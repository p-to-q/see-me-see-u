/**
 * 调速器的每一级都接在一个**已经存在的**开关上（docs/48 §4），而且只在变化时拨它。
 *
 * 为什么要守"已经存在"：调速器最容易长成第二套开关 —— 自己的"关后期"、自己的"降分辨率"，
 * 和控件条、降级阶梯各拨各的，最后谁也说不清后期到底为什么是关的。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDeferral, GOVERNOR_LADDER, type GovernorStep } from '../src/shell/governor.ts';
import { GOVERNOR_SWITCHES, wireGovernor } from '../src/shell/governor-wire.ts';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('调速器接线: 放到第 n 级 = 前 n 个开关拨成"放下"，只拨变了的', () => {
  const calls: [GovernorStep, boolean][] = [];
  const t = Object.fromEntries(GOVERNOR_LADDER.map((s) => [s, (shed: boolean) => { calls.push([s, shed]); }])) as
    unknown as Record<GovernorStep, (shed: boolean) => void>;
  const apply = wireGovernor(t);
  apply(0);
  assert.deepEqual(calls, [], '0 级什么都不拨');
  apply(2);
  assert.deepEqual(calls, [['ink', true], ['swaps', true]]);
  calls.length = 0;
  apply(2);
  assert.deepEqual(calls, [], '同一级重复 apply 不重复拨');
  apply(1);
  assert.deepEqual(calls, [['swaps', false]], '拿回一级只拨那一个');
  calls.length = 0;
  apply(GOVERNOR_LADDER.length);
  assert.deepEqual(calls.map((c) => c[0]), ['swaps', 'inference', 'dpr', 'post', 'ui', 'people']);
  assert.ok(calls.every((c) => c[1] === true));
});

test('调速器接线: 某个开关自己炸了，不拖垮其余几级（帧循环里永不抛）', () => {
  const hit: GovernorStep[] = [];
  const t = Object.fromEntries(GOVERNOR_LADDER.map((s) => [s, () => {
    hit.push(s);
    if (s === 'swaps') throw new Error('boom');
  }])) as unknown as Record<GovernorStep, (shed: boolean) => void>;
  const apply = wireGovernor(t);
  assert.doesNotThrow(() => apply(3));
  assert.deepEqual(hit, ['ink', 'swaps', 'inference']);
});

test('调速器接线: 每一级都登记了它拨的是哪个开关，而且那个开关在代码里本来就有', () => {
  assert.deepEqual(Object.keys(GOVERNOR_SWITCHES), [...GOVERNOR_LADDER]);
  const main = read('../src/main.ts');
  // 开关本身必须在调速器之外也有人用（或者就是那个模块自己的公开方法）
  const owners: Record<GovernorStep, string> = {
    ink: read('../src/stage/stage.ts'),
    swaps: main,
    inference: read('../src/capture/webcam.ts'),
    post: read('../src/stage/stage.ts') + main,
    dpr: main,
    ui: main,
    // 多人（docs/50 §5.4）：开关是 main.ts 里 `people` 那一块的 `shed` 位，帧循环里按它把伴随身体的预算压到 0
    people: main,
  };
  const block = /wireGovernor\(\{([\s\S]*?)\n\s*\}\)/.exec(main)?.[1] ?? '';
  assert.ok(block, 'main.ts 里要有 wireGovernor({ ... }) 那一处接线');
  for (const step of GOVERNOR_LADDER) {
    const sw = GOVERNOR_SWITCHES[step];
    assert.ok(sw.length > 0, `${step} 没登记开关`);
    assert.ok(block.includes(sw), `${step} 的接线里没有用到登记的开关 ${sw}`);
    const bare = sw.split('.').pop()!;
    assert.ok(owners[step].includes(bare), `${sw} 不是一个已经存在的开关`);
  }
});

test('延后: 放下「替换」时压住，恢复或压满 swapDeferMax 就放行 —— 一件都不丢', () => {
  const d = createDeferral<number>(4);
  assert.deepEqual(d.offer(1, 0, false), [1], '没放下时当场执行');
  assert.deepEqual(d.offer(2, 100, true), [], '放下时压住');
  assert.equal(d.pending, 1);
  assert.deepEqual(d.tick(2000, true), [], '还没压满');
  assert.deepEqual(d.tick(4200, true), [2], '压满 4 秒照发 —— 忒修斯不许因为慢机器停摆');
  assert.deepEqual(d.offer(3, 5000, true), []);
  assert.deepEqual(d.tick(5100, false), [3], '恢复了就放行');

  // 随机序列：进来多少件，出去多少件，顺序不变
  const g = createDeferral<number>(4);
  const out: number[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let now = 0;
  for (let i = 0; i < 200; i++) {
    now += rnd() * 3000;
    const shed = rnd() < 0.6;
    out.push(...g.tick(now, shed));
    if (rnd() < 0.5) out.push(...g.offer(i, now, shed));
  }
  out.push(...g.tick(now + 10000, false));
  const inOrder = [...out].sort((a, b) => a - b);
  assert.deepEqual(out, inOrder, '放行顺序 = 进来的顺序');
  assert.equal(new Set(out).size, out.length, '不重复');
  assert.equal(g.pending, 0);
});
