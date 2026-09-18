/**
 * 一场相遇里谁可以短暂脱离。这里只有**产品决策**，没有动画数学或 three：
 * 第一个真正被身体接受的手部替换获得一次 release，之后全场都原位。
 *
 * 状态是显式、不可变的小对象。调用方先 `planRelease()`，等 `Creature.replace()`
 * 确认真的开演后才 `commitRelease()`；占位降级、同件 no-op 或坏输入不能偷走唯一一次。
 * 将来若真人取证支持概率或段落窗口，只扩这个策略，不碰装配和渲染保护。
 */
import type { SlotKey } from '../../../core/src/types.ts';
import type { ReplaceMotion } from './replace-event.ts';

export interface ReleaseState {
  readonly handReleased: boolean;
}

export const INITIAL_RELEASE_STATE: ReleaseState = Object.freeze({ handReleased: false });

const isHand = (slot: SlotKey): boolean => slot === 'handL' || slot === 'handR';

/** 只做计划，不消费状态；非手、脚、连接槽位和第二次请求永远原位。 */
export function planRelease(state: ReleaseState, slot: SlotKey): ReplaceMotion {
  return !state.handReleased && isHand(slot) ? 'hand-release' : 'in-place';
}

/** 只有渲染边界实际接受 hand-release，才消费这一场的唯一名额。 */
export function commitRelease(state: ReleaseState, accepted: ReplaceMotion | null): ReleaseState {
  return accepted === 'hand-release' && !state.handReleased
    ? { handReleased: true }
    : state;
}
