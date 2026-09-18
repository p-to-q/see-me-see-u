/**
 * 右下角那一列 —— 观众对**这具身体**的三个处置。
 *
 * ## 它解决的那一个问题
 *
 * 选完物种之后作品就满屏跑起来，而此后观众**没有任何出口**：
 * 想换一个物种只能刷新地址栏（现场没有地址栏），想让它停下来只能走开。
 * 右下角此前只有两行会自己淡掉的提示（`shell/notice.ts` 的降级提示、
 * `shell/entry.ts` 的「用我的摄像头」），小、灰、四秒就没 —— 那不是入口。
 *
 * 所以这一列只放**三件此刻真的可做的事**，一件都不编：
 *
 *   回到大厅        重载回选择页（S3 → S2）
 *   把身体还回去    它不再跟着你，改演自己的动作；**摄像头照开、采集照跑**
 *   摄像头          开 / 关，并且把"现在是开着的"这件事**显示出来**
 *
 * ## 四条设计决定
 *
 * 1. **「回到大厅」走重载，而且把当前全部状态写回 URL。**
 *    理由不是我重新想的，是 `ui/controls.ts` 文件头第 2 条已经得出的结论：
 *    换物种必须重建身体（重新预取零件、重建基因组），所以只能重载；
 *    而重载时**只带上变化的那一个参数**会让演示到一半刚调好的场景、玩法、
 *    跟随延迟全部回默认 —— 现场演示在这里就断了。
 *    这一列把同一条结论用在反方向上：**删掉** `theme`（回大厅就是要重新选），
 *    其余一项不少地带过去。纯函数 `hallSearch()` 就是那一条，单测钉住它。
 *
 * 2. **「把身体还回去」不是关摄像头。** 关掉摄像头是一次断电，
 *    而这件作品的命题是"那具身体和我是什么关系"——
 *    让它当着你的面**收回自己的身体、继续动**，比让画面停下来狠得多。
 *    实现上它就是 `director.force('untether')`，再按一下 force 回 `follow`：
 *    玩法系统（docs/16）本来就是为"身体怎么动"准备的扩展点，不另起炉灶。
 *
 * 3. **摄像头是一个带状态的开关，不是一张预览图。**
 *    左上角另有人在做预览窗；这一列只回答"它现在是不是在看着我"，
 *    并且给出改变这件事的那一下。两者不重复。
 *
 * 4. **`?kiosk=1` 下整列不挂。** 无人值守的装置不该向公众提供「回到大厅」——
 *    第一个观众就会把它按回选择页然后走开。判断只有 `readFlags().exits` 一处
 *    （和目录同一条路数），挂载点不许自己再判一次。
 *
 * 版式：没有卡片、阴影、圆角、图标（docs/26 §F）。行是"名字 + 状态"，
 * 行与行之间一条细横线 —— 和 `ui/nav.ts` 的那张表、`ui/corner.ts` 的三节同一套语言。
 * 字号走 `--sb-size-h2`（和右上角两个题同一档），因为它压在实时画面上，
 * 而此前那几行 `--sb-size-small` 的灰字在现场基本读不出来。
 */
import { COPY, setBi, type BiText } from './i18n.ts';
import { hallSearch } from './exits-url.ts';
import type { ControlValues } from './control-table.ts';
import './type.css';
import './exits.css';

export { HANDED_BACK_ACT, hallSearch } from './exits-url.ts';

/**
 * 这一列的高度写到根上，右上角的控件面板据此给它让位（`controls.css` 的 max-height）。
 * 和 `ui/readout.ts` 的 `--sb-readout-h` 同一个写法：面板展开滚到底时曾经压在这一列上。
 */
const HEIGHT_VAR = '--sb-exits-h';

export interface ExitsHost {
  /** 当前这一屏的全部状态（和控件条同一份），交给 `hallSearch()` 带走 */
  state(): ControlValues;
  /** 身体现在是不是已经"还回去了"（不再跟随） */
  handedBack(): boolean;
  /** 还回去 / 收回来。返回**切换之后**的真实状态 —— 玩法可能被 Director 禁用了 */
  setHandedBack(on: boolean): boolean;
  /** 摄像头现在是不是在采集（回放驱动时为 false） */
  cameraOn(): boolean;
  /** 开 / 关摄像头。返回**切换之后**的真实状态（拒绝授权时仍然是 false） */
  setCamera(on: boolean): Promise<boolean>;
  /**
   * 摄像头正在打开（按下之后、第一次推理完成之前）。那一行据此写「正在打开」——
   * 不给的话那几秒里它只是变灰，字还写着「关着」（docs/48 §2）。
   */
  cameraStarting?(): boolean;
  /** 观众的手移到了摄像头那一行上（悬停 / 聚焦）：可以先把模型取起来，不要权限 */
  cameraIntent?(): void;
}

