/**
 * “合法拓扑”不等于“可自动向观众播放”。这里守住两道门：
 * 自动弧线绕开断链 radial，显式 `?plan=radial` 仍能进开发预览。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createArc } from '../../core/src/arc.ts';
import { BODY_PLANS } from '../../core/src/bodyplan.ts';
import { bodyAt, intentFromFlags, NO_INTENT } from '../src/shell/intent.ts';
import { readFlags } from '../src/shell/kiosk.ts';
import {
  PUBLIC_BODY_PLANS, QUARANTINED_AUTOMATIC_BODY_PLANS, automaticBodyPlan, bodyPlanFor,
} from '../src/creature/body-plan-policy.ts';

test('自动旅程只隔离 radial，不把开发方案从合法名单删掉', () => {
  assert.deepEqual(QUARANTINED_AUTOMATIC_BODY_PLANS, ['radial']);
  assert.deepEqual(PUBLIC_BODY_PLANS, BODY_PLANS.filter((plan) => plan !== 'radial'));
  assert.ok(BODY_PLANS.includes('radial'), '隔离不是删掉开发能力');
});

test('自动 radial 退回连通人形；参数化身材保留且不改入参', () => {
  assert.equal(automaticBodyPlan('radial'), 'rig');
  const declared = { kind: 'radial' as const, limb: 0.72, head: 1.35 };
  assert.deepEqual(automaticBodyPlan(declared), { kind: 'rig', limb: 0.72, head: 1.35 });
  assert.deepEqual(declared, { kind: 'radial', limb: 0.72, head: 1.35 });
  assert.equal(automaticBodyPlan('column'), 'column');
  assert.equal(automaticBodyPlan('future-shape'), 'future-shape', '不在产品策略层静默吞外部坏值');
});

test('显式 radial 叠加仍优先，URL 可继续做 look-dev 取证', () => {
  assert.equal(bodyPlanFor('radial', 'radial'), 'radial');
  const flags = readFlags('?plan=radial');
  assert.equal(flags.plan, 'radial');
  assert.equal(bodyPlanFor('radial', intentFromFlags(flags).form), 'radial');
});

test('90 秒弧线在 42.3s 开始形态漂移，但自动目标仍是连通身体', () => {
  const arc = createArc({ total: 90 });
  // Arc 与真帧循环一样会夹住过大 dt；用 60Hz 回放走到目标时刻，不绕过它的时间契约。
  let before = arc.state;
  for (let i = 0; i < 42.2 * 60; i++) before = arc.update(true, 1 / 60);
  const beforeBody = bodyAt(NO_INTENT, before);
  assert.equal(beforeBody.drift, 0);

  let after = before;
  for (let i = 0; i < 0.2 * 60; i++) after = arc.update(true, 1 / 60);
  const afterBody = bodyAt(NO_INTENT, after);
  assert.ok(afterBody.drift > 0, `42.4s 仍未开始漂移：${afterBody.drift}`);
  assert.equal(bodyPlanFor('radial', afterBody.override), 'rig');
});
