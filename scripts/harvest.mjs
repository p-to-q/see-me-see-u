#!/usr/bin/env node
/**
 * 取件脚本 —— 从开源仓库下载真实机器人/解剖网格，拆成单件，过规范化流水线。
 *
 * 为什么脚本是交付物而下载的网格不是：各来源授权不同（BSD-3 / Apache-2.0 / MIT 都要保留声明），
 * 而且原始 CAD 动辄几 MB。把网址和授权写进代码、让任何人能重新取一遍，
 * 比把二进制塞进仓库更诚实也更可维护。原料落到 `assets/harvest/`（.gitignore）。
 *
 * 为什么每条来源带一行授权注释：这件作品是公开仓库 + 公开部署。
 * 授权判断必须跟着 URL 走，不能只写在文档里 —— 文档会和代码分叉，这里不会。
 *
 * 用法：
 *   node scripts/harvest.mjs            下载 + 规范化 + 验收
 *   node scripts/harvest.mjs --list     只列来源和授权，不下载
 *   node scripts/harvest.mjs --only=shin.real.cassie.a
 *   node scripts/harvest.mjs --verify   只对已有产物验收（不重新下载）
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HARVEST = resolve(ROOT, 'assets/harvest');          // 下载的原始网格
const OUT = resolve(ROOT, 'assets/parts/harvest');        // 规范化产物

/**
 * 契约阈值 —— 和 `packages/factory/src/check-parts.ts` 逐字一致。
 * 为什么在这里复述而不是 import：那个文件是合并门，只认 `assets/parts/parts.json`，
 * 而 parts.json 由别的线在动（AGENTS.md：不碰）。取件池是独立的池子，
 * 就像慢回路的 `assets/parts/lineage/` 一样 —— 但**验收标准必须是同一套数字**。
 */
const EPS = 2e-3, MAX_TRIS = 5000, MAX_BYTES = 1_500_000;

/**
 * 来源一律钉死在 commit SHA，不要指向 `main`。
 *
 * 指向分支的后果不是报错，是**来源在脚下变**：今天取到的和明天取到的可能不是同一个网格，
 * 而 `check:parts` 照样 0 错 —— 你不会知道它变过。
 * 这和海报数字漂掉是同一类错（`assets/brand/README.md` 记过一次）：
 * 没人在说谎，只是没人负责重新核对。
 *
 * 要升级来源：改 SHA，重跑，**在提交信息里写清楚为什么升**。
 */
const MENAGERIE_SHA = '8161bba264d7fa7c99ca301e91e7fb44737676ad';   // 2026-09-13
const BODYPARTS_SHA = 'fd527e6f4daf732fd814314d9257df5877b844bc';   // 2026-09-13
const MENAGERIE = `https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/${MENAGERIE_SHA}`;
// Menagerie 之外的两条路（docs/42 §3）。同样钉整串 SHA —— 短 SHA 在上游再多几次提交之后可能变得有歧义。
const RLG_SHA = '3bd1111011ea8c9813a66bf5cc21f31067f2e1ef';     // RobotLocomotion/models · 2026-09-03
const LIMX_SHA = '5b97add1f3b461c9ed26ff2ff2f5025cc6ee4316';    // limxdynamics/tron1-robot-description · 2026-08-10
const RLG = `https://raw.githubusercontent.com/RobotLocomotion/models/${RLG_SHA}`;
const LIMX = `https://raw.githubusercontent.com/limxdynamics/tron1-robot-description/${LIMX_SHA}`;

/**
 * 来源清单。
 *
 * `license` 一列是**对这件作品的判定**（公开仓库 + 公开部署 + 非商业艺术装置），
 * 不是泛泛的授权名。三档见 docs/33 §1：✅ 直接可用 / 🟡 有条件 / ❌ 不能用。
 * 这里只放 ✅ 和 🟡 —— ❌ 的来源根本不该出现在可执行的取件路径上。
 *
 * MuJoCo Menagerie 的关键事实：**每个机器人子目录带自己的 LICENSE**，
 * 仓库根的 Apache-2.0 管的是 MJCF 和工具，不是厂商的几何。所以判定必须逐个机器人做。
 */
const SOURCES = [
  {
    id: 'shin.real.cassie.a', slot: 'shin', family: 'real.cassie',
    // MIT（Agility Robotics 自己发布）—— 保留版权声明即可，无 share-alike。这是最干净的一档。
    license: '✅ MIT · Agility Robotics · mujoco_menagerie/agility_cassie/LICENSE',
    url: `${MENAGERIE}/agility_cassie/assets/shin.obj`,
    note: 'Cassie 小腿。真机就叫 shin，几何直接对上我们的 shin 槽位',
  },
  {
    id: 'foreArm.real.cassie.a', slot: 'foreArm', family: 'real.cassie',
    license: '✅ MIT · Agility Robotics · mujoco_menagerie/agility_cassie/LICENSE',
    url: `${MENAGERIE}/agility_cassie/assets/tarsus.obj`,
    note: 'Cassie 跗骨连杆。细长、两端有轴承座，当前臂用比当小腿更像',
  },
  {
    id: 'thigh.real.anymal.a', slot: 'thigh', family: 'real.anymal',
    // BSD-3-Clause（ANYbotics AG, 2020）—— 保留版权 + 免责声明，可再分发。
    license: '✅ BSD-3-Clause · ANYbotics AG · mujoco_menagerie/anybotics_anymal_c/LICENSE',
    url: `${MENAGERIE}/anybotics_anymal_c/assets/thigh.obj`,
    note: 'ANYmal C 大腿。带驱动器外壳，分缝和散热筋是真的',
  },
  {
    id: 'shin.real.anymal.a', slot: 'shin', family: 'real.anymal',
    license: '✅ BSD-3-Clause · ANYbotics AG · mujoco_menagerie/anybotics_anymal_c/LICENSE',
    url: `${MENAGERIE}/anybotics_anymal_c/assets/shank_l.obj`,
    note: 'ANYmal C 小腿。碳纤维管 + 端头，比生成件瘦得多 —— 正是生成模型编不出来的比例',
  },
  {
    id: 'shin.real.g1.a', slot: 'shin', family: 'real.g1',
    // Unitree 的 BSD-3 变体：保留版权 + 免责声明，禁止用 Unitree 名义背书。
    // 我们不声称背书，判定为可用；但**必须**在 docs/33 和 credits 里写明来源。
    license: '🟡 BSD-3 变体 · Unitree Robotics · 需署名且不得暗示背书',
    url: `${MENAGERIE}/unitree_g1/assets/left_knee_link.STL`,
    note: 'G1 膝下连杆。roster 的 compact 条目就是 G1，而它的参考图一直没找到（docs/31 §1 第 5 行）',
  },
  {
    id: 'spine.real.g1.a', slot: 'spine', family: 'real.g1',
    license: '🟡 BSD-3 变体 · Unitree Robotics · 需署名且不得暗示背书',
    url: `${MENAGERIE}/unitree_g1/assets/torso_link_rev_1_0.STL`,
    note: 'G1 躯干。人形躯干的真实比例，生成件最容易编错的就是这个',
  },
  {
    id: 'shin.real.spot.a', slot: 'shin', family: 'real.spot',
    // BSD-3-Clause（Clearpath Robotics 发布的 Spot 描述包）。
    license: '✅ BSD-3-Clause · Clearpath Robotics · mujoco_menagerie/boston_dynamics_spot/LICENSE',
    url: `${MENAGERIE}/boston_dynamics_spot/assets/front_left_lower_leg.obj`,
    note: 'Spot 前左小腿。roster 的 patrol 条目就是 Spot',
  },

  // ── 解剖骨骼（docs/33 §2 B 脉络）───────────────────────────────────────────
  // 这两件是 🟡：CC-BY-SA 要求署名 + 注明改动 + 衍生件同样开源。
  // 我们做的改动恰恰全是 CC-BY-SA 眼里的「改动」：转轴、挪原点、归一长度、减面、去材质。
  // 所以取件池**不进版本库**（.gitignore），署名写在 docs/33 §4 —— 分享传染到网格，传染不到代码。
  {
    id: 'thigh.real.bone.a', slot: 'thigh', family: 'real.bone', ext: '.obj',
    license: '🟡 CC-BY-SA 2.1 JP · BodyParts3D / DBCLS · 需署名 + 注明改动 + 衍生件同样 BY-SA',
    url: `https://media.githubusercontent.com/media/olivercase/body_parts_3d_api/${BODYPARTS_SHA}/meshes/FJ3365_BP23346_FMA24474_Right%20femur.obj`,
    note: '右股骨。3102 tris，已经在预算内 —— 解剖数据天生就是单 mesh、无贴图，比 CAD 还合规',
  },
  {
    id: 'spine.real.bone.a', slot: 'spine', family: 'real.bone', ext: '.obj',
    license: '🟡 CC-BY-SA 2.1 JP · BodyParts3D / DBCLS · 需署名 + 注明改动 + 衍生件同样 BY-SA',
    url: `https://media.githubusercontent.com/media/olivercase/body_parts_3d_api/${BODYPARTS_SHA}/meshes/FJ3152_BP23294_FMA16586_Right%20hip%20bone.obj`,
    note: '右髋骨。BodyParts3D 没有整块颅骨也没有整副胸廓 —— 它按 FMA 本体拆到单骨，这对我们正好',
  },
  {
    id: 'thigh.real.nih.a', slot: 'thigh', family: 'real.nih', ext: '.stl',
    // CC0：署名都不要求。整份调研里授权最干净的一件解剖网格。
    license: '✅ CC0 / 公有领域 · NIH 3D · entry 3DPX-000168',
    url: 'https://3d.nih.gov/api/submissions/162/runs/4e6c5ffb-a687-4992-ac61-198998d7fbcf/output-files/1333',
    note: '人股骨，34k tris 的扫描件。留着它是为了压测减面那一段：CAD 是硬表面，扫描件不是',
  },
];

