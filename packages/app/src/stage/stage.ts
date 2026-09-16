/**
 * 舞台：相机 / 灯光 / 地面 / 后期 / 空场状态。**这里决定这件作品像不像作品。**
 *
 * 四条它必须做到的事（docs/00 §6.3、docs/05 §3 §5、docs/12 §6）：
 *
 * 1. **等身。** 相机不是"摆得好看"：机位在观众的眼高（1.58m）、站在 2.8m 外、**水平**
 *    看出去，用**镜头上下平移**（shift lens）把画面压到含脚含头，而不是低头去看。
 *    低头会让竖线向内收，身体立刻变成"被俯视的模型"，1:1 的读数就没了 ——
 *    而等身是这类作品的全部魔法。
 *    画面框住多大一块世界由 `framing.ts` 按**身体实际的包围盒**算（docs/18 之后
 *    身体不一定是人形：四足是横的矮的）。那里写了"有限插值"这个取舍的来龙去脉。
 * 2. **影子必须落在地面上。** 真阴影贴图（身体形状）+ 着色器里的软接触阴影（贴地那一圈）。
 *    地面圆盘的远端**颜色正好等于背景地平线色**，所以看不到盘子的边 —— 地面和背景连续。
 * 3. **空场不黑屏。** IDLE 时地面上有一团缓慢呼吸的粒子；有人进场时它聚拢成最原始形态。
 * 4. **升档有视觉事件。** `stage.pulse(tier)`：600ms 内全身亮度 +8% + 时间轻微停滞
 *    （docs/23 §S5 把这两个数写死了）。
 *
 * 主题微调（每个主题一套灯光/背景/后期）住在 `look.ts`，是**纯函数**、有单元测试；
 * 这里只负责把它插到 three 的对象上。23 个 roster 条目没有 23 个 if。
 *
 * ── 接入方式（给 main.ts 的一句话）──────────────────────────────────────────
 * 后期需要 `RenderPipeline`，而它**必须替代** `renderer.render(scene, camera)`：
 *
 *     stage.render(renderer);            // 而不是 renderer.render(stage.scene, stage.camera)
 *
 * 不改也能跑 —— 那就等于全程 `?nopost=1`（灯光/阴影/地面/粒子/脉冲都还在），
 * 只是没有 bloom/DOF/AO。`?nopost=1` 也正是排查性能时要的那条路径。
 */
import * as THREE from 'three/webgpu';
// 只为类型：TSL 的运算符扩展（`.mul()` / `.max()`）挂在 `Node<T>` 上，
// 而 `screenUV.sub(...)` 这类表达式的具体类型是推不出来的实现细节 —— 和 post.ts 同一个理由
import type Node from 'three/src/nodes/core/Node.js';
import {
  clamp, densityFogFactor, float, fog, mix, positionWorld, pow, screenUV, sin, smoothstep,
  uniform, vec2,
} from 'three/tsl';
import type {
  MaterialDef, MotionFeatures, PartLibraryIndex, Presence, Skeleton, ThemeDef,
} from '../../../core/src/types.ts';
import { SKELETON, STAGE } from '../../../core/src/tuning.ts';
import { readFlags } from '../shell/kiosk.ts';
import { createBreathField, type BreathField } from './particles.ts';
import { createPost, POST_DEFAULTS, type PostChain } from './post.ts';
import {
  applyArc, ARC_OFF, arcWeights, deriveLook, lerpLook, NEUTRAL_LOOK, stageInk,
  type ArcWeights, type LookProfile, type RGB,
} from './look.ts';
import {
  boundsOfPlan, boundsOfSkeleton, contactPoints, lerpBounds, shotCamera, DEFAULT_BOUNDS,
  type BodyBounds,
} from './framing.ts';
import { stepShot, SHOT_REST, type Shot, type ShotState } from '../../../core/src/autoframe.ts';
import { applyScene, isSceneId, pickScene, SCENES, type SceneId } from './scenes.ts';
import { createInkSampler } from './ink-sampler.ts';

/**
 * ⚠️ 这些数**本该住在 `tuning.ts`**（P0：现场要调的旋钮只有一个文件）。
 * 但 `tuning.ts` 是冻结契约，T-09 不自行修改 —— 已在交付报告里提"需要变更契约"。
 * 在它搬过去之前，这里是唯一一份。
 */


export interface Stage {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  update(p: Presence, m: MotionFeatures | null, dt: number): void;
  resize(w: number, h: number): void;
  dispose(): void;

  // ── 以下是 T-09 新增的能力（只增不改，见 P0） ──
  /**
   * 走后期的渲染入口。**main.ts 用它替代 `renderer.render(scene, camera)`。**
   * 没接也不会坏：不调用就是直出（= `?nopost=1`）。
   */
  render(renderer: THREE.Renderer): void;
  /** 换主题的灯光/背景/后期微调。传 id 需要同时给 index 才查得到 palette */
  setTheme(theme: ThemeDef | string | null, index?: PartLibraryIndex | null): void;
  /**
   * 升档的视觉事件（docs/23 §S5）：600ms 内全身亮度 +8%，同时时间轻微停滞。
   * **只管舞台这一半。** 停滞要作用到身体上，收口的人把 `stage.timeScale` 乘进
   * 传给 creature / act 的 dt 里即可 —— 不乘也不会坏，只是身体不一起停。
   */
  pulse(tier: number): void;
  /** 当前的时间缩放（升档停滞期间 < 1，其余时候正好 1） */
  readonly timeScale: number;
  /** 当前脉冲给全身加了多少亮度（0 = 没在脉冲；峰值 ≈ 0.08，即 docs/23 §S5 的 +8%） */
  readonly pulseGain: number;
  /**
   * 告诉舞台"身体现在有多大、在哪"，取景据此走（docs/18 之后不能再假设人形）。
   * 传**重映射之后**的那副骨架（就是喂给 creature.pose() 的那副）；每帧调都行，
   * 内部只量 34 个端点并平滑过渡。传 null = 没有可信骨架，保持当前取景。
   *
   * 不调也不会出画：换主题时舞台已经按该物种的 `bodyPlan` 摆好了取景，
   * 这个方法是用真人的高矮胖瘦去**细化**它。
   */
  frame(skeleton: Skeleton | null): void;
  /**
   * 景别（docs/49 §落地）：全景（等身）或中景（上半身）。**每帧调都行**，同一个值不重启任何东西。
   * 走多久、跟不跟随由舞台自己按时间推（`core/src/autoframe.ts` 的 `stepShot`），不靠 CSS 或动画事件。
   * @param opts.reduced `prefers-reduced-motion`：0.15 秒到位，中景不跟随
   * @param opts.hold 帧循环在降级：跟随冻结，景别照常按时间走完（docs/49 §6.3：不再直接切）
   */
  setShot(shot: Shot, opts?: { reduced?: boolean; hold?: boolean }): void;
  /**
   * 台上一组身体占多宽、最高的那一具多高（米）。0, 0 = 单人（缺省）。
   * 多人时取景的包围盒至少是这么宽、这么高（docs/50 §4.3），相机距离照旧不动 ——
   * 只按主身体取景的话，主身体一蹲下，站着的伴随身体就被切出画面。
   */
  setGroup(width: number, height: number): void;
  /** 景别此刻的进度（0 全景 … 1 中景，线性）与跟随偏移（米）。HUD / 截图取证用 */
  readonly shot: Readonly<ShotState>;
  /**
   * 身体此刻还能横向走多远而不出画（米，`framing.ts` 的 `lateralRoom()`）。随景别连续变化；
   * 帧循环把它递给 `stepLateral()`，身体的横向根偏移夹在它里面（docs/49 §6.3 二）。
   */
  readonly lateralRoom: number;
  /** 当前取景依据的包围盒（HUD / 截图取证用） */
  readonly bounds: BodyBounds;
  /**
   * 永久开关后期（控件条 / 现场排查 / 降级阶梯）。
   * 关掉会拆链并释放显存；调速器的短暂让路必须走 `setPostSuspended`，不能冒充用户关掉。
   */
  setPost(on: boolean): void;
  /**
   * 调速器临时绕过后期，但保留已经建好的链。恢复时继续用同一个 PassNode / RenderTarget，
   * 不在帧循环里重建；永久关闭仍由 `setPost(false)` 负责释放。
   */
  setPostSuspended(suspended: boolean): void;
  readonly post: boolean;
  /**
   * 在空闲里把**直出**那条路（画布、不走后期）编译一遍。后期开着时直出从来没被画过，
   * 放下后期那一帧才现编译 —— 实测 273ms + 367ms（docs/48 §10）。什么时候调由 `warm-plan.ts` 决定。
   * 永不 reject：失败返回 false，拨开关时照旧现编译。
   */
  warmDirect(renderer: THREE.Renderer): Promise<boolean>;
  /**
   * 角上字的墨色采样开 / 停（2Hz GPU 读回，`ink-sampler.ts`）。
   * 帧调速器放下的第一级就是它（docs/48 §4）：观众看不见它停了。
   */
  setInk(on: boolean): void;
  /** 当前生效的 look，给 HUD 和 dev 页面看 */
  readonly look: LookProfile;

