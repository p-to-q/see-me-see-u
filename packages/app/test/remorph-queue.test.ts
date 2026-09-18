/**
 * 全身 remorph 一次会改十来个槽位，但画面同时只允许两个交接。
 * 这条回归量的是真正提交给 three 的实例桶：排队不是“已经变完”。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import { makeGenome } from '../../core/src/genome.ts';
import type { PartLibraryIndex, PartMeta, Presence, Tier } from '../../core/src/types.ts';
import { createCreature } from '../src/creature/creature.ts';
import type { PartLibrary } from '../src/assets/library.ts';
import { REFERENCE_POSE } from '../src/stage/framing.ts';

const PARTS = fileURLToPath(new URL('../../../assets/parts/parts.json', import.meta.url));
let index: PartLibraryIndex | null = null;
try { index = JSON.parse(readFileSync(PARTS, 'utf8')) as PartLibraryIndex; } catch { index = null; }

const ALIVE: Presence = { state: 'ALIVE', elapsed: 999, transition: 1 };

function fakeLibrary(idx: PartLibraryIndex): PartLibrary {
  const byId = new Map(idx.parts.map((p) => [p.id, p]));
  const geometry = new THREE.BoxGeometry(0.2, 1, 0.2);
  const fallback: PartMeta = {
    id: 'placeholder:spine', file: '', slot: 'spine', tier: 0, family: 'placeholder',
    localGirth: 0.2, triCount: 12,
    aabb: { min: [-0.1, 0, -0.1], max: [0.1, 1, 0.1] }, symmetry: 'none',
  };
  return {
    async load() {},
    index: idx,
    geometry: () => geometry,
    mirrored: () => geometry,
    usingFallback: false,
    rejected: new Set(),
    metaOf: (id) => byId.get(id) ?? { ...fallback, id },
    isLoaded: () => true,
    async preload() {},
    prefetch() {},
    onGeometry: () => () => undefined,
    register(meta) { byId.set(meta.id, meta); },
    async loadUrl() { return geometry; },
    stats: { loaded: idx.parts.length, failed: 0, pending: 0, queued: 0 },
    dispose() { geometry.dispose(); },
  };
}

function countPart(root: THREE.Object3D, partId: string): number {
  let count = 0;
  for (const child of root.children) {
    if (!(child as THREE.InstancedMesh).isInstancedMesh || child.name.endsWith('~outline')) continue;
    if (child.name.startsWith(`${partId}#`) || child.name.startsWith(`${partId}~m#`)) {
      count += (child as THREE.InstancedMesh).count;
    }
  }
  return count;
}

test('remorph 排队：未激活槽位保持旧件，不会新→旧→新闪回', { skip: !index }, (t) => {
  const library = fakeLibrary(index!);
  const creature = createCreature({ library, shading: 'toon' });
  const from = makeGenome(11, 1 as Tier, index!, { theme: 'porcelain' });
  const to = makeGenome(11, 2 as Tier, index!, { theme: 'porcelain' });
  const changed = Object.keys(to.slots).filter((key) =>
    from.slots[key as keyof typeof from.slots]?.partId !== to.slots[key as keyof typeof to.slots]?.partId,
  ) as (keyof typeof to.slots)[];
  assert.equal(changed.length, 11, '真夹具必须同时改 11 个槽位，否则没有压到队列');

  creature.remorph(from);
  creature.pose(REFERENCE_POSE, ALIVE, 0);
  creature.remorph(to);
  creature.pose(REFERENCE_POSE, ALIVE, 0);

  t.diagnostic(`active=${creature.stats.swapsActive} queued=${creature.stats.swapsQueued}`);
  assert.equal(creature.stats.swapsActive, 2, '默认描边预算应只让两个槽位同时交接');
  assert.equal(creature.stats.swapsQueued, 9, '夹具应有九个槽位正在排队');

  for (const key of changed) {
    const oldPick = from.slots[key];
    const nextPick = to.slots[key];
    assert.ok(oldPick && nextPick);
    assert.ok(countPart(creature.object, oldPick.partId) > 0, `${String(key)} 的旧件在它轮到前消失了`);
    assert.equal(countPart(creature.object, nextPick.partId), 0,
      `${String(key)} 的新件在排队阶段就闪现了`);
  }

  for (let frame = 0; frame < 600; frame++) creature.pose(REFERENCE_POSE, ALIVE, 1 / 60);
  assert.equal(creature.stats.swapsActive, 0);
  assert.equal(creature.stats.swapsQueued, 0);
  for (const key of changed) {
    const nextPick = to.slots[key];
    assert.ok(nextPick && countPart(creature.object, nextPick.partId) > 0,
      `${String(key)} 走完队列后没有落到目标件`);
  }

  creature.dispose();
  library.dispose();
});
