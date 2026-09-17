/**
 * 取景模式 —— 「只露上半身的笔记本观众」和「退后让我看全身的人」之间，**实时**怎么切。纯函数。
 *
 * 来路与裁定写在 `docs/49-AUTO-FRAMING.md` §5（落地）与 §6（问题定义与修正）。这里放五件可证伪的东西：
 *
 *  1. **分类器** `createFramingClassifier()`：一帧 `RawPose` + `dt` → `full` / `upper` / `stepping-back`，
 *     带滞回、漏桶式的连续成立、切换冷却。**它不裁任何图**（docs/49 §3 用法 A 的反馈环），
 *     读的是 MediaPipe 在整幅画面上给出的可见度和位置。
 *  2. **一个控制器** `stepFollow()`：目标去抖（One Euro）→ 速度前馈（有上限）→ 夹住范围 → 稳定延迟 →
 *     死区 + 二次过渡带 → 帧率无关的临界阻尼弹簧 → 限速。舞台中景跟随、小屏裁切、身体的横向根偏移**共用这一个**，
 *     各自只是参数不同（docs/49 §6.5 那张对照表里每一条"采纳"都落在这个函数的一个参数上，不是一个特例）。
 *  3. **景别** `stepShot()`：全景 ↔ 中景按时间走完，任何状态下都不一帧切（减少动态是写明的例外）。
 *  4. **小屏裁切** `stepCrop()`：只在上半身模式、一切正常时放大跟随；任何告警 0.2 秒内限速退回整幅（诚实规则）。
 *  5. **横向** `lateralEvidence()` / `stepLateral()`：躯干在画面里的横坐标 → 身体的有界横向根偏移；出了左右边时报哪一侧。
 *
 * 三条硬规矩（出过事或被研究否掉过的）：
 *  - 模式只由**输出侧**消费：舞台相机的景别、腿要不要换成站姿、小屏的裁切、引导文案、身体的横向位置。
 *    采集端一个像素都不动。
 *  - 没有时钟、没有随机：时间全部从 `dt` 来（AGENTS.md 不变量）。
 *  - 结论要能读出来：每一次读数都带 `why` 和证据，HUD 与 `/dev/framing.html` 直接显示它。
 */
import type { Landmark, RawPose } from './types.ts';
import { AUTOFRAME, CAPTURE, PEOPLE, PREVIEW, REFINE } from './tuning.ts';
import { qualityScale } from './refine.ts';
import { MIRROR_X } from './skeleton.ts';
import { oneEuroStep, type OneEuroState } from './filter.ts';

/** 分类器判出来的状态。`stepping-back` 是过渡态：人正在往后退，景别先给全景，腿先别急着放开 */
export type FramingMode = 'full' | 'upper' | 'stepping-back';
/** 操作员 / 观众选的策略。`auto` = 听分类器；另两个是**叠加**，不是锁（再选 auto 就回去） */
export type FramingPolicy = 'auto' | 'full' | 'upper';
export const FRAMING_POLICIES: readonly FramingPolicy[] = ['auto', 'full', 'upper'];
/** 舞台相机实际给的景别 */
export type Shot = 'full' | 'upper';

/** 为什么是这个模式。HUD 上原样显示，所以每个词都要能被一个现场的人读懂 */
export type FramingWhy =
  | 'start'           // 开机默认全身
  | 'legs-out'        // 膝踝持续不在画内 → 上半身
  | 'legs-appearing'  // 上半身时膝踝开始出现 → 退后中
  | 'shrinking'       // 上半身时肩宽和躯干同时在缩 → 退后中
  | 'legs-in'         // 腿真的进画了 → 全身
  | 'timeout'         // 退后中太久没结论
  | 'abnormal'        // 头 / 肩被切，或者肩根本不可信 → 全身
  | 'absent'          // 人走了 → 全身
  | 'forced';         // 策略不是 auto

// ── 证据 ────────────────────────────────────────────────────────────────────

const NOSE = 0;
const EYE_L = 2, EYE_R = 5, EAR_L = 7, EAR_R = 8;
const SHOULDER_L = 11, SHOULDER_R = 12;
const HIP_L = 23, HIP_R = 24;
/** 膝 · 踝。脚跟脚尖不算：它们在画面底边上最先被裁，也最先被桌子挡，是最不稳定的四个点 */
const LEG_POINTS = [25, 26, 27, 28] as const;
/** 头与肩（0–12）。这里面 ≥ `PREVIEW.outOfFramePoints` 个在画外 = 头被切了 */
const UPPER_LAST = 12;

/**
 * 一个点可不可信。**和 `ui/preview-state.ts` 是同一把尺子**（它从这里 import）：
 * 没有 visibility 字段 = 模型不给这个数，有坐标就当可信。
 */
export function trustedLandmark(l: Landmark | undefined): boolean {
  if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return false;
  const v = l.visibility;
  return typeof v === 'number' && Number.isFinite(v) ? v >= REFINE.occlusionVisibility : true;
}

/** 在画内（带 `PREVIEW.edgeMargin` 余量）。和 `outOfFrame()` 同一条线 */
export function inFrame(l: Landmark): boolean {
  const m = PREVIEW.edgeMargin;
  return l.x >= -m && l.x <= 1 + m && l.y >= -m && l.y <= 1 + m;
}

/**
 * 躯干长（画面高度单位，x 按宽高比折算）。**全仓库只有这一份量法**：多人跟踪（`people.ts`）和横向根偏移都用它。
 * 取「肩中点到胯中点」和「肩宽 × `PEOPLE.torsoPerShoulder`」里**大的那个**：弯腰 / 蹲下时躯干的投影缩到几分之一，
 * 侧身时肩宽缩到几分之一，两件事很少同时发生（开合跳录像里只看躯干长，尺度一帧从 0.16 掉到 0.04，2026-09-14 实测）。
 * 胯给 null = 胯在画外（笔记本前坐着）：只按肩宽折算。
 */
export function torsoScale(sL: Landmark, sR: Landmark, hL: Landmark | null, hR: Landmark | null, aspect = 16 / 9): number {
  const byShoulder = Math.hypot((sL.x - sR.x) * aspect, sL.y - sR.y) * PEOPLE.torsoPerShoulder;
  if (!hL || !hR) return byShoulder;
  const mx = (sL.x + sR.x) / 2, my = (sL.y + sR.y) / 2;
  const hx = (hL.x + hR.x) / 2, hy = (hL.y + hR.y) / 2;
  return Math.max(Math.hypot((mx - hx) * aspect, my - hy), byShoulder);
}

/**
 * 画面里的横坐标 → 舞台上的 x（米）。**全仓库只有这一份折算**（多人站位 `lineup()` 与单人的横向根偏移共用）：
 * 偏离中线 `(cx − 0.5)·aspect` 个画面高度，一个躯干长 = `scale` 个画面高度 = `PEOPLE.torsoMeters` 米；
 * 乘 `MIRROR_X`（docs/04 §1 唯一定义处）：观众往自己右边走，身体往屏幕右边走。
 */
