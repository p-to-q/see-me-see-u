/**
 * 性能读数。docs/02 P5：超预算的数字标红 —— **红了就是 bug，不是"以后再优化"**。
 * 只在 ?debug=1 时挂上去。
 */
import { AUTOFRAME, BUDGET } from '../../../core/src/tuning.ts';
import type { FramingDecision, FramingReading } from '../../../core/src/autoframe.ts';
import { MOVEMENT_LABELS, MOVEMENT_NUMERALS, type ArcState } from '../../../core/src/arc.ts';
import type { TheseusState } from '../../../core/src/theseus.ts';
import type { PeopleFrame } from '../../../core/src/people.ts';
import type { EffectiveFraming } from '../stage/effective-framing.ts';
import { label } from './degrade.ts';
import type { FrameStats } from './safe-frame.ts';

export interface HudCounts {
  instances: number; triangles: number; drawCalls: number; inferenceHz: number;
  /** 当前玩法（docs/16）与它想说的一句话 */
  act?: string; note?: string;
  /**
   * 现在实际开着哪一台摄像头（`capture/camera-select.ts` 的 `CamStatus.hud`）。
   * 之所以非要占 HUD 一行：`?cam=` 没有它就是个没人敢用的参数 —— 没人知道 `1` 是谁。
   */
  cam?: string;
  /**
   * 上面那一行是不是"跑在不是你要的那台上"。红的。
   * 这件作品最贵的一种失败是安静地对着一面墙演一整晚（P21），
   * 所以回落必须在仪表上和一切正常时长得**不一样**。
   */
  camFallback?: boolean;
  /**
   * 这一场走到哪儿了（`core/src/arc.ts`）。**现场调时长的人靠这一行，不靠掐表**
   *（docs/40 §5 第 2 条）。观众那一侧永远看不到它：没有进度条，
   * 也没有任何一段的名字（docs/40 §5 / docs/26 §F）。
   */
  arc?: ArcState;
  /** 弧线此刻被 `?act=` 或右下角那一行按住了 —— 那时候乐章照走，身体不听它的 */
  arcForced?: boolean;
  /**
   * 一件一件换掉那条线走到哪儿了（`core/src/theseus.ts`）。docs/44 §7 最后一段：
   * **现场调速率的人靠它，不靠掐表**。`?theseus=off` 时是 undefined，整行不挂 ——
   * 一条在功能关掉之后还照常显示的仪表比没有仪表更坏（P21）。
   */
  theseus?: TheseusState;
  /**
   * 取景模式（`core/src/autoframe.ts`，docs/49 §落地）。**切换要实时看得见**：
   * 模式、为什么、在这个模式里待了多久，以及分类器量到的数和它们各自的门限。
   */
  framing?: FramingHud;
  /**
   * 多人入镜（`core/src/people.ts`，docs/50）。`?people=1` 时是 undefined，整块不挂。
   * 每条轨迹一行：id、主/伴/无身体、在场多久、丢了多久、这一帧配对的代价 —— 现场调门限的人要看"离配错还差多少"。
   */
  people?: PeopleHud;
  /** 实例数的预算（多人时是一具身体的预算 × 身体数）。缺省 `BUDGET.maxInstances` */
  instancesBudget?: number;
}

export interface PeopleHud {
  frame: PeopleFrame;
  cap: number;
  /** 预算放得下几具（`creature/people-budget.ts`） */
  bodies: number;
  /** 伴随身体在场时描边让不让位 */
  outlineYields: boolean;
  /** 调速器此刻有没有放下「人数」那一级 */
  shed: boolean;
}

/**
 * `people` 那几行的文本。纯函数（`test/people-hud.test.ts`）。
 * 读法：
 *   `2/3 人 · 身体上限 2（预算）· 描边让位`
 *   `#1 主 12.4s · cost 0.21`
 *   `#3 伴  4.1s · 丢 0.3s`
 *   `#4 无   1.2s · 候补`（还没转正）/`· 没动过`（海报）/`· 满员`
 */
export function formatPeopleRows(p: PeopleHud): string[] {
  const f = p.frame;
  const bodies = Math.min(p.cap, p.bodies);
  const head = `${f.selected.length}/${p.cap} 人 · 身体上限 ${bodies}${p.bodies < p.cap ? '（预算）' : ''}`
    + `${p.outlineYields ? ' · 描边让位' : ''}${p.shed ? ' · 调速器：只留主身体' : ''}`;
  const rows = f.tracks.map((t) => {
    const role = t.primary ? '主' : t.selected ? '伴' : '无';
    const why = t.selected ? '' : t.state === 'tentative' ? ' · 候补' : !t.moved ? ' · 没动过' : ' · 满员';
    const miss = t.missing > 0 ? ` · 丢 ${t.missing.toFixed(1)}s` : '';
    const cost = Number.isFinite(t.cost) ? ` · cost ${t.cost.toFixed(2)}` : '';
    const back = t.reattached ? ` · 认回 ${t.reattached}` : '';
    return `#${t.id} ${role} ${t.age.toFixed(1).padStart(5)}s${cost}${miss}${back}${why}`;
  });
  return [head, ...rows];
}

