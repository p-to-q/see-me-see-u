/**
 * 慢回路服务端（docs/17-SLOW-LOOP.md）。
 *
 * 这些测试一分钱都不花：生成那一步被换成注入的假客户端，**其余每一步都是真的** ——
 * 真的规范化、真的写盘、真的 HTTP、真的血统池索引。
 * 失败矩阵（超时 / Rodin 报错 / 预算超限 / 未焊接的巨大网格）在这里逐条跑，
 * 因为现场那条路上唯一比"失败"更糟的是"永远停在 generating"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';

import { createSlowLoop, fakeClient, SlowRejected, type SlowClient, type LineagePool } from '../../factory/src/slow.ts';
import { createSlowHandler } from '../../factory/src/slow-http.ts';
import { glbStats } from '../../factory/src/glb-stats.ts';
import { RodinError } from '../../factory/src/rodin.ts';
import { SLOW_LOOP } from '../../core/src/tuning.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const REAL_PARTS = resolve(REPO, 'assets/parts');

/** 一张 1×1 的合法 PNG —— 中间件认魔数，所以不能用随便的字节 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** 临时仓库根：assets/parts/ 里放几件真部件，绝不往真的 assets/ 里写 */
function sandbox(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'sb-slow-'));
  const parts = resolve(root, 'assets/parts');
  mkdirSync(parts, { recursive: true });
  const src = readdirSync(REAL_PARTS).filter((f) => f.endsWith('.glb'));
  for (const f of [src.find((f) => f.startsWith('spine.')), src.find((f) => f.startsWith('head.'))]) {
    if (f) cpSync(resolve(REAL_PARTS, f), resolve(parts, f));
  }
  return root;
}

const poolOf = (root: string): LineagePool =>
  JSON.parse(readFileSync(resolve(root, 'assets/parts', SLOW_LOOP.lineageDir, 'lineage.json'), 'utf8'));

/** 抓住同步抛出的异常（assert.throws 的类型签名不把它还给我们） */
function caught(fn: () => unknown): unknown {
  try { fn(); } catch (e) { return e; }
  throw new Error('应该抛异常，但没有');
}

/** 恒定返回同一块 glb 的客户端 */
function bytesClient(bytes: Uint8Array, consumed = 0.5): SlowClient {
  return { name: 'fake', async generate() { return { glb: bytes, consumed }; } };
}

// ───────────────────────────── 1. 端到端（SLOW_FAKE 那条路） ─────────────────────────────

test('SLOW_FAKE：提交 → 轮询 → ready，件过了完整规范化，血统池与索引都写对', async () => {
  const root = sandbox();
  const loop = createSlowLoop({ root, client: fakeClient(resolve(root, 'assets/parts')), jobTimeoutMs: 60_000 });

  const job = loop.submit({ mask: PNG, slot: 'spine', session: 'anon-abc', species: 'porcelain' });
  assert.equal(job.status, 'submitted');       // 立刻返回，不阻塞
  assert.equal(job.slot, 'spine');
  assert.ok(!job.url);

  await loop.drain();
  const done = loop.get(job.id)!;
  assert.equal(done.status, 'ready', done.error);
  assert.ok(done.readyAt! >= done.submittedAt);

  // url 指向一个真的能拿到的文件
  const partId = done.url!.replace('/__slow/part/', '').replace('.glb', '');
  const file = loop.partPath(partId)!;
  assert.ok(file && existsSync(file), 'url 指向的 glb 必须存在');

  // 规范化契约（docs/03 §6）：主轴 +Y、长度 1、socketA 在原点
  const s = glbStats(file);
  assert.ok(Math.abs(s.size[1] - 1) < 2e-3, `长度应为 1，实得 ${s.size[1]}`);
  assert.ok(Math.abs(s.min[1]) < 2e-3, `socketA 应在原点，实得 y=${s.min[1]}`);
  assert.ok(s.triangles <= 5000);

  // PartMeta 合规
  const meta = done.meta!;
  assert.equal(meta.slot, 'spine');
  assert.equal(meta.family, 'porcelain');
  assert.equal(meta.file, `${SLOW_LOOP.lineageDir}/${partId}.glb`);
  assert.ok(meta.localGirth > 0, 'localGirth 必须有值 —— 运行时靠它反算横向缩放');
  assert.ok(meta.id.includes('.lin'), 'id 要看得出是血统池的件');

  // 血统池索引：谁触发的 / 什么时候 / 哪个物种 / 哪个槽位
  const pool = poolOf(root);
  assert.equal(pool.entries.length, 1);
  const e = pool.entries[0];
  assert.equal(e.session, 'anon-abc');
  assert.equal(e.species, 'porcelain');
  assert.equal(e.slot, 'spine');
  assert.equal(e.job, job.id);
  assert.equal(e.provider, 'fake');
  assert.ok(Date.parse(e.createdAt) > 0);

  // 主库没有被污染
  assert.ok(!existsSync(resolve(root, 'assets/parts', `${partId}.glb`)));
  // 原始件不过夜
  assert.ok(!existsSync(resolve(root, 'assets/parts', SLOW_LOOP.lineageDir, '_raw', `${job.id}.glb`)));
});

