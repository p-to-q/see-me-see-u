// Per-frame framing traces for docs/49 §6.6. Pure node, no browser, no deps.
//
// node scripts/framing/trace.ts --root <modules root> --fixtures <repo root> --out <dir> --tag <after|before> [--hz 60]
//
//   --root      where to import packages/core and packages/app/src from. The current worktree for "after";
//               an extracted `git archive <commit> packages/core packages/app/src` for "before".
//   --fixtures  where to import the synthetic scripts and the jump summary from (always the current tree,
//               so both runs replay the same timelines).
//
// "before" re-creates the old frame-loop wiring from the old API (no lateral offset existed: x = 0);
// "after" uses packages/app/dev/framing-sim.ts, which mirrors main.ts.
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (k: string, d?: string): string => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : (d ?? '');
};
const root = arg('root');
const fixtures = arg('fixtures', root);
const out = arg('out');
const tag = arg('tag', 'after');
const hz = Number(arg('hz', '60'));
if (!root || !out) { console.log('usage: --root <dir> --fixtures <dir> --out <dir> --tag <after|before>'); process.exit(1); }
mkdirSync(out, { recursive: true });

const af = await import(`${root}/packages/core/src/autoframe.ts`);
const tuning = await import(`${root}/packages/core/src/tuning.ts`);
const ps = await import(`${root}/packages/app/src/ui/preview-state.ts`);
const fr = await import(`${root}/packages/app/src/stage/framing.ts`);
const { SCRIPTS, scriptAt, scriptSeconds } = await import(`${fixtures}/packages/core/test/framing-people.ts`);
const { createSim, maxJumps } = await import(`${fixtures}/packages/app/dev/framing-sim.ts`);
const isNew = typeof af.stepLateral === 'function';

/** The old wiring (6439275): same order as main.ts then, old signatures, no lateral offset. */
function createOldSim() {
  const classifier = af.createFramingClassifier();
  const watch = ps.createSeeWatch();
  let crop = af.CROP_FULL, shot = af.SHOT_REST, legHold = 0, t = 0, previousProgress = 0;
  const trace: unknown[] = [];
  const aspect = 16 / 9;
  const B = fr.DEFAULT_BOUNDS;
  return {
    trace,
    step(input: { pose: unknown; dt: number; policy: string; hold: boolean }) {
      const dt = input.dt;
      t += dt;
      const r = classifier.update(input.pose, dt);
      const d = af.decide(input.policy, r);
      const seen = watch.update({ camera: true, pose: input.pose, upperIsIntended: d.upperIsIntended }, dt);
      const snap = seen.state !== 'ok';
      crop = af.stepCrop(crop, { active: d.upperIsIntended, snap, screen: (input.pose as { screen?: unknown })?.screen }, dt);
      legHold = af.stepToward(legHold, d.holdLegs ? 1 : 0, dt, tuning.AUTOFRAME.legBlendSeconds);
      shot = af.stepShot(shot, { shot: d.shot, offset: input.pose ? { x: 0, y: 0 } : null, reduced: false, hold: input.hold }, dt);
      // old fitCamera, verbatim math
      const mix = af.smoothstep(shot.progress);
      const fit = fr.blendFit(fr.fitFrame(B), fr.upperFit(1.71, B.width), mix);
      let h = fit.frameHeight;
      if (h * aspect < fit.frameWidth) h = fit.frameWidth / aspect;
      const dist = Math.max(0.8, tuning.STAGE.viewDistance - Math.min(1.0, B.depth / 2));
      const velocity = dt > 0 ? (shot.progress - previousProgress) / dt : 0;
      previousProgress = shot.progress;
      trace.push({
        t, dt, mode: r.mode, why: r.why, shot: d.shot, progress: shot.progress, velocity, eased: mix,
        fov: (2 * Math.atan((h / 2) / dist) * 180) / Math.PI, panX: shot.fx.x * mix, room: 0, legHold: af.smoothstep(legHold),
        see: { state: seen.state, reason: seen.reason, side: null },
        crop: { zoom: crop.zoom, cx: crop.cx.x, cy: crop.cy.x, active: d.upperIsIntended, snap, tx: null, ty: null },
        lateral: { x: 0, target: 0, deadZone: 0, why: 'none', side: null },
      });
    },
  };
}

const round = (v: unknown): unknown => {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1e5) / 1e5 : null;
  if (Array.isArray(v)) return v.map(round);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));
  return v;
};

const summary: Record<string, unknown> = {};
for (const [name, segs] of Object.entries(SCRIPTS) as [string, unknown[]][]) {
  const sim = isNew ? createSim() : createOldSim();
  const total = scriptSeconds(segs);
  const dt = 1 / hz;
  for (let i = 0; i * dt < total; i++) {
    const s = scriptAt(segs, i * dt);
    sim.step({ pose: s.pose, dt, policy: s.policy, hold: s.hold });
  }
  const jumps = maxJumps(sim.trace);
  summary[name] = jumps;
  writeFileSync(`${out}/${tag}-${name}.json`, JSON.stringify({ script: name, tag, hz, seconds: total, frames: round(sim.trace) }));
  console.log(`${tag} ${name.padEnd(10)} ${Object.entries(jumps).map(([k, v]) => `${k}=${(v as { value: number }).value.toFixed(4)}`).join(' ')}`);
}
writeFileSync(`${out}/${tag}-summary.json`, JSON.stringify(round(summary), null, 2));
