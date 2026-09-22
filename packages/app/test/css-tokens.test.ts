import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGION_TOKENS } from '../src/stage/ink-regions.ts';

/**
 * CSS 令牌的**存在性**。
 *
 * ## 这个文件为什么存在
 *
 * `type.css` 里曾经有一个**嵌套的 `:root {}`**。纯 CSS 不支持嵌套规则，
 * 解析器把整个内层块丢掉 —— 于是 `--sb-layer-*`、`--sb-halo`、
 * `--sb-ink-strong`、`--sb-stage-ground` 全都是未定义的，
 * 每一条取用它们的声明因此**整条失效**。
 *
 * 它藏了很久，因为失效的 CSS 声明不报错，只是"没效果" ——
 * 而没效果的东西正好长得像"设计得很克制"：
 * 面板的底色一直是全透明，看起来像是有人故意做成透明的；
 * 悬停不变色，看起来像是有人故意做成不变色的。
 *
 * docs/02 P21：**问一句"如果这东西坏了，我的仪表会显示什么"。**
 * 如果答案是"和现在一样"，那它就不是仪表。
 * 类型检查看不见 CSS，单测也不会渲染 CSS，所以这一层一直没有仪表。
 * 这个文件就是那个仪表：它不渲染，只检查那份契约在文本上成不成立。
 */

// `new URL(...).pathname` 会把路径里的非 ASCII 百分号编码 ——
// 这个仓库的绝对路径里有中文，于是 readdir 直接 ENOENT。
const UI = fileURLToPath(new URL('../src/', import.meta.url));

/** 递归收集所有 .css */
function cssFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) cssFiles(p, out);
    else if (e.name.endsWith('.css')) out.push(p);
  }
  return out;
}


/** 递归收集 .ts（只看 src 下的，测试自己不算） */
function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FILES = cssFiles(UI);
/** 块注释（CSS 与 TS 通用）+ TS 的行注释。
 *
 * 行注释这一半是后补的：`stage/scenes.ts` 里有两行 `// …#fafafa…`，
 * 是在解释色调映射为什么不能直接喂那个值 —— **一句讨论颜色的话不是一处颜色**。
 * 守卫把它算成违规，等于逼着文档绕开自己要说的那个词。
 *
 * `[^:]` 那一段是为了不把 `https://` 的后半行吃掉：URL 里的 `//` 不是注释，
 * 而把它当注释会让守卫在那一行之后变瞎 —— 一个看不见的漏洞比一条假警报更贵。
 */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('CSS：`:root` 不许出现在任何块里面，且括号必须平衡', () => {
  // 断言写得很窄，是故意的。@media 套 @supports 是合法的，按"嵌套深度不超过 2"
  // 去拦会把合法的东西一起拦掉（editorial.css 就有一处）。
  // 真正咬过我们的缺陷只有一个形状：**一个 `:root` 开在另一个 `:root` 里面**。
  // 宁可只拦这一个形状并且拦准，也不要一条谁都会去改宽的规则。
  for (const f of FILES) {
    const src = stripComments(readFileSync(f, 'utf8'));
    let depth = 0;
    let line = 1;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === '\n') line++;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        assert.ok(depth >= 0, `${f}:${line} 多了一个 }`);
      }
      if (src.startsWith(':root', i) && depth > 0) {
        assert.fail(`${f}:${line} 有一个嵌套的 :root —— 纯 CSS 不支持，整块会被静默丢掉`);
      }
    }
    assert.equal(depth, 0, `${f} 括号不平衡，末尾深度 ${depth}`);
  }
});

