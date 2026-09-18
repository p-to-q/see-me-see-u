/**
 * 身体方案 · A 档：**骨架重映射**。规格见 docs/18-BODY-PLANS.md §2。
 *
 * 输入永远是人体骨架（站在那里的确实是个人），输出还是 17 根骨头，
 * 交给现有的刚体渲染器 —— **一行渲染代码都不用改**。
 *
 * 全部是纯函数：同样的输入永远同样的输出，可以在 node 里秒级验证（P1）。
 */
import type { Bone, BoneId, Skeleton, Vec3 } from './types.ts';
import { add, dist, norm, scale, sub, sane } from './vec.ts';

/**
 * 全部身体方案。**这张表是"物种声明了什么"与"运行时给了什么"之间唯一的对账凭据。**
 *
 * 前七个是这个文件里的骨架重映射；后两个（`mass` / `swarm`）不是重映射，
 * 而是**另一条身体实现**（`app/src/creature/{mass,swarm}.ts`），`remapSkeleton`
 * 对它们走 default、原样返回人体骨架 —— 差别发生在渲染那一层，不在这里。
 *
 * 它们仍然必须列在这里，理由是这张表被当成**合法值的名单**在用（`check-parts.ts`
 * 判错、`ui/controls.ts` 排按钮、`ThemeDef.bodyPlan` 的类型）。名单少列两个，
 * 那两个就成了"合法但不被承认"的值，而这正是下面这个 bug 的另一半。
 *
 * 这里防的 bug：一个条目写 `bodyPlan: 'quadrupd'`（拼错、或者方案被改过名），
 * 类型通过、测试全绿、`remapSkeleton` 的 switch 走 default —— 它**静默地**
 * 按人形刚体装配出场。症状是"身体看起来没毛病，只是不是它声明的那一具"，
 * 没有任何一处会变红。同一类失败（静默换种）这个仓库今天已经踩过一次了。
 */
export type BodyPlanId =
  | 'rig' | 'quadruped' | 'towering' | 'stub' | 'inverted' | 'radial' | 'column'
  | 'mass' | 'swarm';

export const BODY_PLANS: readonly BodyPlanId[] =
  ['rig', 'quadruped', 'towering', 'stub', 'inverted', 'radial', 'column', 'mass', 'swarm'];

/**
 * B 档：**一件槽位件都不实例化**的那两个方案（docs/18 §2 B 档）。
 *
 * 拎出来是因为它有四个使用者，而且四处问的是同一件事：
 *  - `check-parts.ts`：对它们问"凑不凑得齐件"没有意义，跳过；
 *  - `ui/controls.ts`：进出这两个方案要**重载**（另一条身体实现，热切不出来）；
 *  - 本文件的测试：`remapSkeleton` 对它们是恒等，不该拿"重映射之后要贴地"去要求它们；
 *  - `main.ts`：`planKind === 'mass' / 'swarm'` 决定建哪一具身体。
 * 这张表以前有两份拷贝（`check-parts.ts` 一份、`controls.ts` 一份写成了单个 `MASS`），
 * 于是 `swarm` 落在控件条外面 —— 抄一张表就会有一天对不上，这就是那一天。
 */
export const PLANS_WITHOUT_PARTS: readonly BodyPlanId[] = ['mass', 'swarm'];

/**
 * 哪些方案**不能拿脚当落地基准**。这张表是给测试和 `rebuild()` 共用的。
 *  - `radial` 把四肢拆成了绕核心的弧，"谁是脚"已经没有意义；
 *  - `inverted` 翻过来之后脚在最上面，按脚落地会把头埋到地板以下 ——
 *    倒立的东西就该拿**整体最低点**着地（A-pose 翻过来正好是头着地）。
 * 两者都改成：整体最低的那个关节回到 y=0。
 */
export const PLANS_WITHOUT_FEET: readonly string[] = ['radial', 'inverted'];

/**
 * 参数化身体方案。
 *
 * 为什么需要它：光有拓扑（人形 / 四足）还不够 —— 23 个条目如果共用同一张身材表，
 * 那它们仍然是"同一个身材换皮"。比例本身就是物种身份的一大半：
 * 球是"巨大躯干 + 退化四肢"，桌宠是"大头 + 短身"，移动机械臂是"长臂"。
 * 这些都不需要新素材，只需要几个数。
 *
 * `kind` 缺省 'rig' 时只改比例，不改拓扑；也可以和 'quadruped' 叠加。
 */
