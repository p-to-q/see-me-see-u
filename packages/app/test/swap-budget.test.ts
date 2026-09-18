/**
 * **交接那几帧**不越 `BUDGET`（docs/02 P5）。不要显卡：只读 `parts.json` 里的面数和桶的规则。
 *
 * `outline-budget.test.ts` 守的是稳态的身体。这一条守的是换件的那 1.2 秒 ——
 * 2026-09-14 无头 Chrome 正常速率实测 porcelain **42/40 draw、338k/250k 面**，
 * 而当时所有测试都是绿的：没有一条在数"交接中同时在场的几何"。三处来源各守一条：
 *
 *  1. draw call：每个在交接的槽位多一个桶；上限是 `swapCeiling()`，替换不许叠在上面。
 *  2. 面数（静态最坏）：每一格按本物种这一格最重的件算，一件替换 + 其余名额全给交叉淡入，
 *     挑最贵的那几格。多出来几份几何是**这里自己数的**：把 `replaceRenders` /
 *     `crossfadeRenders` 的输出喂给真的 `assemble()`，数它摆出了几件。
 *  3. 借件（真数据走一整场）：每借一件之后，身体的最坏那一帧仍然放得下。
 *
 * 最坏那一帧的求和**照着规则重写一遍，不 import `swap-budget.ts` 的 `worstFrame`**：
 * 和 `outline-budget.test.ts` / `ground.test.ts` 同一个理由 —— 拿被测代码去验证它自己，
 * 改坏了两边一起变绿。从 `swap-budget.ts` 只拿 `swapCeiling`：那是 `creature.ts` 真正在用的上限，
 * 这里要证明的正是"按这个上限跑，放得下"。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assemble, type SlotRender } from '../src/creature/assemble.ts';
import { crossfadeRenders, replaceRenders } from '../src/creature/replace-event.ts';
import { swapCeiling } from '../src/creature/swap-budget.ts';
import { swapOneSlot } from '../src/creature/theseus-wire.ts';
import { REFERENCE_POSE } from '../src/stage/framing.ts';
import { PLANS_WITHOUT_PARTS, remapSkeleton, type BodyPlanId } from '../../core/src/bodyplan.ts';
import { borrowPools } from '../../core/src/borrow.ts';
import { makeGenome } from '../../core/src/genome.ts';
import { createTheseus } from '../../core/src/theseus.ts';
import { createArc } from '../../core/src/arc.ts';
import { ALL_SLOT_KEYS, IS_LEFT, SLOT_OF_BONE } from '../../core/src/slots.ts';
import { BUDGET } from '../../core/src/tuning.ts';
import type {
  Genome, PartLibraryIndex, PartMeta, Skeleton, Slot, SlotKey, SlotPick, ThemeDef, Tier,
} from '../../core/src/types.ts';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
let index: PartLibraryIndex | null = null;
let rejected = new Set<string>();
try {
  index = JSON.parse(read('../../../assets/parts/parts.json')) as PartLibraryIndex;
  const cur = JSON.parse(read('../../../assets/parts/curation.json')) as Record<string, { verdict: string }>;
  rejected = new Set(Object.entries(cur).filter(([, v]) => v.verdict === 'reject').map(([k]) => k));
} catch { index = null; }

/** 描边每桶两次提交。按描边算：着色语言在现场能被 O 键切过去，预算得按更贵的那一种守 */
const PASSES = 2;
const FILL = BUDGET.maxTriangles / PASSES;

/** 和 `main.ts` 的 `kindOf` 同一条读法 */
const planOf = (t: ThemeDef): string => {
  const p = (t as { bodyPlan?: unknown }).bodyPlan;
  return p == null ? 'rig' : typeof p === 'string' ? p : ((p as { kind?: string }).kind ?? 'rig');
};
const partBuilt = (index?.themes ?? []).filter((t) => !PLANS_WITHOUT_PARTS.includes(planOf(t) as BodyPlanId));

const skeletonOf = (t: ThemeDef): Skeleton => {
  const sk = remapSkeleton(REFERENCE_POSE, planOf(t) as BodyPlanId);
  return { ...REFERENCE_POSE, bones: sk.bones, joints: sk.joints };
};
const slotOfKey = (k: SlotKey): Slot => (k === 'joint' ? 'joint' : SLOT_OF_BONE[k]);

// ── 多出来几份几何：用真的 assemble() 数 ──────────────────────────────────────
const FAKE: PartMeta = {
  id: 'x', slot: 'spine', tier: 1, file: '', family: 'x', localGirth: 1, triCount: 1,
  aabb: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, symmetry: 'none',
};
const fakeLib = { metaOf: (id: string): PartMeta => ({ ...FAKE, id }) };
const OLD: SlotPick = { partId: 'old', materialRole: 'primary' };
const NEW: SlotPick = { partId: 'new', materialRole: 'primary' };
const fakeGenome = (): Genome => ({
  seed: 0, tier: 1, theme: 'x', materials: { primary: 'm', secondary: 'm', accent: 'm' },
  slots: Object.fromEntries(ALL_SLOT_KEYS.map((k) => [k, { ...NEW }])) as Genome['slots'],
} as Genome);

