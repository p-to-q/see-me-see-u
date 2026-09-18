import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blendSkeletons, groundSkeleton, remapSkeleton, BODY_PLANS, PLANS_WITHOUT_FEET, PLANS_WITHOUT_PARTS,
  type BodyPlanSpec,
} from '../src/bodyplan.ts';
import { buildSkeleton } from '../src/skeleton.ts';
import { dist } from '../src/vec.ts';
import type { Skeleton, Vec3 } from '../src/types.ts';

// 合成一副站立的人体骨架（米，Y-up，面朝 +Z，左侧在 +X）
const POSE: Record<string, Vec3> = {
  pelvis: [0, 0.95, 0], chest: [0, 1.35, 0], neck: [0, 1.45, 0], headCenter: [0, 1.60, 0],
  shoulderL: [0.19, 1.38, 0], elbowL: [0.33, 1.10, 0.02], wristL: [0.44, 0.86, 0.04], handTipL: [0.48, 0.77, 0.05],
  shoulderR: [-0.19, 1.38, 0], elbowR: [-0.33, 1.10, 0.02], wristR: [-0.44, 0.86, 0.04], handTipR: [-0.48, 0.77, 0.05],
  hipL: [0.09, 0.93, 0], kneeL: [0.10, 0.51, 0.01], ankleL: [0.10, 0.09, 0], footIdxL: [0.10, 0.03, 0.16],
  hipR: [-0.09, 0.93, 0], kneeR: [-0.10, 0.51, 0.01], ankleR: [-0.10, 0.09, 0], footIdxR: [-0.10, 0.03, 0.16],
};

const human = (over: Record<string, Vec3> = {}): Skeleton =>
  buildSkeleton({ ...POSE, ...over }, [], 0);

const lowestJoint = (sk: Skeleton) => Math.min(...Object.values(sk.joints).map((p) => p[1]));

const lowestFoot = (sk: Skeleton) => Math.min(
  sk.joints.footIdxL?.[1] ?? Infinity, sk.joints.footIdxR?.[1] ?? Infinity,
  sk.joints.ankleL?.[1] ?? Infinity, sk.joints.ankleR?.[1] ?? Infinity,
);

test('rig 是恒等映射', () => {
  const sk = human();
  const out = remapSkeleton(sk, 'rig');
  assert.equal(out, sk, 'rig 应该原样返回同一个对象，不做任何拷贝');
});

test('未知 plan 按 rig 处理，不抛异常（P2）', () => {
  const sk = human();
  assert.equal(remapSkeleton(sk, 'no-such-plan'), sk);
  assert.equal(remapSkeleton(sk, undefined as never), sk);
});

test('每个 plan 都不产生 NaN，且骨头数不变', () => {
  const sk = human();
  for (const plan of BODY_PLANS) {
    const out = remapSkeleton(sk, plan);
    assert.equal(out.bones.length, sk.bones.length, `${plan} 改变了骨头数`);
    for (const b of out.bones) {
      assert.ok(b.p0.every(Number.isFinite) && b.p1.every(Number.isFinite), `${plan} 的 ${b.id} 有 NaN`);
      assert.ok(Number.isFinite(b.length), `${plan} 的 ${b.id} 长度非有限`);
    }
    for (const k in out.joints) {
      assert.ok(out.joints[k].every(Number.isFinite), `${plan} 的关节 ${k} 有 NaN`);
    }
  }
});

test('重映射之后要重新贴地（rig 除外 —— 它是恒等，落地是 stabilize 的职责）', () => {
  // 为什么排除 rig：remapSkeleton('rig') 原样返回同一个对象（上面第一条测试写死了这点）。
  // 落地已经由 stabilize.ts 在 FK 之后做过（docs/04 §3.5），这里不该再做一遍 ——
  // 为了让一条断言更整齐而去拷贝一份骨架，是拿性能换整齐。
  //
  // PLANS_WITHOUT_FEET 的基准不一样：radial 把四肢拆成了绕核心的弧，"脚"这个概念没了，
  // 贴地只能按整体最低点算。拿脚当基准会让半个笼子沉到地板下面。
  const sk = human();
  for (const plan of BODY_PLANS) {
    if (plan === 'rig') continue;
    // B 档（mass / swarm）同理，而且理由更直接：它们根本不是骨架重映射，
    // 是另一条身体实现（`app/src/creature/{mass,swarm}.ts`）。`remapSkeleton`
    // 对它们返回同一个对象，拿"重映射之后要贴地"去要求它们等于要求
    // `remapSkeleton` 去做 `stabilize` 的活。它们列在 BODY_PLANS 里是因为
    // 那张表是**合法值的名单**，不是"这个文件处理得了的名单"。
    if (PLANS_WITHOUT_PARTS.includes(plan)) continue;
    const out = remapSkeleton(sk, plan);
    const y = PLANS_WITHOUT_FEET.includes(plan) ? lowestJoint(out) : lowestFoot(out);
    assert.ok(Math.abs(y) < 1e-9, `${plan} 的最低点在 y=${y}，没贴地`);
  }
});

