import { shouldShip } from './build/ship-filter.ts';
import { blockRender } from './build/render-blocking.ts';
import { shouldServeSlow, type SlowHostMode } from './build/slow-host.ts';
import { discoveryFiles, injectDiscovery } from './src/site/discovery.ts';
import { defineConfig, type Plugin } from 'vite';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const DEMO_DIR = resolve(ROOT, 'assets/demo');

/**
 * 扫 assets/demo/ 生成 /demo/index.json —— `?demo=1` 默认挑哪一段就看它（replay.ts）。
 * 真录制排在合成占位数据前面：**默认永远不该挑到假数据**。
 */
function writeDemoIndex(): number {
  mkdirSync(DEMO_DIR, { recursive: true });
  const clips = readdirSync(DEMO_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((file) => {
      const name = file.replace(/\.json$/, '');
      const entry = { name, url: `/demo/${file}`, fps: 30, frames: 0, seconds: 0, synthetic: false };
      try {
        const raw = JSON.parse(readFileSync(resolve(DEMO_DIR, file), 'utf8'));
        const frames = Array.isArray(raw) ? raw : raw?.frames;
        entry.frames = Array.isArray(frames) ? frames.length : 0;
        entry.fps = typeof raw?.fps === 'number' && raw.fps > 0 ? raw.fps : 30;
        entry.seconds = Math.round((entry.frames / entry.fps) * 10) / 10;
        entry.synthetic = raw?.synthetic === true;
      } catch { /* 坏文件照样列出来，自检页会把它标成 ✗ */ }
      return entry;
    })
    .sort((a, b) => Number(a.synthetic) - Number(b.synthetic) || a.name.localeCompare(b.name));
  writeFileSync(resolve(DEMO_DIR, 'index.json'), `${JSON.stringify({ clips }, null, 2)}\n`);
  return clips.length;
}

/**
 * dev-only 中间件：让 /dev/anchor.html 把渲染好的主题参考图写回 assets/refs/<theme>/_anchor.png。
 * 为什么需要：Rodin 的 preview_render 在本账号/本 tier 上拿不到渲染图（docs/09 U12），
 * 所以 anchor 图由我们自己渲染。只在 dev server 下存在，不会进生产包。
 */
/**
 * `/demo/index.json` 必须在 **build 时也生成**，不只是 dev server 起来时。
 * 否则一台新机器 clone 下来直接 `npm run kiosk`，dist 里就没有这个索引：
 * `?demo=1` 会悄悄退回写死的默认文件，自检页则报"一条片段都没有" ——
 * 现场兜底靠的正是这条路，不能依赖"之前谁在这台机器上跑过 dev server"。
 */
function demoIndex(): Plugin {
  return {
    name: 'sb-demo-index',
    buildStart() {
      try { writeDemoIndex(); } catch (e) { this.warn(`/demo/index.json 生成失败：${String(e)}`); }
    },

    /**
     * dev server 上**必须自己发这一个文件**，不能交给 publicDir 的静态中间件。
     *
     * 踩到的坑（docs/36 §D1）：Vite 的 html 中间件会把路径里那个 `index.*`
     * 认成一张页面，于是 `GET /demo/index.json` 拿到的是 **200 + index.html**，
     * 而同一个目录下的 `pose-*.json` 一切正常 —— 坏的只有这一个文件名。
     * 下游 `fetchClipIndex()` 看到 `r.ok` 为真、`r.json()` 抛异常，按既定降级
     * 退回写死的 `pose-synthetic.json`：**dev 上的 `?demo=1` 一直在放合成假数据**，
     * 而画面上看不出来（合成数据也会动）。自检页同时报「一条片段都没有 ✗」，
     * 那条 ✗ 说的不是产物的实情 —— `vite preview` 与 Vercel 上这个文件是好的。
     *
     * 这正是 P21 那条：仪表读数为真，但它说的是错的那件事。所以修在根上 ——
     * 让 dev 与 preview 对同一个 URL 给出同一个答案，自检页才重新值得信。
     */
    configureServer(server) {
      server.middlewares.use('/demo/index.json', (_req, res) => {
        try {
          res.setHeader('content-type', 'application/json');
          res.end(readFileSync(resolve(DEMO_DIR, 'index.json'), 'utf8'));
        } catch {
          // 还没生成出来（比如 assets/demo/ 是空的）。给一个**空索引**而不是 404：
          // 「没有片段」是 replay.ts 认得的状态，它会退回默认文件；
          // 而 404 在 SPA 回退下又会变回 200 + index.html，等于绕回原来那个坑。
          res.end('{"clips":[]}');
        }
      });
    },
  };
}

/**
 * 存档（`docs/43 §8`）：`POST /api/visit` / `GET /api/visits?limit=`。
 *
 * **和 `/__slow` 正好相反的一条：这条回路在线上是存在的。** 慢回路是
 * `apply:'serve'` 的中间件，生产构建里根本没有它，preview 那边还要显式判 404
 * 才能让「不存在」读起来像不存在。存档不是：线上它是 Vercel 的两个函数
 * （`api/visit.ts` / `api/visits.ts`），所以本机的 dev **和** preview 两边都要挂，
 * 否则 `npm run build && preview` 跑的就不是线上那件事。
 *
 * 三个宿主共用 `packages/archive/src/http.ts` 里那一个 handler，
 * 这里只负责把它接上 connect 的中间件链（逻辑不写在 vite.config 里，
 * 理由和慢回路逐字相同：这个文件没法被测试打到）。
 */
type Mw = (req: IncomingMessage, res: ServerResponse) => void;

function slowDisabled(res: ServerResponse): void {
  res.statusCode = 404;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: false, code: 'DISABLED', error: '这个宿主没有开启本机慢回路' }));
}

