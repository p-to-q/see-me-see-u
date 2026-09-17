/**
 * 横向（docs/49 §6.3 二）：躯干在画面里的位置 → 身体的有界横向根偏移；出了左右边时报哪一侧。
 * 每一条边界一个裁定、一个断言。30Hz 喂合成的"画面里的人"（`framing-people.ts`）。
 *
 * 数的换算（便于读断言）：全身站着的人（`WHOLE`，s = 0.5）躯干长 ≈ 0.275 画面高度，
 * 画面 x 每挪 0.1 ≈ 身体挪 0.32 米。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  imageToStageX, lateralEvidence, stageToImageX, stepLateral, LATERAL_REST, type LateralState,
} from '../src/autoframe.ts';
import { AUTOFRAME } from '../src/tuning.ts';
import type { RawPose } from '../src/types.ts';
import { person, WHOLE, type PersonSpec } from './framing-people.ts';

const DT = 1 / 30;
const at = (cx: number, extra: PersonSpec = {}): RawPose => person({ ...WHOLE, cx, ...extra });
const FIXTURE_SCALE = lateralEvidence(at(0.5, { s: 1 }))!.scale;
/** `PersonSpec.s` 不是躯干尺度；身份门吃的是 `lateralEvidence().scale`，由这里精确反解。 */
const atTorsoScale = (cx: number, scale: number, extra: PersonSpec = {}): RawPose =>
  at(cx, { ...extra, s: scale / FIXTURE_SCALE });

interface Opts {
  room?: number | ((i: number) => number); enabled?: (i: number) => boolean; upper?: boolean;
  cameraFraming?: boolean;
}
function run(frames: Array<RawPose | null>, opts: Opts = {}, from: LateralState = LATERAL_REST): LateralState[] {
  const out: LateralState[] = [];
  let s = from;
  frames.forEach((f, i) => {
    const room = typeof opts.room === 'function' ? opts.room(i) : opts.room ?? 2;
    s = stepLateral(s, {
      evidence: lateralEvidence(f), room, enabled: opts.enabled?.(i) ?? true, upper: opts.upper,
      cameraFraming: opts.cameraFraming,
    }, DT);
    out.push(s);
  });
  return out;
}
const hold = (seconds: number, pose: (i: number) => RawPose | null): Array<RawPose | null> =>
  Array.from({ length: Math.round(seconds * 30) }, (_, i) => pose(i));
const last = <T>(a: T[]): T => a[a.length - 1];
/** 每帧变化折到 16ms 的最大值 */
const maxPer16 = (xs: number[]): number => xs.reduce((m, x, i) => (i ? Math.max(m, Math.abs(x - xs[i - 1]) * (0.016 / DT)) : m), 0);

test('镜像：观众往自己左边走（画面 x 变大）→ 身体往屏幕左边（x < 0）；越过画面右边的是观众的左边', () => {
  const s = run([...hold(1, () => at(0.5)), ...hold(3, () => at(0.62))]);
  assert.ok(last(s).x.x < -0.25, `往自己左边走了 0.12 画面宽，身体只到 ${last(s).x.x.toFixed(3)}`);
  assert.ok(imageToStageX(0.62, 0.275) < 0);
  assert.equal(lateralEvidence(at(1.02))?.side, 'left', '越过画面右边 = 观众的左边');
  assert.equal(lateralEvidence(at(-0.02))?.side, 'right', '越过画面左边 = 观众的右边');
});

test('画面 / 舞台横坐标互为逆变换：近远距离与横竖画幅都逐位收敛', () => {
  for (const aspect of [4 / 3, 16 / 9, 9 / 16]) {
    for (const scale of [0.04, 0.1, 0.5, 1]) {
      for (const cx of [0.1, 0.5, 0.9]) {
        const roundTrip = stageToImageX(imageToStageX(cx, scale, aspect), scale, aspect);
        assert.ok(Math.abs(roundTrip - cx) < 1e-12,
          `aspect=${aspect} scale=${scale} cx=${cx}: round-trip=${roundTrip}`);
      }
    }
  }
});

