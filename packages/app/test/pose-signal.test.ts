import test from 'node:test';
import assert from 'node:assert/strict';
import { overallScore } from '../src/capture/pose-protocol.ts';
import { posePresent, poseTorsoEvidence } from '../../core/src/pose-signal.ts';
import { qualityScale } from '../../core/src/refine.ts';
import { CAPTURE, REFINE } from '../../core/src/tuning.ts';
import type { Landmark, RawPose } from '../../core/src/types.ts';
import { seeState } from '../src/ui/preview-state.ts';
import { assess, readOut } from '../src/ui/readout-state.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const landmark = (visibility: number, over: Partial<Landmark> = {}): Landmark => ({
  x: 0.5, y: 0.5, z: 0, visibility, ...over,
});

const pose = (visibility: (i: number) => number, score?: number): RawPose => {
  const screen = Array.from({ length: 33 }, (_, i) => landmark(visibility(i)));
  return {
    world: screen.map((l) => ({ ...l })), screen,
    score: score ?? overallScore(screen, screen), t: 0,
  };
};

test('人体信号：可靠头肩 + 画外低分腿不会再被 33 点平均成“无人”', () => {
  const close = pose((i) => i <= 12 ? 0.95 : 0.1);
  assert.ok(close.score > 0.43 && close.score < 0.44, `测试前提：整体平均应约 0.435，实际 ${close.score}`);
  assert.ok(close.score < CAPTURE.minScore);
  assert.equal(poseTorsoEvidence(close).shoulders, 0.95);
  assert.equal(posePresent(close), true);
  assert.ok(qualityScale(close.score) < 1, '整身质量仍须如实偏低，不能被 presence 例外抹掉');
  assert.deepEqual(seeState({ camera: true, pose: close }), { state: 'ok', reason: 'ok' });
  const readout = readOut({ pose: close, features: null, inferenceHz: 30 });
  assert.equal(readout.present, true);
  assert.equal(readout.values.confidence, '0.43', '读数仍如实显示 33 点平均，不把肩线例外冒充整身质量');
  assert.equal(assess({ pose: close, features: null, inferenceHz: 30 }).levels.confidence, 'warn');
});

test('人体信号：平均分走严格大于；肩/胯例外走质量线且必须成对', () => {
  assert.equal(posePresent(pose(() => 0.1, CAPTURE.minScore)), false, '整身平均正好压线不算');
  assert.equal(posePresent(pose(() => 0.1, CAPTURE.minScore + 1e-6)), true);

  const pair = pose(() => 0.1, 0.1);
  pair.screen![11] = landmark(REFINE.qualityStart);
  pair.screen![12] = landmark(REFINE.qualityStart);
  assert.equal(posePresent(pair), true, '可靠肩对正好压线应算');
  pair.screen![12] = landmark(REFINE.qualityStart - 1e-6);
  assert.equal(posePresent(pair), false, '只有一侧可信不能把噪声认成人');
});

test('人体信号：screen 明确存在时不借更乐观的 world；旧回放才退到 world', () => {
  const p = pose(() => 0.1, 0.1);
  p.world[11] = landmark(0.95);
  p.world[12] = landmark(0.95);
  assert.equal(posePresent(p), false);
  p.screen = undefined;
  assert.equal(posePresent(p), true);
});

test('人体信号：空数组 / 非有限坐标不因高 score 冒充人；全零 visibility 兼容旧模型', () => {
  assert.equal(posePresent({ world: [], screen: [], score: 1, t: 0 }), false);
  assert.equal(posePresent({
    world: Array.from({ length: 33 }, () => landmark(1, { x: NaN })), score: 1, t: 0,
  }), false);

  const zeros = pose(() => 0);
  assert.equal(zeros.score, 1, '采集协议把全零 visibility 视为“不提供该字段”');
  assert.equal(posePresent(zeros), true, '有限 33 点 + 协议 fallback score 必须保持兼容');
});

test('人体信号：高胯可以证明人在，但不能替坏肩把上半身质量报好', () => {
  const p = pose(() => 0.1, 0.1);
  p.screen![23] = landmark(0.95);
  p.screen![24] = landmark(0.95);
  assert.equal(posePresent(p), true);
  assert.equal(poseTorsoEvidence(p).shoulders, 0.1);
  assert.deepEqual(seeState({ camera: true, pose: p }), { state: 'partial', reason: 'quality' });
});

test('人体信号接线：现场 presence、idle、回放与举手入口都不再各画 score 门限', () => {
  const here = fileURLToPath(new URL('../src/', import.meta.url));
  const files = ['main.ts', 'capture/webcam.ts', 'capture/replay.ts', 'choose/ring/wave-input.ts'];
  for (const file of files) {
    const src = readFileSync(`${here}${file}`, 'utf8');
    assert.match(src, /posePresent\(/, `${file} 没有接共享 presence 判据`);
  }
  const joined = files.map((file) => readFileSync(`${here}${file}`, 'utf8')).join('\n');
  assert.doesNotMatch(joined, /(?:score|\.score[^\n]{0,30})[><=]+\s*CAPTURE\.minScore/,
    '运行时仍有一处用 33 点平均直接判“有没有人”');
});