export interface ExitsOptions {
  /**
   * 挂不挂。调用方传 `readFlags().exits` —— 判断只有那一处（见文件头第 4 条）。
   */
  enabled?: boolean;
  host: ExitsHost;
  mount?: HTMLElement;
}

export interface Exits {
  root: HTMLElement;
  /** 把状态刷新到 host 的当前值。摄像头那一行是异步的，切完要刷一次 */
  sync(): void;
  dispose(): void;
}

/** 一行：名字（中英并置）+ 右边的状态词。没有图标，没有圆角 */
type ExitAction = 'hall' | 'give' | 'camera';

function row(action: ExitAction, name: BiText, state: BiText | null): {
  el: HTMLButtonElement; setState(t: BiText): void;
} {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'sb-exit';
  // 给键盘、测试和现场探针一个不随文案 / 排序变的名字。不参与样式。
  el.dataset.action = action;

  const label = document.createElement('span');
  label.className = 'sb-exit-name';
  // 中英并置一律走 setBi：`sb-cjk` 由它按**内容**打，手搭 DOM 会漏掉那 0.06em
  // 补偿（选择页刚修掉的就是这个形状的 bug，见 i18n.ts 的 cjkClass）。
  setBi(label, name);

  const st = document.createElement('span');
  st.className = 'sb-exit-state sb-bi-inline';
  if (state) setBi(st, state);

  el.append(label, st);
  return { el, setState: (t) => setBi(st, t) };
}

export function mountExits(options: ExitsOptions): Exits | null {
  const { enabled = true, host, mount = document.body } = options;
  if (!enabled || typeof document === 'undefined') return null;

  const C = COPY.exits;
  const root = document.createElement('aside');
  root.className = 'sb-exits';

  // ── 1. 回到大厅 ───────────────────────────────────────────────────────────
  // 放第一行是刻意的：它是**离开**这一屏的唯一一条路，而下面两行都是留在这一屏里改点什么。
  const hall = row('hall', C.hall, null);
  hall.el.addEventListener('click', () => {
    location.assign(`${location.pathname}?${hallSearch(location.search, host.state())}`);
  });

  // ── 2. 把身体还回去 ───────────────────────────────────────────────────────
  const give = row('give', C.give, C.giveOff);
  give.el.addEventListener('click', () => { host.setHandedBack(!host.handedBack()); sync(); });

  // ── 3. 摄像头 ─────────────────────────────────────────────────────────────
  // 这一行**同时是一个状态显示**：观众任何时候看一眼都该知道它现在有没有在看着自己。
  const cam = row('camera', C.camera, C.cameraOff);
  cam.el.addEventListener('click', () => {
    cam.el.disabled = true;
    const done = host.setCamera(!host.cameraOn());
    // 当场刷一次：「正在打开」必须在按下的这一帧就出现，不是等下一次 1 秒轮询
    sync();
    void done.finally(() => { cam.el.disabled = false; sync(); });
  });
  // 意图：手移上来就开始取模型（不碰摄像头、不问权限）。按下时省掉的是那十几 MB 的下载
  const intent = (): void => { if (!host.cameraOn()) host.cameraIntent?.(); };
  cam.el.addEventListener('pointerenter', intent);
  cam.el.addEventListener('focus', intent);

  root.append(hall.el, give.el, cam.el);
  mount.append(root);

  function sync(): void {
    const back = host.handedBack();
    give.setState(back ? C.giveOn : C.giveOff);
    give.el.classList.toggle('is-on', back);
    give.el.setAttribute('aria-pressed', String(back));
    const on = host.cameraOn();
    // 启动态是一个状态词，不是一段动画：字本身就是最终的样子（`test/camera-starting.test.ts`）
    const starting = host.cameraStarting?.() ?? false;
    cam.setState(starting ? C.cameraStarting : on ? C.cameraOn : C.cameraOff);
    cam.el.classList.toggle('is-starting', starting);
    cam.el.classList.toggle('is-on', on);
    cam.el.setAttribute('aria-pressed', String(on));
  }

  // 每秒刷一次。理由和控件条那一条一样，而且不是"保险起见"：
  // 玩法会被 Director 自己换掉（没人点过任何按钮），采集也会在运行中被换掉
  //（回放 → 摄像头，`shell/entry.ts` 的那个按钮）。两件事都不会通知这一列。
  const poll = setInterval(sync, 1000);
  sync();

  // 高度会变：摄像头那一行换字（「开着，它在看你」比「关着」长）、窄屏折行。量一次就过期
  const html = document.documentElement;
  const publishHeight = (): void => { html.style.setProperty(HEIGHT_VAR, `${root.offsetHeight}px`); };
  publishHeight();
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publishHeight);
  resize?.observe(root);

  return {
    root,
    sync,
    dispose() {
      clearInterval(poll);
      resize?.disconnect();
      html.style.removeProperty(HEIGHT_VAR);
      root.remove();
    },
  };
}