export function imageToStageX(cx: number, scale: number, aspect = 16 / 9): number {
  return MIRROR_X * (cx - 0.5) * aspect * (PEOPLE.torsoMeters / Math.max(PEOPLE.minScale, scale));
}

/** `imageToStageX()` 的逆变换：把当前舞台根位置投回摄像头画面，供画面空间死区比较。 */
export function stageToImageX(x: number, scale: number, aspect = 16 / 9): number {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  return 0.5 + (MIRROR_X * x * Math.max(PEOPLE.minScale, scale)) / (a * PEOPLE.torsoMeters);
}

/**
 * 尺度换人门：近处保留比例判据；远处还必须越过一个绝对画面尺度，免得 0.10 ↔ 0.14
 * 这种只有 4% 画面高的检测波动因为比例大而把同一个人拦成 `hold-jump`。
 */
function lateralScaleJump(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const delta = Math.abs(a - b);
  return delta > AUTOFRAME.lateralIdentityJumpAbsolute
    // 身份分组必须是对称关系：a→b 与 b→a 不能一个算换人、另一个算同一人。
    && delta / Math.max(PEOPLE.minScale, Math.min(Math.abs(a), Math.abs(b))) > AUTOFRAME.identityJump;
}

/** 一帧里分类器看到的全部东西。HUD 和工作台页直接显示它 */
export interface FramingEvidence {
  /** 膝踝四点里可信且在画内的个数（没有 screen 时只看可信） */
  legs: number;
  /** 头与肩可信地在画里（肩两个都可信，且头肩点里在画外的不到门限） */
  upper: boolean;
  /** 头肩点（0–12）里可信但在画外的个数 */
  upperOut: number;
  /** 追踪质量够不够（`refine.ts` 的 `qualityScale`，和小屏同一把尺子）。不够 = 这一帧不作数 */
  quality: boolean;
  /** 肩宽（画面高度为单位，x 按宽高比折算）。NaN = 量不到 */
  shoulder: number;
  /** 躯干长（肩中点到胯中点）；胯不可信时退到颈长（鼻子到肩中点）。NaN = 量不到 */
  torso: number;
  /** 这一帧有没有 screen 坐标。回放录制通常没有：那时只有可见度，没有"在不在画内"，也没有尺度 */
  screen: boolean;
}

/**
 * 一帧 → 证据。`null` = 没有人（和 `main.ts` 的 `detected`、小屏的 `empty` 同一条线）。
 * @param aspect 摄像头画面宽 / 高。x 坐标乘它才和 y 同一个单位（1280×720 = 16/9）
 */
export function frameEvidence(pose: RawPose | null, aspect = 16 / 9): FramingEvidence | null {
  const score = Number.isFinite(pose?.score) ? pose!.score : 0;
  if (!pose || score <= CAPTURE.minScore) return null;
  const quality = qualityScale(score) >= 1;
  const screen = pose.screen?.length ? pose.screen : null;

  if (!screen) {
    // 回放：只有 world 的可见度。腿看不看得见照样有意义（录制里的人确实只露了上半身），
    // "在不在画内"和尺度没有 —— 少一条判据是事实，编一个"都在画内"不是。
    const w = pose.world ?? [];
    return {
      legs: LEG_POINTS.filter((i) => trustedLandmark(w[i]) && hasVisibility(w[i])).length,
      upper: trustedLandmark(w[SHOULDER_L]) && trustedLandmark(w[SHOULDER_R]),
      upperOut: 0, quality, shoulder: NaN, torso: NaN, screen: false,
    };
  }

  const legs = LEG_POINTS.filter((i) => trustedLandmark(screen[i]) && inFrame(screen[i])).length;
  let upperOut = 0;
  for (let i = 0; i <= UPPER_LAST; i++) {
    const l = screen[i];
    if (trustedLandmark(l) && !inFrame(l)) upperOut++;
  }
  const sL = screen[SHOULDER_L], sR = screen[SHOULDER_R];
  const shouldersOk = trustedLandmark(sL) && trustedLandmark(sR) && inFrame(sL) && inFrame(sR);
  // 头在不在：鼻子或任一只耳朵可信地在画内。**光数"画外的可信点"不够** ——
  // MediaPipe 给出了上边的头的可见度往往只有 0.1–0.3，于是它们根本不算可信点，
  // 一个头被整个切掉的人会被数成"画外 0 个"。合成时间线第一版就是这么漏的。
  const headIn = [NOSE, EAR_L, EAR_R].some((i) => trustedLandmark(screen[i]) && inFrame(screen[i]));
  const upper = shouldersOk && headIn && upperOut < PREVIEW.outOfFramePoints;

  const d = (a: Landmark, b: Landmark): number => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const mid = (a: Landmark, b: Landmark): Landmark => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: 0 });
  const shoulder = shouldersOk ? d(sL, sR) : NaN;
  let torso = NaN;
  if (shouldersOk) {
    const hL = screen[HIP_L], hR = screen[HIP_R], nose = screen[NOSE];
    if (trustedLandmark(hL) && trustedLandmark(hR)) torso = d(mid(sL, sR), mid(hL, hR));
    else if (trustedLandmark(nose)) torso = d(mid(sL, sR), nose) * TORSO_PER_NECK;
  }
  return { legs, upper, upperOut, quality, shoulder, torso, screen: true };
}

/**
 * 颈长（鼻子到肩中点）折成躯干长的系数。只用于**趋势**（比例），不用于绝对值 ——
 * 乘它是为了胯时有时无的时候，两种量法之间不跳一个台阶被当成"换了个人"。
 * 标准站姿里鼻子到肩中点 ≈ 0.20 身高单位、肩到胯 ≈ 0.45。
 */
const TORSO_PER_NECK = 2.25;

const hasVisibility = (l: Landmark | undefined): boolean =>
  typeof l?.visibility === 'number' && Number.isFinite(l.visibility);

// ── 分类器 ──────────────────────────────────────────────────────────────────

export interface FramingReading {
  mode: FramingMode;
  why: FramingWhy;
  /** 在当前模式里待了多少秒 */
  inMode: number;
  /** 这一帧的证据；没有人时是 null */
  evidence: FramingEvidence | null;
  /** 尺度趋势：此刻 / 窗口内最大值（肩宽与躯干取较大的那个 —— 两者都缩才算缩）。NaN = 没得比 */
  trend: number;
  /** 冷却还剩多少秒 */
  cooldown: number;
  /** 这一帧摄像头自己在取景（`capture/cam-framing.ts` 读到 `faceFraming` 开着）。缺省 false */
  cameraFraming?: boolean;
}

