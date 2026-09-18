/**
 * 忒修斯替换那一下（`docs/44-THESEUS.md` §4 / §7）在 app 这一侧要守的东西：
 *
 *  1. **graft 的长度 ≤ `minGap`** —— 否则两次替换叠在一起（§10.5 记过：两个数原来相等）。
 *  2. **描边不断** —— 这一格在任何一刻都至少有一件 ≥ 0.8 倍大小的实体撑着轮廓。
 *  3. **碎开一次 draw call 都不加** —— 墨屑和旧件同一个桶；实例数不越 `maxInstances`。
 *  4. 真 `parts.json` + 真 `curation.json` + 花名册 clearance：一场走完，
 *     被否掉的件、被 clearance 挡掉的家族一件都没被借上身，晚期不借回自己的件。
 *  5. 替换音和碎开是同一帧（读源码：`main.ts` 拉不起来）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  coreScale, crossfadeRenders, detachmentDisplacement, detachmentEnvelope, envelope, graftCurve, REPLACE_SECONDS,
  replaceRenders, resolveDetachmentPlan, shardAt,
} from '../src/creature/replace-event.ts';
import { IN_PLACE_DETACHMENT, type DetachmentPlan } from '../src/creature/detachment.ts';
import { assemble, JOINT_CAPS, type SlotRender } from '../src/creature/assemble.ts';
import { swapOneSlot } from '../src/creature/theseus-wire.ts';
import { REFERENCE_POSE } from '../src/stage/framing.ts';
import { ROSTER, isPublic } from '../../factory/recipes/roster.ts';
import { makeGenome } from '../../core/src/genome.ts';
import { girthOutliers } from '../../core/src/girth.ts';
import { createTheseus } from '../../core/src/theseus.ts';
import { createArc } from '../../core/src/arc.ts';
import { IS_LEFT } from '../../core/src/slots.ts';
import { ARC, BUDGET, MORPH, THESEUS } from '../../core/src/tuning.ts';
import type { Genome, PartLibraryIndex, PartMeta, SlotKey, Tier } from '../../core/src/types.ts';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
let index: PartLibraryIndex | null = null;
let rejected = new Set<string>();
try {
  index = JSON.parse(read('../../../assets/parts/parts.json')) as PartLibraryIndex;
  const cur = JSON.parse(read('../../../assets/parts/curation.json')) as Record<string, { verdict: string }>;
  rejected = new Set(Object.entries(cur).filter(([, v]) => v.verdict === 'reject').map(([k]) => k));
} catch { index = null; }

// ── 1 ────────────────────────────────────────────────────────────────────────
test('theseus 事件: graft 的组装动画不长于 minGap —— 两次替换不叠', () => {
  assert.equal(REPLACE_SECONDS, MORPH.crossfade, '替换那一下的长度必须就是 graft 的长度，不另立一个数');
  assert.ok(REPLACE_SECONDS <= THESEUS.minGap,
    `graft ${REPLACE_SECONDS}s > minGap ${THESEUS.minGap}s：上一件还在装，下一件已经开始碎`);
});

// ── 2 ────────────────────────────────────────────────────────────────────────
test('theseus 事件: 描边不断 —— 任何一刻都有一件 ≥ 0.8 倍的实体撑着轮廓', () => {
  let min = 1;
  let at = 0;
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000;
    const e = envelope(t);
    if (e < min) { min = e; at = t; }
  }
  assert.ok(min >= 0.8, `t=${at.toFixed(3)} 时这一格最大的实体只有 ${min.toFixed(3)} 倍 —— 轮廓在那一刻塌了`);
  // 开头是旧件、结尾是新件，墨屑在事件结束前散完
  assert.equal(coreScale(0), 1);
  assert.equal(coreScale(1), 0);
  assert.equal(graftCurve(1).scale, 1);
  assert.equal(graftCurve(1).offset, 0);
  assert.ok(shardAt(Math.min(1, THESEUS.shardLife)).scale <= 1e-3, '墨屑在 shardLife 之后还在');
  // 碎开是真的发生了：事件前段确实有墨屑离开骨轴
  const mid = replaceRenders('foreArmL', { partId: 'old', materialRole: 'secondary' },
    { partId: 'new', materialRole: 'secondary' }, 0.25);
  const shards = mid.filter((r) => r.partId === 'old' && (r.lateral ?? 0) > 0.02);
  assert.equal(shards.length, THESEUS.shards, 't=0.25 时应当有墨屑正在散开');
});

test('theseus 事件: 缺省替换与 remorph/graft 都在插座上发生，坏进度也有限', () => {
  const from = { partId: 'old', materialRole: 'secondary' as const };
  const to = { partId: 'new', materialRole: 'secondary' as const };
  for (const key of ['footL', 'handR', 'spine', 'joint'] as SlotKey[]) {
    for (const t of [0, 0.25, 0.5, 0.75, 1, Number.NaN, Infinity, -Infinity]) {
      const list = replaceRenders(key, from, to, t);
      const incoming = list.filter((r) => r.partId === to.partId);
      if (t === 1) assert.ok(incoming.length > 0, `${key} 结束时没有新件`);
      for (const r of list) assert.ok(Number.isFinite(r.scale), `${key} t=${String(t)} 产生了非有限 scale`);
      for (const r of incoming) {
        assert.equal(r.offset ?? 0, 0, `${key} t=${String(t)} 仍从插座外飞入`);
      }
      for (const r of crossfadeRenders(key, from, to, t)) {
        assert.equal(r.offset ?? 0, 0, `${key} remorph/graft t=${String(t)} 仍从插座外飞入`);
      }
    }
  }
});

test('theseus 事件: 全槽位 profile 只离开再回接，错误 profile 在渲染边界降级', () => {
  const from = { partId: 'old', materialRole: 'secondary' as const };
  const to = { partId: 'new', materialRole: 'secondary' as const };
  const terminal = { profile: 'terminal-release', result: 'transform' } as const;
  const segment = { profile: 'segment-release', result: 'transform' } as const;
  const core = { profile: 'core-release', result: 'transform' } as const;
  const incoming = (key: SlotKey, t: number, plan: DetachmentPlan = terminal) =>
    replaceRenders(key, from, to, t, 1, plan).find((r) => r.partId === to.partId)!;

  for (const [key, plan] of [['handR', terminal], ['footL', terminal], ['foreArmL', segment], ['spine', core]] as const) {
    assert.equal(incoming(key, 0, plan).along ?? 0, 0, `${key} 起点没有接在 socket`);
    assert.equal(incoming(key, 1, plan).along ?? 0, 0, `${key} 终点没有接回 socket`);
    assert.ok((incoming(key, 0.5, plan).along ?? 0) > 0, `${key} 根本没有离开`);
    assert.ok((incoming(key, 0.5, plan).lift ?? 0) > 0, `${key} 没有离地弧线`);
  }
  assert.equal(incoming('handL', 0.5, IN_PLACE_DETACHMENT).along ?? 0, 0, '原位手被 release 污染');
  assert.equal(resolveDetachmentPlan('spine', terminal).profile, 'in-place', '错误 profile 从渲染边界漏进来了');
  assert.equal(resolveDetachmentPlan('joint', core).profile, 'in-place', '没有点名 cap 的 joint 计划漏进来了');
  const regular = replaceRenders('handR', from, to, 0.5);
  const released = replaceRenders('handR', from, to, 0.5, 1, terminal);
  assert.deepEqual(released.map((r) => r.partId), regular.map((r) => r.partId),
    'release 改了桶或实例集合，draw / 面数预算不再等价');

  for (const t of [Number.NaN, Infinity, -Infinity]) {
    for (const r of replaceRenders('handR', from, to, t, 1, terminal)) {
      assert.ok(Number.isFinite(r.scale), `t=${String(t)} 产生非有限 scale`);
      assert.ok(Number.isFinite(r.along ?? 0), `t=${String(t)} 产生非有限 along`);
      assert.ok(Number.isFinite(r.lift ?? 0), `t=${String(t)} 产生非有限 lift`);
    }
  }
});

test('theseus 事件: 单个 joint cap 脱离，其余 12 处保持原位', () => {
  const from = { partId: 'old', materialRole: 'secondary' as const };
  const to = { partId: 'new', materialRole: 'secondary' as const };
  const member = 'shoulderL';
  const index = JOINT_CAPS.findIndex((cap) => cap.joint === member);
  assert.ok(index >= 0);
  const t = (index + THESEUS.jointWave / 2) / (JOINT_CAPS.length - 1 + THESEUS.jointWave);
  const renders = replaceRenders('joint', from, to, t, 1, {
    profile: 'segment-release', result: 'transform', member,
  });
  const moved = renders.filter((r) => (r.offset ?? 0) > 0 || (r.lift ?? 0) > 0);
  assert.ok(moved.length > 0, '目标 cap 没有离开');
  for (const r of moved) assert.deepEqual(r.caps, [index, index + 1], '别的 cap 跟着一起脱离');
});

test('theseus 事件: 全 profile 与既有 1.2 秒事件共用时钟，15/30/60/120Hz 都按时回接', () => {
  for (const hz of [15, 30, 60, 120]) {
    const frames = Math.ceil(REPLACE_SECONDS * hz);
    let peak = 0;
    for (let frame = 0; frame < frames; frame++) {
      peak = Math.max(peak, detachmentEnvelope(frame / (REPLACE_SECONDS * hz)));
    }
    const elapsed = frames / hz;
    assert.ok(elapsed >= REPLACE_SECONDS && elapsed < REPLACE_SECONDS + 1 / hz + 1e-12,
      `${hz}Hz 在 ${elapsed}s 才结束`);
    assert.ok(Math.abs(peak - detachmentEnvelope(0.5)) < 1e-12, `${hz}Hz 没走到同一个峰值`);
    assert.equal(detachmentEnvelope(frames / (REPLACE_SECONDS * hz)), 0, `${hz}Hz 结束时没接回去`);
    for (const [key, plan] of [
      ['handL', { profile: 'terminal-release', result: 'transform' }],
      ['foreArmL', { profile: 'segment-release', result: 'transform' }],
      ['spine', { profile: 'core-release', result: 'transform' }],
    ] as const) {
      assert.equal(detachmentDisplacement(key, frames / (REPLACE_SECONDS * hz), plan).along, 0, `${hz}Hz ${key} 没回 socket`);
    }
  }
});

// ── 3 ────────────────────────────────────────────────────────────────────────
function bucketsAndInstances(g: Genome, render: Partial<Record<SlotKey, SlotRender[]>>) {
  const byId = new Map(index!.parts.map((p) => [p.id, p]));
  const src = { metaOf: (id: string): PartMeta => byId.get(id)! };
  const inst = assemble(g, REFERENCE_POSE, src, { render, maxInstances: Infinity });
  const b = new Set<string>();
  for (const i of inst) {
    const mirrored = IS_LEFT[i.slotKey as keyof typeof IS_LEFT] === true && byId.get(i.partId)!.symmetry === 'mirror';
    b.add(`${i.partId}|${mirrored}|${i.materialRole}`);
  }
  return { buckets: b.size, instances: inst.length };
}

test('theseus 事件: 碎开不加 draw call，实例数不越上限（最坏的是关节那一格）', { skip: !index }, () => {
  const g = makeGenome(11, 2, index!, { theme: 'porcelain', rejected });
  const base = bucketsAndInstances(g, {});
  for (const slot of ['joint', 'foreArmL', 'spine', 'head'] as SlotKey[]) {
    const other = index!.parts.find((p) => p.slot === g.slots[slot].partId.split('.')[0] && p.id !== g.slots[slot].partId
      && !rejected.has(p.id) && p.tier <= 2)!;
    assert.ok(other, `${slot} 找不到可换的件`);
    let worstB = 0;
    let worstI = 0;
    for (let i = 0; i <= 20; i++) {
      const r = replaceRenders(slot, g.slots[slot], { partId: other.id, materialRole: g.slots[slot].materialRole }, i / 20);
      const c = bucketsAndInstances(g, { [slot]: r });
      worstB = Math.max(worstB, c.buckets);
      worstI = Math.max(worstI, c.instances);
    }
    assert.ok(worstB <= base.buckets + 1, `${slot} 替换时桶数 ${worstB}，基准 ${base.buckets} —— 墨屑多开了桶`);
    // 描边模式每桶两次提交
    assert.ok(2 * worstB <= BUDGET.maxDrawCalls, `${slot} 替换时 ${2 * worstB} draw > ${BUDGET.maxDrawCalls}`);
    assert.ok(worstI <= BUDGET.maxInstances, `${slot} 替换时 ${worstI} 实例 > ${BUDGET.maxInstances}：会把别的件挤掉`);
  }
});

// ── 4 ────────────────────────────────────────────────────────────────────────
test('theseus 借件（真数据）: 否掉的件、clearance 挡掉的家族一件都不上身；晚期不借回自己的件',
  { skip: !index }, () => {
    const withheld = new Set(ROSTER.filter((e) => !isPublic(e)).map((e) => e.id));
    assert.ok(withheld.size > 0, '花名册里没有被 clearance 挡掉的条目 —— 这条测试什么都没证明');
    // 把被挡掉的家族的件**塞回**索引：模拟"件漏进了 parts.json、条目没进 themes"那个缺口
    const leaky: PartLibraryIndex = structuredClone(index!);
    for (const fam of withheld) {
      for (const p of index!.parts.filter((q) => q.family === 'porcelain')) leaky.parts.push({ ...p, id: p.id.replace('porcelain', fam), family: fam });
    }
    const DT = 1 / 20;
    const themes = leaky.themes.map((t) => t.id);
    // girth 越界件（docs/26 §H，和 check:parts 同一份定义）：借给别的物种一次都不许
    const outOfBand = new Map(girthOutliers(leaky.parts).map((o) => [o.part.id, o.part.family]));
    assert.ok([...outOfBand.keys()].some((id) => !rejected.has(id)),
      '真数据里没有一件"越界且没被否掉"的件 —— 这条规矩在真数据上什么都没证明');
    let lateOwn = 0;
    let events = 0;
    for (let s = 0; s < 60; s++) {
      const theme = themes[s % themes.length];
      const seed = (s * 2654435761) >>> 0;
      const arc = createArc();
      const th = createTheseus({ seed });
      let g = makeGenome(seed, 2, leaky, { theme, rejected });
      for (let i = 0; i < Math.round(ARC.total / DT); i++) {
        const a = arc.update(true, DT);
        const st = th.update({ elapsed: a.elapsed, present: true }, DT);
        if (!st.fired) continue;
        const next = swapOneSlot(g, st.fired.slot, (seed ^ Math.imul(st.fired.index, 0x9e3779b9)) >>> 0, {
          tier: Math.max(1, a.tier) as Tier, index: leaky, rejected, overall: a.overall,
          onChoice: (c) => {
            events++;
            assert.ok(!rejected.has(c.pick.partId), `借到了策展否掉的 ${c.pick.partId}`);
            assert.ok(!withheld.has(c.meta.family), `借到了 clearance 挡掉的 ${c.pick.partId}`);
            const fam = outOfBand.get(c.pick.partId);
            assert.ok(fam === undefined || fam === theme,
              `${theme} 借到了 girth 越界的 ${c.pick.partId}（只该留给 ${fam} 自己用）`);
            if (a.overall >= THESEUS.borrowCurve[1] && c.meta.family === theme) lateOwn++;
          },
        });
        if (next) g = next;
      }
    }
    assert.ok(events > 1000, `只借了 ${events} 次`);
    assert.equal(lateOwn, 0, `overall ≥ ${THESEUS.borrowCurve[1]} 之后借回了自己的件 ${lateOwn} 次`);
  });

// ── 5 ────────────────────────────────────────────────────────────────────────
test('theseus 事件: 碎开和替换音是同一帧 —— replace 当帧开始、不排队', () => {
  const main = read('../src/main.ts');
  const block = main.slice(main.indexOf('const requested = planDetachment'), main.indexOf('── 分档'));
  const iReplace = block.indexOf('creature.replace(');
  const iSound = block.indexOf('sound.tierUp(');
  assert.ok(iReplace >= 0, '替换那一段不再调 creature.replace() —— 又退回交叉淡入了');
  assert.ok(iSound > iReplace, '替换音不在 creature.replace() 之后的同一段里');
  assert.ok(!block.includes('creature.remorph('), '替换那一段还在走 remorph（交叉淡入）');
  const creature = read('../src/creature/creature.ts');
  const body = creature.slice(creature.indexOf('    replace(slot, pick, requested'), creature.indexOf('    setShading(id)'));
  assert.ok(body.includes('active.set('), 'replace() 没有当帧进 active');
  assert.ok(!body.includes('enqueue('), 'replace() 走了队列：队列满时画面会晚于那一声');
});
