/**
 * 多人入镜 —— 画面里两三个人时，**谁是谁**、谁拿到身体、身体站在哪。纯函数，node 里测得住。
 *
 * 来路与裁定写在 `docs/50-MULTI-PERSON.md`。这里放四件可证伪的东西：
 *
 *  1. **观测** `observePerson()`：一份 `RawPose` → 躯干中心、尺度、面积、姿态描述子。只读 `screen`。
 *  2. **身份** `createPeopleTracker()`：MediaPipe 的多人输出不带身份、顺序不保证（docs/24 #4681），
 *     身份由这里按几何跟出来 —— 预测位置 + 尺度 + 姿态描述子的代价，门限挡掉不可能的配对，
 *     在 ≤ 4×8 的矩阵上**穷举最优的部分配对**（比 Hungarian 简单，而且在这个规模上是精确的）。
 *     出生要憋、死亡有宽限、死了三秒内在附近回来还是原来那个 id。
 *  3. **谁拿到身体** 同上 `update()` 的 `selected` / `primary`：人数到顶时按面积（离得近 = 大），
 *     带滞回；主身体是粘的，走了才交接；从没动过的轨迹（海报）不拿身体。
 *  4. **站位** `lineup()`：画面里的横向位置折成舞台上的米，镜像，组居中，挤开。
 *
 * 为什么没有外观特征：我们没有 embedding，也不想为了"认出是你"去存一个像你的向量（docs/43 §0.2 的同一条直觉）。
 * 三个人的规模上，几何加滞回够用；它挺不住的那几种情形写在 docs/50 §2.4，每一种有一个决定好的行为。
 *
 * 三条硬规矩：没有时钟、没有随机（时间全从 `dt` 来）；不 throw（坏输入 = 没有这份观测）；
 * 结论要读得出来（每条轨迹带 `cost` / `age` / `missing`，HUD 与 `/dev/people.html` 直接显示）。
 */
import type { Landmark, RawPose } from './types.ts';
import { PEOPLE } from './tuning.ts';
import { imageToStageX, inFrame, torsoScale, trustedLandmark } from './autoframe.ts';
import { posePresent } from './pose-signal.ts';

// ── 观测 ────────────────────────────────────────────────────────────────────

const SHOULDER_L = 11, SHOULDER_R = 12, HIP_L = 23, HIP_R = 24;
/** 姿态描述子用的十个点：肩、肘、腕、胯、膝。脸不要（转头不是换人），脚不要（最先出画） */
export const DESCRIPTOR_POINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26] as const;

export interface PersonObs {
  pose: RawPose;
  /** 躯干中心（画面归一化，0..1） */
  cx: number;
  cy: number;
  /** 躯干长（画面高度单位）。量不到时是肩宽折算的 */
  scale: number;
  /** 可信点包围盒的面积（画面高度单位²，x 按宽高比折算）。"离得近 = 大" */
  area: number;
  /** 描述子：DESCRIPTOR_POINTS 各点相对躯干中心、除以尺度之后的 (x, y)。不可信的点是 NaN */
  desc: number[];
  score: number;
}

const ok = (l: Landmark | undefined): l is Landmark => trustedLandmark(l) && inFrame(l as Landmark);

/**
 * 一份姿态 → 一份观测。`null` = 这一份不作数：没有人体证据、没有 `screen`、躯干量不到。
 * @param aspect 画面宽 / 高。x 乘它才和 y 同一个单位
 */
