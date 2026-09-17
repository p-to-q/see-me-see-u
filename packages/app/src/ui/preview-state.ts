/**
 * 「它有没有看见我」—— 把一帧采集结果判成四种状态中的一种。**纯函数。**
 *
 * ## 它解决的那一个问题
 *
 * 观众站到摄像头前面，没有任何办法知道自己是不是被看见了。追踪一垮
 * （逆光、离得太近、半个人出画、摄像头对着墙），身体就只是**站着不动** ——
 * 而"站着不动"和"这件作品坏了"在观众眼里是同一个画面。
 *
 * 判据必须是纯的，理由和 `core/refine.ts` 一样：这是唯一一处
 * "它到底有没有在看我"能被**证伪**的地方。它要是只活在 DOM 里，
 * 就只能靠站在摄像头前面反复试 —— 而现场没有那个时间。
 *
 * ## 为什么不自己再定义一套置信度
 *
 * `core/refine.ts` 已经有一套"追踪质量"的说法（`qualityScale()`：
 * score 高于 `REFINE.qualityStart` 就是 1，跌到 `qualityFloor` 压到
 * `slowdownFactor`）。精化器正是靠它决定要不要变迟钝。
 *
 * 这里**直接用同一个函数**，不另外写一个门限。两套置信度必然会漂：
 * 那天就会出现"缩略图说一切正常、身体却在发木"，而那是 P21 里最贵的那种仪表 ——
 * 它报的数是真的，只是**真在另一件事上**。
 *
 * ## 出画的判据为什么另算
 *
 * 半个人出画的时候 score 常常还很高（看得见的那半边点点都很清楚）。
 * 靠 score 一条永远抓不住它，而它恰恰是现场最常见的一种"没看见"。
 * 所以出画用 `screen`（图像归一化坐标）单独判，而且**排在质量前面** ——
 * 「往后退一点」是观众当场做得到的事，「光不够」不是。
 */
import type { Landmark, RawPose } from '../../../core/src/types.ts';
import { PREVIEW } from '../../../core/src/tuning.ts';
import { qualityScale } from '../../../core/src/refine.ts';
import { lateralEvidence, trustedLandmark, type Side } from '../../../core/src/autoframe.ts';
import { CAPTURE } from '../../../core/src/tuning.ts';
import type { Flags } from '../shell/kiosk.ts';

/**
 * 这一场要不要挂那块屏幕。**判断只有这一处**，`main.ts` 不许自己再判一次
 *（和 `readFlags().nav` 同一条纪律：只有一个地方决定"现场看得见什么"）。
 *
 * 住在这个文件而不是 `preview.ts`，是因为它必须能在 node 里测 ——
 * `preview.ts` import 了 CSS，进不了单测。
 *
 * - `?demo=1` **永远不挂**，`?preview=on` 也不行。这一条被质疑过一次，
 *   问题问得很好，所以把答案写在这里：
 *
 *   回放这条路上**没有摄像头，但是有 landmark** —— 身体确实在动。
 *   那么这一块显示什么？三个选项，两个是假话：
 *     (a) 挂着、写"打开摄像头"：观众看着身体在动，却被告知没人看见 → 自相矛盾。
 *     (b) 挂着、画那副骨架、安安静静：**这是最坏的一个**。那副骨架是
 *         录像里另一个人的。观众一挥手，骨架不跟 —— 于是他得出的结论正是
 *         "它没在看我"，也就是这块屏幕存在的全部意义被反过来用了。
 *     (c) 根本不挂。
 *   选 (c)。**不存在不是撒谎**，屏幕上没有任何东西在声称任何事。
 *   何况现场切到 `?demo=1` 的那一刻，正是摄像头已经翻车的时刻 ——
 *   那时候还留着一块"看得见你"的指示灯，是 P21 里最贵的那种仪表：
 *   它报的数是真的，只是真在另一件事上。
 * - `?kiosk=1` 默认不挂：装置画面上不该多出一个网页组件（docs/23 §S4「默认零 UI」）。
 *   但现场恰恰是"观众不知道自己被没被看见"最要命的地方，所以留了
 *   `?preview=on` 这条明路 —— 要不要那块屏幕是策展决定，不是代码决定。
 * - 其余（网页版）默认挂：那里的观众连"该不该按右下角那个按钮"都不知道。
 */
export function wantsPreview(flags: Flags): boolean {
  if (flags.demo) return false;
  if (flags.preview) return flags.preview === 'on';
  return !flags.kiosk;
}

