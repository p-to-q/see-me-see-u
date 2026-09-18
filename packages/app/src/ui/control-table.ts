/**
 * 控件表 —— 右上角那张面板上**每一个控件的唯一来源**。纯的，node 里测得住。
 *
 * ## 为什么要一张表
 *
 * 加一个开关以前要改六处：面板的一组 DOM、快捷键、键位条、`reloadWith` 写 URL、
 * 随机的池子、回大厅那份状态。漏一处不报错 —— 屏幕上照样有按钮，只是重载之后它回了默认，
 * 或者键位条上缺一行。现在这些全部从下面这一个数组推出来。
 *
 * **加一个控件**（docs/23 §S4.1 抄了同一份）：
 *   1. 在 `CONTROLS` 里加一条（种类、组、键、URL 怎么写、开机怎么读）；
 *   2. 在 `ControlValues` 里加它的值类型；
 *   3. `ui/i18n.ts` 的 `COPY.controls` 里加文案（`control-table.test.ts` 会点名缺哪句）；
 *   4. `main.ts` 的 host 里把它接到那个真实存在的变量上（`values()` 读、`set()` 写）。
 *
 * ## 四种控件
 *
 *   toggle   一个变量的开 / 关（描边、延迟、声音、精化、后期）
 *   overlay  叠在弧线上的一条，第一项永远是「跟着弧线」（玩法、形体；`shell/intent.ts`）
 *   choice   N 个普通值里挑一个（画面、物种）
 *   action   按一下做一件事（随机）
 *
 * ## 这张表**不**管什么（以及为什么）
 *
 * `shell/kiosk.ts` 的 `readFlags()` 仍然自己解析 URL。它是整台机器的开机契约 ——
 * 采集端、工作台页都读它，每个参数各有一条"认不出来就喊一声"的警告。把它改成从表里推，
 * 等于为了这张面板去改所有人的开机路径。所以表只拥有**写**（`url.write`）和
 * **怎么从 flags 里认回来**（`fromFlags`），`control-table.test.ts` 把每一项
 * 写出去再用 `readFlags` 读回来，两边说的不是同一件事就红。
 *
 * 没有插件机制、没有注册表：只有一个数组和几个从它推出来的函数。
 */
import { ARC_ACTS } from '../../../core/src/arc.ts';
import { FRAMING_POLICIES, isFramingPolicy, type FramingPolicy } from '../../../core/src/autoframe.ts';
import { PLANS_WITHOUT_PARTS } from '../../../core/src/bodyplan.ts';
import { PUBLIC_BODY_PLANS } from '../creature/body-plan-policy.ts';
import { SCENE_IDS } from '../stage/scenes.ts';
import { intentFromFlags } from '../shell/intent.ts';
import { parsePeople, type Flags } from '../shell/kiosk.ts';
import { PEOPLE } from '../../../core/src/tuning.ts';

/** 人数控件的选项：自动在前，再是 '1'..'hardMax'。字符串同时是 choice 值和 i18n 键 */
export const PEOPLE_OPTIONS: readonly string[] = ['auto', ...Array.from({ length: PEOPLE.hardMax }, (_, i) => String(i + 1))];

/** 面板上能读能写的全部值。**这就是"这一屏怎么演"** —— 重载、回大厅、回舞台都带它 */
export interface ControlValues {
  /** 形体叠加。`null` = 跟着弧线（第 III 乐章换成物种自己的方案） */
  form: string | null;
  scene: string;
  /** 玩法叠加。`null` = 跟着弧线 */
  act: string | null;
  outline: boolean;
  vitality: boolean;
  sound: boolean;
  species: string | null;
  refine: boolean;
  post: boolean;
  /** 取景策略（`core/src/autoframe.ts`）。`auto` = 听分类器 */
  framing: FramingPolicy;
  /** 自动发现人数，或固定给几个人各一具身体。`'1'` = 显式锁在单人 */
  people: string;
}
export type ValueId = keyof ControlValues;
export type ControlId = ValueId | 'roll';
export type ControlKind = 'toggle' | 'overlay' | 'choice' | 'action';

/**
 * 组，也就是面板从上到下的顺序。
 * `look` 是观众会选的（「看起来」）；`ab` 是工程对照，排最后、字更轻。
 */
export const GROUPS = ['form', 'scene', 'framing', 'act', 'look', 'species', 'random', 'ab'] as const;
export type GroupId = (typeof GROUPS)[number];

/** 面板要知道的、会影响"哪些项在、要不要重载"的开机事实 */
export interface StageContext {
  /** 开机时建出来的那一种身体实现（`kindOf(activePlan())`） */
  bootPlan: string;
  /** 物种自己声明的方案 */
  speciesPlan: string;
}

/** 通向一台工作台仪器的出口。回程由 `ui/stage-url.ts` 拼 */
export interface WorkbenchLink {
  page: string;
  /** 把当前物种带过去（那一页读 `?theme=`） */
  theme: boolean;
}