/** 每帧可变的外部事实。缺省 = 这一版之前的行为 */
export interface ClassifierFrame {
  /**
   * 摄像头 / 系统自己在取景（Center Stage、Studio Effects、W3C `faceFraming`，docs/49 §6.3 三）。
   * 那时腿不在是预期：进上半身走快档；**不用尺度趋势判退后**（摄像头自己在缩放，尺度不再说明人在动）。
   */
  cameraFraming?: boolean;
  /** 这一帧 `screen` 坐标所属的原始画幅；缺省沿用构造时的兼容值。 */
  aspect?: number;
}

export interface FramingClassifier {
  update(pose: RawPose | null, dt: number, frame?: ClassifierFrame): FramingReading;
  readonly current: FramingReading;
  reset(): void;
}

export interface ClassifierOptions {
  /** 现场：全身优先（`AUTOFRAME.enterUpperSecondsKiosk`），也没有"刚出现时快切"那一档 */
  kiosk?: boolean;
  aspect?: number;
}

/**
 * 漏桶：条件成立时加 dt，不成立时扣 2·dt，不低于 0。
 * 为什么不是"不成立就清零"：真实的腿会偶尔一帧冒一个点，清零会让"坐下来"永远憋不满。
 * 为什么不是"不成立就不动"：门限上 50/50 的颤动会慢慢攒满，最后跳一下 —— 那正是要防的。
 */
const leak = (held: number, on: boolean, dt: number): number => (on ? held + dt : Math.max(0, held - 2 * dt));

export function createFramingClassifier(opts: ClassifierOptions = {}): FramingClassifier {
  const T = AUTOFRAME;
  const fallbackAspect = Number.isFinite(opts.aspect) && (opts.aspect ?? 0) > 0 ? opts.aspect! : 16 / 9;
  let mode: FramingMode = 'full';
  let why: FramingWhy = 'start';
  let inMode = 0;
  let cooldown = 0;
  let present = 0;
  let absent = 0;
  let toUpper = 0, toStep = 0, toFull = 0, toAbnormal = 0;
  /** 尺度窗口：[还剩几秒过期, 肩宽, 躯干] */
  let windowS: Array<[number, number, number]> = [];
  let last: [number, number] | null = null;
  let cam = false;
  let current: FramingReading = { mode, why, inMode, evidence: null, trend: NaN, cooldown, cameraFraming: false };

  function go(next: FramingMode, because: FramingWhy, cool = true): void {
    if (next === mode) return;
    mode = next;
    why = because;
    inMode = 0;
    if (cool) cooldown = T.cooldownSeconds;
    toUpper = toStep = toFull = toAbnormal = 0;
  }

  /** 喂一个尺度样本，返回 此刻 / 窗口最大（两个量里较大的那个比值）。换人时清空 */
  function trendOf(ev: FramingEvidence, dt: number): number {
    for (const s of windowS) s[0] -= dt;
    windowS = windowS.filter((s) => s[0] > 0);
    if (!ev.screen || !Number.isFinite(ev.shoulder) || !Number.isFinite(ev.torso)) { last = null; return NaN; }
    if (last) {
      const jump = Math.max(Math.abs(ev.shoulder / last[0] - 1), Math.abs(ev.torso / last[1] - 1));
      if (jump > T.identityJump) windowS = [];
    }
    last = [ev.shoulder, ev.torso];
    windowS.push([T.stepBackWindow, ev.shoulder, ev.torso]);
    let maxS = 0, maxT = 0;
    for (const [, s, t] of windowS) { maxS = Math.max(maxS, s); maxT = Math.max(maxT, t); }
    return Math.max(ev.shoulder / maxS, ev.torso / maxT);
  }

  function read(ev: FramingEvidence | null, trend: number): FramingReading {
    current = { mode, why, inMode, evidence: ev, trend, cooldown, cameraFraming: cam };
    return current;
  }

  return {
    update(pose, dtIn, frame) {
      const dt = Number.isFinite(dtIn) && dtIn > 0 ? Math.min(dtIn, 0.25) : 0;
      cam = frame?.cameraFraming === true;
      inMode += dt;
      cooldown = Math.max(0, cooldown - dt);
      const aspect = Number.isFinite(frame?.aspect) && (frame?.aspect ?? 0) > 0 ? frame!.aspect! : fallbackAspect;
      const ev = frameEvidence(pose, aspect);

      if (!ev) {
        absent += dt;
        present = 0;
        last = null;
        windowS = [];
        toUpper = toStep = toFull = toAbnormal = 0;
        if (absent >= T.absentResetSeconds && mode !== 'full') go('full', 'absent', false);
        return read(null, NaN);
      }
      absent = 0;
      present += dt;
      const trend = trendOf(ev, dt);

      // 光不够：这一帧的可见度不可信（腿的可见度会跟着一起塌，看起来像"只露上半身"）。
      // **保持当前模式**，桶只漏不加 —— 坏光不该把人判成坐下了。
      if (!ev.quality) {
        toUpper = leak(toUpper, false, dt); toStep = leak(toStep, false, dt);
        toFull = leak(toFull, false, dt); toAbnormal = leak(toAbnormal, false, dt);
        return read(ev, trend);
      }

      // 头 / 肩被切：不是一个上半身取景，是一个出了问题的取景 → 全景，诚实，不等冷却
      toAbnormal = leak(toAbnormal, !ev.upper, dt);
      if (!ev.upper) {
        if (toAbnormal >= T.abnormalSeconds && mode !== 'full') go('full', 'abnormal');
        return read(ev, trend);
      }

      const legsOut = ev.legs <= T.legsOutMax;
      const legsIn = ev.legs >= T.legsInMin;
      // 摄像头自己在缩放时，尺度变小不说明人在往后退
      const shrinking = !cam && Number.isFinite(trend) && trend <= 1 - T.stepBackShrink;

      if (mode === 'full') {
        // 摄像头在取景：腿被它裁掉是预期，现场的"全身优先"也让位 —— 等 3 秒只是在让观众看一双坏腿
        const need = cam || (!opts.kiosk && present <= T.firstWindowSeconds) ? T.enterUpperFirstSeconds
          : opts.kiosk ? T.enterUpperSecondsKiosk : T.enterUpperSeconds;
        toUpper = leak(toUpper, legsOut, dt);
        // 冷却期间桶可以继续积累，但真正切换的这一帧仍必须有 legs-out 证据。
        // 否则候选刚消失、桶还没漏到门限下，又恰好冷却归零时，会用过期证据误切。
        if (legsOut && toUpper >= need && cooldown <= 0) go('upper', 'legs-out');
      } else if (mode === 'upper') {
        const appearing = !legsOut;
        const stepping = appearing || shrinking;
        toStep = leak(toStep, stepping, dt);
        // 刚切进 upper 就开始退后，是上一判断需要立刻纠正，不该再等那次切换留下的全局冷却。
        // 仍然必须攒满同一份连续证据；底边抖动的漏桶与当前帧守卫都没有放宽。
        if (stepping && toStep >= T.stepBackConfirmSeconds) go('stepping-back', appearing ? 'legs-appearing' : 'shrinking');
      } else {
        toFull = leak(toFull, legsIn, dt);
        // 退后完成不等冷却：人已经退到位了，再让他等一秒是在惩罚照做的人
        if (toFull >= T.enterFullSeconds) go('full', 'legs-in', false);
        else if (inMode >= T.stepBackTimeoutSeconds) go(legsOut ? 'upper' : 'full', 'timeout');
      }
      return read(ev, trend);
    },
    get current() { return current; },
    reset() {
      mode = 'full'; why = 'start'; inMode = 0; cooldown = 0; present = 0; absent = 0; cam = false;
      toUpper = toStep = toFull = toAbnormal = 0; windowS = []; last = null;
      current = { mode, why, inMode, evidence: null, trend: NaN, cooldown, cameraFraming: false };
    },
  };
}