// ── quadruped：真的是四足吗 ────────────────────────────────────────────────

test('quadruped：躯干是水平的', () => {
  const q = remapSkeleton(human(), 'quadruped');
  const trunk = dist(q.joints.pelvis, q.joints.chest);
  const rise = Math.abs(q.joints.chest[1] - q.joints.pelvis[1]);
  assert.ok(trunk > 0.3, `躯干太短: ${trunk}`);
  // 允许前低后高的自然斜度，但抬升不能超过躯干长度的一半 —— 否则还是竖着的
  assert.ok(rise < trunk * 0.5, `躯干不够水平：长 ${trunk.toFixed(2)}，抬升 ${rise.toFixed(2)}`);
  // 前后要真的分开在 Z 上
  assert.ok(Math.abs(q.joints.chest[2] - q.joints.pelvis[2]) > trunk * 0.8, '前后没有在 Z 上拉开');
});

test('quadruped：四只脚都在地面附近 —— 它是站着的，不是拖着走', () => {
  const q = remapSkeleton(human(), 'quadruped');
  const feet = ['footIdxL', 'footIdxR', 'handTipL', 'handTipR'].map((n) => q.joints[n][1]);
  for (const y of feet) {
    assert.ok(y < 0.35, `有一只脚离地 ${y.toFixed(2)}m，四足应该四点触地`);
  }
});

test('quadruped：头伸向前方，不是朝上', () => {
  const q = remapSkeleton(human(), 'quadruped');
  const d = [
    q.joints.headCenter[0] - q.joints.chest[0],
    q.joints.headCenter[1] - q.joints.chest[1],
    q.joints.headCenter[2] - q.joints.chest[2],
  ];
  assert.ok(Math.abs(d[2]) > Math.abs(d[1]), `头主要朝 ${Math.abs(d[2]) > Math.abs(d[1]) ? 'Z' : 'Y'}，应该朝前(Z)`);
});

test('quadruped：因果没断 —— 抬起人的手臂，前腿跟着抬', () => {
  const down = remapSkeleton(human(), 'quadruped');
  // 把左臂抬到水平
  const up = remapSkeleton(human({
    elbowL: [0.40, 1.36, 0.02], wristL: [0.62, 1.36, 0.04], handTipL: [0.71, 1.36, 0.05],
  }), 'quadruped');
  const before = down.joints.handTipL[1];
  const after = up.joints.handTipL[1];
  assert.ok(after > before + 0.15,
    `抬手之后前爪只从 ${before.toFixed(2)} 变到 ${after.toFixed(2)} —— 因果链断了`);
});

test('quadruped：人转身时四足跟着转（左右没有被写死）', () => {
  const q = remapSkeleton(human(), 'quadruped');
  assert.ok(q.joints.shoulderL[0] > 0 && q.joints.shoulderR[0] < 0, '左右肩的 X 符号反了');
  assert.ok(q.joints.hipL[0] > 0 && q.joints.hipR[0] < 0, '左右胯的 X 符号反了');
});

// ── 比例类 ────────────────────────────────────────────────────────────────

test('towering 更高、stub 更矮', () => {
  const base = human();
  const tall = remapSkeleton(base, 'towering');
  const short = remapSkeleton(base, 'stub');
  assert.ok(tall.height > base.height * 1.15, `towering 只有 ${tall.height.toFixed(2)}`);
  assert.ok(short.height < base.height * 0.85, `stub 有 ${short.height.toFixed(2)}`);
});

test('inverted：头到了下面', () => {
  const inv = remapSkeleton(human(), 'inverted');
  assert.ok(inv.joints.headCenter[1] < inv.joints.pelvis[1], '倒立之后头应该比胯低');
});