export interface BodyPlanSpec {
  /**
   * 拓扑。
   *
   * 这里原来是 `string`，注释写着"parts.json 是外部数据，未知值不该让类型系统炸掉"。
   * 那句话把**运行时的宽容**和**声明时的宽容**混成了一件事，代价是拼错的 plan
   * 从数据一路畅通无阻地滑到 default 分支。现在分开：
   *  - 声明侧收紧成 `BodyPlanId`（`ThemeDef.bodyPlan` 与 `RosterEntry.bodyPlan` 同此），
   *    拼错的值在 `tsc` 就红；
   *  - 运行时的宽容仍然在 —— `remapSkeleton` 的入参是 `BodyPlan`（含 `string`），
   *    未知值照旧按 'rig' 处理、绝不抛（P2）；
   *  - 而 parts.json 这份外部数据由 `check-parts.ts` 当场判**错**（不是警告），
   *    它会把"声明了什么 / 会静默变成什么"两句话一起印出来。
   */
  kind?: BodyPlanId;
  /** 四肢整体缩放，1 = 不变 */
  limb?: number;
  /** 躯干缩放 */
  torso?: number;
  /** 头（neck→headCenter）缩放 */
  head?: number;
  /** 手臂额外缩放，叠在 limb 之上 */
  arm?: number;
  /** 腿额外缩放，叠在 limb 之上 */
  leg?: number;
}

export type BodyPlan = BodyPlanId | BodyPlanSpec | string;

// ── 工具 ────────────────────────────────────────────────────────────────────

const J = (sk: Skeleton, n: string): Vec3 | null => {
  const v = sk.joints?.[n];
  return v && v.every(Number.isFinite) ? v : null;
};

/** 一条骨链的总长（缺哪段就跳过哪段） */
function chainLength(sk: Skeleton, names: readonly string[]): number {
  let total = 0;
  for (let i = 0; i + 1 < names.length; i++) {
    const a = J(sk, names[i]), b = J(sk, names[i + 1]);
    if (a && b) total += dist(a, b);
  }
  return total;
}

/** 从 joints 重建 bones。BONE_JOINTS 是 docs/04 §2 的表 */
const BONE_JOINTS: Record<BoneId, [string, string]> = {
  spine: ['pelvis', 'chest'], neck: ['chest', 'neck'], head: ['neck', 'headCenter'],
  clavicleL: ['chest', 'shoulderL'], clavicleR: ['chest', 'shoulderR'],
  upperArmL: ['shoulderL', 'elbowL'], upperArmR: ['shoulderR', 'elbowR'],
  foreArmL: ['elbowL', 'wristL'], foreArmR: ['elbowR', 'wristR'],
  handL: ['wristL', 'handTipL'], handR: ['wristR', 'handTipR'],
  thighL: ['hipL', 'kneeL'], thighR: ['hipR', 'kneeR'],
  shinL: ['kneeL', 'ankleL'], shinR: ['kneeR', 'ankleR'],
  footL: ['ankleL', 'footIdxL'], footR: ['ankleR', 'footIdxR'],
};

function groundLevel(joints: Record<string, Vec3>, groundAll = false): number {
  let lo = Infinity;
  const keys = groundAll ? Object.keys(joints) : ['footIdxL', 'footIdxR', 'ankleL', 'ankleR'];
  for (const n of keys) {
    const y = joints[n]?.[1];
    if (Number.isFinite(y) && y < lo) lo = y;
  }
  return Number.isFinite(lo) ? lo : 0;
}

function ground(joints: Record<string, Vec3>, bones: Bone[], groundAll = false): number {
  // 落地：最低的脚回到 y=0（docs/04 §3.5 的同一条规矩，重映射之后必须再来一次）。
  // groundAll：有些拓扑已经没有"脚"这个概念了（radial 把四肢拆成了绕核心的弧），
  // 拿脚当基准会让半个身体沉到地板下面 —— 这时候基准换成整体最低点。
  const lo = groundLevel(joints, groundAll);
  if (Math.abs(lo) > 1e-9) {
    for (const k in joints) joints[k] = [joints[k][0], joints[k][1] - lo, joints[k][2]];
    for (const b of bones) { b.p0 = [b.p0[0], b.p0[1] - lo, b.p0[2]]; b.p1 = [b.p1[0], b.p1[1] - lo, b.p1[2]]; }
    return -lo;
  }
  return 0;
}

function rebuild(sk: Skeleton, joints: Record<string, Vec3>, groundAll = false): Skeleton {
  const conf = new Map(sk.bones.map((b) => [b.id, b.confidence]));
  const bones: Bone[] = [];
  for (const b of sk.bones) {
    const [a, c] = BONE_JOINTS[b.id];
    const p0 = sane(joints[a] ?? b.p0), p1 = sane(joints[c] ?? b.p1);
    bones.push({ id: b.id, p0, p1, length: dist(p0, p1), roll: 0, confidence: conf.get(b.id) ?? b.confidence });
  }
  ground(joints, bones, groundAll);
  const head = joints.headCenter?.[1] ?? sk.height;
  return { ...sk, bones, joints, height: Math.max(0.1, head - 0), warmingUp: sk.warmingUp };
}

/** 沿原骨链的世界方向，从新的起点重新长出来 */
function regrow(
  src: Skeleton, out: Record<string, Vec3>, start: string, chain: readonly string[],
): void {
  let cursor = out[start];
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = J(src, chain[i]), b = J(src, chain[i + 1]);
    if (!a || !b || !cursor) { if (cursor) out[chain[i + 1]] = cursor; continue; }
    const d = sub(b, a);
    const len = Math.hypot(d[0], d[1], d[2]);
    cursor = add(cursor, scale(norm(d), len));
    out[chain[i + 1]] = cursor;
  }
}