// ══ 入库：按物种整体换（docs/26 §H 的策展决定）═════════════════════════════
//
// 上面那张 SOURCES 是**探路**用的取件池：一个槽位取一件，不进版本库，只回答
// 「真实网格能不能过流水线」和「和生成件混在一起会不会打架」。答案是能、会。
//
// 下面这张 ADOPTED 是**入库**：三个物种各 10 个槽位，整具换成真实网格，产物进
// （`patrol` 有两具：Spot 是现在穿的那一具，ANYmal C 是被换下的那一具 ——
//  文件不删、表里也不删，排除写在 `curation.json` 里，理由见那一节的注释）
// `assets/parts/`。分界线是 docs/26 §H 那一句：**真实存在的机器用真实网格，
// 不存在的东西用生成件。** 混搭打的不是「真实 vs 生成」，是「硬表面 vs 软表面」——
// 所以不按槽位穿插，按物种整体换。
//
// 进了版本库就构成**再分发**，所以 docs/33 §4 那三项义务从这一刻起是真的：
// 原始 LICENSE 随件入库（`assets/parts/licenses/`）、逐件写清改了什么
// （`assets/parts/ATTRIBUTION.md`，本脚本生成）、BY-SA 的件一件都不要
// （BodyParts3D 那两件**故意**留在探路池里不入库 —— CC BY-SA 的衍生分发义务
// 不应与仓库的 Apache-2.0 原创代码权利边界混成一件说不清的东西）。

/**
 * 上游来源。一个物种一条，授权判定跟着仓库目录走而不是跟着物种走 ——
 * Menagerie 的关键事实是**每个机器人子目录带自己的 LICENSE**（docs/33 §2 A）。
 */
const ORIGINS = {
  'unitree_g1': {
    dir: 'unitree_g1',
    robot: 'Unitree G1',
    holder: 'HangZhou YuShu TECHNOLOGY CO.,LTD. ("Unitree Robotics")',
    license: 'BSD-3-Clause（Unitree 变体）',
    // BSD-3 第 3 条是**非背书条款**：描述性地说「这是 G1 的躯干几何」可以，
    // 暗示 Unitree 合作或赞助不行。/about 的署名段和这份注释是同一句话的两处落点。
    caveat: '非背书：不得以 Unitree 的名义为本作品背书',
  },
  'spot': {
    dir: 'boston_dynamics_spot',
    robot: 'Boston Dynamics Spot',
    // 描述包由 Clearpath Robotics 发布，BSD-3-Clause 原文在机器人子目录里。
    holder: 'Clearpath Robotics Inc.',
    license: 'BSD-3-Clause',
    caveat: '非背书：不得以 Boston Dynamics / Clearpath 的名义为本作品背书',
  },
  'anymal_c': {
    dir: 'anybotics_anymal_c',
    robot: 'ANYbotics ANYmal C',
    holder: 'ANYbotics AG',
    license: 'BSD-3-Clause',
    caveat: '非背书：不得以 ANYbotics 的名义为本作品背书',
  },
  'cassie': {
    dir: 'agility_cassie',
    robot: 'Agility Robotics Cassie',
    holder: 'Agility Robotics',
    license: 'MIT',
    caveat: '—',
  },
  'stretch3': {
    dir: 'hello_robot_stretch_3',
    robot: 'Hello Robot Stretch 3',
    holder: 'Hello Robot Inc.（Menagerie 子目录 LICENSE 为 Apache-2.0）',
    license: 'Apache-2.0',
    // §4(b)：再分发衍生件要注明改动 —— ATTRIBUTION.md「我们做了什么改动」那一节就是这句话的落点。
    // 子目录与仓库根都没有 NOTICE 文件（2026-09-14 在钉住的 SHA 上查过），§4(d) 不适用。
    caveat: '注明改动（Apache-2.0 §4(b)）；无 NOTICE 文件',
  },
  // ── Menagerie 之外：`meshRoot` / `licenseUrl` 显式给出，不从 `dir` 推 ──
  'atlas': {
    dir: 'atlas',
    meshRoot: `${RLG}/atlas/meshes`,
    licenseUrl: `${RLG}/atlas/LICENSE.TXT`,
    repo: `RobotLocomotion/models@${RLG_SHA.slice(0, 7)}`,
    robot: 'Boston Dynamics Atlas（DRC / v5 描述模型）',
    // 版权人**不是** Boston Dynamics。这份几何是 DRC 时代的描述模型，也不是 2025 年那台电动 Atlas
    // （docs/42 §3 保留意见、§7 第 5 条）。两件事都要写出来，不能含糊成「Atlas 的原厂几何」。
    holder: 'Robot Locomotion Group @ MIT CSAIL',
    license: 'BSD-3-Clause',
    caveat: '非背书（MIT 名义）；版权人非 Boston Dynamics；液压 DRC/v5 一代，非 2025 电动版',
  },
  'wl_p311d': {
    dir: 'wheellegged/WL_P311D',
    meshRoot: `${LIMX}/wheellegged/WL_P311D/meshes`,
    licenseUrl: `${LIMX}/LICENSE`,
    repo: `limxdynamics/tron1-robot-description@${LIMX_SHA.slice(0, 7)}`,
    robot: 'LimX Dynamics WL_P311D 轮足四足（代 W1）',
    holder: 'LimX Dynamics',
    license: 'Apache-2.0',
    // W1 本身没有描述文件（docs/42 §3）。和 Cassie 代 Digit 同类：同厂、同一个"腿末端是轮子"的拓扑。
    caveat: '代用件，不是 W1；注明改动（Apache-2.0 §4(b)）；无 NOTICE 文件；realsense_d435.stl 是第三方件，不取',
  },
};

