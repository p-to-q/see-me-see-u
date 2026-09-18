/**
 * 一场相遇里的脱离调度。任何槽位都有一条可达路径，但不是所有件同时飞开：
 * 先用一只手教会观众“离开—以新件回接”的语法，再逐段开放末端、肢段和核心。
 *
 * 这里没有 three、动画曲线或隐式随机。调用方注入 encounter 自己的 Rng；策略先 plan，
 * 等 Creature 真正接受后再用 receipt commit。预算降级、同件 no-op 与坏输入都不能伪造事件。
 */
import { THESEUS } from '../../../core/src/tuning.ts';
import type { Rng, SlotKey } from '../../../core/src/types.ts';
import { JOINT_CAPS } from './assemble.ts';
import {
  detachmentProfileFor,
  IN_PLACE_DETACHMENT,
  type DetachmentPlan,
  type DetachmentProfile,
  type TransitionReceipt,
} from './detachment.ts';

export interface DetachmentState {
  readonly acceptedEvents: number;
  readonly lastDetachedEvent: number;
  readonly introduced: boolean;
}

export interface DetachmentContext {
  readonly slot: SlotKey;
  /** 整条作品弧线的归一化位置；坏值按 0。 */
  readonly overall: number;
}

export const INITIAL_DETACHMENT_STATE: DetachmentState = Object.freeze({
  acceptedEvents: 0,
  lastDetachedEvent: -1_000_000,
  introduced: false,
});

const finite01 = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const unit = (rng: Rng): number => finite01(rng.next());
const isHand = (slot: SlotKey): boolean => slot === 'handL' || slot === 'handR';

function profileTuning(profile: Exclude<DetachmentProfile, 'in-place'>): { unlock: number; chance: number } {
  const t = THESEUS.detachment;
  return profile === 'terminal-release'
    ? { unlock: t.unlockOverall.terminal, chance: t.chance.terminal }
    : profile === 'segment-release'
      ? { unlock: t.unlockOverall.segment, chance: t.chance.segment }
      : { unlock: t.unlockOverall.core, chance: t.chance.core };
}

/** 只做计划；第一次非原位事件固定是一只手，之后所有槽位按阶段与注入随机获得非零机会。 */
export function planDetachment(
  state: DetachmentState,
  context: DetachmentContext,
  rng: Rng,
): DetachmentPlan {
  // 第一件不摇骰：必须先是一只手，避免脚或躯干成为观众第一次见到的脱离语法。
  if (!state.introduced && !isHand(context.slot)) return IN_PLACE_DETACHMENT;

  const member = context.slot === 'joint'
    ? JOINT_CAPS[Math.min(JOINT_CAPS.length - 1, Math.floor(unit(rng) * Math.max(1, JOINT_CAPS.length)))]?.joint
    : undefined;
  const profile = detachmentProfileFor(context.slot, member);
  const tuning = profileTuning(profile);
  if (finite01(context.overall) < finite01(tuning.unlock)) return IN_PLACE_DETACHMENT;

  if (!state.introduced) {
    return isHand(context.slot) ? { profile: 'terminal-release', result: 'transform' } : IN_PLACE_DETACHMENT;
  }

  const gap = Math.max(0, Math.floor(THESEUS.detachment.minAcceptedGap));
  if (state.acceptedEvents - state.lastDetachedEvent < gap) return IN_PLACE_DETACHMENT;
  if (unit(rng) >= finite01(tuning.chance)) return IN_PLACE_DETACHMENT;

  if (context.slot === 'joint' && member) return { profile, result: 'transform', member };
  return { profile, result: 'transform' };
}

/** 只有渲染边界实际接纳的 receipt 才推进一场的节奏；被预算降级到原位不算脱离。 */
export function commitDetachment(
  state: DetachmentState,
  receipt: TransitionReceipt | null,
): DetachmentState {
  if (!receipt) return state;
  const acceptedEvents = state.acceptedEvents + 1;
  const detached = receipt.applied.profile !== 'in-place';
  return {
    acceptedEvents,
    lastDetachedEvent: detached ? acceptedEvents : state.lastDetachedEvent,
    introduced: state.introduced || detached,
  };
}
