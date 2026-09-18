/**
 * 左下角那块读数的判据（`ui/readout-state.ts`）。
 *
 * 这个文件盯的是**一种在屏幕上看不出来的错**：一个格式化好的数字和一个
 * 格式化好的谎话长得一模一样。空场里留着上一个观众的动能、
 * 模型不报逐点置信度时写成 `0/33`、NaN 被 `toFixed` 变成 `NaN` 甚至 `0.00` ——
 * 这四种坏法在屏幕上都读作"一切正常"（docs/02 P21）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ABSENT, ALARM_ENTER_SECONDS, ALARM_EXIT_SECONDS, alignDecimals, assess, createAlarmWatch, FIGURE_SPACE,
  INFER_ALARM_RATIO, INFER_WARN_RATIO, readOut, splitUnit, visibleJoints, wantsReadout,
} from '../src/ui/readout-state.ts';
// PREVIEW 这个名字下面已经被 preview.css 的文本占了，所以调参块换个名字进来
import { CAPTURE, PREVIEW as PREVIEW_TUNING } from '../../core/src/tuning.ts';
import { isReadoutMode, readFlags, type Flags } from '../src/shell/kiosk.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COPY } from '../src/ui/i18n.ts';
import { NEUTRAL_LOOK, overlayGroundLuma, STAGE_INK, stageInk } from '../src/stage/look.ts';
import { INK_BAND, INK_CROSSOVER } from '../src/stage/ink-regions.ts';
import { SCENE_IDS, SCENES, applyScene } from '../src/stage/scenes.ts';
import type { Landmark, MotionFeatures, RawPose } from '../../core/src/types.ts';

const FEATURES: MotionFeatures = {
  speed: 0.21, energy: 0.0423, expansiveness: 0.376,
  verticality: 0.45, symmetry: 0.3, jerk: 1.2, stillness: 0.1,
};

/** n 个点，每个点的 visibility 由 vis 给 */
const pose = (score: number, vis: readonly number[] | null, n = 33): RawPose => ({
  world: Array.from({ length: n }, (_, i): Landmark => ({
    x: 0, y: 0, z: 0,
    ...(vis ? { visibility: vis[i] ?? vis[vis.length - 1] } : {}),
  })),
  score,
  t: 0,
});

test('readout: 没有人的时候，除了推理频率全是破折号', () => {
  // 这一条是这个文件存在的头号理由：`lastFeatures` 在没人时留着上一个观众的数，
  // 照常显示出来，屏幕上就会出现"空场里有人在动"。
  const r = readOut({ pose: null, features: FEATURES, inferenceHz: 31 });
  assert.equal(r.present, false);
  assert.equal(r.values.energy, ABSENT, '没人的时候不许显示上一个人的动能');
  assert.equal(r.values.extent, ABSENT);
  assert.equal(r.values.confidence, ABSENT);
  assert.equal(r.values.joints, ABSENT);
  assert.equal(r.values.inference, '31 Hz', '推理是机器自己的节拍，空场里它照样在跑');
});

