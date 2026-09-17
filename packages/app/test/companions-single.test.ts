/** 自动人数模式最常见的稳定单人路径：没有第二具身体时不该每个 rAF 建多人容器。 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { PeopleFrame } from '../../core/src/people.ts';
import { PEOPLE } from '../../core/src/tuning.ts';
import { createCompanions, createPipes, type CompanionContext } from '../src/creature/companions.ts';

const SINGLE: PeopleFrame = { tracks: [], selected: [1], primary: 1 };
const MULTI: PeopleFrame = { tracks: [], selected: [1, 2], primary: 1 };
const CONTEXT: CompanionContext = {
  dt: 1 / 120,
  freshInference: true,
  plan: 'rig',
  drift: 0,
  refineOn: false,
  vitalityOn: false,
  bodies: 1,
  scale: 1,
};

test('稳定单人 360 个渲染帧复用同一个空结果与空数组', () => {
  const companions = createCompanions({ seed: () => 1 });
  const probe = companions.stableSingle(SINGLE);
  assert.ok(probe, '完整上下文构造前没能命中稳定单人');
  const first = companions.update(SINGLE, CONTEXT);
  assert.equal(first, probe);
  assert.equal(first.primaryX, 0);
  assert.deepEqual(first.companions, []);

  for (let frame = 1; frame < 360; frame++) {
    const next = companions.update(SINGLE, CONTEXT);
    assert.equal(next, first, `第 ${frame} 帧重新分配了单人结果`);
    assert.equal(next.companions, first.companions, `第 ${frame} 帧重新分配了空伴随数组`);
  }
});

test('第二人或退场残影存在时立即退出单人快路', () => {
  const multi = createCompanions({ seed: () => 1 });
  const stable = multi.update(SINGLE, CONTEXT);
  assert.notEqual(multi.update(MULTI, CONTEXT), stable, '第二人被错误吞进单人快路');

  const retiring = createCompanions({ seed: () => 1 });
  const rest = retiring.update(SINGLE, CONTEXT);
  retiring.retire(9, createPipes(), null, 0);
  assert.notEqual(retiring.update(SINGLE, CONTEXT), rest, '退场中的旧主身体被单人快路跳过');
});

test('多人站位回到单人后连续归中并重新进入快路', () => {
  const samples = new Map<number, number[]>();
  for (const hz of [30, 60, 120]) {
    const companions = createCompanions({ seed: () => 1 });
    companions.retire(1, createPipes(), null, 0.5);
    companions.takePipes(1);

    let previous = 0.5;
    let settled = false;
    const context = { ...CONTEXT, dt: 1 / hz };
    for (let frame = 0; frame < hz * 4; frame++) {
      const result = companions.update(SINGLE, context);
      assert.ok(Math.abs(result.primaryX) <= Math.abs(previous) + 1e-9, `${hz}Hz 回中线时反向远离了目标`);
      const elapsed = (frame + 1) / hz;
      if (elapsed === 0.5 || elapsed === 1 || elapsed === 2) {
        const at = samples.get(elapsed) ?? [];
        at.push(result.primaryX);
        samples.set(elapsed, at);
      }
      if (result.primaryX === 0) {
        const lastStep = PEOPLE.slotRestSpeedEpsilon / hz;
        assert.ok(Math.abs(previous) <= PEOPLE.slotRestEpsilon + lastStep,
          `${hz}Hz 还离中线太远就归零了`);
        assert.equal(companions.update(SINGLE, context), result, `${hz}Hz 归中后没有恢复可复用的单人结果`);
        settled = true;
        break;
      }
      previous = result.primaryX;
    }
    assert.equal(settled, true, `${hz}Hz 四秒后仍未回到稳定单人快路`);
  }
  for (const [elapsed, positions] of samples) {
    assert.equal(positions.length, 3);
    assert.ok(Math.max(...positions) - Math.min(...positions) < 1e-9,
      `${elapsed}s 时的回中位置随帧率改变`);
  }
});
