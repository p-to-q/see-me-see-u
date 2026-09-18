import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALL_SLOT_KEYS } from '../../core/src/slots.ts';
import { THESEUS } from '../../core/src/tuning.ts';
import type { Rng, SlotKey } from '../../core/src/types.ts';
import { JOINT_CAPS } from '../src/creature/assemble.ts';
import {
  commitDetachment, INITIAL_DETACHMENT_STATE, planDetachment, type DetachmentState,
} from '../src/creature/detachment-policy.ts';
import { detachmentProfileFor, IN_PLACE_DETACHMENT, type TransitionReceipt } from '../src/creature/detachment.ts';

function rngOf(...values: number[]): Rng {
  let i = 0;
  const next = () => values[Math.min(i++, values.length - 1)] ?? 0;
  return {
    next,
    int(max) { return Math.floor(next() * Math.max(1, max)); },
    pick<T>(arr: readonly T[]): T { return arr[Math.min(arr.length - 1, Math.floor(next() * arr.length))]!; },
    weighted<T>(arr: readonly T[]): T { return this.pick(arr); },
  };
}

const receipt = (slot: SlotKey, applied = IN_PLACE_DETACHMENT): TransitionReceipt => ({
  slot, requested: applied, applied, degraded: false, reason: 'accepted',
});

test('脱离策略: 第一种语法仍由手建立，失败/no-op 不消费相遇状态', () => {
  let state: DetachmentState = INITIAL_DETACHMENT_STATE;
  for (const slot of ['footL', 'spine', 'joint', 'upperArmR'] as const) {
    assert.equal(planDetachment(state, { slot, overall: 1 }, rngOf(0)).profile, 'in-place', `${slot} 抢在手之前脱离`);
  }
  const hand = planDetachment(state, { slot: 'handL', overall: THESEUS.detachment.unlockOverall.terminal }, rngOf(0));
  assert.equal(hand.profile, 'terminal-release');
  state = commitDetachment(state, null);
  assert.equal(state, INITIAL_DETACHMENT_STATE, '没开演却推进了状态');
  state = commitDetachment(state, receipt('handL', hand));
  assert.equal(state.introduced, true);
  assert.equal(state.acceptedEvents, 1);
});

test('脱离策略: 17 根骨头和 joint 都有命名 profile，阶段前严格原位', () => {
  const expected = new Map<SlotKey, string>([
    ['head', 'terminal-release'], ['handL', 'terminal-release'], ['handR', 'terminal-release'],
    ['footL', 'terminal-release'], ['footR', 'terminal-release'],
    ['clavicleL', 'segment-release'], ['clavicleR', 'segment-release'], ['neck', 'segment-release'],
    ['upperArmL', 'segment-release'], ['upperArmR', 'segment-release'],
    ['foreArmL', 'segment-release'], ['foreArmR', 'segment-release'],
    ['thighL', 'segment-release'], ['thighR', 'segment-release'],
    ['shinL', 'segment-release'], ['shinR', 'segment-release'],
    ['spine', 'core-release'], ['joint', 'segment-release'],
  ]);
  assert.equal(expected.size, ALL_SLOT_KEYS.length);
  for (const slot of ALL_SLOT_KEYS) assert.equal(detachmentProfileFor(slot, slot === 'joint' ? 'shoulderL' : undefined), expected.get(slot), slot);

  const ready: DetachmentState = { acceptedEvents: 10, lastDetachedEvent: 0, introduced: true };
  for (const slot of ALL_SLOT_KEYS) {
    assert.notEqual(planDetachment(ready, { slot, overall: 1 }, rngOf(0, 0)).profile, 'in-place', `${slot} 没有可达脱离路径`);
  }
  const before = THESEUS.detachment.unlockOverall.segment - 1e-6;
  assert.equal(planDetachment(ready, { slot: 'foreArmL', overall: before }, rngOf(0)).profile, 'in-place');
  assert.equal(planDetachment(ready, { slot: 'foreArmL', overall: THESEUS.detachment.unlockOverall.segment }, rngOf(0)).profile,
    'segment-release');
  assert.equal(planDetachment(ready, { slot: 'spine', overall: THESEUS.detachment.unlockOverall.core - 1e-6 }, rngOf(0)).profile,
    'in-place');
  assert.equal(planDetachment(ready, { slot: 'spine', overall: THESEUS.detachment.unlockOverall.core }, rngOf(0)).profile,
    'core-release');
});

