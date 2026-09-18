/**
 * 开场选择页 —— 观众选自己要变成的那具身体（docs/12 §5、docs/14 §4）。
 *
 * 卡片骑在一个**大半在屏幕外**的环上，靠近时融在一起，分开时拉出越来越细的丝，
 * 直到断掉。环本身是 `ring/`（一个全屏片元着色器里的距离场，一个 draw call），
 * 数学移植自 Viscose-carousel（MIT，授权判定与逐条差异见 `docs/35-VISCOSE.md`）；
 * 这个文件是它的外壳：数据、排布、选中、以及现场需要的那几条兜底。
 *
 * **开屏和这一页是同一个场的两个阶段**（见 `ring/field.ts` 的文件头）：
 * 展签还立着时种子已经出生、在背后缓慢地转，按下「开始」之后卡片才一张张剥出来。
 * 所以这里拿到的环**可能已经在跑了** —— `acquireRingField()` 返回的是同一个实例。
 *
 * 三条不能忘的现场规则：
 *   1. **30 秒无操作自动选一个。** 装置不能停在菜单上。
 *   2. **`?theme=<id>` 直接跳过这一页。** 刷新可复现，也是现场的手动覆盖。
 *   3. **WebGL 起不来也要能选。** 掉到一个纯 DOM 的列表，键盘和自动选择照常工作。
 *      （AGENTS.md：每条降级路径必须存在且被跑过 —— `?gl=off` 就是用来跑它的。）
 *      这句话在 2026-09-13 之前是**假的**：`?gl=` 只接在 `/dev/choose.html` 上，
 *      正式程序的 `readFlags()` 里根本没有这个字段，`/?gl=off` 什么都不做
 *      （docs/36 D2）。现在它是真的：`shell/kiosk.ts` 认这个参数，
 *      `main.ts` 把 `forceFallback: !flags.gl` 传进来。
 *
 * 排布不是数组顺序，是**形态空间**：按 `axes.humanLike` / `axes.lifeLike` 绕
 * 质心排成一圈，滑动时观众是在穿越那张图（docs/14 §4）而不是翻列表。
 */
// 排版系统是硬约束：这一页的 CSS 全靠 --sb-*，所以它必须自己把 type.css 带上 ——
// 不能指望每个宿主 HTML 都记得 <link> 它（主程序的 index.html 就没有）。
import '../ui/type.css';
import './choose.css';
import { isThemeId } from '../shell/kiosk.ts';
import { mulberry32 } from '../../../core/src/rng.ts';
import { cjkClass, COPY, setBi } from '../ui/i18n.ts';
import { markNode } from '../ui/mark.ts';
import { announceBrand, declareShared, freezeCanvas, handOff, stageShown } from '../ui/page-transition.ts';
import type { RawPose, Rng, ThemeDef } from '../../../core/src/types.ts';
import { acquireRingField, type RingField } from './ring/field.ts';
import { holdFirstScreen } from './ring/first-screen.ts';
import { buildCard, loadImage, type BuiltCard } from './cards.ts';
import { startWaveInput, type WaveDriver } from './ring/wave-input.ts';
import { isWearable } from './wearable.ts';
import {
  catalogKnowsTheme, resolveChooseCatalog, type ChooseCatalog,
} from './catalog.ts';

