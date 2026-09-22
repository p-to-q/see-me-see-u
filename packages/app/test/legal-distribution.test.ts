import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

test('root license is the unmodified p-to-q Apache-2.0 form', () => {
  const license = read('LICENSE');
  assert.match(license, /^\s*Apache License\n\s+Version 2\.0, January 2004/m);
  assert.match(license, /Copyright 2026 p-to-q/);
  assert.match(license, /END OF TERMS AND CONDITIONS/);
  assert.doesNotMatch(license, /SCOPE|\u8303\u56f4\u8bf4\u660e|carve-out|MIT License/);
});

test('every workspace declares Apache-2.0 and internal workspaces cannot be published', () => {
  const manifests = [
    'package.json',
    'packages/app/package.json',
    'packages/archive-worker/package.json',
    'packages/archive/package.json',
    'packages/core/package.json',
    'packages/factory/package.json',
  ];
  for (const path of manifests) {
    const pkg = JSON.parse(read(path)) as { license?: string; private?: boolean };
    assert.equal(pkg.license, 'Apache-2.0', path);
    assert.equal(pkg.private, true, path);
  }
});

test('third-party inventory retains every non-Apache boundary and the upstream MIT grant', () => {
  const thirdParty = read('THIRD_PARTY_NOTICES.md');
  for (const phrase of [
    'Copyright (c) 2026 Yousuf Soomro',
    'Real-machine geometry',
    'Hyper3D / Rodin outputs',
    'ZKMSerendipity',
    'SIL Open Font License 1.1',
    'CC BY-SA 4.0',
    'CC0 1.0',
    'Software dependencies',
    'Artwork, brand, and staging',
  ]) assert.match(thirdParty, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), phrase);
  assert.match(thirdParty, /Permission is hereby granted, free of charge/);
  assert.match(thirdParty, /Apache-2\.0 grants no rights\s+to these files/);
});

test('website distribution and credits expose the legal files', () => {
  const vite = read('packages/app/vite.config.ts');
  for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
    assert.match(vite, new RegExp(`['"]${file.replace('.', '\\.')}['"]`), file);
  }
  assert.match(vite, /copyFileSync\(resolve\(ROOT, file\), resolve\(out, file\)\)/);

  const about = read('packages/app/src/about/about.ts');
  assert.match(about, /\/LICENSE/);
  assert.match(about, /\/NOTICE/);
  assert.match(about, /\/THIRD_PARTY_NOTICES\.md/);
});

test('active public surfaces no longer describe project source as MIT', () => {
  for (const path of [
    'README.md',
    'packages/app/src/ui/i18n.ts',
    'packages/app/src/ui/type.css',
    'packages/app/poster/brand.html',
    'assets/fonts/ZKMSerendipity/NOTICE.md',
    'scripts/harvest.mjs',
    'assets/parts/ATTRIBUTION.md',
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /Source code is MIT|The code is MIT|\u6e90代码 MIT|\u8fd9个仓库 MIT 的代码|\u5b57体本身不打包/, path);
  }
});