// ── quadruped ───────────────────────────────────────────────────────────────

/** 四足躯干比人的躯干长 —— 不拉长的话读起来像"趴着的人"而不是兽 */
const TRUNK_STRETCH = 1.9;
/** 头从肩前伸出去的长度，相对躯干 */
const HEAD_REACH = 0.45;

/**
 * 人体 → 四足。
 *
 * 关键设计：**四肢的世界方向原样保留，只把插座（肩/胯）搬到水平躯干上。**
 * 于是"你抬手 → 它抬前腿"的因果链一点没断 —— 这是它比"换个模型"强的地方。
 * 前后高度分别取臂链长和腿链长，躯干自然带一点前低后高的斜度，很像真的四足机。
 */
function quadruped(sk: Skeleton): Skeleton {
  const armChain = chainLength(sk, ['shoulderL', 'elbowL', 'wristL', 'handTipL']);
  const legChain = chainLength(sk, ['hipL', 'kneeL', 'ankleL', 'footIdxL']);
  const trunk = Math.max(0.1, chainLength(sk, ['pelvis', 'chest'])) * TRUNK_STRETCH;

  const hipHalf = Math.max(0.04, Math.abs((J(sk, 'hipL')?.[0] ?? 0.09) - (J(sk, 'hipR')?.[0] ?? -0.09)) / 2);
  const shHalf = Math.max(0.04, Math.abs((J(sk, 'shoulderL')?.[0] ?? 0.19) - (J(sk, 'shoulderR')?.[0] ?? -0.19)) / 2);

  const rearY = Math.max(0.1, legChain);
  const frontY = Math.max(0.1, armChain);
  const rearZ = -trunk / 2, frontZ = trunk / 2;

  const out: Record<string, Vec3> = {};
  out.hipL = [hipHalf, rearY, rearZ];
  out.hipR = [-hipHalf, rearY, rearZ];
  out.shoulderL = [shHalf, frontY, frontZ];
  out.shoulderR = [-shHalf, frontY, frontZ];
  out.pelvis = [0, rearY, rearZ];
  out.chest = [0, frontY, frontZ];

  // 四肢：插座换了，方向不动
  regrow(sk, out, 'shoulderL', ['shoulderL', 'elbowL', 'wristL', 'handTipL']);
  regrow(sk, out, 'shoulderR', ['shoulderR', 'elbowR', 'wristR', 'handTipR']);
  regrow(sk, out, 'hipL', ['hipL', 'kneeL', 'ankleL', 'footIdxL']);
  regrow(sk, out, 'hipR', ['hipR', 'kneeR', 'ankleR', 'footIdxR']);

  // 头：人的"向上"在这里变成"向前"。观众低头 → 兽低头，方向感是对的
  const neckLen = Math.max(0.02, chainLength(sk, ['chest', 'neck']));
  const headLen = Math.max(0.02, chainLength(sk, ['neck', 'headCenter']));
  const hd = J(sk, 'neck') && J(sk, 'headCenter')
    ? norm(sub(J(sk, 'headCenter')!, J(sk, 'neck')!))
    : [0, 1, 0] as Vec3;
  const fwd: Vec3 = norm([hd[0], hd[2], hd[1]]);          // 把"上"折成"前"
  out.neck = add(out.chest, scale(fwd, neckLen + trunk * HEAD_REACH * 0.25));
  out.headCenter = add(out.neck, scale(fwd, headLen));

  return rebuild(sk, out);
}

// ── radial：无躯干型 ─────────────────────────────────────────────────────────

/**
 * 人体 → 环绕体。**没有脊柱，也没有四肢链。**
 *
 * 四条肢的部件被摊到四条绕着同一个核心的**轨道弧**上，四条轨道各自倾斜，
 * 合起来是一个笼子而不是一具身体。核心（脊柱+颈+头压扁）悬在中间。
 *
 * 守住的那条因果（和 quadruped 同一条规矩：**保留肢体的世界量，只换插座**）：
 *  - 每条弧的半径 = 那条肢的**末端离身体中心多远** → 张开双臂，弧真的扩大；
 *    蹲下四肢收拢，整个笼子跟着收拢。
 *  - 每条弧的高度 = 那条肢末端相对中心的**高度** → 抬左手，左前那条弧整条浮起来。
 *  - 笼子的朝向 = 人的肩轴朝向 → 人转身，笼子跟着转。
 *
 * 为什么用「弦长 = 骨长」来排：这样部件一件都不被拉伸，还白捡一条读法 ——
 * 半径小的时候同样的骨长要绕更多圈角度，笼子自己盘紧；张开时又松开。
 *
 * 两条锁骨在这里变成**核心到环的系绳**（会被拉长）。两条腿的弧没有对应的骨头
 * 连回核心，所以它们是真的浮着的 —— 这正是"无躯干"该有的读法。
 */
