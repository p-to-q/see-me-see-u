// Capture smoothness probe. Raw CDP, no deps.
// node measure.ts <baseUrl> <outDir> <mode: swap|deeplink> [recordSec=45] [cpuThrottle=1] [warmCache=0]
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [base, out, mode = 'swap', recS = '45', throttle = '1', warm = '0'] = process.argv.slice(2);
// fileURLToPath 而不是 `.pathname`：路径里有非 ASCII（`今天`）时 pathname 是百分号编码的，
// Chrome 拿它找不到假摄像头的 y4m，摄像头那一路静静地 NotFoundError
const HERE = fileURLToPath(new URL('.', import.meta.url));
const videoFixture = process.env.VIDEO_FIXTURE ?? `${HERE}/figure.y4m`;
if (!existsSync(videoFixture)) {
  console.error(`missing fake-camera fixture: ${videoFixture}\nGenerate one with docs/48 §9, then pass VIDEO_FIXTURE=/absolute/path/file.y4m.`);
  process.exit(1);
}
mkdirSync(`${out}/shots`, { recursive: true });
const transientProfile = warm !== '1';
// 冷缓存运行不该在仓库里留下几十 MB 的 Chrome 状态。热缓存才用固定目录；需要并行或隔离时可显式改路径。
const profile = transientProfile
  ? mkdtempSync(join(tmpdir(), 'smu-capture-'))
  : (process.env.CAPTURE_PROFILE ?? `${HERE}/profile-warm`);
const port = 9350 + Math.floor(Math.random() * 100);
// 观众环境默认跟显示器节拍。解锁帧率是测“一帧的活有多重”的压力模式，不是现场复现口径：
// Chrome/Metal 在 128–205fps 下会出现正常 60/120Hz 路径没有的 compositor / rAF 停摆（docs/48 §10.6）。
const unbounded = process.env.UNBOUNDED === '1';
// HEADED=1 → 真窗口（不带 --headless）：分清"真卡死"还是"只在无头 Chrome 里卡"
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  ...(process.env.HEADED === '1' ? [] : ['--headless=new']), `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-video-capture=${videoFixture}`,
  ...(unbounded ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []),
  '--window-size=1280,800', '--autoplay-policy=no-user-gesture-required', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });
