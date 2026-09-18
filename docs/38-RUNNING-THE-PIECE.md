# 38 · Running the Piece — setting it up in a room

> Written in English, like `AGENTS.md`, `02` and `34`: this is operating
> discipline, not part of the artwork (`docs/index.md` §语言).
>
> **Audience:** the person putting this installation in a room, who did not
> write it. It assumes you can open a terminal and a browser, and nothing else.
>
> **Every claim here is derived from the code, and each one names the file it
> came from.** Where a number appears, it is the number that file holds today —
> if you are reading this long after 2026-09-13, re-derive it rather than trust
> it (P21: a derived number is only true at the moment it was derived).
>
> What actually works is `docs/10-SURFACES.md`, not this file. This file tells
> you how to run it; that one tells you how far to trust it.

---

## 1 · Hardware

| Thing | What it needs | Where that comes from |
|---|---|---|
| Machine | Apple-silicon MacBook Pro, driving a 1440p display at 60fps | `docs/02` P5 — the whole performance budget is written against this machine |
| Browser | One with WebGPU. WebGL2 is a working fallback, not a target | `main.ts` reads `renderer.backend.isWebGPUBackend`; three.js falls back on its own (`docs/02` P3) |
| Node | **≥ 22.** The project runs `.ts` directly via type stripping; there is no build step for the source | `packages/factory/src/doctor.ts` fails the machine below 22 |
| Camera | See below | `packages/app/src/capture/webcam.ts` |
| Network | Only needed if the MediaPipe models are not on disk (§7) and for the slow loop (§8) | `webcam.ts` `resolveModel()`, `vite.config.ts` `/__slow` |
| Screen | Portrait or landscape both work; the body is framed life-size by the stage camera | `packages/app/src/stage/` |

### The camera, concretely

`webcam.ts` `#openCamera()` asks for exactly this:

```ts
getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
```

The two numbers come from `CAPTURE.requestedVideo` in
`packages/core/src/tuning.ts`. Four things follow from that, and they are the
four that decide whether a given camera is fine:

- **1280×720 is `ideal`, not `exact`.** A camera that cannot do 720p still
  opens, at whatever it can give. You will not get an error; you will get a
  smaller frame and worse tracking. If you want to know what you actually got,
  open `?debug=1` and watch the `infer` row.
- **No audio is ever requested.** The piece has sound, but it is synthesised in
  the browser; the camera's microphone is never opened.
- **The inference target is 30 Hz** (`CAPTURE.targetHz`), and rendering never
  waits for it (`docs/06` §1). A camera that only does 30fps is enough; one that
  does 60 buys you nothing here.
- **One person.** `PoseLandmarker` is created with `numPoses: 1`. Two visitors
  in frame is not an error state — it is one of them being tracked and the other
  not. Mark the floor.

Two further thresholds worth knowing before you aim the camera, both from
`CAPTURE`:

- `minScore: 0.5` — an average landmark visibility above this proves presence.
  A close visitor can also prove presence with a reliable shoulder or hip pair,
  so cropped legs no longer make the room look empty. The original average still
  drives whole-body quality readouts and warnings.
- `minJointConfidence: 0.4` — a single joint below this drops out of the motion
  statistics, which is what drives evolution. A visitor half behind a pillar
  grows more slowly, and that is the mechanism, not a bug.

**Secure context is required.** `getUserMedia` does not exist over plain
`http://` on a non-local host; `webcam.ts` throws a named error for exactly
this. On site you are on `localhost`, so this is fine. If you serve the build
from another machine on the LAN, you need `https`.

---

## 2 · What to open

### On site

```bash
npm install
npm run doctor          # machine self-check; changes nothing, prints no keys
npm run kiosk           # build + preview + opens /?kiosk=1&preview=on
npm run kiosk:fake      # same production path, but no Rodin credits
```

