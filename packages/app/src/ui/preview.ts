/**
 * 左上角那块小屏幕 —— 「它有没有看见我」。
 *
 * ## 它解决的那一个问题
 *
 * 观众站到摄像头前面，此前**没有任何办法**知道自己是不是被看见了。
 * 追踪一垮（逆光、离得太近、半个人出画、摄像头对着一面墙），身体就只是
 * 站着不动 —— 而"站着不动"和"这件作品坏了"在观众眼里是同一个画面。
 * 这块小屏幕把那件看不见的事变成看得见的：**你在里面，你的骨架在你身上。**
 *
 * ## 为什么它上面必须有骨架，而不只是一路画面
 *
 * 只给一路摄像头画面，它回答的是"镜头亮着吗"。观众要的答案是
 * "它认出我了吗" —— 那两件事在逆光下恰好分家：画面好好的，骨架一个都没有。
 * 所以骨架是这块屏幕的**主语**，摄像头画面只是它的底。
 *
 * ## 圆角：`docs/26 §F` 反面清单的唯一一处例外，**已登记**
 *
 * §F 写着"不用卡片、阴影、圆角、图标、进度条、toast"，而这里用了圆角。
 * 这不是忘了那条规矩，是那条规矩在这一个元素上不适用：
 * §F 禁圆角的理由是**圆角是产品界面的语汇，会让装置读起来像一个 app**。
 * 而这一块不是一个 UI 面板 —— 它是画面里**引用的一件硬件**，一台监视器。
 * 圆角在这里不是装饰，是"这是一块屏幕"这件事本身；把它做成直角，
 * 它就变回了一个浮在作品上的网页组件。
 *
 * 已由作品负责人当场裁定（"圆角小屏幕"），并回写进 `docs/26 §F`。
 * **例外只到这一个元素为止**：`.sb-see` 之外的任何地方出现 border-radius
 * 都不在这次豁免里。
 *
 * ## 它刻意不做的事
 *
 * - **不新开一路 `getUserMedia`，也不新起一个 MediaPipe。** 画面用的是
 *   `WebcamCapture` 自己那个 `<video>`（它本来就在解码，只是从没进过 DOM），
 *   骨架用的是帧循环已经拿到手的那一份 `RawPose`。这块屏幕因此**不产生
 *   任何新的采集成本** —— 它只是把已经存在的东西显示出来。
 * - **正常的时候不说话**（docs/23 §S4）。文字只在四种状态里的三种出现。
 * - 不做关闭按钮、不做拖动、不做设置。它不是一个组件，是一个指示灯。
 */
import type { RawPose } from '../../../core/src/types.ts';
import { cropZoomLimit, stepCrop, CROP_FULL, type Crop } from '../../../core/src/autoframe.ts';
import type { Flags } from '../shell/kiosk.ts';
import { COPY, setBi, type BiText } from './i18n.ts';
import { createSeeWatch, cropActive, displaySide, wantsPreview, type SeeReading } from './preview-state.ts';
import './preview.css';

// 挂不挂的那条判断住在 `preview-state.ts`（它是纯的，能在 node 里测；
// 这个文件 import 了 CSS，进不了 node 测试）。从这里转出去，
// 是为了调用方只需要认识一个模块。
export { wantsPreview } from './preview-state.ts';

/**
 * 骨架连线。**手抄一份，不从 `@mediapipe/tasks-vision` 里 import
 * `PoseLandmarker.POSE_CONNECTIONS`。**
 *
 * 理由：`capture/webcam.ts` 是被**动态 import** 的，为的就是让 `?demo=1`
 * 那条路一个字节的 MediaPipe wasm/模型都不下（见 `capture/capture.ts`）。
 * 这个文件挂在主流程上，静态 import 一个 MediaPipe 的常量，会把整个包
 * 拖回主 chunk，正好毁掉那条路。十六对数字换一条干净的降级路径，值。
 *
 * 索引表见 docs/04 §2。脸上那一圈点故意不画：缩略图上它只是一团噪点，
 * 而这块屏幕要说的是"整个人在不在"，不是"五官认出来没有"。
 */