test('退化输入：空骨架 / 缺关节 / NaN 都不抛', () => {
  const empty = { bones: [], joints: {}, height: 0, warmingUp: false, t: 0 } as Skeleton;
  for (const plan of BODY_PLANS) assert.equal(remapSkeleton(empty, plan), empty);
  const broken = human({ kneeL: [NaN, NaN, NaN], footIdxR: [Infinity, 0, 0] });
  for (const plan of BODY_PLANS) {
    const out = remapSkeleton(broken, plan);
    for (const b of out.bones) assert.ok(b.p0.every(Number.isFinite) && b.p1.every(Number.isFinite));
  }
});

// ── 参数化比例：物种身份的另一半 ────────────────────────────────────────────

test('比例 spec：球形物种真的是"巨大躯干 + 退化四肢"', () => {
  const base = human();
  const orb = remapSkeleton(base, { limb: 0.2, torso: 2.2, head: 0.4 });
  const armBase = dist(base.joints.shoulderL, base.joints.handTipL);
  const armOrb = dist(orb.joints.shoulderL, orb.joints.handTipL);
  const torsoBase = dist(base.joints.pelvis, base.joints.chest);
  const torsoOrb = dist(orb.joints.pelvis, orb.joints.chest);
  assert.ok(armOrb < armBase * 0.35, `四肢没退化：${armBase.toFixed(2)} → ${armOrb.toFixed(2)}`);
  assert.ok(torsoOrb > torsoBase * 1.8, `躯干没变大：${torsoBase.toFixed(2)} → ${torsoOrb.toFixed(2)}`);
});

test('比例 spec：arm / leg 可以分别叠加在 limb 之上', () => {
  const base = human();
  const longArms = remapSkeleton(base, { arm: 1.5, leg: 0.82 });
  const a0 = dist(base.joints.shoulderL, base.joints.handTipL);
  const a1 = dist(longArms.joints.shoulderL, longArms.joints.handTipL);
  const l0 = dist(base.joints.hipL, base.joints.footIdxL);
  const l1 = dist(longArms.joints.hipL, longArms.joints.footIdxL);
  assert.ok(a1 > a0 * 1.4, `手臂没变长：${a0.toFixed(2)} → ${a1.toFixed(2)}`);
  assert.ok(l1 < l0 * 0.9, `腿没变短：${l0.toFixed(2)} → ${l1.toFixed(2)}`);
});

test('比例 spec：全是 1 的 spec 等于不做（不白跑一趟）', () => {
  const base = human();
  const noop = remapSkeleton(base, { limb: 1, torso: 1 });
  assert.equal(noop, base, '没有任何比例变化时应该原样返回');
});

test('拓扑 + 比例可以叠加，且顺序是先拓扑后比例', () => {
  const base = human();
  const q = remapSkeleton(base, 'quadruped');
  const qSmall = remapSkeleton(base, { kind: 'quadruped', limb: 0.7 });
  // 仍然是四足（躯干水平）
  const trunk = dist(qSmall.joints.pelvis, qSmall.joints.chest);
  const rise = Math.abs(qSmall.joints.chest[1] - qSmall.joints.pelvis[1]);
  assert.ok(rise < trunk * 0.5, '叠加比例之后不再是四足了 —— 说明比例把拓扑冲掉了');
  // 而且确实变小了
  const legQ = dist(q.joints.hipL, q.joints.footIdxL);
  const legS = dist(qSmall.joints.hipL, qSmall.joints.footIdxL);
  assert.ok(legS < legQ * 0.85, `腿没变短：${legQ.toFixed(2)} → ${legS.toFixed(2)}`);
});

test('比例 spec 同样贴地、同样不产生 NaN', () => {
  const specs: BodyPlanSpec[] = [
    { limb: 0.2, torso: 2.2, head: 0.4 },
    { arm: 1.5, leg: 0.82 },
    { kind: 'quadruped', limb: 0.7 },
    { head: 1.9 },
  ];
  for (const spec of specs) {
    const out = remapSkeleton(human(), spec);
    const y = lowestFoot(out);
    assert.ok(Math.abs(y) < 1e-9, `${JSON.stringify(spec)} 没贴地: ${y}`);
    for (const b of out.bones) assert.ok(b.p0.every(Number.isFinite) && b.p1.every(Number.isFinite));
  }
});