/** 策略 × 分类器 → 这一帧输出侧该怎么做。**所有消费者只读这个**，不各自再判一次 */
export interface FramingDecision {
  policy: FramingPolicy;
  mode: FramingMode;
  /** 舞台相机的景别 */
  shot: Shot;
  /** 腿换成站姿（不被低可见度的腿点驱动） */
  holdLegs: boolean;
  /** 「上半身是一个正当的取景」：引导文案与 WRN12 不因为腿在画外而说话 */
  upperIsIntended: boolean;
}

/**
 * @param frame.cameraFraming 摄像头自己在取景：腿被它裁掉，往后退救不了 —— 引导不为画面下边说话，**任何策略下**都是
 */
export function decide(policy: FramingPolicy, r: Pick<FramingReading, 'mode'>, frame?: ClassifierFrame): FramingDecision {
  const cam = frame?.cameraFraming === true;
  if (policy === 'full') {
    // 强制全景只管景别。腿照样听分类器：选了全景的笔记本观众不该因此拿到一双坏腿
    return { policy, mode: r.mode, shot: 'full', holdLegs: r.mode !== 'full', upperIsIntended: cam };
  }
  if (policy === 'upper') return { policy, mode: r.mode, shot: 'upper', holdLegs: true, upperIsIntended: true };
  return {
    policy, mode: r.mode,
    shot: r.mode === 'upper' ? 'upper' : 'full',
    // 退后中腿还没进画，先别放开；进画了才是 full
    holdLegs: r.mode !== 'full',
    upperIsIntended: r.mode === 'upper' || cam,
  };
}

/** `?framing=` 认的值。认不出来由 `shell/kiosk.ts` 喊一声 */
export const isFramingPolicy = (v: unknown): v is FramingPolicy =>
  typeof v === 'string' && (FRAMING_POLICIES as readonly string[]).includes(v);

// ── 控制器：去抖 → 前馈 → 夹住 → 稳定延迟 → 死区 → 临界阻尼弹簧 → 限速 ─────────

export interface Follow {
  x: number;
  v: number;
  /** 目标的 One Euro 状态（参数里有 `jitter` 才有） */
  f?: OneEuroState;
  /** 目标速度估计（单位/秒）与上一帧的目标（参数里有 `lead` 才有） */
  tv?: number;
  tp?: number;
  /** 稳定计时：目标在死区外连续成立了多久（漏桶，参数里有 `settle` 才有） */
  st?: number;
}

export interface FollowParams {
  deadZone: number;
  band: number;
  /** 角频率（1/秒）。临界阻尼：不过冲 */
  omega: number;
  /** |x| 的上限 */
  range: number;
  /** 速度上限（单位/秒）。临界阻尼从静止起步本来就慢，**大距离**时峰值速度 ≈ 0.37·ω·距离，要靠它压住 */
  maxSpeed?: number;
  /**
   * 稳定延迟（秒）：目标在死区外**连续成立**这么久（漏桶）才开始动；已经在动的不再等。
   * 人换个姿势、侧一下身，镜头不追；人真的挪了位置，停稳之后才跟过去（ChromiumOS 1 秒稳定期的思路，缩短了）。
   */
  settle?: number;
  /** 速度前馈（秒）：目标 += 目标速度 × lead，夹在 ±`leadMax`。快速横穿时少落后一截；停下时最多冲过 `leadMax` */
  lead?: number;
  leadMax?: number;
  /** 目标去抖（One Euro，`filter.ts` 同一份数学）。检测抖动在进弹簧之前就被压掉，死区不用开得那么大 */
  jitter?: { minCutoff: number; beta: number };
}

/**
 * 误差过死区。`|e| ≤ d → 0`；`d < |e| < d+n → (|e|−d)²/2n`；之后线性（减去 d + n/2）。
 * 三段在接缝处值与斜率都连续 —— 死区边上没有一个"台阶"让画面一顿。
 */
export function deadZone(e: number, d: number, n: number): number {
  const a = Math.abs(e);
  if (!(a > d)) return 0;
  const band = Math.max(1e-9, n);
  const out = a < d + band ? ((a - d) * (a - d)) / (2 * band) : a - d - band / 2;
  return Math.sign(e) * out;
}

/** 前馈的速度估计用多长的时间常数（秒）。短：停下时前馈很快撤掉；长：推理 30Hz 的台阶不被当成速度 */
const LEAD_TAU = 0.15;

/**
 * 一步跟随。弹簧部分是**闭式解**，不是欧拉积分：同一段时间切成 60 步和切成 20 步，落到同一个位置
 *（帧率无关 —— 降帧时镜头不会追得更慢或者更弹）。去抖、前馈、稳定延迟是一阶的近似，参数缺省时整条退回原来那个弹簧。
 * 目标不是有限数 = **冻结**：弹簧只把余速耗掉（跟丢、光不够时用它，不往任何地方漂）。
 */
