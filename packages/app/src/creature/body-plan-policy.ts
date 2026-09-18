/**
 * 身体方案的产品边界。
 *
 * `core/bodyplan.ts` 回答“这种拓扑怎样算”；这里只回答“哪些已经足够稳，
 * 可以进入观众的自动旅程”。两件事不能混在同一张合法值表里：`radial` 仍然是
 * 合法的开发预览，但它未系住的承重链不能在四十多秒时自动突然出现。
 *
 * 显式 `?plan=radial` 永远优先，因为它是取证 / look-dev 的入口。没有显式叠加时，
 * 不稳定方案才会退回一具实时、连通的人形。这是 app 的产品策略，不是骨架契约。
 */
import { BODY_PLANS, type BodyPlan, type BodyPlanId, type BodyPlanSpec } from '../../../core/src/bodyplan.ts';

/** 当前只隔离有断开承重链的旧 radial；恢复自动路径必须先有 hub tether 和真人证据。 */
export const QUARANTINED_AUTOMATIC_BODY_PLANS: readonly BodyPlanId[] = ['radial'];

/** 观众控件和随机路径只暴露已通过自动旅程门的方案。 */
export const PUBLIC_BODY_PLANS: readonly BodyPlanId[] = BODY_PLANS.filter(
  (plan) => !QUARANTINED_AUTOMATIC_BODY_PLANS.includes(plan),
);

const kindOf = (plan: BodyPlan): string =>
  typeof plan === 'string' ? plan : (plan.kind ?? 'rig');

/**
 * 把一个物种自动声明收口到可公开运行的方案。
 *
 * 参数化 radial 退回时仍保留它的肢体 / 头身比例，只拿掉断链拓扑；不改入参，
 * 也不替外部未知方案做第二层静默纠错。
 */
export function automaticBodyPlan(declared: BodyPlan): BodyPlan {
  if (kindOf(declared) !== 'radial') return declared;
  if (typeof declared === 'string') return 'rig';
  return { ...(declared as BodyPlanSpec), kind: 'rig' };
}

/** 显式开发叠加优先；只有物种的自动路径经过隔离门。 */
export function bodyPlanFor(declared: BodyPlan, explicit: BodyPlan | null | undefined): BodyPlan {
  return explicit ?? automaticBodyPlan(declared);
}
