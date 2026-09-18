/** 花 credits 的 `/__slow` 端点只能在本机、显式的现场宿主上出现。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { isLoopbackAddress, shouldServeSlow } from '../build/slow-host.ts';

test('slow host: 只认 socket loopback，不把局域网或通配绑定当本机', () => {
  for (const address of ['127.0.0.1', '127.31.4.9', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
    assert.equal(isLoopbackAddress(address), true, address);
  }
  for (const address of [undefined, '', 'localhost', '0.0.0.0', '::', '192.168.1.8', '::ffff:192.168.1.8']) {
    assert.equal(isLoopbackAddress(address), false, String(address));
  }
});

test('slow host: dev 本机可用；preview 必须精确写 SLOW_ENABLE=1', () => {
  assert.equal(shouldServeSlow('dev', '127.0.0.1', {}), true);
  assert.equal(shouldServeSlow('preview', '127.0.0.1', {}), false);
  assert.equal(shouldServeSlow('preview', '127.0.0.1', { SLOW_ENABLE: 'true' }), false);
  assert.equal(shouldServeSlow('preview', '127.0.0.1', { SLOW_ENABLE: '1' }), true);
  assert.equal(shouldServeSlow('dev', '192.168.1.8', { SLOW_ENABLE: '1' }), false);
  assert.equal(shouldServeSlow('preview', '192.168.1.8', { SLOW_ENABLE: '1' }), false);
});

test('slow host: 标准 kiosk 开慢回路且只绑 loopback，fake 入口明确不烧额度', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.kiosk, /SLOW_ENABLE=1/);
  assert.match(pkg.scripts.kiosk, /--host 127\.0\.0\.1/);
  assert.doesNotMatch(pkg.scripts.kiosk, /SLOW_FAKE=1/);
  assert.match(pkg.scripts['kiosk:fake'], /SLOW_ENABLE=1/);
  assert.match(pkg.scripts['kiosk:fake'], /SLOW_FAKE=1/);
  assert.match(pkg.scripts['kiosk:fake'], /--host 127\.0\.0\.1/);
});