export interface FramingHud {
  reading: FramingReading;
  decision: FramingDecision;
  /** app 层结合身体方案与实际同伴数之后，所有输出消费者共用的最终语义。 */
  effective: EffectiveFraming;
  /** 腿混向站姿的权重 0..1 */
  legHold: number;
  /** 舞台景别进度 0（全景）… 1（中景） */
  shot: number;
  /** 身体的横向根偏移（docs/49 §6.3 二）：此刻的偏移、余量、在做什么、哪一侧出了画 */
  lateral?: { x: number; room: number; why: string; side: string | null };
  /** 中景纵向移轴：输出、信号来源、锚点与当前 screen.y。给真人摄像头调参，不给观众。 */
  vertical?: { y: number; source: 'screen' | 'world' | 'lost'; anchor: 'pelvis' | 'chest' | null; observed: number | null };
}

/**
 * `framing` 那两行的文本。纯函数（和 `formatArcRow` 同一条路数，`test/hud-framing.test.ts`）。
 *
 * 读法：
 *   `upper ← legs-out 3.2s · 策略 auto · 景 100% · 腿 1.00`
 *   `膝踝 0/4 (≥3 全 ≤1 半) · 尺度 0.94 (≤0.88 退) · 头肩出画 0 · 冷却 0.0`
 * 数和门限写在一起：现场的人要看的不是"它判了什么"，是"它离另一个判断还差多少"。
 */
export function formatFramingRows(f: FramingHud): [string, string] {
  const r = f.reading;
  const forced = f.decision.policy === 'auto' ? '' : `  [策略 ${f.decision.policy}]`;
  const l = f.lateral;
  const side = l ? ` · 侧 ${l.x >= 0 ? '+' : ''}${l.x.toFixed(2)}/±${l.room.toFixed(2)}m ${l.why}${l.side ? ` ⚠出画(${l.side})` : ''}` : '';
  const v = f.vertical;
  const vertical = v ? ` · 纵 ${v.y >= 0 ? '+' : ''}${v.y.toFixed(2)}m ${v.source}${v.anchor ? `/${v.anchor}` : ''}${v.observed === null ? '' : ` y${v.observed.toFixed(3)}`}` : '';
  const e = f.effective;
  const resolved = ` · 目标 ${f.decision.shot}→${e.stageShot}/${e.shotWhy}`;
  const head = `${r.mode} ← ${r.why} ${r.inMode.toFixed(1)}s${resolved} · 景 ${Math.round(f.shot * 100)}% · 腿 ${f.legHold.toFixed(2)}${side}${vertical}${forced}`;
  const evidence = r.evidence;
  if (!evidence) return [head, '无人'];
  const trend = Number.isFinite(r.trend) ? r.trend.toFixed(2) : '—';
  const legs = `膝踝 ${evidence.legs}/4 (≥${AUTOFRAME.legsInMin} 全 ≤${AUTOFRAME.legsOutMax} 半)`;
  const scale = evidence.screen ? `尺度 ${trend} (≤${(1 - AUTOFRAME.stepBackShrink).toFixed(2)} 退)` : '尺度 — (回放没有 screen)';
  const cut = `头肩出画 ${evidence.upperOut}${evidence.upper ? '' : ' ⚠'}`;
  const q = evidence.quality ? '' : ' · 光不够：保持';
  const cam = r.cameraFraming ? ' · 摄像头在取景：腿不在是预期' : '';
  return [head, `${legs} · ${scale} · ${cut} · 冷却 ${r.cooldown.toFixed(1)}${q}${cam}`];
}

/**
 * `theseus` 那一行的文本：`12/18 · 借距 d2 · 下一件 ~3.4s`（docs/44 §7）。
 * 纯函数，所以它和 `formatArcRow` 一样能被单测钉住而不用起一个 DOM。
 *
 * 三个数各回答一个现场问题：还剩几件原件、现在借得多远、下一件什么时候到。
 * 宽限里写「宽限」而不是一个倒计时 —— 那 20 秒不是"还没轮到"，是**故意不换**。
 */
export function formatTheseusRow(t: TheseusState): string {
  const head = `${t.replaced}/${t.slots}`;
  const next = t.inGrace ? '宽限中'
    : Number.isFinite(t.nextIn) ? `下一件 ~${t.nextIn.toFixed(1)}s`
      : '走完';
  const busy = t.inFlight > 0 ? `  交接 ${t.inFlight}` : '';
  return `${head} · 借距 d${t.borrowDistance} · ${next}${busy}`;
}

