/**
 * 场景是审美，但"这五套真的**不一样**"是可测的。
 *
 * 这个文件存在的理由：`scenes.ts` 的五套值将来一定会被人调。
 * 调到什么程度算"还是五套不同的世界"、什么程度算"调成同一套了"，
 * 得有个说法，不能靠"我在浏览器里看了一眼"（和 look.test.ts 同一条理由）。
 *
 * 另外钉住三件踩过的事：
 *  - `glowLift` 的几何下限（晕心必须高过眼高，否则整团被地面挡住 —— 第一轮的 bug）
 *  - 雾密度不能超 `BUDGET` 旁边那个上限（雾会连身体一起吃掉）
 *  - 地面反射只有两种合法状态：真做，或者 0。**不许有"淡淡的一点点"**
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveLook, luminance, NEUTRAL_LOOK } from '../src/stage/look.ts';
import { applyScene, isSceneId, pickScene, SCENES, SCENE_IDS } from '../src/stage/scenes.ts';
import { contactPoints, DEFAULT_BOUNDS, REFERENCE_POSE } from '../src/stage/framing.ts';
import { remapSkeleton } from '../../core/src/bodyplan.ts';
import { STAGE } from '../../core/src/tuning.ts';
import type { BoneId, ThemeDef } from '../../core/src/types.ts';

const base = deriveLook(null, []);

test('scenes: 五套场景都完整，而且每套都写清了服务于谁', () => {
  assert.equal(SCENE_IDS.length, 5, '场景数量变了就要同时改 docs/28 和 docs/10');
  for (const id of SCENE_IDS) {
    const s = SCENES[id];
    assert.equal(s.id, id, `${id} 的 id 字段和键名对不上`);
    // “它服务于哪种物种、哪种情绪”是这个文件的价值所在，不许留空
    assert.ok(s.serves.length > 20, `${id} 没写 serves`);
    assert.ok(s.name && s.nameEn, `${id} 缺名字`);
  }
});

test('scenes: 晕心必须高过眼高，否则整团被地面挡住（第一轮的 bug）', () => {
  // 相机水平架在 1.58m，地平线以下全是地面。晕心低于眼高 = 观众一点都看不到。
  const b = DEFAULT_BOUNDS;
  for (const id of SCENE_IDS) {
    const glowY = b.centerY + b.height * SCENES[id].glowLift;
    assert.ok(
      glowY > STAGE.eyeHeight,
      `${id} 的晕心在 ${glowY.toFixed(2)}m，低于眼高 ${STAGE.eyeHeight}m —— 它会整团藏在地面后面`,
    );
  }
});

test('scenes: 雾密度不超上限，否则雾会连身体一起吃掉', () => {
  for (const id of SCENE_IDS) {
    const d = SCENES[id].fogDensity;
    assert.ok(d > 0, `${id} 没有雾 —— 地面就只能靠"两个材质颜色正好相等"接回背景，那条路已经证伪`);
    assert.ok(d <= STAGE.fogDensityMax, `${id} 的雾密度 ${d} 超过 ${STAGE.fogDensityMax}`);
    // 身体在 2.8m 处：exp 平方雾在那里最多吃掉多少对比度
    const atBody = 1 - Math.exp(-((d * STAGE.viewDistance) ** 2));
    assert.ok(atBody < 0.20, `${id} 的雾在身体处已经吃掉 ${(atBody * 100).toFixed(0)}% 对比度`);
  }
});

test('scenes: 地面反射只有"真做"和"彻底不做"两种，没有中间态', () => {
  for (const id of SCENE_IDS) {
    const r = SCENES[id].groundReflect;
    assert.ok(
      r === 0 || r >= 0.35,
      `${id} 的 groundReflect=${r} 落在中间态 —— docs/28 §4：要么映天幕，要么 0`,
    );
  }
  // 而且"湿"必须靠映出来的那张图，不能靠把地面磨成镜子（镜面斑不跟身体走）
  for (const id of SCENE_IDS) {
    assert.ok(
      SCENES[id].groundGlossNear > 0.6,
      `${id} 的地面太光滑了：平行光会在地上炸出一个和身体无关的镜面斑`,
    );
  }
});

test('scenes: 五套的性格真的不同（不是换了个背景色）', () => {
  // 天幕亮度：白展厅最亮，深空最暗。这条次序一旦破了，"多套场景"就名存实亡
  const glow = (id: (typeof SCENE_IDS)[number]): number => luminance(SCENES[id].skyGlow);
  assert.ok(glow('gallery') > glow('backlit'), '白展厅的天幕该比逆光整体更亮');
  assert.ok(glow('backlit') > glow('void'), '逆光那块亮盘该比深空亮');
  assert.ok(glow('tide') > glow('void'), '夜潮的月晕该比深空亮');
  // 逆光的定义就是 rim 压倒 key
  assert.ok(SCENES.backlit.rim / SCENES.backlit.key > 6, '逆光必须是 rim 远大于 key');
  // 白展厅反过来：漫射为主，轮廓光最弱
  assert.ok(SCENES.gallery.rim < SCENES.gallery.key, '白展厅不该靠轮廓光');
  // 纸比白展厅还亮，而且是全场最亮 —— 它就是首屏那张 #fafafa
  assert.ok(glow('paper') > glow('gallery'), '纸该比白展厅更亮');
});

test('scenes: 「纸」不被物种染色 —— 这是它和白展厅唯一的区别，也是它存在的理由', () => {
  // tint 是 applyScene 里天幕跟主光走的系数。paper 一旦有 tint，
  // 一具暖色的身体就会把纸染成米色，整件作品就有了第二种白。
  assert.equal(SCENES.paper.tint, 0, '纸一旦被染色就变回白展厅了');
  assert.deepEqual(SCENES.paper.skyTop, SCENES.paper.skyGlow, '纸是无缝的：天幕和地面同一个值');

  // 真的换一具暖身体上去：天幕必须逐字不动
  const warm = { ...base, key: [1, 0.72, 0.45] as [number, number, number] };
  const out = applyScene(warm, SCENES.paper);
  assert.deepEqual(out.skyTop, SCENES.paper.skyTop, '暖色物种把纸染色了');
  assert.deepEqual(out.skyGlow, SCENES.paper.skyGlow, '暖色物种把纸染色了');
  // 对照：白展厅**应该**被染色，否则这两套就没区别了
  const g = applyScene(warm, SCENES.gallery);
  assert.notDeepEqual(g.skyGlow, SCENES.gallery.skyGlow, '白展厅该跟着主光染色');

  // **地面也不许被染。** 天幕中性而地面带色，雾一混整块底就是暖的 ——
  // 实测 char.line 站上去那张"纸"是米黄的，而这条测试当时是绿的，
  // 因为它只看了天幕。仪表只量它想量的那一半，就是 P21。
  const warmGround = { ...warm, groundNear: [0.9, 0.6, 0.3] as [number, number, number] };
  const p2 = applyScene(warmGround, SCENES.paper);
  const [r, gg, b] = p2.groundNear;
  assert.ok(
    Math.abs(r - gg) < 1e-6 && Math.abs(gg - b) < 1e-6,
    `纸的地面被染成了 ${p2.groundNear.map((x) => x.toFixed(3)).join(', ')} —— 它必须是无彩的`,
  );
  // 对照：白展厅的地面**应该**带色
  const g2 = applyScene(warmGround, SCENES.gallery);
  assert.ok(g2.groundNear[0] > g2.groundNear[2], '白展厅的地面该跟着物种的地色走');
});

test('scenes: ?scene=paper 认得出来 —— 白底是一个可复现的选项，不是运气', () => {
  assert.ok(isSceneId('paper'));
  assert.ok(SCENE_IDS.includes('paper'), '纸必须在 SCENE_IDS 里，否则控件条和 S 键都轮不到它');
});

test('scenes: applyScene 只换世界，不换物种的颜色', () => {
  for (const id of SCENE_IDS) {
    const out = applyScene(base, SCENES[id]);
    // 灯的**颜色**归主题，场景只改强度与方向
    assert.deepEqual(out.key, base.key, `${id} 动了主光的颜色`);
    assert.deepEqual(out.rim, base.rim, `${id} 动了轮廓光的颜色`);
    // 世界那一半必须真的被换掉
    assert.notDeepEqual(out.skyTop, base.skyTop, `${id} 没换天幕`);
    assert.ok(out.fogDensity > 0, `${id} 没换雾`);
  }
});

test('scenes: 每套 look 都没有 NaN，也没有把画面调到纯黑', () => {
  for (const id of SCENE_IDS) {
    const out = applyScene(base, SCENES[id]);
    for (const [k, v] of Object.entries(out)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${id}.${k} 是 ${v}`);
      if (Array.isArray(v)) {
        for (const x of v) assert.ok(Number.isFinite(x), `${id}.${k} 里有 ${x}`);
      }
    }
    // 天幕最亮处不能是纯黑：空场时观众会以为坏了（P3）
    assert.ok(luminance(out.skyGlow) > 0.01, `${id} 的天幕接近纯黑`);
    // bloom 再多就从"被拍下来"变成"加了滤镜"
    assert.ok(out.bloomStrength <= 0.45, `${id} 的 bloom ${out.bloomStrength.toFixed(2)} 破顶`);
  }
});

test('scenes: 最暗的主题配最重的场景也不破 bloom 的顶', () => {
  // 暗主题的 bloomStrength 本身就到 0.26，乘上逆光那套的倍率会冲到 0.45 以上
  const dark = { ...base, bloomStrength: 0.26 };
  for (const id of SCENE_IDS) {
    assert.ok(applyScene(dark, SCENES[id]).bloomStrength <= 0.45, `${id} 在暗主题上破顶`);
  }
});

test('scenes: pickScene 按物种挑，而且永远挑得出一套', () => {
  const mk = (humanLike: number, lifeLike: number): ThemeDef =>
    ({ id: 't', name: 't', nameEn: 't', palette: [], axes: { humanLike, lifeLike } } as unknown as ThemeDef);
  // 亮而无彩 → 白展厅（放进深空会消失在自己的高光里）
  assert.equal(pickScene(mk(0.5, 0.5), { ...base, luma: 0.6 }), 'gallery');
  // 像机器 → 逆光（轮廓是它最好看的地方）
  assert.equal(pickScene(mk(0.1, 0.5), { ...base, luma: 0.1 }), 'backlit');
  // 像活物 → 夜潮
  assert.equal(pickScene(mk(0.8, 0.9), { ...base, luma: 0.1 }), 'tide');
  // 其余 → 深空
  assert.equal(pickScene(mk(0.6, 0.4), { ...base, luma: 0.1 }), 'void');
  // 没有主题也要给得出一套 —— 开场选择页之前就是这个状态
  assert.ok(isSceneId(pickScene(null, NEUTRAL_LOOK)));
});

test('scenes: ?scene= 认不出来的值不该静默变成某一套', () => {
  assert.ok(isSceneId('void'));
  assert.ok(!isSceneId('Void'));
  assert.ok(!isSceneId('toString'), '原型链上的键不能被当成场景 id');
  assert.ok(!isSceneId(null));
});

test('framing: 落地点一只脚一个；抬起的脚和手尖都不该占名额', () => {
  const feet = contactPoints(REFERENCE_POSE, 4);
  assert.equal(feet.length, 2, `站姿应该只有两个落点，实际 ${feet.length} 个（每只脚两个圆斑就是这么来的）`);
  // 两个点左右分开，不是挤在一边
  assert.ok(feet[0][0] * feet[1][0] < 0, '两个落点应该一左一右');
  // 参照系是**地面 y=0**，不是身体自己的最低点。参考站姿的脚尖在 0.03m
  for (const [, , lift] of feet) assert.ok(lift < 0.05, '站姿两只脚都该贴地');

  // 整具身体跳到空中 → 接触阴影必须**消失**，而不是跟着身体飞
  const airborne = {
    ...REFERENCE_POSE,
    bones: REFERENCE_POSE.bones.map((b) => ({
      ...b,
      p0: [b.p0[0], b.p0[1] + 0.6, b.p0[2]] as [number, number, number],
      p1: [b.p1[0], b.p1[1] + 0.6, b.p1[2]] as [number, number, number],
    })),
  };
  assert.deepEqual(contactPoints(airborne, 4, 0.22), [], '跳起来的身体不该还有接触阴影');

  // 反过来：脚陷进地面（装配层实测脚的网格最低点在 -0.025m）也照常有接触阴影
  const sunk = {
    ...REFERENCE_POSE,
    bones: REFERENCE_POSE.bones.map((b) => ({
      ...b,
      p0: [b.p0[0], b.p0[1] - 0.05, b.p0[2]] as [number, number, number],
      p1: [b.p1[0], b.p1[1] - 0.05, b.p1[2]] as [number, number, number],
    })),
  };
  assert.equal(contactPoints(sunk, 4, 0.22).length, 2, '陷进地里的脚仍然该有接触阴影');

  // 抬起一只脚：它就该退出落点名单，否则接触阴影会粘在抬起的脚下面
  const lifted = {
    ...REFERENCE_POSE,
    bones: REFERENCE_POSE.bones.map((b) => (b.id === 'footL' || b.id === 'shinL'
      ? { ...b, p0: [b.p0[0], b.p0[1] + 0.3, b.p0[2]] as [number, number, number],
          p1: [b.p1[0], b.p1[1] + 0.3, b.p1[2]] as [number, number, number] }
      : b)),
  };
  const f2 = contactPoints(lifted, 4, 0.22);
  assert.equal(f2.length, 1, '抬起 0.3m 的那只脚不该再有接触阴影');
  assert.ok(f2[0][0] < 0, '留下的该是没抬起的那只（右脚，x<0）');

  // 可见脚件脱离时只收掉它覆盖的 socket；另一只脚仍在承重，不能让整具身体短暂浮起来。
  const onlyLeftDetached = contactPoints(REFERENCE_POSE, 4, 0.22, (id: BoneId) => id === 'footL');
  assert.equal(onlyLeftDetached.length, 1, '单脚脱离把另一只脚的接触也一起关掉了');
  assert.ok(onlyLeftDetached[0][0] < 0, '左脚脱离后该保留右脚落点');
  assert.deepEqual(
    contactPoints(REFERENCE_POSE, 4, 0.22, (id: BoneId) => id === 'footL' || id === 'footR'),
    [],
    '两只脚都排除后仍从相邻小腿端点复活了假接触',
  );

  const quadruped = remapSkeleton(REFERENCE_POSE, 'quadruped');
  const quadrupedContacts = contactPoints(quadruped, 4, 0.22);
  const withoutFrontLeft = contactPoints(quadruped, 4, 0.22, (id: BoneId) => id === 'handL');
  assert.deepEqual([quadrupedContacts.length, withoutFrontLeft.length], [4, 3],
    '四足一条承重手脱离时没有只从 4 个支点收掉对应的 1 个');

  // 手尖离地 0.73m，在 xz 上离脚很远 —— 去重挡不住它，只有离地上限挡得住
  assert.ok(contactPoints(REFERENCE_POSE, 4, 0.22).every(([, , l]) => l <= 0.22));
});

test('framing: 骨架不可信时返回空数组（调用方保持上一帧，不要闪一下）', () => {
  assert.deepEqual(contactPoints(null), []);
  assert.deepEqual(contactPoints({ ...REFERENCE_POSE, bones: [] }), []);
});
