/**
 * 摄像头平滑度探针不能把自己的压力模式冒充观众环境（docs/48 §10.6）。
 * 这里守的是仪器口径，不是应用行为。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('swap 与 deeplink 两条入口都带上 QUERY，固定种子的 A/B 才是真的同一场', () => {
  assert.match(probe, /url: `\$\{base\}\/\?debug=1\$\{QUERY\}`/);
  assert.match(probe, /url: `\$\{base\}\/\?theme=porcelain&debug=1\$\{QUERY\}`/);
});

test('冷缓存探针使用系统临时目录，并在退出时清掉 Chrome profile', () => {
  assert.match(probe, /mkdtempSync\(join\(tmpdir\(\), 'smu-capture-'\)\)/);
  assert.match(probe, /process\.once\('exit',/);
  assert.match(probe, /if \(transientProfile\) rmSync\(profile, \{ recursive: true, force: true \}\)/);
});
