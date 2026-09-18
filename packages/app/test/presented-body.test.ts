import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';

import { shiftSkeleton } from '../../core/src/people.ts';
import type { Presence, Skeleton } from '../../core/src/types.ts';
import { ACTS, createDirector, type World } from '../src/acts/index.ts';
import type { BodyInstance } from '../src/creature/body.ts';
import { createPresentedBody } from '../src/creature/presented-body.ts';
import { contactPoints, REFERENCE_POSE } from '../src/stage/framing.ts';

const ALIVE: Presence = { state: 'ALIVE', elapsed: 1, transition: 1 };

function target(opts: {
  throwOn?: number;
  reset?: () => void;
  setArc?: (progress: number) => void;
} = {}): BodyInstance & { poses: Skeleton[]; disposed: number } {
  let calls = 0;
  const poses: Skeleton[] = [];
  const body = {
    object: new THREE.Group(),
    stats: { triangles: 7, drawCalls: 2 },
    poses,
    disposed: 0,
    pose(sk: Skeleton) {
      calls += 1;
      if (calls === opts.throwOn) throw new Error('pose failed');
      poses.push(sk);
    },
    ...(opts.reset ? { reset: opts.reset } : {}),
    ...(opts.setArc ? { setArc: opts.setArc } : {}),
    dispose() { body.disposed += 1; },
  };
  return body;
}

test('呈现回执：成功后保存精确骨架引用，object / stats / dispose 原样代理', () => {
  const raw = target();
  const shown = createPresentedBody(raw);
  assert.equal(shown.skeleton, null);
  assert.equal(shown.body.object, raw.object);
  assert.equal(shown.body.stats, raw.stats);

  shown.body.pose(REFERENCE_POSE, ALIVE, 1 / 60);
  assert.equal(shown.skeleton, REFERENCE_POSE);
  assert.equal(raw.poses[0], REFERENCE_POSE);
  shown.body.dispose();
  assert.equal(raw.disposed, 1);
});

test('呈现回执：stats 保留原身体的动态 getter，不冻结初始身体统计', () => {
  const human = { triangles: 7, drawCalls: 2 };
  const species = { triangles: 19, drawCalls: 4 };
  let active = human;
  const raw = target();
  Object.defineProperty(raw, 'stats', { get: () => active });
  const shown = createPresentedBody(raw);

  assert.equal(shown.body.stats, human);
  active = species;
  assert.equal(shown.body.stats, species);
});

test('呈现回执：后一次 pose 抛错时保留 last-good，并把异常交给 Director guard', () => {
  const raw = target({ throwOn: 2 });
  const shown = createPresentedBody(raw);
  const first = shiftSkeleton(REFERENCE_POSE, 0.1);
  const failed = shiftSkeleton(REFERENCE_POSE, 0.2);
  shown.body.pose(first, ALIVE, 1 / 60);
  assert.throws(() => shown.body.pose(failed, ALIVE, 1 / 60), /pose failed/);
  assert.equal(shown.skeleton, first);
  assert.deepEqual(raw.poses, [first]);
});

test('呈现回执：reset 先清回执，再按原能力代理一次', () => {
  let resets = 0;
  const raw = target({ reset: () => { resets += 1; } });
  const shown = createPresentedBody(raw);
  shown.body.pose(REFERENCE_POSE, ALIVE, 1 / 60);
  shown.body.reset?.();
  assert.equal(shown.skeleton, null);
  assert.equal(resets, 1);

  const stateless = createPresentedBody(target());
  stateless.body.pose(REFERENCE_POSE, ALIVE, 1 / 60);
  assert.doesNotThrow(() => stateless.body.reset?.());
  assert.equal(stateless.skeleton, null);
});

test('呈现回执：setArc 只在原身体拥有时存在', () => {
  const progress: number[] = [];
  const withArc = createPresentedBody(target({ setArc: (x) => { progress.push(x); } }));
  const withoutArc = createPresentedBody(target());
  assert.equal(typeof withArc.body.setArc, 'function');
  assert.equal(withoutArc.body.setArc, undefined);
  withArc.body.setArc?.(0.4);
  assert.deepEqual(progress, [0.4]);
});

test('呈现回执：Director 的 facing 输出与人类输入分开，接触点读取输出才与画面一致', () => {
  const input = shiftSkeleton(REFERENCE_POSE, 0.3);
  const shown = createPresentedBody(target());
  const world = {
    t: 0,
    presence: ALIVE,
    arc: { actId: 'facing', overall: 1 },
    skeleton: input,
    features: null,
    evolution: { charge: 0, tier: 0, tierChanged: false, progress: 0 },
    genome: null,
    creature: shown.body,
    stage: {}, library: {}, capture: {}, flags: { debug: false }, intent: {},
    rng: { next: () => 0.5, weighted: <T>(xs: readonly T[]) => xs[0] },
    morph() {}, note() {},
  } as unknown as World;
  const director = createDirector(ACTS);
  assert.equal(director.force('facing', world), true);
  director.update(world, 1 / 60);

  assert.ok(shown.skeleton);
  assert.notEqual(shown.skeleton, input, 'Director 没有真的产出另一副骨架');
  assert.notDeepEqual(contactPoints(shown.skeleton), contactPoints(input),
    '非对称 facing 的输入 / 输出接触点竟然相同，这条夹具量不到接线错误');
});