export function observePerson(pose: RawPose | null | undefined, aspect = 16 / 9): PersonObs | null {
  if (!posePresent(pose)) return null;
  const s = pose.screen;
  if (!s?.length) return null;
  const sL = s[SHOULDER_L], sR = s[SHOULDER_R], hL = s[HIP_L], hR = s[HIP_R];
  const shoulders = ok(sL) && ok(sR);
  const hips = ok(hL) && ok(hR);
  const X = (l: Landmark) => l.x * aspect;
  let cx: number, cy: number, scale: number;
  if (shoulders && hips) {
    const mx = (sL.x + sR.x) / 2, my = (sL.y + sR.y) / 2;
    const hx = (hL.x + hR.x) / 2, hy = (hL.y + hR.y) / 2;
    cx = (mx + hx) / 2; cy = (my + hy) / 2;
    // 尺度的量法（躯干长与肩宽折算取大的那个）住在 `autoframe.ts` 的 `torsoScale()`：身体的横向根偏移用同一把尺子
    scale = torsoScale(sL, sR, hL, hR, aspect);
  } else if (shoulders) {
    cx = (sL.x + sR.x) / 2;
    // 胯在画外（笔记本前坐着）：躯干中心按肩宽往下估半个躯干
    scale = torsoScale(sL, sR, null, null, aspect);
    cy = (sL.y + sR.y) / 2 + scale / 2;
  } else {
    return null;
  }
  if (!Number.isFinite(scale) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  scale = Math.max(PEOPLE.minScale, scale);

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const l of s) {
    if (!ok(l)) continue;
    x0 = Math.min(x0, X(l)); x1 = Math.max(x1, X(l));
    y0 = Math.min(y0, l.y); y1 = Math.max(y1, l.y);
  }
  const area = Number.isFinite(x0) ? Math.max(0, x1 - x0) * Math.max(0, y1 - y0) : 0;

  const desc: number[] = [];
  for (const i of DESCRIPTOR_POINTS) {
    const l = s[i];
    if (trustedLandmark(l)) desc.push(((l.x - cx) * aspect) / scale, (l.y - cy) / scale);
    else desc.push(Number.NaN, Number.NaN);
  }
  return { pose, cx, cy, scale, area, desc, score: pose.score };
}

/** 两份描述子的平均点距（躯干长为单位），只数两边都可信的点。一个都没有 = NaN */
export function descriptorDistance(a: readonly number[] | null, b: readonly number[] | null): number {
  if (!a || !b) return Number.NaN;
  let sum = 0, n = 0;
  for (let i = 0; i + 1 < a.length && i + 1 < b.length; i += 2) {
    const dx = a[i] - b[i], dy = a[i + 1] - b[i + 1];
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
    sum += Math.hypot(dx, dy); n++;
  }
  return n >= 3 ? sum / n : Number.NaN;
}

/**
 * MediaPipe 在同一个人身上给两份（`numPoses > 1` 时偶尔发生）：中心几乎重合、尺度几乎一样。留分高的那份。
 * 顺序无关：先按分排序再逐个收，结果不随输入顺序变。
 */
export function dedupe(obs: readonly PersonObs[], aspect = 16 / 9): PersonObs[] {
  const sorted = [...obs].sort((a, b) => b.score - a.score || a.cx - b.cx);
  const out: PersonObs[] = [];
  for (const o of sorted) {
    const dup = out.some((k) => {
      const d = Math.hypot((o.cx - k.cx) * aspect, o.cy - k.cy) / Math.max(o.scale, k.scale);
      const r = Math.max(o.scale, k.scale) / Math.min(o.scale, k.scale);
      return d < PEOPLE.duplicateTorso && r < PEOPLE.duplicateScale;
    });
    if (!dup) out.push(o);
  }
  return out;
}

// ── 身份 ────────────────────────────────────────────────────────────────────

export type TrackState = 'tentative' | 'confirmed';

/** 一条轨迹此刻的样子。HUD 和工作台页直接显示它 */
export interface PersonTrack {
  id: number;
  state: TrackState;
  /** 最近一次匹配上的那份姿态（丢失期间是丢失前的最后一份） */
  pose: RawPose;
  cx: number;
  cy: number;
  scale: number;
  area: number;
  /** 出生到现在（秒） */
  age: number;
  /** 这一次丢了多久（秒）；这一帧被看见 = 0 */
  missing: number;
  /** 这一帧配对的代价；没配上 = NaN */
  cost: number;
  /** 从出生到现在动过没有（海报从来不动） */
  moved: boolean;
  /** 从墓地里认回来的次数 */
  reattached: number;
  /**
   * **这一帧**是丢了一阵之后重新配上（丢失超过 `tentativeGrace`，或从墓地认回来）。
   * 消费者据此清掉这个人的时间状态（姿态时钟、精化、稳定、生命力）：之前和之后之间不许插值 ——
   * 中间可能隔着一次换姿势，甚至是另一个人被认成了他（docs/50 §2.4）。
   */
  reacquired: boolean;
  selected: boolean;
  primary: boolean;
}

