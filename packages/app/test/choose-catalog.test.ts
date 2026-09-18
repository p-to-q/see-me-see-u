/**
 * 选择页与运行时共用一份 parts.json：守请求所有权、可穿戴计数和缺资产语义。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  catalogFromIndex, catalogKnowsTheme, fetchChooseCatalog, resolveChooseCatalog,
} from '../src/choose/catalog.ts';

const INDEX = {
  themes: [
    { id: 'porcelain', name: '瓷', source: 'rodin' },
    { id: 'field', name: '场', source: 'procedural' },
    null,
  ],
  parts: [
    { family: 'porcelain' }, { family: 'porcelain' }, { family: '' }, null,
  ],
};

test('已有目录时不 fetch，并保留可穿戴所需的自有件计数', async () => {
  const catalog = catalogFromIndex(INDEX);
  let requests = 0;
  const resolved = await resolveChooseCatalog({ catalog }, async () => {
    requests++;
    throw new Error('不该再请求 parts.json');
  });
  assert.equal(requests, 0);
  assert.equal(resolved.catalog, catalog);
  assert.equal(resolved.catalog.partCount.get('porcelain'), 2);
  assert.deepEqual(resolved.catalog.themes.map((t) => t.id), ['porcelain', 'field']);
});

test('没有上游目录时只 fetch 一次；坏条目不会拖垮其余目录', async () => {
  let requests = 0;
  const resolved = await resolveChooseCatalog({}, async () => {
    requests++;
    return { ok: true, status: 200, json: async () => INDEX };
  });
  assert.equal(requests, 1);
  assert.equal(resolved.catalog.partCount.get('porcelain'), 2);
  assert.equal(catalogKnowsTheme(resolved.catalog, 'missing'), false);
});

test('权威索引缺席时不否定手动 theme，失败仍然 resolve', async () => {
  const catalog = await fetchChooseCatalog('/parts/parts.json', async () => {
    throw new Error('offline');
  });
  assert.equal(catalog.sourceAvailable, false);
  assert.equal(catalogKnowsTheme(catalog, 'xeno'), true);
  assert.deepEqual(catalog.themes, []);
});

test('内置占位目录可以显示，但没有资格否定手动 theme', () => {
  const fallback = catalogFromIndex({
    themes: [{ id: 'placeholder', source: 'procedural' }],
    parts: [],
  }, false);
  assert.deepEqual(fallback.themes.map((t) => t.id), ['placeholder']);
  assert.equal(catalogKnowsTheme(fallback, 'xeno'), true);
});

test('调用者直接给 themes 时保持 dev 旁路，且不 fetch', async () => {
  let requests = 0;
  const resolved = await resolveChooseCatalog({
    themes: [{
      id: 'empty-preview', kind: 'character', name: '空', nameEn: 'Empty',
      tagline: '', palette: [], source: 'rodin',
      axes: { humanLike: 0.5, lifeLike: 0.5 }, coverage: 'light',
    }],
  }, async () => {
    requests++;
    throw new Error('不该请求');
  });
  assert.equal(requests, 0);
  assert.equal(resolved.callerSuppliedThemes, true);
  assert.equal(resolved.catalog.partCount.size, 0);
});

test('正式入口把 PartLibrary 的同一份索引交给选择页', () => {
  const main = readFileSync(resolve(import.meta.dirname, '../src/main.ts'), 'utf8');
  const entry = readFileSync(resolve(import.meta.dirname, '../src/shell/entry.ts'), 'utf8');
  assert.match(main, /const chooseCatalog = catalogFromIndex\(library\.index, !library\.usingFallback\)/);
  assert.match(main, /chooseTheme\(\{[\s\S]*?catalog: chooseCatalog,/);
  assert.match(main, /entry\?\.setSpeciesCount\(library\.usingFallback \? null : library\.index\.themes\.length\)/);
  assert.doesNotMatch(entry, /fetch\(['"]\/parts\/parts\.json/,
    '展签自己又请求了 parts.json；应由 PartLibrary 到货后填数字');
});
