/**
 * 帧调速器（`shell/governor.ts`，docs/48 §4）：阶梯、滞回、恢复、不闪。
 *
 * 喂的全是合成帧间隔 —— 调速器是纯的，时间由调用方给。显示器节拍故意不写死：
 * 60 / 120 / 144Hz 各跑一遍，稳态都必须是 0 级（按 16.7ms 写死的调速器在 30Hz 屏上会一直降）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGovernor, GOVERNOR_LADDER, type Governor, type GovernorDecision } from '../src/shell/governor.ts';
import { GOVERNOR } from '../../core/src/tuning.ts';

interface Run { now: number; changes: { at: number; d: GovernorDecision }[] }

/** 按 `pattern(i)` 给的帧间隔跑 `seconds` 秒 */
function feed(g: Governor, run: Run, seconds: number, pattern: (i: number) => number,
  extra: { visible?: boolean; longTasksEvery?: number } = {}): void {
  const end = run.now + seconds * 1000;
  let i = 0;
  let sinceLt = 0;
  while (run.now < end) {
    const ms = pattern(i++);
    run.now += ms;
    sinceLt += ms;
    let longTasks = 0;
    if (extra.longTasksEvery && sinceLt >= extra.longTasksEvery) { longTasks = 1; sinceLt = 0; }
    const d = g.sample({ now: run.now, frameMs: ms, visible: extra.visible ?? true, longTasks });
    if (d.changed !== 0) run.changes.push({ at: run.now, d });
  }
}
const fresh = (): [Governor, Run] => [createGovernor(), { now: 0, changes: [] }];
const HZ60 = () => 1000 / 60;
/** 每 4 帧丢一次（50ms），= 25% 丢帧 */
const OVERLOAD = (i: number) => (i % 4 === 3 ? 50 : 1000 / 60);

test('调速器: 阶梯顺序 —— 先放下看不见的，再降代价，最后才减身体', () => {
  // `people`（docs/50 §5.4）排最后：放下一个人的身体是观众最看得出来的一件事
  assert.deepEqual(GOVERNOR_LADDER, ['ink', 'swaps', 'inference', 'dpr', 'post', 'ui', 'people']);
});

for (const hz of [30, 60, 120, 144]) {
  test(`调速器: ${hz}Hz 屏上稳态 30 秒 —— 0 级、一次都不动`, () => {
    const [g, run] = fresh();
    feed(g, run, 30, () => 1000 / hz);
    assert.equal(g.level, 0);
    assert.equal(run.changes.length, 0);
  });
}

test('调速器: 持续丢帧 —— 一级一级往下放，每级之间至少 minDwell', () => {
  const [g, run] = fresh();
  feed(g, run, 3, HZ60);   // 先让它认识这块屏
  const start = run.now;
  feed(g, run, 20, OVERLOAD);
  assert.ok(g.level >= 2, `20 秒持续过载应当至少放下两级，实际 ${g.level}`);
  assert.ok(run.changes[0].at - start >= GOVERNOR.shedAfter * 1000, '过载要憋 shedAfter 才动');
  for (let k = 0; k < run.changes.length; k++) {
    assert.equal(run.changes[k].d.changed, 1, '过载时只许往下放');
    assert.equal(run.changes[k].d.level, k + 1, '一次只走一级');
    assert.equal(run.changes[k].d.step, GOVERNOR_LADDER[k]);
    if (k > 0) assert.ok(run.changes[k].at - run.changes[k - 1].at >= GOVERNOR.minDwell * 1000 - 1, '两次变化之间至少 minDwell');
  }
  assert.ok(g.level <= GOVERNOR_LADDER.length);
  assert.equal(g.sheds('ink'), true);
  assert.equal(g.sheds('ui'), g.level >= GOVERNOR_LADDER.indexOf('ui') + 1);
});

test('调速器: 余量回来 —— 憋够 restoreAfter 才拿回，一次一级，最后回到 0', () => {
  const [g, run] = fresh();
  feed(g, run, 3, HZ60);
  feed(g, run, 12, OVERLOAD);
  const peak = g.level;
  assert.ok(peak >= 2);
  run.changes.length = 0;
  const calm = run.now;
  feed(g, run, 180, HZ60);
  assert.equal(g.level, 0, '三分钟平稳之后应当全部拿回');
  assert.equal(run.changes.length, peak, '拿回也是一次一级');
  assert.ok(run.changes[0].at - calm >= GOVERNOR.restoreAfter * 1000, '余量要憋 restoreAfter');
  for (const c of run.changes) assert.equal(c.d.changed, -1);
});

test('调速器: 忽好忽坏（3 秒卡 / 3 秒顺）两分钟 —— 只往下放，不来回闪', () => {
  const [g, run] = fresh();
  feed(g, run, 3, HZ60);
  for (let k = 0; k < 20; k++) { feed(g, run, 3, OVERLOAD); feed(g, run, 3, HZ60); }
  assert.ok(run.changes.every((c) => c.d.changed === 1), '顺的那 3 秒不够 restoreAfter，不许拿回');
  assert.ok(run.changes.length <= GOVERNOR_LADDER.length);
});