const meshRootOf = (o) => o.meshRoot ?? `${MENAGERIE}/${o.dir}/assets`;
const licenseUrlOf = (o) => o.licenseUrl ?? `${MENAGERIE}/${o.dir}/LICENSE`;
const repoOf = (o) => o.repo ?? `mujoco_menagerie@${MENAGERIE_SHA.slice(0, 7)}`;
const displayDirOf = (o) => (o.meshRoot ? o.meshRoot.slice(o.meshRoot.indexOf(o.dir)) : `${o.dir}/assets`);

/**
 * **授权门，可执行的那一半。** 注释里的 ✅/🟡 是判定，这里是核对：
 * 取到的 LICENSE 原文必须**认得出**是 BSD-3 / Apache-2.0 / MIT 之一，
 * 而且必须和 ORIGINS 里声明的那一种一致。认不出 = 不取，不是「大概没事」（docs/42 §3）。
 * 为什么要核对"一致"：声明写 Apache、原文却是另一份，说明有人抄错了目录 ——
 * 那正是「记录说 Spot、身上穿 ANYmal」的同一类错。
 */
function licenseKind(text) {
  if (/Apache License\s+Version 2\.0/.test(text)) return 'Apache-2.0';
  if (/Permission is hereby granted, free of charge/.test(text)) return 'MIT';
  if (/Redistribution and use in source and binary forms/.test(text)
    && /Neither the name/.test(text) && !/advertising materials/i.test(text)) return 'BSD-3-Clause';
  return null;
}

/**
 * 槽位的对称性。和 `recipes/catalog.ts` 的 SLOTS 表逐字一致 ——
 * 成对槽位用 X 镜像复用右件，中轴件不镜像。抄在这里是因为取件走的是
 * `normalizeOne` 的覆盖项而不是 recipe（这些件没有配方，也不该有）。
 */
const SYM = {
  head: 'none', spine: 'none', joint: 'none',
  clavicle: 'mirror', upperArm: 'mirror', foreArm: 'mirror',
  hand: 'mirror', thigh: 'mirror', shin: 'mirror', foot: 'mirror',
};

/**
 * 挑件的原则是**剪影**（docs/18：辨识度住在整体剪影里），不是"把 link 搬全"。
 * G1 在 Menagerie 里有 51 个 link，我们只有 10 个槽位 —— 挑的是那些让人
 * 一眼认出"这是 G1"的件，不是那些解剖学上最对得上的件。
 *
 * **挑之前必须量 girth。** `head` / `spine` / `hand` / `foot` / `joint` 这五个槽位在运行时是
 * **uniform 缩放**（`core/attach.ts`：三轴同比例 = `SLOT_WIDTH/localGirth`，完全忽略骨长）。
 * 所以一件归一化后 girth = 0.167 的细长件放进 `foot`，会被整件放大 3.2 倍 ——
 * 得到的不是一只脚，是一根一米长的杆子（实测：ANYmal 的 `foot.obj` 就是这样，
 * 它把足和一段护套捆在一个文件里，长宽比 6:1）。这条和 `curation.json` 里
 * 「girth 0.43 = 槽位中位数的 0.43×」那几条剔件理由是同一件事，只是这次发生在真实件上。
 * 规矩：**uniform 的五个槽位，girth 必须落在槽位中位数的 0.7×–1.3× 之间**；
 * 四肢（stretch）只用 girth 定粗细，偏一点只是胖瘦，不会炸。
 *
 * `tier: 1` 而不是 docs/33 建议的 2：tier 是**最低出现阶段**（docs/03 §3.2）。
 * 这三个物种的 Rodin 件全部退役之后，真实件是它们**仅有的**件 ——
 * 给 tier 2 等于让这三个物种在 tier 1 整个消失（`themeIsUsable` 返回 false），
 * 或者沿 base 链退回 porcelain，那正是本次要消灭的「按槽位穿插」。
 * 真实件不是细节升级，它就是这个物种本身。
 */