/** `reacquired` 只是一次新推理事件；重复渲染同一份 PeopleFrame 不能重复消费它。 */
export function isFreshReacquisition(freshInference: boolean, track: Pick<PersonTrack, 'reacquired'>): boolean {
  return freshInference && track.reacquired;
}

export interface PeopleFrame {
  /** 活着的轨迹（含还没转正的），按 id 升序 */
  tracks: readonly PersonTrack[];
  /** 拿到身体的轨迹 id。**顺序是拿到身体的先后**，不是位置 */
  selected: readonly number[];
  /** 主身体（弧线、读数、声音、取景跟它）。没有人 = null */
  primary: number | null;
}

export interface PeopleTracker {
  /** `aspect` 可随 Capture 换源更新；缺省沿用创建时的值。 */
  update(poses: readonly (RawPose | null | undefined)[], dt: number, aspect?: number): PeopleFrame;
  readonly current: PeopleFrame;
  /** 运行中改人数上限（控件条）。多出来的身体按"最后拿到的先让"退场 */
  setCap(n: number): void;
  readonly cap: number;
  /** 下一个会发出去的 id（给测试看"有没有乱发新 id"） */
  readonly nextId: number;
  reset(): void;
}

interface Internal {
  id: number;
  state: TrackState;
  pose: RawPose;
  cx: number; cy: number; vx: number; vy: number;
  scale: number; area: number; desc: number[];
  birthCx: number; birthCy: number; birthScale: number; birthDesc: number[];
  moved: boolean;
  seen: number;
  age: number;
  missing: number;
  cost: number;
  reattached: number;
  reacquired: boolean;
}

interface Ghost {
  id: number;
  cx: number; cy: number; scale: number; desc: number[];
  moved: boolean; reattached: number;
  /** 进墓地多久了 */
  since: number;
}

/** 活轨迹数的上限：穷举配对的矩阵不许长大（8 × 3 = 529 种部分配对） */
const MAX_TRACKS = 8;

export const clampCap = (n: unknown): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 1;
  return Math.max(1, Math.min(PEOPLE.hardMax, v));
};

/**
 * 一对（轨迹，观测）的代价。门限外 = Infinity。
 * 位置差按**轨迹的**尺度折成躯干长（离得远的人小，同样几个像素的位移代表更远的真实距离）。
 */
export function pairCost(t: Pick<Internal, 'cx' | 'cy' | 'vx' | 'vy' | 'scale' | 'desc' | 'missing'>, o: PersonObs, dt: number, aspect = 16 / 9): number {
  const lead = t.missing + dt;
  const px = t.cx + t.vx * lead, py = t.cy + t.vy * lead;
  const dPos = Math.hypot((o.cx - px) * aspect, o.cy - py) / Math.max(PEOPLE.minScale, t.scale);
  const dScale = Math.abs(Math.log(o.scale / Math.max(PEOPLE.minScale, t.scale)));
  if (!(dPos <= PEOPLE.gateTorso + PEOPLE.gateGrowthPerSecond * t.missing) || !(dScale <= PEOPLE.gateScale)) return Infinity;
  const dPose = descriptorDistance(t.desc, o.desc);
  return dPos + PEOPLE.scaleWeight * dScale + (Number.isFinite(dPose) ? PEOPLE.poseWeight * dPose : 0);
}

/**
 * 最优部分配对：穷举每份观测配哪条轨迹（或谁都不配）。总代价 = 配上的代价 + 没配上的每一边 `unmatchedCost / 2`。
 * 平局时按输入顺序取第一个 —— 输入按 id 与观测位置排过序，所以结果不随 MediaPipe 的输出顺序变。
 */
