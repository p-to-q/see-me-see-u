/**
 * 左下角那块读数 —— 一帧的采集结果 → 屏幕上那几行字。**纯函数。**
 *
 * ## 它为什么和 `readout.ts` 分开
 *
 * 和 `preview-state.ts` 分家的理由逐字相同：`readout.ts` 要
 * `import './readout.css'`，而 node 的测试加载不了 .css —— 两者放同一个文件，
 * 这几条判据就永远没有仪表（docs/02 P21）。而这里恰恰是最该有仪表的一块：
 * **一个格式化错误在屏幕上长得和一个真实读数一模一样**。
 *
 * ## 一条硬规矩：没有信号的地方写破折号，不写上一帧的数
 *
 * 运动特征（`MotionFeatures`）在 `main.ts` 里只在**有 pose 的那一帧**更新，
 * 没人的时候 `lastFeatures` 原样留着上一个观众的数。把它照常显示出来，
 * 屏幕上就会出现"空场里有人在动"—— 那是 P21 里最贵的那种仪表：
 * 它报的数是真的，只是**真在另一个时刻**。
 *
 * 所以判据只有一条：**这一帧有没有人**（`posePresent()`：整身平均或可靠躯干对），
 * 和 `main.ts` 的 `detected`、`preview-state.ts` 的 `empty` 是同一条线 ——
 * 三处不许各画一条）。没有人，除了推理频率之外全部写 `—`：
 * 推理是**机器自己**的节拍，空场里它照样在跑，那个数此刻仍然是真的。
 *
 * ## 为什么这里不用 `Presence`
 *
 * `Presence` 带 0.4 秒滞回，而滞回是**作品的决定**（什么时候开始溶解一个人），
 * 不是一次测量。这块读数只报测量，不报决定 —— 那条线画在哪儿、为什么，
 * 写在 `readout.css` 的文件头里。
 */
import type { Landmark, MotionFeatures, RawPose } from '../../../core/src/types.ts';
import { CAPTURE, PREVIEW, REFINE } from '../../../core/src/tuning.ts';
import { qualityScale } from '../../../core/src/refine.ts';
import { outOfFrame } from './preview-state.ts';
import { lateralEvidence } from '../../../core/src/autoframe.ts';
import { posePresent } from '../../../core/src/pose-signal.ts';
import type { Flags } from '../shell/kiosk.ts';

/**
 * 这一场要不要挂这块读数。**判断只有这一处**，`main.ts` 不许自己再判一次
 *（和 `wantsPreview()` / `readFlags().nav` 同一条纪律）。
 *
 * - `?kiosk=1` 默认**不挂**。现场的默认是"零 UI"（docs/23 §S4），
 *   而这块读数过不了那一条的豁免线：左上角那块小屏幕之所以能在现场被要回来，
 *   是因为它回答的是「它有没有看见我」—— 没有那个答案，"零 UI"本身就不成立。
 *   这块读数回答的是「它读到了什么」，**站在装置前面的人对这个答案无能为力**。
 *   现场不是控制室。要它的场合（讲解、评审、开放日）写 `?readout=on`。
 * - 其余（网页版）默认**挂**：那里没有解说员，观众独自面对一具跟着自己动的身体，
 *   而这件作品的问题恰恰是"它在读你的什么"。这块读数是它自己把答案摊开。
 * - `?demo=1` 照常挂，**和那块小屏幕不一样**。小屏幕在回放下会撒谎：
 *   它画的是录像里另一个人的骨架，观众一挥手骨架不跟。这块读数不声称有摄像头，
 *   它报的是**此刻正在驱动这具身体的那份数据**——回放时那份数据就是录像，
 *   而屏幕上那具身体确实由它驱动。没有一行是假的，所以不需要那条例外。
 */
export function wantsReadout(flags: Flags): boolean {
  if (flags.readout) return flags.readout === 'on';
  return !flags.kiosk;
}

/** 六行的 id。顺序就是屏幕上从上到下的顺序 */
export type ReadoutKey = 'confidence' | 'joints' | 'inference' | 'energy' | 'extent';

export const READOUT_KEYS: readonly ReadoutKey[] = [
  'confidence', 'joints', 'inference', 'energy', 'extent',
];