`npm run kiosk` (root `package.json`) builds and serves the production bundle,
then opens **`http://localhost:4173/?kiosk=1&preview=on`**. It also enables the local slow-loop
host and binds Vite to `127.0.0.1`; the credit-spending endpoint is therefore not reachable
from the venue LAN. That is the URL the installation runs on. Nobody types a second command afterwards — that is P10, and it is why
every on-site adjustment in §3 is a URL parameter rather than a rebuild.

Before using real generation, run `npm run kiosk:fake` once. It serves the same production
bundle through the same preview hook, but `SLOW_FAKE=1` substitutes an existing same-slot part
for Rodin. It proves the host and every downstream step without spending credits.

**Before doors open, turn off every auto-framing upstream of the browser.**
macOS Control Centre › Video Effects › **Center Stage off**; Windows Settings ›
Camera › Studio Effects › **Automatic Framing off**; do not use the NVIDIA
Broadcast virtual camera (Auto Frame); on a PTZ webcam (OBSBOT, Insta360) turn
face tracking off and lock the gimbal. They all frame the *face*, apply to every
app, and cannot be detected from the page — so they crop the legs out before
MediaPipe sees them and the piece switches itself to its upper-body shot for
every visitor. Check: walk slowly along one side of the frame; the *background*
in the top-left screen must not move. If it moves, something upstream is
cropping (`docs/49` §5.6).

Before doors open, also run the self-check page once on the show machine:

```bash
npm run selftest        # opens /?selftest=1
```

It checks WebGPU, camera permission, `parts.json`, the demo clips and the local
models, one line each (`packages/app/src/shell/selftest.ts`). It does not enter
the main program, and it loads even when the main program will not.

### On the web

**https://useeme.ptoq.io** — the deployed build. `u-see.me` is bought and is
the address the work is meant to end up on, but it is **not wired yet**
(`docs/13-DEPLOY.md` §7).

The web build is not the installation: it has no slow loop (§8), and it opens
on the entry wall-label rather than straight into the piece (§4).

### For development

```bash
npm run dev             # → http://localhost:5173
npm run dev:slow        # same, with the slow loop faked (SLOW_FAKE=1)
```

---

## 3 · Every URL flag that matters

Derived in full from `readFlags()` in `packages/app/src/shell/kiosk.ts`. Older
lists elsewhere in `docs/` are stale; this one was read off the function.

A flag is either **on-site** (you may reach for it with an audience in the
room), **setup** (you use it before doors open), or **debug** (never in front
of anyone).

| Flag | Default | What it does | When you use it |
|---|---|---|---|
> **Run kiosk with `&preview=on`.** On its own, `?kiosk=1` turns off the exits
> column, the nav, the HUD *and* the one visitor-facing degradation notice.
> Each of those is right by itself; together they leave the on-site
> configuration with **no outward signal at all**, so a dead camera and an
> empty room look identical and the piece can play to a wall all evening while
> the screen looks fine (`docs/36-DEGRADATION-AUDIT.md` D1). The small screen
> in the top-left is what breaks the tie: with no camera it says
> 「打开摄像头，它就能看见你」. It costs nothing and it is the only thing on
> screen that can report this failure.