function countOn(sk: Skeleton, key: SlotKey, renders: SlotRender[]): number {
  return assemble(fakeGenome(), sk, fakeLib, { render: { [key]: renders } }).filter((i) => i.slotKey === key).length;
}

/** 这一格交接时最坏那一刻比稳态多摆了几件（t 扫 201 个点） */
function extraOf(sk: Skeleton, kind: 'replace' | 'crossfade', key: SlotKey): { extra: number; steady: number } {
  const steady = countOn(sk, key, [{ ...NEW }]);
  const fn = kind === 'replace' ? replaceRenders : crossfadeRenders;
  let worst = 0;
  for (let i = 0; i <= 200; i++) worst = Math.max(worst, countOn(sk, key, fn(key, OLD, NEW, i / 200)) - steady);
  return { extra: worst, steady };
}

/**
 * 最坏那一帧的填充面数：稳态 + 一件替换 + (上限 − 1) 件交叉淡入；
 * 不替换（`?theseus=off`）时上限全给交叉淡入。两种取大。
 */
/** 事件形状只和骨架有关、和面数无关：每具骨架扫一次（一整场几百次借件共用） */
const shapeMemo = new Map<Skeleton, Map<SlotKey, { steady: number; replace: number; crossfade: number }>>();
function shapeOf(sk: Skeleton) {
  let m = shapeMemo.get(sk);
  if (!m) {
    m = new Map();
    for (const key of ALL_SLOT_KEYS) {
      const r = extraOf(sk, 'replace', key);
      m.set(key, { steady: r.steady, replace: r.extra, crossfade: extraOf(sk, 'crossfade', key).extra });
    }
    shapeMemo.set(sk, m);
  }
  return m;
}

function worstFill(bound: Record<SlotKey, number>, sk: Skeleton, ceiling: number) {
  let steady = 0;
  const rep: { key: SlotKey; cost: number }[] = [];
  const xf: { key: SlotKey; cost: number }[] = [];
  const shape = shapeOf(sk);
  for (const key of ALL_SLOT_KEYS) {
    const s = shape.get(key)!;
    steady += s.steady * bound[key];
    rep.push({ key, cost: s.replace * bound[key] });
    xf.push({ key, cost: s.crossfade * bound[key] });
  }
  xf.sort((a, b) => b.cost - a.cost);
  const top = (n: number, skip?: SlotKey) => xf.filter((x) => x.key !== skip).slice(0, Math.max(0, n));
  let worst = { fill: steady + top(ceiling).reduce((s, x) => s + x.cost, 0), what: `${ceiling} 件交叉淡入` };
  for (const r of rep) {
    const x = top(ceiling - 1, r.key);
    const fill = steady + r.cost + x.reduce((s, y) => s + y.cost, 0);
    if (fill > worst.fill) worst = { fill, what: `替换 ${r.key} + 交叉淡入 ${x.map((y) => y.key).join(',') || '—'}` };
  }
  return { ...worst, steady };
}

/**
 * 升档时每个槽位类型能装上的最重一件：沿 base 链找**第一个有货的那一层**，取那一层里最重的。
 * 照着 `makeGenome` 的逐槽位规则重写，不 import `swap-budget.ts` 的 `ownMaxTris`。
 */
const ownMax = (theme: string): Partial<Record<Slot, number>> => {
  const byTheme = new Map(index!.themes.map((t) => [t.id, t]));
  const chain: string[] = [];
  for (let c: string | undefined = theme; c && !chain.includes(c); c = byTheme.get(c)?.base) chain.push(c);
  const out: Partial<Record<Slot, number>> = {};
  for (const slot of new Set(index!.parts.map((p) => p.slot))) {
    for (const fam of chain) {
      const here = index!.parts.filter((p) => p.slot === slot && p.family === fam && !rejected.has(p.id));
      if (here.length) { out[slot] = Math.max(...here.map((p) => p.triCount)); break; }
    }
  }
  return out;
};

// 骨架对所有方案摆出的件数一样（30）；多出来几份只看事件形状 —— 缓存一份，省得每个物种都扫
const extraCache = new Map<string, Skeleton>();
const skFor = (t: ThemeDef) => {
  const k = planOf(t);
  if (!extraCache.has(k)) extraCache.set(k, skeletonOf(t));
  return extraCache.get(k)!;
};

