/**
 * 玩法登记处。**加一个新玩法就在这里加一行，没有别的步骤**（docs/16 §6）。
 * 数组顺序不影响选择（选择按 weight 随机），只影响可读性。
 */
import type { Act } from './act.ts';
import { follow } from './follow.ts';
import { echo } from './echo.ts';
import { facing } from './facing.ts';
import { resist } from './resist.ts';
import { untether } from './untether.ts';

export const ACTS: readonly Act[] = [
  // 前四个是**同一条线上的四个地名**（docs/44 §6），不是四套逻辑：
  // 弧线换名字时线不断，`?act=` 按住时钉在那一点（`acts/act.ts` 的 `playLine`）。
  follow,   // 兜底。I：三个数全 0
  echo,     // II：当下的主体 + 1.2s 前的手臂方向余波 —— “刚才”仍在这一拍里
  resist,   // III：有重量 —— 观众会自发放慢去迁就它
  facing,   // IV：镜像被抵消 —— "它不再是我，它在看着我"
  // 唯一一个**不跟随任何人**的。`canEnter` 恒为 false，所以导演永远排不到它：
  // 它只由右下角那一行「把身体还回去」和 `?act=untether` 进来（docs/16 §7）。
  untether,
];

export type { Act, World, Director } from './act.ts';
export { createDirector, lineFor } from './act.ts';