| `?kiosk=1` | off | **On-site mode.** Hides the cursor, goes fullscreen on the first click anywhere, and turns the nav and the controls bar off. Also skips the entry layer, so the camera is requested at load (§4) | Setup. This is the installation's URL |
| `?demo=1` | off | Replays recorded pose data instead of opening the camera. MediaPipe's wasm and models are not even fetched on this path | On-site — the survival mode when the camera dies or the network is gone |
| `?clip=<name>` | auto | Picks the replay clip, with `?demo=1`. Three spellings all work: `walkturn`, `pose-walkturn.json`, `/demo/pose-walkturn.json`. Available today: `pose-walkturn`, `pose-jumpingjacks` (both real recordings) and `pose-synthetic`. With no flag it picks a **real** recording before a synthetic one | On-site, with `?demo=1` |
| `?theme=<id>` | chooser | Skips the species chooser and goes straight to that species. Also skips the entry layer | Setup — pinning the piece to one species for a short show |
| `?seed=<n>` | random | Reproduces one exact body. Note `?seed=` (empty) is *no seed*, not seed 0 — `readFlags` guards that trap deliberately | Setup, and any bug report |
| `?tier=<n>` | evolving | Locks the evolution tier | Debug |
| `?plan=<id>` | per species | Overrides the body plan (`docs/18`) | Debug |
| `?act=<id>` | Director picks | Locks one act (`docs/16`). Also skips the entry layer | Setup |
| `?scene=<id>` | per species | Overrides the stage scene. An unrecognised value is *not* silently ignored | Setup |
| `?model=lite\|full\|heavy` | `lite` | Swaps the PoseLandmarker tier (`docs/24` §3). An unrecognised value becomes null, and the capture side reports which tier actually loaded, so a typo never masquerades as the default | **On-site.** This is the one lever you have when backlight breaks `lite` |
| `?refine=0` | on | Turns off temporal refinement (One-Euro + occlusion hold + quality fallback) | On-site. Refinement is the only thing adding latency between the visitor and the data — if someone says "it feels slow", this proves or clears it in three seconds |
| `?vitality=0` | on | Turns off follow-lag and breathing | On-site, for the same reason: it is the line between "looks alive" and "reacts late", and it must be comparable on the spot |
| `?mute=1` | sound on | Kills sound completely — no `AudioContext` is even created. Pressing `m` while running also mutes, without a reload (`docs/29`) | On-site |
| `?nopost=1` | post on | Turns postprocessing off. **Degrade rung 1 also flips this to true on its own**, so reading it tells you whether the piece has already degraded itself | On-site, for chasing frame rate |
| `?preview=on\|off` | on for the web, off under `?kiosk=1`, **always off under `?demo=1`** | The small rounded screen in the **top-left** that answers "is it seeing me?" — the camera's own picture with the detected skeleton drawn on it, and a line of advice only when something is wrong. It opens no second camera and starts no second MediaPipe; it shows the video and the landmarks the piece already has. Under `?demo=1` it is not mounted at all and `?preview=on` will not bring it back: replay has no camera but *does* have someone else's landmarks, and a skeleton the visitor cannot move by moving is worse than no indicator. An unrecognised value (`?preview=1`) counts as unwritten, same rule as `?scene=` | **On-site** — reach for `?preview=on` when visitors are standing in front of the camera without realising anything is happening. It is off by default there only because the installation's frame is meant to carry no web furniture (`docs/23 §S4`); whether this venue wants it is a curatorial call, not a code one |
| `?wave=on\|off` | **on** | The chooser's **raise-a-hand scroll**: one hand above your own shoulder, held 0.75s, then swept sideways, browses the roster. It is the only input on that page that needs no device at all, which is why it defaults on. It is absent — with the page behaving exactly as before — when there is no camera, no permission, under `?demo=1`, before the web visitor grants the camera, and on the `?gl=off` DOM list. An unrecognised value (`?wave=1`, `?wave=yes`) is *not* silently read as on; the console prints which way it actually went at boot | **On site.** There is no mouse in the room |
| `?framing=auto\|full\|upper` | `auto` | Framing policy (`core/src/autoframe.ts`, `docs/49` §5). **auto:** a visitor showing only head, shoulders and hips gets a medium shot on the body's upper half, the legs settle into a still standing stance, and "step back" stops nagging about legs; stepping back returns to the life-size full shot within about a second. Under `?kiosk=1` auto is **full-first**: the medium shot needs the legs gone for 3 s (1 s on the web). **full:** always the life-size shot. **upper:** always the medium shot (desk demos). All three are overlays — the controls panel's Framing group (key `C`) switches them live, and choosing Auto hands back to the classifier. `?debug=1` shows two `framing` rows: mode, reason, seconds in mode, knee/ankle count and the torso-scale trend against their thresholds. An unrecognised value counts as unwritten and logs a warning | On-site: `full` if a venue wants life-size no matter what; otherwise leave it |
| `?nav=0` | nav on | Drops the top-right contents menu. Under `?kiosk=1` it is already off. It also gates the on-screen controls bar | Setup — for "projected but not kiosk" |
| `?exits=0` / `?exits=1` | on, but **off under `?kiosk=1`** | Gates the bottom-right column on the running work: **Back to the hall** (returns to the species chooser), **Give the body back** (the creature stops following the visitor and moves on its own — the camera stays on and capture keeps running), and a **Camera** on/off row that also shows whether it is currently watching. It is off under `?kiosk=1` on purpose: an unattended machine must not offer the public a way back to the chooser, because the first visitor presses it and walks away. An unrecognised value (`?exits=yes`) is treated as unwritten and logs a warning — it is never silently read as on or off | Setup — `?kiosk=1&exits=1` for an attended showing, `?exits=0` to drop it anywhere else |
| `?loading=0` | on | Drops the loading layer that sits over the chooser's ring | On-site — it lets you pull that layer in three seconds instead of rolling back a build |
| `?shading=toon\|physical` | per species | Forces the shading language. This is the only render flag that changes what a species *looks like*, which is why it is switchable live (`o` also toggles it) | Setup |
| `?debug=1` | off | Skeleton lines plus the numeric HUD (§5) | Debug |
| `?mirror=0` | mirrored | Turns mirroring off. **Never use this on site** — it exists to check coordinates, and the mirrored world is the one every line after `mediapipeToWorld()` assumes (`docs/04` §1) | Debug |
| `?selftest=1` | off | The pre-show self-check page. Does not enter the main program | Setup |
| `?cam=<n>` / `?cam=<deviceId prefix>` | browser's choice | Picks the camera (`capture/camera-select.ts`). On site one camera faces the visitors and the built-in one faces a wall, and the browser's own pick has nothing to do with which. Two spellings for two people: **an index** (`?cam=1`) is the *finding* tool — stand there with `?debug=1` and walk `0`, `1`, `2` until the HUD shows the right picture; **a deviceId prefix** (`?cam=3f9a1c0b`) is the *pinning* one, stable across replugs on the same machine and profile, and the only spelling a boot URL should use. An unrecognised value (`?cam=1.5`, `?cam=-1`) counts as unwritten, same rule as `?scene=`. "Named a camera that is not here" is a different thing and is **loud**: the HUD's `cam` row reads the deviceId of the track it actually got, not the one we asked for, and turns red on a mismatch | **On-site.** Pin the deviceId in the boot URL; the index will shift the next time someone replugs |
| `?gl=on\|off` | on | `?gl=off` forces the **no-WebGL path**: the chooser drops to the plain DOM list (`docs/23 §S2`) instead of the ring. It is the only way to exercise that path on a machine that *has* WebGPU — `navigator.gpu` cannot be taken away from outside before the page loads. Until 2026-09-13 this flag existed only on `/dev/choose.html`, while `choose.ts`'s own header cited it as proof the path had been run on the real program (`docs/36` D2). An unrecognised value (`?gl=0`, `?gl=false`) counts as unwritten and logs a warning — it never silently drops you into the fallback | Setup, and for any "does it still work without GL" question |

