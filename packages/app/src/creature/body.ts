/**
 * BodyInstance —— 「这具身体怎么被画出来」的那一层接口（docs/18-BODY-PLANS.md §2/§3）。
 *
 * 背景：在这之前只有一种表达 —— 一根骨头挂一个刚体件（`creature.ts`）。
 * 结果是不管选哪个条目，观众看到的都是同一具人体换皮。
 * 解法是把「渲染器」变成可插拔的：`Skeleton` 永远是人体（它是输入，不该改），
 * 由 BodyPlan 决定把它翻译成什么样的 Renderable。
 *
 * **这个文件是纯提取，不是新设计。** `creature.ts` 早就是
 * `{ object, pose, stats, dispose }` 这个形状了；这里只是把那个形状写下来，
 * 好让 `mass.ts`（metaball 团块）与它**并列**实现同一个接口，而不是套在它外面。
 * 所以 `creature.ts` 一行都没动 —— 文件末尾的 `_CreatureSatisfiesBodyInstance`
 * 是这件事的编译期证据。
 *
 * 契约（`BodyInstance` 的实现必须守住的，与 docs/02 P2/P5 一致）：
 *  - `pose()` 在帧循环里跑：**不 throw、不 await**。降级要在内部消化掉。
 *  - `stats` 是同一个对象被就地改写，不是每帧新建 —— 上层 HUD 直接持有它。
 *  - `object` 挂到 scene 上就不再被上层移动；身体自己的位移写在它的子节点里。
 */
import type * as THREE from 'three/webgpu';
import type { Presence, Skeleton } from '../../../core/src/types.ts';
import type { Creature } from './creature.ts';

/**
 * 所有身体方案都要报的两个数。预算在 `BUDGET.maxTriangles` / `maxDrawCalls`。
 * 各方案可以扩展它（`CreatureStats` 加了实例数与换装进度，`MassStats` 加了 res 与球数）。
 */
export interface BodyStats {
  triangles: number;
  /** 实际提交的网格数 ≈ draw call */
  drawCalls: number;
}

export interface BodyInstance {
  /** 挂到 scene 上的根节点 */
  readonly object: THREE.Object3D;
  /** 每帧被就地改写；不要缓存它的字段，缓存这个对象本身 */
  readonly stats: BodyStats;
  /** 帧循环调用：把骨架 + 在场状态变成这一帧的几何。不 throw、不 await */
  pose(sk: Skeleton, presence: Presence, dt: number): void;
  /**
   * 换了一位观众：清掉只属于上一场的时间状态（拖影、能量、交接队列等）。
   *
   * 可选是为了让纯展示型 BodyInstance 仍然保持最小契约；有跨帧状态的实现必须提供。
   * 这不是 dispose：GPU 对象与已编译管线都保留，下一位不为重建付延迟。
   */
  reset?(): void;
  /**
   * 会话弧线走到哪儿了，0..1（`docs/40` 的 `overall`，不是乐章内部的进度）。
   *
   * **可选，而且是故意可选的。** 弧线作用在"表面"上（`docs/41-MATERIAL.md`：
   * 它以一张画开场，然后变成一件东西），而团块和点场没有"表面"这个概念 ——
   * 它们的身份就是材料本身，没有可以从画变成物的那一层。
   * 一具不关心弧线的身体不实现它，比实现一个空函数诚实：
   * 空函数会让调用方以为那边有东西在响应。
   */
  setArc?(progress: number): void;
  dispose(): void;
}

/** `Assert<false>` 编译不过 —— 让下面那条断言在失败时**真的红**，而不是悄悄变成 never */
type Assert<T extends true> = T;

/**
 * 编译期证明：现有的刚体渲染器已经满足 `BodyInstance`，**不需要改它一行**。
 * 如果哪天 `Creature` 漂移了（比如 `pose` 改签名），`npm run typecheck` 会先红。
 */
export type _CreatureSatisfiesBodyInstance = Assert<Creature extends BodyInstance ? true : false>;
