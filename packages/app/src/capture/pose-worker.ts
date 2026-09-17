/**
 * 姿态推理 worker（docs/48 §3）。
 *
 * ## 为什么推理必须离开主线程（基线实测，docs/48 §2）
 *
 *   MediaPipe 建图（wasm + GPU delegate）  主线程一次 7000ms（冷缓存）/ 303ms（暖缓存）
 *   第一次 detectForVideo（编译着色器）      主线程一次 3659ms（冷）/ 195–231ms（暖）
 *   稳态每次 detectForVideo                p50 10ms · p95 19–22ms · p99 24–29ms，每秒 30 次
 *
 * 前两项就是"打开摄像头先黑、然后一顿才出来"：页面在那几秒里整个冻住。
 * 第三项在 60Hz 屏上本身就超过一帧的预算，动作一大（检测器重跑）尾巴更长。
 * 三件事在这里全部发生在 worker 里，主线程只剩一次 `new VideoFrame(video)` 和一次 postMessage。
 *
 * ## 契约
 *
 * - 一次只处理一帧：主线程在收到这一帧的 `pose` / `fail` 之前不发下一帧（背压在主线程那边）。
 * - 收到的帧**一定**被 close，不论成败 —— VideoFrame 不关会把摄像头的缓冲池占满，画面停住。
 * - 从不抛到外面：init 失败发 `error`（之后不再可用），单帧失败发 `fail`（照常可用）。
 * - 这里**不做任何姿态处理**：不滤波、不换坐标系。和 `webcam.ts` 文件头同一条（docs/04 §1）。
 */
import { ImageSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision';
import { describe, overallScore, toLandmark, type PoseIn, type PoseOut } from './pose-protocol.ts';

type ReconfigureRequest = Omit<Extract<PoseIn, { type: 'options' }>, 'type'>;
type ReconfigureResult = Omit<Extract<PoseOut, { type: 'options-result' }>, 'type'>;

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<PoseIn>) => void) | null;
  postMessage(m: PoseOut, transfer?: Transferable[]): void;
};

let landmarker: PoseLandmarker | null = null;
let segmenter: ImageSegmenter | null = null;
let maskCanvas: OffscreenCanvas | null = null;
let lastStamp = 0;
let segStamp = 0;

type Fileset = { wasmLoaderPath: string; wasmBinaryPath: string };

/**
 * 把 MediaPipe 的 wasm 工厂装回全局。**每一次 `createFromOptions` 之前都要调**
 * （`test/pose-worker-factory.test.ts`）。
 *
 * MediaPipe 每建完一个任务就清掉 `self.ModuleFactory`，下一次再加载胶水层把它装回来。
 * 主线程上那是一个新的 `<script>`，会重新执行；module worker 里是 `import()`，
 * 模块被缓存、不再执行 —— 于是第二个任务一律 `ModuleFactory not set`
 * （2026-09-14 无头 Chrome 实测：抠图起不来；GPU 失败回落 CPU 那一条同样会起不来）。
 * `_module` 胶水层 `export default ModuleFactory`，所以从缓存的模块上把它拿回来就行。
 */
async function restoreFactory(loaderPath: string): Promise<void> {
  const g = self as unknown as { ModuleFactory?: unknown };
  if (g.ModuleFactory) return;
  const mod = await import(/* @vite-ignore */ loaderPath) as { default?: unknown };
  if (mod.default && !g.ModuleFactory) g.ModuleFactory = mod.default;
}

/**
 * `setOptions()` 会异步重建 MediaPipe 图，不能并发。正在重建时又来了多个
 * 目标，中间值已经失去意义：明确回执“被取代”，然后只保留最新的一个。
 * reply 也必须隔离错误：postMessage 失败不应该造成未处理的 Promise rejection。
 */
