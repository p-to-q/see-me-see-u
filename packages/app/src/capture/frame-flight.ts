/**
 * worker 帧所有权。超时只是放弃等那一帧，不代表它永远不会回来；
 * 所以回执只能结算与自己 stamp 匹配的在途帧。纯函数，时间由调用方传入。
 */

export type FrameFlight = number | null;

export function ownsFrameFlight(active: FrameFlight, stamp: number): boolean {
  return active !== null && Number.isFinite(stamp) && active === stamp;
}

/** 迟到的旧回执不得清掉更新的在途帧。 */
export function settleFrameFlight(active: FrameFlight, stamp: number): FrameFlight {
  return ownsFrameFlight(active, stamp) ? null : active;
}

export function frameFlightTimedOut(
  active: FrameFlight,
  sentAt: number,
  now: number,
  timeoutMs: number,
): boolean {
  return active !== null
    && Number.isFinite(sentAt)
    && Number.isFinite(now)
    && Number.isFinite(timeoutMs)
    && timeoutMs >= 0
    && now - sentAt >= timeoutMs;
}
