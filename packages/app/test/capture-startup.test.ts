/**
 * 开机采集的交易边界。
 *
 * 摄像头是不可信外部输入：实现按契约应该 resolve + `failed`，
 * 但开机编排还是必须兜住 create / start 直接 reject 的坏实现。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  captureUsable, startInitialCapture,
  type Capture, type CaptureFactory, type CaptureKind,
} from '../src/capture/capture.ts';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

interface FakeOptions {
  failed?: boolean;
  error?: string | null;
  reject?: Error;
  stopThrows?: boolean;
}

function fake(opts: FakeOptions = {}): Capture & { starts: number; stops: number } {
  return {
    starts: 0,
    stops: 0,
    failed: opts.failed ?? false,
    lastError: opts.error ?? null,
    fps: 0,
    async start() {
      this.starts++;
      if (opts.reject) throw opts.reject;
    },
    latest: () => null,
    latestMask: () => null,
    stop() {
      this.stops++;
      if (opts.stopThrows) throw new Error('清理也坏了');
    },
  };
}

function factory(entries: Partial<Record<CaptureKind, Capture | Error>>, calls: CaptureKind[]): CaptureFactory {
  return async (kind) => {
    calls.push(kind);
    const item = entries[kind];
    if (item instanceof Error) throw item;
    if (!item) throw new Error(`没有 ${kind}`);
    return item;
  };
}

test('开机采集: 摄像头正常时不造回放', async () => {
  const webcam = fake();
  const calls: CaptureKind[] = [];
  const result = await startInitialCapture('webcam', {}, factory({ webcam }, calls));

  assert.equal(result.capture, webcam);
  assert.equal(result.kind, 'webcam');
  assert.deepEqual(result.failures, []);
  assert.deepEqual(calls, ['webcam']);
  assert.equal(webcam.starts, 1);
  assert.equal(webcam.stops, 0);
});

test('开机采集: failed 摄像头先停干净，再交给回放', async () => {
  const webcam = fake({ failed: true, error: '权限被拒绝' });
  const replay = fake();
  const calls: CaptureKind[] = [];
  const result = await startInitialCapture('webcam', {}, factory({ webcam, replay }, calls));

  assert.equal(result.capture, replay);
  assert.equal(result.kind, 'replay');
  assert.deepEqual(result.failures, [{ kind: 'webcam', error: '权限被拒绝' }]);
  assert.deepEqual(calls, ['webcam', 'replay']);
  assert.equal(webcam.stops, 1);
  assert.equal(replay.starts, 1);
});

test('开机采集: create / start reject 和 stop 再抛都挡不住回放', async () => {
  const replayA = fake();
  const createCalls: CaptureKind[] = [];
  const afterCreateReject = await startInitialCapture('webcam', {}, factory({
    webcam: new Error('没有权限'), replay: replayA,
  }, createCalls));
  assert.equal(afterCreateReject.kind, 'replay');
  assert.equal(afterCreateReject.capture, replayA);
  assert.match(afterCreateReject.failures[0]?.error ?? '', /没有权限/);

  const webcam = fake({ reject: new Error('驱动崩了'), stopThrows: true });
  const replayB = fake();
  const startCalls: CaptureKind[] = [];
  const afterStartReject = await startInitialCapture('webcam', {}, factory({ webcam, replay: replayB }, startCalls));
  assert.equal(afterStartReject.capture, replayB);
  assert.deepEqual(startCalls, ['webcam', 'replay']);
  assert.equal(webcam.stops, 1);
  assert.match(afterStartReject.failures[0]?.error ?? '', /驱动崩了/);
});

test('开机采集: 回放也造不出时返回安静空采集，不把错误抛给 boot', async () => {
  const calls: CaptureKind[] = [];
  const result = await startInitialCapture('webcam', {}, factory({
    webcam: new Error('没有摄像头'), replay: new Error('回放 chunk 没下来'),
  }, calls));

  assert.equal(result.kind, 'replay');
  assert.deepEqual(calls, ['webcam', 'replay']);
  assert.equal(result.failures.length, 2);
  assert.equal(result.capture.failed, true);
  assert.equal(result.capture.latest(), null);
  await assert.doesNotReject(result.capture.start());
});

test('采集可用性: 明确 failed=false 时，lastError 只是已吸收的警告', () => {
  assert.equal(captureUsable(fake({ failed: false, error: 'GPU → CPU' })), true);
  assert.equal(captureUsable(fake({ failed: true, error: null })), false);
  const legacy = fake({ error: '致命' });
  delete (legacy as { failed?: boolean }).failed;
  assert.equal(captureUsable(legacy), false);
});

test('开机接线: 选择页、直播状态和运行日志都读真正启动的种类', () => {
  const main = read('../src/main.ts');
  assert.match(main, /startInitialCapture\(/, '正式入口没走开机降级边界');
  assert.match(main, /started\.kind === 'webcam'[^]*captureForChoose = started\.capture/,
    '回放 fallback 会倒过来操作选择页');
  assert.match(main, /let cameraOn = initialCapture\.kind === 'webcam'/,
    'cameraOn 还在拿 URL 意图当真实采集');
  assert.match(main, /`capture=\$\{cameraOn \? 'webcam' : 'replay'\}/,
    '运行日志还在报意图，不是实际路径');
});

test('摄像头无画面: loadeddata 有界，失败清理会摘掉旧 srcObject', () => {
  const webcam = read('../src/capture/webcam.ts');
  assert.match(webcam, /withTimeout\(\s*new Promise<void>\([^]*loadeddata[^]*CAPTURE\.startTimeout \* 1000[^]*摄像头没有送来画面/,
    '永远不出帧的 stream 会卡死开机');
  assert.match(webcam, /this\.video\.srcObject = null/,
    '失败后预览会把旧 stream 误报成摄像头仍开着');
});
