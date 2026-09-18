/**
 * 纯装配：(genome, skeleton, library) → PartInstance[]。
 *
 * 这里**不碰 three、不碰 DOM、不持有状态**，只把 docs/04 §4 的挂载数学
 * （`core/attach.ts`，不重写）套到 genome 的每一个槽位上，外加 docs/05 §4 的关节盖片。
 * 渲染怎么画是 `creature.ts` 的事。
 *
 * 之所以要独立成文件：装配是"身体长什么样"的全部规则，
 * 它必须能在没有 GPU 的地方被读、被 diff、被单测。
 */
import { attachMatrix, jointMatrix } from '../../../core/src/attach.ts';
import { groundLift, liftMatrixInPlace, lowestPointOf, MAX_LIFT, type PlacedExtent } from '../../../core/src/ground.ts';
import { IS_LEFT, SLOT_OF_BONE } from '../../../core/src/slots.ts';
import { FOOT, MORPH, SKELETON, SLOT_FIT, SLOT_WIDTH } from '../../../core/src/tuning.ts';
import { BONES } from '../../../core/src/skeleton.ts';
import type {
  Bone, BoneId, Genome, Mat4, MaterialRole, PartMeta, Skeleton, Slot, SlotKey, Vec3,
} from '../../../core/src/types.ts';

/** 一个要画的部件实例。渲染端只认这个结构 */
export interface PartInstance {
  /** 稳定的实例标识：骨头 id，或 `joint:<关节名>` */
  key: string;
  /** 这个实例的 genome 槽位（关节盖片全部是 'joint'） */
  slotKey: SlotKey;
  slot: Slot;
  partId: string;
  materialRole: MaterialRole;
  /**
   * 这是左侧肢体、要用**预镜像几何**（`library.mirrored()`）画。
   * 矩阵本身不含负 X 缩放 —— 镜像烘进几何里了，理由见 `library.mirrorGeometry`。
   */
  mirrored: boolean;
  /** 列主序 4x4，与 three.js Matrix4.elements 一致 */
  matrix: Mat4;
  /**
   * 这件是稳定身体的一部分，可以决定主体贴地量。
   * 替换中的碎屑、芯和飞入件仍然正常绘制，但不能拖着其他部位上下移动。
   */
  groundsBody: boolean;
}

/** 一个槽位这一帧要画成什么样。换装动画期间一个槽位会有两条（旧的缩小 / 新的长回来） */
export interface SlotRender {
  partId: string;
  materialRole: MaterialRole;
  /** 0..1 整体缩放，用于 crossfade */
  scale?: number;
  /** 沿骨头轴（关节盖片沿"离开骨盆"方向）外移多少米，用于组装动画 */
  offset?: number;
  /**
   * 沿骨头轴再挪**骨长的几分之几**（关节盖片没有骨长，忽略）。
   * 忒修斯替换的墨屑用它沿骨头摆开（`replace-event.ts`）
   */
  along?: number;
  /** 垂直于轴向外挪多少米，方向由 `angle`（绕轴的弧度）定。墨屑用它散开 */
  lateral?: number;
  angle?: number;
  /**
   * 只画在 `JOINT_CAPS` 下标落在 `[lo, hi)` 里的那几处盖片上（骨头件忽略）。
   * 缺省 = 每一处都画。关节那一格的交接是一道**波**，不是十三处同时交接 ——
   * 同时交接会把那一格的实例和面数一起乘上去（`replace-event.ts` 的 `waveRenders`）。
   */
  caps?: readonly [number, number];
  /**
   * 是否参与主体落地计算。缺省 true；只有短命的替换效果几何设为 false。
   * 这不影响该实例是否绘制。
   */
  groundsBody?: boolean;
}

