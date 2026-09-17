/** 浏览器侧自动人数边界：稳定主身份、真实在场证据、性能预算与低频探测。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPeopleTracker } from '../../core/src/people.ts';
import { stepProbe, type ProbeState } from '../../core/src/people-probe.ts';
import { CAPTURE, PEOPLE } from '../../core/src/tuning.ts';
import { person, WHOLE } from '../../core/test/framing-people.ts';
import {
  canRunPeopleProbe, peopleProbeCadence, shouldStepPeopleProbe, trackedPrimaryOrSingleFallback,
  visiblePrimaryPose, visibleSelectedCount,
} from '../src/capture/people-probe-runtime.ts';

const DT = 1 / 30;
const probing = (): ProbeState => ({
  level: 1, floor: 1, phase: 'probing', clock: 0, held: 0, topHeld: 0,
  idleHeld: 0, hint: 0, hintLevel: 0,
});

test('探测窗里 MediaPipe 顺序每帧互换，主姿态仍跟 tracker 的稳定 id', () => {
  const tracker = createPeopleTracker({ cap: 3 });
  const left = person({ ...WHOLE, cx: 0.28 });
  const right = person({ ...WHOLE, cx: 0.72 });
  let frame = tracker.current;
  let primaryX: number | null = null;
  for (let i = 0; i < 30; i++) {
    frame = tracker.update(i % 2 ? [right, left] : [left, right], DT);
    if (frame.primary === null) continue;
    const pose = visiblePrimaryPose(frame);
    assert.ok(pose, '已有 primary 却取不到这一帧可见的主姿态');
    const x = (pose.screen![23]!.x + pose.screen![24]!.x) / 2;
    primaryX ??= x;
    assert.ok(Math.abs(x - primaryX) < 1e-6, '主通道跟着数组第 0 项跳到了另一个人');
  }
  assert.notEqual(frame.primary, null);
  assert.ok(primaryX === 0.28 || primaryX === 0.72);
});

test('grace 里的 selected 轨迹不算在场：路人离开后不能靠旧身份升档', () => {
  const tracker = createPeopleTracker({ cap: 3 });
  const left = person({ ...WHOLE, cx: 0.28 });
  const right = person({ ...WHOLE, cx: 0.72 });
  let state = probing();
  let frame = tracker.current;

  // 两个人出现得足够让 tracker 转正，但不够 probeConfirmSeconds。
  for (let i = 0; i < 21; i++) {
    frame = tracker.update([left, right], DT);
    state = stepProbe(state, { dt: DT, selectedCount: visibleSelectedCount(frame) }).state;
  }
  assert.equal(frame.selected.length, 2);

  // 第二人离开；tracker 在 grace 内仍保留 selected 身份，人数证据必须只看 missing===0。
  for (let i = 0; i < 24; i++) {
    frame = tracker.update([left], DT);
    state = stepProbe(state, { dt: DT, selectedCount: visibleSelectedCount(frame) }).state;
  }
  assert.equal(frame.selected.length, 2, '反证没有进入 selected + missing 的 grace 状态');
  assert.equal(visibleSelectedCount(frame), 1);
  assert.ok(frame.tracks.some((t) => t.selected && t.missing > 0));
  assert.equal(state.level, 1, '已经离开的路人被误确认成第二个人');
});

test('单人快速横移失配：检测器仍只有一人时用 latest，不让身体冻结；多人时不乱换身份', () => {
  const tracker = createPeopleTracker({ cap: 3 });
  const left = person({ ...WHOLE, cx: 0.16 });
  const right = person({ ...WHOLE, cx: 0.84 });
  let frame = tracker.current;
  for (let i = 0; i < 20; i++) frame = tracker.update([left], DT);
  assert.notEqual(frame.primary, null);

  frame = tracker.update([right], DT);
  assert.equal(visiblePrimaryPose(frame), null, '反证没有进入旧 primary missing grace');
  assert.equal(trackedPrimaryOrSingleFallback(frame, right, 1, 1), right,
    '有效的唯一单人结果没有接住短暂失配');
  assert.equal(trackedPrimaryOrSingleFallback(frame, right, 2, 1), null,
    '检测到多人时不能拿数组第 0 项冒充稳定 primary');
  assert.equal(trackedPrimaryOrSingleFallback(frame, right, 1, 2), null,
    '已确认多人时不能退回无身份的 latest');
});

test('单人优先预算：只有前台、无降级、无可见慢帧时才探测', () => {
  const calm = {
    active: true, visible: true, throttled: false, degraded: false,
    governorLevel: 0, frameMs: 16.7,
  };
  assert.equal(canRunPeopleProbe(calm), true);
  assert.equal(canRunPeopleProbe({ ...calm, active: false }), false);
  assert.equal(canRunPeopleProbe({ ...calm, visible: false }), false);
  assert.equal(canRunPeopleProbe({ ...calm, throttled: true }), false);
  assert.equal(canRunPeopleProbe({ ...calm, degraded: true }), false);
  assert.equal(canRunPeopleProbe({ ...calm, governorLevel: 1 }), false);
  assert.equal(canRunPeopleProbe({ ...calm, frameMs: 30 }), false);
  assert.equal(canRunPeopleProbe({ ...calm, frameMs: Number.NaN }), false);
});

test('探测窗降频但不低于现有插值能平顺覆盖的频率', () => {
  assert.equal(peopleProbeCadence(CAPTURE.targetHz, false), CAPTURE.targetHz);
  assert.equal(peopleProbeCadence(CAPTURE.targetHz, true), PEOPLE.probeInferenceHz);
  assert.equal(peopleProbeCadence(10, true), 10, '治理器已经更低时不能反向抬频');
  assert.ok(1 / PEOPLE.probeInferenceHz <= CAPTURE.interpDelayMax,
    '探测频率低到超过姿态时钟插值上限，单人身体会在后台探测时卡顿');
});

test('稳定 idle 的缓存渲染帧跳过探测，窗口与提示仍逐帧推进', () => {
  const idle = { ...probing(), phase: 'idle' as const };
  assert.equal(shouldStepPeopleProbe(false, idle), false);
  assert.equal(shouldStepPeopleProbe(true, idle), true);
  assert.equal(shouldStepPeopleProbe(false, probing()), true, '探测窗不能错过卡顿当帧');
  assert.equal(shouldStepPeopleProbe(false, { ...idle, hint: 1 }), true, '提示必须按 UI 时钟收起');
});
