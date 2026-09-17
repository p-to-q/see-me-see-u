/**
 * 伴随身体的"人"那一半（docs/50 §3–§4）：画面里其余几个人，每人一套在场、滤波、腿、站位。
 * 不碰 three —— 画是 `creature.ts` 的 `setCompanions` 的事，这里只把**每个人的骨架**算出来。
 *
 * 为什么不塞进 `main.ts`：主身体那条链（精化 → 稳定 → 反折 → 腿 → 重映射 → 生命力）在 main.ts 里是一行一行写的，
 * 每一行都有一段"为什么顺序不能反"。伴随身体要走**同一条链**，而抄一份到帧循环里等于第二份会漂的代码。
 * 这里按同样的顺序写一遍，并且把每个人的滤波器状态**跟着人走**：主身体交接时，接班那个人自己的那一套换进主通道
 * （`takePipes` / `givePipes`），不从零热身，也不把上一个人的骨长带给他（docs/50 §3.3）。
 */
import { buildSkeleton, mediapipeToWorld } from '../../../core/src/skeleton.ts';
import { createStabilizer, type Stabilizer } from '../../../core/src/stabilize.ts';
import { clampFold, createRefiner, type Refiner } from '../../../core/src/refine.ts';
import { createVitality, type Vitality } from '../../../core/src/vitality.ts';
import { createMotion, type MotionMachine as Motion } from '../../../core/src/motion.ts';
import { createPresence, type PresenceMachine } from '../../../core/src/presence.ts';
import { createFramingClassifier, decide, stepFollow, stepToward, type FramingClassifier, type Follow } from '../../../core/src/autoframe.ts';
import { holdLegs } from '../../../core/src/leghold.ts';
import { blendSkeletons, remapSkeleton, type BodyPlan } from '../../../core/src/bodyplan.ts';
import { lineup, tintFor, type PeopleFrame } from '../../../core/src/people.ts';
import { AUTOFRAME, PEOPLE, PRESENCE, REFINE } from '../../../core/src/tuning.ts';
import type { Skeleton } from '../../../core/src/types.ts';
import type { Companion } from './creature.ts';

/** 一个人的滤波器。主通道（main.ts）和伴随身体各自持有一套，交接时互换 */
export interface PersonPipes {
  refiner: Refiner | null;
  stabilizer: Stabilizer;
  vitality: Vitality;
}

export const createPipes = (): PersonPipes => ({
  refiner: REFINE.enabled ? createRefiner() : null,
  stabilizer: createStabilizer(),
  vitality: createVitality(),
});

interface Entry {
  id: number;
  presence: PresenceMachine;
  pipes: PersonPipes;
  motion: Motion;
  classifier: FramingClassifier;
  legHold: number;
  x: Follow;
  skeleton: Skeleton | null;
  tint: readonly [number, number, number];
  companion: Companion;
  /** ≥ 0 = 这是上一个主身体，正在溶掉（已经溶了多少秒）；−1 = 普通的伴随身体 */
  retiring: number;
}

export interface CompanionContext {
  dt: number;
  /** 这一帧主身体的方案与漂移（伴随身体跟主身体同一个形体，docs/50 §3.1：同一条船） */
  plan: BodyPlan;
  drift: number;
  refineOn: boolean;
  vitalityOn: boolean;
  /** 台上最多几具身体（预算 × 调速器）。主身体算一具 */
  bodies: number;
  /** 伴随身体的整体缩放（开场团块还没长出零件时是 0：伴随身体跟着主身体一起长出来） */
  scale: number;
  aspect?: number;
}

export interface CompanionResult {
  companions: readonly Companion[];
  /** 主身体这一帧的站位（米）。单人 = 0 */
  primaryX: number;
  /** 台上身体（主 + 伴随，含正在溶掉的）横向占多宽（米），给舞台取景 */
  groupWidth: number;
  /** 伴随身体里最高那一具的头顶高度（米）。没有伴随身体 = 0 */
  groupHeight: number;
  /** 此刻在台上的身体数（含正在溶掉的） */
  visible: number;
}

export interface Companions {
  /** 已经在中线的唯一主身体：返回共享结果；其他状态返回 null 交给完整管线。 */
  stableSingle(frame: PeopleFrame): CompanionResult | null;
  update(frame: PeopleFrame, ctx: CompanionContext): CompanionResult;
  /** 主身体交接：把这个人自己的滤波器交出来（没有 = null，调用方新建一套） */
  takePipes(id: number): PersonPipes | null;
  /**
   * 交接的另一半：上一个主身体变成一具**正在溶掉**的伴随身体 —— 停在他最后的姿态和站位上，走完 `PRESENCE.leaveAnim`。
   * 滤波器还给他（他在墓地里回来时接着用）。
   */
  retire(id: number, pipes: PersonPipes, skeleton: Skeleton | null, x: number): void;
  /** 所有人都走了（弧线归零） */
  reset(): void;
  readonly entries: ReadonlyMap<number, { presence: string; legHold: number; x: number }>;
}

