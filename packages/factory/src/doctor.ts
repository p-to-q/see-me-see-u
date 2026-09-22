/**
 * 仓库自检：新机器上第一条该跑的命令。
 * 只报告，不修改任何东西。绝不打印 key 本身。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, PARTS_DIR, RAW_DIR, load } from './ledger.ts';

const ok = (s: string) => console.log('  ✓ ' + s);
const bad = (s: string) => { console.log('  ✗ ' + s); fails++; };
const warn = (s: string) => console.log('  ⚠ ' + s);
let fails = 0;

console.log('SEE-ME SEE-U · doctor\n');

const [major, minor] = process.versions.node.split('.').map(Number);
const nodeSupported = major > 22 || (major === 22 && minor >= 18);
nodeSupported ? ok(`node ${process.versions.node}（需要 ≥22.18.0：靠默认 type stripping 直接跑 .ts）`)
              : bad(`node ${process.versions.node} 太老，需要 ≥22.18.0`);

existsSync(resolve(ROOT, 'node_modules/three')) ? ok('依赖已安装') : bad('依赖缺失：npm install');

const key = process.env.RODIN_API_KEY;
if (!key) warn('RODIN_API_KEY 未注入（只有资产工厂需要；用 node --env-file=.env 或 npm run factory:*）');
else ok(`RODIN_API_KEY 已注入（${key.length} 字符，尾号 …${key.slice(-4)}）`);
existsSync(resolve(ROOT, '.env')) ? ok('.env 存在') : warn('.env 不存在，复制 .env.example');
readFileSync(resolve(ROOT, '.gitignore'), 'utf8').includes('.env') ? ok('.env 已被 gitignore') : bad('.env 没有被 gitignore！');

for (const f of ['docs/index.md','docs/02-ENGINEERING-PRINCIPLES.md','docs/03-SPEC-part-library.md',
                 'docs/04-SPEC-rig-and-attach.md','docs/10-SURFACES.md','AGENTS.md'])
  existsSync(resolve(ROOT, f)) ? ok(f) : bad(`缺 ${f}`);

if (existsSync(resolve(RAW_DIR, 'ledger.json'))) {
  const l = load();
  const n = Object.values(l.entries);
  const by = (s: string) => n.filter((e) => e.status === s).length;
  ok(`台账: ${n.length} 条 · done ${by('done')} · normalized ${by('normalized')} · failed ${by('failed')} · 消耗 ${l.totalConsumed} credits`);
  if (by('failed')) warn(`${by('failed')} 条失败，重跑 npm run factory:generate -- --all 会自动重试`);
} else warn('还没有生成台账');

existsSync(resolve(PARTS_DIR, 'parts.json'))
  ? ok('parts.json 存在')
  : warn('parts.json 不存在 —— 运行时会用占位几何（ADR-4，这是允许的）');

console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
