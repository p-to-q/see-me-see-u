# 01 · Architecture

## 1. 全景

```
                         ┌──────────────── 慢回路 (30–90 s) ────────────────┐
                         │                                                  │
 webcam                  │   silhouette ──► factory-proxy ──► Rodin API     │
   │                     │        ▲              (localhost:8787)      │    │
   ▼                     │        │                                    ▼    │
┌─────────────┐          │        │                            normalize    │
│  CAPTURE    │──frame───┼────────┘                                    │    │
│ MediaPipe   │          │                                             ▼    │
│  Pose+Seg   │          └──────────────────────── hot-swap part ──────┘    │
└──────┬──────┘                                                    │
       │ RawPose (33 landmarks, world m)                            │
       ▼                                                            │
┌─────────────┐                                                     │
│ KINEMATICS  │  OneEuro filter → bone-length stabilize → FK         │
│             │  presence state machine (IDLE/ENTER/ALIVE/LEAVE)     │
└──────┬──────┘                                                     │
       │ Skeleton (17 bones) + Presence                              │
       ▼                                                            │
┌─────────────┐                                                     │
│   MOTION    │  energy / expansiveness / symmetry / jerk            │
│  FEATURES   │  → charge (积分) → tier                              │
└──────┬──────┘                                                     │
       │ MotionFeatures + tier                                       │
       ▼                                                            │
┌─────────────┐                                                     │
│ MORPHOLOGY  │  Genome{seed,tier,slots} ◄── PartLibrary ◄───────────┘
│             │  tier 变化 → 重抽部件 → crossfade
└──────┬──────┘
       │ PartInstance[] (bone matrix × socket × stretch)
       ▼
┌─────────────┐
│   RENDER    │  three.js WebGPU / TSL
│             │  InstancedMesh per part-type + GPU particles + post
└─────────────┘
```

## 2. 分层与依赖方向

```
packages/core      纯逻辑，零依赖，可在 node 里跑测试   ← 唯一允许被所有人 import
   ▲
   │
packages/app       浏览器运行时（three.js / MediaPipe / DOM）
   ▲
   │  (只通过 HTTP，不共享代码)
packages/factory   Node：Hyper3D 客户端 + 资产流水线 + localhost 代理
```

**依赖只能向下。** `core` 不许 import `three`、不许碰 `window`、不许碰 `fs`。
理由：core 里的东西是最容易出 bug 又最难在浏览器里调的（滤波、坐标、状态机），
必须能在 node 里用 `node --test` 秒级验证。

## 3. 模块清单与职责边界

| 模块 | 文件 | 输入 | 输出 | 状态 |
|---|---|---|---|---|
| Rng | `core/rng.ts` | seed | 确定性随机数 | 有（游标） |
| OneEuro | `core/filter.ts` | value, dt | 平滑值 | 有 |
| Skeleton | `core/skeleton.ts` | RawPose | Skeleton | 无（纯） |
| Stabilizer | `core/stabilize.ts` | Skeleton | Skeleton（骨长稳定） | 有（滑窗） |
| Presence | `core/presence.ts` | detected, dt | PresenceState | 有（状态机） |
| Motion | `core/motion.ts` | Skeleton[t-1], Skeleton[t], dt | MotionFeatures | 有（EMA） |
| Evolution | `core/evolution.ts` | MotionFeatures, dt | charge, tier | 有 |
| Genome | `core/genome.ts` | seed, tier, PartIndex | Genome | 无（纯） |
| Attach | `core/attach.ts` | Bone, Part | Mat4 (列主序 number[16]) | 无（纯） |
| — | — | — | — | — |
| Capture | `app/capture/*` | camera | RawPose, mask | 有 |
| PartLibrary | `app/assets/library.ts` | parts.json | GLTF 几何缓存 | 有 |
| Creature | `app/creature/*` | Genome + Skeleton | three.Object3D | 有 |
| Stage | `app/stage/*` | — | 灯光/地面/后期 | 有 |
| SlowLoop | `app/slowloop/*` | mask frame | 新 Part | 有 |
| RodinClient | `factory/rodin.ts` | recipe | glb | 有 |
| Normalize | `factory/normalize.ts` | glb | 规范化 glb + PartMeta | 无 |

## 4. 关键设计决策（ADR 摘要）

### ADR-1 刚体挂载，不做蒙皮
部件以 `socketA→socketB` 主轴对齐到骨头，沿主轴拉伸。
**后果**：可以直接吃任何 AI 生成的网格，无需绑骨；机器人质感是"免费"的副产品。
**代价**：关节处会有穿插/缝隙 → 用「关节球」部件盖住（见 `05` §4）。

### ADR-2 归一化契约放在资产侧，不放运行时
所有 `.glb` 在入库前被规范成：**主轴 = +Y，socketA 在原点，长度 = 1.0 m**。
**后果**：运行时挂载数学退化成 `T(p0) · R(dir) · S(1,len,1)`，10 行代码，没有 per-part 特例。
**代价**：流水线必须严格；任何手工加入的资产也要过同一个脚本。

### ADR-3 无 Blender 依赖
归一化/减面全部用 Node 工具链（`@gltf-transform/core` + `meshoptimizer`）。
**理由**：本机没装 Blender；一套 TS 工具链让子代理不用切换上下文。
Blender 保留为人工修模的可选工具，不进流水线。

### ADR-4 应用在无资产时也必须可运行
`PartLibrary` 在 `parts.json` 缺失时返回程序化占位几何。
**理由**：解耦运行时开发与资产生产，两条线可并行（这是 48 小时内能做完的前提）。

### ADR-5 慢回路与快回路完全隔离
慢回路通过 `localhost:8787` 的 Node 代理走，浏览器侧只有 `fetch` + 超时 + 放弃。
**理由**：P8（key 不进浏览器）+ P3（AI 失败不能影响主体验）。

## 5. 数据流的一帧（伪代码）

```ts
function frame(t: number) {
  const dt = clampDt(t - last);                        // dt ∈ [1/240, 1/15]
  const raw = capture.latest();                        // 可能是 null
  const detected = posePresent(raw);                    // 整身平均或可靠躯干对

  presence.update(detected, dt);

  if (raw) {
    const sk0 = buildSkeleton(mediapipeToWorld(raw));   // core/skeleton
    const sk  = stabilizer.apply(sk0, dt);              // core/stabilize
    motion.update(sk, dt);                              // core/motion
    evolution.update(motion.features, dt);              // core/evolution
    if (evolution.tierChanged) creature.remorph(
      makeGenome(session.seed, evolution.tier, library.index)
    );
    creature.pose(sk);                                  // 写 instance matrices
  }

  stage.update(presence.state, motion.features, dt);
  renderer.renderAsync(scene, camera);
}
```

## 6. 时间线上的并行性（给排任务用）

```
lane A  runtime   : T-01 capture → T-02 skeleton → T-05 attach → T-07 creature → T-09 stage
lane B  core math : T-03 filter  → T-04 stabilize → T-06 motion/evolution → T-08 genome
lane C  factory   : T-10 rodin client → T-11 recipes → T-12 normalize → T-13 batch run
lane D  install   : T-14 presence/lifecycle → T-15 sound → T-16 kiosk/recovery → T-17 slow loop
```
A 和 C 之间**唯一的接口**是 `assets/parts/parts.json`（ADR-4 保证了不阻塞）。