export interface ChooseOptions {
  /** 选定了。id 已经写进 URL。 */
  onChoose: (id: string) => void;
  mount?: HTMLElement;
  partsUrl?: string;
  refsBase?: string;
  /** 无操作多久自动随机选。0 关掉（只该在调试时用）。 */
  idleMs?: number;
  /** 唯一一处非确定性入口。给了 seed 就完全可复现。 */
  seed?: number;
  /** 直接给条目，跳过 fetch（dev 页面 / 演示用）。 */
  themes?: ThemeDef[];
  /** 正式程序已经加载过的目录投影。传它就绝不再请求 parts.json。 */
  catalog?: ChooseCatalog;
  /** 强制走无 WebGL 的降级路径。 */
  forceFallback?: boolean;
  /**
   * 让 canvas 可读回（截图取证用）。现场不要开。
   *
   * ⚠️ 换到 WebGPU 之后这个开关**是个空档**：WebGPU 的画布不需要
   * `preserveDrawingBuffer` 这类设置，`canvas.toDataURL()` 本来就拿得到画面。
   * 留着它是因为它在 `ChooseOptions` 上、dev 页和别处的调用还在传 ——
   * 删一个参数的收益不值得那次连锁。
   */
  capture?: boolean;
  /**
   * 中心卡换了一张（滚动 / 拖动 / 键盘 / 降级列表上划过一行都算）。
   * 挂上来的第一张**不算** —— 那不是"经过"，那是页面刚打开。
   * 不传时这一页的行为逐字不变。
   */
  onPass?: () => void;
  /**
   * 选定了。`onChoose` 之外**另开一个**，是因为这两件事问的不是同一个问题：
   * `onChoose` 问"选了谁"，这里问"**是谁选的**"——
   * `how` 只有 30 秒无操作那一条是 `'idle'`，其余六条入口全是 `'manual'`。
   * 声音需要这个区分（观众得听得出这一下不是自己碰出来的），别的消费者可以不看。
   */
  onCommit?: (id: string, how: 'manual' | 'idle') => void;
  /**
   * 卡片图的到货进度（`done / total`）。**只是上报，不影响这一页的任何表现。**
   *
   * 为什么加在这里：这一页真正的等待在 `mountChoose` 返回**之前** ——
   * 23 张 anchor 图要先拉齐才排得出螺旋，慢网上那是几秒黑屏，
   * 而外面拿不到任何信号（`chooseTheme` 一次性 resolve）。
   * 加载态（`shell/loading.ts`）靠它显示真实进度。
   */
  onProgress?: (done: number, total: number) => void;
  /**
   * 图与条目都就绪后、选择页产生任何可见或可交互副作用之前的交棒闸门。
   *
   * 正式程序用它等加载层**真正移除**；dev 页不传，行为不变。
   * 它不阻塞 anchor 图的并行下载，只序列化两个 UI 的可见时间线。
   */
  beforeReveal?: () => Promise<void>;
  /**
   * 最近一帧姿态。给了才有**举手滚动**（`ring/wave.ts`）。
   *
   * **不传 = 这一页逐字和以前一样。** 所以所有的降级都在调用方那一侧收口，
   * 用"传不传这个函数"表达，而不是在这里再判一次摄像头状态：
   *   没摄像头 / 没授权 → `latest()` 恒为 null，手势永远武装不了；
   *   `?demo=1`（回放）→ **根本不传**。让一段录像去操作名单，
   *     观众会看见名单自己在动而现场没有人举手 —— 那是"它坏了"，不是降级。
   *   `?wave=off` → 不传。
   */
  pose?: () => RawPose | null;
}

export interface ChooseHandle {
  dispose(): void;
  /** 现在停在哪个 id 上 */
  current(): string | null;
  /** 按 id 选中，走完整的退出动画 */
  choose(id: string): void;
  /** 这一页真正在用的条目，按形态空间排好序 */
  entries(): BuiltCard[];
  /** 走的是 GL 还是降级列表 */
  mode: 'gl' | 'fallback';
  /** 环本体，降级时为 null。调试用（fps / step / exit）。 */
  gl: RingField | null;
}

const DEFAULT_IDLE_MS = 30_000;

// ── URL ─────────────────────────────────────────────────────────────────────

export function themeFromUrl(search: string = location.search): string | null {
  // 写法判据取自 `shell/kiosk.ts` —— `?theme=` 只有一条规则，不许两处各写一份正则
  const value = new URLSearchParams(search).get('theme');
  return isThemeId(value) ? value : null;
}

export function writeThemeToUrl(id: string): void {
  const url = new URL(location.href);
  url.searchParams.set('theme', id);
  // 大厅那个标记只管"这一次别立展签"。选定之后它没有意义，分享出去的地址不该带着它
  url.searchParams.delete('hall');
  history.replaceState(null, '', url);
}

// ── 形态空间排布 ─────────────────────────────────────────────────────────────

const axesOf = (t: ThemeDef): { humanLike: number; lifeLike: number } =>
  t.axes ?? { humanLike: 0.5, lifeLike: 0.5 };

/**
 * 二维形态空间 → 一维轮播。
 *
 * 轮播是一个**环**，所以用绕质心的角度排序：相邻的卡片在形态图上也相邻，
 * 滚满一圈正好是绕形态空间走一周。比"按 humanLike 排"好的地方是它不会把
 * lifeLike 那根轴压扁 —— 毛球和工业机不会因为都不像人就排到一起。
 *
 * 退化情况（旧的 parts.json 没有 axes 字段）：所有角度相等，sort 稳定，
 * 于是原样保留数组顺序。这正是我们要的降级行为。
 */
