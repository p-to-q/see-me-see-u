# 16 · SPEC · Acts —— 留给新玩法的那块空间

> 需求原话："也要留出空间给我们加新玩法，或者做一些新的尝试。"
> 这份文档定义那块空间长什么样。**加一个新玩法 = 新建一个文件 + 在一个数组里加一行，
> 不碰 `main.ts`，不碰帧循环，不碰任何契约。**

## 1. 为什么不是"直接改 main.ts"

`main.ts` 是唯一一处所有契约同时成立或同时失效的地方（`docs/06 §1` 的一帧顺序）。
每加一个玩法就往里塞一段 if，三个玩法之后就没人敢动它了 —— 而黑客松之后
"再试一个想法"的成本，直接决定这件作品还能不能长出新东西。

所以：**帧循环固定，玩法挂在它旁边。**

## 2. 三个概念

```
World      每帧重建的只读快照 + 几个命令。Act 能看到的全部世界。
Act        一个玩法。有生命周期（enter / update / exit）和进入条件。
Director   选谁上场、什么时候换、以及**把出错的 Act 关掉**。
```

## 3. `Act`

```ts
interface Act {
  id: string;
  label: string;                       // 给 ?debug=1 的 HUD 看
  /** 'body' = 决定身体怎么动，同时只能有一个；'ambient' = 常驻叠加，可以有多个 */
  kind: 'body' | 'ambient';
  canEnter?(w: World): boolean;        // 不满足就永远不会被选中
  weight?: number;                     // 随机选择时的权重，默认 1
  minSeconds?: number;                 // 上场后至少演这么久，防止来回横跳
  maxSeconds?: number;                 // 演够就让位
  enter?(w: World): void;
  update(w: World, dt: number): void;
  exit?(w: World): void;
}
```

## 4. `World`

只读快照 + 少量命令。**Act 不允许直接碰 renderer、不允许自己开 rAF、不允许读时钟。**

```ts
interface World {
  readonly t: number;                  // 秒，会话开始至今
  readonly presence: Presence;
  readonly skeleton: Skeleton | null;  // 追踪丢失时是 null
  readonly features: MotionFeatures | null;
  readonly evolution: EvolutionState;
  readonly genome: Genome | null;
  readonly creature: Creature;
  readonly stage: Stage;
  readonly library: PartLibrary;
  readonly capture: Capture;
  readonly flags: Flags;
  readonly rng: Rng;                   // 会话级确定性随机，唯一的随机来源（P1）
  /** 重新抽形态。tier 省略时用当前 tier */
  morph(tier?: Tier): void;
  /** 给 HUD / 日志留一句话，说明现在在演什么 */
  note(s: string): void;
}
```

## 5. `Director` 的三条规则

1. **同时只有一个 `body` Act。** 没有任何候选可进入时，回落到 `follow`（它的 `canEnter` 永远为真）。
2. **出错的 Act 会被关掉，不会带走整件作品。** 连续 3 次抛异常 → 该 Act 被永久禁用并打一条错误，
   Director 立刻回落到 `follow`。这条是 P2/P3 在扩展点上的延伸 ——
   **让"随便试新玩法"变得安全，是这块空间成立的前提。**
3. **换场由会话弧线决定，不再由骰子决定**（2026-09-14，`docs/40-SESSION-ARC.md`）。
   `World.arc.actId` 说这一刻该演谁，Director 照做：四个乐章依次是
   `follow` → `echo` → `resist` → `facing`。所以 body 玩法的
   `canEnter` / `weight` / `minSeconds` / `maxSeconds` **不再参与选角** ——
   段长由 `ARC.beats` 定，两套时长互相说了不算数的话，观众看到的是一条不按文档走的弧线。
   这几个字段留着：`ambient` 玩法仍然用 `canEnter`，而 `untether` 的
   `canEnter: false` 仍然是它排不进来的那道锁（弧线根本不叫它的名字，见 `ARC_ACTS`）。
   `director.force()` 按住一个玩法（`?act=` / 右下角那一行），
   `director.release()` 把它**交回给弧线当下那一段** —— 不是回到 `follow`。

## 6. 写一个新玩法

```ts
// packages/app/src/acts/my-idea.ts
import type { Act } from './act.ts';

export const myIdea: Act = {
  id: 'my-idea',
  label: '我的新想法',
  kind: 'body',
  weight: 1,
  minSeconds: 20,
  canEnter: (w) => w.evolution.tier >= 2,        // 只在演化到一定程度后出现
  update(w, dt) {
    if (!w.skeleton) return;
    w.creature.pose(w.skeleton, w.presence, dt); // 一个 body Act 至少要做这件事
  },
};
```