test('前倾 vs 迈步：只有胯动才动。上半身往一边倾 0.05 画面宽身体不动；整个人挪 0.05 身体跟过去', () => {
  const lean = (): RawPose => {
    const p = at(0.5);
    return { ...p, screen: p.screen!.map((l, i) => (i <= 22 ? { ...l, x: l.x + 0.05 } : l)) };
  };
  const leaning = run([...hold(1, () => at(0.5)), ...hold(3, lean)]);
  assert.ok(Math.abs(last(leaning).x.x) < 1e-9, `前倾让身体挪了 ${last(leaning).x.x}`);
  const stepping = run([...hold(1, () => at(0.5)), ...hold(3, () => at(0.55))]);
  assert.ok(last(stepping).x.x < -0.08, `迈了一步身体只挪了 ${last(stepping).x.x.toFixed(3)}`);
});

test('贴边但整个人都在画里：不报侧边、照常跟随，走到舞台余量的边上为止', () => {
  const ev = lateralEvidence(at(0.08))!;
  assert.equal(ev.side, null, `整个人都在画里却报了 ${ev.side}（越界 ${ev.out}）`);
  assert.equal(ev.out, 0);
  const s = run(hold(4, () => at(0.08)), { room: 1.0 });
  // 目标被夹在余量上；弹簧停在它的死区 + 过渡带之内（死区本来就是"差这么一点不追"）
  assert.ok(last(s).x.x >= 1.0 - last(s).deadZone - last(s).band, `没走到余量边上：${last(s).x.x}`);
  assert.ok(s.every((k) => k.x.x <= 1.0 + 1e-9), '出了舞台余量');
});

test('半个人出了一边：报那一侧；身体停在跨出去那一刻的位置，不追外推出来的坐标', () => {
  const walk = hold(1, (i) => at(0.3 - (0.33 * i) / 30));
  const s = run([...hold(2, () => at(0.3)), ...walk, ...hold(2, () => at(-0.03))]);
  const firstEdge = s.findIndex((k) => k.why === 'hold-edge');
  assert.ok(firstEdge > 0, `一直没有停：${[...new Set(s.map((k) => k.why))]}`);
  assert.equal(last(s).side, 'right');
  assert.ok(Math.abs(last(s).x.x - s[firstEdge].x.x) < 0.15, `停住之后又挪了 ${(last(s).x.x - s[firstEdge].x.x).toFixed(3)} 米`);
});

test('整个人走出一边、检测还在（躯干点全不可信、坐标在边外）：照样报那一侧；身体停在边上，人还在边外时不回中线', () => {
  const ev = lateralEvidence(at(1.08))!;
  assert.equal(ev.side, 'left');
  assert.equal(ev.trusted, false);
  const s0 = run(hold(3, () => at(0.8)));
  const s = run(hold(4, () => at(1.08)), {}, last(s0));
  assert.ok(s.every((k) => k.why === 'hold-edge'), `人还在边外却：${[...new Set(s.map((k) => k.why))]}`);
  assert.ok(Math.abs(last(s).x.x - last(s0).x.x) < 0.15, `人还在边外，身体挪了 ${(last(s).x.x - last(s0).x.x).toFixed(3)}`);
});

test('躯干坐标在画内、但一个点都不可信（被桌子整个挡住）：当成跟丢 —— 停 1 秒再回中线', () => {
  const hidden = person({ ...WHOLE, cx: 0.3, vis: 0.1 });
  assert.equal(lateralEvidence(hidden)?.side, null);
  const s0 = run(hold(3, () => at(0.3)));
  const s = run(hold(3, () => hidden), {}, last(s0));
  assert.equal(s[10].why, 'hold-lost');
  assert.equal(last(s).why, 'center');
  assert.ok(Math.abs(last(s).x.x) < 0.2, `挡住 3 秒还没回中线：${last(s).x.x}`);
});

test('快速左右晃（2Hz、±0.06 画面宽）：身体不跟着抖，侧边一次都不报', () => {
  const s = run([...hold(1, () => at(0.5)), ...hold(6, (i) => at(0.5 + 0.06 * Math.sin(2 * Math.PI * 2 * i * DT)))]);
  const tail = s.slice(60);
  const worst = Math.max(...tail.map((k) => Math.abs(k.x.x)));
  assert.ok(worst < 0.05, `2Hz 的晃让身体抖了 ±${worst.toFixed(3)} 米`);
  assert.ok(tail.every((k) => k.side === null));
});

