/**
 * 文案总册 —— 全项目所有面向观众的文字，都在这一个文件里。
 *
 * ## 为什么是"对照"而不是"切换"
 *
 * 语言切换器要求观众先做一个选择，然后**看不到另一半**。
 * 并置（中英同时在场）是美术馆和档案的做法：不打断、不要求选择，
 * 而且双语本身构成排版的一部分 —— 两行不同灰度的文字，本来就是这套
 * International Typographic Style 的常见构型。
 *
 * 所以没有 `setLang()`，只有 `bi()`。这是一个设计决定，不是省事。
 *
 * ## 纪律
 *
 * - **面向观众的字符串一律从这里取**，不许散在组件里（否则永远有几句没翻译）。
 * - 中文是原文，英文是对照 —— 不是反过来。这件作品的思考是用中文进行的。
 * - 英文不要"翻译腔"：宁可换一个说法，也不要逐字对应。
 * - 调试/开发者面向的文字**不进这里**（`?debug=1` 的 HUD、控制台）—— 那些只给我们自己看。
 */

export interface BiText { zh: string; en: string; }

export const bi = (zh: string, en: string): BiText => ({ zh, en });

/**
 * 这一段文字里有没有汉字。用来决定要不要补那 0.06em 的左边距（type.css）。
 *
 * **按字判断，不按槽位判断。** `.sb-zh` 是"承重的那一行"，不是"中文那一行" ——
 * 作品名那一对是倒置的（见下面 `COPY.title`），承重行里装的是
 * `SEE-ME SEE-U`。补偿如果跟着 class 走，就会补在拉丁字母上、
 * 而真正需要补的汉字反而不补：实测 54px 的巨题因此比底下所有东西
 * 往左凸出 3.3px，读起来就是"英文缩进了半格"。
 */
const CJK = /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/;

/**
 * 这一段文字要不要补那 0.06em。手搭 DOM 的地方（`shell/entry.ts` 的巨题把
 * 名字按空格拆成两行，绕过了 `setBi`）用它，**这样规则只有一条**。
 */
export function cjkClass(text: string): string {
  return CJK.test(text) ? ' sb-cjk' : '';
}

/** 渲染成并置的 HTML 片段。中文为主、英文为辅 */
export function biHtml(t: BiText, tag = 'span'): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  // **两条构建路径必须给出一样的 DOM。** 这一条（HTML 字符串）和 `setBi`
  // （逐个建节点）长期各写各的，于是补偿只在其中一条上生效 ——
  // 走这条路的那几页（/about、谱系、做的过程、护照的大标题）一点补偿都没有。
  // 谁改了其中一条就必须改另一条，下面那条单测就是为此立的。
  return `<${tag} class="sb-bi"><span class="sb-zh${cjkClass(t.zh)}">${esc(t.zh)}</span>` +
         `<span class="sb-en${cjkClass(t.en)}">${esc(t.en)}</span></${tag}>`;
}

/** 写进 DOM 元素（比 innerHTML 安全，且不用自己转义） */
export function setBi(el: Element | null, t: BiText): void {
  if (!el) return;
  el.textContent = '';
  el.classList.add('sb-bi');
  // 类名用**和 `biHtml` 逐字相同的表达式**算出来，不用 classList.add ——
  // 两条路径共用一个 `cjkClass()`，于是"它们会不会长出分歧"这个问题不存在，
  // 而不是靠谁记得两边一起改。`test/bilingual.test.ts` 还是钉住了结果。
  const zh = document.createElement('span');
  zh.className = `sb-zh${cjkClass(t.zh)}`;
  zh.textContent = t.zh;
  const en = document.createElement('span');
  en.className = `sb-en${cjkClass(t.en)}`;
  en.textContent = t.en;
  el.append(zh, en);
}

// ─────────────────────────── 文案 ───────────────────────────

