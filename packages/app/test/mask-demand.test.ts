/** 慢回路的 mask 是每位观众一张，不是从开机跑到关机的第二条推理链。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createMaskDemand } from '../src/capture/mask-demand.ts';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('mask demand：只在需求中发一帧，失败可重试，成功后停止', () => {
  const demand = createMaskDemand();
  assert.equal(demand.begin(true), null);

  demand.set(true);
  const generation = demand.begin(true);
  assert.equal(generation, 1);
  assert.equal(demand.begin(true), null, '一张 mask 在途时又发了第二张');

  assert.equal(demand.settle(generation!, false), false);
  assert.equal(demand.begin(true), generation, '掉了一帧后没有保留同一场的需求');
  assert.equal(demand.settle(generation!, true), true);
  assert.equal(demand.begin(true), null, '已经拿到一张后仍在继续分割');
});

test('mask demand：离场换 generation，旧 mask 晚到不能写给下一位', () => {
  const demand = createMaskDemand();
  demand.set(true);
  const oldGeneration = demand.begin(true)!;
  demand.set(false);
  demand.set(true);
  const nextGeneration = demand.begin(true)!;

  assert.notEqual(nextGeneration, oldGeneration);
  assert.equal(demand.settle(oldGeneration, true), false, '旧观众的 mask 被新场接受了');
  assert.equal(demand.inFlight, true, '旧结果误清了新观众的在途需求');
  assert.equal(demand.settle(nextGeneration, true), true);
});

test('mask demand 接线：启动不建分割图，slow reset 撤销需求并释放图像', () => {
  const capture = read('../src/capture/capture.ts');
  const webcam = read('../src/capture/webcam.ts');
  const worker = read('../src/capture/pose-worker.ts');
  const protocol = read('../src/capture/pose-protocol.ts');
  const slow = read('../src/slow/slow.ts');

  assert.match(capture, /takeMask\(\): ImageBitmap \| null/);
  assert.match(capture, /setMaskDemand\?\(wanted: boolean\): void/);
  assert.doesNotMatch(webcam, /MASK_EVERY_N_TICKS/);
  assert.doesNotMatch(webcam, /ImageSegmenter\.createFromOptions/,
    '主线程 fallback 仍在互动期建第二张 MediaPipe 图');
  assert.match(protocol, /type: 'segmenter-init'/);
  assert.match(protocol, /maskGeneration: number \| null/);
  assert.match(worker, /m\.type === 'segmenter-init'/);
  assert.doesNotMatch(worker, /if \(m\.segmenterModel\) void initSegmenter/,
    'worker 还在 pose ready 后无条件建分割图');
  assert.match(worker, /if \(segmenterStarted\) return/,
    '初始化失败后 slow 轮询还会反复建分割图');
  assert.match(worker, /result\.close\?\.\(\)/,
    'ImageSegmenterResult 没有在回调结束时释放');
  assert.match(slow, /setMaskDemand\(false\)/);
  assert.match(slow, /bitmap\.close\?\.\(\)/, 'slow 没释放已取得所有权的 ImageBitmap');
});