export interface ControlDef {
  id: ControlId;
  kind: ControlKind;
  group: GroupId;
  /** 快捷键（大写显示）。`null` = 没有 */
  key: string | null;
  /** 键由别的模块绑（声音的 M 在 `sound/sound.ts`）：面板只刷新，不再切一次 */
  keyBoundElsewhere?: boolean;
  /** overlay / choice 的选项。`'themes'` = 运行时由 `parts.json` 给 */
  options?: readonly string[] | 'themes';
  /** 不带参数开机时的值（`control-table.test.ts` 用 `readFlags('')` 核对） */
  default?: unknown;
  fromFlags?(f: Flags): unknown;
  /** 写回 URL：返回 `null` = 删掉这个参数，`undefined` = 不碰 */
  url?: { param: string; write(v: unknown): string | null | undefined };
  /** 随机那一下抽不抽它。`options: null` = 这一格只消耗一次 rng、写成删除（顺序即契约） */
  roll?: { slot: number; param: string; options: readonly string[] | 'themes' | null };
  links?: readonly WorkbenchLink[];
  /** 这一具身体上有没有这一项。没有就整项不出现（不给按了没反应的按钮） */
  available?(ctx: StageContext): boolean;
  /** 切到 `next` 要不要重载（身体实现是开机时定的） */
  reload?(ctx: StageContext, next: unknown): boolean;
  /** 因为它重载时，顺手删掉的参数（换物种时形体叠加不带过去：那是按在上一个物种身上的） */
  reloadClears?: readonly string[];
}

const isBodyImpl = (plan: string): boolean => (PLANS_WITHOUT_PARTS as readonly string[]).includes(plan);
const bool01 = (v: unknown): string => (v ? '1' : '0');
/** `creature/shading.ts` 的 `SHADING_IDS`。抄一份而不 import：那个文件带着 three，这张表会被正文页引到 */
const SHADINGS = ['physical', 'toon'] as const;

export const CONTROLS: readonly ControlDef[] = [
  {
    id: 'form', kind: 'overlay', group: 'form', key: 'F', options: PUBLIC_BODY_PLANS, default: null,
    fromFlags: (f) => f.plan,
    url: { param: 'plan', write: (v) => (v as string | null) ?? null },
    roll: { slot: 1, param: 'plan', options: PUBLIC_BODY_PLANS },
    links: [{ page: '/dev/lineup.html', theme: false }, { page: '/dev/mass.html', theme: true }],
    // 进出 B 档（团块 / 点场）是另一条身体实现，开机时就定了
    reload: (ctx, next) => {
      const eff = (next as string | null) ?? ctx.speciesPlan;
      return eff !== ctx.bootPlan && (isBodyImpl(eff) || isBodyImpl(ctx.bootPlan));
    },
  },
  {
    id: 'scene', kind: 'choice', group: 'scene', key: 'S', options: SCENE_IDS, default: null,
    fromFlags: (f) => f.scene,
    url: { param: 'scene', write: (v) => v as string },
    roll: { slot: 2, param: 'scene', options: SCENE_IDS },
  },
  {
    // 取景（docs/49 §落地）。**第一项 auto 就是"交回分类器"**：full / upper 是叠在分类器上的一条，
    // 再选 auto 就撤掉 —— 没有一个按钮能锁住系统（docs/23 §S4.1）。热切，不重载：
    // 景别、腿、小屏裁切、引导都在帧循环里每帧读它。随机不抽它：它是给看的人选的，不是长相
    id: 'framing', kind: 'choice', group: 'framing', key: 'C', options: FRAMING_POLICIES, default: 'auto',
    fromFlags: (f) => f.framing,
    url: { param: 'framing', write: (v) => (v === 'auto' || !isFramingPolicy(v) ? null : v) },
  },
  {
    // 人数（docs/50）。和取景同一组：它回答的也是"画面里框进几个人"。
    // **要重载**：伴随身体的颜色挂在桶的 `instanceColor` 上，而它只在建身体时挂（半路挂上会在帧循环里换管线，
    // `creature.ts` 那一段）；单人那条路不挂它 —— 于是 1 ↔ 多人是两种身体，和换物种同一个待遇。
    // 自动写成删除；固定 1 必须真正写成 people=1，否则重载后会又交还给自动。
    // 随机不抽它：它是现场的决定，不是长相
    id: 'people', kind: 'choice', group: 'framing', key: 'N', options: PEOPLE_OPTIONS, default: 'auto',
    fromFlags: (f) => f.peopleAuto ? 'auto' : String(f.people),
    url: { param: 'people', write: (v) => (v === 'auto' || parsePeople(String(v)) === null ? null : String(v)) },
    reload: () => true,
    // 团块 / 点场没有可共用的刚体桶，主线会固定单人；不给一个看得见却永远不生效的控件。
    available: (ctx) => !isBodyImpl(ctx.bootPlan),
  },
  {
    id: 'act', kind: 'overlay', group: 'act', key: 'A', options: ARC_ACTS, default: null,
    fromFlags: (f) => intentFromFlags(f).act ?? null,
    url: { param: 'act', write: (v) => ((ARC_ACTS as readonly unknown[]).includes(v) ? (v as string) : null) },
    // 随机**不抽**玩法：弧线三分钟里自己会走完四段，随机抽一段等于把弧线藏起来。
    // 这一格照样消耗一次 rng（旧 URL 的描边不错位），并写成删除 —— 清掉上一次的叠加
    roll: { slot: 3, param: 'act', options: null },
  },
  {
    id: 'outline', kind: 'toggle', group: 'look', key: 'O',
    // 描边不写回 URL：它是物种自己的声明（`creature/shading.ts` 那张表），带给下一个物种是错的。
    // 随机那一下是显式覆盖，和手打 `?shading=` 同一件事，所以它写
    roll: { slot: 4, param: 'shading', options: SHADINGS },
    available: (ctx) => !isBodyImpl(ctx.bootPlan),
  },
  {
    id: 'vitality', kind: 'toggle', group: 'look', key: 'D', default: true,
    fromFlags: (f) => f.vitality,
    url: { param: 'vitality', write: bool01 },
    links: [{ page: '/dev/vitality.html', theme: false }],
  },
  {
    id: 'sound', kind: 'toggle', group: 'look', key: 'M', keyBoundElsewhere: true, default: true,
    fromFlags: (f) => !f.mute,
    url: { param: 'mute', write: (v) => (v ? null : '1') },
  },
  {
    id: 'species', kind: 'choice', group: 'species', key: null, options: 'themes', default: null,
    fromFlags: (f) => f.theme,
    url: { param: 'theme', write: (v) => (v as string | null) ?? undefined },
    roll: { slot: 0, param: 'theme', options: 'themes' },
    links: [{ page: '/dev/figure.html', theme: true }],
    reload: () => true,
    reloadClears: ['plan'],
  },
  { id: 'roll', kind: 'action', group: 'random', key: 'X' },
  {
    id: 'refine', kind: 'toggle', group: 'ab', key: 'R', default: true,
    fromFlags: (f) => f.refine,
    url: { param: 'refine', write: bool01 },
  },
  {
    id: 'post', kind: 'toggle', group: 'ab', key: 'P', default: true,
    fromFlags: (f) => !f.nopost,
    url: { param: 'nopost', write: (v) => (v ? null : '1') },
  },
];

