# SEE-ME SEE-U

> SEE-ME SEE-U — a body that only stands up while you are standing there.

Stand in front of the camera and pick a species. A life-size synthetic body
comes alive on your skeleton and copies you — and the more you move, the more
elaborate it grows. Meanwhile your silhouette is sent to a 3D generation model;
about a minute later, a part generated from *you* is growing on it. That second
loop exists only on the installation machine — the deployed build linked below
is the fast loop alone.

**Live:** [useeme.ptoq.io](https://useeme.ptoq.io) ·
[what it is](https://useeme.ptoq.io/about) ·
[how it was made](https://useeme.ptoq.io/making) ·
[take your body home](https://useeme.ptoq.io/passport)

`u-see.me` is the address the work is meant to end up on: bought, registered
against the project, and not serving it yet — its nameservers still point at
the registrar's parking page ([`docs/13-DEPLOY.md`](docs/13-DEPLOY.md) §7).

![Position poster](assets/brand/poster-03-position-a1.png)

## Statement

> SEE ME. SEE U. NOT ME. BUT U. AND U SEE ME.

The artist's line, and the only English inside a statement otherwise written in
Chinese. The statement is set in full on
[`/about`](https://useeme.ptoq.io/about), with the five terms it is built on —
*datafication*, *Morphogenesis*, *zoë*, *simulacrum*, *distributed agency*.
Everything below this line is the engineering account of the same object.

## State

A reverse-engineered reconstruction of Universal Everything's *Future You*
(Barbican, 2019), with the layer that did not exist in 2019 — real-time AI 3D
generation — put back inside the interaction loop.

Re-derived from `assets/parts/parts.json` by running
`node packages/app/poster/build-data.mjs` on 2026-09-13: **29 roster entries**,
25 of which have parts of their own; **208 normalised parts** across 10 slots;
**9 body plans** in use — the seven skeleton remappings in
[`packages/core/src/bodyplan.ts`](packages/core/src/bodyplan.ts) (`rig`,
`quadruped`, `towering`, `stub`, `inverted`, `radial`, `column`), plus `mass`
and `swarm`, which replace the rigid body with a fused blob and a point field.
At tier 2 that is a combinatorial capacity of **1,446,403 distinct bodies** —
vacant entries that have never produced a part of their own are excluded from
the count on purpose. Re-run that command rather than trusting the numbers in
this paragraph.

**What actually runs is decided by [`docs/10-SURFACES.md`](docs/10-SURFACES.md),
not by this file.** The slow loop, the stage and the main chain are still marked
`experimental` there, and the main chain has only ever been driven by recorded
pose data — never by a real person.

## What it is not

- **Not a skinned character.** Bodies are chains of rigid parts. A deforming
  mesh would read as a game character; the point is that the material is visibly
  assembled. See [`docs/18-BODY-PLANS.md`](docs/18-BODY-PLANS.md).
- **Not real-time 3D generation.** Generation is a slow loop of roughly a
  minute, deliberately kept out of the frame loop. If it fails, the fast loop
  does not notice.
- **Not a framework.** Nothing here is built to be reused. It is built to survive
  one evening with an audience in front of it.
- **Not a product.** Original project source code is Apache-2.0; that licence
  does not turn the artwork, brand, fonts, geometry, demo data or sound into a
  reusable product.

## Run

Node ≥ 22.18.0 — the source is `.ts` run directly through Node's type stripping, so
there is no build step to develop against.

```bash
npm install
npm run doctor          # environment self-check
npm run dev             # → http://localhost:5173
npm run kiosk           # build + serve + open /?kiosk=1&preview=on — the installation itself
```

It runs with no assets at all (placeholder geometry). The one gate before
merging anything is:

```bash
npm run check           # typecheck + tests + part-contract check
```

## Read

Three files, in this order, and you can start changing things:

1. [`AGENTS.md`](AGENTS.md) — the reading route, the invariants, and the
   baseline self-check you run **before** you start;
2. [`docs/02-ENGINEERING-PRINCIPLES.md`](docs/02-ENGINEERING-PRINCIPLES.md) —
   the constitution, P0–P20, each principle carrying the incident that taught it;
3. [`docs/10-SURFACES.md`](docs/10-SURFACES.md) — the only trustworthy statement
   of what works, with an evidence column.

Then [`docs/index.md`](docs/index.md) routes you to the rest by need and marks
which documents are English and which are Chinese; do not read `docs/` end to
end. If you are setting the piece up in a room rather than changing it, the one
you want is [`docs/38-RUNNING-THE-PIECE.md`](docs/38-RUNNING-THE-PIECE.md) —
hardware, URL flags, permission, and what to do when it goes wrong.

Two rules from `AGENTS.md` decide where an edit belongs. Every tunable number
lives in [`packages/core/src/tuning.ts`](packages/core/src/tuning.ts) and
nowhere else; `packages/core/src/types.ts`, `docs/03` and `docs/04` are frozen
contracts you do not edit — you stop and report
`contract change needed: <reason>`.

## Structure

```
packages/core      pure logic (filtering, rig, attachment, evolution, genome) — zero deps, runs under node --test
packages/app       browser runtime (vite + three.js WebGPU + MediaPipe)
packages/factory   node (Hyper3D client, asset pipeline, slow-loop proxy)
assets/parts       normalised parts + parts.json    ← the only interface between runtime and factory
assets/raw         raw Rodin output (gitignored) + ledger.json (committed — it is what makes generation idempotent)
```

The repository, the root package and the workspace scope are all the work's own
name: `see-me-see-u` and `@smu/*`. One thing still reads `second-body`, and on
purpose: the **Vercel project**, whose name is what the live URL hangs off
([`docs/13-DEPLOY.md`](docs/13-DEPLOY.md) §7).

The asset factory needs a Hyper3D key and spends credits: its commands are in
[`docs/30-ASSET-INTAKE.md`](docs/30-ASSET-INTAKE.md), its prices in
[`docs/07-HYPER3D-API.md`](docs/07-HYPER3D-API.md).

## Licence

Original project source code is licensed under
[Apache-2.0](LICENSE), including its explicit patent grant. The standard
licence text is deliberately kept free of project-specific restrictions;
[`NOTICE`](NOTICE) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) carry
the attribution and scope inventory instead.

That inventory matters. The Viscose-derived opening method, real-machine
geometry, generated Rodin assets, ZKMSerendipity and LXGW WenKai fonts,
CC BY-SA demo-derived pose data, CC0 sound, brand material, and the artwork as
a staged installation retain their own terms. Apache-2.0 does not relicense
them or grant permission to re-stage the piece. Contributions follow the same
boundary; see [`CONTRIBUTING.md`](CONTRIBUTING.md).
