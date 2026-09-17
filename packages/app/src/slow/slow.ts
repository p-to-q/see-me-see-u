/**
 * 慢回路的前端那一半（docs/17 §8）。
 *
 * 这条回路是整件作品唯一的排他主张：**把实时 AI 3D 生成放进交互里**。
 * 2019 年那件原作的回路是「身体 → 形态」，里面没有 AI；我们加的第二条回路是
 * 「你的剪影 → 3D 生成 → 属于你那一档的零件 → 热插接到身上」。
 *
 * 但它必须**永远不能伤到快回路**。慢回路失败的正确表现是"什么都没发生" ——
 * 观众根本不知道刚才有东西在跑（P3）。所以这里的每一条路径都通向同一个终点：
 * `disabled = true`，本页不再尝试，快回路一帧都不受影响。
 *
 * 404 是**正常答案**，不是错误：线上 Web 构建里根本没有这个端点（它是 `apply:'serve'`
 * 的 dev/kiosk 中间件）。装置跑在一台有 factory 的本地机器上 —— 这条回路
 * 从来不需要 serverless，`SlowJob.url` 的注释里早就写着"由 localhost 代理提供"。
 */
import type * as THREE from 'three/webgpu';

import { SLOW_LOOP } from '../../../core/src/tuning.ts';
import { SLOT_OF_BONE } from '../../../core/src/slots.ts';
import type { PartMeta, SlotKey, Slot, SlowJob } from '../../../core/src/types.ts';

/** 慢回路只需要身体的这一个能力；不要在这里依赖整个 BodyInstance */
export interface Graftable {
  graft(slot: SlotKey, meta: PartMeta, geometry: THREE.BufferGeometry): void;
}

export interface SlowLoopDeps {
  /** 最近一帧的人像 mask；没有就是没有（回放模式、ImageSegmenter 起不来） */
  mask(): ImageBitmap | null;
  /** 当前物种 id，决定血统池落在谁名下 */
  species(): string;
  /** 把 glb 地址变成几何。复用 library 的 loader —— meshopt decoder 必须是同一个 */
  loadGeometry(url: string): Promise<THREE.BufferGeometry>;
  body(): Graftable | null;
  /** 每个观众一个匿名 id。随机性留在入口边界，不让本模块自己读随机源。 */
  newSessionId(): string;
  /** 测试缝；正式运行不传时就是浏览器 fetch。 */
  request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** 测试缝；正式运行仍走下面同一份 mask 翻转 + PNG 编码。 */
  encodeMask?: (mask: ImageBitmap) => Promise<Blob | null>;
}

export type SlowPhase = 'idle' | 'armed' | 'running' | 'grafted' | 'off';

export interface SlowLoop {
  /** 每帧调用。alive = presence 处于 ALIVE。不 throw、不 await */
  update(alive: boolean, dt: number): void;
  /** 人走了：换观众 epoch / session，但**不**清 disabled（端点不存在不会因换人变好） */
  reset(): void;
  /** 开场组 genome 之前拉一次前人留下的件 */
  lineage(species: string): Promise<PartMeta[]>;
  readonly phase: SlowPhase;
  /** 给 debug HUD 看的一句话；观众永远看不到它 */
  readonly note: string;
  readonly sessionId: string;
}

const slotKeyOf = (slot: Slot): SlotKey => {
  // spine/head 这类槽位名恰好也是骨头名；其余要反查。
  // 反查表只有一份（core/src/slots.ts），这里不重建。
  for (const [bone, s] of Object.entries(SLOT_OF_BONE)) if (s === slot) return bone as SlotKey;
  return 'spine';
};

/**
 * mask（白形黑底的 ImageBitmap）→ PNG Blob。
 *
 * 为什么要重画一遍而不是直接传原始 bitmap：ImageBitmap 不能直接当 body 发出去，
 * 而且 MediaPipe 的 mask 是镜像前的相机画面 —— 参考图要的是观众看到的那个朝向。
 */
async function maskToPng(mask: ImageBitmap): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = mask.width; c.height = mask.height;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width, 0);
  ctx.scale(-1, 1);                       // 和舞台一样镜像：参考图要跟观众自己看到的一致
  ctx.drawImage(mask, 0, 0);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

function abortError(): Error {
  const e = new Error('观众已换，放弃旧请求');
  e.name = 'AbortError';
  return e;
}

/**
 * 每个请求同时受两道闸：单请求超时 + 观众 epoch 作废。
 * 不直接用 `AbortSignal.any()`，是为了让还没有它的浏览器也能在换人时立即收线。
 */
async function requestWithTimeout(
  request: NonNullable<SlowLoopDeps['request']>,
  url: string,
  init: RequestInit | undefined,
  parent: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent.aborted) abort();
  else parent.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, SLOW_LOOP.requestTimeoutMs);
  try {
    return await request(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', abort);
  }
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const done = () => { signal.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(done, ms);
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(abortError());
    };
    signal.addEventListener('abort', cancel, { once: true });
  });
}