export function bestAssignment(cost: readonly (readonly number[])[], nTracks: number): { pairs: Array<[number, number]>; total: number } {
  const nObs = cost.length;
  const half = PEOPLE.unmatchedCost / 2;
  const used = new Array<boolean>(nTracks).fill(false);
  const pick = new Array<number>(nObs).fill(-1);
  let best = Infinity;
  let bestPick: number[] = pick.slice();
  const walk = (i: number, acc: number, matched: number): void => {
    if (acc >= best) return;
    if (i === nObs) {
      const total = acc + (nTracks - matched) * half;
      if (total < best - 1e-12) { best = total; bestPick = pick.slice(); }
      return;
    }
    for (let t = 0; t < nTracks; t++) {
      const c = cost[i][t];
      if (used[t] || !Number.isFinite(c) || c >= PEOPLE.unmatchedCost) continue;
      used[t] = true; pick[i] = t;
      walk(i + 1, acc + c, matched + 1);
      used[t] = false; pick[i] = -1;
    }
    walk(i + 1, acc + half, matched);
  };
  walk(0, 0, 0);
  const pairs: Array<[number, number]> = [];
  bestPick.forEach((t, i) => { if (t >= 0) pairs.push([i, t]); });
  return { pairs, total: best };
}

/** 漏桶：`on` 时攒，不在时以两倍速度漏。`people-probe.ts` 的探测窗口复用同一套滞回，不另起一套置信度 */
export const leak = (held: number, on: boolean, dt: number): number => (on ? held + dt : Math.max(0, held - 2 * dt));

