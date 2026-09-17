/**
 * 运行中修改 MediaPipe `numPoses` 的时序守卫。
 *
 * 这不是一个普通的赋值：`setOptions()` 是异步重建图。探测窗可能在前一次
 * 还没完成时又改变目标，失败后还必须能对同一个数重试。因此 worker 一次只能
 * 重建一次，主线程只能在带 id 的成功回执后改“已生效”值。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface Request { requestId: number; numPoses: number }
interface Result extends Request { ok: boolean; error?: string }
interface Queue {
  submit(request: Request): void;
  readonly busy: boolean;
}

const posted: unknown[] = [];
Object.defineProperty(globalThis, 'self', {
  configurable: true,
  value: { onmessage: null, postMessage: (message: unknown) => posted.push(message) },
});
const workerModule = await import('../src/capture/pose-worker.ts') as unknown as {
  createReconfigureQueue?: (
    apply: (numPoses: number) => Promise<void>,
    reply: (result: Result) => void,
  ) => Queue;
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('numPoses worker queue: 一次只跑一个 setOptions，等待中只保留最新目标', async () => {
  assert.equal(typeof workerModule.createReconfigureQueue, 'function', 'worker 需要可取证的串行重配置队列');
  const gates = new Map([[2, deferred()], [1, deferred()]]);
  const applied: number[] = [];
  const replies: Result[] = [];
  let active = 0, maxActive = 0;
  const queue = workerModule.createReconfigureQueue!(async (n) => {
    active++;
    maxActive = Math.max(maxActive, active);
    applied.push(n);
    await gates.get(n)!.promise;
    active--;
  }, (result) => replies.push(result));

  queue.submit({ requestId: 10, numPoses: 2 });
  await turn();
  queue.submit({ requestId: 11, numPoses: 3 });
  queue.submit({ requestId: 12, numPoses: 1 });
  assert.deepEqual(applied, [2], '第一次没完成时不得并发 setOptions');

  gates.get(2)!.resolve();
  await turn();
  assert.deepEqual(applied, [2, 1], '等待的 3 已过时，只应用最新的 1');
  gates.get(1)!.resolve();
  await turn();

  assert.equal(maxActive, 1);
  assert.equal(queue.busy, false);
  assert.deepEqual(replies.map((r) => [r.requestId, r.ok]), [[11, false], [10, true], [12, true]]);
  assert.match(replies[0]!.error ?? '', /取代|过时|supersed/i);
});

test('numPoses worker queue: setOptions 失败要显式回执，同值下次仍可重试', async () => {
  assert.equal(typeof workerModule.createReconfigureQueue, 'function');
  let attempts = 0;
  const replies: Result[] = [];
  const queue = workerModule.createReconfigureQueue!(async () => {
    attempts++;
    if (attempts === 1) throw new Error('graph rebuild failed');
  }, (result) => replies.push(result));

  queue.submit({ requestId: 20, numPoses: 3 });
  await turn();
  queue.submit({ requestId: 21, numPoses: 3 });
  await turn();

  assert.equal(attempts, 2, '第一次失败不能把 3 伪装成已生效，阻止同值重试');
  assert.equal(replies[0]?.ok, false);
  assert.match(replies[0]?.error ?? '', /graph rebuild failed/);
  assert.equal(replies[1]?.ok, true);
});

test('webcam 只在匹配的成功 ack 后更新 applied，不再发送前乐观赋值', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/capture/webcam.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /engine\.numPoses\s*=\s*v\s*;\s*engine\.post/,
    '发 options 前就改 engine.numPoses 会把目标伪装成已生效');
  assert.match(source, /requestId/, '请求和 ack 必须能匹配，否则旧回执会覆盖新目标');
  assert.match(source, /m\.ok[\s\S]{0,300}engine\.numPoses\s*=/,
    '只有 worker 明确成功才能推进 applied numPoses');
  assert.match(source, /#mainPeopleRequest\s*=\s*null/,
    'stop/reset 必须使主线程降级路径的旧请求失效');
  assert.doesNotMatch(source, /setOptions\(\{ numPoses: v \}\\?\)\.catch\(\(\) => \{ \/\* 改不了/,
    '主线程降级路径也不得静默吞掉 setOptions 失败');
});
