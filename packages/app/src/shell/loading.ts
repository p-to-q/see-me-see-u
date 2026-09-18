/**
 * 加载态 —— 观众在「打开 URL」和「身体出现」之间看见的那一屏。
 *
 * ## 它解决的那一个问题
 *
 * 在这之前，这段时间里观众看到的是**一块黑屏**。主程序要下 MediaPipe 的
 * wasm + 模型、部件 glb、选择页的 anchor 图，几 MB 起步；慢网上是十几秒。
 * 十几秒的黑屏和「坏了」在观众眼里没有区别 —— 这是整条路径上最容易流失人的一刻，
 * 而它流失人的原因不是"久"，是"不知道它是不是还活着"。
 *
 * ## 三条设计决定
 *
 * 1. **分阶段，不是一个笼统的百分比。** 一个数字只能说还要多久，说不出在等什么。
 *    「正在认识你的身体」这一行回答的是「它在干嘛」，而那才是观众真正的疑问。
 *
 * 2. **进度必须是真的。** 每一档都接在一个真实信号上：渲染器 init 是二值的，
 *    零件档读 `library.stats` 与 anchor 图的到货数，身体档读采集端的启动里程碑。
 *    没有真信号的地方**宁可停在那个数字上不动**，也不许用定时器往上爬 ——
 *    一条骗人的进度条比没有进度条更糟：它第一次骗过你，第二次你就再也不信它了。
 *
 * 3. **快的时候它根本不出现。** 宽限期 `GRACE_MS` 之内加载完就一帧都不画。
 *    `docs/23 §S0` 原本写「WebGPU 首次编译卡顿时不显示任何文字，有文字反而强调在等」——
 *    那条判断在 0.5–2 秒的尺度上是对的，所以保留成宽限期；它在十几秒的尺度上是错的，
 *    所以超过宽限期之后改成说话。两条都成立，分界就是这个常数。
 *
 * ## 和降级的衔接
 *
 * `shell/degrade.ts` 降级时会打 `sb:degrade` 事件，这里接住它，把那一行换成
 * 「画面会简单一点，它照样会动起来」—— 观众读到的是**结果**，不是"降级"这个词。
 * 启动彻底失败走 `boot-error.ts`，那一屏会先把这一层摘掉（两块浮层不许叠在一起）。
 *
 * ## 字标先到，其余后到（作品负责人 2026-09-15 裁定）
 *
 * 左上角挂的是 `ui/mark.ts` 那两行字（选择页左上角、`/about` 页头同一份组件），
 * 不是另起一个 logo：它一出现就该和后面选择页上那一份读起来是**同一件东西**，
 * 差一笔都不许。它跟着这一层的淡入一起出现，不再等三档进度——先有名字，
 * 再有细节，是这个屏该有的顺序。
 *
 * 细节（百分比、三档、总进度线）晚 `DETAIL_DELAY_MS` 才展开：字标先站稳，
 * 剩下的东西再铺开，两次出现不挤成一下。
 *
 * 缓存命中时这一层可能一闪而过——字标刚出现就被摘掉，观众根本没读到。
 * 所以只要它露过面（过了宽限期），就至少露 `MIN_SHOW_MS`：这是一段**刻意的
 * 停留**，不是没找到信号硬凑的等待，`finish()` 因此在最少展示时长上会晚收，
 * 不会晚开始（不阻塞后面的舞台/摄像头）。
 *
 * ## 到齐之后：字标落定，其余才回来（作品负责人 2026-09-15 第三次裁定）
 *
 * 字标一开始是**大的**（`is-big`，挪到画面中段、放大），不是它最终在角落的那个
 * 身份——这一屏在它出场的时候是主角，不是一个已经缩在角落等着被忽略的图标。
 * 真到齐、停满 `DONE_HOLD_MS` 之后，退场分三步，**每一步等上一步真的做完**：
 *
 *   1. 细节（百分比/三档/进度线）先收起（复用 `.sb-loading-details` 自己
 *      的 240ms 淡出）——先按*文件头第一条`裁定，退场时不该还有别的东西在动，
 *      抢字标的戏。
 *   2. 字标从大变小、挪到它在选择页/`/about` 上那个最终角落位置
 *      （`SETTLE_MOVE_MS`，和 `--sb-dur-move` 同一个数：这是一次"挪到位"）。
 *   3. 到位之后闪一下（`SETTLE_FLASH_MS`）——说的是"定住了"，不是重新出现。
 *
 * 三步都做完，这一层才整个摘掉，`finish()` 也只在这一刻 resolve。
 * 选择页的资产此刻已经到齐，但 DOM、输入和入场时间线都还在闸门后；
 * 下一帧才开始它自己的 reveal。因此不会有一帧同时属于两个 UI。
 */