export function morphologyOrder(themes: ThemeDef[]): ThemeDef[] {
  if (themes.length < 3) return themes.slice();
  let cx = 0;
  let cy = 0;
  for (const t of themes) {
    cx += axesOf(t).humanLike;
    cy += axesOf(t).lifeLike;
  }
  cx /= themes.length;
  cy /= themes.length;
  const angle = (t: ThemeDef): number => {
    const a = axesOf(t);
    return Math.atan2(a.lifeLike - cy, a.humanLike - cx);
  };
  return themes.slice().sort((a, b) => angle(a) - angle(b));
}

// ── 数据 ────────────────────────────────────────────────────────────────────

// ── 挂载 ────────────────────────────────────────────────────────────────────

export async function mountChoose(options: ChooseOptions): Promise<ChooseHandle> {
  const {
    onChoose,
    mount = document.body,
    partsUrl = '/parts/parts.json',
    refsBase = '/refs',
    idleMs = DEFAULT_IDLE_MS,
    forceFallback = false,
    // 不传 = 一个什么都不做的函数。这样下面的调用点不需要每处写 `?.()`，
    // 「不传时行为逐字不变」也就只有这一处需要保证
    onPass = () => {},
    onCommit = () => {},
  } = options;
  // 非确定性只从这里进来一次，之后全程用这个 Rng。
  const rng: Rng = mulberry32(options.seed ?? (Date.now() >>> 0));

  const resolved = await resolveChooseCatalog({
    catalog: options.catalog, themes: options.themes, partsUrl,
  });
  const library = resolved.catalog;

  // 先拿 anchor 图，再决定谁能上场。一张也不等太久（cards.ts 有超时）。
  // 每张到货就报一次，好让外面的加载态往前走一格 —— 顺序无关，报的是"到齐了几张"。
  let loadedImages = 0;
  const total = library.themes.length;
  options.onProgress?.(0, total);
  const images = await Promise.all(
    library.themes.map((t) =>
      (t.source === 'procedural' ? Promise.resolve(null) : loadImage(`${refsBase}/${t.id}/_anchor.png`))
        .then((img) => { options.onProgress?.(++loadedImages, total); return img; }),
    ),
  );

  // 能选的身体 = **程序化的** ∪ **库里真的有自有件的**。就这两条。
  //
  // 这里以前还有第三条「∪ 有 anchor 图的」，而 anchor 图是一张**参考渲染**，
  // 不是一件可以穿的零件（`/dev/anchor.html` 画出来的，docs/09 U12）。
  // 两者同时为真是常态，所以那一条长期不改变任何结果 —— 它只在最坏的那一刻生效：
  // 谁给一个零自有件的条目补了一张 anchor 图，它立刻进轮播，观众点得到，
  // 而 `makeGenome` 那边一件自有件都没有（docs/39 §2.1）。
  // 一个"看起来能选"的条目和一个"真的穿得上"的条目必须是同一批，
  // 所以判据只留下「穿不穿得上」这一个问题（docs/02 P21）。
  //
  // 剩下的既可能是**空位**（docs/14 §2 那种"说明这个位置想要什么"的条目），
  // 也可能只是还没生成 —— 从 parts.json 看这两者没有区别，而它们此刻同样**穿不上**，
  // 所以都不进轮播。等 factory 把部件生出来，它们自己就会出现。
  //
  // 例外：条目是调用者直接给的（`themes`，dev/演示）时没有库可查，全部放行 ——
  // `/dev/choose.html?roster=1` 要的正是"把整张形态图铺开看，哪一片还是空的"。
  const cards: BuiltCard[] = [];
  morphologyOrder(library.themes).forEach((theme) => {
    const image = images[library.themes.indexOf(theme)] ?? null;
    if (!isWearable(theme, library, resolved.callerSuppliedThemes)) return;
    cards.push(buildCard(theme, image, rng));
  });

  // 从这一行往下才会挂 DOM、开输入、起空闲计时器和推环的入场时间线。
  // 闸门必须站在这条边界之前：放在 `field.play()` 前还不够，因为底部名牌
  // 和字标都是静态可见的，一挂上就会和透明的加载层重叠。
  try { await options.beforeReveal?.(); } catch (error) {
    // 现场不许因为一个退场回调永久卡在菜单之前。正式的 loading.finish()
    // 本身永不 reject；这条是给其他宿主 / dev 注入时的最后退路。
    console.warn('[choose] 入场交棒失败，已继续显示选择页：', error);
  }

  // 首屏配色由这一页也 hold 一份：环起不来（`?gl=off` / 没有 WebGPU）时
  // 降级列表**就是**首屏，它同样得是白底黑字，不能因为环没起来就翻回深色。
  const releaseFirstScreen = holdFirstScreen();
  const ui = buildDom(mount);
  let disposed = false;
  let committed = false;
  let carousel: RingField | null = null;
  /** 举手滚动的帧循环。没传 `pose` / 降级到列表时永远是 null */
  let wave: WaveDriver | null = null;
  let fallbackIndex = 0;
  let mode: 'gl' | 'fallback' = 'gl';

  const indexOfId = (id: string) => cards.findIndex((c) => c.theme.id === id);
  const activeIndex = () => (carousel ? carousel.activeIndex() : fallbackIndex);

  /**
   * 上一次真正显示过的那一张。**初值 -1 而不是 0**：
   * 挂上来的第一次 showActive 不是"经过"，它是页面打开 ——
   * 给它配一声就等于每次进这一页都先"咔"一下，那是提示音不是反馈。
   */
  let shown = -1;

  function showActive(index: number): void {
    const card = cards[index];
    if (!card) return;
    if (shown >= 0 && index !== shown) onPass();
    shown = index;
    // 补偿按**字**打不按槽位打（i18n.ts 的 cjkClass）：物种名大多是汉字，
    // 但名单里也有本来就是拉丁的（`guest.*` 一类），不能一律补。
    ui.name.textContent = card.theme.name;
    ui.name.className = `sb-zh${cjkClass(card.theme.name)}`;
    ui.nameEn.textContent = card.theme.nameEn;
    ui.nameEn.className = `sb-en${cjkClass(card.theme.nameEn)}`;
    // 中英并置，不切换（ui/i18n.ts 的设计说明）—— 名字那一行早就是并置的，
    // tagline 原来只有中文，是漏的那一半
    setBi(ui.tag, { zh: card.theme.tagline, en: card.theme.taglineEn ?? '' });
    ui.kind.textContent = card.theme.kind === 'archetype' ? '' : card.theme.kind;
    ui.root.querySelectorAll('.sb-row').forEach((row, i) => {
      row.classList.toggle('is-active', i === index);
    });
  }

  /**
   * 选定。写 URL → 放退出动画 → 回调。任何一步坏了都不能卡住现场。
   *
   * `how` 默认 `'manual'`：六条入口（键盘数字、回车、降级列表点击、GL onPick、
   * 外部 `choose()`、以及 idle 超时）里**只有 idle 那一条**要显式传 `'idle'`，
   * 其余全是观众自己动的手。默认值选 manual 是因为漏传一处的代价不对称 ——
   * 把手动读成自动只是少了点区分，把自动读成手动会让观众以为是自己碰的。
   */
  function commit(index: number, how: 'manual' | 'idle' = 'manual'): void {
    const card = cards[index];
    if (!card || committed || disposed) return;
    committed = true;
    const id = card.theme.id;
    // 在退出动画之前叫：声音是"这一下发生了"的回执，不是动画的收尾音
    onCommit(id, how);
    writeThemeToUrl(id);
    ui.idle.classList.remove('is-on');   // 选定了，倒计时那条线立刻收起来
    ui.root.classList.add('is-leaving');
    if (!carousel) {
      finish(id);
      return;
    }
    // 动画没跑完也要交差：定时兜底，onExitDone 先到就取消。
    const safety = setTimeout(() => finish(id), 2000);
    exitDone = (chosen) => {
      clearTimeout(safety);
      finish(chosen);
    };
    carousel.exit(index);
  }

  let finished = false;
  function finish(id: string): void {
    if (finished) return;
    finished = true;
    // 环要拆了，喂它的那条循环必须先停 —— 不然它会对着一个已经 dispose 的场调用
    wave?.stop();
    wave = null;
    onChoose(id);
    // 涨满屏幕的那张卡留在原地，等舞台真的画出第一帧（最多 HANDOFF_WAIT_MS）再交棒。
    // 原来是立刻交：底色一帧从纸翻到深，中间 450ms 没有一帧（docs/47 第 03 跳）
    void stageShown().then(handOver);
  }

  /**
   * 交棒给 S3。
   *
   * **必须拆掉那块画布。** 环是不透明的（底色合成在着色器里，见 ring/sdf.ts），
   * 留着它就等于把接下来出现的身体挡在后面 —— 而 `main.ts` 从来不调
   * `handle.dispose()`（选完主题它就往下走了），所以这件事只能由这一页自己做。
   *
   * 180ms 是 §0 的出场时长。此刻整个屏幕已经被选中的那张卡涨满，
   * 淡掉的是一张满屏的图，不是一个正在动的东西 —— 所以这一下读作交接，不读作消失。
   */
  function handOver(): void {
    const field = carousel;
    carousel = null;
    // 先把涨满屏幕的那张卡冻成一张图，再拆环：WebGPU 画布出了绘制它的任务就读不到，
    // 平台截到的会是透明（docs/47 §4.3）。拆在交棒之前 —— 环的渲染器不和舞台的同时多活一个过渡
    const still = field ? freezeCanvas({ canvas: field.canvas, render: () => field.advance(0) }) : null;
    field?.dispose();
    // 有平台过渡：那张图截下来，底色、字色一次换完，平台淡过去（ui/page-transition.ts）
    if (handOff(() => { releaseFirstScreen(); still?.remove(); ui.root.remove(); })) return;
    // 没有（旧浏览器 / 减少动态效果）：原来那条 180ms 淡出，淡的是那张图
    releaseFirstScreen();
    (still ?? field?.canvas)?.classList.add('is-gone');
    setTimeout(() => {
      still?.remove();
      ui.root.remove();
    }, 180);
  }
  let exitDone: (id: string) => void = () => {};

  // ── 空闲自动选择 ──────────────────────────────────────────────────────────
  // 现场不能停在菜单上：30 秒没人动，自己挑一个进去。
  //
  // docs/23 §S2 对这件事的表现有明确规定：**最后 5 秒**，中心卡下方出现
  // **一条极细的进度线**，走完自动选中。理由是"没有倒计时的话，突然跳转会吓到人"。
  // 所以它必须可见；同时 §0 又禁止进度条百分比 —— 一条正在走完的 1px 横线
  // 同时满足这两条：它说得出"还有一会儿"，但说不出"62%"。
  const COUNTDOWN_MS = 5000;
  let idleAt = performance.now() + idleMs;
  const bump = (): void => {
    idleAt = performance.now() + idleMs;
  };
  // 60ms 而不是 200ms：200ms 一跳的线肉眼能看出台阶，那会读成"卡了"
  const idleTick = window.setInterval(() => {
    if (committed || idleMs <= 0) return;
    const left = idleAt - performance.now();
    const showing = left <= COUNTDOWN_MS;
    ui.idle.classList.toggle('is-on', showing);
    // 线从 0 走到满 = 剩余时间从 5 秒走到 0
    ui.idleFill.style.width = showing
      ? `${Math.min(100, Math.max(0, (1 - left / COUNTDOWN_MS) * 100))}%`
      : '0';
    if (left <= 0) commit(rng.int(cards.length), 'idle');
  }, 60);

  // ── 键盘 ─────────────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent): void => {
    bump();
    if (committed) return;
    if (/^[0-9]$/.test(e.key)) {
      // 现场遥控器/数字键直选。0 是第 10 张。
      const n = e.key === '0' ? 9 : Number(e.key) - 1;
      if (n < cards.length) commit(n);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commit(activeIndex());
      return;
    }
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1
      : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    if (carousel) {
      carousel.focus((activeIndex() + delta + cards.length) % cards.length);
    } else {
      fallbackIndex = (fallbackIndex + delta + cards.length) % cards.length;
      showActive(fallbackIndex);
    }
  };

  window.addEventListener('keydown', onKeyDown);
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'touchstart'] as const) {
    window.addEventListener(type, bump, { passive: true });
  }

  // ── GL，以及它起不来的时候 ────────────────────────────────────────────────
  function toFallback(reason: unknown): void {
    if (mode === 'fallback') return;
    mode = 'fallback';
    // 环归这一页处置：它没有别的用户了（展签那一层这时已经不在）
    wave?.stop();
    wave = null;
    carousel?.dispose();
    carousel = null;
    ui.list.hidden = false;
    ui.root.classList.add('is-fallback');
    // 提示语必须跟着降级路径一起变：没有环可以"穿越"，
    // 一条教人做不到的事的提示比没有提示更糟
    setBi(ui.hint, COPY.choose.hintList);
    // 条目太少是**设计好的**退化，不是故障 —— 别在控制台吼它，
    // 否则真正的 GL 失败会淹没在噪音里（P14：测量工具本身会骗人）
    if (reason === 'cards < 3') console.info('[choose] 条目 < 3，环退化成横向一排（docs/23 §S2）');
    else console.warn('[choose] 环不可用，走 DOM 降级列表：', reason);
    cards.forEach((card, index) => {
      const row = document.createElement('button');
      row.className = 'sb-row';
      row.type = 'button';
      row.appendChild(card.canvas);
      const label = document.createElement('span');
      label.textContent = `${index + 1}. ${card.theme.name} · ${card.theme.nameEn}`;
      row.appendChild(label);
      row.addEventListener('click', () => commit(index));
      row.addEventListener('pointerenter', () => {
        fallbackIndex = index;
        showActive(index);
      });
      ui.list.appendChild(row);
    });
    showActive(fallbackIndex);
  }

  if (cards.length === 0) {
    // 观众看见的话里不许出现 parts.json。它说的是**会发生什么**：零件还在长。
    setBi(ui.name, COPY.choose.emptyTitle);
    setBi(ui.tag, COPY.choose.emptyNote);
  } else if (forceFallback) {
    toFallback('forceFallback');
  } else if (cards.length < 3) {
    // docs/23 §S2：「可选条目 < 3 个 → 退化成横向一排」。
    // 理由写在规格里：3 个以下的环看起来像坏了 —— 卡片绕不满一圈，
    // 观众看到的是一个转不动的轮子，而不是一条可以穿越的形态空间。
    // 而且丝也失去了意义：一条只连着两张卡的丝读作一根杠，不读作正在断的糖浆。
    // 走的是同一条 DOM 路径（键盘、自动选择全部照常），只是排成一排。
    toFallback('cards < 3');
    ui.list.classList.add('is-row');
    ui.list.style.setProperty('--sb-row-n', String(cards.length));
  } else {
    try {
      // 可能已经在跑了（展签那一层先拿过它）。拿到的是同一个实例，
      // 这里只是把 handler 换成这一页的，然后把卡片交给它。
      const field = acquireRingField({
        onActiveChange: showActive,
        onPick: (index) => commit(index),
        onExitDone: (index) => exitDone(cards[index].theme.id),
        onError: (error) => {
          // 帧循环已经自己停了。掉到列表，别让观众对着一块黑屏。
          if (!committed) toFallback(error);
        },
      });
      carousel = field;
      // 举手滚动。**只在环真的起来了之后挂**：降级列表是一条鼠标/键盘的路，
      // 上面既没有环也没有惯性，硬给它接一条手势等于第二套实现（见 wave.ts 文件头）。
      // 传了 `pose` 才有这一条 —— 没摄像头 / `?demo=1` / `?wave=off` 的收口都在调用方。
      if (options.pose) {
        const drive = options.pose;
        void field.ready.then((ok) => {
          if (!ok || committed || disposed) return;
          wave = startWaveInput({
            field,
            pose: drive,
            // 手势滚动和滚轮 / 指针**同一条待遇**：它就是一次操作，
            // 所以它续那 30 秒。只有真的滚动了才续 —— 站着不动的人不该
            // 把装置永远钉在菜单上（这条规则的本意是"没有操作"，不是"没有人"）。
            onScroll: bump,
          });
        });
      }
      field.setCards(cards.map((c) => c.canvas));
      // 展签在场时这一下已经按过了（幂等）；深链和现场没有展签，这一下就是入场。
      field.play();
      showActive(field.activeIndex());
      // WebGPU 起不来（旧浏览器、禁用了硬件加速）——**这是最常见的那条降级**，
      // 而且它是异步的：canvas 已经挂上去了，几百毫秒之后才知道不行。
      void field.ready.then((ok) => {
        if (!ok && !committed && !disposed) toFallback('WebGPU 不可用');
      });
    } catch (error) {
      toFallback(error);
    }
  }

  return {
    // getter：降级可能发生在返回之后（帧循环里炸了），这里不能是一个快照
    get mode() { return mode; },
    get gl() { return carousel; },
    dispose() {
      disposed = true;
      releaseFirstScreen();
      clearInterval(idleTick);
      wave?.stop();
      wave = null;
      window.removeEventListener('keydown', onKeyDown);
      for (const type of ['pointerdown', 'pointermove', 'wheel', 'touchstart'] as const) {
        window.removeEventListener(type, bump);
      }
      carousel?.dispose();
      ui.root.remove();
    },
    current: () => cards[activeIndex()]?.theme.id ?? null,
    choose(id: string) {
      const index = indexOfId(id);
      if (index >= 0) commit(index);
    },
    entries: () => cards.slice(),
  };
}

