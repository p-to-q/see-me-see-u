/**
 * 空场时的呼吸粒子团（docs/05 §5）。
 *
 * **黑屏会让观众以为坏了。** 所以没人的时候屏幕上必须有东西在缓慢地活着：
 * 地面上一团低伏的尘雾，缓慢旋转 + 呼吸。有人进场时它**聚拢成最原始形态的位置**
 * —— 粒子先摆出一具 tier 0 的身体，真身体才在同一个位置长出来。
 *
 * 实现上只有两组静态属性（散开位置 / 聚拢位置）加四个 uniform：
 * 每帧 CPU 开销是 4 次赋值，动画全在顶点着色器里。
 * 帧循环里不 new、不写大数组（docs/02 P5）。
 *
 * 随机全部来自构造时传入的 seed（P1：禁止裸用 Math.random），
 * 所以同一个 seed 的粒子团每次启动完全一样 —— 截图能复现。
 */
import * as THREE from 'three/webgpu';
import {
  attribute, cameraProjectionMatrix, clamp, cos, float, floor, int, mix, mod, modelViewMatrix,
  positionGeometry, pow, sin, smoothstep, uniform, uniformArray, uv, varying, vec3, vec4,
} from 'three/tsl';
import { mulberry32 } from '../../../core/src/rng.ts';
import { ALL_BONE_IDS } from '../../../core/src/slots.ts';
import { placeSwarmPoints, type SwarmPoint } from '../../../core/src/swarm.ts';
import { SKELETON, STAGE, SWARM } from '../../../core/src/tuning.ts';
import type { Vec3 } from '../../../core/src/types.ts';
import type { RGB } from './look.ts';

export interface BreathField {
  readonly object: THREE.Object3D;
  /**
   * @param dt      秒，已被上游钳位
   * @param gather  0 = 散开的雾，1 = 聚成最原始形态
   * @param opacity 0..1，整体不透明度
   * @param timeScale 时间缩放（升档脉冲时的停滞感）
   */
  update(dt: number, gather: number, opacity: number, timeScale: number): void;
  setLook(color: RGB, gain: number, drift: number): void;
  /**
   * 粒子尺寸倍率。**这是"粒子几乎看不见"的直接修法**：
   * 原来的 0.016m 公告牌在 2.8m 外 45° fov 的 1600×900 画面上只有 ~7px，
   * 再乘上 0.35 的基础不透明度，一颗粒子对一个像素的贡献不到 1/255 ——
   * 它不是"淡"，是**在 8bit 输出里根本存不下来**。逆光那套要到 ~2.1 倍才读得出体积。
   */
  setSize(mul: number): void;
  /**
   * 把"聚拢形态"缩放/平移到当前这具身体所在的那个盒子里。
   * 人形以外的方案（四足是横的矮的）如果不缩，粒子会聚成一个和身体对不上的人影。
   * @param scale  相对 1.7m 人形的比例
   * @param centerY 盒子的竖直中心（米）
   */
  setBody(scale: number, centerY: number): void;
  dispose(): void;
}

/**
 * 「跟着活骨架走」的那一档（`bodyPlan:'swarm'`，docs/18 §2 B 档）。
 *
 * 它和上面那个呼吸粒子团**是同一个渲染器** —— 同一批公告牌、同一段
 * 衰减/加色/呼吸、同一个 draw call。变的只有一件事：
 * **「聚拢位置」从一副写死的 tier 0 站姿，换成这一帧（以及前 0.5 秒）的真骨架。**
 * 这就是「场」这个物种缺的那一块：在这之前它没有身体方案，走默认刚体装配，
 * 借别的物种的四肢拼成一具普通机器人，而它的 tagline 是「身体消失，只剩运动」。
 *
 * 为什么不是每帧重写一整个位置数组：那是 1400×3 个浮点的逐帧写入 + 上传，
 * 正是 `docs/02 P5`「帧循环里不写大数组」挡的那件事。这里改成上传
 * **骨架本身**（17 根骨头 × 2 端点 = 34 个 vec3，一个环存 16 帧历史），
 * 点在顶点着色器里自己去环里取自己那一刻的位置 —— 每帧 CPU 侧是
 * 34 次 Vector3.set（而且只在环该推进时才做）加 5 个标量赋值。
 */