// ── 1 ────────────────────────────────────────────────────────────────────────
test('交接中的 draw call 不越 BUDGET —— 稳态桶数 + 同时交接件数 × 每件多开的桶', { skip: !index }, () => {
  const ceiling = swapCeiling(PASSES);
  const byId = new Map(index!.parts.map((p) => [p.id, p]));
  const lib = { metaOf: (id: string): PartMeta => byId.get(id)! };
  let worstSteady = 0;
  let worstAdded = 0;
  let at = '';
  for (const t of partBuilt) {
    const sk = skFor(t);
    for (const tier of [1, 2, 3] as Tier[]) {
      for (const seed of [1, 2026]) {
        const g = makeGenome(seed, tier, index!, { theme: t.id, rejected });
        const buckets = (render: Partial<Record<SlotKey, SlotRender[]>>) => {
          const b = new Set<string>();
          for (const i of assemble(g, sk, lib, { render })) {
            const m = byId.get(i.partId)!;
            b.add(`${i.partId}|${IS_LEFT[i.slotKey as keyof typeof IS_LEFT] === true && m.symmetry === 'mirror'}|${i.materialRole}`);
          }
          return b.size;
        };
        const steady = buckets({});
        worstSteady = Math.max(worstSteady, steady);
        for (const key of ALL_SLOT_KEYS) {
          const from = g.slots[key];
          const other = index!.parts.find((p) => p.slot === slotOfKey(key) && p.id !== from.partId && !rejected.has(p.id));
          if (!other) continue;
          const to = { partId: other.id, materialRole: from.materialRole };
          for (let i = 0; i <= 10; i++) {
            for (const fn of [replaceRenders, crossfadeRenders]) {
              const added = buckets({ [key]: fn(key, from, to, i / 10) }) - steady;
              if (added > worstAdded) { worstAdded = added; at = `${t.id} tier=${tier} ${key} t=${i / 10}`; }
            }
          }
        }
      }
    }
  }
  const draws = PASSES * (worstSteady + ceiling * worstAdded);
  assert.ok(draws <= BUDGET.maxDrawCalls,
    `最坏 ${draws} draw > ${BUDGET.maxDrawCalls}：稳态 ${worstSteady} 桶 + 同时交接 ${ceiling} 件 × 每件多开 ${worstAdded} 桶`
    + `（多开最多的一次：${at}），描边每桶 ${PASSES} 次提交`);
});

