/**
 * Mass —— B 档身体方案「团块」（docs/18-BODY-PLANS.md §2 B 档）。
 *
 * 它不是"在刚体身体外面再套一层"，它是**替换**：`bodyPlan:'mass'` 的条目
 * 一个槽位件都不实例化。整具身体是**一个** MarchingCubes 网格、**一个** draw call。
 * 总账因此变轻，不是变重。
 *
 * 表达上要拿回来的是原作《Future You》那层：形体是**流过身体的物质**，
 * 不是"一根骨头挂一个手办件"。所以这里没有部件、没有接缝、没有槽位 ——
 * 只有沿骨线撒出去的一串 metaball，被 SDF 融成一个连续的团块。
 *
 * 技术路线（**不是 GPU 版、不是 raymarch**）：three 官方 CPU addon
 * `three/addons/objects/MarchingCubes.js`。选它的理由是**分辨率是一个可降的旋钮** ——
 * 帧率掉了就降 res，画面从"光滑的肉"退化成"粗糙的团"，但永不掉帧（docs/02 P3）。
 *
 * 它**不改 `Skeleton`、不碰冻结契约**：
 *  - 球的半径从 `SLOT_OF_BONE` + `SLOT_WIDTH`（tuning.ts 里已有的身体比例表）推；
 *  - 球的密度从 `bone.length` 推；
 *  - 球的权重从 `bone.confidence` 推（追踪不确定的骨头自己淡出，而不是抽搐）。
 *
 * ⚠️ 已知的契约缺口：下面 `MASS` 里的那些数（res 默认值、球间距、半径系数、isolation）
 * 按 `tuning.ts` 的规矩本该住在 `tuning.ts`。`tuning.ts` 是冻结契约，我没有自行修改，
 * 所以它们暂时是本模块常量 + `MassOptions` 覆盖。见收尾报告「需要变更契约」。
 *
 * 四个必须知道的实现细节：
 *  1. **不要每帧重建对象。** 每帧的开销就是 `reset()` + N 次 `addBall()` + `update()`，
 *     三者都在同一个常驻的 MarchingCubes 上就地做。
 *  2. MarchingCubes 默认整块上传 position/normal 缓冲区（按 `maxPolyCount` 开的，几 MB），
 *     它没设 updateRange。WebGPU 后端是尊重 `addUpdateRange` 的
 *     （`WebGPUAttributeUtils.js:223`），所以这里每帧补上实际用到的那一段。
 *  3. **MarchingCubes 这个 Mesh 本身绝不能进场景图**（下面 `blob` 那一段）。
 *     `Mesh.count` 是 three 自己的**实例数**字段（默认 1），而 MarchingCubes 这个
 *     addon 把它当成"这一帧的顶点数"来写。WebGPU 后端照字段名取实例数
 *     （`RenderObject.js:623`），于是团块被实例化几千份：2k 面的身体一帧提交 1200 万面。
 *     这就是团块方案从落地那天起从没跑到过帧率的原因。
 *  4. **落地是这里自己的事**（`pose()` 第 6 步）。团块不走 `assemble()`，
 *     所以 `core/ground.ts` 那条网格落地的路**管不到它** —— 修之前整具身体一直
 *     沉在地板下面约半个球半径（站姿实测 -0.062m）。这里量的是三角化之后
 *     geometry 里真的要画的顶点，不是球心加半径。
 */
import * as THREE from 'three/webgpu';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { MAX_LIFT } from '../../../core/src/ground.ts';
import { SLOT_OF_BONE } from '../../../core/src/slots.ts';
import { SKELETON, SLOT_WIDTH } from '../../../core/src/tuning.ts';
import type { MaterialDef, Presence, Skeleton, Vec3 } from '../../../core/src/types.ts';
import type { PartLibrary } from '../assets/library.ts';
import type { BodyInstance, BodyStats } from './body.ts';
// 旋钮住在 tuning.ts（P0），不在本文件。改之前先开 /dev/mass.html
import { MASS } from '../../../core/src/tuning.ts';