const RADIAL = {
  /** 四条轨道：绕 Y 的方位角、轨道面相对铅垂的倾角、弧的起始相位（弧度） */
  arcs: [
    { az: 0.0, tilt: 0.30, phase: -0.55 },   // 左臂
    { az: Math.PI, tilt: -0.30, phase: -0.55 },   // 右臂
    { az: Math.PI * 0.5, tilt: 0.95, phase: 2.30 },   // 左腿
    { az: -Math.PI * 0.5, tilt: -0.95, phase: 2.30 },   // 右腿
  ],
  /** 核心（脊柱+颈+头）压到原长的多少 —— 不压就还是"躯干 + 一个环" */
  coreScale: 0.40,
  /** 弧半径 = 末端到中心的距离 × 它 */
  radiusScale: 1.0,
  /** 半径下限（米）：太小的时候弦长会超过直径，弧解不出来 */
  minRadius: 0.22,
  /** 弧的高度偏移 = 末端相对中心的高度 × 它 */
  liftScale: 0.55,
};

const ARC_CHAINS: readonly (readonly string[])[] = [
  ['shoulderL', 'elbowL', 'wristL', 'handTipL'],
  ['shoulderR', 'elbowR', 'wristR', 'handTipR'],
  ['hipL', 'kneeL', 'ankleL', 'footIdxL'],
  ['hipR', 'kneeR', 'ankleR', 'footIdxR'],
];

/** 人面朝哪边：肩轴 × 上 = 前。缺肩时退回 +Z（合成骨架的朝向） */
function facing(sk: Skeleton): { right: Vec3; fwd: Vec3 } {
  const l = J(sk, 'shoulderL'), r = J(sk, 'shoulderR');
  const right: Vec3 = l && r && dist(l, r) > 1e-3 ? norm(sub(l, r)) : [1, 0, 0];
  const fwd: Vec3 = norm([-right[2], 0, right[0]]);       // cross(right, up)
  return { right, fwd };
}

function radial(sk: Skeleton): Skeleton {
  const pelvis = J(sk, 'pelvis') ?? [0, 0.9, 0];
  const chest = J(sk, 'chest') ?? [0, 1.3, 0];
  const hub: Vec3 = [(pelvis[0] + chest[0]) / 2, (pelvis[1] + chest[1]) / 2, (pelvis[2] + chest[2]) / 2];

  const yaw = Math.atan2(facing(sk).fwd[0], facing(sk).fwd[2]);

  const out: Record<string, Vec3> = {};

  for (let i = 0; i < ARC_CHAINS.length; i++) {
    const chain = ARC_CHAINS[i];
    const cfg = RADIAL.arcs[i];
    const tip = J(sk, chain[chain.length - 1]);
    const reach = tip ? dist(hub, tip) : RADIAL.minRadius;
    const R = Math.max(RADIAL.minRadius, reach * RADIAL.radiusScale);
    const lift = tip ? (tip[1] - hub[1]) * RADIAL.liftScale : 0;

    // 轨道面：u 在水平面里，v 是铅垂方向绕 u 倾斜 tilt 之后的那条
    const a = cfg.az + yaw;
    const u: Vec3 = [Math.cos(a), 0, Math.sin(a)];
    const w: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
    const ct = Math.cos(cfg.tilt), st = Math.sin(cfg.tilt);
    const v: Vec3 = norm([st * w[0], ct, st * w[2]]);
    const c: Vec3 = [hub[0], hub[1] + lift, hub[2]];

    let theta = cfg.phase;
    const at = (t: number): Vec3 => [
      c[0] + R * (Math.cos(t) * u[0] + Math.sin(t) * v[0]),
      c[1] + R * (Math.cos(t) * u[1] + Math.sin(t) * v[1]),
      c[2] + R * (Math.cos(t) * u[2] + Math.sin(t) * v[2]),
    ];
    out[chain[0]] = at(theta);
    for (let k = 0; k + 1 < chain.length; k++) {
      const p = J(sk, chain[k]), q = J(sk, chain[k + 1]);
      const L = p && q ? dist(p, q) : 0;
      // 弦长 L 对应的圆心角；L 超过直径时贴着半圆走（P2：不产生 NaN）
      theta += 2 * Math.asin(Math.min(1, L / (2 * R)));
      out[chain[k + 1]] = at(theta);
    }
  }

  // 核心：把 脊柱→颈→头 压扁，居中悬在 hub 上。头仍然沿人的头向 —— 观众低头，核心低头
  const spineLen = chainLength(sk, ['pelvis', 'chest']) * RADIAL.coreScale;
  const neckLen = chainLength(sk, ['chest', 'neck']) * RADIAL.coreScale;
  const headLen = chainLength(sk, ['neck', 'headCenter']) * RADIAL.coreScale;
  const half = (spineLen + neckLen + headLen) / 2;
  out.pelvis = [hub[0], hub[1] - half, hub[2]];
  out.chest = [hub[0], hub[1] - half + spineLen, hub[2]];
  out.neck = [hub[0], hub[1] - half + spineLen + neckLen, hub[2]];
  const hd = J(sk, 'neck') && J(sk, 'headCenter')
    ? norm(sub(J(sk, 'headCenter')!, J(sk, 'neck')!)) : [0, 1, 0] as Vec3;
  out.headCenter = add(out.neck, scale(hd, headLen));

  // 锁骨不动 —— 它的两端（chest 与 shoulderL/R）已经分别落在核心与环上，
  // 于是它自己变成了那两根系绳。这是白捡的，不需要额外几何。
  for (const k in sk.joints ?? {}) if (!out[k]) out[k] = sane(sk.joints[k]);
  return rebuild(sk, out, true);
}