export interface ReadoutInput {
  /** 这一帧的原始采集结果。**不是精化之后的** —— 理由同小屏幕：读数要站在滤波之前 */
  pose: RawPose | null;
  /** 这一帧的运动特征。没人的时候它是上一个人的，所以下面按 `present` 整体作废 */
  features: MotionFeatures | null;
  /** 采集端自报的推理频率（Hz）。`Capture.fps` */
  inferenceHz: number;
  /**
   * 喂进来的是不是**摄像头**。`false` = 回放（从选择页进舞台、摄像头还没开、`?demo=1`）。
   * 录像的每一帧 score 都过线，而录像里的人不在现场 —— 读数只替摄像头说话。缺省 = 摄像头。
   */
  live?: boolean;
  /**
   * 上半身是正当取景（docs/49 §落地）。WRN12 用的是小屏同一把尺子 `outOfFrame()`，
   * 这个开关也原样递过去：从画面下边出去的腿不是"部分出画"，头被切照样是。缺省 false
   */
  upperIsIntended?: boolean;
  /** 摄像头画面宽 / 高；WRN12 与取景/小屏共用。 */
  aspect?: number;
}

export interface Readout {
  /** 这一帧有没有人。屏幕顶上那一行，也是下面五行要不要作废的开关 */
  present: boolean;
  /** 摄像头开着。`false` 时顶上那一行说「摄像头关着」，下面全是破折号 */
  live: boolean;
  /** 五行的值，已经格式化成屏幕上的样子。`—` = 这一刻没有这个数 */
  values: Record<ReadoutKey, string>;
}

/** 没有这个数的时候写它。**不是 0，也不是上一帧** */
export const ABSENT = '—';

/**
 * 有多少个点是模型自己说"看得见"的。返回 `null` = **这个模型不报逐点置信度**。
 *
 * ## 为什么它会是 null，而 null 为什么不能写成 0 或者 33
 *
 * `capture/webcam.ts` 的 `overallScore()` 里写着：有些 MediaPipe 版本
 * `visibility` 恒为 0 或者干脆没有，那时候"检出了 33 个点"本身就是证据，score 记 1。
 * 照抄那条约定，这一行就会出现 **置信 1.00 / 关节 0-33** 的自相矛盾：
 * 同一份数据，一行说满分，一行说一个点都没看见。
 *
 * 所以这里和它用**同一个放弃条件**（一个有限的 visibility 都没有，或者全是 0），
 * 放弃时写 `—`。破折号说的是"这台机器不报这个数"，而 0/33 说的是
 * "它一个点都没看见" —— 后者是假话。
 *
 * ## 为什么不复用 `preview-state.ts` 的 `trusted()`
 *
 * 它们问的不是同一个问题，所以不是一处重复。小屏幕问"这个点在不在画面里"，
 * 缺 visibility 时**当作可信**（当不可信会让整条出画判据在那些模型版本上恒为绿）。
 * 这里问的是"模型报了几个点看得见"，缺 visibility 时根本没有答案。
 * 门限共用 `REFINE.occlusionVisibility` 一个来源，这一点不许分叉。
 */
export function visibleJoints(pose: RawPose | null): number | null {
  const src = pose?.screen?.length ? pose.screen : pose?.world;
  if (!src?.length) return null;
  let seen = 0;
  let sum = 0;
  let n = 0;
  for (const l of src as readonly Landmark[]) {
    const v = l?.visibility;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    n++;
    sum += v;
    if (v >= REFINE.occlusionVisibility) seen++;
  }
  // 和 overallScore() 逐字相同的放弃条件
  if (!n || sum === 0) return null;
  return seen;
}

/** 有限就按 `digits` 位定点写，否则破折号。**不许把 NaN 写成 0** */
function fixed(v: number | undefined, digits: number): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : ABSENT;
}

