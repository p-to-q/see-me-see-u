/**
 * 调速器 → **已经存在的**开关（docs/48 §4）。和 `degrade-wire.ts` 同一个写法、同一个理由：
 * `main.ts` 里那几行测不到（它吃 WebGPU），这一层只吃回调，于是
 * "第 n 级放下的是哪个开关、只在变化时拨"是可执行的命题（`test/governor-wire.test.ts`）。
 *
 * 为什么要登记开关的名字：调速器最容易长成第二套开关 —— 自己的"关后期"、自己的"降分辨率"，
 * 和控件条、降级阶梯各拨各的。登记表让测试去 `main.ts` 里核对：接的就是那一个。
 */
import { GOVERNOR_LADDER, type GovernorStep } from './governor.ts';

export type GovernorTargets = Record<GovernorStep, (shed: boolean) => void>;

/** 每一级拨的是哪个开关（在 `main.ts` 的 `wireGovernor({...})` 里原样出现） */
export const GOVERNOR_SWITCHES: Record<GovernorStep, string> = {
  /** 舞台的墨色采样（`stage/ink-sampler.ts`），经 `Stage.setInk` */
  ink: 'stage.setInk',
  /** 忒修斯替换的延后闸（`swapGate = createDeferral(...)`）读的那个位；闸后面仍是 `creature.replace` */
  swaps: 'swapShed',
  /** 采集端的推理频率（`WebcamCapture.setCadence`） */
  inference: 'setCadence',
  /** 后期 —— Stage 对同一条后期链的临时挂起位；永久开关仍归控件条 / 降级阶梯 */
  post: 'stage.setPostSuspended',
  /** 渲染器像素比 —— 开机时设的那一个 */
  dpr: 'renderer.setPixelRatio',
  /** 读数的刷新（它不驱动身体） */
  ui: 'uiShed',
  /** 台上的身体数（docs/50 §5.4）：`people.shed` 为真时伴随身体的预算是 0（帧循环里 `bodies: people.shed ? 1 : …` 读它） */
  people: 'people.shed',
};

/** 返回 `apply(level)`：只拨状态变了的那几个开关。开关自己炸了只记一笔 —— 调用方是帧循环 */
export function wireGovernor(targets: GovernorTargets): (level: number) => void {
  const shed = new Map<GovernorStep, boolean>();
  return (level) => {
    for (let i = 0; i < GOVERNOR_LADDER.length; i++) {
      const step = GOVERNOR_LADDER[i];
      const want = i < level;
      if ((shed.get(step) ?? false) === want) continue;
      shed.set(step, want);
      try { targets[step](want); } catch (e) { console.error(`[governor] ${step} 开关自己炸了：`, e); }
    }
  };
}
