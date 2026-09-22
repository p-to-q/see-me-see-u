# Changes

Append-only，最新在上。每条几行。
只记录 **durable** 变更：坐标系约定、资产格式、协议、渲染模型、provider、部署。
本地可逆的改动写在 commit 里，不写这里。

格式：
```
## YYYY-MM-DD — 一句话
Changed:    现在什么是真的
Why:        原因，不是复述
Forecloses: 这让什么变难或不可能
```

---

## 2026-09-22 — 原创源代码改用 Apache-2.0，标准许可与第三方边界分开
Changed:    根 `LICENSE` 换成与 p-to-q 其他仓库逐字节一致的 Apache-2.0 标准正文；项目 `NOTICE` 与 `THIRD_PARTY_NOTICES.md` 独立记录 Viscose、真实机器几何、Rodin 输出、字体、回放姿态、声音、依赖和作品 / 品牌边界；根 manifest 与五个 workspace manifest 声明 `Apache-2.0`，内部 workspace 全部 `private`；网站构建把三份法律文件带进 object-form 产物，`/about` 直接链到它们。
Why:        旧 `LICENSE` 把 MIT 正文与项目范围限制混在一个文件里，GitHub 只能识别为 `NOASSERTION`，也让「代码开源」与「整个仓库所有东西都是同一许可」混在一起。标准正文使专利授权与再分发义务可被工具识别；独立清单让第三方权利不被 Apache 错误覆盖。
Forecloses: 从此不许在 Apache 正文后附加「不得复展」等项目限制；不许把代码许可写到 `VisualArtwork`、字体、模型、音频或品牌上。ZKMSerendipity 的公开 Git / webfont 分发范围仍需权利人证据；清单会照实写这个未验证边界，不用换许可掩盖它。

## 2026-09-14 — 跨页过渡开着：截图之前冻 GPU 画布，叠层底是底色令牌
Changed:    `@view-transition` 回到 `type.css` 与 `index.html`；`pageswap` 里舞台 / 环在同一个任务里画一帧拷成 2D 图；
            `::view-transition` 底 = `--sb-paper`；展出页入口 `blocking="render"`；共享元素由 `declareShared` 声明；
            门槛 `transitionAllowed`（reduce / `?vt=off` / 现场 / 前进后退 / 活摄像头 / 不支持）；看门狗 630ms。
Why:        第一轮的白帧根因是 WebGPU 画布出了绘制任务就读不到、叠层缺省透明。修完后有头 Chrome 只剩摄像头舞台离开与 404 → 展签
            两类仍白（15a 6/7、17 5/7、16 2/7、14b 7/7），加门槛后 2 轮 30 跳 0 白（docs/47 §4.3）。
Forecloses: 新增一块 WebGPU 画布而不 `registerFreezable`，离开那一页会一刀切到新底色；新增共享元素只能走 `declareShared`
            （测试禁止别处写 `view-transition-name`）；展出页的入口模块从此挡住第一帧。

## 2026-09-14 — 换页：底色在第一帧之前定；跨页过渡关着（已被上一条取代）
Changed:    `index.html` 在任何脚本之前按 URL 挂首屏配色（`ui/transitions.ts` 的 `groundFor`，抄本由测试逐条对）；
            选择页等舞台第一帧再同文档交棒；跨页 View Transition 全部 `none`，`@view-transition` 从样式表里拿掉。
            `vercel.json` 给 `/fonts/*` `/sound/*` 一天缓存。回到大厅带 `?hall=1` 落在选择页。
Why:        冷开 `/` 先闪 707ms 深底再翻纸（跳变 240）；选择页一帧翻深、中间 ~450ms 无帧（198）。
            跨页过渡在无头 Chrome 上每一类跳都量出过整帧纯白，两次归因被推翻，原因未明（docs/47 §4.3）。
Forecloses: 首页的第一帧底色从此由 URL 决定 —— 新增一个"没有 theme 却不进选择页"的入口，必须同时改
            `groundFor` 和 `index.html` 的抄本（测试会红）。开回跨页过渡必须先在真显示器上量，并改掉那条
            「跨页过渡整个关着」的测试；`?hall=1` 成了一个会出现在地址栏里的参数。

