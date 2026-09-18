import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  commitRelease, INITIAL_RELEASE_STATE, planRelease, type ReleaseState,
} from '../src/creature/release-policy.ts';

test('release 策略: 第一件真正开演的手消费唯一名额，其余身体结构永远原位', () => {
  let state: ReleaseState = INITIAL_RELEASE_STATE;
  for (const slot of ['footL', 'spine', 'joint', 'upperArmR'] as const) {
    assert.equal(planRelease(state, slot), 'in-place', `${slot} 被策略允许脱离`);
  }

  assert.equal(planRelease(state, 'handL'), 'hand-release');
  state = commitRelease(state, null);               // 同件 / 占位 no-op 没有真正开演
  assert.equal(planRelease(state, 'handR'), 'hand-release', '失败请求偷走了唯一一次');
  state = commitRelease(state, 'in-place');
  assert.equal(planRelease(state, 'handR'), 'hand-release', '渲染边界降级也偷走了唯一一次');

  state = commitRelease(state, 'hand-release');
  assert.equal(state.handReleased, true);
  assert.equal(planRelease(state, 'handL'), 'in-place');
  assert.equal(planRelease(state, 'handR'), 'in-place');
  assert.equal(planRelease(INITIAL_RELEASE_STATE, 'handR'), 'hand-release', '下一场没有重新获得名额');
});

test('release 接线: 主身体消费 motion，伴随身体保持原位，确认后才提交策略', () => {
  const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const creature = read('../src/creature/creature.ts');
  const primary = creature.slice(creature.indexOf('// 3. 这一帧每个槽位画什么'), creature.indexOf('// 4. 装配'));
  const companions = creature.slice(creature.indexOf('// 4b. 伴随身体'), creature.indexOf('// 5. 分桶'));
  assert.match(primary, /replaceRenders\(key, s\.from, s\.to, s\.t, pres, s\.motion\)/,
    '主身体没有消费 Swap.motion');
  assert.doesNotMatch(companions, /s\.motion/, '伴随身体跟着主身体一起放手');

  const main = read('../src/main.ts');
  const event = main.slice(main.indexOf('const requested = planRelease'), main.indexOf('if (accepted) sound.tierUp'));
  const replaceAt = event.indexOf('creature.replace(');
  const commitAt = event.indexOf('commitRelease(');
  assert.ok(replaceAt >= 0 && commitAt > replaceAt, '策略在身体确认开演前就消费了名额');
});