import { COPY, setBi, type BiText } from '../ui/i18n.ts';
import { markNode } from '../ui/mark.ts';
import type { Flags } from './kiosk.ts';
import { runLoadingExit } from './loading-exit.ts';
import '../ui/type.css';
import './loading.css';

/** 这么快就好了的话，观众不该看见任何东西（见文件头第 3 条） */
const GRACE_MS = 600;

/**
 * 露过面就至少露这么久：字标一闪就摘等于没出现过。
 * 只在真的到了 `is-on`（过了 `GRACE_MS`）之后才计时——瞬间加载的路径完全不受影响。
 */
const MIN_SHOW_MS = 900;

/**
 * 三档**真的**到齐（`finish()` 被调用）之后，再停这么久才走（作品负责人 2026-09-15 追加要求）。
 *
 * 和 `MIN_SHOW_MS` 管的是两件不同的事：`MIN_SHOW_MS` 保证"这一层至少露了多久"，
 * 冷启动这种早就超过它的加载不会再被它拖住——三档真的到 100% 的那一刻，`finish()` 几乎立刻
 * 就走，观众看见的是数字刚跳到 100% 画面就换了，读起来像"卡了一下就切走"，不像"到了"。
 * 这一条管的是**到齐那一刻本身**：不管加载花了 300ms 还是 30 秒，真到 100% 之后都停这么久，
 * 让百分比和三个"已就绪"有机会被看清楚，再往下走。
 *
 * 没有编造任何进度——三档还是只在真信号到齐时才到 100%（见文件头第 2 条），
 * 这一条只管"到了之后别立刻走"，不改到达那一刻本身。
 */
const DONE_HOLD_MS = 1000;

/** 字标先站稳，细节再展开的那一拍。和 `type.css` 的 `--sb-dur-move`（420ms）同一个数——这也是一次"挪到位" */
const DETAIL_DELAY_MS = 420;

/** 退场第一步：细节收起。和 `.sb-loading-details` 自己的淡出时长（`--sb-dur-enter`，240ms）同一个数 */
const SETTLE_DETAILS_MS = 240;
/** 退场第二步：字标从大变小、挪到最终角落位置。和 `type.css` 的 `--sb-dur-move`（420ms）同一个数 */
const SETTLE_MOVE_MS = 420;
/** 退场第三步：到位之后闪一下 */
const SETTLE_FLASH_MS = 200;

/** 慢到这里开始说人话。8 秒这个数来自 docs/23 §S0 的「冷启动 > 8 秒（慢网）」 */
const SLOW_MS = 8_000;
/** 还在等：换第二句，告诉他这是一次性的 */
const SLOWER_MS = 20_000;

export type LoadStageId = 'render' | 'parts' | 'body';

/**
 * 权重 = 这一档在**观众感觉里**占多久，不是它下载多少字节。
 * 零件最重：它是唯一一档真的按文件数往前走的，也是慢网上最久的那一档。
 */
const STAGES: { id: LoadStageId; label: BiText; weight: number }[] = [
  { id: 'render', label: COPY.loading.render, weight: 0.15 },
  { id: 'parts', label: COPY.loading.parts, weight: 0.55 },
  { id: 'body', label: COPY.loading.body, weight: 0.30 },
];

export interface Loading {
  /** 这一档开始等了 */
  begin(id: LoadStageId): void;
  /** 0..1 的真实进度。倒退的值会被忽略（见 §进度只许前进） */
  progress(id: LoadStageId, value: number): void;
  /** 这一档到齐了 */
  done(id: LoadStageId): void;
  /** 全部结束：退场并摘掉。在节点真正移除后 resolve；重复调用返回同一个 Promise */
  finish(): Promise<void>;
}

/** 什么都不做的那一个。`?loading=0` 和现场深链走这条路，调用点因此不用写 if */
const ALREADY_FINISHED = Promise.resolve();
const NOOP: Loading = { begin() {}, progress() {}, done() {}, finish: () => ALREADY_FINISHED };

interface Row {
  root: HTMLElement;
  state: HTMLElement;
  value: number;
  started: boolean;
}

