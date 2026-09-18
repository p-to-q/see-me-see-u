/**
 * 存档（`docs/43 §8`）—— **保留期那条裁定的仪表。**
 *
 * ## 这个文件为什么存在
 *
 * `§9.4` 裁的是「永久保留」，而它的全部基础是一句事实断言：
 *
 * > A 档存的是序号、时间（粗到天）、和物种 —— 这里面没有一样指向一个人。
 * > 「只增不减」因此不是一条要被辩护的例外。
 *
 * 一句这样的断言写在文档里，明天就可能不再是真的：有人为了排查加一个
 * `ua`，为了限流加一个 `ip`，为了"以后用得上"把 `species` 放宽成自由文本。
 * 每一步都合理，而走完之后那条裁定已经没有基础了，**却没有任何东西会响**。
 *
 * `docs/02` P21：问一句"如果这东西坏了，我的仪表会显示什么"。
 * 如果答案是"和现在一样"，那它就不是仪表。注释不是仪表，文档不是仪表。
 * 下面这几条是。
 *
 * 三个层次，缺一条就漏：
 *
 * 1. **字段清单**（`VISIT_FIELDS`）—— 存下去的对象只有那三个键。
 * 2. **那三个键各自装不下一个人** —— `species` 是闭集，`at` 只到天，`n` 是计数。
 * 3. **服务端从来没拿到过那些东西** —— 扫源码：`packages/archive/**` 和
 *    `api/**` 里不许出现任何一处读 IP / UA / cookie 的写法。第 1、2 条钉的是
 *    "写下去的是什么"，这一条钉的是"手里有过什么" —— 前两条挡不住有人
 *    把 IP 写进日志。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createArchiveHandler } from '../../archive/src/http.ts';
import { createVisitStore, fileStore, memoryStore, restStore } from '../../archive/src/store.ts';
import { DAY_RE, SPECIES_MAX, VISIT_FIELDS, readSpecies, seal, type Visit } from '../../archive/src/visit.ts';
import { createVisitReporter } from '../src/archive/visit.ts';
import { SLOW_LOOP } from '../../core/src/tuning.ts';

// `new URL(...).pathname` 会把路径里的非 ASCII 百分号编码 ——
// 这个仓库的绝对路径里有中文，于是 readdir 直接 ENOENT（照抄 css-tokens.test.ts）
const REPO = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

// ─────────────────────── 1 · 字段清单 ───────────────────────

test('存档：一条记录只有 n / species / at 三个字段', async () => {
  const store = memoryStore();
  const row = await store.append('porcelain');
  assert.deepEqual(Object.keys(row).sort(), [...VISIT_FIELDS].sort(),
    '存下去的对象长出了清单以外的键 —— docs/43 §9.4 的保留期裁定就是靠这份清单站住的');
  assert.equal(row.n, 1);
  assert.equal(row.species, 'porcelain');
});

test('存档：`seal()` 把清单以外的字段挡在外面', () => {
  // 将来的 store 实现是别人写的。这一层是响应里"只会有那三个字段"的最后一道闸
  const smuggled = { n: 7, species: 'field', at: '2026-09-13', ip: '1.2.3.4', ua: 'Mozilla' };
  assert.deepEqual(Object.keys(seal(smuggled as never)).sort(), [...VISIT_FIELDS].sort());
});

// ─────────────────────── 2 · 那三个键装不下一个人 ───────────────────────

test('存档：species 是闭集，装不下姓名 / 邮箱 / 坐标', () => {
  for (const ok of ['porcelain', 'field', 'char.dumpling', 'guest.founder', 'x-1_2']) {
    assert.equal(readSpecies({ species: ok }), ok);
  }
  const smuggling = [
    'max.zhuang.yan@gmail.com',
    '31.2304,121.4737',
    'Zhang San',
    '<script>alert(1)</script>',
    'a'.repeat(SPECIES_MAX + 1),
    '',
    null,
    42,
  ];
  for (const bad of smuggling) {
    assert.throws(() => readSpecies({ species: bad }), /species/,
      `species 收下了 ${JSON.stringify(bad)} —— 那就是一条自由文本通道，不是一个闭集`);
  }
});

test('存档：时间戳粗到天，没有时分秒', async () => {
  const row = await memoryStore().append('porcelain', Date.parse('2026-09-13T10:22:31.913Z'));
  assert.match(row.at, DAY_RE, 'at 带上了比天更细的分辨率 —— §1.6 的四条前置之一是"时间戳粗到天"');
  assert.equal(row.at, '2026-09-13');
});

test('存档：POST 的请求体里塞别的字段，一个都不会落库', async () => {
  const store = memoryStore();
  const { post, get, close } = await serve(store);
  const res = await post('/visit', {
    species: 'porcelain',
    ip: '203.0.113.7',
    ua: 'Mozilla/5.0',
    session: 'anon-12345678',
    email: 'someone@example.com',
    lat: 31.2304,
    at: '2026-09-13T10:22:31Z',
    n: 999,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body.entry ?? {}).sort(), [...VISIT_FIELDS].sort());
  // `n` 和 `at` 由服务端定，请求体说了不算 —— 否则序号和日期都是客户端可写的
  assert.equal(res.body.entry?.n, 1);
  assert.match(res.body.entry?.at ?? '', DAY_RE);

  const list = await get('/visits');
  assert.deepEqual(Object.keys(list.body.entries?.[0] ?? {}).sort(), [...VISIT_FIELDS].sort());
  assert.equal(JSON.stringify(list.body).includes('203.0.113.7'), false);
  assert.equal(JSON.stringify(list.body).includes('example.com'), false);
  close();
});

// ─────────────────────── 3 · 服务端手里从来没有过那些东西 ───────────────────────

/**
 * 读 IP / UA / cookie 的那几种写法。
 *
 * 这份名单是**收紧**的，不是穷举：它挡的是今天真会被写出来的那几行。
 * 但 `req.headers` 在名单上，而 IP 和 UA 在 HTTP 里只能从那儿来，
 * 所以这一条比它看起来宽 —— 想绕过去必须先动这个测试，而那是一次显式的决定。
 */
