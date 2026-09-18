/**
 * 取景：**身体有多大 → 画面框住多大一块世界**。纯函数，不 import three。
 *
 * 为什么它得单独成一个文件：docs/18 的身体方案落地之后，
 * 「一个站着的 1.7m 人」这个假设不成立了 —— `quadruped` 是横的矮的
 * （躯干沿 Z 展开 1.1m，整体高度 0.93m），`towering` 是 1.98m 高、1.58m 宽，
 * `inverted` 的重心在**地面以下**。用人形的相机参数去拍它们，身体会直接出画。
 *
 * ── 这里做的那个取舍（重要，PRD §3 第一条主张）──────────────────────────
 *
 * 「等身」是这件作品的第一条产品主张：屏幕上的身体是 1:1 的真人尺寸。
 * 完全按包围盒自适应（每个身体都填满画面）会**直接杀掉这条主张** ——
 * 那样一只狗和一个人在屏幕上一样大，尺度感就没了，所有身体都变成"模型预览"。
 *
 * 另一个极端（严格 1:1、相机纹丝不动）也不对：一只 0.93m 高的四足会缩在
 * 画面底部一小块，上面三分之二是空的。静帧发出去没人看得出那是什么。
 *
 * 所以这里做的是**有限插值**：
 *   - 观众的站位（相机距离 2.8m）**不动** —— 现场地面上是贴了位置线的，
 *     那是个物理事实，不该跟着物种变。
 *   - 画面框住的世界高度 = 身体骨架高度 × 常数，并**上下夹住**。
 *     常数取得让人形正好落回原来的 2.45m（1:1 一点没变），
 *     四足则被放大约 1.7 倍 —— 读起来是"一只跟真狗差不多大的机器兽"，
 *     而不是一个玩具，也不是一头和人一样大的怪物。
 *
 * 换句话说：**人形严格等身，非人形按同一条曲线连续地偏离，偏离量有上限。**
 */
import { remapSkeleton, type BodyPlan } from '../../../core/src/bodyplan.ts';
import { SKELETON , FRAMING as FRAMING_TUNING, AUTOFRAME, STAGE } from '../../../core/src/tuning.ts';
import { smoothstep, type ShotState } from '../../../core/src/autoframe.ts';
import type { Bone, BoneId, Skeleton, Vec3 } from '../../../core/src/types.ts';

/** 一具身体在世界里占的那个盒子。x 始终假设左右对称，所以只记宽度 */
export interface BodyBounds {
  /** 竖直中心（米）。`inverted` 会是负的 */
  centerY: number;
  /** 骨架高度（米，只算骨头端点，不含部件几何） */
  height: number;
  /** 左右宽度（米） */
  width: number;
  /** 前后进深（米）。四足的这一项最大 */
  depth: number;
}

/** 取景结果，直接喂给相机 */
export interface FrameFit {
  /** 画面要框住的世界高度（米） */
  frameHeight: number;
  /** 画面至少要框住的世界宽度（米）——竖屏时它会反过来决定高度 */
  frameWidth: number;
  /** 画面竖直中心在世界坐标的高度（米） */
  centerY: number;
  /** 灯与阴影相机瞄准的高度（米） */
  aimY: number;
}

export const FRAMING = FRAMING_TUNING;


// ── 参考站姿 ────────────────────────────────────────────────────────────────

/**
 * 标准 A-pose（身高 1.7m，面朝 +Z，关节名同 docs/04 §2）。
 * **它不参与渲染**，只有一个用途：在真人到达之前，把某个身体方案的取景先算出来。
 * 数值与 `/dev/figure.html` 的那副同源。
 */