test('脱离策略: joint 只点名一个稳定关节名，核心 cap 与肢体 cap 走不同 profile', () => {
  const ready: DetachmentState = { acceptedEvents: 10, lastDetachedEvent: 0, introduced: true };
  const at = (name: string): number => {
    const i = JOINT_CAPS.findIndex((cap) => cap.joint === name);
    assert.ok(i >= 0, `夹具没有 ${name}`);
    return (i + 0.1) / JOINT_CAPS.length;
  };
  const shoulder = planDetachment(ready, { slot: 'joint', overall: 1 }, rngOf(at('shoulderL'), 0));
  assert.deepEqual([shoulder.member, shoulder.profile], ['shoulderL', 'segment-release']);
  const chest = planDetachment(ready, { slot: 'joint', overall: 1 }, rngOf(at('chest'), 0));
  assert.deepEqual([chest.member, chest.profile], ['chest', 'core-release']);
  for (const cap of JOINT_CAPS) {
    const plan = planDetachment(ready, { slot: 'joint', overall: 1 }, rngOf(at(cap.joint), 0));
    assert.equal(plan.member, cap.joint, `${cap.joint} 不可达`);
  }
  assert.ok(THESEUS.detachment.chance.terminal > THESEUS.detachment.chance.segment
    && THESEUS.detachment.chance.segment > THESEUS.detachment.chance.core,
  '后期开放被写成核心比末端更常见');
});

test('脱离策略: 两次脱离之间保留原位事件，概率边界与坏弧线不误触发', () => {
  const justDetached: DetachmentState = { acceptedEvents: 4, lastDetachedEvent: 4, introduced: true };
  assert.equal(planDetachment(justDetached, { slot: 'head', overall: 1 }, rngOf(0)).profile, 'in-place');
  const ready = { ...justDetached, acceptedEvents: 4 + THESEUS.detachment.minAcceptedGap };
  assert.equal(planDetachment(ready, { slot: 'head', overall: 1 }, rngOf(0)).profile, 'terminal-release');
  assert.equal(planDetachment(ready, { slot: 'head', overall: 1 }, rngOf(THESEUS.detachment.chance.terminal)).profile, 'in-place');
  assert.equal(planDetachment(ready, { slot: 'head', overall: Number.NaN }, rngOf(0)).profile, 'in-place');
});

test('脱离接线: 主身体消费 plan，伴随身体原位；receipt 后才提交，主身份交接收掉旧事件', () => {
  const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const creature = read('../src/creature/creature.ts');
  const primary = creature.slice(creature.indexOf('// 3. 这一帧每个槽位画什么'), creature.indexOf('// 4. 装配'));
  const companions = creature.slice(creature.indexOf('// 4b. 伴随身体'), creature.indexOf('// 5. 分桶'));
  assert.match(primary, /replaceRenders\(key, s\.from, s\.to, s\.t, pres, s\.detachment\)/);
  assert.doesNotMatch(companions, /s\.detachment/, '伴随身体跟着主身体一起脱离');

  const main = read('../src/main.ts');
  const event = main.slice(main.indexOf('const requested = planDetachment'), main.indexOf('if (receipt) sound.tierUp'));
  assert.ok(event.indexOf('creature.replace(') >= 0);
  assert.ok(event.indexOf('commitDetachment(') > event.indexOf('creature.replace('));
  assert.ok(event.indexOf('swapped.set(') > event.indexOf('creature.replace('), 'renderer 接纳前就提交了长期 genome');
  const handoff = main.slice(main.indexOf('const resetPrimaryTemporal'), main.indexOf('const applyGovernor'));
  assert.match(handoff, /creature\.settleDetachment\(\)/, '旧人的脱离会跳到新主人的 socket');
  assert.match(main, /contactPoints\(lastSkeleton, STAGE\.contactPoints, STAGE\.contactLiftRange, contactPartDetached\)/,
    '脱离后仍在按完整骨架画接触阴影或触发落脚声');
  assert.ok(main.indexOf('const contacts = contactPoints(') > main.indexOf('commitDetachment('),
    '接触点在当帧脱离 receipt 之前取样，会多留一帧假落点');
});