test('血统池按物种给下一个观众候选', async () => {
  const root = sandbox();
  const loop = createSlowLoop({ root, client: fakeClient(resolve(root, 'assets/parts')), jobTimeoutMs: 60_000 });
  loop.submit({ mask: PNG, slot: 'spine', session: 's1', species: 'porcelain' });
  await loop.drain();
  loop.submit({ mask: PNG, slot: 'head', session: 's2', species: 'coral' });
  await loop.drain();

  assert.equal(loop.lineage().total, 2);
  const coral = loop.lineage({ species: 'coral' });
  assert.equal(coral.total, 1);
  assert.equal(coral.parts[0].family, 'coral');
  assert.equal(coral.parts[0].slot, 'head');
  // 候选就是标准 PartMeta —— 前端把它并进 PartLibraryIndex.parts 就能被 makeGenome 抽到
  assert.equal(typeof coral.parts[0].localGirth, 'number');
});

// ───────────────────────────── 2. HTTP 外壳 ─────────────────────────────

async function withServer(loop: ReturnType<typeof createSlowLoop>, fn: (base: string) => Promise<void>) {
  const handler = createSlowHandler(loop);
  const server = createServer((req, res) => {
    req.url = (req.url ?? '/').replace(/^\/__slow/, '') || '/';   // connect 的挂载点会剥掉前缀
    void handler(req, res);
  });
  // 客户端固定走 127.0.0.1，服务端也必须明确绑 IPv4。`listen(0)` 在不同宿主上可能只绑 ::，
  // 全负载测试里曾偶发得到一次没有 HTTP 回执的 `fetch failed`，隔离复跑又消失。
  await new Promise<void>((resolveListen, rejectListen) => {
    const failed = (error: Error) => rejectListen(error);
    server.once('error', failed);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', failed);
      resolveListen();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object', '测试 HTTP server 没有取得监听地址');
  const port = address.port;
  try { await fn(`http://127.0.0.1:${port}/__slow`); }
  finally {
    // undici 会保留 keep-alive socket；显式清掉，不能让一条测试的连接寿命漏到下一条。
    server.closeAllConnections();
    await new Promise<void>((resolveClose, rejectClose) => server.close((error) => {
      if (error) rejectClose(error); else resolveClose();
    }));
  }
}

test('HTTP：POST 提交 → GET 轮询 → GET glb；坏请求都是结构化 JSON 错误', async () => {
  const root = sandbox();
  const loop = createSlowLoop({ root, client: fakeClient(resolve(root, 'assets/parts')), jobTimeoutMs: 60_000 });

  await withServer(loop, async (base) => {
    // GET 提交 → 405
    assert.equal((await fetch(base)).status, 405);
    // 不是 PNG → 400
    const bad = await fetch(base, { method: 'POST', body: 'not a png' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'BAD_REQUEST');
    // 不在 targetSlots 里的槽位 → 400
    const badSlot = await fetch(`${base}?slot=hand`, { method: 'POST', body: PNG });
    assert.equal(badSlot.status, 400);
    // 不存在的任务 → 404 而不是 200 空壳
    const noJob = await fetch(`${base}/slow-zzz-000000`);
    assert.equal(noJob.status, 404);
    // 路径穿越进不来
    assert.equal((await fetch(`${base}/part/..%2F..%2Fpackage.json`)).status, 404);

    const r = await fetch(`${base}?slot=spine&session=anon-http&species=porcelain`, { method: 'POST', body: PNG });
    assert.equal(r.status, 200);
    const job = await r.json();
    assert.equal(job.status, 'submitted');

    await loop.drain();
    const st = await (await fetch(`${base}/${job.id}`)).json();
    assert.equal(st.status, 'ready', st.error);

    const glb = await fetch(base.replace('/__slow', '') + st.url);
    assert.equal(glb.status, 200);
    assert.equal(glb.headers.get('content-type'), 'model/gltf-binary');
    const bytes = new Uint8Array(await glb.arrayBuffer());
    assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x46546c67, '拿到的必须是一个 glb');

    const lin = await (await fetch(`${base}/lineage?species=porcelain`)).json();
    assert.equal(lin.total, 1);
    assert.equal(lin.chance, SLOW_LOOP.lineageChance);
    assert.equal(lin.entries[0].session, 'anon-http');
  });
});

// ───────────────────────────── 3. 失败矩阵 ─────────────────────────────

test('预算：同一个 session 第二次被明确拒绝（不是静默退化）', async () => {
  const root = sandbox();
  const loop = createSlowLoop({ root, client: fakeClient(resolve(root, 'assets/parts')), jobTimeoutMs: 60_000 });
  loop.submit({ mask: PNG, slot: 'spine', session: 'one-guy', species: 'porcelain' });
  await loop.drain();

  const e = caught(() => loop.submit({ mask: PNG, slot: 'spine', session: 'one-guy', species: 'porcelain' }));
  assert.ok(e instanceof SlowRejected);
  assert.equal(e.code, 'BUDGET_SESSION');
  assert.equal(e.httpStatus, 429);
  assert.match(e.message, /会话/);
  // 次数闸门必须独立于钱：假客户端花 0 credits，光看钱是拦不住第二次的
  // 换个人照样能来
  assert.doesNotThrow(() => loop.submit({ mask: PNG, slot: 'spine', session: 'next-guy', species: 'porcelain' }));
  await loop.drain();
});

test('预算：当天额度用完 → BUDGET_DAY，一分钱都不会再花', async () => {
  const root = sandbox();
  const dir = resolve(root, 'assets/parts', SLOW_LOOP.lineageDir);
  mkdirSync(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(resolve(dir, 'lineage.json'), JSON.stringify({
    version: 1, entries: [], spend: { [today]: SLOW_LOOP.maxCreditsPerDay },
    sessionsDay: today, sessions: {}, totalCredits: 0,
  }));

  let called = false;
  const loop = createSlowLoop({
    root, jobTimeoutMs: 60_000,
    client: { name: 'fake', async generate() { called = true; return { glb: new Uint8Array(), consumed: 1 }; } },
  });
  const e = caught(() => loop.submit({ mask: PNG, session: 'whoever' }));
  assert.ok(e instanceof SlowRejected);
  assert.equal(e.code, 'BUDGET_DAY');
  assert.equal(called, false, '超预算时绝不能已经调过生成');
});

test('Rodin 报错 → failed + 人能看懂的 error，并且退回预扣', async () => {
  const root = sandbox();
  const loop = createSlowLoop({
    root, jobTimeoutMs: 60_000, checkBalance: false,
    client: {
      name: 'fake',
      async generate() { throw new RodinError('API_OBJECT_NOT_FOUND_ON_IMAGE', 'no object', false); },
    },
  });
  const job = loop.submit({ mask: PNG, session: 'unlucky', species: 'porcelain' });
  await loop.drain();

  const done = loop.get(job.id)!;
  assert.equal(done.status, 'failed');
  assert.match(done.error!, /剪影里没认出物体/);
  assert.ok(!done.url);
  // 没生成出东西就不该记账 —— 同一个人可以再试一次
  assert.equal(poolOf(root).sessions['unlucky'] ?? 0, 0);
  assert.equal(poolOf(root).attempts['unlucky'] ?? 0, 0, '失败不该算用掉那一次机会');
});

test('生成卡住 → 看门狗把任务推进 failed，绝不停在 generating', async () => {
  const root = sandbox();
  const loop = createSlowLoop({
    root, jobTimeoutMs: 40, checkBalance: false,
    client: { name: 'fake', generate: () => new Promise(() => { /* 永远不 resolve */ }) },
  });
  const job = loop.submit({ mask: PNG, session: 'stuck', species: 'porcelain' });
  await new Promise((r) => setTimeout(r, 200));

  const done = loop.get(job.id)!;
  assert.equal(done.status, 'failed');
  assert.match(done.error!, /放弃/);
  // 超时也要退：这个人什么都没拿到
  assert.equal(poolOf(root).attempts['stuck'] ?? 0, 0);
  assert.equal(poolOf(root).spend[new Date().toISOString().slice(0, 10)] ?? 0, 0);
});

test('未焊接的巨大网格（docs/07 §3 第 3 条那个坑）走完减面兜底，仍然进预算', async () => {
  const root = sandbox();
  const loop = createSlowLoop({
    root, jobTimeoutMs: 120_000, checkBalance: false,
    client: bytesClient(await unweldedTube(60, 50)),
  });
  const job = loop.submit({ mask: PNG, slot: 'spine', session: 'huge', species: 'porcelain' });
  await loop.drain();

  const done = loop.get(job.id)!;
  assert.equal(done.status, 'ready', done.error);
  assert.ok(done.meta!.triCount <= 5000, `面数应被收进预算，实得 ${done.meta!.triCount}`);
  const s = glbStats(loop.partPath(done.meta!.id)!);
  assert.ok(Math.abs(s.size[1] - 1) < 2e-3);
});

/**
 * 造一个"Rodin 坏日子"的网格：6000 个三角形、**完全不共享顶点**、每个角带浮点噪声。
 * 这正是实测那两件（1.5M / 439k tris）的形状 —— 精确 weld() 收不动它，
 * 必须先容差焊接。这里用小一号的版本，好让测试几秒就能跑完。
 */
async function unweldedTube(segs: number, rings: number): Promise<Uint8Array> {
  const doc = new Document();
  const buf = doc.createBuffer();
  const pos: number[] = [];
  const nrm: number[] = [];
  const jitter = () => (Math.sin(pos.length * 12.9898) * 1e-7);   // 确定性的"噪声"，不用 Math.random
  const at = (i: number, j: number) => {
    const a = (j / segs) * Math.PI * 2;
    const r = 0.3 * (1 - 0.3 * (i / rings));
    return [Math.cos(a) * r, (i / rings) * 2, Math.sin(a) * r];
  };
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const q = [at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)];
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
      for (const v of [q[a], q[b], q[c]]) {
        pos.push(v[0] + jitter(), v[1] + jitter(), v[2] + jitter());
        const l = Math.hypot(v[0], v[2]) || 1;
        nrm.push(v[0] / l, 0, v[2] / l);
      }
    }
  }
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nrm)).setBuffer(buf))
    .setMaterial(doc.createMaterial('m'));
  const mesh = doc.createMesh().addPrimitive(prim);
  const node = doc.createNode().setMesh(mesh);
  doc.createScene().addChild(node);
  return new NodeIO().writeBinary(doc);
}