const REFERENCE_JOINTS: Record<string, Vec3> = {
  pelvis: [0, 0.95, 0], chest: [0, 1.35, 0], neck: [0, 1.45, 0], headCenter: [0, 1.60, 0],
  shoulderL: [0.19, 1.38, 0], elbowL: [0.36, 1.10, 0.02], wristL: [0.47, 0.86, 0.04], handTipL: [0.51, 0.76, 0.05],
  shoulderR: [-0.19, 1.38, 0], elbowR: [-0.36, 1.10, 0.02], wristR: [-0.47, 0.86, 0.04], handTipR: [-0.51, 0.76, 0.05],
  hipL: [0.09, 0.93, 0], kneeL: [0.10, 0.51, 0.01], ankleL: [0.10, 0.09, 0], footIdxL: [0.10, 0.03, 0.16],
  hipR: [-0.09, 0.93, 0], kneeR: [-0.10, 0.51, 0.01], ankleR: [-0.10, 0.09, 0], footIdxR: [-0.10, 0.03, 0.16],
};

const REFERENCE_BONE_JOINTS: Record<BoneId, [string, string]> = {
  spine: ['pelvis', 'chest'], neck: ['chest', 'neck'], head: ['neck', 'headCenter'],
  clavicleL: ['chest', 'shoulderL'], clavicleR: ['chest', 'shoulderR'],
  upperArmL: ['shoulderL', 'elbowL'], upperArmR: ['shoulderR', 'elbowR'],
  foreArmL: ['elbowL', 'wristL'], foreArmR: ['elbowR', 'wristR'],
  handL: ['wristL', 'handTipL'], handR: ['wristR', 'handTipR'],
  thighL: ['hipL', 'kneeL'], thighR: ['hipR', 'kneeR'],
  shinL: ['kneeL', 'ankleL'], shinR: ['kneeR', 'ankleR'],
  footL: ['ankleL', 'footIdxL'], footR: ['ankleR', 'footIdxR'],
};

export const REFERENCE_POSE: Skeleton = {
  bones: (Object.keys(REFERENCE_BONE_JOINTS) as BoneId[]).map((id): Bone => {
    const [a, b] = REFERENCE_BONE_JOINTS[id];
    const p0 = REFERENCE_JOINTS[a], p1 = REFERENCE_JOINTS[b];
    return {
      id, p0, p1,
      length: Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]),
      roll: 0, confidence: 1,
    };
  }),
  joints: REFERENCE_JOINTS,
  height: SKELETON.referenceHeight,
  warmingUp: false,
  t: 0,
};

/**
 * 人形（`rig`）在标准站姿下的盒子 —— 一切拿不到身体时的退路。
 * **算出来的，不是写死的**：和 `boundsOfPlan('rig')` 必须是同一个数，
 * 否则"未知方案退回人形"会退到一个和人形差一点点的取景上（看起来就是相机轻微跳一下）。
 * 后面那个字面量只是 `remapSkeleton` 万一返回空时的最后兜底（P3：不许出 NaN）。
 */
export const DEFAULT_BOUNDS: BodyBounds =
  boundsOfSkeleton(remapSkeleton(REFERENCE_POSE, 'rig'))
  ?? { centerY: 0.815, height: 1.57, width: 1.02, depth: 0.16 };

/**
 * 某个身体方案在标准站姿下占的盒子：**直接把参考站姿重映射一遍再量**，
 * 不维护一张常数表。表会过期（`bodyplan.ts` 调一次比例就错），
 * 而且表也表达不了 `{ kind: 'quadruped', limb: 0.7 }` 这种带比例的 spec。
 *
 * 结果按 spec 缓存：换条目时才会调用，条目数是个位数。
 * 不认识的方案名一律当人形 —— 没有方案不是错误，是缺省（P3）。
 */
const planCache = new Map<string, BodyBounds>();

export function boundsOfPlan(plan: BodyPlan | null | undefined): BodyBounds {
  if (plan === null || plan === undefined) return DEFAULT_BOUNDS;
  const key = typeof plan === 'string' ? plan : JSON.stringify(plan);
  const hit = planCache.get(key);
  if (hit) return hit;
  const got = boundsOfSkeleton(remapSkeleton(REFERENCE_POSE, plan)) ?? DEFAULT_BOUNDS;
  planCache.set(key, got);
  return got;
}