const ADOPTED = [
  // ── compact = Unitree G1 ──────────────────────────────────────────────────
  // docs/33 §8 第 2 问点名它：参考图一直没找到（docs/31 标 ❌），真 CAD 直接绕过
  // 整个参考图问题；人形拓扑与槽位 1:1；`bodyPlan` 还是 'stub'，沉没成本接近零。
  { id: 'spine.compact.real',    slot: 'spine',    family: 'compact', origin: 'unitree_g1', asset: 'torso_link_rev_1_0.STL',  why: '躯干。剪影里最先被认出来的一块；也是生成件最容易编错比例的一块' },
  { id: 'head.compact.real',     slot: 'head',     family: 'compact', origin: 'unitree_g1', asset: 'head_link.STL',           why: '头。roster 说 compact 的"头不是脸，是一个黑色 sensor pod" —— G1 的头正是那个 pod' },
  { id: 'clavicle.compact.real', slot: 'clavicle', family: 'compact', origin: 'unitree_g1', asset: 'left_shoulder_pitch_link.STL', why: '肩座。四肢从躯干伸出去的那一节' },
  { id: 'upperArm.compact.real', slot: 'upperArm', family: 'compact', origin: 'unitree_g1', asset: 'left_shoulder_yaw_link.STL',   why: '上臂。G1 的上臂就是 shoulder_yaw 这一节连杆' },
  { id: 'foreArm.compact.real',  slot: 'foreArm',  family: 'compact', origin: 'unitree_g1', asset: 'left_elbow_link.STL',     why: '前臂' },
  { id: 'hand.compact.real',     slot: 'hand',     family: 'compact', origin: 'unitree_g1', asset: 'left_rubber_hand.STL',    why: '手。标配的三指橡胶手 —— 连指手套一样的剪影，比灵巧手更"是 G1"' },
  { id: 'thigh.compact.real',    slot: 'thigh',    family: 'compact', origin: 'unitree_g1', asset: 'left_hip_yaw_link.STL',   why: '大腿。髋 yaw 到膝之间那一节' },
  { id: 'shin.compact.real',     slot: 'shin',     family: 'compact', origin: 'unitree_g1', asset: 'left_knee_link.STL',      why: '小腿。探路池验过的那一件' },
  { id: 'foot.compact.real',     slot: 'foot',     family: 'compact', origin: 'unitree_g1', asset: 'left_ankle_roll_link.STL', why: '脚掌' },
  // joint 是 uniform 槽位，中位数 0.993。shoulder_roll 的鼓（0.594）虽然更"像关节"，
  // 放进去会被放大 1.7 倍，18 个关节全变成大鼓，整具身体被关节吃掉。ankle_pitch 的叉形
  // 关节块 girth 0.961，几乎正好 —— 而且它本来就是一个关节。
  { id: 'joint.compact.real',    slot: 'joint',    family: 'compact', origin: 'unitree_g1', asset: 'left_ankle_pitch_link.STL', why: '关节。踝 pitch 的叉形关节块，girth 0.961 ≈ 槽位中位数 0.993' },

  // ── patrol = Boston Dynamics Spot ────────────────────────────────────────
  // 记录一直写着 Spot（docs/31 §1 第 7 行，tagline「一个不该直立的东西直立了」
  // 说的也是那台唯一被普通人见过的机器狗），身上穿的却是 ANYmal C。
  // 换掉 ANYmal 的那句理由 ——「Spot 只给了腿」—— 在钉住的 SHA 上是**假的**：
  // `boston_dynamics_spot/assets/` 有 54 个文件，机身、四条腿各三节、外加一整条
  // 机械臂（sh0 → el → wr → fngr）。两个说法互相抵消时，去看实物再改记录，
  // 不要改记录去迁就实物（docs/42 §0 第二条、§7 第 2 条）。
  { id: 'spine.patrol.spot',    slot: 'spine',    family: 'patrol', origin: 'spot', asset: 'front_left_hip.obj',           why: '机身髋座。**不是 `body_0.obj`**：那块机身实测 0.857×0.234×0.192 m，归一化后 girth 0.273 = spine 中位数 0.842 的 0.32×，而 spine 是 uniform 槽位（SLOT_WIDTH/localGirth），放进去会被撑成一块 1.6 m 长的板子。髋座 girth 0.707 ≈ 0.84×，是这台机器上最大的一块合身的壳' },
  { id: 'head.patrol.spot',     slot: 'head',     family: 'patrol', origin: 'spot', asset: 'arm_link_wr1.obj',             why: '头。腕节 —— Spot 唯一带相机的那一块，也是这台机器唯一能被叫做"脸"的地方；girth 0.915 ≈ head 中位数 0.941' },
  { id: 'clavicle.patrol.spot', slot: 'clavicle', family: 'patrol', origin: 'spot', asset: 'arm_link_sh0.obj',             why: '肩座。机械臂从机身伸出去的那一节' },
  { id: 'upperArm.patrol.spot', slot: 'upperArm', family: 'patrol', origin: 'spot', asset: 'front_left_upper_leg_1.obj',   why: '前腿上节。真机四条腿同形，前腿当上肢' },
  { id: 'foreArm.patrol.spot',  slot: 'foreArm',  family: 'patrol', origin: 'spot', asset: 'front_left_lower_leg.obj',     why: '前腿下节' },
  // Spot 和 ANYmal 的差别正在这里：它**真的有手**（可选机械臂的夹爪），
  // 所以 hand / joint 不再需要拿执行器和雷达去代。
  { id: 'hand.patrol.spot',     slot: 'hand',     family: 'patrol', origin: 'spot', asset: 'arm_link_fngr_0.obj',          why: '手。夹爪的指节 —— 这台机器真的有手；girth 0.668 ≈ hand 中位数 0.624' },
  { id: 'thigh.patrol.spot',    slot: 'thigh',    family: 'patrol', origin: 'spot', asset: 'rear_left_upper_leg_1.obj',    why: '后腿上节' },
  { id: 'shin.patrol.spot',     slot: 'shin',     family: 'patrol', origin: 'spot', asset: 'rear_left_lower_leg.obj',      why: '后腿下节' },
  { id: 'foot.patrol.spot',     slot: 'foot',     family: 'patrol', origin: 'spot', asset: 'front_jaw.obj',                why: '足垫。Spot 的脚是腿末端的一个橡胶球，没有单独的网格；取夹爪前颚那一片扁板当平底的脚 —— 这是挑，不是编（和 ANYmal 那次取检修盖板同一类决定）' },
  { id: 'joint.patrol.spot',    slot: 'joint',    family: 'patrol', origin: 'spot', asset: 'arm_link_wr0.obj',             why: '关节。腕 roll 关节块，girth 0.927 ≈ joint 中位数 0.991 —— 它本来就是一个关节' },

  // ── patrol 的上一具：ANYmal C。**文件一件不删，索引也不摘。** ─────────────
  // 它们仍然由这张表生成（`--adopt` 重跑一次结果一样），排除发生在 `curation.json`：
  // 那十条 reject 的 note 写着为什么。curation 的规矩第 2 条就是"不进候选池，但文件不删 ——
  // 判断可能会变"，而这正是一个可能会变的判断：哪天 ANYmal 自己成为一个条目，它们原地复活。
  { id: 'spine.patrol.real',    slot: 'spine',    family: 'patrol', origin: 'anymal_c', asset: 'top_shell.obj', why: '（已被 Spot 换下）机身上壳' },
  { id: 'head.patrol.real',     slot: 'head',     family: 'patrol', origin: 'anymal_c', asset: 'face.obj',      why: '（已被 Spot 换下）前脸传感器面板' },
  { id: 'clavicle.patrol.real', slot: 'clavicle', family: 'patrol', origin: 'anymal_c', asset: 'hip_l.obj',     why: '（已被 Spot 换下）髋座' },
  { id: 'upperArm.patrol.real', slot: 'upperArm', family: 'patrol', origin: 'anymal_c', asset: 'thigh.obj',     why: '（已被 Spot 换下）前腿上节' },
  { id: 'foreArm.patrol.real',  slot: 'foreArm',  family: 'patrol', origin: 'anymal_c', asset: 'shank_r.obj',   why: '（已被 Spot 换下）前腿下节' },
  { id: 'hand.patrol.real',     slot: 'hand',     family: 'patrol', origin: 'anymal_c', asset: 'drive.obj',     why: '（已被 Spot 换下）ANYdrive 执行器代前肢末端 —— 那台机器没有手' },
  { id: 'thigh.patrol.real',    slot: 'thigh',    family: 'patrol', origin: 'anymal_c', asset: 'thigh.obj',     why: '（已被 Spot 换下）后腿上节' },
  { id: 'shin.patrol.real',     slot: 'shin',     family: 'patrol', origin: 'anymal_c', asset: 'shank_l.obj',   why: '（已被 Spot 换下）后腿下节' },
  { id: 'foot.patrol.real',     slot: 'foot',     family: 'patrol', origin: 'anymal_c', asset: 'hatch.obj',     why: '（已被 Spot 换下）机腹检修盖板代足垫' },
  { id: 'joint.patrol.real',    slot: 'joint',    family: 'patrol', origin: 'anymal_c', asset: 'lidar.obj',     why: '（已被 Spot 换下）顶上那颗旋转激光雷达' },

  // ── digitigrade = Cassie ─────────────────────────────────────────────────
  // docs/33 §6：Digit 本身没有可用授权，Cassie 是同厂同拓扑的鸟腿且是 MIT。
  // 用 Cassie 代 Digit 不是退而求其次 —— 反关节鸟腿这个主张，Cassie 表达得更纯粹
  // （它连躯干和手臂都没有，只剩那对腿）。
  { id: 'spine.digitigrade.real',    slot: 'spine',    family: 'digitigrade', origin: 'cassie', asset: 'pelvis.obj',     why: '骨盆。Cassie 的"躯干"就是这一块，两条腿直接挂上去' },
  // Cassie 真的没有头。不拿别的机器人的头来凑（那就是穿插），而是用髋 yaw 的执行器罩
  // 当 sensor pod —— 同一台机器上的几何，同一种加工语言。这是挑，不是编。
  { id: 'head.digitigrade.real',     slot: 'head',     family: 'digitigrade', origin: 'cassie', asset: 'hip-yaw.obj',    why: '头（代）。Cassie 无头，用同机的髋 yaw 执行器罩当 sensor pod' },
  { id: 'clavicle.digitigrade.real', slot: 'clavicle', family: 'digitigrade', origin: 'cassie', asset: 'knee-spring.obj', why: '肩座（代膝弹簧板）。girth 0.542 ≈ clavicle 中位数 0.548' },
  { id: 'upperArm.digitigrade.real', slot: 'upperArm', family: 'digitigrade', origin: 'cassie', asset: 'hip-pitch.obj',  why: '上臂（代髋 pitch 壳）' },
  { id: 'foreArm.digitigrade.real',  slot: 'foreArm',  family: 'digitigrade', origin: 'cassie', asset: 'tarsus.obj',     why: '前臂。跗骨连杆，细长、两端轴承座 —— 探路池验过它当前臂比当小腿更像' },
  { id: 'hand.digitigrade.real',     slot: 'hand',     family: 'digitigrade', origin: 'cassie', asset: 'foot-crank.obj', why: '手（代足曲柄）。girth 0.530 ≈ hand 中位数 0.624' },
  { id: 'thigh.digitigrade.real',    slot: 'thigh',    family: 'digitigrade', origin: 'cassie', asset: 'knee.obj',       why: '大腿。膝壳连着大腿，反关节的那个折点就在这里' },
  { id: 'shin.digitigrade.real',     slot: 'shin',     family: 'digitigrade', origin: 'cassie', asset: 'shin.obj',       why: '小腿。真机就叫 shin；girth 0.208 —— 鸟腿的细全在这一件上' },
  { id: 'foot.digitigrade.real',     slot: 'foot',     family: 'digitigrade', origin: 'cassie', asset: 'foot.obj',       why: '脚。一片着地的刀，没有脚掌 —— 鸟腿的读法全在这里' },
  // heel-spring（girth 0.401）当关节会被放大 2.5 倍，18 个关节全变成大平板（截过图）。
  // hip-roll 的壳 0.929 ≈ 槽位中位数 0.993，是这台机器上唯一接近各向同性的件。
  { id: 'joint.digitigrade.real',    slot: 'joint',    family: 'digitigrade', origin: 'cassie', asset: 'hip-roll.obj',   why: '关节。髋 roll 壳，girth 0.929 ≈ joint 中位数 0.993' },

  // ── athlete = Atlas（DRC / v5 描述模型）──────────────────────────────────
  // 2026-09-14 取件。girth 是规范化之后当场量的，中位数取当时 parts.json 的值。
  // 版权人是 MIT CSAIL 不是 Boston Dynamics；液压那一代不是电动版 —— 写在 ORIGINS.caveat 与 machine.note。
  { id: 'spine.athlete.atlas',    slot: 'spine',    family: 'athlete', origin: 'atlas', asset: 'utorso.gltf', why: '上躯干。Atlas 那副背着液压泵的宽胸 —— 剪影里最先被认出来的一块；girth 0.726 ≈ spine 中位数 0.842 的 0.86×' },
  { id: 'head.athlete.atlas',     slot: 'head',     family: 'athlete', origin: 'atlas', asset: 'head.gltf',   why: '头。MultiSense 传感器头，没有脸；girth 0.751 ≈ head 中位数的 0.80×' },
  { id: 'clavicle.athlete.atlas', slot: 'clavicle', family: 'athlete', origin: 'atlas', asset: 'r_clav.gltf', why: '锁骨连杆。真机就叫 clav' },
  { id: 'upperArm.athlete.atlas', slot: 'upperArm', family: 'athlete', origin: 'atlas', asset: 'r_uarm.gltf', why: '上臂' },
  { id: 'foreArm.athlete.atlas',  slot: 'foreArm',  family: 'athlete', origin: 'atlas', asset: 'r_farm.gltf', why: '前臂' },
  { id: 'hand.athlete.atlas',     slot: 'hand',     family: 'athlete', origin: 'atlas', asset: 'r_hand.gltf', why: '手（腕法兰端）；girth 0.658 ≈ hand 中位数的 1.05×' },
  { id: 'thigh.athlete.atlas',    slot: 'thigh',    family: 'athlete', origin: 'atlas', asset: 'r_uleg.gltf', why: '大腿' },
  { id: 'shin.athlete.atlas',     slot: 'shin',     family: 'athlete', origin: 'atlas', asset: 'r_lleg.gltf', why: '小腿' },
  { id: 'foot.athlete.atlas',     slot: 'foot',     family: 'athlete', origin: 'atlas', asset: 'r_foot.gltf', why: '脚' },
  { id: 'joint.athlete.atlas',    slot: 'joint',    family: 'athlete', origin: 'atlas', asset: 'r_talus.gltf', why: '关节。踝的万向节块 —— 它本来就是一个关节；girth 1.000 ≈ joint 中位数的 1.01×' },

  // ── wheelleg = LimX WL_P311D（代 W1）──────────────────────────────────────
  // 只有五种网格（机身 / 髋 / 大腿 / 小腿 / 轮），十个槽位在同一台机器上挑，不去别的机器借（docs/26 §H）。
  // 前后腿用不同文件（LF / LH），和 Spot 那次一样。
  { id: 'spine.wheelleg.limx',    slot: 'spine',    family: 'wheelleg', origin: 'wl_p311d', asset: 'base_link.STL', why: '机身。girth 0.588 ≈ spine 中位数的 0.70×，贴着 §H 带的下沿 —— 选它而不是髋座，是因为这台机器的剪影就是一块扁机身挂四条轮腿' },
  { id: 'head.wheelleg.limx',     slot: 'head',     family: 'wheelleg', origin: 'wl_p311d', asset: 'LF_hip.STL',    why: '头（代）。这台机器没有头，用前左髋 HAA 执行器座当 sensor pod；girth 0.848 ≈ head 中位数的 0.90×' },
  { id: 'clavicle.wheelleg.limx', slot: 'clavicle', family: 'wheelleg', origin: 'wl_p311d', asset: 'RF_hip.STL',    why: '肩座。前右髋座 —— 腿从机身伸出去的那一节' },
  { id: 'upperArm.wheelleg.limx', slot: 'upperArm', family: 'wheelleg', origin: 'wl_p311d', asset: 'LF_thigh.STL',  why: '前腿大腿' },
  // maxTris：交接那一帧 foreArmL 替换 + foreArmR 交叉淡入同时在画，两件 ~5000 面让描边后到 250,840（swap-budget.test.ts）
  { id: 'foreArm.wheelleg.limx',  slot: 'foreArm',  family: 'wheelleg', origin: 'wl_p311d', asset: 'LF_calf.STL',   maxTris: 4000, why: '前腿小腿' },
  { id: 'hand.wheelleg.limx',     slot: 'hand',     family: 'wheelleg', origin: 'wl_p311d', asset: 'LF_wheel.STL',  why: '前轮。四足里前腿的末端就是手 —— 这台机器的手是轮子。girth 0.999 超出 hand 带（≈1.6×），只给自己用、不外借' },
  { id: 'thigh.wheelleg.limx',    slot: 'thigh',    family: 'wheelleg', origin: 'wl_p311d', asset: 'LH_thigh.STL',  why: '后腿大腿' },
  { id: 'shin.wheelleg.limx',     slot: 'shin',     family: 'wheelleg', origin: 'wl_p311d', asset: 'LH_calf.STL',   why: '后腿小腿' },
  { id: 'foot.wheelleg.limx',     slot: 'foot',     family: 'wheelleg', origin: 'wl_p311d', asset: 'LH_wheel.STL',  why: '后轮。**这一格就是 docs/42 说这条线上真正缺的那个轮子**' },
  // maxTris：joint 一具身体里有 14 个实例。每件 4984 面时整具 149,448 面，描边翻倍 298,896 > BUDGET.maxTriangles
  // 250,000（outline-budget.test.ts 当场红）。压到 1500 面，整具回到其它物种的量级。
  { id: 'joint.wheelleg.limx',    slot: 'joint',    family: 'wheelleg', origin: 'wl_p311d', asset: 'RH_hip.STL', maxTris: 1500, why: '关节。后右髋 HAA 执行器座；girth 0.847 ≈ joint 中位数的 0.86×。轮子当关节会让 18 个关节全变成轮子，读不出哪里在滚' },

  // ── manipulator = Hello Robot Stretch 3 ─────────────────────────────────
  // 身体方案是 column：两条腿的六节串成桅杆，手臂是顶端的分支（core/bodyplan.ts）。
  // 一个 link 在 Menagerie 里按材质拆成几份 OBJ，按 stretch.xml 的 visual geom 整个取。
  // 不取的：base_link_8（22 MB）、link_head_0（11.5 MB）—— docs/42 §4 已经说过避开它们。
  { id: 'spine.manipulator.stretch', slot: 'spine', family: 'manipulator', origin: 'stretch3',
    asset: ['link_lift_0.obj', 'link_lift_2.obj', 'link_lift_3.obj', 'link_lift_4.obj', 'link_lift_5.obj', 'link_lift_6.obj', 'link_lift_7.obj', 'link_lift_8.obj', 'link_lift_9.obj'],
    why: '升降滑架。套在桅杆上、伸出手臂的那一块 —— column 方案里躯干就在桅杆顶上；girth 0.745 ≈ spine 中位数的 0.88×' },
  { id: 'head.manipulator.stretch', slot: 'head', family: 'manipulator', origin: 'stretch3',
    asset: ['link_head_1.obj', 'link_head_2.obj', 'link_head_3.obj', 'link_head_4.obj', 'link_head_5.obj', 'link_head_6.obj', 'link_head_7.obj', 'link_head_8.obj', 'link_head_9.obj', 'link_head_10.obj', 'link_head_11.obj'],
    why: '头。桅杆顶上那个装相机的头罩（不含 11.5 MB 的 link_head_0）；girth 0.694 ≈ head 中位数的 0.74×' },
  { id: 'clavicle.manipulator.stretch', slot: 'clavicle', family: 'manipulator', origin: 'stretch3',
    asset: ['link_arm_l0_0.obj', 'link_arm_l0_1.obj', 'link_arm_l0_2.obj'], why: '伸缩臂最内一节，连着滑架' },
  { id: 'upperArm.manipulator.stretch', slot: 'upperArm', family: 'manipulator', origin: 'stretch3',
    asset: ['link_arm_l4_0.obj', 'link_arm_l4_1.obj'], why: '伸缩臂外套管' },
  { id: 'foreArm.manipulator.stretch', slot: 'foreArm', family: 'manipulator', origin: 'stretch3',
    asset: ['link_arm_l1_0.obj', 'link_arm_l1_1.obj'], why: '伸缩臂内套管 —— 比上一节细，套筒一节套一节的读法在这里' },
  { id: 'hand.manipulator.stretch', slot: 'hand', family: 'manipulator', origin: 'stretch3',
    asset: 'link_SG3_gripper_body.obj', why: '夹爪本体。girth 0.748 超出 hand 带（≈1.2×），只给自己用、不外借' },
  { id: 'thigh.manipulator.stretch', slot: 'thigh', family: 'manipulator', origin: 'stretch3',
    asset: 'link_mast.obj', why: '桅杆。column 方案里腿骨串成桅杆，而这台机器真的只有一根桅杆' },
  { id: 'shin.manipulator.stretch', slot: 'shin', family: 'manipulator', origin: 'stretch3',
    asset: 'link_mast.obj', why: '桅杆（同一件）。桅杆是一根铝型材，拆两节是拓扑要求，不是机器的' },
  { id: 'foot.manipulator.stretch', slot: 'foot', family: 'manipulator', origin: 'stretch3',
    asset: ['base_link_0.obj', 'base_link_2.obj', 'base_link_3.obj', 'base_link_4.obj', 'base_link_5.obj', 'base_link_6.obj', 'base_link_7.obj'],
    why: '底盘（不含 22 MB 的 base_link_8）。桅杆底端落在它上面 —— 轮式底盘就是这个物种的脚' },
  // maxTris：同 wheelleg 那一条 —— 14 个实例 × 4998 面让整具描边后到 239,294，离 250,000 只剩 4%。
  { id: 'joint.manipulator.stretch', slot: 'joint', family: 'manipulator', origin: 'stretch3', maxTris: 1500,
    asset: ['link_wrist_yaw.obj', 'link_DW3_wrist_yaw_bottom.stl'], why: '关节。腕 yaw 关节 —— 它本来就是一个关节；girth 0.815 ≈ joint 中位数的 0.82×' },
];