test('readout: 摄像头关着、身体在放录像时，不说「有人」—— 录像里的人不在现场', () => {
  // 作品负责人 2026-09-14 在线上看到：没人站在前面，读数照样写「有人」。
  // 原因不是判据错了，是喂错了：从选择页进舞台时 capture 是回放（`cameraOn = !entry`），
  // 录像的每一帧 score 都过线。读数只替**摄像头**说话。
  const r = readOut({ pose: pose(0.9, [0.9]), features: FEATURES, inferenceHz: 30, live: false });
  assert.equal(r.present, false, '回放时写了「有人」');
  assert.equal(r.live, false);
  for (const [k, v] of Object.entries(r.values)) assert.equal(v, ABSENT, `回放时「${k}」写了 ${v} —— 那是录像的数`);
  const a = assess({ pose: pose(0.9, [0.9]), features: FEATURES, inferenceHz: 1, live: false });
  assert.equal(a.code, null, '回放时报了告警 —— 录像没有推理可以停滞');
  // 默认（不传 live）仍是摄像头：老调用方不变
  assert.equal(readOut({ pose: pose(0.9, [0.9]), features: FEATURES, inferenceHz: 30 }).present, true);
  // 屏幕上那一行说的是真正的原因
  assert.ok(COPY.readout.replay, 'COPY.readout 没有「摄像头关着」那一句');
  const src = readFileSync(fileURLToPath(new URL('../src/ui/readout.ts', import.meta.url)), 'utf8');
  assert.match(src, /COPY\.readout\.replay/, 'readout.ts 回放时没有换那一行字');
  const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
  assert.match(main, /mountReadout\(\{[^}]*live:\s*\(\)\s*=>\s*cameraOn/, 'main.ts 没把「摄像头开没开」交给读数');
});

test('readout: score 压线 —— 判据和 main.ts 的 detected 是同一条', () => {
  // CAPTURE.minScore = 0.5，严格大于才算有人（和 `preview-state.seeState` 逐字相同）
  assert.equal(readOut({ pose: pose(0.5, [0.1]), features: FEATURES, inferenceHz: 30 }).present, false);
  assert.equal(readOut({ pose: pose(0.51, [0.1]), features: FEATURES, inferenceHz: 30 }).present, true);
});

test('readout: 有人的时候五个数按位数写出来', () => {
  const r = readOut({ pose: pose(0.873, [0.9]), features: FEATURES, inferenceHz: 30.6 });
  assert.equal(r.present, true);
  assert.equal(r.values.confidence, '0.87');
  assert.equal(r.values.joints, '33/33');
  assert.equal(r.values.inference, '31 Hz', 'Hz 取整 —— 小数位在这一行没有任何信息');
  assert.equal(r.values.energy, '0.042', '动能三位：两位的话站着不动和缓慢挥手是同一个数');
  assert.equal(r.values.extent, '0.376', '舒展实测会超过 types.ts 注释里那个 0.2..0.8，所以它也按量级缩');
});

test('readout: 动能跨量级时自己减小数位 —— 实测挥手是 1.955，不是 0.0x', () => {
  // 上一版写死三位，注释里按 tuning 的阈值猜成 1e-2 量级。`?demo=1` 一跑就是 1.955，
  // 而猜错的精度在小的那一端刚好也说得通，所以它在屏幕上不露馅（P21）。
  const at = (energy: number) =>
    readOut({ pose: pose(0.9, [0.9]), features: { ...FEATURES, energy }, inferenceHz: 30 }).values.energy;
  assert.equal(at(0.018), '0.018', '站着不动的人也要读得出差别');
  assert.equal(at(1.955), '1.955');
  assert.equal(at(12.3456), '12.35');
  assert.equal(at(123.456), '123.5');
  assert.equal(at(1234.5), '1235');
});

test('readout: 模型不报逐点置信度 → 关节写破折号，不写 0/33', () => {
  // `capture/webcam.ts` 的 overallScore()：有些版本 visibility 恒为 0 或者没有，
  // 那时 score 被记成 1。照抄成 0/33 会在同一块面板上出现
  // 「置信 1.00 / 关节 0/33」—— 同一份数据，两行互相打脸。
  assert.equal(visibleJoints(pose(1, null)), null, '没有 visibility 字段 = 没有答案');
  assert.equal(visibleJoints(pose(1, [0])), null, '全零和没有是同一种"这台机器不报这个数"');
  const r = readOut({ pose: pose(1, null), features: FEATURES, inferenceHz: 30 });
  assert.equal(r.values.confidence, '1.00');
  assert.equal(r.values.joints, ABSENT);
});

test('readout: 关节数用 REFINE.occlusionVisibility 那一条线，不另立门限', () => {
  // 0.4 是门限。10 个点在线上/线上方，其余 23 个在下方。
  const vis = Array.from({ length: 33 }, (_, i) => (i < 10 ? 0.4 : 0.39));
  assert.equal(visibleJoints(pose(0.8, vis)), 10);
  const r = readOut({ pose: pose(0.8, vis), features: FEATURES, inferenceHz: 30 });
  assert.equal(r.values.joints, '10/33', '半个人出画时置信度还很高，这一行是那件事唯一的数字证据');
});

test('readout: NaN / Infinity 一律写破折号，绝不写成 0', () => {
  const bad = { ...FEATURES, energy: Number.NaN, expansiveness: Number.POSITIVE_INFINITY };
  const r = readOut({ pose: pose(0.9, [0.9]), features: bad, inferenceHz: Number.NaN });
  assert.equal(r.values.energy, ABSENT);
  assert.equal(r.values.extent, ABSENT);
  assert.equal(r.values.inference, ABSENT, '一个算不出来的频率写 0 Hz = 谎称"模型停了"');
  // 还没有运动特征的第一帧（features 还是 null）也不许写 0
  const first = readOut({ pose: pose(0.9, [0.9]), features: null, inferenceHz: 30 });
  assert.equal(first.values.energy, ABSENT);
});

test('readout: 数装得进定宽的那一栏（readout.css 的 6ch，单位另起一栏）', () => {
  // 这一栏定宽是为了"数字跳动时面板一个像素都不回流"。
  // 宽度一旦被撑破，那条保证就没了，而它在截图上要下一帧才看得出来。
  const cases: ReadoutInputLike[] = [
    { pose: null, features: null, inferenceHz: 0 },
    { pose: pose(1, [0.9]), features: FEATURES, inferenceHz: 120 },
    { pose: pose(0.999, [0.9]), features: { ...FEATURES, energy: 0.9999, expansiveness: 0.999 }, inferenceHz: 60 },
  ];
  for (const c of cases) {
    for (const [k, v] of Object.entries(readOut(c).values)) {
      const [num] = splitUnit(v);
      assert.ok(num.length <= 6, `${k} = "${num}" 有 ${num.length} 个字符，撑破了 6ch 那一栏`);
    }
  }
});
type ReadoutInputLike = Parameters<typeof readOut>[0];

// ── 读数板：灰色半透明的底、没有边、字一样大 ─────────────────────────────────────

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const CSS = strip(read('../src/ui/readout.css'));
const TYPE = strip(read('../src/ui/type.css'));
const PREVIEW = strip(read('../src/ui/preview.css'));
const NOTICE = strip(read('../src/shell/notice.css'));
const SAMPLER = read('../src/stage/ink-sampler.ts');
const TS = strip(read('../src/ui/readout.ts'));

/** 一个选择器第一次出现时那一整块的正文 */
function block(css: string, selector: string): string {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `找不到 ${selector} 那一块`);
  return css.slice(i, css.indexOf('}', i));
}
/** type.css 里一个令牌的值。**从文件里读**，不在测试里抄一份 */
function token(name: string): string {
  const m = TYPE.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(m, `type.css 里没有 ${name}`);
  return m![1].trim();
}
/** sRGB 十六进制 → 0..1 的 gamma 通道值 */
function channels(hex: string): number[] {
  const h = hex.length === 4
    ? [hex[1] + hex[1], hex[2] + hex[2], hex[3] + hex[3]]
    : [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)];
  return h.map((s) => parseInt(s, 16) / 255);
}
const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const luma = (c: number[]): number =>
  0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]);