/**
 * 从活骨架量包围盒。只看 17 根骨头的 34 个端点 —— 比 `Box3.setFromObject`
 * 便宜两个数量级，而且不受部件几何/换装动画的影响（换装中途的插值形态不该改变取景）。
 *
 * 拿不到有效骨架时返回 `null`，调用方保持原来的取景（**不要跳回默认值**：
 * 追踪抖一下就重新取景会让画面一直在呼吸，那是最难看的 bug）。
 */
export function boundsOfSkeleton(sk: Skeleton | null | undefined): BodyBounds | null {
  if (!sk || !sk.bones?.length) return null;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let seen = 0;
  for (const b of sk.bones) {
    for (const p of [b.p0, b.p1]) {
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) continue;
      seen++;
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
      if (p[2] < minZ) minZ = p[2];
      if (p[2] > maxZ) maxZ = p[2];
    }
  }
  if (seen < 4) return null;                    // 只剩几根骨头的骨架量不出可信的盒子
  return {
    centerY: (minY + maxY) / 2,
    height: Math.max(0.05, maxY - minY),
    width: Math.max(0.05, maxX - minX),
    depth: Math.max(0.05, maxZ - minZ),
  };
}

/** 包围盒 → 取景。见文件头「有限插值」那一段 */
export function fitFrame(b: BodyBounds): FrameFit {
  const frameHeight = Math.min(
    FRAMING.maxFrameHeight,
    Math.max(FRAMING.minFrameHeight, b.height * FRAMING.heightFactor),
  );
  return {
    frameHeight,
    frameWidth: Math.max(FRAMING.minFrameWidth, b.width * FRAMING.widthMargin),
    centerY: b.centerY + b.height * FRAMING.centerLift,
    // 灯和阴影瞄准身体的几何中心：四足的"胸口"在 0.4m 高，照着 1m 打会把它留在暗部
    aimY: b.centerY,
  };
}

/**
 * 身体落在地面上的那几个点（世界坐标 xz + 离地高度）。
 *
 * **这是"人浮在空中"的修法的输入。** 真阴影贴图给的是身体的形状，
 * 但它在脚底那一圈永远差一口气（PCF 的半影 + normalBias 把最该黑的地方顶开了）。
 * 接触阴影要画在**真正着地的那几个端点**下面，而不是画在世界原点 ——
 * 第一轮就是画在原点的一个 0.62m 大圆斑，它既不跟脚走，也不像接触。
 *
 * 取最低的 `n` 个骨头端点（两足取到两只脚，四足取到四只）。
 * `lift` = 离地高度：脚抬起来接触阴影就该消失，否则读作"影子粘在脚上"。
 *
 * 只返回**离地不超过 `maxLift`** 的端点。不加这一条的话，名额会被手尖占掉 ——
 * A-pose 的手尖离地 0.73m，在 xz 上离脚很远，去重挡不住它，
 * 于是画面上会在两只手底下各多出一摊接触阴影。
 *
 * @returns 最多 n 个 `[x, z, lift]`；拿不到骨架、或者整具身体都离地时返回空数组
 */
