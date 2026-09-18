/**
 * `?people=`（docs/50）：认字、默认、控件表写出去再读回来、回放合成的人。
 *
 * 默认值由 docs/50 §5 的实测定，这里不钉那个数本身 —— 钉的是**表、flags、tuning 三处说的是同一个数**，
 * 以及 `1` 这条路和这一版之前逐字相同（worker 消息里没有 `others`、回放只给一个人）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PEOPLE } from '../../core/src/tuning.ts';
import { observePerson } from '../../core/src/people.ts';
import type { RawPose } from '../../core/src/types.ts';
import { parsePeople, readFlags } from '../src/shell/kiosk.ts';
import { CONTROLS, stagePatch, STAGE_KEYS, type ControlValues } from '../src/ui/control-table.ts';
import { placeInFrame, synthPeople, SYNTH_SLOTS } from '../src/capture/people-synth.ts';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('?people= 只认 auto 或 1..hardMax；其他值告警后走自动', () => {
  assert.equal(parsePeople('1'), 1);
  assert.equal(parsePeople(String(PEOPLE.hardMax)), PEOPLE.hardMax);
  for (const bad of ['0', String(PEOPLE.hardMax + 1), 'two', '2.5', '-1', '', ' ', '1e1', null]) {
    assert.equal(parsePeople(bad), null, `?people=${bad}`);
  }
  assert.equal(readFlags('').people, PEOPLE.defaultCap);
  assert.equal(readFlags('?kiosk=1').people, PEOPLE.defaultCapKiosk);
  assert.equal(readFlags('?people=2').people, 2);
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message?: unknown) => warnings.push(String(message));
  try {
    assert.equal(readFlags('?people=auto').people, PEOPLE.defaultCap);
    assert.equal(readFlags('?kiosk=1&people=auto').people, PEOPLE.defaultCapKiosk);
    assert.equal(warnings.length, 0, 'auto 是合法值，不该告警');
    assert.equal(readFlags('?people=9').people, PEOPLE.defaultCap, '认不出来 = 自动的初始上限，不是夹到上限');
    assert.match(warnings.at(-1) ?? '', /只认 auto \/ 1–\d+.*按 auto 处理/);
  } finally {
    console.warn = warn;
  }
  assert.ok(PEOPLE.defaultCap >= 1 && PEOPLE.defaultCap <= PEOPLE.hardMax);
  assert.ok(PEOPLE.defaultCapKiosk >= 1 && PEOPLE.defaultCapKiosk <= PEOPLE.hardMax);
});

test('peopleAuto：网页和现场都默认自动，只有显式固定 1..hardMax 才关掉', () => {
  assert.equal(readFlags('').peopleAuto, true, '网页版、没写 ?people=：自动探测默认开');
  assert.equal(readFlags('?people=auto').peopleAuto, true, '显式 auto 和删掉参数同义');
  assert.equal(readFlags('?people=1').peopleAuto, false, '显式写了 1（哪怕和默认值一样）也该关掉探测');
  assert.equal(readFlags('?people=2').peopleAuto, false, '显式选了别的数，探测不该在背后再把它改掉');
  assert.equal(readFlags('?people=9').peopleAuto, true, '认不出来的值等于没写过，探测照常开');
  assert.equal(readFlags('?kiosk=1').peopleAuto, true, '现场也不应让观众手动报人数');
  assert.equal(readFlags('?kiosk=1&people=auto').peopleAuto, true);
  assert.equal(readFlags('?kiosk=1&people=2').peopleAuto, false, '现场 + 显式人数：两条理由都成立');
});

test('控件「人数」：默认自动；固定 1/2/3 都保留在 URL 中', () => {
  const c = CONTROLS.find((x) => x.id === 'people');
  assert.ok(c, '控件表里没有人数这一项');
  assert.equal(c.group, 'framing');
  assert.equal(c.default, 'auto');
  assert.equal(c.fromFlags?.(readFlags('')), 'auto');
  assert.equal(c.fromFlags?.(readFlags('?kiosk=1')), 'auto');
  const base: ControlValues = {
    form: null, scene: 'paper', act: null, outline: false, vitality: true, sound: true,
    species: 'xeno', refine: true, post: true, framing: 'auto', people: '1',
  };
  for (const v of c.options as readonly string[]) {
    const patch = stagePatch({ ...base, people: v });
    const q = new URLSearchParams();
    for (const [k, val] of Object.entries(patch)) if (val !== null) q.set(k, val);
    assert.equal(c.fromFlags?.(readFlags(`?${q}`)), v, `people=${v} 写出去读不回来：${q}`);
    if (v === 'auto') assert.equal(patch.people, null, 'auto 应删掉参数');
    else assert.equal(patch.people, v, `固定 ${v} 不能因为碰巧等于初始上限就被删掉`);
  }
  assert.ok(STAGE_KEYS.includes('people'), '回舞台时要带着人数');
});

test('单人那条路：worker 只在 numPoses > 1 时才发 others；主线程每一处 numPoses 都来自开关', () => {
  const worker = read('../src/capture/pose-worker.ts');
  assert.match(worker, /if \(n > 1\) \{\s*out\.others = \[\]/, '单人时消息必须和这一版之前逐字相同（没有 others 字段）');
  const webcam = read('../src/capture/webcam.ts');
  assert.ok(!/numPoses: 1\b/.test(webcam), 'webcam.ts 里还有写死的 numPoses: 1 —— 那一路不认 ?people=');
  assert.ok(!/numPoses: 1\b/.test(worker.replace(/posesOf\([^)]*\)/g, '')), 'pose-worker.ts 里还有写死的 numPoses: 1');
});

function clip(n = 300): RawPose[] {
  const frames: RawPose[] = [];
  for (let i = 0; i < n; i++) {
    // 一个 1.7m 的人：胯为原点，y 向下（MediaPipe world 约定），手随帧摆动；左肩 11 在 +x
    const world = Array.from({ length: 33 }, (_, k) => ({ x: 0, y: 0, z: 0, visibility: 0.95 }));
    const set = (k: number, x: number, y: number) => { world[k] = { x, y, z: 0, visibility: 0.95 }; };
    set(0, 0, -0.65); set(11, 0.19, -0.45); set(12, -0.19, -0.45);
    set(13, 0.33, -0.2); set(14, -0.33, -0.2); set(15, 0.44 + 0.1 * Math.sin(i / 10), 0.02); set(16, -0.44, 0.02);
    set(23, 0.09, 0); set(24, -0.09, 0); set(25, 0.1, 0.42); set(26, -0.1, 0.42); set(27, 0.1, 0.84); set(28, -0.1, 0.84);
    frames.push({ world, score: 0.9, t: i });
  }
  return frames;
}

test('回放合成的人：位置各不相同、都能被多人跟踪观测到、奇数位镜像时左右成对的点交换', () => {
  const frames = clip();
  const people = synthPeople(frames, 10, 3, 1234);
  assert.equal(people.length, 3);
  const obs = people.map((p) => observePerson(p));
  assert.ok(obs.every(Boolean), '合成的每个人都必须有 screen 观测，否则回放上演示不了多人');
  const xs = obs.map((o) => o!.cx);
  assert.ok(Math.abs(xs[0] - SYNTH_SLOTS[0].cx) < 0.02 && Math.abs(xs[1] - SYNTH_SLOTS[1].cx) < 0.02);
  assert.ok(new Set(xs.map((x) => x.toFixed(2))).size === 3, `三个人站在三个地方：${xs}`);
  // 镜像：原录制左肩（11）在 +x；镜像后 11 号仍是"左肩"，但它的 x 来自原来的右肩取负 = +0.19
  const m = placeInFrame(frames[0], { ...SYNTH_SLOTS[1], mirror: true }, 0);
  assert.ok(Math.abs(m.world[11].x - 0.19) < 1e-9 && Math.abs(m.world[12].x + 0.19) < 1e-9);
  assert.ok(Math.abs(m.world[15].x - 0.44) < 1e-9, '腕的动作跟着换到了另一只手上');
  assert.equal(synthPeople([], 0, 3, 0).length, 0);
});
