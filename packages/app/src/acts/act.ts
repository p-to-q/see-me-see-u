/**
 * 玩法扩展点。规格见 docs/16-SPEC-acts.md。
 *
 * 核心约束：**帧循环固定，玩法挂在它旁边。**
 * 加一个新玩法 = 新建一个文件 + 在 acts/index.ts 的数组里加一行。
 */
import type {
  EvolutionState, Genome, MotionFeatures, Presence, Rng, Skeleton, Tier,
} from '../../../core/src/types.ts';
import { ARC_ACTS, type ArcState, type MovementIndex } from '../../../core/src/arc.ts';
import { createLineSampler, lineAt, pointOf, type LineParams } from '../../../core/src/line.ts';
import type { Capture } from '../capture/capture.ts';
import type { PartLibrary } from '../assets/library.ts';
import type { BodyInstance } from '../creature/body.ts';
import type { Stage } from '../stage/stage.ts';
import type { Flags } from '../shell/kiosk.ts';
import { NO_INTENT, lineOverlay, type Intent } from '../shell/intent.ts';

export interface World {
  readonly t: number;
  readonly presence: Presence;
  /**
   * 这一场走到哪儿了（`core/src/arc.ts`）。**导演按它排座次，不再摇骰子**：
   * 四个乐章依次是 follow / echo / resist / facing（docs/40 §1）。
   * 玩法自己也读得到它 —— 但读了就要想清楚，它是整件作品唯一的时间轴。
   */
  readonly arc: ArcState;
  readonly skeleton: Skeleton | null;
  readonly features: MotionFeatures | null;
  readonly evolution: EvolutionState;
  readonly genome: Genome | null;
  /**
   * 当前的身体。**是 BodyInstance 不是 Creature** —— 玩法只该知道"这里有个身体、
   * 可以把骨架喂给它"，不该知道它是刚体挂载还是团块（docs/18）。
   * 哪天加了 swarm / ribbon，所有 Act 一行都不用改。
   */
  readonly creature: BodyInstance;
  readonly stage: Stage;
  readonly library: PartLibrary;
  readonly capture: Capture;
  readonly flags: Flags;
  /**
   * 观众叠在弧线上的东西（`shell/intent.ts`）。导演**每帧读**它，不接受命令 ——
   * 所以控件条上没有一个按钮能把导演按住。
   */
  readonly intent: Intent;
  readonly rng: Rng;
  morph(tier?: Tier): void;
  note(s: string): void;
}

/** 导演递给玩法的那一点上下文 */
export interface ActContext {
  /**
   * 被 `force()` 按住了。现在只剩「把身体还回去」（右下角那一行 / `?act=untether`）走这条：
   * 它是一个再按一次就松开的开关，不是弧线上的点。按住 = 钉在自己的地名上。
   */
  pinned: boolean;
  /**
   * 观众的玩法叠加落在第几个地名（`shell/intent.ts`）。`null` / 缺省 = 跟着 `arc.overall` 走。
   * 弧线在底下照走，拿掉叠加的那一帧就回到 `overall`。
   */
  point?: MovementIndex | null;
}

export interface Act {
  id: string;
  label: string;
  /** 'body' = 决定身体怎么动，同时只有一个；'ambient' = 常驻叠加 */
  kind: 'body' | 'ambient';
  canEnter?(w: World): boolean;
  weight?: number;
  minSeconds?: number;
  maxSeconds?: number;
  enter?(w: World): void;
  update(w: World, dt: number, ctx?: ActContext): void;
  exit?(w: World): void;
}

// ── 一条线（docs/44 §6：四个乐章留名字，删边界）──────────────────────────────
//
// follow / echo / resist / facing 不再是四套逻辑，是同一个采样器在四个点上的名字。
// 采样器**只有一个**、状态跨四个名字共享：弧线在 40 秒把名字从 follow 换成 echo 时，
// 缓冲、追踪、朝向一样都不重置 —— 名字换了，线没有断。
const line = createLineSampler();
let lastPin: MovementIndex | null = null;
let lastOverall = 0;

/**
 * 名字为 `actId` 的那个玩法此刻在这条线上取哪一组数 —— **和 `playLine` 喂给身体的是同一点**：
 * 被按住就钉在自己的地名，否则跟着 `arc.overall` 走。不在这条线上的（`untether`）是 null。
 *
 * 给声音用（`sound/timbre.ts`）：音色要跟着身体吃的那一组数滑，不能跟着名字跳。
 */
export function lineFor(actId: string | null, overall: number, pinned: boolean): LineParams | null {
  const movement = ARC_ACTS.indexOf(actId as (typeof ARC_ACTS)[number]);
  if (movement < 0) return null;
  const live = Number.isFinite(overall) ? overall : pointOf(movement as MovementIndex);
  return lineAt(pinned ? pointOf(movement as MovementIndex) : live);
}

/**
 * 在这条线上演一帧。`movement` 是调用它的那个玩法自己的地名：
 * 被按住时就钉在那一点，否则跟着 `w.arc.overall` 走（那时 `movement` 只是个名字）。
 */