/**
 * 一个量级跨得很开的数 → 六格宽以内的字符串。
 *
 * **这个函数是实测逼出来的。** 上一版给动能写死三位小数，注释里还写着
 * "量级是 1e-2 ~ 1e-1" —— 那是看 `tuning.ts` 的阈值猜的。
 * 真跑起来（`?demo=1`，jumpingjacks 那段录制）读数是 **1.955**：
 * 动能是"每秒移动多少个身高"，一个正常挥手的人就在 1~3 之间，
 * 站着不动才是 1e-2。猜出来的精度在小的那一端刚好也说得通，
 * 所以它不会在屏幕上露馅 —— 这正是它值得被写下来的原因。
 *
 * 规则：整数部分越长，小数位越少，总宽永远 ≤ 6 格（`readout.css` 的那一栏）。
 * 这样静止的人还能读出 `0.018` 的差别，跳起来的人也不会把面板撑宽。
 */
function scaled(v: number | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return ABSENT;
  const a = Math.abs(v);
  return v.toFixed(a < 10 ? 3 : a < 100 ? 2 : a < 1000 ? 1 : 0);
}

/**
 * `31 Hz` → `['31', 'Hz']`；没有单位的原样返回、单位为空。
 *
 * 数控的读数屏把**单位单独放一栏**：数字右对齐成一条竖线，单位在它右边另起一列。
 * 单位和数字挤在同一格里，`31 Hz` 和 `0.878` 的个位就对不齐 ——
 * 一块读数屏上最该对齐的那条线恰恰断在那儿。
 * 拆在这里（纯函数、能测）而不是在 DOM 里临时切字符串：`readOut()` 的输出格式
 * 已经被一整组测试钉着，改它等于把那组保证重写一遍。
 */
export function splitUnit(s: string): readonly [string, string] {
  const m = /^(.*\S)\s+([A-Za-z]+)$/.exec(s);
  return m ? [m[1], m[2]] : [s, ''];
}

/** 数字宽的空格（U+2007）。等宽字里它和一个数字一样宽，用来垫齐小数点 */
export const FIGURE_SPACE = '\u2007';

/**
 * 小数点竖成一条线：位数少的小数在右边垫数字宽的空格。`0.96` → `0.96 `，`0.878` 不动。
 *
 * 读数屏上人扫的是一列数，而一列数的结构线是小数点。置信写两位（`readOut` 钉死的格式）、
 * 动能和舒展写三位，右对齐之后三个小数点错开一格 —— 每一行都对，整列是乱的。
 * **只垫显示，不改格式**：`readOut()` 的位数被一整组测试钉着，那些保证不该为排版重写。
 * 整数（`31`）和比值（`33/33`）不是小数，不垫，照旧右对齐。垫完不超过 `width`，
 * 不撑破那一栏（数值极大时少垫，宁可那一行的小数点错开，也不回流）。
 */
export function alignDecimals(v: string, digits = 3, width = 6): string {
  const m = /^-?\d+\.(\d+)$/.exec(v);
  if (!m) return v;
  const pad = Math.max(0, Math.min(digits - m[1].length, width - v.length));
  return v + FIGURE_SPACE.repeat(pad);
}

/**
 * 一帧 → 屏幕上那几行。**没有时间、没有随机、没有 DOM**（P1）。
 */
export function readOut(input: ReadoutInput): Readout {
  // 回放：没有一个数是现场的，推理频率也不是（录像没有推理）
  if (input.live === false) {
    return {
      present: false,
      live: false,
      values: { confidence: ABSENT, joints: ABSENT, inference: ABSENT, energy: ABSENT, extent: ABSENT },
    };
  }
  const pose = input.pose;
  const score = Number.isFinite(pose?.score) ? pose!.score : 0;
  const present = posePresent(pose);

  // 推理频率**不跟着 present 作废**：空场里模型照样在跑，那个数此刻仍然是真的。
  // 它同时是这块读数唯一一行"机器自己"的数 —— 全灰的时候它证明机器没死。
  const hz = Number.isFinite(input.inferenceHz) && input.inferenceHz >= 0
    ? `${Math.round(input.inferenceHz)} Hz`
    : ABSENT;

  if (!present) {
    return {
      present: false,
      live: true,
      values: {
        confidence: ABSENT, joints: ABSENT, inference: hz,
        energy: ABSENT, extent: ABSENT,
      },
    };
  }

  const seen = visibleJoints(pose);
  const total = (pose!.screen?.length ? pose!.screen : pose!.world)?.length ?? 0;
  const f = input.features;
  return {
    present: true,
    live: true,
    values: {
      confidence: fixed(score, 2),
      joints: seen === null ? ABSENT : `${seen}/${total}`,
      inference: hz,
      // 动能是"每秒移动多少个身高"（无量纲，见 core/motion.ts），实测跨两个量级：
      // 站着不动 ~0.02，挥手 ~2。定宽一栏里两端都要读得出，所以走 `scaled()`
      energy: scaled(f?.energy),
      // 舒展是四肢离骨盆的平均距离 / 身高。`types.ts` 的注释写着 `0.2..0.8`，
      // 而 jumpingjacks 那段录制实测到 **1.35** —— 那句注释说的是常见区间，
      // 不是值域。所以这一行也走 `scaled()`，不按那个区间写死位数。
      extent: scaled(f?.expansiveness),
    },
  };
}

