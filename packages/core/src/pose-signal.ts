/**
 * 一份 RawPose 到底有没有足够证据代表一个人。
 *
 * MediaPipe 没有整姿置信度；采集层的 `score` 是 33 点 visibility 的平均值。近距离上半身里，
 * 画外的腿会把这个平均值压低，即使两肩 / 两胯仍然非常可靠。存在、去抖质量与整身完整度因此
 * 不能继续共用那个平均值。这里保留原 score，同时让一对可靠的躯干锚点为“可用人体信号”作证。
 */
import type { Landmark, RawPose } from './types.ts';
import { CAPTURE, REFINE } from './tuning.ts';
import { landmarkConfidence } from './skeleton.ts';

const SHOULDER_L = 11, SHOULDER_R = 12, HIP_L = 23, HIP_R = 24;

const clamp01 = (v: number): number => Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;

export interface TorsoEvidence {
  /** 成对肩点的较低置信度；模型不提供 visibility 时，有限坐标记 1。 */
  shoulders: number;
  /** 成对胯点的较低置信度。 */
  hips: number;
}

const pairEvidence = (src: readonly Landmark[], a: number, b: number): number =>
  Math.min(landmarkConfidence(src[a]), landmarkConfidence(src[b]));

/** screen 有数据就以 screen 的 visibility 为准；旧回放没有 screen 时才退到 world。 */
export function poseTorsoEvidence(pose: RawPose | null | undefined): TorsoEvidence {
  if (!pose) return { shoulders: 0, hips: 0 };
  const src = Array.isArray(pose.screen) && pose.screen.length > 0
    ? pose.screen
    : Array.isArray(pose.world) ? pose.world : [];
  return {
    shoulders: pairEvidence(src, SHOULDER_L, SHOULDER_R),
    hips: pairEvidence(src, HIP_L, HIP_R),
  };
}

/**
 * 这不是降低门限。空场仍须有一份非空、坐标有限的 RawPose；整身平均过不了时，
 * 还必须有一对达到现有质量线的肩或胯。仅“勉强可用”的 0.4–0.5 锚点不扩张 presence，
 * 这样坏光下的旧行为不变。位置是否出画由取景 / 引导自己处理，presence 不拿 UI 的
 * 边缘余量当生命周期规则；MediaPipe 停止给 pose 后，既有 Presence 状态机再负责淡出。
 */
export function posePresent(pose: RawPose | null | undefined): pose is RawPose {
  if (!pose) return false;
  const src = Array.isArray(pose.screen) && pose.screen.length > 0
    ? pose.screen
    : Array.isArray(pose.world) ? pose.world : [];
  const finite = src.some((l) => !!l && Number.isFinite(l.x) && Number.isFinite(l.y) && Number.isFinite(l.z));
  if (!finite) return false;
  const raw = clamp01(pose.score);
  const torso = poseTorsoEvidence(pose);
  return raw > CAPTURE.minScore
    || torso.shoulders >= REFINE.qualityStart
    || torso.hips >= REFINE.qualityStart;
}
