/** worker 与主线程降级必须服从同一个推理频率上限。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cadenceDue, mainThreadInferenceDue } from '../src/capture/cadence.ts';

test('推理节拍：第一帧立即；没到间隔不跑；坏输入不放开无限推理', () => {
  assert.equal(cadenceDue(100, Number.NEGATIVE_INFINITY, 15), true);
  assert.equal(cadenceDue(150, 100, 15), false);
  assert.equal(cadenceDue(165, 100, 15), true, '保留 2ms rAF 抖动余量');
  assert.equal(cadenceDue(Number.NaN, 100, 15), false);
  assert.equal(cadenceDue(110, 100, Number.NaN), false, '坏频率退到默认节拍，不是每帧都跑');
});

test('webcam 的 worker 与主线程降级都经过同一个 cadenceDue', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/capture/webcam.ts', import.meta.url)), 'utf8');
  assert.equal((source.match(/cadenceDue\(/g) ?? []).length, 1, 'worker #send 必须经过共享节拍闸');
  assert.equal((source.match(/mainThreadInferenceDue\(/g) ?? []).length, 1,
    '主线程 #infer 必须经过同时认图重建状态的节拍闸');
  assert.match(source, /mainThreadInferenceDue\(this\.#mainPeopleResource\?\.controller\.busy \?\? false,/,
    '主线程必须把真实的 setOptions 在途状态接进互斥闸');
});

test('主线程图重建期间不 detect，成功或失败收口后下一份到期帧恢复', async () => {
  let resolve!: () => void;
  const gate = new Promise<void>((yes) => { resolve = yes; });
  let reconfiguring = true;
  const settled = gate.catch(() => {}).finally(() => { reconfiguring = false; });
  let detects = 0;
  const tryDetect = () => {
    if (mainThreadInferenceDue(reconfiguring, 100, Number.NEGATIVE_INFINITY, 30)) detects += 1;
  };

  tryDetect();
  tryDetect();
  assert.equal(detects, 0, 'setOptions 未完成时仍进入 detectForVideo');
  resolve();
  await settled;
  tryDetect();
  assert.equal(detects, 1, 'setOptions 完成后没有恢复推理');

  // 拒绝也必须释放闸；真实错误由 WebcamCapture 写进 lastError，而不是永久停推理。
  reconfiguring = true;
  const failed = Promise.reject(new Error('graph rebuild failed')).catch(() => {}).finally(() => { reconfiguring = false; });
  await failed;
  tryDetect();
  assert.equal(detects, 2, 'setOptions 失败后把主线程推理永久锁死');
});
