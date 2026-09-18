// Automatic-people browser acceptance. Raw CDP, no browser-test dependency.
//
// node accept.ts <baseUrl> <outDir> <single-person.y4m> [maxRecordSec=24]
//
// Runs the same synthetic single-person camera twice, serially: first through the
// pose worker, then through the `?worker=off` main-thread fallback. This is a
// functional acceptance for automatic people scheduling, not evidence about a
// real camera, distance, occlusion, or target-machine performance.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPTURE, PEOPLE } from '../../packages/core/src/tuning.ts';

type InferencePath = 'worker' | 'main';
type ProbePhase = 'idle' | 'probing';

interface TrackSnapshot {
  id: number;
  missing: number;
  selected: boolean;
  primary: boolean;
}

interface PeopleSnapshot {
  primary: number | null;
  primarySkeleton: unknown | null;
  companions: unknown[];
  tracks: TrackSnapshot[];
}

interface PageSnapshot {
  href: string;
  now: number;
  rafCount: number;
  hud: string | null;
  people: PeopleSnapshot | null;
}

interface Sample {
  atMs: number;
  phase: ProbePhase | null;
  inferencePath: InferencePath | null;
  inferenceHz: number | null;
  selected: number | null;
  confirmedCap: number | null;
  primary: number | null;
  primarySkeleton: boolean;
  visibleSelected: number;
  companions: number;
  rafCount: number;
}

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

interface RunReport {
  schemaVersion: 1;
  runId: string;
  mode: InferencePath;
  pass: boolean;
  url: string;
  browser: string | null;
  targetArtifact: TargetArtifact | null;
  readyAfterMs: number | null;
  probeStartMs: number | null;
  probeEndMs: number | null;
  inferenceHz: { before: number | null; probing: number | null; after: number | null };
  raf: { samples: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; maxMs: number | null };
  checks: Check[];
  samples: Sample[];
  console: string[];
  exceptions: string[];
  error: string | null;
}

interface TargetArtifact {
  finalUrl: string;
  document: { sha256: string; bytes: number };
  scripts: { url: string; sha256: string; bytes: number }[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const [baseArg, outArg, fixtureArg, recordArg = '24'] = process.argv.slice(2);
const failUsage = (message: string): never => {
  console.error(`${message}\nusage: node scripts/people/accept.ts <baseUrl> <outDir> <single-person.y4m> [maxRecordSec=24]`);
  process.exit(1);
};

if (!baseArg || !outArg || !fixtureArg) failUsage('missing baseUrl, outDir, or fake-camera fixture');
const baseUrl = (() => {
  try {
    const parsed = new URL(baseArg);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('not http(s)');
    return parsed;
  } catch {
    return failUsage(`invalid baseUrl: ${baseArg}`);
  }
})();
const recordSeconds = Number(recordArg);
if (!Number.isFinite(recordSeconds) || recordSeconds < 20) {
  failUsage(`maxRecordSec must be at least 20: ${recordArg}`);
}

const outDir = resolve(outArg);
const fixture = resolve(fixtureArg);
mkdirSync(outDir, { recursive: true });
// summary.json is the completion marker. Remove only this tool's known outputs
// before every attempt so a rejected or interrupted rerun cannot inherit an old
// PASS from a reused directory.
for (const name of ['invocation.json', 'worker.json', 'main.json', 'summary.json']) {
  rmSync(join(outDir, name), { force: true });
}
const startedAt = new Date().toISOString();
const runId = `${startedAt.replace(/[^\dTZ]/g, '')}-${process.pid}`;
const gitText = (args: string[]): string | null => {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};
const sourceStatus = gitText(['status', '--porcelain=v1']);
const chromePath = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const host = {
  logicalCpus: availableParallelism(),
  loadAverage: loadavg(),
};
writeFileSync(join(outDir, 'invocation.json'), `${JSON.stringify({
  schemaVersion: 1,
  runId,
  startedAt,
  runnerSource: { commit: gitText(['rev-parse', 'HEAD']), dirty: sourceStatus === null ? null : sourceStatus.length > 0 },
  target: { baseUrl: baseUrl.href, modes: ['worker', 'main'], people: 'auto' },
  workload: { fixture, maxRecordSeconds: recordSeconds, syntheticSinglePerson: true },
  browser: { executable: chromePath, headed: process.env.HEADED === '1', cadence: 'display' },
  host,
}, null, 2)}\n`);

if (!existsSync(fixture)) {
  console.error(
    `missing fake-camera fixture: ${fixture}\n`
    + 'Generate it with: python3 scripts/people/figures.py assets/demo/pose-jumpingjacks.json /tmp/smu-single.y4m 1 20',
  );
  process.exit(1);
}
if (!existsSync(chromePath)) {
  console.error(`Chrome executable not found: ${chromePath}\nSet CHROME=/absolute/path/to/chrome.`);
  process.exit(1);
}

// This script asserts latency, cadence and stalls. A saturated host cannot
// distinguish a product regression from unrelated machine contention. Refuse
// to manufacture that false conclusion; invocation.json still records the
// evidence needed to rerun on an idle machine. Windows reports loadavg as 0.
const loadPerCpu = host.loadAverage[0] / Math.max(1, host.logicalCpus);
if (loadPerCpu > 2) {
  console.error(
    `host too busy for performance acceptance: load ${host.loadAverage[0].toFixed(1)} / `
    + `${host.logicalCpus} CPUs = ${loadPerCpu.toFixed(1)} per CPU (limit 2.0)`,
  );
  process.exit(2);
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const activeChrome = new Set<ReturnType<typeof spawn>>();
const activeProfiles = new Set<string>();
let shuttingDown = false;
const cleanupAndExit = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  const children = [...activeChrome];
  for (const child of children) {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
  await Promise.all(children.map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try { await Promise.race([once(child, 'exit'), sleep(2_000)]); } catch { /* cleanup still continues */ }
  }));
  for (const profile of activeProfiles) rmSync(profile, { recursive: true, force: true });
  process.exit(130);
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void cleanupAndExit(); });
}

