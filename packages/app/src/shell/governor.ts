/**
 * 帧调速器 —— 页面卡了该放下什么、什么时候拿回来。**纯的**：时间和帧间隔全部由调用方给。
 *
 * ## 为什么是一个东西，不是一堆补丁（docs/48 §4）
 *
 * 卡顿的来源有十几种（推理、着色器编译、换件、GC、后台标签页……），但页面能做的动作
 * 只有几件，而且每一件都**已经有开关**：墨色采样、换件、推理频率、像素比、后期、读数刷新、伴随身体。
 * 于是这里只回答一个问题：**此刻该放下阶梯上的第几级**。谁造成的卡不重要 ——
 * 帧间隔和长任务是结果，结果变好就拿回来。
 *
 * ## 阶梯（顺序就是代价：先放下观众看不见的）
 *
 *   1 `ink`        角上字的墨色采样（2Hz GPU 读回）停；墨停在最后一次的那一档
 *   2 `swaps`      忒修斯的替换延后最多 `GOVERNOR.swapDeferMax` 秒（不取消）
 *   3 `inference`  推理降到 `GOVERNOR.inferenceHzShed`，姿态时钟插值盖住中间
 *   4 `dpr`        像素比降到 `GOVERNOR.dprShed`（实测切换本身不产生长帧，先用这枚便宜旋钮）
 *   5 `post`       临时绕过后期（第一次真实直出仍可能漏帧，所以排在已经降过 DPR 之后）
 *   6 `ui`         读数与小屏幕停止刷新（它们不驱动身体）
 *   7 `people`     只留主身体，伴随身体溶掉（docs/50 §5.4）。单人时是 no-op。放在最后：放下一个人的身体是观众最看得出来的
 *
 * ## 判据
 *
 * - 显示器节拍：最近 `refreshWindowSeconds` 秒帧间隔的第 10 百分位 —— 60 / 120 / 144Hz 屏各自为准，
 *   不低于 `refreshFloorMs`（不锁帧的页面会把它量成 1ms）。
 * - 丢帧：帧间隔 > max(节拍 × `jankRatio`, `jankFloorMs`) —— 比节拍慢，而且慢得人看得出来。
 *   过载 = 窗口里丢帧比例 > `shedAbove`，或长任务 ≥ `longTasksShed`。
 * - 有余量 = 丢帧比例 < `restoreBelow` 且窗口里没有长任务。
 *
 * ## 不闪（和 `readout-state.ts` 的告警同一条教训）
 *
 * - 过载憋 `shedAfter` 才放一级；余量憋 `restoreAfter`（更久）才拿回一级；两次变化至少隔 `minDwell`。
 * - **每次变化之后判断窗口清空**：促成上一步的证据不能再算进下一步。
 * - 拿回之后 `relapseWindow` 内又过载 = 复发，下一次拿回要憋的时间翻倍（封顶 `restoreAfterMax`）。
 * - 标签页在后台、或者一次帧间隔长过 `resumeGapMs`（机器睡醒、切回前台）：不算丢帧，窗口重来。
 *
 * ## 已知的盲区（写在这里，不假装没有）
 *
 * 如果整段 10 秒每一帧都一样慢（例如稳定 25ms 跑在 60Hz 屏上），节拍会被认成 25ms，
 * 调速器看不出卡。浏览器实际上不会这样稳定地慢 —— 丢帧总是不规则的 —— 但它不是被证明过的。
 */
import { GOVERNOR } from '../../../core/src/tuning.ts';

export type GovernorStep = 'ink' | 'swaps' | 'inference' | 'dpr' | 'post' | 'ui' | 'people';

export const GOVERNOR_LADDER: readonly GovernorStep[] = ['ink', 'swaps', 'inference', 'dpr', 'post', 'ui', 'people'];

export interface GovernorSample {
  /** 这一帧的时刻（毫秒） */
  now: number;
  /** 这一帧和上一帧的真实间隔（毫秒，**没钳过的**） */
  frameMs: number;
  /** 页面此刻在前台、且帧循环没有在无人降帧 */
  visible: boolean;
  /** 上一帧以来新出现的长任务个数 */
  longTasks?: number;
}

