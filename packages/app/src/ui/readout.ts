/**
 * 左下角那块读数 —— 「它此刻从你身上读到了什么」。
 *
 * ## 它解决的那一个问题
 *
 * 这件作品的整条链是一具身体被一台机器**读**成数。观众看得见结果（那具身体在动），
 * 看不见读的过程 —— 于是它读起来像魔法，而魔法是这件作品最不想要的一种阅读：
 * 它的题目恰恰是"把一个人翻译成数据要付出什么代价"。
 * 这块读数把那次翻译摊开：置信度、认出几个点、每秒读你几次、动能、舒展。
 * **五个数都是这一帧真的在算的数**，一个都不是为了显示而新算的。
 *
 * ## 它为什么带边框（`docs/26 §F` 的反面清单）
 *
 * 完整的论证写在 `readout.css` 的文件头，请在那里读。一句话：
 * 反面清单约束的是**作品的声音**，而仪表按定义不在那个集合里、并且必须看起来
 * 不在那个集合里 —— 把边去掉，这五行字就退回作品自己的排版，
 * 于是一件装置开口报数（`docs/44 §7`：仪表不是诚实，仪表是工具）。
 *
 * ## 上面装什么：只装测量，不装决定
 *
 * 这是这一块唯一的内容规矩，也是它不变成一个 debug dump 的全部原因。
 *
 * **留下的（测量：机器从这个人身上读到的）**
 *
 * | 行 | 来自 | 为什么它必须在 |
 * |---|---|---|
 * | 置信 | `RawPose.score` | 整条链都压在这一个数上。它一掉，身体就发木——这是观众唯一会亲眼撞见的失败 |
 * | 关节 | 逐点 `visibility` | 半个人出画时 score 往往还很高（`preview-state.ts` 头一段）。这一行是那件事唯一的数字证据 |
 * | 推理 | `Capture.fps` | **它不是帧率。** 它是"每秒重新看你几次"——渲染 120fps 而推理 12Hz 的机器，画面顺、身体木 |
 * | 动能 | `MotionFeatures.energy` | 无量纲、换个人读数一样，而且它就是推动整件作品往前走的那个量（`evolution.ts`） |
 * | 舒展 | `MotionFeatures.expansiveness` | 唯一一个**形状**的量（四肢离骨盆多远），其余都是速率。它给地面接触阴影定半径 |
 *
 * **删掉的，以及为什么**
 *
 * - **fps / 三角数 / draw calls / CPU ms** —— 它们是**机器的健康**，不是这个人的身体。
 *   `?debug=1` 的 HUD 已经带预算标红在显示它们（`shell/hud.ts`），
 *   再显示一份就是第二个会漂的仪表；而且"超预算标红"是我们的事，
 *   观众读到一个红数字只会以为作品坏了。
 * - **乐章 / 弧线进度 / 档位 / charge / 当前玩法** —— 这些是**作品的决定**，不是测量。
 *   `docs/40 §5`：「不要给观众进度条…进度条把一段经历翻译成一个百分比，
 *   而这件作品的题目正是那种翻译的代价」；`docs/23 §S5`：升档
 *   「没有文字、没有等级数字」；`docs/44 §7`：乐章的名字只出现在 `?debug=1` 上。
 *   把它们放上来，这块面板就从"机器在读你"变成"剧透这场演出还剩多久"。
 * - **换了几件 / 借距 / 下一件还有几秒（忒修斯，`core/src/theseus.ts`）** ——
 *   它现在**真的存在了**，而且是这件作品此刻算得最清楚的一组数。
 *   **仍然不上来**，而且理由比上面那几条更硬：
 *
 *   `docs/44 §7` 把这三个数指名挂在 `?debug=1` 上，小标题就是
 *   「**给操作员，不给观众**」，正文写着「它和观众无关」。
 *   同一节的「知道」那一段写得更死：三件事共同完成"观众知道发生了什么"，
 *   **没有一件是 UI** —— 而第一件是「它拿走你刚用过的那一部分。挥两次手，
 *   第三次他会怀疑。**这是这件作品唯一一处可以被观众主动验证的机制**，
 *   而能被验证的东西才是被知道的东西」。
 *   在面板上写「已换 12/18」，就是把那次怀疑、那次验证、那个发现
 *   替他做完了。省下的十秒钟，换掉的是这件作品唯一一次"他自己发现"。
 *
 *   `?debug=1` 的 HUD 上有而这块面板上没有，**不是遗漏，是这两块仪表服务两种人**：
 *   HUD 是我们的（现场调速率的人靠它不靠掐表），这块是观众的。
 *   两块内容一样的话，其中一块就是多余的。
 * - **哪根骨头此刻最活跃（`createBoneEnergy`）** —— 同一条，而且更直接：
 *   它就是上面那个"可以被验证的机制"的输入。把最活跃的那一根写在屏幕上，
 *   等于先把谜底印在谜面旁边。
 * - **速度 / 顿挫（speed / jerk）** —— 和动能是同一个轴的三个时间常数
 *   （`motion.ts`：energy 是 speed 的慢 EMA）。三行说同一件事 = 这是一个 log，不是仪表。
 * - **对称 / 竖直度 / 静止度（symmetry / verticality / stillness）** ——
 *   算了，但**全仓没有任何消费者**（`grep` 过）。一个作品自己都不用的数，
 *   放在观众面前是装饰。
 * - **观测身高** —— 想要，但**这一轮不敢要**：`core/skeleton.ts` 的
 *   `observedHeight()` 在脚出画时退回 `SKELETON.referenceHeight`（1.7m），
 *   而从外面**分不出**一次测量和一个缺省值。脚出画在现场很常见。
 *   一个分不出真假的数就是 P21 里最贵的那种仪表，所以它不上来。
 *
 * ## 刷新率：4Hz，不是每帧
 *
 * 每帧写一次 DOM 有两个后果，都比省下来的那点开销贵：一块 60Hz 闪烁的数字板
 * 在一具等身的身体底下**会赢**（人眼先看动的东西）；而且没有人能读一个
 * 每秒变 60 次的数。4Hz 既读得出，又仍然是"实时"。字宽不变，
 * 所以刷新的时候一个像素都不回流（度量写在 `readout.css`）。
 */
