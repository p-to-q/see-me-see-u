/**
 * 控件表（`ui/control-table.ts`）—— 面板、快捷键、键位条、重载写 URL、随机的池子、
 * 回舞台的白名单，全部从这一张表推出来。这里守的是**表本身的完整性**和**它与开机参数的一致**。
 *
 * 加一个控件应该只是：表里加一条 + i18n 里加文案 + main.ts 的 host 里接一个变量。
 * 漏了文案、键位撞车、URL 写出去读不回来 —— 每一样这里一条。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ARC_ACTS } from '../../core/src/arc.ts';
import { BODY_PLANS } from '../../core/src/bodyplan.ts';
import { SCENE_IDS } from '../src/stage/scenes.ts';
import { SHADING_IDS } from '../src/creature/shading.ts';
import { readFlags } from '../src/shell/kiosk.ts';
import { COPY } from '../src/ui/i18n.ts';
import {
  CONTROLS, GROUPS, STAGE_KEYS, available, cycleNext, needsReload, optionsOf, rollSlots, stagePatch,
  type ControlValues,
} from '../src/ui/control-table.ts';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const C = COPY.controls as unknown as Record<string, Record<string, unknown>>;

const VALUES: ControlValues = {
  form: 'quadruped', scene: 'tide', act: 'resist',
  outline: true, vitality: false, sound: false,
  species: 'xeno', refine: true, post: false, framing: 'upper', people: '3',
};

test('每一条都有：合法的种类与组、不撞车的键、文案', () => {
  const ids = CONTROLS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'id 重复');
  const keys = CONTROLS.flatMap((c) => (c.key ? [c.key.toLowerCase()] : []));
  assert.equal(new Set(keys).size, keys.length, `快捷键撞车：${keys.join(' ')}`);
  for (const k of keys) assert.ok(!/^[0-9]$|^ $/.test(k), `键 ${k} 和选择页抢（1–9 / 空格归它）`);
  for (const g of GROUPS) {
    assert.ok(CONTROLS.some((c) => c.group === g), `组 ${g} 是空的`);
    assert.ok((C.groups as Record<string, unknown>)[g], `COPY.controls.groups.${g} 缺`);
    assert.ok((C.groupNotes as Record<string, unknown>)[g], `COPY.controls.groupNotes.${g} 缺`);
  }
  for (const c of CONTROLS) {
    assert.ok(['toggle', 'overlay', 'choice', 'action'].includes(c.kind), `${c.id} 种类 ${c.kind}`);
    assert.ok((GROUPS as readonly string[]).includes(c.group), `${c.id} 的组 ${c.group} 不在 GROUPS 里`);
    if (c.key) assert.ok((C.keys as Record<string, unknown>)[c.id], `COPY.controls.keys.${c.id} 缺 —— 键位条上这一行会是空的`);
    if (c.kind === 'toggle') assert.ok((C.render as Record<string, unknown>)[c.id], `COPY.controls.render.${c.id} 缺`);
    if (c.kind === 'overlay') assert.ok((C.arc as Record<string, unknown>)[c.id], `COPY.controls.arc.${c.id} 缺 —— 没有「跟着弧线」那一项`);
    if ((c.kind === 'overlay' || c.kind === 'choice') && c.options !== 'themes') {
      for (const o of optionsOf(c, [])) {
        assert.ok((C[c.id] as Record<string, unknown>)?.[o], `COPY.controls.${c.id}.${o} 缺 —— 这个按钮会被跳过`);
      }
    }
  }
});

test('看起来 = 观众会选的三样；对照 = 工程 A/B 的两样；A/B 排在最后', () => {
  const inGroup = (g: string) => CONTROLS.filter((c) => c.group === g).map((c) => c.id);
  assert.deepEqual(inGroup('look'), ['outline', 'vitality', 'sound']);
  assert.deepEqual(inGroup('ab'), ['refine', 'post']);
  assert.equal(GROUPS[GROUPS.length - 1], 'ab');
});

test('弧线拥有的两样（玩法、形体）是叠加；其余是普通的值', () => {
  const kind = Object.fromEntries(CONTROLS.map((c) => [c.id, c.kind]));
  assert.equal(kind.act, 'overlay');
  assert.equal(kind.form, 'overlay');
  for (const id of ['outline', 'vitality', 'sound', 'refine', 'post']) assert.equal(kind[id], 'toggle');
  assert.equal(kind.scene, 'choice');
  assert.equal(kind.species, 'choice');
  assert.deepEqual(optionsOf(CONTROLS.find((c) => c.id === 'act')!, []), [...ARC_ACTS]);
  assert.deepEqual(optionsOf(CONTROLS.find((c) => c.id === 'form')!, []), [...BODY_PLANS]);
  assert.deepEqual(optionsOf(CONTROLS.find((c) => c.id === 'scene')!, []), [...SCENE_IDS]);
});

test('默认值就是不带参数开机时的值（表和 readFlags 说的是同一件事）', () => {
  const f = readFlags('');
  for (const c of CONTROLS) {
    if (!c.fromFlags) continue;
    assert.deepEqual(c.fromFlags(f), c.default, `${c.id}：表里默认 ${String(c.default)}，开机读到 ${String(c.fromFlags(f))}`);
  }
  assert.equal(CONTROLS.find((c) => c.id === 'vitality')!.default, true, '生命力默认关了');
  assert.equal(CONTROLS.find((c) => c.id === 'act')!.default, null, '默认应当跟着弧线');
});

test('写进 URL 的每一项，开机都读得回同一个值', () => {
  const samples = (c: (typeof CONTROLS)[number]): readonly unknown[] =>
    c.kind === 'toggle' ? [true, false]
      : c.kind === 'overlay' ? [null, ...optionsOf(c, [])]
        : c.options === 'themes' ? ['porcelain', 'char.line'] : optionsOf(c, []);
  for (const c of CONTROLS) {
    if (!c.url) continue;
    assert.ok(c.fromFlags, `${c.id} 写 URL 却没有 fromFlags —— 写出去的东西没人读`);
    for (const v of samples(c)) {
      const w = c.url.write(v as never);
      if (w === undefined) continue;
      const f = readFlags(w === null ? '' : `?${c.url.param}=${encodeURIComponent(w)}`);
      assert.deepEqual(c.fromFlags!(f), v, `${c.id}=${String(v)} → ?${c.url.param}=${w} → 读回 ${String(c.fromFlags!(f))}`);
    }
  }
});

test('重载只在叠加真的开着时写 act / plan；描边不带走（物种自己的声明）', () => {
  const p = stagePatch(VALUES);
  assert.equal(p.act, 'resist');
  assert.equal(p.plan, 'quadruped');
  const off = stagePatch({ ...VALUES, act: null, form: null });
  assert.ok('act' in off && off.act === null, '叠加关着时必须删掉旧的 act=');
  assert.ok('plan' in off && off.plan === null, '叠加关着时必须删掉旧的 plan=');
  assert.equal(stagePatch({ ...VALUES, act: 'untether' }).act, null, '「还回去」不是弧线上的点，不许被写成叠加');
  assert.ok(!('shading' in p), '描边被带走了 —— 那是物种的声明，不是这一屏的演法');
  assert.deepEqual(
    [p.theme, p.scene, p.vitality, p.refine, p.nopost, p.mute],
    ['xeno', 'tide', '0', '1', '1', '1'],
  );
  for (const k of Object.keys(p)) assert.ok(STAGE_KEYS.includes(k), `${k} 写进了 URL 却不在回舞台的白名单里`);
  assert.ok(STAGE_KEYS.includes('seed'));
});

test('团块 / 点场身上没有描边；进出 B 档要重载，其余热切；换物种一律重载', () => {
  const outline = CONTROLS.find((c) => c.id === 'outline')!;
  const people = CONTROLS.find((c) => c.id === 'people')!;
  for (const b of ['mass', 'swarm']) assert.equal(available(outline, { bootPlan: b, speciesPlan: b }), false);
  for (const b of ['mass', 'swarm']) assert.equal(available(people, { bootPlan: b, speciesPlan: b }), false,
    `${b} 主线固定单人，不应显示一个永远不生效的人数控件`);
  for (const a of ['rig', 'quadruped']) assert.equal(available(outline, { bootPlan: a, speciesPlan: a }), true);
  for (const a of ['rig', 'quadruped']) assert.equal(available(people, { bootPlan: a, speciesPlan: a }), true);
  const form = CONTROLS.find((c) => c.id === 'form')!;
  const rigCtx = { bootPlan: 'rig', speciesPlan: 'rig' };
  const massCtx = { bootPlan: 'mass', speciesPlan: 'mass' };
  assert.equal(needsReload(form, rigCtx, 'quadruped'), false);
  assert.equal(needsReload(form, rigCtx, null), false, '拿掉 A 档叠加不该重载');
  assert.equal(needsReload(form, rigCtx, 'mass'), true);
  assert.equal(needsReload(form, massCtx, null), false, '团块物种拿掉团块叠加：还是同一具实现');
  assert.equal(needsReload(form, massCtx, 'rig'), true);
  assert.equal(needsReload(form, { bootPlan: 'mass', speciesPlan: 'rig' }, null), true, '拿掉团块叠加回到人形物种，必须重建');
  assert.equal(needsReload(CONTROLS.find((c) => c.id === 'species')!, rigCtx, 'xeno'), true);
  assert.equal(needsReload(CONTROLS.find((c) => c.id === 'scene')!, rigCtx, 'void'), false);
});

test('键循环：叠加从「跟着弧线」出发、走完一圈回到「跟着弧线」', () => {
  const act = CONTROLS.find((c) => c.id === 'act')!;
  const walk: (string | null)[] = [];
  let v: string | null = null;
  for (let i = 0; i < 5; i++) { v = cycleNext(act, v, []) as string | null; walk.push(v); }
  assert.deepEqual(walk, ['follow', 'echo', 'resist', 'facing', null]);
  const scene = CONTROLS.find((c) => c.id === 'scene')!;
  assert.equal(cycleNext(scene, SCENE_IDS[SCENE_IDS.length - 1], []), SCENE_IDS[0]);
});

test('随机的池子从表来，顺序是旧 URL 的契约；玩法那一格只消耗、写成删除', () => {
  const slots = rollSlots(['porcelain', 'xeno']);
  assert.deepEqual(slots.map((s) => s.param), ['theme', 'plan', 'scene', 'act', 'shading']);
  assert.deepEqual(slots[0].options, ['porcelain', 'xeno']);
  assert.equal(slots[3].options, null, '随机钉住了玩法');
  assert.deepEqual(slots[4].options, [...SHADING_IDS], '描边的池子和 SHADING_IDS 对不上');
});

test('控件条链出去的工作台页都在，都挂着会读 from 的出口', () => {
  const links = CONTROLS.flatMap((c) => (c.links ?? []).map((l) => [c.id, l.page] as const));
  assert.deepEqual(links, [
    ['form', '/dev/lineup.html'], ['form', '/dev/mass.html'],
    ['vitality', '/dev/vitality.html'], ['species', '/dev/figure.html'],
  ]);
  for (const [, page] of links) {
    const file = resolve(APP, page.slice(1));
    assert.ok(existsSync(file), `${page} 不存在`);
    assert.match(readFileSync(file, 'utf8'), /<script type="module" src="\.\/devnav\.ts"><\/script>/);
    assert.ok((C.links as Record<string, unknown>)[page.replace(/^\/dev\/|\.html$/g, '')], `COPY.controls.links 缺 ${page}`);
  }
});
