/**
 * 自动人数探测。从场合默认人数起步，先让单人路径稳定，再用 `hardMax` 看一扇窗，之后在背景里
 * 定期再看。一次就能分辨一、二、三个人，不用先 1→2、再等一轮 2→3。裁定与理由在
 * docs/50-MULTI-PERSON.md §6.3。纯函数：没有时钟、没有随机，时间全从 `dt` 来。
 *
 * ## 为什么不能零成本地“偷看”
 *
 * `numPoses` 是 worker 的参数：要看第二个人，就必须真的按更高的档跑一遍检测器
 * （docs/50 §1.2）。所以这里定期开短窗、临时抬到硬上限；没有新人就收回实际档位，
 * 而不是一直多付检测器成本。
 *
 * ## 为什么“稳稳地”不是另一套置信度
 *
 * `createPeopleTracker()` 已经有出生滞回；轨迹转正之后才有资格被 `select()` 选中。这里只在
 * “拿到身体”之上再加 `probeConfirmSeconds` 的持续证据（同一个 `leak()`），挡掉路人擦肩而过。
 */
import { leak } from './people.ts';
import { PEOPLE } from './tuning.ts';

export type ProbePhase = 'idle' | 'probing';

export interface ProbeState {
  /** 此刻当真在用的人数上限 */
  readonly level: number;
  /** 这个场合的起步下限；自动退档不得越过它 */
  readonly floor: number;
  readonly phase: ProbePhase;
  /** `idle`：距上次探测的秒数；`probing`：当前窗口的秒数 */
  readonly clock: number;
  /** 至少比 `level` 多一人的持续证据 */
  readonly held: number;
  /** 从 1 起步时，至少比 `level` 多两人的持续证据 */
  readonly topHeld: number;
  /** 实际人数低于 `level` 的持续证据 */
  readonly idleHeld: number;
  /** 提示文字还要留多久（秒） */
  readonly hint: number;
  /** 提示该说第几个人 */
  readonly hintLevel: number;
}

/**
 * 未到顶格时先留一段单人稳定时间，再开第一扇探测窗。
 * `floor` 单列出来，让以后现场默认改成 2 时不会被自动逻辑退回 1。
 */
export function createProbeState(level: number = PEOPLE.defaultCap, floor: number = PEOPLE.defaultCap): ProbeState {
  const v = Number.isFinite(level) ? Math.round(level) : PEOPLE.defaultCap;
  const f = Number.isFinite(floor) ? Math.round(floor) : PEOPLE.defaultCap;
  const safeLevel = Math.max(1, Math.min(PEOPLE.hardMax, v));
  const safeFloor = Math.max(1, Math.min(safeLevel, f));
  return {
    level: safeLevel,
    floor: safeFloor,
    phase: 'idle',
    // 后续窗口等完整 interval；第一扇只再等 initialDelay。
    clock: safeLevel < PEOPLE.hardMax
      ? Math.max(0, PEOPLE.probeIntervalSeconds - PEOPLE.probeInitialDelaySeconds)
      : 0,
    held: 0,
    topHeld: 0,
    idleHeld: 0,
    hint: 0,
    hintLevel: 0,
  };
}

export interface ProbeInput {
  /** 新推理之间的间隔；缓存结果传 0，不能推进任何人数证据 */
  dt: number;
  /** 这一份新推理里被 tracker 选中的人数 */
  selectedCount: number;
  /** 渲染时钟只负责把提示收起来，不参与人数确认 */
  uiDt?: number;
  /** 当前帧有性能余量做后台探测；false 会立即收回正在开的窗口 */
  canProbe?: boolean;
}

export interface ProbeStep {
  state: ProbeState;
  /** 这一帧 worker 和 tracker 该用的人数上限 */
  target: number;
  /** 这一帧刚确认了更多人 */
  justEscalated: boolean;
}

