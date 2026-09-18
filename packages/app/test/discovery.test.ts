import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_PAGES,
  SITE,
  canonical,
  discoveryFiles,
  injectDiscovery,
  renderLlmsFull,
  renderManifest,
  renderSitemap,
  schemaFor,
} from '../src/site/discovery.ts';

const app = fileURLToPath(new URL('..', import.meta.url));
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const count = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].length;

test('every public page gets one initial-HTML discovery contract', () => {
  for (const page of PUBLIC_PAGES) {
    const file = page.path === '/' ? 'index.html'
      : page.path === '/dev' ? 'dev/index.html'
        : `${page.path.slice(1)}.html`;
    const output = injectDiscovery(read(`../${file}`), `${app}/${file}`);
    assert.equal(count(output, /<title>/g), 1, file);
    assert.equal(count(output, /name="description"/g), 1, file);
    assert.equal(count(output, /rel="canonical"/g), 1, file);
    assert.equal(count(output, /property="og:url"/g), 1, file);
    assert.equal(count(output, /type="application\/ld\+json"/g), 1, file);
    assert.match(output, new RegExp(canonical(page.path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(output, /name="robots" content="index, follow,/);
  }
});

test('404 and dev tools are intentionally indexable', () => {
  for (const file of [`${app}/404.html`, `${app}/dev/stage.html`]) {
    const output = injectDiscovery(read(file.endsWith('404.html') ? '../404.html' : '../dev/stage.html'), file);
    assert.match(output, /name="robots" content="index, follow,/);
    assert.match(output, /rel="canonical"/);
    assert.match(output, /application\/ld\+json/);
  }
});

test('poster renderers and unknown HTML still fail closed to noindex', () => {
  const sample = '<!doctype html><html><head><title>Internal</title></head><body></body></html>';
  for (const file of [`${app}/poster/brand.html`, `${app}/future.html`]) {
    const output = injectDiscovery(sample, file);
    assert.match(output, /noindex, follow, noarchive/, file);
    assert.doesNotMatch(output, /rel="canonical"/, file);
    assert.doesNotMatch(output, /application\/ld\+json/, file);
    assert.equal(count(output, /<title>/g), 1, file);
  }
});

test('sitemap and discovery outputs are generated from the public page table', () => {
  const sitemap = renderSitemap();
  const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(urls, PUBLIC_PAGES.map((page) => canonical(page.path)));
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.every((url) => url.startsWith(SITE.origin) && !url.endsWith('.html')));
  assert.match(sitemap, /\/404<\/loc>/);
  assert.match(sitemap, /\/dev\/stage<\/loc>/);
  assert.doesNotMatch(sitemap, /\/poster\//);

  assert.deepEqual(Object.keys(discoveryFiles()).sort(), [
    '9dbbb832d8e24a6788f20261877857f0.txt',
    'llms-full.txt',
    'llms.txt',
    'manifest.webmanifest',
    'robots.txt',
    'sitemap.xml',
  ]);
});

test('structured data describes an artwork, a website, its publisher and the page', () => {
  for (const page of PUBLIC_PAGES) {
    const schema = schemaFor(page) as { '@graph': { '@type': string; license?: string }[] };
    assert.deepEqual(schema['@graph'].map((node) => node['@type']), [
      'Organization', 'WebSite', 'VisualArtwork', 'WebPage',
    ]);
    assert.ok(schema['@graph'].every((node) => node.license === undefined), 'Apache must not be applied to the artwork');
  }
});

test('manifest and social assets form a real, parseable media contract', () => {
  const manifest = JSON.parse(renderManifest()) as { icons: { src: string; sizes: string }[] };
  assert.deepEqual(manifest.icons, [{ src: SITE.iconPath, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]);
  assert.match(read('../src/site/assets/see-me-see-u.svg'), /viewBox="0 0 512 512"/);

  const png = readFileSync(new URL('../src/site/assets/see-me-see-u-stage.png', import.meta.url));
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test('GEO copy keeps the public and installation capability boundary explicit', () => {
  const text = renderLlmsFull();
  assert.match(text, /public website runs the fast loop locally in the browser/);
  assert.match(text, /slow loop captures a silhouette mask/);
  assert.match(text, /real model-backed generation on the installation machine has not yet been verified/);
  assert.match(text, /does not upload raw video, photos, masks, or raw pose-keypoint trajectories/);
  assert.match(text, /future anonymous movement-data line .* is not a capability of this release/);
  assert.doesNotMatch(text, /real-time AI 3D generation is live|real generation is complete/i);
});

test('Vite build is wired to inject and emit the discovery contract', () => {
  const vite = read('../vite.config.ts');
  assert.match(vite, /injectDiscovery\(html, ctx\.filename\)/);
  assert.match(vite, /discoveryFiles\(\)/);
  assert.match(vite, /see-me-see-u-stage\.png/);
  assert.match(vite, /see-me-see-u\.svg/);
});
