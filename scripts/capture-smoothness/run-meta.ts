/**
 * 摄像头平滑度探针的“这一场到底测了什么”。
 *
 * 测量脚本会开 Chrome、改节流、点页面，不能被单测 import。这个文件只放
 * 纯的 URL / 参数 / 结果形状，让“两场是否真的只差一个变量”可以被机器判定。
 */

export type ProbeMode = 'swap' | 'deeplink';

/** UI 只向探针暴露语义，不暴露“恰好是第三行”这种排版偶然。 */
export const CAMERA_EXIT_SELECTOR = '.sb-exits .sb-exit[data-action="camera"]';

export function isProbeMode(value: string): value is ProbeMode {
  return value === 'swap' || value === 'deeplink';
}

/** QUERY 的命令行口径是 `seed=7&plan=...`；宽容地吃掉手滑加的 `?` / `&`。 */
export function normaliseQuery(value: string | undefined): string {
  return (value ?? '').replace(/^[?&]+/, '');
}

export function probeUrl(base: string, mode: ProbeMode, query = ''): string {
  const root = new URL('/', base);
  root.searchParams.set('debug', '1');
  if (mode === 'deeplink') root.searchParams.set('theme', 'porcelain');
  for (const [key, value] of new URLSearchParams(normaliseQuery(query))) root.searchParams.append(key, value);
  return root.href;
}

export interface GovernorPoint {
  atSeconds: number;
  level: number;
}

/** `20:4,26:5` 是实验计划，错一个字就该让整场失败，不该把 NaN 当成 0ms 执行。 */
export function parseGovernorSchedule(value: string | undefined, maxLevel = 7): GovernorPoint[] {
  if (!value?.trim()) return [];
  return value.split(',').map((raw) => {
    const match = /^(\d+(?:\.\d+)?):(\d+)$/.exec(raw.trim());
    if (!match) throw new Error(`invalid GOV_AT point: ${raw}`);
    const atSeconds = Number(match[1]);
    const level = Number(match[2]);
    if (!Number.isFinite(atSeconds) || atSeconds < 0 || !Number.isInteger(level) || level < 0 || level > maxLevel) {
      throw new Error(`invalid GOV_AT point: ${raw}`);
    }
    return { atSeconds, level };
  });
}

export interface ProbeRunManifestInput {
  source: { commit: string | null; dirty: boolean | null };
  target: { baseUrl: string; mode: ProbeMode; query: string; plannedUrl: string; finalUrl: string };
  browser: { product: string; userAgent: string | null; headed: boolean };
  workload: { videoFixture: string; recordSeconds: number };
  cache: { warmProfile: boolean; disabledByByteProbe: boolean };
  emulation: {
    cadence: 'display' | 'unbounded';
    viewport: { width: number; height: number; requestedDpr: number | null; actualDpr: number | null };
    cpuThrottle: number;
    network: { preset: 'native' | 'slow'; latencyMs: number; downloadBytesPerSecond: number; uploadBytesPerSecond: number };
  };
  actions: { noClick: boolean; hover: boolean; hoverMs: number | null; governorSchedule: GovernorPoint[] };
  measurement: { measuredRafFps: number | null; maxRafGapMs: number; rafSamples: number };
}

export function probeRunManifest(input: ProbeRunManifestInput): object {
  return { schemaVersion: 1, ...input };
}