test('距离不改响应门槛：坐得很近的中景横移 1% 画面宽，身体仍开始跟', () => {
  const s = run([
    ...hold(1, () => at(0.5, { s: 1.0 })),
    ...hold(3, () => at(0.51, { s: 1.0 })),
  ], { upper: true });
  assert.equal(last(s).why, 'follow');
  assert.ok(last(s).x.x < -0.002,
    `近处横移 1% 被尺度放大后的米制死区吞掉了：${last(s).x.x.toFixed(4)}m`);
});

test('远处同一个人的中心与尺度轻抖：持续跟随、身体摆幅小于 8cm', () => {
  // 中心 ±1% 与尺度 ±20% 反相，是单目远距离检测最坏的一类：直接先除尺度会把两份噪声相乘放大。
  const noisy = run(hold(12, (i) => {
    const q = Math.sin(2 * Math.PI * 0.5 * i * DT);
    return at(0.58 + 0.01 * q, { s: 0.18 * (1 - 0.2 * q) });
  }));
  const tail = noisy.slice(120).map((state) => state.x.x);
  const span = Math.max(...tail) - Math.min(...tail);
  assert.ok(noisy.slice(120).every((state) => state.why === 'follow'), '检测噪声被错判成换人');
  assert.ok(span < 0.08, `远处静止者被检测噪声拉着摆了 ${(span * 100).toFixed(1)}cm`);
});

test('远处尺度在 0.10 / 0.14 间轻跳时，单人持续走动仍跟得上', () => {
  const trueX = (i: number): number => 0.5 + 0.08 * Math.min(1, i / 89);
  const clean = run(hold(4, (i) => atTorsoScale(trueX(i), 0.12)));
  const noisy = run(hold(4, (i) => at(
    trueX(i) + (i % 2 ? 0.004 : -0.004), { s: (i % 2 ? 0.14 : 0.10) / FIXTURE_SCALE },
  )));
  assert.ok(Math.abs(clean[59].x.x) > 0.2, `无噪声参照没有形成有效移动：${clean[59].x.x.toFixed(3)}m`);
  assert.ok(Math.abs(noisy[59].x.x) >= Math.abs(clean[59].x.x) * 0.7,
    `小绝对尺度噪声把持续移动拦成换人：有噪 ${noisy[59].x.x.toFixed(3)}m · 参照 ${clean[59].x.x.toFixed(3)}m`);
  assert.ok(noisy.filter((state) => state.why === 'hold-jump').length < noisy.length * 0.05,
    '远处同一个人有一半帧被错判成换人');
});

test('尺度身份门是对称关系：门限外的 0.30 / 0.45 交替不能共同攒成稳定身份', () => {
  const s0 = run(hold(3, () => atTorsoScale(0.5, 0.2)));
  const x0 = last(s0).x.x;
  const alternating = run(hold(6, (i) => atTorsoScale(0.45, i % 2 ? 0.45 : 0.30)), {}, last(s0));
  assert.ok(alternating.every((state) => state.why === 'hold-jump'),
    `非对称门把交替身份接成了 follow：${alternating.filter((state) => state.why === 'follow').length} 帧`);
  assert.ok(alternating.every((state) => Math.abs(state.x.x - x0) < 1e-9),
    `交替身份把身体从 ${x0.toFixed(3)}m 拉到 ${last(alternating).x.x.toFixed(3)}m`);
});

test('新身份确认后的第一帧重启中心与尺度滤波，不继承上一人的速度', () => {
  const oldPerson = last(run(hold(3, () => atTorsoScale(0.5, 0.2))));
  const nextPose = atTorsoScale(0.75, 0.45);
  const nextEvidence = lateralEvidence(nextPose)!;
  const handoff = run(hold(0.8, () => nextPose), {}, oldPerson);
  const accepted = handoff.find((state) => state.why === 'follow');
  assert.ok(accepted?.centerFilter && accepted.scaleFilter, '新身份站稳后没有恢复 follow');
  assert.ok(Math.abs(accepted.centerFilter.x - nextEvidence.x) < 1e-12);
  assert.ok(Math.abs(accepted.scaleFilter.x - nextEvidence.scale) < 1e-12);
  assert.equal(accepted.centerFilter.dx, 0);
  assert.equal(accepted.scaleFilter.dx, 0);
});

test('远处持续横移：稳住尺度噪声之后没有把真实走动滤没', () => {
  const walking = run(hold(8, (i) => at(0.5 + 0.12 * Math.min(1, i / 180), { s: 0.18 })));
  assert.ok(last(walking).x.x < -0.75,
    `稳住远处噪声之后也把真实走动滤没了：${last(walking).x.x.toFixed(3)}m`);
});

