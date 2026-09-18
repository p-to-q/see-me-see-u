/**
 * 举手滚动的**接线**：摄像头 → 世界坐标 → `wave.ts` 的状态机 → 环。
 *
 * 判断全在 `wave.ts`（纯函数、可测）。这里只干三件不可测的事：
 * 读时钟、取最近一帧姿态、把结果喂给环。
 *
 * ## 喂进的是**已经存在的**那条输入路
 *
 * 不新开一条。滚轮走的是 `spinVel += 量`，这里走的是同一个 `field.nudge()`：
 * 于是惯性、阻尼、槽位吸附、以及"甩出去之后怎么收尾"全部原样复用。
 * 另开一条的话，手势滚出来的手感会和滚轮不一样 —— 而那两者本来就该是同一件事。
 *
 * ## "它武装了"怎么说
 *
 * 不画任何新东西（docs/26 §F 反面清单：不用卡片、图标、进度条、toast）。
 * 用的是这一页**本来就有的**那句话：光标所在处，环会软化、卡片会朝它倾。
 * 手一举起来，环上就出现同样的一团软化，强度 = 蓄势进度（0.75 秒里从无到有），
 * 位置跟着手横向移动 —— 而且是**沿着卡片行进的那根轴**移动（正面那段弧是竖的），
 * 所以观众看到的第一件事是"它认得我"，第二件事是"往这边走会怎样"。
 *
 * 这团软化落在屏幕中心那张卡上：那正是鼠标悬停正面卡时发生的事，
 * 一个像素的新 UI 都没有。
 *
 * ⚠️ 另一条泳道正在做左上角的摄像头预览 + 骨架叠加。**那是这个信号更自然的家**
 * （举起来的那条手臂可以在预览里亮起来）。本条泳道不碰他们的文件；
 * 需要他们开的口子写在收尾报告里。
 */
import { CAPTURE } from '../../../../core/src/tuning.ts';
import { LM, landmarkConfidence, mediapipeToWorld } from '../../../../core/src/skeleton.ts';
import type { RawPose } from '../../../../core/src/types.ts';
import { posePresent } from '../../../../core/src/pose-signal.ts';
import type { RingField } from './field.ts';
import { createWaveReader, type HandSample, type WaveInput, type WaveOut } from './wave.ts';

export interface WaveDriverOptions {
  field: RingField;
  /** 最近一帧姿态。**没有摄像头 / 没授权 / `?demo=1` 时根本不该传这个函数** */
  pose: () => RawPose | null;
  /** 观众真的滚了一下。用来续那 30 秒空闲计时（和滚轮 / 指针同一条待遇） */
  onScroll?: () => void;
}

export interface WaveDriver {
  stop(): void;
  /** 只读读数，取证和 `/dev/choose.html` 用 */
  debug(): WaveOut & { poses: number };
}

/**
 * 视觉信号的竖直行程，占视口高的比例。
 * 只能到 0.35：再大就会跑进上下两条玻璃唇（`RING.bandTop/bandBottom` 各 0.08），
 * 那里的折射会把这团软化读成"画面出问题了"。
 */
const SIGNAL_TRAVEL = 0.35;

export function startWaveInput(options: WaveDriverOptions): WaveDriver {
  const { field, pose, onScroll } = options;
  const reader = createWaveReader();
  const left: HandSample = { x: 0, y: 0, shoulderY: 0, ok: false };
  const right: HandSample = { x: 0, y: 0, shoulderY: 0, ok: false };
  const input: WaveInput = { left, right };
  let out: WaveOut = reader.update(null, 0);
  let poses = 0;
  /** 上一帧用过的姿态时间戳。推理只有 30Hz，帧有 60 —— 同一帧姿态不必重算一次坐标 */
  let lastPoseT = -1;
  let prevT = performance.now();
  let raf = 0;
  let stopped = false;

  const sample = (raw: RawPose): boolean => {
    const lms = Array.isArray(raw.world) ? raw.world : [];
    // 坐标换算**只走这一处**（P4）。它顺手做了镜像、Y 翻转和落地平移；
    // 落地平移对"腕比肩高多少"没有影响（整具一起平移），对 x 也没有影响。
    const j = mediapipeToWorld(raw);
    const min = CAPTURE.minJointConfidence;
    left.x = j.wristL[0];
    left.y = j.wristL[1];
    left.shoulderY = j.shoulderL[1];
    left.ok = landmarkConfidence(lms[LM.L_WRIST]) >= min
      && landmarkConfidence(lms[LM.L_SHOULDER]) >= min;
    right.x = j.wristR[0];
    right.y = j.wristR[1];
    right.shoulderY = j.shoulderR[1];
    right.ok = landmarkConfidence(lms[LM.R_WRIST]) >= min
      && landmarkConfidence(lms[LM.R_SHOULDER]) >= min;
    return left.ok || right.ok;
  };

  const frame = (): void => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    // 钳住：切回一个后台标签页会给出好几秒的 dt（和 `field.ts` 的 tick 同一条）
    const dt = Math.min(0.05, Math.max(0, (now - prevT) / 1000));
    prevT = now;

    // 环还没进稳态（展签、剥离）或者已经在坍缩了：这一整条不参与。
    // 剥离途中被手势推一把会把入场时间线撞歪，而那是这件作品的第一印象。
    if (!field.accepting()) {
      reader.reset();
      out = reader.update(null, 0);
      field.reach(0, 0, 0);
      return;
    }

    let raw: RawPose | null = null;
    try {
      raw = pose();
    } catch {
      // `latest()` 的契约是绝不抛（capture.ts 文件头），但这条链上还有别人写的壳。
      // 帧循环不许抛（P2）—— 这一帧就当没有人。
      raw = null;
    }

    let ok = false;
    if (posePresent(raw)) {
      if (raw.t !== lastPoseT) {
        lastPoseT = raw.t;
        poses++;
        ok = sample(raw);
      } else {
        ok = left.ok || right.ok;
      }
    }

    out = reader.update(ok ? input : null, dt);

    if (out.spin !== 0) {
      field.nudge(out.spin);
      onScroll?.();
    }
    // 蓄势那 0.75 秒里 charge 从 0 爬到 1：观众在"还没滚"的时候就已经看见它醒了。
    // 这是这条输入唯一的反馈 —— 没有它，人会挥两下然后判定它坏了。
    field.reach(0, out.offset * innerHeight * SIGNAL_TRAVEL, out.charge);
  };

  raf = requestAnimationFrame(frame);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      // 走的时候把那团软化收掉，否则它会冻在最后一帧的位置上
      field.reach(0, 0, 0);
    },
    debug: () => ({ ...out, poses }),
  };
}