/** 垂直于 `dir` 的一个方向，绕轴转 `angle`。退化（dir 贴着 Z）时换一根参考轴 */
function lateralInPlace(m: Mat4, dir: Vec3, dist: number, angle: number): void {
  if (!dist) return;
  const ref: Vec3 = Math.abs(dir[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  let u: Vec3 = [dir[1] * ref[2] - dir[2] * ref[1], dir[2] * ref[0] - dir[0] * ref[2], dir[0] * ref[1] - dir[1] * ref[0]];
  const l = Math.hypot(u[0], u[1], u[2]) || 1;
  u = [u[0] / l, u[1] / l, u[2] / l];
  const v: Vec3 = [dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]];
  const c = Math.cos(angle) * dist;
  const s = Math.sin(angle) * dist;
  m[12] += u[0] * c + v[0] * s;
  m[13] += u[1] * c + v[1] * s;
  m[14] += u[2] * c + v[2] * s;
}

export interface AssembleOptions {
  /** 覆盖某些槽位的渲染内容；没给的槽位按 genome 原样画 */
  render?: Partial<Record<SlotKey, SlotRender[]>>;
  /**
   * 交接中槽位的稳定落地代理；只参与 lift，不返回给渲染端。
   * 这里的件必须是满尺寸、在插座上的稳定几何，不能带碎屑 / offset / 事件 scale。
   * 未列出的槽位不会在这里重复装配：它们已由正常 render 实例参与落地。
   */
  ground?: Partial<Record<SlotKey, SlotRender[]>>;
  /**
   * 交接目标的稳定落地代理。和 `ground` 成对使用，按 `groundProgress[key]` 插值两件代理的
   * **世界最低点**，而不是把旧 AABB 用到最后一帧再突然换成新 AABB。
   * 未列出或量不到一端时退回可测量的一端；坏进度按 0，帧循环不抛。
   */
  groundTo?: Partial<Record<SlotKey, SlotRender[]>>;
  groundProgress?: Partial<Record<SlotKey, number>>;
  /** 实例总数上限（docs/02 P5）。超了就丢弃多余的，绝不越预算 */
  maxInstances?: number;
}

/** assemble 只需要"按 id 查 meta"这一件事 —— 传整个 PartLibrary 也行 */
export interface MetaSource {
  metaOf(partId: string): PartMeta;
}

/**
 * 关节盖片表（docs/05 §4）。
 * 相邻骨头从 `core/skeleton.ts` 的 `BONES` 推得出来，但 hipL/hipR 例外：
 * 骨盆→胯之间没有骨头，所以那两个关节没有"结束于此"的骨头，必须显式写出来。
 * `proximal` = 父部件（结束于该关节的那根骨）；它若 `capJoint: true` 就跳过盖片。
 */
export interface JointCap {
  joint: string;
  neighbors: BoneId[];
  proximal: BoneId | null;
}

export const JOINT_CAPS: JointCap[] = (() => {
  const ends = new Map<string, BoneId[]>();
  const starts = new Map<string, BoneId[]>();
  for (const [id, a, b] of BONES) {
    (starts.get(a) ?? starts.set(a, []).get(a)!).push(id as BoneId);
    (ends.get(b) ?? ends.set(b, []).get(b)!).push(id as BoneId);
  }
  const caps: JointCap[] = [];
  for (const joint of new Set([...starts.keys(), ...ends.keys()])) {
    const prox = ends.get(joint) ?? [];
    const dist = starts.get(joint) ?? [];
    // 'neck' 关节不盖：neck 这根骨头本身就挂了一个 joint 槽位的部件（SLOT_OF_BONE.neck === 'joint'）
    if (joint === 'neck') continue;
    if (prox.length + dist.length < 2) continue;    // 末端（headCenter / handTip / footIdx）不盖
    caps.push({ joint, neighbors: [...prox, ...dist], proximal: prox[0] ?? null });
  }
  // 胯：没有骨头结束在这里，父部件按 spine 算
  caps.push({ joint: 'hipL', neighbors: ['spine', 'thighL'], proximal: 'spine' });
  caps.push({ joint: 'hipR', neighbors: ['spine', 'thighR'], proximal: 'spine' });
  return caps;
})();

/**
 * 这根骨头在标准身材上的"横向宽度"（米）。
 * stretch 槽位的 SLOT_WIDTH 本来就是横向宽度；uniform 槽位的读作"整体大小"
 * （spine = 0.44 是整个躯干的尺寸，不是腰围），拿它当关节半径会得到一个巨大的球，
 * 所以 uniform 槽位一律退回 SLOT_WIDTH.joint。
 */
function boneGirthMeters(bone: BoneId): number {
  const slot = SLOT_OF_BONE[bone];
  return SLOT_FIT[slot] === 'stretch' ? SLOT_WIDTH[slot] : SLOT_WIDTH.joint;
}

const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);