export function contactPoints(
  sk: Skeleton | null | undefined,
  n = 4,
  maxLift = 0.22,
): Array<[number, number, number]> {
  if (!sk || !sk.bones?.length) return [];
  const pts: Vec3[] = [];
  for (const b of sk.bones) {
    for (const p of [b.p0, b.p1]) {
      if (p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])) pts.push(p);
    }
  }
  if (pts.length < 4) return [];
  pts.sort((a, b) => a[1] - b[1]);
  const out: Array<[number, number, number]> = [];
  /**
   * "地面"取 **y = 0**，不取这具身体自己的最低点。
   *
   * 第一版取自身最低点，等于**强迫每具身体都有接触阴影** —— 哪怕它整个跳在空中。
   * 而"浮"和"陷"是同一个问题的两面：装配那条线实测出脚的网格最低点在
   * `y = -0.025`（真实运行时 `ground()` 把 `footIdx` 归零之后还要再沉 ~3cm），
   * 也就是说身体相对地面既可能高也可能低，参照系必须是**地面本身**。
   *
   * 以 y=0 为准之后两边都对：陷进去的脚 `lift ≤ 0` → 照常有接触阴影；
   * 真的跳起来 → 所有落点超过 `maxLift`，接触阴影**正确地消失**。
   * 身体沉进地里那一段该由装配层补（它才拿得到每件的 `aabb`），舞台这边
   * 不去猜一个偏移量 —— 猜错就是把影子画在没有脚的地方。
   */
  const floor = 0;
  for (const p of pts) {
    if (out.length >= n) break;
    if (p[1] - floor > maxLift) break;      // 已按 y 排序，后面只会更高
    /**
     * 一只脚只出一个落点。**0.19m 这个数是量出来的，不是拍的**：
     * 参考站姿里脚踝 (0.10, 0) 和脚尖 (0.10, 0.16) 相距 0.16m，
     * 两只脚之间相距 0.20m。阈值必须落在这两个数中间 —— 取 0.12（第一版）
     * 会让脚踝和脚尖各算一个，画面上就是**每只脚下面两个黑圆斑**；
     * 取 0.22 又会把另一只脚一起吞掉，只剩一边有接触阴影。
     */
    if (out.some(([x, z]) => Math.hypot(x - p[0], z - p[2]) < 0.19)) continue;
    out.push([p[0], p[2], Math.max(0, p[1] - floor)]);
  }
  return out;
}

// ── 中景：上半身取景（docs/49 §落地）────────────────────────────────────────

/**
 * **「等身」的一处登记在案的例外。**
 *
 * 文件头那条主张（人形严格等身、相机距离不动）写的是**全景**。笔记本前的观众只露头、肩、胯，
 * 把他框成一个 1:1 的整个人，屏幕上是一具小小的、下半截没有依据的身体 —— 等身在那一刻
 * 保住的只是一个数，丢掉的是"那是我"。所以取景模式判成上半身（或有人选了上半身）时，
 * 画面收成中景：同一个机位、同一个距离，**只收窄视野**（fov 变小，不推相机），
 * 画面高 ≈ 身高 × 0.64，人形约放大 2.2 倍。
 *
 * 例外的边界：
 *  - 只在人形上成立（`main.ts` 在身体方案漂移开始后一律给全景 —— 四足的"上半身"不是一个取景）；
 *  - 人一退后、腿进画，回到全景，等身原样恢复（`test/framing.test.ts` 钉住 t=0 时和全景逐字相同）；
 *  - 现场（`?kiosk=1`）全身优先：进中景要憋 3 秒。
 * 作品负责人 2026-09-14 裁定，记录在 docs/49 §落地。
 */
export function upperFit(bodyHeight: number, width: number): FrameFit {
  const H = Number.isFinite(bodyHeight) && bodyHeight > 0.3 ? bodyHeight : DEFAULT_BOUNDS.height + SKELETON_TOP_PAD;
  const T = AUTOFRAME;
  return {
    frameHeight: H * T.upperHeightFactor,
    frameWidth: Math.max(T.upperMinWidth, (Number.isFinite(width) ? width : DEFAULT_BOUNDS.width) * 0.9),
    centerY: H * T.upperCenterFactor,
    // 灯不跟着景别走：灯照的是身体，不是画面
    aimY: NaN,
  };
}

/** 骨架盒顶（头中心）到颅顶的那一段。只用于 `upperFit` 拿不到身高时的退路 */
const SKELETON_TOP_PAD = 0.14;

/**
 * 全景与中景之间插值。`t` 已经是缓动过的（0 = 全景，1 = 中景）。
 * **t = 0 时逐字返回 `full`**：等身那条测试不许因为多了一个中景而偏一毫米。
 */
