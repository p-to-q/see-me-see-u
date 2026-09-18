/**
 * 取景这一整条输出侧的**纯模拟**：分类器 → 决策 → 小屏的话与裁切 → 腿 → 景别与舞台相机 → 横向根偏移。
 * 顺序照抄 `src/main.ts` 帧循环里取景那几行（和 `ui/preview.ts` 的 `update()`）；不碰 DOM、不碰 three。
 *
 * 用在两处：`/dev/framing.html` 画它，`scripts/framing/trace.ts` 在 node 里跑它、写逐帧 JSON（docs/49 §6.6）。
 * 舞台的包围盒与身高固定在标准站姿（`DEFAULT_BOUNDS`、1.71m）：要看的是取景怎么动，不是身体长什么样。
 */
import {
  createFramingClassifier, decide, imageToStageX, lateralEvidence, stepCrop, stepLateral, stepShot, stepToward,
  verticalEvidence,
  cropTarget, smoothstep, CROP_FULL, LATERAL_REST, SHOT_REST,
  type Crop, type FramingMode, type FramingPolicy, type FramingWhy, type LateralState, type LateralWhy, type Shot, type ShotState,
} from '../../core/src/autoframe.ts';
import { AUTOFRAME } from '../../core/src/tuning.ts';
import type { RawPose } from '../../core/src/types.ts';
import { cropActive, createSeeWatch, type SeeReason, type SeeState } from '../src/ui/preview-state.ts';
import { DEFAULT_BOUNDS, shotCamera } from '../src/stage/framing.ts';

export interface SimInput {
  pose: RawPose | null;
  dt: number;
  policy?: FramingPolicy;
  reduced?: boolean;
  hold?: boolean;
  cameraFraming?: boolean;
  /** 舞台视口宽高比（缺省 16:9） */
  aspect?: number;
}

/** 一帧的全部读数。字段名就是 JSON 里的键 */
export interface SimFrame {
  t: number;
  dt: number;
  mode: FramingMode;
  why: FramingWhy;
  shot: Shot;
  /** 景别进度、速度与缓动后的进度 */
  progress: number;
  velocity: number;
  eased: number;
  /** 舞台相机：竖直视角（度）、移轴（米）、横向余量（米） */
  fov: number;
  panX: number;
  panY: number;
  room: number;
  legHold: number;
  see: { state: SeeState; reason: SeeReason; side: string | null };
  crop: { zoom: number; cx: number; cy: number; active: boolean; snap: boolean; tx: number | null; ty: number | null };
  lateral: { x: number; target: number; deadZone: number; why: LateralWhy; side: string | null };
}

export interface Sim {
  step(input: SimInput): SimFrame;
  readonly trace: SimFrame[];
  reset(): void;
}

