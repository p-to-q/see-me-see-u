import test from 'node:test';
import assert from 'node:assert/strict';
import { posePresent, poseTorsoEvidence } from '../src/pose-signal.ts';
import { CAPTURE, REFINE } from '../src/tuning.ts';
import type { Landmark, RawPose } from '../src/types.ts';

const pose = (vis: readonly number[], score: number, screen = true): RawPose => {
  const landmarks = Array.from({ length: 33 }, (_, i): Landmark => ({
    x: 0.5, y: 0.5, z: 0, visibility: vis[i] ?? vis[vis.length - 1],
  }));
  return { world: landmarks.map((l) => ({ ...l })), ...(screen ? { screen: landmarks } : {}), score, t: 0 };
};

test('pose signal：低整身平均 + 高质量肩对仍是人，整身全低仍不是', () => {
  const close = pose([0.95, ...Array(10).fill(0.95), 0.95, 0.95, ...Array(20).fill(0.1)], 0.435);
  assert.equal(poseTorsoEvidence(close).shoulders, 0.95);
  assert.equal(posePresent(close), true);
  assert.equal(posePresent(pose([0.3], 0.3)), false);
});

test('pose signal：原平均严格大于、锚点例外大于等于质量线', () => {
  assert.equal(posePresent(pose([0.1], CAPTURE.minScore)), false);
  assert.equal(posePresent(pose([0.1], CAPTURE.minScore + 1e-6)), true);
  const anchor = pose([0.1], 0.1);
  anchor.screen![11].visibility = REFINE.qualityStart;
  anchor.screen![12].visibility = REFINE.qualityStart;
  assert.equal(posePresent(anchor), true);
  anchor.screen![12].visibility = REFINE.qualityStart - 1e-6;
  assert.equal(posePresent(anchor), false);
});

test('pose signal：空 / 非有限不通过；screen 明确存在时不借 world', () => {
  assert.equal(posePresent({ world: [], score: 1, t: 0 }), false);
  assert.equal(posePresent({ world: [{ x: NaN, y: 0, z: 0 }], score: 1, t: 0 }), false);
  const p = pose([0.1], 0.1);
  p.world[11].visibility = p.world[12].visibility = 0.95;
  assert.equal(posePresent(p), false);
  p.screen = undefined;
  assert.equal(posePresent(p), true);
});