test('未知 kind 按 rig 处理，但比例照常生效（外部数据可能带我们不认识的 plan）', () => {
  const base = human();
  // `as BodyPlanSpec` 是这条测试的全部意思：`kind` 现在是 `BodyPlanId`，
  // 写不出未知值**正是新增的那道门**（拼错的 plan 在 tsc 就红）。
  // 但运行时的宽容必须留着 —— parts.json 是外部数据，手改过的、旧版本写的、
  // 将来某个版本加的方案都可能出现在这里，而这个函数在帧循环里，绝不许抛（P2）。
  const out = remapSkeleton(base, { kind: 'some-future-plan', torso: 1.5 } as unknown as BodyPlanSpec);
  const t0 = dist(base.joints.pelvis, base.joints.chest);
  const t1 = dist(out.joints.pelvis, out.joints.chest);
  assert.ok(t1 > t0 * 1.4, '未知拓扑时比例也该生效');
});

// ── radial：真的没有躯干吗，因果还在吗 ──────────────────────────────────────

/** 骨链末端到 pelvis 的距离 —— 拿它当"这条肢伸出去多远" */
const spread = (sk: Skeleton) => Math.max(
  Math.abs(sk.joints.handTipL[0]), Math.abs(sk.joints.handTipR[0]),
  Math.abs(sk.joints.footIdxL[0]), Math.abs(sk.joints.footIdxR[0]),
);

/** 张开双臂的人 */
const armsOpen = () => human({
  elbowL: [0.50, 1.38, 0], wristL: [0.74, 1.38, 0], handTipL: [0.83, 1.38, 0],
  elbowR: [-0.50, 1.38, 0], wristR: [-0.74, 1.38, 0], handTipR: [-0.83, 1.38, 0],
});
/** 抬起左手的人 */
const armRaised = () => human({
  elbowL: [0.24, 1.66, 0], wristL: [0.28, 1.90, 0], handTipL: [0.30, 1.99, 0],
});
/** 蹲下的人 */
const crouched = () => human({
  pelvis: [0, 0.55, 0], chest: [0, 0.95, 0], neck: [0, 1.05, 0], headCenter: [0, 1.20, 0],
  hipL: [0.09, 0.53, 0], hipR: [-0.09, 0.53, 0],
  kneeL: [0.16, 0.32, 0.25], kneeR: [-0.16, 0.32, 0.25],
  shoulderL: [0.19, 0.98, 0], shoulderR: [-0.19, 0.98, 0],
  elbowL: [0.33, 0.70, 0.02], wristL: [0.44, 0.46, 0.04], handTipL: [0.48, 0.37, 0.05],
  elbowR: [-0.33, 0.70, 0.02], wristR: [-0.44, 0.46, 0.04], handTipR: [-0.48, 0.37, 0.05],
});

test('radial：没有脊柱 —— 核心被压扁到人体躯干的一半以下', () => {
  const base = human();
  const r = remapSkeleton(base, 'radial');
  const coreBase = dist(base.joints.pelvis, base.joints.headCenter);
  const core = dist(r.joints.pelvis, r.joints.headCenter);
  assert.ok(core < coreBase * 0.5, `核心还有 ${core.toFixed(2)}（人体 ${coreBase.toFixed(2)}），没压扁就还是"躯干 + 一个环"`);
});

test('radial：四条弧真的绕着核心 —— 每条弧都有一段绕到了核心背面', () => {
  const r = remapSkeleton(human(), 'radial');
  const hub = r.joints.pelvis;   // 核心底端，够用来判断"环"是不是包住了它
  // 环绕的判据：至少有一个肢体关节的 Z 在核心前面，另一个在后面
  const zs = ['handTipL', 'handTipR', 'footIdxL', 'footIdxR', 'elbowL', 'kneeR']
    .map((n) => r.joints[n][2] - hub[2]);
  assert.ok(Math.max(...zs) > 0.2 && Math.min(...zs) < -0.2,
    `部件全挤在核心的一侧（Z 范围 ${Math.min(...zs).toFixed(2)}..${Math.max(...zs).toFixed(2)}），那不是环，是身体`);
});

test('radial：张开双臂 → 环扩大；蹲下 → 环收拢', () => {
  const stand = remapSkeleton(human(), 'radial');
  const open = remapSkeleton(armsOpen(), 'radial');
  const low = remapSkeleton(crouched(), 'radial');
  assert.ok(spread(open) > spread(stand) * 1.2,
    `张开双臂环没扩大：${spread(stand).toFixed(2)} → ${spread(open).toFixed(2)}`);
  assert.ok(low.height < stand.height * 0.85,
    `蹲下环没收拢：${stand.height.toFixed(2)} → ${low.height.toFixed(2)}`);
});

