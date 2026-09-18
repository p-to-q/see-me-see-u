import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeeWatch, seeState } from '../src/ui/preview-state.ts';
import { CAPTURE, REFINE } from '../../core/src/tuning.ts';
import type { Landmark, RawPose } from '../../core/src/types.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 「它有没有看见我」的判据。
 *
 * ## 这个文件为什么存在
 *
 * 这一块是全作品里**唯一一处对观众承诺"我看见你了"**的东西。
 * 它要是判错了，错的方向几乎一定是**报喜**：屏幕上写着一切正常，
 * 而观众站在那里没有被看见 —— 正是 docs/02 P21 那一条
 *（"你的仪表会往讨好你的方向撒谎"）。
 *
 * 在浏览器里试这件事要真人配合：站进画面、走出去半个身子、把灯关掉。
 * 现场没有那个时间，所以判据被切成纯函数，在这里逐条钉住。
 *
 * 钉的是三件事：
 *  1. 四种状态各自的入口条件，**尤其是"半个人出画"** —— 那一种 score 往往还很高，
 *     靠置信度一条永远抓不住，而它是现场最常见的一种"没看见"。
 *  2. 质量判据用的是 `refine.ts` 自己那把尺子，不是另起一套门限。
 *  3. 话不许闪：门限上下颤一帧不该让屏幕上的字跟着跳。
 */

const lm = (x: number, y: number, v = 1): Landmark => ({ x, y, z: 0, visibility: v });

/** 一副全在画面里的 33 点 */
function inFrame(score: number, visibility = score): RawPose {
  return {
    world: [],
    screen: Array.from({ length: 33 }, (_, i) => lm(0.5, 0.1 + (i / 33) * 0.8, visibility)),
    score,
    t: 0,
  };
}

/** 把前 n 个点推到画面外（模拟"人站太近，头和手都出框了"） */
function pushOut(pose: RawPose, n: number): RawPose {
  const screen = pose.screen!.map((l, i) => (i < n ? lm(l.x, -0.5, l.visibility) : l));
  return { ...pose, screen };
}

test('看见：没有摄像头 —— 一切从这里开始，而且它压过其它所有判据', () => {
  assert.deepEqual(seeState({ camera: false, pose: null }), { state: 'off', reason: 'camera' });
  // 就算手上有一副完美的姿态（回放正在跑），摄像头没开就是没开：
  // 这块屏幕说的是"**它**有没有看见你"，不是"这具身体有没有在动"
  assert.equal(seeState({ camera: false, pose: inFrame(1) }).state, 'off');
});

test('看见：摄像头开着但没有人', () => {
  assert.deepEqual(seeState({ camera: true, pose: null }), { state: 'empty', reason: 'nobody' });
  // 门限和 `main.ts` 判 `detected` 用的是同一条线。不一致的话，
  // 会出现"身体已经站起来了，小屏幕还在说站到画面里"
  assert.equal(seeState({ camera: true, pose: inFrame(CAPTURE.minScore, 0.1) }).state, 'empty');
  assert.equal(seeState({ camera: true, pose: inFrame(CAPTURE.minScore + 0.01, 0.1) }).state, 'partial');
});

test('看见：一切正常的时候不说话', () => {
  assert.deepEqual(seeState({ camera: true, pose: inFrame(1) }), { state: 'ok', reason: 'ok' });
  // 质量刚好在 refine 的上界：那是"还没开始变迟钝"，算好的
  assert.equal(seeState({ camera: true, pose: inFrame(REFINE.qualityStart) }).state, 'ok');
});

test('看见：半个人出画 —— score 再高也不算好', () => {
  // 这一条是整份判据的理由。score 1.0 = 看得见的那半边点点都很清楚，
  // 只看置信度的话它是满分，而观众其实半个身子在框外。
  const perfectButHalfOut = pushOut(inFrame(1), 5);
  assert.deepEqual(seeState({ camera: true, pose: perfectButHalfOut }),
    { state: 'partial', reason: 'bounds' });
});

test('看见：一只手扬出画外不算 —— 那是常态，不是故障', () => {
  assert.equal(seeState({ camera: true, pose: pushOut(inFrame(1), 2) }).state, 'ok');
});

