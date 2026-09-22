# 署名与许可 —— `assets/parts/` 里的真实网格

<!-- 由 `node scripts/harvest.mjs --adopt` 生成，不要手改。 -->

这些件不是生成的，是**真实存在的机器的原厂几何**。它们进了版本库，
所以这构成**再分发**，下面三件事必须同时成立（docs/33 §4）：

1. 每个来源的 LICENSE 原文在 [`licenses/`](./licenses/)，随件入库。
2. 下表逐件写清来源与改动。
3. CC-BY-SA 的源**一件都没有取**。BodyParts3D 的人体骨骼留在探路池里
   （`assets/parts/harvest/`，.gitignore），因为 BY-SA 的传染要求衍生件同样 BY-SA，
   和这个仓库 Apache-2.0 的原创代码权利边界混在一起。处理不了就不用 ——
   这是 docs/33 §4 第 3 条的落点。

## 来源钉死在 commit SHA

三个仓库，各钉一串 SHA：

- MuJoCo Menagerie **`8161bba264d7fa7c99ca301e91e7fb44737676ad`**
- RobotLocomotion/models **`3bd1111011ea8c9813a66bf5cc21f31067f2e1ef`**
- limxdynamics/tron1-robot-description **`5b97add1f3b461c9ed26ff2ff2f5025cc6ee4316`**

指向分支的后果不是报错，是来源在脚下变，而 `check:parts` 照样 0 错。
重新取一遍：`node scripts/harvest.mjs --adopt`（只取某几个物种：`--adopt --family=athlete,wheelleg`）。

| 来源 | 仓库 | 版权 | 授权 | 附加条件 |
|---|---|---|---|---|
| Unitree G1 | mujoco_menagerie@8161bba | HangZhou YuShu TECHNOLOGY CO.,LTD. ("Unitree Robotics") | BSD-3-Clause（Unitree 变体） | 非背书：不得以 Unitree 的名义为本作品背书 |
| Boston Dynamics Spot | mujoco_menagerie@8161bba | Clearpath Robotics Inc. | BSD-3-Clause | 非背书：不得以 Boston Dynamics / Clearpath 的名义为本作品背书 |
| ANYbotics ANYmal C | mujoco_menagerie@8161bba | ANYbotics AG | BSD-3-Clause | 非背书：不得以 ANYbotics 的名义为本作品背书 |
| Agility Robotics Cassie | mujoco_menagerie@8161bba | Agility Robotics | MIT | — |
| Hello Robot Stretch 3 | mujoco_menagerie@8161bba | Hello Robot Inc.（Menagerie 子目录 LICENSE 为 Apache-2.0） | Apache-2.0 | 注明改动（Apache-2.0 §4(b)）；无 NOTICE 文件 |
| Boston Dynamics Atlas（DRC / v5 描述模型） | RobotLocomotion/models@3bd1111 | Robot Locomotion Group @ MIT CSAIL | BSD-3-Clause | 非背书（MIT 名义）；版权人非 Boston Dynamics；液压 DRC/v5 一代，非 2025 电动版 |
| LimX Dynamics WL_P311D 轮足四足（代 W1） | limxdynamics/tron1-robot-description@5b97add | LimX Dynamics | Apache-2.0 | 代用件，不是 W1；注明改动（Apache-2.0 §4(b)）；无 NOTICE 文件；realsense_d435.stl 是第三方件，不取 |

**非背书条款是真的。** 说「这是 G1 的躯干几何」是描述，可以；
暗示 Unitree / ANYbotics / Boston Dynamics / MIT / Hello Robot / LimX 与本作品有合作或赞助关系，不行。
本作品与上述任何公司或机构无关。**代用件就写代用**：`wheelleg` 身上是 WL_P311D 不是 W1，
`digitigrade` 身上是 Cassie 不是 Digit，`athlete` 身上是 DRC 那一代 Atlas 的描述模型。

## 我们做了什么改动