const contrast = (a: number, b: number): number =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

test('readout: 没有外边 —— 作品负责人明确否掉过那一圈线', () => {
  const panel = block(CSS, '.sb-readout');
  assert.doesNotMatch(panel, /box-shadow\s*:/, '面板又长出了一圈 box-shadow 边');
  assert.doesNotMatch(panel, /(^|\s)border\s*:/, '面板又长出了一圈 border');
  assert.doesNotMatch(panel, /outline\s*:/, '面板又长出了一圈 outline');
});

test('readout: 数字不比名字大 —— 放大的亮数字是仪表盘的语气，负责人说过很丑', () => {
  const value = block(CSS, '.sb-readout-value');
  assert.doesNotMatch(value, /font-size\s*:/, '数字单独定了字号 —— 它会比名字大');
  assert.doesNotMatch(value, /font-weight\s*:/, '数字单独加粗了');
  const name = block(CSS, '.sb-readout-name');
  assert.doesNotMatch(name, /font-size\s*:/, '名字单独定了字号，两者不再一样大');
});

/**
 * 上半截那块底**跟着左下角的场景墨走**（readout.css 文件头第二节，2026-09-14 第四次）：
 * 深场景上是一块更透的灰，浅场景上是一块更实的深灰；最底下那一条始终接近不透明的黑。
 *
 * CSS 里写的是 `rgb(from color-mix(in srgb, var(--sb-screen) M%, var(--sb-on-stage-bl)) r g b / calc(K - S * r))`。
 * 这里把那三个数读出来，**照浏览器的算法重算一遍**，而不是抄一个结果 —— 调了 CSS 测试自己跟着变。
 */