export interface MountLoadingOptions {
  /**
   * 这一次开机会不会立展签（`wantsEntry(flags)`，main.ts 传进来——`mountEntry()`
   * 这时候还没调用，但要不要展签是纯读 flags 的判断，不需要等它）。
   *
   * 有展签时**这一层不挂字标**：展签自己有一份"巨题变字标"的动画
   * （`entry.ts` 的 `morph(title, 'mark', …)`），加载态如果也做一遍同样的
   * 大变小，观众会同时看见两份 SEE-ME SEE-U 的动画叠在一起——那不是"效果好"，
   * 是"看不懂哪个才是真的"。字标动画只该属于一条路，见文件头「字标落定」那一节。
   */
  hasEntry?: boolean;
}

/**
 * 挂上加载态。`?loading=0` 时返回一个空实现 —— 拿不准这一层会不会打扰画面时，
 * 现场可以用它一键关掉，而不需要改代码或回滚（硬约束里写明了这条退路）。
 */
export function mountLoading(flags: Flags, opts: MountLoadingOptions = {}): Loading {
  if (typeof document === 'undefined' || !flags.loading) return NOOP;

  const layer = document.createElement('div');
  layer.className = 'sb-loading';
  // 它是一块"正在发生的状态"，读屏器该被告知，但不该打断观众正在读的东西
  layer.setAttribute('role', 'status');
  layer.setAttribute('aria-live', 'polite');

  // 字标：和选择页左上角、`/about` 页头同一个组件。**只在没有展签时才挂**——
  // 见 `MountLoadingOptions.hasEntry` 的注释；有展签时那份"大变小"的动画已经
  // 是展签自己的事，这一层不重复一遍。没有展签（深链、`?demo=1`、现场）时它是
  // 这一屏第一件、也是最先站稳的东西，不跟着 `is-detailed` 走——先有名字，
  // 再有细节。一开始是**大的**（`is-big`）——退场时才缩小挪到角落，见文件头
  // 「字标落定」那一节
  const mark = opts.hasEntry ? null : markNode('div', 'start');
  if (mark) {
    mark.classList.add('sb-loading-mark', 'is-big');
    layer.append(mark);
  }

  const inner = document.createElement('div');
  inner.className = 'sb-loading-inner';

  // 细节：百分比 + 三档 + 总进度线，晚 `DETAIL_DELAY_MS` 才展开（`is-detailed`）。
  // 作品名已经是左上角那一份字标在说，这里不再说第二遍（entry.ts 同一条规矩：
  // 同一个名字在一屏上说两遍，读起来是版面在结巴）
  const details = document.createElement('div');
  details.className = 'sb-loading-details';

  const head = document.createElement('div');
  head.className = 'sb-load-head';
  const pct = document.createElement('span');
  pct.className = 'sb-load-pct';
  pct.textContent = '0%';
  head.append(pct);

  const rows = new Map<LoadStageId, Row>();
  const list = document.createElement('div');
  for (const stage of STAGES) {
    const root = document.createElement('div');
    root.className = 'sb-load-stage is-waiting';
    const name = document.createElement('div');
    setBi(name, stage.label);
    const state = document.createElement('div');
    state.className = 'sb-load-state';
    state.textContent = COPY.loading.waiting.zh;
    root.append(name, state);
    list.append(root);
    rows.set(stage.id, { root, state, value: 0, started: false });
  }

  const bar = document.createElement('div');
  bar.className = 'sb-load-bar';
  const fill = document.createElement('i');
  bar.append(fill);

  const note = document.createElement('p');
  note.className = 'sb-load-note';

  details.append(head, list, bar, note);
  inner.append(details);
  layer.append(inner);
  document.body.append(layer);

  const t0 = performance.now();
  let shown = 0;          // §进度只许前进：已经念出口的百分比不许退回去
  let finished = false;
  let finishPromise: Promise<void> | null = null;
  let degraded = false;
  /** 这一层真的露出来的那一刻（`is-on` 落地时）。没露过面就还是 -1 —— 见 `finish()` 的快路径 */
  let shownAt = -1;

  let detailTimer: number | undefined;
  const graceTimer = window.setTimeout(() => {
    layer.classList.add('is-on');
    shownAt = performance.now();
    detailTimer = window.setTimeout(() => layer.classList.add('is-detailed'), DETAIL_DELAY_MS);
  }, GRACE_MS);

  /** 慢网那两句。降级的那句优先级更高 —— 它解释的是画面本身会变 */
  const noteTimers = [
    window.setTimeout(() => { if (!degraded) setBi(note, COPY.loading.slow); }, SLOW_MS),
    window.setTimeout(() => { if (!degraded) setBi(note, COPY.loading.slower); }, SLOWER_MS),
  ];

  const onDegrade = (): void => {
    degraded = true;
    setBi(note, COPY.loading.degraded);
  };
  addEventListener('sb:degrade', onDegrade);

  function render(): void {
    let sum = 0;
    for (const stage of STAGES) sum += stage.weight * (rows.get(stage.id)?.value ?? 0);
    shown = Math.max(shown, Math.min(1, sum));
    // 99% 停一下比冲到 100% 再等着好：到 100 还没进去才真的像坏了
    const n = Math.min(99, Math.floor(shown * 100));
    pct.textContent = `${n}%`;
    fill.style.width = `${shown * 100}%`;
    for (const stage of STAGES) {
      const row = rows.get(stage.id);
      if (!row) continue;
      const done = row.value >= 1;
      row.root.classList.toggle('is-waiting', !row.started && !done);
      row.root.classList.toggle('is-active', row.started && !done);
      row.root.classList.toggle('is-done', done);
      // 已经开跑、但还没有任何可测的进度 → 三个点，不是 "0%"。
      // "0%" 是一个**数字**，数字不动就读成卡住了；三个点只说"在动"，
      // 而这恰好是此刻唯一为真的事（见文件头第 2 条：没有真信号的地方不许编）。
      row.state.textContent = done
        ? COPY.loading.ready.zh
        : !row.started ? COPY.loading.waiting.zh
        : row.value > 0 ? `${Math.floor(row.value * 100)}%` : '···';
    }
  }

  render();

  function cleanup(): void {
    clearTimeout(graceTimer);
    clearTimeout(detailTimer);
    for (const t of noteTimers) clearTimeout(t);
    removeEventListener('sb:degrade', onDegrade);
  }

  return {
    begin(id) {
      const row = rows.get(id);
      if (!row || finished) return;
      row.started = true;
      render();
    },
    progress(id, value) {
      const row = rows.get(id);
      if (!row || finished) return;
      row.started = true;
      // 只许前进：零件档的分母会随着预取排队变大，让它往回跳等于自己承认在瞎猜
      row.value = Math.max(row.value, Math.min(1, Math.max(0, value)));
      render();
    },
    done(id) {
      const row = rows.get(id);
      if (!row || finished) return;
      row.started = true;
      row.value = 1;
      render();
    },
    finish() {
      if (finishPromise) return finishPromise;
      finished = true;
      cleanup();
      console.info(`[loading] 加载完成，耗时 ${Math.round(performance.now() - t0)}ms`);
      // 宽限期内就结束的：一帧都没画过，直接摘掉，不要放一次没人看见的淡出
      if (!layer.classList.contains('is-on')) {
        layer.remove();
        finishPromise = Promise.resolve();
        return finishPromise;
      }
      // 真的到齐了，不再是"99% 假装还没到"——见 render() 里那条注释，那条只管中途
      pct.textContent = '100%';
      fill.style.width = '100%';
      // 退场三步，每一步等上一步真的做完（文件头「字标落定，其余才回来」）：
      // 细节先收起 → 字标从大变小挪到角落 → 到位闪一下 → 整层摘掉。
      // 首屏下这层的底可能是透明的（让展签后的 attract 种子活着），
      // 所以不能再靠“底色会盖住”来幸运隐藏选择页。`ChooseOptions.beforeReveal`
      // 把选择页的 DOM、输入和入场时间线全部留在这个 Promise 后面；
      // 这里的职责是到真正 `layer.remove()` 才交出显示权。
      // 两条下限取更大的那个：MIN_SHOW_MS 保证"这一层至少露了多久"（缓存命中时管用）；
      // DONE_HOLD_MS 保证"真到 100% 之后至少停这么久"（冷启动早就过了 MIN_SHOW_MS，
      // 不加这一条的话数字刚跳到 100% 画面就换了）。都只晚收，不晚开始——
      // 舞台、摄像头照常往下走，等的只有这一层自己摘掉（含退场那三步）
      const wait = Math.max(MIN_SHOW_MS - (performance.now() - shownAt), DONE_HOLD_MS);
      finishPromise = runLoadingExit({
        waitMs: wait,
        detailsMs: SETTLE_DETAILS_MS,
        moveMs: SETTLE_MOVE_MS,
        flashMs: SETTLE_FLASH_MS,
        hasMark: mark !== null,
        onDetails: () => layer.classList.remove('is-detailed'),
        onMove: () => mark?.classList.remove('is-big'),
        onSettled: () => mark?.classList.add('is-settled'),
        onRemove: () => layer.remove(),
        onError: (error) => console.warn('[loading] 退场某一步失败，已继续交棒：', error),
      });
      return finishPromise;
    },
  };
}
