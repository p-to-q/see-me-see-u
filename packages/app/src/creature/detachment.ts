/**
 * 可见脱离的 app-local 语义。它不是骨架 / Genome 契约：只描述一次已经被选中的
 * 零件替换要怎样离开当前 socket，以及最后是回来还是以新件回来。
 */
import type { SlotKey } from '../../../core/src/types.ts';

export type DetachmentProfile = 'in-place' | 'terminal-release' | 'segment-release' | 'core-release';
export type DetachmentResult = 'return' | 'transform';

export interface DetachmentPlan {
  readonly profile: DetachmentProfile;
  readonly result: DetachmentResult;
  /** `joint` 槽位共用一件 genome 选择；脱离时只准点名一处盖片。 */
  readonly member?: string;
}

export interface TransitionReceipt {
  readonly slot: SlotKey;
  readonly requested: DetachmentPlan;
  readonly applied: DetachmentPlan;
  readonly degraded: boolean;
  readonly reason: 'accepted' | 'invalid-profile' | 'detachment-budget' | 'detachment-conflict';
}

export const IN_PLACE_DETACHMENT: DetachmentPlan = Object.freeze({
  profile: 'in-place',
  result: 'transform',
});

/** 每个槽位只对应一种可见语法，避免调用方把任意 profile 当成任意运动向量。 */
const coreJoint = (member: string | undefined): boolean => (
  member === 'chest' || member === 'hipL' || member === 'hipR'
);

export function detachmentProfileFor(
  slot: SlotKey,
  member?: string,
): Exclude<DetachmentProfile, 'in-place'> {
  switch (slot) {
    case 'head': case 'handL': case 'handR': case 'footL': case 'footR':
      return 'terminal-release';
    case 'clavicleL': case 'clavicleR': case 'neck':
    case 'upperArmL': case 'upperArmR': case 'foreArmL': case 'foreArmR':
    case 'thighL': case 'thighR': case 'shinL': case 'shinR':
      return 'segment-release';
    case 'spine':
      return 'core-release';
    case 'joint':
      return coreJoint(member) ? 'core-release' : 'segment-release';
  }
}

export function detachmentCost(plan: DetachmentPlan): number {
  return plan.profile === 'in-place' ? 0 : plan.profile === 'terminal-release' ? 1 : 2;
}

export function sameDetachment(a: DetachmentPlan, b: DetachmentPlan): boolean {
  return a.profile === b.profile && a.result === b.result && a.member === b.member;
}
