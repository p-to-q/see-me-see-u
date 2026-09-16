/**
 * 调速器拨「后期」那一下只是切换（docs/48 §10）。`main.ts` / `stage.ts` 吃 WebGPU、测不到行为，
 * 这里核对接线 —— 和 `governor-wire.test.ts` 同一个写法。
 *
 * 实测（B-gov，强制 L4）：关后期那一帧 273ms、之后又一次 367ms。两处来路各守一条：
 *  1. 直出管线开机以来没用过 → 空闲里 `compileAsync` 先编好（`warm-plan.ts` 决定什么时候）；
 *  2. 关后期 = `post.dispose()`，拿回来时整条链重建 → 关后期只是不走它，链留着。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const STAGE = read('../src/stage/stage.ts');
const MAIN = read('../src/main.ts');
const CREATURE = read('../src/creature/creature.ts');

test('拨后期: 关后期仍然拆链（"不拆"量过没有量出好处，行为保持原样，docs/48 §10.3）', () => {
  const body = /setPost\(on\)\s*\{([\s\S]*?)\n\s{4}\},/.exec(STAGE)?.[1] ?? '';
  assert.ok(body, 'stage.ts 里找不到 setPost');
  assert.match(body, /post\?\.dispose\(\)/, 'setPost(false) 不再拆链 —— 改它之前先按 docs/48 §10 重量拿回后期那一帧');
});

test('拨后期: 舞台能在空闲里把直出那条路编一遍（compileAsync，不是 render）', () => {
  const body = /warmDirect\(r\)\s*\{([\s\S]*?)\n\s{4}\},/.exec(STAGE)?.[1] ?? '';
  assert.ok(body, 'stage.ts 里没有 warmDirect');
  assert.match(body, /compileAsync/, 'warmDirect 没有用 compileAsync');
  assert.match(body, /\.call\(r, scene, camera\)/, 'warmDirect 没有拿舞台的 scene / camera 去编');
  assert.match(STAGE, /warmDirect\(renderer: THREE\.Renderer\): Promise<boolean>/, 'Stage 接口上没有 warmDirect');
});

test('拨后期: 帧循环按 warm-plan 在空闲里调 warmDirect，而且失败不抛进帧循环', () => {
  assert.match(MAIN, /createWarmPlan\(\)/, 'main.ts 没有建 warm-plan');
  assert.match(MAIN, /warmPlan\.next\(/, 'main.ts 没有问 warm-plan');
  assert.match(MAIN, /stage\.warmDirect\(renderer\)[\s\S]{0,200}\.then\(/, 'warmDirect 的结果没有交回 warm-plan');
});

test('升档: 只在资源空闲后准备正式桶，并且每帧只推进一个', () => {
  assert.match(MAIN, /library\.stats\.pending !== 0 \|\| library\.stats\.queued !== 0/, '资源还在到货时就开始准备，Mesh 会被随后重建');
  assert.match(MAIN, /creature\.prepareBuckets\(genomeAt\(next\), REFERENCE_POSE\)/, '准备的不是正式升档会采用的 genome / 骨架');
  assert.match(MAIN, /if \(bucketWarmPlans\[bucketWarmIndex\]!\.next\(\)\) return true/, '一帧没有限制为一个桶');
});

test('升档: 同一个 live Mesh 走真实后期 render，失败也恢复根节点和保留状态', () => {
  const renderBlock = MAIN.slice(MAIN.indexOf('if (!bucketWarmActive)'), MAIN.indexOf('// 空闲里预编译直出'));
  assert.match(renderBlock, /creature\.object\.position\.y = WARM\.tierOffscreenY/);
  assert.match(renderBlock, /creature\.object\.visible = true[\s\S]*stage\.render\(renderer\)/, '未来桶没有走真实后期 render');
  assert.match(renderBlock, /finally \{[\s\S]*plan\.park\(\)[\s\S]*position\.y = previousY[\s\S]*visible = previousVisible/, 'render 异常时会留下画外半态');
  const prepareBody = CREATURE.slice(CREATURE.indexOf('prepareBuckets(g, sk)'), CREATURE.indexOf('clearPreparedBuckets()'));
  assert.doesNotMatch(prepareBody, /compileAsync/, '未来档位又退回了不能等价编译 PassNode/MRT 的 compileAsync');
});

test('升档: 换观众、换着色和来不及升档都有明确撤回路径', () => {
  assert.match(MAIN, /if \(arcState\.justReset\) \{[\s\S]{0,220}resetBucketWarm\(\)/, '换观众没有清掉上一 seed 的准备桶');
  assert.match(MAIN, /case 'outline':[\s\S]{0,180}resetBucketWarm\(\)[\s\S]{0,180}creature\.setShading/, '换材质前没有撤回旧桶');
  assert.match(MAIN, /if \(bucketWarmActive\) abandonBucketWarm\(\)[\s\S]{0,80}morph\(want\)/, '准备赶不上升档时没有先让正式路径接管');
});