export function createSlowLoop(deps: SlowLoopDeps): SlowLoop {
  // 这里的“会话”是**一个观众**，不是页面寿命。装置一天不刷新，两者不能混。
  let sessionId = deps.newSessionId();
  let epoch = 0;
  let disabled = false;
  let phase: SlowPhase = 'idle';
  let note = '';
  let aliveFor = 0;
  let maskRetryIn = 0;
  let used = 0;
  type RunToken = { epoch: number; abort: AbortController };
  let active: RunToken | null = null;

  const request = deps.request ?? globalThis.fetch.bind(globalThis);
  const encodeMask = deps.encodeMask ?? maskToPng;
  const current = (token: RunToken) => active === token && token.epoch === epoch;

  const off = (why: string) => { disabled = true; phase = 'off'; note = why; };

  async function run(): Promise<void> {
    // mass / swarm 这类身体没有可挂载的槽位。必须在 PNG、网络和扣额度之前就停，
    // 不能花完一次 credit 才发现“身体不在了”。
    let bitmap: ImageBitmap | null;
    try {
      if (!deps.body()) return off('当前形体不接慢回路零件');
      bitmap = deps.mask();
    } catch (e) {
      // 依赖来自采集 / WebGL 边界；即使它们违约也不能把拒绝传播回帧循环。
      return off(e instanceof Error ? e.message : String(e));
    }
    // 没有 mask 不是故障：回放模式本来就没有，ImageSegmenter 起不来也照样跑姿态。
    // 但没有参考图就没有"从这个人长出来的"，所以这一次不做，等下一次。
    if (!bitmap) { note = '等 mask'; return; }

    const token: RunToken = { epoch, abort: new AbortController() };
    active = token;
    used += 1;
    phase = 'running';
    try {
      const png = await encodeMask(bitmap);
      if (!current(token)) return;
      if (!png) return off('canvas 出不了 PNG');

      const species = deps.species();
      const slot = SLOW_LOOP.targetSlots[0] ?? 'spine';
      const q = new URLSearchParams({ slot, species });
      // 旧浏览器拿不到安全随机时，入口可以给空字符串；服务端会代生匿名 id。
      if (sessionId) q.set('session', sessionId);
      const res = await requestWithTimeout(request, `/__slow?${q}`, { method: 'POST', body: png }, token.abort.signal);
      if (!current(token)) return;
      // 404 = 这个构建里没有慢回路，是正常答案；其余非 2xx 多半是预算闸门
      if (!res.ok) return off(res.status === 404 ? '本构建无慢回路' : `提交被拒 ${res.status}`);

      let job = (await res.json()) as SlowJob;
      // Response body 也可以是流；换人可能发生在 fetch 已回、JSON 还没读完之间。
      // 每一个 await 之后都重新验 token，不让旧失败把新观众的回路关掉。
      if (!current(token)) return;
      for (let i = 0; i < SLOW_LOOP.maxPolls && job.status !== 'ready' && job.status !== 'failed'; i++) {
        await waitFor(SLOW_LOOP.pollIntervalMs, token.abort.signal);
        const s = await requestWithTimeout(request, `/__slow/${encodeURIComponent(job.id)}`, undefined, token.abort.signal);
        if (!current(token)) return;
        if (!s.ok) return off(`查询失败 ${s.status}`);
        job = (await s.json()) as SlowJob;
        if (!current(token)) return;
        note = `${job.status} ${i + 1}/${SLOW_LOOP.maxPolls}`;
      }
      if (job.status !== 'ready' || !job.url || !job.meta) {
        // error 是给 HUD 的人话，不弹给观众（docs/17 §8 纪律 1）
        return off(job.error ?? (job.status === 'failed' ? '生成失败' : '轮询超时'));
      }

      const geometry = await deps.loadGeometry(job.url);
      if (!current(token)) { geometry.dispose(); return; }
      const target = deps.body();
      // 身体可能已经换过了（人走了、升档重建）。这时候接上去是错的，静静丢掉。
      if (!target) { geometry.dispose(); return off('身体不在了'); }
      try {
        target.graft(slotKeyOf(job.meta.slot), job.meta, geometry);
      } catch (e) {
        geometry.dispose();
        throw e;
      }
      phase = 'grafted';
      note = `已接上 ${job.meta.id}`;
    } catch (e) {
      // reset() 只是说旧观众走了，不是说新观众的慢回路坏了。
      if (!current(token) || (e instanceof Error && e.name === 'AbortError')) return;
      off(e instanceof Error ? e.message : String(e));
    } finally {
      if (active === token) active = null;
    }
  }

  return {
    get phase() { return phase; },
    get note() { return note; },
    get sessionId() { return sessionId; },

    update(alive, dt) {
      if (disabled || active) return;
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      if (!alive) { aliveFor = 0; maskRetryIn = 0; return; }
      aliveFor += step;
      if (aliveFor < SLOW_LOOP.armAfter) return;
      if (used >= SLOW_LOOP.maxPerSession) return;
      if (phase === 'idle') phase = 'armed';
      // mask 不可用时不能每个渲染帧都碰一次采集边界。倒计时只吃注入的 dt，
      // 不读墙钟；第一次武装仍立即探测，晚到的 mask 最多等一个周期。
      if (maskRetryIn > 0) {
        maskRetryIn = Math.max(0, maskRetryIn - step);
        if (maskRetryIn > 0) return;
      }
      maskRetryIn = SLOW_LOOP.maskRetrySeconds;
      // 故意不 await：慢回路的任何状态都不允许影响这一帧（纪律 3）
      void run();
    },

    reset() {
      epoch += 1;
      active?.abort.abort();
      active = null;
      aliveFor = 0;
      maskRetryIn = 0;
      used = 0;
      sessionId = deps.newSessionId();
      if (!disabled) { phase = 'idle'; note = ''; }
    },

    async lineage(species) {
      try {
        // 这是开机读，还不属于某个 run token；仍然有自己的单请求超时。
        const controller = new AbortController();
        const r = await requestWithTimeout(request, `/__slow/lineage?species=${encodeURIComponent(species)}`, undefined, controller.signal);
        if (!r.ok) return [];      // 生产构建下就是 404，正常
        const j = (await r.json()) as { parts?: PartMeta[] };
        return Array.isArray(j.parts) ? j.parts : [];
      } catch { return []; }       // 血统是锦上添花，永远不许挡住开场
    },
  };
}
