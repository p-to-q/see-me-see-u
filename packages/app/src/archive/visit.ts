/**
 * 前端这一半：**一次走完的相遇，往存档里写一行。**
 *
 * ## 什么时候写
 *
 * 弧线走完的那一帧（`ArcState.held` 第一次为真），一次，不再写第二次。
 * 不是每一乐章写一次，也不是关页面时抢救一次 —— 两条都是裁定：
 *
 * - `docs/43 §7.1` 第 1 条：**写出去发生在一次相遇的尽头，不在中途。**
 *   一次失败只毁一条记录；流式写会让一次网络抖动在九十秒里重试三十次，
 *   而每一次重试都在和快回路抢主线程。
 * - `§9.7`：**关掉页面的那一次不救。** `navigator.sendBeacon` 能救回半途离开的
 *   那一条，代价是存档里混进不完整的相遇 —— 存档的每一条都该是一次**完成的**相遇。
 *   这是策展判断，不是技术判断，所以这个文件里没有 `sendBeacon`，
 *   `test/archive.test.ts` 会扫这个目录钉住它。
 *
 * ## 它绝不许弄坏这件作品
 *
 * `docs/02` P10「演出优先」：慢回路是唯一的网络依赖例外，存档是**第二个**，
 * 所以它逐字照抄慢回路那一套纪律（`docs/17 §8`）：
 *
 * 1. **帧循环里只有一次 boolean 比较。** 网络在 `requestIdleCallback` 里。
 * 2. **任何失败 = 静默关掉，本次会话不再尝试。** 含超时、404、5xx、断网。
 * 3. **404 是正常答案**，不是错误：某些部署上这条回路不存在。
 * 4. **降级必须静默**（`docs/26 §F`：给失败配音效等于告诉全场它坏了）。
 *    观众不该知道存档写失败了；`?debug=1` 的 HUD 里那一行就够。
 */

import { archiveBases } from './endpoint.ts';

/** 超时。和慢回路的取件超时同一个量级 —— 它只是"别挂着"，不是"要快" */
const TIMEOUT_MS = 5000;

export type VisitPhase =
  /** 还没走完这条弧线 */
  | 'idle'
  /** 正在写 */
  | 'writing'
  /** 写成功了，这一场结束 */
  | 'kept'
  /** 关掉了：失败过一次，或这一场本来就不该写 */
  | 'off';

export interface VisitReporter {
  /** 帧循环里调。一次 boolean 比较，别的什么都不做 */
  note(held: boolean): void;
  /**
   * 人走了（`ArcState.justReset`）：下一位从头开始，这一位写过的不算数。
   *
   * **不清 `off`。** 写失败过一次就是本次会话不再尝试（`§7.1` 第 3 条），
   * 换一个人不解除它 —— 和 `slow.reset()` 不清 `disabled` 逐字同一条理由：
   * 那道闸是按**会话**算的，重置会绕过它。
   */
  reset(): void;
  /** 给 `?debug=1` 的 HUD 读。**不进任何面向观众的页面** */
  readonly phase: VisitPhase;
  /** 落下去的那一条的序号，没有就是 null */
  readonly n: number | null;
}

export interface VisitOptions {
  /** 观众选的物种。没有就不写 —— 一条记不清物种的记录在这一档里等于没有内容 */
  species: string | null;
  /**
   * 这一场算不算数，**在弧线走完的那一刻回答**。
   *
   * 为什么是一个 getter 而不是一个 boolean：网页版开场用的是回放，
   * 摄像头要等观众按下「用我的摄像头」才打开（`main.ts` 的 `cameraOn`）。
   * 开机那一刻算一次，答案在整个网页版上永远是 `false` —— 存档一行都不会写，
   * 而 `/about` 那一段正说着「每一次到访只在服务端留下一行」。
   *
   * 它同时是 `§9.5` 那条「不参与」的**实现**：不按那个按钮，摄像头不开，
   * 这一场就不算一次到访，什么都不会被留下 —— 而作品照样在放。
   * `/about` 说出来的就是这件事，所以那句话必须和这里读的是同一个东西。
   */
  live: () => boolean;
  /** 测试用的注入口。生产路径上就是 `fetch` */
  fetch?: typeof globalThis.fetch;
  /** 测试用：把"等空闲"折成立刻执行 */
  idle?: (fn: () => void) => void;
  /** 按顺序问的地址前缀。生产路径上是 `archiveBases()`（同源 `/api`，然后线上 Worker） */
  bases?: string[];
}