export function createPeopleTracker(opts: { cap?: number; aspect?: number } = {}): PeopleTracker {
  const cleanAspect = (value: number | undefined): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 16 / 9;
  let aspect = cleanAspect(opts.aspect);
  let cap = clampCap(opts.cap ?? PEOPLE.defaultCap);
  let tracks: Internal[] = [];
  let ghosts: Ghost[] = [];
  let nextId = 1;
  let selected: number[] = [];
  const selectedAt = new Map<number, number>();
  let primary: number | null = null;
  let clock = 0;
  /** 动过的人连续在场多久（漏桶）。攒满 `staticYieldSeconds`，没动过的轨迹让出身体 */
  let movedHeld = 0;
  /** 换人的漏桶：[挑战者 id, 攒了多久] */
  let challenge: [number, number] = [-1, 0];
  let current: PeopleFrame = { tracks: [], selected: [], primary: null };

  function born(o: PersonObs): Internal {
    return {
      id: nextId++, state: 'tentative', pose: o.pose,
      cx: o.cx, cy: o.cy, vx: 0, vy: 0, scale: o.scale, area: o.area, desc: o.desc,
      birthCx: o.cx, birthCy: o.cy, birthScale: o.scale, birthDesc: o.desc,
      moved: false, seen: 0, age: 0, missing: 0, cost: Number.NaN, reattached: 0, reacquired: false,
    };
  }

  function absorb(t: Internal, o: PersonObs, dt: number, cost: number): void {
    const span = Math.max(1e-3, t.missing + dt);
    const k = 1 - Math.exp(-PEOPLE.velocityRate * dt);
    const lim = (v: number) => Math.max(-PEOPLE.maxSpeed, Math.min(PEOPLE.maxSpeed, v));
    // 丢了很久之后的第一帧不拿来估速度：那一段位移里有一次"被挡住时它走了多远"，不是速度
    if (t.missing <= PEOPLE.tentativeGrace) {
      t.vx = lim(t.vx + ((o.cx - t.cx) / span - t.vx) * k);
      t.vy = lim(t.vy + ((o.cy - t.cy) / span - t.vy) * k);
    } else { t.vx = 0; t.vy = 0; }
    t.cx = o.cx; t.cy = o.cy; t.scale = o.scale; t.area = o.area; t.desc = o.desc; t.pose = o.pose;
    t.reacquired = t.missing > PEOPLE.tentativeGrace;
    t.missing = 0;
    t.cost = cost;
    t.seen = leak(t.seen, true, dt);
    if (!t.moved) {
      const d = Math.hypot((o.cx - t.birthCx) * aspect, o.cy - t.birthCy) / Math.max(PEOPLE.minScale, t.birthScale);
      const p = descriptorDistance(o.desc, t.birthDesc);
      if (d > PEOPLE.movedTorso || (Number.isFinite(p) && p > PEOPLE.movedPose)) t.moved = true;
    }
    if (t.state === 'tentative' && t.seen >= PEOPLE.birthSeconds) t.state = 'confirmed';
  }

  function select(dt: number): void {
    const alive = new Map(tracks.map((t) => [t.id, t]));
    const confirmed = tracks.filter((t) => t.state === 'confirmed');
    movedHeld = leak(movedHeld, confirmed.some((t) => t.moved && t.missing === 0), dt);
    // 从没动过的（海报、墙上的人像）：一个动过的人**持续**在场 staticYieldSeconds，它才让出身体。
    // 当场让的话，一个人从几个站着不动的人面前走过，他们的身体会同时溶掉
    const yieldStatic = movedHeld >= PEOPLE.staticYieldSeconds;
    const keepable = (t: Internal | undefined) => !!t && t.state === 'confirmed' && (t.moved || !yieldStatic);
    selected = selected.filter((id) => keepable(alive.get(id)));
    // 上限被调低：最后拿到身体的先让，主身体最后让
    while (selected.length > cap) {
      const victim = [...selected].reverse().find((id) => id !== primary) ?? selected[selected.length - 1];
      selected = selected.filter((id) => id !== victim);
    }
    for (const id of [...selectedAt.keys()]) if (!selected.includes(id)) selectedAt.delete(id);

    const candidates = confirmed
      .filter((t) => t.missing === 0 && !selected.includes(t.id) && keepable(t))
      .sort((a, b) => b.area - a.area || a.id - b.id);
    for (const c of candidates) {
      if (selected.length >= cap) break;
      selected.push(c.id);
      selectedAt.set(c.id, clock);
    }

    // 满员时的挑战：场外最大的那个要比场上最小的（非主身体；上限是 1 时就是主身体）大 swapRatio 倍，持续 swapSeconds
    const outside = candidates.filter((t) => !selected.includes(t.id));
    const top = outside[0];
    const pool = selected.map((id) => alive.get(id)!).filter((t) => cap === 1 || t.id !== primary);
    const weakest = pool.sort((a, b) => a.area - b.area || b.id - a.id)[0];
    if (top && weakest && top.area > weakest.area * PEOPLE.swapRatio) {
      challenge = [top.id, (challenge[0] === top.id ? challenge[1] : 0) + dt];
      if (challenge[1] >= PEOPLE.swapSeconds) {
        selected = selected.map((id) => (id === weakest.id ? top.id : id));
        selectedAt.delete(weakest.id);
        selectedAt.set(top.id, clock);
        challenge = [-1, 0];
      }
    } else {
      challenge = [challenge[0], Math.max(0, challenge[1] - 2 * dt)];
    }

    if (primary === null || !selected.includes(primary)) {
      // 交接：场上拿到身体最久的那一个（它的身体已经在台上了，不新建）；同时拿到的按面积
      const next = [...selected].sort((a, b) =>
        (selectedAt.get(a)! - selectedAt.get(b)!) || (alive.get(b)!.area - alive.get(a)!.area) || a - b)[0];
      primary = next ?? null;
    }
  }

  function snapshot(): PeopleFrame {
    const out: PersonTrack[] = tracks
      .slice().sort((a, b) => a.id - b.id)
      .map((t) => ({
        id: t.id, state: t.state, pose: t.pose, cx: t.cx, cy: t.cy, scale: t.scale, area: t.area,
        age: t.age, missing: t.missing, cost: t.cost, moved: t.moved, reattached: t.reattached, reacquired: t.reacquired,
        selected: selected.includes(t.id), primary: t.id === primary,
      }));
    current = { tracks: out, selected: selected.slice(), primary };
    return current;
  }

  return {
    update(poses, dtIn, aspectIn = aspect) {
      aspect = cleanAspect(aspectIn);
      const dt = Number.isFinite(dtIn) && dtIn > 0 ? Math.min(dtIn, 0.25) : 0;
      clock += dt;
      const raw: PersonObs[] = [];
      for (const p of poses ?? []) {
        const o = observePerson(p, aspect);
        if (o) raw.push(o);
      }
      // 观测按位置排：穷举的平局规则因此和 MediaPipe 的输出顺序无关
      const obs = dedupe(raw, aspect).slice(0, PEOPLE.hardMax + 1).sort((a, b) => a.cx - b.cx || a.cy - b.cy);
      tracks.sort((a, b) => a.id - b.id);

      for (const t of tracks) t.age += dt;
      const matrix = obs.map((o) => tracks.map((t) => pairCost(t, o, dt, aspect)));
      const { pairs } = bestAssignment(matrix, tracks.length);
      const matchedT = new Set<number>(), matchedO = new Set<number>();
      for (const [oi, ti] of pairs) {
        absorb(tracks[ti], obs[oi], dt, matrix[oi][ti]);
        matchedT.add(ti); matchedO.add(oi);
      }

      // 没配上的轨迹：丢失计时；还没转正的丢一下就当没来过，转正的过了宽限进墓地
      const survivors: Internal[] = [];
      tracks.forEach((t, i) => {
        if (matchedT.has(i)) { survivors.push(t); return; }
        t.missing += dt;
        t.cost = Number.NaN;
        t.reacquired = false;
        t.seen = leak(t.seen, false, dt);
        if (t.state === 'tentative') { if (t.missing <= PEOPLE.tentativeGrace) survivors.push(t); return; }
        if (t.missing <= PEOPLE.graceSeconds) { survivors.push(t); return; }
        ghosts.push({ id: t.id, cx: t.cx, cy: t.cy, scale: t.scale, desc: t.desc, moved: t.moved, reattached: t.reattached, since: 0 });
      });
      tracks = survivors;

      for (const g of ghosts) g.since += dt;
      ghosts = ghosts.filter((g) => g.since <= PEOPLE.reattachSeconds);

      // 没配上的观测：先去墓地认亲，认不上才是新人。
      // 认亲按**全局**最近的一对先配（不是按观测顺序先到先得）：两个人先后离开又回来时，先回来的那个不许抢走另一个人的 id
      const free = obs.map((_, i) => i).filter((i) => !matchedO.has(i));
      const kin: Array<[number, number, number]> = [];
      for (const oi of free) {
        const o = obs[oi];
        ghosts.forEach((g, gi) => {
          const d = Math.hypot((o.cx - g.cx) * aspect, o.cy - g.cy) / Math.max(PEOPLE.minScale, g.scale);
          const r = Math.abs(Math.log(o.scale / Math.max(PEOPLE.minScale, g.scale)));
          const p = descriptorDistance(o.desc, g.desc);
          if (d <= PEOPLE.reattachTorso && r <= PEOPLE.gateScale && !(Number.isFinite(p) && p > PEOPLE.reattachPose)) kin.push([d, oi, gi]);
        });
      }
      kin.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      const usedO = new Set<number>(), usedG = new Set<number>();
      for (const [, oi, gi] of kin) {
        if (usedO.has(oi) || usedG.has(gi) || tracks.length >= MAX_TRACKS) continue;
        usedO.add(oi); usedG.add(gi);
        const g = ghosts[gi];
        const t = born(obs[oi]);
        nextId--;   // 认回来的不占新号
        Object.assign(t, { id: g.id, state: 'confirmed' as const, moved: g.moved, reattached: g.reattached + 1, seen: PEOPLE.birthSeconds, reacquired: true });
        tracks.push(t);
      }
      ghosts = ghosts.filter((_, gi) => !usedG.has(gi));
      for (const oi of free) {
        if (usedO.has(oi) || tracks.length >= MAX_TRACKS) continue;
        tracks.push(born(obs[oi]));
      }
      tracks.sort((a, b) => a.id - b.id);

      select(dt);
      return snapshot();
    },
    get current() { return current; },
    setCap(n) { cap = clampCap(n); },
    get cap() { return cap; },
    get nextId() { return nextId; },
    reset() {
      tracks = []; ghosts = []; nextId = 1; selected = []; selectedAt.clear(); primary = null; clock = 0; movedHeld = 0;
      challenge = [-1, 0];
      current = { tracks: [], selected: [], primary: null };
    },
  };
}

