/**
 * 现场外壳：全屏、藏鼠标、防休眠、无人降帧、context lost 自愈、URL 开关。
 * P10 现场优先 —— 启动 = 打开一个 URL，不需要在终端敲第二条命令。
 */
import { BODY_PLANS, type BodyPlanId } from '../../../core/src/bodyplan.ts';
import { FRAMING_POLICIES, isFramingPolicy, type FramingPolicy } from '../../../core/src/autoframe.ts';
import { CAM_FRAMING_FLAGS, isCamFramingFlag, type CamFramingFlag } from '../capture/cam-framing.ts';
import { PEOPLE } from '../../../core/src/tuning.ts';
import { ACTS } from '../acts/index.ts';
import { isCamFlag } from '../capture/camera-select.ts';
import { isShadingId, type ShadingId } from '../creature/shading.ts';
import { getDegradeState } from './degrade.ts';
import { noteActivity } from './idle.ts';

export interface Flags {
  demo: boolean;        // ?demo=1   用录制的 pose 回放，不开摄像头
  debug: boolean;       // ?debug=1  骨架线 + 数值 HUD
  nopost: boolean;      // ?nopost=1 关后期，排查性能（降级阶梯第 1 级也会把它翻成 true）
  mirror: boolean;      // ?mirror=0 关镜像（只用于调试坐标，现场绝不要用）
  /**
   * ?theme=xeno 跳过选择页。写法不合法（带空格 / 斜杠 / 空值）= null = 当没写过，
   * 并且打一条 warn —— 规矩和 `?plan=` / `?cam=` 一样。
   * "这个物种存不存在"不在这里判，见下面 `resolveTheme()`。
   */
  theme: string | null;
  seed: number | null;  // ?seed=12345  复现一个具体的身体
  tier: number | null;  // ?tier=2      锁定 tier，调 look dev 用
  kiosk: boolean;       // ?kiosk=1  进入现场模式
  /**
   * ?act=echo 锁定一个玩法（docs/16）。认不出来的值（`?act=resit`）= null =
   * 当没写过，并且打一条 warn —— 规矩和 `?plan=` 一样，名单从 `ACTS` 现读。
   */
  act: string | null;
  /**
   * ?arc=<秒> 覆盖整条会话弧线的时长（`ARC.total`，默认 180）。
   * 四段按 `ARC.beats` 的比例跟着缩放，所以这**一个**数就是现场唯一要调的旋钮：
   * 讲解时压到 90 秒，长期布展拉到 5 分钟（docs/40 §2）。
   *
   * 认不出来的值（`?arc=abc` / `?arc=0` / `?arc=-5` / `?arc=`）一律 null =
   * 当没写过，并且打一条 warn —— 规矩和 `?scene=` / `?exits=` 一样。
   * **不许静默退回 180**：现场有人压了时长却没生效，而 HUD 上那一行照常在走，
   * 他会以为是弧线错了，而不是参数错了（P21）。
   */
  arc: number | null;
  /**
   * ?theseus=off 关掉整条"一件一件换掉"（docs/44 §9 的现场兜底）；
   * ?theseus=<倍率> 当场调快慢（`2` = 快一倍）。默认开、倍率 1。
   *
   * 关掉之后身体只跟着 `ARC` 的四档走，也就是**这一版之前的行为**——
   * 现场的 plan B 必须是真的，这一条由 `test/theseus-flag.test.ts` 钉住。
   * 认不出来的值（`?theseus=fast` / `?theseus=0` / `?theseus=-1`）按没写过处理
   * 并喊一声 —— 和 `?arc=` / `?scene=` / `?cam=` 同一条规矩。
   */
  theseus: TheseusFlag;
  plan: BodyPlanId | null;  // ?plan=quadruped 覆盖身体方案（docs/18）
  /** ?scene=void 覆盖舞台场景（app/src/stage/scenes.ts）。null = 按物种自动挑 */
  scene: string | null;
  selftest: boolean;    // ?selftest=1 开场自检页（不进主程序）
  clip: string | null;  // ?clip=walkwave  指定回放片段（配合 ?demo=1）
  /** ?model=lite|full|heavy  换 PoseLandmarker 档位（docs/24 §3）。null = 默认档 lite */
  model: PoseModel | null;
  /** ?refine=0 关掉时域精化（One-Euro + 遮挡保持 + 质量兜底）。留着是为了能现场做 A/B */
  refine: boolean;
  /** ?vitality=0 关掉跟随延迟与呼吸。它是"看起来像活的"和"反应慢"之间的那条线，必须能当场比 */
  vitality: boolean;
  /** ?mute=1 彻底关声音（连 AudioContext 都不建）。运行中按 `m` 也能关（docs/29） */
  mute: boolean;
  /**
   * ?loading=0 关掉加载态那一层（`shell/loading.ts`）。
   * 它叠在选择页既有画面之上，而那个镜头是不许动的 —— 万一现场看着不对，
   * 要能在 3 秒内把它摘掉，而不是回滚一次构建。
   */
  loading: boolean;
  /**
   * ?nav=0 关掉右上角目录（`ui/nav.ts`）。现场（`?kiosk=1`）本来就不挂它 ——
   * 装置画面上不该有网站导航。这个开关是给"投影但不是 kiosk"那种场合的。
   */
  nav: boolean;
  /**
   * ?shading=toon|physical 强制着色语言（`creature/shading.ts`）。
   * null = 按物种自己声明的来 —— 目前只有「线」声明了 `toon`。
   * 留这个开关的理由和 `?refine=` 一样：描边是这一批里唯一**改变物种长相**的渲染开关，
   * 「它到底该不该有这圈线」必须能当场 A/B，而不是回滚一次构建再看。
   */
  shading: ShadingId | null;
  /**
   * ?cam=1 或 ?cam=<deviceId 前缀>  选摄像头（`capture/camera-select.ts`）。
   * null = 不指定，交给浏览器挑。
   * 现场是一台外接对着观众、一台内置对着墙，而浏览器默认挑哪台跟这件事无关。
   * 两种写法各自服务于一个人：序号给站在现场一台台试的人，deviceId 给开机脚本
   * （唯一可复现的写法）。认不出来的值一律 null —— 规矩和 `?shading=` 一样。
   */
  cam: string | null;
  /**
   * ?exits=0|1 右下角那一列（`ui/exits.ts`：回到大厅 / 把身体还回去 / 摄像头）。
   *
   * 默认开，**但 `?kiosk=1` 下默认关** —— 这不是"现场界面要干净"那条老理由的复读，
   * 是一条更硬的：无人值守的装置不该向公众提供「回到大厅」，
   * 第一个观众按一下走开，后面所有人看到的就是一张选择页。
   * 有人看着的现场（讲解、评审）要它的话，`?kiosk=1&exits=1` 显式打开。
   *
   * 认不出来的值（`?exits=yes` / `?exits=true`）**不静默生效也不静默关掉**：
   * 当没写过，并且打一条 warn —— 规矩和 `?scene=` / `?shading=` / `?cam=` 一样。
   */
  exits: boolean;
  /**
   * ?preview=on|off  左上角那块小屏幕（`ui/preview.ts`）——「它有没有看见我」。
   * null = 不指定，按场合自己决定（网页版挂、现场不挂、回放永远不挂）。
   *
   * 为什么需要一个强制开：现场唯一真正的问题就是"观众不知道自己被没被看见"，
   * 而现场默认是不挂的（docs/23 §S4「默认零 UI」）。有些场地会要那块小屏幕 ——
   * 那是策展决定，不是代码决定，所以它必须是一个 URL 参数而不是一次重新构建。
   *
   * 认不出来（?preview=1 / ?preview=yes）就是 null = 当没写过，规矩同 `?scene=`。
   */
  preview: PreviewMode | null;
  /**
   * ?readout=on|off  左下角那块读数（`ui/readout.ts`）——「它此刻从你身上读到了什么」。
   * null = 不指定，按场合自己决定（网页版挂、现场不挂）。
   *
   * **现场默认不挂，理由和目录那一条不是同一条。** 目录是"装置画面上不该有网站导航"；
   * 这一块是：左上角那块小屏幕之所以能在现场被 `?preview=on` 要回来，
   * 是因为它回答的是「它有没有看见我」—— 没有那个答案，「默认零 UI」本身不成立。
   * 这块读数回答的是「它读到了什么」，**站在装置前面的人对这个答案无能为力**。
   * 现场不是控制室。讲解 / 评审 / 开放日要它的话，`?kiosk=1&readout=on` 显式打开。
   *
   * 认不出来的值（`?readout=1` / `?readout=yes`）**不静默生效也不静默关掉**：
   * 当没写过，并且打一条 warn —— 规矩和 `?exits=` / `?gl=` / `?arc=` 一样。
   */
  readout: ReadoutMode | null;
  /**
   * ?wave=on|off 选择页的举手滚动（`choose/ring/wave.ts`）。
   * null = 没写，或者写了一个认不出来的值 —— 两种情况都按默认（开）走。
   *
   * 为什么默认开：现场（`?kiosk=1`）**一件输入设备都没有**，没有它，
   * 站在装置前面的人翻不了名单，只能等 30 秒被随机塞一具身体。
   * 而它不会误触发（三道闸写在 `wave.ts` 的文件头），也不会在没摄像头、
   * `?demo=1`、`?gl=off` 时出现任何行为 —— 默认开的下行风险接近零。
   *
   * 认不出来的值（`?wave=yes` / `?wave=1`）**不静默退回**：`readFlags` 给 null，
   * 选择页开机时打一行 `wave=on|off(默认)` 说明实际走的是哪条 ——
   * 规矩和 `?scene=` / `?shading=` / `?cam=` 一样（"我明明写了参数"和
   * "参数没生效"必须分得开）。
   */
  wave: WaveFlag | null;
  /**
   * ?gl=off 强制走**无 WebGL 的那条路**：选择页掉到纯 DOM 列表
   * （`choose/choose.ts` 的 `toFallback()`）。默认 on。
   *
   * 为什么它必须存在于正式程序而不只是 dev 页：`navigator.gpu` 没法在页面加载
   * 之前从外面拿掉，所以"没有 WebGPU 的机器上这一页还选不选得了"这条路，
   * 除了这个开关没有别的办法跑（AGENTS.md：每条降级路径必须存在**且被跑过**）。
   * 在这之前 `?gl=` 只接在 `/dev/choose.html` 上，而 `choose.ts` 的文件头
   * 拿它当"这条路跑过了"的证据 —— 那句话说的是意图，不是现实（docs/36 D2）。
   *
   * 认不出来的值（`?gl=0` / `?gl=false` / `?gl=no`）按没写过处理并喊一声 ——
   * 规矩和 `?scene=` / `?shading=` / `?cam=` / `?exits=` 一样。
   */
  gl: boolean;
  /**
   * ?worker=off  姿态推理不进 worker，回到主线程（`capture/webcam.ts` 的降级路径）。
   * 默认 on。给一个关的开关有两个理由：现场如果某台机器上 worker 起不来要能 3 秒内切走；
   * 以及主线程那条路必须**跑得到**，否则它就只是一段没人验过的代码（P3，docs/48 §3）。
   */
  worker: boolean;
  /**
   * ?framing=auto|full|upper 取景策略（`core/src/autoframe.ts`，docs/49 §落地）。默认 auto。
   *
   * - `auto`  听分类器：只露上半身 → 中景 + 腿换成站姿；退后 → 全景（等身）。
   * - `full`  永远是等身全景（腿照样听分类器，不给选了全景的人一双坏腿）。
   * - `upper` 永远是中景（桌面演示）。
   *
   * 三个值都是**叠加**，不是锁：控件条上再选 auto 就交回分类器。
   * 现场（`?kiosk=1`）也默认 auto，但分类器走"全身优先"那一档（进中景要憋 3 秒，
   * 网页 1 秒）—— 理由写在 docs/49 §落地 的原则一节。
   * 认不出来的值（`?framing=half`）按没写过处理并喊一声 —— 规矩和 `?exits=` / `?gl=` 一样。
   */
  framing: FramingPolicy;
  /**
   * ?camframing=auto|on|off 摄像头自带的取景（`capture/cam-framing.ts`，docs/49 §6.3 三）。默认 auto。
   *
   * - `auto` 不请求任何东西，只读 `getSettings().faceFraming`：系统或摄像头自己开着时，腿被裁掉不算出画。
   * - `on`   在 track 报能力时请求 `faceFraming: true`（桌面演示；它对准脸，会裁腿 —— 所以不是默认）。
   * - `off`  在 track 报能力时请求 `false`，撤掉系统级默认打开。
   *
   * 浏览器不支持时静默忽略，永不挡摄像头启动。**不进控件条**：稳定版 Chrome 不暴露这个约束，按下去什么都不会发生。
   * 认不出来的值按没写过处理并喊一声 —— 规矩和 `?framing=` 一样。
   */
  camframing: CamFramingFlag;
  /**
   * ?hall=1  从舞台「回到大厅」回来：直接进选择页，不再立展签（`shell/entry.ts`）。
   * 仍然用回放起步、不问摄像头 —— 和按过「开始」一模一样，只是不用再按一次。
   */
  hall: boolean;
  /**
   * ?people=auto|1|2|3 画面里最多给几个人各一具身体（`core/src/people.ts`，docs/50）。
   * 没写或者写 `auto` = 自己发现画面里有几个人；`people` 里保留的初始上限仍由
   * `PEOPLE.defaultCap` / `PEOPLE.defaultCapKiosk` 给出，随后由自动发现调度。
   *
   * `1` 是**这一版之前的那条路，一个字都不变**：worker 里 `numPoses = 1`、不跑多人跟踪、只有一具身体。
   * 大于 1 时推理要多看几个人（`numPoses = 上限`），身体按帧预算再砍一次（`creature/people-budget.ts`）——
   * 所以写 3 不保证台上有三具：最重的物种上预算只放得下两具，第三个人没有身体（和超过上限的人同一个待遇）。
   * 认不出来的值（`?people=4` / `?people=two`）按 `auto` 处理并喊一声 —— 规矩和 `?framing=` 一样。
   */
  people: number;
  /**
   * 网页和现场都默认开的自动探测（`core/src/people-probe.ts`，docs/50 §6.3）：真摄像头稳定后、且有性能余量时定期
   * 降频并把 `numPoses` 临时抬到 `hardMax`，一次分辨一、二、三个人；一旦卡顿就收回，观众不用自己去按「人数」。
   *
   * 只有合法的数字值是固定覆盖；哪怕显式写 `1`，探测也不该在背后把它改掉。
   * 没写、写 `auto`、或写了无效值都走自动；网页和 kiosk 的语义完全一致。
   */
  peopleAuto: boolean;
}