## 2026-09-13 — 叠在画面上的字，改成按**角上那块底**翻，不再按正中那团晕
Changed:    `publishStageInk()` 的输入从 `look.bgBottom` 改成 `look.skyTop`，判据搬进
            `look.ts` 的纯函数 `stageInk()` / `overlayGroundLuma()`，两套墨登记成
            `STAGE_INK`（两侧都在，`css-tokens.test.ts` 那条仍然成立）。阈值 0.18 没动。
Why:        `applyScene` 把 `bgBottom` 设成 `skyGlow` —— 身体背后那团晕，画面里最亮的一块，
            而且长在正中；字坐在两个角上。实测 1600×900、五套场景 ×  弧线 0/0.35/0.65/1.0、
            右上角节题与左下角那一行底下的真实像素：「夜潮」晕 0.592 / 角 0.0017，
            「逆光」晕 0.603 / 角 0.0013 —— 旧输入在这两套上发深墨，对比度 1.14–1.36:1，
            20 格里错 8 格。改后 20 格全部翻对，最低 6.98:1。
            两套墨对比度相等的交点算出来是 0.166，**错的从来是输入不是那个数**。
Forecloses: `bgBottom` 从此不许再被当成"底色"读 —— 它是晕，不是背景，`test/stage-ink.test.ts`
            第三条直接钉住输入字段。新增第六套场景**必须先量再进表**：那张实测表是断言的
            唯一依据，照着改数字而不重新量，仪表就会变回装饰（P21）。
            也因此排掉了三条更贵的路：逐帧采样渲染结果（角上像素在一套场景里跨弧线的
            极差 ≤0.05，身体够不到那两个角，没有它要解的问题）、按角发两套令牌
            （两个角在 20 格里从没落到两侧）、连续混色（两套墨本来就是两个极端，
            往中间灰里掺会让两边的对比度一起掉）。

## 2026-09-13 — 现场能选摄像头了（`?cam=`），而且选错会自己喊出来
Changed:    `?cam=<序号>` / `?cam=<deviceId 或唯一前缀>` 进 `readFlags()`（`shell/kiosk.ts`），
            选择逻辑是纯函数（`capture/camera-select.ts`），`WebcamCapture` 据此给
            `getUserMedia` 加 `deviceId: {exact}`。`?debug=1` 的 HUD 多一行 `cam <名字>`，
            开机时控制台另打一次全设备表（每行都能直接抄进 URL）。操作手册在 docs/06 §6。
Why:        现场是一台外接对着观众、一台内置对着墙，而这之前 `getUserMedia` 不带 `deviceId` ——
            用哪台**由浏览器决定**，操作员唯一的补救是拔线或改系统设置。
            设备表只在 stream 开起来之后才枚举：`enumerateDevices()` 不弹权限框，
            但权限之前它不给 label，而为了凑一张表提前要权限会正好毁掉入口层
            （`shell/entry.ts`）存在的全部理由。
Forecloses: 「要的那台不在」从此**不许静默**：`describeCamera()` 的判据钉死在
            `track.getSettings().deviceId`（现实）而不是我们请求的那个 id（意图）——
            以后谁把它改回"报请求值"，拔掉外接之后 HUD 会和一切正常时一模一样，
            装置就能对着一面墙演一整晚（P21）。`camera-select.test.ts` 守着这一条。
            序号写法是易变的（插拔即错位），所以它只是"找"的工具；任何开机脚本、
            任何写进文档的现场 URL 都必须用 deviceId 那一种。

