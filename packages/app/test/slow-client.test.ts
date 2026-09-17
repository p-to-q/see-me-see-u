/**
 * 慢回路的浏览器端生命周期。
 *
 * 服务端 slow.test.ts 已经能证明“提交 → 生成 → 规范化 → 血统池”，但它答不了
 * 装置一天不刷新时的那一问：任务回来时，台上还是不是刚才那个人。
 * 这里把 PNG 编码、fetch 与几何加载都注入，只钉这个所有权契约；不起 server，不写盘，不花 credits。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SLOW_LOOP } from '../../core/src/tuning.ts';
import type { PartMeta } from '../../core/src/types.ts';
import { createSlowLoop, type Graftable } from '../src/slow/slow.ts';

const META = {
  id: 'spine.proof.lin000001', slot: 'spine', family: 'proof', tier: 3,
} as unknown as PartMeta;

const ready = () => new Response(JSON.stringify({
  id: 'slow-proof-000001', status: 'ready', slot: 'spine', submittedAt: 1,
  url: '/__slow/part/spine.proof.lin000001.glb', meta: META,
}), { status: 200, headers: { 'content-type': 'application/json' } });

const png = async () => new Blob(['png'], { type: 'image/png' });
const mask = {} as ImageBitmap;

function geometry() {
  let disposed = 0;
  return {
    value: { dispose() { disposed += 1; } } as unknown as import('three/webgpu').BufferGeometry,
    get disposed() { return disposed; },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function until(predicate: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

test('换观众使旧任务作废：不接到新人身上，并释放已下载几何', async () => {
  const first = deferred<import('three/webgpu').BufferGeometry>();
  const oldGeometry = geometry();
  const newGeometry = geometry();
  const sessions = ['visitor-a', 'visitor-b'];
  const requestSessions: string[] = [];
  const grafts: string[] = [];
  let loads = 0;
  let visitor = 'A';

  const body: Graftable = {
    graft() { grafts.push(visitor); },
  };
  const slow = createSlowLoop({
    mask: () => mask,
    species: () => 'proof',
    body: () => body,
    newSessionId: () => sessions.shift() ?? 'unexpected',
    encodeMask: png,
    request: async (input) => {
      const url = new URL(String(input), 'http://local');
      requestSessions.push(url.searchParams.get('session') ?? '');
      return ready();
    },
    loadGeometry: async () => {
      loads += 1;
      return loads === 1 ? first.promise : newGeometry.value;
    },
  });

  assert.equal(slow.sessionId, 'visitor-a');
  slow.update(true, SLOW_LOOP.armAfter + 1);
  await until(() => loads === 1, '第一个观众的几何没开始加载');

  visitor = 'B';
  slow.reset();
  assert.equal(slow.sessionId, 'visitor-b', '换人后仍在沿用上一个预算 session');
  first.resolve(oldGeometry.value);
  await until(() => oldGeometry.disposed === 1, '过期几何没有释放');
  assert.deepEqual(grafts, [], 'A 的剪影生成件被接到了 B 身上');

  slow.update(true, SLOW_LOOP.armAfter + 1);
  await until(() => slow.phase === 'grafted', '第二个观众没能独立走完慢回路');
  assert.deepEqual(requestSessions, ['visitor-a', 'visitor-b']);
  assert.deepEqual(grafts, ['B']);
  assert.equal(newGeometry.disposed, 0, '已移交给身体的几何不该被客户端释放');
});

test('换人发生在响应体解析期间：旧失败不会关掉新观众的回路', async () => {
  const oldJson = deferred<unknown>();
  let requests = 0;
  let oldJsonStarted = false;
  const grafts: string[] = [];
  const slow = createSlowLoop({
    mask: () => mask,
    species: () => 'proof',
    body: () => ({ graft() { grafts.push(slow.sessionId); } }),
    newSessionId: (() => {
      const sessions = ['visitor-a', 'visitor-b'];
      return () => sessions.shift() ?? 'unexpected';
    })(),
    encodeMask: png,
    request: async () => {
      requests += 1;
      if (requests === 1) {
        return {
          ok: true,
          status: 200,
          json: () => { oldJsonStarted = true; return oldJson.promise; },
        } as Response;
      }
      return ready();
    },
    loadGeometry: async () => geometry().value,
  });

  slow.update(true, SLOW_LOOP.armAfter + 1);
  await until(() => oldJsonStarted, '旧响应体没开始解析');
  slow.reset();
  oldJson.resolve({ id: 'old', status: 'failed', error: '旧任务失败' });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(slow.phase, 'idle');
  slow.update(true, SLOW_LOOP.armAfter + 1);
  await until(() => slow.phase === 'grafted', '旧响应体把新观众的回路关掉了');
  assert.equal(requests, 2);
  assert.deepEqual(grafts, ['visitor-b']);
});

test('不可挂载的形体在 PNG/网络/加载之前就停', () => {
  let masks = 0;
  let requests = 0;
  let loads = 0;
  const slow = createSlowLoop({
    mask: () => { masks += 1; return mask; },
    species: () => 'mass-or-swarm',
    body: () => null,
    newSessionId: () => 'visitor-a',
    encodeMask: png,
    request: async () => { requests += 1; return ready(); },
    loadGeometry: async () => { loads += 1; return geometry().value; },
  });

  slow.update(true, SLOW_LOOP.armAfter + 1);
  assert.equal(slow.phase, 'off');
  assert.deepEqual({ masks, requests, loads }, { masks: 0, requests: 0, loads: 0 });
  assert.match(slow.note, /不接/);
});

test('没有 mask 时低频探测，mask 晚到仍在一个周期内只提交一次', async () => {
  let bodies = 0;
  let masks = 0;
  let requests = 0;
  let available = false;
  const slow = createSlowLoop({
    mask: () => { masks += 1; return available ? mask : null; },
    species: () => 'proof',
    body: () => { bodies += 1; return { graft() {} }; },
    newSessionId: () => 'visitor-a',
    encodeMask: png,
    request: async () => { requests += 1; return ready(); },
    loadGeometry: async () => geometry().value,
  });

  // 先武装并完成第一次即时探测；后面的 600 帧代表 60fps 下十秒。
  slow.update(true, SLOW_LOOP.armAfter + 1);
  assert.equal(masks, 1);
  for (let frame = 0; frame < 600; frame++) slow.update(true, 1 / 60);

  assert.ok(masks <= 11, `十秒无 mask 读了 ${masks} 次，仍在按帧探测`);
  assert.equal(bodies, masks, 'body 边界仍比 mask 多读，可能还在逐帧创建包装对象');
  assert.equal(requests, 0);
  assert.equal(slow.phase, 'armed');

  available = true;
  slow.update(true, SLOW_LOOP.maskRetrySeconds);
  await until(() => slow.phase === 'grafted', 'mask 到达后一个重试周期内没有启动');
  assert.equal(requests, 1);

  // maxPerSession 仍是硬闸：后续帧不能重复花 credit。
  for (let frame = 0; frame < 120; frame++) slow.update(true, 1 / 60);
  assert.equal(requests, 1);
});

test('单张 mask 的 demand 成对收口，PNG 编码后只释放一次所有权', async () => {
  const demand: boolean[] = [];
  let closes = 0;
  const ownedMask = { close() { closes += 1; } } as unknown as ImageBitmap;
  const slow = createSlowLoop({
    maskDemand: (wanted) => demand.push(wanted),
    mask: () => ownedMask,
    species: () => 'proof',
    body: () => ({ graft() {} }),
    newSessionId: () => 'visitor-a',
    encodeMask: png,
    request: async () => ready(),
    loadGeometry: async () => geometry().value,
  });

  slow.update(true, SLOW_LOOP.armAfter + 1);
  await until(() => slow.phase === 'grafted', '单张 mask 没有走完慢回路');
  assert.deepEqual(demand, [true, false]);
  assert.equal(closes, 1, '慢回路没有恰好释放一次已取走的 ImageBitmap');

  slow.reset();
  assert.deepEqual(demand, [true, false], '已收口的需求在 reset 时重复通知 Capture');
  assert.equal(closes, 1);
});

test('等 mask 的重试倒计时不跨观众，新观众仍立即探测', () => {
  let masks = 0;
  const sessions = ['visitor-a', 'visitor-b'];
  const slow = createSlowLoop({
    mask: () => { masks += 1; return null; },
    species: () => 'proof',
    body: () => ({ graft() {} }),
    newSessionId: () => sessions.shift() ?? 'unexpected',
    encodeMask: png,
    request: async () => ready(),
    loadGeometry: async () => geometry().value,
  });

  slow.update(true, SLOW_LOOP.armAfter + 1);
  slow.update(true, SLOW_LOOP.maskRetrySeconds / 2);
  assert.equal(masks, 1);

  slow.reset();
  assert.equal(slow.sessionId, 'visitor-b');
  slow.update(true, SLOW_LOOP.armAfter + 1);
  assert.equal(masks, 2, '上一位观众的 cooldown 延迟了新观众第一次探测');
});

test('非法 dt 不能提前武装，也不能把 mask 重试门打回逐帧', () => {
  let masks = 0;
  const slow = createSlowLoop({
    mask: () => { masks += 1; return null; },
    species: () => 'proof',
    body: () => ({ graft() {} }),
    newSessionId: () => 'visitor-a',
    encodeMask: png,
    request: async () => ready(),
    loadGeometry: async () => geometry().value,
  });

  for (const dt of [Number.NaN, Number.POSITIVE_INFINITY, -1]) slow.update(true, dt);
  assert.equal(slow.phase, 'idle');
  assert.equal(masks, 0);

  slow.update(true, SLOW_LOOP.armAfter + 1);
  assert.equal(masks, 1);
  for (let frame = 0; frame < 120; frame++) slow.update(true, Number.NaN);
  assert.equal(masks, 1, 'NaN dt 击穿了 mask 重试倒计时');
});

test('mask 边界同步抛错也只关慢回路，不抛进帧循环', () => {
  const slow = createSlowLoop({
    mask: () => { throw new Error('segmenter lost'); },
    species: () => 'proof',
    body: () => ({ graft() {} }),
    newSessionId: () => 'visitor-a',
    encodeMask: png,
    request: async () => ready(),
    loadGeometry: async () => geometry().value,
  });

  assert.doesNotThrow(() => slow.update(true, SLOW_LOOP.armAfter + 1));
  assert.equal(slow.phase, 'off');
  assert.match(slow.note, /segmenter lost/);
});

test('下载期间身体消失：不 graft，几何只释放一次', async () => {
  const loaded = deferred<import('three/webgpu').BufferGeometry>();
  const orphan = geometry();
  let target: Graftable | null = { graft() { assert.fail('消失的身体不该收到 graft'); } };
  let loadStarted = false;
  const slow = createSlowLoop({
    mask: () => mask,
    species: () => 'proof',
    body: () => target,
    newSessionId: () => 'visitor-a',
    encodeMask: png,
    request: async () => ready(),
    loadGeometry: async () => { loadStarted = true; return loaded.promise; },
  });

  slow.update(true, SLOW_LOOP.armAfter + 1);
  await until(() => loadStarted, '几何没开始加载');
  target = null;
  loaded.resolve(orphan.value);
  await until(() => slow.phase === 'off', '身体消失没有收口');
  assert.equal(orphan.disposed, 1);
  assert.match(slow.note, /身体不在/);
});

test('正式接线把 mass 和 swarm 都挡在慢回路之外', async () => {
  const { readFile } = await import('node:fs/promises');
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /body:\s*\(\)\s*=>\s*\(isMass\s*\|\|\s*isSwarm\s*\?\s*null/);
});