const FORBIDDEN = [
  'x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'x-vercel-forwarded-for',
  'user-agent', 'req.headers', 'request.headers', '.socket', 'remoteAddress',
  'cookie', 'sendBeacon',
];

function tsFiles(dir: string, out: string[] = []): string[] {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 块注释 + 行注释。一句讨论 IP 的话不是一处读 IP（照抄 css-tokens.test.ts 的理由） */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('存档：服务端源码里没有任何一处读 IP / UA / cookie', () => {
  const files = [
    ...tsFiles(resolve(REPO, 'packages/archive/src')),
    ...tsFiles(resolve(REPO, 'api')),
  ];
  assert.ok(files.length >= 4, `扫到的文件太少（${files.length}）—— 路径写错了，这条守卫会永远绿`);

  const hits: string[] = [];
  for (const f of files) {
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const needle of FORBIDDEN) {
      if (src.toLowerCase().includes(needle.toLowerCase())) hits.push(`${f} 里有 ${needle}`);
    }
  }
  assert.deepEqual(hits, [], `存档的服务端拿到了它不该拿到的东西：\n${hits.join('\n')}`);
});

test('存档：前端不许用 sendBeacon 抢救半途离开的那一条（§9.7）', () => {
  const files = tsFiles(resolve(REPO, 'packages/app/src/archive'));
  assert.ok(files.length >= 1, '扫到 0 个文件 —— 路径写错了，这条守卫会永远绿');
  for (const f of files) {
    assert.equal(stripComments(readFileSync(f, 'utf8')).includes('sendBeacon'), false,
      `${f} 用了 sendBeacon —— §9.7 裁的是不救：存档的每一条都该是一次完成的相遇`);
  }
});

// ─────────────────────── 端点本身 ───────────────────────

test('存档：GET /visits 的形状逐字照抄 GET /__slow/lineage', async () => {
  const store = memoryStore();
  const { post, get, close } = await serve(store);
  await post('/visit', { species: 'porcelain' });
  await post('/visit', { species: 'field' });
  const res = await get('/visits');
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['entries', 'ok', 'total']);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.total, 2);
  // 最新在前 —— 和血统池同向，否则 /lineage 的沉积剖面会上下颠倒
  assert.deepEqual(res.body.entries?.map((e) => e.n), [2, 1]);
  close();
});