export function stepFollow(s: Follow, target: number, dt: number, p: FollowParams): Follow {
  const x0 = Number.isFinite(s.x) ? s.x : 0;
  const v0 = Number.isFinite(s.v) ? s.v : 0;
  const t = Number.isFinite(dt) && dt > 0 ? dt : 0;
  let f = s.f, tv = s.tv ?? 0, tp = s.tp, st = s.st ?? 0;
  let goal = Number.isFinite(target) ? target : NaN;
  if (Number.isFinite(goal)) {
    if (p.jitter) { f = oneEuroStep(f, goal, t, p.jitter); goal = f.x; }
    if (p.lead) {
      const raw = tp !== undefined && Number.isFinite(tp) && t > 0 ? (goal - tp) / t : 0;
      tv += (raw - tv) * (t > 0 ? 1 - Math.exp(-t / LEAD_TAU) : 0);
      tp = goal;
      const m = p.leadMax ?? Infinity;
      goal += Math.max(-m, Math.min(m, tv * p.lead));
    }
    goal = Math.max(-p.range, Math.min(p.range, goal));
  } else {
    tv = 0; tp = undefined;
  }

  let aim = x0;
  if (Number.isFinite(goal)) {
    const e = goal - x0;
    // 死区作用在"离目标多远"上：人在死区里晃，目标就是自己，弹簧只把余速耗掉
    if (p.settle) {
      st = leak(st, Math.abs(e) > p.deadZone, t);
      if (st >= p.settle || Math.abs(v0) > 1e-3) aim = x0 + deadZone(e, p.deadZone, p.band);
    } else {
      aim = x0 + deadZone(e, p.deadZone, p.band);
    }
  }
  const w = Math.max(1e-6, p.omega);
  const e0 = x0 - aim;
  const k = Math.exp(-w * t);
  const c = v0 + w * e0;
  let x = aim + (e0 + c * t) * k;
  let v = (v0 - w * c * t) * k;
  if (x > p.range) { x = p.range; v = Math.min(0, v); }
  if (x < -p.range) { x = -p.range; v = Math.max(0, v); }
  // 限速放在夹住之后：范围突然收窄时（景别推近、窗口变窄），位置按限速收回去，而不是一帧被夹过去
  if (p.maxSpeed && t > 0) {
    const lim = p.maxSpeed * t;
    if (x - x0 > lim) { x = x0 + lim; v = Math.min(v, p.maxSpeed); }
    else if (x0 - x > lim) { x = x0 - lim; v = Math.max(v, -p.maxSpeed); }
  }
  const out: Follow = { x, v };
  if (p.jitter && f) out.f = f;
  if (p.lead) { out.tv = tv; out.tp = tp; }
  if (p.settle) out.st = st;
  return out;
}

/** 线性地朝 0 / 1 走，`seconds` 走完全程。景别和腿的混合都用它，外面再套 smoothstep */
export function stepToward(now: number, target: number, dt: number, seconds: number): number {
  const t = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (!(seconds > 0)) return target;
  const d = target - now;
  const step = t / seconds;
  return Math.abs(d) <= step ? target : now + Math.sign(d) * step;
}

export const smoothstep = (x: number): number => {
  const t = Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
  return t * t * (3 - 2 * t);
};

// ── 景别：中景的混合 + 跟随 ──────────────────────────────────────────────────

export interface ShotState {
  /** 0 = 全景，1 = 中景（进度用的时候套 smoothstep） */
  progress: number;
  /** 景别进度速度（1/秒）。保留它，目标反向时才能先刹车、再回头。 */
  velocity: number;
  fx: Follow;
  fy: Follow;
}

export const SHOT_REST: ShotState = { progress: 0, velocity: 0, fx: { x: 0, v: 0 }, fy: { x: 0, v: 0 } };

export interface ShotInput {
  shot: Shot;
  /** 上半身相对静止站姿的偏移（米）：x = 头胸相对骨盆的横向（前倾），y = 头的高度差。null = 这一帧没有骨架 */
  offset: { x: number; y: number } | null;
  /** `prefers-reduced-motion` */
  reduced: boolean;
  /**
   * 帧循环在降级 / 无人降帧（治理那条线在砍工作量）：**跟随冻结**，景别照常按时间走完。
   * §5.4 原来的裁定是"直接切到位"，docs/49 §6.2 查出它正是"没有过渡"的一个根因：
   * 一段按时间推的 1 秒运镜在低帧率下是几步大一点的台阶，一帧切才是真的跳。
   */
  hold: boolean;
}

/**
 * 一步景别。时间与状态驱动，**不依赖任何 CSS 过渡或动画结束事件**
 *（ui/controls.css、shell/notice.css 里写着的 1.7 fps 教训：静止态不许等一段动画走完才成立）。
 */
export function stepShot(s: ShotState, input: ShotInput, dt: number): ShotState {
  const target = input.shot === 'upper' ? 1 : 0;
  const T = AUTOFRAME;
  const t = Number.isFinite(dt) && dt > 0 ? dt : 0;
  let progress: number;
  let velocity: number;
  if (input.reduced) {
    progress = stepToward(s.progress, target, t, T.shotSecondsReduced);
    velocity = 0;
  } else {
    // 闭式临界阻尼：不是逐帧欧拉积分，同一段时间在 15/30/60/120Hz 下走近同一条轨迹。
    // 与旧的 stepToward 不同，速度属于状态；目标反向时先耗掉旧速度，不会当帧翻号。
    const x0 = Math.min(1, Math.max(0, Number.isFinite(s.progress) ? s.progress : 0));
    const rawVelocity = Number.isFinite(s.velocity) ? s.velocity : 0;
    const v0 = Math.max(-T.shotMaxSpeed, Math.min(T.shotMaxSpeed, rawVelocity));
    if (t <= 0) {
      progress = x0;
      velocity = v0;
    } else {
      const w = Math.max(1e-6, T.shotOmega);
      const e0 = x0 - target;
      const k = Math.exp(-w * t);
      const c = v0 + w * e0;
      progress = target + (e0 + c * t) * k;
      velocity = (v0 - w * c * t) * k;

      const limit = T.shotMaxSpeed * t;
      if (progress - x0 > limit) { progress = x0 + limit; velocity = Math.min(velocity, T.shotMaxSpeed); }
      else if (x0 - progress > limit) { progress = x0 - limit; velocity = Math.max(velocity, -T.shotMaxSpeed); }
      velocity = Math.max(-T.shotMaxSpeed, Math.min(T.shotMaxSpeed, velocity));

      if (progress >= 1) { progress = 1; velocity = Math.min(0, velocity); }
      else if (progress <= 0) { progress = 0; velocity = Math.max(0, velocity); }
      // 端点附近 smoothstep 已把剩余画面差压到不可见；精确收口，免得舞台永久为尾数重算。
      if (Math.abs(target - progress) <= T.shotSettlePosition && Math.abs(velocity) <= T.shotSettleVelocity) {
        progress = target;
        velocity = 0;
      }
    }
  }
  // 减少动态：中景不跟随，偏移收回 0（一个固定机位的中景）。写明的例外：这一下允许是一次切
  if (input.reduced) return { progress, velocity, fx: { x: 0, v: 0 }, fy: { x: 0, v: 0 } };
  if (input.hold) return { progress, velocity, fx: { ...s.fx, v: 0 }, fy: { ...s.fy, v: 0 } };
  const follow = target === 1 && input.offset;
  const gx = follow ? input.offset!.x : 0;
  const gy = follow ? input.offset!.y : 0;
  // 回全景时不要死区也不要稳定延迟：死区会让偏移停在离 0 还有 4cm 的地方，下一次进中景就从一个旧偏移起步
  const base: Omit<FollowParams, 'range'> = follow
    ? { deadZone: T.followDeadZone, band: T.followBand, omega: T.followOmega, maxSpeed: T.followMaxSpeed, settle: T.followSettleSeconds, jitter: T.followJitter }
    : { deadZone: 0, band: 1e-6, omega: T.followOmega, maxSpeed: T.followMaxSpeed };
  return {
    progress,
    velocity,
    fx: stepFollow(s.fx, gx, dt, { ...base, range: T.followRangeX }),
    fy: stepFollow(s.fy, gy, dt, { ...base, range: T.followRangeY }),
  };
}

