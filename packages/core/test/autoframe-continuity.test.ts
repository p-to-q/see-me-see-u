/**
 * 连续性守卫（docs/49 §6.3）：**任何一串取景决策下，每 16ms 的变化量有上限**。
 *
 * 作品负责人第三轮反馈的第一条是"居中、放大、缩小之间没有过渡"。根因是两处一帧跳完的写法
 *（小屏 snap 当帧退回整幅、景别在 hold 时直接切到位，§6.2）。这里不针对那两行写特例，
 * 而是用确定的随机序列把所有输入乱拨：景别、减少动态之外的一切开关、告警、人在哪、人有没有、帧间隔，
 * 逐帧量变化量，按帧间隔折算到 16ms，和 `AUTOFRAME.maxStep` 比。
 *
 * 减少动态**不在**这里：它是写明的例外（0.15 秒读作一次切）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lateralEvidence, stepCrop, stepLateral, stepShot, stepToward, smoothstep, CROP_FULL, LATERAL_REST, SHOT_REST, type Crop, type ShotState,
} from '../src/autoframe.ts';
import { mulberry32 } from '../src/rng.ts';
import { AUTOFRAME } from '../src/tuning.ts';
import { person, SEATED, WHOLE } from './framing-people.ts';

const M = AUTOFRAME.maxStep;
/** 这一帧的变化量折算到 16ms。帧越长允许的变化越大 —— 按时间推的运动在低帧率下是大一点的台阶，不是跳 */
const per16 = (d: number, dt: number): number => Math.abs(d) * (0.016 / dt);

interface Worst { value: number; at: string }
const worst = (): Worst => ({ value: 0, at: '' });
const note = (w: Worst, v: number, at: string): void => { if (v > w.value) { w.value = v; w.at = at; } };

/**
 * 一段确定的乱序：每隔 0.1–1.5 秒重新抽一次开关。帧间隔在 4ms（240Hz）到 66ms（15fps，舞台 step 的上限）之间抽。
 * 返回每一帧的输入，景别 / 裁切 / 腿三路共用。
 */
function chaos(seed: number, seconds: number) {
  const rng = mulberry32(seed);
  const frames: Array<{
    dt: number; shot: 'full' | 'upper'; hold: boolean; offset: { x: number; y: number } | null;
    active: boolean; snap: boolean; cx: number; seated: boolean; present: boolean; legs: boolean;
  }> = [];
  let t = 0, next = 0;
  let cur = { shot: 'full' as 'full' | 'upper', hold: false, active: false, snap: false, cx: 0.5, seated: true, present: true, legs: false, ox: 0, oy: 0 };
  while (t < seconds) {
    if (t >= next) {
      cur = {
        shot: rng.next() < 0.5 ? 'upper' : 'full',
        hold: rng.next() < 0.3,
        active: rng.next() < 0.6,
        snap: rng.next() < 0.35,
        cx: 0.2 + rng.next() * 0.6,
        seated: rng.next() < 0.6,
        present: rng.next() < 0.85,
        legs: rng.next() < 0.5,
        ox: (rng.next() - 0.5) * 0.6,
        oy: (rng.next() - 0.5) * 0.3,
      };
      next = t + 0.1 + rng.next() * 1.4;
    }
    const dt = 0.004 + rng.next() * 0.062;
    t += dt;
    frames.push({
      dt, shot: cur.shot, hold: cur.hold, offset: cur.present ? { x: cur.ox, y: cur.oy } : null,
      active: cur.active, snap: cur.snap, cx: cur.cx, seated: cur.seated, present: cur.present, legs: cur.legs,
    });
  }
  return frames;
}

test('连续性：景别（缓动后的进度、跟随偏移）在任何决策序列下每 16ms 的变化不超过上限 —— 降级 hold 也不许一帧切', () => {
  for (const seed of [1, 2, 3, 7, 42]) {
    let s: ShotState = SHOT_REST;
    const wp = worst(), wv = worst(), wf = worst();
    let t = 0;
    for (const f of chaos(seed, 60)) {
      const n = stepShot(s, {
        shot: f.shot,
        offset: f.offset,
        vertical: f.present ? {
          y: 0.5 + (f.offset?.y ?? 0), anchor: 'pelvis', scale: 0.5, quality: true,
          worldY: 1, accepted: true, cameraFraming: false,
        } : null,
        reduced: false,
        hold: f.hold,
      }, f.dt);
      t += f.dt;
      const at = `seed ${seed} t=${t.toFixed(2)}s shot=${f.shot} hold=${f.hold}`;
      note(wp, per16(smoothstep(n.progress) - smoothstep(s.progress), f.dt), at);
      note(wv, per16(n.velocity - s.velocity, f.dt), at);
      note(wf, per16(Math.hypot(n.fx.x * smoothstep(n.progress) - s.fx.x * smoothstep(s.progress), n.fy.x * smoothstep(n.progress) - s.fy.x * smoothstep(s.progress)), f.dt), at);
      s = n;
    }
    assert.ok(wp.value <= M.progress + 1e-9, `景别进度一帧跳了 ${wp.value.toFixed(3)}/16ms（上限 ${M.progress}）@ ${wp.at}`);
    assert.ok(wv.value <= M.progressVelocity + 1e-9, `景别速度一帧变了 ${wv.value.toFixed(3)}/16ms（上限 ${M.progressVelocity}）@ ${wv.at}`);
    assert.ok(wf.value <= M.pan + 1e-9, `中景跟随一帧挪了 ${wf.value.toFixed(4)}m/16ms（上限 ${M.pan}）@ ${wf.at}`);
  }
});