const kill = () => { try { chrome.kill('SIGKILL'); } catch { /* */ } };
const cleanupProfile = () => {
  if (transientProfile) rmSync(profile, { recursive: true, force: true });
};
process.once('exit', () => {
  kill();
  cleanupProfile();
});
// 被 kill 的时候也要带走 Chrome：否则那个孤儿 Chrome 占着 profile-warm，下一次起的 Chrome 直接交给它然后退出
//（症状只有一行 "no chrome"，实测踩过）
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { kill(); process.exit(130); });
setTimeout(() => { console.log('hard timeout'); kill(); process.exit(2); }, (Number(recS) + 150) * 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let target: { webSocketDebuggerUrl: string } | undefined;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(500);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as { type: string; webSocketDebuggerUrl: string }[];
    target = list.find((t) => t.type === 'page');
  } catch { /* not up */ }
}
if (!target) { console.log('no chrome'); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map<number, (v: any) => void>();
const listeners: ((m: any) => void)[] = [];
const consoleLog: string[] = [];
let topLevelNavigations = 0;
let guardedNavigationCount: number | null = null;
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
  if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) topLevelNavigations++;
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleLog.push(`${m.params.type} ${m.params.args.map((a: any) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
  }
  if (m.method === 'Runtime.exceptionThrown') consoleLog.push(`EXC ${JSON.stringify(m.params.exceptionDetails).slice(0, 300)}`);
  for (const l of listeners) l(m);
});
const send = (method: string, params: object = {}) => new Promise<any>((r) => {
  const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJs = async (expression: string): Promise<any> => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
const browserVersion = (await send('Browser.getVersion')).result?.product ?? 'unknown';
const reloadGuard = setInterval(() => {
  if (guardedNavigationCount === null || topLevelNavigations <= guardedNavigationCount) return;
  const report = `unexpected top-level reload: ${topLevelNavigations - guardedNavigationCount}\n\nconsole tail:\n${consoleLog.slice(-40).join('\n')}\n`;
  console.error('RELOAD after the measured page became ready — this run failed');
  writeFileSync(`${out}/reload.txt`, report);
  clearInterval(reloadGuard);
  kill();
  process.exit(4);
}, 50);
if (Number(throttle) > 1) await send('Emulation.setCPUThrottlingRate', { rate: Number(throttle) });
// DPR=3 → 高 DPI 屏；NET=slow → 模型 / 部件走慢网（下行 1.6Mbps、150ms）
if (process.env.DPR) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: Number(process.env.DPR), mobile: false });
}
if (process.env.NET === 'slow') {
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200 * 1024, uploadThroughput: 100 * 1024 });
}
const QUERY = process.env.QUERY ? `&${process.env.QUERY}` : '';
// BYTES=1 → 按 docs/13 的口径数首屏：标签页 → 选择页 → 舞台出现为止的传输字节（encodedDataLength）
const bytes = { total: 0, requests: 0, byUrl: new Map<string, number>(), frozen: false };
if (process.env.BYTES === '1') {
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const urls = new Map<string, string>();
  listeners.push((m) => {
    if (bytes.frozen) return;
    if (m.method === 'Network.requestWillBeSent') urls.set(m.params.requestId, m.params.request.url);
    if (m.method === 'Network.loadingFinished') {
      const u = urls.get(m.params.requestId) ?? '?';
      bytes.total += m.params.encodedDataLength;
      bytes.requests++;
      bytes.byUrl.set(u, (bytes.byUrl.get(u) ?? 0) + m.params.encodedDataLength);
    }
  });
}

// In-page probe. Only observes; never touches the app.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
(() => {
  const P = window.__probe = { raf: [], lt: [], loaf: [], gum: null, firstVideoFrame: null, firstPose: null, videoInDom: null, click: null };
  const tick = (t) => { P.raf.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => P.lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => P.loaf.push({ s: Math.round(e.startTime), d: Math.round(e.duration), b: Math.round(e.blockingDuration),
    scripts: (e.scripts || []).map((x) => [String(x.sourceURL || '').split('/').pop(), x.sourceFunctionName, x.invoker, Math.round(x.duration)]) }))).observe({ type: 'long-animation-frame', buffered: true }); } catch {}
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => { const s = await orig(c); if (P.gum === null) P.gum = performance.now(); return s; };
  }
  const poll = () => {
    const v = document.querySelector('.sb-see video');
    if (v && P.videoInDom === null) P.videoInDom = performance.now();
    if (v && P.firstVideoFrame === null && v.readyState >= 2 && v.currentTime > 0) P.firstVideoFrame = performance.now();
    const r = document.querySelector('.sb-readout.is-present');
    if (P.gum !== null && r && P.firstPose === null) P.firstPose = performance.now();
    setTimeout(poll, 16);
  };
  poll();
})();` });

const waitFor = async (expr: string, ms: number): Promise<boolean> => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await evalJs(expr)) return true; await sleep(200); }
  return false;
};