export interface SwarmField extends BreathField {
  /**
   * 把这一帧的骨架压进运动历史环。内部按 `SWARM.trailStep` 定速推进：
   * 调得比它快只会更新"当前这一格"，不会让拖影变短 ——
   * 历史的长度因此不随帧率漂（60fps 和 120fps 拖影一样长）。
   */
  pushPose(bones: readonly { p0: Vec3; p1: Vec3 }[], dt: number, bodyScale: number): void;
  /** 换观众：下一副骨架重新灌满历史环，绝不拖着上一位的半秒尾巴进场 */
  resetTrail(): void;
  /** 整片点沿 +Y 平移多少米（落地，见 `creature/swarm.ts`） */
  setLift(lift: number): void;
  /** 这片点的静态属性表 —— 落地要拿它算最低点 */
  readonly points: readonly SwarmPoint[];
  /** 这一帧真正提交的三角数（公告牌 2 个/点） */
  readonly triangles: number;
}

export interface BreathFieldOptions {
  count?: number;
  seed?: number;
  /** 雾团半径（米） */
  radius?: number;
  /**
   * 开启「跟着活骨架走」。给一份**标准站姿的骨长**（下标与 `ALL_BONE_IDS` 一致）
   * 用来按骨长加权撒点 —— 调用方给而不是这里写死，理由见 `core/swarm.ts`。
   */
  follow?: { boneLengths: readonly number[] };
}

/**
 * 「最原始形态」= tier 0 的一具身体。这里只需要它的**轮廓**，
 * 所以用一组骨段 + 半径来采样，而不是去装配真部件（那是 creature.ts 的事）。
 * 坐标是站姿、身高 1.7m、面朝 +Z，与 docs/04 §2 的关节名同源。
 */
const LIMBS: Array<[[number, number, number], [number, number, number], number]> = [
  [[0, 0.94, 0], [0, 1.38, 0], 0.155],        // 躯干
  [[0, 1.38, 0], [0, 1.49, 0], 0.06],         // 颈
  [[0, 1.49, 0], [0, 1.66, 0], 0.10],         // 头
  [[0.18, 1.37, 0], [0.35, 1.11, 0.02], 0.05],   // 上臂 L
  [[-0.18, 1.37, 0], [-0.35, 1.11, 0.02], 0.05],
  [[0.35, 1.11, 0.02], [0.46, 0.87, 0.04], 0.042], // 前臂 L
  [[-0.35, 1.11, 0.02], [-0.46, 0.87, 0.04], 0.042],
  [[0.09, 0.93, 0], [0.10, 0.52, 0.01], 0.068],    // 大腿 L
  [[-0.09, 0.93, 0], [-0.10, 0.52, 0.01], 0.068],
  [[0.10, 0.52, 0.01], [0.10, 0.09, 0], 0.055],    // 小腿 L
  [[-0.10, 0.52, 0.01], [-0.10, 0.09, 0], 0.055],
];

/** 上面那副 LIMBS 的竖直中心（米）。缩放聚拢形态时绕它缩 */
const HUMAN_CENTER_Y = 0.845;

/** 一副骨架在环里占多少个 vec3：17 根骨头 × 两个端点 */
const TRAIL_STRIDE = ALL_BONE_IDS.length * 2;