/**
 * `arc` 那一行的文本。纯函数，所以它能被单测钉住而不用起一个 DOM
 *（`packages/app/test/hud-arc.test.ts`）。
 *
 * 读法：`III 抵抗  46%  →IV 27s`
 *  —— 第几乐章、它叫什么、这一段走了多少、还有多久到下一段。
 * 停住了写 `保持`，没人时写 `无人 Ns`（那个数走到 `ARC.resetAfter` 就归零）。
 */
export function formatArcRow(a: ArcState, forced = false): string {
  const head = `${MOVEMENT_NUMERALS[a.movement]} ${MOVEMENT_LABELS[a.movement]}`;
  const pct = `${Math.round(a.progress * 100)}%`.padStart(4);
  const next = a.held
    ? '保持'
    : `→${MOVEMENT_NUMERALS[Math.min(3, a.movement + 1)]} ${Math.ceil(a.timeToNext)}s`;
  const why = !a.running && !a.held ? `  无人 ${a.away.toFixed(1)}s` : '';
  return `${head}${pct}  ${next}${why}${forced ? '  [按住]' : ''}`;
}

/**
 * @param opts.top 距顶多少像素。默认 8 = 原来的位置。
 *
 * **为什么这个数需要从外面传**：左上角现在还住着一块小屏幕
 *（`ui/preview.ts`，「它有没有看见我」），而那一块是给**观众**的，
 * HUD 是给我们自己的 —— 同一个角上谁让谁没有悬念，观众那一块赢。
 * 但这块屏幕不是每一场都挂（`?demo=1` / `?kiosk=1` 下不挂），
 * 所以让 `main.ts` 按当场的实情给一个数，而不是在这里写死一个
 * "反正躲开就行"的大数字 —— 那会让没有小屏幕的那几场里 HUD 平白掉下去一截。
 */
export function createHud(opts: { top?: number } = {}): { update(s: FrameStats, c: Partial<HudCounts>): void; dispose(): void } {
  const el = document.createElement('div');
  el.style.cssText =
    `position:fixed;left:10px;top:${opts.top ?? 8}px;z-index:9999;font:12px ui-monospace,monospace;` +
    'color:#9aa;background:rgba(10,11,13,.72);padding:8px 10px;border-radius:6px;' +
    'white-space:pre;line-height:1.5;pointer-events:none';
  document.body.appendChild(el);

  const row = (label: string, v: number, budget: number, unit = '', invert = false) => {
    const over = invert ? v < budget : v > budget;
    const color = over ? '#e0455a' : '#9aa';
    return `<span style="color:${color}">${label.padEnd(11)}${v.toFixed(v < 10 ? 1 : 0).padStart(7)}${unit}</span>`;
  };

  return {
    update(s, c) {
      el.innerHTML = [
        row('fps', s.fps, BUDGET.minFps, '', true),
        row('cpu', s.cpuMs, BUDGET.maxCpuMsPerFrame, ' ms'),
        row('instances', c.instances ?? 0, c.instancesBudget ?? BUDGET.maxInstances),
        row('tris', (c.triangles ?? 0) / 1000, BUDGET.maxTriangles / 1000, ' k'),
        row('draws', c.drawCalls ?? 0, BUDGET.maxDrawCalls),
        row('infer', c.inferenceHz ?? 0, 30, ' Hz', true),
        c.cam ? `<span style="color:${c.camFallback ? '#e0455a' : '#9aa'}">cam        ${c.camFallback ? '⚠ ' : ''}${c.cam}</span>` : '',
        c.act ? `<span style="color:#7fb3d5">act        ${c.act}${c.note ? '  ' + c.note : ''}</span>` : '',
        // 弧线那一行。**停表的时候颜色要变** —— 一条"照常在走"的弧线和一条
        // 停住的弧线长得一样，这一行就不是仪表了（P21）。
        c.arc ? `<span style="color:${c.arc.running ? '#7fb3d5' : '#e8a33d'}">arc        ${formatArcRow(c.arc, c.arcForced)}</span>` : '',
        c.theseus ? `<span style="color:#7fb3d5">theseus    ${formatTheseusRow(c.theseus)}</span>` : '',
        // 取景：非全身的时候换色 —— 一眼看得出"现在不是等身"
        ...(c.framing ? formatFramingRows(c.framing).map((line, i) =>
          `<span style="color:${c.framing!.reading.mode === 'full' ? '#9aa' : '#e8a33d'}">${i ? '           ' : 'framing    '}${line}</span>`) : []),
        ...(c.people ? formatPeopleRows(c.people).map((line, i) =>
          `<span style="color:${c.people!.shed ? '#e8a33d' : '#7fb3d5'}">${i ? '           ' : 'people     '}${line}</span>`) : []),
        s.throttled ? '<span style="color:#e8a33d">idle       无人降帧中</span>' : '',
        s.degraded ? `<span style="color:#e0455a">degraded   ${label(s.degraded)}</span>` : '',
        s.errors ? `<span style="color:#e0455a">errors ${s.errors}  ${s.lastError ?? ''}</span>` : '',
      ].filter(Boolean).join('\n');
    },
    dispose() { el.remove(); },
  };
}