/** 一个 link 可以是几份文件（Menagerie 按材质拆 OBJ），`asset` 因此可以是数组 */
const assetsOf = (a) => [a.asset].flat();
const adoptedUrls = (a) => assetsOf(a).map((f) => `${meshRootOf(ORIGINS[a.origin])}/${f}`);
/** 写进 `source.model`。以来源根开头，`check:parts` 拿它比 `machine.source` */
const adoptedUrl = (a) => adoptedUrls(a).join(' + ');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const only = args.find((a) => a.startsWith('--only='))?.slice(7);
const picked = SOURCES.filter((s) => !only || s.id === only);

if (has('--list')) {
  for (const s of SOURCES) console.log(`${s.id.padEnd(24)} ${s.license}\n${' '.repeat(25)}${s.url}\n${' '.repeat(25)}${s.note}\n`);
  console.log('── 入库件（--adopt）─────────────────────────────');
  for (const a of ADOPTED) console.log(`${a.id.padEnd(28)} ${ORIGINS[a.origin].license.padEnd(24)} ${assetsOf(a).join(' + ')}`);
  process.exit(0);
}

if (has('--adopt')) process.exit(await adopt());

async function download(src) {
  // NIH 3D 的下载地址没有扩展名（/output-files/1333），所以来源可以显式声明 `ext`。
  const ext = src.ext ?? src.url.slice(src.url.lastIndexOf('.')).toLowerCase();
  const path = resolve(HARVEST, src.id + ext);
  if (existsSync(path)) return path;                     // 幂等：取过就不再取，别白占别人带宽
  const r = await fetch(src.url);
  if (!r.ok) throw new Error(`${r.status} ${src.url}`);
  mkdirSync(HARVEST, { recursive: true });
  writeFileSync(path, Buffer.from(await r.arrayBuffer()));
  return path;
}