/**
 * 入口：URL 里已经有合法 theme 就**直接跳过这一页**，否则挂上轮播。
 * 返回 null 表示跳过了。
 */
export async function chooseTheme(options: ChooseOptions): Promise<ChooseHandle | null> {
  // 无论 URL 是否带 theme 都先解析一次；若需要真正挂轮播，把同一份结果继续传下去。
  // 这样坏深链也不会先验证一次、再为列表下载第二次。
  const resolved = await resolveChooseCatalog(options);
  const pre = themeFromUrl();
  // 条目表读不到（sourceAvailable=false）时也认这个 id：手动覆盖优先于校验。
  if (pre && catalogKnowsTheme(resolved.catalog, pre)) {
    options.onChoose(pre);
    return null;
  }
  return mountChoose({ ...options, catalog: resolved.catalog });
}

// ── DOM 外壳 ────────────────────────────────────────────────────────────────

interface Ui {
  root: HTMLElement;
  list: HTMLElement;
  name: HTMLElement;
  nameEn: HTMLElement;
  tag: HTMLElement;
  kind: HTMLElement;
  /** 倒计时那条极细横线的容器 */
  idle: HTMLElement;
  /** 线里正在变长的那一段 */
  idleFill: HTMLElement;
  /** 右下角那几行操作提示。降级到列表时要改写 */
  hint: HTMLElement;
}


