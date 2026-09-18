# 13 · Web 部署

> 两个形态共用一套代码：**现场装置**（本机、全屏、有摄像头）和 **公开网页**（任何人打开）。
> 差别只在配置，不在代码路径。

## 1. 两个形态

| | 现场装置 | 公开网页 |
|---|---|---|
| 入口 | `npm run dev` / 本机 build，kiosk 全屏 | `https://<project>.vercel.app` |
| 摄像头 | 固定机位、可控灯光 | 用户自己的摄像头，环境不可控 |
| 慢回路 | localhost 代理（`packages/factory`） | Serverless function |
| 主题 | 轮播选择 or `?theme=` 锁定 | 轮播选择 |
| 兜底 | `?demo=1` 回放 | 无摄像头权限 → 自动进 `?demo=1` |

**网页版的第一原则：不要求授权也能看见东西。** 打开先播 demo 回放，
页面上一个"用我的摄像头"按钮，点了才请求权限。直接弹权限会流失绝大多数人。

## 2. 构建产物

```
packages/app/dist/          静态站点（vite build）
  index.html
  assets/…                  js/css
  parts/*.glb  parts.json   191 件，5.7 MB（meshopt 压缩后，平均 28 KB/件）
  refs/*/_anchor.png        轮播卡片图，21 张 1.3 MB（768² / 256 色）
```

`publicDir` 指向仓库的 `assets/`，所以部件和参考图会被原样拷进 `dist`。

> **2026-09-12 实测**：第一次真跑 `npm run build`，产物是 **975 MB** ——
> `publicDir` 指向 `assets/`，把 `assets/raw/`（929 MB）整个打进去了。
> 本文档 §2 早就写了"raw 绝不进 dist"，但没人验证过。
> 现在由 `vite.config.ts` 的 `shipAssets()` 只复制 `parts / refs / demo`。
> **规格写了不等于做到了。** 产物当时降到 45 MB（后来压到 20 MB，见下面的体积预算）。

### 体积预算

| | 目标 | 2026-09-12 实测 |
|---|---|---|
| 产物总量 | — | **38 MB → 20 MB** |
| 到「第一具身体出现」的字节 | < 3 MB | **8.58 MB → 3.14 MB** |
| 同上的请求数 | — | 36 → 36 |
| 单个部件 glb | ≤ 1.5 MB | 平均 130 KB → **28 KB** |
| 21 张 anchor 图合计 | < 1.5 MB | 6.12 MB → **1.27 MB** |

- 首屏只需要：`parts.json` + 被选主题的 tier≤1 部件 + 卡片图 → **目标 < 3 MB**。
- 其余部件**懒加载**：选完主题再拉该主题的，tier 升级时再拉更复杂的。
- `assets/raw/` 绝不进 dist（.gitignore 已排除）。

> **2026-09-12 实测二**：「首屏 1.9 MB」这个数字只数了 `index + JS + parts.json`。
> 真按「观众打开页面到第一具身体出现」量，是 **9.4 MB / 46 个请求** ——
> 因为 `src/choose/choose.ts` 在出卡片**之前**要把**所有** 21 张 anchor 图拉齐（6.1 MB），
> 那比部件本身还重，而且以前没人把它算进首屏。
> **没有基线就没有优化，而基线要按观众的那条路径量，不是按目录量。**

三件事把它压下来（每件都能单独重跑，都是幂等的）：

1. **部件 meshopt 压缩** —— `npm run factory:compress`（出口逻辑在
   `packages/factory/src/normalize.ts` 的 `writePart()`，`normalize` 也走它）。
   191 件 **19.4 MB → 5.4 MB（3.6×）**，顶点最大偏移 5.8e-5 m，`check:parts` 仍然 0 错。
   **代价**：运行时 `GLTFLoader` 必须挂 `MeshoptDecoder`（`src/assets/library.ts` 已挂）。
   忘了挂不会报错，只会 191 件全部回退占位几何 —— 由
   `packages/app/test/library-meshopt.test.ts` 守着。
2. **anchor 图瘦身** —— `npm run factory:refs`：1024² 真彩 → 768² / 256 色调色板，
   **6.12 MB → 1.27 MB（−79%）**。URL 仍是 `_anchor.png`（`choose.ts` 里写死的），
   容器不变，只降分辨率和色深；卡片是 1024×512 的 cover 裁切，而轮播本身就在抖动，
   看不出差别（对比图见提交说明）。
