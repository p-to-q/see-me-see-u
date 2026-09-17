/** 自动人数的浏览器验收必须真的跑 auto、两条推理路径和正常显示节拍。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = resolve(ROOT, 'scripts/people/accept.ts');
const source = readFileSync(SCRIPT, 'utf8');

test('自动人数验收用同一份假摄像头串行跑 worker 与主线程降级', () => {
  assert.match(source, /for \(const mode of \['worker', 'main'\] as const\)/);
  assert.match(source, /if \(mode === 'main'\) url\.searchParams\.set\('worker', 'off'\)/);
  assert.match(source, /people: 'auto'/);
  assert.match(source, /--use-file-for-fake-video-capture=/);
  assert.match(source, /--use-fake-device-for-media-stream/);
  assert.doesNotMatch(source, /--disable-gpu-vsync|--disable-frame-rate-limit/);
});

test('验收观察真实阶段、推理频率与单人身份，不把一张截图叫通过', () => {
  assert.match(source, /probe:\(idle\|probing\)/);
  assert.match(source, /infer@\(worker\|main\)/);
  assert.match(source, /idle→probing/);
  assert.match(source, /probe is materially cheaper/);
  assert.match(source, /confirmed cap remains one/);
  assert.match(source, /one stable primary id/);
  assert.match(source, /one visible selected track/);
  assert.match(source, /no companion body/);
  assert.match(source, /primary skeleton continuity/);
});

test('验收把重载、停摆、异常和缺证据判成失败，并留下自描述结果', () => {
  assert.match(source, /Page\.frameNavigated/);
  assert.match(source, /navigationBaseline = topLevelNavigations/);
  assert.match(source, /topLevelNavigations > navigationBaseline \+ 1/);
  assert.match(source, /expected one initial navigation/);
  assert.match(source, /unexpected top-level reload/);
  assert.match(source, /rAF stalled for/);
  assert.match(source, /Runtime\.exceptionThrown/);
  assert.match(source, /invocation\.json/);
  assert.match(source, /worker\.json|`\$\{mode\}\.json`/);
  assert.match(source, /summary\.json/);
  assert.match(source, /process\.exitCode = reports\.every/);
});

test('Chrome profile 与端口不污染仓库，也不靠百格随机端口碰运气', () => {
  assert.match(source, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(source, /mkdtempSync\(join\(tmpdir\(\), `smu-people-/);
  assert.match(source, /--remote-debugging-port=0/);
  assert.match(source, /DevToolsActivePort/);
  assert.match(source, /rmSync\(profile, \{ recursive: true, force: true \}\)/);
  assert.match(source, /activeProfiles\.add\(profile\)/);
  assert.match(source, /for \(const profile of activeProfiles\) rmSync/);
  assert.match(source, /process\.once\(signal, \(\) => \{ void cleanupAndExit\(\); \}\)/);
  assert.doesNotMatch(source, /Math\.random\(\)/);
});

test('CDP 的连接与每条命令都有上限，不会绕过总时限永久挂住', () => {
  assert.match(source, /CDP_OPEN_TIMEOUT_MS = 10_000/);
  assert.match(source, /CDP_COMMAND_TIMEOUT_MS = 10_000/);
  assert.match(source, /CDP \$\{method\} timed out after/);
  assert.match(source, /clearTimeout\(waiter\.timer\)/);
  assert.match(source, /AbortSignal\.timeout\(1_000\)/);
});

test('帧率通过条件写成有容差的档位窗口，不冒充精确 30→15→30', () => {
  assert.match(source, /CAPTURE\.targetHz \* 0\.7/);
  assert.match(source, /PEOPLE\.probeInferenceHz \* 0\.65/);
  assert.match(source, /PEOPLE\.probeInferenceHz \* 1\.25/);
  assert.match(source, /Math\.min\(beforeHz, afterHz\) \* 0\.8/);
});

test('CLI 错参数与缺素材都在启动 Chrome 前明确失败', () => {
  const noArgs = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(noArgs.status, 1);
  assert.match(noArgs.stderr, /usage:/);

  const out = mkdtempSync(resolve(tmpdir(), 'smu-people-accept-test-'));
  try {
    for (const name of ['worker.json', 'main.json', 'summary.json']) {
      writeFileSync(resolve(out, name), '{"pass":true}\n');
    }
    const missing = spawnSync(process.execPath, [
      SCRIPT, 'http://127.0.0.1:4777', out, resolve(out, 'missing.y4m'), '24',
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /missing fake-camera fixture/);
    assert.equal(existsSync(resolve(out, 'worker.json')), false);
    assert.equal(existsSync(resolve(out, 'main.json')), false);
    assert.equal(existsSync(resolve(out, 'summary.json')), false);
    const invocation = JSON.parse(readFileSync(resolve(out, 'invocation.json'), 'utf8'));
    assert.match(invocation.runId, /^\d{8}T\d{9}Z-\d+$/);
    assert.deepEqual(invocation.target.modes, ['worker', 'main']);
    assert.equal(invocation.target.people, 'auto');
    assert.equal(invocation.workload.syntheticSinglePerson, true);
    assert.equal(invocation.browser.cadence, 'display');
    assert.ok(Number.isInteger(invocation.host.logicalCpus));
    assert.ok(Array.isArray(invocation.host.loadAverage));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('目标 URL 保留部署路径，报告用页面与入口脚本哈希绑定实际构建', () => {
  assert.match(source, /const url = new URL\(base\.href\)/);
  assert.doesNotMatch(source, /new URL\('\/', base\)/);
  assert.match(source, /document\.documentElement\.outerHTML/);
  assert.match(source, /\[\.\.\.document\.scripts\]/);
  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /targetArtifact/);
  assert.match(source, /runnerSource/);
});

test('性能验收记录宿主负载，并拒绝把过载机器误报成产品回归', () => {
  assert.match(source, /availableParallelism\(\)/);
  assert.match(source, /loadavg\(\)/);
  assert.match(source, /host too busy for performance acceptance/);
  assert.match(source, /loadPerCpu > 2/);
  assert.doesNotMatch(source, /ALLOW_BUSY|FORCE_BUSY/);
});