// ── 站位 ────────────────────────────────────────────────────────────────────

export interface LineupInput { id: number; cx: number; scale: number }

/**
 * 画面里的横向位置 → 舞台上的 x（米）。
 *
 * - 折算：画面里偏离中线 `(cx − 0.5)·aspect` 个画面高度，一个躯干长 = `scale` 个画面高度 = `PEOPLE.torsoMeters` 米。
 *   所以离得远的人（小）走同样几个像素，身体走得更远 —— 这是真实距离，不是像素。
 * - 镜像：乘 `MIRROR_X`（docs/04 §1 唯一定义处）。观众往自己右边走，身体往屏幕右边走。
 * - 组居中：减掉平均值。相机不动（docs/49 §3 用法 C），所以是身体们整体回到中线，不是镜头去追。
 * - 挤开：按 x 排序后相邻两具至少隔 `minGap`，然后夹进 `±maxOffset`。
 *
 * 只有一个人时返回 0：单人时身体永远在中线（这一版之前的行为，一个字都不变）。
 */
export function lineup(people: readonly LineupInput[], aspect = 16 / 9): Map<number, number> {
  const out = new Map<number, number>();
  if (people.length <= 1) { for (const p of people) out.set(p.id, 0); return out; }
  const xs = people.map((p) => ({ id: p.id, x: imageToStageX(p.cx, p.scale, aspect) }));
  const mean = xs.reduce((a, p) => a + p.x, 0) / xs.length;
  for (const p of xs) p.x -= mean;
  xs.sort((a, b) => a.x - b.x || a.id - b.id);
  // 相邻互推会渐近收敛（三个挤在一起时 8 遍还差 1e-5）；推到最大欠账 < 1e-9 为止，最多 64 遍
  for (let pass = 0; pass < 64; pass++) {
    let worst = 0;
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i].x - xs[i - 1].x;
      if (gap < PEOPLE.minGap) {
        const push = (PEOPLE.minGap - gap) / 2;
        xs[i - 1].x -= push; xs[i].x += push;
        worst = Math.max(worst, PEOPLE.minGap - gap);
      }
    }
    // 夹进舞台：从两头往里压，保持间隔（总宽放得下时一定放得下：3 × 0.8 < 2 × 1.3）
    const lo = -PEOPLE.maxOffset, hi = PEOPLE.maxOffset;
    if (xs[0].x < lo) { const d = lo - xs[0].x; for (const p of xs) p.x += d; }
    if (xs[xs.length - 1].x > hi) { const d = xs[xs.length - 1].x - hi; for (const p of xs) p.x -= d; }
    if (worst < 1e-9) break;
  }
  for (const p of xs) out.set(p.id, Math.max(-PEOPLE.maxOffset, Math.min(PEOPLE.maxOffset, p.x)));
  return out;
}

