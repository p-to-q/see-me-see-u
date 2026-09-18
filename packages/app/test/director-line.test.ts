/**
 * 动作线的所有权：历史属于一位 Director / 一场相遇，不属于模块。
 * 这里故意让两个 Director 在同一个进程、同一时刻交错跑；共享单例时第二位会吃到第一位的手势。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pointOf } from '../../core/src/line.ts';
import type { ArcState } from '../../core/src/arc.ts';
import type { Skeleton, Vec3 } from '../../core/src/types.ts';
import { ACTS, createDirector, type World } from '../src/acts/index.ts';
import { echo } from '../src/acts/echo.ts';
import { NO_INTENT } from '../src/shell/intent.ts';
import { REFERENCE_POSE } from '../src/stage/framing.ts';

const dt = 1 / 60;
const gap = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function pose(dx: number, t: number): Skeleton {
  const joints: Record<string, Vec3> = {};
  for (const key in REFERENCE_POSE.joints) joints[key] = [...REFERENCE_POSE.joints[key]];
  joints.wristR[0] += dx;
  joints.handTipR[0] += dx;
  return { ...REFERENCE_POSE, joints, t };
}

function shiftedPose(dx: number, t: number): Skeleton {
  const joints: Record<string, Vec3> = {};
  for (const key in REFERENCE_POSE.joints) {
    const p = REFERENCE_POSE.joints[key];
    joints[key] = [p[0] + dx, p[1], p[2]];
  }
  const bones = REFERENCE_POSE.bones.map((bone) => ({
    ...bone,
    p0: [bone.p0[0] + dx, bone.p0[1], bone.p0[2]] as Vec3,
    p1: [bone.p1[0] + dx, bone.p1[1], bone.p1[2]] as Vec3,
  }));
  return { ...REFERENCE_POSE, joints, bones, t };
}

function echoArc(): ArcState {
  return {
    movement: 1,
    actId: 'echo',
    progress: 0.5,
    overall: pointOf(1),
    elapsed: 62.5,
    timeToNext: 22.5,
    movementChanged: false,
    held: false,
    running: true,
    tier: 1,
    away: 0,
    justReset: false,
  };
}

type MutableWorld = World & { t: number; skeleton: Skeleton };

function rig(initial: Skeleton): { world: MutableWorld; posed: () => Skeleton | null } {
  let latest: Skeleton | null = null;
  const world = {
    t: initial.t,
    presence: { state: 'ALIVE' as const, elapsed: 60, transition: 1 },
    arc: echoArc(),
    skeleton: initial,
    features: { speed: 0.8, energy: 0.4, expansiveness: 0.5, verticality: 0, symmetry: 0, jerk: 0, stillness: 0 },
    evolution: { charge: 0, tier: 1 as const, tierChanged: false, progress: 0.5 },
    genome: null,
    creature: { pose: (sk: Skeleton) => { latest = sk; } },
    stage: {}, library: {}, capture: {},
    flags: { debug: false }, intent: NO_INTENT,
    rng: { next: () => 0.5, weighted: <T>(xs: readonly T[]) => xs[0] },
    morph() {}, note() {},
  } as unknown as MutableWorld;
  return { world, posed: () => latest };
}

function warm(director: ReturnType<typeof createDirector>, world: MutableWorld): void {
  for (let i = 0; i < 120; i++) {
    world.t = i * dt;
    world.skeleton = pose(0, world.t);
    director.update(world, dt);
  }
}

function expectLive(actual: Skeleton | null, live: Skeleton, why: string): void {
  assert.ok(actual, `${why}：没有 pose`);
  assert.ok(gap(actual.joints.wristR, live.joints.wristR) < 1e-9, `${why}：混入了旧手腕方向`);
  assert.ok(gap(actual.joints.pelvis, live.joints.pelvis) < 1e-9, `${why}：主体不是当前帧`);
}

test('line runtime: 两个 Director 同进程交错运行，历史互不污染', () => {
  const a = rig(pose(0, 0));
  const b = rig(pose(0.35, 2));
  const directorA = createDirector(ACTS);
  const directorB = createDirector(ACTS);
  warm(directorA, a.world);

  directorB.update(b.world, dt);
  expectLive(b.posed(), b.world.skeleton, '第二个 Director 的第一帧');

  a.world.t = 2;
  a.world.skeleton = pose(0.2, 2);
  directorA.update(a.world, dt);
  assert.ok(gap(a.posed()!.joints.wristR, a.world.skeleton.joints.wristR) > 0.01,
    '第一位自己的历史也被第二个 Director 清掉了');
});

test('untether runtime: 两个 Director 各自保留交还时的身体与相位', () => {
  const a = rig(shiftedPose(0, 0));
  const b = rig(shiftedPose(2, 0));
  const directorA = createDirector(ACTS);
  const directorB = createDirector(ACTS);

  assert.equal(directorA.force('untether', a.world), true);
  for (let i = 0; i < 90; i++) directorA.update(a.world, dt);
  assert.equal(directorB.force('untether', b.world), true);
  directorB.update(b.world, dt);

  // B 的 enter 若覆盖了模块全局 base，A 下一帧会从 x≈0 跳到 x≈2。
  directorA.update(a.world, dt);
  const pelvisA = a.posed()?.joints.pelvis;
  const pelvisB = b.posed()?.joints.pelvis;
  assert.ok(pelvisA && Math.abs(pelvisA[0]) < 0.2, `A 被 B 串位到 x=${pelvisA?.[0]}`);
  assert.ok(pelvisB && Math.abs(pelvisB[0] - 2) < 0.2, `B 没守住自己的基准 x=${pelvisB?.[0]}`);
  assert.ok(pelvisA && pelvisB && Math.abs(pelvisA[0] - (pelvisB[0] - 2)) > 0.01,
    'A 已运行 1.5 秒、B 才一帧，两者却共享了同一相位');

  // 坏 dt 走有限 fallback，不把帧循环送进 NaN / Infinity。
  directorB.update(b.world, Number.NaN);
  for (const p of Object.values(b.posed()!.joints)) {
    assert.ok(p.every(Number.isFinite), `坏 dt 产生非有限关节 ${p}`);
  }
});

test('line runtime: resetTemporal 后下一位第一帧只有自己的姿态', () => {
  const r = rig(pose(0, 0));
  const director = createDirector(ACTS);
  warm(director, r.world);
  director.resetTemporal();
  r.world.t = 2;
  r.world.skeleton = pose(0.35, 2);
  director.update(r.world, dt);
  expectLive(r.posed(), r.world.skeleton, 'reset 后');
});

test('line runtime: 交还身体再拿回来，不回放交还之前的手势', () => {
  const r = rig(pose(0, 0));
  const director = createDirector(ACTS);
  warm(director, r.world);
  assert.equal(director.force('untether', r.world), true);
  director.release(r.world);
  r.world.t = 2;
  r.world.skeleton = pose(0.35, 2);
  director.update(r.world, dt);
  expectLive(r.posed(), r.world.skeleton, 'untether 往返后');
});

test('line runtime: Act 脱离 Director 单独运行时逐字回 live', () => {
  const r = rig(pose(0.35, 2));
  echo.update(r.world, dt);
  expectLive(r.posed(), r.world.skeleton, '缺少 runtime 的降级');
});
