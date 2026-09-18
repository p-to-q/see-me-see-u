/**
 * 姿态时钟 —— 推理的节拍 → 渲染的节拍。**纯的**：时间全部由调用方给（AGENTS 不变量）。
 *
 * ## 它修的是哪一半卡顿（docs/48 §2 的实测）
 *
 * 推理 30Hz，显示 60–120Hz。此前帧循环每帧直接吃 `capture.latest()`：同一份结果被连着吃
 * 两到四帧，精化器（One-Euro）和运动特征看到的是"不动、不动、跳一大步"——
 * 静止时台阶是零看不出来，**动作一大台阶就大**，身体一顿一顿地追。
 *
 * 这里把渲染时刻往回退约一个推理间隔（`CAPTURE.interpDelayMax` 封顶），
 * 在最近两次推理结果**之间**插值：两次推理之间走的是一条线。代价是约 33ms 的延迟，
 * 换来的是每一帧都在动。
 *
 * ## 推理停了怎么办（看门狗的那一半）
 *
 *   新结果照常到     → `live`：插值
 *   最后一份之后     → `extrapolating`：按最后速度往前走，最多 `extrapolateMax`
 *   `stallAfter` 没新结果 → `holding`：停在外推封顶的那一点（不往回跳）
 *   再过 `holdAfterStall` → `stalled`：交出 null，由在场判定接手淡出
 *   推理说"没人"     → `empty`：立刻 null —— 和 `webcam.ts` 同一条"不返回幽灵"
 *
 * 两份结果隔得比 `stallAfter` 还久（切回前台、停滞后恢复）时不在它们之间插值：
 * 那段路径不存在，从旧姿态慢慢滑到新姿态是编出来的动作。
 *
 * ## 为什么住在 capture/ 而不是 core/
 *
 * 它不碰浏览器，放 core 也行；但它回答的是"采集端的节拍怎么交给渲染"，
 * 消费者只有 `main.ts` 这一处，而 `RawPose` 的时间戳是采集端打的 `performance.now()`。
 */
import type { Landmark, RawPose } from '../../../core/src/types.ts';
import { CAPTURE } from '../../../core/src/tuning.ts';

export type PoseClockState = 'waiting' | 'live' | 'extrapolating' | 'holding' | 'stalled' | 'empty';

/**
 * 给“此刻真的测量”的消费者用：身体可以在推理短停时保持最后姿态，
 * 但取景分类、小屏和读数不能把缓存骨架继续报成新观测。
 */
export function measuredPose(pose: RawPose | null, state: PoseClockState): RawPose | null {
  return state === 'live' || state === 'extrapolating' ? pose : null;
}

export interface PoseClock {
  /**
   * 每帧调一次都行。`inferredAt` = 这份结果是哪一次推理给的（毫秒，和 `now` 同一时钟）。
   * 同一个 `inferredAt` 重复观察不会重复入队。
   */
  observe(pose: RawPose | null, inferredAt: number): void;
  /** 渲染这一刻该用的姿态 */
  sample(now: number): RawPose | null;
  readonly state: PoseClockState;
  /** 测到的推理间隔（毫秒，EMA） */
  readonly intervalMs: number;
  reset(): void;
}

const lerp = (p: number, q: number, u: number): number => p + (q - p) * u;

function lerpLandmarks(a: readonly Landmark[], b: readonly Landmark[], u: number): Landmark[] {
  const out: Landmark[] = new Array(b.length);
  for (let i = 0; i < b.length; i++) {
    const p = a[i];
    const q = b[i];
    if (!p) { out[i] = q; continue; }
    const vp = p.visibility;
    const vq = q.visibility;
    out[i] = {
      x: lerp(p.x, q.x, u),
      y: lerp(p.y, q.y, u),
      z: lerp(p.z, q.z, u),
      visibility: typeof vp === 'number' && typeof vq === 'number'
        ? Math.min(1, Math.max(0, lerp(vp, vq, u)))
        : vq,
    };
  }
  return out;
}

export function createPoseClock(): PoseClock {
  const stallMs = CAPTURE.stallAfter * 1000;
  const holdMs = CAPTURE.holdAfterStall * 1000;
  const extraMs = CAPTURE.extrapolateMax * 1000;
  const delayMax = CAPTURE.interpDelayMax * 1000;
  const nominal = 1000 / CAPTURE.targetHz;

  let a: RawPose | null = null;
  let ta = 0;
  let b: RawPose | null = null;
  let tb = 0;
  let lastAt = Number.NaN;
  let empty = false;
  let interval = nominal;
  let lastOutT = -Infinity;
  let state: PoseClockState = 'waiting';

  function emit(u: number, t: number): RawPose {
    const q = b!;
    const p = a;
    if (!p || u === 1) return { ...q, t };
    const screen = p.screen?.length && q.screen?.length === p.screen.length
      ? lerpLandmarks(p.screen, q.screen, u)
      : q.screen;
    return {
      world: lerpLandmarks(p.world, q.world, u),
      screen,
      score: Math.min(1, Math.max(0, lerp(p.score, q.score, u))),
      t,
    };
  }

  return {
    observe(pose, at) {
      if (!Number.isFinite(at) || at === lastAt) return;
      const gap = at - lastAt;
      lastAt = at;
      // 间隔只吃"正常"的那些：一次停滞不该把插值延迟拉到封顶
      if (gap > 0 && gap < stallMs) interval += (gap - interval) * 0.2;
      if (!pose || !pose.world?.length) { empty = true; a = null; b = null; return; }
      empty = false;
      if (b && at - tb < stallMs) { a = b; ta = tb; } else { a = null; }
      b = pose;
      tb = at;
    },

    sample(now) {
      if (empty) { state = 'empty'; return null; }
      if (!b) { state = 'waiting'; return null; }
      const since = now - lastAt;
      if (since > stallMs + holdMs) { state = 'stalled'; return null; }

      const tr = now - Math.min(interval, delayMax);
      let u = 1;
      if (a && tb > ta) {
        if (tr <= tb) u = Math.max(0, (tr - ta) / (tb - ta));
        else u = 1 + Math.min(tr - tb, extraMs) / (tb - ta);
      }
      state = since > stallMs ? 'holding' : u > 1 ? 'extrapolating' : 'live';
      // 严格递增：下游有按 t 判"是不是新一帧"的（小屏幕），也有拿它建骨架的
      const t = Math.max(tr, lastOutT + 1e-3);
      lastOutT = t;
      return emit(u, t);
    },

    get state() { return state; },
    get intervalMs() { return interval; },

    reset() {
      a = null; b = null; ta = 0; tb = 0;
      lastAt = Number.NaN; empty = false; interval = nominal;
      lastOutT = -Infinity; state = 'waiting';
    },
  };
}
