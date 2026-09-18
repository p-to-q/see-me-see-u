/**
 * ReplayCapture —— 从录制数据回放的 `Capture`（docs/06 §2、§6 的 `?demo=1`）。
 *
 * 存在的理由不是"方便开发"，是**现场兜底**：断网、逆光毁掉追踪、摄像头被占用、
 * 评委不敢上台，任何一条发生时都要能一键切到这里，而下游一行都不用改。
 * 所以它和 WebcamCapture 必须严格同构：同样非阻塞、同样绝不抛异常、
 * 同样在"没有人"的帧返回 null。
 *
 * 数据格式（`/demo/pose-*.json`，录制由 T-16 负责）：
 *   { "fps": 30, "frames": RawPose[] }   或者直接一个 RawPose[]
 * `frames[i].world` 是 **MediaPipe 原始坐标**，不是世界坐标 —— 回放不做任何转换，
 * 转换只允许发生在 core/skeleton.ts 的 mediapipeToWorld()（docs/04 §1）。
 */
import type { RawPose } from '../../../core/src/types.ts';
import { CAPTURE } from '../../../core/src/tuning.ts';
import { posePresent } from '../../../core/src/pose-signal.ts';
import { readFlags } from '../shell/kiosk.ts';
import { notePresence } from '../shell/idle.ts';
import type { Capture, CaptureStep } from './capture.ts';
import { synthPeople } from './people-synth.ts';

/** 找不到别的就用它。T-16 录到真数据后把真文件名写进 /demo/index.json */
const DEFAULT_CLIP = '/demo/pose-synthetic.json';
const INDEX = '/demo/index.json';

interface Clip { fps: number; frames: RawPose[]; }

export class ReplayCapture implements Capture {
  #clip: Clip | null = null;
  #latest: RawPose | null = null;
  #error: string | null = null;
  #running = false;
  #rafId = 0;
  #t0 = 0;
  #index = -1;
  #serveTimes: number[] = [];
  #fps = 0;
  #inferredAt = Number.NaN;

  /** 当前播的是哪个文件，dev 页面拿来显示 */
  source: string | null = null;

  readonly clipUrl: string | undefined;

  /** 启动里程碑（见 capture.ts 的 CaptureStep）。回放只有两件：挑到片段 / 片段到手 */
  #onStep: CaptureStep | null;
  static readonly START_STEPS = 2;

  constructor(clipUrl?: string, onStep?: CaptureStep) {
    this.clipUrl = clipUrl;
    this.#onStep = onStep ?? null;
  }

  #step(n: number): void {
    try { this.#onStep?.(n, ReplayCapture.START_STEPS); } catch { /* 显示用的旁路 */ }
  }