/**
 * 整只脚的世界长度。骨头（踝→脚尖）量不到脚跟那一截，所以要补一个系数；
 * 钳位是因为脚尖 landmark 是全身最容易被追踪冲飞的点之一（docs/04 §2 的回退链就为它而写）。
 */
function footLength(boneLength: number, bodyScale: number): number {
  const raw = finite(boneLength, 0) * FOOT.lengthOfBone;
  return Math.min(FOOT.maxLength * bodyScale, Math.max(FOOT.minLength * bodyScale, raw));
}

function defaultRender(genome: Genome, key: SlotKey): SlotRender[] {
  const pick = genome.slots?.[key];
  if (!pick || typeof pick.partId !== 'string') return [];
  return [{ partId: pick.partId, materialRole: pick.materialRole ?? 'primary' }];
}

/** 单位方向 p0→p1，退化时回退 +Y */
function dirOf(p0: Vec3, p1: Vec3): Vec3 {
  const d: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  return l > 1e-9 ? [d[0] / l, d[1] / l, d[2] / l] : [0, 1, 0];
}

/** 列主序矩阵的平移列就是 m[12..14] —— 组装动画的外移直接加在这里 */
function translateInPlace(m: Mat4, dir: Vec3, dist: number): void {
  if (!dist) return;
  m[12] += dir[0] * dist;
  m[13] += dir[1] * dist;
  m[14] += dir[2] * dist;
}

/**
 * 把装配结果整体抬到地面上（`core/ground.ts` 是那条几何事实的唯一定义处）。
 *
 * 为什么这一步必须在**这里**：落地量 = 每件部件的局部包围盒过一遍它自己的挂载矩阵。
 * 骨架层拿不到 aabb（core 不读 parts.json），渲染层拿不到"哪一件挂在哪根骨头上"
 * 之前的那个矩阵还没算完 —— 只有装配层两头都在手上。
 *
 * 为什么是**每帧**算，而不是组装时算一次存起来：抬升量不是部件的常数，
 * 它随部件的**朝向**变。脚平放时脚底朝下，抬升 = 半个脚厚；踮起脚尖时同一只脚
 * 转了 40°，脚底不再是最低的那一面，抬升就不是那个数了。缓存一个数的代价是
 * "站着对、一动就穿帮"，而算它只要每件三次乘法（≤64 件，对 P5 是噪声）。
 * 真正被缓存下来、不必每帧重算的是**局部包围盒本身** —— 它从 `PartMeta` 直接读，
 * 不分配、不遍历顶点。
 */
function floorBySlot(parts: PartInstance[], lib: MetaSource, floors: Map<SlotKey, number>): void {
  floors.clear();
  for (const i of parts) {
    scratch.matrix = i.matrix;
    scratch.aabb = lib.metaOf(i.partId)?.aabb ?? null;
    scratch.mirrored = i.mirrored;
    const y = lowestPointOf(scratch);
    if (y === null) continue;
    const before = floors.get(i.slotKey);
    if (before === undefined || y < before) floors.set(i.slotKey, y);
  }
}