const tNav = Date.now();
if (mode === 'swap') {
  await send('Page.navigate', { url: `${base}/?debug=1${QUERY}` });
  const entryReady = await waitFor(`!!document.querySelector('.sb-entry button.sb-act')`, 30000);
  console.log('entry', entryReady);
  if (!entryReady) { clearInterval(reloadGuard); kill(); process.exit(1); }
  // 从入口出现起，这个文档不该再做一次顶层导航。产品看门狗的重载也算失败，
  // 不能继续量重载后的深链页，再把第二次启动冒充第一次成功。
  guardedNavigationCount = topLevelNavigations;
  await sleep(1500);
  await evalJs(`document.querySelector('.sb-entry button.sb-act').click()`);
  await sleep(3500);
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  console.log('stage', await waitFor(`document.querySelectorAll('.sb-exits .sb-exit').length >= 3`, 60000), `${(Date.now() - tNav) / 1000}s`);
  if (process.env.BYTES === '1') {
    await sleep(3000);   // 舞台出现之后，预取的部件还在路上（main.ts 等它最多 2.5s）
    bytes.frozen = true;
    const top = [...bytes.byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([u, n]) => `${(n / 1024).toFixed(0)}KB ${u.replace(base, '')}`);
    const line = `first-load ${bytes.requests} requests ${(bytes.total / 1048576).toFixed(2)} MB\n${top.join('\n')}`;
    console.log(line);
    writeFileSync(`${out}/first-load.txt`, `${line}\n`);
    if (process.env.BYTES_ONLY === '1') { ws.close(); kill(); process.exit(0); }
  }
  // 读数默认收着、收着时不写 DOM —— 打开它，is-present 才是首个姿态的证据
  // STEPS=1 → 每一步打一行（排查"卡在哪一步"：截图要等页面出一帧，页面不出帧时它永远不返回）
  const step = (s: string) => { if (process.env.STEPS === '1') console.log(`step ${((Date.now() - tNav) / 1000).toFixed(1)}s ${s}`); };
  step('before readout click');
  await evalJs(`document.querySelector('.sb-readout-bar')?.click()`);
  step('after readout click');
  await sleep(6000);   // replay settles
  step(`raf count ${await evalJs('window.__probe.raf.length')}`);
} else {
  await send('Page.navigate', { url: `${base}/?theme=porcelain&debug=1` });
  const pageReady = await waitFor(`location.search.includes('theme=porcelain') && document.readyState === 'complete'`, 30000);
  if (!pageReady) { clearInterval(reloadGuard); kill(); process.exit(1); }
  guardedNavigationCount = topLevelNavigations;
}

// Trace from here on（TRACE=1 才开：解开帧率后 45 秒的 trace 有 1.4GB，它自己就是负载）
const tracing = process.env.TRACE === '1';
const traceFile = `${out}/trace.json`;
const traceDone = new Promise<string>((res) => listeners.push((m) => { if (m.method === 'Tracing.tracingComplete') res(m.params.stream); }));
if (tracing) await send('Tracing.start', {
  transferMode: 'ReturnAsStream',
  traceConfig: {
    recordMode: 'recordContinuously',
    includedCategories: ['devtools.timeline', 'toplevel', 'blink.user_timing'],
  },
});
// PROFILE=1 → CDP 采样 profiler（200µs）从按下那一刻起：比 trace 小两个数量级，
// 帧循环里每一段长任务能拆到函数（`attribute.ts`）。和 TRACE 一样是负载，数字不进结论
const profiling = process.env.PROFILE === '1';
if (profiling) {
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 200 });
  await send('Profiler.start');
}
const clickPerf = await evalJs(`(performance.mark('probe:click'), performance.now())`);
// GOV_AT="20:4,32:0" → 按下后第 20 秒把调速器拨到 L4、第 32 秒拨回 L0（`?debug=1` 的 `__governorProbe`）。
// 拨开关本身是不是一次长任务，要在没有别的负载的时候单独看（docs/48 §8 第 3 条）
for (const spec of (process.env.GOV_AT ?? '').split(',').filter(Boolean)) {
  const [sec, lvl] = spec.split(':').map(Number);
  setTimeout(() => {
    void evalJs(`(window.__probe.gov = window.__probe.gov || [], window.__probe.gov.push([Math.round(performance.now()), ${lvl}]), window.__governorProbe?.apply(${lvl}))`);
  }, sec * 1000);
}
if (mode === 'swap') {
  // HOVER=1 → 观众先把手移到「摄像头」那一行上（悬停预取），停 HOVER_MS 再按
  if (process.env.HOVER === '1') {
    await evalJs(`document.querySelectorAll('.sb-exits .sb-exit')[2].dispatchEvent(new PointerEvent('pointerenter'))`);
    await sleep(Number(process.env.HOVER_MS ?? 1500));
  }
  // NOCLICK=1 → 只记下"按下"的时刻，不按。深链（`?theme=`）没有展签，开机就是摄像头 ——
  // 那时再按「摄像头」那一行是**关**摄像头，量出来的是回放，不是改前那一场的摄像头稳态
  if (process.env.STEPS === '1') {
    console.log(`step exits: ${JSON.stringify(await evalJs(`[...document.querySelectorAll('.sb-exits .sb-exit')].map((e, i) => i + ':' + (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30))`))}`);
  }
  if (process.env.NOCLICK === '1') await evalJs(`window.__probe.click = performance.now()`);
  else await evalJs(`(window.__probe.click = performance.now(), document.querySelectorAll('.sb-exits .sb-exit')[2].click())`);
} else {
  await evalJs(`window.__probe.click = performance.now()`);
}
console.log('clicked', clickPerf);

