/**
 * **站着别动。** —— docs/40 §1「这条线上最硬的一条：永远不脱钩」的那个判据。
 *
 * > 四个乐章里，没有一个是"它自己在动"。⋯⋯站着别动，如果它还在做动作，
 * > 这条线就破了 —— 那一刻它不再需要你，而这件作品的全部前提是它需要你。
 *
 * 所以这里喂进去一副**一动不动**的骨架，走完整条弧线，断言输出也一动不动。
 * 变的是映射（哪根肢体答哪根、延迟多久、幅度怎么缩放），来源永远是观众。
 *
 * 这个文件同时带着它自己的**对照组**：`untether` 在同一套夹具下必须**动**。
 * 没有那一条，这些断言在"我的夹具根本没跑起来"时也会全绿（P21：
 * 一个在坏掉时读数和正常时一样的仪表不是仪表）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTS, createDirector, type World } from '../src/acts/index.ts';
import { createUntether, untether } from '../src/acts/untether.ts';
import { createArc, ARC_ACTS, type ArcState } from '../../core/src/arc.ts';
import { buildSkeleton } from '../../core/src/skeleton.ts';
import { createVitality } from '../../core/src/vitality.ts';
import type { Act } from '../src/acts/act.ts';
import type { Skeleton, Vec3 } from '../../core/src/types.ts';

/** 一个站着不动的人。数值和 `core/test/bodyplan.test.ts` 的那副是同一副 */
const POSE: Record<string, Vec3> = {
  pelvis: [0, 0.95, 0], chest: [0, 1.35, 0], neck: [0, 1.45, 0], headCenter: [0, 1.60, 0],
  shoulderL: [0.19, 1.38, 0], elbowL: [0.33, 1.10, 0.02], wristL: [0.44, 0.86, 0.04], handTipL: [0.48, 0.77, 0.05],
  shoulderR: [-0.19, 1.38, 0], elbowR: [-0.33, 1.10, 0.02], wristR: [-0.44, 0.86, 0.04], handTipR: [-0.48, 0.77, 0.05],
  hipL: [0.09, 0.93, 0], kneeL: [0.10, 0.51, 0.01], ankleL: [0.10, 0.09, 0], footIdxL: [0.10, 0.03, 0.16],
  hipR: [-0.09, 0.93, 0], kneeR: [-0.10, 0.51, 0.01], ankleR: [-0.10, 0.09, 0], footIdxR: [-0.10, 0.03, 0.16],
};
const STILL: Skeleton = buildSkeleton(POSE, [], 0);

/**
 * 同一个人，站偏 0.3m、右手举过头顶，然后一动不动。
 * 上面那副是左右对称的，而对称姿态在"朝向"那一路上是恒等的 ——
 * 拿它测，朝向就算在没人出力的时候自己转过去，也量不出来。
 */
const STILL_ASYM: Skeleton = (() => {
  const p: Record<string, Vec3> = {};
  for (const k in POSE) p[k] = [POSE[k][0] + 0.3, POSE[k][1], POSE[k][2]];
  p.elbowR = [0, 1.62, 0.02]; p.wristR = [-0.04, 1.88, 0.04]; p.handTipR = [-0.05, 1.97, 0.05];
  return buildSkeleton(p, [], 0);
})();

/**
 * 观众一动不动地站 `seconds` 秒，量这具身体**自己**动了多少（米）。
 *
 * 头 `settle` 秒不算：`resist` 的临界阻尼和 `echo` 的缓冲各有一段建立期，
 * 那不是"自己在动"，那是它在追上一个静止的目标。
 *
 * `segment()` 变了就重新取基准。**乐章交接那一下位移不算脱钩** ——
 * 那正是 docs/40 那张表里"变的"那一列（哪根肢体答哪根、镜像、错位）：
 * `facing` 把 X 取负，身体会整个换到对面去，而那是一次**映射**的改变，
 * 不是它在自己表演。这个判据量的是同一个映射之内它还动不动。
 */