export function stepProbe(state: ProbeState, input: ProbeInput): ProbeStep {
  const dt = Number.isFinite(input.dt) && input.dt > 0 ? Math.min(input.dt, 0.25) : 0;
  const rawUiDt = input.uiDt;
  const uiDt = Number.isFinite(rawUiDt) && rawUiDt !== undefined && rawUiDt > 0
    ? Math.min(rawUiDt, 0.25)
    : dt;
  const canProbe = input.canProbe ?? true;
  const selectedCount = Number.isFinite(input.selectedCount)
    ? Math.max(0, Math.min(PEOPLE.hardMax, Math.floor(input.selectedCount)))
    : 0;
  let { level, floor, phase, clock, held, topHeld, idleHeld } = state;
  const hint = Math.max(0, state.hint - uiDt);
  let hintLevel = hint > 0 ? state.hintLevel : 0;

  if (phase === 'idle') {
    if (level > floor) {
      idleHeld = leak(idleHeld, selectedCount < level, dt);
      if (idleHeld >= PEOPLE.probeDeescalateSeconds) {
        // 经过整段缺席证据后，3 只剩 1 就直接回 1，不再白等另一个退档周期。
        level = Math.max(floor, Math.min(level - 1, selectedCount));
        idleHeld = 0;
        clock = 0;
      }
    } else {
      idleHeld = 0;
    }

    if (level < PEOPLE.hardMax) {
      // 没有余量时暂停而不是清零：这样首帧还没量到 frameMs、切到后台、或偶发一帧卡顿，
      // 都不会把“先稳 3 秒”悄悄改成“再等完整 12 秒”。已经打开的窗口仍在下方立即中止并退避。
      if (canProbe) {
        clock += dt;
        if (clock >= PEOPLE.probeIntervalSeconds) {
          return {
            state: { level, floor, phase: 'probing', clock: 0, held: 0, topHeld: 0, idleHeld, hint, hintLevel },
            target: PEOPLE.hardMax,
            justEscalated: false,
          };
        }
      }
    } else {
      clock = 0;
    }
    return {
      state: { level, floor, phase, clock, held, topHeld, idleHeld, hint, hintLevel },
      target: level,
      justEscalated: false,
    };
  }

  // 探测是后台预算，不是作品主链：任何卡顿 / 降级迹象都立即回到已确认档位，之后完整退避一轮再试。
  if (!canProbe) {
    return {
      state: { level, floor, phase: 'idle', clock: 0, held: 0, topHeld: 0, idleHeld, hint, hintLevel },
      target: level,
      justEscalated: false,
    };
  }

  // 探测窗始终看到 hardMax，因此一扇窗就能从 1 直达 3。
  const target = PEOPLE.hardMax;
  clock += dt;
  held = leak(held, selectedCount >= level + 1, dt);
  topHeld = level + 2 <= PEOPLE.hardMax
    ? leak(topHeld, selectedCount >= level + 2, dt)
    : 0;

  const nextConfirmed = held >= PEOPLE.probeConfirmSeconds ? Math.min(PEOPLE.hardMax, level + 1) : level;
  const topConfirmed = topHeld >= PEOPLE.probeConfirmSeconds ? Math.min(PEOPLE.hardMax, level + 2) : level;
  const confirmed = Math.max(nextConfirmed, topConfirmed);

  // 第三个人已经露头时，给他到窗尾的机会。到期后仍会收下已确认的二人档，
  // 不会因为第三人不稳而两手空空。
  const waitingForTop = level + 2 <= PEOPLE.hardMax && topHeld > 0 && topConfirmed === level;
  if (confirmed > level && (!waitingForTop || clock >= PEOPLE.probeWindowSeconds)) {
    level = confirmed;
    hintLevel = level;
    return {
      state: {
        level, floor, phase: 'idle', clock: 0, held: 0, topHeld: 0, idleHeld: 0,
        hint: PEOPLE.probeHintSeconds, hintLevel,
      },
      target: level,
      justEscalated: true,
    };
  }
  if (clock >= PEOPLE.probeWindowSeconds) {
    return {
      state: { level, floor, phase: 'idle', clock: 0, held: 0, topHeld: 0, idleHeld, hint, hintLevel },
      target: level,
      justEscalated: false,
    };
  }
  return {
    state: { level, floor, phase, clock, held, topHeld, idleHeld, hint, hintLevel },
    target,
    justEscalated: false,
  };
}
