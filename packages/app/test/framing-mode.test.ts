/**
 * 取景模式在 app 这一侧的四个消费者（docs/49 §落地）：
 *
 *  1. 引导（左上角小屏）：上半身是正当取景时，「往后退一点」不为画面下边的腿说话；头被切照样说。
 *  2. 读数（WRN12）：同一把尺子、同一个开关。
 *  3. 舞台中景（`stage/framing.ts`）：t = 0 时和等身全景逐字相同；中景框得住头和胯。
 *  4. `?framing=` 与控件条：写出去读得回来，认不出来的值喊一声、按 auto 走。
 *  5. HUD 那两行：模式、为什么、数和门限都在。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeState } from '../src/ui/preview-state.ts';
import { assess } from '../src/ui/readout-state.ts';
import { blendFit, boundsOfPlan, fitFrame, upperFit } from '../src/stage/framing.ts';
import { readFlags } from '../src/shell/kiosk.ts';
import { CONTROLS, stagePatch } from '../src/ui/control-table.ts';
import { formatFramingRows } from '../src/shell/hud.ts';
import { resolveEffectiveFraming } from '../src/stage/effective-framing.ts';
import { createFramingClassifier, decide } from '../../core/src/autoframe.ts';
import { person, SEATED, STOOD_UP_CLOSE, WHOLE } from '../../core/test/framing-people.ts';

/** 笔记本观众，但 MediaPipe 对画外的膝踝给了**高**可见度（它有时就是这么自信） */
const SEATED_CONFIDENT = person({ ...SEATED, visOut: 0.9 });
/** 同一个人头被切：头的点给了高可见度、在上边外面 */
const HEAD_CUT = person({ ...STOOD_UP_CLOSE, visOut: 0.9 });

test('引导：上半身取景时，从下边出去的腿不让小屏说「往后退一点」；不是上半身取景时照旧说', () => {
  assert.deepEqual(seeState({ camera: true, pose: SEATED_CONFIDENT, upperIsIntended: true }), { state: 'ok', reason: 'ok' });
  assert.deepEqual(seeState({ camera: true, pose: SEATED_CONFIDENT }), { state: 'partial', reason: 'bounds' },
    '全景策略下腿出画是真的出画 —— 这条是这一版之前的行为，不许丢');
});

test('引导：上半身取景时，头被切照样说「往后退一点」', () => {
  assert.deepEqual(seeState({ camera: true, pose: HEAD_CUT, upperIsIntended: true }), { state: 'partial', reason: 'bounds' });
});

test('读数：WRN12 和小屏同一个开关 —— 上半身取景时腿不报警，头被切照样报', () => {
  const live = { features: null, inferenceHz: 30 };
  assert.equal(assess({ ...live, pose: SEATED_CONFIDENT, upperIsIntended: true }).code, null);
  assert.equal(assess({ ...live, pose: SEATED_CONFIDENT }).code, 'WRN12');
  assert.equal(assess({ ...live, pose: HEAD_CUT, upperIsIntended: true }).code, 'WRN12');
});

test('引导 × 分类器：同一个坐着的人，分类器判上半身之后小屏闭嘴；判出之前照旧说（不提前豁免）', () => {
  const c = createFramingClassifier();
  const first = decide('auto', c.update(SEATED_CONFIDENT, 1 / 30));
  assert.equal(first.upperIsIntended, false);
  assert.equal(seeState({ camera: true, pose: SEATED_CONFIDENT, upperIsIntended: first.upperIsIntended }).state, 'partial');
  let d = first;
  for (let i = 0; i < 30; i++) d = decide('auto', c.update(SEATED_CONFIDENT, 1 / 30));
  assert.equal(d.upperIsIntended, true);
  assert.equal(seeState({ camera: true, pose: SEATED_CONFIDENT, upperIsIntended: d.upperIsIntended }).state, 'ok');
});