function groundToFloor(
  out: PartInstance[], stable: PartInstance[], stableTo: PartInstance[],
  progress: AssembleOptions['groundProgress'], lib: MetaSource,
): void {
  if (!out.length) return;                        // mass 那一档一个部件都不实例化
  const blend = !!progress && (stable.length > 0 || stableTo.length > 0);
  if (blend) {
    floorBySlot(stable, lib, fromFloors);
    floorBySlot(stableTo, lib, toFloors);
  }
  // 复用同一个对象喂给 groundLift：这条路在帧循环里，每帧 new 64 个临时对象
  // 就是每分钟给 GC 送 230k 个短命对象（P5：帧里不分配）
  const lift = groundLift((function* () {
    for (const i of out) {
      if (!i.groundsBody) continue;
      scratch.matrix = i.matrix;
      scratch.aabb = lib.metaOf(i.partId)?.aabb ?? null;
      scratch.mirrored = i.mirrored;
      yield scratch;
    }
    if (!blend) {
      for (const i of stable) {
        scratch.matrix = i.matrix;
        scratch.aabb = lib.metaOf(i.partId)?.aabb ?? null;
        scratch.mirrored = i.mirrored;
        yield scratch;
      }
      return;
    }
    // 每个交接槽位只贡献一个连续的最低点。全身仍取所有槽位的最小值，
    // 所以多个同时交接的部位也各走自己的 t，不需要捏造一个全局进度。
    for (const [key, from] of fromFloors) {
      const to = toFloors.get(key) ?? from;
      const raw = progress?.[key];
      const t = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw!)) : 0;
      floorMatrix[13] = from + (to - from) * t;
      yield floorPoint;
    }
    // 从空槽 graft 时生产接线会把 from=to；这里仍给独立调用者一个安全退路。
    for (const [key, to] of toFloors) {
      if (fromFloors.has(key)) continue;
      floorMatrix[13] = to;
      yield floorPoint;
    }
  })());
  if (lift) for (const i of out) liftMatrixInPlace(i.matrix, lift);

  // 短命效果不能决定主体 lift，但它自己也不能穿地。
  // 主体完成稳定落地后再逐件只往 +Y 补：一片墨屑碰地只停住自己，
  // 绝不反向搬动头、躯干或别的人。量不到就不动，荒谬 AABB 沿用 MAX_LIFT 安全阀。
  for (const i of out) {
    if (i.groundsBody) continue;
    scratch.matrix = i.matrix;
    scratch.aabb = lib.metaOf(i.partId)?.aabb ?? null;
    scratch.mirrored = i.mirrored;
    const y = lowestPointOf(scratch);
    if (y !== null && y < 0) liftMatrixInPlace(i.matrix, Math.min(-y, MAX_LIFT));
  }
}

/** `groundToFloor` 的复用槽。单线程、同步遍历，不会有第二个使用者同时持有它 */
const scratch: PlacedExtent = { matrix: [], aabb: null, mirrored: false };
const fromFloors = new Map<SlotKey, number>();
const toFloors = new Map<SlotKey, number>();
const floorMatrix: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const floorPoint: PlacedExtent = {
  matrix: floorMatrix,
  aabb: { min: [0, 0, 0], max: [0, 0, 0] },
  mirrored: false,
};

export function assemble(
  genome: Genome,
  skeleton: Skeleton,
  lib: MetaSource,
  opt: AssembleOptions = {},
): PartInstance[] {
  const out = place(genome, skeleton, lib, opt);
  // 代理只装配 opt.ground 明确列出的槽位，不把整具身体在帧里再算一遍。
  const stable = opt.ground ? place(genome, skeleton, lib, { render: opt.ground }, true) : [];
  const stableTo = opt.groundTo ? place(genome, skeleton, lib, { render: opt.groundTo }, true) : [];
  groundToFloor(out, stable, stableTo, opt.groundProgress, lib);
  return out;
}

