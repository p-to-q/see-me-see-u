/**
 * 主身体交接不是一场新 encounter：弧线与 seed 继续，但所有“上一帧是谁”的状态必须断开。
 * 这里一半跑真实状态机，一半守 main.ts 的唯一接线点；避免只验证清单、没验证 reset 后的首帧。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBoneEnergy, createMotion } from '../../core/src/motion.ts';
import type { Skeleton, Vec3 } from '../../core/src/types.ts';
import { REFERENCE_POSE } from '../src/stage/framing.ts';
import { createGroundSense } from '../src/sound/ground.ts';

const MAIN = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
const RESET = MAIN.match(/const resetPrimaryTemporal = \(resetPipes:[^]*?\n  };\n/)?.[0] ?? '';

const moved = (dx: number): Skeleton => {
  const joints = { ...REFERENCE_POSE.joints } as Record<string, Vec3>;
  const wrist = joints.wristL ?? [0, 0, 0];
  const hand = joints.handTipL ?? wrist;
  joints.wristL = [wrist[0] + dx, wrist[1], wrist[2]];
  joints.handTipL = [hand[0] + dx, hand[1], hand[2]];
  return { ...REFERENCE_POSE, joints };
};

test('主身份交接：运动与逐骨能量的首帧重新立基准，不把空间差误报成动作', () => {
  const motion = createMotion();
  const bones = createBoneEnergy();
  const a = moved(0);
  const b = moved(0.7);

  motion.update(a, 1 / 30);
  const before = motion.update(b, 1 / 30);
  bones.update(a, 1 / 30);
  const boneBefore = bones.update(b, 1 / 30);
  assert.ok(before.energy > 0, '前提：交接前确实积出了运动能量');
  assert.ok(Object.keys(boneBefore).length > 0, '前提：交接前确实积出了逐骨能量');

  motion.reset();
  bones.reset();
  const first = motion.update(a, 1 / 30);
  const boneFirst = bones.update(a, 1 / 30);
  assert.equal(first.speed, 0);
  assert.equal(first.energy, 0);
  assert.equal(first.jerk, 0);
  assert.deepEqual(boneFirst, {});
});

test('主身份交接：触地判据把接班人的第一帧当基准，不凭空响一记', () => {
  const ground = createGroundSense();
  const twoFeet = [[0.1, 0, 0.01], [-0.1, 0, 0.01]] as const;
  const oneFoot = [[-0.1, 0, 0.01]] as const;
  ground.update(twoFeet, 1 / 60);
  ground.update(oneFoot, 1 / 60);
  assert.equal(ground.update(twoFeet, 1), true, '前提：reset 前落脚会触发');
  ground.reset();
  assert.equal(ground.update(twoFeet, 1 / 60), false, '接班第一帧只立基准');
});

test('主身份交接：main 在换 id 与 reacquired 两条边界调用同一份完整清理', () => {
  assert.ok(RESET, 'main.ts 没有主身份时间状态的唯一清理点');
  for (const required of [
    'director.resetTemporal()', 'poseClock.reset()', 'motion.reset()', 'boneEnergy.reset()', 'framer.reset()',
    'framing = decide(framingPolicy, framer.current)', 'legHold = 0',
    'lateral = resetLateralIdentity(lateral)', 'groundSense.reset()',
    'stage.resetShotIdentity()', 'lastFeatures = null',
  ]) assert.ok(RESET.includes(required), `主身份清理漏了：${required}`);

  assert.match(MAIN, /people\.primary = crowd\.primary;[^]*?if \(crowd\.primary !== null\) resetPrimaryTemporal\(false\)/,
    '换成另一个主 id 没有在接管后清掉主通道时间状态');
  assert.match(MAIN, /else if \(primaryReacquired\) \{[^]*?resetPrimaryTemporal\(true\)/,
    '同一 id 失联后认回没有清掉跨空窗的滤波状态');
  assert.doesNotMatch(RESET, /arc\.reset|evolution\.reset|theseus.*reset|seed\s*=/,
    '主身份交接不是新 encounter，不该重启会话弧线、演化、忒修斯或 seed');
});