// ── column：单柱型 ──────────────────────────────────────────────────────────

/**
 * 人体 → 单柱。**没有腿**：两条腿的六块骨头被首尾串成一根从地面长上来的桅杆，
 * 脊柱与颈接在它顶上，人的两条手臂变成桅杆顶端的两条分支。
 *
 * 守住的那条因果：
 *  - 两条手臂**世界方向原样保留**（和 quadruped 同一招）→ 抬手，分支跟着抬。
 *  - 人蹲下 → 桅杆按之字折叠（每一节交替倾斜），整根柱子真的变矮、真的折起来。
 *    这是"没有膝盖也能读出蹲"的那条路。
 *  - 人转身 → 折叠平面跟着肩轴转。
 *
 * 为什么是折叠而不是缩短：骨长是部件的长度，缩短会把部件压扁。
 * 折叠只改方向不改长度，部件一件都不变形，而高度一样会掉下来。
 */
const COLUMN = {
  /** 常驻的轻微之字（弧度）。完全笔直读作一根杆子，不读作"一节一节堆起来的" */
  baseLean: 0.14,
  /** 蹲到底时额外增加的倾角（弧度）≈ 69° */
  foldLean: 1.2,
  /** 顶端两条分支的横向间距 = 人的肩宽 × 它 */
  branchSpread: 0.8,
};

/**
 * 桅杆从地面往上的堆叠顺序。相邻两节共用一个关节，所以没有空档。
 * `footIdxL` 与 `hipR` 是**同一个点**（右腿顶 = 左脚底），`pelvis` 与 `hipL` 同理 ——
 * 人体骨架里那两处本来就没有骨头相连，重合就是把缝合上。
 */
const MAST: readonly [string, string][] = [
  ['footIdxR', 'ankleR'], ['ankleR', 'kneeR'], ['kneeR', 'hipR'],
  ['footIdxL', 'ankleL'], ['ankleL', 'kneeL'], ['kneeL', 'hipL'],
];
/** MAST 每一节对应到人体上是哪根骨头（取长度用） */
const MAST_SRC: readonly [string, string][] = [
  ['ankleR', 'footIdxR'], ['kneeR', 'ankleR'], ['hipR', 'kneeR'],
  ['ankleL', 'footIdxL'], ['kneeL', 'ankleL'], ['hipL', 'kneeL'],
];

