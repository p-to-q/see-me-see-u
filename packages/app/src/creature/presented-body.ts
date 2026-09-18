/**
 * 记录「身体最后真正接纳了哪副骨架」。
 *
 * `World.skeleton` 是观众输入；Director 会在它上面做 echo / resist / facing，
 * 再命令式地调用 `BodyInstance.pose()`。舞台若继续读输入，就会让阴影、取景和
 * 交接旧身体与屏幕上的身体各说各话。这里包住唯一的输出边界：调用成功才提交
 * 回执，失败保留 last-good；只存对象引用，每帧不复制骨架、不分配数组。
 */
import type { Skeleton } from '../../../core/src/types.ts';
import type { BodyInstance } from './body.ts';

export interface PresentedBody {
  /** 交给 Director 的身体；object 与原身体同一引用，stats 保留原身体的动态语义。 */
  readonly body: BodyInstance;
  /** 最后一次成功返回的 pose 输入；从未成功或 reset 后为 null。 */
  readonly skeleton: Skeleton | null;
}

export function createPresentedBody(target: BodyInstance): PresentedBody {
  let skeleton: Skeleton | null = null;
  const body: BodyInstance = {
    object: target.object,
    get stats() { return target.stats; },
    pose(sk, presence, dt) {
      target.pose(sk, presence, dt);
      skeleton = sk;
    },
    reset() {
      skeleton = null;
      target.reset?.();
    },
    ...(target.setArc ? { setArc(progress: number) { target.setArc!(progress); } } : {}),
    dispose() { target.dispose(); },
  };
  return {
    body,
    get skeleton() { return skeleton; },
  };
}