/**
 * dev / preview 共用同一个挂载点。这里只做宿主边界；协议、预算与失败矩阵
 * 仍只在 factory 的 `slow-http.ts` / `slow.ts` 里有一份。
 */
function mountSlow(
  middlewares: { use: (path: string, fn: Mw) => unknown },
  mode: SlowHostMode,
): void {
  middlewares.use('/__slow', (req, res) => {
    if (!shouldServeSlow(mode, req.socket.remoteAddress)) return slowDisabled(res);
    void (async () => {
      try {
        const { slowHandler } = await import('../factory/src/slow-http.ts');
        await slowHandler(req, res);
      } catch (e) {
        // 连模块都没加载起来也不能把现场 server 拖下水。
        res.statusCode = 503;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, code: 'DISABLED', error: String((e as Error)?.message ?? e) }));
      }
    })();
  });
}

function mountArchive(middlewares: { use: (path: string, fn: Mw) => unknown }): void {
  middlewares.use('/api', (req, res) => {
    void (async () => {
      try {
        // 本机默认落盘，落在血统池旁边：它和 `lineage.json` 是同一种东西 ——
        // **这台机器的记忆**，不是仓库的内容（`docs/43 §7.3`）。
        // `assets/parts/lineage/` 已经在 .gitignore 里。
        // 不落盘（内存）的话，本机跑出来的就不是线上那件事，而这个挂载点的全部
        // 意义就是让 dev / preview / 线上对同一个 URL 给出同一个答案。
        process.env.ARCHIVE_FILE ??= resolve(ROOT, 'assets/parts/lineage/visits.jsonl');
        const { createArchiveHandler } = await import('../archive/src/http.ts');
        const { createVisitStore } = await import('../archive/src/store.ts');
        archive ??= createArchiveHandler(createVisitStore());
        await archive(req, res);
      } catch (e) {
        // 连模块都没加载起来也不能把本机的 server 拖下水 —— 和 `/__slow` 同一条
        res.statusCode = 503;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, code: 'DISABLED', error: String((e as Error)?.message ?? e) }));
      }
    })();
  });
}
/** 一个进程一个 handler。建两份没有坏处，但也没有理由 —— store 是有状态的那一半 */
let archive: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined;

