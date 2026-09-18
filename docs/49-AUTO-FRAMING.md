# 49 · 自动取景（auto framing）—— 它叫什么、怎么做的、这件作品该不该要

> 2026-09-14。研究线，**没有改任何代码**。回答作品负责人的三个问题：
> ① Zoom / Meet 那种"人往边上走、画面跟过去把人留在中间"的功能到底叫什么；
> ② 有没有开源实现可以拆来看；③ 在 SEE-ME SEE-U 里做它合不合理。
>
> 标记：**[一手]** = 厂商文档 / 规范 / 源码；**[二手]** = 博客、社区帖、评测；
> **[未验证]** = 找过但没找到一手来源。源码条目是抓取 GitHub / googlesource 原文后读的，
> 引到的函数名与参数名来自原文，但**没有在本机编译或逐行复核**。

---

## 0 · 一句话结论

这类功能的通用名是 **auto framing / 自动取景**（Apple 叫 Center Stage，W3C 叫 `faceFraming`）。
它绝大多数是**数字裁切**：传感器拍得比输出宽，软件在里面挪一个小窗口；只有云台摄像头才真的转。
**它帮不了"人已经出画"**——裁切窗口不能伸到传感器外面去，而这件作品的问题恰恰是整个人（含脚）进不进画。
所以：**不要给 MediaPipe 的输入做自动取景**；左上角小屏幕的"跟随放大"可以以后再看；
**现在就该做的是反过来——现场把操作系统和摄像头自带的自动取景关掉**，因为它们对准的是**脸**，会把腿裁掉。

---

## 1 · 叫什么、各家怎么做

### 1.1 分类

| 做法 | 原理 | 代价 | 能不能救"出画" |
|---|---|---|---|
| **数字裁切（digital crop / digital window）** | 超广角或高分辨率传感器拍全景，软件裁一个窗口放大输出 | 窗口越小越糊；需要检测模型持续在跑 | 不能。只能在传感器视野**之内**挪 |
| **机械云台（motorised PTZ / gimbal）** | 电机真的转镜头 | 专门硬件；移动有延迟和噪声 | 能，在云台行程内 |
| **一次性取景（one-shot）** | 开始时框一次，之后不动 | 最便宜，不分散注意力 | 不能 |

### 1.2 各家叫法与实现