// ── 告警：测量越界时，数字变色、底下那一行给出代码 ──────────────────────────────

/**
 * 读数板上的三档。`ok` 是满墨；`warn` 琥珀；`alarm` 红（颜色令牌在 `type.css`）。
 *
 * ## 为什么读数板可以有颜色
 *
 * 全站"颜色承担语义"只有一处（docs/26 §F）。仪表是那条清单之外的另一类东西（§F 第二类例外），
 * 而仪表上的颜色有一个作品里其它地方都没有的性质：**它不是一个判断，是一个越界** ——
 * 阈值写在代码里、每一条都来自这件作品**已经在用**的判据，不为显示而另立一条线。
 * 作品负责人要的是"更像真实的数控板、会出现意外情况"；真实数控板上的红字就是这个：
 * 某个量出了它该在的范围。**这里一条假告警都不造** —— 没有越界就没有颜色。
 */
export type Level = 'ok' | 'warn' | 'alarm';

/**
 * 告警代码。数控板的写法：字母表示轻重，数字是固定编号，**编号不随显示顺序变**，
 * 这样现场的人可以说"刚才跳了 WRN 12"，而不是"刚才黄了一下"。
 *
 * | 代码 | 什么时候 | 阈值从哪来 |
 * |---|---|---|
 * | ALM 01 关节丢失 | 看得见的关节不到一半 | 本块读数的「关节」那一行 |
 * | ALM 02 推理停滞 | 推理低于目标的 40% | `CAPTURE.targetHz`（readout.ts 头：12Hz 时身体发木） |
 * | WRN 11 置信偏低 | 精化器自己开始变迟钝（`qualityScale < 1`） | `refine.ts`，和左上角小屏幕同一把尺子 |
 * | WRN 12 部分出画 | ≥ `PREVIEW.outOfFramePoints` 个可信点在画外 | `preview-state.ts` 的 `outOfFrame()`，同一把尺子 |
 * | WRN 13 推理偏慢 | 推理低于目标的 80% | `CAPTURE.targetHz` |
 */
export type AlarmCode = 'ALM01' | 'ALM02' | 'WRN11' | 'WRN12' | 'WRN13';

/** 同时越界时底下那一行只说最重的一条。顺序就是轻重 */
export const ALARM_ORDER: readonly AlarmCode[] = ['ALM01', 'ALM02', 'WRN11', 'WRN12', 'WRN13'];

/** 推理低于目标的这个比例 → 偏慢（琥珀）。0.8 × 30 = 24Hz */
export const INFER_WARN_RATIO = 0.8;
/** 推理低于目标的这个比例 → 停滞（红）。0.4 × 30 = 12Hz —— readout.ts 文件头说的"画面顺、身体木"的那个数 */
export const INFER_ALARM_RATIO = 0.4;

export interface Assessment {
  levels: Record<ReadoutKey, Level>;
  code: AlarmCode | null;
}

const OK: Assessment = {
  levels: { confidence: 'ok', joints: 'ok', inference: 'ok', energy: 'ok', extent: 'ok' },
  code: null,
};

/**
 * 一帧 → 哪几个数越界、底下那一行说哪一条。**纯函数。**
 *
 * @param inferred 这台机器**有没有推理出过至少一帧**。开机那一两秒推理频率是 0，
 *   那不是停滞，是还没开始 —— 每次打开页面都先红一下，观众读到的是"坏了"。
 */