// ─────────────────────────── 接口 ───────────────────────────

export interface MassStats extends BodyStats {
  /** 当前体素分辨率 */
  resolution: number;
  /**
   * 这一帧为了让等值面贴地，整团被沿 +Y 抬了多少米（见 `pose()` 第 6 步）。
   * 报出来是为了它**可被读到**：团块沉在地里的时候画面上看不出来，
   * 而这个数会一直是 0。
   */
  lift: number;
  /** 这一帧真正喂给场的球数 */
  balls: number;
  /** reset + addBall + update 的 CPU 开销（毫秒，EMA） */
  cpuMs: number;
}

export interface MassBody extends BodyInstance {
  /**
   * 喂运动能量（0..~3，来自 `MotionFeatures.energy`），驱动表面的"沸腾"层。
   * 不调也能跑：energy 停在 0，只剩呼吸与流动 —— 静止的身体仍然不死。
   */
  setEnergy(v: number): void;
  /** 清掉上一位观众的表面时钟、能量与落地基准，保留 MarchingCubes 缓冲 */
  reset(): void;
  readonly stats: MassStats;
  /** 当前分辨率 */
  readonly res: number;
  /** 降级/升级旋钮。会重开场缓冲区，别在每帧里调 */
  setRes(res: number): void;
  /** 换条目：重新取 palette 的 primary 材质 */
  setTheme(themeId: string): void;
}

export interface MassOptions {
  /** 取 palette / MaterialDef 用。缺省时用内置的中性色 */
  library?: PartLibrary;
  /** 条目 id。它的 `palette[0]`（primary）决定团块的颜色 */
  theme?: string;
  /** 初始分辨率，默认 MASS.res */
  res?: number;
  /**
   * 球半径系数，默认 `MASS.radiusScale`。开场形态（tier 0）用它把相邻骨头的场
   * 彻底融在一起 —— 见 `NASCENT.radiusScale`。这里只是把那一个数开成参数，
   * 别的什么都没改。
   */
  radiusScale?: number;
  /**
   * 覆盖 `MASS.slotScale` 里的若干槽位（其余仍取 MASS 的值）。
   * 开场形态拿它把躯干收窄、把头放大 —— 整个身体越融，头越需要主动探出来，
   * 否则"它在看哪"这条线索会被躯干吞掉（`docs/26 §F`：头是唯一的朝向线索）。
   */
  slotScale?: Partial<Record<string, number>>;
}

// ─────────────────────────── 实现 ───────────────────────────

const DEFAULT_COLOR: Vec3 = [0.78, 0.77, 0.75];
const TAU = Math.PI * 2;

/**
 * `geometry.getAttribute()` 的类型是 `BufferAttribute | InterleavedBufferAttribute`，
 * 只有前者有 updateRange。MarchingCubes 用的是前者。
 */
