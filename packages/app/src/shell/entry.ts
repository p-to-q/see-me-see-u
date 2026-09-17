/**
 * 网页版入口层 —— 一块展签，不是一个落地页。
 *
 * ## 它解决的那一个问题
 *
 * `docs/PRD §8` / `docs/23 §S0 网页分支`：**不要求授权也能看见东西。**
 * 一个陌生人打开这个 URL，第一眼不该是浏览器的权限弹窗 —— 直接弹权限会流失
 * 绝大多数人，而且弹窗挡住的恰好是这件作品唯一能说服人的东西：画面。
 *
 * 所以顺序被掰成了这样：
 *
 * ```
 *   打开 URL → 展签（作品名 + 一句话 + 两个动作）
 *            → 「开始」→ 回放驱动的身体先跑起来，**一次权限都不问**
 *            → 右下角一行「用我的摄像头」→ 这才是唯一请求权限的地方
 * ```
 *
 * ## 它刻意不做的事
 *
 * 不做滚动、不做特性列表、不做页脚链接堆、不做第三个按钮。
 * 「了解这件作品」把所有解释都甩给 `/about` —— 入口层只负责让人进去或让人读。
 *
 * 现场（`?kiosk=1`）和任何带明确意图的深链（`?demo=` / `?theme=` / `?act=` …）
 * 一律跳过这一层：装置前面没有人会点「开始」，而深链的意思就是"我知道我要什么"。
 *
 * ## 展签背后的那一团
 *
 * 这一层**不是一块纯色底**：选择页那个环的场（`choose/ring/field.ts`）在它出现之前
 * 就已经挂上去、种子已经出生、在背后缓慢地转。按下「开始」不是"这一层淡出、
 * 那一页淡入"，而是**同一个场进入下一个阶段** —— 卡片开始一张张从前一张里剥出来。
 * 这是"一比一"里最容易被做丢的一半：参考作品的入场之所以成立，
 * 前提正是在剥离之前所有卡片本来就已经在那里了。
 *
 * 场起不来（没有 WebGPU）时这一层原样退回纯色底 —— 展签本身不依赖它。
 */
import { COPY, setBi, cjkClass } from '../ui/i18n.ts';
import { acquireRingField } from '../choose/ring/field.ts';
import { holdFirstScreen } from '../choose/ring/first-screen.ts';
import { brandShown, canTransition, declareShared, morph } from '../ui/page-transition.ts';
import type { Flags } from './kiosk.ts';
import '../ui/type.css';
import './entry.css';

/** 出场动效 180ms（docs/23 §0），放完再从 DOM 里摘掉 */
const LEAVE_MS = 180;

function biNode<K extends keyof HTMLElementTagNameMap>(
  tag: K, t: { zh: string; en: string }, className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  setBi(node, t);
  return node;
}

function dismiss(node: HTMLElement): void {
  node.classList.add('is-leaving');
  // 标记和展签同时退场：展签一走，加载态（如果还在）就该重新说话了
  document.documentElement.classList.remove('sb-entry-up');
  setTimeout(() => node.remove(), LEAVE_MS);
}

export interface Entry {
  /** 观众按下「开始」之前，主流程停在这里等 */
  readonly started: Promise<void>;
  /** 展签真的立起来了。`?hall=1` 回来时是 false：选择页直接出现，但仍按"按过开始"那条路起步 */
  readonly shown: boolean;
  /** PartLibrary 到货后填入物种数；null 保留未知短横。 */
  setSpeciesCount(count: number | null): void;
}

/**
 * 深链 = "我知道我要什么"，别拿展签挡路。
 * `?debug` / `?nopost` 这种纯排查开关不算意图，所以不在这张表里。
 */
export function wantsEntry(flags: Flags): boolean {
  return !flags.kiosk && !flags.demo && !flags.theme && !flags.act && !flags.plan;
}

/**
 * 挂上入口层。返回 `null` 表示这次不需要它（现场 / 深链），调用方直接往下走。
 *
 * 注意它**不阻塞 boot 的其余部分**：渲染器、资产、模型都在展签后面照常加载，
 * 所以按下「开始」时身体通常已经准备好了。await 的只有 `started`。
 */