function column(sk: Skeleton): Skeleton {
  const { right, fwd } = facing(sk);

  // 蹲的程度：胯离地多高 / 腿链有多长。站直 ≈ 0，蹲到底 ≈ 0.5+
  const legChain = Math.max(0.05, chainLength(sk, ['hipL', 'kneeL', 'ankleL', 'footIdxL']));
  const hipY = Math.max(0, ((J(sk, 'hipL')?.[1] ?? 0) + (J(sk, 'hipR')?.[1] ?? 0)) / 2);
  const crouch = Math.min(1, Math.max(0, 1 - hipY / legChain));
  const lean = COLUMN.baseLean + crouch * COLUMN.foldLean;
  const cl = Math.cos(lean), sl = Math.sin(lean);

  const out: Record<string, Vec3> = {};
  let cursor: Vec3 = [0, 0, 0];
  out[MAST[0][0]] = cursor;
  for (let i = 0; i < MAST.length; i++) {
    if (i === 3) out.footIdxL = cursor;         // 左脚底接在右腿顶上，柱子在这里不断
    const [sa, sb] = MAST_SRC[i];
    const a = J(sk, sa), b = J(sk, sb);
    const L = a && b ? dist(a, b) : 0.1;
    const sign = i % 2 === 0 ? 1 : -1;          // 之字：一节朝前，一节朝后
    const d: Vec3 = [sign * sl * fwd[0], cl, sign * sl * fwd[2]];
    cursor = add(cursor, scale(norm(d), L));
    out[MAST[i][1]] = cursor;
  }

  // 桅杆顶 = pelvis。脊柱是桅杆的**最后一节**，也参加之字 ——
  // 让它笔直会把躯干立成一个正面朝人的胸腔，整根柱子立刻被读回"半个人"。
  // 颈和头不折：头是这具身体唯一的朝向线索，甩掉它就没有"它在看哪"了。
  out.pelvis = out.hipL;
  const spineLen = Math.max(0.02, chainLength(sk, ['pelvis', 'chest']));
  const neckLen = Math.max(0.02, chainLength(sk, ['chest', 'neck']));
  const headLen = Math.max(0.02, chainLength(sk, ['neck', 'headCenter']));
  const spineDir = norm([sl * fwd[0], cl, sl * fwd[2]] as Vec3);   // MAST 有 6 节，第 7 节是偶数号 → 正向
  out.chest = add(out.pelvis, scale(spineDir, spineLen));
  out.neck = [out.chest[0], out.chest[1] + neckLen, out.chest[2]];
  const hd = J(sk, 'neck') && J(sk, 'headCenter')
    ? norm(sub(J(sk, 'headCenter')!, J(sk, 'neck')!)) : [0, 1, 0] as Vec3;
  out.headCenter = add(out.neck, scale(hd, headLen));

  // 顶端的两条分支：插座搬到 chest 两侧，手臂的世界方向一点不动
  const shHalf = Math.abs((J(sk, 'shoulderL')?.[0] ?? 0.19) - (J(sk, 'shoulderR')?.[0] ?? -0.19)) / 2;
  const halfSpread = Math.max(0.03, shHalf * COLUMN.branchSpread);
  out.shoulderL = add(out.chest, scale(right, halfSpread));
  out.shoulderR = add(out.chest, scale(right, -halfSpread));
  regrow(sk, out, 'shoulderL', ['shoulderL', 'elbowL', 'wristL', 'handTipL']);
  regrow(sk, out, 'shoulderR', ['shoulderR', 'elbowR', 'wristR', 'handTipR']);

  for (const k in sk.joints ?? {}) if (!out[k]) out[k] = sane(sk.joints[k]);
  return rebuild(sk, out);
}

// ── 纯比例类重映射 ──────────────────────────────────────────────────────────

/**
 * 按比例改造，绕 pelvis 做。
 *
 * 注意这里是**逐链**缩放而不是整体缩放：手臂链从肩开始缩，腿链从胯开始缩，
 * 头从颈开始缩。整体缩放会让四肢连着躯干一起飞出去，比例就不是比例了，是放大镜。
 */
function proportion(sk: Skeleton, spec: BodyPlanSpec, groundAll = false): Skeleton {
  const root = J(sk, 'pelvis') ?? [0, 0, 0];
  const torso = spec.torso ?? 1;
  const limb = spec.limb ?? 1;
  const armK = limb * (spec.arm ?? 1);
  const legK = limb * (spec.leg ?? 1);
  const headK = spec.head ?? 1;

  const out: Record<string, Vec3> = {};
  // 1) 躯干骨架（含肩胯颈）绕 pelvis 缩放
  const TORSO = ['pelvis', 'chest', 'neck', 'shoulderL', 'shoulderR', 'hipL', 'hipR'];
  for (const k of TORSO) {
    const p = J(sk, k);
    if (p) out[k] = add(root, scale(sub(p, root), torso));
  }
  // 2) 头从 neck 出发单独缩
  const neck = J(sk, 'neck'), head = J(sk, 'headCenter');
  if (neck && head && out.neck) out.headCenter = add(out.neck, scale(sub(head, neck), headK));

  // 3) 四肢：从新的肩/胯出发，沿原方向按各自系数长出来
  const chains: [string, string[], number][] = [
    ['shoulderL', ['shoulderL', 'elbowL', 'wristL', 'handTipL'], armK],
    ['shoulderR', ['shoulderR', 'elbowR', 'wristR', 'handTipR'], armK],
    ['hipL', ['hipL', 'kneeL', 'ankleL', 'footIdxL'], legK],
    ['hipR', ['hipR', 'kneeR', 'ankleR', 'footIdxR'], legK],
  ];
  for (const [start, chain, k] of chains) {
    let cursor = out[start];
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = J(sk, chain[i]), b = J(sk, chain[i + 1]);
      if (!a || !b || !cursor) { if (cursor) out[chain[i + 1]] = cursor; continue; }
      cursor = add(cursor, scale(sub(b, a), k));
      out[chain[i + 1]] = cursor;
    }
  }
  // 兜底：没被算到的关节原样搬过来（P2：宁可不动，不要留空）
  for (const kk in sk.joints ?? {}) if (!out[kk]) out[kk] = sane(sk.joints[kk]);
  return rebuild(sk, out, groundAll);
}

/** 上下颠倒，手当脚 */
function inverted(sk: Skeleton): Skeleton {
  const root = J(sk, 'pelvis') ?? [0, 0, 0];
  const out: Record<string, Vec3> = {};
  for (const k in sk.joints ?? {}) {
    const p = sane(sk.joints[k]);
    out[k] = [p[0], root[1] - (p[1] - root[1]), p[2]];
  }
  return rebuild(sk, out, true);
}