| 产品 / 名字 | 做法 | 需要什么 | 普通摄像头能用吗 | 网页能拿到吗 | 来源 |
|---|---|---|---|---|---|
| **Apple Center Stage** | 超广角前摄 + 人脸检测，数字裁切跟随 | 支持的 iPad / iPhone 17 系、MacBook Pro 2024+ / MacBook Air 2025+ / iMac 2024+、Studio Display；或 iPhone 11+ 做 Continuity Camera | 否（要超广角硬件） | 系统级：用户在控制中心打开后**对所有 app 生效**（`centerStageControlMode` 有 user / app / cooperative 三档）；网页没有专门的开关 | [一手] [Apple 支持](https://support.apple.com/en-us/111102)、[`CenterStageControlMode`](https://developer.apple.com/documentation/avfoundation/avcapturedevice/centerstagecontrolmode-swift.enum) |
| **Zoom（桌面客户端）"Auto framing"** | 软件裁切；有 Group / Individual 两档 | 客户端里 Settings › Video & effects | 是（软件） | 否 | [二手] [社区](https://community.zoom.com/meetings-2/video-auto-framing-glitch-18984)、[askdavetaylor](https://www.askdavetaylor.com/get-starting-using-auto-framing-in-zoom-meetings/)。**客户端这一项没找到 support.zoom.com 的一手文章** |
| **Zoom Rooms** Auto-Framing / Speaker Focus / Multi-Focus / **Intelligent Director** / Boundary Framing | 会议室模式；部分模式在认证摄像头硬件里跑，Intelligent Director 用多台摄像头选最佳画面 | Zoom Rooms 认证摄像头，部分模式要 presets | 部分 | 否 | [一手] [Zoom KB0073484](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0073484) |
| **Google Meet "Framing"**（网页版） | 浏览器里跑的软件裁切。**不用虚拟背景时只框一次、不再跟**；用虚拟背景时持续居中 | Chrome / Edge M91+、WebGL、硬件加速 | 是 | 是 Meet 自己在页面里做的，不是对外 API | [一手] [Meet 帮助](https://support.google.com/meet/answer/9302964?hl=en&co=GENIE.Platform%3DDesktop)、[Workspace 博客 2024-11](https://workspaceupdates.googleblog.com/2024/11/google-meet-automatic-framing-virtual-background-improvements.html) |
| **ChromeOS auto-framing / Meet 硬件** | ChromeOS 相机服务里的 `AutoFramingCrOS`（闭源引擎）；Logitech Rally Bar 系列在机内做连续取景 | 支持的 Chromebook / 会议室硬件 | 否 | 否 | [一手] [platform2 源码](https://chromium.googlesource.com/chromiumos/platform2/+/HEAD/camera/features/auto_framing/)、[Workspace 博客 2025-04](https://workspaceupdates.googleblog.com/2025/04/continuous-framing-logitech-series-one-room-kits-google-meet.html) |
| **Windows Studio Effects "Automatic Framing"**（Teams 等所有 app 吃到的就是它） | NPU 上跑，挂在摄像头驱动链末尾；"检测到人就裁切/放大"。对 app 暴露为 KS 属性 `KSPROPERTY_CAMERACONTROL_EXTENDED_DIGITALWINDOW` 的 `AUTOFACEFRAMING` 标志 | Windows 11 22H2+、受支持 NPU、OEM 装了 Studio Effects 驱动；目前只管前置摄像头 | 否（要 NPU） | Chromium 已把 `faceFraming` 映射到这个属性（见 1.3）。**打开后对所有 app 默认生效** | [一手] [Studio Effects](https://learn.microsoft.com/en-us/windows/apps/develop/windows-integration/studio-effects)、[DIGITALWINDOW](https://learn.microsoft.com/en-us/windows-hardware/drivers/stream/ksproperty-cameracontrol-extended-digitalwindow)。Teams 自己另有的取景功能**[未验证]** |
| **NVIDIA Broadcast "Auto Frame"** | GPU 上跟踪头部，裁切并放大；出一路虚拟摄像头 | GeForce RTX 2060+ | 是（摄像头随便，GPU 不随便） | 只能当虚拟摄像头被选中 | [一手] [NVIDIA 页面](https://www.nvidia.com/en-us/geforce/broadcasting/broadcast-app/) |
| **Logitech RightSight** | 会议室机型（Rally / MeetUp）上：检测参会者 + 机械 PTZ 或数字裁切 | Logitech 会议摄像头 | 否 | 否 | [二手] [Logitech 设计博客](https://medium.com/logitech-design-guide/rightsight-technologies-explained-266df3263faf)、[Logi 支持](https://support.logi.com/hc/en-my/articles/20713215679511-What-is-RightSight) |
| **OBSBOT Tiny / Insta360 Link** | 两轴云台 + 机内 AI 跟踪；变焦是数字的 | 这台摄像头本身 | 否 | 跟踪在固件里；PTZ 能否被网页控制取决于它报不报 UVC 绝对 PanTilt（**逐台[未验证]**） | [二手] [评测对比](https://www.essentialphoto.co.uk/blogs/obsbot/obsbot-tiny-2-vs-insta360-link-hd-1080p-smart-webcam-battle) |

### 1.3 网页平台上现在能拿到什么

| 接口 | 现状（2026-09） | 对我们意味着什么 | 来源 |
|---|---|---|---|
| `faceFraming` 约束（`getCapabilities` / `applyConstraints`） | 写在 **Media Capture Extensions** 草案里（W3C 非正式提案）。Chrome Platform Status：**In development / prototyping**，没有 origin trial、没有发布里程碑；Intel 提的，Apple / Mozilla 口头支持。Chromium Windows 采集层已把它映射到 `DIGITALWINDOW_AUTOFACEFRAMING`（`video_capture_device_mf_win.cc`） | **稳定版浏览器上拿不到**。即使拿到，它也是"裁到**脸**"——规范原话就是 cropping to human faces，不适合全身 | [一手] [规范](https://w3c.github.io/mediacapture-extensions/)、[chromestatus 5129939115835392](https://chromestatus.com/feature/5129939115835392)、[Intent to Prototype](https://groups.google.com/a/chromium.org/g/blink-dev/c/LyQu9L_Iv58)、[Chromium 源码](https://chromium.googlesource.com/chromium/src/+/main/media/capture/video/win/video_capture_device_mf_win.cc)、[explainer](https://github.com/riju/faceFraming/blob/main/explainer.md) |
| `VideoFrameMetadata.backgroundBlur`（只读"系统特效开着没"） | chromestatus：in development，桌面 M134 列为首发目标；说明里写了以后扩到 auto face framing | 以后**可能**能从网页侧知道"系统在帮倒忙"。今天不能依赖 | [一手] [chromestatus 5098450535055360](https://chromestatus.com/feature/5098450535055360) |
| `pan` / `tilt` / `zoom` 约束 | Chrome 87 起桌面可用（Android 只有 zoom）；要求摄像头报 UVC **PanTilt (Absolute)** / **Zoom (Absolute)**，相对控制不支持；权限框多一项"控制摄像头移动"；页面不可见时拒绝。Firefox / Safari 不支持 | 普通笔记本内置摄像头基本没有；C920 这类只有数字变焦 [二手]；要看某台有没有，打开 `about://media-internals` 的 Video Capture 页 | [一手] [web.dev](https://web.dev/articles/camera-pan-tilt-zoom)；浏览器支持 [二手] [Dynamsoft](https://www.dynamsoft.com/codepool/camera-zoom-control-on-web.html) |

---

## 2 · 它是怎么做的：通用流水线 + 拆开的四份源码

### 2.1 通用流水线

```
检测（脸 / 身体 / 物体）→ 目标框（边距、宽高比）→ 死区 + 滞回 → 平滑（PID / 弹簧 / lerp / One Euro）
→ 缩放上下限 → 夹进传感器边界 → 裁切重采样（或发给云台电机）
```

真正决定"好不好用"的全在中间三步：**死区**让人小动时画面不动（否则晕），
**平滑**让大动时画面追得像摄影师而不是像弹簧，**夹边界**让窗口永远不露出画外的黑边。

### 2.2 拆开看的实现

| 项目 | 许可 | 看的文件 | 检测 | 平滑与约束（原文里的写法） |
|---|---|---|---|---|
| **norihiro/obs-face-tracker**（OBS 插件：Source / Filter / PTZ 三种形态） | GPLv2 [一手 README] | [`src/face-tracker.cpp`](https://github.com/norihiro/obs-face-tracker/blob/main/src/face-tracker.cpp)（`calculate_error` / `tick_filter` / `ensure_range`）、`src/face-tracker-ptz.cpp`、[`doc/properties.md`](https://github.com/norihiro/obs-face-tracker/blob/main/doc/properties.md) | dlib 人脸检测**隔一段跑一次**，中间用 dlib 相关跟踪器 | 误差 `e = (目标框 − 当前窗口) × score`，三维（x、y、**z = 尺寸**）。**PID**：Kp、Ki、Td，Td 前面有一阶低通。**死区 + 非线性带**：`|x| ≤ d → 0`；`d < |x| < d+n → (|x|−d)² / 2n`（二次过渡接到线性段，没有台阶）；z 轴另有衰减系数让缩放比平移慢。`scale_max` 限最大放大；`ensure_range` 把窗口夹在源画面内。**是四份里最完整的一份** |
| **royshil/obs-detect** | GPL-2.0 [一手 README] | [`src/detect-filter.cpp`](https://github.com/royshil/obs-detect/blob/master/src/detect-filter.cpp) | EdgeYOLO 物体 / YuNet 人脸 + **SORT** 多目标跟踪；可选 single / biggest / oldest / all（并集） | 目标框按画面宽高比外扩，`zoomFactor` 决定留白；每帧 **lerp**：`rect += zoomSpeedFactor × (target − rect)`，跟丢时系数 ×0.2（慢慢停）。**没有死区，也没有夹边界**（按帧率变的 lerp 也不是帧率无关的） |
| **hamidzr/webcam-mods** | GPL-2.0 [一手 README] | [`src/webcam_mods/entry.py`](https://github.com/hamidzr/webcam-mods/blob/master/src/webcam_mods/entry.py)、`geometry.py` | MediaPipe 人脸，Python，输出到 v4l2loopback / pyvirtualcam | 脸框外扩 x×2、y×2.5 后裁切；检测失败沿用上一帧的框。**没有平滑、没有死区**——README 说的"smooth"在这两个文件里找不到 |
| **ChromiumOS `auto_framing_client.cc`**（Google 自家） | BSD 风格 [一手源码头] | [`camera/features/auto_framing/auto_framing_client.cc`](https://chromium.googlesource.com/chromiumos/platform2/+/HEAD/camera/features/auto_framing/auto_framing_client.cc) | 调闭源的 `AutoFramingCrOS` 引擎；检测输入缩到 **569×320 灰度**，按 `detection_rate` 节流 | 输入输出都是 0–1 归一化的 ROI 与裁切窗口；`kCropWindowStabilizationPeriod = 1s`。**真正的平滑算法在闭源引擎里，看不到** |

另外两份是"接口层"而不是算法：Chromium Windows 采集层把 `faceFraming` 翻成
`KSCAMERA_EXTENDEDPROP_DIGITALWINDOW_AUTOFACEFRAMING`（算法在 Windows Studio Effects 里，闭源）；
Windows 的 `DIGITALWINDOW` 结构本身就是一个 Q24 定点的 `OriginX / OriginY / WindowSize`——**所有平台最后都收敛到"一个归一化的方窗口"这一个数据结构**。

**许可提醒**：前三份是 GPL。拿来**读思路**没问题，**不抄代码**。要用的那部分（死区 + 非线性带 + 帧率无关平滑 + 夹边界）五十行以内，
`packages/core/src/filter.ts` 里已经有 `oneEuro` / `emaAlpha`。

---

## 3 · 放进这件作品：分三种用法说清楚

我们每一次推理都已经有 33 个点的 `RawPose.screen`（0–1 图像坐标），检测这一步是白送的。
问题是**裁谁**。

| 用法 | 它会做什么 | 帮到什么 | 伤到什么 | 判断 |
|---|---|---|---|---|
| **A · 裁 MediaPipe 的输入** | 在 `detectForVideo` 之前把 1280×720 裁成跟着人走的小窗 | 人离得很远、在画面里很小时，**检测器**（224×224 看整幅）也许更容易先找到人 [一手：[BlazePose GHUM model card](https://arxiv.org/pdf/2206.11678) 的输入尺寸] | ① **不增加关节模型的像素**：PoseLandmarker 本来就是 detector → 从上一帧关节推 ROI → 在 ROI 上跑 256×256 的关节模型 [一手：[MediaPipe Pose 文档](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)]，它已经在自己裁了。② **反馈环**：裁切跟着检测走、检测吃裁切后的图；一帧检错 → 窗口挪歪 → 下一帧更容易错。③ **救不了出画**，反而会把"快出画"藏起来。④ `screen` 坐标要反算回原图，preview 骨架、`outOfFrame()`、WRN12 都要跟着改——而 `capture/webcam.ts` 现在是另一条线（docs/48）在动 | **不做** |
| **B · 只裁左上角小屏幕的显示** | 推理照旧看全图；小屏幕里用 CSS transform（或 `drawImage` 子矩形）把人放大居中 | 装置用广角镜头、观众站 2.5–3m 时，168×126 的小屏里人只有一小条；放大后"骨架贴在我身上"更看得清 | 小屏幕存在的**唯一理由**是回答"它有没有看见我"（`ui/preview.ts` 文件头）。跟随居中会让一个**已经半个人出画**的观众在小屏里看起来依然居中——正好删掉「往后退一点，整个人进画面」那句话的证据。所以只能在**画内且质量好**的时候放大，一出现 `outOfFrame` / WRN12 / 质量不够就**退回 1×**，让画框边缘重新可见 | **以后再说**，要现场证据先说明小屏里人太小 |
| **C · 舞台相机跟着人** | 身体在世界里左右走，相机平移跟过去 | 观众走到画面边上时身体不出屏 | `stage/framing.ts` 的第一条主张是**等身 + 相机距离不动**（"现场地面上是贴了位置线的"）。这是一面镜子：人往左走，身体就该往左走；相机一跟，这个位移就被抵消了，镜像的因果变弱。身体会不会出**屏**应当由取景的有限插值和站位线管，不由跟随管 | **不做** |

### 3.1 真正会伤到我们的是"系统自带的自动取景"

上面的表格里所有平台方案都对准**脸**（Center Stage、Studio Effects 的 `AUTOFACEFRAMING`、`faceFraming` 规范原话、NVIDIA 的"track your head"、云台摄像头的人脸跟踪）。
而 PoseLandmarker 要的是**整个人包括脚**。任何一种在我们上游打开，结果都一样：

- 观众一动，送进 MediaPipe 的画面就被悄悄裁到半身 → 腿出画 → WRN12 / 「往后退一点」在观众没动的时候亮起；
- 画面缩放在变 → `screen` 坐标系在变，但我们以为它是固定机位；
- 在 macOS 上它是**用户在控制中心开的、对所有 app 生效**，在 Windows 上是**设置里开的、对所有 app 默认生效**——页面里什么都不改，现场就坏了；
- 网页侧今天**检测不到**（`faceFraming` 与特效状态元数据都还没发布，见 1.3）。

这对 kiosk 是一个现场检查项，对网页观众是一个无法控制的风险（只能在「站到亮一点的地方 / 往后退一点」之外，无从提示）。

### 3.2 kiosk 与网页观众

| | kiosk（`npm run kiosk`，固定机位） | 网页观众（笔记本内置摄像头） |
|---|---|---|
| 视野 | 可以选广角镜头、站位线在地上 | 窄、近，经常只拍到上半身 |
| 自动取景的意义 | 小屏放大（用法 B）也许有点用 | 问题是**画幅不够宽**，裁切只会更窄——无意义 |
| 系统自动取景的风险 | 可控：开机前关掉 | 不可控：Center Stage 机型、Studio Effects 机型上可能默认或被用户打开 |
| 硬件 PTZ | 可以买一台报 UVC 绝对 PanTilt 的云台，但 Chrome 会多一次权限、页面不可见时拒绝；而且云台一动，"固定机位 + 地面站位线"这个前提就没了 | 基本没有 |

### 3.3 代价

- 用法 B：一个 CSS `transform` 写到已经在 DOM 里的 `<video>` 和骨架画布的共同容器上，4Hz 以下更新也够——**帧时间可忽略**，不碰采集。
- 用法 A：每次推理多一次 `drawImage` 到 OffscreenCanvas 再交给 MediaPipe，多一次 GPU 上传；而且要改 `capture/webcam.ts`，与正在进行的相机平滑线（docs/48）撞同一个文件。**本文不建议、也没有碰那个文件。**
- 附注：本机 `@mediapipe/tasks-vision@1.0.1` 的 `vision.d.ts` 里 `PoseLandmarker.detectForVideo` **接受** `ImageProcessingOptions`（含 `regionOfInterest`），但同一文件里 ImageSegmenter 的注释明写 ROI "NOT supported and will result in an error"。PoseLandmarker 是否真的认 ROI **[未验证]**——若以后真要做 A，应先试这个参数，而不是自己裁图。

---

## 4 · 计划（如果要做）

### 阶段 0 · 现在，零代码：把系统自动取景关掉，写进现场表

- `docs/38-RUNNING-THE-PIECE.md` 的开机检查、`docs/46-FIELD-CHECK.md` 的"开始之前"各加一行：
  macOS 控制中心 › 视频效果 › **Center Stage 关**；Windows 设置 › 相机 › Studio Effects › **Automatic Framing 关**；
  不用 NVIDIA Broadcast 虚拟摄像头；云台摄像头（OBSBOT / Insta360）**关人脸跟踪、锁定云台**。
- 检查方法：站到画面一侧慢慢走，左上角小屏里的**背景**不应该跟着动。背景动了 = 上游有人在裁。

### 阶段 1 · MVP：只作用于小屏幕的跟随放大（用法 B），默认关

触发条件：现场检查表里有人写"小屏里我太小，看不清骨架贴没贴"。

| 放哪 | 做什么 |
|---|---|
| `packages/core/src/autoframe.ts`（纯函数，不碰 window） | `frameTarget(screen, aspect, opts) → {cx, cy, size}`：取可信点包围盒 + 边距；任何出画 / 质量不够 / 没人 → 返回 `size = 1` 的全图窗口。`stepFrame(cur, target, dt, opts)`：死区（窗口中心差 < `deadZone` 不动）+ 非线性带（照 obs-face-tracker 的二次过渡）+ **帧率无关**的临界阻尼弹簧（或 `emaAlpha(dt, τ)`）；缩放比平移慢；最后夹进 [0,1] |
| `packages/core/src/tuning.ts` 新增 `AUTOFRAME` | `enabled`（默认 false）、`margin`、`maxZoom`（建议 ≤ 1.6，小屏上再放大就糊）、`deadZone`、`band`、`panHalfLife`、`zoomHalfLife`、`releaseToFullOnWarn: true` |
| `packages/app/src/ui/preview.ts` | 每帧把 `stepFrame` 的结果写成 `.sb-see-screen` 内层的 `transform`；镜像类照旧加在外层。`?autoframe=on\|off` 按 `?preview=` 的规矩判值 |
| 测试 `packages/core/test/autoframe.test.ts` | 死区内窗口一动不动；60Hz 与 20Hz 步进到同一时刻窗口差 < ε（帧率无关）；任何输入下窗口不出 [0,1]；`outOfFrame ≥ PREVIEW.outOfFramePoints` 时一定回到 1×；**用真录制 `assets/demo/pose-walkturn.json` 数窗口大跳次数**（照 `preview-state.test.ts` 数"说法变了几次"的做法） |

### 阶段 2 · 只有证据要求时：推理输入 ROI（用法 A）

前提是**现场录到**"人远到检测器找不到"的片段。先试 `detectForVideo(video, t, { regionOfInterest })`，在 `/dev/accuracy.html` 上对同一段录制比较检出率与关节 CV；
必须等 docs/48 那条线落地之后再碰 `capture/webcam.ts`；`screen` 坐标的反算只许在一处发生。

### 建议：**阶段 0 现在做；阶段 1 以后再说；阶段 2 和舞台跟随不做。**

这件作品需要的是"整个人进画"，而自动取景解决的是"脸在不在中间"——它是给已经在画里的人**缩小**视野的技术，对一个要看脚的系统，它最多是在小屏幕上的锦上添花，最坏是在上游悄悄把腿裁掉。
我们手上已经有每一帧的全身关节，所以真要做，成本很低（一个纯函数 + 一个 CSS transform），但小屏幕的职责是说真话，跟随放大必须在任何告警时让出位置，而这一点只有现场观众告诉我们"看不清"时才值得付。
真正该立刻付的代价是一行现场检查：Center Stage、Studio Effects、Broadcast 和云台自带的跟踪，任何一个在上游开着，都会让「往后退一点」在观众没动的时候亮起来，而网页侧今天还看不见它们。

---

## 5 · 落地（2026-09-14，同日第二轮：作品负责人改了方向）

> 上面 §0–§4 是研究线的结论（"舞台不跟随、小屏以后再说"）。同一天作品负责人看过之后给了新方向：
> **自动取景适合我们** —— 只露上半身是正当的，下半身站着不动、上半身照常动；
> 人一退后（想被看见全身）就切回全景；只露上半身、或者有人要调某个模式时开自动取景。
> 下面是照这个方向落地的版本。§3 表里"用法 A 不做"这一条**没有变**，其余两条按下面的裁定改。

### 5.1 原则

**一、首要观众。** 网页上最常见的观众是**笔记本前只露头、肩、胯的人**，所以网页的默认必须让"上半身"看起来是有意为之、而且好看。
装置的首要观众是**站在站位线上的全身观众**，所以现场**全身优先**（仍然是 `auto`，但进中景要憋 3 秒，网页 1 秒；人刚出现时网页只憋 0.35 秒）。
「你的身体在驱动它」这一条主张两种观众都成立 —— 上半身的人驱动上半身，下半身站着不是在撒谎，是在说"这一半没有读到"。

**二、判据只在输出侧。** 分类器读 MediaPipe 在**整幅**画面上给的可见度和位置；它的结论只改四件事：舞台景别、腿、小屏裁切、引导。
采集端一个像素都不动（§3 用法 A 的反馈环照旧成立）。

**三、切得快，但不来回跳。** 所有"连续成立多久"都是**漏桶**（成立一帧加一帧，不成立一帧扣两帧）：门限上 50/50 颤动的证据永远攒不满，
真变化 1 秒内切过去。每次切换后 1.2 秒冷却；三种纠错不等冷却 —— 头肩被切（诚实优先）、刚进入上半身就出现连续退后证据（上一判断需要立刻纠正）和"退后完成"（不惩罚照做的人）。

**四、看得见。** 操作员：`?debug=1` 的 HUD 多两行 `framing`，模式、理由、在模式里的秒数、膝踝数与门限、尺度趋势与门限、头肩出画数、冷却；非全身时整行变琥珀色。
工作台：`/dev/framing.html` 画 33 个点（实心 = 可信）和最近 20 秒的模式时间线，没有摄像头时播和 node 测试同一段合成时间线。
观众：**不加字**。中景本身就是那个提示 —— 镜头推近到上半身，读得出"它知道你只露了上半身"；小屏在上半身里轻轻放大跟着你。
（考虑过第一次进上半身时出一句双语提示，否决：作品负责人不喜欢冗余提示，而这件事画面已经说了。）

**五、"等身"的一处例外，登记在案。** `stage/framing.ts` 文件头那条主张写的是全景。上半身模式下画面收成中景：**同一个机位、同一个距离，只收窄视野**
（fov 变小，不推相机；画面高 = 身高 × 0.64，人形约放大 2.2 倍）。例外只在人形上成立（身体方案一开始漂移就给全景），人一退后就恢复；
`test/framing-mode.test.ts` 钉住中景插值在 t = 0 时和等身全景**逐字相同**。裁定写进了 `stage/framing.ts` 的 `upperFit()` 注释。

### 5.2 模式

| 层 | 值 | 谁决定 | 意思 |
|---|---|---|---|
| 分类器状态 | `full` | `core/src/autoframe.ts` | 膝踝在画里（或者还没有证据：开机、人走了 4 秒） |
| | `upper` | 同上 | 头肩在画里、膝踝持续不在（≤ 1 个） |
| | `stepping-back` | 同上（过渡态） | 上半身时膝踝开始冒出来（≥ 2 个），或者**肩宽与躯干同时**比 0.8 秒窗口里的最大值缩了 12%。舞台立刻给全景，腿先别放开；腿进画 0.5 秒 → `full`；3 秒没结论 → 腿明确不在回 `upper`，否则 `full` |
| 策略 | `auto`（默认） | `?framing=` / 控件条「取景」· C | 听分类器 |
| | `full` | 同上 | 永远等身全景。腿照样听分类器（选了全景的笔记本观众不该因此拿到一双坏腿），引导照旧为腿说话 |
| | `upper` | 同上 | 永远中景、腿永远站姿（桌面演示） |

三个策略都是**叠加**：控件条上再选「自动」就交回分类器，没有一个按钮能锁住系统（docs/23 §S4.1）。热切，不重载。

### 5.3 典型场景

| 场景 | 分类器 | 舞台 | 左上角小屏 | 引导 | 身体 |
|---|---|---|---|---|---|
| 笔记本前坐着 | 0.35 秒内 `upper` | 1 秒推到中景，小范围跟随（死区 4cm、横 ±12cm、竖 ±8cm） | 放大到 1.3×，跟着上半身 | 不为腿说话 | 腿 0.5 秒混成站姿，上半身照常镜像 |
| 笔记本前站起来（头出了上边） | 0.5 秒内 `full`（`abnormal`） | 回全景 | 当帧退回整幅 | 「往后退一点」 | 腿还在站姿（分类器不是 `full(legs-in)` 前不放开） |
| 站着往后退 | `stepping-back`（尺度在缩，~0.6 秒）→ 腿进画 `full` | 退的过程中就回全景 | 当帧退回整幅 | 退后中照常说话（那正是他在做的事） | 腿进画后 0.5 秒混回追踪 |
| 装置：从远处走到站位线 | `full` 全程 | 等身全景 | （现场默认不挂） | 照旧 | 追踪 |
| 装置：走到镜头跟前 | 腿不在持续 3 秒才 `upper` | 中景 | — | — | 站姿 |
| 画里两个人 | 尺度一帧跳 > 35% 视为换人，清空趋势窗口，不当成退后；腿的证据照常 | 按证据 | 按证据 | 按证据 | 按证据 |
| 人走了 | 4 秒内保持；4 秒后 `full(absent)` | 回全景（下一位从等身开始） | 「站到画面里」 | — | 空场 |

### 5.4 边界（每条一个决定、一个测试）

| 边界 | 决定 | 测试 |
|---|---|---|
| 腿在画面底边上一帧进一帧出 | 漏桶攒不满，不切 | `core/test/autoframe.test.ts`「腿在画面底边上一帧进一帧出」：全身起步 10 秒 0 次、上半身起步 ≤ 1 次且停在 `upper` |
| 前倾（肩变宽、躯干透视变短）再坐直 | 不是退后：两个量**都**缩才算缩 | 「前倾…再坐直」 |
| 转身（肩宽缩到 0.4） | 不是退后：躯干没缩 | 「转身」 |
| 中途坐下、腿被桌子挡住 | 1 秒后 `upper`，只切一次 | 「中途坐下」 |
| 桌椅部分遮挡 | 同上：被挡的膝踝可见度低 = 不在 | 同上 |
| 光线塌了（score < 0.65） | **保持当前模式**：坏光下腿的可见度会跟着塌，看起来像只露上半身 | 「光线塌了」 |
| 摄像头自己在裁（Center Stage / Studio Effects） | 放大不是退后（尺度在涨）；腿被裁掉就是上半身 —— 系统优雅地适应，但**现场仍然要关**（5.6） | 「摄像头自己在裁」 |
| 小孩 / 个子矮 | 全身在画里就是全身，判据不看身高 | 「小孩」 |
| 两个人 | 见上表 | 「两个人」 |
| 回放 / `?demo=1` | 录制没有 `screen`：只看 world 的腿可见度，没有"在不在画内"和尺度。真录制 `pose-walkturn` 全程 `full`；把膝踝可见度压到 0.1 → `upper` | 「回放录制」 |
| `prefers-reduced-motion` | 景别 0.15 秒到位，中景不跟随 | 「景别：…减少动态 0.15 秒」 |
| 调速器在砍工作量 | 放到「后期」那一级（阶梯第 5 级）或降级 / 无人降帧时：景别照常缓动、只冻结跟随 | 「景别：…治理在砍工作量时照常走完」 |
| 头被切但上半身取景 | 小屏和 WRN12 照样说 | `app/test/framing-mode.test.ts` |

### 5.5 实现

| 做什么 | 在哪 | 测试 |
|---|---|---|
| 证据、分类器、策略、跟随弹簧（死区 + 二次过渡带 + 闭式临界阻尼 + 夹住）、景别步进、小屏裁切步进 | `packages/core/src/autoframe.ts`；数全在 `tuning.ts` 的 `AUTOFRAME` | `core/test/autoframe.test.ts` 18 条 |
| 腿换成站姿，按脚重新落地；身高按站姿算 | `packages/core/src/leghold.ts`，帧循环里在 `clampFold` 之后、`motion.update` 之前 | `core/test/leghold.test.ts` 4 条 |
| 中景取景与插值 | `stage/framing.ts` 的 `upperFit` / `blendFit`；`stage.ts` 的 `setShot()`，每帧按时间推，`setViewOffset` 平移视锥（横向跟随也是移轴，不转相机） | `app/test/framing-mode.test.ts` |
| 引导与 WRN12 | `ui/preview-state.ts` 的 `outOfFrame(screen, upperIsIntended)`：上半身取景时**只从下边出去的点**不算出画（腿、放在桌上的手）；上、左、右照算 | 同上 |
| 小屏裁切 | `ui/preview.ts` 一个 `applyCrop()` + 一处调用；每帧写 transform，不用 CSS transition | 纯逻辑在 core 测 |
| `?framing=`、控件「取景」、HUD 两行、工作台 | `shell/kiosk.ts`、`ui/control-table.ts`、`shell/hud.ts`、`dev/framing.html` | `app/test/framing-mode.test.ts`；`control-table.test.ts` 的读回 |

**和原设计不同的一处，理由写在这里。** 任务卡写的是"中景跟随观众在画面里的横竖偏移"。但 MediaPipe 的 world 坐标是**以胯为原点**的：
观众在画面里往左走，舞台上那具身体并不往左走。相机跟着画面偏移去挪，就是在挪向一具没动的身体。
所以跟随的目标是**舞台上那具身体的上半身**：头胸的横向位置、颅顶低于站姿身高多少（前倾、塌腰）。观众在画面里的位移只由小屏裁切跟随 —— 那里坐标系就是画面。

### 5.6 现场检查（阶段 0，照旧必须做）

开机前关掉上游的自动取景：macOS 控制中心 › 视频效果 › **人物居中（Center Stage）关**；Windows 设置 › 相机 › Studio Effects › **自动取景关**；
不用 NVIDIA Broadcast 的虚拟摄像头（Auto Frame）；云台摄像头关人脸跟踪、锁定云台。
检查法：站到画面一侧慢慢走，左上角小屏里的**背景**不该跟着动。已写进 `docs/38` §2 和 `docs/46` §0。
分类器能适应它（腿被裁掉就是上半身），但装置的首要观众是全身 —— 在上游裁掉腿等于替每个人选了中景。

### 5.7 顺手查到的（相关部分还能怎么做）

1. **稳定器的腿长中位数会吃进上半身时的乱帧。** 腿看不见的那几十秒里，`stabilize.ts` 的 90 帧滚动中位数照样在更新腿长；人退后腿进画，腿从站姿混回追踪时用的是被污染的骨长，最多 3 秒才洗干净。修法：腿骨 `confidence` 低于门限时不更新那几根的中位数。本轮没做（`stabilize.ts` 不在这条线的范围）。
2. **`skeleton.ts` 的落地在一只脚都不可信时退到"最低的可见点"。** 全景策略下、腿被桌子挡住的人，整具身体会随那个点上下跳。上半身模式用站姿绕开了它；`?framing=full` 那一条路上它还在。
3. **`observedHeight()` 用脚算身高。** 只露上半身的人身高是乱的，而动能除以身高 —— 读数里的「动能」在笔记本观众身上一直是错的量级。站姿模式下改成按站姿算（`leghold.ts`），全景下没动。
4. **`assets/demo/` 的两段真录制没有 `screen`。** 所以回放下分类器只有可见度，没有"在不在画内"和尺度，也就没法在 `?demo=1` 上演示"退后"。下一次录制（`/dev/record.html`）应当把 `screen` 一起存下。
5. **固定 16:9 假设已在 2026-09-18 拆掉。** Webcam 把每张推理帧的 intrinsic
   `videoWidth / videoHeight` 连同 stamp 发给 worker，回执原样带回；只在该 pose 被接受时更新
   `Capture.frameAspect`。主线每帧只读一次，同值进分类、横向根位移、多人身份 / 站位、
   小屏和读数；回放或坏尺寸才回落 16:9。4:3 → 9:16 同一物理身体的分类量、跟踪尺度和
   身份有确定性反证；**真人横竖屏切换仍未实测**。
6. **`numPoses = 1`。** 两个人时 MediaPipe 在两人之间跳，分类器只能做到"不误判成退后"；真正的多人是另一件事。

### 5.8 先红后绿（每条守卫拿掉它守的那一行再跑，21 发 21 中）

| 拿掉什么 | 红了哪条 |
|---|---|
| 漏桶改成"不成立时不扣" | 腿在底边上颤 |
| 头在不在（鼻子 / 耳朵）那一条 | 证据、时间线（画外的头可见度只有 0.2，数画外可信点数不出来） |
| 退后要两个量都缩 → 一个缩就算 | 前倾再坐直 |
| 一帧跳 > 35% 清空趋势窗口 | 两个人 |
| 光不够保持模式 | 光线塌了 |
| 头肩被切不等冷却 → 等冷却 | 时间线 |
| 现场 3 秒 → 和网页一样 | 现场全身优先 |
| 跟随的目标夹住（和出界后的夹） | 跟随不出范围、景别 |
| 死区 | 跟随：死区里一动不动 |
| 调速器保持镜头 | 景别 |
| 减少动态 0.15 秒 | 景别 |
| 小屏告警当帧退回整幅 | 小屏裁切 |
| 站姿按脚落地 | 腿：脚踩在 y=0（2 条） |
| 膝在髋正下方 | 腿：竖直站姿 |
| 引导：画面下边的豁免 | 引导 / 读数 / 引导 × 分类器（3 条） |
| 引导：豁免扩大到所有边 | 头被切照样说、WRN12（2 条） |
| 读数不接那个开关 | WRN12 |
| `?framing=` 永远 auto | 控件读回、`?framing=` 读回（2 条） |
| 控件把 auto 写进地址栏 | `?framing=` |
| 中景插值在 t = 0 时偏一点 | 中景：t = 0 逐字等于等身全景 |

第一轮里"跟随不出范围"那一发没有红：只拿掉了出界后的夹，而目标先被夹过、临界阻尼又不过冲，出界后的夹是多余的 —— 真正在守的是目标的那一次夹，第二轮拿掉它才红。站姿落地那一发第一轮删掉整行循环、留下一个悬空的 `if`，红的是语法错误不是断言，第二轮改成 `-= 0` 才是真红。

### 5.9 浏览器里的证据（无头 Chrome，raw CDP，截图在工作树 `scratch/evidence/`，不进仓库）

回放片段是从真录制 `pose-walkturn` 派生的两段，**只在取证时放进 `assets/demo/`，取完删掉**（`SOURCES.md`：合成数据不进那个目录）：
`upperwalk` = 同一段录制把膝踝脚（25–32）可见度压到 0.1、坐标加上"桌子底下乱猜"的抖动；`stepback` = 前 8 秒 `upperwalk`、后 8 秒原录制。
URL 都是 `/?demo=1&debug=1&theme=porcelain&seed=7&theseus=off&arc=900&nopost=1&clip=…`；"改前"是同一个 URL 开在 `main`（02d84ed）上。

| 场景 | 改前（main） | 改后 | HUD 读到的 |
|---|---|---|---|
| 只露上半身（`upperwalk`，6 秒） | `before-upper-06s.png`：等身全景，一条腿横甩在地上，两摊影子 | `after-upper-06s.png`：中景，上半身占满画面，腿站着不动 | `upper ← legs-out 5.2s · 景 100% · 腿 1.00 · 膝踝 0/4` |
| 退后（`stepback`，第 8 秒腿回来） | `before-stepback-07s.png` / `-10s.png` | `after-stepback-07s.png`（中景）→ `-09s.png`（正在拉回，景 48%、腿 0.97）→ `-10s.png`（全景，腿追踪） | 7s `upper ← legs-out 6.2s` → 9s `full ← legs-in 0.0s · 景 48%` → 10s `full ← legs-in 1.0s · 景 0% · 腿 0.00` |
| 全身（`walkturn`，8 秒） | `before-full-08s.png` | `after-full-08s.png`：和改前同一个等身全景 | `full ← start 7.7s · 膝踝 4/4` |
| 工作台 `/dev/framing.html` | — | `workbench-02s/04s/08s/12s.png`：合成时间线上琥珀段（upper）两侧是灰段（full），切换处白竖线 | 8s `full ← abnormal 4.2s` |

退后那一段在回放里走的是 `upper → stepping-back(legs-appearing) → full(legs-in)`，从腿回来到景别开始拉回不到 1 秒、拉回走完 1 秒。
回放没有 `screen`，所以"尺度在缩"那一支只在 node 时间线里跑过，浏览器里没有。**小屏裁切在浏览器里没有取证**：`?demo=1` 不挂小屏，而无头 Chrome 的假摄像头要一段只露上半身的 y4m，这一轮没做。

**首屏字节。** 两份 `vite build` 逐个 chunk 比（`dev-*` / worker / wasm 除外）：JS+CSS 合计 gzip **551.1 → 556.2 KB（+5.1 KB）**。
分类器落在 `intent` 这个共享 chunk（9.1 → 12.9 KB gz），`main` 23.4 → 23.8 KB gz，`stage` 13.3 → 13.6 KB gz。docs/13 §6 口径的首屏是 2.06 MB，
+5 KB 之后仍远在 3 MB 之下 —— **但这一轮没有按 docs/13 的口径重走一遍网络量**，这个结论是由 chunk 差值推出来的。

---

## 6 · 问题定义与修正（2026-09-15，作品负责人第三轮反馈）

> 反馈原话（译）：① 居中、放大、缩小这几个模式之间没有过渡；② 左右晃不认，人往左或往右出画它不管；
> ③ 先把问题找准、定义清楚，别做大，在现有架构里改该改的；④ 改一处，让它兼容并能用上 Chrome 自带的摄像头取景。
> 本节先定义问题（6.1–6.3），再写落地与证据（6.4 起）。**不加框架**：只扩 `core/src/autoframe.ts`、`stage/framing.ts`、
> `ui/preview-state.ts` 这几个已经存在的纯模块，外加一个纯的 `capture/cam-framing.ts`。

### 6.1 症状（逐条、可证伪）

| # | 症状 | 在哪看得到 |
|---|---|---|
| S1 | 小屏从 1.3× 退回整幅是**一帧跳完**的 | 上半身 → 退后、站起来头出上边、光不够：小屏的画面"咔"一下变小 |
| S2 | 舞台全景 ↔ 中景在调速器砍工作量（放下「后期」）、降级、无人降帧时是**一帧切** | 性能一般的笔记本上几乎每次换景别都是硬切 |
| S3 | 人在画面里左右走 / 晃，舞台上那具身体**纹丝不动** | 全景和中景都一样；只有前倾会让中景跟一点 |
| S4 | 人往左或往右出画，**小屏不说话、读数不报 WRN12** | 躯干一半出了左边：`outOfFrame = 0`，`seeState = ok` |
| S5 | 真的报了出画时，唯一的话是「往后退一点」 | 人是往旁边走出去的，往后退救不了 |
| S6 | 系统 / 摄像头自己在取景（Center Stage、Studio Effects、W3C `faceFraming`）时我们不知道，腿被裁掉后照样催「往后退一点」 | §3.1 已经写过风险；代码里没有读 `getSettings()` 的地方 |

### 6.2 根因（在代码里找到的，附探针数）

探针：`scratch` 里一段 node 脚本，直接 import 当时 `main`（6439275）的纯模块，喂 `core/test/framing-people.ts` 的合成人。

| 症状 | 根因 | 证据 |
|---|---|---|
| S1 | `stepCrop()` 第一行 `if (input.snap) return CROP_FULL;`（autoframe.ts:468）。`snap = seen.state !== 'ok'`（preview.ts:232）。**放大着的时候来了任何一句告警**就走这条：典型是光线塌了 —— 分类器在坏光下保持上半身（`active` 仍然是 true），小屏 0.45 秒后说「站到亮一点的地方」→ 当帧退回整幅。（本节初稿写的是"退后这条最常见的缩小走它"，**取证推翻了**：退后时 `active` 先变 false，弹簧先把放大收回去，等告警到时已经没剩多少，见 6.6） | 放大到 1.299 之后 snap 一帧：**zoom 1.299 → 1.000**；合成时间线 `light` 上逐帧量：**0.288 / 16ms** |
| S2 | `stepShot()` 里 `if (input.hold) return { progress: target, … }`（autoframe.ts:410），`hold = degraded ∥ throttled ∥ governor.sheds('post')`（main.ts:1062）。§5.4 当时的裁定是"画面不动比卡着动好"，但它把"跟随冻结"和"景别直接切"绑在了一起 | `hold` 下一帧 **progress 0 → 1** |
| S3 | `mediapipeToWorld()` 只读 `raw.world`（skeleton.ts:111），而 MediaPipe 的 world 坐标**以胯中点为原点** —— 人在画面里站哪儿，胯永远在 0。单人时 `lineup()` 返回 0（people.ts:473），main.ts 只在多人时平移骨架。中景跟随的目标是那具身体头胸的 x（stage.ts:926），也就只剩前倾 | 胯中点在画面 cx = 0.2 与 0.8 时，骨架 `pelvis` 都是 **[0, 0, 0]** |
| S4 | `outOfFrame()` 只数**可信**点（preview-state.ts:128）。MediaPipe 对画外的点给低可见度（autoframe.ts:116 那段注释说的正是头出上边时的同一件事），于是半个人出了左右边时画外点根本不可信，数不出 3 个。分类器那边肩不可信 → `upper = false` → `abnormal` → 全景，**舞台缩了，却没有一句话** | 全身站在 cx = 0.1 / 0.03 / −0.02 / −0.08：`outOfFrame` 全是 **0**，`seeState` 全是 **ok**；后三个 `frameEvidence().upper = false` |
| S5 | 出画只有一个 `reason: 'bounds'`、一句 `COPY.preview.stepBack`（preview.ts:220） | — |
| S6 | `capture/webcam.ts` 从来不读 track 的 `getCapabilities()` / `getSettings()`；分类器无从知道腿是被摄像头裁掉的 | — |

另外量到一处**不是位置跳变**、但读起来像顿一下的地方：旧景别是线性进度套 smoothstep，走到一半反向（退后中 → 超时回上半身）时速度一帧从 +1.5/s 翻到 −1.5/s（探针：**一帧 3.0/s**）。2026-09-18 已把进度改成带速度状态的闭式临界阻尼：反向先刹车再回头，速度与位置都有限幅，端点精确收口。

### 6.3 裁定的行为

**一、连续性（S1、S2）。** 任何一个取景状态的变化 —— 景别、小屏放大缩小、跟随开关、腿的站姿混入与放开、控件条上换策略 —— 都不许一帧跳完。
全部由纯函数按时间推（景别二阶进度 + smoothstep、闭式临界阻尼弹簧、限速），不依赖任何 CSS 过渡。守卫：任意决策序列下，
**每 16ms 的变化量有上限**（数在 `AUTOFRAME.maxStep`，测试随机序列逐帧核对）。

- 小屏的诚实规则**保留**，但"当帧退回"改成 **0.2 秒限速退回**（`previewSnapSeconds`）：0.2 秒内画框的边一定重新可见，这件事的证据作用没丢，眼睛也不再被咔一下。
- `hold`（降级 / 调速器 / 无人降帧）只冻结跟随，**景别照常约 1 秒到视觉端点**。二阶轨迹在 15/30/60/120Hz 的共同时间点近似一致；低帧率只是每步大一点，不会改变反向的物理顺序。
- **减少动态（`prefers-reduced-motion`）是唯一的例外，而且写明**：景别 0.15 秒（读作一次切）、中景不跟随；小屏**不裁切**（1×，一块跟着你挪的缩略图本身就是动态）。
  身体的横向位移**不算**减少动态要去掉的东西：那是观众自己的动作，和他抬手是同一类，镜子不该在这里撒谎。

**二、横向位置是一等信号（S3–S5）。** 用 `screen` 里躯干（两肩两胯）的横坐标，不用 world。

| 情形 | 裁定 |
|---|---|
| 画内左右走 | 身体整体平移一个**有界的横向根偏移**：胯中点的画面 x → 米（和 docs/50 `lineup()` 同一个折算：一个躯干长 = 0.5 米），乘 `MIRROR_X` —— **观众往自己左边走，身体往屏幕左边走**（镜子）。临界阻尼弹簧 + 5cm 死区 + 限速，夹在舞台**此刻看得见的余量**里（`stage.lateralRoom`，随景别连续变化）。相机不跟（§3 用法 C 照旧否掉）：中景跟随的目标改成**头胸相对骨盆**的偏移，只剩前倾 |
| 前倾 vs 迈步 | 偏移只看**胯**。前倾时胯不动 → 偏移不动（前倾本来就在 world 骨架里）；迈步时胯动 → 身体动 |
| 贴着边、但整个人都在画里 | 不是出画：不说话、不报警，偏移走到余量的边上为止 |
| 躯干越过左 / 右边（按躯干宽算，≥ 25% 在边外） | 小屏诚实规则照旧：0.2 秒退回整幅，并在**那一侧**画一条细边；小屏说**那一侧的话**（「往左一点，回到画面里」/「往右一点…」），读数照报 WRN12。舞台上身体**停在最后那个位置**，不去追一个被外推出来的坐标 |
| 追踪丢了（人整个出画 / 被挡住） | 保持最后的位置 1 秒，然后弹簧回中线 |
| 从左或右重新进画 | 从停着的地方弹回去，没有台阶 |
| 快速左右晃（2Hz） | 弹簧 + 死区把它吃掉：身体不跟着抖，侧边提示不来回翻 |
| 画里两个人一左一右、`numPoses = 1` | MediaPipe 在两人之间跳，躯干 x 一帧跳 > 0.2 画面宽 → 当成**换人**：先停，新位置稳定 0.5 秒才跟；来回跳就一直停着 |
| 多人（`?people≥2`）有伴随身体在台上 | 横向根偏移让位（弹回 0），站位归 docs/50 §4.2 的 `lineup()`；两者都是弹簧，叠加连续 |
| 回放录制（没有 `screen`） | 没有横向证据：偏移恒 0，不报侧边，不抛 |
| 上半身中景 + 左右晃 | 余量按中景画面算（窄得多），景别推近的那一秒里余量连续收窄，偏移被连续地夹回来 |
| 镜像方向 | 画面 x 是摄像头看到的原图（没有镜像）：观众往自己右边走 → 画面 x 变小 → 越过的是**画面左边**，对观众来说是**右边**。侧边一律按观众自己的左右（= 镜像显示上的左右）说；`?mirror=0` 时细边画在显示上的另一侧 |

**二补、纵向整体位置也是画面信号。** world 骨架会按 docs/04 落地；同一副骨架在摄像头画面里整体上移 / 下移，
落地后可能逐字相同。因此中景把可信 pelvis（近处被裁时退到 chest）的 `screen.y` 与 human skeleton 的**同名 world 关节**配对：
进入中景时两边同时立基线，之后用 screen 位移扣掉 world 同步位移，剩下的才是落地丢掉的整体画面移动。这样蹲起不会被 world 动作 + screen 跟随算两次。
残差按躯干尺度折成米，再走同一条临界阻尼 / 限速跟随。画面 y 向下为正，映到舞台相机中心 +Y 后身体在输出里同样向下，仍是镜子的方向。
丢失先冻结，1 秒后归中；坏光在仍有可信旧基线时无限期冻结；基线已经过期后，明确丢失或坏光都继续归中，不复活另一套坐标系的 world fallback。
单帧跳 20% 画面高、锚点 / 摄像头取景状态改变、尺度跨过身份门都会重立基线，不把换人或坐标系切换读成运镜。
全景、多人和减少动态不跟；只有 `screen === undefined` 的旧回放保留原来的 world-relative fallback，现代链的 `screen === null` 不与它混用。

**三、摄像头自带取景（S6）。** `?camframing=auto|on|off`，默认 `auto`（**不替谁打开**：§1.3 的结论是它对准脸、会裁腿）。

- `on`：`getCapabilities().faceFraming` 里有 `true` 时 `applyConstraints({ faceFraming: true })`；`off`：有 `false` 时请求 `false`（撤掉系统级默认打开，前提是浏览器把这个开关交出来）；`auto`：什么都不请求，只读 `getSettings().faceFraming`。`pan` / `tilt` / `zoom` 只读能力，不请求（请求要多一次权限）。
- 浏览器不支持：静默忽略。**永不抛、永不挡摄像头启动**（`applyConstraints` 带 1.5 秒超时）。
- 只要摄像头**已知在取景**（`getSettings().faceFraming === true`，每秒读一次），分类器把"腿不在"当成预期：进上半身走快档、不用"尺度在缩"判退后（摄像头自己在缩放）；引导与 WRN12 不为画面下边说话。HUD 的 `cam` 行写上它；小屏只挂一个 `title`，**不加常驻字**（作品负责人不喜欢冗余提示）。
- "检测到"只指 `getSettings()` 报的：网页侧没有别的办法知道系统在裁（§1.3），本轮不做画面启发式。
- **不进控件条。** docs/23 §S4.1 的规矩是面板上每一项按下去当场看得见，而今天的稳定版 Chrome 不暴露 `faceFraming` —— 大多数观众按下去什么都不会发生；控件表的 `available()` 只知道开机时的身体方案，不知道摄像头的能力。所以只做 URL 开关。

### 6.4 落地

**一个控制器，不是一堆特例。** 小屏裁切、中景跟随、身体的横向根偏移都走 `core/src/autoframe.ts` 的 `stepFollow()`：
目标去抖（One Euro，`filter.ts` 的 `oneEuroStep`，和精化器同一份数学）→ 速度前馈（有上限）→ 夹住范围 → 稳定延迟（漏桶）→ 死区 + 二次过渡带 → 闭式临界阻尼弹簧 → 限速。
6.5 对照表里每一条"采纳 / 改造"都是这里的一个参数；参数缺省时整条退回原来那个弹簧。数全在 `tuning.ts` 的 `AUTOFRAME`。

| 做什么 | 在哪 | 测试 |
|---|---|---|
| 中景把可信 pelvis/chest 的 `screen.y` 与同名 world 高度配对：相对基线、抵消蹲起、画面空间去抖 / 死区、按躯干尺度折米；坏光冻结、长丢失归中，过期后 `null` / 坏光不复活 world fallback，身份大跳重立基线；工作台显示纵向移轴 | `autoframe.ts` 的 `verticalEvidence` / `stepShot`；`main.ts → stage.setShot`；`framing-sim.ts` | `autoframe.test.ts` 的同 world / screen+world 抵消 / 小位移 / 丢失 / 坏光重现 / 换人 / 旧回放；`framing-lateral.test.ts` 的舞台接线与连续性 |
| 景别保留速度状态，目标反向时先刹再回；速度 / 位置限幅并在视觉端点精确吸附；`upper → stepping-back` 的连续纠错证据不再等上一次切换的冷却 | `autoframe.ts` 的 `stepShot` / 分类器；`tuning.ts` 的 `shotOmega` / `shotMaxSpeed` / 收口门限 | `autoframe.test.ts` 的反向与刚进上半身退后反证；`autoframe-continuity.test.ts` 的速度变化守卫与 15/30/60/120Hz 对照 |
| 降级 hold 不再切景别（只冻结跟随）；小屏告警 0.2 秒**限速**退回整幅 | `autoframe.ts` 的 `stepShot` / `stepCrop` | `core/test/autoframe-continuity.test.ts`（随机决策序列，每 16ms 上限）；`autoframe.test.ts` 两条改写 |
| 控制器的四个新参数：稳定延迟、限速、前馈、去抖 | `stepFollow`；`filter.ts` 的 `oneEuroStep` | `autoframe-controller.test.ts` 4 条 |
| 小屏：放大比平移慢、眼睛在窗口上三分之一、量不到时先停 1 秒再放、分辨率下限；减少动态 / 画里有别的有身体的人时不裁 | `stepCrop` / `cropTarget` / `cropZoomLimit`；`ui/preview-state.ts` 的 `cropActive`；`ui/preview.ts` | `autoframe-controller.test.ts` 4 条；`app/test/framing-lateral.test.ts` |
| 横向证据（躯干坐标，按边外比例报侧边）与横向根偏移（停在边上 / 跟丢 1 秒回中线 / 换人停住 / 坏光冻结 / 多人让位） | `lateralEvidence` / `stepLateral`；躯干尺度与"画面 x → 米"抽成 `torsoScale` / `imageToStageX`，`people.ts` 改用它们（全仓库只有一份） | `autoframe-lateral.test.ts` 15 条（6.3 二那张表每一行一条） |
| 舞台相机的几何抽成纯函数；横向余量；中景跟随改成头胸**相对骨盆**；天幕的晕跟着身体横向走（多人时留中线） | `stage/framing.ts` 的 `shotCamera` / `lateralRoom`；`stage/stage.ts` | `framing-lateral.test.ts`：t = 0 逐字等于全景、任意景别序列下视角与移轴每 16ms 有上限 |
| 帧循环：横向根偏移叠在多人站位上；跟丢时没有新骨架也重新平移（身体和接触阴影一起挪）；HUD `framing` 行多一段"侧" | `main.ts`、`shell/hud.ts` | `framing-lateral.test.ts` HUD 一条 |
| 引导：侧边排在「往后退一点」前面；那一侧一条细边；WRN12 同一把尺子；两句新文案 | `preview-state.ts` / `preview.ts` / `preview.css` / `readout-state.ts` / `i18n.ts`（`outLeft` / `outRight`） | `framing-lateral.test.ts` 5 条 |
| `?camframing=auto\|on\|off`；分类器与 `decide()` 接 `cameraFraming` | `capture/cam-framing.ts`（纯）、`capture/webcam.ts`（开机请求一次、约每秒重读）、`shell/kiosk.ts` | `app/test/cam-framing.test.ts` 6 条（假 track：被拒、同步抛、永不 resolve、方法本身抛） |
| 工作台：目标窗口、死区、实际窗口、横向余量 / 目标 / 死区、20 秒曲线；逐帧读数挂在 `window.__framingTrace` | `dev/framing.{html,ts}`、`dev/framing-sim.ts`（照抄 main.ts 取景那几行的纯模拟）、`scripts/framing/trace.ts` | 取证见 6.6 |

### 6.5 对照：成熟实现做对了、我们原来没做的（作品负责人追加要求）

"他们"一栏的来源见 §1.2 / §2.2（obs-face-tracker、obs-detect、ChromiumOS `auto_framing_client`、Zoom、Meet、Center Stage、Studio Effects、NVIDIA Broadcast）。GPL 的几份**只读思路、没抄码**，所有实现按行为重新推导。

| 他们的行为 | 我们原来 | 裁定 |
|---|---|---|
| 小动不重新取景：死区 + 滞回（obs-face-tracker 的死区 + 二次过渡带） | 有：`stepFollow` 死区 + 过渡带，分类器漏桶 | **保留**；推广到横向根偏移（5cm） |
| 人停稳之后才重新取景（ChromiumOS 1 秒稳定期；Meet 不用虚拟背景时只框一次） | 没有：死区外每帧追 | **改造**：`settle` 漏桶 —— 中景 0.3 秒、小屏 0.25 秒。横向根偏移**不用**：镜子的因果不能等 |
| 速度 / 加速度有上限，缓入缓出、不过冲（PID、临界阻尼） | 临界阻尼有；速度上限没有（大距离时峰值 ≈ 0.37·ω·距离） | **采纳**：`maxSpeed`（中景 0.4 m/s、小屏平移 0.6/s、放大 0.8/s、横向 1.5 m/s） |
| 放大有上限，裁切窗口不低于分辨率下限 | 上限 1.3× 有；下限没有 | **采纳**：`cropZoomLimit`（源像素 / 显示像素 ≥ 1，480p 摄像头上不放大） |
| 裁切窗口不出源画面；人贴边时平移而不是切掉人 | 有：窗口中心夹在画面内 | **保留**；舞台上的对应物是新加的横向余量 `lateralRoom` |
| 头顶留白：眼睛在上三分之一；运动方向留空 | 固定偏移（肩与鼻子中点 + 0.08） | **采纳**眼线（`previewEyeLine` = 1/3）；**改造**运动方向留空 = 小屏前馈（≤ 0.04 画面宽）；舞台相机不跟，不适用 |
| 跟丢：先停，超时后慢慢放回全景，不是一下子弹回去 | 小屏：头肩量不到时当帧开始缩；横向：没有 | **采纳**：小屏停 1 秒再放；横向停 1 秒再回中线；分类器 4 秒回全身（原有） |
| 重新找到：从停着的地方接着走，没有跳 | 弹簧从当前值起步，本来就连续 | **保留**，加了两条测试（小屏、横向） |
| 多人：框整组或保持主角，两者之间有滞回（Zoom Group / Individual） | 舞台：有伴随身体一律全景（docs/50）；小屏只看主身体；`numPoses = 1` 时 MediaPipe 来回跳没人管 | **改造**：小屏在画里有别的有身体的人时不裁（= 整组 = 整幅）；`numPoses = 1` 的来回跳当成换人（停住，新位置稳定 0.5 秒才跟） |
| 有人进 / 出组 | docs/50 的进出场曲线 + 站位弹簧 | **不适用**（已有）；横向根偏移让位给站位，两个弹簧叠加连续 |
| 检测抖动先低通（One Euro）再进控制器 | 没有，全靠死区 | **采纳**：`jitter` 参数 |
| 快速横穿：速度前馈 / 预判，有上限 | 没有 | **采纳（有上限）**：小屏 0.25 秒 ≤ 0.04；横向 0.12 秒 ≤ 0.1 m（停下时最多冲过 0.1 m，测试钉住）；中景 ±12cm 里用不上 |
| 坐下 / 站起 | 分类器上半身 ↔ 全身、腿站姿 | **不适用**（已有）；连续性守卫与 `sitstand` 时间线覆盖 |
| 身后的人被认成主角 | 分类器：尺度一帧跳 > 35% 清空趋势窗口 | **采纳到横向**：位置或尺度一帧跳 → 停住 |
| 光线 / 置信度塌了：冻结取景，不漂 | 分类器保持模式；小屏说「站到亮一点的地方」并退回整幅 | 横向**采纳**（冻结）；小屏**不冻结**，照旧诚实退回 —— 它是指示灯，不是会议摄像头 |
| 减少动态 | 景别 0.15 秒、中景不跟随 | **采纳**：小屏不裁切；横向照跟（观众自己的动作，6.3 一） |
| 关掉时平滑回到全景 | 策略 full 有 1 秒过渡；降级时一帧切 | **采纳**：降级也按时间走完；`?camframing=off` 撤掉系统取景 |
| 放大比平移慢（obs-face-tracker 的 z 轴衰减） | 同一个 ω | **采纳**：`previewZoomOmega` 2.5 < `previewOmega` 4 |
| 对准脸取景（Center Stage、Studio Effects、NVIDIA、`faceFraming`） | 不知道它开没开 | **不适用于我们的取景**（要全身）；改成**读它**：`?camframing=` |
| 云台 PTZ 真转 | — | **不适用**：只读能力，不动云台（§3.2 固定机位 + 地面站位线） |

### 6.6 证据：逐帧轨迹，改前 / 改后

**怎么量的。** 九段合成时间线（`core/test/framing-people.ts` 的 `SCRIPTS`：`sway` / `out-left` / `out-right` / `reentry` / `sitstand` / `stepback` / `light` / `policy` / `two`），
每帧固定 1/60 秒，逐帧记下景别进度、舞台视角与移轴、小屏窗口、腿、横向根偏移，每一路的变化量折到 16ms 取最大值。

- **node**：`scripts/framing/trace.ts`。"改后" = 当前树（`dev/framing-sim.ts`，照抄 main.ts 取景那几行）；"改前" = `git archive 6439275` 解出来的旧模块、按旧签名重写一遍当时的接线（那时没有横向根偏移，x 恒 0）。
- **无头 Chrome**：`scripts/framing/browser.ts`（raw CDP、`--headless=new --mute-audio`，跑完 `SIGKILL`）打开 `/dev/framing.html?script=…&loop=0&dt=fixed`，读页面自己算的同一组数，在时间线 25 / 50 / 75% 处截图。九段全部 `done`、控制台 0 错；**每一个数和 node 的"改后"逐位相同**。
- 逐帧 JSON 与截图在工作树 `scratch/evidence/framing/`（`before-*.json` / `after-*.json` / `browser/`），不进仓库。

**每 16ms 的最大变化量**（上限是 `AUTOFRAME.maxStep`；只列有差别的路）：

| 时间线 | 它走的是哪条路 | 改前 | 改后 |
|---|---|---|---|
| `light`（坐着、放大着，光线塌 2 秒） | §6.2 S1：放大着来了一句告警 | 小屏放大倍数 **0.288** | **0.024** |
| `sitstand`（再坐近那一段调速器在 hold） | §6.2 S2：hold 里景别 full → upper | 景别进度 **0.960**，视角 **24.70°** | **0.024**，**0.71°** |
| `stepback`（坐着往后退） | 退后；`active` 先变 false，弹簧先收回 | 放大倍数 0.0071 | 0.0044 |
| `sway` / `out-left` / `out-right` / `reentry` / `two` | 左右走 | 横向 **0**（身体不动） | 0.013 / 0.012 / 0.012 / 0.024 / 0.018 m（上限 0.03） |

`stepback` 改前也没有跳 —— 所以 §6.2 S1 那一行初稿"退后是最常见的缩小路径"被这张表推翻、已改正；真正经过那一帧跳的是"放大着来告警"（`light`）。
腿的混合改前改后都是 0.048（原本就连续，§6.3 的守卫第一次跑就是绿的）。

**横向的行为顺序**（无头 Chrome 页面读回的 `小屏的话 | 横向在做什么` 分段，括号里是身体横向位置，米，屏幕视角）：

| 时间线 | 发生了什么 |
|---|---|
| `out-left` | 0.8–3.6s 跟着走（0 → −1.14）→ 3.65s 躯干越过右边，**停在边上**（−1.23）→ 4.10s 小屏说「往右一点，回到画面里」并亮左边那条细边，一直到 6.88s，**人在边外时身体不回中线** → 6.90s 人往回走，身体从停着的地方接着跟（−1.26 → −0.08）。话比身体晚撤 0.8 秒：`PREVIEW.enterOkSeconds`（「好了」比「不好」多憋一会，§5 原有的裁定） |
| `out-right` | 与上面逐帧镜像（+1.14 → 停 +1.23 → 「往左一点…」→ 回来） |
| `reentry` | 2.53s 整个人出画（检测也没了）→ 停 1 秒（0.57 不动）→ 3.52s 起回中线（0.56 → 0）→ 5.53s 人从另一边进来，跟过去（→ −0.79），没有台阶 |
| `two` | 两个人一左一右、每 0.27 秒互换：`hold-jump` 与 `follow` 交替，身体一直在 **0.88–0.90**，没有被另一个人拽过去 |
| `light` | 光塌的 2 秒里横向 `hold-light`（冻结），小屏说「站到亮一点的地方」，放大倍数按 0.024/16ms 退回整幅 |

截图（`scratch/evidence/framing/browser/`）：`out-left-t5.5.png`（身体停在边上、目标虚线刻度在余量外、原图右边加粗）、`light-t5.png`（实际窗口红框在退回途中）、`two-t4.5.png`、`sitstand-t7.8.png` 等 27 张。

**首屏字节。** `npm run build` 之后 `vite preview`，无头 Chrome 关缓存、数 `Network.loadingFinished` 的传输字节到网络静默 3 秒：
`/` **96 个请求 2.086 MB**；`/?theme=porcelain&demo=1&seed=7`（不开摄像头直接进舞台）**107 个请求 2.101 MB**。都在 3 MB 之下。
docs/13 §6 记的是"标签页 → 选择页 → 舞台，100 个请求 2.06 MB"—— 走的路不一样（这里没有点选择页），**这一轮没有在 6439275 上重建一次做同口径对照**，两个数只能说"量级没变"。

### 6.7 先红后绿（每条守卫拿掉它守的那一行再跑）

`scratch` 里一个变异脚本：对每一条守卫做一处替换 → 跑那几条测试 → 还原；跑完 `git status --porcelain` 为空。**23 发 23 中**（第一轮 21 发，两发没有断言红，见表下）。

| 拿掉什么 | 红了哪条 |
|---|---|
| 小屏告警限速退回 → 一帧退回 | 连续性 · 小屏；小屏裁切 |
| 降级 hold 景别照走 → 一帧切 | 连续性 · 景别；景别 |
| 横向：人在边外停住 → 追外推坐标 | 半个人出了一边；整个人走出一边 |
| 横向：位置 / 尺度一帧跳当换人 → 照单全收 | 两个人来回跳；身后的人 |
| 横向：跟丢先停 1 秒 → 立刻回中线 | 被桌子挡住；跟丢 |
| 横向：躯干点全不可信时照报侧边 → 返回 null | 整个人走出一边；被桌子挡住 |
| 横向：回中线 / 让位不要死区 → 带死区 | 多人让位 |
| 侧边按 `MIRROR_X` 折 → 反过来 | 镜像；半个人出了一边；整个人走出一边 |
| 控制器限速 → 没有 | 连续性 · 横向；限速 |
| 控制器稳定延迟 → 没有 | 稳定延迟 |
| 控制器前馈上限 → 不限 | 速度前馈（第二轮） |
| 控制器目标去抖 → 直接用原始目标 | 目标去抖 |
| 小屏眼睛在上三分之一 → 放在正中 | 眼睛落在窗口上三分之一 |
| 小屏跟丢先停 1 秒 → 立刻放 | 小屏跟丢 |
| 小屏分辨率下限 → 不管 | 分辨率下限 |
| 摄像头在取景时不看尺度趋势 → 照看 | 摄像头在取景时 |
| 摄像头在取景时腿不在是预期 → 照催 | 摄像头在取景时 |
| 引导：侧边排在「往后退一点」前面 → 删掉 | 引导 · 侧边；引导 · 走出去再回来不闪 |
| 读数：WRN12 认侧边 → 不认 | 读数 · WRN12 |
| 细边按镜像画在对应一侧 → 不管镜像 | 镜像 · 细边 |
| 减少动态时小屏不裁 → 照裁 | 小屏裁切开不开 |
| `applyConstraints` 带上原来的约束 → 只写 `faceFraming` | 请求 · 尺寸与点名的摄像头不许被重置 |
| `applyConstraints` 的超时 → 没有 | applyCamFraming 永不挡启动（第二轮） |

第一轮没中的两发：**前馈上限**那一条测试用的是 ω = 3 的弹簧，它自己落后得多，把前馈的尖峰吃掉了，上限在不在都是绿的 —— 改成 ω = 20 的弹簧量冲过去的量，并先断言"这个用例里确实冲过去了"；
**`applyConstraints` 超时**那一发只是被测试运行器 8 秒超时**取消**，没有断言红 —— 测试里自己掐一块 1 秒的表去赛跑。两条改完再跑，都是断言红。

另有两条先红后绿不是变异出来的，是**写测试之前**就红的：连续性守卫在 `3a10f49` 提交时对着旧代码跑，景别 **0.831**/16ms、小屏 **0.651**/16ms（随机序列里的最坏帧），腿那一条是绿的。

### 6.8 仍然没做的、可能还不对的

2026-09-18 已完成一条：`posePresent()` 把“有可靠躯干锚点”与“全身平均质量”拆开。
13 个 0.95 + 20 个 0.1 的 0.435 近距离用例会进上半身，两轴跟随和人数观测都不再把它删掉；
读数仍如实显示 `0.43` 并保留整身质量告警。统一低质量与空数组仍不能通过，因此不是降低总门限。

1. **没接过真人摄像头。** 纵向、横向与模式证据来自合成的"画面里的人"；真录制又没有 `screen`。`faceFraming` 在稳定版 Chrome 上拿不到，`on` / `off` 只在假 track 上跑过。
2. **横向折算用"一个躯干长 = 0.5 米"**（和 docs/50 同一个数），离得远近、弯腰、侧身都会让尺度偏；死区吃掉小误差，大误差没在现场量过。
3. **横向前馈停下时最多冲过 0.1 米**，和"不过冲"有张力。现场如果读成"身体比我多走了一步"，把 `lateralLead` 调成 0。
4. **小屏的 `title` 看不见**：这一块指针穿透（`pointer-events: none`），悬停不出字。它只给无障碍与检查用；看得见的说明在 HUD。
5. **`dev/framing-sim.ts` 手抄了 main.ts 的接线顺序。** main.ts 改了，模拟不会自动跟；取证数字只对当前这一版成立。
6. **回放录制仍然没有 `screen`**（§5.7 第 4 条）：`?demo=1` 上横向与侧边话都演示不了。

## 7 · 中景更快跟（2026-09-15，第四轮反馈）

> 反馈原话（译）：①（重申）左右晃/出画时舞台上的身体看起来没有跟——追了一遍接线（`main.ts` →
> `poseClock.sample()` → `lateralEvidence(raw)` → `stepLateral` → `shiftSkeleton` → `stage.frame`），逐段核对和 §6.4 落地的
> 设计一致，没有找到额外的接线 bug；§6.8 第 1 条那句"没接过真人摄像头"依然成立，本轮同样只在
> 合成证据上验证，**这件事需要作品负责人自己拿真摄像头对着 `?debug=1` 的 HUD `framing` 行核一遍**
> （逐帧读数：横向偏移 / 侧 / 余量），才能判断是这一层真的没反应，还是余量 / 死区在特定取景下算出来
> 很小、动作因此不明显。② 作品负责人追加要求：全景那一档的迟钝是故意的（不抢"等身 + 相机距离不动"
> 那条主张的戏），但中景（`shot === 'upper'`）已经是自适应取景，不该被同一条主张管，应该更快、更小
> 死区。③ Google/Chrome 相机自带的 auto framing：`?camframing=auto|on|off`（`capture/cam-framing.ts`）
> 已经在读 `getSettings().faceFraming` 并让分类器把"腿不在"当成预期（§6.3 三）——这一条**已经做了**，
> 不是新需求；本轮没有再改它，因为它的读方向是"识别摄像头在裁"，不是"跟随摄像头的裁切位置"，
> 两者不是同一件事，误把后者读成前者会造成迷惑。

### 7.1 落地

只动 `core/src/autoframe.ts`（`LateralInput.upper` 一个新字段）、`core/src/tuning.ts`
（`lateralDeadZoneUpper` = 2cm、`lateralOmegaUpper` = 5.5，全景那两个数不变）、`main.ts`
（`stepLateral()` 传 `upper: framing.shot === 'upper'`）。全景一像素都不变——`upper` 缺省时
`input.upper` 是 falsy，走的还是原来那两个常数，`core/test/autoframe-lateral.test.ts` 的旧断言原样通过。

`core/test/autoframe-continuity.test.ts` 的横向守卫原来没有把 `upper` 传进 `stepLateral()`，
新常数因此完全不在它的随机序列覆盖范围里——**补上了**（`upper: f.shot === 'upper'`），
再跑一遍确认 ω = 5.5 没有让任何一帧的变化超过 `AUTOFRAME.maxStep.lateral`（21 个随机种子全绿）。

`autoframe-lateral.test.ts` 新增一条：同一个 0.01 画面宽的小步位移，全景（死区 5cm）不动，
中景（死区 2cm）该动；同一个大步位移，半秒时中景比全景更接近目标（ω 更高）。

### 7.2 仍然没做的、可能还不对的（并入 §6.8 的清单）

8. **中景更快这条同样没接过真人摄像头**——ω = 5.5、死区 2cm 是按"应该比全景明显"的判断选的，
   不是量出来的；如果现场读成"抖"或者"冲过头"，先看 HUD 的 `framing` 行里 `why` 是不是长时间停在
   `follow`（正常）还是在 `hold-*` 之间跳（那是证据本身不稳，不是弹簧的问题）。
9. **中景更快跟和摄像头自己的 auto framing 会不会打架，没有验证过。** 两边都在动同一件事的不同层：
   我们的中景跟随挪的是**身体在画面里的位置**，摄像头的 auto framing 挪的是**送进 MediaPipe 的那帧
   画面本身**。理论上互不冲突（我们读的坐标已经是摄像头裁完之后的），但从没有在一台真的开着系统
   auto framing 的摄像头上试过这个组合。

## 8 · 摄像头自带取景作兜底（2026-09-15，第五轮反馈）

> 反馈原话（译）：要一个判别条件——正常情况走我们自己这一套；比较极端的情况（我们自己的
> 读数不可信）直接信 Google/系统自带的这个 framing，把它当 fallback，因为它比较稳。

### 8.1 判别条件

只加一条：`LateralInput.cameraFraming`（`camFraming = cameraFraming()`，`main.ts` 本帧已经算过一次，
原样传进去，不重复读）。命中条件是三个都成立：

1. 我们自己的横向证据**质量不够**（`!ev.quality`，光线塌了或分辨率不够——原来的 `hold-light`）；
2. 这个人**没有**判成出画（`!ev.side`）——出画是另一件事，`hold-edge` 那支不变；
3. 摄像头**确认**在自己取景（`getSettings().faceFraming === true`，不是"支持"，是"正在"）。

命中时不冻结，直接回中线（`why: 'center'`，和跟丢超时回中线走同一条曲线，同样不设死区）。
质量够、或者已经判成出画时，这个字段完全不改变行为——`hold-edge` / `follow` / `hold-lost` 三支原样。

### 8.2 为什么是"回中线"，不是"跟它裁到哪"

我们**读不到**摄像头裁切窗口的坐标（docs/49 §1.3：`faceFraming` 规范没有暴露裁切区域，
只有开关本身）。能确认的只有"它在裁"这一件事，不知道裁去了哪。所以这不是跟随，
是一句"这一段我们自己不可信，比起冻在原地，回中线更接近真实情况"的判断——
理由是摄像头的取景本身就以把人留在中间为目标，而我们此刻恰好读不准。

### 8.3 仍然没做的、可能还不对的（并入 §6.8 的清单）

10. **这条同样没接过真的会自动取景的摄像头。** 三个判据分开测（`autoframe-lateral.test.ts`
    新增一条），但"摄像头真的在取景 + 我们的质量读数真的塌了"这个组合场景只在合成数据上验证过。
11. **`hold-lost`（完全没有证据，比如整个人被遮住）不吃这个兜底。** 只在“有证据但质量不够”时生效——
    摄像头在取景不代表镜头前一定还有人，没有证据时继续用原来的跟丢-回中线时序，不提前动。

## 9 · 真人反馈：跟不上（2026-09-15，issue #7 有了第一个真人）

> 反馈原话（译）：我们自己的 auto framing 做得很差，基本上跟不上——左右两边，
> 我到左边了，它还没过来，或者只能移动非常短的距离。**先不推代码，先记下来。**

`docs/53-BACKLOG.md` Q7 / [issue #7](https://github.com/p-to-q/see-me-see-u/issues/7) 一直写的是
"阈值只在合成姿态上调过，需要真人"——现在有了真人，结果是**负面的**：跟随明显滞后，
可移动的范围也比预期小很多。这条不是新症状，是 Q7 缺的那个真人证据到了，而且证据是坏的。

按证据先说清楚，再动代码：

- **没有做的事**：没有拿真摄像头测过实际能移动多少米、跟随的延迟有多少帧。§6.8 第 1 条、
  §6.3 二里 "横向折算用一个躯干长 = 0.5 米" 那条（§6.8 第 2 条）都还是没有真人量过的数。
- **两个可能的根因，没有分开验证**：① `AUTOFRAME.lateralOmega`（3.5）/ `lateralDeadZone`（5cm）
  这两个数是按"镜子不能太迟钝：1 米一步 0.8 秒跟到"这句话选的，从没有用真摄像头核对过 0.8 秒
  这个直觉对不对；② `stage.lateralRoom`（`framing.ts` 的 `lateralRoom()`）在真人常见的取景（笔记本
  摄像头，人比装置设想的 2.8 米更近）下算出来的余量，从没有打印过 HUD 实测。哪一个是真正的瓶颈
  （弹簧太慢，还是余量本来就很小），现在**都是猜的**。
- **下一步第一件事**（照抄 Q7 原来那条，做的方式更具体）：`?debug=1`，一边真人在摄像头前左右走
  一边读 HUD 的 `framing` 行（横向偏移 / room / why），记 3–5 组"我走了多少 → 身体挪了多少 → 用了几秒"，
  再回来看是 `lateralOmega` 太保守，还是 `room` 本身就窄。**不要不看这组数就先调常数**——
  上一轮（§7、§8）已经在没有真人的情况下调过一次弹簧和一次兜底，两次都只在合成证据上验证过。

这一轮没有改代码：GitHub issue #7 已同步这条评论，`docs/53-BACKLOG.md` Q7 的"现状"改成
"有了真人，结果是负面的——需要先量 HUD 读数，不要再猜着调常数"。

## 10 · 远处尺度抖动不能冒充稳定身份（2026-09-17）

`stepLateral()` 原来已经把“位置一帧跳过 0.2 画面宽”或“尺度一帧跳过 35%”当成换人，
但待确认状态只记了新位置 `pending`。因此两份检测只要横坐标接近，即使尺度一大一小逐帧交替，
也会共同攒满 0.5 秒确认时间；控制器随后接受其中一份，又开始下一轮，远处读起来就是反复跳。

待确认状态现在同时记 `pending` 与 `pendingScale`。位置和尺度都仍在原来的身份门限内，才算同一组
证据并继续计时；出画、坏光、跟丢或系统取景兜底都会清掉这段计时，回来后重新连续站稳 0.5 秒。
没有新增 tuning，也没有改变一个真正站稳的新观众的交接时间。

两条 30Hz 反证：同一个 x、两种相差悬殊的尺度交替 6 秒，旧实现会进入 `follow`，修复后 180 帧
全部是 `hold-jump`；0.3 秒候选 → 0.2 秒坏光 → 0.3 秒候选不能拼成 0.5 秒，随后连续 0.6 秒仍会
正常交接。证据仍是合成姿态；远距离真人观感和现有 35% / 0.5 秒两个 tuning 仍待现场验证。

## 11 · 单人近处要能跟，远处不能抖（2026-09-17）

### 11.1 根因与边界

§9 的真人反馈把问题归成“弹簧太慢”或“舞台余量太小”，但确定性反证找到更靠前的一层：
`stepLateral()` 原来先把 `(cx - 0.5) / scale` 投成米，再用固定米制死区和 One Euro 去抖。
这会让同一个 1% 画面横移在近处只剩很小的米数、被死区吞掉；在远处，中心与尺度两份小噪声
先相除，反而被成倍放大。继续调米制死区只能在近处迟钝与远处乱跳之间二选一。

现在的次序是：画面中心与躯干尺度分别去抖 → 把当前舞台根位置用 `stageToImageX()` 投回画面 →
在**画面高度单位**上做死区与二次过渡带 → `imageToStageX()` 投回米 → 原有闭式临界阻尼弹簧只管
前馈、限速、舞台余量与连续性。全景与中景仍有不同死区（0.006 / 0.003 画面高），但不再随距离
改变“要横移多少像素才响应”。工作台显示的蓝线由这两个画面阈值按当帧尺度换算成米，不另存第二份调参。
因此 §6–§9 里写作固定 5cm / 2cm、`lateralDeadZone*` 的旧实现说明由本节取代；那些段落保留的是当时的取证脉络，不是当前参数合同。

近处另有一层更早的坏输入：胯被画面下边裁掉后，MediaPipe 仍给出两个有限坐标，
但 visibility 已掉到不可信。旧 `lateralEvidence()` 只检查“有没有坐标”，仍把这两个外推胯点当根；
另一对可信肩又让整帧 `trusted = true`，所以坏胯点会真的拖走身体。现在根优先用**成对可信、且至少一点在画内的胯**，
没有时才退到同样条件的**肩**；任意一个躯干点可信不再足以驱动根。但画外坐标仍保留在侧边判定里，
因此整个人已经出画、所有点都低置信时仍会报正确左右，只是不追外推出来的位置。

远处还暴露了身份门的另一条边界：`lateralEvidence().scale = 0.10 ↔ 0.14` 只有 0.04 画面高的绝对变化，却有 40% 相对变化，
旧门会把同一个人约一半帧拦成 `hold-jump`。横向跟随现在要求尺度同时越过 35% 相对差和 0.05
画面高绝对差才算换人，而且相对差以两者中较小的尺度为分母，保证 A→B 与 B→A 是同一个判断；
`0.30 ↔ 0.80` 这种真正的两身份跳变仍被冻结。这个绝对门只作用于横向跟随，
没有顺手改模式分类器的尺度趋势语义。

### 11.2 确定性证据

`packages/core/test/autoframe-lateral.test.ts` 的 30Hz 合成人覆盖（下列 `s` 指 `PersonSpec.s`；身份门两项明确写 `lateralEvidence().scale`）：

- 近处中景 `s=1.0` 持续横移 1%：旧实现最终 **0mm**，改后 **10.9mm**；
- 近处 `s=1.0` 的两个胯点被改成 `x=0.95 / visibility=0.1`：根仍读可信肩中心 `x=0.56`，小幅横移能跟、不冲向画边；胯可信时旧有“前倾不当迈步”反证继续通过；
- 远处 `s=0.18`，中心 ±1% 与尺度 ±20% 以 0.5Hz 反相轻抖：旧实现尾段峰峰值 **19.5cm**，改后 **7.3cm**（门限 8cm），且每帧仍是 `follow`；
- 远处 `lateralEvidence().scale = 0.10 / 0.14` 逐帧交替并持续横移：两秒位移是无噪参照的 **101%**，120 帧中 **0** 次 `hold-jump`；
- 门限外 `lateralEvidence().scale = 0.30 / 0.45` 逐帧交替：180 帧全部 `hold-jump`、横向漂移 **0m**；这个反证同时钉住身份门的对称性；
- 同一舞台横向位置从 `s=0.10` 缓慢靠近到 `0.20`：由两路滤波相位差造成的横漂 **7.8cm**（门限 8cm）；
- 远处 `s=0.18` 的真实 12% 画面横移最终到 **1.01m**，没有为了抗抖把真实移动滤掉；
- `imageToStageX()` / `stageToImageX()` 在三种画幅、四档尺度、三个横坐标上 round-trip 到 `1e-12`；近/远固定目标的残差落进画面死区且没有撞 `room`；
- `s=1.0 / 0.18` 两档都守住镜像方向、左右边判断、出画冻结；回中线 / 让位清滤波、短冻结保留滤波；原有坏光、跟丢、多人让位与每 16ms 连续性断言继续通过。

这些数仍是合成姿态，不是现场定标。真人摄像头仍要分别站近 / 中 / 远三档，读 `?debug=1` 的
`framing` 行并录下实际响应时间与摆幅；在那之前，本节只能称逻辑稳定，不能称真人观感已定稿。
摄像头原生 `faceFraming` 的能力与兜底判据没有在这一轮扩展。

## 12 · 推理停滞不能把旧骨架报成“此刻看见”（2026-09-18）

`WebcamCapture.latest()` 按合同返回最后一份结果；它是缓存，不是新鲜度信号。身体为了不在一次短停时闪掉，
会由 `poseClock` 短外推，并在 250ms 后保持最后姿态最多 600ms；但 Auto Framing 分类器、小屏和读数原来
一直直接吃 `latest()`，因此推理若卡住，它们会无限期报上一帧的人和景别。

现在 `measuredPose()` 只在姿态时钟为 `live` / `extrapolating` 时交出采集原话；`holding` / `stalled` / `empty` /
`waiting` 都向这三个“此刻真的测量”消费者交 `null`。身体继续吃 `poseClock.sample()`，原有的平滑保持不变；
因此这不是拿闪烁换诚实。六个时钟状态与主线三个接线都有自动守卫。仍欠真摄像头人为卡住 worker 时的观感验证。