test('radial：因果没断 —— 抬左手，左边那条弧整条浮起来', () => {
  const before = remapSkeleton(human(), 'radial').joints.handTipL[1];
  const after = remapSkeleton(armRaised(), 'radial').joints.handTipL[1];
  assert.ok(after > before + 0.2, `抬手之后只从 ${before.toFixed(2)} 变到 ${after.toFixed(2)} —— 因果链断了`);
});

// ── column：真的没有腿吗，因果还在吗 ────────────────────────────────────────

test('column：没有腿 —— 六块腿骨串成一根柱子，不是两条并排的链', () => {
  const c = remapSkeleton(human(), 'column');
  // 两条腿如果还并排，左右脚的 X 会分开；串成一柱之后它们全在轴线上
  const dx = Math.abs(c.joints.footIdxL[0] - c.joints.footIdxR[0]);
  assert.ok(dx < 0.05, `左右脚还分开 ${dx.toFixed(2)}m，说明还是两条腿`);
  // 而且是首尾相接的：右腿顶端 = 左脚底端
  assert.ok(dist(c.joints.hipR, c.joints.ankleL) < 0.5, '柱子断开了');
  assert.ok(c.joints.headCenter[1] > c.joints.hipL[1], '头应该在柱子顶上');
});

test('column：柱子比人高 —— 两条腿串起来本来就该长', () => {
  const base = human();
  const c = remapSkeleton(base, 'column');
  assert.ok(c.height > base.height * 1.2, `只有 ${c.height.toFixed(2)}，没有"从地面长上来"的读法`);
});

test('column：因果没断 —— 抬手，顶端的分支跟着抬', () => {
  const before = remapSkeleton(human(), 'column').joints.handTipL[1];
  const after = remapSkeleton(armRaised(), 'column').joints.handTipL[1];
  assert.ok(after > before + 0.5, `分支只从 ${before.toFixed(2)} 抬到 ${after.toFixed(2)}`);
});

test('column：蹲下 → 柱子按之字折叠，真的变矮（而不是把部件压扁）', () => {
  const stand = remapSkeleton(human(), 'column');
  const low = remapSkeleton(crouched(), 'column');
  assert.ok(low.height < stand.height * 0.92,
    `蹲下柱子没矮：${stand.height.toFixed(2)} → ${low.height.toFixed(2)}`);
  // 折叠只改方向不改长度：同一个人身上，桅杆每一节的骨长必须等于人体那根骨头的长度
  const boneLen = (sk: Skeleton, id: string) => sk.bones.find((b) => b.id === id)!.length;
  const src = crouched();
  for (const id of ['shinL', 'shinR', 'thighL', 'thighR', 'footL', 'footR']) {
    assert.ok(Math.abs(boneLen(low, id) - boneLen(src, id)) < 1e-6,
      `${id} 的长度被改了 —— 那是压扁部件，不是折叠`);
  }
});

test('column：张开双臂 → 顶端分支跟着张开', () => {
  const stand = remapSkeleton(human(), 'column');
  const open = remapSkeleton(armsOpen(), 'column');
  const w = (sk: Skeleton) => Math.abs(sk.joints.handTipL[0] - sk.joints.handTipR[0]);
  assert.ok(w(open) > w(stand) * 1.3, `分支没张开：${w(stand).toFixed(2)} → ${w(open).toFixed(2)}`);
});

test('radial / column：比例 spec 仍然生效（它们是先缩放再换拓扑）', () => {
  const base = human();
  const plain = remapSkeleton(base, 'column');
  const longArm = remapSkeleton(base, { kind: 'column', arm: 1.5 });
  const a0 = dist(plain.joints.shoulderL, plain.joints.handTipL);
  const a1 = dist(longArm.joints.shoulderL, longArm.joints.handTipL);
  assert.ok(a1 > a0 * 1.35, `column 的 arm 比例没生效：${a0.toFixed(2)} → ${a1.toFixed(2)}`);

  const r0 = remapSkeleton(base, 'radial');
  const r1 = remapSkeleton(base, { kind: 'radial', limb: 0.6 });
  assert.ok(spread(r1) < spread(r0) * 0.85, `radial 的 limb 比例没生效：${spread(r0).toFixed(2)} → ${spread(r1).toFixed(2)}`);
});

// ── 第 III 乐章的那一次漂移（docs/40 §1；`blendSkeletons`）───────────────────