export const COPY = {
  /**
   * 作品名。
   *
   * **全站唯一一处中英倒置的并置。** 别处都是"中文承重、英文辅助"，
   * 因为中文是原文。但**作品的名字就是 `SEE-ME SEE-U`** ——
   * 「看我看你」是它的中文说明，不是名字的一部分。
   * 所以这里让名字占承重的那一行，说明退到辅助行。
   * 倒置只此一处，别处不要照抄。
   */
  title: bi('SEE-ME SEE-U', '看我看你'),
  subtitle: bi(
    '你选一个物种，然后它用你的身体活过来',
    'Choose a species. It comes alive using your body.',
  ),

  /** S0 启动 —— 观众正常看不到这些 */
  boot: {
    slow: bi('稍等一下', 'One moment'),
    failed: bi('出了点问题，正在恢复', 'Something went wrong. Recovering.'),
    fallbackRender: bi('降级渲染', 'Reduced rendering'),
    noCamera: bi('用我的摄像头', 'Use my camera'),
    demoRunning: bi('正在播放录制片段', 'Playing a recording'),
  },

  /**
   * S0 加载态 —— 观众在等的时候读到的那几行。
   *
   * 为什么要**分阶段**而不是一个笼统的百分比：一个数字只能说"还要多久"，
   * 说不出"在等什么"。而现场流失人的那一刻恰恰是「我不知道它是在加载还是坏了」——
   * 一行"正在认识你的身体"回答的是后面那半句。三个阶段就是三件真的在发生的事，
   * 不是把一条进度条切成三段。
   *
   * 慢的时候说人话：不写"超时""失败""重试"。那是运维的词，
   * 观众听到它只会走开；「网有点慢」他会再站一会儿。
   */
  loading: {
    render: bi('正在点亮画面', 'Waking the screen'),
    parts: bi('正在准备零件', 'Laying out the parts'),
    body: bi('正在认识你的身体', 'Learning to see your body'),
    /** 阶段状态。等宽小字，和右边的百分比同一栏 */
    waiting: bi('等一下', 'Waiting'),
    ready: bi('好了', 'Ready'),
    slow: bi('再等一下，网有点慢', 'Hang on — the network is slow'),
    slower: bi(
      '还在等。第一次打开要下最多东西，之后会快很多',
      'Still going. The first visit downloads the most; later ones are far quicker',
    ),
    /** 降级发生在加载途中：说清楚"它还是会活过来"，不说"降级" */
    degraded: bi('画面会简单一点，它照样会动起来', 'The picture will be simpler. It still comes alive'),
  },

  /** S1 空场 */
  attract: {
    invite: bi('站到画面里', 'Step into the frame'),
    inviteWeb: bi('打开摄像头，站到画面里', 'Turn on your camera and step into the frame'),
  },

  /** S2 选择 */
  choose: {
    prompt: bi('选一个身体', 'Choose a body'),
    auto: bi('即将自动选择', 'Choosing for you'),
    /**
     * 这一页唯一的提示语。**它说的是会发生什么，不是这一页支持什么。**
     *
     * 原来写的是「滚动 / 拖动 穿越形态空间 · 数字键直选 · ↑↓ 移动 · Enter 确认」——
     * 那是一张功能清单：它假设观众关心的是"这一页有哪些操作"，
     * 而观众此刻关心的只有一件事 —— 我停在这儿会怎么样。
     */
    hint: bi('停在谁面前，就成为谁', 'Whoever you stop in front of is who you become'),
    /**
     * 按键图例。**和上面那句不是一回事**：那句是说给人听的，这个是一张图例 ——
     * 现场可能只有一个遥控器，不给图例，观众不知道手里那两个键有用。
     * 用等宽、极小号、压暗排成"标注"而不是"说明文字"（docs/23 §0）。
     *
     * 它**不是 BiText**：全是符号，没有中英之分，硬凑一份对照只会多出一行噪声。
     * 这是"并置不切换"那条规矩的边界，不是例外 —— 没有语言的东西不需要对照。
     */
    keys: '↑ ↓ · ENTER',
    /** 退化成列表时：没有"停在谁面前"这回事了，所以换一句 */
    hintList: bi('挑一个，它会用你的骨架站起来', 'Pick one. It will stand up on your skeleton.'),
    emptyTitle: bi('今天没有可以成为的身体', 'Nothing to become today'),
    emptyNote: bi('零件还在长，过一会儿再来', 'The parts are still growing. Come back in a while.'),
    kinds: {
      archetype: bi('物种', 'Archetype'),
      character: bi('角色', 'Character'),
      guest: bi('嘉宾', 'Guest'),
    },
    axes: {
      humanLike: bi('像人', 'Human-like'),
      lifeLike: bi('像活的', 'Life-like'),
    },
  },

  /** S4 共舞 —— 唯一一句功能性文案，而且会自己消失 */
  live: {
    stepBack: bi('往后一点', 'Step back'),
  },

  /**
   * 左上角那块小屏幕（`ui/preview.ts`）说的话。
   *
   * ## 三条规矩，都和别处不一样
   *
   * 1. **只在不好的时候说话。** 一切正常时这一块一个字都没有 ——
   *    它靠"你自己在里面动"就已经把话说完了。一句常驻的「正在追踪」
   *    只会让人去读文字而不是看自己（docs/23 §S4「默认零 UI」）。
   * 2. **说的是观众该做什么，不是出了什么错。** 「没有检测到人体」是一条错误码：
   *    它准确、无用，而且把责任推给观众。「站到画面里」是同一件事，
   *    但它是一个可以照做的动作。
   * 3. **不写"摄像头""追踪""置信度"。** 那是我们的词。观众要的是
   *    "我该往哪挪"，不是"哪个模块不高兴"。
   *
   * 「没有人」那一句直接复用 `attract.invite` —— 同一件事说两遍必然会漂成两句话。
   */
  preview: {
    /** 没有摄像头 / 权限被拒。网页版右下角那个按钮就在那儿，这一句是指着它说的 */
    off: bi('打开摄像头，它就能看见你', 'Turn the camera on and it can see you'),
    /** 半个人出画。任务卡指名的那一句 —— 它是这块小屏幕存在的全部理由 */
    stepBack: bi('往后退一点，整个人进画面', 'Step back — get all of you in frame'),
    /** 追踪质量掉下去了（逆光是现场的头号杀手，见 docs/38 §6） */
    light: bi('站到亮一点的地方', 'Find a brighter spot'),
    /**
     * 从观众**自己的**左 / 右边走出了画（docs/49 §6.3 二）。说的是往哪边回来，不是从哪边出去的 ——
     * 规矩 2：说观众该做什么。镜像显示上观众的左就是屏幕的左，所以这句话和他在小屏里看到的方向一致。
     * 往后退救不了往旁边走出去的人，所以它不能复用 `stepBack`。
     */
    outLeft: bi('往右一点，回到画面里', 'Move right, back into frame'),
    outRight: bi('往左一点，回到画面里', 'Move left, back into frame'),
    /** 摄像头自己在取景时挂在小屏上的 `title`（不是常驻的字，docs/49 §6.3 三） */
    camFraming: bi('摄像头自己在取景：腿被它裁掉不算出画', 'The camera is framing itself: legs it crops out are not counted'),
    /**
     * 自动探测确认了一个新人、给了他一具身体（`core/src/people-probe.ts`，docs/50 §6.3 修订）。
     * 只在**确认之后**出现（不是每一次一晃而过的检测），过一会儿自己收起（`PEOPLE.probeHintSeconds`）——
     * 它是一句"我们看到了"，不是一个常驻的人数读数（那是 §6.1 明确不做的事）。
     */
    peopleNoticed: {
      2: bi('看到了第二个人，给了一具身体', 'Noticed a second person — gave them a body'),
      3: bi('看到了第三个人，给了一具身体', 'Noticed a third person — gave them a body'),
    },
  },

  /**
   * S4 左下角那块读数（`ui/readout.ts`）——「它此刻从你身上读到了什么」。
   *
   * 这几个词是**观众读的**，所以它们进这里，不进 `?debug=1` 的 HUD 那一套
   * 英文缩写（`fps` / `infer` / `tris`）。两套词汇服务两种人：
   * HUD 上的 `infer 31 Hz` 是给现场调机器的人看的，这里的「推理 · INFERENCE」
   * 是给一个站在身体前面、想知道它在读自己什么的人看的。
   *
   * 中文两个字、英文一个词 —— 定宽的两栏排版靠这条约束成立（`readout.css`）。
   * 加行之前先量一眼名字那一栏会不会被撑开。
   */
  readout: {
    /** 顶上那一行：这一帧有没有人。它是下面五行为什么全是破折号的答案 */
    present: bi('有人', 'Someone'),
    absent: bi('无人', 'No one'),
    /** 摄像头没开、身体在放录像。录像里的人不在现场，所以既不说有人也不说无人 */
    replay: bi('摄像头关着', 'Camera off'),
    /** 整体置信度（`RawPose.score`）—— 整条链都压在这一个数上 */
    // 英文是**读数屏的通道代号**，不是句子（`CONF` 而不是 `Confidence`）：
    // 这块屏和左上角那块同宽，最窄 200px；整词放不下，而代号本来就是数控的语汇。
    confidence: bi('置信', 'Conf'),
    /** 模型报"看得见"的点数 / 总点数。半个人出画时置信度还很高，这一行不会 */
    joints: bi('关节', 'Joints'),
    /** **不是帧率**：每秒重新看你几次（`Capture.fps`） */
    inference: bi('推理', 'Infer'),
    /** 无量纲的运动能量。推动整件作品往前走的就是它 */
    energy: bi('动能', 'Energy'),
    /** 四肢离骨盆多远。这一块唯一一个形状的量，其余都是速率 */
    extent: bi('舒展', 'Extent'),
    /** 最底下那一条的题，和它右边那个开合键的两种说法 */
    title: bi('读数', 'Readout'),
    show: bi('显示', 'Show'),
    hide: bi('收起', 'Hide'),
    /** 没有越界时，底下那一行说的话 */
    normal: bi('正常', 'Normal'),
    /**
     * 告警代码对应的话。代码本身（ALM 01…）不翻译，和数控板一样是固定编号；
     * 什么时候触发、阈值从哪来，见 `readout-state.ts` 的 `AlarmCode` 那张表。
     */
    alarms: {
      // 英文是数控板上那种**一个词的状态字**，不是句子：这一行定宽不折行，
      // 句子（'Partly out of frame'）在 200–240px 的板上会被切成 PARTLY OU。中文承重，英文只点题。
      ALM01: bi('关节丢失', 'Lost'),
      ALM02: bi('推理停滞', 'Stall'),
      WRN11: bi('置信偏低', 'Low'),
      WRN12: bi('部分出画', 'Out'),
      WRN13: bi('推理偏慢', 'Slow'),
    },
  },

  /** S7 离场 / 留念 */
  leave: {
    keepsake: bi('带走这具身体', 'Take this body with you'),
    seed: bi('编号', 'Seed'),
  },

  /** 身体方案 */
  /**
   * 九个身体方案的名字。**必须和 `BODY_PLANS` 一一对应** ——
   * `ui/species.ts` 的 PLAN_LABEL 直接由它组成，`/about` 的图例读那张表。
   * 这里以前少了 radial / column / swarm 三个，于是图例上那三种标记的名字
   * 是**英文 id 原样**（`about.ts` 的兜底分支），中文观众读到 "radial"。
   * 少一条不会报错、不会崩、只是"看起来像是有人故意这么写的" —— 和 CSS 那个
   * 嵌套 `:root` 是同一种藏法。`test/body-plans.test.ts` 现在盯着这一条。
   */
  plans: {
    rig: bi('人形', 'Humanoid'),
    quadruped: bi('四足', 'Quadruped'),
    mass: bi('团块', 'Mass'),
    swarm: bi('点场', 'Swarm'),
    stub: bi('矮壮', 'Stub'),
    towering: bi('高瘦', 'Towering'),
    inverted: bi('倒置', 'Inverted'),
    radial: bi('放射', 'Radial'),
    column: bi('单柱', 'Column'),
  },

  /**
   * 入口层（网页版）—— 展签，不是落地页。
   * `docs/23 §S0 网页分支` + `docs/PRD §8`：**不要求授权也能看见东西**。
   * 所以这里只有三样东西：作品是什么、进去、了解它。没有第四样。
   */
  entry: {
    credit: bi('实时交互装置 · 2026', 'Real-time interactive installation · 2026'),
    enter: bi('开始', 'Enter'),
    learn: bi('了解这件作品', 'About this work'),

    /**
     * 入口层的那一句。取自作品陈述，是其中**唯一一个问句** ——
     * 一个问句比一句描述更适合放在观众还没开始之前：它要他先想一下，
     * 而不是先知道我们做了什么。
     */
    question: bi(
      '一个"我"，究竟可以栖居于多少种身体？',
      'What kinds of bodies can a self inhabit?',
    ),

    /**
     * 展签上的元数据。照美术馆作品标签的写法：标签 + 值，纵向排。
     * 不写"支持 A、B、C" —— 那是功能清单；这些是**这件作品是什么**的事实。
     */
    metaYear: bi('年份', 'Year'),
    metaYearV: bi('2026', '2026'),
    metaForm: bi('形式', 'Medium'),
    metaFormV: bi('实时交互装置 · 姿态捕捉 · 实时生成', 'Real-time interactive installation · pose capture · generative'),
    metaSpecies: bi('物种', 'Species'),
    metaDuration: bi('单次时长', 'Duration'),
    /**
     * 单次时长。**这个数不是估的，它是 `tuning.ts` 的 `ARC.total`**（180 秒）——
     * 会话弧线落地之前这里写的是「约 90 秒」，那时它确实只是一个观察值；
     * 现在它是一条被定死的时间轴，展签上就该写那条时间轴的长度（docs/40 §2）。
     */
    metaDurationV: bi('约三分钟', 'about three minutes'),
  },

  /**
   * 工作台（`/dev/*`）顶上的两条出路，`dev/devnav.ts`。
   * 「回到作品」和 `about.back` 同一句话：出口说的是同一件事，不另起一个词
   */
  devnav: {
    workbench: bi('返回工作台', 'Back to the workbench'),
    /** 作为「返回〈来处〉」里的那个名字（`ui/return-to.ts` 的 RETURN_PAGES）。和上一行拼出来是同一句话 */
    home: bi('工作台', 'the workbench'),
    // 原来是「退出 · 回到作品」。负责人：更简单，就是「回到作品」—— 和 `about.back` 同一句话
    exit: bi('回到作品', 'Back to the work'),
  },

  /** 不存在的地址（`404.html`）。左上角「回到作品」、右上角目录，就是它全部的出口 */
  notFound: {
    title: bi('这里没有这一页', 'Nothing here'),
    lede: bi('地址可能拼错了，或者这一页已经搬走。', 'The address may be mistyped, or the page has moved.'),
  },

  /** 作品陈述页 `/about` —— 面向观众和评委，不是面向开发者 */
  about: {
    back: bi('回到作品', 'Back to the work'),
    credit: bi('实时交互装置 · 2026', 'Real-time interactive installation · 2026'),

    /** 两种状态标记。**这是这一页最重要的机制**：分清"已经在跑"和"只写了规格" */
    built: bi('已实现', 'Built'),
    spec: bi('规格', 'Specified'),
    /**
     * 第三种状态，为慢回路而设。它既不是"只写了设计"（回路两端都接上了、
     * 有测试有取证），也不是"已实现"（真实的 AI 生成从没打过一次，
     * 而且线上这个版本里它是 404）。用同一个标记去盖这两种情况，
     * 无论盖哪边都是在撒谎 —— 所以加一个。
     */
    onsite: bi('现场限定', 'On-site only'),
    legend: bi(
      '标注「规格」的只写了设计。标注「现场限定」的已经跑通，但只在装置那台机器上活着。这一页不写没做到的事。',
      'Marked “Specified” means designed, not built. Marked “On-site only” means working, but alive only on the installation’s own machine. This page does not claim what is not done.',
    ),

    // ── 作品陈述 ──────────────────────────────────────────────────────
    /**
     * **艺术家原文。逐字，不改写、不补全、不润色。**
     *
     * 这一段和这个文件里其余所有条目的身份不一样：别处的中文是我们写的文案，
     * 写坏了就重写；这几行是艺术家交下来的正文，**我们只负责排版**。
     * 三条随之而来的规矩，改这一段之前先读：
     *
     * 1. `statementCall` 是艺术家**用英文写的**，它不是任何一句中文的对照。
     *    所以它不走 `bi()`，在版面上也不许被塞进 `.sb-bi` 的"中主英辅"里 ——
     *    那会把一句原文降级成一句译文。
     * 2. `statementLead` 的 `en` 是**译文**（和这一页别处的英文同一个身份：对照）。
     *    要改就往"不像翻译腔"改，不许往"更有文采"改 —— 它不是一次创作。
     * 3. 五个概念：拉丁词与括号里的中文注都来自原文，**这一对本身就是中英并置**，
     *    所以不再替它写第二层英文注。写了就是替艺术家说话。
     *
     * 排版上的两个决定写在 `about.css` 的 `.about-statement` 那一段。
     *
     * **第四句原文不在这里，在 `entry.question`。** 它先落在入口层（那一句是陈述里
     * 唯一的问句，适合放在观众还没开始之前），`/about` 直接取同一个常量，
     * 不抄第二份 —— 两个地方各存一份原文，迟早会有一份被改成不是原文。
     */
    statementTitle: bi('作品陈述', 'Artist statement'),
    statementSource: bi('艺术家原文', 'The artist’s own words'),
    statementLead: bi(
      'SEE-ME SEE-U 是一次关于身体、观看与对抗的生成实验。',
      'SEE-ME SEE-U is a generative experiment in body, looking and confrontation.',
    ),
    /** 艺术家用英文写的那一行。**不是译文，不配中文，不进 `bi()`** */
    statementCall: 'SEE ME. SEE U. NOT ME. BUT U. AND U SEE ME.',
    conceptsTitle: bi('核心概念', 'Key concepts'),
    /** `term` 与 `zh` 均为原文逐字。顺序是艺术家给的顺序，不排序、不编号 */
    concepts: [
      { term: 'datafication', zh: '身体的数据化' },
      { term: 'Morphogenesis', zh: '形态发生' },
      { term: 'zoë', zh: '非人格化的、纯粹的生命' },
      { term: 'simulacrum', zh: '拟像' },
      { term: 'distributed agency', zh: '分布式能动性' },
    ],

    // ── 它是什么 ──────────────────────────────────────────────────────
    whatTitle: bi('它是什么', 'What it is'),
    whatLead: bi(
      '一台摄像头认出你的身体。屏幕上一具等身的合成身体跟着你动，然后用三分钟一点点不再是你。',
      'A camera finds your body. A life-size synthetic body moves as you move — and then, over three minutes, stops being you.',
    ),
    /**
     * 这一栏原来写「观众的 90 秒」。90 从来只是一个观察值；
     * 会话弧线落地之后这件作品有了一条定死的时间轴（`ARC.total = 180`），
     * 而展签、这一页、弧线那一节必须是同一个数。
     */
    ninety: bi('观众的三分钟', 'The visitor’s three minutes'),
    steps: {
      see: bi('看见', 'See'),
      seeNote: bi('空场里一团粒子在呼吸', 'A field of particles, breathing'),
      choose: bi('选择', 'Choose'),
      chooseNote: bi('在形态空间里滚过物种', 'Scroll a space of species'),
      become: bi('成为', 'Become'),
      becomeNote: bi('等身、镜像、200 毫秒以内', 'Life-size, mirrored, under 200 ms'),
      discover: bi('发现', 'Discover'),
      discoverNote: bi('它升档，开始长自己的零件', 'It escalates, and grows parts of its own'),
      leave: bi('带走', 'Leave'),
      leaveNote: bi('一个编号，扫码带走', 'A seed, taken away by phone'),
    },

    // ── 三分钟 ────────────────────────────────────────────────────────
    /**
     * 会话弧线（`docs/40-SESSION-ARC.md`）。
     *
     * **为什么它该在这一页上，而不只是在 docs 里**：在这条弧线之前，这件作品
     * 没有时间 —— 观众体验到的是一堆状态，不是一段经过。而陈述写的恰恰是一段经过。
     * 四个乐章的名字**取自陈述里的那四个词**，所以这一节和上面那张概念表是同一件事
     * 的两个面：那张表是艺术家给的词，这一节是那些词各自占据的那四十几秒。
     *
     * 两条纪律：
     *
     * 1. **不写秒表以外的承诺。** 时间点直接来自 `tuning.ts` 的 `ARC`
     *    （`total: 180`、`beats: [0.22, 0.25, 0.28, 0.25]`），不另存一份。
     * 2. **`arcNever` 那一段不要改软。** 它是这条弧线唯一的硬规矩，也是这件作品
     *    和「一块自己在动的屏幕」之间的全部区别。写成"它仍然会参考你的动作"
     *    就等于把它删了。
     */
    arcTitle: bi('三分钟', 'Three minutes'),
    arcLead: bi(
      '四个乐章不是我们另起的名字，它们就是陈述里的那四个词。时间是主轴，动作只是加速项 —— 一个站着不动的人也在经历这条弧线，只是慢一点。',
      'The four movements are not our names for anything: they are the four words of the statement. Time is the main axis and movement only an accelerator — someone who stands perfectly still still goes through the arc, just more slowly.',
    ),
    /** `at` 是时间点，`term` 是陈述里的那个词（原文，不配第二层英文注） */
    arcMovements: [
      { at: '0:00', term: 'datafication',
        name: bi('跟随', 'Follow'),
        note: bi('它就是你：你的比例，零延迟。起初像是在看一面镜子。',
                 'It is you — your proportions, no latency. At first it is like looking into a mirror.') },
      { at: '0:40', term: 'Morphogenesis · zoë',
        name: bi('回声', 'Echo'),
        note: bi('它慢半拍，零件开始被换掉。形还是你的，材料已经不是了。',
                 'Half a beat behind, and its parts begin to be replaced. The shape is still yours; the material is not.') },
      { at: '1:25', term: 'simulacrum',
        name: bi('抵抗', 'Resist'),
        note: bi('人形让位给这个物种自己的身体。镜像开始脱离镜像。',
                 'The humanoid gives way to this species’ own body. The mirror starts to leave the mirror.') },
      { at: '2:15', term: 'distributed agency',
        name: bi('朝向', 'Facing'),
        note: bi('它转过来看你。你把动作给它，它把另一种身体还给你。',
                 'It turns and looks at you. You give it your movement; it gives you back another kind of body.') },
    ],
    arcNever: bi(
      '四个乐章变的是映射，不是来源。到第三分钟它已经不像你了，而它做的每一个动作仍然来自你此刻的动作 —— 你停下来，它也停下来。它要是自己动起来了，作者身份就完整地归了机器。',
      'What the four movements change is the mapping, never the source. By the third minute it no longer looks like you, and every move it makes still comes from what you are doing right now — stop, and it stops. If it ever moved on its own, the authorship would pass whole to the machine.',
    ),
    /** 物质那一条（docs/41）。和上面是同一条线的两半：形在变，表面也在变 */
    materialTitle: bi('它开场是一张画', 'It opens as a drawing'),
    materialBody: bi(
      '表面走同一条线。开场那一具是被画出来的：平涂、墨线、没有高光 —— 一张关于你的图示，而那正是数据化的零点。三分钟里它一点点变成一个东西：粗糙度按部位分开、材质自己的颜色从薄处透出来、金属起来，开始映这间屋子，而不是被我们的灯描述。最后那圈描边换成它自己的颜色 —— 线还在，但它不再是我们替它描的那一条。',
      'The surface follows the same line. What stands up at the start is drawn: flat colour, an ink outline, no highlights — a diagram of you, which is exactly what datafication looks like. Over three minutes it becomes a thing instead: roughness splits by role, the material’s own colour shows through where it is thin, metal comes up and it starts reflecting the room rather than being described by our lights. At the end the outline takes its own colour — the line is still there, but it is no longer the one we drew for it.',
    ),

    // ── 为什么 ────────────────────────────────────────────────────────
    whyTitle: bi('为什么', 'Why'),
    reference: bi(
      'Universal Everything，《Future You》，Barbican，2019',
      'Universal Everything, “Future You”, Barbican, 2019',
    ),
    whyRef: bi(
      '那件作品的回路是「身体 → 形态」，回路里没有 AI：形态从一个预先做好的组合池里取。',
      'In that work the loop runs body → form, with no AI inside it: form is drawn from a pool built in advance.',
    ),
    whyDiff: bi(
      '唯一的区别是我们加了第二条回路：把实时 AI 3D 生成放进交互回路里。',
      'The one difference: we add a second loop, putting real-time AI 3D generation inside the interaction itself.',
    ),
    fastLoop: bi('快回路 · 16 毫秒', 'Fast loop · 16 ms'),
    fastLoopNote: bi(
      '姿态 → 骨架 → 部件挂载 → 渲染。部件来自预生成的池子，零延迟。',
      'Pose → skeleton → mounted parts → render. Parts come from a pre-generated pool. No latency.',
    ),
    slowLoop: bi('慢回路 · 30–90 秒', 'Slow loop · 30–90 s'),
    slowLoopNote: bi(
      '你此刻的剪影 → 3D 生成模型 → 属于你的那块零件 → 热插拔到身上。',
      'Your silhouette, right now → a 3D generative model → a part that is yours → hot-swapped onto the body.',
    ),
    slowLoopHonest: bi(
      '慢回路已经接通：剪影提交、生成、规范化、热插拔到身上，两端都在跑，并且前一个人留下的零件会进下一个人的候选池。'
      + '但还差两件，所以它标的是「现场限定」而不是「已实现」：真实的 AI 生成调用一次都没打过，离线端到端验的是回路、不是生成；'
      + '而且它只在装置那台本地机器上活着 —— 你现在打开的这个网页版本里，它是 404。',
      'The slow loop is connected: silhouette submitted, generated, normalised, hot-swapped onto the body — both ends run, and a part left by the previous visitor enters the next visitor’s pool. '
      + 'Two things are still missing, which is why it reads “On-site only” and not “Built”: no real generative call has ever been made — the offline end-to-end test proves the loop, not the generation; '
      + 'and it lives only on the installation’s own machine. In this web build, it is a 404.',
    ),
    slowLoopWhy: bi(
      '那 30 到 90 秒的等待不是缺陷，是叙事：它正在想办法成为你。',
      'Those thirty to ninety seconds are not a defect but the story: it is working out how to become you.',
    ),

    // ── 底下是什么 ────────────────────────────────────────────────────
    howTitle: bi('底下是什么', 'Underneath'),
    layers: {
      pose: bi('姿态', 'Pose'),
      poseNote: bi('摄像头 → 骨架。全部在你的设备上算。', 'Camera to skeleton, computed entirely on your device.'),
      plan: bi('身体方案', 'Body plan'),
      planNote: bi(
        '同一副骨架重映射成九种形体。换物种是换形体，不是换一层皮。',
        'One skeleton, remapped into nine builds. Changing species changes the body, not the paint.',
      ),
      express: bi('表达', 'Expression'),
      expressNote: bi(
        '部件刚体挂载到骨头上，互相分离、随关节拆合 —— 不做蒙皮。',
        'Parts are mounted rigidly to bones, separate from each other, opening and closing with the joints. No skinning.',
      ),
    },
    combTitle: bi('47,000 是一个组合数', '47,000 is a combinatorial count'),
    combBody: bi(
      '原作宣称「47,000 种可能」。那不是 47,000 个模型，是槽位 × 部件 × 材质算出来的组合数 —— 这是我们逆向出来的第一条结论，也决定了整个架构。我们用同一套办法：',
      'The original claims “47,000 possible reflections”. That is not 47,000 models but a count — slots × parts × materials. It was the first thing we reverse-engineered, and it decided the whole architecture. We do the same:',
    ),
    counts: {
      species: bi('物种', 'Species'),
      plans: bi('身体方案', 'Body plans'),
      parts: bi('部件', 'Parts'),
      slots: bi('槽位', 'Slots'),
      materials: bi('材质', 'Materials'),
    },

    // ── 物种谱系 ──────────────────────────────────────────────────────
    speciesTitle: bi('物种谱系', 'Species'),
    speciesLead: bi(
      '每个物种在形态空间里占一个位置。两根轴：像人的程度、像活物的程度。标记的形状是它的身体方案。',
      'Each species sits somewhere in a morphology space, on two axes: how human-like, how life-like. The shape of each mark is its body plan.',
    ),

    // ── 隐私 / 署名 ───────────────────────────────────────────────────
    privacyTitle: bi('隐私', 'Privacy'),
    creditsTitle: bi('署名与许可', 'Credits and licence'),
    licence: bi(
      '源代码 MIT。五项除外，请分别对待：',
      'Source code is MIT, with five carve-outs:',
    ),
    // 名字**改过一次**：上一版确实是 `dither-blur-carousel`，但首屏那个轮播已经重做成
    // SDF 的环，出处随之换成同一位作者的 Viscose-carousel（`docs/35-VISCOSE.md` §0/§1）。
    // 署名写错的成本和别处的文案不是一个量级 —— 这一条是许可声明，不是介绍。
    carve1: bi(
      '首屏的环移植自 Viscose-carousel（MIT © Yousuf Soomro），其 public/ 里的图片与字体未取用。',
      'The opening ring is ported from Viscose-carousel (MIT © Yousuf Soomro); nothing from its public/ folder is used.',
    ),
    carve2: bi(
      'ZKMSerendipity 字体权利属于 ZKM，本项目非商用、不再分发；fork 请自行取得许可。',
      'The ZKMSerendipity typeface belongs to ZKM. Non-commercial use here, not redistributed; forks must obtain their own licence.',
    ),
    carve3: bi(
      '部件与参考图由 Hyper3D Rodin 生成并经本仓库流水线规范化，使用前请确认该服务的条款。',
      'Parts and reference images are generated by Hyper3D Rodin and normalised by this repository’s pipeline; check that service’s terms before reuse.',
    ),
    // 六个物种用的是真实机器的几何，不是生成件。
    // 这一条必须在页面上，不能只写在仓库里：BSD-3 的声明保留义务针对的是**再分发**，
    // 而公开部署就是再分发。非背书那一句同样是义务，不是客气话。
    // 代用件照实写：wheelleg 是 WL_P311D 不是 W1，athlete 是 DRC 那一代 Atlas 的描述模型（版权人 MIT，不是 Boston Dynamics）。
    carve5: bi(
      '六个物种用的是真实机器的几何：Unitree G1（BSD-3 变体）、ANYbotics ANYmal C（BSD-3）、Agility Cassie（MIT）、'
      + 'Hello Robot Stretch 3（Apache-2.0），取自 MuJoCo Menagerie 的钉死 commit；'
      + 'DRC 一代 Atlas 的描述模型（BSD-3，版权人 MIT CSAIL Robot Locomotion Group），取自 RobotLocomotion/models；'
      + 'LimX WL_P311D 轮足（Apache-2.0，代用 W1），取自 LimX 公开的描述仓库。'
      + '均经本仓库流水线重新定向、归一、减面、去材质。逐件来源与改动见仓库的 assets/parts/ATTRIBUTION.md。'
      + '本作品与上述任何公司或机构无关，不由它们背书。',
      'Six species use real machine geometry: Unitree G1 (BSD-3 variant), ANYbotics ANYmal C (BSD-3), '
      + 'Agility Cassie (MIT) and Hello Robot Stretch 3 (Apache-2.0) from a pinned commit of MuJoCo Menagerie; '
      + 'the DRC-era Atlas description model (BSD-3, copyright MIT CSAIL Robot Locomotion Group) from RobotLocomotion/models; '
      + 'the LimX WL_P311D wheel-leg (Apache-2.0, standing in for W1) from LimX’s public description repository. '
      + 'All were re-oriented, normalised, decimated and stripped of materials by this repository’s pipeline. '
      + 'Per-part sources and modifications are in assets/parts/ATTRIBUTION.md. '
      + 'This work is not affiliated with, nor endorsed by, any of those companies or institutions.',
    ),
    carve4: bi(
      '作品本身是一件装置。代码开源不等于作品可以被原样复制展出。',
      'The work itself is an installation. Open source code is not permission to re-stage it.',
    ),
    repo: bi('仓库', 'Repository'),
  },

  /**
   * 控件条 —— 把已经存在的能力变成可以当场演示的。
   *
   * 为什么要有它：这件作品做了五套场景、九种身体方案、跟随延迟、时域精化、
   * 四个玩法，而**它们此前全部只能用 URL 参数切**。观众和评委看不见其中任何一样，
   * 不是因为它们没做，是因为没有一个地方能按一下。
   *
   * 为什么每一个都配一句短说明：一个写着「逆光」的按钮只说得出它叫什么，
   * 说不出按下去会发生什么。这一条和目录那一条（「它能回答什么问题」）是同一条规矩。
   * 说明必须短 —— 它是刻在面板上的丝印，不是帮助文档。
   */
  controls: {
    title: bi('控件', 'Controls'),
    /** 回舞台那条出口上印的名字（`ui/return-to.ts`）：「返回舞台」 */
    stage: bi('舞台', 'Stage'),
    /**
     * 分组的题。全大写小标签，承担"这一栏管什么"那个角色。
     * 原来的「渲染」拆成两组（2026-09-14）：观众会选的放「看起来」，
     * 工程上用来做对照的两项放最底下的「对照」—— 一个观众不需要知道时域精化是什么。
     */
    groups: {
      form: bi('形体', 'Form'),
      scene: bi('画面', 'Scene'),
      framing: bi('取景', 'Framing'),
      act: bi('玩法', 'Act'),
      look: bi('看起来', 'Look'),
      species: bi('身体', 'Species'),
      random: bi('随机', 'Random'),
      ab: bi('对照', 'A/B'),
    },
    /** 每组一句：说的是这一栏**在回答什么**，不是它有几个选项 */
    groupNotes: {
      form: bi('同一个你，换一具身体的骨架', 'Same you, a different skeleton'),
      scene: bi('它站在什么地方', 'Where it is standing'),
      framing: bi('只露上半身也行。自动会跟着你切', 'Upper body is fine. Auto follows you'),
      act: bi('它和你是什么关系。弧线会自己走完四段', 'What it is to you. The arc walks all four itself'),
      look: bi('它为什么看起来像活的', 'Why it reads as alive'),
      species: bi('它是什么物种。换物种要重新建身体', 'Which species. Changing this rebuilds the body'),
      /** 说清楚这一组是给谁的：关掉它，看它原本在替你挡住什么 */
      ab: bi('对照用：关掉它，看它原本在补什么', 'For comparison: switch off to see what it covers'),
      /**
       * 说的是**按下去之后能不能走回来**，不是"这个按钮叫随机"。
       * 一个回不去的随机按钮是老虎机 —— 这一句就是它不是老虎机的那句凭据。
       */
      random: bi('物种、形体、画面、描边一起换。地址栏里留得住', 'Rolls species, form, scene, outline. The address bar keeps it'),
    },

    /**
     * 叠加那两组的第一项（`shell/intent.ts`）。它就是"什么都没叠"的样子，
     * 所以说明写的是**弧线自己会做什么** —— 观众据此知道不点也有东西在走。
     */
    arc: {
      act: { name: bi('跟着弧线', 'Arc'), note: bi('三分钟里自己走完四段', 'Walks through all four on its own') },
      form: { name: bi('跟着弧线', 'Arc'), note: bi('第 III 段换成物种自己的身体', 'The species body arrives in part III') },
    },
    /**
     * 选项右边的状态词（全透明之后，状态靠墨的强弱 + 线的形状 + 这几个等宽小字说，docs/23 §S4.1）。
     * 「叠加」那一句**每次都带着撤销的说法**：观众第一次看见它的时候，正是他需要知道怎么撤的时候。
     */
    arcNow: bi('此刻', 'Now'),
    /** 换物种 / 进出团块：要重开一次，这一格一直说到页面真的走了 */
    restarting: bi('重开中', 'Restarting'),
    /** 面板顶上那一行：弧线此刻在哪一段、叠了什么。不写秒数（docs/40 §5 不给观众看进度） */
    statusNow: bi('此刻', 'Now'),
    statusOver: bi('叠加', 'On top'),

    /** 链到工作台的那几条（`ui/control-table.ts` 的 links）。说的是**那一页给你看什么** */
    links: {
      lineup: bi('身体方案并排看', 'Body plans side by side'),
      mass: bi('团块单独看', 'The mass on its own'),
      vitality: bi('生命力 A/B', 'Vitality A/B'),
      figure: bi('这个物种拆开看', 'This species, part by part'),
    },

    /** 身体方案（docs/18）。说明写的是**剪影**，因为物种靠整体剪影辨识 */
    form: {
      rig: { name: bi('人形', 'Rig'), note: bi('和你一样的骨架', 'The same rig as you') },
      quadruped: { name: bi('四足', 'Quadruped'), note: bi('手臂变成前腿，横着走', 'Arms become forelegs') },
      mass: { name: bi('团块', 'Mass'), note: bi('没有零件，整团在动', 'No parts — one moving mass') },
      // 点场。控件条上以前没有它 —— `FORM_IDS` 抄的是 `BODY_PLANS` 加一个手写的
      // `mass`，而 `swarm` 两边都不在，于是一个**线上真的在用**的方案在调试面板上
      // 根本按不出来（只能靠 `?plan=swarm` 重载）。
      swarm: { name: bi('点场', 'Swarm'), note: bi('身体没了，只剩一片跟着动的点', 'The body is gone — only moving points') },
      stub: { name: bi('短肢', 'Stub'), note: bi('大躯干，退化的四肢', 'Big torso, stunted limbs') },
      radial: { name: bi('放射', 'Radial'), note: bi('四肢绕着核心散开', 'Limbs fan out around a core') },
      column: { name: bi('柱状', 'Column'), note: bi('立起来的一根，四肢收拢', 'One upright column') },
      towering: { name: bi('高耸', 'Towering'), note: bi('拉长，比你高一截', 'Stretched — taller than you') },
      inverted: { name: bi('倒置', 'Inverted'), note: bi('翻过来，头着地', 'Upside down, head on the ground') },
    },

    /** 五套场景（stage/scenes.ts）。说明说的是"看得见什么变化" */
    scene: {
      paper: { name: bi('纸', 'Paper'), note: bi('和开头同一张白纸', 'The same white paper as the opening') },
      gallery: { name: bi('白展厅', 'Gallery'), note: bi('亮底，剪影最清楚', 'Bright ground, sharpest silhouette') },
      void: { name: bi('深空', 'Void'), note: bi('一束顶光，四周全黑', 'One top light, nothing else') },
      tide: { name: bi('夜潮', 'Tide'), note: bi('地面是湿的，有倒影', 'Wet ground — it gets a reflection') },
      backlit: { name: bi('逆光', 'Backlit'), note: bi('只剩一圈轮廓光', 'Only a rim of light left') },
    },

    /**
     * 取景策略（`core/src/autoframe.ts`，docs/49 §落地）。说明写的是**画面上会看到什么**，
     * 不是"分类器"—— 观众不需要知道有一个分类器，他需要知道坐着也行、退后会看见全身。
     */
    framing: {
      auto: { name: bi('自动', 'Auto'), note: bi('坐近看上半身，退后看全身', 'Close: upper body. Step back: all of it') },
      full: { name: bi('全身', 'Full'), note: bi('一直是等身的整个人', 'Always the whole body, life-size') },
      upper: { name: bi('上半身', 'Upper'), note: bi('一直是中景，腿站着不动', 'Always a medium shot; legs stand still') },
    },

    /**
     * 人数（docs/50）。和取景同一组。说明只承诺会识别 / 跟踪到多少人；第三具身体仍受几何预算约束，
     * 所以不能在这里写成“三个人、各一具”。
     */
    people: {
      auto: { name: bi('自动', 'Auto'), note: bi('自动识别一到三个人', 'Detects one to three people') },
      1: { name: bi('一个人', 'One'), note: bi('只跟着检测到的一个人', 'Tracks one detected person') },
      2: { name: bi('两个人', 'Two'), note: bi('第二个人进画，就多一具身体', 'A second person gets a second body') },
      3: { name: bi('三个人', 'Three'), note: bi('最多跟着三个人', 'Tracks up to three people') },
    },

    /** 四个玩法（docs/16） */
    act: {
      follow: { name: bi('跟随', 'Follow'), note: bi('它就是你', 'It is you') },
      echo: { name: bi('回声', 'Echo'), note: bi('慢一步 —— 那是刚才的你', 'A step behind — that was you') },
      resist: { name: bi('抵抗', 'Resist'), note: bi('它有重量，你得迁就它', 'It has weight; you give way') },
      facing: { name: bi('朝向', 'Facing'), note: bi('镜像没了，它在看你', 'The mirror drops — it looks at you') },
    },

    /** 渲染开关。`on/off` 只是状态词，说明写的是"关掉之后你会看到什么" */
    render: {
      vitality: { name: bi('跟随延迟', 'Lag'), note: bi('关掉它，整具身体同时到位', 'Off: the whole body arrives at once') },
      refine: { name: bi('时域精化', 'Smoothing'), note: bi('关掉它，抖动直接进画面', 'Off: the jitter comes straight through') },
      post: { name: bi('后期', 'Post'), note: bi('辉光、暗角、颗粒', 'Bloom, vignette, grain') },
      sound: { name: bi('声音', 'Sound'), note: bi('四层环境声', 'Four layers of ambience') },
      /**
       * 描边。说明写的是**开了之后会看到什么**，而不是"启用卡通着色" ——
       * 观众不需要知道反向外壳，他需要知道这具身体会变成被画出来的。
       */
      outline: {
        name: bi('描边', 'Outline'),
        note: bi('开了它就像是被画出来的', 'On: it looks drawn, not built'),
      },
    },
    on: bi('开', 'On'),
    off: bi('关', 'Off'),

    /**
     * 随机那一栏。按钮上写的是**它会做什么**，说明写的是**它怎么被走回去** ——
     * 后面那半句才是这个按钮和老虎机的区别。
     */
    random: {
      roll: {
        name: bi('随机一具', 'Roll a new one'),
        // 玩法不抽：弧线自己会走完四段（`ui/control-table.ts` 里 act 那一条的 roll）
        note: bi('物种 · 形体 · 画面 · 描边', 'Species · form · scene · outline'),
      },
      // 这里原来还有一句 `keeps`（「抽到的写进地址栏…」），和组说明说的是同一件事，删了
    },

    /** 物种那一栏 */
    filter: bi('筛物种', 'Filter species'),

    /** Key 条。现场手比鼠标快 —— 每个键都要在条上看得见 */
    keys: {
      title: bi('快捷键', 'Keys'),
      toggle: bi('显示 / 藏起这条', 'Show / hide this bar'),
      form: bi('下一个形体 · 回到弧线', 'Next form · back to arc'),
      scene: bi('下一套画面', 'Next scene'),
      framing: bi('取景：自动 · 全身 · 上半身', 'Framing: auto · full · upper'),
      people: bi('人数：自动 · 一 · 二 · 三', 'People: auto · one · two · three'),
      act: bi('下一个玩法 · 回到弧线', 'Next act · back to arc'),
      vitality: bi('跟随延迟', 'Lag'),
      refine: bi('时域精化', 'Smoothing'),
      post: bi('后期', 'Post'),
      sound: bi('声音', 'Sound'),
      outline: bi('描边', 'Outline'),
      roll: bi('随机一具', 'Roll a new one'),
    },
  },

  /**
   * 右下角那一列（`ui/exits.ts`）—— 观众对**这具身体**的三个处置。
   *
   * 三条文案的共同规矩：**说的是"会发生什么"，不是"这个功能叫什么"。**
   * 「返回」说不出按下去会看到什么，「回到大厅」说得出；
   * 「自主模式」是一个功能名，「把身体还回去」是一件事。
   *
   * 「把身体还回去」这一句是这一列的重心，措辞不要改软：
   * 它说的不是关掉什么，是**你把借来的东西还了回去**——
   * 而那具身体接着自己动，正是这件作品要问的那句话。
   */
  exits: {
    hall: bi('回到大厅', 'Back to the hall'),
    give: bi('把身体还回去', 'Give the body back'),
    /** 还回去之后 / 还没还的时候，那一行右边的状态词 */
    giveOn: bi('它自己在动', 'Moving on its own'),
    giveOff: bi('它跟着你', 'Following you'),
    camera: bi('摄像头', 'Camera'),
    /** 「开」说的是**它正在看着你**，不是"设备已启用" */
    cameraOn: bi('开着，它在看你', 'On — it sees you'),
    cameraOff: bi('关着', 'Off'),
    /**
     * 按下之后、第一次认出画面之前（冷缓存实测 30 秒量级，docs/48 §2）。
     * 此前这几秒那一行只是变灰、字还写着「关着」—— 观众读到的是"没反应"。
     * 身体这期间照常跟着录像动，所以这一句说的只是摄像头这一件事。
     */
    cameraStarting: bi('正在打开', 'Starting'),
    /** 摄像头中途断了（拔线、被别的程序占走）。身体已经换回录像 —— 这一句把那次替换说出来 */
    cameraLost: bi('摄像头断开了，换回录像', 'Camera lost — back to the recording'),
  },

  /**
   * 目录 —— 这个站的房间之间唯一的通路。
   *
   * 为什么必须有：`/about` 和 `/making.html` 承载了这件作品一半的表达，
   * 而首页上一个入口都没有 —— 一个评委打开首页，除非有人告诉他，
   * 否则永远不会知道它们存在。
   *
   * 为什么每条都写"它能回答什么问题"而不是功能名：`/dev/index.html` 已经
   * 这么做了，而它有效的原因是——人不是在找功能，是带着疑问来的。
   * 「共生护照」四个字说不出你为什么要点它，「谁被拒绝入境，谁被放行」说得出。
   */
  nav: {
    title: bi('目录', 'Contents'),

    items: {
      work: {
        name: bi('作品', 'The work'),
        answers: bi('它跑起来是什么样？站到画面里就知道。', 'What is it like when it runs? Step into the frame.'),
      },
      about: {
        name: bi('作品陈述', 'About'),
        answers: bi('它是什么？和 2019 年那件的区别在哪？', 'What is it — and how does it differ from the 2019 work?'),
      },
      lineage: {
        name: bi('谱系', 'Lineage'),
        answers: bi('在你之前站上去的人，留下了什么？', 'What did the people before you leave behind?'),
      },
      making: {
        name: bi('做的过程', 'The Making'),
        answers: bi('人和机器是怎么互相纠正着把它做出来的？', 'How did people and machines correct each other into making it?'),
      },
      passport: {
        name: bi('共生护照', 'Passport'),
        // 「产物」写窄了：第四枚章的申请人不是一件产物，是花名册上一个空位。
        // 换成这一页自己的那句话（passport.ts 文件头）——「谁被拒绝入境，谁被放行」。
        answers: bi('谁被拒绝入境，谁被放行？', 'Who was refused entry, and who was let in?'),
      },
      dev: {
        name: bi('工作台', 'Workbench'),
        answers: bi('每条降级路径长什么样？我们自己怎么验收？', 'What does each fallback look like? How do we check our own work?'),
      },
    },

  },

  /**
   * 侧室 —— **不在目录里的那四个房间**（docs/23 §S9）。
   *
   * 它们各自都是我们自己的仪器，现在被展出，因为它们回答的那个问题观众也有。
   * 门开在 `/about` 的正文里（`ui/clue.ts`），所以这里的每一句都要
   * **对一个没有造过这件作品的人成立** —— 一句框定，不解释画面。
   *
   * `doors` 那一组只给读屏念。屏幕上那扇门只是一个数字，
   * 读屏念到它的时候得知道自己站在哪儿：「208 侧室 · 部件档案 链接」。
   */
  rooms: {
    parts: {
      title: bi('部件档案', 'Parts Archive'),
      lede: bi(
        '这件作品到现在为止长出来的每一件东西，按物种、按槽位排开，每一件带着它自己的接口标记。',
        'Everything this work has grown so far, laid out by species and by socket, '
        + 'each part carrying its own attachment marks.',
      ),
      /**
       * `parts.json` 读不到或是空的时候，这一页说的话。**原来是 `parts.ts` 里一段手写的中文 HTML**
       * —— 它在 `/dev/` 里是给我们看的，搬成侧室之后它就站在展出页上了，而展出页的文案一律中英并置、
       * 一律走 `setBi`。线上构建里这一段不会出现（`parts.json` 一定在），但"不会出现"不是它可以只说一种语言的理由。
       * 命令本身不翻译：`npm run factory:index` 在两种语言里是同一串字。
       */
      emptyTitle: bi('档案还是空的', 'The archive is still empty'),
      emptyWhy: bi(
        '没有读到 /parts/parts.json，或者它里面还没有条目。这不是故障：没有部件库的时候，作品用程序化占位几何照常运行。',
        'No /parts/parts.json was found, or it has no entries yet. This is not a fault: '
        + 'without a parts library the work runs on procedural placeholder geometry.',
      ),
      emptyHow: bi('要把它填起来，先跑一次资产流水线，再刷新这一页：', 'To fill it, run the asset pipeline once, then reload this page:'),
      readOnly: bi('只读', 'Read-only'),
      curatable: bi('可评级', 'Ratable'),
      readOnlyNoGl: bi('只读 · 无 WebGL，缩略图是比例剪影', 'Read-only · no WebGL, thumbnails are proportion silhouettes'),
      curatableNoGl: bi('可评级 · 无 WebGL，缩略图是比例剪影', 'Ratable · no WebGL, thumbnails are proportion silhouettes'),
      writeFailed: bi('只读 · 评级写不回去', 'Read-only · ratings cannot be written back'),
    },

    roster: {
      title: bi('物种接触表', 'Contact Sheet'),
      lede: bi(
        '可以变成的身体，一版摆完。编号和作品陈述、海报上的是同一套 —— 对得上才算数。',
        'Every body you could become, on a single plate. The numbering is the same one used in '
        + 'the statement and on the posters; it is only a number if it matches.',
      ),
    },

    marks: {
      title: bi('九枚记号', 'Nine Marks'),
      lede: bi(
        '九种身体方案，九个形状。物种靠整体剪影辨识，不靠涂装 —— 这九笔就是那句话的全部字母表。',
        'Nine body plans, nine shapes. A species is recognised by its whole silhouette, not by its '
        + 'paint — these nine strokes are the entire alphabet of that claim.',
      ),
      usedBy: bi('用它的物种', 'Species on this plan'),
      usedByNone: bi('还没有物种走这个方案', 'No species is on this plan yet'),
    },

    /** 读不到 `parts.json` 时这几个房间说的话。白屏不是一种状态（docs/02 §craft） */
    empty: bi(
      '这个房间要等资产流水线跑过一次才有东西可看。应用本身没有部件库照样运行 —— 它会用程序化占位几何。',
      'This room has nothing to show until the asset pipeline has run once. The work itself runs '
      + 'without a parts library; it falls back to procedural placeholder geometry.',
    ),

    /**
     * 门后面是什么 —— **只给读屏**。
     * 写成完整的一句而不是在调用点拼「侧室：」+ 房间名：拼出来的双语迟早有一半漏掉，
     * 而这一句恰恰是那种"漏了也没人看得出来"的字（i18n 文件头的纪律那一条）。
     */
    doors: {
      parts: bi('侧室 · 部件档案', 'Side room · Parts Archive'),
      roster: bi('侧室 · 物种接触表', 'Side room · Contact Sheet'),
      marks: bi('侧室 · 九枚记号', 'Side room · Nine Marks'),
      /** 逐个物种的那一扇：通向它在部件档案里的那一格 */
      partsOfSpecies: bi('侧室 · 部件档案里的这一个物种', 'Side room · this species in the Parts Archive'),
    },
  },

  /** 隐私 —— 网页版必须在页面上（docs/13 §5） */
  privacy: {
    // 「不离开你的浏览器」是一句技术保证，读起来像条款。
    // 同样的事实换一种说法就有画面，而且更准：摄像头的画面从来没被送出去，
    // 送出去的只有关节坐标 —— 它认得的一直只是一副骨头。
    // 曾经续过半句「留下的是一个号码」（docs/43 §6.2 的最小版）。作品负责人 2026-09-14 裁定**删回原句**：
    // 全站（入口展签、/about）只留「它只认得你的骨头」。
    // 存档那一行的声明没有消失：/about 的隐私一节里 `privacy.long` 与 `privacy.archiveRow`（存档真的在应答时才印）照旧说清楚留下了什么。
    short: bi(
      '它只认得你的骨头。',
      'It only ever sees your bones.',
    ),
    // 这句话原来写的是「你**主动触发**的那一张剪影」。那是假的：
    // 慢回路在人待满 `SLOW_LOOP.armAfter`（20 秒）之后**自己**就武装了，
    // 观众一个键都没按（`docs/38 §8`）。
    //
    // 一句写在隐私说明里的假话，比没有隐私说明更糟 —— 它是这件作品
    // 唯一一处必须逐字为真的文案。改成实际发生的事：**站着不走就是那个触发**。
    // 而这句话因此也更准：它说的正是这件作品的题目 —— 你什么都没做，
    // 只是待在那儿，而那已经足够让一具身体从你身上长出来。
    //
    // ── 第三句是「不参与」（`§9.5`）──────────────────────────────────────────
    //
    // `docs/13 §5` 要求页面上有一行说明**加一个「不参与」开关**，而
    // `COPY.privacy.optOut` 这个常量一直存在、全仓没有任何一处渲染它。
    // 裁定是：**不新做一个开关，把已经存在的那条路说出来。**
    // 网页版的入口层本来就不要求授权也能看见东西（`docs/13 §1`、`PRD §8`）——
    // 不按那个按钮，摄像头就不开，作品照样在放 demo 回放。
    // 「不参与」在网页版上**已经实现了，只是没有被命名**。加一个勾选框是
    // `docs/26 §F` 的反面清单；说出来才是这件作品的做法。
    //
    // ── 第二句是存档（`§8` / `§9.4`）────────────────────────────────────────
    //
    // 逐字列出那一行里有什么，是因为「永久保留」这条裁定**不是靠匿名化站住的，
    // 是靠那一行里根本没有个人数据站住的**。说不清有什么，那条裁定就没有基础。
    // 字段清单在 `packages/archive/src/visit.ts`，那边有测试钉着它。
    //
    // 现场那一句（二十秒）留着：它此前写的是「你**主动触发**的那一张剪影」，
    // 而慢回路是人待满 `SLOW_LOOP.armAfter`（20 秒）之后**自己**武装的，
    // 观众一个键都没按（`docs/38 §8`）。一句写在隐私说明里的假话比没有隐私说明更糟。
    long: bi(
      '姿态识别全部在本地运行，摄像头的画面一帧都不离开你的设备。'
      + '不按那个按钮，摄像头就不会打开，作品照样在放。'
      + '装置上的那一张剪影在你连续站够二十秒之后自动送出一次，用来生成那件长在你身上的东西。',
      'Pose estimation runs entirely on your device; no camera frame ever leaves it. '
      + 'If you never press the button, the camera never opens and the piece plays anyway. '
      + 'On the installation, one silhouette is sent once, automatically, after you have stood there '
      + 'for twenty seconds, to generate the part that grows on you.',
    ),

    /**
     * **存档那一句是分开的，而且只有存档真的在的时候才渲染。**
     *
     * 它本来长在 `long` 里。问题是：存储没配的时候，`/api/visits` 会 404，
     * **一行都不会留下** —— 而这一句会照常印在页面上。
     * 那是 `docs/26 §G` 三处「诚实集中」之一，那三处的要求不是"说得好听"，
     * 是**逐字为真**。一句写在隐私说明里的假话比没有隐私说明更糟，
     * 这句话就写在上面 `long` 的注释里，对它自己同样生效。
     *
     * 时序是这样错开的：网站会先于存储上线（存储要作品负责人本人去开，
     * 见 `docs/13 §6` 的发布清单）。所以这一句不能靠"发布的时候记得改文案"
     * 来保证 —— 那等于把一句真话托付给一次人工步骤。
     * 它改成**问一句再说**：`/about` 去敲 `/api/visits`，敲得到才印。
     * 存储开了它自己就出现，不用改代码，也不用有人记得。
     *
     * 逐字列出那一行里有什么，是因为「永久保留」这条裁定**不是靠匿名化站住的，
     * 是靠那一行里根本没有个人数据站住的**。字段清单在
     * `packages/archive/src/visit.ts`，那边有测试钉着它。
     */
    archiveRow: bi(
      '每一次到访只在服务端留下一行：一个序号、你选的物种、一个粗到天的日期 —— '
      + '没有影像，没有动作，没有姓名、账号或 IP。',
      'Each visit leaves a single line on the server: a number, the species you chose, and a date '
      + 'no finer than the day — no imagery, no movement, no name, account or IP address.',
    ),
    /**
     * **这一条故意没有任何一处渲染它，而且从今天起是有裁定的。**
     *
     * `docs/13 §5` 当初要求页面上有一个「不参与」开关，于是这个常量被写了出来，
     * 然后全仓没人用它 —— 一笔悬着的账（`docs/38 §4` 如实记过）。
     * `docs/43 §9.5` 把它裁掉了：网页版的「不参与」**已经实现了，只是没有被命名** ——
     * 不按那个按钮，摄像头就不开，这一场也不会被记进存档（`archive/visit.ts` 的 `live()`）。
     * 做法是让上面那一段把它说出来，不是加一个勾选框（`docs/26 §F` 的反面清单）。
     *
     * 留着这个词是因为现场那一半还欠着（画出来的采集区 + 一条绕开它的路，`§1.5`），
     * 那是布展决定，装台那天在房间里定。**在那之前，网页上不许出现这个控件。**
     */
    optOut: bi('不参与', 'Opt out'),
  },

  /**
   * `/passport.html` 共生护照。
   *
   * 这一页此前把题头的中英文**手搭在 DOM 里**（`'共生护照'` / `'Symbiosis Passport'`
   * 两个字面量直接进 `createElement`）。两个后果：中英对照永远可能漏一句，
   * 而且那条路绕过了 `setBi`，于是汉字那 0.06em 的左边距补偿**一次都没有生效** ——
   * 和选择页名牌那个自造 class 的 bug 是同一类，只是它躲在页题上更难看出来。
   * 现在题头走这里。**章的正文仍然留在 `passport.ts`**：每一枚章是一条带日期的
   * 存证记录，它和文案不是一个身份，搬进文案总册反而会让人以为它可以被改写。
   */
  passport: {
    title: bi('共生护照', 'Symbiosis Passport'),
    /**
     * 四条 —— 第三枚是 2026-09-13 加的（裁定人是另一个代理），
     * 第四枚是 2026-09-14 加的（申请人是一个还没有人申请的位置）。
     * 这一行每加一枚章都要跟着改：它数的是下面真实有几枚。
     */
    lede: bi(
      '四条过程性证明。三次拒入，一次准入。',
      'Four records of process. Three entries refused, one admitted.',
    ),
    work: bi('作品', 'Work'),
    foot: bi(
      '本页每一条都可在仓库中核对。挖不到证据的事件没有被写进来。',
      'Every record on this page can be checked against the repository. Events without evidence were left out.',
    ),
  },

  /**
   * `/lineage` 谱系页。
   *
   * 这一页只回答一个问题：**一个观众怎么知道"我身上这块是别人留下的"。**
   * 所以文案有两条额外的规矩：
   *
   * 1. **不写"记录""条目""数据"这类词。** 池子里的东西不是记录，是**别人留下的身体的一部分**。
   *    一旦用了数据库的词，观众读到的就是一张表，而这一页的全部意义在于它不是表。
   * 2. **空池和 404 都要说得有分量。** 它们是这一页最常见的两种状态
   *    （装置刚开机、网页版打开），说成"暂无数据 / 加载失败"就等于承认这一页是个摆设。
   */
  lineage: {
    title: bi('谱系', 'Lineage'),
    thesis: bi(
      '这里的每一件都曾经长在一个人身上。那个人走了，它没有跟着走 —— 它留下来，等着长在下一个人身上。',
      'Every piece here once grew on somebody. That person left; the piece did not go with them. It stayed, waiting to grow on whoever comes next.',
    ),
    lede: bi(
      '池子只增不减。你在这一页上看到的厚度，就是在你之前站上去过的人。',
      'The pool only ever grows. The thickness on this page is everyone who stepped up before you.',
    ),

    /** 两个巨大的数。数字自己承担句子，所以标签里不留待填的空 */
    countParts: bi('件留在池子里', 'pieces in the pool'),
    /**
     * 网页版那一个数（`docs/43 §8` 的存档）。
     *
     * 它和 `countParts` **不是同一件事**，所以不能共用一个标签：
     * 装置上数的是留下来的件，网页版上数的是走完一整条弧线的人。
     * 一个标签套两种数，那个数就不再说明任何事情。
     */
    countVisits: bi('个人走完过这条弧线', 'people have walked the whole arc'),
    countChance: bi('下一个站上去的人，穿上这里某一件的机会',
                    'the chance that the next person to step up wears one of these'),

    /** 沉积剖面：最新在顶、最早在底。旁边这一句解释它为什么值得看 */
    strata: bi('一件一层，最早的在最底下。这一叠不会变薄。',
               'One layer per piece, the oldest at the bottom. This stack never gets thinner.'),
    strataOlder: bi('底下这一段是更早的人，超出了这一页一次能取回的范围。',
                    'The band below is earlier visitors, beyond what this page can fetch at once.'),
    /** 网页版：一层是一个人，不是一件。厚度的读法不变，被数的东西变了 */
    strataVisits: bi('一人一层，最早的在最底下。这一叠不会变薄。',
                     'One layer per person, the earliest at the bottom. This stack never gets thinner.'),
    /**
     * 网页版这一叠底下那一句。
     *
     * 装置那一版（`lede`）说的是「你在这一页上看到的厚度，就是在你之前站上去过的人」，
     * 网页版逐字成立，但它必须补上**留下来的是什么**：只有位次和日期，没有件。
     * 不补这一句，观众会以为这些层里各有一个看不见的东西。
     */
    visitsNote: bi(
      '这里每一层只有三样东西：第几位、选的哪一个物种、哪一天。没有影像，没有动作，也没有一件可以看的东西 —— 网页版长不出件，那一半只在装置现场发生。',
      'Each layer here holds three things only: a position, the species chosen, and a day. No imagery, no movement, and nothing to look at — the web version grows no parts; that half only happens at the installation.',
    ),
    /**
     * `docs/43 §9.8` 裁的那一句（代 `docs/23` 裁，登记在 `docs/23 §S8`）。
     *
     * 一个循存档链接回来的人看到的是：作品在动，而摄像头没亮。不说明，他会以为坏了；
     * 说明得太重，就变成一个 UI 控件 —— 裁定写明**不做角标、不做「回放中」的常驻标记**，
     * 「那是播放器的语言，而这件作品不是播放器」。所以它是这一页正文里的一句话，
     * 位置在画面之外、和这一页其它文字同一列。
     */
    replay: bi(
      '循一条存档链接回到作品，画面会自己动起来，摄像头不亮 —— 那不是坏了，是有人先来过。',
      'Follow an archive link back into the piece and it moves on its own, with the camera dark. Nothing is broken: somebody was here before you.',
    ),

    /** 记录区 */
    sec: bi('每一件，和留下它的人', 'Each piece, and who left it'),
    /**
     * 存档那一支的同一个位置。**不能共用上面那一句。**
     *
     * 上面写的是「每一件」，而存档那一边一件都没有 —— 它自己底下那一句正说着
     * 「没有一件可以看的东西」。两句话隔着三行互相拆台，读到的人只会认为
     * 这一页哪里坏了。被数的东西变了，题也得变。
     */
    secVisits: bi('每一个走完的人', 'Everyone who walked it through'),
    secNote: bi('左边那个数是留下它的人 —— 按先后排的第几位。不是时间，是位次：谁在谁之后。',
                'The number on the left is the person who left it — their place in the order of arrival. Not a time; a position: who came after whom.'),
    where: bi('长在哪', 'Where it grew'),
    slots: {
      spine: bi('躯干', 'Torso'),
      head: bi('头', 'Head'),
    },
    when: bi('多久以前', 'When'),
    today: bi('今天', 'Today'),
    yesterday: bi('昨天', 'Yesterday'),
    daysAgo: bi('天前', 'days ago'),
    /** provider 不是 hyper3d 时挂这一条：这件不是生成模型造的，别让它冒充 */
    rehearsal: bi('离线演练件', 'Offline rehearsal'),

    /** 空池 —— 装置刚开机的常态，不是错误 */
    emptyTitle: bi('池子是空的。', 'The pool is empty.'),
    emptyBody: bi(
      '装置每次开机都是这样，它不预装任何东西。第一个站上去的人，会是这一页上的第 1 位。',
      'The installation starts this way every time; nothing is preloaded. Whoever steps up first becomes number 1 on this page.',
    ),

    /** 生产构建 / 线上版拿到 404 —— 如实说这条回路在哪，不装作坏了 */
    offTitle: bi('这条回路只在装置现场活着。', 'This circuit is only alive at the installation.'),
    offBody: bi(
      '生成那一步跑在装置那台机器上，谱系也长在那台机器的盘上。网页版是同一件作品的另一半：你可以选一个身体、让它跟着你动，但没有人能在这里留下东西。',
      'The generating step runs on the machine at the installation, and the lineage grows on that machine’s disk. The web version is the other half of the same work: you can choose a body and make it move with you — but nobody can leave anything behind here.',
    ),

    foot: bi('这些不是备份。它们就是下一具身体的候选件。',
             'These are not backups. They are the candidate parts for the next body.'),
  },

  /**
   * `/making` 人机共创过程档案页。
   *
   * 纪律和别处一样，但这一页多一条：**每一条都要能指到一个 commit。**
   * 没有 hash 的事就不写 —— 这一页的全部力量来自它是真的。
   */
  making: {
    title: bi('做的过程', 'The Making'),
    thesis: bi(
      '一个人和一群代理在两天里一起做决定：谁说了什么、谁不同意、为什么、最后动的是哪一边。',
      'One person and a crew of agents deciding together across two days — who said what, who disagreed, why, and which side actually moved.',
    ),
    lede: bi(
      '下面每一条都指向一个 commit。挖不到证据的事没有写进来。',
      'Every line below points at a commit. What could not be evidenced was left out.',
    ),

    sec: {
      numbers: bi('数字', 'Count'),
      timeline: bi('时间线', 'Timeline'),
      corrections: bi('互相纠正', 'Corrections'),
      principles: bi('踩出来的十一条', 'Eleven Principles, Earned'),
      gaps: bi('这一页没有写的', 'Left Out'),
    },

    /** 互相纠正的四段式表头 */
    turn: {
      said: bi('谁说了什么', 'Claim'),
      against: bi('谁不同意', 'Objection'),
      because: bi('理由', 'Reason'),
      result: bi('结果', 'Outcome'),
    },

    /**
     * **每次改这一页都要重新点一遍。** 这张表上的每个数都不是估的，
     * 但「点出来的」只在点的那一刻为真（docs/02 P21 第 2 条）——
     * 上一版把 191 件冻在这里，而部件库当时已经走到 208；合入 main 之后它又是 220。
     * 复核的四条命令：提交数走版本历史、两个包各自的测试脚本、
     * `npm run check:parts`（件数）、`node packages/app/poster/build-data.mjs`（条目与身体方案）。
     */
    numbersNote: bi(
      '全部从版本历史与文件系统里点出来的，不是估的。这一栏点于 2026-09-13 —— 推导出来的数只在推导的那一刻为真，所以它带着日期。',
      'Counted out of the history and the file system, not estimated. This column was counted on 2026-09-13 — a derived number is only true at the moment it was derived, so it carries its date.',
    ),
    timelineNote: bi(
      '不是 changelog。选进来的每一条都是一次判断 —— 有人本可以走另一边。',
      'Not a changelog. Each entry is a judgement call — someone could have gone the other way.',
    ),
    correctionsNote: bi(
      '同一个结构展开：谁说了什么、谁不同意、理由、结果。八件都真的发生过。最后两件里，不同意的那一方也是一个代理。',
      'Same shape each time: claim, objection, reason, outcome. All eight actually happened. In the last two, the party that disagreed was also an agent.',
    ),
    principlesNote: bi(
      '每条原则都附着教会它的那件事。没有故事的原则活不过三天。',
      'Each principle carries the thing that taught it. A principle without its story lasts about three days.',
    ),
    gapsLede: bi(
      '想写但挖不到证据，所以空着 —— 这一页的规矩对它自己也生效。',
      'Wanted, but unevidenced, so left blank. The rule this page imposes applies to this page too.',
    ),

    /** 数字。`value` 一律是从 git / 文件系统点出来的原样，不做四舍五入 */
    numbers: [
      // 这四个数**都只数黑客松那一段**。仓库今天还在长（写这一行时 288 条），
      // 但这一页数的是那场比赛，不是这个仓库的一生 —— 一个跨过截止时间还在涨的
      // 数字，说的已经不是同一件事了。四个数必须同源，否则「149 条提交里 38 次合并」
      // 这种话自己就打自己：它们要么一起数那一段，要么一起数到今天。
      //
      // **注意这一行写的是「第一条提交」，不是「开始」。** 这两件事不是一回事：
      // 比赛开始得比第一条提交早，早出来的那一段没有在往上推代码。
      // 所以这里只报提交的时刻，不报一个时长 —— 拿提交的跨度当比赛的长度，
      // 是把一个测量换个名字再说一遍，而这一页整套规矩就是不许这么做
      // （`docs/10` 的表头规矩：量到的数是记录，改名的记录是伪造）。
      { value: '149', label: bi('次提交', 'Commits'), note: bi('黑客松期间：第一条 09-12 14:24，最后一条 09-13 10:24', 'During the hackathon: first 09-12 14:24, last 09-13 10:24') },
      { value: '38', label: bi('次合并', 'Merges'), note: bi('分支合回来，以及主线合进分支', 'Branches merged back, and main merged in') },
      { value: '23', label: bi('条并行分支', 'Parallel branches'), note: bi('每条是一个代理的一间工作室', 'One worktree, one agent, one room') },
      { value: '5', label: bi('个并行 worktree', 'Worktrees at once'), note: bi('git 一次把五个当成嵌入仓库吞了进去（480a48f）', 'Five got swallowed as embedded repos in one go — 480a48f') },
      { value: '7', label: bi('条契约裁决', 'Contract rulings'), note: bi('分三次报上来，三次都没在下游打补丁', 'Three reports, zero downstream patches') },
      { value: '432', label: bi('个测试', 'Tests'), note: bi('core 182 + app 250，全过', 'core 182 + app 250, all green') },
      { value: '48', label: bi('个测试文件', 'Test files'), note: bi('随 npm run check 一起跑', 'Run by npm run check') },
      { value: '220', label: bi('件部件', 'Parts'), note: bi('28 个物种共用一个部件库', '28 species share one library') },
      { value: '12', label: bi('件剔除', 'Rejected'), note: bi('保留 0 件 —— keep 是审美判断，留给人', 'Zero keeps: that call belongs to a person') },
      { value: '45', label: bi('份文档', 'Documents'), note: bi('契约与背景分开写', 'Contracts kept apart from context') },
      { value: '181', label: bi('个 TS 文件', 'TS files'), note: bi('不含 node_modules', 'node_modules excluded') },
      { value: '11', label: bi('条原则', 'Principles'), note: bi('P11–P21，每条都有它的事故', 'P11–P21, each with its incident') },
    ],

    /** 时间线。每条都是一次判断 —— 不是 changelog */
    timeline: [
      { hash: '2933ec4', day: '09-12', time: '14:24', text: bi(
        '起手先写契约和背景，再写第一行运行时代码。部件格式、挂载数学、主题表 —— 都在有东西可跑之前定下来。',
        'Contracts and context first, runtime code second. Part format, attachment math, theme table — all settled before anything could run.') },
      { hash: '480a48f', day: '09-12', time: '14:44', text: bi(
        '编排者的 git add -A 把五个 worktree 当成嵌入式仓库塞进了索引。下一条提交把它们排除出去。',
        'The orchestrator’s git add -A swallowed five worktrees as embedded repos. The next commit pushed them back out.') },
      { hash: 'f9dc4b3', day: '09-12', time: '14:52', text: bi(
        '?seed= 留空会被 Number(\'\') === 0 坑成锁定 seed 0 —— 现场会看到每个人都变成同一具身体。',
        'An empty ?seed= fell through Number(\'\') === 0 and pinned every visitor to seed 0 — the same body for everyone.') },
      { hash: 'f720220', day: '09-12', time: '14:59', text: bi(
        '裁决：验收标准是编排者写反的。改的是契约，不是实现。',
        'Ruling: the acceptance criterion itself was backwards. The contract moved, the implementation did not.') },
      { hash: '4576a8b', day: '09-12', time: '15:08', text: bi(
        '采集线把量深度的工具和判据全部交付，结论那一栏空着 —— 这台机器前面没有人可以蹲下。',
        'The capture lane shipped the instrument and the criterion, and left the conclusion blank: nobody was there to squat in front of the camera.') },
      { hash: '8720d21', day: '09-12', time: '15:09', text: bi(
        '合成占位数据在加载路径上补了一条 console.warn。只写在文件里的警告，等于没有警告。',
        'The synthetic placeholder data got a console.warn on its load path. A warning only visible inside the file is not a warning.') },
      { hash: '27aea60', day: '09-12', time: '15:12', text: bi(
        '装配线报上来两处文档与实现不一致。文档改成指向 tuning.ts，不再自己抄一份数字。',
        'The assembly lane flagged two doc-vs-code mismatches. The doc now points at tuning.ts instead of keeping its own copy of the number.') },
      { hash: '2370c67', day: '09-12', time: '15:25', text: bi(
        '玩法扩展点自带故障隔离：连续 3 次抛异常就永久禁用并回落。让「随便试」变安全，是那块空间成立的前提。',
        'The act extension point ships with its own blast door: three consecutive throws and an act is disabled for good. Cheap experiments only exist if they are survivable.') },
      { hash: '196f527', day: '09-12', time: '15:26', text: bi(
        '第一遍策展只标 10 个剔除，保留一个没标。keep 的含义是「永不重新生成」—— 那是审美判断。',
        'First curation pass marked ten rejects and zero keeps. A keep means “never regenerate this” — that is a taste call, not a machine call.') },
      { hash: '05ffbb9', day: '09-12', time: '15:34', text: bi(
        '目检 186 件得到的那张表没有被换成公式：长宽比 < 1.6 会漏掉 foot，而 foot 恰恰最严重。同一笔修掉了定向规范化会把 186 件索引删成 2 件。',
        'A list from eyeballing 186 parts stayed a list: the tidy “aspect ratio < 1.6” rule dropped foot, the worst offender. The same commit fixed a targeted normalize that cut a 186-part index down to 2.') },
      { hash: '87b93f8', day: '09-12', time: '15:41', text: bi(
        '写下头号设计缺陷：23 个条目其实是同一具人体换皮。不是素材质量问题，是只有一种表达方式。',
        'The top design defect gets written down: all 23 entries are one human body reskinned. Not an asset-quality problem — only one mode of expression existed.') },
      { hash: '4293b1c', day: '09-12', time: '17:56', text: bi(
        '补上 PRD 的三条产品主张，并当场写明第三条现在不成立。',
        'The PRD lands with three exclusive claims, and a note that the third one does not hold yet.') },
      { hash: '8a8ab68', day: '09-12', time: '18:00', text: bi(
        'P11–P20 并进宪法：原则散在 commit 信息里就会消失，收进一处并各自附上教会它的那件事。',
        'P11–P20 join the constitution. Principles scattered across commit messages evaporate; collected, each keeps the incident that taught it.') },
      { hash: '19880ae', day: '09-12', time: '18:12', text: bi(
        '第一个真的不是人形的物种。关键设计：四肢的世界方向原样保留，只把肩胯搬到水平躯干上 —— 「你抬手，它抬前腿」的因果不能断。',
        'The first genuinely non-human body plan. The design hinges on keeping limb world directions untouched and moving only the sockets: lift your arm, the foreleg lifts. That causal line must survive.') },
      { hash: '448127a', day: '09-12', time: '18:25', text: bi(
        '现场兜底的全部前置条件做完 —— 录制页、写回管线、拒收合成数据的中间件。仍然没有兜底，因为缺的是一个真人，而代理没有再造一份假数据顶上。',
        'Every precondition for the venue fallback is finished — recorder page, write-back pipeline, middleware that refuses synthetic data. There is still no fallback, because what is missing is a person, and the agent would not fake one.') },
      { hash: 'a2127d8', day: '09-12', time: '18:29', text: bi(
        '一条线险些静默删掉别人刚落地的东西。它自己在提交前看了一眼暂存区，退回重做，并报了上来。',
        'One lane came within a commit of silently deleting work another lane had just landed. It checked its own staged diff, backed out, redid it, and said so.') },
      { hash: '0869fc2', day: '09-12', time: '18:57', text: bi(
        '任务卡让代理去读一份还没提交的文档。代理如实说「这个前提是假的，所有数字是我自己测的」，没有假装读过。',
        'A task card told an agent to read a document that had never been committed. The agent said so plainly — “that premise is false; every number here is my own measurement” — instead of pretending.') },
      { hash: 'dfc9c63', day: '09-12', time: '18:58', text: bi(
        '团块身体合入，代理自己标出三处不足：躯干是个圆蛋、低分辨率不是降质而是换了个生物、表面还不会动。',
        'The metaball body merges, with the agent listing its own three shortfalls: the torso is an egg, low resolution is a different creature rather than a cheaper one, and the surface does not move yet.') },
      { hash: 'f013230', day: '09-12', time: '22:55', text: bi(
        '第一次真跑构建：产物 975MB。「raw 绝不进 dist」这句话在文档里躺了一整天，没人验证过。降到 45MB。',
        'The first real build weighed 975MB. “raw never ships” had sat in the docs all day, unverified. Down to 45MB.') },
      { hash: '3b63973', day: '09-12', time: '23:02', text: bi(
        '舞台线推翻自己的前一版四处，每处给理由：升档脉冲从 +108% 改回规格的 +8%，地面冲击波环删掉。',
        'The stage lane overturns four of its own earlier choices and gives a reason for each: the tier-up pulse goes from +108% back to the specified +8%, and the ground shockwave ring is deleted.') },
      { hash: '1e55834', day: '09-12', time: '23:12', text: bi(
        '字体先决定不进仓库：理由不是权利人是谁，而是个人非商用的「使用」授权几乎从不包含「再分发」，而这个仓库是公开的。',
        'The typeface is first kept out of the repo — not because of who owns it, but because a personal non-commercial licence to use almost never includes redistribution, and this repo is public.') },
      { hash: '2850e62', day: '09-12', time: '23:17', text: bi(
        '项目持有人确认授权后字体才进仓库，并且做成可以随时拆掉：回退栈度量完全一致，删掉那个目录排版不变。',
        'It ships only after the project owner confirms the licence, and it ships detachable: the fallback stack has identical metrics, so deleting the folder changes nothing about the typography.') },
      { hash: 'fe8a5c2', day: '09-12', time: '23:24', text: bi(
        '团块补上表面语言 —— 这是它交回时自己指出的缺口。三层叠加各管一件事，幅度刻意小：破了硬夹剪影就散了，那时读到的是「模型在抖」。',
        'The metaball body gets its surface language — the gap the lane itself had named on handover. Three layered waves, each with one job, deliberately shallow: past the hard clamp the silhouette dissolves and it reads as a glitching mesh.') },
      { hash: '96f5270', day: '09-12', time: '23:26', text: bi(
        '收尾不是宣布完成，而是逐条对照六条判据：只有一条是确凿的。并记下那个结构性问题 —— 精力大量投在可自动验证的层，而作品成立与否落在只能由人判断的层。',
        'The last act is not a declaration of done but a line-by-line audit against six criteria: exactly one holds. Plus the structural note — effort pooled in the auto-verifiable layer, while whether the work lands at all sits in the layer only a person can judge.') },
      { hash: '50ae32d', day: '09-13', time: '12:07', text: bi(
        '叙事中文的楷书换掉，而不是重跑一遍子集：芫荽是繁体字身，「关 观 对 实 验」这 81 个字上游的字表里根本没有，重跑一百遍也救不回来。',
        'The narrative typeface is replaced rather than re-subset: Iansui carries traditional forms, and the 81 simplified-only characters were never in the upstream font at all. No amount of re-subsetting recovers them.') },
      { hash: '0b3fa23', day: '09-13', time: '17:30', text: bi(
        '左上角多了一块小屏幕，回答「它有没有看见我」。「默认零 UI」的前提是它真的在动 —— 追踪垮掉时身体只是站着，而那和「坏了」在观众眼里是同一个画面。',
        'A small screen appears in the top-left corner, answering one question: can it see me. “Zero UI by default” assumes the thing is actually moving — when tracking dies the body simply stands there, and to a visitor that is the same picture as broken.') },
      { hash: 'b6e6ee6', day: '09-13', time: '17:41', text: bi(
        '「场」的 tagline 是「身体消失，只剩运动」，而它当时是一具向别的物种借了整套四肢的机器人。改成 1400 个点跟着活骨架走，每个点停在自己的那一刻。',
        'The species called Field is captioned “the body disappears; only the movement is left” — and it was a robot wearing a full set of limbs borrowed from other species. It becomes 1,400 points locked to the live skeleton, each sitting at its own moment in the past.') },
      { hash: '2993fa7', day: '09-13', time: '19:21', text: bi(
        '海报数字号称「算出来的，从不手打」。它确实算过 —— 算过一次，然后冻在 191 件，而部件库已经走到 208。这一条写下来的当天，它又变成了 220。',
        'The poster numbers were “computed, never typed”. They were computed — once — and then frozen at 191 parts while the library moved on to 208. By the day this line was written it was 220.') },
      { hash: 'a8c04ea', day: '09-13', time: '19:31', text: bi(
        '在这之前这件作品没有时间：分档看的是累计运动量，玩法是随机加权挑的。四个乐章按陈述里的那四个词命名，时间成为主轴、动作降为加速项。',
        'Until now the work had no time: tiers tracked accumulated movement and acts were drawn by weighted random. Four movements, named after the statement’s own four words, make time the main axis and movement merely an accelerator.') },
      { hash: '04730e1', day: '09-13', time: '20:00', text: bi(
        '把这条线上最硬的一条写成测试：到第四乐章它已经不像你，而它做的每一个动作仍然来自你此刻的动作。它要是自己动起来了，作者身份就完整地归了机器。',
        'The arc’s hardest rule becomes a test: by the fourth movement it no longer looks like you, and every action it takes still comes from what you are doing right now. If it ever moved on its own, the authorship would pass whole to the machine.') },
      { hash: '204b21e', day: '09-13', time: '20:07', text: bi(
        '描边翻成全局默认，把一份写到一半的材质设计的前提掀了。停下来重读一遍陈述，结论反过来更准：平涂加墨线本身就是第一乐章 —— 它开场是一张画。',
        'Turning the outline on by default pulled the ground out from under a half-written material design. Re-reading the statement turned the conclusion around and made it sharper: flat colour plus an ink line is the first movement. It opens as a drawing.') },
      { hash: '7df5c18', day: '09-13', time: '20:22', text: bi(
        '29 个物种逐条渲染复核。三条在运行时根本点不到 —— 而且不是报错，是静默换成另一个物种：帧上连名字都是别人的。',
        'All 29 species are re-rendered and checked one by one. Three cannot be reached at runtime at all — and not with an error: they are silently swapped for another species, down to the name printed on the frame.') },
      { hash: 'f826849', day: '09-13', time: '20:23', text: bi(
        '降级路径审计，20 条跑了 12 条。最糟的失败不是崩溃 —— 崩溃看得见，有人会去按重启；最糟的是它安静地降级着跑完一整晚。',
        'Every fallback path is audited; twelve of twenty were actually exercised. The worst failure is not a crash — a crash is visible and somebody restarts it. The worst is running the whole night quietly degraded.') },
      { hash: '86bc02a', day: '09-13', time: '20:28', text: bi(
        '第一次 30 分钟浸泡。判据是地板不是峰值：泄漏的签名是地板被抬高，而半小时后的地板和第一分钟逐字相同。',
        'The first thirty-minute soak. The criterion is the floor, not the peak: a leak announces itself by lifting the floor, and after half an hour the floor read exactly what it read in the first minute.') },
      { hash: '62b3c87', day: '09-13', time: '20:32', text: bi(
        '手和脚上的墨碎成了片。判据只有一句：会变粗的是线，碎成片的是坏的。没有一个几何标量分得开 —— 全身最小的件反而最干净 —— 所以它只能是一张看出来的表。',
        'The ink on hands and feet had shattered into flakes. One criterion settles it: a line that thickens is a line; a line that breaks into flakes is broken. No geometric scalar separates the two — the smallest part on the body is the cleanest — so it stays a list someone looked at.') },
    ],

    /** 互相纠正。四段式，全部真实，每件指到 commit */
    corrections: [
      {
        no: '01',
        refs: ['f720220'],
        title: bi('验收标准本身是错的', 'The acceptance criterion was the bug'),
        said: bi('任务卡 T-02 要求断言：抬左手 → handL 落在世界 +X。编排者写的。',
                 'Task card T-02 required an assertion: raise your left hand, handL lands at world +X. The orchestrator wrote it.'),
        against: bi('骨架线。它没有为了让测试变绿去改实现，而是停下来报上来。',
                    'The skeleton lane. It did not bend the implementation to turn the test green; it stopped and filed a report.'),
        because: bi('MediaPipe 的 left_* 指的是被摄者的左侧，正对相机时出现在图像右侧，镜像之后落在 −X。正确的不变式是 handR → +X。',
                    'MediaPipe’s left_* means the subject’s left, which faces the camera on the image’s right, and after mirroring lands at −X. The correct invariant is handR → +X.'),
        result: bi('改的是契约。docs/04 §1 补了一节把这条推导写死，免得下一个人再写反一次。',
                   'The contract moved. A new section in docs/04 §1 nails the derivation down so the next person cannot get it backwards.'),
      },
      {
        no: '02',
        refs: ['27f8843', '3b63973'],
        title: bi('升档脉冲从 +108% 改回 +8%', 'The tier-up pulse, from +108% back to +8%'),
        said: bi('舞台的前一版把升档做成 +108% 亮度加全屏叠加闪光，再加一圈地面冲击波环。',
                 'An earlier stage pass rendered the tier-up as +108% brightness plus a full-screen additive flash, ringed by a ground shockwave.'),
        against: bi('后一版推翻了它，四处修改各自给了理由。',
                    'The next pass overturned it — four reversals, each with its reason.'),
        because: bi('提曝光会把背景一起抬起来，读作相机闪光，而不是身体在发光；地面冲击波环是游戏 VFX，读作另一个门类。',
                    'Lifting exposure lifts the background with it, so it reads as a camera flash rather than a body lighting up. The shockwave ring is game VFX — it reads as a different medium altogether.'),
        result: bi('改回规格的 +8%，只动灯不动曝光，冲击波环删掉。实测身体像素线性亮度 +7.8%。',
                   'Back to the specified +8%, lights only and exposure untouched, ring gone. Measured: +7.8% linear luminance on body pixels.'),
      },
      {
        no: '03',
        refs: ['4576a8b', '9f9dd92'],
        title: bi('没有真人就不编数', 'No person, no numbers'),
        said: bi('任务卡 T-01 顺带要解两个未知：MediaPipe 的轴向，以及深度值能不能用。',
                 'Task card T-01 also asked for two unknowns to be closed: MediaPipe’s axis convention, and whether its depth is usable.'),
        against: bi('采集线拒绝回答，交了 partial。',
                    'The capture lane declined to answer and filed partial.'),
        because: bi('这台机器前面没有人能蹲下、能前后走一米。Chrome 的 fake camera 里没有人，MediaPipe 一个 landmark 都不输出。',
                    'There was nobody to squat, nobody to walk a metre toward the lens. Chrome’s fake camera contains no human, and MediaPipe emits not one landmark from it.'),
        result: bi('量它的工具交付了，判据写死在页面上（抖动 ≈ 量程就是深度不可用），结论那一栏空着。宁可交一个诚实的半成品。',
                   'The instrument shipped, the criterion is printed on the page — jitter ≈ range means depth is unusable — and the conclusion stayed blank. An honest fragment beats an invented whole.'),
      },
      {
        no: '04',
        refs: ['0869fc2', '0bbefa2'],
        title: bi('任务卡的前提是假的', 'The task card’s premises were false'),
        said: bi('给团块那条线的任务卡写着：读 docs/22，里面有可照抄的骨架和实测数字；再读 AGENTS.md 新加的两节。',
                 'The card for the metaball lane said: read docs/22, it has a skeleton you can copy and real measurements; then read the two new sections of AGENTS.md.'),
        against: bi('领卡的代理。',
                    'The agent holding the card.'),
        because: bi('docs/22 当时还是 untracked，而 worktree 是从提交分出去的 —— 它里面根本没有那个文件。那两节则在 docs/02，不在 AGENTS.md。',
                    'docs/22 was still untracked, and a worktree branches from a commit — the file simply was not there. Those two sections lived in docs/02, not AGENTS.md.'),
        result: bi('它如实报上来「这两个前提是假的，所有数字是我自己测的」，代价是白花一轮重新调研。规则写进 docs/15：任务卡引用的文件必须是已提交的文件。',
                   'It reported plainly — “both premises are false; every number here is mine” — at the cost of one wasted research round. The rule went into docs/15: a task card may only cite committed files.'),
      },
      {
        no: '05',
        refs: ['84f8510', 'a2127d8'],
        title: bi('代理纠正的是它自己', 'The agent that corrected itself'),
        said: bi('现场加固那条线整理提交时用了 git reset --soft main。',
                 'The venue-hardening lane tidied its commits with git reset --soft main.'),
        against: bi('它自己 —— 提交前看了一眼暂存区。',
                    'Itself — it looked at the staged diff before committing.'),
        because: bi('编排者在它工作期间往 main 落了新提交。于是它的暂存区一度显示：要删掉 bodyplan.ts，并从冻结契约里移除 bodyPlan 字段。',
                    'The orchestrator had landed a new commit on main while it worked. For a moment its index proposed deleting bodyplan.ts and stripping the bodyPlan field out of a frozen contract.'),
        result: bi('它没有提交那个状态，退回自己分支的起点重做再 rebase，并主动报上来。规则：用不动的 sha，不用会动的 main。',
                   'It never committed that state. It rebuilt from its branch’s own fixed starting sha, rebased, and reported the near-miss. Rule: reset onto a sha that does not move, never onto main.'),
      },
      {
        no: '06',
        refs: ['196f527', '05ffbb9'],
        title: bi('坏 anchor 上不再花 credits', 'No more credits on a bad anchor'),
        said: bi('素材线的任务是按每个主题的参考图生成那一整套部件。',
                 'The asset lane’s job was to generate a full set of parts per theme from that theme’s reference image.'),
        against: bi('素材线，在发现三个条目的参考图本身是碎片或多物体之后。',
                    'The asset lane itself, once it found three themes whose reference images were fragments or multi-object scenes.'),
        because: bi('image-to-3D 会忠实照抄「多物体」这件事。坏的上游会放大成一批坏的下游 —— 照着坏图再生成十五件垃圾交差，是有成本管线上最贵的做法。',
                    'Image-to-3D faithfully reproduces “several disconnected objects.” A bad input multiplies into a batch of bad outputs — and on a metered pipeline, shipping fifteen more failures is the most expensive possible move.'),
        result: bi('停下来问人。换一批随机种子重锚，并把这件事记在 RE_ANCHOR 里，而不是偷偷改 id 让它看起来没发生过。',
                   'It stopped and asked. The three were re-anchored with fresh seeds, recorded in RE_ANCHOR rather than quietly renamed so the failure would leave no trace.'),
      },
      {
        no: '07',
        refs: ['7df5c18', 'b6e6ee6'],
        title: bi('一个物种和它自己的说明书矛盾', 'A species that contradicted its own caption'),
        said: bi('花名册上有一条叫「场」，tagline 写着「身体消失，只剩运动」。',
                 'The roster carried a species called Field, captioned “the body disappears; only the movement is left”.'),
        against: bi('物种自查那条线 —— 它把 29 条逐条渲染出来，和各自声称的对照。',
                    'The species audit, which rendered all 29 entries one at a time and held each against what it declares.'),
        because: bi('它当时没有自己的身体方案，走的是默认刚体装配，向别的物种借了一整套四肢 —— 画面上它是一具机器人，而机器人正是那句 tagline 说它已经不是的东西。',
                    'It had no body plan of its own. It fell through to the default rigid assembly and wore a full set of limbs borrowed from other species — on screen it was a robot, which is precisely the thing its caption says it is no longer.'),
        result: bi('给它一片跟着活骨架走的点：1400 个点，每个点停在过去自己的那一刻。不是给它换一套更好的零件 —— 有零件这件事本身就是那个矛盾。',
                   'It was given a field of points locked to the live skeleton: 1,400 of them, each sitting at its own moment in the past. Not a better set of parts — having parts at all was the contradiction.'),
      },
      {
        no: '08',
        refs: ['7df5c18', '245b731'],
        title: bi('三个物种在运行时被静默换成另一个', 'Three species were silently swapped for another'),
        said: bi('花名册上 29 条，档案页、选择页、海报都按 29 条算。',
                 'The roster lists 29 entries, and the archive, the chooser and the poster all counted 29.'),
        against: bi('同一条自查线，在挨个渲染的时候发现三张帧长得一模一样。',
                    'The same audit, which noticed while rendering them one by one that three frames looked identical.'),
        because: bi('可选物种的名单是「索引里出现过的那些」。这三条一件自有件都没生成过，于是名单里没有它们，而那一行代码的另一个分支是随机挑一个 —— 不是报错，是换人：连画面上印的名字都是别人的。',
                    'The list of available species is “whichever ones appear in the index”. These three had never had a single part generated, so they were not in the list — and the other branch of that line picks one at random. Not an error: a substitution, down to the name printed on the frame.'),
        result: bi('修在源头，不是修那三条：缺件的表现应该是借件（沿 base 链，并且喊一声），不是换物种。一个故意留的空位现在看得见地缺席，而不是假装自己在场。',
                   'Fixed at the source rather than in the three entries: missing parts should show up as borrowing — down the base chain, with a warning — never as a different species. A deliberately empty slot is now visibly absent instead of quietly impersonating someone.'),
      },
    ],

    /** P11–P21。每条 = 规则 + 教会它的那件事 */
    principles: [
      { id: 'P11',
        title: bi('契约的错由契约持有者裁决，不在下游打补丁', 'A broken contract is fixed by its owner, never patched downstream'),
        story: bi('验收标准要求「抬左手 → handL 在 +X」，而实际镜像后落在 −X。领卡的人没有为了让测试变绿去改实现。',
                  'The criterion demanded “left hand → handL at +X”; mirroring actually puts it at −X. The lane holding the card refused to bend the code to make the test pass.'),
        rule: bi('发现契约有问题 → 停下来报告。不要为了通过验收去迁就一个错的规格。',
                 'Found a bad contract? Stop and report it. Do not accommodate a wrong spec just to clear acceptance.') },
      { id: 'P12',
        title: bi('坏的上游会放大成一批坏的下游', 'A bad input multiplies into a batch of bad outputs'),
        story: bi('素材线发现三个条目的参考图是碎片或多物体，停下来问人，而不是照着坏图再生成十五件垃圾交差。',
                  'Three reference images turned out to be fragments or multi-object scenes. The lane stopped and asked, instead of generating fifteen more failures to look productive.'),
        rule: bi('一个环节的产出要作为下一个环节的输入时，先验它。「先做完再说」在有成本的管线上是最贵的做法。',
                 'Validate an output before it becomes the next stage’s input. On a metered pipeline, “finish it first and see” is the most expensive strategy there is.') },
      { id: 'P13',
        title: bi('破坏性默认必须设计成安全的', 'Destructive defaults must be designed safe'),
        story: bi('定向规范化会把整个索引重写成点名的那几件。186 件变成 2 件，运行时直接变空场，而现象只是「应用好像坏了」。',
                  'A targeted normalize rewrote the whole index down to the items named. 186 parts became 2, the runtime went empty, and the only symptom was “the app seems broken.”'),
        rule: bi('「部分操作」的语义默认必须是合并，不是替换。一个操作如果可能删掉你没点名的东西，它的默认行为就是错的。',
                 'A partial operation must default to merge, not replace. If an operation can delete what you did not name, its default is wrong.') },
      { id: 'P14',
        title: bi('测量工具本身会骗人', 'The instrument lies too'),
        story: bi('每帧 await 渲染会把它塞进微任务队列，帧时间读数因此不准。这种问题留到现场调性能时极难查 —— 因为你信的那个数字本身是错的。',
                  'Awaiting the render every frame pushes it into the microtask queue and skews frame timing. Left for the venue, it is near-impossible to find, because the number you trust is the thing that is wrong.'),
        rule: bi('先确认测量是对的，再去优化被测的东西。',
                 'Establish that the measurement is right before optimising the thing it measures.') },
      { id: 'P15',
        title: bi('数据结论不要为了优雅变回公式', 'Do not trade a measured list for an elegant formula'),
        story: bi('那张「哪些槽位会照抄躯干轮廓」的表来自目检 186 件。曾想用长宽比 < 1.6 去推它，结果把 foot 漏掉 —— 而 foot 恰恰最严重。',
                  'The list of slots that copy the torso silhouette came from eyeballing 186 parts. An attempt to derive it from “aspect ratio < 1.6” dropped foot, the very worst case.'),
        rule: bi('目检出来的列表就让它是列表。为了少几行代码把它换成一个公式，是在用优雅换正确。',
                 'Let a hand-checked list stay a list. Collapsing it into a formula to save a few lines trades correctness for elegance.') },
      { id: 'P16',
        title: bi('扩展点必须自带故障隔离', 'An extension point ships with its own blast door'),
        story: bi('玩法的 Director 规定：一个 Act 连续 3 次抛异常就被永久禁用并回落到基线。',
                  'The act Director has a rule: three consecutive throws and an act is disabled for the session, falling back to the baseline.'),
        rule: bi('让「随便试新玩法」变安全，是那块空间能成立的前提。一个会把整件作品带走的扩展点，没有人敢用第二次。',
                 'Cheap experiments only exist where failure is survivable. An extension point that can take the whole work down gets used exactly once.') },
      { id: 'P17',
        title: bi('没有真人就不编数', 'No person, no numbers'),
        story: bi('采集线写完了整条链，却拒绝回答轴向问题 —— 这台机器上没有人能站到摄像头前蹲一下。它交了 partial，并说明「十分钟就能解，但需要一个有身体的人」。',
                  'The capture lane finished the whole chain and still refused to answer the axis question: nobody could stand in front of the camera and squat. It filed partial, noting it was ten minutes of work away — pending one person with a body.'),
        rule: bi('宁可交一个诚实的半成品，不要交一个编出来的完成品。',
                 'Ship an honest fragment rather than an invented whole.') },
      { id: 'P18',
        title: bi('合成数据要在使用路径上吼', 'Synthetic data must shout on the path that uses it'),
        story: bi('项目里有一份程序生成的占位姿态数据。文件里有注记，但只有打开文件才看得到。于是在加载路径上补了一条 console.warn。',
                  'A procedurally generated placeholder pose file carried a note inside it — visible only if you opened the file. A console.warn went onto the load path instead.'),
        rule: bi('一个陷阱如果只在文档里标注，它就还是个陷阱。要让它在被踩到的那一刻出声。',
                 'A trap documented is still a trap. It has to make noise at the moment someone steps in it.') },
      { id: 'P19',
        title: bi('并行度要留余量，长任务要能断点续跑', 'Leave headroom in parallelism; make long jobs resumable'),
        story: bi('一次开了九条线，撞上会话限额，九条同时被中断。活下来的是已经提交的和写进文件的；死掉的是还在内存里的。',
                  'Nine lanes were running when the session limit hit, and all nine died at once. What survived was committed or written to disk; what was still in memory was gone.'),
        rule: bi('每多一条线，「全部一起失败」的概率就高一分。长任务要能从中断处继续 —— 幂等台账救了素材线，因为它重跑时只重试失败项。',
                 'Each added lane raises the odds of losing all of them together. Long jobs must resume from where they stopped — an idempotent ledger saved the asset lane, because a rerun only retries what failed.') },
      { id: 'P20',
        title: bi('编排者自己的手也会滑', 'The orchestrator’s hand slips too'),
        story: bi('按时间顺序：git add -A 把五个 worktree 当 submodule 加进索引；给出的等待命令匹配到了等待自己的那条 shell，挂住两个代理半小时；和素材线共用主目录撞了 git index。',
                  'In order: git add -A staged five worktrees as submodules; a wait-loop command matched the very shell doing the waiting and hung two agents for half an hour; sharing the main directory with the asset lane collided on the git index.'),
        rule: bi('编排者的错会被乘以并行度。所以编排者的每一条指令，在发出去之前都该按「它会被执行十次」来检查。',
                 'An orchestrator’s mistakes are multiplied by the parallelism. Check every instruction as if it will be executed ten times, because it will.') },
      { id: 'P21',
        title: bi('仪表会朝着讨好你的方向说谎', 'Your instruments lie in the direction that flatters you'),
        story: bi('同一种失败换了五张脸：号称「算出来从不手打」的海报数字，算过一次就冻在了 191；截图前那个「暂停」把每帧的 dt 夹在下限上，于是一千个虚拟帧照跑；等一行 ALLDONE 等了九分钟，而二十四张图早就在盘上了；取件来源钉在分支上，网格在脚下换掉而检查照样 0 错；帧时间显示 2.42 毫秒 —— 那一刻是 16 fps。',
                  'One failure wearing five faces: poster numbers “computed, never typed” that were computed once and froze at 191; a pause button that clamped dt to its floor, so a thousand virtual frames ran before the screenshot; nine minutes spent waiting for a line of output while all twenty-four images already sat on disk; harvest sources pinned to a branch, so the mesh could change underfoot with every check still green; a frame-time readout of 2.42 ms — taken at 16 fps.'),
        rule: bi('问一句：假如这件事真的坏了，这个仪表会显示什么？答案要是「和现在一模一样」，它就不是仪表。推导出来的数只在推导的那一刻为真 —— 要么在用的时候重新推一遍，要么把它是从哪儿推出来的一起写上。',
                 'Ask what the instrument would show if the thing were broken. If the answer is “exactly what it shows now”, it is not an instrument. A derived number is only true at the moment it was derived: either re-derive it where it is used, or stamp it with what it came from.') },
    ],

    /** 挖不到证据的事。列出来，而不是编一条填上 */
    gaps: [
      bi('那次「一次开了九条线」被限额一起打断 —— git 里只留下这句话，没有留下它们是哪九条、各自做到了哪一步。',
         'The nine lanes that died together at the session limit: git records that it happened, not which nine they were or how far each had got.'),
      bi('每条线各自跑了多久、花了多少 token。提交时间只告诉我们它什么时候落地，不告诉我们它什么时候开始。',
         'How long each lane ran, and at what cost. Commit times say when work landed, never when it started.'),
      bi('代理报上来又被驳回的提议。仓库里留下的是被采纳的那一半 —— 没有被采纳的那一半不在 git 里。',
         'The proposals that were reported and then declined. The repository keeps the half that was accepted; the other half never entered git.'),
      bi('作品成立与否的那一层：像不像、五秒之内认不认得出那是自己。没有观众站在它前面过。',
         'The layer that decides whether the work works at all: does it look like you, do you recognise yourself inside five seconds. No visitor has stood in front of it yet.'),
    ],

    footer: bi(
      '人类署名 2 人；黑客松那 149 条提交里有 122 条写着代理的共同署名。每一条都写着它是谁和谁一起做的。',
      'Two human authors; of the hackathon’s 149 commits, 122 carry an agent’s co-author line. Every one records who made it with whom.',
    ),
  },
} as const;
