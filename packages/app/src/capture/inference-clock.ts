/**
 * 把“渲染又读了一次缓存”与“推理真的产出了一份新结果”分开。
 *
 * MediaPipe 通常 30Hz、舞台可到 120Hz。凡是会累计证据的状态机（多人出生、
 * 换人、自动人数确认）都只能在这里返回非 null 时前进一步，否则同一份结果会
 * 被按屏幕刷新率重复计时。
 */
export interface FreshInference {
  /** 交回调用方保存；下一次拿它判重 */
  stamp: number;
  /** 距上一份新推理的秒数；第一份用调用方这一帧的 dt */
  dt: number;
}

export function freshInference(
  lastStamp: number,
  inferredAt: number | undefined,
  poseAt: number | undefined,
  firstDt: number,
): FreshInference | null {
  // `inferredAt` 是采集端完成时刻，优先于 pose 自带的时刻；旧 Capture 没实现它时
  // 才退到 RawPose.t。NaN 不是“有值”，不能用 ?? 判。
  const stamp = Number.isFinite(inferredAt)
    ? inferredAt!
    : Number.isFinite(poseAt) ? poseAt! : Number.NaN;
  if (!Number.isFinite(stamp)) return null;
  if (Number.isFinite(lastStamp) && stamp <= lastStamp) return null;

  const elapsed = Number.isFinite(lastStamp) ? (stamp - lastStamp) / 1000 : firstDt;
  const dt = Number.isFinite(elapsed) && elapsed > 0 ? Math.min(elapsed, 0.25) : 0;
  return { stamp, dt };
}
