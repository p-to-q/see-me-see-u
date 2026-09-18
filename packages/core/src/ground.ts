/**
 * 网格落地 —— 让**看得见的那个东西**站在地面上。
 *
 * ## 它补的是哪一个洞
 *
 * 骨架那条线已经在全部骨架变换之后由 `bodyplan.ts/groundSkeleton()` 收过一次地：
 * 整具骨架沿 Y 平移，让最低的**关节**回到 y=0
 * —— 人形按脚关节，没有脚的方案按整具最低关节（`bodyplan.ts` 的 `groundsByLowestJoint`）。
 * 那一层没有错，它只是**只认关节**。而关节是骨架里的一个点，不是网格的底面：
 *
 *   踝在 y=0 → 脚这个部件绕骨轴长出来 → 脚底在 y≈-0.05。
 *
 * 也就是说地板以下永远藏着半个脚厚。实测（29 个条目、参考站姿、真 parts.json）：
 * 人形一档普遍沉 3~6cm，最深的 `digitigrade` 是 -0.059m；四足更糟，因为它的
 * 前腿末端（手）本来就落在脚的落地基准以下。这就是"脚陷进地里 5cm"那个现象。
 *
 * ## 做法
 *
 * 每件部件的局部包围盒（`PartMeta.aabb`，归一化空间）过一遍它自己的挂载矩阵，
 * 取所有部件里最低的那个角，整体抬上来。**不猜、不写死偏移量** ——
 * 每个物种的脚厚度不一样，写死一个数就是给 29 个条目配一个平均值
 * （舞台那边 `framing.ts` 的注释早就把这件事推给了装配层，因为只有装配层拿得到 aabb）。
 *
 * ## 为什么是"最低的部件"，而不是"脚这个槽位"
 *
 * 因为槽位的语义随身体方案漂：四足的前腿是**手**，`radial` 根本没有"脚"，
 * `inverted` 的脚在最上面，`mass` 一个部件都不实例化。给这七种方案各写一条
 * "谁算落地点"的规则，就是七条会各自过期的规则（P15 反过来用：
 * 这里没有一张靠看得出来的表，只有一条对所有方案都成立的几何事实）。
 * 「渲染出来的东西不许穿过地板」对哪一种方案都成立，所以规则只有这一条。
 *
 * ## 退化情况（都在下面显式处理，绝不 NaN —— P2）
 *
 *  - 一个部件都没有（`mass`、IDLE 时全身缩到 0）→ 抬升 0，身体保持原样；
 *  - 某件没有 aabb（parts.json 是外部数据，字段可能缺）→ 跳过这一件；
 *  - 矩阵里有 NaN/Infinity（追踪冲飞）→ 跳过这一件，而不是让整具身体消失；
 *  - 算出来的抬升荒谬地大 → 钳在 `MAX_LIFT`，宁可还沉着也不要飞出画面。
 */
import type { Mat4, Vec3 } from './types.ts';

/**
 * 单帧允许的最大抬升（米）。**不是美术旋钮，所以不住在 `tuning.ts`** ——
 * 它是这段算法自己的安全阀，和 `creature.ts` 里的 `IDLE_FRAMES_BEFORE_DISPOSE` 同类：
 * aabb 来自 parts.json（外部数据，P2 默认不可信），一件坏掉的包围盒能把整具身体弹出画面。
 * 钳住之后最坏情况只是"还沉着"，而不是"飞了"。
 * 0.5m 的由来：实测最厚的部件半厚 ≈ 0.06m，乘上身高钳位上限 2.5 倍仍不到 0.2m，
 * 所以任何超过半米的抬升都只可能是数据坏了。
 */
export const MAX_LIFT = 0.5;

/** 一件已经算好挂载矩阵、等着被量的部件 */
export interface PlacedExtent {
  /** 列主序 4x4，与 `attachMatrix` 的输出一致 */
  matrix: Mat4;
  /** 部件在**局部空间**的包围盒（`PartMeta.aabb`）。缺了就量不了这一件 */
  aabb?: { min: Vec3; max: Vec3 } | null;
  /**
   * 这一件用的是**预镜像几何**（`library.mirrored()`）。
   * 镜像烘在几何里、不在矩阵里（见 `creature.ts` 的抬头注释），
   * 所以 meta 里那个 aabb 的 X 区间对这一件是反的 —— 不翻回来，
   * 左右不对称的部件（脚就是）会量错一边。
   */
  mirrored?: boolean;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 一件部件被挂载矩阵变换之后的世界最低点。量不了时返回 `null`（不是 0 ——
 * 0 是一个合法的高度，用它当"没量到"会把整具身体钉在地面上）。
 *
 * 只取 Y 行：世界 y = m[1]·x + m[5]·y + m[9]·z + m[13]。
 * 变换是线性的，所以八个角不用一个个算 —— 每根轴取两端里较小的那个乘积即可。
 * 每帧全身 ≤64 件、每件 3 次乘法，对 P5 的 4ms 预算是噪声。
 */
export function lowestPointOf(part: PlacedExtent): number | null {
  const m = part?.matrix;
  const box = part?.aabb;
  if (!m || m.length < 16 || !box) return null;
  if (!isNum(m[1]) || !isNum(m[5]) || !isNum(m[9]) || !isNum(m[13])) return null;

  const min = box.min, max = box.max;
  if (!Array.isArray(min) || !Array.isArray(max)) return null;
  // 镜像几何的 X 区间是原区间关于 0 的镜像
  const x0 = part.mirrored ? -max[0] : min[0];
  const x1 = part.mirrored ? -min[0] : max[0];
  if (!isNum(x0) || !isNum(x1) || !isNum(min[1]) || !isNum(max[1]) || !isNum(min[2]) || !isNum(max[2])) return null;

  const y = m[13]
    + Math.min(m[1] * x0, m[1] * x1)
    + Math.min(m[5] * min[1], m[5] * max[1])
    + Math.min(m[9] * min[2], m[9] * max[2]);
  return Number.isFinite(y) ? y : null;
}

/**
 * 这一堆部件整体要沿 +Y 抬多少，最低的那一点才正好落在 y=0。
 *
 * 返回值可正可负：网格陷在地下 → 正数（抬起来）；整体浮在空中 → 负数（放下去）。
 * 后者不是多余的 —— 骨架层的落地基准是关节，四足/矮壮那些方案换过基准之后，
 * 网格底面完全可能停在地面之上。两个方向都补，"贴地"才是一条恒等式而不是一个愿望。
 *
 * 没有任何一件量得出来（`mass` 不实例化部件、进场时全身缩到 0）→ 返回 0：
 * 不知道身体在哪里的时候，唯一安全的动作是别动它。
 */
export function groundLift(parts: Iterable<PlacedExtent>): number {
  let lo = Infinity;
  for (const p of parts) {
    const y = lowestPointOf(p);
    if (y !== null && y < lo) lo = y;
  }
  if (!Number.isFinite(lo)) return 0;
  const lift = -lo;
  if (Math.abs(lift) <= MAX_LIFT) return lift;
  return lift > 0 ? MAX_LIFT : -MAX_LIFT;
}

/** 列主序矩阵的平移列在 m[12..14]，抬升只动 m[13] */
export function liftMatrixInPlace(m: Mat4, lift: number): void {
  if (!lift || !Number.isFinite(lift) || !m || m.length < 16) return;
  if (!Number.isFinite(m[13])) return;      // 本来就是坏的，别再往上加一个数
  m[13] += lift;
}