import type { MotionFeatures, RawPose } from '../../../core/src/types.ts';
import type { Flags } from '../shell/kiosk.ts';
import { COPY, setBi } from './i18n.ts';
import {
  alignDecimals, createAlarmWatch, readOut, READOUT_KEYS, splitUnit, wantsReadout,
  type AlarmCode, type Level, type ReadoutKey,
} from './readout-state.ts';
import './type.css';
import './readout.css';

// 挂不挂的判断住在 `readout-state.ts`（它是纯的，能在 node 里测；
// 这个文件 import 了 CSS，进不了 node 测试）。从这里转出去，
// 是为了调用方只需要认识一个模块 —— 和 `preview.ts` 同一条路数。
export { wantsReadout } from './readout-state.ts';

/** 多久重画一次。见文件头最后一节 */
const SAMPLE_SECONDS = 0.25;

/**
 * 面板的高度写到根上的这个变量里，左下角的名牌据此抬到读数上面（`shell/notice.css`）。
 * 名牌只说 4 秒，读数一直在 —— **常驻的几何不给 4 秒的东西让位**，反过来让。
 */
const HEIGHT_VAR = '--sb-readout-h';

export interface Readout {
  /** 每帧调一次。`pose` / `features` 是帧循环手上那一份，不另算 */
  update(pose: RawPose | null, features: MotionFeatures | null, inferenceHz: number, dt: number, aspect?: number): void;
  dispose(): void;
}

export interface ReadoutOptions {
  flags: Flags;
  mount?: HTMLElement;
  /** 此刻喂进来的是不是摄像头（`main.ts` 的 `cameraOn`）。缺省当作摄像头 */
  live?: () => boolean;
  /** 上半身是正当取景（`main.ts` 的取景模式）。WRN12 不为画面下边的腿报警。缺省 false */
  upperIsIntended?: () => boolean;
}