function buildDom(mount: HTMLElement): Ui {
  const root = document.createElement('div');
  root.className = 'sb-choose';
  root.innerHTML = `
    <div class="sb-brand"></div>
    <div class="sb-list" hidden></div>
    <div class="sb-hud">
      <div class="sb-name sb-bi"><span class="sb-zh"></span><span class="sb-en"></span></div>
      <div class="sb-tag"></div>
      <div class="sb-kind"></div>
    </div>
    <div class="sb-idle"><i></i></div>
    <div class="sb-hint"></div>
    <div class="sb-keys"></div>`;
  mount.appendChild(root);
  // 左对齐的那一份：`start` 说的是它落在左上角，不是"选择页的字标长这样"
  root.querySelector<HTMLElement>('.sb-brand')!.append(declareShared(markNode('div', 'start'), 'mark'));
  // 展签的巨题在等它（docs/47）
  announceBrand();
  const hint = root.querySelector<HTMLElement>('.sb-hint')!;
  setBi(hint, COPY.choose.hint);
  root.querySelector<HTMLElement>('.sb-keys')!.textContent = COPY.choose.keys;
  return {
    root,
    list: root.querySelector<HTMLElement>('.sb-list')!,
    // 名字这一行**必须走并置系统的类名**（sb-bi / sb-zh / sb-en）。
    // 原来它用的是 sb-cn，一个全站别处都不存在的类 —— 于是 type.css 里那条
    // 给汉字补 0.06em 左边距的规则对它不生效，而它正下方的 tagline 走 setBi、
    // 补到了。结果是同一块名牌里**两行中文自己都不对齐**，英文看起来像缩进半格。
    // 类名不一致不是风格问题，是排版规则的漏网。
    name: root.querySelector<HTMLElement>('.sb-name > .sb-zh')!,
    nameEn: root.querySelector<HTMLElement>('.sb-name > .sb-en')!,
    tag: root.querySelector<HTMLElement>('.sb-tag')!,
    kind: root.querySelector<HTMLElement>('.sb-kind')!,
    idle: root.querySelector<HTMLElement>('.sb-idle')!,
    idleFill: root.querySelector<HTMLElement>('.sb-idle i')!,
    hint,
  };
}
