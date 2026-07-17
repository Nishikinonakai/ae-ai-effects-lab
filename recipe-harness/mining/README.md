# Vendor Preset Mining (Trapcode Designer → recipe drafts)

The Trapcode suite ships 548 vendor-authored Particular presets in **plain JSON**
(`/Users/Shared/Red Giant/Trapcode Packs/*/Presets/Particular/`): 186 `.xbxc` customs +
362 `.xbxs` full scenes. Each contains the scriptable param values (Designer `FXid_*` ids),
the **over-life curves as readable data** (`rg.custom.*.life`: sample arrays / gradient
stops), and an official preview render (base64 PNG).

`mine_xbxc.mjs` turns them into raw material for the recipe library:

```bash
node mining/mine_xbxc.mjs        # → catalog.json, drafts/<pack>/<name>.json, thumbs/
```

- **FXid → matchName mapping**: normalize (camel-split, prefix-strip) → curated alias table
  (incl. `@direct-matchName` overrides for the known collision traps: Size Random 0074 vs
  0775, Particle Type 0703 vs legacy 0026) → fuzzy fallback. Coverage ~46% of preset params
  (the rest are Designer-only options, OBJ/sprite refs, aux-system blocks).
- **Enum offsets**: Designer enums are 0-based, AE popups 1-based; `+1` applied to a curated
  set, marked `+enumOffset` in the draft labels. ASSUMED until loop-validated.
- **Physics guard**: the engine ignores Wind + Air Turbulence when Air Resistance == 0, and
  AE raises a MODAL warning if they're set anyway — which stalls the headless bridge. Since
  the vendor's own preview rendered with them inert, drafts DROP those params (recorded in
  `_dropped_inert`) rather than activating physics the vendor never saw. Verified A/B on
  fire-motion: AirResist 0 matches the thumb; clamping to 0.2 bends the plume away from it.
- **Drafts are unvalidated raw material.** Each carries `_map_coverage`, `_unmapped`,
  `_curves` (verbatim vendor curve data — not script-settable; the master-clone route
  owns application) and an `intent` referencing the vendor thumbnail, so the **tune loop
  is the validator**: run a draft, score against the thumb, let the loop fix residue.
- Verified on `drafts/TC14/fire-motion.json`: 33/35 params applied (Set Color enum-offset and
  VelSpread→Velocity Random both fixed and confirmed), render reproduces the vendor
  thumbnail's structure (upward directional spray). Known residue: Emitter Size Y/Z fail
  under a point emitter (hidden-param class; values were 0 — harmless).

**Licensing**: vendor content installed under the user's license — internal/local research
material only; do not ship derived recipes without clearance.

## Batch validation results (2026-07-15, all 186 drafts)

`validate_drafts.mjs` rendered every draft through the bridge (186/186 completed, zero
stalls, ~11s each, resumable JSONL); `make_sheets.py` built render-vs-thumbnail contact
sheets + pixel stats; agent-vision scored all pairs (`validation/scores.json`).

**23 match / 71 partial / 90 fail** — and the residue is highly clustered:

| class | n | root cause | fix (ranked by yield) |
|---|---|---|---|
| white-square | 32 | PType enum table wrong for textured types (Cloudlet/Smokelet/Sprite render as white squares) | probe 0703 empirically; fallback textured→Glow Sphere |
| sprite-obj | 26 | needs sprite/OBJ footage shipped in the packs | footage import layer, later |
| aux-trail | 20 | Options_Aux_* never aliased | alias round vs the TSV aux group |
| no-thumb | 19 | vendor shipped no preview | render-only plausibility (mostly fine) |
| color-gradient | 19 | Set Color=Over Life + unscriptable gradient → AE default blue | curve masters; cheap fallback = force Set Color→At Birth so the mapped flat PColor survives |
| ok-partial | 13 | density/size/faintness only | the tune loop can close these |
| blowout | 8 | flash/ring glow+size unit semantics | investigate scale mapping |
| burst-behavior | 7 | EmitterBehaviour=Explode was skipped | translate to a Particles/sec spike expression |
| fluid-physics | 7 | physics model param unmapped | map Physics Model + fluid params |
| light / emitter-enum / path / empty | 10 | no light layer; ring enum; path keyframes | addLight in runner; probe 0782 |