/**
 * 入库件的下载：几份文件逐个取；`.gltf` 连同它外挂的 `.bin` 一起取，
 * 并把 buffer 的 uri 改写成本地文件名（原料按件 id 命名，上游的 `r_hand.bin` 会撞名）。
 * 贴图不取 —— `readGltfGeometry` 读之前就把贴图引用摘掉了。
 */
async function downloadAdopted(a) {
  const urls = adoptedUrls(a);
  const out = [];
  for (let i = 0; i < urls.length; i++) {
    const id = urls.length > 1 ? `${a.id}.${i}` : a.id;
    const path = await download({ id, url: urls[i] });
    if (path.endsWith('.gltf')) {
      const json = JSON.parse(readFileSync(path, 'utf8'));
      for (const [k, b] of (json.buffers ?? []).entries()) {
        if (!b.uri || b.uri.startsWith('data:')) continue;
        const local = `${id}.${k}.bin`;
        if (b.uri !== local) {
          await download({ id: `${id}.${k}`, url: urls[i].replace(/[^/]*$/, b.uri), ext: '.bin' });
          b.uri = local;
        }
      }
      writeFileSync(path, JSON.stringify(json));
    }
    out.push(path);
  }
  return out.length === 1 ? out[0] : out;
}

/** 验收：用和 check:parts 同一套数字，对取件池独立跑一遍。 */
async function verify() {
  const { glbStats } = await import(resolve(ROOT, 'packages/factory/src/glb-stats.ts'));
  const idxPath = resolve(OUT, '_harvest.json');
  if (!existsSync(idxPath)) { console.log('还没有产物，先跑一次不带 --verify 的取件'); return 1; }
  const metas = JSON.parse(readFileSync(idxPath, 'utf8'));
  const errs = [], warns = [];
  for (const m of metas) {
    const f = resolve(OUT, `${m.id}.glb`);
    if (!existsSync(f)) { errs.push(`${m.id}: 文件缺失`); continue; }
    const s = glbStats(f);
    if (Math.abs(s.size[1] - 1) > EPS) errs.push(`${m.id}: 长度 ${s.size[1].toFixed(4)} ≠ 1.0`);
    if (Math.abs(s.min[1]) > EPS) errs.push(`${m.id}: socketA 不在原点 y=${s.min[1].toFixed(4)}`);
    if (s.triangles > MAX_TRIS) errs.push(`${m.id}: ${s.triangles} tris > ${MAX_TRIS}`);
    if (s.bytes > MAX_BYTES) errs.push(`${m.id}: ${(s.bytes / 1e6).toFixed(1)} MB 超预算`);
    if (s.hasAnimation || s.hasSkin) errs.push(`${m.id}: 含动画/骨骼`);
    if (s.meshes !== 1) warns.push(`${m.id}: ${s.meshes} 个 mesh`);
    if (s.images > 0) warns.push(`${m.id}: 仍带 ${s.images} 张贴图`);
    if (Math.abs((s.min[0] + s.max[0]) / 2) > EPS * 5) warns.push(`${m.id}: X 未居中`);
    console.log(`  ${errs.length ? ' ' : '✓'} ${m.id.padEnd(24)} ${String(s.triangles).padStart(5)} tris  ` +
      `girth=${m.localGirth.toFixed(3)}  len=${s.size[1].toFixed(5)}  y0=${s.min[1].toFixed(5)}  ${(s.bytes / 1024).toFixed(0)}KB`);
  }
  for (const w of warns) console.warn('  ⚠ ' + w);
  for (const e of errs) console.error('  ✗ ' + e);
  console.log(`\n取件池契约检查 — ${metas.length} 件, ${errs.length} 错, ${warns.length} 警告`);
  return errs.length ? 1 : 0;
}

