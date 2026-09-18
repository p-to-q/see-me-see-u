/**
 * Creature —— docs/06-SPEC-runtime-protocol.md §4。
 *
 * 每种「部件 × 材质」一个 `InstancedMesh`，每帧把 `assemble()` 算出的矩阵写进去。
 * 矩阵一律来自 `core/attach.ts`，这里**不做任何挂载数学**（docs/04 §4 是唯一定义处）。
 *
 * 三条必须守住的线：
 *  - `pose()` 在帧循环里跑 → 不 throw、不 await、不分配大对象（P2/P5）。
 *  - 实例总数硬顶 `BUDGET.maxInstances`，超了丢弃而不是"以后再优化"。
 *  - 换装只动**变化的槽位**，同时最多 `MORPH.maxConcurrentSwaps` 个，其余排队（docs/05 §3）。
 *
 * 着色语言（`shading.ts`）：默认 `DEFAULT_SHADING`（2026-09-13 起是 `toon`）。
 * 走 `toon` 时每个桶**多挂一块反向外壳**（`BackSide` + 沿法线外推）画描边，
 * 填充换成 3 级平涂；墨的宽度按槽位来（`TOON.outlineSlotScale`，手和脚收窄）。
 * 为什么描边要在这里、而不是做成一个后期 pass，理由写在 `shading.ts` 里 ——
 * 一句话是：后期是可以被降级阶梯自动关掉的，而一个物种的辨识度不能挂在那上面。
 *
 * 镜像（docs/04 §4 的陷阱）：**不用负 X 缩放**。负行列式会把左半身的三角形全变成背面，
 * 而背面片元的法线会被取反 —— 左半身于是比右半身暗一大截，读起来像"左右手材质不一样"。
 * 改成向库要一块预镜像的几何（`library.mirrored()`），行列式保持为正。
 * 材质仍然 `side: DoubleSide`，那是为了兜住部件本身没封闭的情况，不再是为了兜镜像。
 */
import * as THREE from 'three/webgpu';
import { harmonize } from '../../../core/src/palette.ts';
import { ALL_SLOT_KEYS } from '../../../core/src/slots.ts';
import { BUDGET, MATERIAL, MORPH, TIME } from '../../../core/src/tuning.ts';
import type {
  Genome, MaterialDef, MaterialRole, PartMeta, Presence, Skeleton, Slot, SlotKey, SlotPick, Tier,
} from '../../../core/src/types.ts';
import type { PartLibrary } from '../assets/library.ts';
import { writeInstanceColor } from './instance-color.ts';
import { assemble, partIdsOf, type PartInstance, type SlotRender } from './assemble.ts';
import {
  createFillMaterial, createOutlineMaterial, DEFAULT_SHADING, disposeShading, outlineMetersFor,
  setOutlineTint,
  type ShadingId,
} from './shading.ts';
import { ARC_OFF, arcWeights, rgbToHsl, type ArcWeights } from '../stage/look.ts';
import { surfaceFor, type SurfaceSpec } from './surface.ts';
import { crossfadeRenders, graftCurve, REPLACE_SECONDS, replaceRenders } from './replace-event.ts';
import { passesOf, swapCeiling } from './swap-budget.ts';

export interface CreatureStats {
  instances: number;
  triangles: number;
  /**
   * 实际提交的 InstancedMesh 数量 ≈ draw call。
   * **描边外壳算在里面** —— HUD 上读到的必须是真的提交了多少次（P21）。
   */
  drawCalls: number;
  swapsActive: number;
  swapsQueued: number;
  /** 还在用占位几何的实例数（资产没到货 / 加载失败） */
  placeholders: number;
  /**
   * 桶集合的版本号：建一个桶、拆一个桶各 +1。
   * `stage/warm-plan.ts` 据此判断直出那条路要不要在空闲里重编（docs/48 §10）。
   */
  buckets: number;
}

export interface Creature {
  /** 只对变化的槽位做 crossfade，最多同时 MORPH.maxConcurrentSwaps 个（docs/05 §3） */
  remorph(g: Genome): void;
  pose(sk: Skeleton, p: Presence, dt: number): void;
  /** 换观众：丢掉 genome 与所有在途交接，保留桶和 GPU 资源供下一场复用 */
  reset(): void;
  /** 慢回路产物到货：把某个槽位热插拔成新部件，带组装动画 */
  graft(slot: SlotKey, meta: PartMeta, geometry: THREE.BufferGeometry): void;
  /**
   * 忒修斯的一次替换（docs/44 §7）：旧件碎成墨屑、新件用 graft 的组装动画装上、描边不断。
   * **当帧就开始**，不排队 —— 替换音在同一帧响，排进队列就对不上了。
   * 形状全在 `replace-event.ts`，这里只管把它接进帧循环。
   */
  replace(slot: SlotKey, pick: SlotPick): void;
  /**
   * 换着色语言。控件条的「描边」那一项走这里 —— 它要重建全部材质与桶，
   * 所以只该被一次按键调用，不该每帧调。相同值是 no-op。
   */
  setShading(id: ShadingId): void;
  readonly shading: ShadingId;

