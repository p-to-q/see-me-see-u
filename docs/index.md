# docs index —— 哪份文档回答哪个问题

> **In English:** this is the map of `docs/`. Each row says what question that
> document answers and whether it is written in English (`EN`) or Chinese
> (`中文`). Six files are English: [`../README.md`](../README.md),
> [`../AGENTS.md`](../AGENTS.md), [`02`](02-ENGINEERING-PRINCIPLES.md),
> [`15`](15-ORCHESTRATION.md), [`34`](34-REPO-STYLE.md),
> [`38`](38-RUNNING-THE-PIECE.md) — the engineering discipline and the
> operating manual. Everything else is Chinese, because it is the artwork
> talking about itself. If you are setting the piece up in a room and read no
> Chinese, [`38-RUNNING-THE-PIECE.md`](38-RUNNING-THE-PIECE.md) is written for
> exactly you and is self-contained.

## 新人（或新代理）从这三份开始

读完这三份就能开始改，**不要**一次读完 `docs/`：

1. [`../AGENTS.md`](../AGENTS.md) —— 读取路线、不变量，以及**开工前的基线自检**（EN）
2. [`02-ENGINEERING-PRINCIPLES.md`](02-ENGINEERING-PRINCIPLES.md) —— 宪法 P0–P20，每条附教会我们的那件事（EN）
3. [`10-SURFACES.md`](10-SURFACES.md) —— 什么真的跑通了（唯一可信，带证据栏）（中文）

然后按下面的表按需取用。所有**可调的数**都在
[`../packages/core/src/tuning.ts`](../packages/core/src/tuning.ts) 一个文件里。

**冻结契约**是 `packages/core/src/types.ts`、`03`、`04` 三处：**不自己改，停下来报告
`contract change needed: <原因>`**，由契约持有者统一改并广播（理由见 P0 / P11）。

## 语言

面向"进来改代码的人"的规范与纪律是**英文**：`../README.md`、`../AGENTS.md`、
[`02-ENGINEERING-PRINCIPLES.md`](02-ENGINEERING-PRINCIPLES.md)、
[`15-ORCHESTRATION.md`](15-ORCHESTRATION.md)、
[`34-REPO-STYLE.md`](34-REPO-STYLE.md)、
[`38-RUNNING-THE-PIECE.md`](38-RUNNING-THE-PIECE.md)。
它们的中文版**已被取代，不再维护** —— 两份规范一定会漂移，漂移的规范比没有规范更糟；
旧措辞在 git history 里。

作品本身的文档（`PRD` / `00` / `25` / `26` / `27` / `31`）和 `packages/` 里的全部代码注释
**保持中文**：它们记录的是"为什么"，中文写得更准。其余文档（规格、调研、部署）
标题多为英文、正文是中文，下表逐行标了语言。

## 契约（改代码前必须服从）