function selfMotion(play: (w: World, dt: number) => void, w: World & { posed: Skeleton | null },
  seconds = 20, settle = 3, segment: () => string = () => ''): number {
  const dt = 1 / 60;
  let ref: Record<string, Vec3> | null = null;
  let seg: string | null = null;
  let segStart = 0;
  let worst = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const t = i * dt;
    // 会话时钟照走 —— 延迟那一路给缓冲打的就是这个时间戳
    (w as { t: number }).t = t;
    play(w, dt);
    const now = segment();
    if (now !== seg) { seg = now; segStart = t; ref = null; continue; }
    if (!w.posed || t - segStart < settle) continue;
    if (!ref) { ref = structuredClone(w.posed.joints); continue; }
    for (const k in w.posed.joints) {
      const a = ref[k]; const b = w.posed.joints[k];
      if (!a) continue;
      worst = Math.max(worst, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
  }
  return worst;
}

type StillWorld = World & { posed: Skeleton | null; arc: ArcState };

function stillWorld(arc: ArcState, skeleton: Skeleton = STILL): StillWorld {
  const w = {
    t: 0,
    presence: { state: 'ALIVE' as const, elapsed: 60, transition: 1 },
    arc,
    skeleton,
    // 站着不动的人：速度、能量、jerk 全是 0，stillness 是 1
    features: {
      speed: 0, energy: 0, expansiveness: 0.5, verticality: 0.2,
      symmetry: 0, jerk: 0, stillness: 1,
    },
    evolution: { charge: 0, tier: 3 as const, tierChanged: false, progress: 1 },
    genome: null,
    posed: null as Skeleton | null,
    creature: { pose(sk: Skeleton) { (w as { posed: Skeleton | null }).posed = sk; } },
    stage: {}, library: {}, capture: {},
    flags: { debug: false },
    rng: { next: () => 0.5, weighted: <T>(xs: readonly T[]) => xs[0] },
    morph() {}, note() {},
  };
  return w as unknown as StillWorld;
}

/** 一米的千分之一。低于它的位移在 1.7m 的身体上连一个像素都不到 */
const STILL_ENOUGH = 1e-3;

for (const id of ARC_ACTS) {
  for (const [name, pose] of [['对称', STILL], ['举手偏站', STILL_ASYM]] as const) {
    test(`永不脱钩：钉在第 ${ARC_ACTS.indexOf(id) + 1} 个地名「${id}」（${name}）—— 人不动，它就不动`, (t) => {
      const act = ACTS.find((a) => a.id === id) as Act;
      const w = stillWorld(createArc().state, pose);
      act.enter?.(w);
      // 按住 = `?act=` 那条路：钉在它自己那一点上，而不是跟着弧线（此刻在 0）
      const moved = selfMotion((world, dt) => act.update(world, dt, { pinned: true }), w);
      t.diagnostic(`${id}/${name}: 静止 20 秒，自动 ${(moved * 1000).toFixed(4)}mm`);
      assert.ok(moved < STILL_ENOUGH,
        `${id} 在观众静止时自己动了 ${(moved * 1000).toFixed(1)}mm —— ` +
        '那一刻它不再需要他（docs/40 §1「永远不脱钩」）');
      assert.ok(w.posed !== null, `${id} 一帧都没有 pose 过 —— 这个夹具没跑起来`);
    });
  }
}

for (const [name, pose] of [['对称', STILL], ['举手偏站', STILL_ASYM]] as const) {
  test(`永不脱钩：整条弧线走一遍（${name}），**跨过旧界也**不自己动`, (t) => {
    // 这里原来按 `director.currentId` 分段、每换一段重取基准 ——
    // 「乐章交接那一下位移不算脱钩」。docs/44 §6 之后没有交接了，这个豁免也删掉：
    // 整整 200 秒一个基准，名字换了四次，身体一毫米都不许动。
    const arc = createArc();
    const director = createDirector(ACTS);
    const vitality = createVitality();
    const w = stillWorld(arc.state, pose);
    const seen = new Set<string>();
    const moved = selfMotion((world, dt) => {
      (world as StillWorld).arc = arc.update(true, dt);
      // 按正式主线把身体先交给 vitality，再进 Director。旧测试绕过这一层，
      // 因而它即使在静止时主动呼吸，下面仍会全绿。
      (world as unknown as { skeleton: Skeleton }).skeleton = vitality.apply(pose, dt);
      director.update(world, dt);
      seen.add(director.currentId!);
    }, w, 200, 5);
    t.diagnostic(`整条弧线 200 秒（${name}），自动 ${(moved * 1000).toFixed(4)}mm`);
    assert.deepEqual([...seen].sort(), [...ARC_ACTS].sort(), '四个名字都要真的上过台');
    assert.ok(moved < STILL_ENOUGH, `整条弧线上它自己动了 ${(moved * 1000).toFixed(1)}mm`);
  });
}

test('对照组：`untether` 在同一套夹具下**必须**动 —— 否则上面那些断言什么都没测', (t) => {
  // 它是唯一一个脱钩的玩法，而它只由观众自己按下去（docs/40 §1 末尾、docs/16 §7）。
  // 「主动交出身体」和「被作品擅自拿走」是两件相反的事。
  const w = stillWorld(createArc().state);
  const act = createUntether();
  act.enter?.(w);
  const moved = selfMotion((world, dt) => act.update(world, dt), w);
  t.diagnostic(`untether: 静止 20 秒，自动 ${(moved * 1000).toFixed(1)}mm`);
  assert.ok(moved > 0.01,
    `untether 只动了 ${(moved * 1000).toFixed(1)}mm —— 夹具量不出"自己在动"，上面的绿是假的`);
});

test('对照组：弧线永远走不到那个脱钩的玩法', () => {
  assert.equal(untether.canEnter?.({} as World), false, 'canEnter 必须恒为 false');
  assert.ok(!(ARC_ACTS as readonly string[]).includes('untether'));
});
