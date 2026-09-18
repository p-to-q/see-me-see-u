/**
 * 一场相遇的交易边界。
 *
 * `main.ts` 吃 WebGPU、DOM 与整条启动链，Node 里不能直接 boot；这里一半量身体实现
 * 的真实 reset，一半读唯一接线点。源码守卫不是在证明实现细节，而是在防两条曾经真的
 * 出现过的回归：自然离场清了一半，输入源切换又另写一份更短的清单。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REFERENCE_POSE } from '../src/stage/framing.ts';
import { createMassBody } from '../src/creature/mass.ts';
import { createSwarmBody } from '../src/creature/swarm.ts';
import type { Presence } from '../../core/src/types.ts';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const MAIN = read('../src/main.ts');
const RESET = MAIN.match(/const resetEncounter = \(reason:[^]*?\n  };\n\n  \/\*\*\n   \* 调速器/)?.[0] ?? '';
const ALIVE: Presence = { state: 'ALIVE', elapsed: 1, transition: 1 };

test('encounter reset: 团块清掉能量、时钟与落地基准，但对象可直接复用', () => {
  const body = createMassBody({});
  body.setEnergy(3);
  body.pose(REFERENCE_POSE, ALIVE, 1 / 60);
  assert.ok(body.stats.drawCalls > 0, '前提：reset 前团块真的画过');

  body.reset();
  assert.equal(body.stats.drawCalls, 0);
  assert.equal(body.stats.triangles, 0);
  assert.equal(body.stats.balls, 0);
  assert.equal(body.stats.lift, 0);
  assert.equal(body.object.children[0]?.visible, false);

  body.pose(REFERENCE_POSE, ALIVE, 1 / 60);
  assert.ok(body.stats.drawCalls > 0, 'reset 不是 dispose：同一个身体下一场要能直接再用');
  body.dispose();
});

test('encounter reset: 点场收起旧拖影，下一场仍可用同一批 GPU 对象', () => {
  const body = createSwarmBody({ count: 32 });
  body.pose(REFERENCE_POSE, ALIVE, 1 / 60);
  assert.ok(body.stats.drawCalls > 0, '前提：reset 前点场真的画过');

  body.reset();
  assert.equal(body.stats.drawCalls, 0);
  assert.equal(body.stats.triangles, 0);
  assert.equal(body.stats.lift, 0);
  assert.equal(body.object.children[0]?.visible, false);

  body.pose(REFERENCE_POSE, ALIVE, 1 / 60);
  assert.ok(body.stats.drawCalls > 0, 'reset 后第一副骨架要重新灌满历史环并出画');
  body.dispose();
});

test('encounter reset: 自然离场和成功换源只调用同一个完整清零点', () => {
  assert.ok(RESET, 'main.ts 没有唯一 resetEncounter 接线点');
  assert.match(MAIN, /if \(arcState\.justReset\) resetEncounter\('absence'\)/,
    '自然离场又另写了一份清零清单');
  assert.match(MAIN, /if \(kindChanged\) resetEncounter\('capture-change'\)/,
    '成功换输入源没有走同一个 encounter 边界');

  for (const required of [
    'presence.reset()', 'arc.reset()', 'poseClock.reset()', 'framer.reset()', 'stage.resetShotIdentity()',
    'motion.reset()', 'boneEnergy.reset()', 'evolution.reset()', 'stabilizer.reset()',
    'refiner?.reset()', 'vitality.reset()', 'groundSense.reset()', 'swapGate.reset()',
    'slow.reset()', 'visits.reset()', 'people.tracker.reset()', 'people.bodies.reset()',
    'lastFeatures = null', 'lastSkeleton = null', 'lastBase = null', 'body.reset?.()',
    'theseus?.reset(seed)', 'intent = intentFromFlags(flags)',
  ]) assert.ok(RESET.includes(required), `完整清零漏了：${required}`);

  assert.doesNotMatch(RESET, /governor\.reset|warmPlan\.reset|disabled\.clear/,
    '机器级能力 / 失败闸不属于某一位观众，不能跟着清');
});

test('encounter reset: 换源只有在新一路 start 成功并提交之后才清，失败保持旧场', () => {
  const SWAP = MAIN.match(/const swapCapture = async[^]*?\n  };\n\n  \/\/ 摄像头中途断了/)?.[0] ?? '';
  assert.ok(SWAP, '找不到 swapCapture');
  const started = SWAP.indexOf('await next.start()');
  const committed = SWAP.indexOf('capture = next');
  const reset = SWAP.indexOf("resetEncounter('capture-change')");
  assert.ok(started >= 0 && committed > started && reset > committed,
    'reset 必须在新采集 start 成功并成为当前采集之后提交');
  assert.match(SWAP, /catch \(e\)[^]*return false;/,
    'create / start reject 仍会把失败抛出并打断当前 encounter');
  assert.match(SWAP, /try \{ capture\.stop\(\); \} catch/,
    '旧采集 stop 抛错会挡住已经成功的新采集');
});

test('encounter reset: 会话随机只从注入 Rng 续种，固定 seed 跨场仍可复现', () => {
  assert.doesNotMatch(MAIN, /Math\.random\(/, 'main.ts 还在换人时摇裸骰子');
  assert.match(MAIN, /const nextEncounterSeed = \(\): number => flags\.seed \?\?[^]*encounterSeeds\.next\(\)/,
    '固定 URL seed 或注入 Rng 没有成为唯一会话种子来源');
  assert.match(RESET, /encounterRng = mulberry32\(seed\)/,
    'seed 换了但 World.rng 还留在上一位观众');
});
