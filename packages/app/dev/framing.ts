/**
 * 取景靶场 —— 分类器每一帧看到了什么、判了什么，以及**它让画面怎么动**（docs/49 §5 / §6）。
 *
 * 为什么是 2D 而不是真舞台：要看的是判据与控制器（目标框、死区、实际窗口、横向余量），不是渲染。
 * 不吃 WebGPU，无头环境里也能出图。舞台上的效果去 `/?debug=1` 看 HUD 的 framing 两行。
 *
 * 画面上有三块：
 *  - **原图**（没镜像）：33 个点（实心 = 可信）、小屏裁切的**目标窗口**（虚线）、窗口中心的**死区**（小方框）、**实际窗口**（实线）；
 *    从左右走出画时，出去的那条边加粗。
 *  - **舞台横向**（屏幕视角，镜像之后）：余量（浅色带）、目标（虚线刻度）、死区（身体两侧的细线）、身体此刻的位置。
 *  - **最近 20 秒**：模式色带 + 放大倍数 / 景别进度 / 横向偏移 / 腿的曲线。
 *
 * 默认播合成时间线（`core/test/framing-people.ts` 的 `SCRIPTS`，和 node 测试、`scripts/framing/trace.ts` 同一份），
 * 按「用摄像头」才请求权限 —— 和正式程序同一条规矩：不点就不问。
 *
 * 取证：`?script=out-left&loop=0&dt=fixed` 播一遍就停、每帧固定 1/60 秒，播完 `window.__framingDone = true`；
 * 逐帧读数在 `window.__framingTrace`，每 16ms 的最大变化量在 `window.__framingJumps`。
 */
import { isFramingPolicy, trustedLandmark, type FramingMode, type FramingPolicy } from '../../core/src/autoframe.ts';
import { AUTOFRAME } from '../../core/src/tuning.ts';
import type { RawPose } from '../../core/src/types.ts';
import { SCRIPTS, scriptAt, scriptSeconds } from '../../core/test/framing-people.ts';
import type { Capture } from '../src/capture/capture.ts';
import { formatFramingRows } from '../src/shell/hud.ts';
import { createSim, maxJumps, type SimFrame } from './framing-sim.ts';
import '../src/ui/type.css';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const view = $<HTMLCanvasElement>('view');
const stageCv = $<HTMLCanvasElement>('stage');
const plot = $<HTMLCanvasElement>('line');
const num = $<HTMLDivElement>('num');
const vctx = view.getContext('2d')!;
const sctx = stageCv.getContext('2d')!;
const pctx = plot.getContext('2d')!;

const q = new URLSearchParams(location.search);
let scriptName = q.get('script') && SCRIPTS[q.get('script')!] ? q.get('script')! : 'sitstand';
const loop = q.get('loop') !== '0';
const fixedDt = q.get('dt') === 'fixed';
/** 'script' = 听时间线里写的策略（sitstand 里有一段控件条换成 full） */
let policyChoice: FramingPolicy | 'script' = isFramingPolicy(q.get('framing')) ? (q.get('framing') as FramingPolicy) : 'script';
let kiosk = q.get('kiosk') === '1';
let reduced = q.get('reduced') === '1';
let camFraming = q.get('camframing') === 'on';
let forceHold = false;
let sim = createSim({ kiosk, keep: loop ? 1200 : Infinity });
let capture: Capture | null = null;
let t = 0;
let last = performance.now();
let done = false;
const W = window as unknown as { __framingTrace?: SimFrame[]; __framingJumps?: unknown; __framingDone?: boolean };

function restart(): void {
  sim = createSim({ kiosk, keep: loop ? 1200 : Infinity });
  t = 0; done = false; W.__framingDone = false;
}