**Deep links skip the wall label.** `?kiosk=1`, `?demo=1`, `?theme=`, `?act=`
and `?plan=` each mean "I know what I want", so the entry layer is not mounted
(`wantsEntry()` in `entry.ts`). `?debug=1` and `?nopost=1` do **not** count as
intent, and leave the entry layer in place.

---

## 4 · Permission, and why it is late on purpose

Read the file header of `packages/app/src/shell/entry.ts` — the behaviour below
is a decision, and the reasoning belongs with it.

**The web branch never asks first.** The order is:

```
open the URL   → a wall label: title, one question, the metadata, two actions
press 「开始」  → a body driven by recorded pose runs. Still not one permission prompt
「用我的摄像头」 → the only place in the whole experience that requests the camera
```

The reason is stated in `entry.ts` and in `docs/PRD §8` / `docs/23 §S0`: a
stranger who opens this URL should not meet a browser permission dialog first.
Asking immediately loses most people, and the dialog covers the only thing that
could persuade them — the picture. So the piece shows itself working, with
somebody else's recorded body, and *then* offers to swap in yours.

Two operational consequences:

- **Refusal is not a failure state.** `mountCameraButton()` leaves the button
  in place when `use()` fails, because the replay is still running and the
  screen is not broken. What the visitor sees is "not me yet", not an error
  (`docs/23 §S1`). They can press it again.