**每一件都改过**，改动对所有件是同一套（`packages/factory/src/normalize.ts`）：

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
| `spine.compact.real` | Unitree G1 | `unitree_g1/assets/torso_link_rev_1_0.STL` | BSD-3-Clause（Unitree 变体） | 躯干。剪影里最先被认出来的一块；也是生成件最容易编错比例的一块 |
| `head.compact.real` | Unitree G1 | `unitree_g1/assets/head_link.STL` | BSD-3-Clause（Unitree 变体） | 头。roster 说 compact 的"头不是脸，是一个黑色 sensor pod" —— G1 的头正是那个 pod |
| `clavicle.compact.real` | Unitree G1 | `unitree_g1/assets/left_shoulder_pitch_link.STL` | BSD-3-Clause（Unitree 变体） | 肩座。四肢从躯干伸出去的那一节 |
| `upperArm.compact.real` | Unitree G1 | `unitree_g1/assets/left_shoulder_yaw_link.STL` | BSD-3-Clause（Unitree 变体） | 上臂。G1 的上臂就是 shoulder_yaw 这一节连杆 |
| `foreArm.compact.real` | Unitree G1 | `unitree_g1/assets/left_elbow_link.STL` | BSD-3-Clause（Unitree 变体） | 前臂 |
| `hand.compact.real` | Unitree G1 | `unitree_g1/assets/left_rubber_hand.STL` | BSD-3-Clause（Unitree 变体） | 手。标配的三指橡胶手 —— 连指手套一样的剪影，比灵巧手更"是 G1" |
| `thigh.compact.real` | Unitree G1 | `unitree_g1/assets/left_hip_yaw_link.STL` | BSD-3-Clause（Unitree 变体） | 大腿。髋 yaw 到膝之间那一节 |
| `shin.compact.real` | Unitree G1 | `unitree_g1/assets/left_knee_link.STL` | BSD-3-Clause（Unitree 变体） | 小腿。探路池验过的那一件 |
| `foot.compact.real` | Unitree G1 | `unitree_g1/assets/left_ankle_roll_link.STL` | BSD-3-Clause（Unitree 变体） | 脚掌 |
| `joint.compact.real` | Unitree G1 | `unitree_g1/assets/left_ankle_pitch_link.STL` | BSD-3-Clause（Unitree 变体） | 关节。踝 pitch 的叉形关节块，girth 0.961 ≈ 槽位中位数 0.993 |
| `spine.patrol.spot` | Boston Dynamics Spot | `boston_dynamics_spot/assets/front_left_hip.obj` | BSD-3-Clause | 机身髋座。**不是 `body_0.obj`**：那块机身实测 0.857×0.234×0.192 m，归一化后 girth 0.273 = spine 中位数 0.842 的 0.32×，而 spine 是 uniform 槽位（SLOT_WIDTH/localGirth），放进去会被撑成一块 1.6 m 长的板子。髋座 girth 0.707 ≈ 0.84×，是这台机器上最大的一块合身的壳 |
| `head.patrol.spot` | Boston Dynamics Spot | `boston_dynamics_spot/assets/arm_link_wr1.obj` | BSD-3-Clause | 头。腕节 —— Spot 唯一带相机的那一块，也是这台机器唯一能被叫做"脸"的地方；girth 0.915 ≈ head 中位数 0.941 |
| `clavicle.patrol.spot` | Boston Dynamics Spot | `boston_dynamics_spot/assets/arm_link_sh0.obj` | BSD-3-Clause | 肩座。机械臂从机身伸出去的那一节 |
| `upperArm.patrol.spot` | Boston Dynamics Spot | `boston_dynamics_spot/assets/front_left_upper_leg_1.obj` | BSD-3-Clause | 前腿上节。真机四条腿同形，前腿当上肢 |
| `foreArm.patrol.spot` | Boston Dynamics Spot | `boston_dynamics_spot/assets/front_left_lower_leg.obj` | BSD-3-Clause | 前腿下节 |
| `hand.patrol.spot` | Boston Dynamics Spot | `boston_dynamics_spot/assets/arm_link_fngr_0.obj` | BSD-3-Clause | 手。夹爪的指节 —— 这台机器真的有手；girth 0.668 ≈ hand 中位数 0.624 |
| `thigh.patrol.spot` | Boston Dynamics Spot | `boston_dynamics_spot/assets/rear_left_upper_leg_1.obj` | BSD-3-Clause | 后腿上节 |
| `shin.patrol.spot` | Boston Dynamics Spot | `boston_dynamics_spot/assets/rear_left_lower_leg.obj` | BSD-3-Clause | 后腿下节 |
| `foot.patrol.spot` | Boston Dynamics Spot | `boston_dynamics_spot/assets/front_jaw.obj` | BSD-3-Clause | 足垫。Spot 的脚是腿末端的一个橡胶球，没有单独的网格；取夹爪前颚那一片扁板当平底的脚 —— 这是挑，不是编（和 ANYmal 那次取检修盖板同一类决定） |
| `joint.patrol.spot` | Boston Dynamics Spot | `boston_dynamics_spot/assets/arm_link_wr0.obj` | BSD-3-Clause | 关节。腕 roll 关节块，girth 0.927 ≈ joint 中位数 0.991 —— 它本来就是一个关节 |
| `spine.patrol.real` | ANYbotics ANYmal C | `anybotics_anymal_c/assets/top_shell.obj` | BSD-3-Clause | （已被 Spot 换下）机身上壳 |
| `head.patrol.real` | ANYbotics ANYmal C | `anybotics_anymal_c/assets/face.obj` | BSD-3-Clause | （已被 Spot 换下）前脸传感器面板 |
| `clavicle.patrol.real` | ANYbotics ANYmal C | `anybotics_anymal_c/assets/hip_l.obj` | BSD-3-Clause | （已被 Spot 换下）髋座 |
| `upperArm.patrol.real` | ANYbotics ANYmal C | `anybotics_anymal_c/assets/thigh.obj` | BSD-3-Clause | （已被 Spot 换下）前腿上节 |
| `foreArm.patrol.real` | ANYbotics ANYmal C | `anybotics_anymal_c/assets/shank_r.obj` | BSD-3-Clause | （已被 Spot 换下）前腿下节 |
| `hand.patrol.real` | ANYbotics ANYmal C | `anybotics_anymal_c/assets/drive.obj` | BSD-3-Clause | （已被 Spot 换下）ANYdrive 执行器代前肢末端 —— 那台机器没有手 |
| `thigh.patrol.real` | ANYbotics ANYmal C | `anybotics_anymal_c/assets/thigh.obj` | BSD-3-Clause | （已被 Spot 换下）后腿上节 |
| `shin.patrol.real` | ANYbotics ANYmal C | `anybotics_anymal_c/assets/shank_l.obj` | BSD-3-Clause | （已被 Spot 换下）后腿下节 |
| `foot.patrol.real` | ANYbotics ANYmal C | `anybotics_anymal_c/assets/hatch.obj` | BSD-3-Clause | （已被 Spot 换下）机腹检修盖板代足垫 |
| `joint.patrol.real` | ANYbotics ANYmal C | `anybotics_anymal_c/assets/lidar.obj` | BSD-3-Clause | （已被 Spot 换下）顶上那颗旋转激光雷达 |
| `spine.digitigrade.real` | Agility Robotics Cassie | `agility_cassie/assets/pelvis.obj` | MIT | 骨盆。Cassie 的"躯干"就是这一块，两条腿直接挂上去 |
| `head.digitigrade.real` | Agility Robotics Cassie | `agility_cassie/assets/hip-yaw.obj` | MIT | 头（代）。Cassie 无头，用同机的髋 yaw 执行器罩当 sensor pod |
| `clavicle.digitigrade.real` | Agility Robotics Cassie | `agility_cassie/assets/knee-spring.obj` | MIT | 肩座（代膝弹簧板）。girth 0.542 ≈ clavicle 中位数 0.548 |
| `upperArm.digitigrade.real` | Agility Robotics Cassie | `agility_cassie/assets/hip-pitch.obj` | MIT | 上臂（代髋 pitch 壳） |
| `foreArm.digitigrade.real` | Agility Robotics Cassie | `agility_cassie/assets/tarsus.obj` | MIT | 前臂。跗骨连杆，细长、两端轴承座 —— 探路池验过它当前臂比当小腿更像 |
| `hand.digitigrade.real` | Agility Robotics Cassie | `agility_cassie/assets/foot-crank.obj` | MIT | 手（代足曲柄）。girth 0.530 ≈ hand 中位数 0.624 |
| `thigh.digitigrade.real` | Agility Robotics Cassie | `agility_cassie/assets/knee.obj` | MIT | 大腿。膝壳连着大腿，反关节的那个折点就在这里 |
| `shin.digitigrade.real` | Agility Robotics Cassie | `agility_cassie/assets/shin.obj` | MIT | 小腿。真机就叫 shin；girth 0.208 —— 鸟腿的细全在这一件上 |
| `foot.digitigrade.real` | Agility Robotics Cassie | `agility_cassie/assets/foot.obj` | MIT | 脚。一片着地的刀，没有脚掌 —— 鸟腿的读法全在这里 |
| `joint.digitigrade.real` | Agility Robotics Cassie | `agility_cassie/assets/hip-roll.obj` | MIT | 关节。髋 roll 壳，girth 0.929 ≈ joint 中位数 0.993 |
| `spine.athlete.atlas` | Boston Dynamics Atlas（DRC / v5 描述模型） | `atlas/meshes/utorso.gltf` | BSD-3-Clause | 上躯干。Atlas 那副背着液压泵的宽胸 —— 剪影里最先被认出来的一块；girth 0.726 ≈ spine 中位数 0.842 的 0.86× |
| `head.athlete.atlas` | Boston Dynamics Atlas（DRC / v5 描述模型） | `atlas/meshes/head.gltf` | BSD-3-Clause | 头。MultiSense 传感器头，没有脸；girth 0.751 ≈ head 中位数的 0.80× |
| `clavicle.athlete.atlas` | Boston Dynamics Atlas（DRC / v5 描述模型） | `atlas/meshes/r_clav.gltf` | BSD-3-Clause | 锁骨连杆。真机就叫 clav |
| `upperArm.athlete.atlas` | Boston Dynamics Atlas（DRC / v5 描述模型） | `atlas/meshes/r_uarm.gltf` | BSD-3-Clause | 上臂 |
| `foreArm.athlete.atlas` | Boston Dynamics Atlas（DRC / v5 描述模型） | `atlas/meshes/r_farm.gltf` | BSD-3-Clause | 前臂 |
| `hand.athlete.atlas` | Boston Dynamics Atlas（DRC / v5 描述模型） | `atlas/meshes/r_hand.gltf` | BSD-3-Clause | 手（腕法兰端）；girth 0.658 ≈ hand 中位数的 1.05× |
| `thigh.athlete.atlas` | Boston Dynamics Atlas（DRC / v5 描述模型） | `atlas/meshes/r_uleg.gltf` | BSD-3-Clause | 大腿 |
| `shin.athlete.atlas` | Boston Dynamics Atlas（DRC / v5 描述模型） | `atlas/meshes/r_lleg.gltf` | BSD-3-Clause | 小腿 |
| `foot.athlete.atlas` | Boston Dynamics Atlas（DRC / v5 描述模型） | `atlas/meshes/r_foot.gltf` | BSD-3-Clause | 脚 |
| `joint.athlete.atlas` | Boston Dynamics Atlas（DRC / v5 描述模型） | `atlas/meshes/r_talus.gltf` | BSD-3-Clause | 关节。踝的万向节块 —— 它本来就是一个关节；girth 1.000 ≈ joint 中位数的 1.01× |
| `spine.wheelleg.limx` | LimX Dynamics WL_P311D 轮足四足（代 W1） | `wheellegged/WL_P311D/meshes/base_link.STL` | Apache-2.0 | 机身。girth 0.588 ≈ spine 中位数的 0.70×，贴着 §H 带的下沿 —— 选它而不是髋座，是因为这台机器的剪影就是一块扁机身挂四条轮腿 |
| `head.wheelleg.limx` | LimX Dynamics WL_P311D 轮足四足（代 W1） | `wheellegged/WL_P311D/meshes/LF_hip.STL` | Apache-2.0 | 头（代）。这台机器没有头，用前左髋 HAA 执行器座当 sensor pod；girth 0.848 ≈ head 中位数的 0.90× |
| `clavicle.wheelleg.limx` | LimX Dynamics WL_P311D 轮足四足（代 W1） | `wheellegged/WL_P311D/meshes/RF_hip.STL` | Apache-2.0 | 肩座。前右髋座 —— 腿从机身伸出去的那一节 |
| `upperArm.wheelleg.limx` | LimX Dynamics WL_P311D 轮足四足（代 W1） | `wheellegged/WL_P311D/meshes/LF_thigh.STL` | Apache-2.0 | 前腿大腿 |
| `foreArm.wheelleg.limx` | LimX Dynamics WL_P311D 轮足四足（代 W1） | `wheellegged/WL_P311D/meshes/LF_calf.STL` | Apache-2.0 | 前腿小腿 |
| `hand.wheelleg.limx` | LimX Dynamics WL_P311D 轮足四足（代 W1） | `wheellegged/WL_P311D/meshes/LF_wheel.STL` | Apache-2.0 | 前轮。四足里前腿的末端就是手 —— 这台机器的手是轮子。girth 0.999 超出 hand 带（≈1.6×），只给自己用、不外借 |
| `thigh.wheelleg.limx` | LimX Dynamics WL_P311D 轮足四足（代 W1） | `wheellegged/WL_P311D/meshes/LH_thigh.STL` | Apache-2.0 | 后腿大腿 |
| `shin.wheelleg.limx` | LimX Dynamics WL_P311D 轮足四足（代 W1） | `wheellegged/WL_P311D/meshes/LH_calf.STL` | Apache-2.0 | 后腿小腿 |
| `foot.wheelleg.limx` | LimX Dynamics WL_P311D 轮足四足（代 W1） | `wheellegged/WL_P311D/meshes/LH_wheel.STL` | Apache-2.0 | 后轮。**这一格就是 docs/42 说这条线上真正缺的那个轮子** |
| `joint.wheelleg.limx` | LimX Dynamics WL_P311D 轮足四足（代 W1） | `wheellegged/WL_P311D/meshes/RH_hip.STL` | Apache-2.0 | 关节。后右髋 HAA 执行器座；girth 0.847 ≈ joint 中位数的 0.86×。轮子当关节会让 18 个关节全变成轮子，读不出哪里在滚 |
| `spine.manipulator.stretch` | Hello Robot Stretch 3 | `hello_robot_stretch_3/assets/link_lift_0.obj` + `hello_robot_stretch_3/assets/link_lift_2.obj` + `hello_robot_stretch_3/assets/link_lift_3.obj` + `hello_robot_stretch_3/assets/link_lift_4.obj` + `hello_robot_stretch_3/assets/link_lift_5.obj` + `hello_robot_stretch_3/assets/link_lift_6.obj` + `hello_robot_stretch_3/assets/link_lift_7.obj` + `hello_robot_stretch_3/assets/link_lift_8.obj` + `hello_robot_stretch_3/assets/link_lift_9.obj` | Apache-2.0 | 升降滑架。套在桅杆上、伸出手臂的那一块 —— column 方案里躯干就在桅杆顶上；girth 0.745 ≈ spine 中位数的 0.88× |
| `head.manipulator.stretch` | Hello Robot Stretch 3 | `hello_robot_stretch_3/assets/link_head_1.obj` + `hello_robot_stretch_3/assets/link_head_2.obj` + `hello_robot_stretch_3/assets/link_head_3.obj` + `hello_robot_stretch_3/assets/link_head_4.obj` + `hello_robot_stretch_3/assets/link_head_5.obj` + `hello_robot_stretch_3/assets/link_head_6.obj` + `hello_robot_stretch_3/assets/link_head_7.obj` + `hello_robot_stretch_3/assets/link_head_8.obj` + `hello_robot_stretch_3/assets/link_head_9.obj` + `hello_robot_stretch_3/assets/link_head_10.obj` + `hello_robot_stretch_3/assets/link_head_11.obj` | Apache-2.0 | 头。桅杆顶上那个装相机的头罩（不含 11.5 MB 的 link_head_0）；girth 0.694 ≈ head 中位数的 0.74× |
| `clavicle.manipulator.stretch` | Hello Robot Stretch 3 | `hello_robot_stretch_3/assets/link_arm_l0_0.obj` + `hello_robot_stretch_3/assets/link_arm_l0_1.obj` + `hello_robot_stretch_3/assets/link_arm_l0_2.obj` | Apache-2.0 | 伸缩臂最内一节，连着滑架 |
| `upperArm.manipulator.stretch` | Hello Robot Stretch 3 | `hello_robot_stretch_3/assets/link_arm_l4_0.obj` + `hello_robot_stretch_3/assets/link_arm_l4_1.obj` | Apache-2.0 | 伸缩臂外套管 |
| `foreArm.manipulator.stretch` | Hello Robot Stretch 3 | `hello_robot_stretch_3/assets/link_arm_l1_0.obj` + `hello_robot_stretch_3/assets/link_arm_l1_1.obj` | Apache-2.0 | 伸缩臂内套管 —— 比上一节细，套筒一节套一节的读法在这里 |
| `hand.manipulator.stretch` | Hello Robot Stretch 3 | `hello_robot_stretch_3/assets/link_SG3_gripper_body.obj` | Apache-2.0 | 夹爪本体。girth 0.748 超出 hand 带（≈1.2×），只给自己用、不外借 |
| `thigh.manipulator.stretch` | Hello Robot Stretch 3 | `hello_robot_stretch_3/assets/link_mast.obj` | Apache-2.0 | 桅杆。column 方案里腿骨串成桅杆，而这台机器真的只有一根桅杆 |
| `shin.manipulator.stretch` | Hello Robot Stretch 3 | `hello_robot_stretch_3/assets/link_mast.obj` | Apache-2.0 | 桅杆（同一件）。桅杆是一根铝型材，拆两节是拓扑要求，不是机器的 |
| `foot.manipulator.stretch` | Hello Robot Stretch 3 | `hello_robot_stretch_3/assets/base_link_0.obj` + `hello_robot_stretch_3/assets/base_link_2.obj` + `hello_robot_stretch_3/assets/base_link_3.obj` + `hello_robot_stretch_3/assets/base_link_4.obj` + `hello_robot_stretch_3/assets/base_link_5.obj` + `hello_robot_stretch_3/assets/base_link_6.obj` + `hello_robot_stretch_3/assets/base_link_7.obj` | Apache-2.0 | 底盘（不含 22 MB 的 base_link_8）。桅杆底端落在它上面 —— 轮式底盘就是这个物种的脚 |
| `joint.manipulator.stretch` | Hello Robot Stretch 3 | `hello_robot_stretch_3/assets/link_wrist_yaw.obj` + `hello_robot_stretch_3/assets/link_DW3_wrist_yaw_bottom.stl` | Apache-2.0 | 关节。腕 yaw 关节 —— 它本来就是一个关节；girth 0.815 ≈ joint 中位数的 0.82× |