const scriptSel = $<HTMLSelectElement>('script');
for (const name of Object.keys(SCRIPTS)) { const o = document.createElement('option'); o.textContent = name; scriptSel.append(o); }
scriptSel.value = scriptName;
scriptSel.addEventListener('change', () => { scriptName = scriptSel.value; capture?.stop(); capture = null; restart(); });
$<HTMLSelectElement>('policy').value = policyChoice;
$<HTMLSelectElement>('policy').addEventListener('change', (e) => { policyChoice = (e.target as HTMLSelectElement).value as FramingPolicy | 'script'; });
const bindBox = (id: string, get: () => boolean, set: (v: boolean) => void, reset = false): void => {
  const el = $<HTMLInputElement>(id);
  el.checked = get();
  el.addEventListener('change', () => { set(el.checked); if (reset) restart(); });
};
bindBox('kiosk', () => kiosk, (v) => { kiosk = v; }, true);
bindBox('reduced', () => reduced, (v) => { reduced = v; });
bindBox('hold', () => forceHold, (v) => { forceHold = v; });
bindBox('camframing', () => camFraming, (v) => { camFraming = v; });
$<HTMLButtonElement>('cam').addEventListener('click', async () => {
  const { createCapture } = await import('../src/capture/capture.ts');
  const c = await createCapture('webcam');
  await c.start();
  if (c.lastError) { $('src').textContent = `摄像头没开起来：${c.lastError}`; c.stop(); return; }
  capture = c;
  restart();
});

const COLOR: Record<FramingMode, string> = { full: '#8a9099', upper: '#e8a33d', 'stepping-back': '#5aa9e6' };
const PAD = 0.14;

function drawView(pose: RawPose | null, f: SimFrame): void {
  const Wd = view.width, H = view.height;
  vctx.fillStyle = '#0a0b0d';
  vctx.fillRect(0, 0, Wd, H);
  // 画框留一圈边：画外的点也要画得出来（它们是"出画"的证据）
  const sx = (x: number) => (PAD + x * (1 - 2 * PAD)) * Wd;
  const sy = (y: number) => (PAD + y * (1 - 2 * PAD)) * H;
  vctx.lineWidth = 1;
  vctx.strokeStyle = '#555';
  vctx.strokeRect(sx(0), sy(0), sx(1) - sx(0), sy(1) - sy(0));
  // 侧边：观众的左 = 原图的右边（`MIRROR_X`），加粗出去的那条边
  if (f.see.reason === 'side' && f.see.side) {
    const x = f.see.side === 'left' ? sx(1) : sx(0);
    vctx.strokeStyle = '#e8a33d'; vctx.lineWidth = 4;
    vctx.beginPath(); vctx.moveTo(x, sy(0)); vctx.lineTo(x, sy(1)); vctx.stroke();
  }
  const pts = pose?.screen;
  pts?.forEach((l, i) => {
    if (!Number.isFinite(l.x) || !Number.isFinite(l.y)) return;
    const leg = i >= 25 && i <= 28;
    vctx.beginPath();
    vctx.arc(sx(l.x), sy(l.y), leg ? 5 : 3, 0, Math.PI * 2);
    vctx.strokeStyle = vctx.fillStyle = leg ? '#e8a33d' : '#e6e6e6';
    vctx.lineWidth = 1;
    if (trustedLandmark(l)) vctx.fill(); else vctx.stroke();
  });
  const box = (cx: number, cy: number, zoom: number) => {
    const w = 1 / zoom;
    return [sx(cx - w / 2), sy(cy - w / 2), sx(cx + w / 2) - sx(cx - w / 2), sy(cy + w / 2) - sy(cy - w / 2)] as const;
  };
  // 目标窗口（虚线）：控制器想去的地方
  if (f.crop.tx !== null && f.crop.ty !== null) {
    vctx.setLineDash([6, 5]); vctx.strokeStyle = '#5aa9e6'; vctx.lineWidth = 1.5;
    vctx.strokeRect(...box(f.crop.tx, f.crop.ty, AUTOFRAME.previewZoom));
    vctx.setLineDash([]);
  }
  // 死区：窗口中心周围 ±previewDeadZone，目标中心落在里面就不动
  const d = AUTOFRAME.previewDeadZone;
  vctx.strokeStyle = '#5aa9e6'; vctx.lineWidth = 1;
  vctx.strokeRect(sx(f.crop.cx - d), sy(f.crop.cy - d), sx(f.crop.cx + d) - sx(f.crop.cx - d), sy(f.crop.cy + d) - sy(f.crop.cy - d));
  // 实际窗口（实线）
  vctx.strokeStyle = f.crop.snap ? '#e0455a' : '#ffffff'; vctx.lineWidth = 2;
  vctx.strokeRect(...box(f.crop.cx, f.crop.cy, f.crop.zoom));
  vctx.fillStyle = '#9aa'; vctx.font = '12px ui-monospace, monospace';
  vctx.fillText('原图（没镜像）· 虚线 = 目标窗口 · 小框 = 死区 · 实线 = 实际窗口（红 = 在诚实退回）', 8, 16);
}