/** 纯挂载：只按骨架把每件摆到它该在的地方，**不管地面**。落地是 `assemble()` 的事 */
function place(
  genome: Genome,
  skeleton: Skeleton,
  lib: MetaSource,
  opt: AssembleOptions,
  onlyRenderOverrides = false,
): PartInstance[] {
  const out: PartInstance[] = [];
  const cap = finite(opt.maxInstances ?? Infinity, Infinity);
  if (!genome || !skeleton || !Array.isArray(skeleton.bones)) return out;

  // bodyScale = 观测身高 / 标准身高（docs/04 §4）。身高是外部输入 → 必须钳位
  const height = finite(skeleton.height, SKELETON.referenceHeight);
  const bodyScale = Math.min(2.5, Math.max(0.4, height / SKELETON.referenceHeight));

  const byId = new Map<BoneId, Bone>();
  for (const b of skeleton.bones) if (b && b.id) byId.set(b.id, b);

  // ── 1. 骨头部件 ────────────────────────────────────────────────────────
  for (const bone of skeleton.bones) {
    if (out.length >= cap) return out;
    if (!bone || !bone.id) continue;
    const slot = SLOT_OF_BONE[bone.id];
    if (!slot) continue;

    const renders = opt.render?.[bone.id] ?? (onlyRenderOverrides ? [] : defaultRender(genome, bone.id));
    const mode = SLOT_FIT[slot];
    const dir = dirOf(bone.p0, bone.p1);

    for (const r of renders) {
      if (out.length >= cap) return out;
      const meta = lib.metaOf(r.partId);
      const s = Math.max(0, Math.min(1, finite(r.scale ?? 1, 1)));
      if (s <= 1e-3) continue;                       // 缩到看不见就别占实例位

      const girth = (SLOT_WIDTH[slot] * bodyScale) / Math.max(1e-4, meta.localGirth);
      const mirrored = IS_LEFT[bone.id] && meta.symmetry === 'mirror';
      // 脚的长轴与骨头不是一回事（见 tuning.ts 的 FOOT）：长度自己算，踝钉在脚长三成处
      const isFoot = slot === 'foot';

      const matrix: Mat4 = new Array(16).fill(0);
      attachMatrix(bone, matrix, {
        mode,
        girth: girth * s,
        // 镜像不再走负 X 缩放（那会让整个左半身的法线反过来，看着像换了材质），
        // 改成让渲染端拿预镜像的几何。见 assets/library.ts 的 mirrorGeometry。
        mirror: false,
        // uniform 模式的 sy 已经含 girth（= g·ls），再乘 s 会平方；stretch 的 sy = len·ls 才需要
        lengthScale: mode === 'stretch' ? s : 1,
        axisLength: isFoot ? footLength(bone.length, bodyScale) * s : undefined,
        anchor: isFoot ? FOOT.anchor : 0,
      });
      translateInPlace(matrix, dir, finite(r.offset ?? 0, 0) + finite(r.along ?? 0, 0) * finite(bone.length, 0));
      lateralInPlace(matrix, dir, finite(r.lateral ?? 0, 0), finite(r.angle ?? 0, 0));

      out.push({
        key: bone.id,
        slotKey: bone.id,
        slot,
        partId: r.partId,
        materialRole: r.materialRole,
        mirrored,
        matrix,
        groundsBody: r.groundsBody !== false,
      });
    }
  }

  // ── 2. 关节盖片（docs/05 §4） ──────────────────────────────────────────
  const joints = skeleton.joints ?? {};
  const pelvis = joints['pelvis'] ?? [0, 0, 0];
  const jointRenders = opt.render?.['joint'] ?? (onlyRenderOverrides ? [] : defaultRender(genome, 'joint'));

  for (let ci = 0; ci < JOINT_CAPS.length; ci++) {
    const capDef = JOINT_CAPS[ci];
    if (out.length >= cap) return out;
    const p = joints[capDef.joint];
    if (!p) continue;

    // 父部件自带盖片就不重复盖
    const parent = capDef.proximal ? byId.get(capDef.proximal) : undefined;
    if (parent) {
      const parentPick = genome.slots?.[parent.id];
      if (parentPick && lib.metaOf(parentPick.partId).capJoint) continue;
    }

    // 半径 = max(相邻两骨 girth) × MORPH.jointCapScale（旋钮住在 tuning.ts）
    let widest = 0;
    for (const n of capDef.neighbors) widest = Math.max(widest, boneGirthMeters(n));
    const radiusMeters = widest * bodyScale * MORPH.jointCapScale;
    const dir = dirOf(pelvis, p);

    for (const r of jointRenders) {
      if (out.length >= cap) return out;
      if (r.caps && (ci < r.caps[0] || ci >= r.caps[1])) continue;
      const meta = lib.metaOf(r.partId);
      const s = Math.max(0, Math.min(1, finite(r.scale ?? 1, 1)));
      if (s <= 1e-3) continue;

      const matrix: Mat4 = new Array(16).fill(0);
      jointMatrix(p, (radiusMeters * s) / Math.max(1e-4, meta.localGirth), matrix);
      translateInPlace(matrix, dir, finite(r.offset ?? 0, 0));
      lateralInPlace(matrix, dir, finite(r.lateral ?? 0, 0), finite(r.angle ?? 0, 0));

      out.push({
        key: `joint:${capDef.joint}`,
        slotKey: 'joint',
        slot: 'joint',
        partId: r.partId,
        materialRole: r.materialRole,
        mirrored: false,
        matrix,
        groundsBody: r.groundsBody !== false,
      });
    }
  }

  return out;
}

/** 这个 genome 会用到哪些 partId —— 给 `library.preload()` 用 */
export function partIdsOf(genome: Genome): string[] {
  const ids = new Set<string>();
  for (const pick of Object.values(genome?.slots ?? {})) {
    if (pick && typeof pick.partId === 'string') ids.add(pick.partId);
  }
  return [...ids];
}