// ── 看门狗（docs/48 §10.6）：按下之后页面超过 WATCHDOG_MS（默认 2000，0 = 关）没出一帧 = 这一场失败。
// 卡死的页面上 Runtime.evaluate 永远不返回（截图也一样），脚本会一直挂到 hard timeout —— 那不是结论。
// 所以心跳只在上一次返回之后才发，另一个定时器看"rAF 计数最后一次增长是什么时候"。
// 判定卡死时先要一个 Debugger.pause 的栈（JS 在跑的死循环能被打断；卡在原生等待里拿不到，也照实写下来）。
const watchdogMs = Number(process.env.WATCHDOG_MS ?? 2000);
if (watchdogMs > 0) {
  let lastCount = -1;
  let lastAdvance = Date.now();
  let inflight = false;
  const beat = setInterval(() => {
    if (inflight) return;
    inflight = true;
    void evalJs('window.__probe.raf.length').then((n: number) => {
      inflight = false;
      if (typeof n === 'number' && n > lastCount) { lastCount = n; lastAdvance = Date.now(); }
    });
  }, 250);
  const dog = setInterval(async () => {
    const stalled = Date.now() - lastAdvance;
    if (stalled <= watchdogMs) return;
    clearInterval(dog); clearInterval(beat);
    console.log(`STALL no frame for ${stalled}ms at ${((Date.now() - tNav) / 1000).toFixed(1)}s after navigate (watchdog ${watchdogMs}ms)`);
    // 先看是不是"页面换了"：导航 / 预渲染激活之后 CDP 会话还挂在旧页面上，evaluate 和 pause 都不会回 ——
    // 看上去和卡死一模一样，而渲染进程其实闲着
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as { type: string; url: string; id: string }[];
      console.log(`targets: ${list.filter((t) => t.type === 'page').map((t) => `${t.id.slice(0, 6)} ${t.url}`).join(' | ')} (probe attached to ${target!.webSocketDebuggerUrl.split('/').pop()!.slice(0, 6)})`);
    } catch { /* */ }
    // 页面此刻的状态（JS 还活着时才回得来，给 3 秒）：rAF 停了而定时器照跑，原因一般在这几样里
    const diag = await Promise.race([
      evalJs(`(async () => {
        const raf = await Promise.race([new Promise((r) => requestAnimationFrame(() => r('raf fired'))), new Promise((r) => setTimeout(() => r('raf silent 1s'), 1000))]);
        const exits = [...document.querySelectorAll('.sb-exits .sb-exit')].map((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24));
        return JSON.stringify({ raf, vis: document.visibilityState, hidden: document.hidden, focus: document.hasFocus(),
          vt: !!document.activeViewTransition, ready: document.readyState, now: Math.round(performance.now()),
          exits, videos: [...document.querySelectorAll('video')].map((v) => [v.readyState, v.paused, Math.round(v.currentTime * 10) / 10]),
          canvases: document.querySelectorAll('canvas').length, lastRaf: Math.round(window.__probe.raf.at(-1) || 0),
          notice: (document.querySelector('.sb-notice') || {}).textContent || null });
      })()`),
      new Promise((r) => setTimeout(() => r('diag: no answer in 3s'), 3000)),
    ]);
    console.log(`page: ${diag}`);
    const paused = new Promise<any>((res) => {
      listeners.push((m) => { if (m.method === 'Debugger.paused') res(m.params); });
      setTimeout(() => res(null), 4000);
    });
    void send('Debugger.enable');
    void send('Debugger.pause');
    const p = await paused;
    const frames = p ? p.callFrames.slice(0, 25).map((f: any) =>
      `${f.functionName || '(anon)'} ${String(f.url).split('/').pop()}:${f.location.lineNumber + 1}:${f.location.columnNumber + 1}`) : [];
    const report = p ? `paused reason=${p.reason}\n${frames.join('\n')}` : 'Debugger.pause got no answer in 4s — main thread is not running JS (native wait / GPU / sync IPC)';
    console.log(report);
    writeFileSync(`${out}/stall.txt`, `${report}\n\nconsole tail:\n${consoleLog.slice(-40).join('\n')}\n`);
    // NATIVE_SAMPLE=1（macOS）：主线程不在跑 JS 时，用系统的 `sample` 取渲染进程和 GPU 进程的原生栈，各 3 秒
    if (process.env.NATIVE_SAMPLE === '1') {
      const { execFileSync } = await import('node:child_process');
      const ps = execFileSync('ps', ['-Ao', 'pid=,ppid=,command=']).toString().split('\n');
      const kids = ps.map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
        .filter((m) => Number(m[2]) === chrome.pid && /--type=(renderer|gpu-process)/.test(m[3]) && !/top-chrome-webui|extension-process/.test(m[3]));
      await Promise.all(kids.map((m) => new Promise<void>((res) => {
        const kind = /gpu-process/.test(m[3]) ? 'gpu' : 'renderer';
        const s = spawn('/usr/bin/sample', [m[1], '3', '-file', `${out}/sample-${kind}-${m[1]}.txt`], { stdio: 'ignore' });
        s.on('exit', () => res());
      })));
      console.log(`native samples: ${kids.length} processes → ${out}/sample-*.txt`);
    }
    kill();
    process.exit(3);
  }, 250);
}