/**
 * 巨题。按**空格**拆成两个 block，不靠 CSS 断行。
 *
 * 试过 `width: min-content` —— 它在**连字符**处也断，`SEE-ME SEE-U` 变成四行
 * （SEE- / ME / SEE- / U）。而这个名字里的连字符是名字的一部分，不是可断点。
 * 拆在 DOM 里是唯一确定的做法：断点由我们定，不由排版引擎猜。
 */
function titleNode(): HTMLElement {
  const h1 = document.createElement('h1');
  h1.className = 'sb-entry-title';
  const zh = document.createElement('span');
  // 补偿按**字**打，不按槽位打（i18n.ts 的 cjkClass）。这一对是全站唯一倒置的：
  // 承重行里装的是 `SEE-ME SEE-U`，辅助行里才是汉字。
  zh.className = `sb-zh${cjkClass(COPY.title.zh)}`;
  for (const word of COPY.title.zh.split(' ')) {
    const line = document.createElement('span');
    line.textContent = word;
    zh.append(line);
  }
  const en = document.createElement('span');
  en.className = `sb-en${cjkClass(COPY.title.en)}`;
  en.textContent = COPY.title.en;
  h1.className = 'sb-entry-title sb-bi';
  h1.append(zh, en);
  // 这一行字和 /about 的巨题是同一件东西；按下「开始」时它挪成选择页左上角的字标（docs/47）
  declareShared(h1, 'title');
  return h1;
}

