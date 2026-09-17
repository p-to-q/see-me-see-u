/**
 * 多人跟踪的时钟必须来自推理，不是渲染。否则 30Hz 的同一份结果在 120Hz 屏上
 * 会被当成四次观测，出生、换人和自动探测都比真实证据快四倍。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { freshInference } from '../src/capture/inference-clock.ts';
import { createPeopleTracker } from '../../core/src/people.ts';
import { stepProbe, type ProbeState } from '../../core/src/people-probe.ts';
import { PEOPLE } from '../../core/src/tuning.ts';
import { person, WHOLE } from '../../core/test/framing-people.ts';

const MAIN = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');

test('主线：tracker 与自动探测都只在 fresh inference 上推进', () => {
  assert.match(MAIN, /freshInference\(/, '主线没有区分新推理与缓存结果');
  assert.doesNotMatch(MAIN, /tracker\.update\(capture\.latestAll/, 'tracker 仍在每个 rAF 重喂缓存结果');
  assert.match(MAIN, /peopleProbe && people && cameraOn && inference/,
    '自动探测仍会在没有新推理时累计确认时间');
  assert.match(MAIN, /stepProbe\([^]*dt:\s*inference\.dt/,
    '自动探测没有使用真实推理间隔');
});

test('一份缓存结果在 120Hz 被读 3 秒：只算一次观测，不能把 tentative 轨迹催熟', () => {
  const tracker = createPeopleTracker({ cap: 2 });
  const pose = person(WHOLE);
  let stamp = Number.NaN;
  for (let frame = 0; frame < 360; frame++) {
    const tick = freshInference(stamp, 1000, pose.t, 1 / 120);
    if (!tick) continue;
    stamp = tick.stamp;
    tracker.update([pose], tick.dt);
  }
  assert.equal(tracker.current.tracks.length, 1);
  assert.equal(tracker.current.tracks[0].state, 'tentative');
  assert.equal(tracker.current.selected.length, 0, '旧结果被重复计时后拿到了身体');

  for (let i = 1; i <= Math.ceil((PEOPLE.birthSeconds + 0.1) * 30); i++) {
    const tick = freshInference(stamp, 1000 + i * (1000 / 30), pose.t, 1 / 120)!;
    stamp = tick.stamp;
    tracker.update([pose], tick.dt);
  }
  assert.equal(tracker.current.tracks[0].state, 'confirmed', '新的 30Hz 推理没有按真实时间转正');
  assert.equal(tracker.current.selected.length, 1);
});

test('自动人数确认：缓存 3 秒不累计；只有新推理连续够时才升档', () => {
  let state: ProbeState = {
    level: 1, phase: 'probing', clock: 0, held: 0, idleHeld: 0, hint: 0, hintLevel: 0,
  };
  let stamp = Number.NaN;
  for (let frame = 0; frame < 360; frame++) {
    const tick = freshInference(stamp, 2000, 2000, 1 / 120);
    if (!tick) continue;
    stamp = tick.stamp;
    state = stepProbe(state, { dt: tick.dt, selectedCount: 2 }).state;
  }
  assert.equal(state.level, 1, '同一份多人结果被重复读后误升档');

  for (let i = 1; i <= Math.ceil((PEOPLE.probeConfirmSeconds + 0.1) * 30); i++) {
    const tick = freshInference(stamp, 2000 + i * (1000 / 30), 2000, 1 / 120)!;
    stamp = tick.stamp;
    state = stepProbe(state, { dt: tick.dt, selectedCount: 2 }).state;
  }
  assert.equal(state.level, 2, '新的多人推理连续够时没有升档');
});

test('推理时刻：优先 capture.inferredAt，缺失时退到 pose.t；重复、倒退和坏值都忽略', () => {
  assert.deepEqual(freshInference(Number.NaN, 1000, 7, 1 / 60), { stamp: 1000, dt: 1 / 60 });
  assert.equal(freshInference(1000, 1000, 1001, 1 / 60), null, 'capture 时刻没变，不能拿 pose 绕过判重');
  assert.equal(freshInference(1000, 999, 1001, 1 / 60), null);
  assert.deepEqual(freshInference(Number.NaN, undefined, 77, 1 / 60), { stamp: 77, dt: 1 / 60 });
  assert.equal(freshInference(Number.NaN, Number.NaN, Number.NaN, 1 / 60), null);
  assert.doesNotThrow(() => freshInference(1000, Number.POSITIVE_INFINITY, undefined, Number.NaN));
});