export function createSim(opts: { kiosk?: boolean; keep?: number } = {}): Sim {
  const keep = opts.keep ?? Infinity;
  let classifier = createFramingClassifier({ kiosk: opts.kiosk });
  let watch = createSeeWatch();
  let crop: Crop = CROP_FULL;
  let shot: ShotState = SHOT_REST;
  let lateral: LateralState = LATERAL_REST;
  let legHold = 0;
  let t = 0;
  let trace: SimFrame[] = [];

  return {
    step(input) {
      const dt = input.dt;
      const aspect = input.aspect ?? 16 / 9;
      const cam = input.cameraFraming === true;
      t += dt;
      const r = classifier.update(input.pose, dt, { cameraFraming: cam });
      const d = decide(input.policy ?? 'auto', r, { cameraFraming: cam });
      const seen = watch.update({ camera: true, pose: input.pose, upperIsIntended: d.upperIsIntended }, dt);
      const active = cropActive({ upperIsIntended: d.upperIsIntended, reduced: input.reduced ?? false, othersBodied: false });
      const snap = seen.state !== 'ok';
      crop = stepCrop(crop, { active, snap, screen: input.pose?.screen }, dt);
      legHold = stepToward(legHold, d.holdLegs ? 1 : 0, dt, AUTOFRAME.legBlendSeconds);
      // 前倾（头胸相对骨盆）：舞台上它来自骨架；这里从画面折一个同量纲的数
      const s = input.pose?.screen;
      const lean = s ? imageToStageX((s[11].x + s[12].x) / 2, 0.275, aspect) - imageToStageX((s[23].x + s[24].x) / 2, 0.275, aspect) : 0;
      // 舞台用上一帧的余量（`stage.lateralRoom`），这里同样
      const before = shotCamera(DEFAULT_BOUNDS, 1.71, shot, aspect);
      lateral = stepLateral(lateral, { evidence: lateralEvidence(input.pose, aspect), room: before.room, enabled: true, aspect }, dt);
      const verticalRaw = verticalEvidence(input.pose, aspect);
      const vertical = verticalRaw ? {
        ...verticalRaw, worldY: 0, accepted: lateral.why !== 'hold-jump', cameraFraming: cam,
      } : verticalRaw;
      const drift = 0;
      shot = stepShot(shot, {
        shot: d.shot === 'upper' && drift <= 0 ? 'upper' : 'full',
        offset: input.pose ? { x: lean, y: 0 } : null,
        vertical,
        reduced: input.reduced ?? false,
        hold: input.hold ?? false,
      }, dt);
      const c = shotCamera(DEFAULT_BOUNDS, 1.71, shot, aspect);
      const target = active && !snap ? cropTarget(s, AUTOFRAME.previewZoom) : null;
      const frame: SimFrame = {
        t, dt, mode: r.mode, why: r.why, shot: d.shot,
        progress: shot.progress, velocity: shot.velocity, eased: smoothstep(shot.progress),
        fov: c.fov, panX: c.panX, panY: c.panY, room: c.room, legHold: smoothstep(legHold),
        see: { state: seen.state, reason: seen.reason, side: seen.side ?? null },
        crop: { zoom: crop.zoom, cx: crop.cx.x, cy: crop.cy.x, active, snap, tx: target?.x ?? null, ty: target?.y ?? null },
        lateral: { x: lateral.x.x, target: lateral.target, deadZone: lateral.deadZone, why: lateral.why, side: lateral.side },
      };
      trace.push(frame);
      if (trace.length > keep) trace.shift();
      return frame;
    },
    get trace() { return trace; },
    reset() {
      classifier = createFramingClassifier({ kiosk: opts.kiosk });
      watch = createSeeWatch();
      crop = CROP_FULL; shot = SHOT_REST; lateral = LATERAL_REST; legHold = 0; t = 0; trace = [];
    },
  };
}

/** 一段逐帧读数里，每一路**折到 16ms** 的最大变化量与它发生的时刻 */
export type Jumps = Record<'progress' | 'progressVelocity' | 'zoom' | 'center' | 'legHold' | 'lateral' | 'fovDeg' | 'pan', { value: number; t: number }>;

export function maxJumps(trace: readonly SimFrame[]): Jumps {
  const out = {} as Jumps;
  const put = (k: keyof Jumps, v: number, t: number) => { if (!out[k] || v > out[k].value) out[k] = { value: v, t }; };
  for (const k of ['progress', 'progressVelocity', 'zoom', 'center', 'legHold', 'lateral', 'fovDeg', 'pan'] as const) out[k] = { value: 0, t: 0 };
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1], b = trace[i];
    const k = 0.016 / b.dt;
    put('progress', Math.abs(b.eased - a.eased) * k, b.t);
    put('progressVelocity', Math.abs(b.velocity - a.velocity) * k, b.t);
    put('zoom', Math.abs(b.crop.zoom - a.crop.zoom) * k, b.t);
    put('center', Math.hypot(b.crop.cx - a.crop.cx, b.crop.cy - a.crop.cy) * k, b.t);
    put('legHold', Math.abs(b.legHold - a.legHold) * k, b.t);
    put('lateral', Math.abs(b.lateral.x - a.lateral.x) * k, b.t);
    put('fovDeg', Math.abs(b.fov - a.fov) * k, b.t);
    put('pan', Math.hypot(b.panX - a.panX, b.panY - a.panY) * k, b.t);
  }
  return out;
}