export interface GovernorDecision {
  level: number;
  /** +1 = 刚放下一级，-1 = 刚拿回一级 */
  changed: -1 | 0 | 1;
  /** 刚放下 / 拿回的是哪一级 */
  step: GovernorStep | null;
}

export interface Governor {
  sample(s: GovernorSample): GovernorDecision;
  /** 0 = 全开；n = 阶梯上前 n 级已经放下 */
  readonly level: number;
  sheds(step: GovernorStep): boolean;
  /** 测到的显示器节拍（毫秒）。数据不够时是 NaN */
  readonly refreshMs: number;
  /** 判断窗口里的丢帧比例 */
  readonly jank: number;
  reset(): void;
}

/**
 * 放下「替换」那一级时的延后闸。**只延后，不取消**：
 * 一件替换最多压 `maxSeconds`，调速器拿回这一级就立刻放行；
 * 压着的时候又来一件，先把压着的那件放出去，再压新的 —— 进来几件出去几件，顺序不变。
 * 返回"这一刻该执行的那几件"。没有要执行的时候返回同一个空数组（帧循环上不分配）。
 */
export interface Deferral<T> {
  offer(item: T, now: number, shed: boolean): readonly T[];
  tick(now: number, shed: boolean): readonly T[];
  readonly pending: number;
  /** 换了一个观众：压着的那件属于上一个人，丢掉是对的 */
  reset(): void;
}

const NOTHING: readonly never[] = Object.freeze([]);

export function createDeferral<T>(maxSeconds: number): Deferral<T> {
  let held: T | undefined;
  let has = false;
  let since = 0;
  return {
    offer(item, now, shed) {
      if (!has && !shed) return [item];
      const out: T[] = [];
      if (has) { out.push(held as T); has = false; held = undefined; }
      if (!shed) { out.push(item); return out; }
      held = item; has = true; since = now;
      return out.length ? out : NOTHING;
    },
    tick(now, shed) {
      if (!has || (shed && now - since < maxSeconds * 1000)) return NOTHING;
      const out = [held as T];
      has = false; held = undefined;
      return out;
    },
    get pending() { return has ? 1 : 0; },
    reset() { has = false; held = undefined; },
  };
}

const CAP = 4096;
const LT_CAP = 128;