| 文件 | 回答什么问题 | 语言 | 谁必须读 |
|---|---|---|---|
| [`02-ENGINEERING-PRINCIPLES.md`](02-ENGINEERING-PRINCIPLES.md) | 这个项目怎么判断一次改动值不值得做？**全项目宪法**：落点与工艺标准、排优先级的四问、P0–P10、以及这一路踩出来的 P11–P20（每条附教会我们的那件事） | EN | 所有人，反复读 |
| [`03-SPEC-part-library.md`](03-SPEC-part-library.md) | 一件部件在磁盘上长什么样？`parts.json` 格式与规范化保证（**冻结**） | 中文 | 资产流水线 + 运行时 |
| [`04-SPEC-rig-and-attach.md`](04-SPEC-rig-and-attach.md) | 一件部件怎么长到骨头上？坐标系、单位、骨架拓扑、挂载数学（**冻结**） | 中文 | 任何碰几何/姿态的人 |
| [`05-SPEC-genome-and-evolution.md`](05-SPEC-genome-and-evolution.md) | 身体凭什么变复杂？genome 抽取、运动特征、演化、生命周期 | 中文 | 形态/交互 |
| [`06-SPEC-runtime-protocol.md`](06-SPEC-runtime-protocol.md) | 模块之间说什么话？模块间接口、慢回路 HTTP 协议 | 中文 | 跨模块工作 |
| [`12-SPEC-themes.md`](12-SPEC-themes.md) | 开场那一页怎么选物种？anchor 一致性流程、选择页 | 中文 | 资产 + 开场页 |
| [`14-SPEC-roster.md`](14-SPEC-roster.md) | 可以变成哪些身体？物种谱系、三种 kind、clearance 门、素材策展 | 中文 | 资产 |
| [`16-SPEC-acts.md`](16-SPEC-acts.md) | 加一个新玩法要挂在哪？Act / World / Director 扩展点 | 中文 | 加新玩法 |
| [`17-SLOW-LOOP.md`](17-SLOW-LOOP.md) | 慢回路服务端怎么接？端点、预算、血统池、失败矩阵、前端接口 | 中文 | 接慢回路 |
| [`23-SPEC-ui.md`](23-SPEC-ui.md) | 这一帧画面上该有什么？**每个场景的 UI + 全部边界情况** | 中文 | 任何碰画面的人 |
| [`29-SOUND.md`](29-SOUND.md) | 声音从哪来、绑在哪个信号上？四层结构、现场怎么调、怎么关 | 中文 | 任何碰声音的人 |
| `../packages/core/src/types.ts` | 共享类型到底是哪些？（**冻结**） | 代码 | 所有人 |

## 作品：为什么做、做成什么样算做完

| 文件 | 回答什么问题 | 语言 |
|---|---|---|
| [`PRD.md`](PRD.md) | 做成什么样才算做完？观众的 90 秒、三条排他主张、完成的定义、当前最大缺口 | 中文 |
| [`00-PROJECT-BRIEF.md`](00-PROJECT-BRIEF.md) | 我们到底在做什么，为什么？意图、对原作的逆向结论、成功判据、非目标 | 中文 |
| [`25-COMPLETENESS.md`](25-COMPLETENESS.md) | 离"完整"还差什么？内部账本 —— 诚实集中的三处之一（`26` §G） | 中文 |
| [`26-ARTWORK-STANDARD.md`](26-ARTWORK-STANDARD.md) | 怎么判断它是作品还是 demo？拿参考图谱的尺子量自己；§G 定了"诚实只放三处"这条规矩 | 中文 |
| [`39-SPECIES-AUDIT.md`](39-SPECIES-AUDIT.md) | 每个物种渲染出来的，是不是它声称的那一个？29 条逐条判决、五个系统性成因、`check:parts` 看不见的那几种坏法 | 中文 |
| [`41-MATERIAL.md`](41-MATERIAL.md) | 三分钟里身体的**表面**在说什么？四个乐章 → 一条连续的表面曲线（`MATERIAL` 块）；描边翻成默认之后这条线为什么反而更准；手脚的墨为什么按槽位收窄 | 中文 |
| [`27-BRAND.md`](27-BRAND.md) | 对外物料长什么样？品牌字体规范、海报与票根（导出在 `../assets/brand/`） | 中文 |
| [`31-ARCHETYPES.md`](31-ARCHETYPES.md) | 每个物种的参考来自哪台真机器？16 个 archetype ↔ roster id 对表、prompt 摘要、bodyPlan 不符清单 | 中文 |
| [`42-REAL-MACHINES.md`](42-REAL-MACHINES.md) | 那台真机的**几何**在哪、授权是什么？18 条对表与三档判定（实·有几何／实·无几何／虚）、逐台来源 URL 与授权、取件的字节与工程量、命名建议 | 中文 |

## 背景（是 context，不是 contract）

