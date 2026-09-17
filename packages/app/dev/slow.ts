/**
 * 慢回路靶场 —— 只跑**前端**那一半，服务端是真的。
 *
 * 为什么需要它：浏览器里没有摄像头就没有人像 mask，慢回路的前端路径
 * 因此在任何自动化环境里都走不到。没有这一页，`slow.ts` 就只有 typecheck 背书 ——
 * 而它是整件作品唯一那条排他主张的一半。
 *
 * 这里画一张剪影顶替 mask。**只有 mask 是假的**：提交、轮询、规范化、
 * 血统池落盘、graft 调用全部是真路径。
 */
import type * as THREE from 'three/webgpu';

import { createPartLibrary } from '../src/assets/library.ts';
import { createSlowLoop, type Graftable } from '../src/slow/slow.ts';
import { SLOW_LOOP } from '../../core/src/tuning.ts';
import type { PartMeta, SlotKey } from '../../core/src/types.ts';
import '../src/ui/type.css';

const log = document.getElementById('log') as HTMLElement;
const line = (label: string, value: string, cls = '') => {
  const d = document.createElement('div');
  d.innerHTML = `<b>${label}</b> <span class="${cls}">${value}</span>`;
  log.appendChild(d);
};

// 一张最粗糙的人形剪影：白形黑底，和 docs/07 §4B 对参考图的要求一致
const c = document.getElementById('mask') as HTMLCanvasElement;
const ctx = c.getContext('2d')!;
ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 256, 256);
ctx.fillStyle = '#fff';
ctx.beginPath(); ctx.arc(128, 48, 26, 0, Math.PI * 2); ctx.fill();
ctx.fillRect(104, 76, 48, 96);
ctx.fillRect(72, 84, 32, 16); ctx.fillRect(152, 84, 32, 16);
ctx.fillRect(108, 172, 16, 64); ctx.fillRect(132, 172, 16, 64);

const library = createPartLibrary();
await library.load();

let grafted: { slot: SlotKey; meta: PartMeta } | null = null;
const body: Graftable = {
  graft(slot, meta, geometry: THREE.BufferGeometry) {
    grafted = { slot, meta };
    line('graft()', `${slot} ← ${meta.id} · ${geometry.getAttribute('position').count} 顶点`, 'ok');
  },
};

const slow = createSlowLoop({
  mask: () => maskBitmap,
  species: () => 'porcelain',
  loadGeometry: (url) => library.loadUrl(url),
  body: () => body,
  newSessionId: () => globalThis.crypto?.randomUUID?.() ?? '',
});

const maskBitmap = await createImageBitmap(c);

line('session', slow.sessionId);
line('armAfter', `${SLOW_LOOP.armAfter}s（靶场直接跳过）`);
const lin = await slow.lineage('porcelain');
line('血统池', lin.length ? `${lin.length} 件：${lin.map((p) => p.id).join(', ')}` : '空（第一次跑就是空的）');

// 直接把 armAfter 喂满，不用真等 20 秒
slow.update(true, SLOW_LOOP.armAfter + 1);
line('phase', slow.phase);

const t0 = performance.now();
const timer = setInterval(() => {
  line('轮询', `${slow.phase} · ${slow.note} · ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  if (slow.phase === 'grafted' || slow.phase === 'off') {
    clearInterval(timer);
    const ok = slow.phase === 'grafted' && grafted !== null;
    line('结论', ok ? '前端回路走通：剪影 → 提交 → 轮询 → glb → graft' : `没走通：${slow.note}`, ok ? 'ok' : 'bad');
    // 给自动化用：无头浏览器读这个属性，不用去解析文字
    document.body.dataset.result = ok ? 'pass' : 'fail';
  }
}, 1000);