const describe = (error: unknown): string => error instanceof Error ? error.message : String(error);
const median = (values: number[]): number | null => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const percentile = (values: number[], p: number): number | null => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null;
};
const fixed = (value: number | null, digits = 1): string => value === null ? 'missing' : value.toFixed(digits);

function acceptanceUrl(base: URL, mode: InferencePath): string {
  // The caller may host the app below a path. Keep that exact target rather
  // than silently measuring the origin root.
  const url = new URL(base.href);
  url.search = '';
  url.hash = '';
  const values: Record<string, string> = {
    theme: 'athlete', seed: '7', debug: '1', loading: '0', wave: 'off',
    theseus: 'off', arc: '900', people: 'auto',
  };
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  if (mode === 'main') url.searchParams.set('worker', 'off');
  return url.href;
}

async function devtoolsPort(profile: string, launchError: () => string | null): Promise<number> {
  const path = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 120; i++) {
    const problem = launchError();
    if (problem) throw new Error(`Chrome failed to launch: ${problem}`);
    if (existsSync(path)) {
      const port = Number(readFileSync(path, 'utf8').split(/\r?\n/)[0]);
      if (Number.isInteger(port) && port > 0) return port;
    }
    await sleep(100);
  }
  throw new Error('Chrome did not create DevToolsActivePort within 12s');
}

async function pageTarget(port: number): Promise<{ webSocketDebuggerUrl: string }> {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1_000) });
      const list = await response.json() as {
        type: string; webSocketDebuggerUrl?: string;
      }[];
      const page = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return { webSocketDebuggerUrl: page.webSocketDebuggerUrl };
    } catch { /* DevTools HTTP endpoint is still starting */ }
    await sleep(100);
  }
  throw new Error('Chrome opened DevTools but no page target appeared');
}

const CDP_OPEN_TIMEOUT_MS = 10_000;
const CDP_COMMAND_TIMEOUT_MS = 10_000;