function drawStage(f: SimFrame): void {
  const Wd = stageCv.width, H = stageCv.height;
  sctx.fillStyle = '#0a0b0d';
  sctx.fillRect(0, 0, Wd, H);
  const span = 2.0;
  const X = (m: number) => Wd / 2 + (m / span) * (Wd / 2 - 10);
  const y = H * 0.55;
  sctx.fillStyle = '#1e2328';
  sctx.fillRect(X(-f.room), y - 22, X(f.room) - X(-f.room), 44);
  sctx.strokeStyle = '#444'; sctx.beginPath(); sctx.moveTo(X(-span), y); sctx.lineTo(X(span), y); sctx.moveTo(X(0), y - 30); sctx.lineTo(X(0), y + 30); sctx.stroke();
  // 目标（虚线刻度，夹住之前的那个数）
  sctx.setLineDash([4, 4]); sctx.strokeStyle = '#5aa9e6';
  const tx = Math.max(-span, Math.min(span, f.lateral.target));
  sctx.beginPath(); sctx.moveTo(X(tx), y - 34); sctx.lineTo(X(tx), y + 34); sctx.stroke();
  sctx.setLineDash([]);
  // 身体（0.5m 宽的一块）与它两侧的死区
  const dz = f.lateral.deadZone;
  sctx.fillStyle = f.lateral.why === 'follow' ? '#e6e6e6' : '#e8a33d';
  sctx.fillRect(X(f.lateral.x - 0.25), y - 16, X(f.lateral.x + 0.25) - X(f.lateral.x - 0.25), 32);
  sctx.strokeStyle = '#5aa9e6';
  for (const s of [-1, 1]) { sctx.beginPath(); sctx.moveTo(X(f.lateral.x + s * dz), y - 26); sctx.lineTo(X(f.lateral.x + s * dz), y + 26); sctx.stroke(); }
  sctx.fillStyle = '#9aa'; sctx.font = '12px ui-monospace, monospace';
  sctx.fillText(`舞台横向（屏幕视角）· 浅带 = 余量 ±${f.room.toFixed(2)}m · 虚线 = 目标 · 蓝细线 = 死区 · 身体 ${f.lateral.x >= 0 ? '+' : ''}${f.lateral.x.toFixed(2)}m ${f.lateral.why}`, 8, 16);
}