test('blend: 两端就是两个方案本身，中间不许凭空多出一具身体', () => {
  const sk = human();
  const rig = remapSkeleton(sk, 'rig');
  const quad = remapSkeleton(sk, 'quadruped');
  // 两端走捷径：弧线四段里有三段落在这里，那些帧必须零分配
  assert.equal(blendSkeletons(rig, quad, 0), rig);
  assert.equal(blendSkeletons(rig, quad, 1), quad);
  assert.equal(blendSkeletons(rig, quad, -1), rig, '负数按 0 处理，不许外插');
  assert.equal(blendSkeletons(rig, quad, Number.NaN), rig);

  const mid = blendSkeletons(rig, quad, 0.5);
  assert.equal(mid.bones.length, rig.bones.length, '17 根骨头一根不多一根不少');
  for (const b of mid.bones) {
    const a0 = rig.bones.find((x) => x.id === b.id)!;
    const b0 = quad.bones.find((x) => x.id === b.id)!;
    for (let i = 0; i < 3; i++) {
      const lo = Math.min(a0.p0[i], b0.p0[i]);
      const hi = Math.max(a0.p0[i], b0.p0[i]);
      assert.ok(b.p0[i] >= lo - 1e-9 && b.p0[i] <= hi + 1e-9,
        `${b.id} 漂到了两端之外 —— 那是一具没人设计过的身体`);
    }
  }
});

test('blend: 骨长是**重新量**的，不是插出来的 —— 否则部件会被拉成橡皮', () => {
  const sk = human();
  const mid = blendSkeletons(remapSkeleton(sk, 'rig'), remapSkeleton(sk, 'column'), 0.4);
  for (const b of mid.bones) {
    assert.ok(Math.abs(b.length - dist(b.p0, b.p1)) < 1e-9,
      `${b.id} 的 length 和两端点对不上（${b.length} vs ${dist(b.p0, b.p1)}）`);
  }
});

test('blend: 漂移的每一帧都还是一具合法骨架（拓扑换了也一样）', () => {
  const sk = human();
  for (const plan of ['quadruped', 'radial', 'column', 'inverted'] as const) {
    const to = remapSkeleton(sk, plan);
    for (let t = 0.1; t < 1; t += 0.1) {
      const mid = blendSkeletons(sk, to, t);
      assert.equal(mid.bones.length, 17, `${plan} @${t.toFixed(1)}：骨头数变了`);
      for (const b of mid.bones) {
        // 下限是 0 不是正数：这副合成姿态里 footL/footR 本来就是零长骨
        assert.ok(Number.isFinite(b.length) && b.length >= 0, `${plan} @${t.toFixed(1)}：${b.id} 骨长坏了`);
        assert.ok(b.p0.every(Number.isFinite) && b.p1.every(Number.isFinite));
      }
      for (const k in mid.joints) {
        assert.ok(mid.joints[k].every(Number.isFinite), `${plan} @${t.toFixed(1)}：关节 ${k} 是 NaN`);
      }
    }
  }
});

test('blend: 每个中间态都按目标方案落地，不悬空也不入地', () => {
  // 真实主线的 rig 来自 stabilizer，入口已经贴地；测试也遵守这个前提。
  const raw = human();
  const floor = lowestFoot(raw);
  const joints: Record<string, Vec3> = {};
  for (const key in raw.joints) {
    const p = raw.joints[key];
    joints[key] = [p[0], p[1] - floor, p[2]];
  }
  const rig = buildSkeleton(joints, [], 0);

  for (const plan of ['quadruped', 'towering', 'stub', 'inverted', 'radial', 'column'] as const) {
    const target = remapSkeleton(rig, plan);
    for (const t of [0.01, 0.25, 0.5, 0.75, 0.99]) {
      const mid = groundSkeleton(blendSkeletons(rig, target, t), plan);
      const y = PLANS_WITHOUT_FEET.includes(plan) ? lowestJoint(mid) : lowestFoot(mid);
      assert.ok(Math.abs(y) < 1e-9, `${plan} @${t.toFixed(2)} 的落地点在 y=${y.toFixed(4)}m`);
    }
  }
});

test('final grounding is zero-allocation when the body is already on the floor', () => {
  const input = human();
  const grounded = groundSkeleton(input, 'rig');
  assert.notEqual(grounded, input, 'the floating fixture must exercise the correction path first');
  assert.equal(groundSkeleton(grounded, 'rig'), grounded, 'the normal grounded path allocated a second skeleton');
});
