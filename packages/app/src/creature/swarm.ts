/**
 * Swarm —— B 档身体方案「点场」（`docs/18 §2` B 档那张表里 `swarm` 那一行）。
 *
 * ── 它修的是什么 ────────────────────────────────────────────────────────────
 * 物种 `field`／「场」在 `assets/parts/parts.json` 里自己写着：
 *   tagline「身体消失，只剩运动」、`source: "procedural"`、**自己一件部件都没有**。
 * 但它**没有 `bodyPlan`**，于是 `main.ts` 算出 `planKind = 'rig'`，它走刚体装配、
 * 沿 `base` 链向别的物种借满一套四肢 —— 画面上是一具用别人零件拼出来的普通机器人。
 * **这个物种在屏幕上说的话，和它自己写的话正好相反。**
 *
 * 现在它是：一片跟着活骨架走的点，没有躯干、没有四肢、没有一件部件。
 *
 * ── 三个属于这一层的判断（`core/swarm.ts` 的文件头写了前两个的理由）─────────
 *
 * 1. **点怎么挂在骨架上**：锁在骨头上（按骨长加权撒点、固定抖动），但**每个点
 *    落后的时间不同**，分布是 `rand^SWARM.lagCurve`。静止时所有点叠回同一个姿势
 *    （形短暂出现），一动起来沿轨迹拉开（形被运动吃掉）。这是"只剩运动"和
 *    "用点画的人"之间的那条线。延迟**不**再沿骨链排一次 —— `vitality.ts` 已经在
 *    骨架那一层做过 root→tip 的跟随，这里再来一遍就是把同一件事做两遍。
 *
 * 2. **进出场**：和 `mass.ts` / `creature.ts` 同一套 `pres`（ENTERING smoothstep、
 *    LEAVING 反过来、IDLE 直接不画）。但表达不一样：团块是"物质向质心收回去"，
 *    这里直接复用 `BreathField` 本来就有的 `gather` —— **`gather = pres`**。
 *    于是进场就是"空场的地面雾聚拢成这个人"，离场就是"散回地面"。
 *    这不是省事：空场的呼吸粒子团和这具身体**本来就是同一种材料**，
 *    让它们用同一个动作过渡，比另发明一个缩放动画更说得通。
 *
 * 3. **落地**：点云的"贴地"= **看得见的最低那一个点**落在 y=0。
 *    骨架那一层只保证最低的**关节**在 y=0，而点撒在骨头周围 —— 踝在 y=0，
 *    脚那一段的点就有一半在地板下面。这个 bug 在这个仓库里已经出现过两次
 *    （`core/ground.ts` 的网格落地、`mass.ts` 第 6 步的等值面落地），这是第三次。
 *    量的是 `core/swarm.ts` 的 `lowestSwarmY`：**逐点量**，不是"骨头最低点 - 抖动半径"
 *    （后者是包络，按包络落地会让整片点浮在空中一层抖动半径）。
 *    抬升按 `SWARM.liftTau` 平滑，否则追踪噪声会让整片点上下抖 ——
 *    那读作"地面在动"，不是"身体站着"。
 *
 * ── 成本 ────────────────────────────────────────────────────────────────────
 * 一个 draw call、`2 × SWARM.count` 个三角（1400 点 = 2800 三角）。
 * 帧循环里的 CPU：34 次 `Vector3.set`（还只在环推进的那一帧做）+ 逐点量一次最低点
 * + 几个标量赋值。**不 new、不写大数组**（P5）。
 */
import * as THREE from 'three/webgpu';
import { MAX_LIFT } from '../../../core/src/ground.ts';
import { ALL_BONE_IDS } from '../../../core/src/slots.ts';
import { lowestSwarmY } from '../../../core/src/swarm.ts';
import { SKELETON, SWARM } from '../../../core/src/tuning.ts';
import type { Bone, MaterialDef, Presence, Skeleton } from '../../../core/src/types.ts';
import type { PartLibrary } from '../assets/library.ts';
import { createBreathField, type SwarmField } from '../stage/particles.ts';
import { REFERENCE_POSE } from '../stage/framing.ts';
import type { BodyInstance, BodyStats } from './body.ts';

