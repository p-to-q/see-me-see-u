/**
 * 把分类器 / 手动策略的原始决定，收束成这一帧所有输出消费者共同采用的语义。
 *
 * `FramingDecision` 只认识“人是否只露上半身”；它不知道后面已经长成四足，
 * 也不知道台上是否真有第二具身体。那些是 app 编排层才知道的事实，因此不能
 * 塞回 core 分类器，也不能让 stage / preview / HUD 各自再判一次。
 */
import type { FramingDecision, Shot } from '../../../core/src/autoframe.ts';
import type { BodyPlan } from '../../../core/src/bodyplan.ts';

export type EffectiveShotWhy = 'decision' | 'body-plan' | 'group' | 'invalid-plan';

export interface EffectiveFraming {
  /** 舞台、横向、纵向与小屏裁切共同采用的最终景别。 */
  stageShot: Shot;
  /** 原始决定为什么被保留或改成全景；只给工作台 / HUD 取证。 */
  shotWhy: EffectiveShotWhy;
  /** 腿的安全策略保留原始决定：拉远期间或腿不可信时仍要站稳。 */
  holdLegs: boolean;
  /** 原始画面缺腿是否合理：最终中景，或摄像头已经确认在自行取景。 */
  lowerBodyOptional: boolean;
}

export interface EffectiveFramingInput {
  /** 这一帧真正采用的形体。rig / stub / towering 仍有可读的上半身。 */
  plan: BodyPlan;
  /** 物种身体从人形漂走的进度；必须是 0..1。 */
  planDrift: number;
  /** 以真正画上台的 companion 为准，不以探测上限或 tentative 轨迹为准。 */
  hasCompanions: boolean;
  /** 上游摄像头自行裁掉腿时，往后退不能把腿救回来。 */
  cameraFraming: boolean;
}

/**
 * 中景要求“头、肩、胸”仍然是稳定的构图对象，而不是要求身体从未变化。
 * 比例化的人形仍满足这个条件；四足、环、柱、团块和未知扩展形体不满足。
 */
export function bodyPlanAllowsUpper(plan: BodyPlan): boolean {
  const kind = typeof plan === 'string' ? plan : plan.kind ?? 'rig';
  return kind === 'rig' || kind === 'stub' || kind === 'towering';
}

export function resolveEffectiveFraming(
  decision: FramingDecision,
  input: EffectiveFramingInput,
): EffectiveFraming {
  const validPlan = Number.isFinite(input.planDrift) && input.planDrift >= 0 && input.planDrift <= 1;
  let stageShot: Shot = decision.shot;
  let shotWhy: EffectiveShotWhy = 'decision';

  // 坏 plan 状态宁可退到能看见全身的全景，不能在帧循环里把 NaN 当作“仍是人形”。
  if (!validPlan) {
    stageShot = 'full';
    shotWhy = 'invalid-plan';
  } else if (input.hasCompanions) {
    // 一旦真有伴随身体，取景对象就是整组；中景会切掉两侧的人。
    stageShot = 'full';
    shotWhy = 'group';
  } else if (input.planDrift > 0 && !bodyPlanAllowsUpper(input.plan)) {
    // 四足 / 环 / 柱没有稳定的“上半身”语义，漂移从第一帧起就拉回全景。
    stageShot = 'full';
    shotWhy = 'body-plan';
  }

  return {
    stageShot,
    shotWhy,
    holdLegs: decision.holdLegs,
    lowerBodyOptional: stageShot === 'upper' || input.cameraFraming,
  };
}
