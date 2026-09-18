/** 人数重配置 owner 的 applied / desired / deadline 语义；不需要真的加载 MediaPipe。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReconfigureController,
  type ReconfigureRequest,
} from '../src/capture/reconfigure.ts';

function fakeClock(): {
  schedule: (task: () => void, ms: number) => number;
  cancel: (handle: unknown) => void;
  fire(): void;
  readonly delay: number;
} {
  let task: (() => void) | null = null;
  let delay = Number.NaN;
  return {
    schedule(next, ms) { task = next; delay = ms; return 1; },
    cancel() { task = null; },
    fire() { const next = task; task = null; next?.(); },
    get delay() { return delay; },
  };
}

test('重配置 owner：一次只发一个，等待中只追最后目标，成功才推进 applied', () => {
  const clock = fakeClock();
  const posted: ReconfigureRequest[] = [];
  const failures: string[] = [];
  const controller = createReconfigureController({
    initialNumPoses: 1,
    timeoutMs: 2500,
    post: (request) => posted.push(request),
    onFailure: (error) => failures.push(error),
    onTimeout: () => assert.fail('正常回执不应超时'),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });

  controller.request(3);
  controller.request(2);
  assert.deepEqual(posted.map((request) => request.numPoses), [3]);
  assert.equal(controller.applied, 1, '发送目标不能伪装成已经生效');
  assert.equal(controller.busy, true);

  controller.settle({ ...posted[0]!, ok: true });
  assert.deepEqual(posted.map((request) => request.numPoses), [3, 2]);
  assert.equal(controller.applied, 3);
  controller.settle({ ...posted[1]!, ok: true });
  assert.equal(controller.applied, 2);
  assert.equal(controller.busy, false);
  assert.deepEqual(failures, []);
});

test('重配置 owner：普通失败释放互斥，同值下一次显式请求可以重试', () => {
  const clock = fakeClock();
  const posted: ReconfigureRequest[] = [];
  const failures: string[] = [];
  let throwOnce = true;
  const controller = createReconfigureController({
    initialNumPoses: 1,
    timeoutMs: 2500,
    post: (request) => {
      posted.push(request);
      if (throwOnce) { throwOnce = false; throw new Error('post broke'); }
    },
    onFailure: (error) => failures.push(error),
    onTimeout: () => assert.fail('同步失败不应等 deadline'),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });

  controller.request(3);
  assert.equal(controller.busy, false);
  assert.equal(controller.applied, 1);
  assert.match(failures[0] ?? '', /post broke/);
  controller.request(3);
  assert.equal(posted.length, 2, '同值失败被错误当成已经生效');
  controller.settle({ ...posted[1]!, ok: false, error: 'graph rebuild failed' });
  assert.equal(controller.busy, false);
  assert.match(failures[1] ?? '', /graph rebuild failed/);
});

test('重配置 owner：deadline 是终态，迟到成功不能覆盖 applied 或启动下一目标', () => {
  const clock = fakeClock();
  const posted: ReconfigureRequest[] = [];
  const timeouts: Array<{ request: ReconfigureRequest; error: string }> = [];
  const controller = createReconfigureController({
    initialNumPoses: 1,
    timeoutMs: 2500,
    post: (request) => posted.push(request),
    onFailure: () => assert.fail('永不返回不是普通 reject'),
    onTimeout: (request, error) => timeouts.push({ request, error }),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });

  controller.request(3);
  controller.request(2);
  assert.equal(clock.delay, 2500);
  clock.fire();
  assert.equal(controller.busy, false);
  assert.equal(controller.applied, 1);
  assert.equal(timeouts.length, 1);
  assert.match(timeouts[0]!.error, /2500ms/);

  controller.settle({ ...posted[0]!, ok: true });
  controller.request(2);
  assert.equal(controller.applied, 1, '迟到成功覆盖了旧 applied');
  assert.deepEqual(posted.map((request) => request.numPoses), [3], 'poisoned owner 又启动了 mutation');
});

test('重配置 owner：stop 取消 deadline，迟到结果只能被忽略', () => {
  const clock = fakeClock();
  const posted: ReconfigureRequest[] = [];
  let timedOut = 0;
  const controller = createReconfigureController({
    initialNumPoses: 1,
    timeoutMs: 2500,
    post: (request) => posted.push(request),
    onFailure: () => assert.fail('stop 不是失败'),
    onTimeout: () => { timedOut++; },
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  controller.request(3);
  controller.stop();
  clock.fire();
  controller.settle({ ...posted[0]!, ok: true });
  assert.equal(timedOut, 0);
  assert.equal(controller.applied, 1);
  assert.equal(controller.busy, false);
});