// ── 小屏数字裁切 ────────────────────────────────────────────────────────────

export interface Crop {
  /** 放大倍数，1 = 整幅 */
  zoom: number;
  /** 窗口中心（画面归一化坐标） */
  cx: Follow;
  cy: Follow;
  z: Follow;
  /** 上半身取景里人（的头肩）量不到多久了（秒）。量不到时先停在原处，`previewLostHoldSeconds` 之后才慢慢放回整幅 */
  lost?: number;
}

export const CROP_FULL: Crop = { zoom: 1, cx: { x: 0.5, v: 0 }, cy: { x: 0.5, v: 0 }, z: { x: 1, v: 0 } };

export interface CropInput {
  /** 上半身是正当取景（`FramingDecision.upperIsIntended`），而且没有减少动态、画里没有别的有身体的人 */
  active: boolean;
  /**
   * 诚实规则：出画、退后中、任何告警（小屏的状态不是 `ok`）→ 退回整幅，`previewSnapSeconds` 内**限速**走完。
   * 让画框的边重新可见，那正是「往后退一点」的证据（docs/49 §3 用法 B）。
   */
  snap: boolean;
  /** 这一帧的 screen 坐标（原始，滤波之前 —— 和小屏同一份） */
  screen: readonly Landmark[] | undefined;
  /** 分辨率下限给出的放大上限（`cropZoomLimit()`）。缺省 = `previewZoom` */
  maxZoom?: number;
}

/**
 * 放大倍数的分辨率下限：裁出来的那块在源画面里至少还有「显示高度 × `previewMinSourcePerDisplayPx`」个像素。
 * 480p 的摄像头放进 1080 屏上 216px 高（×2 dpr）的小屏，1.3× 已经在放大像素 —— 那时就不放大。
 */
export function cropZoomLimit(sourceHeight: number, displayHeight: number): number {
  const T = AUTOFRAME;
  if (!(sourceHeight > 0) || !(displayHeight > 0)) return T.previewZoom;
  return Math.max(1, Math.min(T.previewZoom, sourceHeight / (displayHeight * T.previewMinSourcePerDisplayPx)));
}

/**
 * 上半身取景的目标：横向在两肩中点（肩不全时退到头），**眼睛落在窗口上三分之一**（`previewEyeLine`，头顶留白的通行规矩）。
 * 量不到（头一个都不在画内、肩和头加起来不到两个）= null。
 */
export function cropTarget(screen: readonly Landmark[] | undefined, zoom: number = AUTOFRAME.previewZoom): { x: number; y: number } | null {
  if (!screen?.length) return null;
  const ok = (i: number): boolean => trustedLandmark(screen[i]) && inFrame(screen[i]);
  const head = [NOSE, EYE_L, EYE_R, EAR_L, EAR_R].filter(ok).map((i) => screen[i]);
  const shoulders = ok(SHOULDER_L) && ok(SHOULDER_R);
  if (!head.length || (!shoulders && head.length < 2)) return null;
  const eyeY = head.reduce((a, l) => a + l.y, 0) / head.length;
  const x = shoulders ? (screen[SHOULDER_L].x + screen[SHOULDER_R].x) / 2 : head.reduce((a, l) => a + l.x, 0) / head.length;
  return { x, y: eyeY + (0.5 - AUTOFRAME.previewEyeLine) / Math.max(1, zoom) };
}

export function stepCrop(c: Crop, input: CropInput, dt: number): Crop {
  const T = AUTOFRAME;
  const t = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const cap = Math.max(1, Math.min(T.previewZoom, Number.isFinite(input.maxZoom) ? input.maxZoom! : T.previewZoom));
  let zoom: number, z: Follow, fx: Follow, fy: Follow;
  let lost = 0;
  if (input.snap) {
    // 诚实规则：退回整幅，但按时间限速走完，不是当帧。窗口中心不追任何东西，只被下面那个随放大倍数收窄的夹子带回中间
    zoom = Math.max(1, c.zoom - ((T.previewZoom - 1) / Math.max(1e-3, T.previewSnapSeconds)) * t);
    z = { x: zoom, v: 0 };
    fx = { x: c.cx.x - 0.5, v: 0 };
    fy = { x: c.cy.x - 0.5, v: 0 };
  } else {
    const target = input.active ? cropTarget(input.screen, cap) : null;
    lost = input.active && !target ? (c.lost ?? 0) + t : 0;
    // 跟丢：先停在原处（NaN = 冻结），过了保持期再放回整幅 —— 一帧没检出不该让小屏一缩一放
    const holding = lost > 0 && lost < T.previewLostHoldSeconds;
    const zf = stepFollow(
      { ...c.z, x: c.z.x - 1 }, target ? cap - 1 : holding ? NaN : 0, t,
      { deadZone: 0, band: 1e-6, omega: T.previewZoomOmega, range: Math.max(0, T.previewZoom - 1), maxSpeed: T.previewZoomMaxSpeed },
    );
    zoom = 1 + zf.x;
    z = { ...zf, x: zoom };
    const p: FollowParams = {
      deadZone: T.previewDeadZone, band: T.previewBand, omega: T.previewOmega,
      // 窗口不许伸出画面：中心夹在 [0.5/zoom, 1 − 0.5/zoom]。用 range 表达成"离 0.5 最多多远"
      range: Math.max(0, 0.5 - 0.5 / Math.max(1, T.previewZoom)),
      maxSpeed: T.previewMaxSpeed, settle: T.previewSettleSeconds,
      lead: T.previewLead, leadMax: T.previewLeadMax, jitter: T.previewJitter,
    };
    const g = (v: number | undefined): number => (target ? v! - 0.5 : holding ? NaN : 0);
    fx = stepFollow({ ...c.cx, x: c.cx.x - 0.5 }, g(target?.x), t, p);
    fy = stepFollow({ ...c.cy, x: c.cy.x - 0.5 }, g(target?.y), t, p);
  }
  const lim = 0.5 - 0.5 / zoom;
  const clamp = (v: number): number => Math.max(-lim, Math.min(lim, v));
  const out: Crop = { zoom, cx: { ...fx, x: 0.5 + clamp(fx.x) }, cy: { ...fy, x: 0.5 + clamp(fy.x) }, z };
  if (lost > 0) out.lost = lost;
  return out;
}

// ── 横向：躯干在画面里的位置 → 身体的横向根偏移 ─────────────────────────────

/** 观众**自己的**左右（= 镜像显示上的左右）。画面 x 是摄像头原图，没有镜像：观众往右走，画面 x 变小 */
export type Side = 'left' | 'right';