function anchorWriter(): Plugin {
  return {
    name: 'sb-anchor-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__anchor', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }
        const theme = (req.url ?? '').replace(/^\//, '').split('?')[0];
        // roster id 允许带点（char.dumpling / guest.founder）。每个点后面必须还有字符，
        // 所以 '..' 和前导点都进不来 —— 仍然挡住路径穿越。
        if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/i.test(theme)) { res.statusCode = 400; return res.end('bad theme'); }
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const dir = resolve(ROOT, 'assets/refs', theme);
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, '_anchor.png'), Buffer.concat(chunks));
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, bytes: Buffer.concat(chunks).length }));
      });

      // 策展评级：/dev/parts.html 点一下部件就写回 assets/parts/curation.json
      server.middlewares.use('/__curate', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }
        // `/parts` 开页时问一句「写回在不在」。原来靠发一个空 POST 换 400 来判断 ——
        // 答案对，但每开一次控制台就多一条红色的 400，看起来像坏了（docs/47 导航审计）
        if ((req.url ?? '').includes('probe')) { res.statusCode = 204; return res.end(); }
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const { id, verdict, note } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!id || typeof id !== 'string') { res.statusCode = 400; return res.end('bad id'); }
        const { setVerdict } = await import('../factory/src/curation.ts');
        const c = setVerdict(id, verdict ?? null, note);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, count: Object.keys(c).length }));
      });

      // 录制回写：/dev/record.html 录完一段 pose 就 POST 到这里，落到 assets/demo/
      server.middlewares.use('/__demo', async (req, res) => {
        const fail = (code: number, error: string) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error }));
        };
        if (req.method !== 'POST') return fail(405, 'POST only');
        const name = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0]);
        // 只认扁平文件名：没有点、没有斜杠 —— 路径穿越进不来
        if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) return fail(400, `片段名只能是 [a-z0-9_-]：${name}`);

        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const c of req) {
          bytes += (c as Buffer).length;
          if (bytes > 128 * 1024 * 1024) return fail(413, '超过 128MB，录太长了');
          chunks.push(c as Buffer);
        }
        const text = Buffer.concat(chunks).toString('utf8');
        let clip: { fps?: unknown; frames?: unknown; synthetic?: unknown };
        try { clip = JSON.parse(text); } catch (e) { return fail(400, `不是合法 JSON：${String(e)}`); }

        // 守住 T-16 的那条红线：这个口子只接受**录制**，不接受合成数据
        if (clip.synthetic !== undefined) return fail(400, '带 synthetic 标记的数据不许写进 assets/demo/');
        const frames = clip.frames;
        if (!Array.isArray(frames) || !frames.length) return fail(400, 'frames 是空的');
        if (!frames.some((f) => Array.isArray((f as { world?: unknown })?.world) && (f as { world: unknown[] }).world.length)) {
          return fail(400, '整段里一帧都没有人 —— 这份数据没用，别存');
        }
        if (typeof clip.fps !== 'number' || clip.fps <= 0) return fail(400, 'fps 必须是正数');

        const file = `${name.startsWith('pose-') ? name : `pose-${name}`}.json`;
        mkdirSync(DEMO_DIR, { recursive: true });
        writeFileSync(resolve(DEMO_DIR, file), text);
        const count = writeDemoIndex();
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, path: `assets/demo/${file}`, bytes, clips: count }));
      });

      // 慢回路：本机 dev 可用，局域网请求一律是结构化 404。花钱的口子不跟 `--host` 一起暴露。
      mountSlow(server.middlewares, 'dev');

      mountArchive(server.middlewares);

      // 手动丢进 assets/demo/ 的文件也要被认到：每次起 dev server 重扫一遍
      try { writeDemoIndex(); } catch (e) { console.warn('[sb] /demo/index.json 生成失败：', e); }
    },

    /**
     * 普通 `vite preview` 仍给 `/__slow/*` 结构化 404；只有现场启动命令显式给
     * `SLOW_ENABLE=1` 才挂同一份 handler。线上静态托管不跑 preview hook，仍然没有慢回路。
     */
    configurePreviewServer(server) {
      // 存档在 preview 上**存在**，这一点和 `/__slow` 正好相反 —— 理由见 mountArchive()
      mountArchive(server.middlewares);

      mountSlow(server.middlewares, 'preview');
    },
  };
}

/**
 * 只把**运行时真正要的**资产复制进 dist。
 *
 * 为什么不用 publicDir 指向 assets/：那样会把 `assets/raw/`（Rodin 原始件，带贴图，
 * 929 MB）一起打进产物。`docs/13 §2` 早就写了"raw 绝不进 dist"，
 * 但没人验证过 —— 直到真跑了一次 build，产物是 975 MB。
 * 规格写了不等于做到了（§craft）。
 */
// 'sound' 里是四个离散接触音，共约 8KB —— 见 assets/sound/README.md。
const SHIPPED = ['parts', 'refs', 'demo', 'fonts', 'sound'];

/** 展出页与工作台页的入口脚本挡住第一帧，首页除外。理由在 `build/render-blocking.ts` */
function renderBlockingEntries(): Plugin {
  return {
    name: 'sb-render-blocking-entries',
    apply: 'build',
    transformIndexHtml: { order: 'post', handler: (html, ctx) => blockRender(html, ctx.filename) },
  };
}