if (has('--verify')) process.exit(await verify());

const { normalizeOne } = await import(resolve(ROOT, 'packages/factory/src/normalize.ts'));
const metas = [];
for (const src of picked) {
  try {
    const raw = await download(src);
    const { meta, warnings, orient } = await normalizeOne(src.id, raw, {
      outDir: OUT,
      file: `harvest/${src.id}.glb`,      // 运行时按 `/parts/` + file 取件
      slot: src.slot,
      tier: 2,                            // 真机几何是机械化/关节化的，按 docs/03 §3.2 归 tier 2
      family: src.family,
      symmetry: 'mirror',
      source: { provider: 'harvest', model: src.url, recipeId: src.id },
    });
    metas.push(meta);
    console.log(`  ✓ ${src.id.padEnd(24)} ${String(meta.triCount).padStart(5)} tris  girth=${meta.localGirth.toFixed(3)}  ${orient}` +
      (warnings.length ? `\n      ⚠ ${warnings.join('; ')}` : ''));
  } catch (e) {
    console.error(`  ✗ ${src.id}: ${e.message}`);
  }
}

// 和 normalizeAll 一样：定向取件（--only）必须合并进已有索引，不能整个重写。
const idxPath = resolve(OUT, '_harvest.json');
let merged = metas;
if (only && existsSync(idxPath)) {
  const byId = new Map(JSON.parse(readFileSync(idxPath, 'utf8')).map((m) => [m.id, m]));
  for (const m of metas) byId.set(m.id, m);
  merged = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
mkdirSync(OUT, { recursive: true });
writeFileSync(idxPath, JSON.stringify(merged, null, 2));
console.log(`\n取件 ${metas.length} 件；索引共 ${merged.length} 件 → assets/parts/harvest/`);

writeMixedIndex(merged);
console.log(`混合索引 → /dev/figure.html?parts=/parts/harvest/&theme=real.g1\n`);
process.exit(await verify());

/**
 * 写一份**混合索引**：192 件 Rodin 生成件 + 取件池，放进同一个 PartLibrary。
 *
 * 为什么要这个：验收问的是「真实网格和生成件放在同一具身体上会不会打架」。
 * 这个问题只能看出来，不能想出来 —— 所以必须真的拼一具。
 *
 * 为什么不直接改 `assets/parts/parts.json`：那个文件由别的线在动（AGENTS.md：不碰）。
 * 这里另写一份，`file` 指回 `../`，同一批 glb 不复制第二遍。
 *
 * 混合是靠 genome 的 `base` 回退链实现的（core/genome.ts 的 baseChain）：
 * `real.g1` 这个 theme 只有 shin 和 spine 两个槽位有件，其余槽位自动回退到
 * `base: 'compact'` 的 Rodin 件。于是一具身体里两种来源**天然**并存。
 */
function writeMixedIndex(harvestMetas) {
  const basePath = resolve(ROOT, 'assets/parts/parts.json');
  if (!existsSync(basePath)) { console.warn('没有 assets/parts/parts.json，跳过混合索引'); return; }
  const base = JSON.parse(readFileSync(basePath, 'utf8'));

  // 每个真实来源挂到 docs/31 对表里那个对应的 archetype 上。
  // 挂错了这具身体就没有意义：Cassie 的腿必须落在鸟腿人身上，不是落在瓷上。
  // 解剖骨骼挂到 xeno 上：那是 roster 里唯一一条生物机械的线（docs/31 §3）。
  const BASE_OF = { 'real.g1': 'compact', 'real.spot': 'patrol', 'real.anymal': 'patrol',
                    'real.cassie': 'digitigrade', 'real.bone': 'xeno', 'real.nih': 'xeno' };
  const themes = [...base.themes];
  for (const [fam, baseId] of Object.entries(BASE_OF)) {
    if (!harvestMetas.some((m) => m.family === fam)) continue;
    const b = base.themes.find((t) => t.id === baseId);
    themes.push({
      ...(b ?? {}), id: fam, base: baseId, kind: 'archetype', source: 'harvest',
      name: `真实·${fam.split('.')[1]}`, nameEn: `Real ${fam.split('.')[1]}`,
      tagline: '这是那台机器真正的几何', taglineEn: 'The actual geometry of the actual machine',
    });
  }

  writeFileSync(resolve(OUT, 'parts.json'), JSON.stringify({
    ...base,
    generatedAt: new Date().toISOString(),
    themes,
    parts: [
      ...base.parts.map((p) => ({ ...p, file: `../${p.file}` })),   // 同一批 glb，不复制第二份
      ...harvestMetas.map((m) => ({ ...m, file: `${m.id}.glb` })),
    ],
  }, null, 2));
}

// ══ 入库流程（--adopt）═════════════════════════════════════════════════════
/**
 * 和上面那条探路流程的差别只有一个：**产物落到 `assets/parts/`，进版本库。**
 * 这一步就是再分发，所以它同时负责把 docs/33 §4 的三项义务做掉：
 * 原始 LICENSE 随件入库、`ATTRIBUTION.md` 逐件可追溯、BY-SA 的件一件不取。
 *
 * 幂等：重跑一次结果一样（下载有缓存，规范化是纯函数，索引按 id 合并）。
 */
async function adopt() {
  const { normalizeOne } = await import(resolve(ROOT, 'packages/factory/src/normalize.ts'));
  const { buildIndex } = await import(resolve(ROOT, 'packages/factory/src/index-parts.ts'));
  const PARTS = resolve(ROOT, 'assets/parts');
  const LICENSES = resolve(PARTS, 'licenses');

  // 1) 原始 LICENSE 原文随件入库（docs/33 §4 第 1 条）。
  //    BSD-3 的第 1/2 条要求再分发时保留版权声明与免责声明 —— 保留的方式就是把原文放在这里。
  //    `--family=a,b`：只取这几个物种。其余已入库件的 glb 一个字节不碰，索引按 id 合并。
  const families = args.find((x) => x.startsWith('--family='))?.slice(9).split(',');
  const todo = ADOPTED.filter((a) => !families || families.includes(a.family));
  const origins = new Set(todo.map((a) => a.origin));
  mkdirSync(LICENSES, { recursive: true });
  for (const [key, o] of Object.entries(ORIGINS)) {
    if (!origins.has(key)) continue;
    const path = resolve(LICENSES, `${key}.LICENSE.txt`);
    const url = licenseUrlOf(o);
    let text;
    if (existsSync(path)) text = readFileSync(path, 'utf8');
    else {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`取不到 ${o.robot} 的 LICENSE：${r.status} ${url}`);
      text = await r.text();
    }
    // 授权门：认不出、或者和声明的不是同一种 → 这台机器一件都不取
    const kind = licenseKind(text);
    if (!kind || !o.license.startsWith(kind)) {
      throw new Error(`${o.robot}: LICENSE 原文认作 ${kind ?? '（认不出）'}，声明是 ${o.license} —— 只收 BSD-3-Clause / Apache-2.0 / MIT 且必须一致（${url}）`);
    }
    if (!existsSync(path)) {
      writeFileSync(path, `# ${o.robot} · ${o.license}\n# 原文取自 ${url}\n\n${text}`);
      console.log(`  ✓ LICENSE  ${key}（${kind}）`);
    }
  }

  // 2) 逐件取 + 规范化，直接写进 assets/parts/
  const metas = [];
  for (const a of todo) {
    try {
      const raw = await downloadAdopted(a);
      const { meta, warnings } = await normalizeOne(a.id, raw, {
        outDir: PARTS,
        file: `${a.id}.glb`,
        slot: a.slot,
        tier: 1,                       // 见 ADOPTED 上方注释：真实件不是细节升级，它就是这个物种
        family: a.family,
        symmetry: SYM[a.slot],
        maxTris: a.maxTris,              // 缺省 = 单件预算；joint 这种一具身体十几个实例的槽位要压得更低
        source: { provider: 'harvest', model: adoptedUrl(a), recipeId: a.id },
      });
      metas.push(meta);
      console.log(`  ✓ ${a.id.padEnd(28)} ${String(meta.triCount).padStart(5)} tris  girth=${meta.localGirth.toFixed(3)}`
        + (warnings.length ? `\n      ⚠ ${warnings.join('; ')}` : ''));
    } catch (e) {
      console.error(`  ✗ ${a.id}: ${e.message}`);
      return 1;                        // 缺件比错件更难查：宁可整批失败，也不要半具身体悄悄入库
    }
  }

  // 3) 并进 _metas.json（parts.json 由 buildIndex 从它生成，那里执行"整具换"的规则）
  const metaPath = resolve(PARTS, '_metas.json');
  const byId = new Map(JSON.parse(readFileSync(metaPath, 'utf8')).map((m) => [m.id, m]));
  for (const m of metas) byId.set(m.id, m);
  writeFileSync(metaPath, JSON.stringify([...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), null, 2));

  // 4) 重出 parts.json
  await buildIndex();

  // 5) 署名（docs/33 §4 第 2 条）
  writeFileSync(resolve(PARTS, 'ATTRIBUTION.md'), attribution([...byId.values()]));
  console.log(`\n入库 ${metas.length} 件 → assets/parts/；署名 → assets/parts/ATTRIBUTION.md`);
  return 0;
}