  /**
   * 弧线进度 `0..1`（docs/40 的四个乐章 → 表面，docs/41）。**每帧调都行** ——
   * 它只写已经存在的那几块材质的 uniform，不建桶、不换管线、不重编译。
   *
   * 从来没被调过的时候这条线整个不存在，画面和今天逐像素相同。
   */
  setArc(progress: number): void;
  readonly arc: number;

  /**
   * 伴随身体（docs/50 §5.1）：画面里其余几个人，每人一具，**共用这一份 genome 和这一组桶**。
   * 每帧调一次（空数组 = 只有主身体）。它们的实例排在主身体后面，描边外壳只数主身体那几份；
   * 颜色走 `instanceColor`，不开新桶。`companions` 选项为 0 时这一条什么都不做。
   */
  setCompanions(list: readonly Companion[]): void;
  /** 伴随身体在场时主身体留不留描边（`creature/people-budget.ts` 的结论） */
  setOutlineWithCompanions(on: boolean): void;

  /**
   * 为尚未出现的 genome 建立**将来真正会采用的同一批桶**。调用方一次只让 `next()`
   * 暴露一个桶，走过一帧真实渲染后立刻 `park()`；失败或来不及就什么也不暖，正式成型照旧现建。
   */
  prepareBuckets(g: Genome, sk: Skeleton): CreatureBucketWarmPlan;
  /** 取消尚未上场的桶保留；桶本身走原来的空闲 TTL，不在取消当帧集中 dispose */
  clearPreparedBuckets(): void;

  /** 挂到 scene 上的根节点 */
  readonly object: THREE.Group;
  readonly genome: Genome | null;
  readonly stats: CreatureStats;
  dispose(): void;
}

export interface CreatureBucketWarmPlan {
  /** 暴露下一个桶；false = 全部走完或准备失败 */
  next(): boolean;
  /** 收起此刻暴露的桶；幂等，取消 / render 抛错时也必须调用 */
  park(): void;
  readonly done: boolean;
}

export interface CreatureOptions {
  library: PartLibrary;
  /** 实例上限，默认 BUDGET.maxInstances */
  maxInstances?: number;
  /**
   * 着色语言。缺省 `DEFAULT_SHADING` —— dev 页不传这一项时看到的必须和现场一样，
   * 否则取证图和现场不是同一具身体。
   * 调用方通常传 `resolveShading(themeId, flags.shading)` —— 物种自己声明，URL 可覆盖。
   */
  shading?: ShadingId;
  /**
   * 给 `replace()` 留几个交接名额（0 或 1）。`main.ts` 在忒修斯开着的时候给 1。
   *
   * 同时在交接的件数上限由 draw call 预算算出来（`swap-budget.ts` 的 `swapCeiling`：
   * 描边 2，平涂之外 3）。替换是当帧开始、不排队的（替换音同一帧响），
   * 所以它的名额必须事先空着 —— 否则升档那一批交叉淡入占满之后它只能**叠在上面**，
   * 那正是 2026-09-14 实测 42/40 draw 的来路之一。
   * `?theseus=off` 时给 0：没有替换，名额全给交叉淡入。
   */
  replaceSlots?: number;
  /**
   * 最多几具伴随身体（`?people=` − 1，docs/50）。缺省 0 = 这一版之前的那条路：
   * 桶上不挂 `instanceColor`（挂上会多一个着色器变体），`setCompanions` 是 no-op。
   */
  companions?: number;
}

/** 一具伴随身体这一帧的样子。骨架是它自己的人的；站位是整体平移（米），不进挂载数学 */
export interface Companion {
  skeleton: Skeleton;
  presence: Presence;
  /** 乘在材质上的整体色（`core/people.ts` 的 `tintFor`） */
  tint: readonly [number, number, number];
  dx: number;
  dz: number;
  /** 额外的整体缩放 0..1（开场团块还没长出零件时是 0：伴随身体跟着主身体一起长出来）。缺省 1 */
  scale?: number;
}

interface Swap {
  key: SlotKey;
  from: SlotPick | null;
  to: SlotPick;
  /** 0..1 */
  t: number;
  /** 'replace' = 忒修斯那一下（碎开 + 组装），缺省 = 交叉淡入 */
  kind?: 'replace';
}

interface MeshEntry {
  mesh: THREE.InstancedMesh;
  partId: string;
  materialId: string;
  capacity: number;
  trisPerInstance: number;
  /** 连续多少帧没被用到 —— 换材质/换部件后回收空 mesh，免得 draw call 慢慢长胖 */
  idleFrames: number;
  /** 预备桶在目标档位出现前不能被普通空桶回收；真正走到这档后恢复原来的 TTL */
  preparedUntilTier: Tier | null;
  /** 这一帧是否真的改过实例颜色；稳定单人全白时必须一直为 false，避免重复 GPU 上传。 */
  colorDirty: boolean;
  /**
   * 描边外壳（只在 `toon` 下存在）。**和填充共用同一个 `instanceMatrix`**：
   * 矩阵每帧只写一遍，外壳白拿 —— 这是这条路径几乎不吃 CPU 的原因。
   * 共用的代价是两块 mesh 必须一起建、一起丢（见 `disposeEntry`）。
   */
  outline: THREE.InstancedMesh | null;
}

