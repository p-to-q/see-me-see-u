/**
 * 加载层 → 选择页的显示权交棒。
 *
 * 这里不拿“等 1.3 秒看看”当证据：退场编排吃假时钟，每一条边界都能
 * 精确推进。再用一组接线守卫钉住三件事：入口不提前开播、chooser 的
 * 任何可见副作都在 gate 后、reveal 声不早于加载层真正移除。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runLoadingExit, type LoadingExitScheduler } from '../src/shell/loading-exit.ts';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function fakeClock(): { schedule: LoadingExitScheduler; advance(ms: number): void } {
  let now = 0;
  let order = 0;
  const pending: { at: number; order: number; run: () => void }[] = [];
  return {
    schedule(run, delayMs) {
      pending.push({ at: now + delayMs, order: order++, run });
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        pending.sort((a, b) => a.at - b.at || a.order - b.order);
        const next = pending[0];
        if (!next || next.at > end) break;
        pending.shift();
        now = next.at;
        next.run();
      }
      now = end;
    },
  };
}

test('有展签：100% 停满 1000ms，细节收完 240ms 才交棒', async () => {
  const clock = fakeClock();
  const events: string[] = [];
  let done = false;
  const finished = runLoadingExit({
    waitMs: 1000, detailsMs: 240, moveMs: 420, flashMs: 200, hasMark: false,
    schedule: clock.schedule,
    onDetails: () => events.push('details'),
    onMove: () => events.push('move'),
    onSettled: () => events.push('settled'),
    onRemove: () => events.push('remove'),
  });
  void finished.then(() => { done = true; });

  clock.advance(999);
  assert.deepEqual(events, []);
  clock.advance(1);
  assert.deepEqual(events, ['details']);
  clock.advance(239);
  assert.equal(done, false);
  clock.advance(1);
  await Promise.resolve();
  assert.deepEqual(events, ['details', 'remove']);
  assert.equal(done, true);
});

test('无展签：细节、字标移动、闪动全部完成后才 resolve', async () => {
  const clock = fakeClock();
  const events: string[] = [];
  const finished = runLoadingExit({
    waitMs: 1000, detailsMs: 240, moveMs: 420, flashMs: 200, hasMark: true,
    schedule: clock.schedule,
    onDetails: () => events.push('details'),
    onMove: () => events.push('move'),
    onSettled: () => events.push('settled'),
    onRemove: () => events.push('remove'),
  });

  clock.advance(1000);
  assert.deepEqual(events, ['details']);
  clock.advance(240);
  assert.deepEqual(events, ['details', 'move']);
  clock.advance(420);
  assert.deepEqual(events, ['details', 'move', 'settled']);
  clock.advance(199);
  assert.deepEqual(events, ['details', 'move', 'settled']);
  clock.advance(1);
  await finished;
  assert.deepEqual(events, ['details', 'move', 'settled', 'remove']);
});

test('退场某一步抛错也继续交棒；scheduler 失败时立即放行', async () => {
  const clock = fakeClock();
  const errors: unknown[] = [];
  let removed = 0;
  const finished = runLoadingExit({
    waitMs: 0, detailsMs: 0, moveMs: 0, flashMs: 0, hasMark: true,
    schedule: clock.schedule,
    onDetails: () => { throw new Error('details'); },
    onMove: () => { throw new Error('move'); },
    onSettled: () => { throw new Error('settled'); },
    onRemove: () => { removed++; },
    onError: (error) => errors.push(error),
  });
  clock.advance(0);
  await finished;
  assert.equal(errors.length, 3);
  assert.equal(removed, 1);

  let failOpenRemoved = 0;
  await runLoadingExit({
    waitMs: 1000, detailsMs: 240, moveMs: 420, flashMs: 200, hasMark: false,
    schedule: () => { throw new Error('timer'); },
    onDetails() {}, onMove() {}, onSettled() {},
    onRemove: () => { failOpenRemoved++; },
  });
  assert.equal(failOpenRemoved, 1);
});

test('接线：chooser 的 DOM / 输入 / play 全在 gate 后，entry 不提前开播', () => {
  const choose = strip(read('../src/choose/choose.ts'));
  const gate = choose.indexOf('await options.beforeReveal?.()');
  assert.ok(gate > 0, 'chooser 没有 reveal gate');
  for (const needle of ['holdFirstScreen()', 'buildDom(mount)', 'window.addEventListener', 'field.play()']) {
    assert.ok(choose.indexOf(needle) > gate, `${needle} 跑到 gate 前面了`);
  }
  const entry = strip(read('../src/shell/entry.ts'));
  assert.doesNotMatch(entry, /field\.play\(\)/, 'entry 仍会绕过 gate 提前开播');
  assert.match(entry, /field\.attract\(\)/, '回大厅路径没有留在 attract');
});

test('接线：main 把 loading 完成作为 gate，reveal 声只在交棒后', () => {
  const main = strip(read('../src/main.ts'));
  assert.match(main, /beforeReveal:\s*\(\)\s*=>\s*loading\.finish\(\)/);
  const gate = main.indexOf('await loading.finish()');
  const release = main.indexOf('releasePrepaint()', gate);
  const cue = main.indexOf("cues.play('reveal')", gate);
  assert.ok(gate > 0 && release > gate && cue > release, '首屏释放 / reveal 声早于交棒');

  const loading = strip(read('../src/shell/loading.ts'));
  assert.match(loading, /finish\(\):\s*Promise<void>/);
  assert.match(loading, /if\s*\(finishPromise\)\s*return finishPromise/);
  assert.match(loading, /onRemove:\s*\(\)\s*=>\s*layer\.remove\(\)/);
});