3. **tier 分档预取** —— `library.preload()` 只 await tier ≤ 1 的件，tier ≥ 2 进后台队列；
   选择页展示期间预取轮播最前面几个主题的 tier ≤ 1 件；某家族 tier T 被预取时顺手
   预热 T+1。策略全在 `src/assets/library.ts` 里，见该文件的 §预取策略。

### 持久缓存：**暂时不做**

评估过 Cache Storage + 版本键（`parts.json` 里有现成的 `generatedAt`，
`version` 是写死的 1，真要用得改成每次生成递增）。结论是**现在不值得**：

- 压缩之后**整个部件库只有 5.4 MB**，单个主题的 tier≤1 那一档是 0.23 MB。
  省下来的那点字节买不回一层缓存的复杂度。
- `max-age=86400` 已经覆盖了真正的重复访问场景：现场装置是同一台机器跑一整天，
  24 小时内二次加载根本不发请求；公开网页的访客绝大多数是一次性的。
- 代价是新增一个**独立于 HTTP 缓存的真相来源**，而它失效时的症状正是
  `immutable` 被禁掉的那个症状：部件重生成后旧访客永远看见旧几何。
- 什么时候回头做：部件总量超过 ~30 MB，或者现场需要**离线**跑。
  那时再做，并且用 `generatedAt` 当 cache name，不要用 `version`。

## 3. Vercel