// ── 入口 ────────────────────────────────────────────────────────────────────

/**
 * 把人体骨架翻译成某个物种的身体。永不抛异常，未知 plan 按 'rig' 处理（P2）。
 */
/** 预设：为了让常见的几种一句话能写出来 */
const PRESETS: Record<string, BodyPlanSpec> = {
  towering: { limb: 1.55, torso: 0.85 },
  stub: { limb: 0.55, torso: 1.25, head: 1.2 },
};

const isSpec = (p: unknown): p is BodyPlanSpec =>
  typeof p === 'object' && p !== null && !Array.isArray(p);

/** BodyPlanSpec 的五个比例字段。写一次，下面两处共用 —— 加第六个只改这里 */
const PROPORTION_KEYS = ['limb', 'torso', 'head', 'arm', 'leg'] as const;

/**
 * 预设 + 条目自己写的比例：**条目写了的字段赢，没写的落回预设。**
 *
 * 这里修的 bug：`{ kind: 'stub', head: 1.5 }` 以前整份 spec 被丢掉，
 * switch 走的是 `proportion(sk, PRESETS.stub)`，出口那一遍又被 `FIXED_PROPORTION`
 * 挡住 —— 实测 `{kind:'stub',head:2.1,limb:0.3,torso:0.9}` 与光写 `'stub'`
 * 吐出来的关节坐标一模一样。于是 `droid` / `char.line` / `char.diva` 这三个条目里
 * 那几个数是**装饰**：数据声明了一种身材，运行时给的是另一种，而且没有任何一处会红。
 * 和"拼错的 plan 静默变人形"是同一类失败 —— **声明没有到达运行时**。
 *
 * 为什么是合并而不是覆盖：`'stub'` 这个名字本身就承载三个数（limb/torso/head），
 * 只写 `{kind:'stub', head:1.5}` 的人要的是"矮壮，但头再大一点"，不是
 * "把 limb/torso 恢复成 1"。覆盖式会让 `droid` 从矮壮变回正常比例的大头人。
 */
function withPreset(kind: string, spec: BodyPlanSpec): BodyPlanSpec {
  const out: BodyPlanSpec = { ...(PRESETS[kind] ?? {}) };
  for (const k of PROPORTION_KEYS) if (spec[k] !== undefined) out[k] = spec[k];
  return out;
}

/**
 * 一个 `BodyPlan`（字符串 / 预设名 / spec 对象）到底是**哪一个拓扑**。
 *
 * 单独抽出来是因为它有三个使用者（`remapSkeleton`、`groundsByLowestJoint`、`main.ts`
 * 的 HUD），而 `towering` / `stub` 这两个预设名只改比例、拓扑其实是 `rig` ——
 * 这条读法在三个地方各写一遍，迟早有一处漏掉。
 */
export function planKind(plan: BodyPlan = 'rig'): string {
  if (isSpec(plan)) return plan.kind ?? 'rig';
  return PRESETS[plan] ? 'rig' : (plan as string);
}

/**
 * 这个方案的落地基准是**整具骨架的最低关节**（而不是脚）吗。
 *
 * 这是 `PLANS_WITHOUT_FEET` 唯一的判据函数 —— **不要再建第二张表**。
 * 凡是"把骨架整体沿 Y 平移到地面"的地方（`bodyplan.ts` 的 `rebuild()` 与
 * `groundSkeleton()`）都必须先问它一次，否则 `radial` / `inverted`
 * 会被按着一组**长在身体顶上**的关节往下拽。
 */
export const groundsByLowestJoint = (plan: BodyPlan = 'rig'): boolean =>
  PLANS_WITHOUT_FEET.includes(planKind(plan));

/**
 * 一串骨架变换全部结束后的唯一落地收口。输入已经贴地时原样返回同一个对象，
 * 所以正常人形路径只多四个 Y 比较，不为一条恒等式分配整副骨架。
 */
export function groundSkeleton(sk: Skeleton, plan: BodyPlan = 'rig'): Skeleton {
  if (!sk?.joints || !Array.isArray(sk.bones)) return sk;
  const groundAll = groundsByLowestJoint(plan);
  if (Math.abs(groundLevel(sk.joints, groundAll)) <= 1e-9) return sk;
  const joints: Record<string, Vec3> = {};
  for (const key in sk.joints) joints[key] = [...sk.joints[key]];
  const bones = sk.bones.map((bone) => ({ ...bone, p0: [...bone.p0] as Vec3, p1: [...bone.p1] as Vec3 }));
  ground(joints, bones, groundAll);
  return { ...sk, joints, bones };
}

/** 这个 spec 会不会真的改变比例？全是 1 就别白跑一趟 */
const changesProportion = (s: BodyPlanSpec): boolean =>
  PROPORTION_KEYS.some((k) => s[k] !== undefined && s[k] !== 1);

