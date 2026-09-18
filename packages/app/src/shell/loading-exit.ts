/**
 * 加载层的退场时间线。
 *
 * 抽成这个不碰 DOM 的小函数，不是为了造一套动画框架：
 * `loading.ts` 以前只能用一串定时器表示“开始退场”，外面无法知道
 * 它什么时候**真的从 DOM 里消失**。选择页因此会在它下面提前开播。
 *
 * 这里只负责一件事：按顺序调四个回调，在 `remove` 完成后 resolve。
 * 时长和 DOM 表现仍然属于 `loading.ts`；测试可以换进假时钟，不需要
 * 为这一条时序引入一整套 DOM 依赖。
 */

export type LoadingExitScheduler = (run: () => void, delayMs: number) => unknown;

export interface LoadingExitOptions {
  waitMs: number;
  detailsMs: number;
  moveMs: number;
  flashMs: number;
  hasMark: boolean;
  schedule?: LoadingExitScheduler;
  onDetails(): void;
  onMove(): void;
  onSettled(): void;
  onRemove(): void;
  onError?(error: unknown): void;
}

/** 任何一步的 DOM 操作失败都不许把选择页永久卡在闸门后面。 */
export function runLoadingExit(options: LoadingExitOptions): Promise<void> {
  const schedule = options.schedule ?? ((run, delayMs) => setTimeout(run, delayMs));

  return new Promise<void>((resolve) => {
    let removed = false;
    const report = (error: unknown): void => {
      try { options.onError?.(error); } catch { /* 报错的人也不能把交棒卡住 */ }
    };
    const invoke = (fn: () => void): void => {
      try { fn(); } catch (error) { report(error); }
    };
    const remove = (): void => {
      if (removed) return;
      removed = true;
      invoke(options.onRemove);
      resolve();
    };
    const later = (delayMs: number, run: () => void): void => {
      try { schedule(run, Math.max(0, delayMs)); } catch (error) {
        report(error);
        remove();
      }
    };

    later(options.waitMs, () => {
      invoke(options.onDetails);
      later(options.detailsMs, () => {
        if (!options.hasMark) { remove(); return; }
        invoke(options.onMove);
        later(options.moveMs, () => {
          invoke(options.onSettled);
          later(options.flashMs, remove);
        });
      });
    });
  });
}