test('连续性：景别二阶轨迹在 15/30/60/120Hz 的共同时间点近似一致', () => {
  const sample = (hz: number, seconds: number): ShotState => {
    let s: ShotState = SHOT_REST;
    for (let i = 0; i < Math.round(hz * seconds); i++) {
      s = stepShot(s, { shot: 'upper', offset: null, reduced: false, hold: false }, 1 / hz);
    }
    return s;
  };
  for (const seconds of [0.4, 0.8, 1.0]) {
    const states = [15, 30, 60, 120].map((hz) => sample(hz, seconds));
    const progress = states.map((s) => s.progress);
    const velocity = states.map((s) => s.velocity);
    assert.ok(Math.max(...progress) - Math.min(...progress) < 0.005,
      `${seconds}s 的景别进度随帧率漂了：${progress.join(', ')}`);
    assert.ok(Math.max(...velocity) - Math.min(...velocity) < 0.01,
      `${seconds}s 的景别速度随帧率漂了：${velocity.join(', ')}`);
  }
});

test('连续性：小屏裁切（放大倍数、窗口中心）在任何决策序列下每 16ms 的变化不超过上限 —— 告警退回整幅也不许一帧跳完', () => {
  for (const seed of [1, 2, 3, 7, 42]) {
    let c: Crop = CROP_FULL;
    const wz = worst(), wc = worst();
    let t = 0;
    for (const f of chaos(seed, 60)) {
      const screen = f.present ? person({ ...(f.seated ? SEATED : WHOLE), cx: f.cx }).screen : undefined;
      const n = stepCrop(c, { active: f.active, snap: f.snap, screen }, f.dt);
      t += f.dt;
      const at = `seed ${seed} t=${t.toFixed(2)}s active=${f.active} snap=${f.snap} present=${f.present}`;
      note(wz, per16(n.zoom - c.zoom, f.dt), at);
      note(wc, per16(Math.hypot(n.cx.x - c.cx.x, n.cy.x - c.cy.x), f.dt), at);
      c = n;
    }
    assert.ok(wz.value <= M.zoom + 1e-9, `小屏放大倍数一帧跳了 ${wz.value.toFixed(3)}/16ms（上限 ${M.zoom}）@ ${wz.at}`);
    assert.ok(wc.value <= M.center + 1e-9, `小屏窗口中心一帧跳了 ${wc.value.toFixed(4)}/16ms（上限 ${M.center}）@ ${wc.at}`);
  }
});

test('连续性：身体的横向根偏移在任何序列下（人乱跳、出左右边、跟丢、余量随景别变、多人让位）每 16ms 的变化不超过上限', () => {
  for (const seed of [1, 2, 3, 7, 42]) {
    let s = LATERAL_REST;
    const wl = worst();
    let t = 0;
    for (const f of chaos(seed, 60)) {
      t += f.dt;
      // 人的位置在 [-0.1, 1.1] 里乱跳：包括越过左右边
      const cx = -0.1 + ((f.cx - 0.2) / 0.6) * 1.2;
      const ev = f.present ? lateralEvidence(person({ ...WHOLE, cx })) : null;
      // 余量随景别连续地在 0.35 与 1.2 之间变（和舞台一样是连续的）
      const room = 0.35 + 0.85 * (0.5 + 0.5 * Math.sin(t * 0.7));
      const n = stepLateral(s, { evidence: ev, room, enabled: !f.hold, upper: f.shot === 'upper' }, f.dt);
      note(wl, per16(n.x.x - s.x.x, f.dt), `seed ${seed} t=${t.toFixed(2)}s why=${n.why}`);
      s = n;
    }
    assert.ok(wl.value <= M.lateral + 1e-9, `横向根偏移一帧挪了 ${wl.value.toFixed(4)}m/16ms（上限 ${M.lateral}）@ ${wl.at}`);
  }
});

test('连续性：腿混向站姿（缓动后）每 16ms 的变化不超过上限', () => {
  for (const seed of [1, 2, 3]) {
    let w = 0;
    const wl = worst();
    for (const f of chaos(seed, 60)) {
      const n = stepToward(w, f.legs ? 1 : 0, f.dt, AUTOFRAME.legBlendSeconds);
      note(wl, per16(smoothstep(n) - smoothstep(w), f.dt), `seed ${seed}`);
      w = n;
    }
    assert.ok(wl.value <= M.legHold + 1e-9, `腿一帧混了 ${wl.value.toFixed(3)}/16ms（上限 ${M.legHold}）`);
  }
});