export function blendFit(full: FrameFit, upper: FrameFit, t: number): FrameFit {
  if (!(t > 0)) return full;
  const k = Math.min(1, t);
  // 在"画面高度"上线性插值读起来像推镜；在 1/高度（放大倍数）上插值读起来匀速。取后者
  const inv = (1 - k) / full.frameHeight + k / upper.frameHeight;
  return {
    frameHeight: 1 / inv,
    frameWidth: full.frameWidth + (upper.frameWidth - full.frameWidth) * k,
    centerY: full.centerY + (upper.centerY - full.centerY) * k,
    aimY: full.aimY,
  };
}

/** 舞台相机这一刻的全部几何。`stage.ts` 的 `fitCamera()` 用它，连续性测试和 `/dev/framing.html` 也用它 —— 三处同一份数学 */
export interface ShotCamera {
  /** 画面框住的世界高度（米，竖屏时已经按宽度撑高） */
  h: number;
  /** 竖直视角（度） */
  fov: number;
  /** 中景跟随的移轴平移（米） */
  panX: number;
  /** 中景跟随的纵向移轴（米）；正 = 画面中心上移、身体在输出里下移 */
  panY: number;
  /** 画面竖直中心（米，含场景的构图票） */
  centerY: number;
  /** 取景平面离相机多远（米） */
  dist: number;
  aimY: number;
  /** 身体此刻还能横向走多远而不出画（米，`lateralRoom()`） */
  room: number;
}

/**
 * 包围盒 + 身高 + 景别状态 → 相机几何。**t = 0 时和等身全景逐字相同**（`blendFit` 的约定）。
 * @param frameLift 场景对构图的那一票（`look.frameLift`）
 */
export function shotCamera(bounds: BodyBounds, bodyH: number, shot: ShotState, aspect: number, frameLift = 0): ShotCamera {
  const mix = smoothstep(shot.progress);
  const fit = blendFit(fitFrame(bounds), upperFit(bodyH, bounds.width), mix);
  const panX = shot.fx.x * mix;
  const panY = shot.fy.x * mix;
  let h = fit.frameHeight;
  if (h * aspect < fit.frameWidth) h = fit.frameWidth / aspect;   // 太窄了就往高了框
  // 取景平面放在身体的**近面**，不是身体中心（四足的腿跑出画面外那个 bug 的修法，见 stage.ts）
  const dist = Math.max(0.8, STAGE.viewDistance - Math.min(1.0, bounds.depth / 2));
  return {
    h,
    fov: (2 * Math.atan((h / 2) / dist) * 180) / Math.PI,
    panX,
    panY,
    centerY: fit.centerY + panY + bounds.height * frameLift,
    dist,
    aimY: fit.aimY,
    room: lateralRoom(h, aspect, bounds.width, panX),
  };
}

/**
 * 身体的横向根偏移最多能走多远（米）：画面半宽 − 身体半宽 − 边距 − 移轴偏了多少。
 * 随景别连续变化（中景画面窄得多），`core/src/autoframe.ts` 的 `stepLateral()` 按限速把偏移收进来。
 */
export function lateralRoom(frameHeight: number, aspect: number, bodyWidth: number, panX = 0): number {
  const half = (Number.isFinite(frameHeight) ? frameHeight : 0) * (Number.isFinite(aspect) ? aspect : 0) / 2;
  const body = (Number.isFinite(bodyWidth) ? bodyWidth : DEFAULT_BOUNDS.width) / 2;
  return Math.max(0, half - body - AUTOFRAME.lateralRoomMargin - Math.abs(Number.isFinite(panX) ? panX : 0));
}

/** 两个包围盒之间插值。换条目时相机要平滑过渡（docs/23 §S3：进场必须无缝） */
export function lerpBounds(a: BodyBounds, b: BodyBounds, t: number): BodyBounds {
  const f = (x: number, y: number): number => x + (y - x) * t;
  return {
    centerY: f(a.centerY, b.centerY),
    height: f(a.height, b.height),
    width: f(a.width, b.width),
    depth: f(a.depth, b.depth),
  };
}
