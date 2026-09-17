/**
 * 多人跟踪的时钟必须来自推理，不是渲染。否则 30Hz 的同一份结果在 120Hz 屏上
 * 会被当成四次观测，出生、换人和自动探测都比真实证据快四倍。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { freshInference } from '../src/capture/inference-clock.ts';
import { createPeopleTracker, isFreshReacquisition } from '../../core/src/people.ts';
import { stepProbe, type ProbeState } from '../../core/src/people-probe.ts';
import { PEOPLE } from '../../core/src/tuning.ts';
import { person, WHOLE } from '../../core/test/framing-people.ts';
import { shouldStepPeopleProbe } from '../src/capture/people-probe-runtime.ts';

const MAIN = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
const COMPANIONS = readFileSync(fileURLToPath(new URL('../src/creature/companions.ts', import.meta.url)), 'utf8');

test('主线：tracker 与自动探测都只在 fresh inference 上推进', () => {
  assert.match(MAIN, /freshInference\(/, '主线没有区分新推理与缓存结果');
  assert.doesNotMatch(MAIN, /tracker\.update\(capture\.latestAll/, 'tracker 仍在每个 rAF 重喂缓存结果');
  assert.match(MAIN, /stepProbe\([^]*dt:\s*inference\?\.dt\s*\?\?\s*0/,
    '自动探测没有使用真实推理间隔');
  assert.match(MAIN, /selectedCount:\s*visibleSelectedCount\(crowd\)/,
    '自动探测把 grace 里已经 missing 的 selected 轨迹也算成在场');
  assert.doesNotMatch(MAIN, /selectedCount:\s*crowd\?\.selected\.length/);
  assert.match(MAIN, /trackerOwnsChannel[^]*trackedPrimaryOrSingleFallback\(crowd,\s*latest,\s*detectedPeopleCount,\s*peopleCap\)/,
    '探测窗没有稳定主身份，或单人短暂失配时没有受限的 latest 回退');
  assert.match(MAIN, /createProbeState\(peopleCap,\s*peopleCap\)/,
    '探测没有记住场合起步下限，未来 kiosk 从 2 起步时会错误退到 1');
  assert.match(MAIN, /people:\s*flags\.peopleAuto\s*\?\s*'auto'\s*:\s*String\(flags\.people\)/,
    '控件没有显示真实策略，会把自动误报成固定人数');
  assert.match(MAIN, /const inferredPeople = people && inference[^]*capture\.latestAll\?\.\(\)/,
    '多人快照仍在每个渲染帧读取并创建数组，而不是只随新推理更新');
  assert.doesNotMatch(MAIN, /let peoplePoses/,
    '主线不该在人数上限收缩后仍持有旧多人姿态数组');
  assert.match(MAIN, /detectedPeopleCount = Math\.min\(detectedPeopleCount, liveCap\)/,
    '人数上限收缩后没有同步截断缓存人数');
  assert.match(MAIN, /if \(people && crowdOut !== renderedCrowd\)/,
    '稳定单人快路的同一个空结果仍被每帧重复写进渲染器');
  assert.match(MAIN, /shouldStepPeopleProbe\(inference !== null, peopleProbe\.state\)/,
    '稳定 idle 时仍在每个缓存渲染帧分配人数探测状态');
  assert.match(MAIN, /isFreshReacquisition\(inference !== null, t\)/,
    '主身体 reacquired 事件没有被新推理门控');
  assert.match(COMPANIONS, /isFreshReacquisition\(ctx\.freshInference, t\)/,
    '伴随身体 reacquired 事件没有被新推理门控');
});

test('120Hz 渲染只按 30Hz 新推理读取多人快照', () => {
  let stamp = Number.NaN;
  let reads = 0;
  let cached: readonly number[] = [];
  const capture = { latestAll: (): readonly number[] => [++reads] };
  for (let frame = 0; frame < 360; frame++) {
    const inferenceStamp = 1000 + Math.floor(frame / 4) * (1000 / 30);
    const tick = freshInference(stamp, inferenceStamp, inferenceStamp, 1 / 120);
    if (tick) {
      stamp = tick.stamp;
      cached = capture.latestAll();
    }
    assert.equal(cached[0], reads || undefined);
  }
  assert.equal(reads, 90, '三秒 120Hz 渲染把 30Hz 快照读了不止 90 次');
});

test('120Hz / 30Hz：idle probe 与 reacquired 事件都只消费新推理', () => {
  const idle: ProbeState = {
    level: 1, floor: 1, phase: 'idle', clock: 0, held: 0, topHeld: 0,
    idleHeld: 0, hint: 0, hintLevel: 0,
  };
  let stamp = Number.NaN;
  let probeSteps = 0;
  let reacquiredResets = 0;
  for (let frame = 0; frame < 360; frame++) {
    const inferenceStamp = 1000 + Math.floor(frame / 4) * (1000 / 30);
    const tick = freshInference(stamp, inferenceStamp, inferenceStamp, 1 / 120);
    const fresh = tick !== null;
    if (tick) stamp = tick.stamp;
    if (shouldStepPeopleProbe(fresh, idle)) probeSteps++;
    const eventStillCached = Math.floor(frame / 4) === 0;
    if (isFreshReacquisition(fresh, { reacquired: eventStillCached })) reacquiredResets++;
  }
  assert.equal(probeSteps, 90);
  assert.equal(reacquiredResets, 1, '同一份 reacquired 推理被缓存渲染帧重复消费');
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
    level: 1, floor: 1, phase: 'probing', clock: 0, held: 0, topHeld: 0,
    idleHeld: 0, hint: 0, hintLevel: 0,
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