function topVeil(css: string): { mix: number; k: number; s: number }[] {
  const re = /rgb\(from color-mix\(in srgb,\s*var\(--sb-screen\)\s*([\d.]+)%,\s*var\(--sb-on-stage-bl\)\)\s*r g b \/ calc\(([\d.]+)\s*-\s*([\d.]+)\s*\*\s*r\)\)/g;
  return [...block(css, '.sb-readout').matchAll(re)].map((m) => ({ mix: Number(m[1]) / 100, k: Number(m[2]), s: Number(m[3]) }));
}
/** 某一侧的场景墨下，上半截最淡那一端的颜色（0..255 sRGB）和不透明度 */
function veilFor(side: 'onDark' | 'onLight'): { rgb: number[]; alpha: number } {
  const stops = topVeil(CSS);
  const screen = channels(token('--sb-screen')).map((c) => c * 255);
  const ink = channels(STAGE_INK[side].on).map((c) => c * 255);
  const worst = stops.map((st) => {
    const rgb = screen.map((c, i) => st.mix * c + (1 - st.mix) * ink[i]);
    return { rgb, alpha: Math.min(1, Math.max(0, st.k - st.s * rgb[0])) };
  });
  return worst.reduce((a, b) => (b.alpha < a.alpha ? b : a));
}

test('readout: 上半截跟着左下角的场景墨走，底下那一条接近不透明；没有写死的颜色', () => {
  const panel = block(CSS, '.sb-readout');
  assert.equal(topVeil(CSS).length, 2, '上半截的梯度不再是两端各一个「从场景墨算出来的灰」—— 这条测试要跟着重写');
  assert.match(panel, /color:\s*var\(--sb-screen-ink\)/);
  // 不支持相对颜色语法的浏览器退回一条固定的深灰梯度（写在前面，被后一条覆盖）
  assert.match(panel, /background:\s*linear-gradient\(180deg,\s*color-mix\(in srgb,\s*var\(--sb-screen\)/, '没有给旧浏览器的退路');
  // 区间（readout.css 文件头第二节第 5 条）：两侧都比上一版（0.84）透，但**往中间收** ——
  // 负责人看过 0.42 / 0.79 那一版：逆光和纸上下两块色阶差太大
  const dark = veilFor('onDark').alpha;
  const light = veilFor('onLight').alpha;
  for (const [name, a] of [['深场景', dark], ['浅场景', light]] as const) {
    // 上沿 0.80：深空上泛灰的纱化进地里之后（readout.css 第 6 条）放宽的；仍低于上一版固定的 0.84
    assert.ok(a >= 0.62 && a <= 0.8, `${name}上半截的不透明度 ${a.toFixed(2)} 出了 0.62–0.80 的区间`);
  }
  assert.ok(Math.abs(light - dark) <= 0.1, `两侧差 ${Math.abs(light - dark).toFixed(2)} —— 负责人要两端往中间靠`);
  // 底下那一条：和上半截在任何场景上都拉得开
  const bar = block(CSS, '.sb-readout-bar');
  const barPct = Number(bar.match(/background:\s*color-mix\(in srgb,\s*var\(--sb-screen\)\s*([\d.]+)%/)?.[1]);
  assert.ok(barPct >= 96, `底下那一条只有 ${barPct}% —— 在深场景上和上半截分不开`);
  assert.ok(barPct / 100 - Math.max(dark, light) >= 0.2, '底条和上半截的不透明度差不到 0.2 —— 上下两截分不开');
  assert.doesNotMatch(CSS, /--sb-screen-dim|opacity\s*:/, '用了暗墨或透明度做层级 —— 小字会掉到 4.5:1 以下');
  assert.doesNotMatch(CSS, /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})(?![0-9a-fA-F])/, 'readout.css 里写死了一个颜色');
  // 左下角的采样框要包住读数自己：身后亮了（一具白身体走到面板后面），那一角才会翻成浅场景那一档
  assert.match(SAMPLER, /bl:\s*'[^']*\.sb-readout/, 'ink-sampler 的左下角没有量读数面板身后');
});