test('存档：limit 被血统池那一个旋钮封顶，不新开一个', async () => {
  const store = memoryStore();
  for (let i = 0; i < SLOW_LOOP.lineageServeLimit + 5; i++) await store.append('porcelain');
  const { get, close } = await serve(store);
  const capped = await get(`/visits?limit=${SLOW_LOOP.lineageServeLimit + 100}`);
  assert.equal(capped.body.entries?.length, SLOW_LOOP.lineageServeLimit);
  assert.equal(capped.body.total, SLOW_LOOP.lineageServeLimit + 5, 'total 是整池的，不是窗口的');
  const three = await get('/visits?limit=3');
  assert.equal(three.body.entries?.length, 3);
  close();
});

test('存档：方法不对 / 路径不对 一律结构化 JSON，绝不静默 200', async () => {
  const { get, post, close } = await serve(memoryStore());
  const wrongMethod = await get('/visit');
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.code, 'METHOD');
  const noRoute = await get('/nope');
  assert.equal(noRoute.status, 404);
  assert.equal(noRoute.body.code, 'NO_ROUTE');
  const bad = await post('/visit', { species: '不是闭集里的' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'BAD_REQUEST');
  close();
});

test('存档：本地盘实现只追加，n 就是行号', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'sb-archive-'));
  const path = join(dir, 'visits.jsonl');
  const store = fileStore(path);
  await store.append('porcelain');
  await store.append('field');
  // 换一个实例读回来 —— 装置那台机器上重启是常态（§7.3）
  const again = fileStore(path);
  const { total, entries } = await again.recent(10);
  assert.equal(total, 2);
  assert.deepEqual(entries.map((e) => e.n), [2, 1]);
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  // 一条 60 字节那个数是 §2.1 量出来的。这里只钉数量级：一条记录不许长胖
  assert.ok(statSync(path).size / 2 < 80, `一条记录 ${statSync(path).size / 2} 字节，超过 §2.1 量的 60 B 一截`);
  await store.append('xeno');
  assert.equal((await again.recent(1)).entries[0].n, 3, '第二个实例看不到新写的行 —— 那就不是只追加');
});

test('存档：一个存储都没配 = 没有这条回路，不是一个会忘的计数器', async () => {
  assert.equal(createVisitStore({}), null,
    '没配存储却给了一个 store —— 线上那个数会每隔一阵子从 1 重新数起，'
    + '而这一页头一行写着「这一叠不会变薄」（docs/02 P21）');
  assert.match(createVisitStore({ ARCHIVE_FILE: '/tmp/x.jsonl' })?.kind ?? '', /^file:/);
  assert.equal(createVisitStore({ KV_REST_API_URL: 'https://x', KV_REST_API_TOKEN: 't' })?.kind, 'rest');
  // 集成注入的名字不由我们定，两套都认
  assert.equal(
    createVisitStore({ UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 't' })?.kind, 'rest');

  // 而"没有这条回路"在 HTTP 上就是 404 —— `/lineage` 对这件事有一句准备好的话
  const { post, get, close } = await serve(null);
  const w = await post('/visit', { species: 'porcelain' });
  assert.equal(w.status, 404);
  assert.equal(w.body.code, 'DISABLED');
  assert.equal((await get('/visits')).status, 404);
  close();
});

/**
 * Marketplace 上那一个走的是 HTTP，所以它的**协议**在这里是可测的
 * （连上真服务不是这条线的事 —— 开通是作品负责人的动作）。
 * 钉三件事：序号由 `INCR` 发、追加是 `LPUSH`、**没有任何一条命令会让这一叠变薄**。
 */
