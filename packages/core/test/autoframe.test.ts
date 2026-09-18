/**
 * 取景模式（`core/src/autoframe.ts`）。钉的是 docs/49 §落地 里写下的每一条场景与边界：
 * 它们各自有一个决定好的行为，这里每一条一个断言。
 *
 * 时间线测试的读法：`timeline()` 以 30Hz 喂一段合成的"画面里的人"（`framing-people.ts`），
 * 返回每一次模式切换发生的时刻与理由。断言的是**切了几次、在什么时候、为什么**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createFramingClassifier, decide, frameEvidence, lateralEvidence, stepCrop, stepFollow, stepShot, verticalEvidence,
  CROP_FULL, SHOT_REST, type ClassifierOptions, type FramingMode, type FramingWhy, type ShotState, type VerticalMeasurement,
} from '../src/autoframe.ts';
import { AUTOFRAME } from '../src/tuning.ts';
import type { RawPose } from '../src/types.ts';
import { between, person, SEATED, STOOD_UP_CLOSE, WHOLE, type PersonSpec } from './framing-people.ts';

const HZ = 30;
const DT = 1 / HZ;

const verticalOf = (
  pose: RawPose,
  worldY = 0,
  accepted = true,
  cameraFraming = false,
): VerticalMeasurement => {
  const evidence = verticalEvidence(pose);
  assert.ok(evidence, '测试姿态应有纵向 screen 证据');
  return { ...evidence, worldY, accepted, cameraFraming };
};

type Seg = { seconds: number; pose: (u: number, frame: number) => RawPose | null };
type Switch = { t: number; mode: FramingMode; why: FramingWhy };

function timeline(segs: Seg[], opts: ClassifierOptions = {}): { switches: Switch[]; final: FramingMode; summary: string } {
  const c = createFramingClassifier(opts);
  const switches: Switch[] = [];
  let t = 0;
  let mode: FramingMode = c.current.mode;
  let frame = 0;
  for (const seg of segs) {
    const n = Math.round(seg.seconds * HZ);
    for (let i = 0; i < n; i++, frame++) {
      const r = c.update(seg.pose(i / n, frame), DT);
      t += DT;
      if (r.mode !== mode) { switches.push({ t: +t.toFixed(3), mode: r.mode, why: r.why }); mode = r.mode; }
    }
  }
  return { switches, final: mode, summary: switches.map((s) => `${s.t}s ${s.mode}(${s.why})`).join(' → ') || '（没切过）' };
}
const hold = (spec: PersonSpec, seconds: number): Seg => ({ seconds, pose: () => person(spec) });
const move = (a: PersonSpec, b: PersonSpec, seconds: number): Seg => ({ seconds, pose: (u) => person(between(a, b, u)) });
const custom = (seconds: number, pose: Seg['pose']): Seg => ({ seconds, pose });

// ── 证据 ────────────────────────────────────────────────────────────────────

test('证据：坐在笔记本前 = 头肩在、腿不在；全身 = 四个膝踝都在；站起来出了上边 = 头肩不算在', () => {
  const seated = frameEvidence(person(SEATED))!;
  assert.equal(seated.legs, 0);
  assert.equal(seated.upper, true);
  const whole = frameEvidence(person(WHOLE))!;
  assert.equal(whole.legs, 4);
  assert.equal(whole.upper, true);
  // 出了上边的头可见度只有 0.2（MediaPipe 的习惯）：它们不是"画外的可信点"，
  // 光数画外点会把一个没有头的人判成上半身在画里
  const cut = frameEvidence(person(STOOD_UP_CLOSE))!;
  assert.equal(cut.upper, false, `头被切了却判成上半身在画里（画外头肩点 ${cut.upperOut}）`);
  assert.equal(frameEvidence(null), null);
  assert.equal(frameEvidence(person({ ...WHOLE, score: 0.3, vis: 0.3 })), null, '整身与躯干证据都不可信才是没有人');
});

test('纵向证据：同一副 world 骨架只在画面里整体下移，肩线读数跟着变；旧回放明确返回 undefined', () => {
  const a = person(SEATED);
  const b = person({ ...SEATED, hy: (SEATED.hy ?? 0) + 0.03 });
  assert.deepEqual(a.world, b.world, '测试前提：world 必须逐字相同');
  const ay = verticalEvidence(a)!;
  const by = verticalEvidence(b)!;
  assert.ok(Math.abs((by?.y ?? 0) - (ay?.y ?? 0) - 0.03) < 1e-12);
  assert.equal(ay.anchor, 'pelvis');
  assert.equal(verticalEvidence(person({ ...SEATED, hy: 1.2 }))?.anchor, 'chest', '近处胯裁掉后没有退到肩线');
  assert.ok(verticalEvidence(person({ ...SEATED, cx: 1.1, visOut: 0.95 })), '横向出界不该抹掉仍在画内的纵向证据');
  assert.equal(verticalEvidence({ ...a, screen: undefined }), undefined, '没有 screen 的回放不能编一个纵向位置');
  assert.equal(verticalEvidence(null), null);
});

test('近距离单人：低整身平均不再吞掉可靠头肩，自动进上半身且两轴都能跟', () => {
  const close = person(SEATED);
  const visibility = (i: number) => i <= 12 ? 0.95 : 0.1;
  close.screen = close.screen!.map((l, i) => ({ ...l, visibility: visibility(i) }));
  close.world = close.world.map((l, i) => ({ ...l, visibility: visibility(i) }));
  close.score = (13 * 0.95 + 20 * 0.1) / 33;
  assert.ok(close.score < 0.5, `测试前提：整身平均没有掉到门下 ${close.score}`);

  const frame = frameEvidence(close);
  assert.ok(frame);
  assert.deepEqual({ upper: frame.upper, legs: frame.legs, quality: frame.quality }, { upper: true, legs: 0, quality: true });
  const lateral = lateralEvidence(close);
  assert.ok(lateral?.quality && lateral.trusted, '可靠肩线没有成为可用横向证据');
  const vertical = verticalEvidence(close);
  assert.ok(vertical?.quality);
  assert.equal(vertical?.anchor, 'chest', '低质量胯不该压过可靠肩线');

  const classified = timeline([custom(0.8, () => close)]);
  assert.equal(classified.final, 'upper', classified.summary);
  assert.equal(classified.switches[0]?.why, 'legs-out');
});

// ── 典型场景 ─────────────────────────────────────────────────────────────────

test('时间线：坐近 → 站起来 → 退后 → 再走近。一共切三次，每一次都在一秒左右、理由对', () => {
  const { switches, summary } = timeline([
    hold(SEATED, 3),
    move(SEATED, STOOD_UP_CLOSE, 0.4), hold(STOOD_UP_CLOSE, 1.6),
    move(STOOD_UP_CLOSE, WHOLE, 1.2), hold(WHOLE, 2.8),
    move(WHOLE, SEATED, 1.0), hold(SEATED, 4),
  ]);
  assert.deepEqual(switches.map((s) => `${s.mode}(${s.why})`), ['upper(legs-out)', 'full(abnormal)', 'upper(legs-out)'], summary);
  // 刚出现就是上半身，只要 0.35 秒：笔记本观众不该先看一秒坏腿
  assert.ok(switches[0].t <= AUTOFRAME.enterUpperFirstSeconds + 0.1, summary);
  // 站起来头出了上边 → 全景（诚实），在动作开始后一秒内
  assert.ok(switches[1].t > 3 && switches[1].t < 4, summary);
  // 退后的整段里一直是全景 —— 由"一共三次"钉住。再走近 → 上半身，憋满 1 秒，不是快切
  assert.ok(switches[2].t > 9 + AUTOFRAME.enterUpperSeconds * 0.5 && switches[2].t < 9 + 2.2, summary);
});

test('坐着 → 退后：先判"退后中"，舞台立刻给全景；腿进画后落到全身。不经过冷却', () => {
  const { switches, summary } = timeline([hold(SEATED, 3), move(SEATED, WHOLE, 1.5), hold(WHOLE, 3)]);
  assert.deepEqual(switches.map((s) => s.mode), ['upper', 'stepping-back', 'full'], summary);
  assert.equal(switches[1].why, 'shrinking', `退后要靠尺度在缩先认出来，不能等腿冒出来：${summary}`);
  assert.ok(switches[1].t < 3 + 0.9, `退后到第 ${(switches[1].t - 3).toFixed(2)} 秒才认出来：${summary}`);
  assert.ok(switches[2].t < 3 + 1.5 + 0.7, summary);
  assert.equal(decide('auto', { mode: 'stepping-back' }).shot, 'full', '退后中舞台必须已经是全景');
  assert.equal(decide('auto', { mode: 'stepping-back' }).holdLegs, true, '退后中腿还没进画，先别放开');
});

test('现场全身优先：同一个坐近的人，网页 0.35 秒切，现场要憋满 3 秒', () => {
  const web = timeline([hold(SEATED, 5)]);
  const kiosk = timeline([hold(SEATED, 5)], { kiosk: true });
  assert.ok(web.switches[0].t < 0.5, web.summary);
  assert.ok(kiosk.switches[0].t >= AUTOFRAME.enterUpperSecondsKiosk, kiosk.summary);
});

// ── 边界 ────────────────────────────────────────────────────────────────────

test('边界 · 腿在画面底边上一帧进一帧出：十秒里一次都不切（全身起步、上半身起步各一遍）', () => {
  // 全身：膝踝可见度在门限两边逐帧颤（4 个 ↔ 0 个，最坏的那种）
  const flickFull = timeline([hold(WHOLE, 2), custom(10, (_, f) => person({ ...WHOLE, legVis: f % 2 ? 0.1 : 0.9 }))]);
  assert.equal(flickFull.switches.length, 0, flickFull.summary);
  // 上半身：膝盖在底边上 1 ↔ 2 个颤
  const edge = { ...SEATED, hy: 0.62, s: 0.9 };
  const flickUpper = timeline([hold(SEATED, 2), custom(10, (_, f) => person({ ...edge, legVis: f % 2 ? 0.1 : 0.9 }))]);
  assert.ok(flickUpper.switches.length <= 1, flickUpper.summary);
  assert.equal(flickUpper.final, 'upper', flickUpper.summary);
});

test('边界 · 冷却到期时腿已重新进画，不用过期的 legs-out 桶切到上半身', () => {
  const c = createFramingClassifier();
  let r = c.current;
  for (let i = 0; i < 11; i++) r = c.update(person(SEATED), DT);
  assert.equal(r.mode, 'upper', '测试前提：应先进入上半身');

  // 头肩出画迫使切回全身，并开始 1.2 秒冷却。
  for (let i = 0; i < 30 && r.mode !== 'full'; i++) r = c.update(person(STOOD_UP_CLOSE), DT);
  assert.equal(r.mode, 'full', '测试前提：异常取景应切回全身');
  assert.ok(r.cooldown > 0);

  // 冷却里一直只露上半身，legs-out 桶已越过门限；最后一帧腿回到画里。
  for (let i = 0; i < 60 && c.current.cooldown > DT + 1e-9; i++) {
    r = c.update(person(SEATED), DT);
    assert.equal(r.mode, 'full', '冷却期间不该切换');
  }
  assert.ok(c.current.cooldown <= DT + 1e-9, '测试前提：冷却应已走到最后一帧');
  r = c.update(person(WHOLE), DT);
  assert.equal(r.cooldown, 0, '反证帧应恰好结束冷却');
  assert.equal(r.evidence?.legs, 4, '反证帧的腿已经在画里');
  assert.equal(r.mode, 'full', '当前腿已进画，不许用过期桶值切到上半身');
});

test('边界 · 退后候选在确认帧消失，不用过期的 toStep 桶切到退后中', () => {
  const c = createFramingClassifier();
  let r = c.current;
  for (let i = 0; i < 11; i++) r = c.update(person(SEATED), DT);
  assert.equal(r.mode, 'upper', '测试前提：应先进入上半身');

  // 只把腿点放回画内，头肩与躯干尺度不变：这是 legs-appearing，不是 shrinking。
  const appearing = person(SEATED);
  const appearingScreen = appearing.screen?.map((l, i) => i >= 25 ? { ...l, y: 0.9, visibility: 0.95 } : l);
  const legsAppearing = { ...appearing, screen: appearingScreen };
  for (let i = 0; i < Math.floor(AUTOFRAME.stepBackConfirmSeconds / DT) - 1; i++) {
    r = c.update(legsAppearing, DT);
    assert.equal(r.mode, 'upper', '连续证据没攒满时不该切换');
  }

  r = c.update(person(SEATED), DT);
  assert.equal(r.evidence?.legs, 0, '反证帧已不再是 legs-appearing');
  assert.ok(Math.abs(r.trend - 1) < 1e-12, `反证帧尺度没有缩小：trend=${r.trend}`);
  assert.equal(r.mode, 'upper', '当前没有腿出现或缩小，不许用过期桶值切到退后中');
});

test('边界 · 刚进入上半身就持续退后：只等退后证据，不再被上一次切换的冷却挡住', () => {
  const c = createFramingClassifier();
  let r = c.current;
  for (let i = 0; i < 30 && r.mode !== 'upper'; i++) r = c.update(person(SEATED), DT);
  assert.equal(r.mode, 'upper', '测试前提：应先进入上半身');
  assert.ok(r.cooldown > AUTOFRAME.stepBackConfirmSeconds, '测试前提：全局冷却应仍在');

  // 只把腿点放回画内，头肩与躯干尺度不变：连续的 legs-appearing 是明确的纠错方向。
  const appearing = person(SEATED);
  const screen = appearing.screen?.map((l, i) => i >= 25 ? { ...l, y: 0.9, visibility: 0.95 } : l);
  const legsAppearing = { ...appearing, screen };
  let elapsed = 0;
  while (elapsed <= AUTOFRAME.stepBackConfirmSeconds + DT && r.mode === 'upper') {
    r = c.update(legsAppearing, DT);
    elapsed += DT;
  }
  assert.equal(r.mode, 'stepping-back', `持续退后 ${elapsed.toFixed(3)}s 仍被冷却挡住`);
  assert.ok(elapsed <= AUTOFRAME.stepBackConfirmSeconds + DT + 1e-9, `退后确认花了 ${elapsed.toFixed(3)}s`);
});

test('边界 · 前倾（肩变宽、躯干透视变短）再坐直：不是退后', () => {
  const lean = { ...SEATED, width: 1.2, torso: 0.8 };
  const { switches, summary } = timeline([hold(SEATED, 3), move(SEATED, lean, 0.5), hold(lean, 1), move(lean, SEATED, 0.5), hold(SEATED, 2)]);
  assert.equal(switches.length, 1, summary);
  assert.equal(switches[0].mode, 'upper');
});

test('边界 · 转身（肩宽缩到 0.4）：不是退后', () => {
  const side = { ...SEATED, width: 0.4 };
  const { switches, summary } = timeline([hold(SEATED, 3), move(SEATED, side, 0.6), hold(side, 3)]);
  assert.deepEqual(switches.map((s) => s.mode), ['upper'], summary);
});

test('边界 · 全身站着的人中途坐下、腿被桌子挡住（可见度 0.1）：一秒后到上半身，只切一次', () => {
  const desk = { ...WHOLE, legVis: 0.1 };
  const { switches, summary } = timeline([hold(WHOLE, 4), hold(desk, 4)]);
  assert.deepEqual(switches.map((s) => `${s.mode}(${s.why})`), ['upper(legs-out)'], summary);
  assert.ok(switches[0].t >= 4 + AUTOFRAME.enterUpperSeconds && switches[0].t < 4 + AUTOFRAME.enterUpperSeconds + 0.2, summary);
});

test('边界 · 光线塌了（score 掉到质量线以下、腿的可见度跟着塌）：保持当前模式，不判成坐下', () => {
  const dark = { ...WHOLE, score: 0.58, legVis: 0.1, vis: 0.5 };
  const { switches, summary } = timeline([hold(WHOLE, 3), hold(dark, 6)]);
  assert.equal(switches.length, 0, summary);
});

test('边界 · 两个人（尺度一帧跳 40% 又跳回来）：换人不是退后', () => {
  const other = { ...SEATED, s: 0.6 };
  const { switches, summary } = timeline([hold(SEATED, 3), custom(4, (_, f) => person(Math.floor(f / 10) % 2 ? other : SEATED))]);
  assert.ok(!switches.some((s) => s.why === 'shrinking'), summary);
});

test('边界 · 摄像头自己在裁（Center Stage 放大 25%、腿被裁掉）：放大不是退后；腿没了就是上半身', () => {
  const zoomed = { ...WHOLE, s: 0.625, hy: 0.62 };
  const { switches, summary } = timeline([hold(WHOLE, 3), move(WHOLE, zoomed, 0.5), hold(zoomed, 1), move(zoomed, SEATED, 0.5), hold(SEATED, 3)]);
  assert.ok(!switches.some((s) => s.mode === 'stepping-back'), summary);
  assert.equal(switches.at(-1)?.mode, 'upper', summary);
});

test('边界 · 小孩 / 个子矮（全身在画里、只占画面三成）：全身', () => {
  const { switches, summary } = timeline([hold({ s: 0.3, hy: 0.7 }, 6)]);
  assert.equal(switches.length, 0, summary);
});

test('边界 · 人走了：四秒后回到全身（下一个人从等身开始），走开一两秒不算', () => {
  const brief = timeline([hold(SEATED, 3), custom(2, () => null), hold(SEATED, 2)]);
  assert.deepEqual(brief.switches.map((s) => s.mode), ['upper'], brief.summary);
  const gone = timeline([hold(SEATED, 3), custom(5, () => null)]);
  assert.deepEqual(gone.switches.map((s) => `${s.mode}(${s.why})`), ['upper(legs-out)', 'full(absent)'], gone.summary);
});

test('边界 · 回放录制（没有 screen）：模式来自录制里腿的可见度；真录制全程全身', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const clip = JSON.parse(readFileSync(`${here}../../../assets/demo/pose-walkturn.json`, 'utf8')) as { frames: RawPose[] };
  assert.ok(!clip.frames[0].screen, '这段录制现在有 screen 了 —— 这条测试的前提变了');
  const real = timeline([custom(clip.frames.length / 30, (_, f) => clip.frames[f])]);
  assert.equal(real.switches.length, 0, `真录制 pose-walkturn 里人全身在画，却切了：${real.summary}`);
  // 同一段录制把膝踝可见度压到 0.1：录制里的人只露了上半身
  const upper = (f: RawPose): RawPose => ({ ...f, world: f.world.map((l, i) => (i >= 25 ? { ...l, visibility: 0.1 } : l)) });
  const cut = timeline([custom(clip.frames.length / 30, (_, f) => upper(clip.frames[f]))]);
  assert.deepEqual(cut.switches.map((s) => s.mode), ['upper'], cut.summary);
});

test('策略：full 只管景别（腿照样听分类器）；upper 永远中景、永远站姿；auto 听分类器', () => {
  assert.deepEqual(decide('full', { mode: 'upper' }), { policy: 'full', mode: 'upper', shot: 'full', holdLegs: true, upperIsIntended: false });
  assert.deepEqual(decide('full', { mode: 'full' }).holdLegs, false);
  assert.deepEqual(decide('upper', { mode: 'full' }), { policy: 'upper', mode: 'full', shot: 'upper', holdLegs: true, upperIsIntended: true });
  assert.equal(decide('auto', { mode: 'upper' }).shot, 'upper');
  assert.equal(decide('auto', { mode: 'upper' }).upperIsIntended, true);
  assert.equal(decide('auto', { mode: 'full' }).holdLegs, false);
});

// ── 跟随与景别 ──────────────────────────────────────────────────────────────

const P = { deadZone: 0.04, band: 0.06, omega: 3, range: 0.12 };

test('跟随：死区里一动不动；目标再远也不出范围；帧率无关', () => {
  let s = { x: 0, v: 0 };
  for (let i = 0; i < 300; i++) s = stepFollow(s, 0.039, DT, P);
  assert.equal(s.x, 0, `死区内的晃动让镜头动了 ${s.x}`);
  s = { x: 0, v: 0 };
  let worst = 0;
  for (let i = 0; i < 600; i++) { s = stepFollow(s, i % 60 < 30 ? 10 : -10, DT, P); worst = Math.max(worst, Math.abs(s.x)); }
  assert.ok(worst <= P.range + 1e-12, `跟随出了范围：${worst}`);
  // 帧率无关：同一段 1 秒，60 步和 20 步
  const noDz = { ...P, deadZone: 0, band: 1e-6, range: 1 };
  let a = { x: 0, v: 0 }, b = { x: 0, v: 0 };
  for (let i = 0; i < 60; i++) a = stepFollow(a, 0.5, 1 / 60, noDz);
  for (let i = 0; i < 20; i++) b = stepFollow(b, 0.5, 1 / 20, noDz);
  assert.ok(Math.abs(a.x - b.x) < 1e-6, `60Hz ${a.x} vs 20Hz ${b.x}`);
  let c = { x: 0, v: 0 }, d = { x: 0, v: 0 };
  for (let i = 0; i < 60; i++) c = stepFollow(c, 0.1, 1 / 60, P);
  for (let i = 0; i < 20; i++) d = stepFollow(d, 0.1, 1 / 20, P);
  assert.ok(Math.abs(c.x - d.x) < 0.005, `有死区时 60Hz ${c.x} vs 20Hz ${d.x}`);
  // 临界阻尼：不过冲
  let e = { x: 0, v: 0 }, peak = 0;
  for (let i = 0; i < 300; i++) { e = stepFollow(e, 0.1, DT, { ...P, range: 1 }); peak = Math.max(peak, e.x); }
  assert.ok(peak <= 0.1 + 1e-9, `过冲到 ${peak}`);
});

const run = (s: ShotState, n: number, input: Parameters<typeof stepShot>[1]): ShotState => {
  for (let i = 0; i < n; i++) s = stepShot(s, input, DT);
  return s;
};

test('景别：正常 1 秒走完（0.9 秒时还没到）；减少动态 0.15 秒；治理在砍工作量时景别照常走完、跟随冻结（docs/49 §6.3：不再直接切）', () => {
  const base = { shot: 'upper' as const, offset: { x: 0.3, y: 0 }, reduced: false, hold: false };
  assert.ok(run(SHOT_REST, 27, base).progress < 1, '0.9 秒就走完了 —— 那是一次切，不是一段运镜');
  const done = run(SHOT_REST, 31, base);
  assert.equal(done.progress, 1);
  assert.ok(done.fx.x > 0 && done.fx.x <= AUTOFRAME.followRangeX, `中景没在跟：${done.fx.x}`);
  const reduced = run(SHOT_REST, 5, { ...base, reduced: true });
  assert.equal(reduced.progress, 1);
  assert.equal(reduced.fx.x, 0, '减少动态时中景还在跟随');
  const held = stepShot({ progress: 0, velocity: 0, fx: { x: 0.05, v: 0.4 }, fy: { x: 0, v: 0 } }, { ...base, hold: true }, DT);
  assert.ok(held.progress > 0 && held.progress < 0.1, `降级时景别一帧走了 ${held.progress} —— 要么没走，要么是一次切`);
  assert.deepEqual([held.fx.x, held.fx.v], [0.05, 0], '降级时跟随还在动');
  assert.equal(run({ progress: 0, velocity: 0, fx: { x: 0.05, v: 0 }, fy: { x: 0, v: 0 } }, 31, { ...base, hold: true }).progress, 1, '降级时景别没有走完');
  // 回到全景：偏移收回 0（等身机位是不动的）
  const back = run(done, 120, { ...base, shot: 'full' });
  assert.equal(back.progress, 0);
  assert.ok(Math.abs(back.fx.x) < 0.01);
});

test('景别：推到一半立即回全景，先减速再反向，不在一帧里把速度符号翻过去', () => {
  const upper = { shot: 'upper' as const, offset: null, reduced: false, hold: false };
  const moving = run(SHOT_REST, 15, upper);
  assert.ok(Number.isFinite(moving.velocity) && moving.velocity > 0, `推近没有正速度：${moving.velocity}`);

  const firstBack = stepShot(moving, { ...upper, shot: 'full' }, DT);
  assert.ok(firstBack.velocity >= 0, `反向首帧速度从 ${moving.velocity} 瞬间翻成 ${firstBack.velocity}`);
  assert.ok(firstBack.progress >= moving.progress, '反向首帧应该仍在刹车，不该立即倒走');

  let s = firstBack;
  let reversed = false;
  for (let i = 0; i < 30; i++) {
    const n = stepShot(s, { ...upper, shot: 'full' }, DT);
    if (n.velocity < 0) reversed = true;
    s = n;
  }
  assert.ok(reversed, '有限时间内没有平滑反向');
  assert.ok(s.progress < moving.progress, '反向后没有朝全景收回');
});

test('景别：坏状态、坏 dt 与过大旧速度都被净化，永远留在有限范围内', () => {
  const input = { shot: 'upper' as const, offset: null, reduced: false, hold: false };
  const bad = stepShot({ progress: NaN, velocity: Infinity, fx: { x: 0, v: 0 }, fy: { x: 0, v: 0 } }, input, NaN);
  assert.deepEqual([bad.progress, bad.velocity], [0, 0], '坏 dt 不该推进，坏状态必须退回有限静止值');

  const limited = stepShot({ progress: 0.5, velocity: 1e6, fx: { x: 0, v: 0 }, fy: { x: 0, v: 0 } }, input, DT);
  assert.ok(Number.isFinite(limited.progress) && limited.progress >= 0 && limited.progress <= 1);
  assert.ok(Number.isFinite(limited.velocity) && Math.abs(limited.velocity) <= AUTOFRAME.shotMaxSpeed + 1e-12);
});

test('中景纵向：进入时立零点；近处肩线移动 1.5% 画面高也有连续反馈', () => {
  const basePose = person(SEATED);
  const movedPose = person({ ...SEATED, hy: (SEATED.hy ?? 0) + 0.015 });
  const input = (pose: RawPose) => ({
    shot: 'upper' as const, offset: { x: 0, y: 0 }, vertical: verticalOf(pose), reduced: false, hold: false,
  });
  let s = run(SHOT_REST, 60, input(basePose));
  assert.ok(Math.abs(s.fy.x) < 1e-9, `入场位置被当成动作：${s.fy.x}`);
  const before = s.fy.x;
  s = run(s, 60, input(movedPose));
  assert.ok(s.fy.x > before + 0.001, `肩线下移 1.5% 没有反馈：${s.fy.x}`);
  assert.ok(s.fy.x <= AUTOFRAME.followRangeY + 1e-12);
});

test('中景纵向：同一锚点的 screen 与 world 同步移动时互相抵消，蹲起不被算两次', () => {
  const pose = person(SEATED);
  const evidence = verticalEvidence(pose)!;
  let s = run(SHOT_REST, 60, {
    shot: 'upper', offset: { x: 0, y: 0 }, vertical: { ...evidence, worldY: 1, accepted: true, cameraFraming: false }, reduced: false, hold: false,
  });
  const screenDelta = 0.04;
  const worldDelta = -screenDelta * (0.5 / evidence.scale);
  s = run(s, 90, {
    shot: 'upper', offset: { x: 0, y: worldDelta },
    vertical: { ...evidence, y: evidence.y + screenDelta, worldY: 1 + worldDelta, accepted: true, cameraFraming: false },
    reduced: false, hold: false,
  });
  assert.ok(Math.abs(s.fy.x) < 0.003, `screen + world 同一个蹲起被重复跟了 ${s.fy.x}m`);
});

test('中景纵向：坏光 / 丢失先冻结再归中；大跳当换人重立基线，不追过去', () => {
  const input = (pose: RawPose | null) => ({
    shot: 'upper' as const, offset: { x: 0, y: 0 }, vertical: pose ? verticalOf(pose) : null, reduced: false, hold: false,
  });
  let s = run(SHOT_REST, 45, input(person(SEATED)));
  s = run(s, 60, input(person({ ...SEATED, hy: (SEATED.hy ?? 0) + 0.04 })));
  const shifted = s.fy.x;
  assert.ok(shifted > 0.01, `测试前提：纵向没有移开 ${shifted}`);

  const dim = verticalOf(person({ ...SEATED, hy: (SEATED.hy ?? 0) + 0.04 }));
  let heldInBadLight = s;
  for (let i = 0; i < 90; i++) heldInBadLight = stepShot(heldInBadLight, {
    shot: 'upper', offset: { x: 0, y: 0 }, vertical: { ...dim, quality: false }, reduced: false, hold: false,
  }, DT);
  assert.ok(Math.abs(heldInBadLight.fy.x - shifted) < 0.005, `坏光三秒却漂了：${shifted} → ${heldInBadLight.fy.x}`);
  s = heldInBadLight;

  const oneLost = stepShot(s, input(null), DT);
  assert.ok(Math.abs(oneLost.fy.x - shifted) < 0.005, '短丢失没有冻结在原处');
  const centered = run(oneLost, Math.ceil(AUTOFRAME.verticalHoldSeconds / DT) + 60, input(null));
  assert.ok(Math.abs(centered.fy.x) < Math.abs(shifted) * 0.25, `长丢失没有归中：${centered.fy.x}`);

  let changed = run(SHOT_REST, 45, input(person(SEATED)));
  const jumpedPose = person({ ...SEATED, hy: (SEATED.hy ?? 0) + AUTOFRAME.verticalJump + 0.05 });
  changed = stepShot(changed, input(jumpedPose), DT);
  assert.ok(Math.abs(changed.fy.x) < 0.002, `换人式大跳被镜头追了：${changed.fy.x}`);
  assert.ok(Math.abs((changed.vertical?.screenAnchor ?? 0) - verticalEvidence(jumpedPose)!.y) < 1e-12, '没有在新锚点重立基线');
});

test('中景纵向：旧回放继续吃 world fallback；减少动态明确清空 screen-space 跟随', () => {
  const replay = run(SHOT_REST, 90, {
    shot: 'upper', offset: { x: 0, y: 0.06 }, vertical: undefined, reduced: false, hold: false,
  });
  assert.ok(replay.fy.x > 0.001, '没有 screen 的旧回放丢了既有 world 跟随');
  const reduced = run(SHOT_REST, 30, {
    shot: 'upper', offset: { x: 0, y: 0 }, vertical: verticalOf(person({ ...SEATED, hy: 0.99 })), reduced: true, hold: false,
  });
  assert.equal(reduced.fy.x, 0);
  assert.equal(reduced.vertical, undefined);
});

test('小屏裁切：任何告警 0.2 秒内限速退回整幅（不是当帧）；正常时放大到上限、窗口永远不伸出画面', () => {
  const seated = person(SEATED).screen;
  let c = CROP_FULL;
  for (let i = 0; i < 90; i++) c = stepCrop(c, { active: true, snap: false, screen: seated }, DT);
  assert.ok(c.zoom > 1.2 && c.zoom <= AUTOFRAME.previewZoom + 1e-9, `zoom ${c.zoom}`);
  const first = stepCrop(c, { active: true, snap: true, screen: seated }, DT);
  assert.ok(first.zoom < c.zoom && first.zoom > 1, `告警第一帧 zoom ${c.zoom} → ${first.zoom}：要么没退，要么一帧退完`);
  let snapped = c;
  for (let i = 0; i < Math.ceil(AUTOFRAME.previewSnapSeconds / DT); i++) snapped = stepCrop(snapped, { active: true, snap: true, screen: seated }, DT);
  assert.equal(snapped.zoom, 1, `告警 ${AUTOFRAME.previewSnapSeconds} 秒后还没退回整幅：${snapped.zoom}`);
  assert.equal(snapped.cx.x, 0.5);
  assert.equal(snapped.cy.x, 0.5);
  for (const cx of [0.02, 0.98]) {
    let k = CROP_FULL;
    for (let i = 0; i < 200; i++) {
      k = stepCrop(k, { active: true, snap: false, screen: person({ ...SEATED, cx }).screen }, DT);
      const half = 0.5 / k.zoom;
      assert.ok(k.cx.x - half >= -1e-9 && k.cx.x + half <= 1 + 1e-9, `窗口伸出了画面：cx ${k.cx.x} zoom ${k.zoom}`);
      assert.ok(k.cy.x - half >= -1e-9 && k.cy.x + half <= 1 + 1e-9, `窗口伸出了画面：cy ${k.cy.x} zoom ${k.zoom}`);
    }
  }
  let off = c;
  for (let i = 0; i < 120; i++) off = stepCrop(off, { active: false, snap: false, screen: seated }, DT);
  assert.ok(Math.abs(off.zoom - 1) < 0.01, `离开上半身模式后没有回到整幅：${off.zoom}`);
});
