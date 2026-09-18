/**
 * 第 III 乐章的名字：迟滞。身体跟随你，但**有重量**。
 *
 * 双臂末端的方向被阻尼，躯干、肘和承重链仍当帧回应。于是猛地挥手时手上有阻力、
 * 缓缓抬手时它贴着你；观众可以去迁就那份重量，但不会把整具身体读成输入延迟。
 *
 * docs/44 §6 之后它是那条线（`acts/act.ts` 的 `playLine`）在第 III 个地名上的样子：
 * 重量 = `LINE.weight[2]` = 1，即双臂方向的临界阻尼追踪（τ 随速度在
 * `LINE.tauSlow`..`LINE.tauFast` 之间）。追踪一直在后台跑，重量只决定输出混进去多少。
 */
import type { Act } from './act.ts';
import { playLine } from './act.ts';

export const resist: Act = {
  id: 'resist',
  label: '迟滞（它有重量）',
  kind: 'body',
  weight: 1,
  update(w, dt, ctx) { playLine(w, dt, 2, ctx); },
};
