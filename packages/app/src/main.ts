/**
 * 收口：把五条泳道接成一件作品。
 *
 * 一帧的顺序在 docs/06 §1 已经写死，这里就是照抄。
 * 之所以不发给子代理：这是唯一一处所有契约同时成立或同时失效的地方，
 * 出问题时必须有人能一眼看懂整条链，而不是看懂五个模块。
 *
 * 启动 = 打开一个 URL（P10）。URL 开关见 docs/06 §6。
 */
import * as THREE from 'three/webgpu';

import { buildSkeleton, mediapipeToWorld } from '../../core/src/skeleton.ts';
import { createStabilizer } from '../../core/src/stabilize.ts';
import { clampFold, createRefiner } from '../../core/src/refine.ts';
import {
  createFramingClassifier, decide, lateralEvidence, stepLateral, stepToward, LATERAL_REST,
  type FramingDecision, type FramingPolicy, type LateralState,
} from '../../core/src/autoframe.ts';
import { holdLegs } from '../../core/src/leghold.ts';
import { createVitality } from '../../core/src/vitality.ts';
import { createBoneEnergy, createMotion } from '../../core/src/motion.ts';
import { createEvolution } from '../../core/src/evolution.ts';
import { createPresence } from '../../core/src/presence.ts';
import { arcPresent, createArc, type ArcState } from '../../core/src/arc.ts';
import { makeGenome, toPlaceholderGenome } from '../../core/src/genome.ts';
import { blendSkeletons, remapSkeleton, type BodyPlan } from '../../core/src/bodyplan.ts';
import { mulberry32 } from '../../core/src/rng.ts';
import { createPeopleTracker, shiftSkeleton, type PeopleFrame } from '../../core/src/people.ts';
import { createProbeState, stepProbe } from '../../core/src/people-probe.ts';
import { AUTOFRAME, BUDGET, CAPTURE, GOVERNOR, NASCENT, PEOPLE, REFINE, STAGE, WARM } from '../../core/src/tuning.ts';
import type { Genome, MotionFeatures, PartMeta, Presence, Skeleton, SlotKey, SlotPick, Tier } from '../../core/src/types.ts';

import { createCapture, startInitialCapture, type Capture, type StartedCapture } from './capture/capture.ts';
import { createPartLibrary } from './assets/library.ts';
import { createCreature } from './creature/creature.ts';
import { createCompanions, createPipes, type CompanionResult } from './creature/companions.ts';
import { bodyFill, planPeople } from './creature/people-budget.ts';
import { makeTheseus, swapOneSlot } from './creature/theseus-wire.ts';
import { resolveShading, type ShadingId } from './creature/shading.ts';
import { createMassBody } from './creature/mass.ts';
import { createNascent } from './creature/nascent.ts';
import { createSwarmBody } from './creature/swarm.ts';
import type { BodyInstance } from './creature/body.ts';
import { createStage } from './stage/stage.ts';
import { contactPoints, REFERENCE_POSE } from './stage/framing.ts';
import { chooseTheme, themeFromUrl } from './choose/choose.ts';
import { catalogFromIndex, catalogKnowsTheme } from './choose/catalog.ts';
import { createFrameLoop } from './shell/safe-frame.ts';
import { wireDegrade } from './shell/degrade-wire.ts';
import { degradeTo, deviceLostAction, getDegradeState } from './shell/degrade.ts';
import { watchStall } from './shell/stall.ts';
import { createDeferral, createGovernor, GOVERNOR_LADDER } from './shell/governor.ts';
import { wireGovernor } from './shell/governor-wire.ts';
import { createWarmPlan } from './stage/warm-plan.ts';
import { createLongTaskCounter } from './shell/long-tasks.ts';
import { createPoseClock } from './capture/pose-clock.ts';
import { freshInference } from './capture/inference-clock.ts';
import {
  canRunPeopleProbe, peopleProbeCadence, trackedPrimaryOrSingleFallback, visibleSelectedCount,
} from './capture/people-probe-runtime.ts';
import { showBootError } from './shell/boot-error.ts';
import { createSlowLoop } from './slow/slow.ts';
import { createVisitReporter } from './archive/visit.ts';
import { enterKiosk, readFlags } from './shell/kiosk.ts';
import { mountCameraButton, mountEntry, wantsEntry } from './shell/entry.ts';
import { mountLoading } from './shell/loading.ts';
import { showNotice } from './shell/notice.ts';
import { isVacantPosition, vacancyOnShow } from './shell/vacancy.ts';
import { mountNav } from './ui/nav.ts';
import { announceStageShown, registerFreezable, revealSettled, transitionIdle } from './ui/page-transition.ts';
import { adoptPrepaint } from './choose/ring/first-screen.ts';
import { mountControls, type Controls } from './ui/controls.ts';
import { cornerColumn } from './ui/corner.ts';
import { mountPreview, wantsPreview, previewReservedTop } from './ui/preview.ts';
import { mountReadout } from './ui/readout.ts';
import { HANDED_BACK_ACT, mountExits } from './ui/exits.ts';
import type { ControlValues } from './ui/control-table.ts';
import { bodyAt, intentFromFlags, setOverlay, type Intent } from './shell/intent.ts';
import { createHud } from './shell/hud.ts';
import { createSound } from './sound/sound.ts';
import { createCues } from './sound/cues.ts';
import { createGroundSense } from './sound/ground.ts';
import { COPY, type BiText } from './ui/i18n.ts';
import { ACTS, createDirector, lineFor, type World } from './acts/index.ts';

const flags = readFlags();

/**
 * 「正在准备零件」这一档里，`parts.json` 自己占多少。
 * 剩下的留给选择页那 23 张 anchor 图 —— 它们才是这一档真正要等的东西。
 */
const PARTS_INDEX_SHARE = 0.15;