export interface LateralEvidence {
  /** 根的画面横坐标（原图 0..1）：成对可信的胯中点；近处胯被裁时退到成对可信的肩中点。 */
  x: number;
  /** 躯干长（画面高度单位，`torsoScale()`） */
  scale: number;
  /** 躯干宽度里越过左 / 右边的比例，两边取大的那个 */
  out: number;
  /** 哪一侧出了画（观众自己的左右）。两边都出 = null：那是离得太近，不是走偏了 */
  side: Side | null;
  /** 追踪质量够（`qualityScale ≥ 1`）。不够 = 冻结，不往一个坏光下的坐标漂 */
  quality: boolean;
  /**
   * 胯或肩至少有一对可信，且其中一点在画内。false = 位置全靠 MediaPipe 外推：**侧边照样报**（人确实在那一侧的边外），
   * 但位置不作数 —— 没有侧边时控制器把它当成跟丢。
   */
  trusted: boolean;
}

/**
 * 一帧 → 横向证据。`null` = 没有横向证据：没有人、没有 `screen`（回放录制）、两肩连坐标都没有。
 * 躯干点一个都不可信时照样返回（`trusted: false`）：整个人走出一边、检测还在的那几秒，正是最该报侧边的时候
 *（第一版要求"至少一个可信点"，取证时间线里侧边只报了 0.25 秒，然后身体在人还站在边外时回了中线，docs/49 §6.6）。
 *
 * 越界按**坐标**算，不按可信点数：MediaPipe 对画外的点给低可见度，数可信点的话半个人出了左边也数不出一个（docs/49 §6.2 S4）。
 */
export function lateralEvidence(pose: RawPose | null | undefined, aspect = 16 / 9): LateralEvidence | null {
  const score = Number.isFinite(pose?.score) ? pose!.score : 0;
  if (!pose || score <= CAPTURE.minScore) return null;
  const s = pose.screen;
  if (!s?.length) return null;
  const has = (l: Landmark | undefined): l is Landmark => !!l && Number.isFinite(l.x) && Number.isFinite(l.y);
  const sL = s[SHOULDER_L], sR = s[SHOULDER_R], hL = s[HIP_L], hR = s[HIP_R];
  if (!has(sL) || !has(sR)) return null;
  const hips = has(hL) && has(hR);
  const torso = hips ? [sL, sR, hL, hR] : [sL, sR];
  const shouldersTrusted = trustedLandmark(sL) && trustedLandmark(sR) && (inFrame(sL) || inFrame(sR));
  const hipsTrusted = hips && trustedLandmark(hL) && trustedLandmark(hR) && (inFrame(hL) || inFrame(hR));
  // 坐标“存在”不等于可以驱动根。近处胯被裁时 MediaPipe 仍会给两个有限、但低置信的外推点：
  // 用它们会让身体突然冲向画边。可信胯仍优先（不把前倾当迈步），胯不可信才用可信肩。
  const trusted = hipsTrusted || shouldersTrusted;
  const x = hipsTrusted
    ? (hL.x + hR.x) / 2
    : shouldersTrusted
      ? (sL.x + sR.x) / 2
      : hips ? (hL.x + hR.x) / 2 : (sL.x + sR.x) / 2;
  const scale = torsoScale(sL, sR, hipsTrusted ? hL : null, hipsTrusted ? hR : null, aspect);
  const xs = torso.map((l) => l.x * aspect);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  // 侧身时躯干宽度缩到几乎为 0：分母给一个按躯干长折算的下限，免得一点抖动就是"一半出画"
  const width = Math.max(hi - lo, AUTOFRAME.lateralMinTorsoWidth * scale, 1e-6);
  const m = PREVIEW.edgeMargin;
  const outL = Math.max(0, -m * aspect - lo) / width;
  const outR = Math.max(0, hi - (1 + m) * aspect) / width;
  const f = AUTOFRAME.lateralSideFraction;
  const edge = outL >= f && outR < f ? 0 : outR >= f && outL < f ? 1 : null;
  // 画面的哪条边 → 观众的哪一侧：按 MIRROR_X 折，和身体往哪边走同一个符号（docs/04 §1 唯一定义处）
  const side: Side | null = edge === null ? null : MIRROR_X * (edge - 0.5) > 0 ? 'right' : 'left';
  return { x, scale, out: Math.max(outL, outR), side, quality: qualityScale(score) >= 1, trusted };
}

/** 横向根偏移此刻在做什么。HUD 与工作台原样显示 */
export type LateralWhy = 'follow' | 'hold-edge' | 'hold-lost' | 'hold-light' | 'hold-jump' | 'center' | 'yield';

export interface LateralState {
  /** 身体的横向根偏移（米），弹簧状态 */
  x: Follow;
  /** 弹簧此刻追的目标（米，夹住之前） */
  target: number;
  /** 最后一次被接受的根的画面横坐标与尺度（换人判断用）。NaN = 还没有 */
  accepted: number;
  scale: number;
  /** 一帧跳得太远的那个新位置与尺度，和这组身份证据稳定了多久 */
  pending: number;
  pendingScale: number;
  pendingFor: number;
  /** 画面中心与躯干尺度各自的 One Euro 状态；先稳住它们，不能先做 `center / scale` 放大噪声 */
  centerFilter?: OneEuroState;
  scaleFilter?: OneEuroState;
  /** 当前画面死区投影到舞台后的米数；给测试与取景靶场看，不是另一份调参 */
  deadZone: number;
  band: number;
  /** 没有横向证据多久了（秒） */
  lost: number;
  side: Side | null;
  why: LateralWhy;
}

export const LATERAL_REST: LateralState = {
  x: { x: 0, v: 0 }, target: 0, accepted: NaN, scale: NaN,
  pending: NaN, pendingScale: NaN, pendingFor: 0, deadZone: 0, band: 0,
  lost: 0, side: null, why: 'center',
};

export interface LateralInput {
  evidence: LateralEvidence | null;
  /** 舞台此刻看得见的横向余量（米，`stage/framing.ts` 的 `lateralRoom()`，随景别连续变化） */
  room: number;
  /**
   * false = 让位：台上有伴随身体时站位归 docs/50 的 `lineup()`，这里弹回 0。两者都是弹簧，叠加连续。
   */
  enabled: boolean;
  aspect?: number;
  /**
   * 此刻是不是中景（`FramingDecision.shot === 'upper'`）。中景死区更小、弹簧更快
   * （`AUTOFRAME.lateralDeadZoneUpperImage` / `lateralOmegaUpper`）——全景那一档的迟钝
   * 是为了不抢"等身 + 相机距离不动"这条主张的戏，中景本身已经是自适应取景，不受它约束。
   */
  upper?: boolean;
  /**
   * 摄像头此刻**确认**在自己取景（`capture/cam-framing.ts` 的 `getSettings().faceFraming === true`，
   * 不是"支持"，是"正在"）。判别条件：只在**我们自己的证据质量不够**（`hold-light`，光线塌了 /
   * 分辨率不够）时才看它——质量够、或者已经判成了出画（`hold-edge`），这个字段不改变行为。
   *
   * 极端情况下的兜底（作品负责人 2026-09-15 追加要求）：我们自己读不准的时候，
   * 摄像头的取景比我们冻在一个低置信度坐标上更稳——回中线，不硬撑一个不可信的位置。
   * **不是去追它裁到哪**：我们读不到它裁切窗口的坐标（docs/49 §1.3），能读到的只有"它在裁"这一件事。
   */
  cameraFraming?: boolean;
}

