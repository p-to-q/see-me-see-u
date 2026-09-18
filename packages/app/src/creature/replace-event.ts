/**
 * 忒修斯替换那一下**长什么样**（`docs/44-THESEUS.md` §7）。纯函数：不碰 three，只出 `SlotRender[]`。
 *
 *   1. 旧件碎开：几片墨屑（旧件自己的几何，缩小）从骨轴向外散、缩没；
 *   2. 新件装上：沿用 graft 的缩放曲线，但缺省**原位**长回来。
 *      150mm 轴向飞入不再是所有槽位的隐式语法；未来单手 release 由显式策略授权；
 *   3. **描边不断**：旧件的"芯"保持原大，直到新件长到八成以上才让位。
 *      描边是每个实例自己的外壳，互相重叠的实例外壳彼此遮住，只剩并集的外沿 ——
 *      所以只要这一格在任何一刻都有一件足够大的实体，轮廓就是连续的。
 *      交叉淡入做不到这一点：中点两件各剩一半大，轮廓在那一刻塌成一个洞。
 *
 * **这一下的预算**（`swap-budget.ts` 算，`test/swap-budget.test.ts` 守）：
 *  - draw call：墨屑和芯用旧件的桶，新件本来就要一个桶 —— 和交叉淡入一样**加一个桶**。
 *    描边模式下 18 桶已经是 36/40，所以同时在交接的件数上限是 2，不是 3。
 *  - 面数：一件实例的面数和它画得多大**无关**，0.42 倍的墨屑也是整件几何。
 *    骨头件那一格最坏是 1 + 片数 + 1 份几何；关节那一格是一道波（`waveRenders`），
 *    任何一刻只有 `THESEUS.jointWave` 处在交接 —— 十三处同时交接曾把 porcelain 推到 338k / 250k。
 */
import { MORPH, THESEUS } from '../../../core/src/tuning.ts';
import type { SlotKey, SlotPick } from '../../../core/src/types.ts';
import { JOINT_CAPS, type SlotRender } from './assemble.ts';

/**
 * 替换那一下有多长（秒）。**就是 graft 的组装动画的长度**，不另立一个数；
 * 它必须 ≤ `THESEUS.minGap`，否则两次替换会叠在一起。
 */
export const REPLACE_SECONDS = MORPH.crossfade;

const clamp01 = (x: number): number => Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0;
const smoothstep = (x: number): number => { const t = clamp01(x); return t * t * (3 - 2 * t); };

/** graft 的组装动画（交叉淡入里新件那一半）：从轴向外 `assembleOffset` 吸附回位 */
export function graftCurve(t: number): { scale: number; offset: number } {
  const u = smoothstep(t);
  return { scale: u, offset: (1 - u) * MORPH.assembleOffset };
}

/** 旧件的芯：前 `coreHold` 保持原大，之后缩没 */
export function coreScale(t: number, hold = THESEUS.coreHold): number {
  const h = clamp01(hold);
  return h >= 1 ? (t >= 1 ? 0 : 1) : 1 - smoothstep((t - h) / (1 - h));
}

/**
 * 这一格在 t 时刻"至少有多大的一件实体撑着轮廓"。测试钉的就是它的下界 ——
 * 墨屑不算：它们是往外散的，撑不住轮廓。
 */
export function envelope(t: number): number {
  return Math.max(coreScale(t), graftCurve(t).scale);
}

/** 一片墨屑在 t 时刻的大小与离轴距离（米） */
export function shardAt(t: number): { scale: number; lateral: number } {
  const life = Math.max(1e-3, THESEUS.shardLife);
  const tau = clamp01(t / life);
  const out = 1 - (1 - tau) * (1 - tau);                  // 先快后慢：碎开是"崩"的，不是"飘"的
  return {
    scale: clamp01(THESEUS.shardScale) * (1 - smoothstep(tau)),
    lateral: Math.max(0, THESEUS.shardSpread) * out,
  };
}

/** 一件骨头件碎几片；关节盖片每一处 1 片 */
export const shardCount = (key: SlotKey): number =>
  key === 'joint' ? 1 : Math.max(0, Math.floor(THESEUS.shards));

/** 黄金角：几片墨屑绕骨轴散开时互不重叠，而且不需要随机数（P1） */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** 一次交接波及几处：关节那一格是全部盖片，骨头件是它自己一件 */
const JOINT_COUNT = JOINT_CAPS.length;

/**
 * 关节波里第 `i` 处（共 `n` 处）在总进度 t 时的局部进度。
 * 波前走过 `n - 1 + w` 个单位：第 i 处在 [i, i + w] 那一段里从 0 走到 1，
 * 于是任何一刻落在 (0, 1) 里的最多 `w` 处。t = 0 全是旧件，t = 1 全是新件。
 */