export function createGovernor(): Governor {
  const times = new Float64Array(CAP);
  const intervals = new Float64Array(CAP);
  const scratch = new Float64Array(CAP);
  let head = 0;
  let size = 0;
  const lt = new Float64Array(LT_CAP);
  let ltHead = 0;
  let ltSize = 0;

  let level = 0;
  let windowStart = -Infinity;
  let overloadSince = Number.NaN;
  let headroomSince = Number.NaN;
  let lastChange = -Infinity;
  let lastRestore = -Infinity;
  let restoreHold = GOVERNOR.restoreAfter;
  let refresh = Number.NaN;
  let refreshAt = -Infinity;
  let jank = 0;

  const none = (): GovernorDecision => ({ level, changed: 0, step: null });

  function clearWindow(now: number): void {
    windowStart = now;
    overloadSince = Number.NaN;
    headroomSince = Number.NaN;
    ltSize = 0;
  }

  function estimateRefresh(now: number): void {
    // 250ms 重算一次：排序 1–2 千个数不该每帧都做
    if (now - refreshAt < 250 && Number.isFinite(refresh)) return;
    refreshAt = now;
    let n = 0;
    const since = now - GOVERNOR.refreshWindowSeconds * 1000;
    for (let k = 0; k < size; k++) {
      const i = (head - 1 - k + CAP) % CAP;
      if (times[i] < since) break;
      scratch[n++] = intervals[i];
    }
    if (n < GOVERNOR.minFrames) { refresh = Number.NaN; return; }
    const view = scratch.subarray(0, n);
    view.sort();
    // 不锁帧的页面会把节拍量成 1ms（无头 Chrome ~400fps 实测）：没有比 240Hz 更快的真实屏幕
    refresh = Math.max(view[Math.floor(n * 0.1)], GOVERNOR.refreshFloorMs);
  }

  function change(now: number, dir: 1 | -1): GovernorDecision {
    if (dir === 1) {
      // 复发：刚拿回来不久又撑不住 → 下一次拿回憋更久
      restoreHold = now - lastRestore <= GOVERNOR.relapseWindow * 1000
        ? Math.min(restoreHold * 2, GOVERNOR.restoreAfterMax)
        : GOVERNOR.restoreAfter;
      level++;
    } else {
      level--;
      lastRestore = now;
    }
    lastChange = now;
    clearWindow(now);
    return { level, changed: dir, step: GOVERNOR_LADDER[dir === 1 ? level - 1 : level] };
  }

  return {
    sample({ now, frameMs, visible, longTasks = 0 }) {
      if (!Number.isFinite(now) || !Number.isFinite(frameMs)) return none();
      if (!visible || frameMs > GOVERNOR.resumeGapMs) { clearWindow(now); return none(); }

      times[head] = now;
      intervals[head] = frameMs;
      head = (head + 1) % CAP;
      size = Math.min(CAP, size + 1);
      for (let k = 0; k < longTasks && k < LT_CAP; k++) {
        lt[ltHead] = now;
        ltHead = (ltHead + 1) % LT_CAP;
        ltSize = Math.min(LT_CAP, ltSize + 1);
      }

      estimateRefresh(now);
      if (!Number.isFinite(refresh)) return none();

      const from = Math.max(now - GOVERNOR.windowSeconds * 1000, windowStart);
      let n = 0;
      let bad = 0;
      // 丢帧 = 比节拍慢**而且**慢过人看得出来的那条线（60Hz 上丢一帧的量）。
      // 只看比例的话，120Hz / VRR 屏上一帧 12ms 的抖动就会让它去关后期 —— 那才是看得出来的变化
      const limit = Math.max(refresh * GOVERNOR.jankRatio, GOVERNOR.jankFloorMs);
      for (let k = 0; k < size; k++) {
        const i = (head - 1 - k + CAP) % CAP;
        if (times[i] <= from) break;
        n++;
        if (intervals[i] > limit) bad++;
      }
      let tasks = 0;
      for (let k = 0; k < ltSize; k++) {
        const i = (ltHead - 1 - k + LT_CAP) % LT_CAP;
        if (lt[i] <= from) break;
        tasks++;
      }
      if (n < GOVERNOR.minFrames) { overloadSince = Number.NaN; headroomSince = Number.NaN; return none(); }
      jank = bad / n;

      const overload = jank > GOVERNOR.shedAbove || tasks >= GOVERNOR.longTasksShed;
      const headroom = jank < GOVERNOR.restoreBelow && tasks === 0;
      if (overload) { if (Number.isNaN(overloadSince)) overloadSince = now; } else overloadSince = Number.NaN;
      if (headroom) { if (Number.isNaN(headroomSince)) headroomSince = now; } else headroomSince = Number.NaN;

      const dwelt = now - lastChange >= GOVERNOR.minDwell * 1000;
      if (overload && dwelt && level < GOVERNOR_LADDER.length && now - overloadSince >= GOVERNOR.shedAfter * 1000) {
        return change(now, 1);
      }
      if (headroom && dwelt && level > 0 && now - headroomSince >= restoreHold * 1000) {
        return change(now, -1);
      }
      return none();
    },

    get level() { return level; },
    sheds(step) { return GOVERNOR_LADDER.indexOf(step) < level; },
    get refreshMs() { return refresh; },
    get jank() { return jank; },

    reset() {
      head = 0; size = 0; ltHead = 0; ltSize = 0;
      level = 0; windowStart = -Infinity;
      overloadSince = Number.NaN; headroomSince = Number.NaN;
      lastChange = -Infinity; lastRestore = -Infinity;
      restoreHold = GOVERNOR.restoreAfter;
      refresh = Number.NaN; refreshAt = -Infinity; jank = 0;
    },
  };
}
