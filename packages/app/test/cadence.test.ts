/** worker 与主线程降级必须服从同一个推理频率上限。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cadenceDue } from '../src/capture/cadence.ts';

test('推理节拍：第一帧立即；没到间隔不跑；坏输入不放开无限推理', () => {
  assert.equal(cadenceDue(100, Number.NEGATIVE_INFINITY, 15), true);
  assert.equal(cadenceDue(150, 100, 15), false);
  assert.equal(cadenceDue(165, 100, 15), true, '保留 2ms rAF 抖动余量');
  assert.equal(cadenceDue(Number.NaN, 100, 15), false);
  assert.equal(cadenceDue(110, 100, Number.NaN), false, '坏频率退到默认节拍，不是每帧都跑');
});

test('webcam 的 worker 与主线程降级都经过同一个 cadenceDue', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/capture/webcam.ts', import.meta.url)), 'utf8');
  const calls = source.match(/cadenceDue\(/g) ?? [];
  assert.equal(calls.length, 2, 'worker #send 与主线程 #infer 必须各有一处节拍闸');
});
