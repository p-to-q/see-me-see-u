import test from 'node:test';
import assert from 'node:assert/strict';
import { writeInstanceColor } from '../src/creature/instance-color.ts';

test('稳定单人白色不脏缓冲；颜色只在实际变化的那一次变脏', () => {
  const colors = new Float32Array(6).fill(1);
  assert.equal(writeInstanceColor(colors, 0, null), false);
  assert.equal(writeInstanceColor(colors, 1, [0.4, 0.5, 0.6]), true);
  assert.equal(writeInstanceColor(colors, 1, [0.4, 0.5, 0.6]), false);
  assert.deepEqual([...colors], [...new Float32Array([1, 1, 1, 0.4, 0.5, 0.6])]);
});

test('坏颜色被钳住，坏下标不写也不抛', () => {
  const colors = new Float32Array(3).fill(0);
  assert.equal(writeInstanceColor(colors, -1, [1, 1, 1]), false);
  assert.equal(writeInstanceColor(colors, 0, [Number.NaN, -2, 3]), true);
  assert.deepEqual([...colors], [1, 0, 1]);
});