test('同一舞台横向位置缓慢靠近：尺度变化不制造虚假横移', () => {
  const fixedStageRatio = (scale: number): RawPose => at(0.5 + 0.5 * scale, { s: scale });
  const frames = [
    ...hold(4, () => fixedStageRatio(0.1)),
    ...hold(6, (i) => fixedStageRatio(0.1 + 0.1 * (i / 179))),
    ...hold(4, () => fixedStageRatio(0.2)),
  ];
  const s = run(frames);
  const baseline = s[119].x.x;
  const depthChange = s.slice(120).map((state) => state.x.x);
  const drift = Math.max(...depthChange.map((x) => Math.abs(x - baseline)));
  assert.ok(drift < 0.08, `只靠近镜头却横向漂了 ${(drift * 100).toFixed(1)}cm`);
});

test('近处与远处的镜像、侧边和冻结语义一致', () => {
  for (const scale of [1, 0.18]) {
    assert.ok(imageToStageX(0.51, scale) < 0, `s=${scale}: 画面右移没有镜像到负 x`);
    assert.ok(imageToStageX(0.49, scale) > 0, `s=${scale}: 画面左移没有镜像到正 x`);
    assert.equal(lateralEvidence(at(1.03, { s: scale }))?.side, 'left', `s=${scale}: 右边越界方向错`);
    assert.equal(lateralEvidence(at(-0.03, { s: scale }))?.side, 'right', `s=${scale}: 左边越界方向错`);
    const before = run(hold(3, () => at(0.3, { s: scale })));
    const edge = run(hold(2, () => at(1.03, { s: scale })), {}, last(before));
    assert.ok(edge.every((state) => state.why === 'hold-edge'), `s=${scale}: 出画没有冻结`);
    assert.ok(Math.abs(last(edge).x.x - last(before).x.x) < 0.01,
      `s=${scale}: 出画冻结后仍漂了 ${(last(edge).x.x - last(before).x.x).toFixed(3)}m`);
  }
});

test('近处与远处固定目标都收敛到画面死区，不靠撞舞台余量假装稳定', () => {
  for (const specScale of [1, 0.18]) {
    const pose = at(0.55, { s: specScale });
    const ev = lateralEvidence(pose)!;
    const states = run(hold(8, () => pose));
    const end = last(states);
    assert.ok(end.scaleFilter, `s=${specScale}: 尺度滤波器没有建立`);
    const projected = stageToImageX(end.x.x, end.scaleFilter.x);
    const residual = Math.abs(ev.x - projected) * (16 / 9);
    assert.ok(residual <= AUTOFRAME.lateralDeadZoneImage + AUTOFRAME.lateralBandImage,
      `s=${specScale}: 收敛后画面误差 ${residual.toFixed(4)} 仍在死区外`);
    assert.ok(Math.abs(end.x.x) < 1.9, `s=${specScale}: 靠 room=2 饱和制造假稳定`);
  }
});

test('慢慢左右走（0.25Hz、±0.15 画面宽）：身体跟得上', () => {
  const s = run(hold(12, (i) => at(0.5 + 0.15 * Math.sin(2 * Math.PI * 0.25 * i * DT))));
  const peak = Math.max(...s.slice(120).map((k) => Math.abs(k.x.x)));
  assert.ok(peak > 0.3, `慢走的峰值只有 ${peak.toFixed(3)} 米`);
});

test('画里两个人一左一右、MediaPipe 在两人之间来回跳：身体停着，不追另一个人', () => {
  const s0 = run(hold(3, () => at(0.15)));
  const x0 = last(s0).x.x;
  const s = run(hold(6, (i) => at(Math.floor(i / 8) % 2 ? 0.85 : 0.15)), {}, last(s0));
  assert.ok(s.some((k) => k.why === 'hold-jump'));
  assert.ok(s.every((k) => Math.abs(k.x.x - x0) < 0.1), `被另一个人拽走了：${Math.min(...s.map((k) => k.x.x)).toFixed(3)} vs ${x0.toFixed(3)}`);
});

