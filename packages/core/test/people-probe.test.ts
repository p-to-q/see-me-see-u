/**
 * 自动人数探测。证明先保住单人稳定、一扇窗可以 1→3、擦肩不升档、
 * 久不在场能直接收回到实际人数，而且不越过场合下限。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProbeState, stepProbe, type ProbeState } from '../src/people-probe.ts';
import { PEOPLE } from '../src/tuning.ts';

const HZ = 30;
const DT = 1 / HZ;

function run(
  state: ProbeState,
  seconds: number,
  selectedAt: (t: number) => number,
  canProbeAt: (t: number) => boolean = () => true,
) {
  let s = state;
  let t = 0;
  const steps: Array<{ target: number; justEscalated: boolean; hint: number; level: number }> = [];
  while (t < seconds) {
    const r = stepProbe(s, { dt: DT, uiDt: DT, selectedCount: selectedAt(t), canProbe: canProbeAt(t) });
    s = r.state;
    steps.push({ target: r.target, justEscalated: r.justEscalated, hint: s.hint, level: s.level });
    t += DT;
  }
  return { state: s, steps };
}

test('先让单人稳定，再看到 hardMax；没有新人就收回，之后才按 interval 周期再看', () => {
  const initial = createProbeState(1, 1);
  assert.equal(initial.phase, 'idle');
  const settling = run(initial, PEOPLE.probeInitialDelaySeconds - DT * 2, () => 1);
  assert.ok(settling.steps.every((s) => s.target === 1), '摄像头刚起来时不应重建三人图');
  const first = run(settling.state, DT * 4, () => 1);
  assert.ok(first.steps.some((s) => s.target === PEOPLE.hardMax), '单人稳定期后应打开满档发现');

  const closed = run(first.state, PEOPLE.probeWindowSeconds + 0.1, () => 1);
  assert.equal(closed.state.level, 1);
  assert.equal(closed.state.phase, 'idle');
  assert.equal(closed.steps.at(-1)?.target, 1);
  assert.ok(!closed.steps.some((s) => s.justEscalated));

  const reopened = run(closed.state, PEOPLE.probeIntervalSeconds + 0.1, () => 1);
  assert.ok(reopened.steps.some((s) => s.target === PEOPLE.hardMax), '稳态后仍要定期重新发现');
});

test('两个人稳定入选够久才升到 2，并且只提示一次', () => {
  const { state, steps } = run(
    createProbeState(1, 1),
    PEOPLE.probeInitialDelaySeconds + PEOPLE.probeWindowSeconds,
    () => 2,
  );
  assert.equal(state.level, 2);
  assert.equal(state.hintLevel, 2);
  assert.equal(steps.filter((s) => s.justEscalated).length, 1);
  assert.ok(steps.find((s) => s.justEscalated)!.hint > 0);
});

test('三个人从开机就在画里：一扇窗直接 1→3，不经过 2 再等12秒', () => {
  const { state, steps } = run(
    createProbeState(1, 1),
    PEOPLE.probeInitialDelaySeconds + PEOPLE.probeWindowSeconds,
    () => 3,
  );
  assert.equal(state.level, PEOPLE.hardMax);
  assert.equal(state.hintLevel, PEOPLE.hardMax);
  assert.ok(steps.some((s) => s.justEscalated && s.level === PEOPLE.hardMax));
  assert.ok(!steps.some((s) => s.justEscalated && s.level === 2), '不应先停在 2');
});

test('第二个人稳定、第三个人只闪过：窗尾收下 2，不因第三人不稳而放弃全部证据', () => {
  const { state } = run(createProbeState(1, 1), PEOPLE.probeInitialDelaySeconds + PEOPLE.probeWindowSeconds + 0.1, (t) => {
    if (t < PEOPLE.probeInitialDelaySeconds) return 2;
    const u = t - PEOPLE.probeInitialDelaySeconds;
    const frame = Math.round(u * HZ);
    return frame % 15 === 0 ? 3 : 2;
  });
  assert.equal(state.level, 2);
});

test('一次擦肩而过（够不上 confirm）不会升档', () => {
  const blipEnd = Math.max(0.05, PEOPLE.probeConfirmSeconds - 0.3);
  const { state, steps } = run(
    createProbeState(1, 1),
    PEOPLE.probeInitialDelaySeconds + PEOPLE.probeWindowSeconds + 0.1,
    (t) => (t >= PEOPLE.probeInitialDelaySeconds && t < PEOPLE.probeInitialDelaySeconds + blipEnd ? 2 : 1),
  );
  assert.equal(state.level, 1);
  assert.ok(!steps.some((s) => s.justEscalated));
});

test('顶格之后不再开探测窗', () => {
  const top = createProbeState(PEOPLE.hardMax, 1);
  const { steps } = run(top, PEOPLE.probeIntervalSeconds * 3, () => PEOPLE.hardMax);
  assert.ok(steps.every((s) => s.target === PEOPLE.hardMax));
});

test('3 人只剩 1 人持续够久：一次直接回 1，不再用两个退档周期', () => {
  const { state } = run(createProbeState(3, 1), PEOPLE.probeDeescalateSeconds + 0.2, () => 1);
  assert.equal(state.level, 1);
});

test('退档不越过场合 floor：以 2 起步的现场最低仍是 2', () => {
  const { state } = run(createProbeState(3, 2), PEOPLE.probeDeescalateSeconds + 0.2, () => 1);
  assert.equal(state.level, 2);
});

test('坏输入不 throw：负 dt、NaN 人数、超大 dt', () => {
  const s = createProbeState(1, 1);
  assert.doesNotThrow(() => stepProbe(s, { dt: -1, selectedCount: Number.NaN }));
  assert.doesNotThrow(() => stepProbe(s, { dt: Number.NaN, selectedCount: -3 }));
  assert.doesNotThrow(() => stepProbe(s, { dt: 999, selectedCount: 99 }));
});

test('性能预算一紧就撤掉探测，并完整退避后再试', () => {
  const opened = run(createProbeState(1, 1), PEOPLE.probeInitialDelaySeconds + 0.1, () => 1);
  assert.equal(opened.state.phase, 'probing');
  const aborted = stepProbe(opened.state, { dt: DT, uiDt: DT, selectedCount: 1, canProbe: false });
  assert.equal(aborted.target, 1);
  assert.equal(aborted.state.phase, 'idle');
  assert.equal(aborted.state.clock, 0);

  const backoff = run(aborted.state, PEOPLE.probeIntervalSeconds - DT * 2, () => 1);
  assert.ok(backoff.steps.every((s) => s.target === 1));
  const retry = run(backoff.state, DT * 4, () => 1);
  assert.ok(retry.steps.some((s) => s.target === PEOPLE.hardMax));
});

test('探测还没开始时，没有性能余量只暂停倒计时，不抹掉首轮稳定期', () => {
  const initial = createProbeState(1, 1);
  const paused = run(initial, 1, () => 1, () => false);
  assert.equal(paused.state.phase, 'idle');
  assert.equal(paused.state.clock, initial.clock);

  const resumed = run(paused.state, PEOPLE.probeInitialDelaySeconds + 0.1, () => 1);
  assert.ok(resumed.steps.some((s) => s.target === PEOPLE.hardMax));
});

test('推理停住时提示仍按渲染时钟收起，不会永久挂着', () => {
  const confirmed = run(
    createProbeState(1, 1),
    PEOPLE.probeInitialDelaySeconds + PEOPLE.probeWindowSeconds,
    () => 2,
  );
  assert.ok(confirmed.state.hint > 0);
  let state = confirmed.state;
  for (let t = 0; t < PEOPLE.probeHintSeconds + 0.2; t += 1 / 60) {
    state = stepProbe(state, { dt: 0, uiDt: 1 / 60, selectedCount: 2 }).state;
  }
  assert.equal(state.hint, 0);
  assert.equal(state.hintLevel, 0);
});