  /**
   * 弧线进度 `0..1`（docs/40 的四个乐章 → 灯，docs/41）。**每帧调都行**。
   *
   * 它盖在「主题 → 场景」之上，是同一套 `LookProfile` 的第三层，
   * 只缩放已有字段（`applyArc`）—— 不是第二套颜色/灯光系统。
   * 从来没被调过的时候这一层不存在，灯和今天完全一样。
   */
  setArc(progress: number): void;
  readonly arc: number;

  /**
   * 换场景（整个视觉世界：天幕 / 地面 / 布光 / 雾 / 后期 / 粒子）。
   * 过渡是 `STAGE.sceneFade` 秒的交叉淡入，**不是硬切** —— 走的是换主题那条通道。
   * 传 null = 交回给"按物种自动挑"。
   */
  setScene(id: SceneId | string | null): void;
  /** 当前场景 id。（叫 `sceneId` 不叫 `scene`：`stage.scene` 已经是 three 的 Scene） */
  readonly sceneId: SceneId;
}

export interface StageOptions {
  /** 主题。给字符串就需要 `index` 才能查到 palette */
  theme?: ThemeDef | string | null;
  index?: PartLibraryIndex | null;
  /** 覆盖 `?nopost=` 的判断 */
  post?: boolean;
  /** parts.json 的基址，默认 `/parts/`。只在没人调 setTheme 时用来自举主题 */
  baseUrl?: string;
  /** 覆盖 URL flags（dev 页面用） */
  search?: string;
  /** 场景。缺省先看 `?scene=`，再按物种自动挑（`scenes.ts` 的 pickScene） */
  scene?: SceneId | string | null;
}

const toColor = (c: RGB): THREE.Color =>
  new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);

const setColor = (target: THREE.Color, c: RGB): void => {
  target.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);
};

/**
 * 着色器里的颜色一律走 `Vector3`，不走 `Color`。两个理由，踩过才知道：
 *  1. `uniform(Color)` 出来的是 `Node<'color'>`，在 TSL 的类型里**不是** vec3，
 *     喂给 `mix()` / `vec3()` 会被拒（就是 T-09 中断时那七个红点里的六个）。
 *  2. `Color` 的赋值会牵扯色彩空间转换，而 `look.ts` 给的已经是**线性** RGB，
 *     再转一次就偏色了。Vector3 是纯数字，没有这层魔法。
 */
const toVec3 = (c: RGB): THREE.Vector3 => new THREE.Vector3(c[0], c[1], c[2]);

const setVec3 = (target: THREE.Vector3, c: RGB): void => { target.set(c[0], c[1], c[2]); };

/** 帧率无关的 EMA（docs/05 §2 的同一条约定：a = 1 - exp(-dt/τ)） */
const ease = (cur: number, target: number, dt: number, tau: number): number =>
  cur + (target - cur) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * 升档脉冲的包络：age（秒）→ 0..1。快起慢落。
 * 用**显式时长**而不是指数衰减，因为 docs/23 §S5 规定的是"600ms"这个数，
 * 指数衰减只有时间常数、没有终点，说不清什么时候算结束。
 */
function pulseEnvelope(age: number): number {
  if (age <= 0 || age >= STAGE.pulseDuration) return 0;
  if (age < STAGE.pulseAttack) return age / STAGE.pulseAttack;
  const k = (age - STAGE.pulseAttack) / (STAGE.pulseDuration - STAGE.pulseAttack);
  return (1 - k) * (1 - k);        // 二次落回：尾巴够长，能被看见，但不拖成一段动画
}

function dirLight(dir: readonly [number, number, number], aim: THREE.Vector3): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(0xffffff, 1);
  const v = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize().multiplyScalar(STAGE.lightDistance);
  light.position.copy(aim).add(v);
  light.target.position.copy(aim);
  return light;
}