export interface SwarmStats extends BodyStats {
  /** 这一帧整片点被沿 +Y 抬了多少米。报出来是为了它**可被读到** —— 沉在地里时画面上看不出来 */
  lift: number;
  /** 点数（恒定） */
  points: number;
  /** pose() 自己的 CPU 开销（毫秒，EMA） */
  cpuMs: number;
}

export interface SwarmBody extends BodyInstance {
  readonly stats: SwarmStats;
  /** 清掉上一位观众的拖影环与落地基准，保留点表和 GPU 管线 */
  reset(): void;
  /** 换条目：重新取 palette 的 primary 颜色 */
  setTheme(themeId: string): void;
}

export interface SwarmOptions {
  library?: PartLibrary;
  /** 条目 id。它的 `palette[0]`（primary）决定这片点的颜色 */
  theme?: string;
  /** 点数，默认 `SWARM.count` */
  count?: number;
  /** 随机种子，默认 `SWARM.seed`（固定 → 截图可复现，P1） */
  seed?: number;
}

/** 没有 palette 时的中性色（线性 RGB）。和 `mass.ts` 的 DEFAULT_COLOR 同一个位置的东西 */
const DEFAULT_COLOR: [number, number, number] = [0.80, 0.86, 1.0];

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const smoothstep = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * 标准站姿的 17 根骨长，按 `ALL_BONE_IDS` 的次序。
 * **取自 `framing.ts` 的 `REFERENCE_POSE`，不另立一张常数表** ——
 * 另立一张，它和参考站姿漂开的那天没有人会发现（`docs/02 P15`）。
 */
function referenceBoneLengths(): number[] {
  const byId = new Map<string, Bone>();
  for (const b of REFERENCE_POSE.bones) byId.set(b.id, b);
  return ALL_BONE_IDS.map((id) => byId.get(id)?.length ?? 0);
}