const HISTORY = 20;
function drawPlot(trace: readonly SimFrame[]): void {
  const Wd = plot.width, H = plot.height;
  pctx.clearRect(0, 0, Wd, H);
  const now = trace.length ? trace[trace.length - 1].t : 0;
  const px = (tt: number) => Wd - ((now - tt) / HISTORY) * Wd;
  const recent = trace.filter((f) => now - f.t <= HISTORY);
  for (let i = 0; i < recent.length; i++) {
    const a = recent[i], b = recent[i + 1];
    pctx.fillStyle = COLOR[a.mode];
    pctx.fillRect(px(a.t), 0, Math.max(1, (b ? px(b.t) : Wd) - px(a.t)), 10);
  }
  const lines: Array<[string, (f: SimFrame) => number]> = [
    ['#ffffff', (f) => (f.crop.zoom - 1) / Math.max(1e-6, AUTOFRAME.previewZoom - 1)],
    ['#e8a33d', (f) => f.eased],
    ['#5aa9e6', (f) => 0.5 + f.lateral.x / 4],
    ['#7bc47f', (f) => f.legHold],
  ];
  for (const [color, get] of lines) {
    pctx.strokeStyle = color; pctx.lineWidth = 1.5; pctx.beginPath();
    recent.forEach((f, i) => { const yy = H - 6 - get(f) * (H - 22); if (i) pctx.lineTo(px(f.t), yy); else pctx.moveTo(px(f.t), yy); });
    pctx.stroke();
  }
}

function frame(): void {
  const nowMs = performance.now();
  const dt = fixedDt ? 1 / 60 : Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  const segs = SCRIPTS[scriptName];
  const total = scriptSeconds(segs);
  if (!capture && !loop && t >= total) {
    if (!done) { done = true; W.__framingDone = true; }
    requestAnimationFrame(frame);
    return;
  }
  const s = capture ? { pose: capture.latest(), policy: 'auto' as const, hold: false } : scriptAt(segs, t);
  t += dt;
  const policy = policyChoice === 'script' ? s.policy : policyChoice;
  const f = sim.step({ pose: s.pose, dt, policy, reduced, hold: forceHold || s.hold, cameraFraming: camFraming });
  $('src').textContent = capture ? '摄像头' : `${scriptName} ${(t % total).toFixed(1)} / ${total.toFixed(1)}s`;
  drawView(s.pose, f);
  drawStage(f);
  drawPlot(sim.trace);
  const jumps = maxJumps(sim.trace);
  W.__framingTrace = sim.trace;
  W.__framingJumps = jumps;
  const M = AUTOFRAME.maxStep as Record<string, number>;
  const [a, b] = formatFramingRows({
    reading: { mode: f.mode, why: f.why, inMode: 0, evidence: null, trend: NaN, cooldown: 0, cameraFraming: camFraming },
    decision: { policy, mode: f.mode, shot: f.shot, holdLegs: f.legHold > 0, upperIsIntended: f.shot === 'upper' },
    legHold: f.legHold, shot: f.eased,
    lateral: { x: f.lateral.x, room: f.room, why: f.lateral.why, side: f.lateral.side },
  });
  num.innerHTML = '';
  for (const [text, bad] of [
    [a, false], [b, false],
    [`小屏：${f.see.state}/${f.see.reason}${f.see.side ? `（观众的${f.see.side === 'left' ? '左' : '右'}边）` : ''} · 裁切 ${f.crop.active ? '开' : '关'}${f.crop.snap ? ' · 诚实退回中' : ''} · zoom ${f.crop.zoom.toFixed(3)} · 中心 (${f.crop.cx.toFixed(3)}, ${f.crop.cy.toFixed(3)})`, false],
    [`舞台：景别 ${f.shot} ${(f.eased * 100).toFixed(0)}% · fov ${f.fov.toFixed(2)}° · 移轴 ${f.panX.toFixed(3)}m · 腿 ${f.legHold.toFixed(2)}`, false],
    ...Object.entries(jumps).map(([k, v]) => [`每 16ms 最大 ${k}: ${v.value.toFixed(4)}（上限 ${M[k]}）@ ${v.t.toFixed(2)}s`, v.value > M[k] + 1e-9] as [string, boolean]),
    ['曲线：白 = 放大倍数 · 琥珀 = 景别 · 蓝 = 横向偏移 · 绿 = 腿；顶上色带：灰 full / 琥珀 upper / 蓝 stepping-back', false],
  ] as Array<[string, boolean]>) {
    const el = document.createElement('div');
    el.textContent = text;
    if (bad) el.style.color = '#e0455a';
    num.append(el);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