export function createCompanions(opts: { seed: () => number }): Companions {
  const entries = new Map<number, Entry>();
  let primaryX: Follow = { x: 0, v: 0 };
  const spring = { deadZone: PEOPLE.slotDeadZone, band: PEOPLE.slotDeadZone, omega: PEOPLE.slotOmega, range: PEOPLE.maxOffset };
  const centerSpring = { ...spring, deadZone: 0, band: 0 };
  const view = new Map<number, { presence: string; legHold: number; x: number }>();
  // 自动模式默认会建多人管线，但绝大多数帧仍只有一位主身体。这个结果不可变、可复用：
  // 只有第二人拿到身体、旧主仍在退场，或主身体还在从多人站位回中线时才走下面的完整路径。
  const singleResult: CompanionResult = Object.freeze({
    companions: Object.freeze([]) as readonly Companion[],
    primaryX: 0, groupWidth: 0, groupHeight: 0, visible: 1,
  });

  function entryFor(id: number): Entry {
    let e = entries.get(id);
    if (!e) {
      e = {
        id, presence: createPresence(), pipes: createPipes(), motion: createMotion(),
        classifier: createFramingClassifier(), legHold: 0, x: { x: 0, v: 0 }, skeleton: null,
        tint: tintFor(opts.seed(), id),
        retiring: -1,
        companion: { skeleton: null as unknown as Skeleton, presence: { state: 'IDLE', elapsed: 0, transition: 0 }, tint: [1, 1, 1], dx: 0, dz: 0, scale: 1 } as Companion,
      };
      entries.set(id, e);
    }
    return e;
  }

  const stableSingle = (frame: PeopleFrame): CompanionResult | null => {
    const solePrimary = frame.primary !== null
      && frame.selected.length === 1
      && frame.selected[0] === frame.primary;
    if (!solePrimary || entries.size > 0 || primaryX.x !== 0 || primaryX.v !== 0) return null;
    view.clear();
    return singleResult;
  };

  return {
    stableSingle,
    update(frame, ctx) {
      const solePrimary = frame.primary !== null
        && frame.selected.length === 1
        && frame.selected[0] === frame.primary;
      const single = stableSingle(frame);
      if (single) return single;
      const dt = ctx.dt;
      const tracks = new Map(frame.tracks.map((t) => [t.id, t]));
      // 台上的身体：主身体在前，其余按拿到身体的先后，截到预算
      const onStage = frame.primary === null ? [] : [frame.primary, ...frame.selected.filter((id) => id !== frame.primary)];
      const bodied = new Set(onStage.slice(0, Math.max(1, ctx.bodies)));

      // 站位：主身体 + 伴随身体一起排（lineup 只看**此刻真的被看见**的人；丢失中的保持最后的站位）
      const seen = [...bodied].map((id) => tracks.get(id)).filter((t) => !!t && t.missing === 0);
      const targets = lineup(seen.map((t) => ({ id: t!.id, cx: t!.cx, scale: t!.scale })), ctx.aspect);

      for (const id of new Set([...entries.keys(), ...bodied])) {
        if (id === frame.primary) continue;
        const t = tracks.get(id);
        const e = entryFor(id);
        if (e.retiring >= 0) {
          // 上一个主身体：不再吃任何姿态，停在最后那一刻溶掉。**他在溶的途中回来了**（墓地认亲、重新拿到身体）就当普通伴随身体接着用
          if (bodied.has(id) && t && t.missing === 0) { e.retiring = -1; e.presence.reset(); }
          else {
            e.retiring += dt;
            const k = Math.min(1, e.retiring / PRESENCE.leaveAnim);
            if (k >= 1) { entries.delete(id); continue; }
            if (e.skeleton) Object.assign(e.companion, { skeleton: e.skeleton, presence: { state: 'LEAVING', elapsed: e.retiring, transition: k }, tint: e.tint, dx: e.x.x, dz: 0, scale: ctx.scale });
            continue;
          }
        }
        const detected = bodied.has(id) && !!t && t.missing === 0;
        const p = e.presence.update(detected, dt);
        if (detected && t) {
          // 丢了一阵又被认回来：这个人的时间状态清掉，不在"之前"和"之后"之间插值（和主身体同一条，docs/50 §2.4）
          if (t.reacquired) {
            e.pipes.refiner?.reset(); e.pipes.stabilizer.reset(); e.pipes.vitality.reset();
            e.motion.reset(); e.classifier.reset(); e.legHold = 0;
          }
          const raw = t.pose;
          const cooked = e.pipes.refiner && ctx.refineOn ? e.pipes.refiner.apply(raw, dt) : raw;
          const tracked = e.pipes.stabilizer.apply(buildSkeleton(mediapipeToWorld(cooked), cooked.world, cooked.t), dt);
          if (e.pipes.refiner && ctx.refineOn) clampFold(tracked);
          const reading = e.classifier.update(raw, dt);
          e.legHold = stepToward(e.legHold, decide('auto', reading).holdLegs ? 1 : 0, dt, AUTOFRAME.legBlendSeconds);
          const human = holdLegs(tracked, e.legHold);
          const features = e.motion.update(human, dt);
          const planned = ctx.drift >= 1 ? remapSkeleton(human, ctx.plan)
            : ctx.drift <= 0 ? remapSkeleton(human, 'rig')
              : blendSkeletons(remapSkeleton(human, 'rig'), remapSkeleton(human, ctx.plan), ctx.drift);
          e.skeleton = ctx.vitalityOn ? e.pipes.vitality.apply(planned, features, dt, ctx.drift > 0 ? ctx.plan : 'rig') : planned;
        }
        const target = targets.get(id);
        if (target !== undefined) e.x = stepFollow(e.x, target, dt, spring);
        // 溶完了、也不再拿身体：整条收掉（人回来时重新长出来，站位从他此刻的位置起步）
        if (p.state === 'IDLE' && !bodied.has(id)) { entries.delete(id); continue; }
        if (!e.skeleton) continue;
        Object.assign(e.companion, { skeleton: e.skeleton, presence: p, tint: e.tint, dx: e.x.x, dz: -PEOPLE.backstep, scale: ctx.scale });
      }
      // 主身体：单人时永远在中线；有伴随身体时和他们一起排
      const pTarget = frame.primary !== null ? targets.get(frame.primary) : undefined;
      const grouped = seen.length > 1 && pTarget !== undefined;
      primaryX = stepFollow(primaryX, grouped ? pTarget : 0, dt, grouped ? spring : centerSpring);
      // 死区适合防人体抖动，但单人回中线不能永久停在死区边上：
      // 连续收回到 1mm 内再精确归零，下一帧才能回到无分配的稳定单人路径。
      if (!grouped
        && Math.abs(primaryX.x) <= PEOPLE.slotRestEpsilon
        && Math.abs(primaryX.v) <= PEOPLE.slotRestSpeedEpsilon) primaryX = { x: 0, v: 0 };
      if (solePrimary && entries.size === 0 && primaryX.x === 0 && primaryX.v === 0) {
        view.clear();
        return singleResult;
      }

      const companions: Companion[] = [];
      // 舞台取景的包围盒按左右对称算（`stage/framing.ts`），所以宽度 = 离中线最远那一具 × 2 + 一个身位
      let far = Math.abs(primaryX.x);
      let tall = 0;
      view.clear();
      for (const e of entries.values()) {
        view.set(e.id, { presence: e.retiring >= 0 ? 'LEAVING' : e.presence.current.state, legHold: e.legHold, x: e.x.x });
        if (!e.skeleton || e.id === frame.primary) continue;
        companions.push(e.companion);
        far = Math.max(far, Math.abs(e.x.x));
        for (const k in e.skeleton.joints) {
          const y = e.skeleton.joints[k][1];
          if (Number.isFinite(y) && y > tall) tall = y;
        }
      }
      return {
        companions, primaryX: primaryX.x,
        groupWidth: companions.length ? 2 * far + PEOPLE.minGap : 0,
        groupHeight: companions.length ? tall : 0,
        visible: 1 + companions.length,
      };
    },
    takePipes(id) {
      const e = entries.get(id);
      if (!e) return null;
      entries.delete(id);
      // 接班的人的身体**就站在他原来的位置上**：主身体的站位从那里起步，不从上一个主身体那里滑过来
      primaryX = { x: e.x.x, v: 0 };
      return e.pipes;
    },
    retire(id, pipes, skeleton, x) {
      const e = entryFor(id);
      e.pipes = pipes;
      e.skeleton = skeleton;
      e.x = { x, v: 0 };
      e.retiring = 0;
    },
    reset() {
      entries.clear();
      primaryX = { x: 0, v: 0 };
      view.clear();
    },
    get entries() { return view; },
  };
}