/** `?people=` 认的值：1..`PEOPLE.hardMax` 的整数。别的一律 null = 当没写过 */
export function parsePeople(raw: string | null): number | null {
  if (raw === null || raw.trim() === '' || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= 1 && n <= PEOPLE.hardMax ? n : null;
}

/** 同一个坏值只喊一次 —— `readFlags()` 一次启动会被调好几处 */
const warnedPeople = new Set<string>();

function resolvePeople(raw: string | null, kiosk: boolean): number {
  const parsed = parsePeople(raw);
  if (parsed !== null) return parsed;
  const fallback = kiosk ? PEOPLE.defaultCapKiosk : PEOPLE.defaultCap;
  if (raw !== null && raw.trim().toLowerCase() !== 'auto' && !warnedPeople.has(raw)) {
    warnedPeople.add(raw);
    console.warn(`[kiosk] ?people=${raw} 认不出来，只认 auto / 1–${PEOPLE.hardMax} —— 按 auto 处理（初始 ${fallback}）`);
  }
  return fallback;
}

/** 同一个坏值只喊一次 —— `readFlags()` 一次启动会被调好几处 */
const warnedCamFraming = new Set<string>();

function resolveCamFraming(raw: string | null): CamFramingFlag {
  if (isCamFramingFlag(raw)) return raw;
  if (raw !== null && !warnedCamFraming.has(raw)) {
    warnedCamFraming.add(raw);
    console.warn(`[kiosk] ?camframing=${raw} 认不出来，只认 ${CAM_FRAMING_FLAGS.join(' / ')} —— 按没写过处理（auto）`);
  }
  return 'auto';
}

const warnedFraming = new Set<string>();

function resolveFraming(raw: string | null): FramingPolicy {
  if (isFramingPolicy(raw)) return raw;
  if (raw !== null && !warnedFraming.has(raw)) {
    warnedFraming.add(raw);
    console.warn(`[kiosk] ?framing=${raw} 认不出来，只认 ${FRAMING_POLICIES.join(' / ')} —— 按没写过处理（auto）`);
  }
  return 'auto';
}

/** `?gl=` 认的两个值。别的一律当没写过 */
export type GlFlag = 'on' | 'off';
const GL_FLAGS: readonly string[] = ['on', 'off'];
export const isGlFlag = (v: string | null): v is GlFlag => v !== null && GL_FLAGS.includes(v);

/** 同一个坏值只喊一次 —— `readFlags()` 一次启动会被调好几处 */
const warnedGl = new Set<string>();

function resolveGl(raw: string | null): boolean {
  if (isGlFlag(raw)) return raw === 'on';
  if (raw !== null && !warnedGl.has(raw)) {
    warnedGl.add(raw);
    console.warn(`[kiosk] ?gl=${raw} 认不出来，只认 on / off —— 按没写过处理（GL 照常用）`);
  }
  return true;
}

/** `?preview=` 的两个合法值。和 `?shading=` 同一个位置、同一条规矩 */
export type PreviewMode = 'on' | 'off';
const PREVIEW_MODES: readonly string[] = ['on', 'off'];

export function isPreviewMode(v: unknown): v is PreviewMode {
  return typeof v === 'string' && PREVIEW_MODES.includes(v);
}

/**
 * `?preview=` 认字，**认不出来的时候喊一声**。
 *
 * 这一条原来是默默退回默认的：`?preview=1` 写错了，小屏幕照常按默认挂或不挂，
 * 而现场的人分不出"参数没生效"和"参数本来就是这个意思"。`?readout=` 一出生就会喊，
 * 它的注释里还点名说 `?preview=` 至今不会 —— 同一套词汇（on / off）的两个开关，
 * 一个出错会说、一个出错不说，这本身就是一处要修的不一致。
 */
export function resolvePreview(raw: string | null): PreviewMode | null {
  if (raw === null) return null;
  if (isPreviewMode(raw)) return raw as PreviewMode;
  console.warn(`[kiosk] ?preview=${raw} 认不出来，只认 on / off —— 按没写过处理（网页版挂、现场不挂、回放永远不挂）`);
  return null;
}

/**
 * `?readout=` 的两个合法值。和 `?preview=` 同一套词汇（on / off），
 * 但**认不出来的时候要喊一声** —— `?preview=` 那一条原来是默默退回默认的（2026-09-14 已补上同样的一声），
 * 而 docs/06 §6 给新开关定的规矩是"写错的值当没写过**并打一条 warn**"。
 * 两者不一致时照规矩走，不照隔壁走。
 */
export type ReadoutMode = 'on' | 'off';
const READOUT_MODES: readonly string[] = ['on', 'off'];

export function isReadoutMode(v: unknown): v is ReadoutMode {
  return typeof v === 'string' && READOUT_MODES.includes(v);
}

/** 同一个坏值只喊一次 —— `readFlags()` 一次启动会被调好几处 */
const warnedReadout = new Set<string>();

function resolveReadout(raw: string | null): ReadoutMode | null {
  if (isReadoutMode(raw)) return raw;
  if (raw !== null && !warnedReadout.has(raw)) {
    warnedReadout.add(raw);
    console.warn(`[kiosk] ?readout=${raw} 认不出来，只认 on / off —— 按没写过处理（网页版挂、现场不挂）`);
  }
  return null;
}

/** `?wave=` 认的两个值。别的一律 null */
export type WaveFlag = 'on' | 'off';
const WAVE_FLAGS: readonly string[] = ['on', 'off'];
export const isWaveFlag = (v: string | null): v is WaveFlag =>
  v !== null && WAVE_FLAGS.includes(v);

/**
 * `?exits=` 的三态解析。`null` = 没写，或者写了但认不出来。
 *
 * 单独拎出来是为了能被单测直接钉住："认不出来"和"写了 0"必须是两件事 ——
 * 前者回到默认（现场关、别处开），后者无论在哪里都是关。
 */
export function parseExits(raw: string | null): boolean | null {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

/** 同一个坏值只喊一次 —— `readFlags()` 一次启动会被调好几处（采集端也读它） */
const warnedExits = new Set<string>();

function resolveExits(raw: string | null, kiosk: boolean): boolean {
  const parsed = parseExits(raw);
  if (parsed !== null) return parsed;
  if (raw !== null && !warnedExits.has(raw)) {
    warnedExits.add(raw);
    console.warn(`[kiosk] ?exits=${raw} 认不出来，只认 0 / 1 —— 按没写过处理`);
  }
  return !kiosk;
}

/**
 * `?arc=<秒>` 的解析。`null` = 没写，或者写了但认不出来。
 *
 * 单独拎出来（和 `parseExits` 同一条路数）是为了能被单测直接钉住：
 * 「写了一个坏值」和「没写」必须走同一条路（都按默认），但前者要说话。
 */
export function parseArcSeconds(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 同一个坏值只喊一次 —— `readFlags()` 一次启动会被调好几处 */
const warnedArc = new Set<string>();

function resolveArc(raw: string | null): number | null {
  const parsed = parseArcSeconds(raw);
  if (parsed !== null) return parsed;
  if (raw !== null && !warnedArc.has(raw)) {
    warnedArc.add(raw);
    console.warn(`[kiosk] ?arc=${raw} 认不出来，只认大于 0 的秒数 —— 按没写过处理（弧线走默认 180 秒）`);
  }
  return null;
}

/** `?theseus=` 解析出来的两件事：开不开、多快 */
export interface TheseusFlag { on: boolean; rate: number }

/**
 * `?theseus=` 的解析。`off` = 关掉整条；一个大于 0 的数 = 速率倍率；
 * 没写 = 开、倍率 1。`null` 的返回值表示"写了但认不出来"，由调用方喊一声。
 *
 * 单独拎出来（和 `parseExits` / `parseArcSeconds` 同一条路数）是为了能被单测直接钉住：
 * 「写了一个坏值」和「没写」要走同一条路，但前者必须说话。
 */
export function parseTheseus(raw: string | null): TheseusFlag | null {
  if (raw === null || raw.trim() === '') return { on: true, rate: 1 };
  const v = raw.trim();
  if (v === 'off') return { on: false, rate: 1 };
  if (v === 'on') return { on: true, rate: 1 };
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? { on: true, rate: n } : null;
}

/** 同一个坏值只喊一次 —— `readFlags()` 一次启动会被调好几处 */
const warnedTheseus = new Set<string>();

function resolveTheseus(raw: string | null): TheseusFlag {
  const parsed = parseTheseus(raw);
  if (parsed !== null) return parsed;
  if (raw !== null && !warnedTheseus.has(raw)) {
    warnedTheseus.add(raw);
    console.warn(`[kiosk] ?theseus=${raw} 认不出来，只认 off / on / 大于 0 的倍率 —— 按没写过处理（照常一件一件换）`);
  }
  return { on: true, rate: 1 };
}

/**
 * `?plan=`。认不出来就是 null = 当没写过，而且**喊一声**（和 `?model=` / `?shading=`
 * / `?scene=` / `?cam=` 同一条规矩）。
 *
 * 这里原来是 `q.get('plan')` 原样透传。于是 `?plan=quadrupd` 一路滑到
 * `remapSkeleton` 的 default，画面上站着一具**人形**，而地址栏里明明白白写着
 * 四足 —— "我写了参数"和"参数没生效"在画面上分不开，正是这条规矩存在的理由。
 * 和物种数据里拼错 `bodyPlan` 是同一个 bug，只是入口换成了地址栏。
 */
function resolvePlan(raw: string | null): BodyPlanId | null {
  if (raw === null || raw.trim() === '') return null;
  const v = raw.trim();
  if ((BODY_PLANS as readonly string[]).includes(v)) return v as BodyPlanId;
  console.warn(`[kiosk] ?plan=${raw} 认不出来，只认 ${BODY_PLANS.join(' / ')} —— 按没写过处理（用物种自己的方案）`);
  return null;
}

/**
 * `?act=`。认不出来就是 null = 当没写过，而且**喊一声**（和 `?plan=` 同一条规矩）。
 *
 * 这里原来是 `q.get('act')` 原样透传。于是 `?act=resit`（`resist` 手滑）进 `main.ts`
 * 的 `director.force()`，那边找不到就**按正常流程排座次** —— 画面上跑的是第 I 乐章
 * 的 follow，而地址栏里写着一个玩法名，看起来像生效了。
 * 名单**从 `ACTS` 现读**，不手抄：`acts/index.ts` 的文件头写着"加一个新玩法就在这里
 * 加一行，没有别的步骤"，抄一份到这里就是给它加了第二步，而那一步迟早会漏。
 */
export const ACT_IDS: readonly string[] = ACTS.map((a) => a.id);

function resolveAct(raw: string | null): string | null {
  if (raw === null || raw.trim() === '') return null;
  const v = raw.trim();
  if (ACT_IDS.includes(v)) return v;
  console.warn(`[kiosk] ?act=${raw} 认不出来，只认 ${ACT_IDS.join(' / ')} —— 按没写过处理（导演按弧线排）`);
  return null;
}

/**
 * `?theme=`。**只判写法，不判在不在**（和 `?cam=` 同一条分工）。
 *
 * 这里原来是 `q.get('theme')` 原样透传，而 `choose.ts` 的 `themeFromUrl()` 读同一个
 * 参数时是**过了这条正则的**。两个读法对同一个参数给出不同答案，`main.ts` 那句
 * `flags.theme ?? themeFromUrl()` 又让宽的那个先手 —— 于是带空格、带斜杠的值
 * 只有 `flags.theme` 认，它绕过选择页直奔一个不存在的物种。
 *
 * 单独导出 `isThemeId` 是因为 `choose/choose.ts` 的 `themeFromUrl()` 问的是同一个问题 ——
 * 它本来自己写了一份一模一样的正则，而一条规则抄两份，迟早有一份不再是那条规则。
 *
 * 为什么不在这里判"这个物种存不存在"：这里没有物种表（`parts.json` 要 fetch），
 * 而且那是另一种错 —— 写法不合法是当场就知道的事，物种不存在要等资产到齐，
 * 由 `choose.ts` 的 `chooseTheme()` 判（读不到条目表时它**认**这个 id，
 * 因为没有资产也要能开发，ADR-4）。分工和 `?cam=` 逐字一样。
 */
export const isThemeId = (v: string | null): v is string =>
  v !== null && /^[a-z0-9._-]+$/i.test(v);

function resolveTheme(raw: string | null): string | null {
  if (raw === null || raw.trim() === '') return null;
  const v = raw.trim();
  if (isThemeId(v)) return v;
  console.warn(`[kiosk] ?theme=${raw} 不是一个物种 id（只认字母数字和 . _ -）—— 按没写过处理（照常进选择页）`);
  return null;
}

/** MediaPipe 的三个 PoseLandmarker 档位。精度/延迟的实测差异见 docs/24 §3 */
export type PoseModel = 'lite' | 'full' | 'heavy';
const POSE_MODELS: readonly string[] = ['lite', 'full', 'heavy'];

export function readFlags(search = location.search): Flags {
  const q = new URLSearchParams(search);
  // 空字符串（?seed=）必须是 null 而不是 0 —— Number('') === 0 是个经典陷阱，
  // 它会让一个手滑写空的参数变成"锁定 seed 0"，而且完全没有提示。
  const num = (k: string) => {
    const v = q.get(k);
    if (v === null || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    demo: q.get('demo') === '1',
    debug: q.get('debug') === '1',
    // 降级阶梯第 1 级 = 关后期。写在这里而不是让各子系统各记一份状态：
    // 谁读 flags 谁就自动看到降级后的世界，晚初始化的模块也不会漏掉。
    nopost: q.get('nopost') === '1' || getDegradeState().nopost,
    mirror: q.get('mirror') !== '0',
    theme: resolveTheme(q.get('theme')),
    seed: num('seed'),
    tier: num('tier'),
    kiosk: q.get('kiosk') === '1',
    act: resolveAct(q.get('act')),
    arc: resolveArc(q.get('arc')),
    theseus: resolveTheseus(q.get('theseus')),
    plan: resolvePlan(q.get('plan')),
    scene: q.get('scene'),
    selftest: q.get('selftest') === '1',
    clip: q.get('clip'),
    // 手滑写 ?model=fulll 不该静默退回 lite —— 认不出来就是 null，
    // 采集端会把"实际用的是哪个档"显示出来，现场不用猜。
    model: POSE_MODELS.includes(q.get('model') ?? '') ? (q.get('model') as PoseModel) : null,
    // 默认开。之所以给一个关的开关：精化是**唯一**会在观众和数据之间加延迟的东西，
    // 现场如果有人说"反应慢了"，要能在 3 秒内证明是不是它。
    refine: q.get('refine') !== '0',
    vitality: q.get('vitality') !== '0',
    // 默认开声音。`?mute=1` 是现场"三秒内让它闭嘴"的第一条路 ——
    // 第二条是运行中按 `m`，不用重载（docs/29 §现场怎么调）。
    mute: q.get('mute') === '1',
    loading: q.get('loading') !== '0',
    // 现场默认不挂目录：装置前面的画面上不该有网站导航（docs/23 §S4「默认零 UI」）。
    // 判断放在这里而不是各挂载点，是为了只有一处决定"现场看得见什么"。
    nav: q.get('nav') !== '0' && q.get('kiosk') !== '1',
    // 认不出来就是 null（和 ?model= 同一条规矩）：手滑写 ?shading=cartoon
    // 不该静默退回物种默认，那样"我明明写了参数"和"参数没生效"分不开
    shading: isShadingId(q.get('shading')) ? (q.get('shading') as ShadingId) : null,
    // 认不出来（?cam=1.5 / ?cam=-1 / ?cam=前面那台）就是 null = 当没写过。
    // "那台不在" 不在这里判 —— 这里没有设备表，而且那是另一种错：
    // 它要的是现场看得见的大声回落，不是静默的 null（见 camera-select.ts 文件头）。
    cam: isCamFlag(q.get('cam')) ? q.get('cam')!.trim() : null,
    // 认不出来就是 null（同 `?scene=` / `?shading=` / `?cam=`）：
    // `?preview=1` 手滑写成数字**不该**被猜成 'on'，那样"我写了参数"和
    // "参数没生效"就分不开了。挂不挂的默认判断在 `ui/preview.ts` 的 `wantsPreview()`，
    // 不在这里 —— 这里只负责认字。
    preview: resolvePreview(q.get('preview')),
    // 认不出来就是 null = 当没写过，**而且喊一声**（见 `resolveReadout` 的注释）。
    // 挂不挂的默认判断在 `ui/readout-state.ts` 的 `wantsReadout()`，不在这里 ——
    // 这里只负责认字，和 `?preview=` 同一条分工。
    readout: resolveReadout(q.get('readout')),
    // 认不出来就是 null = 当没写过（和 ?shading= / ?cam= 同一条规矩）。
    // "默认是哪一条"由消费者决定并打印出来，不在这里替它决定。
    wave: isWaveFlag(q.get('wave')) ? (q.get('wave') as WaveFlag) : null,
    exits: resolveExits(q.get('exits'), q.get('kiosk') === '1'),
    // 默认 on。`?gl=off` 是唯一一条能在有 WebGPU 的机器上跑到
    // "环起不来"那条降级路径的办法 —— 消费者是 `main.ts` 的
    // `chooseTheme({ forceFallback: !flags.gl })`。
    gl: resolveGl(q.get('gl')),
    worker: q.get('worker') !== 'off',
    framing: resolveFraming(q.get('framing')),
    camframing: resolveCamFraming(q.get('camframing')),
    hall: q.get('hall') === '1',
    people: resolvePeople(q.get('people'), q.get('kiosk') === '1'),
    // 只有合法的数字才是固定覆盖；没写 / auto / 无效值在网页和现场都自动探测
    peopleAuto: parsePeople(q.get('people')) === null,
  };
}

/** 防止 macOS 在无人交互时息屏 —— 装置会在这上面吃大亏 */
async function keepAwake(): Promise<() => void> {
  const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
  if (!nav.wakeLock) return () => {};
  let lock: { release(): Promise<void> } | null = null;
  const acquire = async () => {
    try { lock = await nav.wakeLock!.request('screen'); }
    catch { /* 没权限就算了，不是致命的 */ }
  };
  await acquire();
  // 切走再切回来会自动释放，必须重新申请
  const onVis = () => { if (document.visibilityState === 'visible') void acquire(); };
  document.addEventListener('visibilitychange', onVis);
  return () => { document.removeEventListener('visibilitychange', onVis); void lock?.release(); };
}

export interface Kiosk { dispose(): void; }

export function enterKiosk(canvas: HTMLCanvasElement, flags: Flags): Kiosk {
  const cleanups: (() => void)[] = [];

  if (flags.kiosk) {
    document.documentElement.style.cursor = 'none';
    // 全屏必须由用户手势触发，所以挂在第一次点击上
    const once = () => { void document.documentElement.requestFullscreen?.().catch(() => {}); };
    addEventListener('pointerdown', once, { once: true });
    cleanups.push(() => removeEventListener('pointerdown', once));
  }

  void keepAwake().then((release) => cleanups.push(release));

  // 有人动鼠标/键盘 = 有人在这儿，立刻退出无人降帧（现场调试时不该对着 10fps 调参）
  const wake = () => noteActivity();
  addEventListener('pointermove', wake, { passive: true });
  addEventListener('pointerdown', wake, { passive: true });
  addEventListener('keydown', wake);
  cleanups.push(() => {
    removeEventListener('pointermove', wake);
    removeEventListener('pointerdown', wake);
    removeEventListener('keydown', wake);
  });

  // WebGL/WebGPU context lost：现场跑几小时一定会遇到一次
  const onLost = (e: Event) => {
    e.preventDefault();
    console.warn('[kiosk] graphics context lost —— 3 秒后重载');
    setTimeout(() => location.reload(), 3000);
  };
  canvas.addEventListener('webglcontextlost', onLost);
  cleanups.push(() => canvas.removeEventListener('webglcontextlost', onLost));

  // 未捕获的异常不该让页面停在半死状态
  const onErr = (e: ErrorEvent) => console.error('[kiosk] uncaught:', e.message);
  const onRej = (e: PromiseRejectionEvent) => console.error('[kiosk] unhandled rejection:', e.reason);
  addEventListener('error', onErr);
  addEventListener('unhandledrejection', onRej);
  cleanups.push(() => { removeEventListener('error', onErr); removeEventListener('unhandledrejection', onRej); });

  return { dispose() { for (const c of cleanups) c(); } };
}