export function createStage(opt: StageOptions = {}): Stage {
  /** 多人时整组身体的横向跨度、最高那一具的高度（米）。0 = 单人 */
  let groupWidth = 0;
  let groupHeight = 0;
  const flags = readFlags(opt.search ?? (typeof location !== 'undefined' ? location.search : ''));
  const baseUrl = (opt.baseUrl ?? '/parts/').replace(/\/?$/, '/');
  let postEnabled = opt.post ?? !flags.nopost;

  const scene = new THREE.Scene();
  const aim = new THREE.Vector3(0, STAGE.aimHeight, 0);
  // 帧循环里不 new（P5）。它只在 placeLights 里当草稿纸用
  const tmpDir = new THREE.Vector3();

  // ── 相机：水平 + 镜头平移，见文件头 §1 ──────────────────────────────────
  const camera = new THREE.PerspectiveCamera(45, 1, STAGE.near, STAGE.far);
  camera.position.set(0, STAGE.eyeHeight, STAGE.viewDistance);
  camera.lookAt(0, STAGE.eyeHeight, 0);          // **水平**。不要 lookAt 胸口
  let viewW = 1280;
  let viewH = 720;

  // ── look（主题微调）────────────────────────────────────────────────────
  /**
   * 两个 look，不是一个：
   *   `baseLook` = 主题（它是什么颜色）→ 场景（它站在什么地方），过渡在这一层上插值
   *   `look`     = 再盖上弧线（这是第几分钟），**渲染读的是它**
   *
   * 分成两个的唯一理由：弧线每帧都在动，而换主题的交叉淡入是从**上一个 baseLook**
   * 起步的。合成一个变量的话，换场景那一刻会把当时的弧线偏移一起冻进起点，
   * 然后再叠一次 —— 第 IV 乐章换场景会突然暗一档，而且不会自己恢复。
   */
  let baseLook: LookProfile = NEUTRAL_LOOK;
  let look: LookProfile = NEUTRAL_LOOK;
  let lookFrom: LookProfile = NEUTRAL_LOOK;
  let lookTo: LookProfile = NEUTRAL_LOOK;
  let lookMix = 1;
  /** 弧线进度与它此刻的四个份量。没有人调过 `setArc()` 时是 `ARC_OFF`，这一层等于不存在 */
  let arc = 0;
  let arcW: ArcWeights = ARC_OFF;
  let themeSet = false;

  // ── 灯 ────────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(hemi);

  const key = dirLight(STAGE.keyDir, aim);
  key.castShadow = true;
  key.shadow.mapSize.set(STAGE.shadowMapSize, STAGE.shadowMapSize);
  key.shadow.bias = STAGE.shadowBias;
  key.shadow.normalBias = STAGE.shadowNormalBias;
  {
    const cam = key.shadow.camera;
    cam.left = -STAGE.shadowExtent;
    cam.right = STAGE.shadowExtent;
    cam.top = STAGE.shadowExtent * 1.35;
    cam.bottom = -STAGE.shadowExtent * 0.5;
    cam.near = 0.5;
    cam.far = STAGE.lightDistance * 2.4;
    cam.updateProjectionMatrix();
  }
  scene.add(key, key.target);

  const fill = dirLight(STAGE.fillDir, aim);
  scene.add(fill, fill.target);

  const rim = dirLight(STAGE.rimDir, aim);
  scene.add(rim, rim.target);

  // ── 天幕：一个**屏幕空间**的函数，不是一个几何体 ──────────────────────────
  /**
   * 第一轮的失败是可以量的：`scratch/evidence/stage-before-idle.png` 的第 240→249 行，
   * 整行平均亮度 9 个像素内跳了 **+5.6/255**，而上半屏总共才有 4.2/255 的渐变 ——
   * 「一条硬地平线切开两片死灰」。
   *
   * 老做法是"让地面远端的颜色**正好等于**背景布的颜色"。它在纸面上成立，
   * 在管线里不成立：地面是 `MeshPhysical` 的 emissive，背景布是 `MeshBasic` 的 color，
   * 两条着色路径不保证给出同一个数值。**任何"两个材质要输出同一个颜色"的设计
   * 都会在某个 three 版本上裂开。**
   *
   * 所以改成：天幕是一个函数 `skyAt(uv)`，
   *  - 背景布直接用它上色；
   *  - 场景雾的**雾色**也用它（`fog(color, factor)` 的 color 可以是节点）。
   * 于是地面不是"淡成一个正好相等的颜色"，而是**被雾化进天幕本身**。
   * 同一个表达式，同一个输出阶段，**结构上不可能出现接缝**。
   *
   * 天幕的形状也换了：不是上下分色，是**身体背后的一团晕**（cyclorama 的做法，
   * docs/28 §2）。横向的明暗分界线才是"地平线"的来源；一团圆的晕没有分界线，
   * 而且它自带纵深和一个视觉重心 —— 正好落在身体背后。
   */
  const uSkyTop = uniform(toVec3(look.skyTop));
  const uSkyGlow = uniform(toVec3(look.skyGlow));
  /** (x, y) = 晕心的 screenUV（y=0 在下）；z = 半径（× 画面高度） */
  const uGlow = uniform(new THREE.Vector3(0.5, 0.5, 0.6));
  const uGlowSoft = uniform(1);
  /** 画面宽高比。不修正的话晕在 16:9 上会被拉成一条横的椭圆 —— 又是一条地平线 */
  const uAspect = uniform(16 / 9);
  /** 地平线在屏幕上的高度（screenUV.y）。地面镜射天幕时绕它翻折 */
  const uHorizonY = uniform(0.5);
  const uFogDensity = uniform(look.fogDensity);

  const skyAt = (uv: Node<'vec2'>): Node<'vec3'> => {
    // 半径**手写**，不走 `vec2(...).length()`：后者在这条链上量出来的不是这两个分量的长度
    // （r=0.4 时整片天幕是黑的，r=6 时全白，中间没有可解释的过渡）。
    // dx/dy 各自平方再开方是同一件事，而且没有歧义。
    const dx = uv.x.sub(uGlow.x).mul(uAspect);      // 画面是宽的，晕要圆就得先按宽高比压 x
    const dy = uv.y.sub(uGlow.y);
    const r = dx.mul(dx).add(dy.mul(dy)).sqrt().div(uGlow.z.max(0.02));
    const halo = pow(clamp(float(1).sub(r), 0, 1), uGlowSoft);
    return mix(uSkyTop, uSkyGlow, halo) as unknown as Node<'vec3'>;
  };
  const skyNode = skyAt(screenUV as unknown as Node<'vec2'>);

  // 雾是"地面化进天幕"的唯一机制。密度由场景给，上限在 tuning（超了会把身体也吃掉）
  scene.fogNode = fog(skyNode, densityFogFactor(uFogDensity)) as unknown as THREE.Scene['fogNode'];

  // ── 地面 ──────────────────────────────────────────────────────────────
  const uGroundNear = uniform(toVec3(look.groundNear));
  const uContact = uniform(look.contactStrength);
  const uContactR = uniform(look.contactRadius);
  /** 大而淡那一摊的中心（世界 xz）。跟着身体走，不再钉死在原点 */
  const uContactAt = uniform(new THREE.Vector2(0, 0));
  const uCore = uniform(look.contactCore);
  const uCoreR = uniform(look.contactCoreRadius);
  const uReflect = uniform(look.groundReflect);
  /**
   * 倒影的涟漪幅度。**这是"夜潮"那套唯一让人认出是水的东西**：
   * 一张不动的镜面读作"抛光地板"，动起来才读作"水"。
   * 幅度是屏幕空间的（0.006 ≈ 1600 宽上的 10px），因为倒影本身就是屏幕空间采的。
   */
  const uRipple = uniform(look.groundRipple);
  const uTime = uniform(0);
  const uGlossNear = uniform(look.groundGlossNear);
  const uGlossFar = uniform(look.groundGlossFar);

  /**
   * 落地点。**这是"人浮在空中"那一条的修法。**
   * 真阴影贴图的半影 + `normalBias` 一起把脚底那一圈最该黑的地方顶开了，
   * 于是影子在两米外很清楚，在脚下反而没有 —— 人就飘起来了。
   * 每个点是 (x, z, 离地高度)；抬起来的脚不该还拖着一摊黑影，所以半径随高度收到 0。
   */
  const uFeet = Array.from({ length: STAGE.contactPoints }, () =>
    uniform(new THREE.Vector3(0, 0, 99)));

  const groundDist = positionWorld.xz.length();
  const farMix = smoothstep(float(STAGE.groundFadeStart), float(STAGE.groundFadeEnd), groundDist);

  // 大而淡的一摊：读作"这里有东西挡住了环境光"
  const broadD = positionWorld.xz.sub(uContactAt).length();
  const broad = float(1).sub(smoothstep(float(0), uContactR, broadD));
  // 脚下紧的一圈：读作"它**踩在**地上"
  let core: Node<'float'> = float(0) as unknown as Node<'float'>;
  for (const f of uFeet) {
    const d = positionWorld.xz.sub(vec2(f.x, f.y)).length();
    // 抬到 contactLiftRange 就把半径收成 0（下限 1mm，免得 smoothstep 两端相等）
    const r = uCoreR
      .mul(float(1).sub(smoothstep(float(0), float(STAGE.contactLiftRange), f.z)))
      .max(float(0.001));
    // 从 0 开始衰减（不是从 r·0.2 开始）并再平方一次：
    // 硬边的圆斑读作"地上有个洞"，柔和的才读作"这里压着一只脚"
    const w = float(1).sub(smoothstep(float(0), r, d));
    core = core.max(w.mul(w)) as unknown as Node<'float'>;
  }
  const occl = clamp(uContact.mul(broad).add(uCore.mul(core)), 0, 1);
  const contact = float(1).sub(occl);

  // 用 Physical 而不是 Standard，只为了一个字段：`specularIntensityNode`。
  // 地面在远端是**掠射**的，菲涅耳会把高光推到接近全反射；湿地面（tide）尤其严重。
  // 把远端的高光强度按 farMix 收到 0，远处就只剩雾。
  const groundMat = new THREE.MeshPhysicalNodeMaterial();
  groundMat.specularIntensityNode = float(1).sub(farMix);
  groundMat.colorNode = uGroundNear.mul(contact);
  /**
   * 地面镜射**天幕**（不是身体）：把天幕绕地平线翻折再采一次。
   * 为什么不做真的平面反射：那要把整个场景再渲一遍，draw 17 → ~35，
   * 而 `BUDGET.maxDrawCalls` 是 40 —— P5 说超了就是 bug。屏幕空间反射（SSR）
   * 则会在 `?nopost=1` 时整条消失，那就不是"降级"，是**构图变了**。
   * 折中的假反射（一点点模糊的倒影）是评语里说的"最尴尬的中间态"，所以：
   * **要么映天幕（真实的、免费的），要么 `groundReflect = 0` 彻底不映。**
   * 五套场景里只有 tide / backlit 是非零的。
   */
  // 两列不同频率、不同方向的波。同频会变成搓衣板，差得远才像水面
  const wave = sin(positionWorld.x.mul(2.7).add(uTime.mul(0.75)))
    .add(sin(positionWorld.z.mul(1.9).sub(uTime.mul(0.52))))
    .mul(uRipple);
  const mirrored = vec2(
    screenUV.x.add(wave.mul(0.6)),
    uHorizonY.mul(2).sub(screenUV.y).add(wave),
  ) as unknown as Node<'vec2'>;
  // 掠射项：正下方（脚边）几乎看不到反射，往远处才越来越像镜子 ——
  // 这是菲涅耳的真实行为，也正好让倒影从身体脚下**长出去**，而不是糊在脚上
  const grazing = smoothstep(float(0.15), float(3.5), groundDist);
  groundMat.emissiveNode = skyAt(mirrored).mul(uReflect).mul(grazing).mul(contact);
  groundMat.roughnessNode = mix(uGlossNear, uGlossFar, smoothstep(float(0), float(6), groundDist));
  groundMat.metalnessNode = float(0);
  const groundGeo = new THREE.CircleGeometry(STAGE.groundRadius, 128);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.name = 'stage-ground';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.castShadow = false;
  scene.add(ground);

  // ── 背景布：朝内的大圆筒，直接用天幕函数上色 ────────────────────────────
  // 它已经不负责"和地面对色"了（那件事交给了雾），只负责一件事：
  // 相机转到哪儿都有东西挡着，不会露出 `scene.background` 那条路径。
  const backdropMat = new THREE.MeshBasicNodeMaterial();
  backdropMat.colorNode = skyNode;
  backdropMat.side = THREE.BackSide;
  backdropMat.fog = false;          // 它**就是**雾色，再雾一次没有意义
  const backdropGeo = new THREE.CylinderGeometry(
    STAGE.backdropRadius, STAGE.backdropRadius, STAGE.backdropHeight, 64, 1, true,
  );
  const backdrop = new THREE.Mesh(backdropGeo, backdropMat);
  backdrop.name = 'stage-backdrop';
  backdrop.position.y = STAGE.backdropHeight / 2 - 20;   // 往下埋一段，低头也看不到筒底
  backdrop.castShadow = false;
  backdrop.receiveShadow = false;
  scene.add(backdrop);
  // 背景布万一没画上也不能是黑的（P3：观众永远不该看见"出错了"）
  scene.background = toColor(look.skyGlow);

  // ── 空场的呼吸粒子（docs/05 §5）────────────────────────────────────────
  const field: BreathField = createBreathField({
    count: STAGE.particleCount,
    seed: STAGE.particleSeed,
    radius: STAGE.particleRadius,
  });
  field.setLook(look.particle, look.particleGain, look.particleDrift);
  scene.add(field.object);

  // ── 状态 ──────────────────────────────────────────────────────────────
  let renderer: THREE.Renderer | null = null;
  let post: PostChain | null = null;
  let postFailed = false;
  /** 调速器的临时状态，和用户 / 降级阶梯拥有的 `postEnabled` 正交。 */
  let postSuspended = false;
  let renderedViaStage = false;
  let warnedWiring = false;
  let frames = 0;

  // ── 取景（framing.ts）：当前用的盒子 + 想去的盒子，之间是时间常数 framingTau ──
  let bounds: BodyBounds = { ...DEFAULT_BOUNDS };
  let boundsTarget: BodyBounds = { ...DEFAULT_BOUNDS };
  let framingSettled = true;

  // ── 景别（docs/49 §落地）：全景 ↔ 中景，加中景里的小范围跟随 ──
  let shotWant: Shot = 'full';
  let shotReduced = false;
  let shotHold = false;
  let shotState: ShotState = SHOT_REST;
  /** 中景按身高取景；身高来自骨架（上半身模式下是站姿身高，`core/src/leghold.ts`），带 framingTau 缓动 */
  let bodyH = DEFAULT_BOUNDS.height + 0.14;
  let bodyHTarget = bodyH;
  /** 中景跟随的目标偏移（米）：x = 头胸的横向位置，y = 颅顶低于站姿身高多少（前倾 / 塌腰为负） */
  let shotOffset: { x: number; y: number } | null = null;
  /** 横向余量（米），每次 fitCamera 重算 */
  let lateralRoomM = 0;
  /** 身体骨盆的横向位置（米，含横向根偏移）与天幕的晕上一次按它算时的值 */
  let bodyX = 0;
  let glowBodyX = 0;

  let aliveMix = 0;
  let gather = 0;
  let particleFade = 1;
  /** 升档事件已经走了多久（秒）。`Infinity` = 没有正在进行的事件 */
  let pulseAge = Infinity;
  let pulseAmp = 0;
  /** 这一帧脉冲加了多少亮度（0..pulseAmp） */
  let pulse = 0;
  let timeScale = 1;
  let swayT = 0;

  // ── 场景 ──────────────────────────────────────────────────────────────
  /** `?scene=` 或调用方点名的那一套；null = 交给 `pickScene` 按物种挑 */
  let sceneForced: SceneId | null =
    (isSceneId(opt.scene) ? opt.scene : null) ?? (isSceneId(flags.scene) ? flags.scene : null);
  let sceneId: SceneId = sceneForced ?? 'void';
  /** 当前主题，换场景时要拿它重算一次 look */
  let curTheme: ThemeDef | null = null;
  let curMaterials: readonly MaterialDef[] = [];
  /** 这一次过渡走多久（秒）。换场景比换主题慢：整个世界换了，太快像切台 */
  let lookFade = 0.7;

  /**
   * 借用渲染器：阴影开关、色调映射、曝光都是"这件作品长什么样"的一部分，
   * 但它们住在 renderer 上，而 renderer 归 main.ts 管。
   * three 会把 renderer 传进 `scene.onBeforeRender`，我们在第一帧接住它。
   * 这样 main.ts 一行都不用改，灯光/阴影就是对的。
   */
  function adopt(r: THREE.Renderer): void {
    if (renderer === r) return;
    renderer = r;
    try {
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFShadowMap;      // WebGPU 后端会把 PCFSoft 降级回 PCF，别自欺欺人
      r.toneMapping = THREE.NeutralToneMapping;    // 克制的胶片感；ACES 会把暖黄推成橙色
      r.toneMappingExposure = look.exposure;
    } catch (e) {
      console.warn('[stage] 接管渲染器设置失败，画面会偏亮/没有阴影', e);
    }
  }
  scene.onBeforeRender = ((r: THREE.Renderer) => { adopt(r); }) as unknown as THREE.Scene['onBeforeRender'];

  /**
   * 把舞台底色的亮度发布成 CSS 变量，供**叠在画布上的那几层**取用
   *（物种名牌 `shell/notice.css`、右上角目录 `ui/nav.css`）。
   *
   * 为什么需要它：那几层的颜色原来写死成 `--sb-ink`（浅灰，为深底设计）。
   * 场景那条线做出了 `gallery` 白展厅之后，两边各自都是对的 ——
   * 合在一起，白底上的浅灰字**几乎看不见**。
   *
   * 不去翻 `--sb-ink` 本身：它是全站共用的，文档页（深底）还要用它。
   * 这里只覆盖 `--sb-on-stage`，而它的缺省值就是 `--sb-ink` ——
   * 于是不在舞台上的页面一个字都不用改。
   */
  function publishStageInk(): void {
    // 翻到哪一侧由 `look.ts` 的 `stageInk()` 说了算 —— 那里是纯函数，量得住
    // （`test/stage-ink.test.ts` 拿实测的角上亮度钉着它）。
    //
    // 这里原来自己算一遍 `look.bgBottom` 的亮度。那是**错的像素**：
    // `bgBottom` 是身体背后那团晕，画面里最亮的一块，长在正中；
    // 而字坐在两个角上。「夜潮」和「逆光」的晕亮到 0.59 / 0.60，
    // 角上却只有 0.0013 ~ 0.033 —— 于是深墨被发到近乎全黑的角上，
    // 对比度 1.2:1，那一行字在现场是看不见的。
    const ink = stageInk(look);
    const root = document.documentElement.style;
    root.setProperty('--sb-on-stage', ink.on);
    root.setProperty('--sb-on-stage-dim', ink.dim);
    // 最强的那一档也跟着底色翻：亮场景上最强的是黑，不是白
    root.setProperty('--sb-ink-strong', ink.strong);
  }

  /**
   * 上面那一份是**每场一个数**，跟不上从角底下走过的身体、弧线改的灯、中途换的场景。
   * 所以角上的字另外按渲染出来的像素翻（`ink-regions.ts` / `ink-sampler.ts`），
   * 各角写自己的 `--sb-on-stage-{tr,br,bl,tl}`；读不到像素时撤掉，CSS 退回上面这一份。
   * `?gl=off` 下不采：那是"别碰 GPU 的那条路"。
   */
  const inkSampler = createInkSampler({ enabled: typeof document !== 'undefined' && flags.gl });

  function applyLook(): void {
    publishStageInk();
    setColor(key.color, look.key);
    setColor(fill.color, look.fill);
    setColor(rim.color, look.rim);
    setColor(hemi.color, look.sky);
    setColor(hemi.groundColor, look.bounce);
    setVec3(uGroundNear.value, look.groundNear);
    setVec3(uSkyTop.value, look.skyTop);
    setVec3(uSkyGlow.value, look.skyGlow);
    setColor(scene.background as THREE.Color, look.skyGlow);
    uGlow.value.z = Math.max(0.05, look.glowRadius);
    uGlowSoft.value = Math.max(0.2, look.glowSoft);
    uFogDensity.value = Math.min(STAGE.fogDensityMax, Math.max(0, look.fogDensity));
    uContact.value = look.contactStrength;
    uContactR.value = look.contactRadius;
    uCore.value = look.contactCore;
    uCoreR.value = Math.min(STAGE.contactCoreRadiusMax, Math.max(0.02, look.contactCoreRadius));
    uReflect.value = look.groundReflect;
    uRipple.value = look.groundRipple;
    uGlossNear.value = look.groundGlossNear;
    uGlossFar.value = look.groundGlossFar;
    key.shadow.intensity = look.shadowIntensity;
    placeLights();
    field.setLook(look.particle, look.particleGain, look.particleDrift);
    field.setSize(look.particleSize);
    post?.setLook(look);
  }

  /**
   * 三盏灯的位置。**方向归场景管、颜色归主题管**（scenes.ts 的头一段）：
   * 白展厅要把主光压到近乎顶光（45° 主光会拖出一条和身高一样长的影子，
   * 那正是"人在飘"的另一半原因），逆光那套要把 rim 几乎推到镜头正对面。
   */
  function placeLights(): void {
    const put = (l: THREE.DirectionalLight, dir: RGB): void => {
      tmpDir.set(dir[0], dir[1], dir[2]);
      if (tmpDir.lengthSq() < 1e-6) tmpDir.set(0, 1, 0);
      tmpDir.normalize().multiplyScalar(STAGE.lightDistance);
      l.position.copy(aim).add(tmpDir);
      l.target.position.copy(aim);
      l.target.updateMatrixWorld();
    };
    put(key, look.keyDir);
    put(fill, look.fillDir);
    put(rim, look.rimDir);
  }
  applyLook();

  /**
   * 换一个取景目标。相同的目标不重启过渡 —— 每帧调 `frame()` 时这一点很重要，
   * 否则过渡永远停不下来（值一直在追一个一直在变的目标，看起来就是相机在抖）。
   */
  function aimAt(next: BodyBounds): void {
    const same = Math.abs(next.height - boundsTarget.height) < 0.01
      && Math.abs(next.centerY - boundsTarget.centerY) < 0.01
      && Math.abs(next.width - boundsTarget.width) < 0.02;
    if (same) return;
    boundsTarget = next;
    framingSettled = false;
  }

  /**
   * 重算目标 look = 主题（物种的颜色）→ 场景（它站在什么地方）。
   * 两层是正交的：换场景不该改变物种的固有色，换物种也不该把世界换掉。
   */
  function composeLook(fade: number): void {
    const base = deriveLook(curTheme, curMaterials);
    sceneId = sceneForced ?? pickScene(curTheme, base);
    lookFrom = baseLook;
    lookTo = applyScene(base, SCENES[sceneId]);
    lookMix = 0;
    lookFade = fade;
  }

  function useTheme(theme: ThemeDef | null, materials: readonly MaterialDef[]): void {
    curTheme = theme;
    curMaterials = materials;
    composeLook(0.7);
    // 物种的身体方案决定"没有真人时按什么取景"（docs/18）。
    // `?plan=` 优先：现场调试时要能强行看某一种方案。
    aimAt(boundsOfPlan(flags.plan ?? theme?.bodyPlan ?? "rig"));
    if (flags.debug) {
      console.info(
        `[stage] look ${theme?.id ?? '(none)'} · scene=${sceneId} · temp=${lookTo.temperature.toFixed(2)}` +
        ` cool=${lookTo.coolBias.toFixed(2)} hue=${lookTo.hueWeight.toFixed(2)}` +
        ` key=#${toColor(lookTo.key).getHexString()}`,
      );
    }
  }

  function resolveTheme(id: string, index: PartLibraryIndex | null | undefined): void {
    const t = index?.themes.find((x) => x.id === id) ?? null;
    useTheme(t, index?.materials ?? []);
  }

  /**
   * 没人调 `setTheme()` 时的自举：URL 里有 `?theme=` 就自己去拿一次主题表。
   * 这样在 main.ts 接上之前，`/?theme=xeno` 也已经是对的灯光。
   * 失败完全静默 —— 没有主题就是中性影棚，不是坏了（P3）。
   */
  function bootstrapTheme(): void {
    const id = opt.theme ?? flags.theme;
    if (typeof id !== 'string' || !id) return;
    void fetch(baseUrl + 'parts.json', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((raw: PartLibraryIndex | null) => {
        if (!raw || themeSet) return;              // 谁先明确设过主题，谁说了算
        resolveTheme(id, raw);
      })
      .catch(() => {});
  }

  if (opt.theme && typeof opt.theme !== 'string') {
    useTheme(opt.theme, opt.index?.materials ?? []);
    themeSet = true;
  } else if (typeof opt.theme === 'string' && opt.index) {
    resolveTheme(opt.theme, opt.index);
    themeSet = true;
  } else {
    bootstrapTheme();
  }

  function buildPost(): void {
    if (!renderer || post || postFailed || !postEnabled) return;
    post = createPost(renderer, scene, camera, { ...POST_DEFAULTS, focusDistance: STAGE.viewDistance });
    if (!post) postFailed = true;
    else post.setLook(look);
  }

  /**
   * 画面的取景：**先定世界坐标里要框住的那块矩形，再反算 fov**，
   * 而不是先拍一个 fov 再挪相机。竖屏/横屏都保证含头含脚、手臂不出画。
   *
   * 那块矩形有多大由 `framing.ts` 按**身体实际的包围盒**给出 —— 见那个文件里
   * 「有限插值」的取舍：人形严格等身，非人形连续地偏离，偏离量有上限。
   */
  function fitCamera(): void {
    const aspect = viewW / Math.max(1, viewH);
    uAspect.value = aspect;
    // 景别、移轴、视角、横向余量都由 `framing.ts` 的 `shotCamera()` 算：t = 0 时 `blendFit` 逐字返回全景，
    // 等身一毫米不偏（`test/framing.test.ts`）；取景平面放在身体**近面**（四足的前腿离镜头只有 2.25m，
    // 按 2.8m 反算 fov 它会被透视放大到出画）那一条也在那里。连续性测试和 `/dev/framing.html` 用的是同一个函数
    const cam = shotCamera(bounds, bodyH, shotState, aspect, look.frameLift);
    const { h, panX } = cam;
    const fit = { aimY: cam.aimY };
    lateralRoomM = cam.room;

    camera.aspect = aspect;
    camera.fov = cam.fov;

    // 镜头上下平移：相机保持水平，把整个视锥往下推 (eyeHeight - 画面中心)。
    // width/height 用满 → 不裁剪、只平移，等价于移轴镜头：竖线仍然是竖的。
    //
    // `frameLift` 是场景对构图的那一票，叠在 `FRAMING.centerLift` 之上（后者不动）。
    // 为什么构图要归场景管：留白多少是"这个世界有多空"的一部分 ——
    // 逆光那套身后是一块亮盘，身体要压低一点才压得住；白展厅反过来。
    const centerY = cam.centerY;
    const shift = (STAGE.eyeHeight - centerY) / h;
    const full = 1000;
    // 中景的横向跟随同样是平移视锥（移轴），不转相机：竖线仍然是竖的，地平线不歪
    camera.setViewOffset(full * aspect, full, (panX / h) * full, shift * full, full * aspect, full);
    camera.updateProjectionMatrix();

    // 聚拢形态跟着身体走（四足的粒子不该聚成一个站着的人影）
    field.setBody(bounds.height / DEFAULT_BOUNDS.height, bounds.centerY);

    // 灯与阴影跟着身体中心走。四足的"胸口"在 0.4m 高，
    // 照着人形的 0.98m 打，它整只都会留在暗部里。
    if (Math.abs(aim.y - fit.aimY) > 1e-4) {
      aim.y = fit.aimY;
      placeLights();
    }

    // ── 天幕的晕跟着身体走 ──
    // 这是构图那一条的另一半：晕心钉在身体背后（肩/头那一带），
    // 于是画面的视觉重心和身体重合，而不是钉在世界坐标的某个高度上。
    // 顺带也就没有"横向明暗分界线"可言了 —— 地平线是那么来的。
    //
    // ⚠️ 这里**不能**用 `Vector3.project(camera)`。相机的 `matrixWorldInverse`
    // 要到渲染那一刻才更新，在 fitCamera 里它还是上一帧（首帧是单位阵）的，
    // 算出来的晕心会落在画面左下角 —— `wip-tide.png` 里那团跑到左下的白斑就是它。
    // 而这套取景是**自己算出来的**：画面正好框住以 centerY 为中心、高 h 的一块世界，
    // 所以屏幕纵坐标有闭式解，不需要问相机。
    // ⚠️ `screenUV.y` 在这条管线里是**从上往下**的（0 = 画面顶端）。
    // 这一条实测出来的：按"0 在下"写的时候，晕心永远出现在画面**底部**
    // （`wip-gallery/backlit/tide` 前几轮那团贴着下边缘的亮斑就是它），
    // 而探针读出来的 `uGlow.y` 和手算的完全一致 —— 差的只有这一个符号。
    // 上游文档两种约定都能找到，所以这里以实测为准，别按记忆改回去。
    const toScreenY = (worldY: number): number => 0.5 - (worldY - centerY) / h;
    // 晕心钉在身体背后：身体横向走了多少（横向根偏移，docs/49 §6.3 二）、镜头移轴移了多少，晕就跟着挪多少。
    // 多人时按组取景（组是左右对称的），晕留在中线
    glowBodyX = groupWidth > 0 ? 0 : bodyX;
    uGlow.value.x = 0.5 + (glowBodyX - panX) / (h * aspect);
    uGlow.value.y = toScreenY(bounds.centerY + bounds.height * look.glowLift);
    // 地平线 = 眼高那条水平视线（地面上无穷远处）。地面镜射天幕时绕它翻折
    uHorizonY.value = toScreenY(STAGE.eyeHeight);
  }
  fitCamera();

  // 调试探针（只在 ?debug=1 下挂）：天幕的晕心/地平线是算出来的，
  // 算错了画面上看不出是"算错"还是"着色器错"—— 第一轮在这上面绕了一圈
  if (flags.debug && typeof globalThis !== 'undefined') {
    (globalThis as Record<string, unknown>).__stageProbe = {
      get glow() { return { x: uGlow.value.x, y: uGlow.value.y, r: uGlow.value.z }; },
      get horizon() { return uHorizonY.value; },
      get soft() { return uGlowSoft.value; },
      get sky() { return { top: [...uSkyTop.value.toArray()], glow: [...uSkyGlow.value.toArray()] }; },
      get ink() {
        return { active: inkSampler.active, samples: inkSampler.samples, regions: inkSampler.board?.state };
      },
    };
  }

  const stage: Stage = {
    scene,
    camera,

    update(p, m, dt) {
      frames++;
      const step = Math.min(Math.max(dt, 1 / 240), 1 / 15);
      inkSampler.tick(step);

      // ── 主题过渡：换主题不该是一次跳变 ──
      if (lookMix < 1) {
        lookMix = Math.min(1, lookMix + step / Math.max(0.05, lookFade));
        baseLook = lerpLook(lookFrom, lookTo, lookMix * lookMix * (3 - 2 * lookMix));
        look = applyArc(baseLook, arcW);
        applyLook();
        // 晕心 / 构图 / 地平线都跟着 look 走，过渡期间必须每帧重算 ——
        // 不然换场景时世界换了、晕却停在上一套的位置上
        fitCamera();
      }

      // ── 取景过渡 ──
      if (!framingSettled) {
        const t = 1 - Math.exp(-step / STAGE.framingTau);
        bounds = lerpBounds(bounds, boundsTarget, t);
        if (Math.abs(bounds.height - boundsTarget.height) < 0.003
          && Math.abs(bounds.centerY - boundsTarget.centerY) < 0.003) {
          bounds = { ...boundsTarget };
          framingSettled = true;
        }
        fitCamera();
      }

      // ── 景别过渡与中景跟随（时间驱动；静止时一帧都不重算）──
      {
        bodyH += (bodyHTarget - bodyH) * (1 - Math.exp(-step / STAGE.framingTau));
        const next = stepShot(shotState, { shot: shotWant, offset: shotOffset, reduced: shotReduced, hold: shotHold }, step);
        const moved = Math.abs(next.progress - shotState.progress) > 1e-6
          || Math.abs(next.fx.x - shotState.fx.x) > 1e-6 || Math.abs(next.fy.x - shotState.fy.x) > 1e-6
          || (next.progress > 0 && Math.abs(bodyHTarget - bodyH) > 1e-4)
          || Math.abs((groupWidth > 0 ? 0 : bodyX) - glowBodyX) > 1e-3;
        shotState = next;
        if (moved) fitCamera();
      }

      // ── 在场 ──
      const state = p?.state ?? 'IDLE';
      const alive = state === 'ALIVE' || state === 'ENTERING';
      aliveMix = ease(aliveMix, alive ? 1 : 0, step, 0.85);

      // ── 升档脉冲与时间停滞（docs/23 §S5）──
      // 注意用的是**真实 dt（step）**而不是被停滞缩过的时间：
      // 否则停滞会把自己的恢复也拖慢，600ms 会变成一段随帧率漂移的动画。
      if (pulseAge < STAGE.pulseDuration) {
        pulseAge += step;
        pulse = pulseAmp * pulseEnvelope(pulseAge);
        timeScale = 1 - (1 - STAGE.stasisScale) * Math.max(0, 1 - pulseAge / STAGE.stasisRecover);
      } else {
        pulse = 0;
        timeScale = 1;
      }

      // ── 运动 → 极轻的呼应。能被单独看出来就是过了 ──
      const energy = clamp01((m?.energy ?? 0) / 1.5);
      const presenceGain = STAGE.idleFloor + (1 - STAGE.idleFloor) * aliveMix;
      // 「全身亮度 +8%」就是字面意思：只乘在灯上。
      // 不动曝光、不在后期加常数 —— 那两种做法会把背景一起提亮，读成闪光灯而不是身体在发光。
      const pulseGain = 1 + pulse;

      key.intensity = look.keyIntensity * presenceGain * (1 + 0.10 * energy) * pulseGain;
      fill.intensity = look.fillIntensity * (0.55 + 0.45 * aliveMix) * pulseGain;
      rim.intensity = look.rimIntensity * presenceGain * (1 + 0.22 * energy) * pulseGain;
      hemi.intensity = look.hemiIntensity * (0.7 + 0.3 * aliveMix);
      // 接触阴影跟着"人有多大"走：张得越开，脚下那摊越大越淡
      uContact.value = look.contactStrength * aliveMix;
      uContactR.value = look.contactRadius * (1 + 0.5 * clamp01(((m?.expansiveness ?? 0.4) - 0.2) / 0.6));

      // ── 粒子：IDLE 散开呼吸 → 进场聚拢成最原始形态 → 身体接管后**彻底**淡出 ──
      // 淡到 0 而不是 0.12：docs/23 §S4 说共舞时"满屏只有身体、地面、影子"。
      // 加性混合的粒子哪怕只剩一点点，也会在身体前面留下一层挥不掉的星尘。
      gather = ease(gather, state === 'IDLE' ? 0 : 1, step, 0.75);
      particleFade = ease(particleFade, state === 'ALIVE' ? 0 : 1, step, state === 'ALIVE' ? 1.1 : 0.9);
      field.update(step, gather, particleFade, timeScale);

      // 水面的时间。乘 timeScale：升档停滞时水也要一起慢下来，
      // 否则"时间停了"这件事会被一片照常流动的水拆穿
      uTime.value += step * timeScale;

      // ── 机位呼吸：厘米级。只为了让画面不像一张贴图 ──
      swayT += step * timeScale;
      camera.position.set(
        Math.sin(swayT * 0.11) * STAGE.sway,
        STAGE.eyeHeight + Math.sin(swayT * 0.083 + 1.3) * STAGE.sway * 0.6,
        STAGE.viewDistance,
      );
      camera.lookAt(0, camera.position.y, 0);

      if (renderer) renderer.toneMappingExposure = look.exposure;
      post?.tick(step);

      // 后期没接上时提醒一次 —— 否则"为什么没有 bloom"会被查半天
      if (postEnabled && !renderedViaStage && !warnedWiring && frames > 120) {
        warnedWiring = true;
        console.info('[stage] 后期未接入：main.ts 请用 stage.render(renderer) 替代 renderer.render(...)');
      }
    },

    resize(w, h) {
      viewW = Math.max(1, w);
      viewH = Math.max(1, h);
      fitCamera();
    },

    render(r) {
      renderedViaStage = true;
      adopt(r);
      const postActive = postEnabled && !postSuspended;
      if (postActive) buildPost();
      // 后期没建起来（旧后端 / 建链失败）就直出。帧循环里永不抛异常（P2）
      if (postActive && post) post.render();
      else r.render(scene, camera);
      // 必须紧跟着绘制、在同一个任务里：WebGPU 画布出了这个任务就读不到了
      inkSampler.afterRender((r as { domElement?: HTMLCanvasElement }).domElement);
    },

    setTheme(theme, index) {
      themeSet = true;
      if (theme === null) { useTheme(null, index?.materials ?? []); return; }
      if (typeof theme === 'string') resolveTheme(theme, index ?? null);
      else useTheme(theme, index?.materials ?? []);
    },

    pulse(tier) {
      const t = Math.max(0, Math.min(3, Number.isFinite(tier) ? tier : 0));
      // 档位只微调幅度（tier 3 比 tier 1 重一点点），**峰值仍然锁在规格的 +8% 附近**。
      // 冷却与滞回不在这里挡（docs/23 §S5 说那是 tuning.ts 的事）：重复调用就是重新开始一次。
      pulseAmp = STAGE.pulseGain * (0.85 + 0.05 * t);
      pulseAge = 0;
    },

    get timeScale() { return timeScale; },
    get pulseGain() { return pulse; },

    setShot(shot, opts) {
      shotWant = shot === 'upper' ? 'upper' : 'full';
      shotReduced = !!opts?.reduced;
      shotHold = !!opts?.hold;
    },

    get shot() { return shotState; },
    get lateralRoom() { return lateralRoomM; },

    setGroup(w, h) {
      groupWidth = Number.isFinite(w) && w > 0 ? w : 0;
      groupHeight = Number.isFinite(h) && h > 0 ? h : 0;
    },

    frame(skeleton) {
      const b = boundsOfSkeleton(skeleton);
      // 多人（docs/50 §4.3）：画面至少框住整组身体 —— 最宽的跨度、最高的那一具（身体都站在 y = 0 上）。
      // 单人时两个数都是 0，这两行什么都不改
      if (b && groupWidth > 0) b.width = Math.max(b.width, groupWidth);
      if (b && groupHeight > b.height) { b.height = groupHeight; b.centerY = Math.max(b.centerY, groupHeight / 2); }
      if (b) aimAt(b);
      // 中景的两个输入：身高，和上半身相对站姿的偏移
      const J = skeleton?.joints;
      const head = J?.headCenter, chest = J?.chest;
      if (skeleton && Number.isFinite(skeleton.height) && skeleton.height > 0.3) bodyHTarget = skeleton.height;
      // 横向跟随的目标是头胸**相对骨盆**的偏移（前倾），不是头胸的绝对位置：身体整体的横向根偏移是镜子，
      // 相机跟过去就把观众的位移抵消了（docs/49 §3 用法 C / §6.3 二）。单人、没有横向偏移时骨盆就在 0，和原来逐字相同
      const pelvis = J?.pelvis;
      const px = pelvis && Number.isFinite(pelvis[0]) ? pelvis[0] : 0;
      if (skeleton && pelvis && Number.isFinite(pelvis[0])) bodyX = pelvis[0];
      shotOffset = head && chest && [...head, ...chest].every(Number.isFinite)
        ? { x: (head[0] + chest[0]) / 2 - px, y: head[1] + SKELETON.craniumOffset - bodyHTarget }
        : null;
      // 落地点：拿不到骨架就**保持上一帧**，不要归零 ——
      // 追踪丢一帧就把接触阴影关掉，脚下会闪一下，比没有更显眼
      // 骨架本身不可信（b 为 null）才保持上一帧；骨架可信但**整具身体都离地**时
      // 必须把落点全部关掉 —— 那正好是"它跳起来了"，那一刻脚下就不该有接触阴影
      if (!b) return;
      const feet = contactPoints(skeleton, STAGE.contactPoints, STAGE.contactLiftRange);
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < uFeet.length; i++) {
        const f = feet[i];
        // lift = 99 → 着色器里半径收成 0，这一路落点等于不存在
        if (f) { uFeet[i].value.set(f[0], f[1], f[2]); cx += f[0]; cz += f[1]; }
        else uFeet[i].value.set(0, 0, 99);
      }
      const k = Math.max(1, feet.length);
      uContactAt.value.set(cx / k, cz / k);
    },

    get bounds() { return bounds; },

    setPost(on) {
      postEnabled = on;
      // 这是用户 / 永久降级的资源所有权开关：关掉就释放。调速器只需暂时直出，走下面的挂起位，
      // 否则恢复那一帧会重建整条 PassNode / RenderTarget 链（实测 95–848ms，docs/48 §10.10）。
      if (!on) { post?.dispose(); post = null; postFailed = false; }
    },

    setPostSuspended(suspended) { postSuspended = suspended; },

    warmDirect(r) {
      try {
        adopt(r);
        const compile = (r as { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<void> }).compileAsync;
        if (typeof compile !== 'function') return Promise.resolve(false);
        // 编的是渲染器此刻的输出目标 —— 后期开着时它就是没被画过的那条直出
        return compile.call(r, scene, camera).then(() => true, (e: unknown) => {
          console.warn('[stage] 直出预编译失败 → 放下后期时照旧现编译', e);
          return false;
        });
      } catch (e) {
        console.warn('[stage] 直出预编译失败 → 放下后期时照旧现编译', e);
        return Promise.resolve(false);
      }
    },

    get post() { return postEnabled && !postSuspended && post !== null; },
    setInk(on) { inkSampler.setPaused(!on); },
    get look() { return look; },

    setArc(progress) {
      const a = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
      // 一帧的增量小于这个数就不重算。1e-4 × 180s ≈ 18ms，比一帧还短 —— 线不会变成阶梯
      if (Math.abs(a - arc) < 1e-4 && arcW !== ARC_OFF) return;
      arc = a;
      arcW = arcWeights(arc);
      look = applyArc(baseLook, arcW);
      applyLook();
    },
    get arc() { return arc; },

    setScene(id) {
      sceneForced = isSceneId(id) ? id : null;
      composeLook(STAGE.sceneFade);
    },
    get sceneId() { return sceneId; },

    dispose() {
      scene.onBeforeRender = (() => {}) as THREE.Scene['onBeforeRender'];
      inkSampler.dispose();
      post?.dispose();
      post = null;
      field.dispose();
      scene.remove(field.object);
      groundGeo.dispose();
      groundMat.dispose();
      backdropGeo.dispose();
      backdropMat.dispose();
      key.shadow.dispose?.();
    },
  };

  // 身高参考只有一份（docs/04）：如果哪天 referenceHeight 变了，取景要跟着变
  if (Math.abs(SKELETON.referenceHeight - 1.7) > 0.001 && flags.debug) {
    console.info(`[stage] referenceHeight=${SKELETON.referenceHeight}m，取景仍按 STAGE.frameHeight 走`);
  }

  return stage;
}
