/**
 * 姿态时钟（`capture/pose-clock.ts`，docs/48 §3）。
 *
 * 基线实测：推理 30Hz，显示更快时同一份结果被连着吃好几帧 —— 精化器和运动特征看到的
 * 是"不动、不动、跳一大步"。这一组守的是：两次推理之间走的是一条线，不是一级台阶；
 * 推理停了，身体先顺着走一小段、再停住、再交给在场判定，不闪也不飞。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPoseClock, measuredPose, type PoseClockState } from '../src/capture/pose-clock.ts';
import { CAPTURE } from '../../core/src/tuning.ts';
import type { RawPose } from '../../core/src/types.ts';

/** 33 个点全在 x 上，score 满 —— 够看出插值走没走线 */
const pose = (x: number, t: number, score = 0.9): RawPose => ({
  world: Array.from({ length: 33 }, () => ({ x, y: 0, z: 0, visibility: 0.9 })),
  screen: Array.from({ length: 33 }, () => ({ x: x / 10, y: 0.5, z: 0, visibility: 0.9 })),
  score,
  t,
});
const xOf = (p: RawPose | null) => p?.world[0].x ?? NaN;

test('姿态时钟: 两次推理之间插值，不是停在最新那一份上', () => {
  const c = createPoseClock();
  c.observe(pose(0, 0), 0);
  c.observe(pose(1, 33.3), 33.3);
  // 延迟 = 测到的推理间隔（33.3ms，没超上限）。渲染在 50ms：往回退到 16.7ms，正好一半
  const p = c.sample(50);
  assert.ok(Math.abs(xOf(p) - 0.5) < 0.02, `应在两次结果中间，实际 x=${xOf(p)}`);
  assert.ok(Math.abs((p!.screen![0].x) - 0.05) < 0.002, 'screen 坐标同样插值');
});

test('姿态时钟: 30Hz 推理 × 120Hz 渲染，匀速运动出来是匀速的（没有台阶）', () => {
  const c = createPoseClock();
  const hz = 30;
  const v = 2;   // 每秒 2 个单位
  let nextInfer = 0;
  const xs: number[] = [];
  for (let now = 0; now < 2000; now += 1000 / 120) {
    while (nextInfer <= now) { c.observe(pose((v * nextInfer) / 1000, nextInfer), nextInfer); nextInfer += 1000 / hz; }
    if (now > 300) xs.push(xOf(c.sample(now)));
  }
  const steps = xs.slice(1).map((x, i) => x - xs[i]);
  const min = Math.min(...steps);
  const max = Math.max(...steps);
  assert.ok(min > 0, `每一帧都要往前走，最小一步 ${min}（0 = 台阶）`);
  assert.ok(max / min < 1.6, `步长要均匀，最大/最小 = ${(max / min).toFixed(2)}`);
});

test('姿态时钟: 推理停了 —— 先外推一小段，封顶，不飞出去', () => {
  const c = createPoseClock();
  c.observe(pose(0, 0), 0);
  c.observe(pose(1, 33.3), 33.3);   // 速度 1 单位 / 33.3ms
  const cap = 1 + (CAPTURE.extrapolateMax * 1000) / 33.3;
  for (let now = 60; now < 33.3 + CAPTURE.stallAfter * 1000; now += 8) {
    const x = xOf(c.sample(now));
    assert.ok(x <= cap + 1e-6, `外推不许超过 ${cap.toFixed(2)}，t=${now} 时 x=${x}`);
  }
});

test('姿态时钟: 停滞 → 保持最后姿态 → 超过保持时长交出 null（在场判定接手）', () => {
  const c = createPoseClock();
  c.observe(pose(0, 0), 0);
  c.observe(pose(1, 33.3), 33.3);
  const holdAt = 33.3 + (CAPTURE.stallAfter + CAPTURE.holdAfterStall / 2) * 1000;
  assert.notEqual(c.sample(holdAt), null, '保持期里还给姿态');
  assert.equal(c.state, 'holding');
  const goneAt = 33.3 + (CAPTURE.stallAfter + CAPTURE.holdAfterStall) * 1000 + 50;
  assert.equal(c.sample(goneAt), null, '保持期过了就交出 null，不是永远僵在那儿');
  assert.equal(c.state, 'stalled');
  // 推理回来：立刻重新活过来
  c.observe(pose(3, goneAt + 10), goneAt + 10);
  assert.notEqual(c.sample(goneAt + 20), null);
});

test('姿态时钟: 身体可保持，取景 / 小屏 / 读数不报缓存骨架', () => {
  const last = pose(1, 33.3);
  const expected = new Map<PoseClockState, RawPose | null>([
    ['waiting', null],
    ['live', last],
    ['extrapolating', last],
    ['holding', null],
    ['stalled', null],
    ['empty', null],
  ]);
  for (const [state, want] of expected) assert.equal(measuredPose(last, state), want, state);
  assert.equal(measuredPose(null, 'live'), null);
});

test('姿态时钟: 推理说"没人" —— 立刻 null，不从上一份里插出一个幽灵', () => {
  const c = createPoseClock();
  c.observe(pose(0, 0), 0);
  c.observe(pose(1, 33.3), 33.3);
  c.observe(null, 66.6);
  assert.equal(c.sample(70), null);
  assert.equal(c.state, 'empty');
});

test('姿态时钟: 中间隔了一大段（切回前台 / 停滞后恢复）—— 不从旧姿态慢慢滑过来', () => {
  const c = createPoseClock();
  c.observe(pose(0, 0), 0);
  c.observe(pose(1, 33.3), 33.3);
  c.observe(pose(9, 5000), 5000);
  const x = xOf(c.sample(5010));
  assert.ok(Math.abs(x - 9) < 1e-6, `隔了 5 秒的两份之间没有可信的路径，应直接用新的，实际 x=${x}`);
});

test('姿态时钟: 同一次推理被连着观察很多帧，不重复入队（插值不塌）', () => {
  const c = createPoseClock();
  const a = pose(0, 0); const b = pose(1, 33.3);
  c.observe(a, 0);
  for (let i = 0; i < 5; i++) c.observe(a, 0);
  c.observe(b, 33.3);
  for (let i = 0; i < 5; i++) c.observe(b, 33.3);
  assert.ok(Math.abs(xOf(c.sample(50)) - 0.5) < 0.02);
});

test('姿态时钟: 给出去的 t 严格递增', () => {
  const c = createPoseClock();
  let last = -Infinity;
  let nextInfer = 0;
  for (let now = 0; now < 1000; now += 7) {
    while (nextInfer <= now) { c.observe(pose(nextInfer / 100, nextInfer), nextInfer); nextInfer += 33.3 + (nextInfer % 3); }
    const p = c.sample(now);
    if (!p) continue;
    assert.ok(p.t > last, `t 必须递增：${last} → ${p.t}`);
    last = p.t;
  }
});
