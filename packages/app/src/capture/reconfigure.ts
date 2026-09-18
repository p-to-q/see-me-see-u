/**
 * MediaPipe 运行中重建图的单在途控制器。
 *
 * 超时不能等同于普通 reject：Promise 可能只是停止回话，底下的图仍在变。控制器因此在
 * deadline 后进入终态，把整份资源交给 owner 隔离；它不会为了“恢复”而放开下一次推理。
 * worker owner 会 terminate，主线程 owner 会摘掉旧 landmarker，等旧 mutation 真 settle 后再 close。
 */

export interface ReconfigureRequest {
  requestId: number;
  numPoses: number;
}

export interface ReconfigureResult extends ReconfigureRequest {
  ok: boolean;
  error?: string;
}

export interface ReconfigureController {
  request(numPoses: number): void;
  settle(result: ReconfigureResult): void;
  stop(): void;
  readonly applied: number;
  readonly busy: boolean;
}

interface Options {
  initialNumPoses: number;
  timeoutMs: number;
  post(request: ReconfigureRequest): void;
  onFailure(error: string): void;
  onTimeout(request: ReconfigureRequest, error: string): void;
  /** 测试注入；正式运行只用浏览器自己的 timer。 */
  schedule?: (task: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

const posesOf = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(8, Math.round(value)))
    : 1
);

const describe = (error: unknown): string => (
  error instanceof Error ? `${error.name}: ${error.message}` : String(error)
);

/**
 * applied / desired / in-flight 只在这里各存一份。等待中反复换目标时不排队，只在当前请求
 * 明确收口后发送最后一个；同值失败必须由下一次显式 request 重试。
 */
export function createReconfigureController(options: Options): ReconfigureController {
  const schedule = options.schedule ?? ((task, ms) => globalThis.setTimeout(task, ms));
  const cancel = options.cancel ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs >= 0 ? options.timeoutMs : 0;
  let applied = posesOf(options.initialNumPoses);
  let desired = applied;
  let current: ReconfigureRequest | null = null;
  let failed: number | null = null;
  let sequence = 0;
  let timer: unknown = null;
  let stopped = false;

  const clearDeadline = (): void => {
    if (timer === null) return;
    try { cancel(timer); } catch { /* timer 清理不能改变资源所有权 */ }
    timer = null;
  };

  const reportFailure = (error: string): void => {
    try { options.onFailure(error); } catch { /* 显示旁路不能打断状态机 */ }
  };

  const pump = (): void => {
    if (stopped || current || desired === applied || failed === desired) return;
    const request = { requestId: ++sequence, numPoses: desired };
    current = request;
    try {
      options.post(request);
    } catch (error) {
      current = null;
      failed = request.numPoses;
      if (desired === request.numPoses) reportFailure(`人数重配置发送失败：${describe(error)}`);
      if (desired !== request.numPoses) pump();
      return;
    }
    // 某些测试替身可能同步回执；那时 settle 已经清掉 current，不得再遗留一只幽灵 timer。
    if (stopped || current !== request) return;
    timer = schedule(() => {
      if (stopped || current !== request) return;
      timer = null;
      current = null;
      stopped = true;
      const error = `人数重配置超时：${request.numPoses}（${Math.round(timeoutMs)}ms）`;
      try { options.onTimeout(request, error); } catch { /* owner 的降级也必须 best-effort */ }
    }, timeoutMs);
  };

  return {
    request(value) {
      if (stopped) return;
      desired = posesOf(value);
      // 显式再请求同一个失败值就是重试；等待中的同值不新开并发。
      if (failed === desired) failed = null;
      pump();
    },
    settle(result) {
      const request = current;
      if (stopped || !request || result.requestId !== request.requestId) return;
      clearDeadline();
      current = null;
      if (result.ok && result.numPoses === request.numPoses) {
        applied = request.numPoses;
        if (failed === applied) failed = null;
      } else {
        failed = request.numPoses;
        if (desired === request.numPoses) {
          reportFailure(`人数重配置失败：${result.error ?? '回执与请求不一致'}`);
        }
      }
      pump();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearDeadline();
      current = null;
    },
    get applied() { return applied; },
    get busy() { return current !== null; },
  };
}
