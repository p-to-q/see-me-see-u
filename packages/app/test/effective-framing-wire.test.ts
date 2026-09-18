import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAIN = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
const PREVIEW = readFileSync(fileURLToPath(new URL('../src/ui/preview.ts', import.meta.url)), 'utf8');

test('有效取景接线：拿到实际 companion 后只解析一次，舞台与横纵跟随共用结果', () => {
  assert.match(MAIN, /const crowdOut =[^]*effectiveFraming = resolveEffectiveFraming\(framing,[^]*hasCompanions:\s*\(crowdOut\?\.companions\.length[^]*preview\?\.update/,
    '最终景别在实际同伴数之前就定了，或小屏仍抢先读原始 decision');
  assert.match(MAIN, /upper:\s*effectiveFraming\.stageShot === 'upper'/,
    '横向控制仍按原始 upper 使用快档');
  assert.match(MAIN, /stage\.setShot\(effectiveFraming\.stageShot,[^]*vertical:\s*effectiveFraming\.stageShot === 'upper' \? screenVertical : null/,
    '舞台与纵向跟随没有共享最终景别');
  assert.doesNotMatch(MAIN, /stage\.setShot\(framing\.shot === 'upper'/,
    '旧的 stage 私有覆盖仍留在正式链');
});

test('有效取景接线：缺腿豁免和数字裁切分开，读数与 HUD 能看见最终原因', () => {
  assert.match(MAIN, /lowerBodyOptional:\s*\(\) => effectiveFraming\.lowerBodyOptional/);
  assert.match(MAIN, /cropUpper:\s*\(\) => effectiveFraming\.stageShot === 'upper'/);
  assert.match(MAIN, /upperIsIntended:\s*\(\) => effectiveFraming\.lowerBodyOptional/);
  assert.match(MAIN, /decision:\s*framing, effective:\s*effectiveFraming/);
  assert.match(PREVIEW, /upperIsIntended:\s*lowerBodyOptional/);
  assert.match(PREVIEW, /upperIsIntended:\s*opts\.cropUpper\?\.\(\) \?\? false/);
  assert.doesNotMatch(PREVIEW, /othersBodied/, '小屏又建立了一份多人景别判据');
  assert.match(MAIN, /selectedIndex >= 0 && selectedIndex < bodyBudget/,
    '小屏身体透明度没有服从真正渲染预算');
});