/** 按 `pattern` 跑，直到调速器到了 `level` 级（最多 `seconds` 秒）—— 过载在那一刻就停 */
function feedUntil(g: Governor, run: Run, seconds: number, pattern: (i: number) => number, level: number): void {
  const end = run.now + seconds * 1000;
  let i = 0;
  while (run.now < end && g.level !== level) {
    const ms = pattern(i++);
    run.now += ms;
    const d = g.sample({ now: run.now, frameMs: ms, visible: true });
    if (d.changed !== 0) run.changes.push({ at: run.now, d });
  }
}

test('调速器: 拿回之后很快又卡（复发）—— 下一次拿回要憋的时间翻倍', () => {
  const [g, run] = fresh();
  feed(g, run, 3, HZ60);
  feedUntil(g, run, 5, OVERLOAD, 1);
  assert.equal(g.level, 1);
  feed(g, run, GOVERNOR.restoreAfter + 1.5, HZ60);
  assert.equal(g.level, 0, '第一次正常拿回');
  feedUntil(g, run, 5, OVERLOAD, 1);
  assert.equal(g.level, 1, '复发');
  run.changes.length = 0;
  const calm = run.now;
  feed(g, run, GOVERNOR.restoreAfter * 2 + 2, HZ60);
  assert.equal(run.changes.length, 1);
  assert.ok(run.changes[0].at - calm >= GOVERNOR.restoreAfter * 2 * 1000, '复发后憋 2 × restoreAfter');
});

test('调速器: 标签页在后台 5 秒又回来 —— 不算卡，不放级', () => {
  const [g, run] = fresh();
  feed(g, run, 5, HZ60);
  run.now += 5000;
  g.sample({ now: run.now, frameMs: 5000, visible: false });
  feed(g, run, 5, HZ60);
  assert.equal(g.level, 0);
  assert.equal(run.changes.length, 0);
});

test('调速器: 没有 visibility 事件的一次大间隔（机器睡醒）—— 单独一帧不放级', () => {
  const [g, run] = fresh();
  feed(g, run, 5, HZ60);
  feed(g, run, 0.001, () => 3000);
  feed(g, run, 5, HZ60);
  assert.equal(g.level, 0);
});

test('调速器: 帧间隔看起来还行但长任务不断 —— 照样放级', () => {
  const [g, run] = fresh();
  feed(g, run, 3, HZ60);
  feed(g, run, 6, HZ60, { longTasksEvery: 400 });
  assert.ok(g.level >= 1, `每 400ms 一次长任务应当放级，实际 ${g.level}`);
});

/**
 * 2026-09-14 无头 Chrome 实测逼出来的两条（docs/48 §4「第一次上机」）：
 * 解开帧率的页面跑到 ~400fps，节拍被量成 1.0–1.4ms，一帧 2–3ms 就被当成"丢帧"，
 * 调速器几秒内把六级全放了。可变刷新率（VRR / ProMotion）的屏上帧间隔同样是抖的。
 * 丢帧必须同时是**人看得出来**的那种：比节拍慢，而且慢过一个绝对下限。
 */
test('调速器: 不锁帧的页面（~400fps，帧间隔 1–3ms 乱跳）—— 0 级，一次都不动', () => {
  const [g, run] = fresh();
  let s = 3;
  const jitter = () => { s = (s * 16807) % 2147483647; return 1 + 2 * (s / 2147483647); };
  feed(g, run, 30, jitter);
  assert.equal(run.changes.length, 0, `变化了 ${run.changes.length} 次，节拍 ${g.refreshMs}ms`);
  assert.ok(g.refreshMs >= GOVERNOR.refreshFloorMs, '节拍不许被量成比任何真实屏幕都快');
});

test('调速器: 120Hz 屏上偶尔一帧 12ms（人看不出来）—— 0 级', () => {
  const [g, run] = fresh();
  feed(g, run, 30, (i) => (i % 5 === 4 ? 12 : 1000 / 120));
  assert.equal(g.level, 0);
});

test('调速器: 加了下限之后，60Hz 屏上真的丢帧照样放级', () => {
  const [g, run] = fresh();
  feed(g, run, 3, HZ60);
  feed(g, run, 6, OVERLOAD);
  assert.ok(g.level >= 1);
});

test('调速器: reset 回到 0 级', () => {
  const [g, run] = fresh();
  feed(g, run, 3, HZ60);
  feed(g, run, 10, OVERLOAD);
  assert.ok(g.level > 0);
  g.reset();
  assert.equal(g.level, 0);
  assert.equal(g.sheds('ink'), false);
});