/**
 * 一步横向根偏移。镜子：观众往自己左边走，身体往屏幕左边走；相机不跟（docs/49 §3 用法 C）。
 *
 * - 出了左右边 / 光不够：**停在最后那个位置**（不追一个外推出来的、坏光下的坐标）；
 * - 没有横向证据（整个人出画、被挡住、回放）：停 `lateralHoldSeconds`，然后回中线；
 * - 根的画面 x 一帧跳过 `lateralJump`，或尺度一帧跳过 `identityJump`：当成换人（`numPoses = 1` 时 MediaPipe 在两个人之间跳、
 *   或者身后的人被认成了主角）—— 停着，新位置稳定 `lateralJumpConfirmSeconds` 才跟；来回跳就一直停着。
 * 不吃减少动态：那是观众自己的动作，和他抬手是同一类（docs/49 §6.3 一）。
 */
export function stepLateral(s: LateralState, input: LateralInput, dt: number): LateralState {
  const T = AUTOFRAME;
  const t = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const ev = input.evidence;
  const aspect = input.aspect ?? 16 / 9;
  let { target, accepted, scale, pending, pendingScale, pendingFor, centerFilter, scaleFilter, lost } = s;
  let why: LateralWhy;
  let goal: number;
  if (!input.enabled) {
    target = 0; accepted = NaN; scale = NaN; pending = NaN; pendingScale = NaN; pendingFor = 0; lost = 0;
    centerFilter = undefined; scaleFilter = undefined;
    why = 'yield'; goal = 0;
  } else if (!ev || (!ev.side && !ev.trusted)) {
    // 没有证据，或者位置全靠外推、又不在任何一边外（被桌子整个挡住）：跟丢
    lost += t;
    pending = NaN; pendingScale = NaN; pendingFor = 0;
    if (lost >= T.lateralHoldSeconds) {
      target = 0; accepted = NaN; scale = NaN; centerFilter = undefined; scaleFilter = undefined;
      why = 'center'; goal = 0;
    } else { why = 'hold-lost'; goal = NaN; }
  } else if (!ev.side && !ev.quality && input.cameraFraming) {
    // 判别条件 + 兜底：我们自己的质量读数不够，但摄像头确认在自己取景——
    // 信它更稳，回中线好过冻在一个低置信度的坐标上（见 LateralInput.cameraFraming 的注释）
    lost = 0;
    target = 0; accepted = NaN; scale = NaN; pending = NaN; pendingScale = NaN; pendingFor = 0; why = 'center'; goal = 0;
    centerFilter = undefined; scaleFilter = undefined;
  } else if (ev.side || !ev.quality) {
    lost = 0;
    // 出画 / 坏光打断“同一组新身份连续稳定”的证据，回来后必须重新计时。
    pending = NaN; pendingScale = NaN; pendingFor = 0;
    why = ev.side ? 'hold-edge' : 'hold-light';
    goal = NaN;
  } else {
    lost = 0;
    const jumped = Number.isFinite(accepted)
      && (Math.abs(ev.x - accepted) > T.lateralJump || lateralScaleJump(ev.scale, scale));
    let accept = !jumped;
    if (jumped) {
      const samePending = Number.isFinite(pending) && Number.isFinite(pendingScale)
        && Math.abs(ev.x - pending) <= T.lateralJump
        && !lateralScaleJump(ev.scale, pendingScale);
      if (samePending) pendingFor += t;
      else { pending = ev.x; pendingScale = ev.scale; pendingFor = 0; }
      accept = pendingFor >= T.lateralJumpConfirmSeconds;
    }
    if (accept) {
      // 中心和尺度必须先各自稳定，再做 `center / scale` 的透视投影。反过来会把远处的
      // 两份小噪声相乘；米制死区还会让同样的画面移动近处不响应、远处过度响应。
      const freshIdentity = !Number.isFinite(accepted) || jumped;
      centerFilter = oneEuroStep(freshIdentity ? undefined : centerFilter, ev.x, t, T.lateralCenterJitter);
      scaleFilter = oneEuroStep(freshIdentity ? undefined : scaleFilter, ev.scale, t, T.lateralScaleJitter);
      accepted = ev.x; scale = ev.scale; pending = NaN; pendingScale = NaN; pendingFor = 0;
      const currentImageX = stageToImageX(s.x.x, scaleFilter.x, aspect);
      const imageError = (centerFilter.x - currentImageX) * aspect;
      const imageDeadZone = input.upper ? T.lateralDeadZoneUpperImage : T.lateralDeadZoneImage;
      const correctedImageX = currentImageX + deadZone(imageError, imageDeadZone, T.lateralBandImage) / aspect;
      target = imageToStageX(correctedImageX, scaleFilter.x, aspect);
      why = 'follow'; goal = target;
    } else {
      why = 'hold-jump'; goal = NaN;
    }
  }
  // 回中线 / 让位时不要死区：死区会让身体停在中线旁边（和景别回全景同一条理由）
  const centering = why === 'center' || why === 'yield';
  const projectionScale = Math.max(PEOPLE.minScale, scaleFilter?.x ?? scale);
  const metresPerImageHeight = PEOPLE.torsoMeters / projectionScale;
  const deadZoneMetres = centering ? 0
    : (input.upper ? T.lateralDeadZoneUpperImage : T.lateralDeadZoneImage) * metresPerImageHeight;
  const band = centering ? 1e-6 : T.lateralBandImage * metresPerImageHeight;
  const omega = input.upper ? T.lateralOmegaUpper : T.lateralOmega;
  const x = stepFollow(s.x, goal, t, {
    // 横向死区已经在画面空间处理；这里的弹簧只负责连续性、前馈、限速与舞台余量。
    deadZone: 0, band: 1e-6, omega,
    range: Math.max(0, Number.isFinite(input.room) ? input.room : 0),
    maxSpeed: T.lateralMaxSpeed, lead: T.lateralLead, leadMax: T.lateralLeadMax,
  });
  return {
    x, target, accepted, scale, pending, pendingScale, pendingFor,
    centerFilter, scaleFilter, deadZone: deadZoneMetres, band, lost, side: ev?.side ?? null, why,
  };
}