| 文件 | 回答什么问题 | 语言 |
|---|---|---|
| [`01-ARCHITECTURE.md`](01-ARCHITECTURE.md) | 整个系统怎么分层？全景图、ADR 摘要、并行泳道 | 中文 |
| [`07-HYPER3D-API.md`](07-HYPER3D-API.md) | Rodin 怎么调、一次多少钱？事实卡（实测，不是记忆） | 中文 |
| [`08-OPEN-SOURCE-BASE.md`](08-OPEN-SOURCE-BASE.md) | 底座为什么选这些？开源清单与取舍、Plan B | 中文 |
| [`09-RISKS-AND-UNKNOWNS.md`](09-RISKS-AND-UNKNOWNS.md) | 什么还可能崩？不确定性登记册 + 现场风险（§A 是逆向原作的完整依据） | 中文 |
| [`13-DEPLOY.md`](13-DEPLOY.md) | 网页版怎么上线、域名怎么接？现场形态 vs 网页形态、Vercel、体积与隐私（§7 说明 Vercel 项目名为何仍叫 `second-body`） | 中文 |
| [`18-BODY-PLANS.md`](18-BODY-PLANS.md) | 为什么物种看起来都一样，怎么治？**头号设计缺陷**的诊断与 A / B 两档解法 | 中文 |
| [`19-RESEARCH-morphology.md`](19-RESEARCH-morphology.md) | 成熟项目怎么做形体重定向？ | 中文 |
| [`22-RESEARCH-procedural-bodies.md`](22-RESEARCH-procedural-bodies.md) | 不用部件也能有身体吗？程序化身体表达调研 | 中文 |
| [`24-RESEARCH-mocap.md`](24-RESEARCH-mocap.md) | 追踪能信到什么程度？MediaPipe Pose 精度 —— 上游弱点、可移植的后处理、换档取舍 | 中文 |
| [`28-RESEARCH-stage.md`](28-RESEARCH-stage.md) | 舞台该长什么样？同类装置做了什么，以及每条结论对应改哪个参数（四套场景的来路、地平线/接触阴影/反射/粒子的取舍） | 中文 |
| [`30-ASSET-INTAKE.md`](30-ASSET-INTAKE.md) | 怎么喂一张参考图给素材工厂？要求与工厂命令（每条都是烧过 credits 买来的） | 中文 |
| [`32-RESEARCH-editorial.md`](32-RESEARCH-editorial.md) | 作品集版面怎么排？实测与落点 | 中文 |
| [`33-RESEARCH-open3d.md`](33-RESEARCH-open3d.md) | 哪些开源真实 3D 资产能用？调研、实测与授权 | 中文 |
| [`35-VISCOSE.md`](35-VISCOSE.md) | 首屏那个环从哪来、能不能用？移植出处、授权判定、GLSL→TSL 逐条差异 | 中文 |
| [`43-ARCHIVE.md`](43-ARCHIVE.md) | 每一次到访要不要留下来、留下什么、留在哪、怎么回放？**八条岔路已于 2026-09-14 全部裁定**（§9），A 档正在实现：一条记录的四档与实测字节、存储选型与三个规模的钱、命名的法律轴与艺术轴、隐私文案两版、降级矩阵、最小第一步 | 中文 |
| [`44-THESEUS.md`](44-THESEUS.md) | 身上的零件怎么一件一件被换成别人的，换到最后一件原件都不剩？**这条线的主轴**：替换速率与十八个槽位的覆盖证明、按陈旧度和「你正在用哪只手」抽签、借件距离怎么越借越远、以及「四个乐章留名字删边界」那条裁定 | 中文 |
| [`45-ARCHIVE-RITUAL.md`](45-ARCHIVE-RITUAL.md) | 存档建好了，谁去让它真的开始记？**一页有回执的仪式**：装置那台机器一条命令、不需要任何账号（今天就能做），网站那半边等一个有 Vercel 权限的人（晚做不坏事，页面在那之前不会说假话） | 中文 |
| [`48-CAPTURE-SMOOTHNESS.md`](48-CAPTURE-SMOOTHNESS.md) | 打开摄像头为什么先黑、一顿才出来，动作一大为什么卡？**测量先于改动**：基线与改后的启动时间、长任务、帧间隔，推理进 worker、姿态时钟、全页帧调速器的阶梯与不闪的判据，灾难情形怎么恢复，还没做的按收益排好 | 中文 |
| [`46-FIELD-CHECK.md`](46-FIELD-CHECK.md) | 找一个人站到摄像头前，十分钟里该看什么？**一页不用读代码的检查表**：三分钟里依次会发生什么（秒数来自代码）、十一个是/否观察项、什么情况算坏了、调试地址怎么加速复现 | 中文 |
| [`47-TRANSITIONS.md`](47-TRANSITIONS.md) | 页面之间每一跳量出来是什么样？27 跳前后实测（底色跳变、空帧、308、重新验证、往返缓存）、改了什么、**跨页过渡为什么关着**、逐页导航审计 | 中文 |
| [`50-MULTI-PERSON.md`](50-MULTI-PERSON.md) | 两三个人同时站到摄像头前，谁是谁、谁拿到身体、身体站在哪、帧预算放得下几具？**多人入镜的设计、落地与没做完的清单** | 中文 |
| [`52-STAGE-INTERACTION.md`](52-STAGE-INTERACTION.md) | 台上的机器人能不能用鼠标拖、转视角、拽一件零件？**计划，未落地**：路由、轨道限位、受力、边界与守卫 | 中文 |
| [`53-BACKLOG.md`](53-BACKLOG.md) | 还有什么没做完、先做哪件？**待办队列**：P0–P3 排好，每条带现象、证据位置、下一步第一件事 | 中文 |
| [`54-TRANSFORMATION-CAUSALITY.md`](54-TRANSFORMATION-CAUSALITY.md) | 身体怎样逐渐变成他者、却始终让观众读出“那一下来自我”？**变化的产品语法与最小技术架构**：实时载波、局部动作映射、单手 / 低概率整臂脱离、承重链与地面不变量、分阶段验收 | 中文 |
| [`51-CLOSEOUT.md`](51-CLOSEOUT.md) | 第零步之前负责人提过的所有诉求，现在各自是什么状态？**一条一条过的收口清单**：落在哪、怎么验、做完 / 只在无头环境验过 / 在跑 / 暂缓，文末是最后一次整体验证 | 中文 |