/**
 * 四种状态。**只有 `ok` 是不说话的那一种。**
 * docs/23 §S4「默认零 UI」：一切正常的时候屏幕上不该多出一个字。
 */
export type SeeState = 'off' | 'empty' | 'partial' | 'ok';

/**
 * 为什么是这个状态。`partial` 有两个成因，而它们要的是**两句不同的话** ——
 * 出画要往后退，质量差要换个亮一点的地方。状态只有四种，话可以有五句。
 */
export type SeeReason = 'ok' | 'camera' | 'nobody' | 'bounds' | 'side' | 'quality';

export interface SeeReading {
  state: SeeState;
  reason: SeeReason;
  /**
   * `reason === 'side'` 时：从观众**自己的**哪一侧走出了画（docs/49 §6.3 二）。
   * 往后退救不了往旁边走出去的人，所以它和 `bounds` 是两句话。
   */
  side?: Side;
}

/**
 * 小屏上那条侧边画在显示的哪一边。侧边按观众自己的左右说；镜像显示时那就是屏幕上的同一侧，
 * `?mirror=0`（只用于调坐标）时反过来。
 */
export function displaySide(side: Side, mirror: boolean): Side {
  return mirror ? side : side === 'left' ? 'right' : 'left';
}

/**
 * 小屏的数字裁切开不开（docs/49 §6.3 一、§6.5）。三条都要满足：
 *  - 上半身是正当取景；
 *  - 没有减少动态（一块跟着人挪的缩略图本身就是动态）；
 *  - 画里没有别的**有身体**的人（多人时取景是整组，也就是整幅 —— 和舞台一律全景同一条）。
 */
export function cropActive(input: { upperIsIntended: boolean; reduced: boolean; othersBodied: boolean }): boolean {
  return input.upperIsIntended && !input.reduced && !input.othersBodied;
}

export interface SeeInput {
  /**
   * 摄像头这条路在不在。false = 没开 / 权限被拒 / 现在跑的是回放。
   * 调用方自己决定怎么算（`main.ts` 用的是"当前 capture 有没有 video 且没有致命错误"），
   * 因为"摄像头开没开"是浏览器的事，不是这个函数该知道的事。
   */
  camera: boolean;
  /** 最近一次采集结果。null = 这一帧没人 */
  pose: RawPose | null;
  /** 上半身是正当取景（`FramingDecision.upperIsIntended`）。缺省 false = 这一版之前的行为 */
  upperIsIntended?: boolean;
  /** 摄像头画面宽 / 高；缺省由 Auto Framing 安全回落 16:9。 */
  aspect?: number;
}

// 四个数都在 `core/tuning.ts` 的 `PREVIEW` 块里，各自的理由写在那边。
// 搬过去的原因只有一个：`edgeMargin` 是换一颗镜头就要重调的量，
// 而现场调一个数不该要求人去读一个 UI 文件。
const { edgeMargin: EDGE_MARGIN, outOfFramePoints: OUT_OF_FRAME_POINTS } = PREVIEW;

/**
 * 哪些点参与出画判定：只看**可信**的点，理由同 `refine.ts` 的遮挡门限。
 * 没有 visibility 字段 = 模型不给这个数（`skeleton.ts` / `refine.ts` 同一条约定）：
 * 有坐标就当可信，而不是当不可信 —— 当不可信会让整条判据在那些模型版本上**恒为绿**。
 * 判据本身住在 `core/src/autoframe.ts`：取景分类器和这块小屏必须是同一把尺子。
 */
const trusted = trustedLandmark;

/**
 * 有几个**可信**点落在画面外。**导出**是为了左下角读数的「部分出画」告警（`readout-state.ts`）
 * 用这一把尺子，而不是另画一条线 —— 两块仪表对"出画"说法不一，观众会信其中一块、不信另一块。
 *
 * `upperIsIntended`：上半身是一个**正当的取景**（取景模式判成上半身，或者有人选了上半身，docs/49 §落地）。
 * 这时**只从画面下边出去的**点不算出画 —— 画面下边就是这个取景自己选的那条切线：
 * 腿在它下面，放在腿上、桌上的手也常常在它下面（合成的"坐着的人"第一版只豁免了胯以下，
 * 六个手指点照样把小屏喊成「往后退一点」）。为它说话就是在纠正一个没有犯的错。
 * **从上边、左右出去的照样算**：头被切、肩出了边，在任何取景里都是真的出画。
 */