export const control = (id: ControlId): ControlDef => CONTROLS.find((c) => c.id === id)!;

export function optionsOf(c: ControlDef, themes: readonly string[]): readonly string[] {
  return c.options === 'themes' ? themes : c.options ?? [];
}

export const available = (c: ControlDef, ctx: StageContext): boolean => c.available?.(ctx) ?? true;
export const needsReload = (c: ControlDef, ctx: StageContext, next: unknown): boolean => c.reload?.(ctx, next) ?? false;

/** 快捷键的下一个值。叠加从「跟着弧线」出发，走完一圈回到它；认不出当前值时直接交回弧线 */
export function cycleNext(c: ControlDef, now: unknown, themes: readonly string[]): unknown {
  const opts = optionsOf(c, themes);
  if (c.kind === 'toggle') return !now;
  if (c.kind === 'overlay') {
    const seq: (string | null)[] = [null, ...opts];
    const i = seq.indexOf(now as string | null);
    return i < 0 ? null : seq[(i + 1) % seq.length];
  }
  if (!opts.length) return now;
  return opts[(Math.max(0, opts.indexOf(now as string)) + 1) % opts.length];
}

/** 这一屏写回 URL 的那一份。叠加关着时写成删除（`null`）—— 地址栏里旧的 `act=` 不许活下来 */
export function stagePatch(v: ControlValues): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const c of CONTROLS) {
    if (!c.url || c.id === 'roll') continue;
    const w = c.url.write(v[c.id]);
    if (w !== undefined) out[c.url.param] = w;
  }
  return out;
}

/**
 * 回舞台时 `from` 里允许出现的键（`ui/return-to.ts` 的白名单）。
 * 物种排第一：没有它那一屏是大厅，不是舞台。`seed` 不是控件，但回来的必须是同一具身体。
 */
export const STAGE_KEYS: readonly string[] = [
  'theme',
  ...CONTROLS.flatMap((c) => (c.url && c.url.param !== 'theme' ? [c.url.param] : [])),
  'seed',
];

/** 随机那一下的池子，按抽签顺序。纯函数 `randomPatch`（`ui/random-url.ts`）吃它 */
export function rollSlots(themes: readonly string[]): { param: string; options: readonly string[] | null }[] {
  return CONTROLS
    .flatMap((c) => (c.roll ? [c.roll] : []))
    .sort((a, b) => a.slot - b.slot)
    .map((r) => ({ param: r.param, options: r.options === 'themes' ? themes : r.options }));
}
