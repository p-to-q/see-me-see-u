/**
 * 摄像头平滑度探针不能把自己的压力模式冒充观众环境（docs/48 §10.6）。
 * 这里守的是仪器口径，不是应用行为。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAMERA_EXIT_SELECTOR, normaliseQuery, parseGovernorSchedule, probeRunManifest, probeUrl,
} from '../../../scripts/capture-smoothness/run-meta.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const probe = readFileSync(resolve(ROOT, 'scripts/capture-smoothness/measure.ts'), 'utf8');

test('平滑度探针默认跟显示器节拍；只有 UNBOUNDED=1 才解锁帧率', () => {
  assert.match(probe, /const unbounded = process\.env\.UNBOUNDED === '1'/);
  assert.match(
    probe,
    /\.\.\.\(unbounded \? \['--disable-gpu-vsync', '--disable-frame-rate-limit'\] : \[\]\)/,
  );
});

test('平滑度探针把产品重载判失败，不把恢复后的第二次启动算成功', () => {
  assert.match(probe, /m\.method === 'Page\.frameNavigated'/);
  assert.match(probe, /writeFileSync\(`\$\{out\}\/reload\.txt`/);
  assert.match(probe, /process\.exit\(4\)/);
});

test('平滑度探针显式接收并检查假摄像头文件，结果记录运行口径与实际 fps', () => {
  assert.match(probe, /process\.env\.VIDEO_FIXTURE/);
  assert.match(probe, /existsSync\(videoFixture\)/);
  assert.match(probe, /writeFileSync\(`\$\{out\}\/run\.json`/);
  assert.match(probe, /measuredRafFps/);
});

test('swap 与 deeplink 两条入口都由同一个 URL 函数保留 QUERY', () => {
  assert.equal(normaliseQuery('?&seed=7&plan=mass'), 'seed=7&plan=mass');
  assert.equal(probeUrl('http://127.0.0.1:4391', 'swap', 'seed=7'), 'http://127.0.0.1:4391/?debug=1&seed=7');
  assert.equal(
    probeUrl('http://127.0.0.1:4391/', 'deeplink', 'seed=7&plan=mass'),
    'http://127.0.0.1:4391/?debug=1&theme=porcelain&seed=7&plan=mass',
  );
  assert.equal(probe.match(/Page\.navigate/g)?.length, 2);
  assert.equal(probe.match(/url: plannedUrl/g)?.length, 2);
});

test('冷缓存探针使用系统临时目录，并在退出时清掉 Chrome profile', () => {
  assert.match(probe, /mkdtempSync\(join\(tmpdir\(\), 'smu-capture-'\)\)/);
  assert.match(probe, /process\.once\('exit',/);
  assert.match(probe, /if \(transientProfile\) rmSync\(profile, \{ recursive: true, force: true \}\)/);
});

test('探针按语义找摄像头，不把“第三行”当成产品契约', () => {
  const exits = readFileSync(resolve(ROOT, 'packages/app/src/ui/exits.ts'), 'utf8');
  assert.equal(CAMERA_EXIT_SELECTOR, '.sb-exits .sb-exit[data-action="camera"]');
  assert.match(exits, /row\('camera', C\.camera, C\.cameraOff\)/);
  assert.match(probe, /matches\.length/);
  assert.match(probe, /process\.exit\(5\)/);
  assert.doesNotMatch(probe, /querySelectorAll\('\.sb-exits \.sb-exit'\)\[2\]/);
});

test('GOV_AT 拒绝错字，不把 NaN 在 0ms 当成一场有效实验', () => {
  assert.deepEqual(parseGovernorSchedule('20:4,26.5:5,34:0'), [
    { atSeconds: 20, level: 4 }, { atSeconds: 26.5, level: 5 }, { atSeconds: 34, level: 0 },
  ]);
  assert.throws(() => parseGovernorSchedule('twenty:4'), /invalid GOV_AT/);
  assert.throws(() => parseGovernorSchedule('20:8'), /invalid GOV_AT/);
});

test('run.json 的自描述足以区分两场实验', () => {
  const base = {
    source: { commit: 'abc123', dirty: false },
    target: {
      baseUrl: 'http://127.0.0.1:4391', mode: 'swap' as const, query: 'seed=7',
      plannedUrl: 'http://127.0.0.1:4391/?debug=1&seed=7', finalUrl: 'http://127.0.0.1:4391/?debug=1&seed=7',
    },
    browser: { product: 'Chrome/152', userAgent: 'Chrome', headed: false },
    workload: { videoFixture: '/tmp/figure.y4m', recordSeconds: 45 },
    cache: { warmProfile: true, disabledByByteProbe: false },
    emulation: {
      cadence: 'display' as const,
      viewport: { width: 1280, height: 800, requestedDpr: null, actualDpr: 2 },
      cpuThrottle: 1,
      network: { preset: 'native' as const, latencyMs: 0, downloadBytesPerSecond: 0, uploadBytesPerSecond: 0 },
    },
    actions: { noClick: false, hover: false, hoverMs: null, governorSchedule: [] },
    measurement: { measuredRafFps: 60, maxRafGapMs: 16.8, rafSamples: 2700 },
  };
  const a = probeRunManifest(base) as any;
  const b = probeRunManifest({
    ...base,
    target: { ...base.target, query: 'seed=8', finalUrl: 'http://127.0.0.1:4391/?debug=1&seed=8' },
    emulation: { ...base.emulation, cpuThrottle: 4 },
  }) as any;
  assert.equal(a.schemaVersion, 1);
  assert.notDeepEqual(a, b);
  assert.deepEqual(a.source, { commit: 'abc123', dirty: false });
  assert.equal(a.target.finalUrl, base.target.finalUrl);
  assert.equal(a.cache.warmProfile, true);
  assert.equal(b.emulation.cpuThrottle, 4);
});

test('Chrome 还没开就失败时，invocation.json 也已经留下来历', () => {
  const out = mkdtempSync(resolve(tmpdir(), 'smu-probe-meta-'));
  try {
    const run = spawnSync(process.execPath, [
      resolve(ROOT, 'scripts/capture-smoothness/measure.ts'),
      'http://127.0.0.1:4391', out, 'swap', '1', '1', '0',
    ], {
      cwd: ROOT,
      env: { ...process.env, VIDEO_FIXTURE: resolve(out, 'missing.y4m'), QUERY: 'seed=99&plan=mass', DPR: '3' },
      encoding: 'utf8',
    });
    assert.equal(run.status, 1);
    const invocation = JSON.parse(readFileSync(resolve(out, 'invocation.json'), 'utf8'));
    assert.equal(invocation.schemaVersion, 1);
    assert.equal(invocation.target.query, 'seed=99&plan=mass');
    assert.equal(invocation.emulation.requestedDpr, 3);
    assert.equal(typeof invocation.source.dirty, 'boolean');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