const EDGES: readonly (readonly [number, number])[] = [
  [11, 12], [11, 23], [12, 24], [23, 24],          // 躯干
  [11, 13], [13, 15], [12, 14], [14, 16],          // 手臂
  [23, 25], [25, 27], [24, 26], [26, 28],          // 腿
  [27, 31], [28, 32],                              // 脚
  [0, 11], [0, 12],                                // 颈（鼻子 → 两肩）
];

/** 画多大。小到不和作品抢画面，大到能看清自己在不在里面 */
const W = 168;
const H = 126;

/**
 * 这一块在左上角占到多少像素（含安全区、含底下那句话）。
 * `?debug=1` 的 HUD 靠它让路（`shell/hud.ts` 的 `top`）。
 *
 * 屏幕本身的高由 CSS 定（`--sb-see-h`，随视口走），**这里不再重复那个数** ——
 * 上一版把它写死成 224，那是按当时固定的 126px 屏量出来的；屏一改成随视口，
 * 那个常量就开始骗人（1080 上屏是 216px，HUD 会压在它身上）。
 *
 * 下面那块字的高度**仍然是量出来的**：2026-09-13 在 Chrome 上逐句量四种状态，
 * 最高的两句（「打开摄像头…」「往后退一点…」英文折成两行）是 98px，
 * 再加安全区 24px。文案改长了要重量一次 —— 变长的是英文那一行，
 * 它最容易折出第三行。
 */
const SEE_TEXT_PX = 98 + 24;

/**
 * HUD 该从多高开始，才不压在小屏上。**用的时候导出，不存成常量**
 * （P21：派生数要么在用的时候重新导出，要么标明它从哪儿来）。
 * 屏高从 CSS 那一个来源读，所以改 `--sb-see-h` 这里自动跟上。
 */
export function previewReservedTop(): number {
  if (typeof document === 'undefined') return 8;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--sb-see-h').trim();
  const h = Number.parseFloat(raw);
  // 读不到（老浏览器、样式还没到）就按上限算：宁可 HUD 低一点，也不要压在屏上
  return (Number.isFinite(h) ? h : 280) + SEE_TEXT_PX;
}

export interface Preview {
  /** 每帧调一次。`pose` 是帧循环手上那一份，不另取 */
  update(pose: RawPose | null, dt: number, aspect?: number): void;
  dispose(): void;
}

/**
 * @param video 当前 `Capture` 自己那个 `<video>`（`WebcamCapture.video`）。
 *   没有就传 undefined —— 那时这块屏幕只剩一句"打开摄像头"，这是对的。
 * @param cameraOn 摄像头这条路现在通不通。`main.ts` 每帧重算并递进来，
 *   因为观众可能在运行中按下「用我的摄像头」，那一刻 capture 会被整个换掉。
 */
