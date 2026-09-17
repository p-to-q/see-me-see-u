/**
 * WebcamCapture —— MediaPipe 实现的 `Capture`（docs/06 §2）。
 *
 * 契约里真正难的只有两条，其余都是样板：
 *  1. `latest()` 非阻塞：推理跑在自己的节拍上（目标 CAPTURE.targetHz），
 *     渲染线程只读最近一次成功的结果。渲染永远不等推理（docs/06 §1）。
 *  2. `latest()` 绝不抛异常：所有可能炸的东西（getUserMedia / wasm / 模型下载 /
 *     detectForVideo）都被包住，失败只写 `lastError`，返回值退化成 null。
 *
 * ## 推理在 worker 里（docs/48 §3）
 *
 * 基线实测（docs/48 §2）：建图一次冻住主线程 7000ms（冷缓存），第一次 detect 编译着色器
 * 再冻 3659ms，稳态每次 detect 在主线程上 p95 19–22ms —— "打开摄像头先黑、一顿才出来"
 * 和"大动作时卡"都在这三个数里。现在三件事都在 `pose-worker.ts` 里做，主线程每次推理只剩
 * 一次 `new VideoFrame(video)` + postMessage。
 *
 * - **一次一帧**：上一帧的结果回来之前不发下一帧（背压）。推理慢了，推理频率自己降下来，
 *   渲染不受影响；两次结果之间由姿态时钟（`pose-clock.ts`）插值。
 * - **worker 常驻**：关掉摄像头再打开不重新建图；观众手移到摄像头那一行上时（`prewarmPose()`）
 *   就开始取模型 —— 不碰摄像头、不问权限。
 * - **`start()` 在第一次推理完成之后才返回**：调用方（`main.ts` 的 swapCapture）在那之前
 *   一直用旧的那一路（回放）驱动身体，换过来的那一刻已经有姿态了。
 *
 * 降级路径（P2/P3，每条都必须存在）：
 *   worker 起不来 / `?worker=off` → 主线程推理（下面 #openModels 那一条，原来的实现）
 *   worker 中途死了        → 重新拿一个 worker（最多 WORKER_RETRIES 次），期间姿态时钟保持/交出 null
 *   GPU delegate 失败      → CPU delegate（两条路上都是）
 *   本地 wasm 失败         → CDN wasm（主线程那一条）
 *   本地模型文件不存在      → CDN 模型
 *   ImageSegmenter 起不来  → 只丢 mask，姿态照跑（慢回路自己会静默关掉）
 *   摄像头权限被拒          → `failed`，lastError 有值，latest() 恒为 null，页面不白屏
 *   摄像头中途断了          → `lost`（main.ts 换回回放并说一句）
 *   `?cam=` 要的那台不在     → 照常开默认那台，但 `camera.why === 'fallback'`，
 *                            HUD 上是红的一行（`?cam=` 见 camera-select.ts）
 *
 * 这里**不做任何姿态处理**：不滤波、不建骨架、不换坐标系。
 * 坐标转换只允许发生在 core/skeleton.ts 的 mediapipeToWorld()（docs/04 §1）。
 */
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { RawPose } from '../../../core/src/types.ts';
import { CAPTURE, PEOPLE } from '../../../core/src/tuning.ts';
import { notePresence } from '../shell/idle.ts';
import { readFlags, type PoseModel } from '../shell/kiosk.ts';
import type { Capture, CaptureStep } from './capture.ts';
import {
  describeCamera, formatCameraList, pickCamera,
  type CamDevice, type CamStatus,
} from './camera-select.ts';
import { describe, overallScore, toLandmark, type PoseIn, type PoseOut } from './pose-protocol.ts';
import { applyCamFraming, readCamFraming, type CamFramingFlag, type CamFramingStatus, type TrackLike } from './cam-framing.ts';
import { cadenceDue, mainThreadInferenceDue } from './cadence.ts';
import { frameFlightTimedOut, ownsFrameFlight, settleFrameFlight, type FrameFlight } from './frame-flight.ts';
import { createMaskDemand } from './mask-demand.ts';

// 本地 wasm：打包进产物，现场断网也能起（Vite 把它们当静态资源发出去）
// 注意子路径没有 /wasm/：包的 exports 就是这么导出的
// 经典那一份给主线程（MediaPipe 在主线程上用 <script> 加载它）；
// `_module` 那一份给 module worker（经典胶水层只是一个顶层 var，到了 module 作用域里就找不到了）。
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import wasmModuleLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmModuleBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';

const CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';

/**
 * 模型文件不进仓库（几 MB 的二进制）。优先读本地 `assets/models/`（现场务必预先放好），
 * 没有就回落到 Google 的模型 CDN。
 */
const MODELS = {
  segmenter: {
    local: '/models/selfie_segmenter.tflite',
    cdn: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  },
};

/**
 * 三个档位的姿态模型（`?model=lite|full|heavy`，docs/24 §3）。
 * 官方 model card 的实测差：lite→full 的 3D MAE 45mm→39mm、PDJ +4 点，GPU 代价约 +20%；
 * heavy 再好一点但 GPU 帧率掉到约一半。默认仍是 lite —— 现场机器的余量还没压测过（U9）。
 *
 * **换档是一个 URL 参数，不是一次重新构建**：逆光把 lite 打崩时，现场只能靠这个。
 */