test('看见：画面外的点如果本来就看不见，不参与出画判定', () => {
  // 低 visibility 的点坐标本来就是垃圾（`refine.ts` 的遮挡门限同一条）。
  // 拿它们判出画，等于让噪声决定屏幕上说不说话。
  const noisy: RawPose = {
    ...inFrame(1),
    screen: inFrame(1).screen!.map((l, i) =>
      (i < 8 ? lm(-0.5, -0.5, REFINE.occlusionVisibility - 0.01) : l)),
  };
  assert.equal(seeState({ camera: true, pose: noisy }).state, 'ok');
});

test('看见：质量判据借的是 refine 自己那把尺子，不是第二套门限', () => {
  // 两套置信度必然漂。漂了之后就会出现"小屏幕说正常、身体却在发木"，
  // 而那种仪表报的数是真的，只是真在另一件事上（P21）。
  const justBelow = REFINE.qualityStart - 0.01;
  assert.ok(justBelow > CAPTURE.minScore, '这条测试的前提：质量线在有没有人那条线之上');
  assert.deepEqual(seeState({ camera: true, pose: inFrame(justBelow) }),
    { state: 'partial', reason: 'quality' });
});

test('看见：出画排在质量前面 —— 「往后退一点」观众做得到，「光不够」做不到', () => {
  const bothBad = pushOut(inFrame(REFINE.qualityStart - 0.05), 6);
  assert.equal(seeState({ camera: true, pose: bothBad }).reason, 'bounds');
});

test('看见：没有 screen 坐标时跳过出画判定，而不是假装都在画面里', () => {
  const noScreen: RawPose = { world: Array.from({ length: 33 }, () => lm(0, 0, 1)), score: 1, t: 0 };
  assert.equal(seeState({ camera: true, pose: noScreen }).state, 'ok');
  // 但质量那一条照常生效 —— 少一条判据是事实，少两条就是装聋
  assert.equal(seeState({ camera: true, pose: {
    ...noScreen, world: noScreen.world.map((l) => ({ ...l, visibility: 0.55 })), score: 0.55,
  } }).reason, 'quality');
});

test('看见：脏输入不许炸，也不许判成"好的"', () => {
  const nan: RawPose = { world: [], screen: [lm(NaN, NaN)], score: NaN, t: 0 };
  assert.equal(seeState({ camera: true, pose: nan }).state, 'empty');
  const empty: RawPose = { world: [], screen: [], score: 1, t: 0 };
  assert.equal(seeState({ camera: true, pose: empty }).state, 'empty', '空 landmark 不能只靠一个脏高分冒充人');
});

// ── 憋话 ──────────────────────────────────────────────────────────────────

test('憋话：新状态要连续成立才换过去，颤一帧不算', () => {
  const w = createSeeWatch();
  const good = { camera: true, pose: inFrame(1) };
  const bad = { camera: true, pose: inFrame(0.55) };

  // 先稳到 ok
  for (let i = 0; i < 60; i++) w.update(good, 1 / 60);
  assert.equal(w.current.state, 'ok');

  // 掉下去一帧 —— 屏幕上不许有任何变化
  assert.equal(w.update(bad, 1 / 60).state, 'ok', '一帧的抖动不该让字跳出来');

  // 一直掉着，半秒后才认
  for (let i = 0; i < 60; i++) w.update(bad, 1 / 60);
  assert.equal(w.current.state, 'partial');
});

test('憋话：回到"好的"比掉下去要多憋一会儿 —— 报喜更容易是误报', () => {
  const w = createSeeWatch();
  const good = { camera: true, pose: inFrame(1) };
  const bad = { camera: true, pose: inFrame(0.55) };
  for (let i = 0; i < 60; i++) w.update(bad, 1 / 60);
  assert.equal(w.current.state, 'partial');

  // 0.5 秒的好帧还不够
  for (let i = 0; i < 30; i++) w.update(good, 1 / 60);
  assert.equal(w.current.state, 'partial', '半秒还不足以宣布"好了"');
  for (let i = 0; i < 30; i++) w.update(good, 1 / 60);
  assert.equal(w.current.state, 'ok');
});

test('憋话：同一个状态里换成因不必憋 —— 那不是闪烁，是换一句话', () => {
  const w = createSeeWatch();
  const quality = { camera: true, pose: inFrame(0.55) };
  for (let i = 0; i < 60; i++) w.update(quality, 1 / 60);
  assert.equal(w.current.reason, 'quality');
  const bounds = { camera: true, pose: pushOut(inFrame(1), 6) };
  assert.equal(w.update(bounds, 1 / 60).reason, 'bounds', '两句话都属于同一块"不太好"');
});

