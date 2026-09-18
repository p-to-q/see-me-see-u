# 05 · SPEC · Genome, Motion Features & Evolution

## 1. Genome

一个身体 = 一个 `Genome`。**给定 `seed` 与 `tier`，genome 必须完全确定**（P1/P9）。

```ts
interface Genome {
  seed: number;                       // uint32，一次 session 一个
  tier: 0|1|2|3;
  family: string;                     // 本次抽中的主 family，用于风格统一
  slots: Record<SlotKey, SlotPick>;   // SlotKey = BoneId 或 "joint"
  materials: { primary: string; secondary: string; accent: string };
}
interface SlotPick { partId: string; materialRole: "primary"|"secondary"|"accent"; }
```

> `SlotKey`（骨头）→ `Slot`（部件类别）的映射在 `core/slots.ts` 的 `SLOT_OF_BONE`，**只有那一份**。
> 注意 `neck` 骨头映射到 `joint` 槽位（颈环/球），不单独生成 neck 部件。

### 抽取算法（`core/genome.ts`）

```
rng = mulberry32(seed ^ (tier * 0x9E3779B9))
1. family  ← 从 tier 可用的 family 里按权重抽 1 个（70% 概率整具用同一 family）
2. 对每个骨头 slot:
     候选 = parts.filter(p => p.slot === slotOf(bone) && p.tier <= tier)
     若 family 内有候选 → 80% 从 family 内抽，20% 跨 family（制造"杂交感"）
     若候选为空 → 回退到占位几何
3. materials ← 从 tier 可用的 material 里抽 3 个不重复
4. materialRole 按骨头分组指定：躯干=primary，四肢=secondary，头/手/脚=accent
```

**不变式**（有测试）：
- `makeGenome(s, t, idx)` 调两次结果深度相等。
- 任何 `seed`/`tier` 组合都不会返回缺槽位的 genome（缺就填占位）。
- `tier` 升高时，已有槽位**允许**变，但同一 seed 的 family 不变（身体的"身份"连续）。

## 2. MotionFeatures

每帧由 `core/motion.ts` 从连续两帧骨架算出，全部**归一化到无量纲**（除以身高 `H`）。

| 字段 | 定义 | 范围 |
|---|---|---|
| `speed` | Σ‖Δjoint‖ / (dt·H·N) 的 EMA(τ=0.25s) | 0..~3 |
| `energy` | `speed` 的 EMA(τ=1.5s)，慢变量 | 0..~3 |
| `expansiveness` | mean(‖extremity - pelvis‖)/H，extremity = 两手两脚+头 | 0.2..0.8 |
| `verticality` | (headCenter.y - pelvis.y)/H，蹲下时变小 | 0..0.6 |
| `symmetry` | 左右肢速度的相关系数，EMA(τ=1s) | -1..1 |
| `jerk` | ‖Δspeed‖/dt 的 EMA，用于触发"惊吓"类瞬时效果 | 0..∞ |
| `stillness` | `1 - clamp(speed/0.3)`，静止度 | 0..1 |

**实现要求**：
- 所有 EMA 用 `a = 1 - exp(-dt/τ)`（帧率无关），不要用固定系数。
- `dt` 已被上游 clamp 到 [1/240, 1/15]。
- 关节 confidence < 0.4 的不参与统计（防止抖动喂进 energy）。

## 3. Evolution（演化状态机）

```
charge' = charge + (energy · GAIN - DECAY) · dt          // 单位：无量纲
charge  = clamp(charge, 0, CHARGE_MAX)
tier    = 最大的 k 使 charge >= THRESHOLD[k]              // 带滞回
```

默认参数（`core/evolution.ts` 顶部常量，现场要调）：

```ts
GAIN = 1.0
DECAY = 0.08            // 完全静止时 ~12s 掉一档
THRESHOLD = [0, 1.5, 5.0, 11.0]
HYSTERESIS = 0.25       // 降档需要比升档阈值低 25% 才触发，防抖
TIER_COOLDOWN = 2.0     // 秒；两次换装之间的最小间隔
```

**换装（remorph）不是瞬时的**：
- 触发时生成新 genome，只对**发生变化的槽位**做 1.2s 的 crossfade：
  旧部件 scale→0 + 溶解，新部件 scale 0→1；**缺省在原 socket 长回来**，不再给所有槽位隐式加一条轴向飞入。
- 同一时刻最多 3 个槽位在动画中，其余排队（避免"整个人炸开"）。

可见脱离不是 remorph 的隐式副作用。它由 app-local `DetachmentPlan` 显式授权，按末端 / 肢段 / 核心三种
profile 在同一条交接时钟上离开再回接；未获授权、计划无效或预算不足一律原位。策略、位移、阶段、概率与预算的
旋钮只住在 `packages/core/src/tuning.ts` 的 `THESEUS.detachment`，本规范不复制数值。

**设计意图**：观众必须能感知"我动 → 它变"的因果。所以：
- 升档要有**明确的视听事件**（音效 + 短暂的全身脉冲 + 轻微时间停滞）。
- 升档阈值宁可偏低：第一次升档应在**站上去后 8–15 秒内**发生，否则大部分观众看不到。

## 4. 关节盖片（joint caps）

刚体挂载必然在关节处穿插。解法：在每个关节点放一个 `slot: "joint"` 的球/多面体，
半径由 `tuning.ts` 的 `MORPH.jointCapScale` 决定（当前 0.75），乘以相邻骨的 girth。
**这里不写死数字** —— 旋钮住在 `tuning.ts`（P0），文档里再抄一份就一定会对不上（已经对不上过一次）。tier 0 用素球，tier ≥ 2 换成机械关节件。
父部件若 `capJoint: true` 则跳过该关节的盖片。

## 5. Presence 生命周期（`core/presence.ts`）

```
IDLE ──detected 持续 0.4s──► ENTERING ──1.2s 动画──► ALIVE
ALIVE ──lost 持续 1.0s──► LEAVING ──2.5s 溶解──► IDLE(重置 seed/charge)
LEAVING ──重新 detected──► ALIVE (取消溶解，保留 charge)
```

- 进入/离开都有**滞回时间**，防止追踪抖动导致角色闪烁。
- `IDLE` 时屏幕上是缓慢呼吸的粒子团（不是黑屏——黑屏会让观众以为坏了）。
- 回到 `IDLE` 时 `seed = rng32()`，`charge = 0`：**下一个人是全新的身体**。
- `LEAVING → ALIVE` 保留 charge：同一个人短暂走出画面不该被清零。
