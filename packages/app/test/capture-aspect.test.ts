/** 摄像头画幅必须沿同一条接线进入分类、横向、多人和两块仪表。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createFramingClassifier, lateralEvidence, LATERAL_REST, stepLateral } from '../../core/src/autoframe.ts';
import { createPeopleTracker } from '../../core/src/people.ts';
import { person, WHOLE } from '../../core/test/framing-people.ts';
import { captureAspect, type Capture } from '../src/capture/capture.ts';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const fake = (frameAspect?: number | null): Capture => ({
  async start() {},
  latest: () => null,
  takeMask: () => null,
  fps: 0,
  lastError: null,
  stop() {},
  frameAspect,
});

test('capture aspect：只接受有限正数，回放和坏尺寸安全回落 16:9', () => {
  assert.equal(captureAspect(fake(4 / 3)), 4 / 3);
  assert.equal(captureAspect(fake(9 / 16)), 9 / 16);
  for (const bad of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(captureAspect(fake(bad)), 16 / 9);
  }
});

test('capture aspect：同一画面位移按真实 4:3 / 9:16 得到不同且有限的舞台距离', () => {
  const pose = person({ ...WHOLE, cx: 0.68 });
  const settle = (aspect: number): number => {
    let state = LATERAL_REST;
    for (let i = 0; i < 180; i++) {
      state = stepLateral(state, {
        evidence: lateralEvidence(pose, aspect), aspect, room: 5, enabled: true,
      }, 1 / 60);
    }
    return state.x.x;
  };
  const landscape = settle(4 / 3);
  const portrait = settle(9 / 16);
  assert.ok(Number.isFinite(landscape) && Number.isFinite(portrait));
  assert.ok(Math.abs(landscape - portrait) > 0.05,
    `4:3 与 9:16 仍像固定画幅：${landscape.toFixed(3)} / ${portrait.toFixed(3)}`);
});

test('capture aspect：同一身体换横竖画幅后，分类与单人身份的物理量不跳', () => {
  const classifier = createFramingClassifier();
  const landscape = classifier.update(person({ ...WHOLE, aspect: 4 / 3 }), 1 / 30, { aspect: 4 / 3 });
  const portrait = classifier.update(person({ ...WHOLE, aspect: 9 / 16 }), 1 / 30, { aspect: 9 / 16 });
  assert.ok(landscape.evidence && portrait.evidence);
  assert.ok(Math.abs(landscape.evidence.shoulder - portrait.evidence.shoulder) < 1e-9);
  assert.ok(Math.abs(landscape.evidence.torso - portrait.evidence.torso) < 1e-9);

  const tracker = createPeopleTracker({ cap: 1 });
  let trackId: number | undefined;
  for (let i = 0; i < 20; i++) {
    const frame = tracker.update([person({ ...WHOLE, aspect: 4 / 3 })], 1 / 30, 4 / 3);
    trackId ??= frame.tracks[0]?.id;
  }
  const before = tracker.current.tracks[0];
  for (let i = 0; i < 20; i++) {
    tracker.update([person({ ...WHOLE, aspect: 9 / 16 })], 1 / 30, 9 / 16);
  }
  const after = tracker.current.tracks[0];
  assert.equal(after?.id, trackId, '画幅换了不是换了一个人');
  assert.ok(before && after && Math.abs(before.scale - after.scale) < 1e-9);
  assert.equal(tracker.nextId, 2, '没有为画幅变化乱发新身份');
});

test('capture aspect 接线：分类、横向、身份、站位、小屏与读数共用每帧同一个值', () => {
  const capture = read('../src/capture/capture.ts');
  const webcam = read('../src/capture/webcam.ts');
  const main = read('../src/main.ts');
  const preview = read('../src/ui/preview-state.ts');
  const readout = read('../src/ui/readout-state.ts');
  const companions = read('../src/creature/companions.ts');

  assert.match(capture, /readonly frameAspect\?: number \| null/);
  assert.match(webcam, /get frameAspect\(\): number \| null/);
  assert.match(main, /const sourceAspect = captureAspect\(capture\)/);
  assert.match(main, /tracker\.update\([^;]*inference\.dt, sourceAspect\)/);
  assert.match(main, /framer\.update\(measured, dt, \{ cameraFraming: camFraming, aspect: sourceAspect \}\)/);
  assert.match(main, /preview\?\.update\(measured, dt, sourceAspect\)/);
  assert.match(main, /aspect: sourceAspect/);
  assert.match(main, /lateralEvidence\(raw, sourceAspect\)/);
  assert.match(main, /readout\?\.update\(measured, lastFeatures, capture\.fps, dt, sourceAspect\)/);
  assert.match(preview, /lateralEvidence\(pose, input\.aspect\)/);
  assert.match(readout, /lateralEvidence\(pose, input\.aspect\)/);
  assert.match(companions, /classifier\.update\(raw, dt, \{ aspect: ctx\.aspect \}\)/);
});