test('存档：REST 实现只用 INCR / LPUSH / LRANGE / LLEN，没有 LTRIM 也没有 DEL', async () => {
  const sent: (string | number)[][] = [];
  const replies: unknown[] = [41, 1, ['{"n":41,"species":"field","at":"2026-09-14"}'], 41];
  const stub = (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
    assert.equal(init.headers.authorization, 'Bearer tok', 'token 没有进 Authorization');
    sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ result: replies.shift() }) };
  }) as never;
  const real = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = stub;
  try {
    const store = restStore('https://example.invalid/', 'tok');
    const row = await store.append('field', Date.parse('2026-09-14T10:00:00Z'));
    assert.deepEqual(row, { n: 41, species: 'field', at: '2026-09-14' });
    const { total, entries } = await store.recent(3);
    assert.equal(total, 41);
    assert.deepEqual(entries.map((e) => e.n), [41]);
  } finally {
    (globalThis as { fetch: unknown }).fetch = real;
  }
  assert.deepEqual(sent.map((c) => c[0]), ['INCR', 'LPUSH', 'LRANGE', 'LLEN']);
  const shrinks = sent.filter((c) => ['LTRIM', 'DEL', 'LPOP', 'RPOP', 'EXPIRE'].includes(String(c[0])));
  assert.deepEqual(shrinks, [], '有一条会让这一叠变薄的命令 —— /lineage 上那句话是字面意思');
});

// ─────────────────────── 前端那一半 ───────────────────────

/** 一个记账的 fetch 替身。每次都成功，序号递增 */
function counting(calls: unknown[]): typeof globalThis.fetch {
  let n = 0;
  return (async (_url: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body));
    n += 1;
    return { ok: true, json: async () => ({ ok: true, entry: { n } }) };
  }) as never;
}

const settle = () => new Promise((res) => setTimeout(res, 0));

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const keptResponse = (n: number) => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, entry: { n } }),
}) as Response;

test('存档：弧线走完才写，一次，而且只写一次', async () => {
  const calls: unknown[] = [];
  const r = createVisitReporter({ species: 'porcelain', live: () => true, idle: (fn) => fn(), fetch: counting(calls) });
  r.note(false); r.note(false);
  assert.equal(calls.length, 0, '弧线没走完就写了 —— §7.1 第 1 条：写在一次相遇的尽头');
  r.note(true); r.note(true); r.note(true);
  await settle();
  assert.equal(calls.length, 1, '写了不止一次');
  assert.deepEqual(calls[0], { species: 'porcelain' }, '请求体里有物种以外的东西');
  assert.equal(r.phase, 'kept');
});

/**
 * 网页版开场用的是回放，摄像头要等观众按下「用我的摄像头」才打开。
 * `live` 如果在开机那一刻算定，答案在整个网页版上永远是 false —— 存档一行都不会写，
 * 而 `/about` 那一段正说着「每一次到访只在服务端留下一行」。
 * 所以这一条钉的是：**它读的是此刻**。
 */
test('存档：算不算数在弧线走完的那一刻才问 —— 中途打开摄像头也算', async () => {
  const calls: unknown[] = [];
  let cameraOn = false;
  const r = createVisitReporter({
    species: 'porcelain', live: () => cameraOn, idle: (fn) => fn(), fetch: counting(calls),
  });
  r.note(true);
  await settle();
  assert.equal(calls.length, 0, '摄像头还没开就写了');
  assert.equal(r.phase, 'idle', '摄像头没开不该把这一场关死 —— 观众随时可能按下那个按钮');

  cameraOn = true;
  r.note(true);
  await settle();
  assert.equal(calls.length, 1, '观众打开摄像头、走完弧线，这一条没写 —— 网页版的存档因此是死的');
});

test('存档：不按那个按钮就什么都不留（§9.5 的「不参与」）', async () => {
  let called = false;
  const r = createVisitReporter({
    species: 'porcelain', live: () => false, idle: (fn) => fn(),
    fetch: (async () => { called = true; return { ok: true, json: async () => ({}) }; }) as never,
  });
  r.note(true); r.note(true);
  await settle();
  assert.equal(called, false,
    '摄像头没开也写了一条 —— /about 说的是「不按那个按钮，摄像头就不会打开，作品照样在放」');
});

/**
 * 装置那台机器一开就是一整天，一个接一个的人走过同一条弧线。
 * 不在 `justReset` 上把它收回来，这一页数的东西就从「人」偷偷变成了「开机次数」。
 */