const POSE_MODEL_FILES = {
  lite: 'pose_landmarker_lite',
  full: 'pose_landmarker_full',
  heavy: 'pose_landmarker_heavy',
} as const;

function poseModelSource(which: PoseModel): { local: string; cdn: string } {
  const base = POSE_MODEL_FILES[which] ?? POSE_MODEL_FILES.lite;
  return {
    local: `/models/${base}.task`,
    cdn: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/${base}/float16/latest/${base}.task`,
  };
}

/** worker 中途死了，最多重新拿几次。再死就是这台机器上 worker 不可靠：停在那儿，读数报停滞 */
const WORKER_RETRIES = 2;

// ── 姿态引擎（worker，整页常驻一个）──────────────────────────────────────────

type PoseEngineEvent = Exclude<PoseOut, { type: 'options-result' }> | { type: 'options-fail'; error: string };

interface PoseEngine {
  backend: 'GPU' | 'CPU';
  warning: string | null;
  dead: boolean;
  segmenterReady: boolean;
  /** 图此刻按几个人建的。整页共用一个 worker，所以换人数走 `options` 消息，不重新建 worker */
  numPoses: number;
  post(msg: PoseIn, transfer: Transferable[]): void;
  /** 目标值会串行发送；只有 worker 成功回执才会改 `numPoses` */
  requestNumPoses(numPoses: number): void;
  /** 首次慢回路需求才解析模型并建分割图；同一 worker 最多启动一次。 */
  requestSegmenter(): void;
  /** 在途帧超时说明这个 worker 已不再可信；终止它，不往同一个堵塞队列继续塞帧。 */
  retire(why: string): void;
  listen(fn: ((m: PoseEngineEvent) => void) | null): void;
}

let enginePromise: Promise<PoseEngine> | null = null;
let engineModel: PoseModel | null = null;

/**
 * 观众的手移到了摄像头那一行上：先把 wasm 和模型取起来、把图建好。
 * **不碰摄像头、不问权限**（`shell/entry.ts` 文件头那条规矩照旧）。永不抛。
 */
export function prewarmPose(model?: PoseModel): void {
  try {
    const flags = readFlags();
    if (!flags.worker) return;
    void acquirePoseEngine(model ?? flags.model ?? 'lite').catch(() => { /* 真按下时会再试一次，并把原因写进 lastError */ });
  } catch { /* 预热是旁路 */ }
}

function acquirePoseEngine(model: PoseModel): Promise<PoseEngine> {
  if (enginePromise && engineModel === model) return enginePromise;
  engineModel = model;
  const p = createPoseEngine(model, () => { if (enginePromise === p) enginePromise = null; });
  enginePromise = p;
  p.catch(() => { if (enginePromise === p) enginePromise = null; });
  return p;
}

const abs = (u: string): string => new URL(u, location.href).href;

/** `?people=` 开机时的值（docs/50）。1 = 单人那条路：`numPoses = 1`，消息里永远没有 `others` */
function peopleCap(): number {
  try { return readFlags().people; } catch { return 1; }
}

/** 一份 worker 给的"其余的人"→ RawPose。时间戳和第 0 个一样（同一帧） */
const othersToPoses = (others: PoseOut extends infer M ? M extends { type: 'pose'; others?: infer O } ? O : never : never, t: number): RawPose[] =>
  (others ?? []).map((o) => ({ world: o.world, screen: o.screen ?? undefined, score: o.score, t }));

async function createPoseEngine(model: PoseModel, forget: () => void): Promise<PoseEngine> {
  if (typeof Worker === 'undefined') throw new Error('浏览器没有 Worker');
  const poseModel = await resolveModel(poseModelSource(model));
  const worker = new Worker(new URL('./pose-worker.ts', import.meta.url), { type: 'module', name: 'sb-pose' });
  let listener: ((m: PoseEngineEvent) => void) | null = null;
  const numPoses = peopleCap();
  let desiredNumPoses = numPoses;
  let optionsRequest: Extract<PoseIn, { type: 'options' }> | null = null;
  let optionsSequence = 0;
  let failedNumPoses: number | null = null;
  let segmenterRequested = false;
  let retireEngine: (why: string) => void = () => {};

  const pumpOptions = (): void => {
    if (engine.dead || optionsRequest || desiredNumPoses === engine.numPoses || failedNumPoses === desiredNumPoses) return;
    const request: Extract<PoseIn, { type: 'options' }> = {
      type: 'options', requestId: ++optionsSequence, numPoses: desiredNumPoses,
    };
    optionsRequest = request;
    try {
      engine.post(request, []);
    } catch (error) {
      optionsRequest = null;
      failedNumPoses = request.numPoses;
      listener?.({ type: 'options-fail', error: `人数重配置发送失败：${describe(error)}` });
    }
  };

  const engine: PoseEngine = {
    backend: 'CPU',
    warning: null,
    dead: false,
    segmenterReady: false,
    numPoses,
    post(msg, transfer) {
      if (engine.dead) {
        for (const t of transfer) (t as { close?: () => void }).close?.();
        return;
      }
      worker.postMessage(msg, transfer);
    },
    requestNumPoses(value) {
      desiredNumPoses = value;
      // 显式再请求一次同值，就是对上次失败的重试。
      if (failedNumPoses === value) failedNumPoses = null;
      pumpOptions();
    },
    requestSegmenter() {
      if (segmenterRequested || engine.dead) return;
      segmenterRequested = true;
      // 模型探测也在需求之后才发生；失败是本 worker 的终态，避免 slow 轮询反复下载/建图。
      void resolveModel(MODELS.segmenter).then((segmenterModel) => {
        if (!engine.dead) engine.post({ type: 'segmenter-init', model: abs(segmenterModel) }, []);
      }).catch((error) => {
        engine.segmenterReady = false;
        listener?.({ type: 'segmenter', ok: false, warning: `ImageSegmenter 未启用（慢回路会静默关掉）：${describe(error)}` });
      });
    },
    retire(why) { retireEngine(why); },
    listen(fn) { listener = fn; },
  };

  return new Promise<PoseEngine>((resolve, reject) => {
    let ready = false;
    const die = (why: string): void => {
      if (engine.dead) return;
      engine.dead = true;
      forget();
      try { worker.terminate(); } catch { /* 已经没了 */ }
      if (!ready) reject(new Error(why));
      else listener?.({ type: 'fail', stamp: Number.NaN, error: why });
    };
    retireEngine = die;
    worker.onmessage = (ev: MessageEvent<PoseOut>) => {
      const m = ev.data;
      if (m.type === 'options-result') {
        const current = optionsRequest;
        // worker 重启/旧消息晚到时，不许它改写新一轮的 applied 值。
        if (!current || m.requestId !== current.requestId) return;
        optionsRequest = null;
        if (m.ok && m.numPoses === current.numPoses) {
          engine.numPoses = current.numPoses;
          if (failedNumPoses === current.numPoses) failedNumPoses = null;
        } else {
          failedNumPoses = current.numPoses;
          if (desiredNumPoses === current.numPoses) {
            listener?.({ type: 'options-fail', error: `人数重配置失败：${m.error ?? '回执与请求不一致'}` });
          }
        }
        // 在途期间改了几次也只发最后的目标；失败的同值等显式重试。
        pumpOptions();
        return;
      }
      if (m.type === 'ready') {
        ready = true;
        engine.backend = m.backend;
        engine.warning = m.warning;
        console.info(`[webcam] 姿态 worker 就位：${m.backend}，预热 ${m.warmMs.toFixed(0)}ms${m.warning ? `（${m.warning}）` : ''}`);
        resolve(engine);
        return;
      }
      if (m.type === 'segmenter') {
        engine.segmenterReady = m.ok;
        if (m.warning) console.warn(`[webcam] ${m.warning}`);
        return;
      }
      if (m.type === 'error') { die(`姿态 worker 起不来：${m.error}`); return; }
      listener?.(m);
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      die(`姿态 worker 崩了：${e.message || 'unknown'}`);
    };
    worker.postMessage({
      type: 'init',
      wasmLoaderPath: abs(wasmModuleLoaderUrl),
      wasmBinaryPath: abs(wasmModuleBinaryUrl),
      poseModel: abs(poseModel),
      width: CAPTURE.requestedVideo.width,
      height: CAPTURE.requestedVideo.height,
      numPoses,
    } satisfies PoseIn);
  });
}

// ── Capture ───────────────────────────────────────────────────────────────

export class WebcamCapture implements Capture {
  readonly video: HTMLVideoElement;

  #stream: MediaStream | null = null;
  #landmarker: PoseLandmarker | null = null;

  #latest: RawPose | null = null;
  /** 这一帧 MediaPipe 给出的其余几个人（`numPoses > 1`）。单人时永远是空数组 */
  #others: RawPose[] = [];
  /** `?people=` / 控件条要的人数上限 */
  #people = peopleCap();
  #mask: ImageBitmap | null = null;
  #maskDemand = createMaskDemand();

  #fps = 0;
  #tickTimes: number[] = [];
  #lastVideoTime = -1;
  #lastStamp = -1;
  /** 最近一次已接受推理所属输入帧的画幅；不是 `<video>` 此刻可能已变化的新尺寸。 */
  #frameAspect: number | null = null;
  #running = false;
  #rafId = 0;
  #error: string | null = null;
  #failed = false;
  #lost = false;

  // worker 那一条路的状态
  #engine: PoseEngine | null = null;
  #inFlight: FrameFlight = null;
  #sentAt = 0;
  #lastSent = -Infinity;
  #accepted = -Infinity;
  #inferredAt = Number.NaN;
  #inferMs = 0;
  #cadence: number = CAPTURE.targetHz;
  #firstResult: (() => void) | null = null;
  #retries = 0;
  #reacquiring = false;
  /** 主线程降级路径的已生效值和唯一在途请求。 */
  #mainPeopleApplied: number | null = null;
  #mainPeopleRequest: { landmarker: PoseLandmarker; numPoses: number } | null = null;
  readonly #useWorker: boolean;

  /** 起来之后用的是哪条路，dev 页面拿来显示 */
  backend: 'GPU' | 'CPU' | null = null;
  /** 推理在哪儿跑：worker / 主线程。HUD 显示它 */
  where: 'worker' | 'main' | null = null;
  /** 实际加载的姿态模型档位（`?model=`；没指定就是默认档） */
  readonly model: PoseModel;
  /**
   * 实际开着的是哪一台摄像头，以及它是不是 `?cam=` 要的那一台。
   * 摄像头还没开起来之前是 null。HUD（`shell/hud.ts`）显示它。
   */
  camera: CamStatus | null = null;

  /** `?cam=` 原值。构造时读一次，之后不再碰 URL */
  readonly #cam: string | null;

  /**
   * 摄像头自带的取景（`cam-framing.ts`，docs/49 §6.3 三）：开没开、请求成没成。摄像头开起来之前是 null。
   * 每约 30 次推理重读一次 `getSettings()`：用户在系统里开关 Center Stage 不会通知页面。
   */
  camFraming: CamFramingStatus | null = null;
  readonly #camFramingFlag: CamFramingFlag;
  #framingTicks = 0;

  /**
   * 启动里程碑。三件：摄像头开了 / 姿态模型到了 / 第一次推理完成。
   * 三件都是**真的发生了才报**，加载态因此不用猜（见 capture.ts 的 CaptureStep）。
   */
  #onStep: CaptureStep | null;
  #steps = 0;
  static readonly START_STEPS = 3;

  constructor(video?: HTMLVideoElement, model?: PoseModel, onStep?: CaptureStep) {
    this.#onStep = onStep ?? null;
    const flags = readFlags();
    this.model = model ?? flags.model ?? 'lite';
    this.#cam = flags.cam;
    this.#camFramingFlag = flags.camframing ?? 'auto';
    this.#useWorker = flags.worker;
    this.video = video ?? document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
  }

  get fps(): number { return this.#fps; }
  get lastError(): string | null { return this.#error; }
  /** 起不来（权限被拒、没有摄像头、模型/推理超时）。`lastError` 上的已兜住的旧账不算 */
  get failed(): boolean { return this.#failed; }
  /** 摄像头中途断了（track `ended`） */
  get lost(): boolean { return this.#lost; }
  get inferredAt(): number { return this.#inferredAt; }
  /** 单次推理耗时（毫秒，EMA；worker 那条路才有） */
  get inferMs(): number { return this.#inferMs; }
  /** MediaPipe `screen` 坐标所属的原始画幅；驱动尚未报尺寸时交给 Capture 的统一回退。 */
  get frameAspect(): number | null {
    return this.#frameAspect;
  }

  /**
   * 推理频率上限（Hz）。帧调速器放下「推理」那一级时降到 `GOVERNOR.inferenceHzShed`（docs/48 §4）。
   * 不高于 `CAPTURE.targetHz`。worker 与主线程降级路径共用同一条节拍闸。
   */
  setCadence(hz: number): void {
    if (Number.isFinite(hz) && hz > 0) this.#cadence = Math.min(CAPTURE.targetHz, hz);
  }

  latest(): RawPose | null { return this.#latest; }
  /**
   * 这一帧画面里的全部人（第 0 个就是 `latest()`）。顺序不保证、不带身份（docs/50 §1.3）。
   * 单人（`?people=1`）时就是 `[latest()]` 或 `[]`。
   */
  latestAll(): readonly RawPose[] {
    return this.#latest ? (this.#others.length ? [this.#latest, ...this.#others] : [this.#latest]) : [];
  }
  /**
   * 运行中改人数上限（控件条）。worker 那条路发一次 `options`，在两帧之间重建图；主线程那条路直接 `setOptions`。
   * 已生效的相同值是 no-op；上次失败的同值会再试一次。
   */
  setPeople(n: number): void {
    const v = Number.isFinite(n) ? Math.max(1, Math.min(PEOPLE.hardMax, Math.round(n))) : 1;
    this.#people = v;
    // 收缩时先把旧结果截到新上限，不等下一次推理才少一具身体。
    this.#others = this.#others.slice(0, Math.max(0, v - 1));
    const engine = this.#engine;
    if (engine && !engine.dead) engine.requestNumPoses(v);
    this.#syncMainPeople();
  }
  takeMask(): ImageBitmap | null {
    const mask = this.#mask;
    this.#mask = null;
    return mask;
  }
  setMaskDemand(wanted: boolean): void {
    this.#maskDemand.set(wanted);
    if (!wanted) {
      this.#mask?.close();
      this.#mask = null;
      return;
    }
    this.#engine?.requestSegmenter();
  }

  /** 永不 reject：失败写进 lastError + failed，让页面自己决定怎么显示 */
  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      // 模型和权限**并行**：观众在权限框上犹豫的那几秒，wasm 和模型已经在取了
      const engineP: Promise<PoseEngine | null> = this.#useWorker
        ? acquirePoseEngine(this.model).catch((e) => {
          console.warn('[webcam] 姿态 worker 起不来，回落主线程：', describe(e));
          this.#error = `姿态 worker 起不来，回落主线程：${describe(e)}`;
          return null;
        })
        : Promise.resolve(null);

      await this.#openCamera();
      if (!this.#running) return;
      this.#step();

      const engine = await withTimeout(engineP, CAPTURE.startTimeout * 1000, '姿态模型加载超时');
      if (!this.#running) return;
      if (engine) {
        this.where = 'worker';
        this.#attach(engine);
        this.#step();
        const first = new Promise<void>((res) => { this.#firstResult = res; });
        this.#pump();
        await withTimeout(first, CAPTURE.startTimeout * 1000, '第一次推理超时');
      } else {
        this.where = 'main';
        await this.#openModels();
        this.#loop();
      }
      this.#step();
    } catch (e) {
      const why = describe(e);
      this.stop();
      this.#error = why;
      this.#failed = true;
    }
  }

  stop(): void {
    this.#running = false;
    if (this.#rafId) cancelAnimationFrame(this.#rafId);
    this.#rafId = 0;
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#stream = null;
    // 不只停 track，也把 <video> 从旧 MediaStream 上摘下来。否则首次启动
    // 在模型 / 首帧阶段失败后，预览仍会把这个已失效的 srcObject 当成“摄像头开着”。
    try { this.video.pause(); } catch { /* 清理必须 best-effort */ }
    try { this.video.srcObject = null; } catch { /* 同上 */ }
    // worker 不关：它是整页共用的，下一次打开摄像头直接用（不再建图）。只是不再听它
    this.#engine?.listen(null);
    this.#engine = null;
    this.#inFlight = null;
    this.#firstResult = null;
    // 先让旧 setOptions 回调失效，再 close；否则它可能在下一次 start 后改新图的状态。
    this.#mainPeopleRequest = null;
    this.#mainPeopleApplied = null;
    try { this.#landmarker?.close(); } catch { /* 关闭失败不值得吵 */ }
    this.#landmarker = null;
    this.#maskDemand.set(false);
    this.#mask?.close();
    this.#mask = null;
    this.#latest = null;
    this.#frameAspect = null;
    this.#fps = 0;
  }

  /** 报一件。回调自己炸了不许拖垮启动 —— 它只是个显示用的旁路 */
  #step(): void {
    this.#steps = Math.min(WebcamCapture.START_STEPS, this.#steps + 1);
    try { this.#onStep?.(this.#steps, WebcamCapture.START_STEPS); } catch { /* 显示用的旁路，别管 */ }
  }

  // ── 启动 ────────────────────────────────────────────────────────────────
  async #openCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('浏览器没有 getUserMedia（需要 https 或 localhost）');
    }

    // 权限之前也可以枚举：`enumerateDevices()` **不弹权限框**，只是不给 label、
    // 多数浏览器连 deviceId 都藏起来。所以这一次枚举只在"权限早就给过"
    // （现场那台机器的常态）时能直接命中；命中不了就先开默认那台，
    // 等有了 stream 再枚举一次——那时 label 才是真的。
    // 绝不为了凑一张设备表提前要权限：入口层（`shell/entry.ts` 文件头）存在的
    // 全部理由就是"第一眼不该是权限弹窗"。
    let first: string | null = null;
    try { first = pickCamera(await listVideoInputs(), this.#cam)?.deviceId ?? null; }
    catch { /* 枚举不了就当没有偏好，下面照样开 */ }

    this.#stream = await this.#openStream(first).catch(async (e) => {
      // 点名的那台在这一瞬间没了（拔线正好卡在这里）→ 退回默认那台再开一次。
      // 这条 catch 只兜"点名"这一种；真的一台都没有时下面这次照样抛，
      // 由 start() 写进 lastError —— 那是既有的那条降级路径，不动它。
      if (!first) throw e;
      return this.#openStream(null);
    });

    // 到这里权限已经有了：这一次枚举才有真的 label 和 deviceId
    try { await this.#settleCamera(); }
    catch (e) {
      // 选摄像头绝不能成为采集死掉的新方式（文件头第 2 条）。
      // 这里失败就只是"不知道在用哪台"，画面照跑。
      this.camera = null;
      this.#error = `摄像头选择失败（画面照跑，但不知道在用哪一台）：${describe(e)}`;
    }

    // 摄像头自带的取景：按 `?camframing=` 请求（能请求的话），读回实际状态。自带超时、永不 reject ——
    // 它绝不能成为摄像头起不来的新方式（和上面选摄像头同一条规矩）
    this.camFraming = await applyCamFraming(this.#track(), this.#camFramingFlag);
    if (this.camFraming.flag !== 'auto' || this.camFraming.active) console.info(`[webcam] ${this.camFraming.hud}`);

    // 摄像头中途断了（拔线、被别的程序占走、系统收回权限）：记下来，由 main.ts 换回回放
    for (const t of this.#stream?.getVideoTracks() ?? []) {
      t.addEventListener('ended', () => {
        if (!this.#running) return;
        this.#lost = true;
        this.#error = '摄像头断开了（track ended）';
      }, { once: true });
    }

    this.video.srcObject = this.#stream;
    await this.video.play();
    if (!this.video.videoWidth) {
      // 有些驱动会返回一条永远不出帧的 stream。不设界的 loadeddata 等待
      // 会让整个启动卡死，连回放降级都永远没机会开始。
      await withTimeout(
        new Promise<void>((res) => this.video.addEventListener('loadeddata', () => res(), { once: true })),
        CAPTURE.startTimeout * 1000,
        '摄像头没有送来画面',
      );
    }
  }

  #openStream(deviceId: string | null): Promise<MediaStream> {
    const size = {
      width: { ideal: CAPTURE.requestedVideo.width },
      height: { ideal: CAPTURE.requestedVideo.height },
    };
    // `exact`：点了名就必须是那一台。给 `ideal` 的话浏览器会"尽量"——
    // 也就是在那台不在时**安静地**换一台，而那正是要修掉的失败。
    const video = deviceId ? { ...size, deviceId: { exact: deviceId } } : size;
    return navigator.mediaDevices.getUserMedia({ video, audio: false });
  }

  /** 权限到手之后：该换就换，然后把"实际在用哪一台"记下来并打一次全表 */
  async #settleCamera(): Promise<void> {
    const devices = await listVideoInputs();
    const want = pickCamera(devices, this.#cam);
    if (want && want.deviceId !== currentDeviceId(this.#stream)) {
      const next = await this.#openStream(want.deviceId).catch(() => null);
      if (next) {
        this.#stream?.getTracks().forEach((t) => t.stop());
        this.#stream = next;
      }
    }
    // 报的是那条 track 自己说的 deviceId，不是我们请求的那个（P21）
    this.camera = describeCamera(devices, this.#cam, currentDeviceId(this.#stream));
    const head = this.camera.why === 'fallback' ? '[webcam] ⚠ 摄像头回落' : '[webcam] 摄像头';
    const log = this.camera.why === 'fallback' ? console.warn : console.info;
    log(`${head}：${this.camera.hud}\n${formatCameraList(devices, this.camera).join('\n')}`);
  }

  // ── worker 那条路 ───────────────────────────────────────────────────────
  #attach(engine: PoseEngine): void {
    this.#engine = engine;
    this.backend = engine.backend;
    if (engine.warning) this.#error = engine.warning;
    this.#inFlight = null;
    // worker 是整页共用的：上一个 capture 可能把它改成了别的人数
    engine.listen((m) => this.#onEngine(m));
    engine.requestNumPoses(this.#people);
    if (this.#maskDemand.wanted) engine.requestSegmenter();
  }

  #pump = (): void => {
    if (!this.#running) return;
    this.#rafId = requestAnimationFrame(this.#pump);
    try {
      this.#send();
    } catch (e) {
      // 一帧炸了不许冒到帧循环外（AGENTS 不变量：帧循环里永不抛异常）
      this.#error = describe(e);
    }
  };

  #send(): void {
    const engine = this.#engine;
    if (!engine) return;
    if (engine.dead) { this.#reacquire(); return; }
    const now = performance.now();
    if (this.#inFlight !== null) {
      if (!frameFlightTimedOut(this.#inFlight, this.#sentAt, now, CAPTURE.workerFrameTimeoutMs)) return;
      const timedOut = this.#inFlight;
      this.#inFlight = null;
      // detectForVideo 在 worker 里是同步的。向已经堵住的同一 worker 再发 B，
      // A 若永远不回，就会每两秒多排一张 VideoFrame。退休整个引擎，走有上限的重拿。
      engine.retire(`姿态 worker 帧 ${timedOut.toFixed(1)} 超时`);
      this.#reacquire();
      return;
    }
    if (this.video.readyState < 2) return;
    if (!cadenceDue(now, this.#lastSent, this.#cadence)) return;
    // 同一帧不重复推理
    const vt = this.video.currentTime;
    if (vt === this.#lastVideoTime) return;
    this.#lastVideoTime = vt;
    // timestamp 必须严格递增，否则 MediaPipe 会抛
    const stamp = now <= this.#lastStamp ? this.#lastStamp + 1 : now;
    this.#lastStamp = stamp;
    this.#lastSent = now;
    const aspect = videoAspect(this.video) ?? 16 / 9;
    if (typeof VideoFrame !== 'undefined') {
      let frame: VideoFrame;
      try { frame = new VideoFrame(this.video, { timestamp: Math.round(stamp * 1000) }); }
      catch { return; }   // 这一刻还拿不到一帧（尺寸为 0 之类）：下一帧再来
      const maskGeneration = this.#maskDemand.begin(engine.segmenterReady);
      this.#inFlight = stamp;
      this.#sentAt = now;
      try {
        engine.post({ type: 'frame', frame, stamp, aspect, maskGeneration }, [frame]);
      } catch (error) {
        try { frame.close(); } catch { /* 转移失败时所有权仍在主线程 */ }
        if (maskGeneration !== null) this.#maskDemand.settle(maskGeneration, false);
        this.#inFlight = settleFrameFlight(this.#inFlight, stamp);
        throw error;
      }
      return;
    }
    // 没有 VideoFrame 的浏览器：ImageBitmap 也能转移，只是多一次异步
    this.#inFlight = stamp;
    this.#sentAt = now;
    void createImageBitmap(this.video).then((bmp) => {
      if (!this.#running || this.#engine !== engine || !ownsFrameFlight(this.#inFlight, stamp)) {
        bmp.close();
        this.#inFlight = settleFrameFlight(this.#inFlight, stamp);
        return;
      }
      const maskGeneration = this.#maskDemand.begin(engine.segmenterReady);
      try {
        engine.post({ type: 'frame', frame: bmp, stamp, aspect, maskGeneration }, [bmp]);
      } catch (error) {
        try { bmp.close(); } catch { /* 转移失败时所有权仍在主线程 */ }
        if (maskGeneration !== null) this.#maskDemand.settle(maskGeneration, false);
        this.#inFlight = settleFrameFlight(this.#inFlight, stamp);
        throw error;
      }
    }).catch(() => { this.#inFlight = settleFrameFlight(this.#inFlight, stamp); });
  }

  #onEngine(m: PoseEngineEvent): void {
    if (m.type === 'pose') {
      // 超时后新帧已经在途时，旧帧的迟到回执既不能释放新帧，也不再写回旧姿态。
      const owned = ownsFrameFlight(this.#inFlight, m.stamp);
      this.#inFlight = settleFrameFlight(this.#inFlight, m.stamp);
      if (!owned) return;
      if (!(m.stamp > this.#accepted)) return;
      this.#accepted = m.stamp;
      this.#frameAspect = cleanAspect(m.aspect);
      const now = performance.now();
      this.#latest = m.world?.length
        ? { world: m.world, screen: m.screen ?? undefined, score: m.score, t: m.stamp }
        : null;   // 没人：返回 null，不是返回上一帧的幽灵
      this.#others = this.#latest && m.others?.length ? othersToPoses(m.others, m.stamp) : [];
      this.#inferredAt = m.stamp;
      this.#inferMs += (m.inferMs - this.#inferMs) * 0.2;
      // 顺手上报"有没有人"给无人降帧（shell/idle.ts）
      notePresence((this.#latest?.score ?? 0) > CAPTURE.minScore, now);
      this.#countTick(now);
      const done = this.#firstResult;
      this.#firstResult = null;
      done?.();
    } else if (m.type === 'mask') {
      if (this.#maskDemand.settle(m.generation, true)) {
        // 新的到货再换掉旧的，别让消费者拿到半张图
        this.#mask?.close();
        this.#mask = m.bitmap;
      } else {
        m.bitmap.close();
      }
    } else if (m.type === 'mask-fail') {
      this.#maskDemand.settle(m.generation, false);
    } else if (m.type === 'fail') {
      if (Number.isFinite(m.stamp)) {
        if (!ownsFrameFlight(this.#inFlight, m.stamp)) return;
        this.#inFlight = settleFrameFlight(this.#inFlight, m.stamp);
      } else {
        // worker 级别的死亡没有单帧 stamp；它已不可能再为当前帧回答。
        this.#inFlight = null;
      }
      this.#error = m.error;
    } else if (m.type === 'options-fail') {
      this.#error = m.error;
    }
  }

  /** worker 死了：重新拿一个。期间姿态时钟先保持、再交出 null —— 读数上是 ALM 02 停滞，那是实话 */
  #reacquire(): void {
    if (this.#reacquiring || this.#retries >= WORKER_RETRIES) return;
    this.#reacquiring = true;
    this.#retries++;
    // worker 已终止，不会再有旧 mask 回执；把那张在途需求退回可重试态。
    this.#maskDemand.settle(this.#maskDemand.generation, false);
    this.#engine?.listen(null);
    void acquirePoseEngine(this.model).then((e) => {
      if (this.#running) this.#attach(e);
    }).catch((e) => {
      this.#error = `姿态 worker 重启失败：${describe(e)}`;
    }).finally(() => { this.#reacquiring = false; });
  }

  // ── 主线程那条路（降级路径：worker 起不来 / `?worker=off`）─────────────────
  async #openModels(): Promise<void> {
    // 动态 import：worker 那条路上主线程一个字节的 MediaPipe 都不需要
    const { FilesetResolver } = await import('@mediapipe/tasks-vision');
    const poseModel = await resolveModel(poseModelSource(this.model));

    // wasm：先本地，失败再 CDN
    let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
    let opened: { landmarker: PoseLandmarker; numPoses: number };
    try {
      fileset = { wasmLoaderPath: new URL(wasmLoaderUrl, location.href).href,
                  wasmBinaryPath: new URL(wasmBinaryUrl, location.href).href };
      opened = await this.#makeLandmarker(fileset, poseModel);
    } catch (e) {
      this.#error = `本地 wasm 起不来，回落 CDN：${describe(e)}`;
      fileset = await FilesetResolver.forVisionTasks(CDN_WASM);
      opened = await this.#makeLandmarker(fileset, poseModel);
    }
    this.#landmarker = opened.landmarker;
    this.#mainPeopleApplied = opened.numPoses;
    this.#syncMainPeople();
    this.#step();
  }

  async #makeLandmarker(
    fileset: { wasmLoaderPath: string; wasmBinaryPath: string },
    modelAssetPath: string,
  ): Promise<{ landmarker: PoseLandmarker; numPoses: number }> {
    const { PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const opts = { runningMode: 'VIDEO' as const, numPoses: this.#people, outputSegmentationMasks: false };
    try {
      const lm = await PoseLandmarker.createFromOptions(fileset, {
        ...opts, baseOptions: { modelAssetPath, delegate: 'GPU' },
      });
      this.backend = 'GPU';
      return { landmarker: lm, numPoses: opts.numPoses };
    } catch (e) {
      // 没有 WebGL / 驱动挂了 → CPU 也能跑，只是慢
      this.#error = `GPU delegate 失败，回落 CPU：${describe(e)}`;
      const lm = await PoseLandmarker.createFromOptions(fileset, {
        ...opts, baseOptions: { modelAssetPath, delegate: 'CPU' },
      });
      this.backend = 'CPU';
      return { landmarker: lm, numPoses: opts.numPoses };
    }
  }

  /** 主线程降级路径也用同一条规矩：单在途、latest-wins，成功才更新 applied。 */
  #syncMainPeople(): void {
    const landmarker = this.#landmarker;
    const numPoses = this.#people;
    if (!landmarker || this.#mainPeopleRequest || this.#mainPeopleApplied === numPoses) return;
    const request = { landmarker, numPoses };
    this.#mainPeopleRequest = request;
    let applying: Promise<unknown>;
    try {
      applying = Promise.resolve(landmarker.setOptions({ numPoses }));
    } catch (error) {
      this.#mainPeopleRequest = null;
      this.#error = `人数重配置失败：${describe(error)}`;
      return;
    }
    void applying.then(() => {
      if (this.#mainPeopleRequest === request && this.#landmarker === landmarker) this.#mainPeopleApplied = numPoses;
    }).catch((error) => {
      if (this.#mainPeopleRequest === request && this.#landmarker === landmarker) {
        this.#error = `人数重配置失败：${describe(error)}`;
      }
    }).finally(() => {
      // stop() 或新一轮启动已经让这个请求失效。
      if (this.#mainPeopleRequest !== request || this.#landmarker !== landmarker) return;
      this.#mainPeopleRequest = null;
      // 在途期间可能改了多次，只追最后的值；同值失败等下次显式 setPeople 再试。
      if (this.#people !== numPoses) this.#syncMainPeople();
    });
  }

  #loop = (): void => {
    if (!this.#running) return;
    this.#rafId = requestAnimationFrame(this.#loop);
    try {
      this.#infer();
    } catch (e) {
      // 一帧炸了不许冒到帧循环外（AGENTS 不变量：帧循环里永不抛异常）
      this.#error = describe(e);
    }
  };

  #infer(): void {
    const lm = this.#landmarker;
    if (!lm || this.video.readyState < 2) return;

    // 主线程是降级路径，但仍必须服从调速器 / 自动人数探测的节拍；否则最贵的三人探测会在这里满速跑。
    const now = performance.now();
    // `setOptions()` 会异步重建 MediaPipe 图，不能与 detectForVideo 并发。worker 也在
    // reconfigureQueue.busy 时拒绝帧；主线程降级必须保持同一份所有权语义。
    if (!mainThreadInferenceDue(this.#mainPeopleRequest !== null, now, this.#lastSent, this.#cadence)) return;

    // 同一帧不重复推理；timestamp 必须严格递增，否则 MediaPipe 会抛
    const vt = this.video.currentTime;
    if (vt === this.#lastVideoTime) return;
    this.#lastVideoTime = vt;
    const stamp = now <= this.#lastStamp ? this.#lastStamp + 1 : now;
    this.#lastStamp = stamp;
    this.#lastSent = now;
    const aspect = videoAspect(this.video);

    const res = lm.detectForVideo(this.video, stamp);
    const world = res.worldLandmarks?.[0];
    const screen = res.landmarks?.[0];
    if (world?.length) {
      this.#latest = {
        world: world.map(toLandmark),
        screen: screen?.map(toLandmark),
        score: overallScore(screen, world),
        t: stamp,
      };
    } else {
      this.#latest = null;   // 没人：返回 null，不是返回上一帧的幽灵
    }
    // 其余几个人（`numPoses > 1`），和 worker 那条路同一个形状
    this.#others = [];
    for (let i = 1; this.#latest && i < (res.worldLandmarks?.length ?? 0); i++) {
      const w = res.worldLandmarks[i], sc = res.landmarks?.[i];
      if (w?.length) this.#others.push({ world: w.map(toLandmark), screen: sc?.map(toLandmark), score: overallScore(sc, w), t: stamp });
    }
    res.close?.();
    this.#inferredAt = stamp;
    this.#frameAspect = aspect;

    // 顺手上报"有没有人"给无人降帧（shell/idle.ts）。
    // 这件事只有采集端知道，让它自己说，收口的 main.ts 就一行都不用改。
    notePresence((this.#latest?.score ?? 0) > CAPTURE.minScore, now);

    this.#countTick(now);
  }

  /** 推理 Hz：数最近 1 秒里成功跑了几次 */
  #countTick(now: number): void {
    this.#tickTimes.push(now);
    while (this.#tickTimes.length && now - this.#tickTimes[0] > 1000) this.#tickTimes.shift();
    this.#fps = this.#tickTimes.length;
    // 摄像头自带的取景：约每秒重读一次（同步、只读、永不抛）
    if (this.camFraming && ++this.#framingTicks % 30 === 0) {
      this.camFraming = readCamFraming(this.#track(), this.#camFramingFlag, this.camFraming.applied);
    }
  }

  /** 这条流的视频 track，按 `cam-framing.ts` 要的那几个方法看 */
  #track(): TrackLike | null {
    return (this.#stream?.getVideoTracks()[0] as unknown as TrackLike | undefined) ?? null;
  }

}

function withTimeout<T>(p: Promise<T>, ms: number, why: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${why}（${Math.round(ms / 1000)}s）`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

async function listVideoInputs(): Promise<CamDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

/** 这条流现在**实际**接的是哪台。拿不到就是空串（于是一定判成 fallback，宁可吵） */
function currentDeviceId(stream: MediaStream | null): string {
  return stream?.getVideoTracks()[0]?.getSettings?.().deviceId ?? '';
}

/** 输入帧自身的画幅。读取失败留给 Capture 的统一 16:9 回退，不把坏尺寸扩散成 NaN。 */
function videoAspect(video: Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight'>): number | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : null;
}

const cleanAspect = (value: number): number | null =>
  Number.isFinite(value) && value > 0 ? value : null;

/** 本地有模型就用本地（现场断网），否则 CDN */
async function resolveModel(m: { local: string; cdn: string }): Promise<string> {
  try {
    const r = await fetch(m.local, { method: 'HEAD' });
    const type = r.headers.get('content-type') ?? '';
    if (r.ok && !type.includes('text/html')) return m.local;
  } catch { /* 本地没有就算了 */ }
  return m.cdn;
}
