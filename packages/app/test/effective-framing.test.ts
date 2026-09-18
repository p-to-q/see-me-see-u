import test from 'node:test';
import assert from 'node:assert/strict';

import type { FramingDecision } from '../../core/src/autoframe.ts';
import { person, SEATED } from '../../core/test/framing-people.ts';
import { createSim } from '../dev/framing-sim.ts';
import { resolveEffectiveFraming } from '../src/stage/effective-framing.ts';

const UPPER: FramingDecision = {
  policy: 'auto', mode: 'upper', shot: 'upper', holdLegs: true, upperIsIntended: true,
};
const FULL: FramingDecision = {
  policy: 'full', mode: 'upper', shot: 'full', holdLegs: true, upperIsIntended: false,
};

test('有效取景：单人人形保留原始景别，腿安全策略不被第二次推导', () => {
  assert.deepEqual(resolveEffectiveFraming(UPPER, {
    plan: 'rig', planDrift: 0, hasCompanions: false, cameraFraming: false,
  }), {
    stageShot: 'upper', shotWhy: 'decision', holdLegs: true, lowerBodyOptional: true,
  });
  assert.deepEqual(resolveEffectiveFraming(FULL, {
    plan: 'rig', planDrift: 0, hasCompanions: false, cameraFraming: false,
  }), {
    stageShot: 'full', shotWhy: 'decision', holdLegs: true, lowerBodyOptional: false,
  });
});

test('有效取景：非人形漂移与真正的伴随身体都统一强制全景', () => {
  const bodyPlan = resolveEffectiveFraming(UPPER, {
    plan: 'quadruped', planDrift: Number.MIN_VALUE, hasCompanions: false, cameraFraming: false,
  });
  assert.equal(bodyPlan.stageShot, 'full');
  assert.equal(bodyPlan.shotWhy, 'body-plan');
  assert.equal(bodyPlan.holdLegs, true, '强制全景不等于放开画外的坏腿');
  assert.equal(bodyPlan.lowerBodyOptional, false);

  const group = resolveEffectiveFraming(UPPER, {
    plan: 'quadruped', planDrift: 0.6, hasCompanions: true, cameraFraming: false,
  });
  assert.equal(group.stageShot, 'full');
  assert.equal(group.shotWhy, 'group', '多人是当场最直接的全景原因');
  assert.equal(group.lowerBodyOptional, false);
});

test('有效取景：人形比例变化不是非人形，显式 rig / stub / towering 仍允许中景', () => {
  for (const plan of ['rig', { kind: 'rig', head: 1.3 }, 'stub', 'towering'] as const) {
    const out = resolveEffectiveFraming(UPPER, {
      plan, planDrift: 1, hasCompanions: false, cameraFraming: false,
    });
    assert.equal(out.stageShot, 'upper');
    assert.equal(out.shotWhy, 'decision');
  }
});

test('有效取景：摄像头自己裁腿时不误报，但不擅自把舞台推成中景', () => {
  const out = resolveEffectiveFraming(FULL, {
    plan: 'rig', planDrift: 0, hasCompanions: false, cameraFraming: true,
  });
  assert.equal(out.stageShot, 'full');
  assert.equal(out.lowerBodyOptional, true);
});

test('有效取景：坏 drift 统一安全退到全景，不把 NaN / 越界当成人形', () => {
  for (const planDrift of [Number.NaN, -0.01, 1.01, Number.POSITIVE_INFINITY]) {
    const out = resolveEffectiveFraming(UPPER, {
      plan: 'rig', planDrift, hasCompanions: false, cameraFraming: false,
    });
    assert.equal(out.stageShot, 'full');
    assert.equal(out.shotWhy, 'invalid-plan');
    assert.equal(out.lowerBodyOptional, false);
  }
});

test('取景工作台复用正式解析器：原始 upper 被身体方案或同伴覆盖时，景别和裁切一起回全景', () => {
  for (const input of [
    { planDrift: 1, plan: 'quadruped', companions: 0, why: 'body-plan' },
    { planDrift: 0, plan: 'rig', companions: 1, why: 'group' },
  ] as const) {
    const frame = createSim().step({
      pose: person(SEATED), dt: 1 / 30, policy: 'upper',
      planDrift: input.planDrift, plan: input.plan, companions: input.companions,
    });
    assert.equal(frame.decision.shot, 'upper', '夹具没有制造原始 / 有效分歧');
    assert.equal(frame.shot, 'full');
    assert.equal(frame.effective.shotWhy, input.why);
    assert.equal(frame.crop.active, false, '舞台已经全景，小屏仍在放大');
    assert.equal(frame.effective.holdLegs, true);
  }
});

test('取景工作台复用正式多人让位：有同伴时横向不再追主身体', () => {
  const sim = createSim();
  const offCenter = person({ ...SEATED, cx: 0.8 });
  let frame = sim.step({ pose: offCenter, dt: 1 / 60, policy: 'upper', companions: 1 });
  for (let i = 1; i < 120; i++) {
    frame = sim.step({ pose: offCenter, dt: 1 / 60, policy: 'upper', companions: 1 });
  }
  assert.equal(frame.effective.shotWhy, 'group');
  assert.equal(frame.lateral.why, 'yield');
  assert.ok(Math.abs(frame.lateral.x) < 1e-6, `多人让位后仍横移 ${frame.lateral.x}`);
});
