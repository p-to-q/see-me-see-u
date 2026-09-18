import test from 'node:test';
import assert from 'node:assert/strict';
import { groundSkeleton, remapSkeleton } from '../src/bodyplan.ts';
import { BONES, buildSkeleton } from '../src/skeleton.ts';
import { VITALITY } from '../src/tuning.ts';
import { createVitality } from '../src/vitality.ts';
import type { Skeleton, Vec3 } from '../src/types.ts';

const POSE: Record<string, Vec3> = {
  pelvis: [0, 0.95, 0], chest: [0, 1.35, 0], neck: [0, 1.45, 0], headCenter: [0, 1.60, 0],
  shoulderL: [0.19, 1.38, 0], elbowL: [0.33, 1.10, 0.02], wristL: [0.44, 0.86, 0.04], handTipL: [0.48, 0.77, 0.05],
  shoulderR: [-0.19, 1.38, 0], elbowR: [-0.33, 1.10, 0.02], wristR: [-0.44, 0.86, 0.04], handTipR: [-0.48, 0.77, 0.05],
  hipL: [0.09, 0.93, 0], kneeL: [0.10, 0.51, 0.01], ankleL: [0.10, 0.09, 0], footIdxL: [0.10, 0.03, 0.16],
  hipR: [-0.09, 0.93, 0], kneeR: [-0.10, 0.51, 0.01], ankleR: [-0.10, 0.09, 0], footIdxR: [-0.10, 0.03, 0.16],
};

const sk = (over: Record<string, Vec3> = {}, t = 0): Skeleton => buildSkeleton({ ...POSE, ...over }, [], t);
const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const moved = (): Skeleton => sk({
  elbowL: [0.55, 1.25, 0.10], wristL: [0.78, 1.31, 0.22],
  elbowR: [-0.49, 1.22, 0.08], wristR: [-0.68, 1.35, 0.18],
}, 1);

function assertFiniteSkeleton(value: Skeleton): void {
  for (const key in value.joints) {
    assert.ok(value.joints[key].every(Number.isFinite), `${key} contains a non-finite coordinate`);
  }
  for (const bone of value.bones) {
    assert.ok(bone.p0.every(Number.isFinite) && bone.p1.every(Number.isFinite), `${bone.id} has a non-finite endpoint`);
    assert.ok(Number.isFinite(bone.length), `${bone.id} has a non-finite length`);
  }
}

test('carrier joints are live; only wrist and hand directions retain follow-through', () => {
  const vitality = createVitality();
  const base = sk();
  vitality.apply(base, 1 / 60);
  const target = moved();
  const out = vitality.apply(target, 1 / 60);

  for (const key of Object.keys(target.joints)) {
    if (key === 'wristL' || key === 'handTipL' || key === 'wristR' || key === 'handTipR') continue;
    assert.ok(distance(out.joints[key], target.joints[key]) < 1e-12, `${key} must use the current frame`);
  }
  assert.ok(distance(out.joints.wristL, target.joints.wristL) > 1e-3, 'the wrist must retain visible local follow-through');
  assert.ok(distance(out.joints.wristL, base.joints.wristL) > 1e-3, 'the wrist must respond on the first display frame');
});

test('reconstructed bones remain connected and keep current-frame lengths', () => {
  const vitality = createVitality();
  vitality.apply(sk(), 1 / 60);
  const target = moved();
  const out = vitality.apply(target, 1 / 60);

  for (const [id, a, b] of BONES) {
    const bone = out.bones.find((candidate) => candidate.id === id)!;
    const wanted = target.bones.find((candidate) => candidate.id === id)!;
    assert.ok(distance(bone.p0, out.joints[a]) < 1e-12, `${id}.p0 detached from ${a}`);
    assert.ok(distance(bone.p1, out.joints[b]) < 1e-12, `${id}.p1 detached from ${b}`);
    assert.ok(Math.abs(bone.length - distance(bone.p0, bone.p1)) < 1e-12, `${id}.length disagrees with its endpoints`);
    assert.ok(Math.abs(bone.length - wanted.length) < 1e-9, `${id} changed current-frame length`);
  }
});

test('static input has zero autonomous joint motion for 200 seconds', () => {
  const vitality = createVitality();
  const still = sk();
  let maximum = 0;
  for (let frame = 0; frame < 200 * 60; frame++) {
    const out = vitality.apply(still, 1 / 60);
    for (const key in still.joints) maximum = Math.max(maximum, distance(out.joints[key], still.joints[key]));
  }
  assert.ok(maximum < 1e-12, `static joints moved ${(maximum * 1000).toFixed(6)}mm`);
});

