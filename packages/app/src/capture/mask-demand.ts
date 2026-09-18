/**
 * 分割器的单张需求闸。不读时钟，不碰图像；WebcamCapture 只把消息所有权交给它。
 *
 * generation 是观众边界：离场后旧 worker 回调即使晚到，也不能被下一场接受。
 */
export interface MaskDemand {
  set(wanted: boolean): void;
  /** 分割器已就位时，为下一个 pose frame 领一个 generation；null = 这帧不抐图。 */
  begin(segmenterReady: boolean): number | null;
  /** 收到 worker 结果。true = 这张属于当前场且应被接受。 */
  settle(generation: number, delivered: boolean): boolean;
  readonly wanted: boolean;
  readonly inFlight: boolean;
  readonly generation: number;
}

export function createMaskDemand(): MaskDemand {
  let generation = 0;
  let wanted = false;
  let inFlight = false;

  return {
    set(next) {
      if (next === wanted) return;
      generation += 1;
      wanted = next;
      inFlight = false;
    },
    begin(ready) {
      if (!wanted || !ready || inFlight) return null;
      inFlight = true;
      return generation;
    },
    settle(resultGeneration, delivered) {
      if (resultGeneration !== generation || !inFlight) return false;
      inFlight = false;
      if (!delivered || !wanted) return false;
      wanted = false;
      return true;
    },
    get wanted() { return wanted; },
    get inFlight() { return inFlight; },
    get generation() { return generation; },
  };
}