function shipAssets(): Plugin {
  return {
    name: 'sb-ship-assets',
    apply: 'build',
    closeBundle() {
      const out = resolve(__dirname, 'dist');
      for (const dir of SHIPPED) {
        const from = resolve(ROOT, 'assets', dir);
        if (!existsSync(from)) continue;
        cpSync(from, resolve(out, dir), {
          recursive: true,
          // _metas.json 是流水线的中间产物，运行时只读 parts.json；
          // assets/sound/licenses/ 是授权证据（四张下载页截图，约 660KB），
          // 留在仓库里给人查，**不进运行时** —— 素材本身才 8KB，
          // 把证据一起打进去等于让产物为一件观众永远不会加载的东西变大 80 倍。
          // 哪些绝不进 dist（含观众剪影原图与装置本机存档）见 build/ship-filter.ts
          filter: shouldShip,
        });
      }
    },
  };
}

/**
 * 搜索、社交卡与机器阅读层。
 *
 * 关键元数据在 build 时就进 HTML，而不是等 JS 启动后再补；同一份
 * `discovery.ts` 同时生成 sitemap / robots / manifest / LLM 地图，防止 URL 漂移。
 */
function siteDiscovery(): Plugin {
  return {
    name: 'sb-site-discovery',
    transformIndexHtml: {
      order: 'pre',
      handler: (html, ctx) => injectDiscovery(html, ctx.filename),
    },
    closeBundle() {
      const out = resolve(__dirname, 'dist');
      mkdirSync(out, { recursive: true });
      for (const [name, body] of Object.entries(discoveryFiles())) {
        writeFileSync(resolve(out, name), body);
      }

      const media = [
        ['src/site/assets/see-me-see-u.svg', 'icons/see-me-see-u.svg'],
        ['src/site/assets/see-me-see-u-stage.png', 'social/see-me-see-u-stage.png'],
      ] as const;
      for (const [from, to] of media) {
        const target = resolve(out, to);
        mkdirSync(resolve(target, '..'), { recursive: true });
        copyFileSync(resolve(__dirname, from), target);
      }
    },
  };
}

export default defineConfig({
  root: __dirname,
  // dev 下 assets/ 整个作为静态根（/raw/ 在 anchor 渲染时要用）；
  // build 时改由 shipAssets() 只复制 SHIPPED 里那几个目录。
  publicDir: process.env.NODE_ENV === 'production' ? false : resolve(__dirname, '../../assets'),
  plugins: [demoIndex(), anchorWriter(), shipAssets(), siteDiscovery(), renderBlockingEntries()],
  server: { port: 5173, host: true, fs: { allow: [ROOT] } },
  // 姿态推理的 worker（`capture/pose-worker.ts`）必须是 ES module worker：
  // MediaPipe 在 module worker 里走 `import()` 加载 wasm 胶水层，而经典胶水层只是一个顶层 `var`，
  // 到了 module 作用域里就找不到了 —— 所以 worker 用 `_module` 那一份（它自己挂 globalThis）。
  // Vite 构建时默认把 worker 打成 iife（经典 worker），dev 下却是 module：两边不一样，只能写死 es。
  worker: { format: 'es' },
  build: {
    target: 'esnext',
    outDir: 'dist',
    // Vite 默认只把 root 下的 index.html 当入口。`/dev/*.html` 因此**从来没有
    // 进过 dist** —— 本机 dev server 上好好的，部署上去全是 404。
    // 这是"规格写了不等于做到了"的又一次（§craft）：docs/13 里链着这些页面，
    // 而线上一个都打不开。全部显式列进 input。
    rollupOptions: { input: pages() },
  },
});

/**
 * 入口清单 = 根目录下的每一个 .html（主程序 + 展陈层：护照、目录、自述…）
 * 加 `dev/` 下的每一个 .html（工具页）。
 *
 * 扫目录而不是写死名单，有两个各自独立的理由：
 * - dev 工具页一直**没有进过 dist** —— 本机好好的，线上全 404，
 *   因为 Vite 默认只认 root 的 index.html。新增一页的人不会记得回来改构建配置。
 * - 展陈层的页面是分几条线并行加出来的。写死名单既是 merge 冲突点，
 *   也是同一类"加了但没进构建"的错。
 * 放一个 html 进来就是一页，没有第二处登记。
 */
function pages(): Record<string, string> {
  const input: Record<string, string> = {};
  const scan = (dir: string, prefix: string) => {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.html')) continue;
      const base = file.replace(/\.html$/, '');
      input[`${prefix}${base === 'index' && !prefix ? 'main' : base}`] = resolve(dir, file);
    }
  };
  scan(__dirname, '');
  scan(resolve(__dirname, 'dev'), 'dev-');
  return input;
}