async function boot(): Promise<void> {
  // ── 0−. 点名的是一个**故意空着的位置** ───────────────────────────────────
  // 不是拼错的 id（那一类照家规当没写过，见下面第 4 节）。这一个名字指着花名册上
  // 一件真的东西，而它之所以空着本身就是内容。它没有身体可以装配，但它有一处
  // 已经在展出的说明 —— 《共生护照》第四枚章。理由与边界写在 `shell/vacancy.ts`。
  // 放在这里是为了在启动一整套渲染器之前就把人送过去；现场（`?kiosk=1`）不走这条。
  const vacancy = flags.kiosk ? null : vacancyOnShow(flags.theme ?? themeFromUrl());
  if (vacancy) { location.replace(vacancy); return; }

  // ── 0. 加载态（docs/23 §S0）─────────────────────────────────────────────
  // 在这之前，从打开 URL 到身体出现之间观众看到的是一块黑屏。它挂在最前面，
  // 但 600ms 宽限期内一帧都不画 —— 快的时候观众仍然不该看见这个场景。
  // `?loading=0` 返回空实现，所以下面的调用点不需要写 if。
  //
  // `wantsEntry(flags)` 在这里判一次、传给它：`mountEntry()` 这时候还没调用
  // （它要等 `revealSettled()` 之后，见下面），但"要不要展签"是纯读 flags 的判断，
  // 不需要等那一步。加载态需要提前知道结果——展签在场时它自己已经不显字标
  // （`html.sb-entry-up`），但**它自己的字标动画**（大变小、闪一下）是另一件事：
  // 展签那条路已经有 `morph(title, 'mark', …)` 在把巨题变成字标（`entry.ts`），
  // 加载态如果也做一遍同样的"变大变小"，观众会同时看见两份 SEE-ME SEE-U 的动画
  // 叠在一起（2026-09-15 真人测出来的）。所以有展签时加载态**不挂字标**，
  // 让唯一的那份动画只属于展签→选择页那条路。
  const loading = mountLoading(flags, { hasEntry: wantsEntry(flags) });
  // index.html 在第一帧之前按 URL 开上的纸底（docs/47）。展签 / 选择页各自 hold 住之后才放
  const releasePrepaint = adoptPrepaint();

  // 目录（docs/23 §S4）。现场（`?kiosk=1`）下 `flags.nav` 为 false，等于不存在。
  // 挂在这里而不是等选择页结束：慢网上它正好是那几秒里唯一"还有别的可看"的出口。
  //
  // 控件条（`ui/controls.ts`）和它共用右上角，所以目录一展开就要让位。
  // 控件条要等身体和舞台都在了才挂得起来，于是这里只能留一个可变引用 ——
  // 两条线的先后顺序是真实存在的，不假装它不存在。
  // ── 0b. 网页版入口层（docs/PRD §8 / docs/23 §S0 网页分支） ─────────────────
  // 唯一的作用是把「请求摄像头」推迟到观众自己按那一下为止：在此之前用回放驱动，
  // 一次权限都不问。现场（?kiosk=1）和深链拿到 null，这一层等于不存在。
  // 它不阻塞下面的加载 —— 只有进 S2 之前会 await 一次 entry.started。
  //
  // **它必须在目录之前建**：目录要不要挂上来就铺开，答案就是"展签在不在"，
  // 而那个答案只有它知道。用它的返回值，不要在这里把它的条件重写一遍。
  // 从别的页淡进来的那 240ms 里不起 WebGPU（环在 mountEntry 里、舞台在下面）：着色器编译卡住合成器，
  // 淡入就一帧都画不出来（docs/47 §4.3）。没有过渡时当场落定，现场开机不受影响
  await revealSettled();
  const entry = mountEntry(flags);

  // 右上角那一列：目录 → 设置 → 控件，三节同流（`ui/corner.ts`）。
  // 只在真要挂东西的时候才建，否则空的 fixed 元素会吃掉指针事件。
  const corner = flags.nav ? cornerColumn() : undefined;

  // 铺开是**展签版式的一部分** —— `shell/entry.css` 只在够宽时才为它让出右边一栏
  // （`@media (max-width: 620px)` 那条，跨文件对应关系写在这条注释和那条注释里）。
  // 620px 以下展签不再让位，这时候如果还铺开，目录会整片压在展签上——
  // 装置现场之外，手机和不少旧笔记本的视口都落在这一档，这正是被投诉的那个 bug。
  // 只在挂载这一刻判一次：nav.ts 的 toggle/点外面/Escape 都不看这个值，
  // 之后开合概不受影响。
  const entryHasRoomForNav = typeof matchMedia === 'function'
    && matchMedia('(min-width: 621px)').matches;

  let controls: Controls | null = null;
  const nav = mountNav({
    mount: corner,
    startOpen: entry?.shown === true && entryHasRoomForNav,
    enabled: flags.nav, overlay: true,
  });

  // 离散接触音（docs/29 §第五层）。**必须在这里建**，不能跟着 createSound 走：
  // 它要放的四记里有三记发生在选择页上，而 createSound 是选完主题才建的。
  // 建它只是发四个 fetch + 一次离线解码，不碰输出设备、不等用户手势，
  // 所以展签还立着的时候素材就已经就位了。加载不上就是那一记没声音（P3）。
  const cues = createCues({ muted: flags.mute });

  // ── 1. 资产先开跑。它不依赖渲染器 ────────────────────────────────────────
  // 原来它排在 `renderer.init()` **后面**。可 parts.json 和 anchor 图跟渲染器
  // 一点关系都没有，而 init() 是首次 pipeline 编译，慢机器上要好几秒 ——
  // 那几秒里管子完全是空的。改成并行，首屏少等的正是这一整段。
  // 失败也 resolve：没有 parts.json 时用占位几何照跑（ADR-4）。
  loading.begin('parts');
  const library = createPartLibrary();
  const libraryReady = library.load().then(() => loading.progress('parts', PARTS_INDEX_SHARE));

  // ── 2. 渲染器与舞台 ──────────────────────────────────────────────────────
  loading.begin('render');
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, GOVERNOR.dprMax));
  renderer.setSize(innerWidth, innerHeight);
  // 渲染器造出来了 —— 这是这一档里唯一一个 init() 之前就成立的真事实。
  // 报它是因为 init() 是一个不可分割的长 await：没有这一格，慢机器上
  // 「正在点亮画面」会在 0% 上停好几秒，而停住的数字读起来就是"坏了"。
  loading.progress('render', 0.4);
  // WebGPU 必须先 init() 才能同步 render()。renderAsync() 已废弃，
  // 而且每帧 await 会把渲染塞进微任务队列，帧时间读数会骗人。
  await renderer.init();
  loading.done('render');
  document.body.appendChild(renderer.domElement);

  // WebGPU device 丢了（驱动重置、GPU 进程崩了）：之后一帧都画不出来（docs/48 §5）。
  // 先说一句「出了点问题，正在恢复」，再直接重载 —— 不白走降级阶梯的前两级，但仍吃重载闸。
  // `destroyed` 是我们自己拆的（离开舞台时），不算事故（`shell/degrade.ts` 的 deviceLostAction）。
  const threeDeviceLost = renderer.onDeviceLost.bind(renderer);
  renderer.onDeviceLost = (info) => {
    try { threeDeviceLost(info); } catch { /* 三自己的那条日志，炸了也不管 */ }
    const lost = info as { reason?: string | null; message?: string } | undefined;
    if (deviceLostAction(lost) !== 'reload') return;
    showNotice(COPY.boot.failed, { corner: 'bottom-right' });
    setTimeout(() => degradeTo('reload', `device lost: ${lost?.reason ?? lost?.message ?? 'unknown'}`), GOVERNOR.deviceLostNotice * 1000);
  };

  // 回落到 WebGL2 了没有。**在这里读，不在这里说** —— 说要等加载态收掉之后（见下面），
  // 否则这句话会被那一层盖住，等它露出来的时候 4 秒早就走完了（实测踩过）。
  const renderFellBack =
    (renderer.backend as { isWebGPUBackend?: boolean } | undefined)?.isWebGPUBackend !== true;

  const stage = createStage();
  stage.resize(innerWidth, innerHeight);
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    stage.resize(innerWidth, innerHeight);
  });

  enterKiosk(renderer.domElement, flags);
  // HUD 和那块小屏幕（`ui/preview.ts`）共用左上角，而小屏幕赢 ——
  // 它是给观众的，HUD 是给我们自己的。挂不挂只看 flags，所以这里就能算出来。
  const hud = flags.debug ? createHud({ top: wantsPreview(flags) ? previewReservedTop() : 8 }) : null;

  // ── 3. 等资产（上面早就在跑了）──────────────────────────────────────────
  await libraryReady;
  if (library.usingFallback) console.warn('[main] 没有部件库，用程序化占位几何运行');
  entry?.setSpeciesCount(library.usingFallback ? null : library.index.themes.length);
  // PartLibrary 是这一页对 parts.json 的唯一所有者。选择页只拿这份轻量投影，
  // 不再为条目 / 可穿戴计数重复下载、重复 JSON.parse。
  const chooseCatalog = catalogFromIndex(library.index, !library.usingFallback);

  // ── 4. 采集与选主题**并行** ──────────────────────────────────────────────
  // 为什么并行：MediaPipe 的 wasm + 两个模型要好几秒。串行的话观众选完主题
  // 会盯着一块黑屏等它加载 —— 而那正是整个体验里最需要连贯的一刻
  //（卡片冲向镜头、溶解、然后身体应该**已经在那里了**）。
  loading.begin('body');
  const capturePromise: Promise<StartedCapture> = (async () => {
    // 入口层在场 = 还没人授权过 → 先用回放起步（见 shell/entry.ts 的文件头）
    // onStep 是采集端自己报的真实里程碑，不是定时器（见 capture.ts 的 CaptureStep）
    const started = await startInitialCapture(entry ? 'replay' : undefined, {
      onStep: (done, total) => loading.progress('body', done / total),
    });
    for (const failure of started.failures) {
      console.warn(`[main] capture(${failure.kind}) 开机失败，已降级：`, failure.error);
    }
    if (!started.failures.length && started.capture.lastError) {
      console.info(`[main] capture(${started.kind}) 已兜住：`, started.capture.lastError);
    }
    loading.done('body');
    return started;
  })();

  // 展签还立着的时候不要把选择页顶出来。加载在后面照常进行，这里只等那一下点击。
  await entry?.started;

  // 展签一走，目录就收回那个词。理由同上：让出右边一栏的是展签的版式，
  // 展签不在了那一栏也就不在了，再铺着就是压在作品上。
  // 观众想看目录随时点得开 —— 收起来的不是入口，只是那张表。
  nav?.close();

  // 「开始」那一下同时是 AudioContext 的解锁时刻，一声轻触是"系统醒了"的唯一回执。
  // 放在 await 之后而不是塞进 entry.ts：`started` 是在 click 处理里 resolve 的，
  // 紧接着的这一个微任务仍在同一次用户手势内，浏览器照样放行。
  // 深链与现场（entry === null）没有这一下点击，也就没有这一声 —— 那是对的。
  if (entry?.shown) cues.play('enter');

  let theme = flags.theme ?? themeFromUrl();
  // 写法由 `readFlags()` 判过了（`?theme=` 与 `?plan=` 同一条规矩），**在不在**只能在
  // 这里判：物种表要等 `libraryReady`。不在就是当没写过 —— 照常进选择页，并且喊一声。
  // 在这之前 `?theme=xenoo` 会直奔一个不存在的物种：没有名牌、没有自有件，
  // 画面上是一具借来的身体，而地址栏里写着那个拼错的名字（`?plan=quadrupd` 的同胞）。
  // 条目表读不到时**认**这个 id —— 和 `chooseTheme()` 同一条（没有资产也要能开发，ADR-4）。
  if (theme && isVacantPosition(theme)) {
    // 只有现场会走到这里 —— 网页版在 boot 开头就送去护照那一枚章了。
    // 说法和下面那一条**必须不一样**：这一个不是"查无此人"，是"这里没有人"。
    console.warn(`[main] ?theme=${theme} 是一个故意空着的位置（docs/14 §2）—— 没有身体可装配，照常进选择页`);
    theme = null;
  } else if (theme && !catalogKnowsTheme(chooseCatalog, theme)) {
    console.warn(`[main] ?theme=${theme} 不在物种表里 —— 按没写过处理（进选择页）`);
    theme = null;
  }
  if (!theme) {
    // 举手滚动（`choose/ring/wave.ts`）。现场一件输入设备都没有，这是那一页
    // 唯一一条不靠鼠标/键盘的输入。三个条件缺一不可，**判断只在这一处**：
    //   1. `?wave=off` 没关掉它（认不出来的值 = 没写过，走默认 on）
    //   2. 这一刻驱动帧的真的是摄像头 —— 网页版入口层还在时用的是回放，
    //      现场 / 深链才是摄像头（和上面 `createCapture` 的判断同一条）
    //   3. `?demo=1` 不算。让一段录像去操作名单，观众看见的是"它自己在动"
    // 摄像头还在起（好几秒）时 `captureForChoose` 还是 null，手势就晚一点到位 ——
    // 这一页在此期间照常可以用鼠标/键盘，不需要等它。
    const waveOn = flags.wave !== 'off' && !entry && !flags.demo;
    let captureForChoose: { latest(): ReturnType<Capture['latest']> } | null = null;
    if (waveOn) void capturePromise.then((started) => {
      // 摄像头起不来时初始编排会退到回放。录像不许倒过来操作选择页。
      if (started.kind === 'webcam') captureForChoose = started.capture;
    });
    console.info(`[main] 选择页举手滚动：${waveOn ? 'on' : 'off'}（?wave=${flags.wave ?? '默认'}）`);
    await new Promise<void>((done) => {
      void chooseTheme({
        onChoose: (id) => { theme = id; done(); },
        catalog: chooseCatalog,
        seed: flags.seed ?? undefined,
        pose: waveOn ? () => captureForChoose?.latest() ?? null : undefined,
        onPass: () => cues.play('pass'),
        // 自动选择必须和手动确认**不是同一声**，否则观众会以为自己碰到了什么
        onCommit: (_id, how) => cues.play(how === 'idle' ? 'idle' : 'commit'),
        // 这一页真正的等待在它返回之前（23 张 anchor 图）。只上报，不改这一页的任何表现。
        onProgress: (n, total) => loading.progress(
          'parts', PARTS_INDEX_SHARE + (1 - PARTS_INDEX_SHARE) * (total ? n / total : 1),
        ),
        // `?gl=off` —— 强制走无 WebGL 的 DOM 列表。在这之前这个参数只接在
        // `/dev/choose.html` 上，而 `choose.ts` 的文件头拿它当"这条降级路径跑过了"
        // 的证据：那是一句关于**正式程序**的话，而正式程序上它什么都不做（docs/36 D2）。
        forceFallback: !flags.gl,
      }).then((handle) => {
        // 选择页已经在屏幕上了 —— 观众有事可做，加载态立刻让位。
        // 剩下的预取在后面继续跑，但它不该再挡着任何人。
        loading.finish();
        releasePrepaint();
        // 机器把一盘东西放到你面前（docs/29 §2.7）。**必须在这里，不能在
        // `chooseTheme` 调用之前** —— 那时候页面还没落定，声音会早于画面，
        // 读作"它自己弹出来了"而不是"它拿给你"。
        // `handle` 为 null（URL 里已经有主题）时这一页压根没出现过，也就不该有这一声。
        if (handle) cues.play('reveal');
        if (!handle) done();   // handle 为 null = URL 里已经有主题
      });
    });
  } else {
    loading.done('parts');
    releasePrepaint();
  }

  // 血统：前人留在这台机器上的件，有机会进下一个人的候选池（docs/17 §5）。
  // 这是「模型会被改变、会留下后果」的那一半 —— 没有它，慢回路只是一次性的礼物；
  // 有了它，这台机器上的物种池是被历任观众改写过的。
  // 公开 Web / 普通 preview 下这个端点是 404，`lineage()` 返回空数组；
  // 只有现场的本机 production preview 显式开闸，开场两种情况都不被它挡住。
  /**
   * 慢回路为**这一个观众**生成、已经到货的件 —— 忒修斯借件的 d4 池（docs/44 §4）。
   * 空着就是没到货，d4 退回 d3。人一走清空（它属于这个人，不属于下一个）。
   */
  const grown: PartMeta[] = [];
  const slow = createSlowLoop({
    mask: () => capture.latestMask(),
    species: () => theme ?? '',
    loadGeometry: (url) => library.loadUrl(url),
    // id 只用来做人均预算闸，不落任何身份。随机源放在入口边界，
    // slow 模块自己不读时钟也不摇骰子；极旧浏览器无 crypto 时留空，由服务端代生。
    newSessionId: () => globalThis.crypto?.randomUUID?.() ?? '',
    // 团块身体没有槽位，也就没有"接一个零件上去"这回事 —— 它的表达是连续的。
    // 这不是缺陷，是 docs/18 里两种表达的分界；慢回路对它静默跳过。
    body: () => (isMass || isSwarm ? null : {
      graft: (slot, meta, geometry) => { grown.push(meta); creature.graft(slot, meta, geometry); },
    }),
  });
  for (const p of await slow.lineage(theme ?? '')) {
    if (!library.index.parts.some((q) => q.id === p.id)) library.index.parts.push(p);
  }

  // 预取被选中主题的部件，免得进场后第一秒还在拿占位几何顶着
  const wanted = library.index.parts.filter((p) => p.family === theme).map((p) => p.id);
  await Promise.race([
    library.preload(wanted),
    new Promise((r) => setTimeout(r, 2500)),   // 预取失败/慢也不许卡住进场
  ]);
  // 深链（`?theme=`）没经过选择页，加载态要在这里收 —— 它是幂等的，重复调用无害
  loading.finish();

  // `let` 而不是 `const`：观众按下「用我的摄像头」之后，这一个引用会被换掉
  // （回放 → 摄像头）。两个实现可互换是 Capture 的硬契约，帧循环不需要知道换过。
  const initialCapture = await capturePromise;
  let capture = initialCapture.capture;

  // 身体方案：物种自己声明，?plan= 可覆盖（docs/18-BODY-PLANS.md）。
  // 这是「物种真的不一样」与「同一具人体换皮」之间的那一行。
  const themeDef = library.index.themes?.find((t) => t.id === theme);
  stage.setTheme(themeDef ?? theme ?? null, library.index);

  // 进场这一刻，`docs/23` 允许说两句话，都只说一次、都自己淡掉：
  //
  //   §S4  左下角物种名 —— 「观众需要知道自己选的是什么，但只需要知道一次」。
  //        此前这一行不存在：选择页一退场，观众就再也没机会知道自己选了什么。
  //   §S0  右下角「降级渲染」—— 只给网页版。现场静默：站在装置前面的人
  //        对这条信息无能为力，说了只是打扰。此前只有一行 console.warn，
  //        而那是给我们看的，不是给观众看的。
  if (themeDef) showNotice({ zh: themeDef.name, en: themeDef.nameEn });
  if (renderFellBack && !flags.kiosk) showNotice(COPY.boot.fallbackRender, { corner: 'bottom-right' });
  // ── 身体方案：**开场一律人形**（docs/40 §1「为什么开场必须是人形」）───────────
  //
  // 此前这一行是 `flags.plan ?? themeDef?.bodyPlan ?? 'rig'`，一次算定。
  // 现在物种自己的方案**不是被取消，是被推迟**到第 III 乐章：第 I 乐章的概念是
  // datafication，「它借你的动作站立」—— 借的是**你的**动作，那就必须先有一具
  // 能读成"你"的身体。一面四条腿的镜子不是镜子。
  //
  // `?plan=` 仍然**立刻**生效（不等第 III 乐章）：look dev 要的是一个开场就站定的靶子。
  // 但它和控件条按下的形体一样是一条**叠加**（`shell/intent.ts`），不再是永远赢过弧线的覆盖 ——
  // 再点一次就拿掉，身体回到弧线（作品负责人 2026-09-14：没有一个按钮能锁住系统）。
  const speciesPlan: BodyPlan = themeDef?.bodyPlan ?? 'rig';
  /** 观众叠在弧线上的东西。按钮只增删它，导演和身体到场每帧自己读；人一走回到 URL 写的那一份 */
  let intent: Intent = intentFromFlags(flags);
  const kindOf = (p: BodyPlan | null): string =>
    (p === null ? 'rig' : typeof p === 'string' ? p : (p.kind ?? 'rig'));
  /** 这一帧实际用的方案（弧线还没到第 III 乐章时是 `rig`，见 `planDrift()`） */
  const activePlan = (): BodyPlan => (intent.form as BodyPlan | undefined) ?? speciesPlan;

  // ── 4b. 左上角那块小屏幕（`ui/preview.ts`）────────────────────────────────
  // **挂在这里，不是更早。** 它要显示摄像头画面，而这件作品有一条硬规矩：
  //「开始」之前一次权限都不问（`shell/entry.ts` 文件头）。挂在选择页之前，
  // 它就得先有画面可显示，那就等于把权限弹窗提到了第一眼 —— 正好是那条规矩
  // 存在的全部理由。所以它出现在**观众选完物种、已经进到作品里**之后：
  // 这一刻回放或摄像头都已经在跑，它显示的是真事。
  //
  // 挂不挂的判断在 `wantsPreview()` 一处（`?demo=1` 永不挂、`?kiosk=1` 默认不挂），
  // 这里不重写一遍那个条件 —— 和 `flags.nav` 同一条纪律。
  // ── 4a. 取景模式（`core/src/autoframe.ts`，docs/49 §落地）─────────────────────
  // 分类器每帧吃 **raw**（和小屏、读数同一份，滤波之前）：它要回答的是"画面里现在是什么样"，
  // 精化器那 0.67 秒的遮挡保持会让它晚一拍认出"腿不在了"。
  // 它的结论只给输出侧用 —— 舞台景别、腿、小屏裁切、引导；采集端一个像素都不动（docs/49 §3 用法 A）。
  const framer = createFramingClassifier({ kiosk: flags.kiosk });
  /** `?framing=` / 控件条。叠加在分类器上，选 auto 就交回去 */
  let framingPolicy: FramingPolicy = flags.framing;
  let framing: FramingDecision = decide(framingPolicy, framer.current);
  /** 腿混向站姿的权重（线性，`holdLegs` 里套 smoothstep） */
  let legHold = 0;
  /**
   * 身体的横向根偏移（docs/49 §6.3 二）。MediaPipe 的 world 以胯为原点：人在画面里站哪儿，那具身体都在中线。
   * 这里用躯干在画面里的横坐标把它补回来 —— 有界、弹簧、镜像；台上有伴随身体时让位给 docs/50 的站位
   */
  let lateral: LateralState = LATERAL_REST;
  /** 摄像头自己在取景（`capture/cam-framing.ts`，采集端每秒读一次）。回放没有摄像头：恒 false */
  const cameraFraming = (): boolean => (capture as { camFraming?: { active: boolean | null } | null }).camFraming?.active === true;
  const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  const preview = mountPreview({
    flags,
    // 上半身是正当取景时：「往后退一点」不为腿说话，小屏在人身上做一个小范围的数字裁切
    framing: () => framing.upperIsIntended,
    reduced: () => reducedMotion?.matches ?? false,
    cameraFraming,
    // 用 getter：观众按下「用我的摄像头」之后 `capture` 会被整个换掉，
    // 这块屏幕必须跟着换到新的那一个 `<video>` 上。
    // `video` 只有 `WebcamCapture` 有（回放没有摄像头画面），所以按可选字段读 ——
    // 和 HUD 读 `camera` 是同一个写法，不为一个显示用的旁路去动 `Capture` 契约。
    video: () => (capture as { video?: HTMLVideoElement }).video ?? null,
    // "摄像头这条路通不通"问的是那条流还在不在，不是有没有报过错：
    // `lastError` 上会留着"GPU delegate 失败，回落 CPU"这种**已经被兜住**的旧账，
    // 拿它当判据，画面明明好好的却会一直写着"打开摄像头"。
    cameraOn: () => {
      const v = (capture as { video?: HTMLVideoElement }).video;
      return !!v?.srcObject;
    },
    // 多人（docs/50 §6.2）：其余被看见的人淡淡地画出来。`people` 声明在下面，这个闭包第一次被调用时它早已初始化
    others: () => (people?.frame?.tracks ?? []).filter((t) => t.missing === 0 && !t.primary).map((t) => ({ pose: t.pose, bodied: t.selected })),
    // 自动探测确认了一个新人（docs/50 §6.3 修订）：「看到了第二 / 三个人」。`peopleHint` 声明在下面，
    // 同一条闭包纪律；探测没开、或没在提示窗口里时是 null，屏幕不多一个字（docs/23 §S4）
    notice: () => peopleHint(),
  });

  // ── 4c. 左下角那块读数（`ui/readout.ts`）──────────────────────────────────
  // 「它此刻从你身上读到了什么」：置信 / 关节 / 推理 / 动能 / 舒展，五个数
  // 都是这一帧本来就在算的。挂在这里而不是更早，理由和上面那块小屏幕一样：
  // 它报的是**驱动这具身体的那份数据**，而那份数据要等观众进到作品里才存在。
  //
  // 挂不挂的判断在 `wantsReadout()` 一处（`?kiosk=1` 默认不挂），
  // 这里不重写一遍那个条件 —— 和 `flags.nav` / `wantsPreview()` 同一条纪律。
  // `live`：从选择页进来时 capture 是回放，录像的每一帧都过 minScore —— 不告诉它，它就对着空场说「有人」。
  // `cameraOn` 在下面才声明，这里只是一个闭包，第一次被调用时它早已初始化
  const readout = mountReadout({ flags, live: () => cameraOn, upperIsIntended: () => framing.upperIsIntended });

  // ── 5. 状态机 ───────────────────────────────────────────────────────────
  const presence = createPresence();
  /**
   * 会话弧线（`core/src/arc.ts` / `docs/40-SESSION-ARC.md`）——
   * **这件作品的时间轴，此前它不存在**。四个乐章依次是
   * 跟随 → 回声 → 抵抗 → 朝向，导演按它排座次，分档跟着它走。
   * `?arc=<秒>` 当场改时长；认不出来的值在 `readFlags` 里已经退成 null 并喊过一声。
   */
  const arc = createArc({ total: flags.arc });
  let arcState: ArcState = arc.state;
  /**
   * 现在是不是摄像头在驱动。开场那一份由 `capturePromise` 决定，两处判断必须一致。
   *
   * **声明在这里，不在下面那一列旁边**（它原来在 `mountExits` 上面）：存档要在
   * 弧线走完的那一刻读它，而弧线和帧循环都建在这一行之前 —— `let` 有 TDZ，
   * 一个建得更早、调得更晚的闭包会在第一帧上炸，而那正是绝不许炸的地方（P2）。
   */
  let cameraOn = initialCapture.kind === 'webcam';

  /**
   * 存档（`docs/43 §8`）—— 一次走完的相遇往 `/api/visit` 写一行。
   *
   * 挂在弧线旁边而不是慢回路旁边：它记的是**这一场**，不是那一件生成物。
   * 帧循环里只有 `visits.note(arcState.held)` 一次 boolean 比较，网络在空闲里。
   *
   * `live` 是一个 getter，读的是**此刻**是不是摄像头在驱动：
   * 网页版开场用的是回放，摄像头要等观众按下「用我的摄像头」才打开。
   * 一段录像走完弧线不是一次相遇（那是给厚度掺水），而不按那个按钮就什么都
   * 不会被留下 —— 那正是 `§9.5` 那条「不参与」，`/about` 说出来的就是它。
   */
  const visits = createVisitReporter({
    species: theme ?? null,
    live: () => cameraOn,
  });
  // `let`：多人时主身体交接，接班那个人自己的那一套滤波器换进来（docs/50 §3.3）。单人时从不重新赋值
  let stabilizer = createStabilizer();
  // 时域精化在**原始 landmark 上**做，在 buildSkeleton 之前 ——
  // 骨架是从 landmark 推出来的，先抖后建等于把抖动烘进骨长和朝向里，
  // 后面再滤就只能滤掉症状。顺序不能反（docs/24 §2）。
  // 建出来就不再拆：这两个是控件条上唯一**必须能当场比**的两项
  //（"它为什么看起来像活的"），而重建一次精化器等于丢掉整条滚动中位数。
  // 所以开关是一个 boolean，不是一个 null —— 关掉时它不参与那一帧，仅此而已。
  let refiner = REFINE.enabled ? createRefiner() : null;
  let refineOn = flags.refine;
  // 生命力在 remapSkeleton **之后**才作用（见帧循环）：延迟要发生在**那具身体**的链上，
  // 不是人的链上。反了的话四足的前腿会带着人类肩膀的延迟。
  let vitality = createVitality();
  let vitalityOn = flags.vitality;
  const motion = createMotion();
  // 逐骨运动能量：`motion` 给的是整具的一个数，回答不了"他现在在用哪根肢体"，
  // 而 docs/44 §3 的 `motionBias`（"它拿走你正在用的那一部分"）只关心这个。
  const boneEnergy = createBoneEnergy();
  const evolution = createEvolution();
  // 身体方案决定用哪种**表达**：刚体挂载（手办式）还是团块（物质式）。
  // 两者都满足 BodyInstance，帧循环不关心是哪一种（docs/18 §2）。
  const planKind = kindOf(activePlan());
  const isMass = planKind === 'mass';
  // 点场（`creature/swarm.ts`）：和团块同一条路数的第三种表达 —— 一片跟着活骨架
  // 走的点，一件槽位件都不实例化。挂在 `field`／「场」这一个条目上，理由是它的
  // tagline 就是「身体消失，只剩运动」，而在这之前它**没有 bodyPlan**，
  // 走的是默认刚体装配、向别的物种借了一整套四肢。
  const isSwarm = planKind === 'swarm';
  // 着色语言：物种自己声明（`creature/shading.ts` 的那张表），`?shading=` 可覆盖。
  // 和 `bodyPlan` 同一条路数 —— 「线」这个物种的辨识度全在那一圈描边上，
  // 而描边是着色属性不是几何属性（docs/12），所以它只能在这里被决定。
  let shading: ShadingId = resolveShading(theme, flags.shading);
  // 忒修斯开着时给替换空着一个交接名额：它当帧开始、不排队，名额满了就只能越过 draw call 预算叠上去
  // 多人（docs/50）只在刚体身体上开：团块 / 点场是另一种表达，没有桶可共用 —— 那两种物种上 `?people=` 按 1 走
  //
  // 自动探测（docs/50 §6.3）：`flags.peopleAuto` 时人数上限从场合默认起步、探测把它往上抬，
  // 但 companions 的桶容量必须在**这里**、开机那一刻就按 `PEOPLE.hardMax` 留够 —— 半路再挂
  // `instanceColor` 会换材质管线（`creature.ts` 那句注释），那正是"探测确认了却还要等一拍才有身体"
  // 的卡顿来源。桶留够之后单人这条路一个像素都不变（`companionsMax > 0` 时只是多出的实例格空着不用），
  // 这就是任务卡要的"加载阶段预热"：不新开一段加载，只是把桶开大一点，成本是启动时多编一个着色器变体。
  const probeCapable = flags.peopleAuto && !isMass && !isSwarm;
  const peopleCapacity = probeCapable ? PEOPLE.hardMax : flags.people;
  const multi = (flags.people > 1 || probeCapable) && !isMass && !isSwarm;
  const creature = createCreature({ library, shading, replaceSlots: flags.theseus.on ? 1 : 0, companions: multi ? peopleCapacity - 1 : 0 });
  /**
   * **确认了的**人数上限：`plan.bodies` / 描边预算跟着它走。探测开着时从 `PEOPLE.defaultCap`
   * 起步，只在探测**真的**确认（或退档）时才改（下面的帧循环）；不开探测时永远是 `flags.people`，
   * 这一版之前的那条路一个字不变。
   */
  let peopleCap = flags.people;
  /**
   * **活的**人数上限：tracker.cap / worker `numPoses` 这一帧真的在跑的值。探测窗口里它临时到
   * `PEOPLE.hardMax`（先让 tracker 内部确认，不等于已经会画出一具身体，见帧循环那一段的注释）。
   */
  let liveCap = peopleCap;
  // 团块 / 点场、以及还没探测到别人时：别让 worker 白白按几个人跑检测器（docs/50 §1.2）
  capture.setPeople?.(multi ? liveCap : 1);
  const massBody = isMass ? createMassBody({ library, theme: theme ?? undefined }) : null;
  const swarmBody = isSwarm ? createSwarmBody({ library, theme: theme ?? undefined }) : null;
  // 开场那一具：tier 0 是一个还没分化出零件的团块，tier ≥ 1 才长出刚体件。
  // 理由全写在 `creature/nascent.ts` 的文件头 —— 一句话是：兜底几何是 catch 块，
  // 不是形态，拿它当开场，观众读到的是"它坏了"。
  // `bodyPlan:'mass'` 的物种本来就全程是团块，不需要这一层。
  // `NASCENT.enabled=false` 时这里是 null，下面的 morph 就退回"每档都 remorph"，
  // 也就是改这版之前的行为 —— 那个开关的理由写在 tuning.ts 的 NASCENT.enabled 上。
  // 点场和团块一样，本来就全程不实例化零件 —— 开场那一层（团块 tier 0）
  // 对它没有意义：它没有"还没分化出零件"的阶段，它从来就没有零件。
  //
  // **B 档物种（mass / swarm）现在也要这一层**：它们的物种身体要等到第 III 乐章
  // 才到场（见下面 `arcBody`），在那之前站在台上的必须是一具人形 ——
  // 而"人形"对它们来说就是这一团跟着人骨架走的未分化的体。
  // `?plan=mass` 强制时不需要它（那时物种身体开场就在）。
  const nascent = !NASCENT.enabled || (intent.form !== undefined && (isMass || isSwarm))
    ? null
    : createNascent({ creature, library, theme: theme ?? undefined });
  /** 第 I / II 乐章那一具：人形。团块开场 → tier ≥ 1 长出刚体件 */
  const humanBody: BodyInstance = nascent ?? creature;
  /** 物种自己的那一具（B 档才有）。A 档物种换的是拓扑，不换这一层 */
  const speciesBody: BodyInstance | null = massBody ?? swarmBody;

  /**
   * 物种的身体方案到场了没有。第 III 乐章（`NOT ME` / simulacrum）那一刻 ——
   * **它出现的那一刻因此有了意义：那正是 simulacrum 成立的证据**（docs/40 §1）。
   * 形体叠加开着时立刻到场；拿掉就回到弧线。两条都在 `bodyAt()` 里，`test/intent.test.ts` 钉住。
   */
  const speciesArrived = (): boolean => bodyAt(intent, arcState).arrived;
  /** 拓扑漂移的进度 0..1：第 III 乐章开头到第 III 个地名之间从人形漂到物种身体（`core/src/line.ts`） */
  const planDrift = (): number => bodyAt(intent, arcState).drift;

  /**
   * ── 第 III 乐章那一次到场（B 档物种）─────────────────────────────────────
   *
   * A 档物种（四足 / 环 / 柱 / 倒置 / 比例）换的是**骨架**，所以它的到场发生在
   * 帧循环里的 `blendSkeletons` 那一行，这里什么都不用做。
   * B 档（`mass` / `swarm`）换的是**表达**，而表达是构造期选定的 ——
   * 于是两具都建出来，由这个外壳决定这一帧谁在演、谁在淡出。
   *
   * 交叉淡入复用**已经存在的**那一套：两个模块都只认 `Presence`，
   * `ENTERING` 长出来、`LEAVING` 缩回去。所以这里不新造任何淡入淡出，
   * 只是把「真实在场 × 自己那一份 blend」合成两个假的 `Presence` 递下去 ——
   * 和 `creature/nascent.ts` 里那一段是同一个写法（同样的代价：smoothstep 套两层）。
   */
  const bodyRoot = new THREE.Group();
  bodyRoot.name = 'arc-body';
  bodyRoot.add(humanBody.object);
  if (speciesBody) bodyRoot.add(speciesBody.object);
  stage.scene.add(bodyRoot);

  const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const aliveOf = (pr: Presence | null | undefined): number =>
    (!pr ? 1 : pr.state === 'ENTERING' ? clamp01(pr.transition)
      : pr.state === 'LEAVING' ? 1 - clamp01(pr.transition)
        : pr.state === 'IDLE' ? 0 : 1);
  const fadeIn: Presence = { state: 'ENTERING', elapsed: 0, transition: 1 };
  const fadeOut: Presence = { state: 'LEAVING', elapsed: 0, transition: 0 };

  const body: BodyInstance = speciesBody === null ? humanBody : {
    object: bodyRoot,
    get stats() { return speciesArrived() ? speciesBody.stats : humanBody.stats; },
    reset() { humanBody.reset?.(); speciesBody.reset?.(); },
    pose(sk, presence, dt) {
      const t = planDrift();
      const alive = aliveOf(presence);
      humanBody.object.visible = t < 1;
      speciesBody.object.visible = t > 0;
      if (t < 1) {
        fadeOut.transition = 1 - alive * (1 - t);
        humanBody.pose(sk, t <= 0 ? presence : fadeOut, dt);
      }
      if (t > 0) {
        fadeIn.transition = alive * t;
        speciesBody.pose(sk, t >= 1 ? presence : fadeIn, dt);
      }
    },
    dispose() { humanBody.dispose(); speciesBody.dispose(); },
  };
  if (speciesBody) speciesBody.object.visible = intent.form !== undefined;

  // 页面只在入口边界向平台取一次熵；每一场的种子随后都由注入的 Rng 给出。
  // 极旧浏览器没有 crypto 时用固定种子继续跑（可复现的降级胜过偷偷改读时钟 / Math.random）。
  const entropy = new Uint32Array(1);
  try { globalThis.crypto?.getRandomValues(entropy); } catch { /* 固定种子兜底 */ }
  const encounterSeeds = mulberry32(entropy[0] || 0x5ee1e55);
  const nextEncounterSeed = (): number => flags.seed ?? Math.floor(encounterSeeds.next() * 0x100000000) >>> 0;
  let seed = nextEncounterSeed();
  let encounterRng = mulberry32(seed);

  // 声音（docs/29-SOUND.md）。四层各绑一个**已经算好的**信号，所以这里只是转手，
  // 不新增任何计算。它自己等第一次用户手势才建 AudioContext（浏览器自动播放策略），
  // 建不起来就永久静音继续 —— 画面一帧都不受影响（P3）。
  const sound = createSound({ muted: flags.mute, seed, theme: themeDef ?? null });
  // 触地那一记的判据（docs/29 §2.8）。它吃的是画接触阴影用的**同一批落点**，
  // 不是 `speed` —— 从 speed 推出来的是"动得快就响"，观众一听就知道对不上（P21）。
  const groundSense = createGroundSense();
  let slowWas = slow.phase;
  let lastFeatures: MotionFeatures | null = null;
  let lastSkeleton: Skeleton | null = null;
  /** 平移之前的那一份与它当时的平移量：跟丢时横向根偏移还在走，拿它重新平移 */
  let lastBase: Skeleton | null = null;
  let lastShift = 0;
  let tier: Tier = (flags.tier ?? 0) as Tier;
  /** 运动量那一半给出的档位。它只能把 tier 往上推，见帧循环里的那一段 */
  let evoTier: Tier = 0;
  let note = '';
  let elapsedT = 0;

  /**
   * ── 降级阶梯的前两级，在这里才第一次有人接（docs/36 D4）────────────────
   *
   * 机制一直在（`shell/degrade.ts`），动作一直没有：`registerDegradeHandler`
   * 在 `packages/app/src` 里零个调用者，正式程序的阶梯实际是
   * **空转 → 空转 → 重载**，而 `/dev/degrade.html` 把三级全打绿了 ——
   * 因为那一页注册的是它自己的三个处理器。
   *
   * 第 1 级走 `stage.setPost(false)`，也就是控件条「渲染」那一组按 `P` 的同一条路；
   * **不是**翻 `flags.nopost`（`createStage()` 开机读一次就不再读了）。
   * 第 2 级把整具换成占位几何 —— 丑，但一定画得出来（AGENTS.md 不变量）。
   */
  // ── 帧调速器（`shell/governor.ts`，docs/48 §4）的状态 ──────────────────────
  // **声明在降级接线之前**：降级处理器注册时如果已经降过级会当场执行，它要写 postWanted（let 有 TDZ）。
  /** 后期"应该"开着吗 —— 观众（控件条）和降级阶梯说了算；调速器只能在这之上临时关掉 */
  let postWanted = !flags.nopost;
  /** 调速器放下「替换」那一级：忒修斯的替换进延后闸 */
  let swapShed = false;
  /** 调速器放下「UI」那一级：读数停刷（它不驱动身体；小屏幕照刷 —— 那是给观众的回答） */
  let uiShed = false;
  /** 此刻要求采集端跑的推理频率。换了 capture 之后要重新告诉新的那一个 */
  let inferHz: number = CAPTURE.targetHz;
  /** 「降级渲染」那一句一个会话只说一次：说过了再说就是闪 */
  let saidReduced = false;
  const governor = createGovernor();
  /** 什么时候在空闲里把直出那条路编一遍 —— 让调速器放下「后期」只是一次切换（docs/48 §10） */
  const warmPlan = createWarmPlan();
  const longTasks = createLongTaskCounter();
  /** 推理节拍 → 渲染节拍（`capture/pose-clock.ts`）。身体吃它给的；小屏幕和读数吃采集端的原话 */
  const poseClock = createPoseClock();

  wireDegrade({
    setPost: (on) => { if (!on) postWanted = false; stage.setPost(on && postWanted); },
    toPlaceholder: () => {
      // 团块 / 点场没有槽位件，也就没有"换回占位几何"这回事；还没成型时同理。
      if (isMass || isSwarm || !creature.genome) return;
      creature.remorph(toPlaceholderGenome(creature.genome));
    },
  });

  /**
   * ── 忒修斯之船（`docs/44-THESEUS.md`）──────────────────────────────────────
   *
   * 排期器住在 `core`（纯的，测得起 200 个种子 × 180 秒），这里只接三件事：
   * 喂它时间和运动量、拿它给的那一件去 `remorph`、人一走把槽位收回来。
   * **没有第二套换装机制** —— docs/44 §1：升档那套一行都不浪费，只是粒度改细。
   *
   * `?theseus=off` 时 `theseus` 是 null，下面每一处都是 `?.`：
   * 关掉之后这条线上一个对象都不存在，身体退回这一版之前那条四档跳的路。
   */
  const theseus = makeTheseus(flags, seed, arc.total);
  type Fired = NonNullable<NonNullable<ReturnType<NonNullable<typeof theseus>['update']>>['fired']>;
  /**
   * 忒修斯替换的延后闸（docs/48 §4 第 2 级）。慢机器上替换压一压（最多 `GOVERNOR.swapDeferMax` 秒），
   * **不取消** —— 那一声和那一下碎开被一起压、一起放，仍然是同一帧。
   */
  const swapGate = createDeferral<Fired>(GOVERNOR.swapDeferMax);
  /**
   * 已经被换掉的那些槽位。**升档重建 genome 时必须盖回去** ——
   * `morph()` 是拿 `seed` 从头抽一具身体，不盖的话每一次乐章交接都会把
   * 前面换掉的件悄悄变回原件，于是"一件都不剩"永远走不到头，
   * 而画面上看不出发生过什么（它只是又换了一批）。
   */
  const swapped = new Map<SlotKey, SlotPick>();
  const withSwapped = (g: Genome): Genome => {
    if (!swapped.size) return g;
    const slots = { ...g.slots };
    for (const [k, v] of swapped) slots[k] = v;
    return { ...g, slots };
  };

  /** 正式升档与画外准备共用这一条入口；两边各算一份会暖错 seed / 降级状态。 */
  const genomeAt = (target: Tier): Genome => {
    const g = withSwapped(makeGenome(seed, target, library.index, {
      theme: theme ?? undefined,
      rejected: library.rejected,
    }));
    return getDegradeState().placeholder ? toPlaceholderGenome(g) : g;
  };

  const morph = (t?: Tier) => {
    if (t !== undefined) tier = t;
    // 团块没有槽位件可换 —— 它的"演化"由 tier 驱动的表面参数表达，不是换装。
    if (isMass || isSwarm) return;
    nascent?.setTier(tier);
    // tier 0 一件部件都没有（parts.json 里 tier 0 的件数是 0），有开场形态接着的时候
    // remorph 只会白建 30 个占位实例然后被团块盖住 —— 那 30 个实例正是这次要拿掉的东西。
    if (!nascent || tier >= 1) {
      // 已经降到第 2 级之后，升档不许把真几何再装回来 —— 那会让降级**自己撤销自己**，
      // 而画面上看不出发生过什么（docs/36 D4）。降级是单向的，只有重载能回头。
      creature.remorph(genomeAt(tier));
    }
  };
  morph(tier);

  // ── 未来档位：用正式 Mesh 在真实后期路径里、每帧一个桶地走过画外 ────────────
  // `compileAsync` 不能等价编译 PassNode/MRT（docs/48 §10.8）；真正能复用的是同一个
  // RenderObject。tier 0 的团块把刚体藏着，正好让 1–3 档的桶在画外逐个走一次真实 render。
  const bucketWarmPlans: ReturnType<typeof creature.prepareBuckets>[] = [];
  let bucketWarmIndex = 0;
  let bucketWarmStarted = false;
  let bucketWarmActive = false;

  const activateNextBucket = (): boolean => {
    while (bucketWarmIndex < bucketWarmPlans.length) {
      if (bucketWarmPlans[bucketWarmIndex]!.next()) return true;
      bucketWarmIndex++;
    }
    return false;
  };

  const resetBucketWarm = (): void => {
    bucketWarmPlans[bucketWarmIndex]?.park();
    creature.clearPreparedBuckets();
    bucketWarmPlans.length = 0;
    bucketWarmIndex = 0;
    bucketWarmStarted = false;
    bucketWarmActive = false;
  };

  const abandonBucketWarm = (): void => {
    bucketWarmPlans[bucketWarmIndex]?.park();
    creature.clearPreparedBuckets();
    bucketWarmPlans.length = 0;
    bucketWarmIndex = 0;
    bucketWarmStarted = true; // 这一位观众不重试；正式升档沿用原来的现编译兜底
    bucketWarmActive = false;
  };

  const maybeStartBucketWarm = (): void => {
    if (
      bucketWarmStarted || flags.tier !== null || !nascent || isMass || isSwarm || tier !== 0
      || library.stats.pending !== 0 || library.stats.queued !== 0
    ) return;
    bucketWarmStarted = true;
    try {
      for (const next of [1, 2, 3] as const) {
        bucketWarmPlans.push(creature.prepareBuckets(genomeAt(next), REFERENCE_POSE));
      }
      bucketWarmActive = activateNextBucket();
    } catch (e) {
      abandonBucketWarm();
      console.warn('[creature] 档位画外准备失败 → 升档时照旧现编译', e);
    }
  };

  /**
   * ── 多人入镜（`core/src/people.ts` / `creature/companions.ts`，docs/50）─────────────
   *
   * `?people=1`（缺省）时整块是 null，下面每一处都是 `people?.` / `if (people)`：单人那条路一个对象都不多。
   * 跟踪器给身份和"谁拿到身体"，伴随身体那一半算每个人的骨架，creature 把它们画进同一组桶。
   * 预算（几具、描边留不留）开机按物种算一次，换描边时重算（`creature/people-budget.ts`）。
   */
  const people = multi ? {
    tracker: createPeopleTracker({ cap: liveCap }),
    bodies: createCompanions({ seed: () => seed }),
    /** 此刻的主身体轨迹 id。和跟踪器的 `primary` 不一样的那一帧就是交接 */
    primary: null as number | null,
    plan: planPeople(peopleCap, bodyFill(library.index, theme ?? '', shading, flags.theseus.on, library.rejected), shading),
    /** 调速器放下「人数」那一级：只留主身体 */
    shed: false,
    frame: null as PeopleFrame | null,
  } : null;
  /** 多人状态机最后真正消费的推理时刻；渲染重复读缓存不能推进它。 */
  let peopleInferenceAt = Number.NaN;
  /** 最近一次**新推理**的人数；只保留数字，不让收缩上限后的旧多人快照滞留。 */
  let detectedPeopleCount = 0;
  /** 稳定单人快路返回同一个对象；渲染侧只需接一次空伴随结果。 */
  let renderedCrowd: CompanionResult | null = null;
  const replanPeople = (): void => {
    if (!people) return;
    people.plan = planPeople(peopleCap, bodyFill(library.index, theme ?? '', shading, flags.theseus.on, library.rejected), shading);
    creature.setOutlineWithCompanions(people.plan.outlineWithCompanions);
  };
  replanPeople();
  if (people) console.info(`[people] 上限 ${peopleCap} · 预算放得下 ${people.plan.bodies} 具 · 伴随身体在场时描边${people.plan.outlineWithCompanions ? '留着' : '让位'}（一具最坏 ${Math.round(people.plan.fill)} 面）`);

  /**
   * 自动探测（`core/src/people-probe.ts`，docs/50 §6.3）：`probeCapable` 时先让单人路径稳定，
   * 再在有性能余量时把人数临时抬到硬上限看一扇窗。显式固定 `?people=1|2|3` 时是 null。
   */
  const peopleProbe = probeCapable ? { state: createProbeState(peopleCap, peopleCap) } : null;
  /** 探测确认了第几个人，提示要说这一句；`stepProbe.uiDt` 用渲染时钟把它按时收起。 */
  const peopleHint = (): BiText | null => {
    const s = peopleProbe?.state;
    if (!s || s.hint <= 0) return null;
    return COPY.preview.peopleNoticed[s.hintLevel as 2 | 3] ?? null;
  };
  /** 正常单人优先；只有探测窗把推理降到轻量节拍。 */
  const effectivePeopleCadence = (): number => peopleProbeCadence(
    inferHz,
    peopleProbe?.state.phase === 'probing',
  );
  const syncPeopleCadence = (): void => {
    (capture as { setCadence?(hz: number): void }).setCadence?.(effectivePeopleCadence());
  };

  // ── 玩法扩展点（docs/16）。帧循环固定，玩法挂在旁边 ───────────────────────
  const director = createDirector(ACTS);
  const world: World = {
    get t() { return elapsedT; },
    get presence() { return presence.current; },
    get arc() { return arcState; },
    get skeleton() { return lastSkeleton; },
    get features() { return lastFeatures; },
    get evolution() { return evolution.state; },
    get genome() { return isMass || isSwarm ? null : creature.genome; },
    // getter：capture 会在运行中被换掉（回放 → 摄像头），玩法必须看到当前那一个
    get capture() { return capture; },
    // getter：按钮会把整份叠加换成新的一份（它是不可变的），导演每帧读到的必须是当前那一份
    get intent() { return intent; },
    creature: body, stage, library, flags,
    // getter 让换人后的玩法读到新 Rng；World 对象本身不重建，导演也不需要重新接线。
    get rng() { return encounterRng; },
    morph,
    note: (s) => { note = s; },
  };

  type EncounterResetReason = 'absence' | 'capture-change';

  /**
   * 一场的唯一清零点。自然离场与成功换输入源都走这里；页面级能力、调速器、
   * 已编译管线，以及 slow / visit 因真实失败立下的 disabled 闸都故意保留。
   */
  const resetEncounter = (reason: EncounterResetReason): void => {
    // 画外准备持有的是上一位观众 seed 下的正式 Mesh；先收起并解除保留，不能跨场沿用。
    resetBucketWarm();
    seed = nextEncounterSeed();
    encounterRng = mulberry32(seed);

    // 检测、时间轴与输出侧取景必须一起归零。少任何一个，新输入的第一帧都会与旧时间线插值。
    presence.reset();
    arc.reset();
    arcState = arc.state;
    elapsedT = 0;
    poseClock.reset();
    framer.reset();
    framing = decide(framingPolicy, framer.current);
    legHold = 0;
    lateral = LATERAL_REST;

    motion.reset();
    boneEnergy.reset();
    evolution.reset();
    stabilizer.reset();
    refiner?.reset();
    vitality.reset();
    groundSense.reset();
    swapGate.reset();

    // 异步回路先换 epoch / abort，再清画面状态；旧结果晚回来也不能写到新观众头上。
    slow.reset();
    slowWas = slow.phase;
    visits.reset();
    grown.length = 0;
    swapped.clear();

    if (people) {
      people.tracker.reset();
      people.bodies.reset();
      people.primary = null;
      people.frame = null;
      peopleInferenceAt = Number.NaN;
      detectedPeopleCount = 0;
      renderedCrowd = null;
      creature.setCompanions([]);
      stage.setGroup(0, 0);
    }
    if (peopleProbe) {
      peopleProbe.state = createProbeState(flags.people, flags.people);
      peopleCap = flags.people;
      liveCap = flags.people;
      people?.tracker.setCap(liveCap);
      capture.setPeople?.(liveCap);
      syncPeopleCadence();
      replanPeople();
    }

    lastFeatures = null;
    lastSkeleton = null;
    lastBase = null;
    lastShift = 0;
    note = '';
    evoTier = 0;
    tier = (flags.tier ?? 0) as Tier;

    // 身体实现各自清拖影 / 能量 / 在途交接，但保留 GPU 资源。新 seed 的形态随后直接落位。
    body.reset?.();
    bodyRoot.scale.setScalar(1);
    theseus?.reset(seed);
    morph(tier);
    body.pose(REFERENCE_POSE, presence.current, 0);
    stage.setArc(0);
    body.setArc?.(0);

    // 上一位可能把身体还回去了；下一位重新服从弧线。URL 写下的叠加仍是开机意图。
    if (director.forced && flags.act !== HANDED_BACK_ACT) director.release(world);
    intent = intentFromFlags(flags);
    if (hud) console.info(`[arc] 归零（${reason === 'absence' ? '离场' : '输入源已切换'}）—— 下一位从第 I 乐章开始`);
  };

  /**
   * 调速器的每一级 → 一个**已经存在的**开关（`shell/governor-wire.ts` 登记表，测试逐个核对）。
   * 只在级别变化时拨；开关自己炸了不拖垮帧循环。
   */
  const applyGovernor = wireGovernor({
    ink: (shed) => stage.setInk(!shed),
    swaps: (shed) => { swapShed = shed; },
    inference: (shed) => {
      inferHz = shed ? GOVERNOR.inferenceHzShed : CAPTURE.targetHz;
      // 保留调速器的显式开关契约；目标频率同时受后台人数探测的更低节拍约束。
      (capture as { setCadence?(hz: number): void }).setCadence?.(effectivePeopleCadence());
    },
    // 调速器只是短暂让后期让路：保留已编译的链，拿回来不在帧循环里重建。
    // 用户开关 / 永久降级仍走 setPost，负责真正释放显存。
    post: (shed) => stage.setPostSuspended(shed),
    dpr: (shed) => renderer.setPixelRatio(shed ? Math.min(devicePixelRatio, GOVERNOR.dprShed) : Math.min(devicePixelRatio, GOVERNOR.dprMax)),
    ui: (shed) => { uiShed = shed; },
    // 单人时 `people` 是 null：这一级是 no-op（docs/50 §5.4）
    people: (shed) => { if (people) people.shed = shed; },
  });
  // 调试探针（只在 ?debug=1 下挂）：直接拨到第几级，量"拨开关本身"是不是一次长任务（docs/48 §10）。
  // 调速器自己下一次变级时 `wireGovernor` 只拨和它不一样的那几个，所以拨乱了也会被收回来
  if (flags.debug) (globalThis as Record<string, unknown>).__governorProbe = { apply: (l: number) => applyGovernor(l) };

  // ── 6. 一帧（docs/06 §1） ────────────────────────────────────────────────
  // 停摆看门狗（`shell/stall.ts`，docs/48 §10.6）：定时器看门，不靠 rAF —— 帧停了它还在。
  // 停摆走有次数上限的重载；根因没追到，这是兜底，不是修复
  const stall = watchStall((sinceMs) => degradeTo('reload', `frame loop stalled ${Math.round(sinceMs)}ms`));
  const loop = createFrameLoop((dt, tMs) => {
    stall.frame(performance.now());
    elapsedT += dt;

    // ── 调速器：这一帧的真实间隔 + 长任务 → 该放下第几级（docs/48 §4）──────────
    // 后台标签页、无人降帧期间不判：那些帧慢是我们自己要的，不是卡。
    const gov = governor.sample({
      now: tMs,
      frameMs: loop.stats.frameMs,
      visible: document.visibilityState === 'visible' && !loop.stats.throttled,
      longTasks: longTasks.take(),
    });
    if (gov.changed !== 0) {
      applyGovernor(gov.level);
      // 带上时刻：拨开关本身可能就是一次长任务（关后期 / 改像素比会重建目标与管线，docs/48 §4.3），
      // 对得上长任务的时间戳才分得清"它在救火"还是"它在放火"
      console.info(`[governor] @${(tMs / 1000).toFixed(2)}s ${gov.changed > 0 ? '放下' : '拿回'} ${gov.step} → L${gov.level}（丢帧 ${(governor.jank * 100).toFixed(0)}% · 节拍 ${governor.refreshMs.toFixed(1)}ms）`);
      // 观众只在**看得出来**的那一级被告知一次：后期没了画面会变（docs/23 §S0 那一句）。
      // 前三级（墨色采样、替换延后、推理降频）观众看不出来，说了只是打扰。现场静默，同开机那一句。
      if (gov.changed > 0 && governor.sheds('post') && !saidReduced && !flags.kiosk) {
        saidReduced = true;
        showNotice(COPY.boot.fallbackRender, { corner: 'bottom-right' });
      }
    }

    // 采集端手上最新的那一份 —— **原话**，小屏幕和读数吃它（它们的职责是说实话）
    // 多人（docs/50）：跟踪器给身份，"主身体"那个人的那一份才是 `live` —— 小屏、读数、取景、声音都跟着他。
    // 单人时 `people` 是 null，`live` 就是 `capture.latest()`，一个字都不变
    const latest = capture.latest();
    const poseAt = latest?.t;
    const inference = people
      ? freshInference(peopleInferenceAt, capture.inferredAt, poseAt, dt)
      : null;
    if (inference) peopleInferenceAt = inference.stamp;
    // 完整姿态数组只活一个新推理步；渲染帧只缓存后面单人回退需要的人数。
    // 这样 `setPeople(1)` 截断 WebcamCapture 旧结果时，主线不会另外握着一份旧多人数组。
    const inferredPeople = people && inference
      ? (capture.latestAll?.() ?? (latest ? [latest] : []))
      : null;
    if (inferredPeople) detectedPeopleCount = inferredPeople.length;
    const crowd = people
      ? (inference ? people.tracker.update(inferredPeople ?? [], inference.dt) : people.tracker.current)
      : null;
    if (people) people.frame = crowd;

    // 自动探测（docs/50 §6.3）：喂这一帧真的还在画里的已选轨迹，结果影响**下一帧**的
    // tracker.cap / worker numPoses —— 决策天然晚一帧，和调速器采样同一个节奏，不逼帧循环里 await 任何东西。
    //
    // **只在真摄像头开着且机器有余量时探测**。回放（`?demo=1`、按摄像头之前的默认展示、
    // 摄像头丢了自动退回的那几秒）没有真人——`ReplayCapture.latestAll()` 在 `setPeople(n>1)`
    // 之后会**合成**另外几个人（`people-synth.ts`），那是给工作台 / 演示用的，不该在观众
    // 还没按「用我的摄像头」之前的默认画面里自己冒出来。这一条不加的话，展签之前的默认展示
    // 每隔 `probeIntervalSeconds` 就会凭空多出一两具合成的身体——2026-09-15 真人测出来的回归。
    if (peopleProbe && people) {
      const previousPhase = peopleProbe.state.phase;
      const step = stepProbe(peopleProbe.state, {
        // 只有新推理能推进人数证据；渲染帧只负责提示倒计时和及时撤掉超预算窗口。
        dt: inference?.dt ?? 0,
        uiDt: dt,
        selectedCount: visibleSelectedCount(crowd),
        canProbe: canRunPeopleProbe({
          active: cameraOn,
          visible: document.visibilityState === 'visible',
          throttled: loop.stats.throttled,
          degraded: loop.stats.degraded !== null,
          governorLevel: governor.level,
          frameMs: loop.stats.frameMs,
        }),
      });
      peopleProbe.state = step.state;
      if (step.state.phase !== previousPhase) syncPeopleCadence();
      // 活的上限（tracker.cap / numPoses）跟 target 走：探测窗口里它临时到 hardMax，
      // 好让 tracker **内部**确认第二、第三个人；这一步本身不会让任何一具身体被画出来（见下一段）。
      if (step.target !== liveCap) {
        liveCap = step.target;
        detectedPeopleCount = Math.min(detectedPeopleCount, liveCap);
        people.tracker.setCap(liveCap);
        capture.setPeople?.(liveCap);
      }
      // 确认了的上限（`plan.bodies` / 描边预算）只在探测**真的**升档或退档时才跟上 ——
      // 试探窗口里就算 tracker 内部选中了第二个人，也不该真的多画一具身体：
      // 否则一个人擦肩而过也会先长出一具身体再溶掉，正是 docs/50 §0 第 2 条要避免的"认错了人"。
      if (step.state.level !== peopleCap) {
        peopleCap = step.state.level;
        replanPeople();
        console.info(`[people] 探测把上限${step.justEscalated ? '确认' : '收回'}到 ${peopleCap}`);
      }
    }

    // 真摄像头的探测窗已经临时让 MediaPipe 输出多人，数组第 0 项不再有身份语义；即使第二人尚未
    // 获得身体，主通道也必须跟 tracker 的稳定 id。回放自动单人仍走 latest：旧录制没有 screen，
    // tracker 无法建立身份；显式多人回放由 synthPeople 补了 screen，可以照常走 tracker。
    const trackerOwnsChannel = !!(people && crowd && (cameraOn || peopleCap > 1));
    const trackerHasPrimary = trackerOwnsChannel && crowd !== null && crowd.primary !== null;
    const live = trackerHasPrimary
      ? trackedPrimaryOrSingleFallback(crowd, latest, detectedPeopleCount, peopleCap)
      : latest;
    // 主身体的人丢了一阵又被认回来：姿态时钟和滤波器不许在"之前"和"之后"之间插值（docs/50 §2.4）——
    // 中间可能隔着一次换姿势，甚至是另一个人被认成了他。插过去的结果是一具摊在地上的星形（2026-09-14 无头取证撞到的）
    if (trackerHasPrimary && crowd?.tracks.some((t) => t.primary && t.reacquired)) {
      poseClock.reset(); refiner?.reset(); stabilizer.reset(); vitality.reset();
    }
    if (people && crowd && trackerOwnsChannel && crowd.primary !== people.primary) {
      // 交接（docs/50 §3.3）：上一个主身体变成一具正在溶掉的伴随身体，停在他最后的样子和站位上；
      // 接班的人自己那一套滤波器换进主通道（他的身体已经在台上，不从零热身，也不吃上一个人的骨长）
      if (people.primary !== null && crowd.primary !== null) {
        const theirs = people.bodies.takePipes(crowd.primary);
        people.bodies.retire(people.primary, { refiner, stabilizer, vitality }, lastSkeleton, 0);
        const next = theirs ?? createPipes();
        refiner = next.refiner; stabilizer = next.stabilizer; vitality = next.vitality;
        poseClock.reset();
        if (hud) console.info(`[people] 主身体 #${people.primary} → #${crowd.primary}`);
      }
      people.primary = crowd.primary;
    }
    // 身体吃的那一份：两次推理之间插值，推理停了先保持再交出 null（`capture/pose-clock.ts`）。
    // 此前这里直接是 `capture.latest()`：30Hz 的结果被 60–120Hz 的帧连着吃好几次，动作一大身体就一顿一顿地追。
    poseClock.observe(live, capture.inferredAt ?? live?.t ?? Number.NaN);
    const raw = poseClock.sample(tMs);
    // "有没有人"：多人时任何一具身体的人此刻被看见就算（主身体被挡住一下，弧线不停、在场不掉，docs/50 §3.2）
    const detected = (raw !== null && raw.score > CAPTURE.minScore)
      || (crowd !== null && crowd.tracks.some((t) => t.selected && t.missing === 0));
    const p = presence.update(detected, dt);
    // 弧线吃的是**未经时间停滞缩放的 dt**（和 presence / evolution 同一条理由：
    // 升档那 0.15 秒是给身体的顿挫，不是给时间轴的）。在不在场用已有的 `Presence`
    // 折一下，不发明第二套检测（docs/40 §3）。
    arcState = arc.update(arcPresent(p), dt);
    // 一次走完的相遇，写一行。这里只有一次 boolean 比较（`docs/43 §7.1` 第 2 条）
    visits.note(arcState.held);

    // 把弧线交给**表面和光**（`docs/41-MATERIAL.md`）。
    //
    // 这一行之前，那整套材质设计在作品里是不存在的：`setArc()` 建好了、
    // 测试绿了、文档写了，但没有人调用它，于是运行时永远停在 `ARC_OFF`。
    // 一个没有调用方的功能和没有这个功能是同一件事 —— 它甚至更糟，
    // 因为仓库里那些绿色的测试会让下一个人以为它已经在跑了（docs/02 P21）。
    //
    // 喂的是 `overall`（整条弧线 0..1），不是 `progress`（当前乐章内部的 0..1）：
    // 表面要的是"走到哪儿了"，不是"这一段走了多少"。
    stage.setArc(arcState.overall);
    body.setArc?.(arcState.overall);

    // 那块小屏幕吃的是 **raw，不是精化之后的 cooked**。
    // 精化器会在遮挡时保持最后一次可信位置最多 0.67 秒（`core/refine.ts`）——
    // 那对身体是对的（抽搐比迟钝更毁体验），对这块屏幕是致命的：
    // 它会在人已经走出画面之后继续显示一副"看得见"的骨架。
    // 这块屏幕唯一的职责就是说实话，所以它站在滤波之前。
    // 取景模式先判，小屏和读数这一帧就用上同一个结论。吃**原话**（和小屏同一份）：
    // 它要回答"画面里此刻是什么样"，插值出来的那一份不是画面里有过的样子
    // 摄像头自己在取景时，腿被它裁掉是预期（docs/49 §6.3 三）：分类器和引导都要知道
    const camFraming = cameraFraming();
    framing = decide(framingPolicy, framer.update(live, dt, { cameraFraming: camFraming }), { cameraFraming: camFraming });
    legHold = stepToward(legHold, framing.holdLegs ? 1 : 0, dt, AUTOFRAME.legBlendSeconds);
    preview?.update(live, dt);

    // 伴随身体（docs/50 §4）：每个人各自的骨架、在场、站位。开场团块还没长出零件时（`emergence` 0）它们也不长
    // 稳定单人先判：命中时连 `bodyAt()` / CompanionContext 都不构造。
    const stableSingle = people && crowd ? people.bodies.stableSingle(crowd) : null;
    const crowdOut = stableSingle ?? (people && crowd ? people.bodies.update(crowd, {
      dt, plan: activePlan(), drift: planDrift(), refineOn, vitalityOn,
      bodies: people.shed ? 1 : people.plan.bodies,
      scale: nascent ? nascent.stats.emergence : 1,
    }) : null);
    if (people && crowdOut !== renderedCrowd) {
      creature.setCompanions(crowdOut?.companions ?? []);
      stage.setGroup(crowdOut?.groupWidth ?? 0, crowdOut?.groupHeight ?? 0);
      renderedCrowd = crowdOut;
    }
    // 横向根偏移：吃姿态时钟给身体的同一份连续流。模式分类 / 小屏仍吃 `live` 原话；
    // 这里若也吃原话，30Hz 的同一结果会在 120Hz 屏上变成「三帧不动、下一帧跳一下」。
    // 夹在舞台此刻的横向余量里（随景别连续变化）。
    // 台上有伴随身体时让位 —— 站位归 lineup；两个都是弹簧，加起来是连续的
    lateral = stepLateral(lateral, {
      evidence: lateralEvidence(raw), room: stage.lateralRoom, enabled: !crowdOut?.companions.length,
      // 中景死区更小、弹簧更快：进中景已经是自适应取景，不受全景那条"相机距离不动"的主张约束
      upper: framing.shot === 'upper',
      // 我们自己的证据质量不够时的兜底：摄像头确认在自己取景就信它，回中线（`camFraming` 本帧已经算过一次）
      cameraFraming: camFraming,
    }, dt);
    const shiftX = (crowdOut?.primaryX ?? 0) + lateral.x.x;

    if (raw) {
      // 运动特征算在**人的**骨架上：驱动演化的是观众实际动了多少，
      // 而不是重映射之后那具身体动了多少。顺序不能反。
      const cooked = refiner && refineOn ? refiner.apply(raw, dt) : raw;
      const trackedSk = stabilizer.apply(buildSkeleton(mediapipeToWorld(cooked), cooked.world, cooked.t), dt);
      // 反折约束放在稳定化**之后**：它靠骨长把远端点转回去，
      // 而骨长要等滚动中位数定下来才可信（放前面就是拿噪声当尺子）。
      if (refiner && refineOn) clampFold(trackedSk);
      // 上半身模式：腿换成站在地上的站姿，不被画外的腿点驱动（`core/src/leghold.ts`）。
      // 放在运动特征**之前**：站着不动的腿不该贡献动能。权重 0 时原样返回同一个对象
      const humanSk = holdLegs(trackedSk, legHold);
      lastFeatures = motion.update(humanSk, dt);
      // 逐骨能量也算在**人的**骨架上，和 `motion` 同一条理由：
      // docs/44 §3 那条机制说的是"他刚才在用哪根肢体"，不是"那具身体哪根动得多"。
      boneEnergy.update(humanSk, dt);
      // 拓扑漂移（docs/40 §1：**"逐渐"是这条线的全部技术要求**）。
      // 第 I / II 乐章 drift = 0，人形；第 III 乐章开头到第 III 个地名之间
      // 从人形漂到物种自己的方案；之后 drift = 1，一次 remap 就够，零额外开销。
      const drift = planDrift();
      const plan = activePlan();
      const planned = drift >= 1 ? remapSkeleton(humanSk, plan)
        : drift <= 0 ? remapSkeleton(humanSk, 'rig')
          : blendSkeletons(remapSkeleton(humanSk, 'rig'), remapSkeleton(humanSk, plan), drift);
      // 刚体挂载做不出"弯"，但一串各自延迟不同的刚体看起来就是在弯 ——
      // 这是参照作品那句 "wiggles, shifts, and bends" 唯一能不做蒙皮就拿到的部分。
      // 方案要一起递进去：vitality 末尾还要落一次地，而"拿谁当基准"随方案变
      // （没有脚的方案按整具最低关节，见 core/bodyplan.ts 的 groundsByLowestJoint）
      // 漂移一开始就按**目标方案**的基准落地：`inverted` / `radial` 的脚已经不是脚了，
      // 漂到一半再换基准会让整具身体跳一下 —— 宁可在漂移的第一帧换，那时它还在人形上。
      lastSkeleton = vitalityOn
        ? vitality.apply(planned, lastFeatures, dt, drift > 0 ? plan : 'rig')
        : planned;
      // 站位：多人时主身体和伴随身体一起排（docs/50 §4.2），单人时是横向根偏移（docs/49 §6.3 二）。
      // 平移在生命力之后：它的状态链上存的是没挪过的那一份。偏移为 0 时 `shiftSkeleton` 原样返回同一个对象
      lastBase = lastSkeleton;
      lastShift = shiftX;
      lastSkeleton = shiftSkeleton(lastSkeleton, shiftX);
      stage.frame(lastSkeleton);   // 取景按**重映射之后**的身体算：四足是横的矮的
      // 那具身体的重量真的落在地上。判据和上面那行画的接触阴影共用同一批落点，
      // 所以听到的那一下和看到的那一摊影子不可能对不上。dt 不吃 timeScale（同 sound.update）
      const feet = contactPoints(lastSkeleton, STAGE.contactPoints, STAGE.contactLiftRange);
      if (groundSense.update(feet, dt)) cues.play('ground');
      const evo = evolution.update(lastFeatures, dt);
      // 团块的"沸腾"层由运动能量驱动 —— 动得越猛表面越沸（tuning 的 MASS.surface）
      massBody?.setEnergy(lastFeatures.energy);
      nascent?.setEnergy(lastFeatures.energy);
      evoTier = evo.tier;
    } else if (lastSkeleton && lastBase && Math.abs(shiftX - lastShift) > 1e-4) {
      // 跟丢的这几帧没有新骨架，但横向根偏移还在走（先停住、再回中线）：身体和脚下的接触阴影一起挪
      lastShift = shiftX;
      lastSkeleton = shiftSkeleton(lastBase, shiftX);
      stage.frame(lastSkeleton);
    }

    // ── 忒修斯之船：这一帧要不要换一件（docs/44 §2 / §3）────────────────────
    //
    // 时间喂的是 `arcState.elapsed`（人不在就停表），在不在场喂的是同一个
    // `arcPresent(p)` —— 不发明第二套检测（docs/44 §8）。
    // 借件的种子由会话种子和第几件推出来，**不摇裸骰子**（P1）：
    // 同一个 seed 的同一场，第 7 件换成谁，每次都一样。
    const step = theseus?.update(
      {
        elapsed: arcState.elapsed,
        present: arcPresent(p),
        energy: boneEnergy.current,
        // 逐骨的那一份决定**换哪一件**，整具这一个决定**换多快**（docs/44 §3 的裁定）。
        // 两边喂的都是**人的**骨架算出来的读数，不是重映射之后那具身体的。
        overallEnergy: lastFeatures?.energy ?? 0,
      },
      dt,
    );
    // 整体尺度（docs/44 §5 第 5 条）。`bodyRoot` 的原点就是地面，所以按它缩放
    // **脚不会离地**；取景吃的是没缩放过的骨架（`stage.frame(lastSkeleton)`），
    // 所以这一下是真的在画面里长大/变小，而不是被相机跟着补偿掉。
    // `?theseus=off` 时 `step` 是 undefined，缩放回 1 —— 和这一版之前逐字相同。
    bodyRoot.scale.setScalar(step?.scale ?? 1);

    // 调速器放下「替换」那一级时，这一件进延后闸（最多压 `GOVERNOR.swapDeferMax` 秒，不取消）。
    // 没放下时闸是直通的：当帧 offer、当帧执行。闸里压着的那件到点了由 tick 放出来。
    // 一帧只问闸一次：这一帧有新的一件就 offer（它会先把压着的那件放出来），没有就 tick。
    // 同一刻 offer 之后再 tick 永远是空的 —— 刚压进去的那件 since 就是此刻。
    const due = step?.fired && !isMass && !isSwarm ? swapGate.offer(step.fired, tMs, swapShed) : swapGate.tick(tMs, swapShed);
    for (const fired of due) {
      // 借件距离按弧线张开（docs/44 §4）；d4 只在慢回路那一件真的到货之后才有得借
      const g = swapOneSlot(
        creature.genome, fired.slot,
        (seed ^ Math.imul(fired.index, 0x9e3779b9)) >>> 0,
        {
          tier, index: library.index, rejected: library.rejected, overall: arcState.overall, grown,
          // 给操作员（`?debug=1`），不给观众：换的是哪一格、从哪一圈借的（docs/44 §7 最后一段）
          onChoice: hud ? (c) => console.info(
            `[theseus] @${(tMs / 1000).toFixed(2)}s #${fired.index} ${fired.slot} ← d${c.ring} ${c.pick.partId}`,
          ) : undefined,
        },
      );
      // 借不到就是这一件不发生 —— 不抛、不等、不退化成"换了个一模一样的"（P3）。
      if (g) {
        swapped.set(fired.slot, g.slots[fired.slot]);
        // 不是交叉淡入：旧件碎开、新件装上、描边不断（docs/44 §7，形状在 `creature/replace-event.ts`）。
        // 这一下当帧开始，所以下面那一声和画面上的碎开是同一帧
        const shown = getDegradeState().placeholder ? toPlaceholderGenome(g) : g;
        creature.replace(fired.slot, shown.slots[fired.slot]);
        // docs/40 §5 第 3 条（2026-09-14 改的挂点）+ docs/44 §7：
        // 升档音原来挂在四个乐章的交接上，而 docs/44 §6 之后那四个点不再是事件 ——
        // 一个挂在不再发生的东西上的声音等于没有声音。挪到**每一次替换**上：
        // 那是一件真的发生了的事，它让"刚才是不是有什么变了"从怀疑变成确认。
        // **不新造提示音**，用的就是已经存在的那一个（docs/29 §S5 的克制照旧）。
        // 现场如果听起来像钟表，docs/44 §7 给了退路：加一句 `step.borrowDistance >= 2`
        // 就只在借得远的时候响 —— 那个数这里已经拿在手上了。
        sound.tierUp(tier);
      }
    }

    // ── 分档：**跟着弧线走，运动量只是加速项**（docs/40 §4 最后一段）───────────
    //
    // 此前这里只有 `evo.tierChanged`：分档看的是累计运动量，于是站着不动的人
    // 永远停在 tier 0（"观众体验到的是一堆状态，不是一段经过"）。
    // 现在时间是主轴 —— 乐章序号就是这一场的档位下限，动得多的人可以**提前**到，
    // 但没有人会因为不动而被卡住。
    //
    // 取最大值而且**只涨不落**（本场之内）：charge 会随静止衰减，跟着它回落
    // 意味着观众站定几秒就会看着零件退回去，那读作故障，不读作"它安静下来了"。
    // 归零由弧线负责，不由衰减负责。
    // `?tier=` 锁定时整段不参与 —— look dev 要的是一个不动的靶子。
    //
    // **档位下限在忒修斯开着时取排期给的那一档**（`step.tier`，docs/44 §6，2026-09-14 夜）。
    // 原来取的是乐章序号，于是整具 remorph + `stage.pulse` 恰好落在三条乐章边界上 ——
    // 一次全身换装加一下亮度脉冲，就是 docs/44 §6 删掉的那条边本身。
    // 而且第 I 乐章那两件替换发生时档位还是 0，台上是开场那一团，换掉的零件没画出来。
    // 现在第 k 档在它那一段第一件替换之前 `THESEUS.tierLead` 秒升，离任何一条边至少
    // `THESEUS.edgeMargin` 秒（`core/test/theseus-tier.test.ts`）。`step` 只在 `?theseus=off` 时是 undefined，
    // 那条 plan B 照旧取乐章序号。
    if (flags.tier === null) {
      const want = Math.max(tier, step ? step.tier : arcState.tier, evoTier) as Tier;
      if (want !== tier) {
        // 给操作员（`?debug=1`）：升档落在弧线的第几秒 —— 现场验"它不在乐章边界上"靠这一行
        if (hud) console.info(`[tier] @${(tMs / 1000).toFixed(2)}s ${tier} → ${want} @ arc ${arcState.elapsed.toFixed(2)}s（乐章 ${arcState.movement + 1}）`);
        // 极慢网下准备可能还没跑完；不要让画外桶和正式身体抢同一个 object。
        if (bucketWarmActive) abandonBucketWarm();
        morph(want);
        stage.pulse(want);      // docs/23 §S5：升档必须可感知，否则演化等于没发生
        // 这一声也跟着挂点搬走了。**乐章序号就是档位下限**，所以在四个交接点上
        // 走的正是这一条分支 —— 留着它，那一声照样在标记那四个点，
        // 而 docs/44 §6 已经裁定那四个点不再是事件。`?theseus=off` 时原样保留。
        if (!theseus) sound.tierUp(want);
      } else if (!theseus && arcState.movementChanged) {
        // 乐章交接那一下（画面顿一下 + 那一声）**只剩 `?theseus=off` 这条 plan B 上有**：
        // 现场的 plan B 必须和这一版之前逐字相同（`test/theseus-flag.test.ts`）。
        // 忒修斯开着时乐章边界不是事件（docs/44 §6，`test/arc-edges.test.ts`）：
        // 画面顿一下跟着升档走（上面那一支），声音跟着每一次零件替换走。
        stage.pulse(tier);
        if (!theseus) sound.tierUp(tier);
      }
    }
    // 身体怎么动交给当前的 Act。追踪短暂丢失时 lastSkeleton 还在，
    // Act 会继续用它 pose，所以画面不会僵死（P3）。
    // 升档那 0.15 秒的时间停滞对**身体**生效，对状态机不生效 ——
    // 否则 charge 和在场判定会跟着一起变慢，观众会觉得"卡了一下"而不是"顿了一下"。
    director.update(world, dt * stage.timeScale);

    // 慢回路：站够 SLOW_LOOP.armAfter 秒才武装。它内部**从不 await**在这一帧上，
    // 失败的正确表现是什么都没发生 —— 观众不该知道刚才有东西在跑（P3）。
    slow.update(p.state === 'ALIVE', dt);

    // ── 人走了 → 这一场结束（docs/05 §5 + docs/40 §3）─────────────────────────
    //
    // **判据换成了弧线的归零**，不再是 `presence.justReset`：同一件事只该有一个
    // 时刻，而这件作品里"一场"的长度由 `ARC.resetAfter` 的宽限定义
    //（走出画面捡个东西不算走）。`Presence` 仍然是唯一的检测器 ——
    // 弧线吃的就是它，这里没有第二套。
    //
    // **任何跨观众留存的状态都是 bug**，除非它是 `/lineage` 谱系那一条
    //（那一条留在 `library.index.parts` 里，是开场就注入的，不在这里）。
    // 所以除了种子和各个滤波器，这里还要把最容易被漏掉的那一样收回来：
    // **被按住的玩法**（`untether` 写进 URL 那次 bug 的同一类）。
    // 物种身体的到场不用在这里写一行 —— `speciesArrived()` 读的就是
    // `arcState.movement`，弧线一归零它自己就退回人形。派生状态不该被复制两份。
    if (arcState.justReset) resetEncounter('absence');

    // 声音吃的是 **未经时间停滞缩放的 dt**：升档那 0.15 秒画面顿一下是设计，
    // 声音跟着顿会变成"卡带"。理由和状态机不吃 timeScale 是同一条。
    if (slow.phase === 'grafted' && slowWas !== 'grafted') sound.grafted();
    slowWas = slow.phase;
    sound.update({
      presence: p.state, transition: p.transition,
      speed: lastFeatures?.speed ?? 0,
      jerk: lastFeatures?.jerk ?? 0,
      energy: lastFeatures?.energy ?? 0,
      // 音色跟着身体吃的那一组三个数滑，不跟着乐章的名字跳（`sound/timbre.ts`，docs/44 §6）
      // 玩法叠加开着时，身体在叠加的那个地名上采样 —— 声音跟着身体，也在那一点（「还回去」时叠加让路）
      line: lineFor(
        (!director.forced && intent.act) || director.currentId,
        arcState.overall,
        director.forced || (!director.forced && intent.act !== undefined),
      ),
      waiting: slow.phase === 'running',
    }, dt);

    // 景别。中景只给人形：身体方案一开始漂移，"上半身"就不再是一个取景（四足没有上半身），给全景。
    // 帧循环在降级或无人降帧时：跟随冻结，景别照常按时间走完（docs/49 §6.3 一 —— 一帧切正是"没有过渡"的根因之一）
    // 多人：台上有伴随身体时一律全景（docs/50 §4.3 —— 三个人的中景要么切掉两侧的人，要么不再是中景）
    stage.setShot(framing.shot === 'upper' && planDrift() <= 0 && !crowdOut?.companions.length ? 'upper' : 'full', {
      reduced: reducedMotion?.matches ?? false,
      // 调速器放到「后期」那一级（docs/48 §4 的阶梯第 5 级）才冻结跟随；景别仍照常缓动。
      // 前四级（墨色采样、换件延后、推理降频、DPR）连跟随也不冻结
      hold: loop.stats.degraded !== null || loop.stats.throttled || governor.sheds('post'),
    });
    stage.update(p, lastFeatures, dt);
    maybeStartBucketWarm();
    if (!bucketWarmActive) {
      stage.render(renderer);   // 后期链在舞台里；?nopost=1 时它退化成直出
    } else {
      // `compileAsync` 不会走与 PassNode/MRT 相同的管线；必须让**将来会上场的同一个
      // InstancedMesh** 真正走一帧后期。根节点搬到画外，避免准备中的单位矩阵闪进画面。
      // 一帧只放一个桶；无论 render 成败都恢复舞台状态并收起桶，帧循环绝不留下半态。
      const plan = bucketWarmPlans[bucketWarmIndex]!;
      const previousY = creature.object.position.y;
      const previousVisible = creature.object.visible;
      let rendered = false;
      try {
        creature.object.position.y = WARM.tierOffscreenY;
        creature.object.visible = true;
        stage.render(renderer);
        rendered = true;
      } finally {
        plan.park();
        creature.object.position.y = previousY;
        creature.object.visible = previousVisible;
        bucketWarmActive = rendered ? activateNextBucket() : false;
        if (!rendered) abandonBucketWarm();
      }
    }

    // 空闲里预编译直出那条路（docs/48 §10）：桶集合稳定、画面不忙、后期开着时才编，编的时候让出主线程。
    // 物种身体到场（第 III 乐章）是另一批网格第一次可见，也算内容变了
    warmPlan.note(creature.stats.buckets * 2 + (speciesBody?.object.visible ? 1 : 0), tMs);
    // "不忙" = 这一帧自己不是丢帧。**不看调速器走到了第几级**：原来看，结果恰恰在它要放下后期之前
    // 那几秒（L3）被挡住，一次都没编成（B-prof2：@24.29s 放下后期，那一帧 302ms，其中节点构建 61ms）。
    // 编译本身逐个对象让出主线程，所以在调速器忙着放级的时候开编是对的 —— 那正是它要赶在前面的时候
    if (warmPlan.next(tMs, { postOn: stage.post, calm: loop.stats.frameMs < GOVERNOR.jankFloorMs })) {
      warmPlan.started(tMs);
      void stage.warmDirect(renderer).then((ok) => warmPlan.finished(performance.now(), ok));
    }

    // 左下角那块读数。放在这里而不是上面 `preview?.update()` 旁边，是因为它要的
    // `lastFeatures` 是这一帧**刚算出来**的那一份 —— 放在前面就永远晚一帧，
    // 而"晚一帧"在一块 4Hz 刷新的读数上看不出来，正是 P21 说的那种坏法。
    // `raw` 和小屏幕吃的是同一份（滤波之前），理由也同：读数要说实话。
    // 调速器放下最后一级（UI）时读数停刷：它不驱动身体。小屏幕不停 —— 它回答的是「它有没有看见我」
    if (!uiShed) readout?.update(live, lastFeatures, capture.fps, dt);

    if (hud) {
      // 多人取证（docs/50 §10）：这一帧**真的交给身体的**骨架和站位。只在 `?debug=1` 下写，
      // 无头 Chrome 截图的同一刻用 CDP 读它 —— 画面上看到的形状和骨架的数对不对得上，一眼就分得清是"人那一半"还是"画那一半"
      if (people) {
        const brief = (sk: Skeleton | null) => sk ? {
          height: +sk.height.toFixed(3),
          pelvis: sk.joints.pelvis?.map((v) => +v.toFixed(3)),
          head: sk.joints.headCenter?.map((v) => +v.toFixed(3)),
        } : null;
        (globalThis as { __people?: unknown }).__people = {
          primary: crowd?.primary ?? null,
          primaryX: crowdOut?.primaryX ?? 0,
          primarySkeleton: brief(lastSkeleton),
          companions: (crowdOut?.companions ?? []).map((c) => ({
            dx: +c.dx.toFixed(3), dz: c.dz, scale: c.scale, presence: c.presence.state, ...brief(c.skeleton),
          })),
          tracks: (crowd?.tracks ?? []).map((t) => ({ id: t.id, cx: +t.cx.toFixed(3), scale: +t.scale.toFixed(3), missing: +t.missing.toFixed(2), selected: t.selected, primary: t.primary })),
        };
      }
      const s = body.stats;
      hud.update(loop.stats, {
        instances: (s as { instances?: number }).instances ?? 0, triangles: s.triangles,
        drawCalls: s.drawCalls, inferenceHz: capture.fps,
        act: director.currentId ?? '—',
        // 现场调时长的人靠这一行，不靠掐表（docs/40 §5 第 2 条）
        arc: arcState,
        arcForced: director.forced,
        // docs/44 §7 最后一段：现场调速率的人靠这一行，不靠掐表
        theseus: theseus?.state,
        // 取景模式此刻是什么、为什么、量到了什么（docs/49 §落地：切换必须实时看得见）
        framing: {
          reading: framer.current, decision: framing, legHold, shot: stage.shot.progress,
          lateral: { x: lateral.x.x, room: stage.lateralRoom, why: lateral.why, side: lateral.side },
        },
        // 多人（docs/50）：每条轨迹一行 —— id、主 / 伴 / 无、在场多久、配对代价
        // `cap` 是**确认了的**上限（`peopleCap`），不是开机那个 `flags.people`——探测开着时它会在运行中变
        people: people && crowd ? { frame: crowd, cap: peopleCap, bodies: people.plan.bodies, outlineYields: !people.plan.outlineWithCompanions, shed: people.shed } : undefined,
        instancesBudget: people ? BUDGET.maxInstances * (crowdOut?.visible ?? 1) : undefined,
        // `camera` 只有 `WebcamCapture` 有（回放没有摄像头可选），所以按可选字段读 ——
        // 和上面 `instances` 同一个写法，不为一个显示字段去动 `Capture` 契约。
        // 摄像头自带的取景接在同一行后面（docs/49 §6.3 三）：`camframing=auto · 摄像头在取景`
        cam: [(capture as { camera?: { hud: string } | null }).camera?.hud, (capture as { camFraming?: { hud: string } | null }).camFraming?.hud]
          .filter(Boolean).join(' · ') || undefined,
        camFallback: (capture as { camera?: { why: string } | null }).camera?.why === 'fallback',
        // 精化的三个数挂在 note 上而不是扩 HudCounts：它们只在调参时看，
        // 不值得为此动一个被所有页面共用的契约。
        note: [
          note,
          // 调速器在第几级、为什么（docs/48 §4）；姿态时钟在哪个状态；推理在哪儿跑、一次多久
          `gov=L${governor.level}${governor.level ? `(${GOVERNOR_LADDER[governor.level - 1]})` : ''} jank=${(governor.jank * 100).toFixed(0)}% pose=${poseClock.state}`
            + `${(capture as { where?: string | null }).where ? ` infer@${(capture as { where?: string | null }).where}` : ''}`
            + `${(capture as { inferMs?: number }).inferMs ? ` ${((capture as { inferMs?: number }).inferMs ?? 0).toFixed(1)}ms` : ''}`,
          refiner && `hold=${refiner.stats.held} drop=${refiner.stats.dropped} q=${refiner.stats.cutoffScale.toFixed(2)}`,
          slow.phase !== 'idle' && `slow:${slow.phase}${slow.note ? `(${slow.note})` : ''}`,
          // 存档写成没写成只在这一行说（`docs/43 §7.1` 第 5 条：降级必须静默）
          visits.phase !== 'idle' && `visit:${visits.phase}${visits.n === null ? '' : `(#${visits.n})`}`,
          // 自动探测此刻在哪个阶段、活的上限是几（docs/50 §6.3 修订）：现场调这一段的人靠这一行，不靠掐表
          peopleProbe && `probe:${peopleProbe.state.phase}${liveCap !== peopleCap ? `(试→${liveCap})` : ''}`,
        ].filter(Boolean).join(' · '),
      });
    }
  });

  // `?act=` 里弧线上的四个点开机就是叠加（上面的 `intentFromFlags`）。
  // 只有「还回去」那一场走 force —— 它是右下角那一行的开关，再按一次就松开
  if (flags.act === HANDED_BACK_ACT && !director.force(flags.act, world)) {
    console.warn(`[main] ?act=${flags.act} 已被禁用，按正常流程选`);
  }

  /** 这一屏此刻的全部值。控件条、回大厅、回舞台读的是同一份（`ui/control-table.ts`），不抄 */
  const controlValues = (): ControlValues => ({
    form: intent.form ?? null,
    scene: stage.sceneId,
    act: intent.act ?? null,
    outline: shading === 'toon',
    vitality: vitalityOn,
    sound: !(sound.state === 'off' || sound.state === 'muted'),
    species: theme ?? null,
    refine: refineOn && refiner !== null,
    // 控件显示用户的选择，不跟着调速器的短暂让路闪成「关」。实际渲染状态仍由 stage.post 给 warm-plan / HUD 读。
    post: postWanted,
    framing: framingPolicy,
    people: flags.peopleAuto ? 'auto' : String(flags.people),
  });

  // ── 控件条（`ui/controls.ts`）──────────────────────────────────────────────
  // 这里只是把**已经存在的**变量接出去：每个控件是什么在表里，这里只管读写哪个变量。
  // 现场（`?kiosk=1`）下 `flags.nav` 为 false，这一整条不挂 —— 和目录同一个判断。
  controls = mountControls({
    enabled: flags.nav,
    mount: corner,
    nav,
    host: {
      themes: library.index.themes ?? [],
      context: { bootPlan: planKind, speciesPlan: kindOf(speciesPlan) },
      values: controlValues,
      set: (id, value) => {
        const v = value as unknown;
        switch (id) {
          // 叠加：只换一份新的 intent。导演和身体到场下一帧自己读到，不给它们发任何命令
          case 'act': case 'form': intent = setOverlay(intent, id, v as string | null); break;
          case 'scene': stage.setScene(v as string); break;
          // 团块 / 点场上表里不给这一项（`available`），不会走到这里
          // 描边一换，多人的预算要重算：伴随身体在场时描边留不留，取决于它是几遍（docs/50 §5.2）
          case 'outline':
            // 着色语言会整体重建桶；先撤掉旧材质上的保留，下一帧按新语言重新准备。
            resetBucketWarm();
            shading = v ? 'toon' : 'physical';
            creature.setShading(shading);
            replanPeople();
            break;
          case 'vitality': vitalityOn = v as boolean; if (!vitalityOn) vitality.reset(); break;
          case 'refine': refineOn = v as boolean; if (!refineOn) refiner?.reset(); break;
          // 用户意愿与调速器的临时挂起分开记：即使此刻正在让路，用户打开后期也不能被写成永久关闭。
          case 'post': postWanted = v as boolean; stage.setPost(postWanted); break;
          // 取景策略：下一帧 `decide()` 自己读到。分类器不重置 —— 它一直在看，换的只是听不听它
          case 'framing': framingPolicy = v as FramingPolicy; break;
          case 'sound': if (v !== controlValues().sound) sound.toggleMute(); break;
          case 'species': break;   // 换物种走重载（表里的 reload），热切不到这里
          case 'people': break;    // 人数走重载（表里的 reload：单人身体不挂 instanceColor），热切不到这里
        }
      },
      // 叠加底下弧线此刻在哪：玩法 = 导演演的那段；形体 = 物种到场了没有
      arcValue: (id) => (id === 'act' ? director.currentId : speciesArrived() ? kindOf(speciesPlan) : 'rig'),
      seed: () => seed,
    },
  });

  loop.start();
  announceStageShown();
  // 换页截图之前把舞台冻成一张图：同一个任务里画一帧再拷走（ui/page-transition.ts）。
  // 只多画那一帧，不碰帧循环的节奏
  registerFreezable({ canvas: renderer.domElement, render: () => stage.render(renderer) });

  // ── 右下角那一列（`ui/exits.ts`）────────────────────────────────────────────
  // 选完物种之后观众此前没有任何出口：换物种只能改地址栏，而现场没有地址栏。
  // 三件事都接在**已经存在的**机制上，一个都不新造：
  // 回到大厅 = 重载（和控件条换物种同一条路），把身体还回去 = `director.force`，
  // 摄像头 = 和下面那个按钮完全相同的一次 capture 替换。
  // `?kiosk=1` 下 `flags.exits` 为 false，这一整列不挂（见 shell/kiosk.ts 的那条注释）。

  // `cameraOn` 声明在弧线那一段（存档要读它，而它有 TDZ）—— 这里只有用它的人

  /** 摄像头正在打开（按下之后、第一次推理完成之前）。右下角那一行据此写「正在打开」 */
  let cameraStarting = false;

  /**
   * 换一个 Capture。失败时**原来那一个继续跑** —— 画面不许因为切换而停（P3）。
   *
   * **旧的那一路一直跑到新的这一路第一次推理完成**（docs/48 §3）：`WebcamCapture.start()`
   * 在第一份结果回来之后才返回。此前它在模型建好就返回，于是换过去之后第一次 detect
   * （编译着色器：暖缓存 195–231ms，冷缓存 3.7s）冻在已经换上去的画面上 —— 就是"先黑、然后一顿"。
   *
   * 判"起没起来"看 `failed`，不看 `lastError`：后者会留着已经兜住的旧账（GPU 回落 CPU），
   * 拿它判的话，一台好好的、只是跑在 CPU 上的摄像头会被当成坏的丢掉。
   */
  const swapCapture = async (kind: 'webcam' | 'replay'): Promise<boolean> => {
    if (kind === 'webcam') cameraStarting = true;
    let next: Capture | null = null;
    try {
      next = await createCapture(kind);
      await next.start();
      const failed = next.failed ?? (next.lastError !== null);
      if (failed) {
        console.warn(`[main] capture(${kind}):`, next.lastError);
        try { next.stop(); } catch (e) { console.warn(`[main] capture(${kind}) stop after failure:`, e); }
        return false;
      }
      if (next.lastError) console.info(`[main] capture(${kind}) 已兜住：`, next.lastError);
      const kindChanged = cameraOn !== (kind === 'webcam');
      try { capture.stop(); } catch (e) { console.warn('[main] previous capture stop:', e); }
      capture = next;
      cameraOn = kind === 'webcam';
      // 新的一路已经成功启动才提交清零；创建 / 启动失败时旧 encounter 原样继续。
      if (kindChanged) resetEncounter('capture-change');
      else poseClock.reset();
      syncPeopleCadence();
      // 团块 / 点场上多人不开：别让 worker 白白按三个人跑检测器（docs/50 §1.2）。
      // 用 `liveCap` 不用 `flags.people`：换 capture 的那一刻探测可能已经把它抬起来了，新的
      // capture 要接着用同一个数，不能因为换了一次摄像头 / 回放就悄悄把探出来的第二个人弄丢
      capture.setPeople?.(multi ? liveCap : 1);
      return true;
    } catch (e) {
      console.warn(`[main] capture(${kind}) switch failed:`, e);
      if (next && next !== capture) {
        try { next.stop(); } catch (stopError) { console.warn(`[main] capture(${kind}) cleanup:`, stopError); }
      }
      return false;
    } finally {
      if (kind === 'webcam') cameraStarting = false;
    }
  };

  // 摄像头中途断了（拔线、被别的程序占走）：换回录像，并且说一句（docs/48 §5）。
  // 不在帧循环里做：换 capture 是异步的，帧循环里不 await。1 秒看一次就够。
  let lostHandled = false;
  setInterval(() => {
    const lost = cameraOn && (capture as { lost?: boolean }).lost === true;
    if (!lost) { lostHandled = false; return; }
    if (lostHandled || cameraStarting) return;
    lostHandled = true;
    void swapCapture('replay').then((ok) => {
      if (ok) showNotice(COPY.exits.cameraLost, { corner: 'bottom-right' });
      else lostHandled = false;
    });
  }, 1000);

  const exits = mountExits({
    enabled: flags.exits,
    host: {
      // 一次重载要带走的全部状态 —— 和控件条是**同一份**，不再逐条抄一遍
      state: controlValues,
      // 「还回去」= 换一个玩法，仅此而已。摄像头照开、采集照跑、骨架照算，
      // 只是这一场不用观众的那一份（`acts/untether.ts` 的文件头）。
      handedBack: () => director.currentId === HANDED_BACK_ACT,
      setHandedBack: (on) => {
        // 「拿回来」不是"切到 follow"，是**交回给弧线** —— 观众拿回身体之后
        // 应该回到这一场此刻的乐章（已经走到第 III 段就该是「抵抗」），
        // 而不是永远停在第 I 段。这是 `director.release()` 存在的全部理由。
        if (on) director.force(HANDED_BACK_ACT, world); else director.release(world);
        return director.currentId === HANDED_BACK_ACT;
      },
      cameraOn: () => cameraOn,
      cameraStarting: () => cameraStarting,
      // 手移上来就开始取模型、建图（worker 里，不问权限）。按下时那十几 MB 和那几百毫秒已经花过了
      cameraIntent: () => { void import('./capture/webcam.ts').then((m) => m.prewarmPose(flags.model ?? undefined)).catch(() => {}); },
      setCamera: async (on) => {
        // 选择页 → 舞台的交棒还没收完就不拿摄像头（docs/47 §4.2、docs/48 §10.6）：过渡期间渲染被挂起
        await transitionIdle();
        await swapCapture(on ? 'webcam' : 'replay');
        return cameraOn;
      },
    },
  });

  // 唯一请求摄像头权限的地方。失败（拒绝 / 没有摄像头）就留着按钮，回放继续跑 ——
  // 观众看到的不是一个报错，而是"还没换成我"（docs/23 §S1 网页分支）。
  //
  // **右下角那一列在场时不挂它**：那一列的「摄像头」行做的是同一件事
  // （同一次 `createCapture('webcam')`、同一次权限请求），两个按钮并排贴在同一个角上
  // 只会让观众以为它们不一样。`?exits=0` 下这条老路一个字都没变。
  if (entry && !exits) {
    mountCameraButton(async () => { await transitionIdle(); return swapCapture('webcam'); });
  }

  console.info(
    `[main] running · theme=${theme} · seed=${seed} · ` +
    `plan=${planKind}${intent.form === undefined && planKind !== 'rig' ? '(第 III 乐章到场)' : ''} · ` +
    `arc=${arc.total}s · theseus=${theseus ? (flags.theseus.rate === 1 ? 'on' : `×${flags.theseus.rate}`) : 'off'} · ` +
    `capture=${cameraOn ? 'webcam' : 'replay'} · ` +
    `acts=${ACTS.map((a) => a.id).join(',')} · sound=${sound.state}`,
  );
}

void boot().catch(showBootError);