## 2026-09-13 — 三个物种整具换成真实机器的原厂几何
Changed:    `compact` / `patrol` / `digitigrade` 各 10 个槽位改用真实 CAD（Unitree G1 / ANYbotics ANYmal C / Agility Cassie，全部取自 MuJoCo Menagerie 的钉死 commit），`node scripts/harvest.mjs --adopt` 可重放。`buildIndex()` 多一条规则：**一个 family 只要有一件 `source.provider === 'harvest'` 的件，它的生成件就整批不进 `parts.json`**（文件不删，还在 `assets/parts/` 里）。`parts.json` 198 → 196 件。再分发义务随之落地：`assets/parts/licenses/*.LICENSE.txt`、`assets/parts/ATTRIBUTION.md`（脚本生成）、`/about` 署名段多一条除外项。`digitigrade` 的 `bodyPlan` 从 `quadruped` 改回两足（docs/31 §4.1 记的那个实质性错判）；`char.idol` 的 base 从 `compact` 改成 `porcelain`。
Why:        真实存在的机器，它的身份**就是**那台真机 —— 用真 CAD 不只是更准，是更诚实（docs/26 §H）。而且它救的正是参考图采集失败的那几个条目。规则写成"按 family 整具换"而不是一张退役名单，是因为名单会和现实分叉；`curation.json` 没有被借用来做这件事，因为那里的 `reject` 有一个已经被用掉的含义（立场海报上唯一的颜色 = 被人眼剔掉的那十件），而这 32 件不是坏件。
Forecloses: 一个 family 从此不能真假混搭 —— 想给某个物种加一件生成件，得先让它的真实件全部退出。`assets/parts/` 里现在有不进索引的 glb，**扫目录得到的件数不再等于 `parts.json` 的件数**：海报的 `partsLive = parts.length - rejected.size` 因此当场改成了「数在池里的件」，而它的 `counts.parts` 从此混着生成件和取来的件（新增 `counts.partsReal` 用来分开，海报文案里「N 件生成」那一句下次出图前要改）。BY-SA 的源永久出局：BodyParts3D 的人体骨骼只要不能和 MIT 的代码分家，就不能入库。

## 2026-09-13 — `assets/demo/` 里有真人录制了；顺带测出"身体的前后位移不在数据里"
Changed:    `/dev/record.html` 多一条视频文件路（`?video=` / 选文件，逐帧 seek，不跟实时播放），用它对两段 CC BY-SA 4.0 的真人视频跑出 `pose-jumpingjacks.json`（45.2s）与 `pose-walkturn.json`（20.3s）。`/demo/index.json` 把真录制排在合成数据前面，所以 `?demo=1` 默认不再挑到 `pose-synthetic`。来源、授权、质量报告在 `assets/demo/SOURCES.md`；原料视频在 gitignore 的 `assets/capture-src/`。docs/09 的 U14 结掉、U2 结掉、U1 结掉一半。
Why:        `?demo=1` 是现场断网 / 摄像头翻车时的唯一兜底，也是线上部署实际跑的那条路，而它之前放的是一段 2 秒的程序生成数据 —— 等于没有兜底。MediaPipe 在真人视频上的输出**就是真实录制**：真的关节抖动、真的遮挡、真的前缩。左前臂骨长变异系数从合成数据的 65.7% 降到 9.2%／11.1%。
Forecloses: **MediaPipe `worldLandmarks` 的原点就是胯中点，所以整具身体的前后位移根本不在 `raw.world` 里** —— `pelvis.z` 恒等于 0 是定义不是测量。`pose-walkturn` 里人走远又走近（画幅内肩宽 211×），`world` 里的胯一动不动。`core/skeleton.ts` 只消费 `raw.world`，于是**观众往前走一米，生物不会往前走**；想要它动，必须另找信号（`screen` 尺度等）推全局位移，那是新的一张卡，不是调参。四肢相对躯干的深度则是可用的（跨度/抖动 51–128×），不用退 2.5D。
## 2026-09-13 — A 档新增两种**真的不是人**的拓扑，六个条目挪走
Changed:    `BodyPlanId` 增加 `radial`（无躯干：四条肢摊成四条绕核心的轨道弧，核心压到 0.40）与 `column`（单柱：六块腿骨串成一根桅杆，双臂是顶端分支，蹲下按之字折叠）。两者输出仍是 17 根骨头的合法 `Skeleton`，走现有刚体渲染器。`orb`/`furball`→`radial`，`manipulator`/`screenface`→`column`，`autonomous`→`quadruped`，`xeno`→`inverted`，`char.paper`→`towering`。`radial` 与 `inverted` 改成按**整体最低点**贴地（`PLANS_WITHOUT_FEET`），不再按"最低的脚"。
Why:        之前只有 `quadruped` 和 `mass` 真的换拓扑，`towering`/`stub` 只改比例 —— 所以 `xeno`（异形）、`orb`（球）、`furball`（毛球）这些"全部意义就是不是人"的条目仍然是穿着涂装的人形。光改数据解决不了，缺的是拓扑。选 A 档而不是 B 档，是因为 A 档**不作废任何已生成的部件**（这六个条目共 50 件）。
Forecloses: `radial` / `column` 的比例是**先缩放人体、再换拓扑**（与 `quadruped` 相反），因为 `proportion()` 依赖"肩是肩、胯是胯"这套语义，而这两个拓扑把它拆了 —— 以后给它们加比例参数必须记住这个顺序。`radial` 的两条腿弧没有骨头连回核心，想给它们加系绳就要新增骨头，那是改冻结契约。`inverted` 的落地语义变了：之前按脚（头会沉到地板下），现在按整体最低点。