export function mountEntry(flags: Flags): Entry | null {
  if (!wantsEntry(flags)) return null;

  // 从舞台「回到大厅」回来（docs/47 §5）。展签已经读过一次，不再挡路；
  // 但返回值照旧不是 null —— main.ts 据此用回放起步，不在大厅里弹摄像头权限。
  if (flags.hall) {
    const field = acquireRingField();
    field.play();
    return { started: Promise.resolve(), shown: false, setSpeciesCount() {} };
  }

  const layer = document.createElement('div');
  layer.className = 'sb-entry';

  // 展签自己也要白底黑字 —— 哪怕场起不来（那时它就是一块纯白的展签）
  const releaseFirstScreen = holdFirstScreen();

  // 场先挂上：种子在展签背后出生。这一步是同步的，WebGPU 的初始化在背后跑；
  // 起不来就把 has-field 摘掉，退回纯色底（P3：每条降级路径都必须存在）。
  const field = acquireRingField();
  layer.classList.add('has-field');
  field.attract();
  void field.ready.then((ok) => {
    if (!ok) layer.classList.remove('has-field');
  });

  const enter = biNode('button', COPY.entry.enter, 'sb-act');
  enter.type = 'button';

  const learn = document.createElement('a');
  learn.className = 'sb-act';
  learn.href = '/about';
  setBi(learn, COPY.entry.learn);

  const actions = document.createElement('div');
  actions.className = 'sb-entry-actions';
  actions.append(enter, learn);

  // 隐私一行必须在页面上（docs/13 §5）；入口层给短句，完整那段在 /about
  const foot = document.createElement('div');
  foot.className = 'sb-entry-foot';
  foot.append(biNode('p', COPY.privacy.short, 'sb-label'));

  /**
   * 版面照**美术馆作品标签**排（参照 zkm.de 的作品页）：
   * 巨题 → 大留白 → 标签化的元数据（标签 + 值，纵向） → 一句问句 → 动作。
   *
   * 为什么是这个结构：这件作品就是一件装置，而装置在展厅里就是这样被介绍的。
   * 它比"标题 + 一句卖点 + 两个按钮"更接近作品应有的语域，
   * 而且元数据把"这是什么"说清楚了，不用再写一句概括的话去凑。
   */
  const meta = document.createElement('dl');
  meta.className = 'sb-entry-meta';
  let speciesValue: HTMLElement | null = null;
  const rows: [{ zh: string; en: string }, { zh: string; en: string } | 'species'][] = [
    [COPY.entry.metaYear, COPY.entry.metaYearV],
    [COPY.entry.metaForm, COPY.entry.metaFormV],
    [COPY.entry.metaSpecies, 'species'],
    [COPY.entry.metaDuration, COPY.entry.metaDurationV],
  ];
  for (const [k, v] of rows) {
    meta.append(biNode('dt', k, 'sb-label'));
    if (v === 'species') {
      // 先占位，PartLibrary 到货后由 main.ts 填同一份索引里的数。
      // 占位是一条短横而不是 0 —— 0 是一个**错的数**，短横是"还不知道"。
      const dd = document.createElement('dd');
      dd.dataset.species = '';
      dd.textContent = '—';
      speciesValue = dd;
      meta.append(dd);
    } else {
      meta.append(biNode('dd', v));
    }
  }

  layer.append(
    // 这里**什么都不放**。
    //
    // 原来是一行「实时交互装置 · 2026」，后来换成两行字标 —— 两个都不对：
    // 前者说的形式和年份在下面的元数据里各有一行，是重复；
    // 后者是 `SEE ME / SEE U` 的口语写法，而它正下方就立着同一句话的巨题，
    // 同一个名字在一屏上说两遍，读起来是版面在结巴。
    // 字标属于**没有巨题的那几页**（文档页的页眉），不属于这一屏。
    titleNode(),
    biNode('p', COPY.entry.question, 'sb-entry-lede'),
    meta,
    actions,
    foot,
  );

  document.body.append(layer);
  // 告诉加载态"展签在场"：它就不再出文字了，只留那条进度线。
  // 两层都贴底，实测会互相压字 —— 而展签本身就是加载屏，
  // 观众在读那块标签的时候加载正在背后进行，他不需要第二段文字告诉他在等。
  document.documentElement.classList.add('sb-entry-up');
  enter.focus({ preventScroll: true });

  const started = new Promise<void>((resolve) => {
    enter.addEventListener('click', () => {
      // 剥离从这一下开始 —— 但真正开剥要等卡片到齐（见 field.ts 的"闸门"）。
      // 在那之前观众看到的还是那一团在转，而不是一圈空白卡。
      field.play();
      // 巨题不跟着展签一起淡掉：它等选择页左上角的字标挂上，挪过去变成它（docs/47）。
      // 其余的字当场收起；等不到字标（HANDOFF_WAIT_MS）或不支持过渡，就走原来那条淡出。
      const title = layer.querySelector<HTMLElement>('.sb-entry-title');
      if (title && canTransition()) {
        layer.classList.add('is-handing');
        document.documentElement.classList.remove('sb-entry-up');
        void brandShown().then(() => {
          if (!morph(title, 'mark', () => layer.remove())) layer.remove();
        });
      } else {
        dismiss(layer);
      }
      // 展签这一份还回去。环和选择页还各自 hold 着，所以底色不会在这里翻 ——
      // 只有深链（`?theme=`，选择页根本不挂）那一条会一路还到 0，那是对的。
      releaseFirstScreen();
      resolve();
    }, { once: true });
  });

  return {
    started,
    shown: true,
    setSpeciesCount(count) {
      if (speciesValue) speciesValue.textContent = typeof count === 'number' && Number.isInteger(count) && count > 0
        ? String(count) : '—';
    },
  };
}

/**
 * 运行中的「用我的摄像头」。整个体验里唯一请求摄像头权限的地方。
 *
 * `use()` 失败（用户拒绝、没有摄像头）时按钮**留在原地**：
 * 回放还在跑，画面没坏，观众可以再点一次 —— 这条正是 `docs/23 §S1` 的那一行。
 */
export function mountCameraButton(use: () => Promise<boolean>): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sb-act sb-camera';
  setBi(btn, COPY.boot.noCamera);
  btn.addEventListener('click', () => {
    btn.disabled = true;
    void use().then((ok) => {
      if (ok) dismiss(btn);
      else btn.disabled = false;
    });
  });
  document.body.append(btn);
}
