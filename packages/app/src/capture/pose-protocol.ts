/**
 * 主线程 ↔ 姿态 worker 之间的消息，以及两边共用的两个纯函数。
 *
 * **这里不许 import MediaPipe**：主线程那一侧只在降级路径上才需要它，
 * 而消息类型两边都要认识。
 */
import type { Landmark } from '../../../core/src/types.ts';

export type PoseIn =
  | {
    type: 'init';
    wasmLoaderPath: string;
    wasmBinaryPath: string;
    poseModel: string;
    segmenterModel: string | null;
    /** 预热用的画布尺寸：让着色器按真实输入的尺寸编译 */
    width: number;
    height: number;
    /**
     * 最多认几个人（`?people=`，docs/50）。缺省 1 = 这一版之前的那条路。
     * **大于 1 有真实代价**：MediaPipe 在跟踪到的人数少于它时每一帧都重跑检测器（docs/50 §1.2 实测）。
     */
    numPoses?: number;
  }
  /**
   * 运行中改人数上限（控件条）。worker 在两帧之间重建图，这期间来的帧回 `fail`。
   * `requestId` 让主线程可以丢掉旧回执；只有匹配的成功回执才能改“已生效”人数。
   */
  | { type: 'options'; requestId: number; numPoses: number }
  | {
    type: 'frame';
    frame: VideoFrame | ImageBitmap;
    /** 主线程的 `performance.now()`，严格递增。worker 的时钟原点不同，所以时间戳只用这一个 */
    stamp: number;
    /** 这一帧顺手抠一次图（慢回路用，2Hz） */
    mask: boolean;
  };

export type PoseOut =
  | { type: 'ready'; backend: 'GPU' | 'CPU'; warning: string | null; warmMs: number }
  | { type: 'segmenter'; ok: boolean; warning: string | null }
  /** 起不来（init 失败）。之后这个 worker 不再可用 */
  | { type: 'error'; error: string }
  | {
    type: 'pose'; stamp: number; world: Landmark[] | null; screen: Landmark[] | null; score: number; inferMs: number;
    /**
     * MediaPipe 这一帧给出的**其余**几个人（下标 1..n−1）。`numPoses = 1` 时永远不出现。
     * 顺序不保证、不带身份（docs/24 #4681）：身份由主线程的 `core/src/people.ts` 跟出来。
     * 第 0 个仍然走上面那三个字段 —— 单人的消费者一个字都不用改。
     */
    others?: Array<{ world: Landmark[]; screen: Landmark[] | null; score: number }>;
  }
  /** 这一帧推理抛了；worker 还活着 */
  | { type: 'fail'; stamp: number; error: string }
  /** `setOptions()` 的显式结果；失败时不得把目标值当成已生效 */
  | { type: 'options-result'; requestId: number; numPoses: number; ok: boolean; error?: string }
  | { type: 'mask'; bitmap: ImageBitmap };

export function toLandmark(l: { x: number; y: number; z: number; visibility?: number }): Landmark {
  return { x: l.x, y: l.y, z: l.z, visibility: l.visibility };
}

/**
 * MediaPipe 不给"整体置信度"，只有逐点 visibility。取平均值当 score（docs/06 §1 用它判有没有人）。
 * 有些模型版本 visibility 恒为 0；那种情况下"检出了 33 个点"本身就是证据，记 1。
 */
export function overallScore(
  screen: ReadonlyArray<{ visibility?: number }> | undefined,
  world: ReadonlyArray<{ visibility?: number }>,
): number {
  const src = screen?.length ? screen : world;
  let sum = 0, n = 0;
  for (const l of src) {
    const v = l.visibility;
    if (typeof v === 'number' && Number.isFinite(v)) { sum += v; n++; }
  }
  if (!n || sum === 0) return 1;
  return Math.min(1, Math.max(0, sum / n));
}

export function describe(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}
