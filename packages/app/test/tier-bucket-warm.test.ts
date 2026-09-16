/**
 * 升档桶的画外准备守三件很具体的事：
 *  1. 一帧只暴露一个桶，绝不把整具未来身体塞进同一帧；
 *  2. 正式升档采用的必须是已经走过真实 render 的**同一个 Mesh 对象**；
 *  3. 排在换装队尾的未来桶即使等过普通空闲 TTL，也不能在上场前被回收。
 *
 * 这里不造 renderer。WebGPU 管线是否被编译由浏览器实测证明；这个单测守住让缓存
 * 命中的前提（对象身份和生命周期），免得一次看似无害的池化重构把修复静默抹掉。
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

const fillMeshes = (object: THREE.Object3D) => object.children.filter(
  (child): child is THREE.InstancedMesh => (child as THREE.InstancedMesh).isInstancedMesh
    && !child.name.endsWith('~outline'),
);

test('未来档位准备: 每次只暴露一个桶，正式 pose 复用同一个 Mesh', { skip: !index }, () => {
  const library = fakeLibrary(index!);
  const creature = createCreature({ library, shading: 'physical' });
  const genome = makeGenome(7, 1 as Tier, index!, { theme: 'porcelain' });
  const plan = creature.prepareBuckets(genome, REFERENCE_POSE);
  let first: THREE.InstancedMesh | null = null;
  let buckets = 0;

  while (plan.next()) {
    const visible = fillMeshes(creature.object).filter((mesh) => mesh.visible && mesh.count > 0);
    assert.equal(visible.length, 1, '一帧只能提交一个未来桶');
    first ??= visible[0]!;
    buckets++;
    plan.park();
    assert.equal(fillMeshes(creature.object).filter((mesh) => mesh.visible).length, 0, 'park 后不能留下画外桶');
  }
  assert.ok(first && buckets > 1, '测试身体至少要覆盖两个桶');
  assert.equal(plan.done, true);

  creature.remorph(genome);
  creature.pose(REFERENCE_POSE, ALIVE, 1 / 60);
  assert.ok(first.visible && first.count > 0, '正式成型没有采用已经预备的 Mesh 对象');
  assert.ok(creature.object.children.includes(first), '预备 Mesh 被替换成了另一个对象');

  creature.dispose();
  library.dispose();
});

test('未来档位准备: 队尾桶跨过空闲 TTL 仍保留到真正采用', { skip: !index }, () => {
  const library = fakeLibrary(index!);
  const creature = createCreature({ library, shading: 'physical' });
  const tier1 = makeGenome(7, 1 as Tier, index!, { theme: 'porcelain' });
  const tier3 = makeGenome(7, 3 as Tier, index!, { theme: 'porcelain' });
  const plan = creature.prepareBuckets(tier3, REFERENCE_POSE);
  while (plan.next()) plan.park();

  creature.remorph(tier1);
  creature.pose(REFERENCE_POSE, ALIVE, 1 / 60);
  const future = fillMeshes(creature.object).filter((mesh) => !mesh.visible);
  assert.ok(future.length > 0, '测试数据里没有 tier 3 独有桶');

  // creature 的普通空桶 TTL 是 180 帧；多等一截，确认保留不是恰好卡在边界。
  for (let i = 0; i < 240; i++) creature.pose(REFERENCE_POSE, ALIVE, 1 / 60);
  for (const mesh of future) {
    assert.ok(creature.object.children.includes(mesh), `${mesh.name} 在目标档位上场前被 TTL 回收`);
  }

  creature.remorph(tier3);
  for (let i = 0; i < 600; i++) creature.pose(REFERENCE_POSE, ALIVE, 1 / 60);
  assert.ok(future.some((mesh) => mesh.visible && mesh.count > 0), '预备的未来桶最终没有被正式档位采用');

  creature.dispose();
  library.dispose();
});

test('未来档位准备: 取消后解除保留，未采用的桶仍走原有 TTL', { skip: !index }, () => {
  const library = fakeLibrary(index!);
  const creature = createCreature({ library, shading: 'physical' });
  const tier1 = makeGenome(7, 1 as Tier, index!, { theme: 'porcelain' });
  const tier3 = makeGenome(7, 3 as Tier, index!, { theme: 'porcelain' });
  const plan = creature.prepareBuckets(tier3, REFERENCE_POSE);
  while (plan.next()) plan.park();
  creature.remorph(tier1);
  creature.pose(REFERENCE_POSE, ALIVE, 1 / 60);
  const unused = fillMeshes(creature.object).filter((mesh) => !mesh.visible);
  assert.ok(unused.length > 0);

  creature.clearPreparedBuckets();
  for (let i = 0; i < 240; i++) creature.pose(REFERENCE_POSE, ALIVE, 1 / 60);
  assert.ok(unused.every((mesh) => !creature.object.children.includes(mesh)), '取消后未来桶没有按 TTL 回收');

  creature.dispose();
  library.dispose();
});