## 被换下来的生成件（45 件）

这些物种原来的 Rodin 生成件**文件一件都没删**，还在 `assets/parts/` 里，
只是不再进 `parts.json`（规则在 `packages/factory/src/index-parts.ts`：
一个物种只要有一件真实网格，它的生成件就整批不进索引）。

它们不是坏件 —— 坏件在 `curation.json` 里，那是另一回事。
它们是被一个策展决定换下来的（docs/26 §H），而那个决定可能会变。

- `clavicle.patrol.a`
- `clavicle.patrol.b`
- `foot.athlete.a`
- `foot.compact.a`
- `foot.digitigrade.a`
- `foot.manipulator.a`
- `foot.patrol.a`
- `foot.patrol.b`
- `foreArm.patrol.a`
- `foreArm.patrol.b`
- `hand.patrol.a`
- `hand.patrol.b`
- `head.athlete.a`
- `head.compact.a`
- `head.digitigrade.a`
- `head.manipulator.a`
- `head.patrol.a`
- `head.patrol.b`
- `joint.athlete.a`
- `joint.compact.a`
- `joint.digitigrade.a`
- `joint.manipulator.a`
- `joint.patrol.a`
- `joint.patrol.b`
- `shin.athlete.a`
- `shin.compact.a`
- `shin.digitigrade.a`
- `shin.manipulator.a`
- `shin.patrol.a`
- `shin.patrol.b`
- `spine.athlete.a`
- `spine.compact.a`
- `spine.digitigrade.a`
- `spine.manipulator.a`
- `spine.patrol.a`
- `spine.patrol.b`
- `spine.wheelleg.a`
- `thigh.patrol.a`
- `thigh.patrol.b`
- `upperArm.athlete.a`
- `upperArm.compact.a`
- `upperArm.digitigrade.a`
- `upperArm.manipulator.a`
- `upperArm.patrol.a`
- `upperArm.patrol.b`

## 顺手引用

Menagerie 请求（非强制）引用：

```bibtex
@software{menagerie2022github,
  author = {Zakka, Kevin and Tassa, Yuval and {MuJoCo Menagerie Contributors}},
  title = {{MuJoCo Menagerie: A collection of high-quality simulation models for MuJoCo}},
  url = {https://github.com/google-deepmind/mujoco_menagerie},
  year = {2022},
}
```