- **`?kiosk=1` is the opposite, and that is also deliberate.** With no entry
  layer, `createCapture()` defaults to the webcam and the permission prompt
  happens at load (`main.ts`, `captureKindFromUrl()`). Nobody standing in front
  of an installation is going to press a "start" button. **So on site you grant
  the camera once, before doors open, on that origin — and then it never asks
  again.** Do this during setup, not while someone is watching.

One thing the copy promises that the code does not yet do: `docs/13 §5` calls
for an **opt-out** control on the page. The string exists (`ui/i18n.ts`
`privacy.optOut`) and nothing reads it. There is no opt-out switch today.

---

## 5 · Telling working from degraded, at a glance

You will be looking at this from across a room, mid-show. In order of how
quickly it tells you something:

**The picture itself.** A person is present and the body follows them within a
beat. Presence has hysteresis on purpose (`PRESENCE` in `tuning.ts`):
`enterDelay 0.4s` before it accepts somebody, `loseDelay 1.0s` before it accepts
they are gone, then a 2.5s dissolve. A body that flickers in and out faster than
that is a tracking problem, not a presence problem.

**The species name, bottom-left, for four seconds.** Shown once per visitor and
never again (`shell/notice.ts`, `docs/23 §S4`). If you never see it, the chooser
never committed.

**"降级渲染", bottom-right, for four seconds.** WebGPU was unavailable and the
renderer fell back to WebGL2. **This appears on the web only — on site it is
deliberately silent**, because a person standing in front of the installation
can do nothing about it and telling them is just noise. It is also deliberately
delayed until the loading layer has gone, or it would be covered.

**`?debug=1` and read the HUD** (`shell/hud.ts`). Every row is coloured against
`BUDGET` in `tuning.ts`, and **red means broken, not "optimise later"** (P5):

| Row | Good | Budget |
|---|---|---|
| `fps` | ≥ 55 | `minFps: 55` |
| `cpu` | ≤ 4 ms | `maxCpuMsPerFrame: 4` |
| `instances` | ≤ 64 | `maxInstances: 64` |
| `tris` | ≤ 250 k | `maxTriangles: 250_000` |
| `draws` | ≤ 40 | `maxDrawCalls: 40` |
| `infer` | ≥ 30 Hz | `CAPTURE.targetHz` |

Read **`fps`, not `cpu`**. They are not the same fact, and the project has been
burned by exactly this: a renderer spending 1–2 ms of JS per frame while running
at 9 fps, because the real time was on the GPU submit side (P21, and the comment
on `BUDGET.minFps`). Milliseconds hide a stall that frames per second cannot.

The HUD also carries three state rows that only appear when they are true:

- `idle 无人降帧中` — nobody for 300s, rendering throttled to 10fps
  (`shell/idle.ts`). **This is correct behaviour, not a fault.** An installation
  runs all day with an empty room; rendering an unwatched picture at full rate
  only heats the machine until it throttles at the moment somebody finally walks
  up. Movement, a keypress or a detected person restores full rate immediately.
- `degraded <stage>` — the piece has degraded itself (below).
- `errors <n>` — frames that threw. The frame loop never breaks (P2); it counts.

**Without the HUD, the degrade ladder is still readable**: it sets
`data-sb-degrade` on `<html>`, and fires a `sb:degrade` event
(`shell/degrade.ts`). The three rungs, cheapest first, each entered only after
the previous one failed to save it — 30 consecutive erroring frames per rung
(`safe-frame.ts`):