export function assess(input: ReadoutInput, inferred = true): Assessment {
  // 回放没有可以越界的测量：录像不会停滞，录像里的关节也不是谁丢的
  if (input.live === false) return OK;
  const levels: Record<ReadoutKey, Level> = { ...OK.levels };
  const hit = new Set<AlarmCode>();

  // 推理是机器自己的节拍：没人的时候也照判（和「推理」那一行不跟着 present 作废同一个理由）
  const hz = input.inferenceHz;
  if (inferred && Number.isFinite(hz) && hz >= 0) {
    if (hz < CAPTURE.targetHz * INFER_ALARM_RATIO) { levels.inference = 'alarm'; hit.add('ALM02'); }
    else if (hz < CAPTURE.targetHz * INFER_WARN_RATIO) { levels.inference = 'warn'; hit.add('WRN13'); }
  }

  const pose = input.pose;
  const score = Number.isFinite(pose?.score) ? pose!.score : 0;
  const present = posePresent(pose);
  // **没有人就没有身体上的告警**：空场里说"关节丢失"是假话 —— 没有人可丢
  if (present) {
    const seen = visibleJoints(pose);
    const total = (pose!.screen?.length ? pose!.screen : pose!.world)?.length ?? 0;
    if (seen !== null && total > 0 && seen < total / 2) {
      levels.joints = 'alarm'; hit.add('ALM01');
    } else if (pose!.screen?.length
      && (lateralEvidence(pose, input.aspect)?.side || outOfFrame(pose!.screen, input.upperIsIntended) >= PREVIEW.outOfFramePoints)) {
      // 从左右走出去的也是部分出画，和小屏同一把尺子（`lateralEvidence`，按躯干坐标判，docs/49 §6.2 S4）。
      // **出画不给「关节」那一行上色。** 出画的点照样是看得见的点：截图上 33/33 被涂成琥珀，
      // 读起来是"全都看见了，但有问题"—— 一行数和它的颜色自相矛盾。出画这件事没有哪一行在量，
      // 所以它只出现在最底下那一行的代码里。
      hit.add('WRN12');
    }
    if (qualityScale(score) < 1) { levels.confidence = 'warn'; hit.add('WRN11'); }
  }

  return { levels, code: ALARM_ORDER.find((c) => hit.has(c)) ?? null };
}

/** 进入越界要连续成立多久才显示；回到正常要连续成立多久才撤掉（撤得更慢：「好了」更容易是误报） */
export const ALARM_ENTER_SECONDS = 1.0;
export const ALARM_EXIT_SECONDS = 2.0;

const rank = (a: Assessment): number =>
  a.code === null ? 0 : a.code.startsWith('ALM') ? 2 : 1;

export interface AlarmWatch {
  update(input: ReadoutInput, dt: number): Assessment;
  reset(): void;
}

/**
 * 告警不许闪。和左上角小屏幕的 `createSeeWatch` 同一条教训：
 * 门限附近逐帧判出来的状态一定会颤，一块忽红忽白的读数板读起来是"这东西在抽"。
 * 新判定要**连续成立**一段时间才换上去；变重用 `ALARM_ENTER_SECONDS`，变轻用更长的 `ALARM_EXIT_SECONDS`。
 */
export function createAlarmWatch(): AlarmWatch {
  let shown: Assessment = OK;
  let pending: string | null = null;
  let held = 0;
  let inferred = false;
  const key = (a: Assessment): string => JSON.stringify(a);
  return {
    update(input, dt) {
      if (Number.isFinite(input.inferenceHz) && input.inferenceHz > 0) inferred = true;
      const raw = assess(input, inferred);
      const k = key(raw);
      if (k === key(shown)) { pending = null; held = 0; return shown; }
      if (k !== pending) { pending = k; held = 0; }
      held += Number.isFinite(dt) && dt > 0 ? dt : 0;
      const need = rank(raw) >= rank(shown) ? ALARM_ENTER_SECONDS : ALARM_EXIT_SECONDS;
      if (held >= need) { shown = raw; pending = null; held = 0; }
      return shown;
    },
    reset() { shown = OK; pending = null; held = 0; inferred = false; },
  };
}
