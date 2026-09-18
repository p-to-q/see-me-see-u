/**
 * 生命力 —— 让一串刚体看起来像活的。
 *
 * ## 为什么需要它
 *
 * 参照作品（Universal Everything, *Future You*）里那具身体被描述为
 * "wiggles, shifts, and **bends**"，而它的创作者 Matt Pyke 把自己的方法论
 * 概括成一句 "technology that has a soul in it"。
 *
 * 我们的身体做不到"bend"，因为它按设计就是**刚体挂载、不做蒙皮**（docs/04）。
 * 每个零件的矩阵直接来自骨骼，于是全身每一帧完美同步 ——
 * 那读起来是提线木偶，不是生物。这是项目负责人说"人做得不好看"时，
 * 除了材质之外的另一半原因，而且是更根本的那一半。
 *
 * ## 解法：局部跟随与重叠动作（follow-through / overlapping action）
 *
 * 动画里最老的一条原理：**末端比动作起点慢一点**。这里的“末端”严格只指
 * 肘之后的前臂与手；骨盆、躯干、头、肘和整条承重链始终是当前帧。
 *
 * 做法分两步，第二步是关键：
 *
 * 1. 只追踪前臂与手的**方向**，手腕比手尖快；静止目标没有任何自主相位。
 * 2. 从当前肘按当前骨长重新长出前臂与手，延迟不能拆链、缩骨或移动支撑点。
 *
 * 没有第二步这个东西就是错的：骨长是稳定器辛苦算出来的（滚动中位数），
 * 而下游的 `attachMatrix` 拿 `bone.length` 当缩放。让骨长跟着弹簧漂，
 * 结果是零件一帧胖一帧瘦 —— 那不是生命力，那是故障。
 *
 * ## 它在哪一层
 *
 * 在 `remapSkeleton` **之后**、`body.pose()` **之前**。
 * 放这里有两个理由：
 * - 它对**所有**身体方案都生效，包括团块（`mass`）—— 它只认 Skeleton，不认渲染器；
 * - 四足/矮壮那些方案已经把插座搬过位置了，延迟应该发生在**那具身体**的链上，
 *   而不是人的链上。顺序反了，四足的前腿会带着人类肩膀的延迟。
 *
 * 这一层不再拥有落地规则。调用者把全部骨架变换做完后，统一交给
 * `bodyplan.ts/groundSkeleton()` 收口；生命力只负责局部时间形状。
 */
import { SKELETON, VITALITY } from './tuning.ts';
import { BONES } from './skeleton.ts';
import type { Bone, Skeleton, Vec3 } from './types.ts';

/** 关节在链上的深度。根 = 0，越往末端越大 —— 延迟量就按它分配 */
const DEPTH: Record<string, number> = (() => {
  const d: Record<string, number> = { pelvis: 0, hipL: 1, hipR: 1 };
  // BONES 已经是从根往外排的，所以一趟扫下来就够，不需要建树
  for (const [, a, b] of BONES) if (d[b] === undefined) d[b] = (d[a] ?? 0) + 1;
  return d;
})();

/** 最深的那一级，用来把深度归一化成 0..1 */
const MAX_DEPTH = Math.max(...Object.values(DEPTH));

const finite = (v: Vec3 | undefined): v is Vec3 =>
  !!v && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);

const ARM_CHAINS = [
  { elbow: 'elbowL', wrist: 'wristL', tip: 'handTipL' },
  { elbow: 'elbowR', wrist: 'wristR', tip: 'handTipR' },
] as const;

const ENDPOINTS = new Map<string, readonly [string, string]>(
  BONES.map(([id, a, b]) => [id, [a, b] as const]),
);

const measure = (a: Vec3, b: Vec3): number => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

function direction(a: Vec3, b: Vec3): Vec3 {
  const n = measure(a, b);
  return n > 1e-9 ? [(b[0] - a[0]) / n, (b[1] - a[1]) / n, (b[2] - a[2]) / n] : [0, 1, 0];
}

function blendDirection(a: Vec3, b: Vec3, amount: number): Vec3 {
  const u = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 1;
  const mixed: Vec3 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  const n = Math.hypot(mixed[0], mixed[1], mixed[2]);
  return n > 1e-9 ? [mixed[0] / n, mixed[1] / n, mixed[2] / n] : [...b];
}

const along = (origin: Vec3, dir: Vec3, length: number): Vec3 => [
  origin[0] + dir[0] * length,
  origin[1] + dir[1] * length,
  origin[2] + dir[2] * length,
];

function rebuildBones(sk: Skeleton, joints: Record<string, Vec3>): Bone[] {
  return (sk.bones ?? []).map((bone) => {
    const ends = ENDPOINTS.get(bone.id);
    if (!ends) return bone;
    const p0 = joints[ends[0]], p1 = joints[ends[1]];
    if (!finite(p0) || !finite(p1)) return bone;
    return { ...bone, p0: [...p0], p1: [...p1], length: measure(p0, p1) };
  });
}

