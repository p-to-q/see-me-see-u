/**
 * 第 II 乐章的名字：回声。身体仍在当下回应，前臂与手保留你 1.2 秒前的方向余波。
 *
 * 躯干、承重链与动作起点始终实时；回声不是“坏了以后才追上”，而是同一次动作里
 * 当下与刚才同时存在。停下来以后历史自然追上，不播放另一段自主动画。
 *
 * docs/44 §6 之后它是那条线（`acts/act.ts` 的 `playLine`）在第 II 个地名上的样子：
 * 延迟 = `LINE.delay[1]`。延迟从第 I 个地名开始连续地长上来，
 * 所以没有"它突然慢了半拍"的那一刻。
 */
import type { Act } from './act.ts';
import { playLine } from './act.ts';

export const echo: Act = {
  id: 'echo',
  label: '回声（局部余波）',
  kind: 'body',
  weight: 1,
  update(w, dt, ctx) { playLine(w, dt, 1, ctx); },
};
