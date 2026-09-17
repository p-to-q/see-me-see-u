/**
 * 自动人数探测在浏览器侧的几条边界。状态机住在 core；这里仅把运行时事实翻译成它的输入：
 * 谁这一帧真的还在、主身体是哪一份姿态、机器此刻有没有余量，以及探测时该跑多快。
 */
import type { PeopleFrame } from '../../../core/src/people.ts';
import type { RawPose } from '../../../core/src/types.ts';
import { CAPTURE, GOVERNOR, PEOPLE } from '../../../core/src/tuning.ts';

/** grace 里的轨迹仍有 selected 身份，但已经不在画面里，不能拿来确认人数。 */
export function visibleSelectedCount(frame: PeopleFrame | null): number {
  if (!frame) return 0;
  return frame.tracks.reduce((n, t) => n + (t.selected && t.missing === 0 ? 1 : 0), 0);
}

/** MediaPipe 的数组顺序不稳定；主通道只能按 tracker 的稳定 id 取。 */
export function visiblePrimaryPose(frame: PeopleFrame | null): RawPose | null {
  if (!frame || frame.primary === null) return null;
  return frame.tracks.find((t) => t.id === frame.primary && t.missing === 0)?.pose ?? null;
}

/**
 * tracker 的旧 primary 短暂进入 missing grace 时，常见的“检测器仍只看见一个人”不能把身体冻住。
 * 只有已确认上限仍为 1、且这一份推理确实至多一人时才退回 `latest`；多人时宁可保持稳定身份，
 * 也不按 MediaPipe 的数组顺序突然换人。
 */
export function trackedPrimaryOrSingleFallback(
  frame: PeopleFrame | null,
  latest: RawPose | null,
  detectedCount: number,
  confirmedCap: number,
): RawPose | null {
  const tracked = visiblePrimaryPose(frame);
  if (tracked) return tracked;
  const count = Number.isFinite(detectedCount) ? Math.max(0, Math.floor(detectedCount)) : Number.POSITIVE_INFINITY;
  return confirmedCap <= 1 && count <= 1 ? latest : null;
}

export interface PeopleProbeBudget {
  /** 只有真摄像头才有要发现的真人；回放的多人是合成取证。 */
  active: boolean;
  visible: boolean;
  throttled: boolean;
  degraded: boolean;
  governorLevel: number;
  frameMs: number;
}

/**
 * 单人流畅优先：页面、帧循环或调速器只要有一处在吃紧，就不开 / 立即撤掉后台多人探测。
 * 不另造性能门限；“一帧已经慢得看得出来”的判据复用调速器自己的 `jankFloorMs`。
 */
export function canRunPeopleProbe(b: PeopleProbeBudget): boolean {
  return b.active
    && b.visible
    && !b.throttled
    && !b.degraded
    && b.governorLevel === 0
    && Number.isFinite(b.frameMs)
    && b.frameMs > 0
    && b.frameMs < GOVERNOR.jankFloorMs;
}

/** 探测窗降频；正常单人和已确认人数仍用调速器给出的基准频率。 */
export function peopleProbeCadence(baseHz: number, probing: boolean): number {
  const base = Number.isFinite(baseHz) && baseHz > 0 ? baseHz : CAPTURE.targetHz;
  return probing ? Math.min(base, PEOPLE.probeInferenceHz) : base;
}