/**
 * 上游按契约应当只交有限数；这里仍守最后一道帧循环边界。
 * 优先用这帧骨头端点补坏关节，而不是把一截肢体扯向世界原点。
 */
function recoverSkeleton(sk: Skeleton, previous: Skeleton | null): Skeleton {
  const joints: Record<string, Vec3> = {};
  for (const key in sk.joints ?? {}) if (finite(sk.joints[key])) joints[key] = [...sk.joints[key]];
  for (const [id, a, b] of BONES) {
    const bone = sk.bones?.find((candidate) => candidate.id === id);
    if (!finite(joints[a]) && finite(bone?.p0)) joints[a] = [...bone.p0];
    if (!finite(joints[b]) && finite(bone?.p1)) joints[b] = [...bone.p1];
  }
  for (const [, a, b] of BONES) {
    if (!finite(joints[a]) && finite(joints[b])) joints[a] = [...joints[b]];
    if (!finite(joints[b]) && finite(joints[a])) joints[b] = [...joints[a]];
  }

  const fallback = previous?.joints.pelvis;
  const anchor: Vec3 = finite(fallback) ? [...fallback] : [0, 0, 0];
  for (const [, a, b] of BONES) {
    if (!finite(joints[a])) joints[a] = [...anchor];
    if (!finite(joints[b])) joints[b] = [...anchor];
  }

  const recovered: Skeleton = {
    ...sk,
    joints,
    bones: rebuildBones(sk, joints),
    height: Number.isFinite(sk.height) && sk.height > 1e-3
      ? sk.height
      : previous?.height ?? SKELETON.referenceHeight,
    t: Number.isFinite(sk.t) ? sk.t : previous?.t ?? 0,
  };
  return recovered;
}

export interface Vitality {
  /**
   * 返回一个**新的** Skeleton；输入不被改写。
   * 骨长与 `height` 逐字保持；只有关节的**方向**会有延迟。
   *
   * 正常路径只保留观众动作产生的局部 follow-through；静止没有隐藏的自主呼吸。
   */
  apply(sk: Skeleton, dt: number): Skeleton;
  reset(): void;
}

export function createVitality(): Vitality {
  /** 双臂末端的方向状态；第一帧直接落到目标，不从默认方向飞过去。 */
  let state: Record<string, Vec3> = {};
  /** 坏帧只冻结到上一副可画骨架；绝不把坏链拉向世界原点。 */
  let previous: Skeleton | null = null;

  function reset(): void { state = {}; previous = null; }

  function apply(sk: Skeleton, dt: number): Skeleton {
    if (!VITALITY.enabled || !sk?.joints) return sk;
    const values = Object.values(sk.joints);
    const sourceIsFinite = values.length > 0 && values.every(finite);
    if (!sourceIsFinite && previous) return previous;
    const safe = sourceIsFinite ? sk : recoverSkeleton(sk, previous);
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
    const src = safe.joints;
    const out: Record<string, Vec3> = {};
    for (const key in src) out[key] = [...src[key]];

    const follow = (key: string, target: Vec3): Vec3 => {
      const prior = state[key];
      if (!finite(prior)) {
        state[key] = [...target];
        return target;
      }
      const depth = DEPTH[key] ?? MAX_DEPTH;
      const norm = MAX_DEPTH > 0 ? depth / MAX_DEPTH : 1;
      const tau = VITALITY.lagSeconds * Math.pow(norm, VITALITY.lagCurve);
      const amount = tau > 1e-4 ? 1 - Math.exp(-step / tau) : 1;
      const next = blendDirection(prior, target, amount);
      state[key] = next;
      return next;
    };

    for (const chain of ARM_CHAINS) {
      const elbow = src[chain.elbow], wrist = src[chain.wrist], tip = src[chain.tip];
      if (!finite(elbow) || !finite(wrist) || !finite(tip)) continue;
      const wristOut = along(elbow, follow(chain.wrist, direction(elbow, wrist)), measure(elbow, wrist));
      const tipOut = along(wristOut, follow(chain.tip, direction(wrist, tip)), measure(wrist, tip));
      out[chain.wrist] = wristOut;
      out[chain.tip] = tipOut;
    }

    const result: Skeleton = {
      ...safe,
      joints: out,
      bones: rebuildBones(safe, out),
      height: Number.isFinite(safe.height) && safe.height > 1e-3
        ? safe.height
        : previous?.height ?? SKELETON.referenceHeight,
      t: Number.isFinite(safe.t) ? safe.t : previous?.t ?? 0,
    };
    previous = result;
    return result;
  }

  return { apply, reset };
}