## 2026-09-13 — 脚不再按"管子"挂：`attach` 多了 `axisLength` 与 `anchor`
Changed:    `AttachOptions` 增加两个可选项：`axisLength`（直接给长轴的世界尺寸，`mode` 只再管横向）与 `anchor`（部件长轴上的哪一点钉在 `bone.p0`，默认 0 = 原来的 socketA）。`foot` 槽位据此挂：长度由脚骨推（`FOOT.lengthOfBone` + 钳位），踝钉在脚长三成处。`SLOT_WIDTH.foot` 从 0.21 改成 0.115，含义从"整体大小"变成"脚宽"。
Why:        `mode` 的两档都默认**骨头量的就是部件长轴、且插座在端点**。脚两条都不满足：ankle→footIdx 量的是踝到脚尖（脚跟在踝后面，没人量它），而踝在脚长三成处、脚背上方。结果是整只脚 0.39m 从脚踝往前平铺、戳穿地板 —— 看起来就是"脚掉在地上"。同一件事的另一面是 `foot` 长轴朝向那个 12:12 硬币：脚的两端本来就没有"哪端更粗"的定论。
Forecloses: `SLOT_WIDTH` 这张表现在有三种读法（stretch = 横向宽度 / uniform = 整体大小 / foot = 脚宽），读之前必须先看 `SLOT_FIT` 和 `FOOT`。脚的长度从此与 `SLOT_WIDTH` 无关，只能从 `FOOT` 调。

---

## 2026-09-13 — 左右镜像改由几何承担，不再由负 X 缩放承担
Changed:    左侧肢体用 `library.mirrored(partId)` 给的预镜像几何（X 取反 + 三角形绕序翻回来），挂载矩阵不再带负 X 缩放。`InstancedMesh` 的分桶键因此多一维（部件 × 左右 × 材质）。
Why:        负行列式把左半身的三角形全变成背面，而 `DoubleSide` 对背面片元会把法线取反 —— 左半身"从内部被照亮"，比右半身暗一大截。现场看到的"左右手像两种完全不同的材质"就是这个，跟材质无关。`DoubleSide` 从来没有绕开这个问题，它只是让破绽看得见。
Forecloses: 每个镜像件多一份几何（~3k 面）与一个 draw call；`PartInstance.mirrored` 的含义从"矩阵里有负缩放"变成"要用预镜像几何"，任何自己消费 `assemble()` 的渲染端都必须跟着改，否则左半身会朝里翻。

---

## 2026-09-13 — 材质按物种收敛，而不是三个全局材质各管各的
Changed:    `core/palette.ts` 把 `secondary` / `accent` 两个角色向**该物种自己的 `primary`** 收敛（色调、明度差、粗糙度/金属度），旋钮在 `PALETTE`。自发光材质原样放行。渲染端的材质缓存键因此带上主色 id。
Why:        genome 已经把部件约束在同一家族里了，材质却没有 —— 三个角色各取一个全局材质、彼此没有关系，读起来是"装错了零件"而不是"一个物种"。
Forecloses: 材质不再是"查一张全局表"，同一个 `matte.ash` 在不同物种上是不同的颜色 —— 任何按 `materialId` 做缓存或做对照的代码都必须带上物种主色。收敛系数调到 1 会把物种做成一个色调，那会毁掉 docs/PRD §5 第 3 条判据（`palette.test.ts` 里有一条护栏盯着）。