test('readout: 身后从纯黑到纯白每一档，按采样器会选的那一侧算，满墨都过 4.5:1', () => {
  // 采样器按亮度在两侧之间翻（带回差）。最坏情况是亮度停在回差带里、侧没翻过去：
  // 深侧一直用到带的上沿，浅侧从带的下沿用起。按均匀的身后算（采样本来就是取平均）
  // ink-regions.ts：亮度 > hi 才翻深墨（浅场景那一档），< lo 才翻回浅墨 —— 深侧最远用到 hi，浅侧最远用到 lo
  const inkL = luma(channels(token('--sb-screen-ink')));
  const thin: string[] = [];
  let checked = 0;
  for (let g = 0; g <= 255; g += 5) {
    const behind = toLinear(g / 255);
    const sides: Array<'onDark' | 'onLight'> = [];
    if (behind <= INK_BAND.hi) sides.push('onDark');
    if (behind >= INK_BAND.lo) sides.push('onLight');
    checked += sides.length;
    for (const side of sides) {
      const v = veilFor(side);
      const onPanel = luma(v.rgb.map((c) => (v.alpha * c + (1 - v.alpha) * g) / 255));
      const c = contrast(inkL, onPanel);
      if (c < 4.5) thin.push(`身后 ${g} · ${side}: ${c.toFixed(2)}:1`);
    }
  }
  assert.ok(checked > 52, '扫描一档都没量到 —— INK_BAND 的字段名变了？');
  assert.deepEqual(thin, [], `读不动：\n${thin.join('\n')}`);
});