test('身后的人被认成主角（尺度一帧大 60%）：当成换人，停住；他站稳 0.5 秒之后才跟', () => {
  const s0 = run(hold(3, () => at(0.5)));
  const s = run([...hold(0.3, () => at(0.45, { s: 0.8 })), ...hold(2, () => at(0.45, { s: 0.8 }))], {}, last(s0));
  assert.equal(s[3].why, 'hold-jump');
  assert.ok(Math.abs(s[5].x.x - last(s0).x.x) < 1e-6, '换人的那几帧身体动了');
  assert.equal(last(s).why, 'follow', '新的人站稳之后没有跟过去');
});

test('远处检测尺度在两个身份之间来回跳：位置相同也不能攒满换人确认时间', () => {
  const s0 = run(hold(3, () => at(0.5)));
  const x0 = last(s0).x.x;
  // x 故意相同：旧实现的 pending 只记 x，会把两种相差悬殊的尺度误认成
  // “同一个新目标稳定了 0.5 秒”，随后在两个深度之间反复交接。
  const s = run(hold(6, (i) => at(0.45, { s: i % 2 ? 0.3 : 0.8 })), {}, last(s0));
  assert.ok(s.every((k) => k.why === 'hold-jump'),
    `尺度仍在交替却发生了交接：${[...new Set(s.map((k) => k.why))]}`);
  assert.ok(s.every((k) => Math.abs(k.x.x - x0) < 1e-6),
    `尺度交替把身体从 ${x0.toFixed(3)} 拉到 ${Math.min(...s.map((k) => k.x.x)).toFixed(3)}`);
});

test('换人待确认期间一度出画或掉到低质量：回来后重新计满连续 0.5 秒', () => {
  const s0 = run(hold(3, () => at(0.5)));
  const candidate = () => at(0.45, { s: 0.8 });
  const s = run([
    ...hold(0.3, candidate),
    ...hold(0.2, () => at(0.45, { s: 0.8, score: 0.58 })),
    ...hold(0.3, candidate),
  ], {}, last(s0));
  assert.equal(last(s).why, 'hold-jump', '两段不足 0.5 秒的证据不该隔着坏帧相加');
  const settled = run(hold(0.6, candidate), {}, last(s));
  assert.equal(last(settled).why, 'follow', '回来后连续站稳 0.5 秒仍该正常交接');
});

test('跟丢：停 1 秒，然后回中线；人从另一边回来，全程每 16ms 的变化不超过上限', () => {
  const s = run([
    ...hold(2, () => at(0.3)),
    ...hold(3, () => null),
    ...hold(3, () => at(0.7)),
  ]);
  const x2 = s[59].x.x;
  assert.ok(x2 > 0.4, `前两秒没跟到：${x2}`);
  assert.ok(Math.abs(s[59 + 27].x.x - x2) < 0.05, '丢了 0.9 秒就开始回中线了');
  assert.ok(Math.abs(s[59 + 90].x.x) < 0.15, `丢了 3 秒还没回中线：${s[59 + 90].x.x}`);
  assert.ok(last(s).x.x < -0.4, `从另一边回来没跟过去：${last(s).x.x}`);
  assert.ok(maxPer16(s.map((k) => k.x.x)) <= AUTOFRAME.maxStep.lateral + 1e-9);
});

test('回放录制（没有 screen）：没有横向证据，偏移恒 0、不报侧边、不抛', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const clip = JSON.parse(readFileSync(`${here}../../../assets/demo/pose-walkturn.json`, 'utf8')) as { frames: RawPose[] };
  const s = run(clip.frames);
  assert.ok(s.every((k) => k.x.x === 0 && k.side === null));
});

test('上半身中景 + 左右晃：余量在推近的那一秒里连续收窄，偏移被限速收回来，最后不出余量', () => {
  const s = run(hold(6, () => at(0.2)), { room: (i) => (i < 90 ? 1.2 : Math.max(0.35, 1.2 - ((i - 90) / 30) * 0.85)) });
  assert.ok(s[89].x.x > 0.8, `前三秒没跟到：${s[89].x.x}`);
  assert.ok(last(s).x.x <= 0.35 + 1e-9 && last(s).x.x >= 0.345, `推近之后没有收回余量边缘：${last(s).x.x}`);
  assert.ok(maxPer16(s.map((k) => k.x.x)) <= AUTOFRAME.maxStep.lateral + 1e-9, '收窄那一秒里跳了');
});