export function createReconfigureQueue(
  apply: (numPoses: number) => Promise<void>,
  reply: (result: ReconfigureResult) => void,
): { submit(request: ReconfigureRequest): void; readonly busy: boolean } {
  let running = false;
  let pending: ReconfigureRequest | null = null;
  const safeReply = (result: ReconfigureResult): void => {
    try { reply(result); } catch { /* worker 被终止时回执失败，不再向外抛 */ }
  };
  const drain = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const request = pending;
        pending = null;
        try {
          await apply(request.numPoses);
          safeReply({ ...request, ok: true });
        } catch (error) {
          safeReply({ ...request, ok: false, error: describe(error) });
        }
      }
    } finally {
      running = false;
      // reply 中的同步代码也可能插入一个新请求。
      if (pending) void drain();
    }
  };
  return {
    submit(request) {
      if (pending) safeReply({ ...pending, ok: false, error: '已被更新的人数请求取代' });
      pending = request;
      void drain();
    },
    get busy() { return running; },
  };
}

/** 图正在按新的 `numPoses` 重建：这期间来的帧回 `fail`（主线程清掉在途、下一帧再来） */
const reconfigureQueue = createReconfigureQueue(
  async (numPoses) => {
    const lm = landmarker;
    if (!lm) throw new Error('模型还没就位');
    await lm.setOptions({ numPoses: posesOf(numPoses) });
  },
  (result) => ctx.postMessage({ type: 'options-result', ...result }),
);

ctx.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === 'init') void init(m);
  else if (m.type === 'frame') onFrame(m);
  else if (m.type === 'options') reconfigureQueue.submit({ requestId: m.requestId, numPoses: posesOf(m.numPoses) });
};

/** `numPoses` 只认 1..8 的整数；上限在主线程那一侧是 `PEOPLE.hardMax`，这里只防一个坏消息 */
const posesOf = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.min(8, Math.round(n))) : 1);

async function init(m: Extract<PoseIn, { type: 'init' }>): Promise<void> {
  try {
    const fileset: Fileset = { wasmLoaderPath: m.wasmLoaderPath, wasmBinaryPath: m.wasmBinaryPath };
    const opts = { runningMode: 'VIDEO' as const, numPoses: posesOf(m.numPoses), outputSegmentationMasks: false };
    let backend: 'GPU' | 'CPU' = 'GPU';
    let warning: string | null = null;
    try {
      await restoreFactory(fileset.wasmLoaderPath);
      landmarker = await PoseLandmarker.createFromOptions(fileset, {
        ...opts, baseOptions: { modelAssetPath: m.poseModel, delegate: 'GPU' },
      });
    } catch (e) {
      // worker 里没有 OffscreenCanvas 的 WebGL / 驱动挂了 → CPU 也能跑，只是慢
      warning = `GPU delegate 失败，回落 CPU：${describe(e)}`;
      backend = 'CPU';
      await restoreFactory(fileset.wasmLoaderPath);
      landmarker = await PoseLandmarker.createFromOptions(fileset, {
        ...opts, baseOptions: { modelAssetPath: m.poseModel, delegate: 'CPU' },
      });
    }

    // 预热：第一次 detect 才真正编译着色器。在这里用一张空画布做掉，
    // 第一帧真画面就不再背那几百毫秒 —— 而且那几百毫秒现在也不在主线程上。
    const t0 = performance.now();
    try {
      const warm = new OffscreenCanvas(Math.max(1, m.width), Math.max(1, m.height));
      const g = warm.getContext('2d');
      // 中灰就行：预热要的是走一遍图，不是认出什么（不是 UI 颜色，所以不走令牌）
      if (g) { g.fillStyle = 'gray'; g.fillRect(0, 0, warm.width, warm.height); }
      lastStamp = 1;
      const r = landmarker.detectForVideo(warm as unknown as ImageBitmap, lastStamp);
      (r as { close?: () => void }).close?.();
    } catch { /* 预热失败不致命：第一帧真画面会自己编译 */ }
    ctx.postMessage({ type: 'ready', backend, warning, warmMs: performance.now() - t0 });

    // 抠图是慢回路的输入：姿态先就位，它在后面慢慢起，起不来也不拖垮姿态
    if (m.segmenterModel) void initSegmenter(fileset, m.segmenterModel);
    else ctx.postMessage({ type: 'segmenter', ok: false, warning: null });
  } catch (e) {
    ctx.postMessage({ type: 'error', error: describe(e) });
  }
}