export function playLine(w: World, dt: number, movement: MovementIndex, ctx?: ActContext): void {
  const sk = w.skeleton;
  if (!sk) return;
  const pin = ctx?.pinned ? movement : ctx?.point ?? null;
  const live = w.arc && Number.isFinite(w.arc.overall) ? w.arc.overall : pointOf(movement);
  const overall = pin === null ? live : pointOf(pin);
  // 换钉点、或者弧线往回走了（归零 = 换了一个人）：朝向直接到位，不慢慢追
  const snap = pin !== lastPin || overall < lastOverall - 1e-3;
  lastPin = pin;
  lastOverall = overall;
  const target = lineAt(overall);
  const posed = line.apply({ skeleton: sk, t: w.t, dt, speed: w.features?.speed ?? 0, target, snap });
  w.creature.pose(posed, w.presence, dt);
  w.note(`线 余波 ${target.delay.toFixed(2)}s/${line.history.toFixed(2)} · 重量 ${target.weight.toFixed(2)} · 朝向 ${line.facing.toFixed(2)}`);
}

/** 连续出错这么多次，这个 Act 就被永久禁用 —— 一个坏玩法不该带走整件作品 */
const STRIKES_BEFORE_DISABLE = 3;

export interface Director {
  update(w: World, dt: number): void;
  readonly currentId: string | null;
  /** 被禁用的 act id 和原因，给 HUD / 日志看 */
  readonly disabled: ReadonlyMap<string, string>;
  /**
   * 强制切到某个 act。强制之后弧线不再插手，直到 `release()`。
   * **控件条不许调它**（`test/controls-panel.test.ts`）：观众的玩法选择是叠加（`World.intent`）。
   * 留给「把身体还回去」—— 那是一个自己带解除键的开关。
   */
  force(id: string, w: World): boolean;
  /**
   * 交回给弧线。右下角那一行「把身体拿回来」走这条 ——
   * 观众拿回身体之后应该回到**这一场此刻的**乐章，而不是永远停在 follow。
   */
  release(w: World): void;
  /** 现在是不是被强制按住了（HUD / 出口那一列要知道） */
  readonly forced: boolean;
}

export function createDirector(acts: readonly Act[], fallbackId = 'follow'): Director {
  const body = acts.filter((a) => a.kind === 'body');
  const ambient = acts.filter((a) => a.kind === 'ambient');
  const fallback = body.find((a) => a.id === fallbackId) ?? body[0];

  const disabled = new Map<string, string>();
  const strikes = new Map<string, number>();
  let current: Act | null = null;
  let forced = false;

  /** 把 Act 的任何异常挡在帧循环之外（docs/16 §5 规则 2） */
  function guard<T>(act: Act, what: string, fn: () => T): T | undefined {
    try {
      const r = fn();
      strikes.set(act.id, 0);
      return r;
    } catch (err) {
      const n = (strikes.get(act.id) ?? 0) + 1;
      strikes.set(act.id, n);
      console.error(`[act:${act.id}] ${what} 抛了异常（第 ${n} 次）`, err);
      if (n >= STRIKES_BEFORE_DISABLE) {
        const why = err instanceof Error ? err.message : String(err);
        disabled.set(act.id, why);
        console.error(`[act:${act.id}] 连续出错 ${n} 次，已禁用。回落到 ${fallback?.id}`);
        if (current === act) current = null;      // 下一帧会重新挑
      }
      return undefined;
    }
  }

  /** 弧线此刻点的那个玩法。被禁用（连续出错 3 次）时回落到兜底的 `follow` */
  function arcPick(w: World): Act | null {
    const want = body.find((a) => a.id === w.arc?.actId);
    return want && !disabled.has(want.id) ? want : fallback ?? null;
  }

  function switchTo(act: Act | null, w: World): void {
    if (current && current !== act) guard(current, 'exit', () => current!.exit?.(w));
    current = act;
    if (act) {
      guard(act, 'enter', () => act.enter?.(w));
      if (w.flags.debug) console.info(`[act] → ${act.id}`);
    }
  }

  return {
    update(w, dt) {
      // 选角。**按弧线排，不摇骰子**（docs/40 §0：此前是随机加权，同一个人两次
      // 站上去顺序不同，而且可能一次都轮不到「抵抗」）。
      //
      // `canEnter` / `weight` 在这条路上不再参与 body 玩法的选择：弧线说了算，
      // 它们留着是因为 ambient 玩法和 docs/16 的契约都还在用（而且 `untether`
      // 的 `canEnter: false` 仍然是它排不进来的那道锁 —— 弧线根本不叫它的名字）。
      // `minSeconds` / `maxSeconds` 同理：段长由 `ARC.beats` 定，两套时长说了不算数的话
      // 就会打架，而打架的时候观众看到的是一条不按文档走的弧线。
      if (!forced) {
        const next = arcPick(w);
        if (next && next !== current) switchTo(next, w);
      }
      if (!current && fallback && !disabled.has(fallback.id)) switchTo(fallback, w);

      // 叠加只换采样点，不换演员：弧线说该演哪一段就演哪一段（`currentId` 照走），
      // 线在叠加的那个地名上采样。「还回去」按住时叠加让路 —— 那一场不跟随任何人
      const point = forced ? null : lineOverlay(w.intent ?? NO_INTENT);
      if (current) guard(current, 'update', () => current!.update(w, dt, { pinned: forced, point }));
      for (const a of ambient) {
        if (disabled.has(a.id)) continue;
        if (a.canEnter && guard(a, 'canEnter', () => a.canEnter!(w)) !== true) continue;
        guard(a, 'update', () => a.update(w, dt, { pinned: false }));
      }
    },
    get currentId() { return current?.id ?? null; },
    get disabled() { return disabled; },
    force(id, w) {
      const act = acts.find((a) => a.id === id && a.kind === 'body');
      if (!act || disabled.has(id)) return false;
      forced = true;
      switchTo(act, w);
      return true;
    },
    release(w) {
      forced = false;
      const next = arcPick(w);
      if (next && next !== current) switchTo(next, w);
    },
    get forced() { return forced; },
  };
}
