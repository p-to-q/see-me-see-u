import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAIN = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');

test('呈现回执接线：Director 写包装身体，舞台在它之后读取同一份输出', () => {
  const wrapped = MAIN.indexOf('const presented = createPresentedBody(body)');
  const world = MAIN.indexOf('creature: presented.body');
  const director = MAIN.indexOf('director.update(world');
  const reset = MAIN.indexOf("if (arcState.justReset) resetEncounter('absence')");
  const receipt = MAIN.indexOf('const shown = presented.skeleton', reset);
  const contacts = MAIN.indexOf('contactPoints(shown', receipt);
  const stage = MAIN.indexOf('stage.frame(shown, contacts)', contacts);

  assert.ok(wrapped >= 0 && world > wrapped, 'World 没有把 Director 接到回执包装器');
  assert.ok(director >= 0 && reset > director && receipt > reset,
    '呈现回执必须在 Director 和 encounter reset 之后读取');
  assert.ok(contacts > receipt && stage > contacts, '接触点与舞台没有消费同一个 presented skeleton');
  assert.equal(MAIN.includes('stage.frame(lastSkeleton'), false,
    '舞台重新读回了 Director 变化前的人类输入');
});

test('呈现回执接线：交接旧身体、HUD 与 reset 都不绕过包装器', () => {
  assert.match(MAIN, /\.retire\([^;]+presented\.skeleton/s,
    '主身份交接冻结的不是上一帧真正呈现的身体');
  assert.match(MAIN, /primarySkeleton:\s*brief\(shown\)/,
    '调试取证仍在报告 Director 之前的骨架');
  assert.match(MAIN, /presented\.body\.reset\?\.\(\)[\s\S]+presented\.body\.pose\(REFERENCE_POSE/,
    'encounter reset 没有清回执并提交新的参考姿态');
});