async function connect(wsUrl: string): Promise<{
  ws: WebSocket;
  send(method: string, params?: object): Promise<Record<string, unknown>>;
  evaluate<T>(expression: string): Promise<T>;
  onEvent(fn: (message: Record<string, any>) => void): void;
}> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolveOpen, rejectOpen) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
    };
    const onOpen = (): void => { cleanup(); resolveOpen(); };
    const onError = (): void => { cleanup(); rejectOpen(new Error('CDP WebSocket failed to open')); };
    const timer = setTimeout(() => {
      cleanup();
      try { ws.close(); } catch { /* opening socket may not be closable yet */ }
      rejectOpen(new Error(`CDP WebSocket did not open within ${CDP_OPEN_TIMEOUT_MS}ms`));
    }, CDP_OPEN_TIMEOUT_MS);
    ws.addEventListener('open', onOpen, { once: true });
    ws.addEventListener('error', onError, { once: true });
  });
  let nextId = 0;
  const pending = new Map<number, {
    resolve(value: Record<string, unknown>): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const listeners: ((message: Record<string, any>) => void)[] = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as Record<string, any>;
    const responseId = typeof message.id === 'number' ? message.id : null;
    if (responseId !== null) {
      const waiter = pending.get(responseId);
      if (waiter) {
        pending.delete(responseId);
        clearTimeout(waiter.timer);
        if (message.error) waiter.reject(new Error(`CDP ${message.error.message ?? 'command failed'}`));
        else waiter.resolve(message);
      }
    }
    if (message.method) for (const listener of listeners) listener(message);
  });
  ws.addEventListener('close', () => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('CDP WebSocket closed'));
    }
    pending.clear();
  });
  const send = (method: string, params: object = {}): Promise<Record<string, unknown>> => new Promise((resolveSend, rejectSend) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      if (!pending.delete(id)) return;
      rejectSend(new Error(`CDP ${method} timed out after ${CDP_COMMAND_TIMEOUT_MS}ms`));
    }, CDP_COMMAND_TIMEOUT_MS);
    pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
    try { ws.send(JSON.stringify({ id, method, params })); }
    catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      rejectSend(new Error(describe(error)));
    }
  });
  const evaluate = async <T>(expression: string): Promise<T> => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    const result = (response.result as Record<string, any> | undefined)?.result as Record<string, any> | undefined;
    if (result?.subtype === 'error') throw new Error(result.description ?? 'page evaluation failed');
    return result?.value as T;
  };
  return { ws, send, evaluate, onEvent: (fn) => listeners.push(fn) };
}

