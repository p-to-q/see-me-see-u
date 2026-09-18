/**
 * 横向与连续性在 app 这一侧的消费者（docs/49 §6.3）：
 *
 *  1. 引导：从左右走出去的人听到**那一侧**的话，排在「往后退一点」前面；贴边但整个人在画里的人不被说。
 *  2. 读数：WRN12 同一把尺子。
 *  3. 镜像：侧边按观众自己的左右说，小屏上那条边画在显示的对应一侧。
 *  4. 小屏裁切开不开：减少动态、多人时不开。
 *  5. 舞台相机（`shotCamera`）：任意景别序列下视角与双轴移轴每 16ms 的变化有上限；横向余量随景别连续收窄。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cropActive, createSeeWatch, displaySide, seeState } from '../src/ui/preview-state.ts';
import { assess } from '../src/ui/readout-state.ts';
import { COPY } from '../src/ui/i18n.ts';
import { DEFAULT_BOUNDS, fitFrame, lateralRoom, shotCamera } from '../src/stage/framing.ts';
import { formatFramingRows } from '../src/shell/hud.ts';
import { createPoseClock } from '../src/capture/pose-clock.ts';
import {
  createFramingClassifier, decide, lateralEvidence, resetLateralIdentity, resetShotIdentity, smoothstep, stepLateral, stepShot, verticalEvidence,
  LATERAL_REST, SHOT_REST, type LateralState, type ShotState, type VerticalMeasurement,
} from '../../core/src/autoframe.ts';
import { mulberry32 } from '../../core/src/rng.ts';
import { AUTOFRAME, PEOPLE, STAGE } from '../../core/src/tuning.ts';
import { person, SEATED, WHOLE } from '../../core/test/framing-people.ts';
import { createSim, maxJumps } from '../dev/framing-sim.ts';

const at = (cx: number) => person({ ...WHOLE, cx });
const verticalOf = (pose: ReturnType<typeof person>, worldY = 0): VerticalMeasurement => {
  const evidence = verticalEvidence(pose);
  assert.ok(evidence);
  return { ...evidence, worldY, accepted: true, cameraFraming: false };
};

const MAIN = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');

test('引导：从观众自己的左 / 右边走出去 → 那一侧的话；排在「往后退一点」前面', () => {
  assert.deepEqual(seeState({ camera: true, pose: at(1.03) }), { state: 'partial', reason: 'side', side: 'left' });
  assert.deepEqual(seeState({ camera: true, pose: at(-0.03) }), { state: 'partial', reason: 'side', side: 'right' });
  // 画外点可见度给高（MediaPipe 有时就这么自信）：可信点数也够「往后退一点」了，仍然说那一侧
  assert.equal(seeState({ camera: true, pose: person({ ...WHOLE, cx: -0.03, visOut: 0.9 }) }).reason, 'side');
  // 整个人都走出去了、检测还在（躯干点一个都不可信）：照样说那一侧 —— 第一版这里闭嘴，人被晾在边外
  assert.deepEqual(seeState({ camera: true, pose: at(1.08) }), { state: 'partial', reason: 'side', side: 'left' });
  // 回来那一侧的话：往左出去 → 往右回来
  assert.ok(COPY.preview.outLeft && COPY.preview.outRight && COPY.preview.outLeft !== COPY.preview.outRight);
});

test('引导：贴着边、但整个人都在画里 —— 不说话；太近两边都出 —— 是「往后退一点」，不是侧边', () => {
  assert.deepEqual(seeState({ camera: true, pose: at(0.08) }), { state: 'ok', reason: 'ok' });
  assert.deepEqual(seeState({ camera: true, pose: at(0.92) }), { state: 'ok', reason: 'ok' });
  const huge = person({ ...WHOLE, s: 2.2, hy: 0.6, visOut: 0.9 });
  assert.equal(seeState({ camera: true, pose: huge }).reason, 'bounds');
});

test('引导：快速左右晃在画内，话一次都不出；真的走出去再走回来，话出现一次、收回一次，不闪', () => {
  const watch = createSeeWatch();
  const dt = 1 / 30;
  let changes = 0, prev = 'ok|';
  const feed = (pose: ReturnType<typeof at>) => {
    const r = watch.update({ camera: true, pose }, dt);
    const key = `${r.reason}|${r.side ?? ''}`;
    if (key !== prev) { changes++; prev = key; }
  };
  for (let i = 0; i < 60; i++) feed(at(0.5));
  changes = 0;
  for (let i = 0; i < 180; i++) feed(at(0.5 + 0.3 * Math.sin(2 * Math.PI * 2 * i * dt)));
  assert.equal(changes, 0, '画内晃让小屏开口了');
  for (let i = 0; i < 60; i++) feed(at(1.03));
  for (let i = 0; i < 90; i++) feed(at(0.5));
  assert.equal(changes, 2, `走出去再回来，话变了 ${changes} 次`);
});

test('读数：从左右走出去照报 WRN12（按躯干坐标，不靠数画外可信点）；画内贴边不报；一大半关节都丢了时 ALM01 照旧更重', () => {
  const live = { features: null, inferenceHz: 30 };
  // 胯中点正好压在左边上：33 个点里 16 个在画外（可见度 0.2，不可信 → `outOfFrame` 数出 0 个），躯干 31% 越界
  assert.equal(assess({ ...live, pose: at(0.0) }).code, 'WRN12');
  assert.equal(assess({ ...live, pose: at(0.08) }).code, null);
  // 再往外走：一大半关节看不见了。「关节丢失」比「部分出画」重（ALARM_ORDER），这一条不因为横向而改
  assert.equal(assess({ ...live, pose: at(-0.03) }).code, 'ALM01');
});

test('镜像：侧边按观众自己的左右；镜像显示时细边画在同一侧，?mirror=0 时画在另一侧', () => {
  assert.equal(displaySide('left', true), 'left');
  assert.equal(displaySide('right', true), 'right');
  assert.equal(displaySide('left', false), 'right');
});

test('小屏裁切：上半身取景才开；减少动态、画里有别的有身体的人时不开', () => {
  assert.equal(cropActive({ upperIsIntended: true, reduced: false, othersBodied: false }), true);
  assert.equal(cropActive({ upperIsIntended: true, reduced: true, othersBodied: false }), false);
  assert.equal(cropActive({ upperIsIntended: true, reduced: false, othersBodied: true }), false);
  assert.equal(cropActive({ upperIsIntended: false, reduced: false, othersBodied: false }), false);
});

test('舞台相机：t = 0 时视角和等身全景逐字相同；余量在中景里窄得多', () => {
  const b = DEFAULT_BOUNDS;
  const full = shotCamera(b, 1.71, SHOT_REST, 16 / 9);
  const f = fitFrame(b);
  const dist = Math.max(0.8, STAGE.viewDistance - Math.min(1.0, b.depth / 2));
  assert.equal(full.fov, (2 * Math.atan((Math.max(f.frameHeight, f.frameWidth / (16 / 9)) / 2) / dist) * 180) / Math.PI);
  const upper = shotCamera(b, 1.71, { ...SHOT_REST, progress: 1 }, 16 / 9);
  assert.ok(upper.room < full.room * 0.6, `中景余量 ${upper.room.toFixed(2)} vs 全景 ${full.room.toFixed(2)}`);
  assert.ok(full.room > 0.8, `全景余量只有 ${full.room.toFixed(2)}m`);
  assert.equal(lateralRoom(1, 9 / 16, 1.0), 0, '竖屏里没有横向余量时不许是负的');
});

test('舞台纵向：world 骨架不变、只改 screen.y，进入中景后仍产生有限且连续的竖直移轴', () => {
  const basePose = person(SEATED);
  const movedPose = person({ ...SEATED, hy: (SEATED.hy ?? 0) + 0.04 });
  const xyz = (pose: typeof basePose) => pose.world?.map(({ x, y, z }) => [x, y, z]);
  assert.deepEqual(xyz(basePose), xyz(movedPose), '测试前提：world 几何必须逐字相同');
  let s: ShotState = SHOT_REST;
  for (let i = 0; i < 60; i++) {
    s = stepShot(s, {
      shot: 'upper', offset: { x: 0, y: 0 }, vertical: verticalOf(basePose), reduced: false, hold: false,
    }, 1 / 60);
  }
  const before = shotCamera(DEFAULT_BOUNDS, 1.71, s, 16 / 9);
  let worst = 0;
  for (let i = 0; i < 120; i++) {
    const prev = shotCamera(DEFAULT_BOUNDS, 1.71, s, 16 / 9);
    s = stepShot(s, {
      shot: 'upper', offset: { x: 0, y: 0 }, vertical: verticalOf(movedPose), reduced: false, hold: false,
    }, 1 / 60);
    const next = shotCamera(DEFAULT_BOUNDS, 1.71, s, 16 / 9);
    worst = Math.max(worst, Math.abs(next.panY - prev.panY) * 0.96);
  }
  const after = shotCamera(DEFAULT_BOUNDS, 1.71, s, 16 / 9);
  assert.ok(after.panY > before.panY + 0.01, `screen.y 下移没有进入舞台：${before.panY} → ${after.panY}`);
  assert.ok(after.panY <= AUTOFRAME.followRangeY + 1e-12);
  assert.ok(worst <= AUTOFRAME.maxStep.pan + 1e-9, `纵向移轴一帧挪了 ${worst}m/16ms`);
});

test('换主身份：镜头与身体留在当前像素，旧人的纵横滤波、速度与锚点全部清掉', () => {
  let shot: ShotState = SHOT_REST;
  for (let i = 0; i < 90; i++) {
    shot = stepShot(shot, {
      shot: 'upper', offset: { x: 0.24, y: 0 }, vertical: verticalOf(person(SEATED)), reduced: false, hold: false,
    }, 1 / 60);
  }
  assert.ok(shot.vertical && Math.abs(shot.fx.x) > 0, '前提：旧人的跟随状态已经建立');
  const cameraBefore = shotCamera(DEFAULT_BOUNDS, 1.71, shot, 16 / 9);
  const cleanShot = resetShotIdentity(shot);
  const cameraAfter = shotCamera(DEFAULT_BOUNDS, 1.71, cleanShot, 16 / 9);
  assert.deepEqual(cameraAfter, cameraBefore, '清身份记忆的当帧不该切镜头');
  assert.equal(cleanShot.fx.v, 0);
  assert.equal(cleanShot.fy.v, 0);
  assert.equal(cleanShot.vertical, undefined);
  assert.equal(cleanShot.fx.f, undefined);

  const lateral = stepLateral(LATERAL_REST, {
    evidence: lateralEvidence(at(0.82)), room: 1, enabled: true,
  }, 1);
  const cleanLateral = resetLateralIdentity(lateral);
  assert.equal(cleanLateral.x.x, lateral.x.x, '交接帧身体不能瞬移回中线');
  assert.equal(cleanLateral.x.v, 0);
  assert.ok(Number.isNaN(cleanLateral.accepted));
  assert.ok(Number.isNaN(cleanLateral.scale));
  assert.equal(cleanLateral.centerFilter, undefined);
  assert.equal(cleanLateral.pendingFor, 0);
});

test('连续性：任意景别 / hold 序列下，舞台相机的视角、移轴与横向余量每 16ms 的变化不超过上限', () => {
  const rng = mulberry32(11);
  let s: ShotState = SHOT_REST;
  let prev = shotCamera(DEFAULT_BOUNDS, 1.71, s, 16 / 9);
  let t = 0, next = 0;
  let shot: 'full' | 'upper' = 'full', hold = false, ox = 0;
  let wf = 0, wp = 0;
  while (t < 60) {
    if (t >= next) { shot = rng.next() < 0.5 ? 'upper' : 'full'; hold = rng.next() < 0.3; ox = (rng.next() - 0.5) * 0.5; next = t + 0.1 + rng.next() * 1.4; }
    const dt = 0.004 + rng.next() * 0.062;
    t += dt;
    s = stepShot(s, { shot, offset: { x: ox, y: 0 }, reduced: false, hold }, dt);
    const cam = shotCamera(DEFAULT_BOUNDS, 1.71, s, 16 / 9);
    wf = Math.max(wf, Math.abs(cam.fov - prev.fov) * (0.016 / dt));
    wp = Math.max(wp, Math.abs(cam.panX - prev.panX) * (0.016 / dt));
    prev = cam;
  }
  assert.ok(wf <= AUTOFRAME.maxStep.fovDeg + 1e-9, `视角一帧变了 ${wf.toFixed(3)}°/16ms（上限 ${AUTOFRAME.maxStep.fovDeg}）`);
  assert.ok(wp <= AUTOFRAME.maxStep.pan + 1e-9, `移轴一帧挪了 ${wp.toFixed(4)}m/16ms（上限 ${AUTOFRAME.maxStep.pan}）`);
  assert.ok(smoothstep(1) === 1);
});

test('工作台：逐帧暴露景别速度，并把速度变化纳入同一份连续性读数', () => {
  const sim = createSim();
  const velocities: number[] = [];
  for (let i = 0; i < 15; i++) velocities.push(sim.step({ pose: person(SEATED), dt: 1 / 30, policy: 'upper' }).velocity);
  for (let i = 0; i < 30; i++) velocities.push(sim.step({ pose: person(SEATED), dt: 1 / 30, policy: 'full' }).velocity);
  assert.ok(velocities.some((v) => v > 0) && velocities.some((v) => v < 0), '工作台没有看见先推近、再拉远的速度');
  const jumps = maxJumps(sim.trace);
  assert.ok(Number.isFinite(jumps.progressVelocity.value));
  assert.ok(jumps.progressVelocity.value <= AUTOFRAME.maxStep.progressVelocity + 1e-9,
    `工作台量到景别速度跳变 ${jumps.progressVelocity.value}`);
});

test('工作台 parity：画幅、上半身快档与系统取景兜底逐字段等于生产控制器', () => {
  const aspect = 9 / 16;
  const pose = person({ ...SEATED, aspect, cx: 0.58 });
  const dt = 1 / 30;
  const sim = createSim();
  const actual = sim.step({ pose, dt, policy: 'upper', cameraFraming: true, aspect });

  const classifier = createFramingClassifier();
  const reading = classifier.update(pose, dt, { cameraFraming: true, aspect });
  const decision = decide('upper', reading, { cameraFraming: true });
  const before = shotCamera(DEFAULT_BOUNDS, 1.71, SHOT_REST, aspect);
  const expected = stepLateral(LATERAL_REST, {
    evidence: lateralEvidence(pose, aspect), room: before.room, enabled: true, aspect,
    upper: decision.shot === 'upper', cameraFraming: true,
  }, dt);

  assert.deepEqual(actual.reading, reading, '工作台分类器没有吃生产链同一份 aspect / cameraFraming');
  assert.deepEqual(actual.decision, decision, '工作台自己重写了策略结论');
  assert.deepEqual(actual.lateral, {
    x: expected.x.x, target: expected.target, deadZone: expected.deadZone,
    why: expected.why, side: expected.side,
  }, '工作台横向没有吃生产链同一份 upper / cameraFraming');

  const dim = person({ ...WHOLE, aspect, vis: 0.55, score: 0.55 });
  const dimEvidence = lateralEvidence(dim, aspect);
  assert.ok(dimEvidence?.trusted && !dimEvidence.quality, '测试前提：应是位置存在但低质量');
  const dimFrame = createSim().step({ pose: dim, dt, policy: 'upper', cameraFraming: true, aspect });
  assert.equal(dimFrame.lateral.why, 'center', '系统确认正在取景时，工作台仍冻结在低质量坐标');
});

test('工作台 parity：screen 与同名 world 关节同步移动时抵消，不把一个动作跟两遍', () => {
  const aspect = 16 / 9;
  const base = person(SEATED);
  const moved = person({ ...SEATED, hy: (SEATED.hy ?? 0) + 0.04 });
  const evidence = verticalEvidence(base, aspect);
  assert.ok(evidence && evidence.anchor === 'pelvis', '测试前提：应使用 pelvis 纵向锚点');
  const worldDelta = -0.04 * (PEOPLE.torsoMeters / evidence.scale);
  const input = (pose: typeof base, worldY: number) => ({
    pose, dt: 1 / 60, policy: 'upper' as const, aspect,
    worldY: { pelvis: worldY },
  });

  const synced = createSim();
  let frame = synced.step(input(base, 1));
  for (let i = 1; i < 90; i++) frame = synced.step(input(base, 1));
  const before = frame.panY;
  for (let i = 0; i < 120; i++) frame = synced.step(input(moved, 1 + worldDelta));
  assert.ok(Math.abs(frame.panY - before) < 0.003,
    `screen + world 同步移动仍让工作台追了 ${(frame.panY - before).toFixed(4)}m`);

  const screenOnly = createSim();
  let control = screenOnly.step(input(base, 1));
  for (let i = 1; i < 90; i++) control = screenOnly.step(input(base, 1));
  const controlBefore = control.panY;
  for (let i = 0; i < 120; i++) control = screenOnly.step(input(moved, 1));
  assert.ok(control.panY > controlBefore + 0.01,
    '对照组没有追 screen 位移，抵消测试等于没有执行');
});

test('工作台 parity：坏 dt / 画幅和残缺 landmark 只走有限 fallback，不抛进动画帧', () => {
  const broken = person(SEATED);
  broken.screen = [{ x: Number.NaN, y: Infinity, z: 0 }];
  broken.world = [];
  broken.score = Number.NaN;
  const frame = createSim().step({ pose: broken, dt: Number.NaN, aspect: -Infinity });
  for (const value of [
    frame.t, frame.dt, frame.progress, frame.velocity, frame.fov, frame.panX, frame.panY,
    frame.room, frame.legHold, frame.crop.zoom, frame.crop.cx, frame.crop.cy,
    frame.lateral.x, frame.lateral.target, frame.lateral.deadZone,
  ]) assert.ok(Number.isFinite(value), `工作台坏输入产出 ${String(value)}`);
});

test('横向接线：30Hz 推理先过姿态时钟，再喂 120Hz 跟随；分类器与小屏只吃未停滞原话', () => {
  assert.match(MAIN, /const measured = measuredPose\(live, poseClock\.state\)[^]*framer\.update\(measured,[^]*preview\?\.update\(measured, dt, sourceAspect\)/,
    '模式分类 / 小屏不该把插值姿态或停滞缓存说成摄像头原话');
  assert.match(MAIN, /evidence:\s*lateralEvidence\(raw, sourceAspect\)/,
    '横向跟随还在重复吃采集端 30Hz 的同一份结果');
  assert.doesNotMatch(MAIN, /evidence:\s*lateralEvidence\(live\)/);
  assert.match(MAIN, /const verticalRaw = verticalEvidence\(raw, sourceAspect\)/,
    'screen.y 没有从姿态时钟进入纵向证据');
  assert.match(MAIN, /screenVertical =[^]*worldY[^]*accepted:[^]*stage\.setShot\([^]*vertical:\s*screenVertical/,
    'screen.y 没有与同名 world 锚点 / 身份门配对后接进舞台');

  const run = (renderHz: number): number[] => {
    const clock = createPoseClock();
    let lateral: LateralState = LATERAL_REST;
    let nextInfer = 0;
    const sampled: number[] = [];
    const frameMs = 1000 / renderHz;
    for (let now = 0, frame = 0; now < 2500; frame++, now = frame * frameMs) {
      while (nextInfer <= now + 1e-9) {
        const seconds = nextInfer / 1000;
        const p = at(0.35 + 0.12 * Math.min(1, seconds / 1.5));
        p.t = nextInfer;
        clock.observe(p, nextInfer);
        nextInfer += 1000 / 30;
      }
      const raw = clock.sample(now);
      lateral = stepLateral(lateral, {
        evidence: lateralEvidence(raw), room: 1, enabled: true,
      }, 1 / renderHz);
      // 两条渲染频率只在 30Hz 的共同时间点比较。
      if (now >= 500 && Math.abs(now / (1000 / 30) - Math.round(now / (1000 / 30))) < 1e-6) sampled.push(lateral.x.x);
    }
    return sampled;
  };

  const at60 = run(60), at120 = run(120);
  assert.equal(at60.length, at120.length);
  const worst = Math.max(...at60.map((x, i) => Math.abs(x - at120[i])));
  // 连续时间弹簧在不同积分步长下不可能逐位相等；把差异压在 5mm 内，
  // 仍低于 5mm，不会变成可见的模式分歧；横向响应门槛现已改为与距离无关的画面空间死区。
  assert.ok(worst < 0.005, `同一 30Hz 输入在 60/120Hz 上横向轨迹漂了 ${worst.toFixed(5)}m`);
});

test('HUD：横向、纵向诊断和"摄像头在取景"都读得出来', () => {
  const c = createFramingClassifier();
  const r = c.update(person(SEATED), 1 / 30, { cameraFraming: true });
  const [a, b] = formatFramingRows({
    reading: r, decision: decide('auto', r), legHold: 0, shot: 0,
    lateral: { x: -0.42, room: 0.9, why: 'hold-edge', side: 'left' },
    vertical: { y: 0.03, source: 'screen', anchor: 'pelvis', observed: 0.812 },
  });
  assert.match(a, /侧 -0\.42\/±0\.90m hold-edge ⚠出画\(left\)/);
  assert.match(a, /纵 \+0\.03m screen\/pelvis y0\.812/);
  assert.match(b, /摄像头在取景/);
});