/**
 * 整具骨架横向平移 `dx` 米（主身体在多人时的站位）。返回新对象，不改输入 —— 输入是生命力 / 稳定器的状态链上的那一份。
 * `dx === 0` 原样返回同一个对象（单人那条路不分配）。
 */
export function shiftSkeleton<S extends { bones: Array<{ p0: [number, number, number]; p1: [number, number, number] }>; joints: Record<string, [number, number, number]> }>(sk: S, dx: number): S {
  if (!sk || !Number.isFinite(dx) || dx === 0) return sk;
  const joints: Record<string, [number, number, number]> = {};
  for (const k in sk.joints) { const v = sk.joints[k]; joints[k] = [v[0] + dx, v[1], v[2]]; }
  const bones = sk.bones.map((b) => ({ ...b, p0: [b.p0[0] + dx, b.p0[1], b.p0[2]] as [number, number, number], p1: [b.p1[0] + dx, b.p1[1], b.p1[2]] as [number, number, number] }));
  return { ...sk, joints, bones };
}

/** 非主身体的整体色：按会话种子与轨迹 id 从 `PEOPLE.tints` 里挑。确定、永远不是白色 */
export function tintFor(seed: number, id: number): readonly [number, number, number] {
  const h = Math.imul((seed ^ Math.imul(id, 0x9e3779b9)) >>> 0, 0x85ebca6b) >>> 13;
  return PEOPLE.tints[h % PEOPLE.tints.length];
}