async function initSegmenter(fileset: Fileset, model: string): Promise<void> {
  try {
    await restoreFactory(fileset.wasmLoaderPath);
    segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: model, delegate: 'GPU' },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
    ctx.postMessage({ type: 'segmenter', ok: true, warning: null });
  } catch (e) {
    segmenter = null;
    ctx.postMessage({ type: 'segmenter', ok: false, warning: `ImageSegmenter 未启用（慢回路会静默关掉）：${describe(e)}` });
  }
}

function onFrame(m: Extract<PoseIn, { type: 'frame' }>): void {
  const src = m.frame;
  try {
    const lm = landmarker;
    if (!lm || reconfigureQueue.busy) {
      ctx.postMessage({ type: 'fail', stamp: m.stamp, error: lm ? '正在按新的人数重建' : '模型还没就位' });
      return;
    }
    // MediaPipe 要求时间戳严格递增，否则抛
    const stamp = m.stamp <= lastStamp ? lastStamp + 1 : m.stamp;
    lastStamp = stamp;
    const t0 = performance.now();
    const res = lm.detectForVideo(src as unknown as ImageBitmap, stamp);
    const inferMs = performance.now() - t0;
    const world = res.worldLandmarks?.[0];
    const screen = res.landmarks?.[0];
    const found = !!world?.length;
    const out: PoseOut = {
      type: 'pose',
      stamp: m.stamp,
      inferMs,
      world: found ? world!.map(toLandmark) : null,
      screen: found && screen?.length ? screen.map(toLandmark) : null,
      score: found ? overallScore(screen, world!) : 0,
    };
    // 其余几个人（`numPoses > 1`）。单人时这一段一次都不进 —— 消息和这一版之前逐字相同
    const n = res.worldLandmarks?.length ?? 0;
    if (n > 1) {
      out.others = [];
      for (let i = 1; i < n; i++) {
        const w = res.worldLandmarks[i];
        if (!w?.length) continue;
        const sc = res.landmarks?.[i];
        out.others.push({ world: w.map(toLandmark), screen: sc?.length ? sc.map(toLandmark) : null, score: overallScore(sc, w) });
      }
    }
    (res as { close?: () => void }).close?.();
    ctx.postMessage(out);
    if (m.mask && segmenter) segment(src, stamp);
  } catch (e) {
    ctx.postMessage({ type: 'fail', stamp: m.stamp, error: describe(e) });
  } finally {
    try { (src as { close?: () => void }).close?.(); } catch { /* 已经关过 */ }
  }
}

function segment(src: VideoFrame | ImageBitmap, stamp: number): void {
  const seg = segmenter;
  if (!seg) return;
  try {
    segStamp = stamp <= segStamp ? segStamp + 1 : stamp;
    seg.segmentForVideo(src as unknown as ImageBitmap, segStamp, (result) => {
      const mask = result.categoryMask;
      if (!mask) return;
      const w = mask.width, h = mask.height;
      const data = mask.getAsUint8Array();
      const cvs = maskCanvas ??= new OffscreenCanvas(w, h);
      if (cvs.width !== w) cvs.width = w;
      if (cvs.height !== h) cvs.height = h;
      const g = cvs.getContext('2d');
      if (!g) return;
      const img = g.createImageData(w, h);
      for (let i = 0; i < data.length; i++) {
        // selfie_segmenter 的 category mask：0 = 背景，非 0 = 人
        const p = i * 4;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = 255;
        img.data[p + 3] = data[i] !== 0 ? 255 : 0;
      }
      g.putImageData(img, 0, 0);
      const bitmap = cvs.transferToImageBitmap();
      ctx.postMessage({ type: 'mask', bitmap }, [bitmap]);
    });
  } catch { /* 抠图掉一帧无所谓 */ }
}