1. `post` — postprocessing off. The audience barely notices.
2. `placeholder` — fall back to procedural geometry. Ugly, but it always draws.
3. `reload` — reload the page. Two to three seconds of black, so it is last, and
   it is capped at **two reloads per session** so a broken machine cannot black
   out every few seconds forever.

Note for honest reading: rungs 1 and 2 flip the state and announce it, but the
stage and creature have not claimed their handlers yet
(`registerDegradeHandler`), so today their visible effect is partial. That is
recorded in `docs/10-SURFACES.md`, which is where you check it, not here.

---

## 6 · When it goes wrong

### No camera / permission refused

The symptom is a screen that still works: `webcam.ts` never throws out of
`latest()`, so the failure lands in `lastError` and the pose simply stays null.

1. Check the browser's site permission for the origin you are on — remember the
   kiosk origin (`localhost:4173`) and the dev origin (`localhost:5173`) are
   different sites with different grants.
2. `?selftest=1` will tell you which of "no camera device", "not granted" and
   "granted" you are in.
3. **Fall back**: `/?kiosk=1&demo=1`. The piece runs on recorded pose data with
   no camera at all, and the MediaPipe wasm and models are not even fetched on
   that path. Pick the clip with `?clip=walkturn` or `?clip=jumpingjacks`.

### Nobody is detected

The body needs either an average visibility above `CAPTURE.minScore` (0.5) or a
reliable shoulder/hip pair. A low number can therefore mean cropped legs rather
than an empty room; the little screen distinguishes that from poor tracking.
In order of what actually fixes it on site:

0. **Turn the little screen on: `?preview=on`.** It is the fastest way to tell
   the three failures apart without reading any numbers — nobody found, half a
   body in frame, or poor tracking each say a different line, and a working
   visitor gets silence plus their own skeleton. It also tells the *visitor*
   what to do, which no HUD row can.
1. **Light the visitor from the front.** Backlight is the known killer — it is
   why `?model=` exists at all.
2. **`?model=full`**, or `heavy`. Better landmarks at roughly +20% GPU for
   `full`; `heavy` is better again and roughly halves the GPU frame rate
   (`docs/24 §3`). Check the `infer` row afterwards.
3. **Check framing.** One person, whole body, facing the camera.
4. `?debug=1` and watch `infer`. If it is 0, the models never loaded — that is
   §7, not a lighting problem.

### Slow

1. `?debug=1` first, and read **`fps`**, not `cpu`.
2. `?nopost=1` — the cheapest large win, and the same thing rung 1 of the
   degrade ladder does by itself.
3. If `infer` is dragging the frame rate, go **down** a model tier, not up.
4. If `instances` / `tris` / `draws` are red, that is a content problem for a
   specific species, not a room problem — note the `?theme=` and `?seed=` and
   report it.
5. Check the machine is not simply hot. `idle 无人降帧中` exists precisely so it
   is not hot by the time a visitor arrives; if it never appears during a quiet
   hour, the presence signal is stuck at "someone is here".

### Blank screen

1. **`?selftest=1`.** It is a separate 8 KB chunk that loads even when the main
   program does not, which is the entire point of it.
2. Open the console. Boot failures land in `showBootError()`; frame errors are
   logged once each by `safe-frame.ts` (the same message is not repeated, so
   scroll up rather than assuming it happened once).
3. If it went black after running fine for hours, that is probably the graphics
   context being lost — `enterKiosk()` catches `webglcontextlost` and reloads
   after three seconds by itself. Wait four seconds before touching anything.
4. `parts.json` missing is **not** a cause of a blank screen: the app is
   required to run on placeholder geometry without it (P3, and it is an
   `AGENTS.md` invariant). If you are staring at placeholder capsules, that is
   the fallback doing its job — check `assets/parts/parts.json` shipped.

---

## 7 · The two things to put on the machine before doors open

Neither is in the repository, and both are silent about being missing.

**The MediaPipe models.** `webcam.ts` `resolveModel()` prefers
`assets/models/` and falls back to Google's model CDN. So without them the piece
still runs — **as long as the room has network**. Put them on disk:

- `assets/models/pose_landmarker_lite.task` (plus `_full` / `_heavy` if you
  intend to use `?model=`)
- `assets/models/selfie_segmenter.tflite`

The wasm runtime is already bundled locally and only falls back to jsDelivr if
the local copy fails to start.

**Real demo clips.** `assets/demo/` is what `?demo=1` replays. It currently
holds two real recordings and one synthetic placeholder, and the clip picker
deliberately prefers a real one — a synthetic body is never what you want in
front of an audience by accident (P18).

---

## 8 · Privacy — what leaves the machine

This section is load-bearing for the work's own argument, so it is derived from
the code rather than from the copy. Three facts, in the order a visitor would
ask them.

**1. The camera image never leaves the browser.** Pose estimation is MediaPipe
running in local wasm/GPU inside the page (`webcam.ts`). No frame, no video, no
still of the visitor is uploaded, saved, or written to disk by the runtime.
What the rest of the system sees downstream of `latest()` is 33 landmark
coordinates — the piece's own phrase for this is "it only ever sees your bones"
(`ui/i18n.ts` `privacy.short`), and that is literally what the data is.

**2. One image can leave, and only on the installation machine.** The slow loop
sends a **silhouette mask** — a black-and-white PNG of the visitor's outline,
drawn from MediaPipe's segmentation mask, with no photographic content — to a
3D generation model. Precisely:

- It is submitted to **`POST /__slow` on localhost**, a local Vite middleware
  (`vite.config.ts`). The Node side holds the API key and talks to Hyper3D
  Rodin; the key never enters the browser bundle (P8).
- The socket must be loopback. A request from the LAN gets the same structured 404 as a
  disabled host, even if Vite itself was started with `--host`.
- **It is not user-triggered.** `slow.ts` arms itself after
  `SLOW_LOOP.armAfter` = 20 seconds of continuous presence and fires at most
  `maxPerSession` = 1 time. Standing there is the trigger. (The `/about` and
  entry copy says "a silhouette you trigger yourself"; on site, the thing you
  do to trigger it is stay.)
- The resulting part and a row naming session id, time, species and slot are
  kept locally in the lineage pool, so the next visitor may inherit it.

**3. On the deployed web build, not even that leaves.** `/__slow` is a Node-side
host hook, not browser-bundle code. A normal production preview returns an explicit 404;
only the on-site command sets `SLOW_ENABLE=1`. Static Vercel deployment runs neither Vite
hook and has no endpoint. `docs/10`
records the check: after `npm run build`, `grep -rl "__slow\|slow-http\|RODIN_API_KEY" dist/`
is empty. So **on https://useeme.ptoq.io nothing at all is uploaded**; the piece
there is the fast loop only.

What this means for what you may tell a visitor, or print on a card:

- On the web: the camera image stays in their browser, and nothing is uploaded.
- On site: the same, plus one outline of them, once, after twenty seconds, to a
  generation service — not a photograph, not stored against their identity.
- Either way, no login, no account, no cloud state. The piece does not know who
  anyone is, and has nowhere to put it if it did (P10).

And the one thing not to claim: **there is no opt-out control today** (§4). If
the room needs one, the honest version is a sign and a second camera-free
station running `?demo=1`, not a checkbox that does not exist.

---

## 9 · Where to look next

- `docs/10-SURFACES.md` — what actually works, with an evidence column. The only
  trustworthy status.
- `docs/23-SPEC-ui.md` — every screen and every edge case, including the ones
  §5 above only summarises.
- `docs/13-DEPLOY.md` — deployment, domains, size and the privacy checklist.
- `docs/29-SOUND.md` — the four sound layers and how to tune or kill them on
  site.
- `docs/09-RISKS-AND-UNKNOWNS.md` — the on-site risk register, including the
  ones nobody has been able to test without a real room.
- `packages/core/src/tuning.ts` — every tunable number in the project, in one
  file. Every threshold quoted above lives there.