export function createSwarmBody(opt: SwarmOptions = {}): SwarmBody {
  const object = new THREE.Group();
  object.name = 'swarm';

  const field: SwarmField = createBreathField({
    count: opt.count ?? SWARM.count,
    seed: opt.seed ?? SWARM.seed,
    follow: { boneLengths: referenceBoneLengths() },
  });
  object.add(field.object);

  const stats: SwarmStats = {
    triangles: 0, drawCalls: 0, lift: 0, points: field.points.length, cpuMs: 0,
  };

  /** 上一帧的落地抬升（米）。是状态，所以住在闭包里而不是从 stats 读回来 */
  let lift = 0;
  let liftSeeded = false;

  /**
   * 骨架按 `ALL_BONE_IDS` 的次序重排后的工作数组。**常驻**：`Skeleton.bones` 的
   * 次序由上游保证但不由契约保证，而点表里的 `bone` 是下标 —— 对不上就会
   * 把手上的点画到腿上。每帧重排一次（17 次赋值），不新建数组。
   */
  const ordered: Array<Bone | undefined> = new Array(ALL_BONE_IDS.length).fill(undefined);
  const orderIndex = new Map<string, number>(ALL_BONE_IDS.map((id, i) => [id, i]));

  function applyTheme(themeId: string | undefined) {
    let def: MaterialDef | undefined;
    const library = opt.library;
    if (library && themeId) {
      const theme = library.index.themes?.find((t) => t.id === themeId);
      const primary = theme?.palette?.[0];
      if (primary) def = library.index.materials?.find((m) => m.id === primary);
    }
    // 加色混合的点：亮的那一头由 emissive 决定，没有 emissive 就退回 baseColor。
    // 「场」的 palette[0] 是 `glow.signal`，正是为这一档准备的。
    const c = def?.emissive ?? def?.baseColor ?? DEFAULT_COLOR;
    field.setLook([c[0], c[1], c[2]], 1, 1);
  }
  applyTheme(opt.theme);

  const body: SwarmBody = {
    get object() { return object; },
    get stats() { return stats; },
    reset() {
      lift = 0;
      liftSeeded = false;
      field.resetTrail();
      field.setLift(0);
      field.update(0, 0, 0, 1);
      stats.triangles = 0;
      stats.drawCalls = 0;
      stats.lift = 0;
      stats.cpuMs = 0;
    },
    setTheme(themeId: string) { applyTheme(themeId); },

    pose(sk: Skeleton, presence: Presence, dt: number) {
      if (!sk || !sk.bones?.length) return;
      const t0 = performance.now();
      const step = Number.isFinite(dt) && dt > 0 ? clamp(dt, 0, 1 / 15) : 1 / 60;

      // 1. 在场（和 mass.ts / creature.ts 同一套折法）
      const pres = presence?.state === 'ENTERING' ? smoothstep(presence.transition)
        : presence?.state === 'LEAVING' ? 1 - smoothstep(presence.transition)
        : presence?.state === 'IDLE' ? 0
        : 1;

      // 2. 按 ALL_BONE_IDS 重排
      ordered.fill(undefined);
      for (const b of sk.bones) {
        const i = orderIndex.get(b.id);
        if (i !== undefined) ordered[i] = b;
      }

      const height = Number.isFinite(sk.height) && sk.height > 0.2 ? sk.height : SKELETON.referenceHeight;
      const bodyScale = height / SKELETON.referenceHeight;

      // 3. 落地。**在压进历史环之前算**：环里存的是世界坐标，抬升是一个整体平移，
      //    所以它作用在着色器的最后一步而不是烘进环里 —— 否则同一副骨架在环里
      //    会带着不同时刻的抬升，拖影会沿 Y 抖。
      //
      //    只在满在场时重算，进出场那几帧冻结它：`gather` 会把点散回地面雾，
      //    那时点云的最低点本来就该低下去，跟着重算会让整片点在化开的同时往上跳。
      //    （这条和 `mass.ts` 第 6 步冻结 lift 是同一个理由，同一个坑。）
      if (pres >= 0.999) {
        const lo = lowestSwarmY(field.points, ordered as Bone[], bodyScale);
        if (lo !== null) {
          const target = clamp(-lo, -MAX_LIFT, MAX_LIFT);
          if (!liftSeeded) { lift = target; liftSeeded = true; }
          else {
            const a = 1 - Math.exp(-step / Math.max(1e-3, SWARM.liftTau));
            lift += (target - lift) * a;
          }
        }
      }
      field.setLift(lift);
      stats.lift = lift;

      // 4. 压进运动历史环（`particles.ts` 里定速推进）
      field.pushPose(ordered as Bone[], step, bodyScale);

      // 5. 画。gather = pres：进场是"地面的雾聚拢成这个人"，离场是"散回地面"。
      //    timeScale 恒为 1 —— 升档的时间停滞对刚体件有意义（零件要顿一下），
      //    对一片正在流动的点没有：把它停住，读到的是"卡了一下"。
      //
      //    不透明度也乘 pres，而不是只靠 gather 散开：只散不淡的话，人走了以后
      //    这片点会**留在地面上变成第二团雾** —— 舞台自己已经有一团了（`stage.ts`
      //    的 `BreathField`），两团叠在一起读作"上一个人没走干净"。
      //    IDLE 时 opacity=0 → `mesh.visible=false` → 这一帧 0 draw，真的不花钱。
      field.update(step, pres, SWARM.opacity * pres, 1);

      stats.triangles = field.triangles;
      stats.drawCalls = field.triangles > 0 ? 1 : 0;
      stats.points = field.points.length;
      stats.cpuMs = stats.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
    },

    dispose() {
      object.remove(field.object);
      field.dispose();
      object.clear();
    },
  };

  return body;
}