test('readout: 告警色在五套场景和纯黑纯白上都读得出（≥ 3:1，另有代码文字兜底）', () => {
  // 告警不只靠颜色：底下那一行写着 ALM 01 这样的代码。所以颜色按界面元素的 3:1 算，满墨才按正文的 4.5:1
  const behind: Array<[string, number]> = [['纯黑身后', 0], ['纯白身后', 1]];
  for (const id of SCENE_IDS) behind.push([id, overlayGroundLuma(applyScene(NEUTRAL_LOOK, SCENES[id]))]);
  const thin: string[] = [];
  for (const [name, bg] of behind) {
    const side = bg > INK_CROSSOVER ? 'onLight' : 'onDark';
    const v = veilFor(side);
    const g = toGamma(bg) * 255;
    const onPanel = luma(v.rgb.map((c) => (v.alpha * c + (1 - v.alpha) * g) / 255));
    for (const [label, tok] of [['红（告警）', '--sb-alarm'], ['琥珀（警告）', '--sb-caution']] as const) {
      const c = contrast(luma(channels(token(tok))), onPanel);
      if (c < 3) thin.push(`${name} · ${label}: ${c.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(thin, [], `读不动：\n${thin.join('\n')}`);
});

test('readout: 和左上角那块屏幕同一列、同宽 —— 屏幕尺寸只有一个来源', () => {
  const panel = block(CSS, '.sb-readout');
  const see = block(PREVIEW, '.sb-see');
  const left = /left:\s*calc\(var\(--sb-safe\)\s*\*\s*0\.5\)/;
  assert.match(panel, left, '读数没有贴仪表那条线（安全区的一半）');
  assert.match(see, left, '小屏幕不在仪表线上了 —— 两块要一起改');
  assert.match(panel, /width:\s*var\(--sb-see-w\)/, '读数和小屏幕不同宽');
  assert.match(see, /width:\s*var\(--sb-see-w\)/);
  // 尺寸住在 type.css：读数不能依赖 preview.css 恰好被加载（?preview=off 时它没被加载）
  assert.match(TYPE, /--sb-see-h\s*:/);
  assert.match(TYPE, /--sb-see-w\s*:/);
  assert.doesNotMatch(PREVIEW, /--sb-see-[hw]\s*:/, 'preview.css 又定义了一份屏幕尺寸 —— 两份会漂');
});

test('readout: 收起键在最底下、面板贴底 —— 开合的时候那个键一个像素都不动', () => {
  const panel = block(CSS, '.sb-readout');
  assert.match(panel, /bottom:/, '面板不是贴底的');
  assert.doesNotMatch(panel, /\btop:/, '面板贴了顶 —— 收起时那个键会跳');
  assert.match(TS, /root\.append\(\s*body\s*,\s*bar\s*\)/, '开合键不是最后一个孩子');
  assert.match(TS, /aria-expanded/, '开合键没有告诉读屏器它是开是合');
  assert.match(block(CSS, '.sb-readout-bar'), /pointer-events:\s*auto/, '开合键点不到');
  assert.match(panel, /pointer-events:\s*none/, '整块面板吃掉了指针 —— 只许那一条吃');
});

test('readout: 收起时底边那条线变透明而不是删掉 —— 删掉那一条会矮 1px，键就挪了', () => {
  const collapsed = CSS.match(/\.sb-readout\.is-collapsed \.sb-readout-bar\s*\{[^}]*\}/);
  assert.ok(collapsed, '找不到收起态的底边规则');
  assert.doesNotMatch(collapsed![0], /border(-top)?:\s*0/, '收起时删了线：实测键从 835 挪到 836');
  assert.match(collapsed![0], /border-top-color:\s*transparent/);
});

test('readout: 默认收起 —— 画面上首先该是身体，读数是想看的人自己点开的', () => {
  // 第一次调用 setOpen 就是那一刻的默认状态；它必须是收着的
  const first = TS.match(/setOpen\((true|false)\);/);
  assert.ok(first, '找不到挂载时那一次 setOpen');
  assert.equal(first![1], 'false', '读数板挂上来是展开的 —— 作品负责人要的是默认收起');
});

test('readout: 收起不跨观众留存 —— 刷新就回到收起', () => {
  assert.doesNotMatch(TS, /localStorage|sessionStorage|indexedDB|document\.cookie/);
});

test('readout: 左下角的名牌抬到读数上面，而不是压在上面', () => {
  const lift = NOTICE.match(/body:has\(>\s*\.sb-readout\)\s*\.sb-notice--bottom-left\s*\{[^}]*\}/);
  assert.ok(lift, 'notice.css 没有给读数让位的那一条');
  assert.match(lift![0], /var\(--sb-readout-h/, '名牌抬多高没跟着读数的实际高度走');
  assert.match(TS, /'--sb-readout-h'/, 'readout.ts 没有把面板高度写出去');
});

test('readout: 小数点竖成一条线 —— 只垫显示，不撑破那一栏', () => {
  assert.equal(alignDecimals('0.96'), `0.96${FIGURE_SPACE}`, '两位小数没垫到三位的小数点上');
  assert.equal(alignDecimals('0.878'), '0.878');
  assert.equal(alignDecimals('31'), '31', '整数不是小数，不垫');
  assert.equal(alignDecimals('33/33'), '33/33', '比值不是小数，不垫');
  assert.equal(alignDecimals(ABSENT), ABSENT);
  assert.ok(alignDecimals('123.4').length <= 6, '垫完撑破了 6ch');
  const r = readOut({ pose: pose(0.96, [0.9]), features: FEATURES, inferenceHz: 31 });
  assert.equal(r.values.confidence, '0.96', 'readOut 的位数被改了 —— 该垫的是显示层');
});

test('readout: 单位坐在数字的基线上、落在数字右下方 —— 不许飘起来', () => {
  // 截图上 Hz 飘在 31 上方：单位原来是网格里单独一格，小一号的那一格按自己的行盒对齐。
  // 现在单位必须和数字在同一个格子、同一行文字里。
  assert.match(TS, /value\.append\(\s*num\s*,\s*unit\s*\)/, '单位不在数字那一格里 —— 它会按自己的格子对齐，又飘起来');
  assert.doesNotMatch(TS, /rows\.append\([^)]*unit/, '单位又成了网格里单独的一格');
  const unit = block(CSS, '.sb-readout-unit');
  assert.match(unit, /vertical-align:\s*baseline/, '单位没有坐在基线上');
  assert.doesNotMatch(unit, /vertical-align:\s*(super|top|text-top|middle)/, '单位被抬起来了');
  assert.match(unit, /font-size:\s*var\(--sb-size-micro\)/, '单位没有小一号');
  const num = block(CSS, '.sb-readout-num');
  assert.doesNotMatch(num, /font-size\s*:/, '数字单独定了字号 —— 它会比名字大');
});

test('readout: 单位不大写 —— 赫兹是 Hz，不是 HZ', () => {
  const unit = block(CSS, '.sb-readout-unit');
  assert.doesNotMatch(unit, /text-transform/, '单位被改了大小写');
  // 大写那一组（通道代号）里不许混进单位
  const upper = CSS.match(/([^{}]*)\{[^}]*text-transform:\s*uppercase/g) ?? [];
  assert.ok(!upper.some((r) => r.includes('.sb-readout-unit')), '单位混进了全大写的那一组 —— 截图上会印成 HZ');
});

// ── 告警：只报真的越界，而且不闪 ──────────────────────────────────────────────

/** 带画面坐标的一帧：n 个点里前 out 个在画外 */
const framed = (score: number, n = 33, out = 0, vis = 0.9): RawPose => ({
  world: Array.from({ length: n }, (): Landmark => ({ x: 0, y: 0, z: 0, visibility: vis })),
  screen: Array.from({ length: n }, (_, i): Landmark => ({ x: i < out ? 1.2 : 0.5, y: 0.5, z: 0, visibility: vis })),
  score,
  t: 0,
});

test('readout 告警: 没有越界就没有颜色、没有代码', () => {
  const a = assess({ pose: framed(0.97), features: FEATURES, inferenceHz: CAPTURE.targetHz });
  assert.equal(a.code, null);
  assert.ok(Object.values(a.levels).every((l) => l === 'ok'), JSON.stringify(a.levels));
});

test('readout 告警: 阈值全部取自已有的判据，不另立一条线', () => {
  const hz = CAPTURE.targetHz;
  // 推理：目标的 80% / 40%
  assert.equal(assess({ pose: null, features: null, inferenceHz: hz * INFER_WARN_RATIO - 0.1 }).code, 'WRN13');
  assert.equal(assess({ pose: null, features: null, inferenceHz: hz * INFER_ALARM_RATIO - 0.1 }).code, 'ALM02');
  assert.equal(assess({ pose: null, features: null, inferenceHz: hz * INFER_WARN_RATIO }).code, null, '正好压线不算');
  // 出画：左上角小屏幕的那一把 —— 差一个点不算，够数就算
  assert.equal(assess({ pose: framed(0.97, 33, PREVIEW_TUNING.outOfFramePoints - 1), features: FEATURES, inferenceHz: hz }).code, null);
  assert.equal(assess({ pose: framed(0.97, 33, PREVIEW_TUNING.outOfFramePoints), features: FEATURES, inferenceHz: hz }).code, 'WRN12');
  // 关节不到一半 → 丢失（比出画更重）
  // 关节数先读画面坐标（有 screen 就用 screen），所以两份都要压低 —— 只压 world 的话这一行根本测不到
  const lowVis = (l: Landmark, i: number): Landmark => ({ ...l, visibility: i < 20 ? 0.1 : 0.9 });
  const base = framed(0.97);
  const half = { ...base, world: base.world.map(lowVis), screen: base.screen!.map(lowVis) };
  assert.equal(assess({ pose: half, features: FEATURES, inferenceHz: hz }).code, 'ALM01');
});

test('readout 告警: 没有人就没有身体上的告警 —— 空场里说"关节丢失"是假话', () => {
  const a = assess({ pose: framed(CAPTURE.minScore - 0.1, 33, 20, 0.1), features: FEATURES, inferenceHz: CAPTURE.targetHz });
  assert.equal(a.code, null);
  assert.equal(a.levels.joints, 'ok');
  assert.equal(a.levels.confidence, 'ok');
});

test('readout 告警: 开机还没推理过的那一两秒不报停滞 —— 每次打开都先红一下，观众读到的是坏了', () => {
  const w = createAlarmWatch();
  let a = w.update({ pose: null, features: null, inferenceHz: 0 }, 5);
  assert.equal(a.code, null, '还没推理过就报了 ALM 02');
  w.update({ pose: null, features: null, inferenceHz: 30 }, 0.25);
  a = w.update({ pose: null, features: null, inferenceHz: 0 }, ALARM_ENTER_SECONDS);
  assert.equal(a.code, 'ALM02', '推理过之后真停了，应当报');
});

test('readout 告警: 不闪 —— 进入要憋 1 秒，撤掉要憋 2 秒，门限上颤不换', () => {
  const w = createAlarmWatch();
  const ok = { pose: framed(0.97), features: FEATURES, inferenceHz: 30 };
  const slow = { pose: framed(0.97), features: FEATURES, inferenceHz: 20 };
  w.update(ok, 0.25);
  assert.equal(w.update(slow, ALARM_ENTER_SECONDS / 2).code, null, '半秒就换上去了');
  assert.equal(w.update(slow, ALARM_ENTER_SECONDS / 2).code, 'WRN13', '憋够一秒还没换');
  // 在门限上来回颤：每次都只成立一小段，永远憋不够，不许跟着颤
  for (let i = 0; i < 20; i++) {
    const a = w.update(i % 2 ? slow : ok, 0.25);
    assert.equal(a.code, 'WRN13', `第 ${i} 次采样跟着颤了`);
  }
  assert.equal(w.update(ok, ALARM_EXIT_SECONDS - 0.25).code, 'WRN13', '撤得太快');
  assert.equal(w.update(ok, 0.25).code, null, '憋够两秒还没撤');
});

test('readout 告警: 同时越界时底下只说最重的一条', () => {
  const a = assess({ pose: framed(0.97, 33, PREVIEW_TUNING.outOfFramePoints), features: FEATURES, inferenceHz: 5 });
  assert.equal(a.code, 'ALM02', `推理停滞比部分出画重，却报了 ${a.code}`);
  assert.equal(a.levels.joints, 'ok', '出画不给关节那一行上色 —— 33/33 涂成琥珀是自相矛盾');
  assert.equal(a.levels.inference, 'alarm');
});

test('readout 告警: 告警行的英文是一个词的状态字 —— 句子会在窄板上被切掉', () => {
  // 截图上 'Partly out of frame' 被切成 PARTLY OU、'Tracking lost' 只剩 TRACKING。
  // node 量不了版面，所以量字数：这一行定宽不折行，英文 ≤ 5 个字母才放得下（最窄 200px 的板上实测）。
  for (const [code, t] of Object.entries(COPY.readout.alarms)) {
    assert.ok(t.en.length <= 5, `${code} 的英文「${t.en}」有 ${t.en.length} 个字母 —— 会被切掉`);
    assert.ok(!/\s/.test(t.en), `${code} 的英文「${t.en}」是一句话，不是一个状态字`);
  }
});

test('readout 告警: 告警行永远占着高度，DOM 里一直在', () => {
  assert.match(TS, /body\.append\(\s*state\s*,\s*rows\s*,\s*alarm\s*\)/, '告警行不是常驻的 —— 告警来去时面板会长高缩矮');
  assert.match(block(CSS, '.sb-readout-alarm'), /white-space:\s*nowrap/, '告警行会折成两行，高度就不固定了');
});

test('readout: 单位单独一栏，数的个位才对得齐', () => {
  assert.deepEqual(splitUnit('31 Hz'), ['31', 'Hz']);
  assert.deepEqual(splitUnit('120 Hz'), ['120', 'Hz']);
  assert.deepEqual(splitUnit('33/33'), ['33/33', '']);
  assert.deepEqual(splitUnit(ABSENT), [ABSENT, '']);
  assert.deepEqual(splitUnit('0.878'), ['0.878', '']);
});

// ── 挂不挂 ───────────────────────────────────────────────────────────────────

const flags = (search: string): Flags => readFlags(search);

test('readout: 网页版默认挂、现场默认不挂、两边都能被显式翻过来', () => {
  assert.equal(wantsReadout(flags('')), true, '网页版没有解说员，这块读数是它自己把答案摊开');
  assert.equal(wantsReadout(flags('?kiosk=1')), false, '现场不是控制室（docs/23 §S4 默认零 UI）');
  assert.equal(wantsReadout(flags('?kiosk=1&readout=on')), true, '讲解 / 评审要它的时候要能要回来');
  assert.equal(wantsReadout(flags('?readout=off')), false, '网页版也要能摘掉');
});

test('readout: `?demo=1` 照常挂 —— 它和那块小屏幕不是同一种东西', () => {
  // 小屏幕在回放下会撒谎（画的是录像里另一个人的骨架，观众一挥手骨架不跟）。
  // 这块读数不声称有摄像头，它报的是此刻真正在驱动这具身体的那份数据。
  assert.equal(wantsReadout(flags('?demo=1')), true);
});

test('readout: 认不出来的值当没写过（并且 readFlags 会喊一声）', () => {
  assert.ok(isReadoutMode('on'));
  assert.ok(isReadoutMode('off'));
  assert.ok(!isReadoutMode('1'), '?readout=1 最容易手滑 —— 猜成 on 就分不出"没生效"和"没写"');
  assert.ok(!isReadoutMode('On'));
  assert.ok(!isReadoutMode('yes'));
  assert.ok(!isReadoutMode(null));
  assert.ok(!isReadoutMode('toString'), '原型链上的键不能被当成合法值');

  assert.equal(readFlags('').readout, null);
  assert.equal(readFlags('?readout=on').readout, 'on');
  assert.equal(readFlags('?readout=off').readout, 'off');
  assert.equal(readFlags('?readout=1').readout, null);
  // 当没写过 = 走默认，而不是"关掉"
  assert.equal(wantsReadout(flags('?readout=1')), true);
  assert.equal(wantsReadout(flags('?kiosk=1&readout=yes')), false);
});
