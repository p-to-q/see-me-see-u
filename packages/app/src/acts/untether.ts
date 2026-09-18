/**
 * 归还：它把身体收回去，演自己的动作。
 *
 * ## 它是什么
 *
 * 观众按下右下角那一行「把身体还回去」之后上场的那一个玩法。
 * 摄像头照开、采集照跑、骨架照算 —— **只是它不再用你的那一份**。
 * 所以这不是"关掉摄像头"，是**它当着你的面收回自己的身体**：
 * 你继续动，它不再回应；你停下来，它还在动。
 * 这正是这件作品的命题（"那具身体和我是什么关系"）最直接的一次陈述。
 *
 * ## 为什么它必须是"新建的"，以及它刻意做得很小
 *
 * 玩法一共四个（`acts/index.ts`），没有一个是自主的：`follow` / `resist` /
 * `facing` 都由当前骨架驱动，`echo` 由 1.2 秒前的骨架驱动 —— 全部都要有人站在那儿。
 * 所以"它自己动"这件事在这个仓库里**此前不存在**，只能新写。
 * 但它按 docs/16 §6 的配方写：一个文件、几十行、不碰帧循环、不碰任何契约，
 * 从 `ACTS` 里删掉那一行就等于没发生过。
 *
 * ## 那段"自己的动作"是什么
 *
 * 一场缓慢的**站立摇曳**，不是一段动画：
 * 以观众离开时的那副骨架为姿态基准（比例、骨长、脚的位置都是对的），
 * 在它上面叠一个随高度增强的正弦位移场 —— 离地越高摆得越多，
 * 像一棵立着的东西在呼吸。两个频率不成整数比，所以它不会走回同一个循环。
 *
 * 三条硬约束（`packages/core/test/acts-shape.test.ts` 静态钉住）：
 * 不 import three、不读时钟（时间从 `w.t` / `dt` 来）、不就地改 `w.skeleton`。
 *
 * ## 它永远不会被 Director 选中
 *
 * `canEnter` 恒为 false：这一场是**观众按出来的**，不是导演随机排到的。
 * `director.force()` 不看 `canEnter`（`acts/act.ts`），所以右下角那一行
 * 和 `?act=untether` 都照常进得来。
 */
import type { Bone, Skeleton, Vec3 } from '../../../core/src/types.ts';
import { SKELETON, UNTETHER } from '../../../core/src/tuning.ts';
import type { Act } from './act.ts';

const TAU = Math.PI * 2;

/**
 * 位移场：同一个点永远得到同一个位移，所以骨头两端一起被搬走、
 * 形状不会被撕开。强度随离地高度线性增长（脚不动，头摆得最多）。
 */
function drift(p: Vec3, h: number, t: number): Vec3 {
  const up = Math.max(0, Math.min(UNTETHER.heightWeightCap, p[1] / Math.max(UNTETHER.minHeightMeters, h)));
  const s = Math.sin(TAU * UNTETHER.swayHz * t) * UNTETHER.swayHeightRatio * h * up;
  const z = Math.sin(TAU * UNTETHER.swayHz * t * UNTETHER.depthFrequencyRatio + UNTETHER.depthPhaseRadians)
    * UNTETHER.swayHeightRatio * UNTETHER.depthAmplitudeRatio * h * up;
  const y = Math.sin(TAU * UNTETHER.breathHz * t) * UNTETHER.breathHeightRatio * h * up;
  return [p[0] + s, p[1] + y, p[2] + z];
}

/**
 * 每个 Director 都要拿自己的实例。`base` / `age` 若在模块级共享，双屏或联机的第二具身体
 * 会把第一具的基准姿态覆盖掉；单舞台时看不见，扩成多舞台时却会直接串人。
 */
export function createUntether(): Act {
  /** 姿态基准：观众交出身体那一刻的那副骨架。没有它就什么都不做 */
  let base: Skeleton | null = null;
  /** 上场以来的秒数。**不从 `w.t` 读**，那是会话时钟，上场第一帧就会跳一大段相位 */
  let age = 0;

  return {
    id: 'untether',
    label: '归还（它自己动）',
    kind: 'body',
    weight: 0,
    instantiate: createUntether,
    // 永远不自动上场 —— 只由 `director.force()` 进来（右下角那一行 / `?act=untether`）
    canEnter: () => false,

    enter(w) {
      age = 0;
      base = w.skeleton;
    },

    update(w, dt) {
      // 上场那一帧可能正好丢追踪。补一次基准，而不是僵在那里等（P3）。
      if (!base) base = w.skeleton;
      const sk = base;
      if (!sk) return;
      const step = Number.isFinite(dt) && dt > 0
        ? Math.min(dt, UNTETHER.maxStepSeconds)
        : UNTETHER.fallbackStepSeconds;
      age += step;

      const h = sk.height > 0 ? sk.height : SKELETON.referenceHeight;
      // **构造一份新的**，不就地改 —— `w.skeleton` 是共享的（docs/16 §7b），
      // 而 `base` 本身就是某一帧的 `w.skeleton`。
      const joints: Record<string, Vec3> = {};
      for (const k in sk.joints) joints[k] = drift(sk.joints[k], h, age);
      const bones: Bone[] = sk.bones.map((b) => {
        const p0 = drift(b.p0, h, age);
        const p1 = drift(b.p1, h, age);
        // 位移场是连续的，两端搬的量略有差别 —— 重新量一次长度，
        // 否则挂载数学会照着旧长度拉伸部件（和 resist.ts 同一条理由）。
        return { ...b, p0, p1, length: Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) };
      });

      w.creature.pose({ ...sk, joints, bones, t: sk.t + age }, w.presence, step);
      w.note('归还：它自己在动');
    },

    // 把 note 擦掉。`follow` 从不写 note，所以不擦的话 `?debug=1` 的 HUD 上
    // 会一直挂着「归还：它自己在动」——**身体已经交回去了，仪表还在说没有**。
    // 一个说的是上一场的仪表就不是仪表（docs/02 P21）。
    exit(w) { base = null; age = 0; w.note(''); },
  };
}

/** 玩法目录里的原型；正式运行时 `createDirector()` 会为自己实例化一份。 */
export const untether: Act = createUntether();