  get fps(): number { return this.#fps; }
  get lastError(): string | null { return this.#error; }
  /** 回放的"推理"就是出帧 —— 和 WebcamCapture 同构，姿态时钟不需要知道是哪一路 */
  get inferredAt(): number { return this.#inferredAt; }

  latest(): RawPose | null { return this.#latest; }

  /** 合成的其余几个人（`?people=` > 1 时，`people-synth.ts`）。**只给演示和工作台**：他们从没站在摄像头前面 */
  #all: RawPose[] = [];
  #people = (() => { try { return readFlags().people; } catch { return 1; } })();

  /**
   * 单人（`?people=1`）：`[latest()]`。多人：同一段录制错开取帧、摆到画面两侧（docs/50 §7 回放那一条）。
   * 第 0 个也换成摆好 `screen` 的那一份 —— 多人跟踪只读 `screen`，而录制没有它。
   */
  latestAll(): readonly RawPose[] {
    if (this.#people <= 1) return this.#latest ? [this.#latest] : [];
    return this.#all;
  }

  setPeople(n: number): void {
    this.#people = Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1;
    if (this.#people <= 1) this.#all = [];
  }

  /** 录制里没有 mask（慢回路在 demo 模式下本来就该关掉） */
  takeMask(): ImageBitmap | null { return null; }

  /** 永不 reject：加载失败只写 lastError，latest() 恒为 null */
  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      const url = this.clipUrl ?? (await pickClip());
      this.source = url;
      this.#step(1);
      this.#clip = await loadClip(url);
      this.#step(2);
      this.#t0 = performance.now();
      this.#loop();
    } catch (e) {
      this.#error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      this.#running = false;
    }
  }

  stop(): void {
    this.#running = false;
    if (this.#rafId) cancelAnimationFrame(this.#rafId);
    this.#rafId = 0;
    this.#latest = null;
    this.#fps = 0;
  }

  #loop = (): void => {
    if (!this.#running) return;
    this.#rafId = requestAnimationFrame(this.#loop);
    try {
      this.#serve();
    } catch (e) {
      this.#error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
  };

  #serve(): void {
    const clip = this.#clip;
    if (!clip || !clip.frames.length) return;
    const now = performance.now();
    // 墙钟驱动、循环播放：回放速度不跟渲染帧率走，跟录制时的 fps 走
    const i = Math.floor(((now - this.#t0) / 1000) * clip.fps) % clip.frames.length;
    if (i === this.#index) return;
    this.#index = i;

    const f = clip.frames[i];
    // score 低于门限 = 录制里那一段确实没人，照原样传下去（docs/06 §1 自己会判）
    this.#latest = f.world?.length ? { ...f, t: now } : null;
    this.#all = this.#people > 1 && this.#latest ? synthPeople(clip.frames, i, this.#people, now) : [];
    this.#inferredAt = now;
    // 和 WebcamCapture 同构：顺手把"有没有人"喂给无人降帧（shell/idle.ts）
    notePresence(posePresent(this.#latest), now);

    this.#serveTimes.push(now);
    while (this.#serveTimes.length && now - this.#serveTimes[0] > 1000) this.#serveTimes.shift();
    this.#fps = this.#serveTimes.length;
  }
}

/**
 * `?clip=` 的写法（三种都认，因为现场手打 URL 的人不会记得前缀）：
 *   `?clip=walkwave`                 → /demo/pose-walkwave.json
 *   `?clip=pose-walkwave.json`       → /demo/pose-walkwave.json
 *   `?clip=/demo/pose-walkwave.json` → 原样
 */
export function resolveClipUrl(asked: string): string {
  const s = asked.trim();
  if (!s) return DEFAULT_CLIP;
  if (s.startsWith('/') || /^https?:\/\//.test(s)) return s;
  const named = s.startsWith('pose-') ? s : `pose-${s}`;
  return `/demo/${named.endsWith('.json') ? named : `${named}.json`}`;
}

/** index.json 里的一条。只有 url 是必需的，其余是给自检页显示用的 */
export interface ClipEntry {
  url: string;
  name?: string;
  fps?: number;
  frames?: number;
  seconds?: number;
  /** 合成占位数据 = 不是录制 = 不算现场兜底（docs/11 T-16） */
  synthetic?: boolean;
}

/** 宽松解析：数组 of string / 数组 of 对象 / `{clips:[…]}` 都认 */
export function parseClipIndex(raw: unknown): ClipEntry[] {
  const list = Array.isArray(raw) ? raw : (raw as { clips?: unknown })?.clips;
  if (!Array.isArray(list)) return [];
  const out: ClipEntry[] = [];
  for (const item of list) {
    if (typeof item === 'string' && item) out.push({ url: resolveClipUrl(item), name: item });
    else if (item && typeof item === 'object') {
      const o = item as Partial<ClipEntry>;
      const url = typeof o.url === 'string' ? o.url : (typeof o.name === 'string' ? resolveClipUrl(o.name) : null);
      if (url) out.push({ ...o, url });
    }
  }
  return out;
}

/** 真录制排在合成占位前面 —— 默认永远不该挑到假数据 */
export function preferredClip(entries: ClipEntry[]): ClipEntry | null {
  return entries.find((e) => e.synthetic !== true) ?? entries[0] ?? null;
}

export async function fetchClipIndex(): Promise<ClipEntry[]> {
  try {
    const r = await fetch(INDEX);
    if (!r.ok) return [];
    return parseClipIndex(await r.json());
  } catch {
    return [];   // 没有 index 就走默认
  }
}

/** `?clip=` > /demo/index.json 里第一条**真录制** > 默认文件 */
async function pickClip(): Promise<string> {
  const asked = readFlags().clip;
  if (asked) return resolveClipUrl(asked);
  return preferredClip(await fetchClipIndex())?.url ?? DEFAULT_CLIP;
}

async function loadClip(url: string): Promise<Clip> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`回放数据取不到：${url} → HTTP ${r.status}`);
  const raw: unknown = await r.json();
  const frames = Array.isArray(raw) ? raw : (raw as { frames?: unknown })?.frames;
  if (!Array.isArray(frames) || !frames.length) throw new Error(`回放数据是空的：${url}`);
  const fps = (!Array.isArray(raw) && typeof (raw as { fps?: unknown }).fps === 'number')
    ? (raw as { fps: number }).fps
    : CAPTURE.targetHz;

  // 合成数据是按 docs/04 §1 那套**尚未实测**的轴向假设造出来的。
  // 用它来校准坐标转换，等于把假设当成证据 —— 所以每次加载都要吼一声。
  if (!Array.isArray(raw) && (raw as { synthetic?: unknown }).synthetic === true) {
    console.warn(
      `[replay] ${url} 是合成占位数据，不是录制。\n` +
      '它的轴向来自 docs/04 §1 尚未实测的假设，**不能**用来验证 U1/U2 或校准坐标转换。\n' +
      '真实录制见 docs/11 T-16，录到之后直接替换该文件。',
    );
  }
  return { fps: fps > 0 ? fps : CAPTURE.targetHz, frames: frames as RawPose[] };
}