---
## 2026-09-12 — 挂载分成 stretch / uniform 两种模式
Changed:    `SLOT_FIT` 决定一个槽位是"沿骨头拉长"（四肢）还是"三轴同比例、尺寸由 `SLOT_WIDTH` 定"（头/躯干/手/脚/关节）。`SLOT_WIDTH` 对 uniform 槽位读作"整体大小"。
Why:        装配预览里头被颈骨压成了一坨 —— 头不是一段可以被拉长的管子。把"有固有比例的物体"和"可拉伸的管子"分开，是让身体看起来像身体的最小改动。
Forecloses: `SLOT_WIDTH` 这张表现在同时承担两种语义，读的时候必须先看 `SLOT_FIT`；uniform 槽位的部件不再随骨长变化，很长的颈/脚骨不会再被表达出来。

---

## 2026-09-12 — 引入 theme 轴，与 tier 正交
Changed:    资产目录重构为 `theme × slot × variant`（`<slot>.<theme>.<variant>`）。六个主题：porcelain / industrial / patrol / xeno / coral / field。`PartLibraryIndex` 增加 `themes[]`，`Genome.family` 改名 `Genome.theme`。观众在开场轮播里选主题，tier 仍由运动挣得。
Why:        "换一套皮肤"和"变得更复杂"是两件事，之前用同一个 family 字段表达，导致演化和风格互相绑架。分开之后，主题可以独立增加而不影响演化曲线。
Forecloses: 旧的 `<slot>.<family>.<variant>` id（shell/mech/bloom）全部作废，对应的 ledger 条目不再匹配；跨主题混搭只能发生在 tier 3 的少数槽位，不能任意组合。

## 2026-09-12 — 主题内风格一致性改由 anchor 图保证
Changed:    每个主题先 text-to-3D 生成 `spine.<theme>.a`，由 `/dev/anchor.html` 渲成 `assets/refs/<theme>/_anchor.png`，该主题其余 19 件全部走 image-to-3D。`factory:generate --theme=` 因此是两阶段的。
Why:        纯文字生成的一致性靠形容词碰运气（docs/09 U6）。用图做条件是 Rodin 直接支持的能力，而且参考图是我们自己渲的，不依赖任何第三方图片。
Forecloses: 加一个新主题不再是"写段 prompt"就够了，必须走一次 anchor 流程（多一次手动开页面）。同时 anchor 一旦定下，该主题的风格就被钉死了 —— 想改风格要重生成整个主题。

---

## 2026-09-12 — 部件规范化契约定为「主轴 +Y / socketA 在原点 / 长度 1」
Changed:    所有入库 `.glb` 在写入 `assets/parts/` 前被烘成这个姿态；`PartMeta.localGirth` 记录归一化后的横向尺寸，由运行时反算横向缩放。
Why:        把 per-part 特例全部推到资产侧，运行时的挂载数学退化成 `T(p0)·R(+Y→dir)·S(g,len,g)`，10 行、无分支、可单测。
Forecloses: 不能再直接使用外部下载的、未过流水线的 `.glb`；任何手工资产也必须跑一遍 `factory:normalize`。同时放弃了"部件自带局部偏移"的灵活性。

## 2026-09-12 — 刚体挂载，不做蒙皮（ADR-1）
Changed:    部件以刚体形式挂到骨头上，项目不含任何 skinning / 自动绑骨。
Why:        原作的机器人质感本身就来自硬表面刚体；刚体让任何 AI 生成的网格可以直接用，砍掉整个绑骨环节。
Forecloses: 布料/软体/肌肉类形态在 v1 不可能；关节穿插只能靠关节盖片遮，不能靠蒙皮平滑。

## 2026-09-12 — 资产流水线不依赖 Blender（ADR-3）
Changed:    规范化/减面全部用 `@gltf-transform` + `meshoptimizer`，纯 Node。
Why:        本机没装 Blender；统一 TS 工具链让协作者不用切换上下文。
Forecloses: 需要人工修模的部件必须离线在 Blender 里做完再走流水线，流水线本身不提供建模能力。

## 2026-09-12 — 运行时统一套自己的材质，丢弃生成资产的贴图
Changed:    `factory:normalize` 删掉所有 texture/material，运行时按 `MaterialDef` 统一上色。
Why:        50 个独立生成的部件贴图风格不可能统一；统一材质是"看起来像一个作品"而不是"素材堆"的关键。顺带把单件 2.3 MB 降到 ~110 KB。
Forecloses: 放弃了单件贴图里的细节信息（原始带贴图版本保留在 `assets/raw/`，可随时回头取）。