/**
 * 这些 kind 自己已经把比例消化掉了，出口不许再来一遍。
 * towering / stub 是因为上面那一句 `proportion(sk, withPreset(kind, spec))`
 * 已经把预设和条目自己的比例合并着做完了 —— 出口再来一遍就是平方；
 * radial / column 是因为 `proportion()` 依赖"肩是肩、胯是胯"这套人体语义，
 * 而这两个拓扑把那套语义拆了 —— 拓扑之后再缩放会把环和桅杆撕开。
 * 所以它们改成**先缩放人体、再换拓扑**：比例仍然生效，而且作用在一具还是人的骨架上。
 */
const FIXED_PROPORTION = new Set(['towering', 'stub', 'radial', 'column']);

const pre = (sk: Skeleton, spec: BodyPlanSpec): Skeleton =>
  changesProportion(spec) ? proportion(sk, spec) : sk;

/**
 * 把人体骨架翻译成某个物种的身体。永不抛异常，未知 plan 按 'rig' 处理（P2）。
 *
 * 顺序是固定的：**先改拓扑，再改比例**。反过来的话比例会被拓扑重映射冲掉 ——
 * quadruped 会重新摆放所有插座，之前的缩放就白做了。
 */
export function remapSkeleton(sk: Skeleton, plan: BodyPlan = 'rig'): Skeleton {
  if (!sk || !Array.isArray(sk.bones) || !sk.bones.length) return sk;

  const spec: BodyPlanSpec = isSpec(plan) ? plan : (PRESETS[plan] ?? { kind: plan as BodyPlanId });
  const kind = planKind(plan);

  let out = sk;
  switch (kind) {
    case 'quadruped': out = quadruped(sk); break;
    case 'inverted': out = inverted(sk); break;
    // 预设 + 条目自己的比例（`withPreset`）。以前这里写死 `PRESETS[kind]`，
    // 条目自带的那几个数被静默丢掉 —— 见 `withPreset` 的注释。
    case 'towering': case 'stub': out = proportion(sk, withPreset(kind, spec)); break;
    // radial / column 的比例是**先**做的，见下面 PRE_PROPORTION 的理由
    case 'radial': out = radial(pre(sk, spec)); break;
    case 'column': out = column(pre(sk, spec)); break;
    default: break;                            // 'rig' 与任何未知值 = 不改拓扑
  }
  // 出口的比例遍要沿用这个拓扑自己的落地基准 —— 否则 inverted 会被重新按"脚"贴地，
  // 而它的脚在最上面，头就被按到地板以下去了（这条是 xeno 换成 inverted 时抓到的）
  if (changesProportion(spec) && !FIXED_PROPORTION.has(kind)) {
    out = proportion(out, spec, PLANS_WITHOUT_FEET.includes(kind));
  }
  return out;
}

/**
 * 两个身体方案之间的**渐变**。会话弧线第 III 乐章用它（`docs/40 §1`）：
 *
 * > 「拓扑漂走：人形让位给这个物种自己的身体方案。」
 * > **"逐渐"是这条线的全部技术要求**（docs/40 §1 末尾）。
 *
 * 做法是把**两次重映射的结果**逐点插值，而不是去插值方案参数本身 ——
 * 后者对 `radial` / `column` 这种换了拓扑的方案根本没有中间态可言，
 * 而两端各自都是一具合法骨架，它们之间的直线就是一条合法的漂移。
 *
 * 骨长**重新量**（和 `acts/resist.ts` 同一条理由）：不重量的话挂载数学会照着
 * 插值出来的端点去拉伸部件，读起来像橡皮，而这里要的是漂移不是形变。
 *
 * `t<=0` / `t>=1` 直接返回那一端的对象（不是拷贝）—— 弧线四段里有三段落在这里，
 * 这条捷径让"不在漂移中"的那些帧零分配（P2）。
 */
export function blendSkeletons(a: Skeleton, b: Skeleton, t: number): Skeleton {
  if (!a || !b || !Number.isFinite(t) || t <= 0) return a;
  if (t >= 1) return b;
  if (a === b) return a;

  const lerp = (p: Vec3, q: Vec3): Vec3 => {
    if (!sane(p)) return q;
    if (!sane(q)) return p;
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  };

  const joints: Record<string, Vec3> = {};
  for (const k in a.joints) {
    const q = b.joints?.[k];
    joints[k] = q ? lerp(a.joints[k], q) : a.joints[k];
  }
  for (const k in b.joints) if (!(k in joints)) joints[k] = b.joints[k];

  const byId = new Map<BoneId, Bone>(b.bones.map((x) => [x.id, x]));
  const bones: Bone[] = a.bones.map((bone) => {
    const other = byId.get(bone.id);
    if (!other) return bone;
    const p0 = lerp(bone.p0, other.p0);
    const p1 = lerp(bone.p1, other.p1);
    return {
      ...bone,
      p0,
      p1,
      length: dist(p0, p1),
      roll: bone.roll + (other.roll - bone.roll) * t,
      confidence: Math.min(bone.confidence, other.confidence),
    };
  });

  return { ...a, joints, bones, height: a.height + (b.height - a.height) * t };
}
