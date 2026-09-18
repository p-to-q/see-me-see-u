/**
 * 采集端两条推理路径共用的节拍闸。worker 和主线程降级若各写一份，后台人数探测就会只降到其中一条。
 */
import { CAPTURE } from '../../../core/src/tuning.ts';

export function cadenceDue(nowMs: number, lastMs: number, hz: number): boolean {
  if (!Number.isFinite(nowMs)) return false;
  if (!Number.isFinite(lastMs)) return true;
  const safeHz = Number.isFinite(hz) && hz > 0 ? hz : CAPTURE.targetHz;
  return nowMs - lastMs >= Math.max(0, 1000 / safeHz - CAPTURE.cadenceSlackMs);
}

/** 主线程降级还要避开 MediaPipe 异步重建图；worker 由自己的 busy queue 守同一条边界。 */
export function mainThreadInferenceDue(
  reconfiguring: boolean,
  nowMs: number,
  lastMs: number,
  hz: number,
): boolean {
  return !reconfiguring && cadenceDue(nowMs, lastMs, hz);
}