## 状态与流水

| 文件 | 回答什么问题 | 语言 |
|---|---|---|
| [`10-SURFACES.md`](10-SURFACES.md) | **什么真的跑通了** —— 唯一可信的状态表，每行带证据 | 中文 |
| [`11-TASKS.md`](11-TASKS.md) | 现在能领什么活？可分派的任务卡 | 中文 |
| [`CHANGES.md`](CHANGES.md) | 哪些决定已经定了、又关掉了什么门？durable 变更的 append-only 记录（`Forecloses:` 格式） | 中文 |
| [`15-ORCHESTRATION.md`](15-ORCHESTRATION.md) | 多条线并行怎么不撞车？泳道、合并顺序、踩过的坑 | EN |
| [`34-REPO-STYLE.md`](34-REPO-STYLE.md) | p-to-q 的 README 应该怎么写？逐条带出处的对照与我们的差距（其中的 `second-body:N` 引用是读取当时的仓库名，**有意不改**） | EN |
| [`38-RUNNING-THE-PIECE.md`](38-RUNNING-THE-PIECE.md) | 怎么在一个房间里把它跑起来？硬件与摄像头要求、开哪个 URL、全部 URL 开关一览（从 `shell/kiosk.ts` 现读）、权限为什么推迟到观众按下「开始」、正常与降级怎么一眼分辨、出问题怎么办、什么会离开这台机器 | EN |