The 23 matches are usable recipes as-is; the 13 ok-partials are one tune-loop pass away.
Slug collision bug: `single-glow` and `triangles-2d` exist in two categories and overwrote
each other's drafts — include the category in the slug on the next mining round.

## Round-3 results (2026-07-16, all 186 re-validated)

Fixes landed: sprite-fallback (probed 0703 table: 1 Sphere / 2 GlowSphere / 3 Star /
4 Cloudlet / 5 Streaklet / 6 Square, >6 rejected), **thumbnail-dominant-color tint** on
texture loss (PIL pre-pass → `thumb_colors.json`), star-name → Star type, burst spike +
life-aware sampling, slug de-collision, aux SE_* aliases (dormant — see below).

**Trajectory: r1 23 / 71 / 90 → r3 32 match / 107 partial / 49 fail.**
The tint was the big win: entire categories went from white/wrong to vendor-hue particle
fields (icosas, tech-balls, stars, streak-brushes, smoke-magic/wizard, fire family).
ring-explosion became a clean usable ring element; point-explosion now matches density.

Round-4 queue (by yield):
1. **aux/S2 unlock (25 drafts)** — DONE via UI-assisted observer diff (see repo commits
   f1f05c0/0e2b881) + the round-5 miner translation below.
2. **burst-timing (10)** — DONE round-5: sample inside the emission window; life-scaled spike.
3. **texture-color without thumbs (19)** — open (category palette).
4. **ok-partials (14)** — open (tune-loop batch).
5. **sprite-obj (27)** — DONE round-4 (below).

## Round-4: sprite pipeline unlocked (2026-07-17)

Round-3's probe conclusion "0703: 6=Square, >6 rejected" was a MISREAD: **value 6 IS
Sprite — an unconnected sprite renders as a white card**, which the visual probe labeled
"Square". Verified with a peppermint-candy texture through the bridge, then blue-icosas
(true faceted icosahedra = vendor thumb).

Chain: runner `footage:[{path,layerName}]` (find-or-import by file path → video-off layer
in the comp) + `{"__layer":"<name>"}` param values resolved to layer indices at set time →
`0703=6` + `0066` (Sprite > Sprite Controls > Layer). Designer Colorize/Fill TYPE variants
map to v2023's separate 0700/0701 booleans; PLayerTime+1 → 0067 Time Sampling. PLayer refs
resolve `${RootAssetPack}` → the preset's own pack (53/58 exist on disk; 40 .mov + 18 .png,
both import). 52 sprite drafts re-validated, zero failures, zero stalls.

## Round-5: aux→S2 + gradient second home + fluid switch (2026-07-17, batch in flight)