test('CSS：每一个 var(--sb-*) 都有地方定义它', () => {
  const declared = new Set<string>();
  for (const f of FILES) {
    for (const m of stripComments(readFileSync(f, 'utf8')).matchAll(/(--sb-[a-z0-9-]+)\s*:/g)) {
      declared.add(m[1]);
    }
  }
  // 这几个由 JS 在运行时写进行内样式（stage.ts 的 publishStageInk），
  // 文本里也有缺省值，所以它们本来就该在 declared 里 —— 列出来是为了
  // 万一将来有人把缺省值删了，这条断言会指着它说话。
  const runtime = [
    '--sb-on-stage', '--sb-on-stage-dim', '--sb-ink-strong',
    // 各角那一份（stage/ink-regions.ts 按像素发布）。缺省值丢了的话，
    // 没有舞台的页面、或者读不到像素的那一刻，角上的字是未定义色
    ...Object.values(REGION_TOKENS).flatMap((t) => [t.on, t.dim, t.strong]),
  ];
  // 缺省值必须在 type.css：first-screen.css 里那一份挂在 `html.sb-first-screen` 上，
  // 首屏一走它就不在了 —— 只查"某个文件里声明过"会把它当成缺省值（实测：删掉 type.css
  // 那一行，这条仍然是绿的）。
  const typeCss = new Set(
    [...stripComments(readFileSync(join(UI, 'ui/type.css'), 'utf8')).matchAll(/(--sb-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
  );
  for (const n of runtime) {
    assert.ok(typeCss.has(n), `${n} 只在运行时被写入，type.css 里没有缺省值 —— 舞台不在场的页面上它是未定义的`);
  }

  const missing: string[] = [];
  for (const f of FILES) {
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/var\(\s*(--sb-[a-z0-9-]+)/g)) {
      // var(--x, fallback) 有兜底，不算
      const after = src.slice(m.index! + m[0].length, m.index! + m[0].length + 2);
      if (after.trim().startsWith(',')) continue;
      if (!declared.has(m[1])) missing.push(`${f} 用了 ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], `有 var() 指向从未定义的令牌：\n${missing.join('\n')}`);
});

test('CSS："跟着底色翻"的令牌，亮底那一侧必须也有人翻', () => {
  // 深底是缺省值（type.css）。亮底有两处：首屏那个类，和舞台按场景亮度发布的那一份。
  // 少了任何一侧，都会退回成"在一种底色上写死"——那正是犯过三次的那个 bug。
  const firstScreen = readFileSync(join(UI, 'choose/ring/first-screen.css'), 'utf8');
  const stage = readFileSync(join(UI, 'stage/stage.ts'), 'utf8');
  // 曾经有三个。`--sb-halo`（字周围的光晕）和 `--sb-stage-ground`（面板的底）
  // 都**删掉了** —— 浮层改成纯文字、面板改成无底，理由写在 nav.css 和 chrome.css：
  // 任何一个固定的底色都只在几种场景上成立，在别的上面它就是一块补丁。
  // 剩下这一个仍然要两侧都翻。
  for (const n of ['--sb-ink-strong']) {
    assert.ok(firstScreen.includes(n), `first-screen.css 没有翻 ${n}`);
    assert.ok(stage.includes(n), `stage.ts 的 publishStageInk 没有发布 ${n}`);
  }
});

test('CSS：各角的墨，首屏翻了、组件取的是自己那一角', () => {
  // 各角令牌由舞台写成行内样式。首屏不翻它们的话，首屏上角里的字会拿到
  // 舞台量到的墨 —— 而那几秒底下是纸，不是舞台画布。
  const firstScreen = stripComments(readFileSync(join(UI, 'choose/ring/first-screen.css'), 'utf8'));
  const consumers: Record<keyof typeof REGION_TOKENS, string[]> = {
    tr: ['ui/corner.css'],
    br: ['ui/exits.css', 'shell/notice.css'],
    bl: ['shell/notice.css'],
    tl: ['ui/preview.css'],
  };
  const problems: string[] = [];
  for (const [region, t] of Object.entries(REGION_TOKENS) as Array<[keyof typeof REGION_TOKENS, typeof REGION_TOKENS.tr]>) {
    for (const n of [t.on, t.dim, t.strong]) {
      if (!new RegExp(`${n}\\s*:[^;]*!important`).test(firstScreen)) problems.push(`first-screen.css 没有翻 ${n}`);
    }
    for (const f of consumers[region]) {
      const src = stripComments(readFileSync(join(UI, f), 'utf8'));
      // 取用 = 把全局那个名字重新指到这一角：`--sb-on-stage: var(--sb-on-stage-tr)`
      if (!new RegExp(`--sb-on-stage\\s*:\\s*var\\(\\s*${t.on}\\s*\\)`).test(src)) {
        problems.push(`${f} 没有让 --sb-on-stage 取 ${t.on}`);
      }
    }
  }
  // 左上那句话的中文行不写自己的颜色，吃的是 type.css 的 `.sb-zh { color: var(--sb-ink) }` ——
  // 只重指 --sb-on-stage 不够：2026-09-14 无头 Chrome 实测「纸」场景下它是 #dfe4ea 压在 0.90 的底上，1.15:1。
  // 所以这一句（和右上那一列一样）连 --sb-ink 也要重指到自己这一角。
  for (const [f, region] of [['ui/preview.css', 'tl'], ['ui/corner.css', 'tr']] as const) {
    const src = stripComments(readFileSync(join(UI, f), 'utf8'));
    if (!new RegExp(`--sb-ink\\s*:\\s*var\\(\\s*${REGION_TOKENS[region].on}\\s*\\)`).test(src)) {
      problems.push(`${f} 没有让 --sb-ink 取 ${REGION_TOKENS[region].on} —— 里面的 .sb-zh 会停在全局浅墨上`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

/**
 * **UI 颜色不许写成十六进制字面量 —— 除非那一处就是某个令牌的定义点。**
 *
 * 这条守的是今天犯了三次的那个 bug：`color: #fff` 在深色底上写的时候，
 * 它的字面意思和意图恰好重合；首屏和白展厅翻成亮底之后，它的字面意思变成
 * "和纸一样白"，手放上去那一行就没了。
 *
 * 规矩**不是"禁止十六进制"**：令牌本身总得在某处被定义成一个具体颜色，
 * 而一块没有信号的屏幕就是黑的 —— 那是物理事实，不是主题色。
 * 所以这里是一张**带理由的白名单**。一刀切的禁令只会被下一个人关掉；
 * 一张要求写下理由才能进的名单，会逼他先想一下他到底在干什么。
 *
 * 这条测试本身是补上来的：它曾经被写在一张任务卡上当作"已经存在的东西"，
 * 而它并不存在（一条 lane 去核了，发现树上还有七处）。把想做的事当成
 * 做过的事，是 P21 的另一种形状。
 */
const HEX_ALLOWED: Array<{
  /** 相对 `packages/app/` 的路径 */
  file: string;
  why: string;
  /**
   * 只放行**挂在这个选择器底下**的规则（仅 CSS）。每一条含十六进制的规则，
   * 它逗号分开的每一个选择器都必须以它开头 —— 否则照样算违规。
   * 一个按文件放行的条目会连同下一个人新写的、没挂作用域的那一处一起放过去，
   * 而那正是这张名单要拦的泄漏。
   */
  onlyUnder?: string;
}> = [
  { file: 'src/ui/type.css', why: '--sb-ink-strong 的深底定义点。令牌总要在某处是一个具体颜色' },
  { file: 'src/choose/ring/first-screen.css', why: '同上的亮底定义点（首屏用 !important 翻过来）' },
  { file: 'src/stage/look.ts', why: 'STAGE_INK：舞台两侧墨色三元组的定义点，由 publishStageInk 按场景亮度选一侧' },
  { file: 'src/ui/preview.css', why: '摄像头小屏的底。**一块没有信号的屏幕就是黑的** —— 物理事实，不是主题色' },
  { file: 'src/slow/slow.ts', why: '剪影遮罩的画布填充。它不是 UI，是喂给生成模型的一张图' },
  { file: 'src/shell/boot-error.ts', why: '**起不来时的那一屏。** 它存在的前提就是样式表没加载成功，所以它不能依赖任何令牌 —— 这一处是全仓最不该用 var() 的地方' },
  { file: 'src/shell/hud.ts', why: '`?debug=1` 的 HUD，行内样式，观众永远看不到。它是仪表不是画面，用固定色是为了在任何场景下都一眼可读' },
  { file: 'src/choose/ring/field.ts', why: 'readVar() 的兜底值。CSS 变量取不到时才用，而取不到正是"样式没加载"那一种情况' },
  { file: 'src/choose/cards.ts', why: '卡片是画在 canvas 上的，不是 DOM —— 它拿不到 CSS 变量，颜色只能是具体值' },
  { file: 'src/ui/chrome.css', why: 'dev HUD 的警告琥珀色。它是 `--sb-warn` 之外的第二档，只在 `?debug=1` 出现' },
  { file: 'src/shell/selftest.ts', why: '开场前自检页。和 boot-error 同一类：它要在"东西可能是坏的"的前提下也能读，所以不依赖样式表' },
  { file: 'src/site/discovery.ts', why: '浏览器外壳的 theme-color 与可安装站点清单的背景色。它们在 CSS 到达前由浏览器消费，不能引用运行时 CSS 令牌' },
  { file: 'index.html', why: '主程序那一页在任何样式表和 main.ts 到达之前的底色。和 boot-error 同一类：那一刻还没有令牌可取' },
  {
    file: 'dev/archive.css',
    onlyUnder: '.sb-archive.can-curate',
    why: '**策展模式里的色相**（绿 = keep、红 = reject、琥珀 = 可疑比例），只挂在 `.sb-archive.can-curate` 底下。'
      + '那个类只在 `/__curate` 中间件探得到时才有，生产上没有 —— 它是我们的仪器，不是展出的声音。'
      + '观众那一侧三档靠墨的浓淡与虚实区分，不靠色相（docs/26 §F 的那一处仍然只有一处）',
  },
];

// ── 展出页顺着 import 走到的每一个文件 ──────────────────────────────────────
//
// 这一段是补上来的，补的是一个**目录边界造成的盲区**：守卫原来只扫 `src/`，
// 而 `/parts` 与 `/lineage` import 了 `dev/archive.css` 和 `dev/thumbs.ts` ——
// 两个文件里写着策展的绿框红框、socket 的红蓝两端，于是第二处"颜色承担语义"
// 进了展出页，而这条守卫一直是绿的。
//
// 修法有两条：把那两个文件搬进 `src/`，或者让守卫顺着 import 走。选后者：
// 搬家修的是**这一次**；顺着 import 走修的是**这一类** —— 下一个从 `src/` 里
// import `../../dev/whatever.css` 的人，不需要记得这条守卫只看哪个目录。
// 文件住在哪不决定它会不会出现在观众面前，import 图才决定。
//
// 「展出页」= `packages/app/` 根目录下的每一个 .html。这不是这里新定的：
// `vite.config.ts` 的 `pages()` 就是这样分的（根目录 = 主程序 + 展陈层，`dev/` = 工具页）。

const APP = fileURLToPath(new URL('../', import.meta.url));

/** 裸说明符（`three`、`three/examples/...`）是依赖，不是我们写的 UI —— 不跟 */
const isLocal = (spec: string): boolean => spec.startsWith('.') || spec.startsWith('/');

function resolveSpec(fromFile: string, spec: string): string {
  const clean = spec.split('?')[0];
  return clean.startsWith('/') ? join(APP, clean) : join(dirname(fromFile), clean);
}

/** 一个文件直接引用到的本地文件 */
function edgesOf(file: string): string[] {
  const raw = readFileSync(file, 'utf8');
  const specs: string[] = [];
  if (file.endsWith('.html')) {
    for (const m of raw.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)) specs.push(m[1]);
    for (const m of raw.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css)["']/g)) specs.push(m[1]);
    // 行内 <script type="module"> 里的 import（index.html 就是这样进 main.ts 的）
    for (const m of raw.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) specs.push(...tsSpecs(m[1]));
  } else if (file.endsWith('.css')) {
    for (const m of stripComments(raw).matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/g)) specs.push(m[1]);
  } else if (file.endsWith('.ts')) {
    specs.push(...tsSpecs(raw));
  }
  return specs.filter(isLocal).map((s) => resolveSpec(file, s));
}

function tsSpecs(src: string): string[] {
  const s = stripComments(src);
  return [
    ...s.matchAll(/\b(?:import|export)\s[^'";]*?\bfrom\s*["']([^"']+)["']/g),
    ...s.matchAll(/\bimport\s*["']([^"']+)["']/g),
    ...s.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);
}

/** 从一张页面出发，走到的所有 .ts / .css（含页面本身） */
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    // 只跟会带 UI 颜色的那几种文件；.json / .glb 之类不是
    if (!/\.(ts|css|html)$/.test(f)) continue;
    // 解析不到就当场红：一条解析失败被静默跳过的边，就是下一个盲区
    assert.ok(existsSync(f), `${relative(APP, entry)} 走到一个不存在的文件：${relative(APP, f)}`);
    seen.add(f);
    stack.push(...edgesOf(f));
  }
  return [...seen];
}

const EXHIBITED = readdirSync(APP).filter((n) => n.endsWith('.html')).map((n) => join(APP, n));

/** 所有被扫的文件：`src/` 全部（包括只被 dev 页用到的），加上展出页走得到的一切 */
function hexScope(): string[] {
  const all = new Set<string>([...FILES, ...tsFiles(UI)]);
  for (const page of EXHIBITED) {
    const files = reachable(page);
    // 走不出页面本身，说明解析坏了 —— 那样这条守卫又会安静地变瞎
    assert.ok(files.length > 1, `${relative(APP, page)} 一个模块都没走到，import 解析坏了`);
    for (const f of files) all.add(f);
  }
  return [...all];
}

/** 位置 i 所在的 CSS 规则的选择器（最内层那个块） */
function selectorAt(src: string, i: number): string | null {
  const open = src.lastIndexOf('{', i);
  const close = src.lastIndexOf('}', i);
  if (open < 0 || close > open) return null;   // 不在任何块里
  const start = Math.max(src.lastIndexOf('}', open), src.lastIndexOf('{', open - 1), src.lastIndexOf(';', open)) + 1;
  return src.slice(start, open).trim();
}

test('展出页：import 图真的走到了 dev/ 底下', () => {
  // 仪表自己也要证明它不瞎（docs/02 P21）：如果哪天 `/parts` 不再从 dev/ 取东西，
  // 这一条会红，提醒人去看一眼上面那段理由还成不成立，而不是让它悄悄变成空话。
  const parts = reachable(join(APP, 'parts.html')).map((f) => relative(APP, f));
  assert.ok(parts.includes('dev/archive.css'), `parts.html 没走到 dev/archive.css：\n${parts.join('\n')}`);
  assert.ok(parts.includes('dev/thumbs.ts'), 'parts.html 没走到 dev/thumbs.ts');
});

test('CSS/TS：UI 颜色不写十六进制，除非它是令牌的定义点', () => {
  const offenders: string[] = [];
  for (const f of hexScope()) {
    const rel = relative(APP, f);
    const allow = HEX_ALLOWED.find((a) => rel === a.file);
    if (allow && !allow.onlyUnder) continue;
    let src = stripComments(readFileSync(f, 'utf8'));
    if (f.endsWith('.html')) src = src.replace(/<!--[\s\S]*?-->/g, '');
    for (const m of src.matchAll(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})(?![0-9a-fA-F])/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      if (allow?.onlyUnder) {
        const sel = selectorAt(src, m.index!);
        const scoped = sel !== null && sel.split(',').every((s) => {
          const t = s.trim();
          return t === allow.onlyUnder || t.startsWith(`${allow.onlyUnder} `) || t.startsWith(`${allow.onlyUnder}:`);
        });
        if (scoped) continue;
        offenders.push(`${rel}:${line} ${m[0]}（不在 ${allow.onlyUnder} 底下：${sel ?? '规则之外'}）`);
        continue;
      }
      offenders.push(`${rel}:${line} ${m[0]}`);
    }
  }
  assert.deepEqual(
    offenders, [],
    '这些地方把颜色写死了。用 --sb-ink / --sb-ink-dim / --sb-ink-strong '
    + '（它们跟着底色翻），或者把这一处连同**理由**加进 HEX_ALLOWED：\n'
    + offenders.join('\n'),
  );
});
