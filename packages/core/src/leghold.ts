/**
 * 上半身模式下的腿：**不被低可见度的腿点驱动，换成一个站在地上的中性站姿**。纯函数。
 *
 * ## 为什么需要它
 *
 * 笔记本观众只露头、肩、胯。MediaPipe 对画外的膝踝照样给坐标（可见度 0.1–0.4），
 * 精化器（`refine.ts`）按遮挡规矩保持 0.67 秒之后**放手** —— 放手的意思是
 * 可见度归零、坐标照旧是那个猜出来的数。于是骨架的腿在桌子底下乱甩，
 * `mediapipeToWorld` 的落地拿不到可信的脚，退到"最低的那个点"，整具身体跟着上下跳。
 *
 * ## 为什么不是一套新的落地
 *
 * 它只做两件事，然后把剩下的交还给已经存在的机制：
 *  1. 腿的关节按权重混向一个站姿（髋照旧来自追踪 —— 髋是躯干的一部分，看得见）；
 *  2. 按**脚**把整具骨架重新落回 y=0 —— 和 `skeleton.ts` 的入口落地、全部骨架变换后的
 *     `bodyplan.ts/groundSkeleton()` 是同一条规矩（最低的脚关节回到地面），不是第二套。
 *
 * 骨长按"躯干量出来的身材"给（脊柱骨长 / 标准站姿脊柱长），而不是用稳定器那一份腿长：
 * 腿看不见的时候，腿长的滚动中位数里装的正是那些乱甩的帧。
 *
 * 在帧循环里的位置：`clampFold` 之后、`motion.update` 之前 —— 站着不动的腿不该贡献运动能量。
 */
import type { Bone, Skeleton, Vec3 } from './types.ts';
import { BONES } from './skeleton.ts';
import { SKELETON } from './tuning.ts';

/** 标准站姿（1.7m，`stage/framing.ts` 的 REFERENCE_POSE 同源）里的几段长度（米） */
const REF = { spine: 0.40, thigh: 0.42, shin: 0.42, footDown: 0.06, footFwd: 0.16, heelBack: 0.05 };
/** 身材系数夹在这里面：脊柱被追踪量歪时，腿不至于长成高跷或者缩成两截 */
const SCALE_MIN = 0.7, SCALE_MAX = 1.35;

const LEG_BONES = new Set(['thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR']);

const finite = (v: Vec3 | undefined): v is Vec3 =>
  !!v && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (x: number): number => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/**
 * 这具骨架在权重 `weight`（0..1，线性，内部套 smoothstep）下的腿。
 * 返回**新的** Skeleton；输入不被改写。权重 0 原样返回同一个对象（零开销）。
 */
export function holdLegs(sk: Skeleton, weight: number): Skeleton {
  const w = smooth(weight);
  if (!(w > 0) || !sk?.joints) return sk;
  const src = sk.joints;
  const hipL = src.hipL, hipR = src.hipR;
  if (!finite(hipL) || !finite(hipR)) return sk;

  const spine = sk.bones?.find((b) => b.id === 'spine')?.length;
  const s = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Number.isFinite(spine) && spine! > 1e-3 ? spine! / REF.spine : 1));

  const J: Record<string, Vec3> = {};
  for (const k in src) if (finite(src[k])) J[k] = [src[k][0], src[k][1], src[k][2]];

  for (const [side, hip] of [['L', hipL], ['R', hipR]] as const) {
    // 站姿：膝在髋正下方、踝在膝正下方、脚尖朝前（+Z 面向镜头，docs/04 §1）。
    // 方向是**世界**的竖直，不跟躯干倾斜走 —— 人前倾的时候腿仍然是立着的
    const knee: Vec3 = [hip[0], hip[1] - REF.thigh * s, hip[2] + 0.01 * s];
    const ankle: Vec3 = [hip[0], knee[1] - REF.shin * s, hip[2]];
    const foot: Vec3 = [ankle[0], ankle[1] - REF.footDown * s, ankle[2] + REF.footFwd * s];
    const heel: Vec3 = [ankle[0], ankle[1] - REF.footDown * s, ankle[2] - REF.heelBack * s];
    const at = (name: string, rest: Vec3): Vec3 => (finite(J[name]) ? lerp3(J[name], rest, w) : rest);
    J['knee' + side] = at('knee' + side, knee);
    J['ankle' + side] = at('ankle' + side, ankle);
    J['footIdx' + side] = at('footIdx' + side, foot);
    J['heel' + side] = at('heel' + side, heel);
  }

  // 落地：最低的脚关节回到 y=0（和 skeleton.ts / vitality.ts 同一条规矩）
  let lo = Infinity;
  for (const n of ['footIdxL', 'footIdxR', 'ankleL', 'ankleR']) lo = Math.min(lo, J[n]?.[1] ?? Infinity);
  if (Number.isFinite(lo) && Math.abs(lo) > 1e-12) for (const k in J) J[k][1] -= lo;

  const byId = new Map(sk.bones?.map((b) => [b.id, b]) ?? []);
  const bones: Bone[] = BONES.flatMap(([id, a, b]) => {
    const old = byId.get(id);
    if (!old) return [];
    const p0 = J[a] ?? old.p0, p1 = J[b] ?? old.p1;
    const leg = LEG_BONES.has(id);
    return [{
      ...old,
      p0: [p0[0], p0[1], p0[2]] as Vec3,
      p1: [p1[0], p1[1], p1[2]] as Vec3,
      // 非腿骨只是平移了，长度就是稳定器那一份；腿骨长度按新端点量（站姿本身就是按身材给的）
      length: leg ? Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) : old.length,
      // 站姿是一个**决定**，不是一次猜测：团块身体按 confidence 给球的权重，站着的腿不该淡出
      confidence: leg ? old.confidence + (1 - old.confidence) * w : old.confidence,
    }];
  });

  // 身高按**站姿**算：骨盆高度 + 脊柱、颈、头三段骨长 + 颅顶补偿。
  // 不取"颅顶的 y"：人一前倾头就低下去，那样身高跟着缩，动能（除以身高）和中景的画面高度都会跟着呼吸。
  // 前倾时颅顶低于这个身高，差值正是舞台中景跟随的竖直偏移（`stage.ts`）。
  const len = (id: string): number => byId.get(id as Bone['id'])?.length ?? 0;
  const stance = (J.pelvis?.[1] ?? NaN) + len('spine') + len('neck') + len('head') + SKELETON.craniumOffset;
  const height = Number.isFinite(stance) && stance > 0.3 ? sk.height + (stance - sk.height) * w : sk.height;
  return { bones, joints: J, height: height > 1e-3 ? height : sk.height, warmingUp: sk.warmingUp, t: sk.t };
}