- **aux→S2**: raw-xbxc scan shows **62 presets with ACTIVE aux** (SE_Emitter=2=Continuously
  — the only active value in the packs). Translation: `master: MASTER_particular_S2` clone +
  `2830=8` (Emit from Parent) + AUX_S2 table (see mine_xbxc.mjs; Size Random S2 is **2122**,
  not the name-twin 2823 from the strings block). Aux color has NO flat param: ColorFromMain%
  ≥50 → inherit the parent's final mined color; else flatten SE_PColorOverLifeArb; else
  classic white (the master's S2 red must always be overridden). S2 physics guard mirrors the
  main one. Verified: smoke-magic = pink cloud + white S2 spray, matches the vendor thumb.
  Known residue: 2236 Emit Probability is hidden (gated by 2752 From-Parent Behavior).
- **Gradient's second home**: candle-flame-class presets keep the color-over-life curve in
  `FXid_PColorOverLifeArb` (same PosP/R/G/B shape), not `rg.custom.col.life` — the flatten
  reads both now (candle: blue → flame-orange).
- **Fluid**: the live switch is **0638 Enable Fluid Motion** (Physics Model 0119 is locked —
  hidden-param class). Alias table pinned by Designer↔TSV default-value pairs (MotionType+1
  → 0615 Fluid Force, ForceOption+1 → 0636 Apply Force, VortexSize → 0618 Force Region Size).
  Color fixed; SHAPE residue: flame renders as a static dot — buoyancy/sim semantics unprobed.
- **Burst**: spike sized to psec×life within the 0.1s window; first sample frame at t=0.08
  (inside the window regardless of life).

## Round-6 RESULTS (2026-07-17 night): 44 match / 93 partial / 49 fail

Trajectory: r1 23/71/90 → r3 33/107/48 → **r6 44/93/49** — matches +33% in one
night; `promote_matches.mjs` shipped all 44 into `recipes/mined/` (the recipe
library's first bulk intake). Mean param coverage 56% → **73%**.

What moved: the sprite pipeline (icosas/cubes/stars/tech-balls/seeds/leaves/
snowflakes/bubbles/feathers now render true textures — 12+ new matches), the
TF remap (swirl-tracers/electron-dance went blob → thumb-matching swirls),
aux→S2 (smoke-magic/ghost-trail/firestarter/nebula-strings/blue-swarm show live
parent-emission), 0577 size-mode gate (clouds/cloud-cover wide emitters formed),
flat burst spike + t0.08 sampling (muzzle/flare flashes render; lens-flare
sprites at t0 are genuinely pretty).

New classes discovered by this round's scoring:
- **render-hang (12 fail)**: a specific burst subset (smoke-puff/hit, spark-*)
  JAMS AE's async frame renderer — reproducible on a fresh instance, killed two
  AE sessions tonight. Suspects: r6b streaklet params (0314/0315) × spike, or
  TF displace on heavy counts. NEEDS BISECTION (round-7 #1).
- **sprite-alpha (4)**: luma-keyed .mov sprites (fire/smoke family) render as
  visible CARDS — footage alphaMode/blend handling needed; the geometry .movs
  (icosas etc.) carry real alpha and are fine.
- **cloud-merge (6)**: explode-up family renders featureless pancakes — cloudlet
  size/count fidelity needs the curve masters (size-over-life).
- **aux-burst-density (3)**: S2 psec on spiked parents multiplies (white walls);
  needs S2-psec normalization when isBurst.
- **fluid-viz-suspect (1)**: candle-flame renders a cyan disc in batch context
  but flame-orange in single runs — 0629 Visualize Flow reads 1 and is LOCKED;
  0634 Visualize Relative Density defaults 1. Also the general saveFrameToPng
  degradation below.

**Ops discovery — saveFrameToPng degrades in long sessions**: heavy drafts whose
async renders exceed the 20s frame poll got dropped when the validator's
30-draft project-close killed pending renders; late in the night, mis-rendered
frames (another comp's buffer?) appeared. Mitigations for round-7: bump frame
timeout for heavy drafts, close-project less aggressively, verify frame counts
before scoring, restart AE between big batches (bridge_up.sh makes this free).

## Round-7a: user-assisted session (2026-07-17 morning) — 45 match / 95 partial / 46 fail

Three user reads + three clicks closed several fronts:
- **2752 Emitter-from-Parent Behavior enum (user-read)**: 1 Continuous / 2 Emit on Parent
  Bounce / 3 From Parent Speed / 4 At Parent End of Life. Classic aux "Continuously" = 1 =
  default → no draft changes needed. Screenshot also surfaced **"Particles/sec are % of
  Primary"** checkbox — the aux-burst-density lead (S2 psec semantics).
- **Fluid viz all Off (user-read)**: Visualize Relative Density is a dropdown (Off/Opacity/
  Brightness), Off; candle-cyan is therefore NOT a viz overlay → filed under the
  saveFrameToPng buffer-misattribution class. Fluid Force enum confirmed: "Buoyancy & Swirl
  Only" (our +1 mapping ✓).
- **OBJ masters (user picked 3 models)**: model refs survive project IMPORT but NOT
  copyToComp → runner gained `master.mode: 'use-comp'` (the imported master comp itself
  becomes the recipe comp; layer renamed + outPoint extended). Two traps found and fixed:
  (a) the mined emitter type must be FORCED to 6/3D-Model (Designer stores the artist's
  last pre-OBJ type — orbit came back Point, ring-emitter Text/Mask, wiping the model);
  (b) **a script-retimed comp stops rendering particles at its ORIGINAL duration** (probed:
  t=3.9 lit / t=4.5 empty with duration/outPoint/workArea all extended — plugin-private
  cap), so OBJ drafts render within the master's native 4s. Result: obj-emitter MATCH
  (icosa edge wireframe), fumes/orbit/ring-emitter PARTIAL (geometry right; fluid melt /
  streaklet trails are the residue). OBJ options mapped: 0535 Emit From (+1), 0539
  Normalize, 0537/0538 Sequence, 0578 Invert Z — gated to OBJ drafts only.
- **Licensing (user decision)**: mined recipes = local research; REWRITE as original
  param-sets before productization (provenance markers kept). Strategic corollary from the
  user: the product must generalize across AE/RG versions, languages, and translation
  quality via MODEL REASONING over runtime introspection — tables are reference priors,
  not the mechanism.

## Round-7 RESULTS (2026-07-17): 49 match / 102 partial / 35 fail

Trajectory: r1 23/71/90 → r3 32/107/48 → r6 44/93/49 → **r7 49/102/35**; 49
recipes promoted. Three fronts closed in one session:

1. **Render-hang dissolved** (13 drafts): the class was a harness artifact, not
   params — see the postmortem in queue item 1 below. All 12 "hang" drafts
   re-validated 2/2 frames in 4–15s on a clean session; verdicts: 10 partial
   (smoke/spark bursts render true), 2 burst-sampling fails → fixed (below).
   ring-explosion's genuinely slow frame traced to the S2-psec bug (next).
2. **S2-psec burst normalization**: parents each emit the aux rate, so spiked
   bursts multiplied child counts (ring-explosion: 19k parents × 450/s × 1s ≈
   8.6M particles at t1.9 = the "15-min frame"). 2194 ÷10 when isBurst →
   ring-explosion renders in 12s, a clean teal turbulent ring (partial,
   no-thumb).
3. **sprite-alpha SOLVED — the Unmult twin trap**: 0531 "Unmult" reads 1 but is
   WRITE-LOCKED and **inert**; the LIVE toggle is **0694** (default off). With it
   off, luma sprites composite as opaque cards: invisible on black, hard black
   occlusion rectangles at overlaps — which also HID most of the fire wall
   (foreground cards blacked out everything behind). 0694=1 + curated
   **0069 Blend Mode=Add** for fire-named luma sprites (Designer's preview is
   additive: white-hot overlap cores; smoke banks stay Normal) →
   falling-flares/fireplace/horizontal-fire/horizontal-smoke-2 all **match**.
   Probe methodology that found it: sweep all 7657 effect properties for
   name-matches and settability — Designer FXids can map to LOCKED display
   twins; the live param lives at a different id (S2 twin pair: 2579 locked /
   2742 live). Footage alphaMode was a red herring (fire .movs carry no alpha).
4. **Instant-flash sampling** (spark-single/directional + muzzle-flash family):
   life < 0.1s means everything is dead after the emission window (ticks at 0,
   1/30, 2/30) — post-window samples render empty (t0.112: 0 px; t0.08: 38k px).
   Burst sampling now uses [0.01, 0.08] when life < 0.1.

Validator hardening: 20s frame poll → 45s; `--drain=SEC` (default 90) keeps the
next draft off a saturated async queue and records late frames as ready;
pre-delete of target frame files (stale same-name PNGs satisfied the ready-poll
instantly and scored old pixels). bridge_down.sh: kill -9 + verify-dead +
queue-file reset (SIGTERM-surviving zombies raced the new instance on
ae_command.json — the "poisoned fresh instance" mechanism).

## Round-8 (2026-07-18): 49 match / 107 partial / 30 fail — colorize amount-slider discovery

Clean-session re-validation of 6 stale fails + the 19 colorize-carrying sprite drafts:

1. **0700 Colorize / 0701 Color Fill are 0-100 AMOUNT sliders, not booleans.** The r4
   sprite chain wrote `1` = 1% tint = invisible → the whole sprite-color residue (white
   triangles). Probed: 1 → white, 100 → full teal. **Corroborated by the artist's own
   hibana project** (brownfield survey: petals rig authors Color Fill = 100). Miner fixed,
   19 drafts regenerated + re-validated: triangles-2d ×2 fail→partial, stars ×3 / cubes
   stay match, no regressions.
2. **burst-sampling class CLOSED**: spark-directional/single render true cones/bursts on
   a clean session (the r7 [0.01,0.08] sampling fix works); residue is dots-vs-streaks
   (motion-blur/streaklet class), reclassed burst-streaks.
3. **fluid-viz-suspect class CLOSED**: candle-flame's cyan disc never reproduced on a
   clean session — it was the saveFrameToPng buffer-misattribution artifact. Renders a
   flame-orange glow core; residue = fluid buoyancy shape (no teardrop rise) → fluid-shape.
4. **sprite-missing reclassed**: the Triangle Fill.png refs EXIST on disk (import works;
   classification predated the path fix). wireframe-pyramids → obj-gated (needs the
   use-comp OBJ master route).
5. **New lead — Color S2 name-twins 2118/2598**: the miner's flattened S2 color goes to
   2118 (label sets fine, spray renders WHITE); the artist dump shows a second "Color S2"
   at 2598; add-testing 2598 on streak-brush-1 produced a full-frame white flood (S2
   psec interaction?). The streak-brush color route needs a settability/gradient probe —
   round-9 queue.
6. Brownfield note: `brownfield/aep_params.py` (new) extracts per-instance effect values
   from real .aep files — the artist-recipe survey it produced is in
   `brownfield/AMV_SURVEY.md` (ambient-dust / petals / text-dissolve / wind-dust rigs).

## FORM round-1 (2026-07-18): 25 match / 46 partial / 6 fail — 32% match on the FIRST round

`mine_form.mjs` + the offline-curated `form_alias_map.json` (157/161 FXids, see
FORM_ALIAS_NOTES.md) translated all 77 Form presets; two validation passes same night
(the second after the color-mode fix). Compare Particular r1: 12% match — the compounding
of five rounds of Particular lessons (write-order gates, enum offsets, sprite connects,
gradient flattens, physics/dialog hygiene) transfers across effects.

What worked first try: **sprite pipeline** (0024 6-11 + 0027 connect — Shape Grids
category went 10/16 match: chevrons/brackets/circles/arrows/hex render their true
textures), **fluid** (0553 enable — TC15 Fluid renders headless; single-drop close to
thumb), landscapes/spin-dots (dot-twister/sideways-twist/spiral-dots match), bokeh, the
gradient flatten (genesis red silk = match), string/fractal bases.

Fixed mid-round: **the r1 "green bias"** — flatten wrote 0036 but ColorMapOver 0042 had
been dropped as inert-at-default upstream, so Form's unscriptable DEFAULT teal-green
gradient kept rendering over the flat color (red-shard came out green). Forcing 0042=1
whenever the flatten runs re-colored 29 drafts.

Residue classes (round-2 queue):
1. **form-gradient-color (25 partial)** — color still rides a gradient the flatten didn't
   reach (plasma-things/red-shard/joy-division/flight-* stay default-green). Suspects:
   a second gradient home (Kaleidospace KColorArb? per-mode color maps?), or 0042=1
   lands a mode that ignores 0036. Needs one live probe of the 0042 option list + a
   raw-preset key census for color curves outside FXid_ColorMapArb.
2. **obj-gated (6 fail)** — Geometry category = BaseShape 3D-Model; use-comp master route
   (user picks models once, like Particular round-7a).
3. **form-blend-blowout (2)** — horizon-twist/ominous white-clip; test 0037 Add
   hypothesis vs Screen/Normal on one draft.
4. dim-faint (4) + ok-partials (15) — tune-loop material.

## Round-7 queue (by yield)

1. **Render-hang class — SOLVED 2026-07-17 (reverse bisect): the drafts are
   innocent.** Reverse-bisect from the r5 draft converged in 4 trials, all
   RENDER: r5+all-25-r6-params ✓, +r6 spike ✓, =r6 param set ✓, and finally the
   **verbatim r6 draft rendered in 11s** on a healthy session. The "class" was
   two compounding harness artifacts, not params:
   (a) **batch cascade** — in the r6 batch the 13 "hangs" are results.jsonl
   lines 151–162, a perfectly CONTIGUOUS run starting at ring-explosion, whose
   pathologically slow second frame (t1.9; still grinding after 10+ min solo)
   saturated AE's async saveFrameToPng queue; every draft behind it starved.
   (b) **poisoned "fresh" instances** — overnight single-draft repro trials ran
   after `pkill` (SIGTERM): a wedged AE that ignores SIGTERM survives alongside
   the new instance, BOTH panels poll the same ae_command.json, and the zombie
   swallows commands → "still no frames" on every trial regardless of params
   (4 orphan crashpad handlers found this morning corroborate). All of last
   night's single-group "eliminations" were this artifact.
   Fixes: frame poll 20s→45s in validate_drafts; ring-explosion needs its own
   treatment (cheaper second sample or per-draft frame budget); bridge_up.sh
   should kill -9 and VERIFY death before relaunch.
2. **Sprite alpha/blend** — root cause found 2026-07-17: the drafts already mine
   `FXid_PUnmult=1` → 0531, but **0531 lives in Sprite Controls and stays HIDDEN
   until the 0066 layer connect**, which the miner appended AFTER it → "Can not
   set value" → black cards. Miner now relocates 0531 past the connect (52 sprite
   drafts regenerated). Validation pending on the 5 sprite-alpha drafts.
3. **S2-psec burst normalization** (3) — divide S2 psec by spike factor. DONE
   2026-07-17: each parent emits the aux rate, so a spiked ring-explosion ran
   19k parents × 450/s × 1s child life ≈ 8.6M particles at t1.9 — the "slow
   frame" was this bug's render bill. 2194 ÷10 when isBurst.
4. **OBJ emitters** (4) — 3D Model group needs the model file connect; likely
  UI-gated (Choose Model button); check 2581 "3D Model S2"/main twin for a
  layer-param route (OBJ import into AE unsupported → may need the user once).
5. **Curve masters** (empty/cloud-merge/size-over-life classes, ~12 drafts) —
  the artist curve pass on MASTER_particular_* (user session).
6. PTMode semantics (0..5 enum, 186 presets) + fluid shape (buoyancy/vortex
  probe) + light-path class (needs animated emitter paths).

## Round-6 queue (aliases landed, validation pending)

Default-value-pair method (Designer default == TSV default pins the target) resolved:
- **Designer F\* = TURBULENCE FIELD, not Air Turbulence** — the old 'f affect pos'→0711
  target was even in the inert-drop set, so fire/smoke presets silently lost their
  turbulence. Now: displace 0042, affect-size 0041, fade-in 0045 (FAffectTime 0.5=0.5),
  scale 0046, complexity 0047, evolution 0052.
- **Particle rotation was never mapped** (alias keys said 'p rot *', Designer emits
  PRotate\*; 127 presets): 0136/0275/0276 + random 0137 + speeds 0138/0277/0278/0279/0282 +
  orient-to-motion 0726.
- Shading: PShade→0284, PShadeFalloffAdjust→0304 Nominal Distance (250=250), smokelet
  shadow color/strength/opacity → 0210/0211/0212. Glow_TransferMode+1 → 0218.
- Dropped: Gen1SubframePos (param removed in v18), PLayerTime (consumed by sprite connect).