test('存档：换一个人就重新算一场，但写失败那道闸不解除', async () => {
  const calls: unknown[] = [];
  const ok = createVisitReporter({ species: 'porcelain', live: () => true, idle: (fn) => fn(), fetch: counting(calls) });
  ok.note(true);
  await settle();
  ok.note(true);
  await settle();
  assert.equal(calls.length, 1);
  ok.reset();                       // 人走了
  assert.equal(ok.phase, 'idle');
  ok.note(true);                    // 下一位走完
  await settle();
  assert.equal(calls.length, 2, 'reset 之后下一位没被记下 —— 一次开机只记一条');
  assert.equal(ok.n, 2);

  let tries = 0;
  const dead = createVisitReporter({
    species: 'porcelain', live: () => true, idle: (fn) => fn(),
    fetch: (async () => { tries++; return { ok: false, status: 500, json: async () => ({}) }; }) as never,
  });
  dead.note(true);
  await settle();
  dead.reset();
  dead.note(true);
  await settle();
  assert.equal(tries, 1, 'reset 把会话级那道闸解除了 —— §7.1 第 3 条是本次会话不再尝试');
  assert.equal(dead.phase, 'off');
});

test('存档：上一场迟到的 fetch 失败或非 2xx 不会关闭下一场', async () => {
  for (const outcome of ['reject', '500'] as const) {
    const first = deferred<Response>();
    let calls = 0;
    const r = createVisitReporter({
      species: 'porcelain', live: () => true, idle: (fn) => fn(),
      fetch: (async () => {
        calls += 1;
        return calls === 1 ? first.promise : keptResponse(22);
      }) as never,
    });

    r.note(true);
    assert.equal(r.phase, 'writing');
    r.reset();
    assert.equal(r.phase, 'idle');
    if (outcome === 'reject') first.reject(new Error('old encounter offline'));
    else first.resolve({ ok: false, status: 500, json: async () => ({}) } as Response);
    await settle();
    assert.equal(r.phase, 'idle', `${outcome}：上一场迟到的失败污染了下一场`);
    assert.equal(r.n, null);

    r.note(true);
    await settle();
    assert.equal(r.phase, 'kept', `${outcome}：下一场不能再写`);
    assert.equal(r.n, 22);
  }
});

test('存档：上一场迟到的成功或坏 JSON 不会改写下一场', async () => {
  for (const outcome of ['success', 'bad-json'] as const) {
    const body = deferred<{ ok: true; entry: { n: number } }>();
    let calls = 0;
    const r = createVisitReporter({
      species: 'porcelain', live: () => true, idle: (fn) => fn(),
      fetch: (async () => {
        calls += 1;
        if (calls > 1) return keptResponse(22);
        return { ok: true, status: 200, json: () => body.promise } as Response;
      }) as never,
    });

    r.note(true);
    await settle();
    assert.equal(r.phase, 'writing', '第一场还没等到 JSON 就不再 writing');
    r.reset();
    if (outcome === 'success') body.resolve({ ok: true, entry: { n: 11 } });
    else body.reject(new SyntaxError('old encounter returned invalid JSON'));
    await settle();
    assert.equal(r.phase, 'idle', `${outcome}：上一场迟到的 body 改写了下一场`);
    assert.equal(r.n, null, `${outcome}：上一场的序号落在下一场头上`);

    r.note(true);
    await settle();
    assert.equal(r.phase, 'kept');
    assert.equal(r.n, 22);
  }
});

test('存档：上一场在第一处迟到拿到 404，仍完成那一场的既定降级但不碰新状态', async () => {
  const first = deferred<Response>();
  const urls: string[] = [];
  const r = createVisitReporter({
    species: 'porcelain', live: () => true, idle: (fn) => fn(), bases: ['/api', 'https://archive.example'],
    fetch: (async (url: string) => {
      urls.push(url);
      if (urls.length === 1) return first.promise;
      return keptResponse(11);
    }) as never,
  });

  r.note(true);
  r.reset();
  first.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  await settle();
  assert.deepEqual(urls, ['/api/visit', 'https://archive.example/visit'],
    '走完整条弧线的旧相遇因 reset 丢掉了既定的 404 fallback');
  assert.equal(r.phase, 'idle');
  assert.equal(r.n, null);
});