export function createBreathField(opt: BreathFieldOptions & { follow: { boneLengths: readonly number[] } }): SwarmField;
export function createBreathField(opt?: BreathFieldOptions): BreathField;
export function createBreathField(opt: BreathFieldOptions = {}): SwarmField {
  const follow = opt.follow ?? null;
  const count = Math.max(16, opt.count ?? (follow ? SWARM.count : 760));
  const radius = opt.radius ?? 1.75;
  const rng = mulberry32(opt.seed ?? (follow ? SWARM.seed : 0x5EC0D1));
  const scale = SKELETON.referenceHeight / 1.7;    // 比例表是按 1.7m 写的

  // 跟随档的静态点表。**它是纯函数的输出**（`core/swarm.ts`），所以落地那一步
  // 能拿同一份表在 CPU 上量最低点 —— 画面上的点和量出来的点是同一批，不是两套近似。
  const points: SwarmPoint[] = follow
    ? placeSwarmPoints(count, follow.boneLengths, opt.seed ?? SWARM.seed)
    : [];

  // 骨段按长度加权，粒子才会均匀铺在身体上而不是全挤在头上
  const lengths = LIMBS.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  const total = lengths.reduce((s, x) => s + x, 0);

  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const position = new Float32Array(count * 4 * 3);
  const uvs = new Float32Array(count * 4 * 2);
  const dispersed = new Float32Array(count * 4 * 3);
  const gathered = new Float32Array(count * 4 * 3);
  const rand = new Float32Array(count * 4 * 3);
  const index = new Uint32Array(count * 6);
  // 跟随档独有的两条：aFollow = (骨头下标, 沿骨轴的 t, 自己的延迟)，aJitter = 固定偏移
  const followAttr = follow ? new Float32Array(count * 4 * 3) : null;
  const jitterAttr = follow ? new Float32Array(count * 4 * 3) : null;

  for (let i = 0; i < count; i++) {
    // ── 散开：地面上的一摊雾。sqrt 保证面积均匀，y 用高次幂压在地面附近 ──
    const a = rng.next() * Math.PI * 2;
    const r = radius * Math.sqrt(rng.next());
    const dy = 0.012 + 0.62 * Math.pow(rng.next(), 2.6);
    const dx = Math.cos(a) * r;
    const dz = Math.sin(a) * r * 0.8;          // 稍扁，贴合观众视角下的地面透视

    // ── 聚拢：最原始形态上的一点 ──
    let pick = rng.next() * total;
    let li = 0;
    while (li < LIMBS.length - 1 && pick > lengths[li]) { pick -= lengths[li]; li++; }
    const [p0, p1, rad] = LIMBS[li];
    const t = rng.next();
    const jx = (rng.next() * 2 - 1) * rad;
    const jy = (rng.next() * 2 - 1) * rad * 0.5;
    const jz = (rng.next() * 2 - 1) * rad;
    const gx = (p0[0] + (p1[0] - p0[0]) * t + jx) * scale;
    const gy = (p0[1] + (p1[1] - p0[1]) * t + jy) * scale;
    const gz = (p0[2] + (p1[2] - p0[2]) * t + jz) * scale;

    // 跟随档的相位/尺寸/延迟来自那张纯函数点表 —— 两份随机不能各走各的，
    // 否则"落地量的那一个点"和"画出来的那一个点"不是同一个点。
    const pt = points[i];
    const phase = pt ? pt.phase : rng.next();
    const sizeVar = pt ? pt.size : 0.55 + rng.next() * 0.9;
    const delay = rng.next();

    for (let c = 0; c < 4; c++) {
      const v = i * 4 + c;
      if (followAttr && jitterAttr && pt) {
        followAttr[v * 3] = pt.bone;
        followAttr[v * 3 + 1] = pt.t;
        followAttr[v * 3 + 2] = pt.lag;
        jitterAttr[v * 3] = pt.jitter[0];
        jitterAttr[v * 3 + 1] = pt.jitter[1];
        jitterAttr[v * 3 + 2] = pt.jitter[2];
      }
      position[v * 3] = corners[c][0];
      position[v * 3 + 1] = corners[c][1];
      position[v * 3 + 2] = 0;
      uvs[v * 2] = (corners[c][0] + 1) / 2;
      uvs[v * 2 + 1] = (corners[c][1] + 1) / 2;
      dispersed[v * 3] = dx; dispersed[v * 3 + 1] = dy; dispersed[v * 3 + 2] = dz;
      gathered[v * 3] = gx; gathered[v * 3 + 1] = gy; gathered[v * 3 + 2] = gz;
      rand[v * 3] = phase; rand[v * 3 + 1] = sizeVar; rand[v * 3 + 2] = delay;
    }
    const o = i * 4;
    index.set([o, o + 1, o + 2, o, o + 2, o + 3], i * 6);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aDispersed', new THREE.BufferAttribute(dispersed, 3));
  geo.setAttribute('aGathered', new THREE.BufferAttribute(gathered, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 3));
  if (followAttr && jitterAttr) {
    geo.setAttribute('aFollow', new THREE.BufferAttribute(followAttr, 3));
    geo.setAttribute('aJitter', new THREE.BufferAttribute(jitterAttr, 3));
  }
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  // 顶点是"角偏移"不是世界坐标，包围球算出来会是个 1m 的球 —— 交给 three 剔除一定剔错
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), radius * 2.2);

  const uTime = uniform(0);
  const uGather = uniform(0);
  const uOpacity = uniform(1);
  // 跟随档的点要大一点：它不再是背景里的雾，它**就是**这具身体
  const sizeBase = STAGE.particleSize * (follow ? SWARM.sizeMul : 1);
  const uSize = uniform(sizeBase);
  const uDrift = uniform(1);
  const uColor = uniform(new THREE.Vector3(0.8, 0.86, 1));   // 线性 RGB，直接当 vec3 用
  const uGain = uniform(1);
  // 聚拢形态的缩放与中心。默认 1 / 人形中心 —— 没人调 setBody 时表现和以前一模一样
  const uGatherScale = uniform(1);
  const uGatherCenter = uniform(HUMAN_CENTER_Y);

  const aDisp = attribute('aDispersed', 'vec3');
  const aGath = attribute('aGathered', 'vec3');
  const aRand = attribute('aRand', 'vec3');

  const phase = aRand.x;
  const seedAngle = phase.mul(6.2832);

  // 慢旋 + 呼吸：全部由 uTime 驱动，uTime 只从上游 dt 累加（P1：模块内不读时钟）
  const spin = uTime.mul(uDrift.mul(0.05).add(phase.mul(0.03)));
  const breath = float(1).add(sin(uTime.mul(0.33).add(seedAngle)).mul(0.09));
  const cs = cos(spin);
  const sn = sin(spin);
  const driftY = sin(uTime.mul(0.5).add(seedAngle.mul(1.5))).mul(0.03);
  const dispersedPos = vec3(
    aDisp.x.mul(cs).sub(aDisp.z.mul(sn)).mul(breath),
    aDisp.y.add(driftY),
    aDisp.x.mul(sn).add(aDisp.z.mul(cs)).mul(breath),
  );

  // 每颗粒子各自延迟一点点再出发 —— 同时到位会像一次开关，不像"聚拢"
  const k = smoothstep(aRand.z.mul(0.45), aRand.z.mul(0.45).add(0.55), uGather);

  // ── 运动历史环（只有跟随档用）────────────────────────────────────────────
  // 环里躺着最近 SWARM.trailSlots 副骨架，每副 34 个世界坐标端点。
  // 每个点按**自己的**延迟去环里取一个（插值出来的）时刻：
  // 静止时所有时刻重合成同一个姿势（形短暂出现），一动起来沿轨迹拉开（只剩运动）。
  const SLOTS = Math.max(2, SWARM.trailSlots);
  const trail = follow
    ? uniformArray(Array.from({ length: SLOTS * TRAIL_STRIDE }, () => new THREE.Vector3()), 'vec3')
    : null;
  const uHead = uniform(0);          // 最新那一格的下标（0..SLOTS-1）
  const uFrac = uniform(0);          // 距离下一次推进还差多少（0..1），用来插平推进的台阶
  const uBodyScale = uniform(1);     // 观测身高 / 标准身高：抖动按标准身材写的，要跟着缩
  const uLift = uniform(0);          // 落地抬升（米）

  let gathered3;
  if (trail) {
    const aFollow = attribute('aFollow', 'vec3');
    const aJitter = attribute('aJitter', 'vec3');
    // +SLOTS*4 是为了在取模之前把读位置抬成正数：环下标要用 mod，而 GLSL/WGSL 的
    // mod 对负数的行为不是我们要的那个。抬四圈远大于 uFrac(<1) + 最大延迟(SLOTS-2)。
    //
    // 环里第 head 格是**最近一次推进**时的姿势，head-1 是再往前 trailStep 秒，以此类推
    // ——间距严格等于 trailStep，所以时间轴是均匀的。"现在"落在 head + uFrac 处，
    // 而 head+1 那一格还没被写过（它是最老的那一格），所以可读的上界是 head：
    // 整体减去 1 之后，延迟为 0 的点读到的是 0..trailScoped 秒前，延迟 1 的点读到
    // head-1-(SLOTS-3)。`-1` 不是余量，它是"最新的一格也已经是过去"这件事本身。
    const readPos = float(uHead).add(SLOTS * 4).add(uFrac).sub(1)
      .sub(aFollow.z.mul(SLOTS - 3));
    const fa = floor(readPos);
    const w = readPos.sub(fa);                       // 两格之间的插值权重
    const ia = int(mod(fa, float(SLOTS)));
    const ib = int(mod(fa.add(1), float(SLOTS)));
    const boneOff = int(aFollow.x).mul(2);
    const baseA = ia.mul(TRAIL_STRIDE).add(boneOff);
    const baseB = ib.mul(TRAIL_STRIDE).add(boneOff);
    // 先沿骨轴插（t），再沿时间插（w）。反过来也等价，但这个次序读起来是
    // 「这根骨头上的那一点，在那一刻在哪里」——和上面注释里的说法对得上。
    // `uniformArray(..., 'vec3').element()` 在类型上退化成 `UniformArrayElementNode<string>`
    // （nodeType 是运行时字符串，推不出字面量），而 `mix()` 只收有具体类型的节点。
    // 这里过一道 `vec3()` 把类型钉回来 —— 运行时没有转换，元素本来就是 vec3。
    const at = (i: typeof baseA) => trail.element(i) as unknown as ReturnType<typeof vec3>;
    const pa = mix(at(baseA), at(baseA.add(1)), aFollow.y);
    const pb = mix(at(baseB), at(baseB.add(1)), aFollow.y);
    gathered3 = mix(pa, pb, w).add(aJitter.mul(uBodyScale)).add(vec3(0, uLift, 0));
  } else {
    // 聚拢位置按当前身体的盒子缩放（绕人形中心缩，再挪到身体中心）
    gathered3 = vec3(
      aGath.x.mul(uGatherScale),
      aGath.y.sub(float(HUMAN_CENTER_Y)).mul(uGatherScale).add(uGatherCenter),
      aGath.z.mul(uGatherScale),
    );
  }
  const center = mix(dispersedPos, gathered3, k);

  const mv = modelViewMatrix.mul(vec4(center, 1));
  const size = uSize.mul(aRand.y).mul(float(0.6).add(k.mul(0.5)));
  // position 里存的是"角偏移"(±1,±1,0) 而不是世界坐标：
  // 在视图空间里加这一个偏移 = 永远正对镜头的公告牌，不需要每帧算朝向
  const corner = positionGeometry.mul(size);

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.vertexNode = cameraProjectionMatrix.mul(vec4(mv.xyz.add(corner), 1));
  const vPhase = varying(phase);
  const vK = varying(k);
  const d = uv().sub(0.5).mul(2).length();
  const falloff = pow(clamp(float(1).sub(d), 0, 1), 2.4);
  mat.colorNode = uColor.mul(uGain).mul(float(0.55).add(vPhase.mul(0.7)));
  // 聚拢的时候亮一点：它正在变成一具身体，应该看得出在"用力"
  mat.opacityNode = falloff.mul(uOpacity).mul(float(0.35).add(vPhase.mul(0.45))).mul(float(1).add(vK.mul(0.6)));
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.AdditiveBlending;
  mat.side = THREE.DoubleSide;
  mat.toneMapped = true;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = follow ? 'swarm-field' : 'breath-field';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;

  let t = 0;
  /** 环里最新那一格的下标 */
  let head = 0;
  /** 距离下一次推进还差多少秒 */
  let sinceStep = 0;
  /** 环里灌过骨架了吗 —— 第一副要把整个环灌满，否则拖影会从原点扫过来 */
  let seededTrail = false;

  /**
   * 把一副骨架写进环的某一格。**帧循环里唯一的数组写入，34 次 `Vector3.set`。**
   * 不 new、不 push —— `trail` 那个数组和里面的 Vector3 全是构造时就位的（P5）。
   */
  function writeSlot(slot: number, bones: readonly { p0: Vec3; p1: Vec3 }[]): void {
    if (!trail) return;
    const base = slot * TRAIL_STRIDE;
    for (let i = 0; i < ALL_BONE_IDS.length; i++) {
      const b = bones[i];
      const a = trail.array[base + i * 2] as THREE.Vector3;
      const c = trail.array[base + i * 2 + 1] as THREE.Vector3;
      // 骨架是外部数据（追踪可能冲飞）：坏掉的那根骨头保持上一帧的值，
      // 而不是把 NaN 写进环里 —— NaN 进了环就会在整整 0.5 秒里反复被读到（P2）。
      if (!b || !Number.isFinite(b.p0[0] + b.p0[1] + b.p0[2] + b.p1[0] + b.p1[1] + b.p1[2])) continue;
      a.set(b.p0[0], b.p0[1], b.p0[2]);
      c.set(b.p1[0], b.p1[1], b.p1[2]);
    }
    // `uniformArray` 的 updateType 是 RENDER：它每次渲染都会把 array 重抄进
    // uniform buffer，所以这里不需要（也没有）一个 needsUpdate 标志。
  }

  return {
    object: mesh,
    points,
    get triangles() { return mesh.visible ? count * 2 : 0; },

    /**
     * 把这一帧的骨架压进环。**定速推进**（`SWARM.trailStep`），不是每帧一格 ——
     * 每帧一格的话拖影的时长会随帧率变，60fps 和 120fps 看到的不是同一个东西。
     * 两次推进之间靠 `uFrac` 插值，所以它是滑过去的，不是一格一格跳的。
     */
    pushPose(bones: readonly { p0: Vec3; p1: Vec3 }[], dt: number, bodyScale: number) {
      if (!trail || !bones?.length) return;
      uBodyScale.value = Number.isFinite(bodyScale) && bodyScale > 0 ? bodyScale : 1;
      const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 1 / 15) : 1 / 60;

      // 第一副骨架灌满整个环：不灌的话前 0.5 秒里一半的点在读 (0,0,0)，
      // 画面上是一道从地心扫上来的尾巴 —— 那不是"刚进场"，那是一个 bug 的样子。
      if (!seededTrail) {
        seededTrail = true;
        sinceStep = 0;
        for (let i = 0; i < SLOTS; i++) writeSlot(i, bones);
        head = 0;
      } else {
        sinceStep += step;
        // 掉帧掉过一整格时只推进一格、余数清零：补齐那几格只会把同一个姿势
        // 复制几份（我们没有中间那几帧的数据），那是假的历史。
        if (sinceStep >= SWARM.trailStep) {
          sinceStep = sinceStep >= SWARM.trailStep * 2 ? 0 : sinceStep - SWARM.trailStep;
          head = (head + 1) & (SLOTS - 1);
          writeSlot(head, bones);
        }
      }
      uHead.value = head;
      uFrac.value = Math.min(1, sinceStep / SWARM.trailStep);
    },

    resetTrail() {
      head = 0;
      sinceStep = 0;
      seededTrail = false;
      uHead.value = 0;
      uFrac.value = 0;
    },

    setLift(lift: number) { uLift.value = Number.isFinite(lift) ? lift : 0; },

    update(dt, gather, opacity, timeScale) {
      t += dt * timeScale;
      uTime.value = t;
      uGather.value = gather;
      uOpacity.value = opacity;
      mesh.visible = opacity > 0.002;
    },
    setBody(scale, centerY) {
      uGatherScale.value = scale;
      uGatherCenter.value = centerY;
    },
    setLook(color, gain, drift) {
      uColor.value.set(color[0], color[1], color[2]);
      uGain.value = gain;
      uDrift.value = drift;
    },
    setSize(m) { uSize.value = sizeBase * Math.max(0.1, m); },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