export function outOfFrame(screen: readonly Landmark[] | undefined, upperIsIntended = false): number {
  if (!screen?.length) return 0;
  let n = 0;
  for (let i = 0; i < screen.length; i++) {
    const l = screen[i];
    if (!trusted(l)) continue;
    const below = l.y > 1 + EDGE_MARGIN;
    if (upperIsIntended && below && l.x >= -EDGE_MARGIN && l.x <= 1 + EDGE_MARGIN) continue;
    if (l.x < -EDGE_MARGIN || l.x > 1 + EDGE_MARGIN || l.y < -EDGE_MARGIN || below) n++;
  }
  return n;
}

/**
 * 一帧 → 一个状态。**没有时间、没有随机、没有 DOM**（P1）。
 *
 * 顺序是有讲究的，从"最没得商量"排到"最需要解释"：
 *   没有摄像头 → 没有人 → 出画 → 质量不够 → 好的。
 */
export function seeState(input: SeeInput): SeeReading {
  if (!input.camera) return { state: 'off', reason: 'camera' };

  const pose = input.pose;
  const score = Number.isFinite(pose?.score) ? pose!.score : 0;
  // 和 `main.ts` 判 `detected` 用的是**同一条线**（CAPTURE.minScore）。
  // 不一致的话，缩略图会在身体已经站起来之后还说"站到画面里"。
  if (!pose || score <= CAPTURE.minScore) return { state: 'empty', reason: 'nobody' };

  // `screen` 可能没有（回放数据里就常常没有）。没有就跳过这一条，
  // 而不是当成"没出画" —— 少一条判据是事实，编一个"都在画面里"不是。
  if (pose.screen?.length) {
    // 从左右走出去的排在「往后退」前面：它按躯干**坐标**判，不数可信点 ——
    // MediaPipe 对画外的点给低可见度，半个人出了左边时画外点一个都不可信（docs/49 §6.2 S4）
    const side = lateralEvidence(pose, input.aspect)?.side;
    if (side) return { state: 'partial', reason: 'side', side };
    if (outOfFrame(pose.screen, input.upperIsIntended) >= OUT_OF_FRAME_POINTS) return { state: 'partial', reason: 'bounds' };
  }

  // 质量：直接问精化器自己的那把尺子。< 1 = 它已经开始变迟钝了。
  if (qualityScale(score) < 1) return { state: 'partial', reason: 'quality' };

  return { state: 'ok', reason: 'ok' };
}

/**
 * 话不能闪。
 *
 * 逐帧判出来的状态在门限附近一定会颤（score 就在 `qualityStart` 上下跳一下），
 * 而屏幕上一句忽隐忽现的话比没有话更糟 —— 观众读到的是"这东西在抽"。
 *
 * 所以显示层看到的不是 `seeState()` 的原始输出，是这里憋过的：
 * **新状态要连续成立 `ENTER_SECONDS` 才换过去**，回到 `ok` 也一样要憋
 * （憋得更久一点 —— 「好了」比「不好」更容易是一次误报）。
 */
const { enterSeconds: ENTER_SECONDS, enterOkSeconds: ENTER_OK_SECONDS } = PREVIEW;

export interface SeeWatch {
  /** 喂一帧，拿回**当前对外的**读数（不是这一帧的原始判定） */
  update(input: SeeInput, dt: number): SeeReading;
  readonly current: SeeReading;
  reset(): void;
}

/** 开机第一帧就说"没摄像头"是对的：那时候确实还没有摄像头 */
const INITIAL: SeeReading = { state: 'off', reason: 'camera' };

export function createSeeWatch(): SeeWatch {
  let shown: SeeReading = INITIAL;
  let pending: SeeReading | null = null;
  let held = 0;

  return {
    update(input, dt) {
      const now = seeState(input);
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;

      if (now.state === shown.state) {
        // 状态没变，但成因可能变了（出画 → 光不够）。成因不必憋：
        // 两句话都属于同一块"不太好"，换一句不会读成闪烁。
        shown = now;
        pending = null;
        held = 0;
        return shown;
      }
      if (!pending || pending.state !== now.state) {
        pending = now;
        held = 0;
      }
      held += step;
      if (held >= (now.state === 'ok' ? ENTER_OK_SECONDS : ENTER_SECONDS)) {
        shown = now;
        pending = null;
        held = 0;
      }
      return shown;
    },
    get current() { return shown; },
    reset() { shown = INITIAL; pending = null; held = 0; },
  };
}