interface UpdatableAttribute {
  itemSize: number;
  needsUpdate: boolean;
  clearUpdateRanges(): void;
  addUpdateRange(start: number, count: number): void;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const smoothstep = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

export function createMassBody(opt: MassOptions = {}): MassBody {
  const library = opt.library;

  const object = new THREE.Group();
  object.name = 'mass';

  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(),
    roughness: 0.55,
    metalness: 0.05,
  });
  material.name = 'mass';

  let res = clamp(Math.round(opt.res ?? MASS.res), MASS.resMin, MASS.resMax);
  const radiusScale = Number.isFinite(opt.radiusScale) ? opt.radiusScale! : MASS.radiusScale;
  const slotScale: Partial<Record<string, number>> = { ...MASS.slotScale, ...(opt.slotScale ?? {}) };

  // 常驻对象：每帧只 reset + addBall + update，绝不重建（见文件头 §1）。
  // MarchingCubes 来自 `three` 主构建，我们的场景是 `three/webgpu`——
  // 两份构建里的 Object3D 是不同的类，但运行时全靠 `isMesh` 之类的鸭子类型，
  // 所以这里只需要在类型上过一道桥，运行时没有转换。
  //
  // ⚠️ `mc` 在这里只当**几何发生器**用，**不进场景图**（见文件头 §3）。**根因就在这一段。**
  // `Mesh.count` 在 three 里是实例数（`Mesh.js:104`，默认 1），而 MarchingCubes 这个
  // addon 把同一个字段当成"这一帧写了多少顶点"在用。`three/webgpu` 取实例数时是：
  //     else if (object.count !== undefined) instanceCount = Math.max(0, object.count);
  // （`RenderObject.js:623`）—— 它只看字段，不问这个 Mesh 是不是 InstancedMesh。
  // 于是整块团块被画了 `count`（res=36 时 ≈6000）遍：1 个 draw call、2k 面的身体，
  // 一帧真正提交 1200 万面，~100ms。JS 侧只有 1~2ms，所以 HUD 的毫秒数一直是好看的。
  // （WebGLRenderer 走 `object.isInstancedMesh` 分支，同一个 addon 在 WebGL 上没事 ——
  //  这是 WebGPU 后端独有的字段名冲突，不是 addon 在所有后端都坏。）
  const mc = new MarchingCubes(res, material as unknown as THREE.Material, false, false, MASS.maxPolyCount);

  // 真正进场景图的是这个干净的 Mesh：**共用 mc 的 geometry**（mc.update() 写的就是它，
  // 连 setDrawRange 也是），但身上没有 `count` 这个属性，所以实例数老老实实是 1。
  // 世界变换（位置/缩放）也挂在它身上；mc 自己的 transform 不参与渲染。
  const blob = new THREE.Mesh(mc.geometry as unknown as THREE.BufferGeometry, material);
  blob.name = 'mass';
  blob.frustumCulled = false;        // 包围球跟着骨架跑，交给 three 算只会误剔
  blob.castShadow = true;
  blob.receiveShadow = true;
  object.add(blob);

  const stats: MassStats = { triangles: 0, drawCalls: 0, resolution: res, balls: 0, cpuMs: 0, lift: 0 };

  /**
   * 上一帧算出来的落地抬升（米）。进出场那几帧**冻结**它，不重算 —— 理由在 `pose()` 第 6 步。
   * 它是状态，所以住在闭包里而不是每帧从 stats 读回来（stats 是给外面看的，不是账本）。
   */
  let lift = 0;

  // ── 表面语言的状态（tuning.ts 的 MASS.surface）──────────────────────────
  /** 会话时钟。用累计 dt 而不是 performance.now()：P1 —— 模块里不读时钟 */
  let clock = 0;
  /** 平滑后的运动能量，由 setEnergy() 喂入 */
  let energy = 0;

  /**
   * 每根骨头一个固定相位，让三条波不要在整具身体上同相 ——
   * 同相会读成"整个人在一起脉动"，那是心跳不是物质。
   * 用 id 的字符哈希，确定性（P1），且换个部件库也不会变。
   */
  function bonePhase(id: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return (h % 1000) / 1000 * Math.PI * 2;
  }
  const phaseCache = new Map<string, number>();
  const phaseOf = (id: string): number => {
    let p = phaseCache.get(id);
    if (p === undefined) { p = bonePhase(id); phaseCache.set(id, p); }
    return p;
  };

  /** 场盒中心（世界，米）。第一帧直接吸附，之后 EMA 跟随 */
  const center: Vec3 = [0, 0.95, 0];
  let seeded = false;

  function applyTheme(themeId: string | undefined) {
    let def: MaterialDef | undefined;
    if (library && themeId) {
      const theme = library.index.themes?.find((t) => t.id === themeId);
      const primary = theme?.palette?.[0];
      if (primary) def = library.index.materials?.find((m) => m.id === primary);
    }
    const c = def?.baseColor ?? DEFAULT_COLOR;
    material.color.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
    material.roughness = Number.isFinite(def?.roughness) ? def!.roughness : 0.55;
    material.metalness = Number.isFinite(def?.metalness) ? def!.metalness : 0.05;
    material.clearcoat = def?.clearcoat ?? 0;
    if (def?.emissive) {
      material.emissive.setRGB(def.emissive[0], def.emissive[1], def.emissive[2], THREE.SRGBColorSpace);
      material.emissiveIntensity = 1;
    } else {
      material.emissive.setRGB(0, 0, 0);
    }
    material.needsUpdate = true;
  }
  applyTheme(opt.theme);

  function setRes(next: number) {
    const r = clamp(Math.round(next), MASS.resMin, MASS.resMax);
    if (r === res) return;
    res = r;
    mc.init(res);                  // 重开 field / normal_cache / position / normal 缓冲区
    mc.isolation = MASS.isolation; // init() 会把 isolation 重置回 80，这里重新贴上
    // init() 是在**同一个** BufferGeometry 上换 attribute，不是换 geometry 对象，
    // 所以共用它的 blob 不需要重新挂 —— 这一行注释是为了让人别去"修"它。
    stats.resolution = res;
  }
  mc.isolation = MASS.isolation;

  const body: MassBody = {
    get object() { return object; },

    reset() {
      clock = 0;
      energy = 0;
      lift = 0;
      seeded = false;
      center[0] = 0; center[1] = 0.95; center[2] = 0;
      mc.reset();
      blob.visible = false;
      stats.triangles = 0;
      stats.drawCalls = 0;
      stats.balls = 0;
      stats.cpuMs = 0;
      stats.lift = 0;
    },

    setEnergy(v) {
      const target = Number.isFinite(v) ? clamp(v, 0, 3) : 0;
      // 平滑一次：energy 本身已经是 EMA，但换玩法/换人时会跳，
      // 跳变会让表面"啪"地一下 —— 物质不该有开关感
      const a = 1 - Math.exp(-(1 / 60) / Math.max(1e-3, MASS.surface.energyTau));
      energy += (target - energy) * a;
    },
    get stats() { return stats; },
    get res() { return res; },
    setRes,
    setTheme(themeId: string) { applyTheme(themeId); },

    pose(sk: Skeleton, presence: Presence, dt: number) {
      if (!sk || !sk.bones?.length) return;
      const t0 = performance.now();
      const step = Number.isFinite(dt) && dt > 0 ? clamp(dt, 0, 1 / 15) : 1 / 60;
      clock += step;

      // 1. 在场：ENTERING 长出来、LEAVING 缩回去（docs/05 §5）。
      //    团块没有"槽位"可以逐个装配，所以进出场表达成**物质向质心收回去**：
      //    球半径 × pres，球位置向质心收 (1-pres)。整团化开而不是整具消失。
      const pres = presence?.state === 'ENTERING' ? smoothstep(presence.transition)
        : presence?.state === 'LEAVING' ? 1 - smoothstep(presence.transition)
        : presence?.state === 'IDLE' ? 0
        : 1;
      if (pres <= 0.001) {
        blob.visible = false;
        stats.triangles = 0; stats.drawCalls = 0; stats.balls = 0;
        return;
      }
      blob.visible = true;

      // 2. 场盒：边长由身高定（恒定 → 体素大小恒定 → 团块不会随身体位移忽胖忽瘦），
      //    中心 EMA 跟随骨架质心。
      const height = Number.isFinite(sk.height) && sk.height > 0.2 ? sk.height : SKELETON.referenceHeight;
      const bodyScale = height / SKELETON.referenceHeight;
      const half = height * MASS.boxHalfOfHeight;

      let cx = 0, cy = 0, cz = 0, n = 0;
      for (const b of sk.bones) {
        cx += (b.p0[0] + b.p1[0]) * 0.5; cy += (b.p0[1] + b.p1[1]) * 0.5; cz += (b.p0[2] + b.p1[2]) * 0.5;
        n++;
      }
      if (!n || !Number.isFinite(cx + cy + cz)) return;
      cx /= n; cy /= n; cz /= n;
      if (!seeded) { center[0] = cx; center[1] = cy; center[2] = cz; seeded = true; }
      else {
        const step = Number.isFinite(dt) ? clamp(dt, 0, 1 / 15) : 1 / 60;
        const a = 1 - Math.exp(-step / Math.max(1e-3, MASS.centerTau));
        center[0] += (cx - center[0]) * a;
        center[1] += (cy - center[1]) * a;
        center[2] += (cz - center[2]) * a;
      }

      // Y 先按 center 摆着；这一帧的落地抬升要等等值面真的生成出来才量得到（第 6 步）
      blob.position.set(center[0], center[1] + lift, center[2]);
      blob.scale.setScalar(half);          // 局部空间是 [-1,1]³ → 世界边长 2·half

      // 3. 撒球。addBall 的坐标是 0..1 的场空间；强度由想要的世界半径反解：
      //    单个球的等值面在 strength/d² - subtract = isolation → d = sqrt(strength/(iso+sub))，
      //    其中 d 是 0..1 场空间里的距离，即世界半径 / (2·half)。
      mc.reset();
      const voxel = (2 * half) / res;
      const minRadius = MASS.minRadiusVoxels * voxel;
      const k = MASS.isolation + MASS.subtract;
      const inv = 1 / (2 * half);
      const shrink = 0.35 + 0.65 * pres;   // 进出场：物质向质心收回去

      let balls = 0;
      for (const b of sk.bones) {
        if (balls >= MASS.maxBalls) break;
        const conf = Number.isFinite(b.confidence) ? clamp(b.confidence, 0, 1) : 1;
        if (conf <= 0.02) continue;        // 追踪丢了的骨头自己淡出，不抽搐
        const slot = SLOT_OF_BONE[b.id];
        if (!slot) continue;

        const girth = (SLOT_WIDTH[slot] ?? 0.12) * 0.5 * bodyScale
          * radiusScale * (slotScale[slot] ?? 1);
        const baseRadius = Math.max(girth, minRadius) * (0.55 + 0.45 * conf) * shrink;
        const phase = phaseOf(b.id);

        const len = Number.isFinite(b.length) && b.length > 0
          ? b.length
          : Math.hypot(b.p1[0] - b.p0[0], b.p1[1] - b.p0[1], b.p1[2] - b.p0[2]);
        const count = clamp(Math.ceil(len / (MASS.ballSpacing * bodyScale)), 1, MASS.maxBallsPerBone);

        for (let i = 0; i < count; i++) {
          if (balls >= MASS.maxBalls) break;
          const u = (i + 0.5) / count;
          // 世界位置 → 向质心收缩 → 归一化到场空间 0..1
          const wx = center[0] + ((b.p0[0] + (b.p1[0] - b.p0[0]) * u) - center[0]) * shrink;
          const wy = center[1] + ((b.p0[1] + (b.p1[1] - b.p0[1]) * u) - center[1]) * shrink;
          const wz = center[2] + ((b.p0[2] + (b.p1[2] - b.p0[2]) * u) - center[2]) * shrink;
          const fx = (wx - center[0]) * inv + 0.5;
          const fy = (wy - center[1]) * inv + 0.5;
          const fz = (wz - center[2]) * inv + 0.5;
          if (!(fx > 0 && fx < 1 && fy > 0 && fy < 1 && fz > 0 && fz < 1)) continue;  // 出盒的段落直接不喂

          // ── 表面语言：三层叠加，各管一件事（docs/18 / tuning 的 MASS.surface）──
          //  breathe 全局慢呼吸 —— 静止时身体不死
          //  flow    沿骨链的行波 —— 物质在**流过**肢体，这是"流过身体的物质"的落点
          //  boil    能量驱动的高频起伏 —— 动得越猛表面越沸
          const S = MASS.surface;
          const mul = clamp(
            1
            + S.breatheAmp * Math.sin(TAU * S.breatheHz * clock + phase)
            + S.flowAmp * Math.sin(TAU * S.flowHz * clock - TAU * S.flowWaves * u + phase)
            + S.boilAmp * energy * Math.sin(TAU * S.boilHz * clock + phase * 3.1 + i * 1.7),
            S.mulMin, S.mulMax,
          );
          const rNorm = baseRadius * mul * inv;
          const strength = k * rNorm * rNorm;
          if (!(strength > 0)) continue;

          mc.addBall(fx, fy, fz, strength, MASS.subtract);
          balls++;
        }
      }

      // 4. 三角化
      mc.update();

      // 5. 只上传这一帧真正写过的那一段（见文件头 §2）。
      //    渲染器上传完会自己 clearUpdateRanges；这里先清一次是防止某帧没被渲染时范围累积。
      const geo = mc.geometry;
      for (const name of ['position', 'normal'] as const) {
        // MarchingCubes 这两条一定是独立的 BufferAttribute（它自己 new 出来的），
        // 不是 InterleavedBufferAttribute —— 后者没有 updateRange，所以显式收窄。
        const attr = geo.getAttribute(name) as UpdatableAttribute | undefined;
        if (!attr || typeof attr.addUpdateRange !== 'function') continue;
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, mc.count * attr.itemSize);
        attr.needsUpdate = true;
      }

      // 6. 落地：量**这一帧真的三角化出来的那个等值面**，把整团抬到地面上。
      //
      //    为什么这一步非有不可：团块身体（coral / char.dumpling / char.ghost，以及
      //    每个人的 tier 0 开场形态）**不走 `assemble()`**，而 `assemble()` 才是网格落地
      //    （`core/ground.ts`）那条路。骨架那一层只保证最低的**脚关节**在 y=0，而球是绕
      //    骨线撒的、还会互相融胖一圈 —— 于是脚那一段的表面一直在地板下面
      //    （参考站姿实测 -0.062m，蹲姿 -0.047m）。
      //
      //    为什么量顶点而不是"球心 - 半径"：融合让表面胖出球半径之外，胖多少取决于
      //    相邻球间距和 isolation，不是一个能写下来的数 —— 那是估计，不是测量（P21）。
      //    `mc.update()` 之后 geometry 里躺着的就是这一帧要画的顶点，量它才是量成品。
      //
      //    ⚠️ 这里读的是 `mc.count`（**顶点数**，addon 的用法），不是实例数 ——
      //    这个字段名冲突就是文件头 §3 那个坑。它在这一行是安全的，因为 mc 不进场景图。
      //
      //    为什么进出场要冻结：`shrink` 把物质向质心收回去，等值面的最低点自然升高。
      //    那时再重算抬升，团块会**一边化开一边往地上掉** —— 那不是"物质收回去"，
      //    那是"东西掉下来了"。所以只在满在场时量，其余时候沿用上一次的值。
      if (pres >= 0.999) {
        let loLocal = Infinity;
        const pos = geo.getAttribute('position');
        const n = Math.min(mc.count, pos.count);
        for (let i = 0; i < n; i++) {
          const y = pos.getY(i);
          if (y < loLocal) loLocal = y;               // NaN 比不过任何数，自然被跳过（P2）
        }
        if (Number.isFinite(loLocal)) {
          // 摆放是 blob.position.y = center[1] + lift，局部 [-1,1]³ 乘 half，
          // 所以世界最低点 = center[1] + lift + loLocal·half。要它落在 y=0 上
          // ⇒ lift = -(center[1] + loLocal·half)。
          // 钳位复用 `core/ground.ts` 的 MAX_LIFT：数据坏掉时宁可让身体还沉着，
          // 也不要把它弹出画面（那条安全阀的理由写在 ground.ts 上，这里不重写第二份）。
          lift = clamp(-(center[1] + loLocal * half), -MAX_LIFT, MAX_LIFT);
          blob.position.y = center[1] + lift;
        }
      }
      stats.lift = lift;

      stats.balls = balls;
      stats.triangles = Math.floor(mc.count / 3);
      stats.drawCalls = stats.triangles > 0 ? 1 : 0;
      stats.resolution = res;
      stats.cpuMs = stats.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
    },

    dispose() {
      object.remove(blob);
      mc.geometry.dispose();
      material.dispose();
      object.clear();
    },
  };

  return body;
}