/**
 * 逐件署名表。**生成的，不是手写的** —— 手写的署名会和 ADOPTED 分叉，
 * 而分叉的署名等于没有署名（和海报数字漂掉是同一类错）。
 */
function attribution(allMetas) {
  const retired = allMetas
    .filter((m) => ADOPTED.some((a) => a.family === m.family) && m.source?.provider !== 'harvest')
    .map((m) => m.id).sort();

  const rows = ADOPTED.map((a) => {
    const o = ORIGINS[a.origin];
    return `| \`${a.id}\` | ${o.robot} | ${assetsOf(a).map((f) => `\`${displayDirOf(o)}/${f}\``).join(' + ')} | ${o.license} | ${a.why} |`;
  }).join('\n');

  return `# 署名与许可 —— \`assets/parts/\` 里的真实网格

<!-- 由 \`node scripts/harvest.mjs --adopt\` 生成，不要手改。 -->

这些件不是生成的，是**真实存在的机器的原厂几何**。它们进了版本库，
所以这构成**再分发**，下面三件事必须同时成立（docs/33 §4）：

1. 每个来源的 LICENSE 原文在 [\`licenses/\`](./licenses/)，随件入库。
2. 下表逐件写清来源与改动。
3. CC-BY-SA 的源**一件都没有取**。BodyParts3D 的人体骨骼留在探路池里
   （\`assets/parts/harvest/\`，.gitignore），因为 BY-SA 的传染要求衍生件同样 BY-SA，
   和这个仓库 Apache-2.0 的原创代码权利边界混在一起。处理不了就不用 ——
   这是 docs/33 §4 第 3 条的落点。

## 来源钉死在 commit SHA

三个仓库，各钉一串 SHA：

- MuJoCo Menagerie **\`${MENAGERIE_SHA}\`**
- RobotLocomotion/models **\`${RLG_SHA}\`**
- limxdynamics/tron1-robot-description **\`${LIMX_SHA}\`**

指向分支的后果不是报错，是来源在脚下变，而 \`check:parts\` 照样 0 错。
重新取一遍：\`node scripts/harvest.mjs --adopt\`（只取某几个物种：\`--adopt --family=athlete,wheelleg\`）。

| 来源 | 仓库 | 版权 | 授权 | 附加条件 |
|---|---|---|---|---|
${Object.values(ORIGINS).map((o) => `| ${o.robot} | ${repoOf(o)} | ${o.holder} | ${o.license} | ${o.caveat} |`).join('\n')}

**非背书条款是真的。** 说「这是 G1 的躯干几何」是描述，可以；
暗示 Unitree / ANYbotics / Boston Dynamics / MIT / Hello Robot / LimX 与本作品有合作或赞助关系，不行。
本作品与上述任何公司或机构无关。**代用件就写代用**：\`wheelleg\` 身上是 WL_P311D 不是 W1，
\`digitigrade\` 身上是 Cassie 不是 Digit，\`athlete\` 身上是 DRC 那一代 Atlas 的描述模型。

## 我们做了什么改动

**每一件都改过**，改动对所有件是同一套（\`packages/factory/src/normalize.ts\`）：

1. 合并成单 mesh，烘掉节点变换；
2. **丢掉全部材质与贴图**（运行时统一套本仓库自己的材质）；
3. 超过 5000 三角形的做容差焊接 + 减面；
4. 把 OBB 最长边**转到 +Y**，粗端朝下；
5. 平移到「一端在原点」，**按长度归一到 1.0**，横向居中。

换句话说：几何被重新定向、重新缩放、简化过，颜色和材质全部丢弃。
这满足 Apache-2.0 §4(b) 的「注明改动」，也满足 BSD/MIT 的声明保留要求。

## 逐件

| 部件 id | 机器 | 上游文件 | 授权 | 为什么是这一件 |
|---|---|---|---|---|
${rows}

## 被换下来的生成件（${retired.length} 件）

这些物种原来的 Rodin 生成件**文件一件都没删**，还在 \`assets/parts/\` 里，
只是不再进 \`parts.json\`（规则在 \`packages/factory/src/index-parts.ts\`：
一个物种只要有一件真实网格，它的生成件就整批不进索引）。

它们不是坏件 —— 坏件在 \`curation.json\` 里，那是另一回事。
它们是被一个策展决定换下来的（docs/26 §H），而那个决定可能会变。

${retired.map((id) => `- \`${id}\``).join('\n')}

## 顺手引用

Menagerie 请求（非强制）引用：

\`\`\`bibtex
@software{menagerie2022github,
  author = {Zakka, Kevin and Tassa, Yuval and {MuJoCo Menagerie Contributors}},
  title = {{MuJoCo Menagerie: A collection of high-quality simulation models for MuJoCo}},
  url = {https://github.com/google-deepmind/mujoco_menagerie},
  year = {2022},
}
\`\`\`
`;
}