test('中景：t = 0 逐字等于等身全景；t = 1 框得住颅顶和胯；中间单调', () => {
  const full = fitFrame(boundsOfPlan('rig'));
  const upper = upperFit(1.71, 1.02);
  assert.deepEqual(blendFit(full, upper, 0), full, '多了一个中景之后等身全景偏了');
  const u = blendFit(full, upper, 1);
  assert.ok(Math.abs(u.frameHeight - upper.frameHeight) < 1e-9);
  assert.ok(u.centerY + u.frameHeight / 2 >= 1.71 + 0.05, `中景顶 ${(u.centerY + u.frameHeight / 2).toFixed(3)} 切到了头`);
  assert.ok(u.centerY - u.frameHeight / 2 <= 0.93 - 0.1, `中景底 ${(u.centerY - u.frameHeight / 2).toFixed(3)} 没框住胯`);
  assert.ok(u.frameHeight < full.frameHeight * 0.5, '中景没有比全景近');
  let prev = Infinity;
  for (let k = 0; k <= 10; k++) {
    const h = blendFit(full, upper, k / 10).frameHeight;
    assert.ok(h <= prev + 1e-12, `第 ${k} 格画面高度往回走了`);
    prev = h;
  }
  assert.equal(u.aimY, full.aimY, '灯跟着景别走了');
  // 坏输入不许出 NaN
  const bad = upperFit(NaN, NaN);
  assert.ok([bad.frameHeight, bad.frameWidth, bad.centerY].every(Number.isFinite));
});

test('?framing=：三个值读得回来，默认 auto；认不出来喊一声、按 auto 走；控件条写出去读得回来', () => {
  assert.equal(readFlags('').framing, 'auto');
  assert.equal(readFlags('?kiosk=1').framing, 'auto');
  for (const v of ['auto', 'full', 'upper'] as const) assert.equal(readFlags(`?framing=${v}`).framing, v);
  const warn = console.warn;
  const said: string[] = [];
  console.warn = (m: string) => { said.push(String(m)); };
  try { assert.equal(readFlags('?framing=half').framing, 'auto'); } finally { console.warn = warn; }
  assert.ok(said.some((m) => m.includes('?framing=half')), '认不出来的值没有喊');
  const c = CONTROLS.find((x) => x.id === 'framing')!;
  assert.equal(c.kind, 'choice', '取景要是一个选择（auto 就是交回分类器），不是一个开关');
  for (const v of ['auto', 'full', 'upper']) {
    const w = c.url!.write(v);
    const back = readFlags(w === null || w === undefined ? '' : `?framing=${w}`);
    assert.equal(c.fromFlags!(back), v);
  }
  assert.equal(stagePatch({ form: null, scene: 'void', act: null, outline: false, vitality: true, sound: true, species: null, refine: true, post: true, framing: 'auto', people: '1' }).framing, null,
    'auto 应该写成删除：地址栏里不留一个默认值');
});

test('HUD：模式、理由、在模式里的秒数、膝踝数与门限、尺度与门限都在那两行里', () => {
  const c = createFramingClassifier();
  let r = c.update(person(WHOLE), 1 / 30);
  for (let i = 0; i < 60; i++) r = c.update(person(SEATED), 1 / 30);
  const decision = decide('auto', r);
  const effective = resolveEffectiveFraming(decision, { plan: 'rig', planDrift: 0, hasCompanions: false, cameraFraming: false });
  const [a, b] = formatFramingRows({ reading: r, decision, effective, legHold: 1, shot: 1 });
  assert.match(a, /^upper ← legs-out \d+\.\ds/);
  assert.match(b, /膝踝 0\/4 \(≥3 全 ≤1 半\)/);
  assert.match(b, /尺度 \d\.\d\d \(≤0\.88 退\)/);
  const full = decide('full', r);
  const [, none] = formatFramingRows({
    reading: c.update(null, 1 / 30), decision: full,
    effective: resolveEffectiveFraming(full, { plan: 'rig', planDrift: 0, hasCompanions: false, cameraFraming: false }),
    legHold: 0, shot: 0,
  });
  assert.equal(none, '无人');
});