然后在 `packages/app/src/acts/index.ts` 的 `ACTS` 数组里加一行。**没有别的步骤。**

## 7. 已有的 Act

「进入条件」那一栏写的是**旧的选角**（随机加权时代）。现在四个 body 玩法由
`docs/40` 的弧线按顺序排，那一栏因此只剩历史价值 —— 留着是因为
`canEnter` 本身还在代码里，而 `untether` 那一行的 `false` 至今是一道真锁。

| id | kind | 是什么 | 弧线里的位置 | 它问了什么 |
|---|---|---|---|---|
| `follow` | body | 基线：身体跟随你。原作的行为 | **第 I 乐章**（也是永远的兜底） | — |
| `echo` | body | 主体当帧回应，前臂 / 手混入 **1.2 秒前**的方向余波 | **第 II 乐章** | 现在和刚才可以同时是我吗 |
| `resist` | body | 跟随，但**有重量**：快动作被阻尼，慢动作 1:1 | **第 III 乐章** | 是它学我，还是我学它 |
| `facing` | body | 镜像被抵消：它不是你的反射，是一个**面对你的人** | **第 IV 乐章** | 那个身体是**我**吗 |
| `untether` | body | **归还**：它不再用你的骨架，演自己的一场缓慢摇曳。摄像头照开、采集照跑 | **`canEnter` 恒为 false** —— 导演永远排不到它；只由右下角那一行「把身体还回去」和 `?act=untether` 进来 | 那具身体还是我的吗 |

`untether` 和上面四个不是一类：**它是唯一一个由观众按出来的玩法**，所以它不参加选角
（`weight: 0` 且 `canEnter` 恒为 false），`director.force()` 不看 `canEnter`，这是它进得来的全部机制。
它也是唯一一个**不由任何一副当前骨架驱动**的：以观众交出身体那一刻的姿态为基准，
叠一个随高度增强的正弦位移场。写它的理由写在 `acts/untether.ts` 的文件头 ——
一句话是：此前四个玩法全都要有人站在那儿，「它自己动」在这个仓库里不存在。

**那件事现在是一条纪律，不只是一个现状**（`docs/40 §1`「永远不脱钩」）：
弧线上的四个乐章没有一个可以自己动起来 —— 观众静止，输出必须也静止，
`packages/app/test/arc-still.test.ts` 照着这一条验（并带一个会动的对照组，
否则夹具没跑起来时那些断言也会全绿）。`untether` 是唯一的例外，
而它成立的全部理由是**观众自己按下去的**：主动交出身体，和被作品擅自拿走，
是两件相反的事。所以它既不在 `ARC_ACTS` 里，`canEnter` 也永远是 false。

三个非基线玩法各自问一个不同的问题，这是选它们的理由 ——
玩法不是特效，是把"那具身体和我是什么关系"这个问题从不同角度问一遍。

**`facing` 是最便宜也最狠的一个：一行取负。** 整个作品默认是镜子
（`docs/04 §1`：镜像只发生一次），把 X 再取一次负就抵消了它。
观众几乎立刻察觉不对，但往往说不出哪里不对。

**`resist` 是唯一反过来改变观众行为的一个**：它跟不上快动作，于是观众会自发地放慢。

删掉任何一个都只需要从 `ACTS` 数组里去掉一行，其余代码一个字不用动。

## 7b. 形状约束（有测试）

`packages/core/test/acts-shape.test.ts` 静态检查每个玩法文件：
不 import three、不开 rAF、不读时钟、不用 `Math.random()`、
**不就地修改 `World.skeleton`**（它是共享的，就地改会污染同帧的其它消费者），
以及必须声明 `id` / `label` / `kind`。

还有一条断言是 `files.length >= 4` —— **扩展点建好了却没人用，等于没建。**

## 8. 明确的边界

- Act **不能**改坐标系、不能改挂载数学、不能改 genome 抽取算法。那些是契约。
- Act **可以**：换姿态来源（echo 就是）、触发 remorph、改舞台参数、决定什么时候不动。
- Act 之间不通信。需要协作就合成一个 Act —— 两个玩法互相依赖时，它们本来就是一个玩法。