test('存档：当前相遇只接受正的安全整数序号，坏回执静默关掉', async () => {
  for (const serial of [undefined, null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '7']) {
    const r = createVisitReporter({
      species: 'porcelain', live: () => true, idle: (fn) => fn(),
      fetch: (async () => ({
        ok: true, status: 200,
        json: async () => ({ ok: true, entry: { n: serial } }),
      })) as never,
    });
    r.note(true);
    await settle();
    assert.equal(r.phase, 'off', `收下了坏序号 ${String(serial)}`);
    assert.equal(r.n, null);
  }
});

test('存档：空闲调度器抛错也不能逃出帧循环', () => {
  let fetched = false;
  const r = createVisitReporter({
    species: 'porcelain', live: () => true,
    idle: () => { throw new Error('scheduler unavailable'); },
    fetch: (async () => { fetched = true; return keptResponse(1); }) as never,
  });
  assert.doesNotThrow(() => r.note(true));
  assert.equal(r.phase, 'off');
  assert.equal(fetched, false);
});

test('存档：reset 发生在 idle callback 之前，完成的旧相遇仍写出但不碰新状态', async () => {
  const queued: Array<() => void> = [];
  const calls: unknown[] = [];
  const r = createVisitReporter({
    species: 'porcelain', live: () => true,
    idle: (fn) => { queued.push(fn); },
    fetch: counting(calls),
  });

  r.note(true);
  assert.equal(queued.length, 1);
  r.reset();
  queued.shift()?.();
  await settle();
  assert.equal(calls.length, 1, '已经走完整条弧线的观众因 idle callback 晚到而被丢掉');
  assert.equal(r.phase, 'idle');
  assert.equal(r.n, null, '旧相遇的序号落在下一位头上');

  r.note(true);
  queued.shift()?.();
  await settle();
  assert.equal(calls.length, 2, '当前相遇的空闲写入被旧 epoch 吞掉了');
  assert.equal(r.phase, 'kept');
  assert.equal(r.n, 2);
});

test('存档：404 和断网都是静默关掉，不重试', async () => {
  for (const outcome of ['404', 'throw'] as const) {
    let n = 0;
    const r = createVisitReporter({
      // 只问一处：这条钉的是「同一处不重试」。两处之间 404 换下一处是另一件事，
      // 钉在 archive-worker.test.ts —— 否则部署那天填上 Worker 地址，这条就会无端变红
      species: 'porcelain', live: () => true, idle: (fn) => fn(), bases: ['/api'],
      fetch: (async () => {
        n++;
        if (outcome === 'throw') throw new Error('offline');
        return { ok: false, status: 404, json: async () => ({}) };
      }) as never,
    });
    r.note(true);
    await settle();
    r.note(true); r.note(true);
    await settle();
    assert.equal(n, 1, `${outcome}：重试了 —— §7.1 第 3 条是失败即静默关掉，本次会话不再尝试`);
    assert.equal(r.phase, 'off');
  }
});

// ─────────────────────── 起一个真 server ───────────────────────

/** 测试里读回来的那一份。字段全是可选的 —— 这些断言要能问"它在不在" */
interface Res {
  status: number;
  body: { ok?: boolean; code?: string; error?: string; total?: number; entry?: Visit; entries?: Visit[] };
}
async function serve(store: Parameters<typeof createArchiveHandler>[0]): Promise<{
  post(path: string, body: unknown): Promise<Res>;
  get(path: string): Promise<Res>;
  close(): void;
}> {
  const handler = createArchiveHandler(store);
  const server = createServer((req, res) => void handler(req, res));
  // keep-alive：`fetch` 留着的那条连接会让 `server.close()` 等到天荒地老，
  // 而 `node --test` 等 server 退出 —— 整个测试文件因此挂着不返回（实测过一次，
  // 而且它比"红"更糟：红会说话，挂着只是慢）。`closeAllConnections()` 是那一把剪刀
  server.on('connection', (s) => void s.unref());
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const read = async (res: Response): Promise<Res> =>
    ({ status: res.status, body: (await res.json()) as Res['body'] });
  return {
    post: async (path, body) => read(await fetch(base + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })),
    get: async (path) => read(await fetch(base + path)),
    close: () => { server.closeAllConnections(); server.close(); },
  };
}