const defaultIdle = (fn: () => void): void => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (ric) ric(fn); else setTimeout(fn, 0);
};

export function createVisitReporter(opt: VisitOptions): VisitReporter {
  const doFetch = opt.fetch ?? globalThis.fetch?.bind(globalThis);
  const idle = opt.idle ?? defaultIdle;
  const bases = opt.bases ?? archiveBases();

  // 没有物种、没有 fetch：这一整个会话都写不了，一次判完。
  // `live` 不在这里判 —— 它会变（观众中途按下「用我的摄像头」），见 VisitOptions
  let phase: VisitPhase = (!opt.species || !doFetch) ? 'off' : 'idle';
  let n: number | null = null;
  /**
   * 第几场。`reset()` 加一。
   *
   * 为什么需要它：一个人在写还没回来的时候走掉，`reset()` 会把状态交给下一位，
   * 而上一场那个 `await` 迟一点才落地 —— 没有这个计数，它会把**上一场的结果**
   * 写在下一位头上（运气不好的话正是把 `idle` 改成 `kept`，于是下一位不写了）。
   */
  let era = 0;

  const write = async (species: string, mine: number): Promise<void> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    /** 这一场还在不在。人已经走了就只丢结果，不改任何状态 */
    const current = () => mine === era;
    try {
      // 按 `endpoint.ts` 的顺序问：同源在前，线上 Worker 在后。
      // **只有 404 才换下一处** —— 404 是「这里没有这条回路」（`§7.1` 第 4 条），
      // 一行都没写下。别的失败（5xx、超时、断网）不换：那一处也许已经落了一行，
      // 再往另一处写一遍，同一位观众就成了两位。
      let res: Response | null = null;
      for (const base of bases) {
        res = await doFetch!(`${base}/visit`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ species }),
          signal: ctrl.signal,
        });
        if (res.status !== 404) break;
      }
      // 所有地方都 404 = 这个部署上没有这条回路。和别的失败归成同一个出口：
      // 对观众来说它们是同一件事（什么都没发生），而这一页不需要知道是哪一种
      // —— 当前相遇仍有效时，它**永久**关掉（`§7.1` 第 3 条）；上一场迟到的
      // 回执没有权替下一位关闸，下一位自己的请求若同样失败，仍会走这条终态
      if (!res?.ok) {
        if (current()) phase = 'off';
        return;
      }
      const j = (await res.json()) as { ok?: boolean; entry?: { n?: unknown } };
      if (!current()) return;
      const serial = j?.entry?.n;
      if (j?.ok !== true || typeof serial !== 'number' || !Number.isSafeInteger(serial) || serial <= 0) {
        phase = 'off';
        return;
      }
      n = serial;
      phase = 'kept';
    } catch {
      if (current()) phase = 'off';
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    note(held) {
      if (phase !== 'idle' || !held) return;
      // 帧循环里到这里为止只有两次布尔比较。`live()` 读的是一个已经算好的
      // boolean（`main.ts` 的 `cameraOn`），也不做任何事
      if (!opt.live()) return;
      phase = 'writing';
      const species = opt.species as string;
      const mine = era;
      try {
        idle(() => { void write(species, mine); });
      } catch {
        // 平台调度器也是外部边界；即使它坏了也不能从帧循环里 throw。
        phase = 'off';
      }
    },
    reset() {
      // 换了一个人。写过的那一条不影响下一位 —— 装置那台机器一开就是一整天，
      // 一次开机只记一条等于把这一页数的东西从"人"偷偷换成"开机次数"。
      // **`off` 不解除**：那是会话级的闸（见接口上的注释）
      if (phase === 'off') return;
      era += 1;
      phase = 'idle';
      n = null;
    },
    get phase() { return phase; },
    get n() { return n; },
  };
}