test('憋话：dt 是脏的也不许卡死或瞬间切换', () => {
  const w = createSeeWatch();
  const good = { camera: true, pose: inFrame(1) };
  for (let i = 0; i < 10; i++) w.update(good, NaN);
  assert.equal(w.current.state, 'off', 'dt 不可信时不累积 —— 宁可不换，也不要凭一帧就换');
  w.reset();
  assert.equal(w.current.state, 'off');
});

// ── 真录制 ────────────────────────────────────────────────────────────────

/**
 * 上面全是手搭的姿态。这一段换成**仓库里真的那几段录制**（`assets/demo/`，
 * `?demo=1` 回放的就是它们），因为手搭的数据只会长成我想到的样子 ——
 * 而这一块正是为"我没想到的那种失败"存在的。
 *
 * 真录制立刻带来一件我没想到的：`pose-walkturn` 里有一段
 * **1.8 秒内检出/丢失来回十几次**。逐帧判的话，屏幕上那句话会跟着闪十几下。
 */
const CLIP = fileURLToPath(new URL('../../../assets/demo/pose-walkturn.json', import.meta.url));

function loadClip(): RawPose[] {
  const raw = JSON.parse(readFileSync(CLIP, 'utf8')) as { fps: number; frames: RawPose[] };
  return raw.frames;
}

test('真录制：判据跟着真人的那一段走，两种状态都真的出现过', () => {
  const frames = loadClip();
  assert.ok(frames.length > 300, '录制没了或者变短了，下面几条的前提就不成立');
  const seen = new Set(frames.map((f) => seeState({ camera: true, pose: f }).state));
  assert.ok(seen.has('ok'), '整段录制里一帧都没判成"看见了" —— 那是判据太严');
  assert.ok(seen.has('empty'), '整段录制里一帧都没判成"没有人" —— 那是判据恒为绿（P21）');
});

test('真录制：一段好好走路的录制不许被判成"不太好" —— 不许狼来了', () => {
  // 前 290 帧是人稳稳在画面里。这一块要是在这里开口说话，
  // 现场就会变成"它老在指挥我往后退"，然后没人再理它。
  const frames = loadClip().slice(0, 290);
  const bad = frames.filter((f) => seeState({ camera: true, pose: f }).state !== 'ok');
  assert.equal(bad.length, 0, `稳定站着的 290 帧里有 ${bad.length} 帧被判成不好`);
});

test('真录制：那段十几次的闪烁，憋过之后只剩个位数', () => {
  const frames = loadClip();
  const dt = 1 / 30;

  // 逐帧判（也就是不憋话的那一版）会切换多少次
  let rawSwitches = 0;
  let prev = '';
  for (const f of frames) {
    const s = seeState({ camera: true, pose: f }).state;
    if (prev && s !== prev) rawSwitches++;
    prev = s;
  }

  // 憋过之后屏幕上真的变了多少次
  const w = createSeeWatch();
  let shownSwitches = 0;
  let last = w.current.state;
  for (const f of frames) {
    const s = w.update({ camera: true, pose: f }, dt).state;
    if (s !== last) shownSwitches++;
    last = s;
  }

  assert.ok(rawSwitches >= 16, `前提变了：这段录制现在只切换 ${rawSwitches} 次，不再是那段闪烁`);
  assert.ok(
    shownSwitches <= 4,
    `屏幕上切换了 ${shownSwitches} 次（逐帧是 ${rawSwitches} 次）—— 一句忽隐忽现的话比没有话更糟`,
  );
});

test('真录制：出画那条判据在这几段上**没有证据** —— 如实记下来，不当它验过了', () => {
  // 真录制里只有 `world`，没有 `screen`（录制页当时没存图像坐标）。
  // 于是出画判据在 `?demo=1` 这条路上**从来不会运行**，它此前只有手搭数据作证。
  // 这一条不是在测功能，是在钉住这个缺口：哪天录制补上了 screen，它会红，
  // 那时候才该去补一条真数据的出画用例。
  const f0 = loadClip()[0];
  assert.equal(f0.screen, undefined,
    '录制里出现 screen 了 —— 去给出画判据补一条真数据的用例');
});