export function capPhase(i: number, n: number, t: number, w = THESEUS.jointWave): number {
  const width = Math.max(1, Math.min(n, Math.floor(Number.isFinite(w) ? w : 1)));
  return clamp01((clamp01(t) * (n - 1 + width) - i) / width);
}

/**
 * 把"一处"的交接铺成一道波：交接完的一段画新件、没轮到的一段画旧件，
 * 正在交接的每一处单独画 `at(局部进度)`。每一条都带 `caps` 区间，`assemble()` 按它过滤。
 */
function waveRenders(
  t: number, from: SlotPick | null, to: SlotPick, pres: number,
  at: (u: number) => SlotRender[],
): SlotRender[] {
  const out: SlotRender[] = [];
  const n = JOINT_COUNT;
  let i = 0;
  while (i < n) {
    const u = capPhase(i, n, t);
    let j = i + 1;
    let list: SlotRender[];
    if (u <= 0 || u >= 1) {
      while (j < n && capPhase(j, n, t) === u) j++;
      const pick = u <= 0 ? from : to;
      list = pick ? [{
        partId: pick.partId, materialRole: pick.materialRole, scale: pres, groundsBody: false,
      }] : [];
    } else {
      list = at(u);
    }
    for (const r of list) out.push({ ...r, caps: [i, j] });
    i = j;
  }
  return out;
}

/**
 * 一处（一件骨头件，或一处盖片）的替换：芯、墨屑、新件。
 * 这里的每一件都在跑缩放 / 离轴曲线，所以只画、不参与主体落地；
 * 包括关节波里看似静止的区段，整个 active slot 的 lift 都只认
 * `assemble(..., { ground })` 那份满尺寸、在插座上的稳定代理。
 */
function replaceOne(
  key: SlotKey, from: SlotPick | null, to: SlotPick, tt: number, pres: number,
): SlotRender[] {
  const list: SlotRender[] = [];
  if (from) {
    const core = coreScale(tt);
    if (core > 0) list.push({
      partId: from.partId, materialRole: from.materialRole, scale: core * pres, groundsBody: false,
    });
    const n = shardCount(key);
    const sh = shardAt(tt);
    if (sh.scale > 1e-3) {
      for (let k = 0; k < n; k++) {
        list.push({
          partId: from.partId, materialRole: from.materialRole,
          scale: sh.scale * pres,
          // 沿骨头均匀摆开：缩小后的件占 [0, scale] 那一段，起点落在剩下那一段里
          along: n > 1 ? ((k + 0.5) / n) * (1 - clamp01(THESEUS.shardScale)) : 0,
          lateral: sh.lateral,
          angle: k * GOLDEN,
          groundsBody: false,
        });
      }
    }
  }
  const g = graftCurve(tt);
  list.push({
    partId: to.partId, materialRole: to.materialRole, scale: g.scale * pres,
    groundsBody: false,
  });
  return list;
}

/**
 * t ∈ [0,1] 时这一格要画的全部实例。`pres` 是在场缩放（和交叉淡入同一个乘法）。
 * 顺序：芯、墨屑、新件。关节那一格是一道波，见 `capPhase`。
 */
export function replaceRenders(
  key: SlotKey, from: SlotPick | null, to: SlotPick, t: number, pres = 1,
): SlotRender[] {
  const tt = clamp01(t);
  if (key === 'joint') return waveRenders(tt, from, to, pres, (u) => replaceOne(key, from, to, u, pres));
  return replaceOne(key, from, to, tt, pres);
}

/** 一处的交叉淡入：旧件缩没、新件走 graft 的组装曲线；两者都是短命效果。 */
function crossfadeOne(from: SlotPick | null, to: SlotPick, tt: number, pres: number): SlotRender[] {
  const list: SlotRender[] = [];
  if (from) list.push({
    partId: from.partId, materialRole: from.materialRole, scale: (1 - smoothstep(tt)) * pres,
    groundsBody: false,
  });
  const g = graftCurve(tt);
  list.push({
    partId: to.partId, materialRole: to.materialRole, scale: g.scale * pres, offset: g.offset,
    groundsBody: false,
  });
  return list;
}

/**
 * 升档 / 慢回路 / 降级走的交叉淡入（`creature.remorph()` / `graft()`）。
 * 从 `creature.ts` 里搬出来，是为了预算守卫能数到它真实画了几份几何 ——
 * 关节那一格和替换一样是一道波：十三处同时交叉淡入是 26 份几何。
 */
export function crossfadeRenders(
  key: SlotKey, from: SlotPick | null, to: SlotPick, t: number, pres = 1,
): SlotRender[] {
  const tt = clamp01(t);
  if (key === 'joint') return waveRenders(tt, from, to, pres, (u) => crossfadeOne(from, to, u, pres));
  return crossfadeOne(from, to, tt, pres);
}