test('creature 真的按那个上限跑 —— 交叉淡入给替换留名额，满了也不驱逐在途件', () => {
  const src = read('../src/creature/creature.ts');
  const pump = src.slice(src.indexOf('function pumpQueue()'), src.indexOf('function enqueue('));
  assert.ok(/active\.size \+ reserve < c\b/.test(pump), 'pumpQueue() 不再按 `swapCeiling` 和替换预留的名额收交叉淡入');
  const replace = src.slice(src.indexOf('    replace(slot, pick, requested'), src.indexOf('    settleDetachment()'));
  assert.match(replace, /if \(active\.size >= ceiling\(\)\) return null/,
    'replace() 名额满了没有明确拒绝 —— 会叠过 42/40 或驱逐半空中的旧事件');
  assert.doesNotMatch(replace, /active\.delete\(/, 'replace() 仍会把在途脱离突然掐掉');
  const main = read('../src/main.ts');
  assert.ok(/createCreature\(\{[^}]*replaceSlots: flags\.theseus\.on \? 1 : 0/.test(main),
    'main.ts 没给替换留名额：升档那一批交叉淡入会把名额占满');
});

// ── 2 ────────────────────────────────────────────────────────────────────────
test('交接中的面数不越 BUDGET —— 每个物种按自己每一格最重的件算最坏那一帧', { skip: !index }, () => {
  const ceiling = swapCeiling(PASSES);
  const over: string[] = [];
  let tightest = { id: '', drawn: 0, what: '' };
  for (const t of partBuilt) {
    const own = ownMax(t.id);
    const bound = Object.fromEntries(ALL_SLOT_KEYS.map((k) => [k, own[slotOfKey(k)] ?? 0])) as Record<SlotKey, number>;
    const w = worstFill(bound, skFor(t), ceiling);
    const drawn = PASSES * w.fill;
    if (drawn > tightest.drawn) tightest = { id: t.id, drawn, what: w.what };
    if (drawn > BUDGET.maxTriangles) {
      over.push(`${t.id}: ${Math.round(drawn)} 面（稳态 ${Math.round(PASSES * w.steady)}，${w.what}）`);
    }
  }
  assert.equal(over.length, 0,
    `交接中越过 BUDGET.maxTriangles=${BUDGET.maxTriangles}（描边 ×${PASSES}）：\n  ${over.join('\n  ')}`);
  // 活性：最紧的那个物种确实在逼近预算，不是一条永远宽松的断言
  assert.ok(tightest.drawn > 0.8 * BUDGET.maxTriangles,
    `最紧的物种 ${tightest.id} 只有 ${Math.round(tightest.drawn)} 面 —— 这条断言没有在守任何东西`);
});

/**
 * "一件原件都不剩"（docs/44 §0）和预算要同时成立：每个物种的每一格，都换成它能借到的**最轻**那件外借件，
 * 最坏那一帧也要放得下。放不下 = 借件门迟早要把某一件原件挡在外面 —— 替换在排期器上发生了、
 * 画面上什么都没换，而 HUD 上的计数照样走到 18/18。最轻的外借件从真的 `borrowPools()` 里挑（d1–d3）。
 */
test('每一件原件都还换得掉 —— 全身换成最轻的外借件，最坏那一帧也放得下', { skip: !index }, () => {
  const ceiling = swapCeiling(PASSES);
  const over: string[] = [];
  for (const t of partBuilt) {
    const own = ownMax(t.id);
    const g = makeGenome(1, 3, index!, { theme: t.id, rejected });
    const bound = {} as Record<SlotKey, number>;
    for (const key of ALL_SLOT_KEYS) {
      const pools = borrowPools({ slot: key, genome: g, tier: 3, index: index!, rejected });
      const outer = [...pools[1], ...pools[2], ...pools[3]];
      const lightest = outer.length ? Math.min(...outer.map((p) => p.triCount)) : 0;
      bound[key] = Math.max(own[slotOfKey(key)] ?? 0, lightest);
    }
    const w = worstFill(bound, skFor(t), ceiling);
    if (PASSES * w.fill > BUDGET.maxTriangles) {
      over.push(`${t.id}: ${Math.round(PASSES * w.fill)} 面（稳态 ${Math.round(PASSES * w.steady)}，${w.what}）`);
    }
  }
  assert.equal(over.length, 0,
    `这些物种换不完所有原件就会越过 BUDGET.maxTriangles=${BUDGET.maxTriangles}：\n  ${over.join('\n  ')}`);
});

// ── 3 ────────────────────────────────────────────────────────────────────────
test('借件之后最坏那一帧仍然放得下 —— 真数据走一整场，每一次借件都量', { skip: !index }, () => {
  const ceiling = swapCeiling(PASSES);
  const byId = new Map(index!.parts.map((p) => [p.id, p]));
  const DT = 1 / 10;
  let events = 0;
  let heaviest = 0;
  const over: string[] = [];
  for (const t of partBuilt) {
    const own = ownMax(t.id);
    const sk = skFor(t);
    for (const seed of [3, 1999]) {
      const arc = createArc();
      const th = createTheseus({ seed });
      let g = makeGenome(seed, 1, index!, { theme: t.id, rejected });
      for (let i = 0; i < Math.round(arc.total / DT); i++) {
        const a = arc.update(true, DT);
        const st = th.update({ elapsed: a.elapsed, present: true }, DT);
        if (!st.fired) continue;
        const next = swapOneSlot(g, st.fired.slot, (seed ^ Math.imul(st.fired.index, 0x9e3779b9)) >>> 0, {
          tier: Math.max(1, a.tier) as Tier, index: index!, rejected, overall: a.overall,
        });
        if (!next) continue;
        // 替换进行中新旧两件同时在场：那一格按重的那件算
        const was = byId.get(g.slots[st.fired.slot].partId)?.triCount ?? 0;
        g = next;
        events++;
        const bound = Object.fromEntries(ALL_SLOT_KEYS.map((k) => [
          k, Math.max(byId.get(g.slots[k].partId)?.triCount ?? 0, own[slotOfKey(k)] ?? 0, k === st.fired!.slot ? was : 0),
        ])) as Record<SlotKey, number>;
        const w = worstFill(bound, sk, ceiling);
        heaviest = Math.max(heaviest, PASSES * w.fill);
        if (PASSES * w.fill > BUDGET.maxTriangles) {
          over.push(`${t.id} seed=${seed} #${st.fired.index} ${st.fired.slot} ← ${g.slots[st.fired.slot].partId}：`
            + `${Math.round(PASSES * w.fill)} 面（${w.what}）`);
        }
      }
    }
  }
  assert.ok(events > 20 * partBuilt.length, `一共只借了 ${events} 件 —— 借件这条路没怎么走过，下面那条什么都没证明`);
  assert.equal(over.length, 0, `借件之后越过 BUDGET.maxTriangles（前 5 条）：\n  ${over.slice(0, 5).join('\n  ')}`);
  assert.ok(heaviest > 0.8 * BUDGET.maxTriangles, `借件之后最重只有 ${Math.round(heaviest)} 面 —— 这条断言没有在守任何东西`);
});