```
配置已经落在仓库根的 `vercel.json` 里（buildCommand / outputDirectory / 缓存头），
不需要在面板上手填。Node 版本必须是 **22.x** —— 我们靠 type stripping 直接跑 `.ts`。

缓存策略（依据见 `docs/20` 调研）：
- `/assets/*`（vite 产出、文件名带 hash）→ `max-age=31536000, immutable`
- `/parts/*.glb`、`/refs/*`（**文件名不带 hash**，重生成后同名）→ `max-age=86400`，
  **不能用 `immutable`** —— 那会让重生成的部件在旧访客那里永远不更新
- `/parts/parts.json`（索引，必须新）→ `max-age=0, must-revalidate`
```

### 慢回路的 serverless 版本

`api/slow/submit.ts`、`api/slow/status.ts`、`api/slow/part.ts`，
协议与本地代理完全一致（`docs/06-SPEC` §5），换的只是宿主。

- `RODIN_API_KEY` 放 Vercel 环境变量，**只在 function 里读**（P8）。
- 公开网页上慢回路必须**限流**：每 IP 每小时 1 次 + 全局每日上限，
  否则一次分享就能把 credits 烧光。在 function 里硬编码上限，不要只靠前端冷却。
- 生成结果存 Vercel Blob（或任何对象存储），function 返回签名 URL。
- **默认关闭**：公开版用 `SLOW_LOOP_ENABLED` 环境变量控制，现场演示前再打开。

## 4. 浏览器兼容

- WebGPU：Chrome / Edge / Firefox 桌面、Safari 26+（含 iOS）、Android 12+ Chrome。
  three.js 的 `WebGPURenderer` 在不支持时自动回退 WebGL2 backend —— **必须真的测过回退路径**（P3）。
- MediaPipe：`@mediapipe/tasks-vision` 需要 WASM + 摄像头；iOS Safari 要用户手势才能开摄像头。
- 移动端：竖屏 + 前置摄像头其实很适合这件作品（全身入镜要退后一点）。
  移动端默认降到 tier ≤ 2、实例上限 32。

## 5. 隐私（网页版必须写在页面上）

- 视频**不离开浏览器**：姿态推理全在本地 WASM/GPU 里跑。
- 唯一会上传的是慢回路那**一张剪影 mask**，而且是用户主动触发的；
  不上传原始画面、不保存、不关联身份。
- 页面上要有一行说明 + 一个"不参与"开关。这不是合规姿态，是作品的一部分：
  一件关于身体的作品，对身体数据的态度就是它的态度。

> **「不参与」那一条已经落地了，但不是一个开关**（`docs/43 §9.5` 裁定，2026-09-14）。
> 网页版的入口层本来就不要求授权：不按「开始 / 用我的摄像头」，摄像头不开，
> 作品照样在放回放，而且**那一场不会被记进存档**（`main.ts` 的 `cameraOn` →
> `archive/visit.ts` 的 `live()`）。这条路一直存在，只是没有被命名 ——
> 现在 `/about` 的隐私段把它说出来了。加一个勾选框是 `docs/26 §F` 的反面清单。

### 5.1 存档的行住在哪（`docs/43 §9.3` 的落地）

> **2026-09-14 重裁，本节下面 Upstash 那一套现在是休眠备选。** 没有人有 Vercel 项目的权限，
> 设不了环境变量、装不了集成（`docs/43 §9.3` 重裁那一条）。线上存档走作品负责人自己
> Cloudflare 账号里的 Worker + D1（`packages/archive-worker/`），网站经由提交进仓库的地址找到它
> （`packages/app/src/archive/endpoint.ts`）。部署步骤、限流、以及 IP 在哪一层被经手的实话，
> 都在 `docs/45` 乙。下面的内容原样留着，给哪天有 Vercel 权限的人。

一次走完的相遇在服务端留下**一行**：序号、物种、粗到天的日期。
字段清单和它为什么只能是这三个，在 `packages/archive/src/visit.ts`，有测试钉着。

`§9.3` 裁的是**不加第二个部署目标**：站点在 Vercel 上，行就住在 Vercel 上，
具体哪一家由实现那条线按 Marketplace 的现状定。

**挑的结果（2026-09-14，`vercel integration discover --category storage` 的实际列表）：
Upstash for Redis（slug `upstash/upstash-kv`）。** 三条理由，按重要性排：

1. **序号是主键**（`§4.2`），而 `INCR` 是一条原子命令就给的。换成 Postgres 要
   建表、要迁移、要一个连接池；换成对象存储则根本给不出单调序号（`§3.3`）。
2. **它的口子是 HTTP**，所以这条回路一个依赖都不用加（`AGENTS.md` 那条）。
   `packages/archive/src/store.ts` 里的 `restStore()` 就是全部，四条命令。
3. Neon 那条路（`§3.6` 记的）有**5 分钟无活动冷启动**和免费额度用尽后 compute
   挂起。这一页是一个几天才有人打开一次的页面，冷启动正好命中它。

**这条线没有开通它。** 开通要花钱、要改项目所有者的 Vercel 设置 ——
那是作品负责人的动作。要做的事按顺序：

```bash
vercel link                                   # 还没 link 过的话
vercel integration add upstash                # 面板上会开一个授权页，在那里建 database
vercel env pull .env.local                    # 把注入的变量拉下来核一眼
vercel --prod                                 # 重新部署一次，函数才读得到新变量
```

（也可以全在面板上点：Vercel 项目 → Storage → Browse Marketplace →
Upstash for Redis → Create，区域选离 `useeme.ptoq.io` 的读者最近的那一个。）

集成会自己注入环境变量，**不需要手填**。代码认两套名字（`store.ts` 的
`createVisitStore`），装哪一版都不用改代码：

| 变量 | 用途 |
|---|---|
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | 集成注入的那一对，优先 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 另一套常见命名，同样认 |
| `ARCHIVE_FILE` | 本地盘那条路。dev server / `vite preview` 自己设；装置那台机器用它（`§7.3`） |

**开通之前线上是什么样：** `createVisitStore()` 返回 `null`，
`/api/visit` 与 `/api/visits` 一律 **404 `{code:'DISABLED'}`**，
`/lineage` 因此仍然是「这条回路只在装置现场活着」那一句。
**不退回内存计数器** —— 那个数会随函数实例重置，贴在「这一叠不会变薄」下面
就是 `docs/02` P21 那种读数为真、说的是错的那件事的仪表。

**免费档够不够：** 一行是 60 字节（`docs/43 §2.1` 量过）。一百万次到访 = 59 MB，
每次到访是 2 条命令（`INCR` + `LPUSH`），打开一次 `/lineage` 是 2 条（`LRANGE` + `LLEN`）。
免费档的具体额度以开通那天面板上写的为准 —— 这里不抄一个会过期的数字，
但要记住判据：**这份存档的瓶颈是命令数，不是字节数**，而且它一天的量级是三位数。

## 6. 上线检查单

### 搜索、社交卡与机器阅读层

`packages/app/src/site/discovery.ts` 是这一层唯一的事实源：公开页的
canonical URL、标题、描述和索引策略都在那里。Vite 构建期把元数据注入
初始 HTML，再从同一张表生成：

- `/robots.txt`
- `/sitemap.xml`
- `/manifest.webmanifest`
- `/llms.txt` / `/llms-full.txt`
- IndexNow 公开 key 文件
- 1200×630 真实舞台画面与方形字标 icon

8 张展陈页、`/404` 和 18 张 `/dev/*` 工作台都是有意公开的可索引页，
各自进 sitemap 并有自己的 canonical / description。`/404` 的内容仍可能被搜索引擎
自行判为 soft-404；仓库不伪装这个外部结果，但也不再主动发 `noindex`。
`/poster/*` 与任何未登记新页仍默认 `noindex` ── 它们是打印渲染面或未裁定表面。

`llms*.txt` 只是方便机器阅读的建议性索引，不是网络标准，也不是「已被
AI 收录」的证据。真正承重的仍是可抓取 HTML、canonical、sitemap、
Schema.org 与外部链接。文案必须保留两条边界：线上只有快回路；慢回路是
现场限定，真实模型调用尚未验证。`packages/app/test/discovery.test.ts` 守这两句，
同时禁止把 Apache-2.0 误写给作品实体。

生产部署稳定后可跑：

```bash
npm run seo:indexnow -- --dry-run   # 先查准备提交的 canonical URL
npm run seo:indexnow                # 部署后再提交；不替代 Google Search Console
```

它使用这个站自己的公开 key，不复制 `ptoq.io` 或其他仓库的 key。

> 2026-09-14 过了两遍，证据在每一条后面。第一遍是 `main@5e1f97d`；第二遍是乐章边界、读数、控件三条合并之后的 main
> （首屏 98 个请求 2.06 MB、无摄像头权限 0 错、无 WebGPU 0 错，结论与第一遍相同）。线上入口与推上去的构建逐字相同时才算过。
> **没有真人、没有真摄像头、没有真 GPU 的那几条照实写了没验。**

- [x] `npm run check` 通过 —— 第二遍：core 227/0，app 436/0，check:parts 247 件 0 错
- [x] `dist` 首屏 < 3 MB —— 走完标签页 → 选择页 → 舞台，100 个请求 2.06 MB
- [x] 部件真的解出来了 —— meshopt 测试是门，过了。**没验**：线上 `?debug=1` 的 loaded 数（headless 没有真 GPU）
- [x] 无摄像头权限时不白屏 —— **行为和这一条原文不同，以代码为准**：不进 demo 回放，舞台照常跑，
      左上写「打开摄像头，它就能看见你」、右下「摄像头 关着」；0 个未捕获错误
- [x] WebGL2 回退路径 —— 用脚本删掉 `navigator.gpu` 模拟，到得了选择页，0 个错误。**没验**：真机关 flag
- [x] 慢回路限流上限已硬编码 —— maxPerSession 1、maxCreditsPerJob 1、maxCreditsPerSession 1、maxCreditsPerDay 20
- [x] `assets/raw/` 没有被打进去 —— `build/ship-filter.ts` + 测试；构建时故意放进去的文件没出现在 dist
- [x] 隐私说明在页面上
- [x] 存档：存储是 Cloudflare Worker + D1（不是 `§5.1` 那条 Vercel 路，`docs/43 §9`）。
      `GET /visits` 返回 `{ok:true,total,entries}`；站点自己的 `/api/visits` 干净地 404，于是走 Worker。
      没往里写测试行。**没验**：大陆网络能否访问 `workers.dev`（打不开时页面照实不写存档那一行）
- [x] **存储要和这一版一起上，不能晚。** `/about` 的隐私段从这一版起写着
      「每一次到访只在服务端留下一行」（`docs/43 §6.2` 的裁定文案）。存储没开通时
      那一行写不出去，于是那句话在线上是**不准的** —— 而它正是 `docs/26 §G`
      那三处「诚实集中」之一，那三处必须逐字为真。开通是四条命令（`§5.1`），
      别让它欠着过夜


## 7. 域名

作品的地址是 **`u-see.me`**。不是风格问题 —— `second-body.vercel.app`
**已经被别人占了**（它返回一个同名的 React Native Web 应用），我们的默认地址
是 `second-body-one.vercel.app`，那串东西印不进说明牌。

### 架构：Vercel 出内容，Cloudflare 出解析

两层各管一件事，分开的理由是**大陆**：Vercel 的 `cname.vercel-dns.com`
在国内解析不稳，而 Cloudflare 的权威 DNS 在大陆有可用的 anycast 出口。
所以**域名的 NS 指 Cloudflare，Cloudflare 的记录指 Vercel**。

```
u-see.me  ──NS──▶  Cloudflare（权威 DNS）
                      │
                      ├─ A    @    76.76.21.21           代理关闭（灰云）
                      └─ CNAME www cname.vercel-dns.com  代理关闭（灰云）
                                        │
                                        └──▶ Vercel 项目 second-body
```

**橙云必须关掉。** Cloudflare 的代理会终止 TLS，Vercel 就拿不到
`.well-known/acme-challenge` 的回源，证书永远签不出来 —— 站点会挂在
"Invalid Configuration"。要 CDN 的话那是 Cloudflare 自己的事，不能同时。

### Vercel 项目仍然叫 `second-body`，这是故意的

仓库改名成 `see-me-see-u` 之后，**Vercel 项目名没有跟着改**。

改它会断三样东西：项目名决定 `second-body-one.vercel.app`；
`useeme.ptoq.io` 是别人按项目挂上去的；而域名验证记录也绑在项目上。
GitHub 那边的集成按**仓库 ID** 关联，改仓库名它自己跟着走 ——
所以"改仓库名"和"改 Vercel 项目名"是两件不相干的事，
只有后者会弄断线上地址。

下面所有写着 `second-body` 的地方指的都是**那个 Vercel 项目**，不是仓库。

### Vercel 侧（已完成，2026-09-13）

两个域名都已挂到项目 `second-body` 上，且 `verified: true`
（这个域名不在别的 Vercel 账号下，所以**不需要 TXT 验证**）：

```bash
curl -X POST -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  https://api.vercel.com/v10/projects/second-body/domains \
  -d '{"name":"u-see.me"}'
```

要什么记录由 `/v6/domains/<name>/config` 说了算，别背：

| 名称 | 类型 | 值 | 代理 |
|---|---|---|---|
| `@` | A | `76.76.21.21` | 关 |
| `www` | CNAME | `cname.vercel-dns.com` | 关 |

### 线上地址（2026-09-13 起）

**https://useeme.ptoq.io** —— 由有 `ptoq.io` 权限的人在他们那边挂好的。
推 `main` 就会更新，不需要我们这边再做任何事。核过一次：它服务的就是 `f29cb27`。

`u-see.me` 是作品自己的域名，还没接上（下面那一步）。两个地址并存不冲突：
`ptoq.io` 那个是 p-to-q 的作品列表里的位置，`u-see.me` 是这件作品自己的门牌。

### 还没做的那一步：把 NS 从 Spaceship 换到 Cloudflare

实测 `u-see.me` 的 NS 仍是 `launch1.spaceship.net` / `launch2.spaceship.net`，
A 记录指着 `54.149.79.189` / `34.216.117.25`（Spaceship 的停放页）。
这一步**必须在浏览器里做**，本机没有 Cloudflare 凭证。

1. Cloudflare → Add a site → `u-see.me` → Free。它会分配一对
   `xxx.ns.cloudflare.com`。
2. Spaceship → 域名 → Nameservers → Custom → 填那一对，保存。
3. 回 Cloudflare，DNS 里按上表加两条，**代理一律灰云**；
   Spaceship 扫过来的停放 A 记录删掉。
4. SSL/TLS 模式选 **Full (strict)**。Flexible 会和 Vercel 的强制 HTTPS
   撞成重定向循环。

NS 生效通常十几分钟到两小时。生效后 Vercel 会自己签证书，核一句：

```bash
dig +short u-see.me NS && curl -sI https://u-see.me | head -1
```

---

## 部署地址的真实状态（2026-09-13 实测）

**`second-body.vercel.app` 不是我们的。** 它返回一个 React Native Web 应用，
标题也叫 "Second Body"。所以那个默认子域**已经被别人占了** ——
我们的部署会落在 `second-body-<hash>-<team>.vercel.app` 这种带哈希的地址上。

这把域名这件事从"风格一致"变成了**必需**。落点见 §7：`u-see.me`。

下面这张表是在**本机生产构建**（`npm run build` + `vite preview`）上验的 ——
写它的时候还核不到线上地址。后来核到了：生产是 `second-body-one.vercel.app`，
再后来是 `useeme.ptoq.io`（见 §7；`u-see.me` 还没接上）。表里的结论仍然成立，但**它验的是产物不是线上**，
这个区别在 P21 的意义上是真的区别，所以不改成"线上实测"。

| 检查 | 结果 |
|---|---|
| `RODIN_API_KEY` 出现在 dist 里 | **没有**（逐字符串 grep 过） |
| `/__slow/*` 在普通 production preview 可达 | **404**，正确；只有本机 `SLOW_ENABLE=1` 才挂宿主，线上静态部署仍无端点 |
| `/__anchor` `/__curate` 返回 200 | 那是 **vite preview 的 SPA 兜底**，不是真端点。Vercel 上没有对应 rewrite，会是 404 |
| `/`、`/about`、`/making.html`、`/passport.html` | 全部 200 |
| dist 体积 | 23 MB |

**`/making` `/passport` 这种不带扩展名的地址只在 Vercel 上成立**（`cleanUrls: true`），
本机 `vite preview` 不支持 —— 本机测要带 `.html`。这不是 bug，但每次都会让人愣一下，
所以记在这里。