export function mountReadout(options: ReadoutOptions): Readout | null {
  if (typeof document === 'undefined' || !wantsReadout(options.flags)) return null;

  const root = document.createElement('aside');
  root.className = 'sb-readout';

  // ── 读数本体：状态行 · 五行三栏（**中间不画线**：整块板只有底边那一条） ─────
  const body = document.createElement('div');
  body.className = 'sb-readout-body';
  body.id = 'sb-readout-body';

  const state = document.createElement('p');
  state.className = 'sb-readout-state';
  // 中英并置一律走 setBi：`sb-cjk` 由它按**内容**打，手搭 DOM 会漏掉那 0.045em 补偿
  setBi(state, COPY.readout.absent);

  const rows = document.createElement('div');
  rows.className = 'sb-readout-rows';

  const cells = new Map<ReadoutKey, { value: HTMLElement; num: HTMLElement; unit: HTMLElement }>();
  for (const key of READOUT_KEYS) {
    const name = document.createElement('span');
    name.className = 'sb-readout-name';
    setBi(name, COPY.readout[key]);
    // 数和单位**住在同一格里、同一行文字里**：单位跟着数字的基线走，落在数字右下方。
    // 原来单位是另一个网格格子，字号小一号的那一格按自己的行盒对齐，截图上 Hz 就飘在 31 的上面。
    const value = document.createElement('span');
    value.className = 'sb-readout-value';
    const num = document.createElement('span');
    num.className = 'sb-readout-num';
    const unit = document.createElement('span');
    unit.className = 'sb-readout-unit';
    value.append(num, unit);
    rows.append(name, value);
    cells.set(key, { value, num, unit });
  }
  // 最后一行：告警代码 + 那一句。**永远占着高度**（没事时写「正常」），告警来去面板不长不缩
  const alarm = document.createElement('p');
  alarm.className = 'sb-readout-alarm';
  const code = document.createElement('span');
  code.className = 'sb-readout-code';
  const message = document.createElement('span');
  setBi(message, COPY.readout.normal);
  alarm.append(code, message);

  body.append(state, rows, alarm);

  // ── 最底下那一条：题 + 显示 / 收起 ───────────────────────────────────────
  const bar = document.createElement('button');
  bar.type = 'button';
  bar.className = 'sb-readout-bar';
  bar.setAttribute('aria-controls', body.id);
  const title = document.createElement('span');
  title.className = 'sb-readout-title';
  setBi(title, COPY.readout.title);
  const action = document.createElement('span');
  action.className = 'sb-readout-action';
  bar.append(title, action);

  // **顺序是版式的一部分**：开合键最后 append，面板贴底 ——
  // 于是展开 / 收起时上面那一截长出来或缩回去，那个键一个像素都不动。
  root.append(body, bar);
  (options.mount ?? document.body).append(root);

  let since = SAMPLE_SECONDS;      // 第一帧就画一次，别让面板空着出现
  const watch = createAlarmWatch();
  let shownCode: AlarmCode | null | undefined;
  const LEVEL_CLASS: Record<Level, string | null> = { ok: null, warn: 'is-warn', alarm: 'is-alarm' };
  const paint = (el: HTMLElement, level: Level): void => {
    el.classList.toggle('is-warn', LEVEL_CLASS[level] === 'is-warn');
    el.classList.toggle('is-alarm', LEVEL_CLASS[level] === 'is-alarm');
  };
  let shownPresent: 'replay' | 'present' | 'absent' | null = null;
  let open = false;

  // **默认收起**（作品负责人 2026-09-14）：画面上首先该是身体，读数是想看的人自己点开的东西。
  // 收起**不写进任何存储**：刷新就回到收起（docs/40 §3，跨观众的状态当 bug）
  const setOpen = (next: boolean): void => {
    open = next;
    body.hidden = !next;
    root.classList.toggle('is-collapsed', !next);
    bar.setAttribute('aria-expanded', String(next));
    setBi(action, next ? COPY.readout.hide : COPY.readout.show);
    // 重新展开的那一刻立刻画一次，不让观众看见一屏半秒前的旧数
    if (next) since = SAMPLE_SECONDS;
  };
  setOpen(false);
  bar.addEventListener('click', () => setOpen(!open));

  // **矮视口里两块仪表会撞**：左上角那块屏幕往下长，这块往上长（实测 385px 高的窗口里
  // 读数的顶压到了屏幕中间）。挂载时量一次，撞了就先收着，只剩底边那一条。
  // 只在挂载时判 —— resize 时替观众自动开合，等于在他手底下换开关的状态。
  const see = document.querySelector('.sb-see');
  if (see && see.getBoundingClientRect().bottom + 12 > root.getBoundingClientRect().top) setOpen(false);

  const html = document.documentElement;
  const publishHeight = (): void => {
    html.style.setProperty(HEIGHT_VAR, `${root.offsetHeight}px`);
  };
  publishHeight();
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publishHeight);
  resize?.observe(root);

  return {
    update(pose, features, inferenceHz, dt, aspect) {
      since += Number.isFinite(dt) && dt > 0 ? dt : 0;
      // 收着的时候不写 DOM：看不见的数不值得一次样式重算
      if (!open || since < SAMPLE_SECONDS) return;
      const elapsed = since;
      since = 0;

      const input = {
        pose, features, inferenceHz, live: options.live?.() ?? true,
        upperIsIntended: options.upperIsIntended?.() ?? false,
        aspect,
      };
      const r = readOut(input);
      // 告警憋过才换（readout-state.ts 的 createAlarmWatch），所以喂进去的是这两次采样之间真实过去的时间
      const a = watch.update(input, elapsed);
      // 顶上那一行三种说法：摄像头关着（身体在放录像）/ 有人 / 无人
      const said = !r.live ? 'replay' : r.present ? 'present' : 'absent';
      if (said !== shownPresent) {
        shownPresent = said;
        root.classList.toggle('is-present', r.present);
        setBi(state, said === 'replay' ? COPY.readout.replay : r.present ? COPY.readout.present : COPY.readout.absent);
      }
      for (const key of READOUT_KEYS) {
        const cell = cells.get(key)!;
        const [raw, unit] = splitUnit(r.values[key]);
        const value = alignDecimals(raw);   // 小数点竖成一条线（readout-state.ts）
        // 值没变就不写 DOM。4Hz 下大部分行大部分时候是不变的
        if (cell.num.textContent !== value) cell.num.textContent = value;
        if (cell.unit.textContent !== unit) cell.unit.textContent = unit;
        // 整格变色：数和它的单位一起（单位继承颜色）
        paint(cell.value, a.levels[key]);
      }
      if (a.code !== shownCode) {
        shownCode = a.code;
        paint(alarm, a.code === null ? 'ok' : a.code.startsWith('ALM') ? 'alarm' : 'warn');
        // 代码按数控板的写法排：ALM01 → ALM 01
        code.textContent = a.code === null ? '' : a.code.replace(/^([A-Z]+)(\d+)$/, '$1 $2');
        setBi(message, a.code === null ? COPY.readout.normal : COPY.readout.alarms[a.code]);
      }
    },
    dispose() {
      resize?.disconnect();
      html.style.removeProperty(HEIGHT_VAR);
      root.remove();
    },
  };
}