// Screenshots of the top-left preview for the first 12 s (black-screen check)
const shots: string[] = [];
const tClick = Date.now();
let n = 0;
while (Date.now() - tClick < 12000) {
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 400, height: 330, scale: 0.5 } });
  const t = await evalJs(`performance.now()`);
  const name = `s${String(n++).padStart(3, '0')}.png`;
  writeFileSync(`${out}/shots/${name}`, Buffer.from(s.result.data, 'base64'));
  shots.push(`${name}\t${Math.round(t - clickPerf)}`);
  await sleep(150);
}
writeFileSync(`${out}/shots/index.tsv`, shots.join('\n') + '\n');
const remain = Number(recS) * 1000 - (Date.now() - tClick);
if (remain > 0) await sleep(remain);

if (tracing) {
  await send('Tracing.end');
  const stream = await traceDone;
  const fh = createWriteStream(traceFile);
  for (;;) {
    const r = await send('IO.read', { handle: stream, size: 4 << 20 });
    const chunk = r.result;
    fh.write(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data);
    if (chunk.eof) break;
  }
  fh.end();
  await send('IO.close', { handle: stream });
}

if (profiling) {
  const r = await send('Profiler.stop');
  writeFileSync(`${out}/profile.json`, JSON.stringify(r.result.profile));
}

const probe = await evalJs(`JSON.stringify(window.__probe)`);
writeFileSync(`${out}/probe.json`, probe);
const probeData = JSON.parse(probe) as { raf?: number[] };
const raf = probeData.raf ?? [];
const elapsedRaf = raf.length > 1 ? raf[raf.length - 1] - raf[0] : 0;
const measuredRafFps = elapsedRaf > 0 ? Number((((raf.length - 1) * 1000) / elapsedRaf).toFixed(1)) : null;
let maxRafGap = 0;
for (let i = 1; i < raf.length; i++) maxRafGap = Math.max(maxRafGap, raf[i] - raf[i - 1]);
writeFileSync(`${out}/run.json`, `${JSON.stringify({
  cadence: unbounded ? 'unbounded' : 'display',
  headed: process.env.HEADED === '1',
  browser: browserVersion,
  videoFixture,
  measuredRafFps,
  maxRafGapMs: Number(maxRafGap.toFixed(1)),
  rafSamples: raf.length,
}, null, 2)}\n`);
const hud = await evalJs(`[...document.querySelectorAll('body *')].find(e => e.children.length >= 6 && /fps/.test(e.textContent||''))?.textContent?.replace(/\\s+/g,' ')`);
writeFileSync(`${out}/console.txt`, consoleLog.join('\n') + `\nHUD ${hud}\n`);
console.log('done', out, `cadence=${unbounded ? 'unbounded' : 'display'}`, `raf=${measuredRafFps ?? 'n/a'}fps`, `max-gap=${maxRafGap.toFixed(1)}ms`);
clearInterval(reloadGuard);
ws.close();
kill();
await sleep(300);
cleanupProfile();
process.exit(0);