export function mountPreview(opts: {
  flags: Flags;
  mount?: HTMLElement;
  video: () => HTMLVideoElement | null;
  cameraOn: () => boolean;
  /** 上半身是正当取景（docs/49 §落地）。缺省 false = 这一版之前的行为：不裁切、腿出画照样说话 */
  framing?: () => boolean;
  /**
   * 画面里**其余**被看见的人（docs/50 §6.2）：`bodied` = 他有没有身体。缺省 = 单人，只画 `pose` 那一个。
   * 有身体的画 0.5 透明度，没有身体的（超过上限、海报）画 0.2 —— 小屏说实话：他确实被看见了，只是没有身体。
   */
  others?: () => ReadonlyArray<{ pose: RawPose; bodied: boolean }>;
  /** `prefers-reduced-motion`：小屏不裁切（一块跟着人挪的缩略图本身就是动态，docs/49 §6.3 一） */
  reduced?: () => boolean;
  /**
   * 摄像头自己在取景（`capture/cam-framing.ts`）。小屏上只挂 `title` / `data-cam-framing`，**不加常驻字**
   *（docs/49 §6.3 三；这一块指针穿透，悬停也不出字 —— 看得见的说明在 `?debug=1` 的 HUD 上）。
   */
  cameraFraming?: () => boolean;
  /**
   * 自动探测确认了一个新人（`core/src/people-probe.ts`，docs/50 §6.3 修订）：非 null 时在小屏下面
   * 单独一行说"看到了第几个人"。和上面 `word`（「它有没有看见我」）是两件不同的事，
   * 所以是独立的一行，不复用同一段文字——那句话此刻可能正在说别的事（往后退一点 / 站到亮一点的地方）。
   * 缺省 = 单人 / 探测没开：这一行永远不出现。
   */
  notice?: () => BiText | null;
}): Preview | null {
  if (!wantsPreview(opts.flags)) return null;

  const root = document.createElement('div');
  root.className = 'sb-see';

  const screen = document.createElement('div');
  screen.className = 'sb-see-screen';
  // 镜像：舞台上的身体是镜像的（docs/04 §1），这块屏幕不跟着镜像的话，
  // 观众抬左手会看到小屏幕里的人抬右手 —— 那比没有这块屏幕更糟。
  // **这不是一次坐标转换**（所以函数名里没有 `To`）：底下的 `<video>` 和
  // 骨架画布一起被同一个 CSS transform 翻过去，两者始终在同一个坐标系里，
  // 一个数都没动过。P4 说的"镜像只发生在 mediapipeToWorld 一处"讲的是
  // 世界坐标，这里连世界坐标都没有。
  if (opts.flags.mirror) screen.classList.add('is-mirrored');

  const canvas = document.createElement('canvas');
  canvas.className = 'sb-see-bones';
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');

  const word = document.createElement('p');
  word.className = 'sb-see-word';

  // 「看到了第二 / 三个人」——独立于上面那句「它有没有看见我」，理由见 `notice` 参数的注释
  const noticeEl = document.createElement('p');
  noticeEl.className = 'sb-see-note';

  screen.append(canvas);
  root.append(screen, word, noticeEl);
  (opts.mount ?? document.body).append(root);

  const watch = createSeeWatch();
  let shown: SeeReading | null = null;
  let shownNotice: BiText | null = null;
  /** 上一次画进画布的那一帧的时间戳。推理是 30Hz，画面可以是 120Hz —— 不重画同一帧 */
  let drawnAt = -1;
  let attached: HTMLVideoElement | null = null;

  function attach(v: HTMLVideoElement | null): void {
    if (v === attached) return;
    // 把**同一个** video 搬进来，不是复制一个新的：复制意味着第二条解码流，
    // 而这块屏幕的全部前提就是它不新增采集成本。
    // 搬走的时候不动它的 srcObject —— 采集端还在用它推理。
    if (attached && attached.parentElement === screen) attached.remove();
    attached = v;
    if (v) {
      v.className = 'sb-see-video';
      screen.prepend(v);
    }
  }

  function paint(pose: RawPose | null): void {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 其余的人先画、画淡：主身体那条线永远压在最上面，和单人时一个像素都不差
    for (const o of opts.others?.() ?? []) {
      if (o.pose !== pose) strokeSkeleton(o.pose, o.bodied ? 0.46 : 0.18);
    }
    strokeSkeleton(pose, 0.92);
  }

  function strokeSkeleton(pose: RawPose | null, alpha: number): void {
    if (!ctx) return;
    const pts = pose?.screen;
    if (!pts?.length) return;
    // `screen` 是图像归一化坐标（0..1，原点左上）。乘一下就是画布坐标 ——
    // 缩略图和摄像头画面是同一个取景，所以这里没有任何"换算"可言。
    const at = (i: number): [number, number] | null => {
      const l = pts[i];
      if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return null;
      return [l.x * canvas.width, l.y * canvas.height];
    };
    ctx.lineWidth = 1.5 * dpr;
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    for (const [a, b] of EDGES) {
      const p = at(a), q = at(b);
      if (!p || !q) continue;
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
    }
    ctx.stroke();
  }

  function say(r: SeeReading): void {
    if (shown && shown.state === r.state && shown.reason === r.reason && shown.side === r.side) return;
    shown = r;
    root.classList.toggle('is-bad', r.state !== 'ok');
    // 从哪一侧走出了画：屏幕那一侧一条细边，只在那句话在说的时候在（docs/49 §6.3 二）
    const edge = r.reason === 'side' && r.side ? displaySide(r.side, opts.flags.mirror) : null;
    root.classList.toggle('is-out-left', edge === 'left');
    root.classList.toggle('is-out-right', edge === 'right');
    if (r.state === 'ok') { word.textContent = ''; return; }
    setBi(
      word,
      r.state === 'off' ? COPY.preview.off
        : r.state === 'empty' ? COPY.attract.invite
          : r.reason === 'quality' ? COPY.preview.light
            : r.reason === 'side' ? (r.side === 'left' ? COPY.preview.outLeft : COPY.preview.outRight)
              : COPY.preview.stepBack,
    );
  }

  /** 「看到了第二 / 三个人」：`null` 就清空——它是一句一段时间之后自己收起的话，不是一个常驻状态 */
  function sayNotice(n: BiText | null): void {
    if (shownNotice === n) return;
    shownNotice = n;
    if (!n) { noticeEl.textContent = ''; return; }
    setBi(noticeEl, n);
  }

  /** 摄像头自己在取景：只挂属性，不出字 */
  let camNoted = false;
  function noteCameraFraming(on: boolean): void {
    if (on === camNoted) return;
    camNoted = on;
    if (on) {
      root.title = `${COPY.preview.camFraming.zh} · ${COPY.preview.camFraming.en}`;
      root.dataset.camFraming = 'on';
    } else {
      root.removeAttribute('title');
      delete root.dataset.camFraming;
    }
  }

  /**
   * 上半身取景时的数字裁切（docs/49 §落地 · 用法 B）。**只作用于显示**：
   * video 和骨架画布一起挪，推理照旧看整幅。任何一句话在说（出画 / 光不够 / 没人）→ 当帧退回整幅，
   * 让画框的边重新可见 —— 这块屏幕的职责是说实话，裁切不许替一个半个人出画的观众把他摆回正中。
   * 退回整幅按时间限速走完（`previewSnapSeconds`，docs/49 §6.3 一），不是当帧。
   * 每帧由状态写成 transform，不用 CSS transition（静止态不许等一段动画走完）。
   */
  let crop: Crop = CROP_FULL;
  /** 屏幕此刻的设备像素高度。约每秒量一次：每帧读 clientHeight 会逼一次布局 */
  let displayPx = 0;
  let sizeTick = 0;
  function applyCrop(active: boolean, seen: SeeReading, pose: RawPose | null, dt: number): void {
    if (sizeTick++ % 60 === 0) displayPx = screen.clientHeight * (devicePixelRatio || 1);
    // 分辨率下限：源画面不够时不放大像素（480p 摄像头放进 1080 屏上的小屏）
    const maxZoom = cropZoomLimit(attached?.videoHeight ?? NaN, displayPx);
    crop = stepCrop(crop, { active, snap: seen.state !== 'ok', screen: pose?.screen, maxZoom }, dt);
    // transform-origin 0 0：先平移让窗口中心落到 (0.5/zoom)，再放大
    const t = crop.zoom === 1 ? ''
      : `scale(${crop.zoom.toFixed(4)}) translate(${((0.5 / crop.zoom - crop.cx.x) * 100).toFixed(3)}%, ${((0.5 / crop.zoom - crop.cy.x) * 100).toFixed(3)}%)`;
    for (const el of [attached, canvas]) {
      if (!el || el.style.transform === t) continue;
      el.style.transformOrigin = '0 0';
      el.style.transform = t;
    }
  }

  return {
    update(pose, dt, aspect) {
      const camera = opts.cameraOn();
      attach(camera ? opts.video() : null);
      const upper = opts.framing?.() ?? false;
      const seen = watch.update({ camera, pose, upperIsIntended: upper, aspect }, dt);
      say(seen);
      sayNotice(opts.notice?.() ?? null);
      applyCrop(cropActive({
        upperIsIntended: upper,
        reduced: opts.reduced?.() ?? false,
        othersBodied: (opts.others?.() ?? []).some((o) => o.bodied),
      }), seen, pose, dt);
      noteCameraFraming(camera && (opts.cameraFraming?.() ?? false));
      // 只在采集端真的给了新一帧的时候重画。`pose.t` 是 `performance.now()`
      // 打的推理时间戳（`capture/webcam.ts`），严格递增。
      const t = pose?.t ?? -1;
      if (t !== drawnAt) { drawnAt = t; paint(pose); }
    },
    dispose() {
      // video 不销毁、不解绑 srcObject：它不是这块屏幕的东西，
      // 采集端还在拿它推理。只是把它搬回 DOM 外面（它本来就在那儿）。
      attach(null);
      root.remove();
    },
  };
}
