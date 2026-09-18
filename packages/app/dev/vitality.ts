/**
 * 生命力 A/B 靶场。
 *
 * 为什么是 2D 画骨架线而不是真渲染：要看的是**局部余势的形状**，不是材质和光。
 * 骨架线把它暴露得最清楚，而且不吃 WebGPU —— 无头环境里也能出图。
 */
import { createVitality } from '../../core/src/vitality.ts';
import { buildSkeleton, BONES } from '../../core/src/skeleton.ts';
import { VITALITY } from '../../core/src/tuning.ts';
import type { Skeleton, Vec3 } from '../../core/src/types.ts';
import '../src/ui/type.css';

const BASE: Record<string, Vec3> = {
  pelvis: [0, 0.95, 0], chest: [0, 1.35, 0], neck: [0, 1.45, 0], headCenter: [0, 1.60, 0],
  shoulderL: [0.19, 1.38, 0], elbowL: [0.33, 1.10, 0.02], wristL: [0.44, 0.86, 0.04], handTipL: [0.48, 0.77, 0.05],
  shoulderR: [-0.19, 1.38, 0], elbowR: [-0.33, 1.10, 0.02], wristR: [-0.44, 0.86, 0.04], handTipR: [-0.48, 0.77, 0.05],
  hipL: [0.09, 0.93, 0], kneeL: [0.10, 0.51, 0.01], ankleL: [0.10, 0.09, 0], footIdxL: [0.10, 0.03, 0.16],
  hipR: [-0.09, 0.93, 0], kneeR: [-0.10, 0.51, 0.01], ankleR: [-0.10, 0.09, 0], footIdxR: [-0.10, 0.03, 0.16],
};

/**
 * `BASE` 经 `buildSkeleton` 之后最低的脚关节离地多高。靶场先遵守稳定器的贴地契约，
 * 避免把输入自己的高度误读成 vitality 造成的位移。
 */
const FLOOR = (() => {
  const b = buildSkeleton(BASE, [], 0).joints;
  return Math.min(b.footIdxL[1], b.footIdxR[1], b.ankleL[1], b.ankleR[1]);
})();

/** 一段左右甩臂 —— 延迟在往复运动的**折返点**上最明显，所以用正弦而不是匀速 */
function poseAt(t: number): Skeleton {
  const s = Math.sin(t * 2.1);
  const j: Record<string, Vec3> = {};
  // 按稳定器的输出契约贴地：目标骨架自己就站在 y=0 上（见 FLOOR 的注释）
  for (const k in BASE) j[k] = [BASE[k][0], BASE[k][1] - FLOOR, BASE[k][2]];
  const swing = (k: string, amt: number) => { j[k] = [j[k][0] + s * amt, j[k][1] + Math.abs(s) * amt * 0.5, j[k][2] + s * amt * 0.6]; };
  swing('chest', 0.05); swing('neck', 0.07); swing('headCenter', 0.09);
  swing('shoulderL', 0.10); swing('elbowL', 0.26); swing('wristL', 0.46); swing('handTipL', 0.52);
  swing('shoulderR', 0.08); swing('elbowR', 0.20); swing('wristR', 0.36); swing('handTipR', 0.41);
  return buildSkeleton(j, [], t);
}

const PX = 190, CX = 310, CY = 520;
const project = (p: Vec3): [number, number] => [CX + p[0] * PX, CY - p[1] * PX];

function draw(ctx: CanvasRenderingContext2D, sk: Skeleton, alpha: number, color: string): void {
  ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = alpha > 0.5 ? 2.5 : 1.2;
  ctx.lineCap = 'round';
  for (const [, a, b] of BONES) {
    const pa = sk.joints[a], pb = sk.joints[b];
    if (!pa || !pb) continue;
    const [x0, y0] = project(pa), [x1, y1] = project(pb);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

const ctxOff = (document.getElementById('off') as HTMLCanvasElement).getContext('2d')!;
const ctxOn = (document.getElementById('on') as HTMLCanvasElement).getContext('2d')!;
const num = document.getElementById('num') as HTMLElement;

const vit = createVitality();
const trailOff: Skeleton[] = [];
const trailOn: Skeleton[] = [];
const TRAIL = 12;

let t = 0;
let peakTip = 0, peakChest = 0;

function frame(): void {
  const dt = 1 / 60;
  t += dt;
  const target = poseAt(t);
  const alive = vit.apply(target, dt);

  trailOff.push(target); if (trailOff.length > TRAIL) trailOff.shift();
  trailOn.push(alive); if (trailOn.length > TRAIL) trailOn.shift();

  for (const [ctx, trail, color] of [
    [ctxOff, trailOff, '#9aa0a6'] as const,
    [ctxOn, trailOn, '#7fb3d5'] as const,
  ]) {
    ctx.clearRect(0, 0, 620, 560);
    ctx.strokeStyle = '#2a3038'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, CY); ctx.lineTo(620, CY); ctx.stroke();
    trail.forEach((s, i) => { if (i < trail.length - 1) draw(ctx, s, 0.06 + (i / trail.length) * 0.16, color); });
    draw(ctx, trail[trail.length - 1], 1, color);
  }

  // 数值：手部末端有局部余势；胸口和骨盆必须逐帧等于目标
  const d = (k: string) => Math.hypot(
    alive.joints[k][0] - target.joints[k][0],
    alive.joints[k][1] - target.joints[k][1],
    alive.joints[k][2] - target.joints[k][2]);
  // 骨盆拆成两个方向，现场能直接分辨横向 carrier 与竖直落地有没有被误改。
  const pa = alive.joints.pelvis, pt = target.joints.pelvis;
  const pelvisH = Math.hypot(pa[0] - pt[0], pa[2] - pt[2]);
  const pelvisV = Math.abs(pa[1] - pt[1]);
  peakTip = Math.max(peakTip, d('handTipL'));
  peakChest = Math.max(peakChest, d('chest'));

  if (Math.round(t * 60) % 20 === 0) {
    num.innerHTML =
      `<div>hand lagSeconds <b>${VITALITY.lagSeconds}</b> · lagCurve <b>${VITALITY.lagCurve}</b> · autonomous joints <b>off</b></div>` +
      `<div>指尖落后峰值 <b>${(peakTip * 100).toFixed(1)} cm</b> · 胸口落后峰值 <b>${(peakChest * 100).toFixed(1)} cm</b></div>` +
      `<div>骨盆水平落后 <b>${(pelvisH * 1000).toFixed(2)} mm</b> · 竖直 <b>${(pelvisV * 1000).toFixed(2)} mm</b>（都应当 ≈ 0）· 指尖/胸口 <b>${(peakTip / Math.max(1e-9, peakChest)).toFixed(1)}×</b></div>`;
  }
  requestAnimationFrame(frame);
}
frame();