test('follow-through settles after the visitor stops', () => {
  const vitality = createVitality();
  const still = sk();
  vitality.apply(still, 1 / 60);
  vitality.apply(moved(), 1 / 60);
  let out = still;
  for (let frame = 0; frame < 2 * 60; frame++) out = vitality.apply(still, 1 / 60);
  assert.ok(distance(out.joints.wristL, still.joints.wristL) < 1e-4);
  assert.ok(distance(out.joints.handTipL, still.joints.handTipL) < 1e-4);
});

for (const hz of [15, 30, 60, 120]) {
  test(`${hz}Hz: first-frame response and fixed-time convergence remain intact`, () => {
    const vitality = createVitality();
    const base = sk();
    const target = moved();
    vitality.apply(base, 1 / hz);
    let out = vitality.apply(target, 1 / hz);
    assert.ok(distance(out.joints.elbowL, target.joints.elbowL) < 1e-12, 'elbow carrier is not live');
    assert.ok(distance(out.joints.wristL, base.joints.wristL) > 1e-3, 'wrist did not react on the first frame');
    for (let frame = 1; frame < hz * 2; frame++) out = vitality.apply(target, 1 / hz);
    assert.ok(distance(out.joints.wristL, target.joints.wristL) < 1e-4, 'wrist did not converge in two seconds');
  });
}

test('reset prevents the next visitor from inheriting arm history', () => {
  const vitality = createVitality();
  vitality.apply(sk(), 1 / 60);
  vitality.apply(moved(), 1 / 60);
  vitality.reset();
  const next = sk({ elbowL: [0.20, 1.24, -0.1], wristL: [-0.02, 1.38, -0.24] }, 2);
  const out = vitality.apply(next, 1 / 60);
  for (const key in next.joints) assert.ok(distance(out.joints[key], next.joints[key]) < 1e-12, `${key} inherited prior history`);
});

test('bad dt values do not throw or produce non-finite output', () => {
  const vitality = createVitality();
  vitality.apply(sk(), 1 / 60);
  for (const dt of [0, -1, Number.NaN, Infinity, 1]) assertFiniteSkeleton(vitality.apply(moved(), dt));
});

test('a bad joint freezes the previous safe frame instead of pulling a limb to the origin', () => {
  const vitality = createVitality();
  const previous = vitality.apply(sk(), 1 / 60);
  const valid = moved();
  const bad: Skeleton = { ...valid, joints: { ...valid.joints, wristL: [Number.NaN, 1, 0] } };
  const out = vitality.apply(bad, 1 / 60);
  assert.equal(out, previous);
  assertFiniteSkeleton(out);
});

test('a first bad frame recovers from finite bone endpoints', () => {
  const vitality = createVitality();
  const valid = moved();
  const bad: Skeleton = { ...valid, joints: { ...valid.joints, wristL: [Number.NaN, Number.NaN, Number.NaN] } };
  const out = vitality.apply(bad, 1 / 60);
  const forearm = valid.bones.find((bone) => bone.id === 'foreArmL')!;
  assertFiniteSkeleton(out);
  assert.ok(distance(out.joints.wristL, forearm.p1) < 1e-12, 'did not recover the joint from its bone endpoint');
  assert.ok(distance(out.joints.wristL, [0, 0, 0]) > 0.1, 'bad chain collapsed to the world origin');
});

test('input is never mutated', () => {
  const vitality = createVitality();
  const input = sk();
  const before = JSON.stringify(input);
  vitality.apply(input, 1 / 60);
  vitality.apply(moved(), 1 / 60);
  assert.equal(JSON.stringify(input), before);
});

for (const plan of ['rig', 'inverted', 'radial'] as const) {
  test(`${plan}: a static, already-grounded body is not moved`, () => {
    const vitality = createVitality();
    const planned = remapSkeleton(sk(), plan);
    for (let frame = 0; frame < 120; frame++) {
      const out = vitality.apply(planned, 1 / 60);
      for (const key in planned.joints) assert.ok(distance(out.joints[key], planned.joints[key]) < 1e-12, `${key} moved`);
    }
  });
}

for (const plan of ['inverted', 'radial'] as const) {
  test(`${plan}: final grounding contains local follow-through`, () => {
    const vitality = createVitality();
    vitality.apply(remapSkeleton(sk(), plan), 1 / 60);
    const lively = vitality.apply(remapSkeleton(moved(), plan), 1 / 60);
    const out = groundSkeleton(lively, plan);
    const lowest = Math.min(...Object.values(out.joints).map((point) => point[1]));
    assert.ok(Math.abs(lowest) < 1e-9, `lowest joint is at ${lowest.toFixed(6)}m`);
    assertFiniteSkeleton(out);
  });
}

test('disabled mode returns the exact input object', () => {
  const enabled = VITALITY.enabled;
  try {
    (VITALITY as { enabled: boolean }).enabled = false;
    const input = sk();
    assert.equal(createVitality().apply(input, 1 / 60), input);
  } finally {
    (VITALITY as { enabled: boolean }).enabled = enabled;
  }
});