/** 空 mesh 留这么多帧再回收（换装动画来回切时不要反复重建） */
const IDLE_FRAMES_BEFORE_DISPOSE = 180;

const smoothstep = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** 在场缩放：ENTERING 长出来，LEAVING 缩回去（docs/05 §5）。主身体和伴随身体同一条曲线 */
const presenceScale = (presence: Presence | null | undefined): number =>
  presence?.state === 'ENTERING' ? smoothstep(presence.transition)
    : presence?.state === 'LEAVING' ? 1 - smoothstep(presence.transition)
      : presence?.state === 'IDLE' ? 0
        : 1;

const DEFAULT_COLOR: [number, number, number] = [0.78, 0.77, 0.75];

/**
 * 一个 InstancedMesh 桶 = 部件 × 左右 × 材质。
 * 左右要分桶是因为左侧用的是**另一块几何**（预镜像副本），不是同一块几何的负缩放。
 */
const bucketKey = (partId: string, mirrored: boolean, materialId: string) =>
  `${partId}${mirrored ? '~m' : ''}#${materialId}`;

export function createCreature(opt: CreatureOptions): Creature {
  const library = opt.library;
  const maxInstances = opt.maxInstances ?? BUDGET.maxInstances;
  const companionsMax = Math.max(0, Math.floor(opt.companions ?? 0));
  let companions: readonly Companion[] = [];
  let outlineWithCompanions = true;
  /** 伴随身体每一帧的渲染表（复用同一个对象） */
  const renderC: Partial<Record<SlotKey, SlotRender[]>> = {};
  /** 伴随身体交接槽位的稳定落地代理（不画） */
  const groundC: Partial<Record<SlotKey, SlotRender[]>> = {};
  /** 伴随身体交接目标的稳定落地代理（与 groundC 的最低点连续插值） */
  const groundToC: Partial<Record<SlotKey, SlotRender[]>> = {};
  /** 这一帧每个桶里主身体占几份（描边外壳只画这几份） */
  const primaryCounts = new Map<string, number>();
  /** 这一帧伴随身体实例的颜色，下标 = 实例序号 − 主身体实例数 */
  const tints: Array<readonly [number, number, number]> = [];

  const object = new THREE.Group();
  object.name = 'creature';

  const meshes = new Map<string, MeshEntry>();          // bucketKey() → mesh
  const materials = new Map<string, THREE.Material>();  // materialIdFor() 的键 → material
  /**
   * 每块材质**调和之后、弧线之前**的那一份。
   *
   * 弧线每一帧都从这里重算，**不是在上一帧的结果上再乘一次** ——
   * 累乘的话弧线就不可逆了（倒着走回第 I 乐章不会回到第 I 乐章的样子），
   * 而 docs/40 §3 要求人一走就归零。
   */
  const bases = new Map<string, { role: MaterialRole; base: SurfaceSpec; toneL: number }>();
  const dirtyParts = new Set<string>();                 // 真几何到货 → 重建这些 mesh

  let shading: ShadingId = opt.shading ?? DEFAULT_SHADING;
  /** 弧线进度与它此刻的四个份量。`ARC_OFF` = 没有人调过 `setArc()`，这条线等于不存在 */
  let arc = 0;
  let weights: ArcWeights = ARC_OFF;

  let genome: Genome | null = null;
  const active = new Map<SlotKey, Swap>();
  const queued: Swap[] = [];

  const stats: CreatureStats = {
    instances: 0, triangles: 0, drawCalls: 0, swapsActive: 0, swapsQueued: 0, placeholders: 0, buckets: 0,
  };

  const tmp = new THREE.Matrix4();
  const counts = new Map<string, number>();
  /** 每个桶的代表实例 —— 桶键是拼出来的字符串，别再从字符串里把字段解析回来 */
  const specs = new Map<string, PartInstance>();
  const cursor = new Map<string, number>();
  const render: Partial<Record<SlotKey, SlotRender[]>> = {};
  /** 主身体交接槽位的稳定落地代理（不画） */
  const ground: Partial<Record<SlotKey, SlotRender[]>> = {};
  /** 主身体交接目标的稳定落地代理 */
  const groundTo: Partial<Record<SlotKey, SlotRender[]>> = {};
  /** 每个槽位自己的交接进度；主身体和伴随身体共用同一条事件时间线 */
  const groundProgress: Partial<Record<SlotKey, number>> = {};

  const unsubscribe = library.onGeometry((partId) => { dirtyParts.add(partId); });

  // ── 材质 ────────────────────────────────────────────────────────────────
  /**
   * 桶键里用的材质标识 = `<材质 id>@<物种主色 id>`。
   *
   * 为什么要把主色编进键里：材质现在不是"查一张全局表"，而是**被这个物种的主色调和过**
   * 的结果（`core/palette.ts`）。同一个 `matte.ash` 挂在瓷身上和挂在异形身上不是同一块材质，
   * 键不带主色就会拿错缓存 —— 换个物种，旧材质还挂在那儿。
   */
  function materialIdFor(role: MaterialRole, source: Genome | null = genome): string {
    const id = source?.materials?.[role] ?? 'proto.clay';
    return `${id}@${source?.materials?.primary ?? id}@${role}`;
  }

  function materialFor(materialKey: string): THREE.Material {
    let m = materials.get(materialKey);
    if (m) return m;
    const [materialId, toneId, role] = materialKey.split('@');
    const find = (id: string) => library.index.materials?.find((x) => x.id === id);
    const raw = find(materialId);
    const def: MaterialDef | undefined = raw && find(toneId)
      ? harmonize(raw, find(toneId)!, role as MaterialRole)
      : raw;
    const c = def?.baseColor ?? DEFAULT_COLOR;
    const base: SurfaceSpec = {
      baseColor: [c[0], c[1], c[2]],
      roughness: Number.isFinite(def?.roughness) ? def!.roughness : 0.7,
      metalness: Number.isFinite(def?.metalness) ? def!.metalness : 0.05,
      emissive: def?.emissive ? [def.emissive[0], def.emissive[1], def.emissive[2]] : [0, 0, 0],
    };
    const tone = find(toneId)?.baseColor ?? c;
    bases.set(materialKey, {
      role: role as MaterialRole,
      base,
      toneL: rgbToHsl([tone[0], tone[1], tone[2]]).l,
    });
    // 弧线已经在走的时候新建的材质（换装换来一个没见过的材质角色）必须**直接落在
    // 当前这一刻**，不能从弧线起点开始 —— 否则第 IV 乐章里换上来的那一件是新的、亮的
    const s = surfaceFor(role as MaterialRole, base, weights, rgbToHsl([tone[0], tone[1], tone[2]]).l);
    // 调和出来的那一份参数两条着色路径共用 —— 平涂换的是**怎么照亮**，不是换一套颜色。
    // 换了颜色的话「线」就不再是这个物种池里的成员了（`core/palette.ts` 的全部意义）。
    m = createFillMaterial(shading, {
      color: new THREE.Color().setRGB(s.baseColor[0], s.baseColor[1], s.baseColor[2], THREE.SRGBColorSpace),
      roughness: s.roughness,
      metalness: s.metalness,
      clearcoat: def?.clearcoat,
      /**
       * **自发光永远给一个值，哪怕是黑的。**
       *
       * 弧线的第 II 乐章要在运行时改它（`MATERIAL.growEmissive`）。three 的
       * `emissive` 是一个 uniform，改值不触发重编译 —— 但"这块材质有没有自发光"
       * 是在建材质那一刻定的。缺省 `undefined` 时 `createFillMaterial` 走的是另一条
       * 分支（`emissiveIntensity` 不被赋值），第一次给它上色就可能换一条管线，
       * 而管线重编译发生在帧循环里（P2/P5：帧循环里不许有会卡住的东西）。
       * 给一个黑色等于什么都没改，却把那条路从第一帧就打开了。
       */
      emissive: new THREE.Color().setRGB(s.emissive[0], s.emissive[1], s.emissive[2], THREE.SRGBColorSpace),
      name: materialKey,
    });
    materials.set(materialKey, m);
    return m;
  }

  /**
   * 把这一刻的弧线写进已经建好的每一块材质。
   *
   * **只写 uniform**：颜色 / 粗糙度 / 金属度 / 自发光在 three 里都是 uniform，
   * 改值不换管线。会换管线的那几个（`flatShading`、`clearcoat` 从 0 变非 0 —— 它们是
   * define）**一个都不碰**，理由写在 `docs/41 §5`：管线重编译发生在帧循环里，
   * 而帧循环里不许有会卡住的东西（P2/P5）。
   *
   * 平涂那条路只吃颜色和自发光：`MeshToonNodeMaterial` 上没有粗糙度和金属度，
   * 它的明暗是那张色阶贴图说了算的 —— 那正是「线」这个物种的身份，弧线不去动它。
   */
  function applyArcToMaterials(): void {
    let ink: readonly number[] | null = null;
    for (const [key, info] of bases) {
      const m = materials.get(key);
      if (!m) continue;
      const s = surfaceFor(info.role, info.base, weights, info.toneL);
      const mat = m as THREE.MeshPhysicalMaterial;
      mat.color?.setRGB(s.baseColor[0], s.baseColor[1], s.baseColor[2], THREE.SRGBColorSpace);
      mat.emissive?.setRGB(s.emissive[0], s.emissive[1], s.emissive[2], THREE.SRGBColorSpace);
      if (typeof mat.roughness === 'number') mat.roughness = s.roughness;
      if (typeof mat.metalness === 'number') mat.metalness = s.metalness;
      // 墨跟着**主色**走：它是这具身体的锚，也是唯一一路不转色相的那个角色。
      // 跟次要色走的话，同一条线在两个乐章之间会莫名其妙地换两次颜色
      if (info.role === 'primary') ink = s.baseColor;
    }
    setOutlineTint(
      ink ? [ink[0] * MATERIAL.otherInkValue, ink[1] * MATERIAL.otherInkValue, ink[2] * MATERIAL.otherInkValue] : null,
      MATERIAL.otherInk * weights.other,
    );
  }

  // ── InstancedMesh 池 ────────────────────────────────────────────────────
  function disposeEntry(key: string) {
    const e = meshes.get(key);
    if (!e) return;
    object.remove(e.mesh);
    if (e.outline) {
      // 先摘外壳再摘填充：两者共用 instanceMatrix，留一个孤儿在场上等于画一帧鬼影
      object.remove(e.outline);
      e.outline.dispose();
    }
    e.mesh.dispose();          // 只释放 instanceMatrix；geometry/material 是共享的，由库/本模块管
    meshes.delete(key);
    stats.buckets++;
  }

  function entryFor(
    key: string, partId: string, materialId: string, mirrored: boolean, need: number, slot: Slot,
  ): MeshEntry {
    let e = meshes.get(key);
    if (e && e.capacity < need) {
      disposeEntry(key);
      e = undefined;
    }
    if (!e) {
      const geo = mirrored ? library.mirrored(partId) : library.geometry(partId);
      const capacity = Math.max(4, 1 << Math.ceil(Math.log2(Math.max(1, need))));
      const mesh = new THREE.InstancedMesh(geo, materialFor(materialId), capacity);
      mesh.name = key;
      mesh.frustumCulled = false;        // 实例包围球跟着骨架跑，交给 three 算只会误剔
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      // 伴随身体的颜色（docs/50 §5.1）。**建桶时就挂上**，不是等第二个人进画才挂：
      // 半路挂上会换管线（NodeMaterial 按 `object.instanceColor` 选分支），而管线编译发生在帧循环里。
      // 白色 = 原色，主身体乘 1 一个像素都不变。单人（companions = 0）不挂，管线和这一版之前逐字相同
      if (companionsMax > 0) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
      }
      object.add(mesh);
      // 描边外壳：同一块几何、同一份实例矩阵，只换材质和面向。
      // `renderOrder = -1` 让它先画 —— 不是为了正确性（深度测试已经保证了遮挡关系），
      // 而是为了让填充的片元大多数被提前剔掉，省一点 overdraw。
      let outline: THREE.InstancedMesh | null = null;
      if (shading === 'toon') {
        // 墨按槽位定宽：手和脚收窄，其余九个槽位原样（`TOON.outlineSlotScale`）。
        // 一个部件 id 只属于一个槽位（`PartMeta.slot`），所以桶的代表实例说了算
        outline = new THREE.InstancedMesh(geo, createOutlineMaterial(outlineMetersFor(slot)), capacity);
        outline.name = `${key}~outline`;
        outline.instanceMatrix = mesh.instanceMatrix;
        outline.frustumCulled = false;
        // 外壳**不投影**：一个被撑胖了一圈的影子会比身体大一圈，穿帮得非常明显
        outline.castShadow = false;
        outline.receiveShadow = false;
        outline.renderOrder = -1;
        outline.count = 0;
        object.add(outline);
      }
      const idx = geo.getIndex();
      const pos = geo.getAttribute('position');
      stats.buckets++;
      e = {
        mesh, partId, materialId, capacity, idleFrames: 0, preparedUntilTier: null, colorDirty: false, outline,
        trisPerInstance: Math.floor((idx ? idx.count : pos ? pos.count : 0) / 3),
      };
      meshes.set(key, e);
    }
    return e;
  }

  // ── 换装队列（docs/05 §3） ──────────────────────────────────────────────
  /** 此刻同时在交接的件数上限（交叉淡入 + 替换）。着色语言会被切换，所以每次现算 */
  const ceiling = (): number => swapCeiling(passesOf(shading));

  function replacing(): boolean {
    for (const s of active.values()) if (s.kind === 'replace') return true;
    return false;
  }

  function pumpQueue() {
    // 没有替换在飞时给它空着一个名额；替换在飞时名额就是它自己占着的那一个
    const c = ceiling();
    const reserve = replacing() ? 0 : Math.min(c - 1, Math.max(0, Math.floor(opt.replaceSlots ?? 0)));
    while (active.size + reserve < c && queued.length) {
      const s = queued.shift()!;
      // 同一个槽位排了两次：后来的覆盖前面的，起点用当前正在播的那个
      const running = active.get(s.key);
      if (running) s.from = running.to;
      active.set(s.key, s);
    }
  }

  function enqueue(swap: Swap, front = false) {
    const i = queued.findIndex((q) => q.key === swap.key);
    if (i >= 0) queued.splice(i, 1);
    if (front) queued.unshift(swap); else queued.push(swap);
    pumpQueue();
  }

  // ── 接口 ────────────────────────────────────────────────────────────────
  const creature: Creature = {
    reset() {
      genome = null;
      active.clear();
      queued.length = 0;
      companions = [];
      arc = 0;
      weights = ARC_OFF;
      applyArcToMaterials();
      for (const e of meshes.values()) {
        e.mesh.count = 0;
        e.mesh.visible = false;
        if (e.outline) { e.outline.count = 0; e.outline.visible = false; }
      }
      stats.instances = 0;
      stats.triangles = 0;
      stats.drawCalls = 0;
      stats.swapsActive = 0;
      stats.swapsQueued = 0;
      stats.placeholders = 0;
    },

    remorph(g) {
      if (!g || !g.slots) return;
      const prev = genome;
      genome = g;

      // 第一次成型：不做动画，直接是它
      if (!prev) { active.clear(); queued.length = 0; return; }

      for (const key of ALL_SLOT_KEYS) {
        const a = prev.slots?.[key];
        const b = g.slots?.[key];
        if (!b) continue;
        if (a && a.partId === b.partId) continue;      // 没变的槽位不动（这是 remorph 的全部意义）
        enqueue({ key, from: a ?? null, to: b, t: 0 });
      }
      // 预取新部件；到货前该槽位先用占位几何顶着，不阻塞帧循环
      void library.preload(partIdsOf(g));
    },

    pose(sk, presence, dt) {
      if (!genome || !sk) return;
      const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), TIME.dtMax) : 1 / 60;

      // 0. 真几何到货 → 丢掉用占位几何建的 mesh，下面会用新几何重建
      if (dirtyParts.size) {
        for (const [key, e] of [...meshes]) if (dirtyParts.has(e.partId)) disposeEntry(key);
        dirtyParts.clear();
      }

      // 1. 推进换装动画（替换那一下的长度 `REPLACE_SECONDS` 就是 `MORPH.crossfade`）
      for (const [key, s] of [...active]) {
        s.t += step / Math.max(1e-3, s.kind === 'replace' ? REPLACE_SECONDS : MORPH.crossfade);
        if (s.t >= 1) active.delete(key);
      }
      pumpQueue();

      // 2. 在场缩放：ENTERING 长出来，LEAVING 缩回去（docs/05 §5）
      const pres = presenceScale(presence);

      // 3. 这一帧每个槽位画什么
      for (const key of ALL_SLOT_KEYS) {
        const pick = genome.slots?.[key];
        const s = active.get(key);
        if (s?.kind === 'replace') {
          render[key] = replaceRenders(key, s.from, s.to, s.t, pres);
        } else if (s) {
          // 旧件缩没、新件走 graft 的组装曲线；关节那一格是一道波（`replace-event.ts`）
          render[key] = crossfadeRenders(key, s.from, s.to, s.t, pres);
        } else if (pick) {
          render[key] = [{ partId: pick.partId, materialRole: pick.materialRole, scale: pres }];
        } else {
          render[key] = [];
        }
        // 交接的视觉实例会缩放、飞入、散开：它们不能决定整具身体的 lift。
        // 用交接前那件的满尺寸插座位置做代理；从空槽 graft 时才用目标件。
        const anchor = s?.from ?? s?.to;
        if (s && anchor) {
          ground[key] = [{ partId: anchor.partId, materialRole: anchor.materialRole, scale: pres }];
          groundTo[key] = [{ partId: s.to.partId, materialRole: s.to.materialRole, scale: pres }];
          // 主体基准和新件长回来共用同一条时间语义；调 graft 节奏时不得遗漏落地。
          groundProgress[key] = graftCurve(s.t).scale;
        } else {
          delete ground[key];
          delete groundTo[key];
          delete groundProgress[key];
        }
      }

      // 4. 装配（挂载数学全在 core/attach.ts 里）
      let instances: PartInstance[];
      try {
        instances = assemble(genome, sk, library, {
          render,
          ground: active.size ? ground : undefined,
          groundTo: active.size ? groundTo : undefined,
          groundProgress: active.size ? groundProgress : undefined,
          maxInstances,
        });
      } catch (e) {
        console.error('[creature] assemble 失败，保持上一帧', e);
        return;
      }

      // 4b. 伴随身体（docs/50 §5.1）：同一份 genome、同一张交接表，各自的骨架与在场缩放。
      // 实例**接在主身体后面** —— 每个桶里主身体那几份在前，描边外壳因此只要一个 count 就只画主身体。
      // 站位是整体平移：写在矩阵的平移列上，挂载数学一行不碰（落地只动 y，平移 x/z 不影响它）
      const primaryN = instances.length;
      tints.length = 0;
      for (const c of companionsMax > 0 ? companions : []) {
        const cp = presenceScale(c.presence) * Math.max(0, Math.min(1, Number.isFinite(c.scale) ? c.scale! : 1));
        if (cp <= 1e-3 || !c.skeleton) continue;
        for (const key of ALL_SLOT_KEYS) {
          const pick = genome.slots?.[key];
          const s = active.get(key);
          renderC[key] = s?.kind === 'replace' ? replaceRenders(key, s.from, s.to, s.t, cp)
            : s ? crossfadeRenders(key, s.from, s.to, s.t, cp)
              : pick ? [{ partId: pick.partId, materialRole: pick.materialRole, scale: cp }] : [];
          const anchor = s?.from ?? s?.to;
          if (s && anchor) {
            groundC[key] = [{ partId: anchor.partId, materialRole: anchor.materialRole, scale: cp }];
            groundToC[key] = [{ partId: s.to.partId, materialRole: s.to.materialRole, scale: cp }];
          } else {
            delete groundC[key];
            delete groundToC[key];
          }
        }
        let extra: PartInstance[];
        try {
          extra = assemble(genome, c.skeleton, library, {
            render: renderC,
            ground: active.size ? groundC : undefined,
            groundTo: active.size ? groundToC : undefined,
            groundProgress: active.size ? groundProgress : undefined,
            maxInstances,
          });
        } catch {
          continue;   // 一具伴随身体摆不出来不拖垮主身体（P2）
        }
        const dx = Number.isFinite(c.dx) ? c.dx : 0, dz = Number.isFinite(c.dz) ? c.dz : 0;
        for (const inst of extra) {
          inst.matrix[12] += dx;
          inst.matrix[14] += dz;
          instances.push(inst);
          tints.push(c.tint);
        }
      }
      const withCompanions = instances.length > primaryN;
      const outlineOn = !withCompanions || outlineWithCompanions;

      // 5. 分桶 → 写 InstancedMesh
      counts.clear();
      specs.clear();
      primaryCounts.clear();
      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        const key = bucketKey(inst.partId, inst.mirrored, materialIdFor(inst.materialRole));
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (i < primaryN) primaryCounts.set(key, (primaryCounts.get(key) ?? 0) + 1);
        if (!specs.has(key)) specs.set(key, inst);
      }

      let triangles = 0;
      let drawCalls = 0;
      let placeholders = 0;
      cursor.clear();
      for (const [key, n] of counts) {
        const spec = specs.get(key)!;
        // 有伴随身体的时候按"每具一份"预留容量：第二个人进画不重建桶
        const need = companionsMax > 0 ? Math.max(n, (primaryCounts.get(key) ?? 1) * (1 + companionsMax)) : n;
        const e = entryFor(key, spec.partId, materialIdFor(spec.materialRole), spec.mirrored, need, spec.slot);
        if (e.preparedUntilTier !== null && genome && genome.tier >= e.preparedUntilTier) {
          e.preparedUntilTier = null;
        }
        e.mesh.count = n;
        e.mesh.visible = true;
        e.idleFrames = 0;
        cursor.set(key, 0);
        triangles += n * e.trisPerInstance;
        drawCalls++;
        if (e.outline) {
          const shell = outlineOn ? (primaryCounts.get(key) ?? 0) : 0;
          e.outline.count = shell;
          e.outline.visible = shell > 0;
          // 外壳的面和 draw 都要报出来。少报的那一份不会因为没写下来就不提交（P21）；
          // 反过来，count 为 0 的外壳不提交，也就不报
          if (shell > 0) {
            triangles += shell * e.trisPerInstance;
            drawCalls++;
          }
        }
        if (!library.isLoaded(e.partId)) placeholders += n;
      }
      for (const [key, e] of [...meshes]) {
        if (counts.has(key)) continue;
        e.mesh.count = 0;
        e.mesh.visible = false;
        if (e.outline) { e.outline.count = 0; e.outline.visible = false; }
        // 保留一直持续到**这个桶真的被 pose 采用**。只看 `genome.tier` 不够：remorph
        // 先换 genome，再把十几个槽位分批交叉淡入；排在队尾的桶可能等超过普通 TTL。
        if (e.preparedUntilTier !== null) {
          e.idleFrames = 0;
          continue;
        }
        if (++e.idleFrames > IDLE_FRAMES_BEFORE_DISPOSE) disposeEntry(key);
      }

      for (let k = 0; k < instances.length; k++) {
        const inst = instances[k];
        const key = bucketKey(inst.partId, inst.mirrored, materialIdFor(inst.materialRole));
        const e = meshes.get(key);
        if (!e) continue;
        const i = cursor.get(key) ?? 0;
        if (i >= e.capacity) continue;
        tmp.fromArray(inst.matrix);
        e.mesh.setMatrixAt(i, tmp);
        const col = e.mesh.instanceColor;
        if (col) {
          const c = k < primaryN ? null : tints[k - primaryN];
          e.colorDirty = writeInstanceColor(col.array as Float32Array, i, c ?? null) || e.colorDirty;
        }
        cursor.set(key, i + 1);
      }
      for (const [key, e] of meshes) {
        if (!counts.has(key)) continue;
        e.mesh.instanceMatrix.needsUpdate = true;
        if (e.mesh.instanceColor && e.colorDirty) {
          e.mesh.instanceColor.needsUpdate = true;
          e.colorDirty = false;
        }
      }

      stats.instances = instances.length;
      stats.triangles = triangles;
      stats.drawCalls = drawCalls;
      stats.swapsActive = active.size;
      stats.swapsQueued = queued.length;
      stats.placeholders = placeholders;
    },

    graft(slot, meta, geometry) {
      if (!genome || !meta?.id) return;
      library.register(meta, geometry);
      const prev = genome.slots?.[slot] ?? null;
      const pick: SlotPick = { partId: meta.id, materialRole: prev?.materialRole ?? 'accent' };
      genome.slots[slot] = pick;
      // 慢回路的产物是一个叙事时刻，插队到最前面
      enqueue({ key: slot, from: prev, to: pick, t: 0 }, true);
    },

    replace(slot, pick) {
      if (!genome?.slots || !pick?.partId) return;
      const running = active.get(slot);
      // 这一格正在交接：从**正在装上的那一件**碎起，不是从更早那一件
      const from = running ? running.to : genome.slots[slot] ?? null;
      if (from?.partId === pick.partId) return;
      genome = { ...genome, slots: { ...genome.slots, [slot]: pick } };
      const i = queued.findIndex((q) => q.key === slot);
      if (i >= 0) queued.splice(i, 1);
      // 不走 `enqueue`：队列满（升档那一批正在交叉淡入）时它会等，而替换音不等。
      // 它的名额是 `replaceSlots` 事先空出来的，所以正常情况下这里不会满。
      // 满了只可能是帧卡顿：排期器按弧线秒数发件，这里的动画吃的是被 `TIME.dtMax` 钳过的 dt，
      // 上一件替换就还差一点没演完。那就让**最快演完的那一件**当帧收尾（先挑替换、再挑交叉淡入）——
      // genome 里早就是它的新件，收尾只是少画最后几帧，而不是越过预算叠上去。
      if (!running) {
        while (active.size >= ceiling()) {
          let victim: SlotKey | null = null;
          let best = -Infinity;
          for (const [k, s] of active) {
            const score = (s.kind === 'replace' ? 2 : 0) + s.t;
            if (score > best) { best = score; victim = k; }
          }
          if (victim === null) break;
          active.delete(victim);
        }
      }
      active.set(slot, { key: slot, from, to: pick, t: 0, kind: 'replace' });
      void library.preload([pick.partId]);
    },

    setShading(id) {
      if (id === shading) return;
      shading = id;
      // 材质缓存的键里**没有**着色语言 —— 与其把它编进键（缓存里从此常驻两套材质，
      // 而观众一场只会看见一套），不如整体重建：这条路一场演出最多被走几次。
      for (const key of [...meshes.keys()]) disposeEntry(key);
      for (const m of materials.values()) m.dispose();
      materials.clear();
      bases.clear();
      // 描边材质缓存在 `shading.ts` 里按线宽共享，这里不单独持有 —— 换回 physical
      // 只是不再建外壳 mesh，材质留着（一场演出里 O 键会被按来按去）
    },
    get shading() { return shading; },

    setArc(progress) {
      const a = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
      // 现场每帧会调一次，而弧线三分钟才走完 —— 一帧的增量小于这个数就不重写 uniform。
      // 1e-4 × 180s = 18ms，比一帧还短，**不会让线变成阶梯**
      if (Math.abs(a - arc) < 1e-4 && weights !== ARC_OFF) return;
      arc = a;
      weights = arcWeights(arc);
      applyArcToMaterials();
    },
    get arc() { return arc; },

    setCompanions(list) {
      companions = companionsMax > 0 && Array.isArray(list) ? list.slice(0, companionsMax) : [];
    },
    setOutlineWithCompanions(on) { outlineWithCompanions = !!on; },

    prepareBuckets(g, sk) {
      let instances: PartInstance[];
      try {
        instances = assemble(g, sk, library, { maxInstances });
      } catch {
        return { next: () => false, park: () => undefined, done: true };
      }
      const planned = new Map<string, { count: number; spec: PartInstance; materialId: string }>();
      for (const inst of instances) {
        const materialId = materialIdFor(inst.materialRole, g);
        const key = bucketKey(inst.partId, inst.mirrored, materialId);
        const row = planned.get(key);
        if (row) row.count++;
        else planned.set(key, { count: 1, spec: inst, materialId });
      }
      const primed: MeshEntry[] = [];
      for (const [key, row] of planned) {
        const need = row.count * (1 + companionsMax);
        const e = entryFor(key, row.spec.partId, row.materialId, row.spec.mirrored, need, row.spec.slot);
        // 相邻档位经常沿用同一个部件；同一个 live Mesh 真渲染一次就够，后面的计划
        // 只把保留期限延长，不再白占一帧重复提交。
        const alreadyPrepared = e.preparedUntilTier !== null;
        e.preparedUntilTier = e.preparedUntilTier === null
          ? g.tier
          : Math.max(e.preparedUntilTier, g.tier) as Tier;
        // 调用方只在资源队列清空后准备。这里已经用当前几何重建好这一桶，之前同 part 的
        // “到货待重建”信号因此已经兑现；不删会在正式 pose 的第一行把刚暖好的同一 Mesh 丢掉。
        dirtyParts.delete(row.spec.partId);
        e.mesh.count = 0;
        e.mesh.visible = false;
        if (e.outline) { e.outline.count = 0; e.outline.visible = false; }
        if (!alreadyPrepared) primed.push(e);
      }
      let cursor = 0;
      let active: MeshEntry | null = null;
      const park = () => {
        if (active) {
          const e = active;
          e.mesh.count = 0;
          e.mesh.visible = false;
          if (e.outline) { e.outline.count = 0; e.outline.visible = false; }
          active = null;
        }
      };
      return {
        next() {
          park();
          const e = primed[cursor++];
          if (!e) return false;
          tmp.identity();
          e.mesh.setMatrixAt(0, tmp);
          e.mesh.instanceMatrix.needsUpdate = true;
          e.mesh.count = 1;
          e.mesh.visible = true;
          if (e.outline) { e.outline.count = 1; e.outline.visible = true; }
          active = e;
          return true;
        },
        park,
        get done() { return cursor >= primed.length && active === null; },
      };
    },

    clearPreparedBuckets() {
      for (const e of meshes.values()) e.preparedUntilTier = null;
    },

    get object() { return object; },
    get genome() { return genome; },
    get stats() { return stats; },

    dispose() {
      unsubscribe();
      for (const key of [...meshes.keys()]) disposeEntry(key);
      for (const m of materials.values()) m.dispose();
      materials.clear();
      bases.clear();
      disposeShading();
      object.clear();
    },
  };

  return creature;
}
