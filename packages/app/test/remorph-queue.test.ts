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

test('替换事务：容量满时不改 genome、不驱逐在途交接', { skip: !index }, () => {
  const library = fakeLibrary(index!);
  const creature = createCreature({ library, shading: 'toon', replaceSlots: 0 });
  const from = makeGenome(11, 1 as Tier, index!, { theme: 'porcelain' });
  const to = makeGenome(11, 2 as Tier, index!, { theme: 'porcelain' });
  creature.remorph(from);
  creature.pose(REFERENCE_POSE, ALIVE, 0);
  creature.remorph(to);
  creature.pose(REFERENCE_POSE, ALIVE, 0);
  assert.equal(creature.stats.swapsActive, 2, '夹具没有填满描边交接容量');

  const slot = 'handL' as const;
  const before = creature.genome!.slots[slot];
  const other = index!.parts.find((part) => part.slot === 'hand' && part.id !== before.partId)!;
  const rejected = creature.replace(slot, { partId: other.id, materialRole: before.materialRole }, {
    profile: 'terminal-release', result: 'transform',
  });
  assert.equal(rejected, null);
  assert.deepEqual(creature.genome!.slots[slot], before, 'renderer 拒绝后 genome 已经偷偷提交');
  assert.equal(creature.stats.swapsActive, 2, '新请求驱逐了原有 active swap');

  creature.dispose();
  library.dispose();
});

test('脱离事务：两脚不并发、结构段独占全部交接，主身份切换只撤位移不删事件', { skip: !index }, () => {
  const library = fakeLibrary(index!);
  const creature = createCreature({ library, shading: 'toon', replaceSlots: 1 });
  const genome = makeGenome(11, 2 as Tier, index!, { theme: 'porcelain' });
  creature.remorph(genome);
  creature.pose(REFERENCE_POSE, ALIVE, 0);
  const alternate = (slot: 'footL' | 'footR' | 'spine' | 'handL') => {
    const current = creature.genome!.slots[slot];
    const kind = slot.startsWith('foot') ? 'foot' : slot.startsWith('hand') ? 'hand' : 'spine';
    const part = index!.parts.find((candidate) => candidate.slot === kind && candidate.id !== current.partId)!;
    return { partId: part.id, materialRole: current.materialRole };
  };
  const terminal = { profile: 'terminal-release', result: 'transform' } as const;
  const firstFoot = creature.replace('footL', alternate('footL'), terminal)!;
  assert.equal(firstFoot.applied.profile, 'terminal-release');
  assert.equal(creature.isDetached('footL'), true);
  const secondFoot = creature.replace('footR', alternate('footR'), terminal)!;
  assert.deepEqual([secondFoot.applied.profile, secondFoot.reason], ['in-place', 'detachment-conflict']);
  const activeBeforeHandoff = creature.stats.swapsActive;
  creature.settleDetachment();
  assert.equal(creature.isDetached('footL'), false, '主身份交接后旧脚还在新人的 socket 上脱离');
  assert.equal(creature.stats.swapsActive, activeBeforeHandoff,
    '主身份交接直接删掉半程事件，会让零件从半空/半尺寸跳成满尺寸目标件');

  for (let i = 0; i < 100; i++) creature.pose(REFERENCE_POSE, ALIVE, 1 / 60);

  const plainHand = creature.replace('handL', alternate('handL'))!;
  assert.equal(plainHand.applied.profile, 'in-place');
  const blockedCore = creature.replace('spine', alternate('spine'), { profile: 'core-release', result: 'transform' })!;
  assert.deepEqual([blockedCore.applied.profile, blockedCore.reason], ['in-place', 'detachment-conflict'],
    '普通交接还在播时 core 仍然开始脱离');
  for (let i = 0; i < 100; i++) creature.pose(REFERENCE_POSE, ALIVE, 1 / 60);

  const core = creature.replace('spine', alternate('spine'), { profile: 'core-release', result: 'transform' })!;
  assert.equal(core.applied.profile, 'core-release');
  const handBefore = creature.genome!.slots.handL;
  assert.equal(creature.replace('handL', alternate('handL'), terminal), null,
    'core 回接前另一件仍能抢进同一构图');
  assert.deepEqual(creature.genome!.slots.handL, handBefore, '被结构段拒绝的事件仍提前改了 genome');

  const queuedTarget = makeGenome(29, 2 as Tier, index!, { theme: 'porcelain' });
  creature.remorph(queuedTarget);
  creature.pose(REFERENCE_POSE, ALIVE, 0);
  assert.equal(creature.stats.swapsActive, 1, 'core 脱离期间 remorph 队列开始抢画面');
  assert.ok(creature.stats.swapsQueued > 0, 'core 脱离期间普通交接没有留在队列');

  creature.dispose();
  library.dispose();
});