async function fingerprintTarget(cdp: Awaited<ReturnType<typeof connect>>): Promise<TargetArtifact> {
  const runtime = await cdp.evaluate<{ href: string; html: string; scripts: string[] }>(`({
    href: location.href,
    html: document.documentElement.outerHTML,
    scripts: [...document.scripts].map((script) => script.src).filter(Boolean),
  })`);
  const scripts = await Promise.all(runtime.scripts.map(async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(CDP_COMMAND_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`entry script fingerprint failed: ${response.status} ${url}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { url, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength };
  }));
  return {
    finalUrl: runtime.href,
    document: {
      sha256: createHash('sha256').update(runtime.html).digest('hex'),
      bytes: Buffer.byteLength(runtime.html),
    },
    scripts,
  };
}

const SNAPSHOT = `(() => {
  const hud = [...document.querySelectorAll('div')].find((el) => el.textContent?.startsWith('fps'));
  const probe = globalThis.__peopleAcceptance;
  return {
    href: location.href,
    now: performance.now(),
    rafCount: Array.isArray(probe?.raf) ? probe.raf.length : 0,
    hud: hud?.textContent ?? null,
    people: globalThis.__people ? JSON.parse(JSON.stringify(globalThis.__people)) : null,
  };
})()`;

function parseSample(snapshot: PageSnapshot, atMs: number): Sample {
  const hud = snapshot.hud ?? '';
  const phase = /probe:(idle|probing)/.exec(hud)?.[1] as ProbePhase | undefined;
  const inferencePath = /infer@(worker|main)/.exec(hud)?.[1] as InferencePath | undefined;
  const inferenceHz = Number(/infer\s+([\d.]+)\s*Hz/.exec(hud)?.[1]);
  const peopleHead = /people\s+(\d+)\/(\d+)\s*人/.exec(hud);
  const tracks = snapshot.people?.tracks ?? [];
  return {
    atMs,
    phase: phase ?? null,
    inferencePath: inferencePath ?? null,
    inferenceHz: Number.isFinite(inferenceHz) ? inferenceHz : null,
    selected: peopleHead ? Number(peopleHead[1]) : null,
    confirmedCap: peopleHead ? Number(peopleHead[2]) : null,
    primary: snapshot.people?.primary ?? null,
    primarySkeleton: snapshot.people?.primarySkeleton != null,
    visibleSelected: tracks.filter((track) => track.selected && track.missing === 0).length,
    companions: snapshot.people?.companions?.length ?? 0,
    rafCount: snapshot.rafCount,
  };
}

async function runCase(mode: InferencePath): Promise<RunReport> {
  const url = acceptanceUrl(baseUrl, mode);
  const samples: Sample[] = [];
  const consoleLog: string[] = [];
  const exceptions: string[] = [];
  const checks: Check[] = [];
  const profile = mkdtempSync(join(tmpdir(), `smu-people-${mode}-`));
  activeProfiles.add(profile);
  let chrome: ReturnType<typeof spawn> | null = null;
  let cdp: Awaited<ReturnType<typeof connect>> | null = null;
  let browser: string | null = null;
  let targetArtifact: TargetArtifact | null = null;
  let launchError: string | null = null;
  let technicalError: string | null = null;
  let topLevelNavigations = 0;
  let navigationBaseline: number | null = null;
  let fatal: string | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let readyAfterMs: number | null = null;
  let probeStartMs: number | null = null;
  let probeEndMs: number | null = null;
  let beforeHz: number | null = null;
  let probingHz: number | null = null;
  let afterHz: number | null = null;
  let rafIntervals: number[] = [];
  const launchedAt = Date.now();

  const addCheck = (name: string, pass: boolean, detail: string): void => {
    checks.push({ name, pass, detail });
  };

  try {
    chrome = spawn(chromePath, [
      ...(process.env.HEADED === '1' ? [] : ['--headless=new']),
      '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      '--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist',
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${fixture}`,
      '--window-size=1280,800', '--autoplay-policy=no-user-gesture-required', '--no-first-run', 'about:blank',
    ], { stdio: 'ignore' });
    activeChrome.add(chrome);
    chrome.once('error', (error) => { launchError = describe(error); });
    const port = await devtoolsPort(profile, () => launchError);
    const target = await pageTarget(port);
    cdp = await connect(target.webSocketDebuggerUrl);
    cdp.onEvent((message) => {
      if (message.method === 'Page.frameNavigated' && !message.params?.frame?.parentId) {
        topLevelNavigations++;
        if (navigationBaseline !== null && topLevelNavigations > navigationBaseline + 1) {
          fatal = `unexpected top-level reload (${topLevelNavigations - navigationBaseline - 1})`;
        }
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        const kind = String(message.params?.type ?? 'log');
        const text = (message.params?.args ?? []).map((arg: Record<string, unknown>) => arg.value ?? arg.description ?? '').join(' ');
        consoleLog.push(`${kind} ${String(text).slice(0, 400)}`);
        if (kind === 'error') fatal ??= `console.error: ${String(text).slice(0, 240)}`;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const text = JSON.stringify(message.params?.exceptionDetails ?? {}).slice(0, 600);
        exceptions.push(text);
        fatal ??= `uncaught page exception: ${text.slice(0, 240)}`;
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    const version = await cdp.send('Browser.getVersion');
    browser = String((version.result as Record<string, unknown> | undefined)?.product ?? 'unknown');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const probe = globalThis.__peopleAcceptance = { raf: [] };
      const frame = (now) => { probe.raf.push(now); requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    })();` });
    navigationBaseline = topLevelNavigations;
    await cdp.send('Page.navigate', { url });

    const expectedPath = mode;
    let readySnapshot: PageSnapshot | null = null;
    const startupDeadline = Date.now() + 180_000;
    while (Date.now() < startupDeadline) {
      if (fatal) throw new Error(fatal);
      const snapshot = await cdp.evaluate<PageSnapshot>(SNAPSHOT);
      const sample = parseSample(snapshot, 0);
      if (sample.inferencePath === expectedPath && sample.primary !== null && sample.primarySkeleton && sample.phase === 'idle') {
        readySnapshot = snapshot;
        break;
      }
      await sleep(250);
    }
    if (!readySnapshot) throw new Error(`page did not reach stable single-person ${mode} idle state within 180s`);
    if (readySnapshot.href !== url) throw new Error(`URL drift before measurement: ${readySnapshot.href}`);
    if (topLevelNavigations !== navigationBaseline + 1) {
      throw new Error(`expected one initial navigation, observed ${topLevelNavigations - navigationBaseline}`);
    }
    targetArtifact = await fingerprintTarget(cdp);
    if (targetArtifact.finalUrl !== url) throw new Error(`artifact URL drift: ${targetArtifact.finalUrl}`);
    readyAfterMs = Date.now() - launchedAt;
    const readyAt = Date.now();
    const firstRaf = readySnapshot.rafCount;
    let lastRafCount = firstRaf;
    let lastRafAdvanceAt = Date.now();

    watchdog = setInterval(() => {
      if (Date.now() - lastRafAdvanceAt <= 2_000 || fatal) return;
      fatal = `rAF stalled for ${Date.now() - lastRafAdvanceAt}ms`;
      try { chrome?.kill('SIGKILL'); } catch { /* force the stuck CDP request to reject */ }
    }, 100);

    const deadline = readyAt + recordSeconds * 1_000;
    while (Date.now() < deadline) {
      if (fatal) throw new Error(fatal);
      const snapshot = await cdp.evaluate<PageSnapshot>(SNAPSHOT);
      if (snapshot.href !== url) throw new Error(`URL drift during measurement: ${snapshot.href}`);
      if (snapshot.rafCount > lastRafCount) {
        lastRafCount = snapshot.rafCount;
        lastRafAdvanceAt = Date.now();
      }
      const atMs = Date.now() - readyAt;
      const sample = parseSample(snapshot, atMs);
      samples.push(sample);
      if (sample.phase === 'probing' && probeStartMs === null) probeStartMs = atMs;
      if (probeStartMs !== null && sample.phase === 'idle' && probeEndMs === null) probeEndMs = atMs;
      if (probeEndMs !== null && atMs - probeEndMs >= 3_000) break;
      await sleep(100);
    }
    if (fatal) throw new Error(fatal);
    if (probeStartMs === null || probeEndMs === null) {
      throw new Error(`auto probe did not complete idle→probing→idle within ${recordSeconds}s`);
    }

    const allRaf = await cdp.evaluate<number[]>('globalThis.__peopleAcceptance?.raf?.slice() ?? []');
    const measuredRaf = allRaf.slice(Math.max(0, firstRaf - 1));
    rafIntervals = measuredRaf.slice(1).map((time, i) => time - measuredRaf[i]);

    const before = samples.filter((sample) => sample.atMs >= 500 && sample.atMs <= probeStartMs! - 200);
    const probing = samples.filter((sample) => sample.atMs >= probeStartMs! + 1_000 && sample.atMs <= probeEndMs! - 100);
    const after = samples.filter((sample) => sample.atMs >= probeEndMs! + 1_000);
    beforeHz = median(before.flatMap((sample) => sample.inferenceHz === null ? [] : [sample.inferenceHz]));
    probingHz = median(probing.flatMap((sample) => sample.inferenceHz === null ? [] : [sample.inferenceHz]));
    afterHz = median(after.flatMap((sample) => sample.inferenceHz === null ? [] : [sample.inferenceHz]));

    const expectedInitialFloor = Math.max(1_800, PEOPLE.probeInitialDelaySeconds * 1_000 - 800);
    const probeDuration = probeEndMs - probeStartMs;
    const primaryIds = new Set(samples.flatMap((sample) => sample.primary === null ? [] : [sample.primary]));
    const stableSamples = samples.length || 1;
    const primaryCoverage = samples.filter((sample) => sample.primary !== null && sample.primarySkeleton).length / stableSamples;
    const oneVisibleCoverage = samples.filter((sample) => sample.visibleSelected === 1).length / stableSamples;
    const steadyMin = CAPTURE.targetHz * 0.7;
    const probeMin = PEOPLE.probeInferenceHz * 0.65;
    const probeMax = PEOPLE.probeInferenceHz * 1.25;

    addCheck('inference path', samples.every((sample) => sample.inferencePath === expectedPath), `expected ${expectedPath}`);
    addCheck('probe phase sequence', probeStartMs > 0 && probeEndMs > probeStartMs, `idle→probing @${probeStartMs}ms→idle @${probeEndMs}ms`);
    addCheck('single-person settling delay', probeStartMs >= expectedInitialFloor, `${probeStartMs}ms >= ${expectedInitialFloor}ms`);
    addCheck(
      'bounded probe window',
      probeDuration >= PEOPLE.probeWindowSeconds * 1_000 * 0.65 && probeDuration <= PEOPLE.probeWindowSeconds * 1_000 * 1.5,
      `${probeDuration}ms around ${PEOPLE.probeWindowSeconds * 1_000}ms`,
    );
    addCheck('enough cadence samples', before.length >= 5 && probing.length >= 5 && after.length >= 5, `before=${before.length} probing=${probing.length} after=${after.length}`);
    addCheck('steady cadence before probe', beforeHz !== null && beforeHz >= steadyMin, `${fixed(beforeHz)}Hz >= ${steadyMin.toFixed(1)}Hz`);
    addCheck('probe cadence', probingHz !== null && probingHz >= probeMin && probingHz <= probeMax, `${fixed(probingHz)}Hz in ${probeMin.toFixed(1)}..${probeMax.toFixed(1)}Hz`);
    addCheck('steady cadence recovered', afterHz !== null && afterHz >= steadyMin, `${fixed(afterHz)}Hz >= ${steadyMin.toFixed(1)}Hz`);
    addCheck(
      'probe is materially cheaper',
      beforeHz !== null && probingHz !== null && afterHz !== null && probingHz <= Math.min(beforeHz, afterHz) * 0.8,
      `${fixed(beforeHz)}→${fixed(probingHz)}→${fixed(afterHz)}Hz`,
    );
    addCheck('confirmed cap remains one', samples.every((sample) => sample.confirmedCap === 1 && sample.selected === 1), 'HUD stayed 1/1');
    addCheck('one stable primary id', primaryIds.size === 1, `ids=${[...primaryIds].join(',') || 'none'}`);
    addCheck('primary skeleton continuity', primaryCoverage >= 0.9, `${(primaryCoverage * 100).toFixed(1)}% samples`);
    addCheck('one visible selected track', oneVisibleCoverage >= 0.9 && samples.every((sample) => sample.visibleSelected <= 1), `${(oneVisibleCoverage * 100).toFixed(1)}% samples, never >1`);
    addCheck('no companion body', samples.every((sample) => sample.companions === 0), 'companions stayed empty');
    addCheck('no reload', topLevelNavigations === navigationBaseline + 1, `${topLevelNavigations - navigationBaseline - 1} extra navigation(s)`);
    addCheck('no uncaught error', exceptions.length === 0 && !consoleLog.some((line) => line.startsWith('error ')), `${exceptions.length} exceptions`);
    addCheck('no rAF stall', rafIntervals.length > 0 && Math.max(...rafIntervals) < 2_000, `max ${fixed(rafIntervals.length ? Math.max(...rafIntervals) : null)}ms`);
  } catch (error) {
    // The watchdog deliberately kills Chrome to break a CDP call that cannot
    // return while the renderer is stuck. Preserve that causal diagnosis;
    // “WebSocket closed” is only the cleanup symptom.
    technicalError = fatal ?? describe(error);
    addCheck('run completed', false, technicalError);
  } finally {
    if (watchdog) clearInterval(watchdog);
    try { cdp?.ws.close(); } catch { /* already closed */ }
    if (chrome) {
      activeChrome.delete(chrome);
      if (chrome.exitCode === null && chrome.signalCode === null) {
        try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
        try { await Promise.race([once(chrome, 'exit'), sleep(2_000)]); } catch { /* cleanup still continues */ }
      }
    }
    rmSync(profile, { recursive: true, force: true });
    activeProfiles.delete(profile);
  }

  const report: RunReport = {
    schemaVersion: 1,
    runId,
    mode,
    pass: technicalError === null && checks.length > 0 && checks.every((check) => check.pass),
    url,
    browser,
    targetArtifact,
    readyAfterMs,
    probeStartMs,
    probeEndMs,
    inferenceHz: { before: beforeHz, probing: probingHz, after: afterHz },
    raf: {
      samples: rafIntervals.length,
      p50Ms: percentile(rafIntervals, 0.5),
      p95Ms: percentile(rafIntervals, 0.95),
      p99Ms: percentile(rafIntervals, 0.99),
      maxMs: rafIntervals.length ? Math.max(...rafIntervals) : null,
    },
    checks,
    samples,
    console: consoleLog.slice(-100),
    exceptions,
    error: technicalError,
  };
  writeFileSync(join(outDir, `${mode}.json`), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const reports: RunReport[] = [];
for (const mode of ['worker', 'main'] as const) {
  console.log(`[people-auto] ${mode}: starting`);
  const report = await runCase(mode);
  reports.push(report);
  console.log(
    `[people-auto] ${mode}: ${report.pass ? 'PASS' : 'FAIL'} · `
    + `${fixed(report.inferenceHz.before)}→${fixed(report.inferenceHz.probing)}→${fixed(report.inferenceHz.after)}Hz`
    + `${report.error ? ` · ${report.error}` : ''}`,
  );
}

writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify({
  schemaVersion: 1,
  runId,
  pass: reports.every((report) => report.pass),
  reports: reports.map((report) => ({
    mode: report.mode,
    pass: report.pass,
    inferenceHz: report.inferenceHz,
    probeStartMs: report.probeStartMs,
    probeEndMs: report.probeEndMs,
    failedChecks: report.checks.filter((check) => !check.pass),
    error: report.error,
  })),
}, null, 2)}\n`);
process.exitCode = reports.every((report) => report.pass) ? 0 : 1;