test('中景（upper）：死区更小、弹簧更快——同一小步位移，中景比全景更快、更远地跟', () => {
  // 响应门槛已经改为与距离无关的画面空间门槛；1% 位移两档都该响应，
  // 中景仍因更小死区与更快弹簧而明显领先。
  const full = run(hold(1, () => at(0.51)), { upper: false });
  const upper = run(hold(1, () => at(0.51)), { upper: true });
  assert.ok(Math.abs(last(full).x.x) > 0.002, `全景也该对持续 1% 位移开始响应：${last(full).x.x}`);
  assert.ok(Math.abs(last(upper).x.x) > Math.abs(last(full).x.x), `中景该比全景更跟这一步：中景 ${last(upper).x.x.toFixed(4)} · 全景 ${last(full).x.x.toFixed(4)}`);
  // 更大的一步：两档最终都跟到同一个目标，但中景更快到（角频率更高）
  const bigFull = run(hold(2, () => at(0.7)), { upper: false });
  const bigUpper = run(hold(2, () => at(0.7)), { upper: true });
  assert.ok(Math.abs(bigUpper[14].x.x) > Math.abs(bigFull[14].x.x), `半秒时中景该比全景更接近目标：中景 ${bigUpper[14].x.x.toFixed(3)} · 全景 ${bigFull[14].x.x.toFixed(3)}`);
  assert.ok(maxPer16(upper.map((k) => k.x.x)) <= AUTOFRAME.maxStep.lateral + 1e-9, '中景死区/弹簧改快之后跳过守卫上限');
});

test('光线塌了（score 掉到质量线以下）：冻结，不往坏光下的坐标漂', () => {
  const s0 = run(hold(3, () => at(0.4)));
  const s = run(hold(2, () => at(0.6, { score: 0.58 })), {}, last(s0));
  assert.ok(s.every((k) => k.why === 'hold-light'));
  assert.ok(Math.abs(last(s).x.x - last(s0).x.x) < 0.02, `坏光下漂了 ${(last(s).x.x - last(s0).x.x).toFixed(3)}`);
});

test('光线塌了 + 摄像头确认在自己取景：判别条件命中，回中线而不是冻在原地（作品负责人 2026-09-15 追加要求）', () => {
  const s0 = run(hold(3, () => at(0.4)));
  const s = run(hold(2, () => at(0.6, { score: 0.58 })), { cameraFraming: true }, last(s0));
  assert.ok(s.every((k) => k.why === 'center'), `该一路是 center，实际 ${[...new Set(s.map((k) => k.why))]}`);
  assert.ok(Math.abs(last(s).x.x) < 0.05, `该回到中线附近，实际 ${last(s).x.x.toFixed(3)}`);
  // 出画那一侧不受这个字段影响：那是不同的判别条件（见 LateralInput.cameraFraming 的注释）
  const edge = run(hold(2, () => at(1.05)), { cameraFraming: true });
  assert.equal(last(edge).why, 'hold-edge', 'cameraFraming 不该改变出画那一支的行为');
});

test('回中线与让位会清空画面滤波器；短暂冻结保留它', () => {
  const following = last(run(hold(3, () => at(0.4))));
  assert.ok(following.centerFilter && following.scaleFilter, '跟随时没有建立滤波状态');

  const held = last(run(hold(0.2, () => at(0.4, { score: 0.58 })), {}, following));
  assert.ok(held.centerFilter && held.scaleFilter, '短暂坏光冻结不该丢掉同一个人的滤波历史');

  const yielded = last(run([at(0.4)], { enabled: () => false }, following));
  assert.equal(yielded.centerFilter, undefined);
  assert.equal(yielded.scaleFilter, undefined);

  const lost = last(run(hold(1.1, () => null), {}, following));
  assert.equal(lost.why, 'center');
  assert.equal(lost.centerFilter, undefined);
  assert.equal(lost.scaleFilter, undefined);

  const fallback = last(run([at(0.4, { score: 0.58 })], { cameraFraming: true }, following));
  assert.equal(fallback.why, 'center');
  assert.equal(fallback.centerFilter, undefined);
  assert.equal(fallback.scaleFilter, undefined);
});

test('多人：台上有伴随身体时让位（站位归 lineup），连续地弹回 0', () => {
  const s = run(hold(6, () => at(0.3)), { enabled: (i) => i < 90 });
  assert.ok(s[89].x.x > 0.4);
  assert.equal(last(s).why, 'yield');
  assert.ok(Math.abs(last(s).x.x) < 0.02);
  assert.ok(maxPer16(s.map((k) => k.x.x)) <= AUTOFRAME.maxStep.lateral + 1e-9);
});
