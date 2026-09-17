/**
 * 慢回路的 HTTP 外壳（connect 风格中间件）。
 * 挂载点在 packages/app/vite.config.ts 的 `/__slow`：dev 本机存在，现场 preview 只在
 * `SLOW_ENABLE=1` 时存在；两者都拒绝非 loopback 请求。
 *
 * 为什么不把这段直接写进 vite.config.ts：那里没法被测试打到。
 * `/__curate` 已经立了同样的规矩 —— 中间件在 vite.config 里登记，逻辑在 factory 里。
 * 这条口子会花真钱，它的每一条拒绝路径都必须有测试。
 *
 * 形状跟着 `/__anchor` `/__curate` `/__demo`：POST-only、正则挡路径穿越、
 * 大小上限、结构化 JSON 错误（`{ok:false, code, error}`）。
 */
import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SLOW_LOOP } from '../../core/src/tuning.ts';
import { createSlowLoop, SlowRejected, type SlowLoop } from './slow.ts';

/** 剪影是一张 PNG。真人全身 mask 实测 20–120KB，8MB 是"显然不是剪影"的线 */
const MAX_MASK_BYTES = 8 * 1024 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}
const fail = (res: ServerResponse, status: number, code: string, error: string) =>
  json(res, status, { ok: false, code, error });

export function createSlowHandler(loop: SlowLoop) {
  return async function slowHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const [rawPath, rawQuery] = (req.url ?? '/').split('?');
    const path = decodeURIComponent(rawPath || '/');
    const q = new URLSearchParams(rawQuery ?? '');

    try {
      // ── 提交：POST /__slow?slot=&session=&species= ──
      if (path === '/' || path === '') {
        if (req.method !== 'POST') return fail(res, 405, 'METHOD', 'POST only');
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const c of req) {
          bytes += (c as Buffer).length;
          if (bytes > MAX_MASK_BYTES) return fail(res, 413, 'TOO_LARGE', `剪影超过 ${MAX_MASK_BYTES / 1e6}MB`);
          chunks.push(c as Buffer);
        }
        const mask = Buffer.concat(chunks);
        // 认 PNG 魔数而不是 content-type：前端 canvas.toBlob 出来的就是 PNG，
        // 而 content-type 是请求方随口说的
        if (mask.length < 8 || !PNG_MAGIC.every((b, i) => mask[i] === b)) {
          return fail(res, 400, 'BAD_REQUEST', '请求体必须是一张 PNG 剪影');
        }
        const job = loop.submit({
          mask,
          slot: q.get('slot') ?? undefined,
          session: q.get('session') ?? undefined,
          species: q.get('species') ?? undefined,
        });
        return json(res, 200, job);
      }

      // ── glb：GET /__slow/part/<partId>.glb ──
      if (path.startsWith('/part/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'METHOD', 'GET only');
        const id = path.slice('/part/'.length).replace(/\.glb$/, '');
        const file = loop.partPath(id);
        if (!file) return fail(res, 404, 'NO_PART', `没有这件：${id}`);
        res.statusCode = 200;
        res.setHeader('content-type', 'model/gltf-binary');
        res.setHeader('content-length', String(statSync(file).size));
        // 血统池的件名字唯一（带 job id 尾巴），不会被同名覆盖 → 可以长缓存
        res.setHeader('cache-control', 'max-age=86400');
        if (req.method === 'HEAD') return void res.end();
        return void createReadStream(file).pipe(res);
      }

      // ── 血统池：GET /__slow/lineage?species= ──
      if (path === '/lineage') {
        if (req.method !== 'GET') return fail(res, 405, 'METHOD', 'GET only');
        const limit = Math.min(Number(q.get('limit')) || SLOW_LOOP.lineageServeLimit, SLOW_LOOP.lineageServeLimit);
        const { parts, entries, total } = loop.lineage({ species: q.get('species') ?? undefined, limit });
        return json(res, 200, {
          ok: true,
          chance: SLOW_LOOP.lineageChance,
          total,
          parts,
          // 只吐匿名痕迹，不吐整条 meta 两遍
          entries: entries.map((e) => ({
            id: e.id, session: e.session, createdAt: e.createdAt,
            species: e.species, slot: e.slot, provider: e.provider,
          })),
        });
      }

      // ── 查状态：GET /__slow/<jobId> ──
      if (req.method !== 'GET') return fail(res, 405, 'METHOD', 'GET only');
      const job = loop.get(path.slice(1));
      if (!job) return fail(res, 404, 'NO_JOB', `没有这个任务：${path.slice(1)}`);
      return json(res, 200, job);
    } catch (e) {
      if (e instanceof SlowRejected) return fail(res, e.httpStatus, e.code, e.message);
      // 中间件里抛出去会把 dev server 的请求挂死；一律翻成 500 JSON
      return fail(res, 500, 'INTERNAL', String((e as Error)?.message ?? e));
    }
  };
}

let handler: ReturnType<typeof createSlowHandler> | undefined;
/** dev server 用的单例入口 */
export function slowHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!handler) handler = createSlowHandler(createSlowLoop());
  return handler(req, res);
}
