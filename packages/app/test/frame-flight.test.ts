/** worker 帧超时后的所有权：旧回执不许释放新帧。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CAPTURE } from '../../core/src/tuning.ts';
import {
  frameFlightTimedOut, ownsFrameFlight, settleFrameFlight, type FrameFlight,
} from '../src/capture/frame-flight.ts';

const SOURCE = readFileSync(fileURLToPath(new URL('../src/capture/webcam.ts', import.meta.url)), 'utf8');

test('旧帧 A 超时、新帧 B 在途：A 迟到不能释放 B', () => {
  let flight: FrameFlight = 10;
  assert.equal(frameFlightTimedOut(flight, 100, 100 + CAPTURE.workerFrameTimeoutMs - 1, CAPTURE.workerFrameTimeoutMs), false);
  assert.equal(frameFlightTimedOut(flight, 100, 100 + CAPTURE.workerFrameTimeoutMs, CAPTURE.workerFrameTimeoutMs), true);

  flight = null; // A 被宣告丢弃
  flight = 20;   // B 已发出
  assert.equal(ownsFrameFlight(flight, 10), false);
  assert.equal(settleFrameFlight(flight, 10), 20, 'A 的迟到回执误清了 B');
  assert.equal(settleFrameFlight(flight, 20), null, 'B 自己回来却没有收口');
});

test('坏时间 / 坏 stamp 不得穿透超时门或释放帧', () => {
  assert.equal(frameFlightTimedOut(1, 0, Number.NaN, 2000), false);
  assert.equal(frameFlightTimedOut(1, 0, 3000, Number.NaN), false);
  assert.equal(frameFlightTimedOut(null, 0, 3000, 2000), false);
  assert.equal(ownsFrameFlight(1, Number.NaN), false);
  assert.equal(settleFrameFlight(1, Number.NaN), 1);
});

test('WebcamCapture 两条发送路径和 pose/fail 回执都按 stamp 结算', () => {
  assert.match(SOURCE, /#inFlight: FrameFlight = null/);
  assert.match(SOURCE, /frameFlightTimedOut\(this\.#inFlight, this\.#sentAt, now, CAPTURE\.workerFrameTimeoutMs\)/);
  assert.match(SOURCE, /createImageBitmap\(this\.video\)[^]*!ownsFrameFlight\(this\.#inFlight, stamp\)/);
  assert.match(SOURCE, /m\.type === 'pose'[^]*ownsFrameFlight\(this\.#inFlight, m\.stamp\)[^]*settleFrameFlight\(this\.#inFlight, m\.stamp\)/);
  assert.match(SOURCE, /m\.type === 'fail'[^]*Number\.isFinite\(m\.stamp\)[^]*ownsFrameFlight\(this\.#inFlight, m\.stamp\)/);
  assert.match(SOURCE, /frameFlightTimedOut\([^]*engine\.retire\([^]*this\.#reacquire\(\)[^]*return/,
    '超时后还在向同一个堵塞 worker 排新帧');
  assert.doesNotMatch(SOURCE, /#inFlight\s*=\s*(?:true|false)/);
});
