# Planner eval — does the product loop work on novel requests?

Everything so far measured the LAB (can we translate vendor presets / probe params).
This measures the PRODUCT: NL request → **model-planned** recipe → render → vision
score → tune loop. The planner is the model reasoning over the enriched cards +
the recipe library as reference material — per the 2026-07-17 generalization
decision, recipes are priors the model reasons FROM, not tables it looks up.

## Question under test

Given the current library (55 Particular + 44 Form mined + 12 native stacks +
3 hand-grown + 21 cards), what fraction of realistic NL requests does the stack
land — one-shot, and within 3 tune-loop iterations? Where does it break: planning
(wrong structure), ontology (wrong params), or rendering class residue
(cloudlet/smoke etc.)?

## Prompt set

`prompts.json` — 24 prompts across three axes:

- **tier**: T1 texture/ambient (11) / T2 path+rig (7) / T3 compositional (6) —
  mirrors the original gap-test tiers, where the difficulty cliff lives.
- **family**: particular 12 / native 6 / form 3 / mixed 2 / any 1.
- **dist** (distance from the library): `in` 6 (a recipe covers it — sanity floor,
  should one-shot), `near` 11 (recombination: palette/motion/density deltas, e.g.
  fireflies = dust + flicker), `ood` 6 (no close recipe: fireworks, portal,
  rain-ripples, Text/Mask emitter), `vague` 1 (underspecified on purpose — tests
  curated defaults).

Expectations going in: in-dist one-shot ≥80% (anything less = harness/planner
bug, not knowledge gap); near pass@3 high; ood is the honest frontier — e20
(rain ripples, linked systems) is expected to fail and marks headroom.

## Protocol

Per prompt, in order:

1. **Plan** (in-session agent = the planner, same seat the product model takes):
   read the relevant recipes/cards first, then author
   `eval/plans/eval-<id>.json` — tune_loop plan schema (`intent`,
   `pass_criteria` copied from prompts.json, `name: "eval-<id>"`) plus
   provenance: `_planner_rationale` (choice → evidence) and `_planner_sources`
   (the recipe/card files actually consulted). Sources are a metric, not
   decoration — they measure library leverage.
2. **Run**: `node runner/tune_loop.mjs eval/plans/eval-<id>.json --max-iters=3
   --backend=agent --timeout=180` (bridge up first: `../bridge_up.sh`).
3. **Score** (agent backend): the loop exits 2 with
   `loop/eval-<id>/iterN/review_request.json`; the agent reads the FRAMES ONLY
   and writes `review.json` per `runner/review_schema.mjs`. Honesty rules:
   judge against `pass_criteria` literally; any core criterion absent caps the
   score at 5; pass threshold is the schema's verdict (embers precedent:
   8/10 = pass); remember stills under-sell lateral motion — read drift from
   population lean and t1-vs-t4 deltas before penalizing.
4. Repeat the tune_loop command until exit 0 (pass) or 1 (max-iters/dead-end).

Scorer and planner are the same agent — the guard is that scoring happens
against frames + written criteria, not intentions. Suggestion quality feeds the
loop exactly as in production.

## Ledger

`node eval/eval_status.mjs` scans `loop/eval-*/iter*/review.json` against
`prompts.json` and writes `eval/results.json` + prints the summary: per-prompt
rows (scores per iter, first/final verdict, pass iter) and breakdowns by
tier/family/dist — one-shot rate, pass@3, mean iters-to-pass, plus a
library-leverage column (#sources cited per plan).

## Output interpretation

- **one-shot rate by dist** = how far library+cards carry pure planning.
- **pass@3 − one-shot** = what the visual loop is worth (the moat's third layer).
- **ood failures** = the next mining/probing worklist, ranked by user value
  instead of vendor-preset frequency — this replaces the round-N queue as the
  source of work once mining saturates.

## Round-1 results (2026-07-18, full 24/24)

**one-shot 46% / pass@3 71% / mean iters-to-pass 1.4.** Gradients exactly as
the thesis predicts: tier T1 82% / T2 86% / T3 33% pass@3 (the compositional
cliff, same place the gap test found it); dist in 83% / near 91% / ood 33%
(library coverage drives success — near BEATS in because the loop turns
recombinations into passes); family: form 3/3, particular 9/12, native 5/6,
mixed 0/2 (cross-family composition is the weakest seam).

Standout passes: e18 smoke volume (the cloudlet residue class CLOSED by the
cloud curve master — billowing connected volume, 9/10), e09/e10 light-paths
(dual-psec + zero-velocity ribbon recipe), e16 fireworks (burst spike + shell
structure), e23 equalizer terrain, e12 Form sphere (0003=3 confirmed).

## Round-2 revisions (2026-07-19, post-forensics)

Re-run after the round-1 forensics (four fails re-planned). **Net: one-shot
46%→54%, pass@3 71%→79%; T1 82%→91%, T2 86%, T3 33%→50%, near dist →100%,
ood 33%→50%, native family →100%. ALL PHASE-A EXIT METRICS MET (T1/T2 pass@3
≥85%, T3 ≥50%).**

- **e17 魔法传送门 — FAIL(4/6/6/6/6) → PASS 9/10.** The portal was a slow pen-
  stroke: the emitter traced its circle only ONCE over the 4s clip (0.25 rev/s)
  so only a partial arc existed at any frame — misdiagnosed in round-1 as a
  density problem (the loop's `0146→8000` nudges did nothing, and the `0005`
  "live psec twin" was a myth — 0005 is Emitter-Type-Old, every setValue
  silently errored). Two fixes: (1) **swept-emitter FAST trace** (6 rev/s)
  repaints the full circle every ~0.17s → complete ring every frame; (2) the
  solid luminous annulus is a **native shape-layer** (elliptical glowing stroke),
  not Particular — glow-spheres only ever read as loose beads (capped 6/10). New
  runner primitive `shapes[]` (ellipse/stroke/fill/rotate/per-shape effects)
  makes the hybrid reproducible; Particular now only supplies bead sparkle on the
  ring edge + outer dust. Promoted to `recipes/native/native-portal-ring.json`.

- **e24 复古双色调海报 — FAIL(2/5/6) → PASS 9/10.** Design-panel synthesized a
  native stack; the win was resolving the **strict-two-tone vs visible-emboss
  tension** with a *base-binarize-then-emboss* architecture:
  `FN(Basic, BLOCK noise, static evolution) → Mosaic(sharp cells) →
  Posterize(2) [binarize the BASE] → Emboss(blend 78, on the binary field) →
  Tint(continuous, LAST)`. Binarizing the base BEFORE emboss means the only
  non-binary values Tint ever sees are the emboss lips at cell edges → pure
  navy/cream cells + grey-lip relief that reads as paper-embossed. Posterize
  AFTER emboss (or levels>2) muddies the palette; emboss AFTER tint desaturates
  it (the two round-1 failures). Promoted to `recipes/native/native-duotone-poster.json`.
  - **HARNESS GOTCHA found here**: find-or-create effects does NOT remove effects
    absent from the plan nor reorder shared ones — a stack REDESIGN on a reused
    host silently keeps the old effects underneath and appends the new ones out
    of order (scrambled render). For any stack redesign, delete the host's
    effects (or the comp) first. Reset scripts must match the exact `compName`.
- **e15 龙卷风 — 7/4/7 → spring SOLVED, score a variable 5-7 (still fail).**
  Box-emitter coil-fusion is the durable technique: Point emitter (0782=1)
  spawns every particle at the exact moving helix point → thin discrete coils
  (Emitter Size is IGNORED for Point). Switch to **Box (0782=2) + Emitter Size Y
  ≈ helix pitch** so each instant spawns a short vertical box that overlaps the
  pitch, fusing the swept helix into a continuous wall; a **constant-climb
  sawtooth** emitter path (not a triangle wave) kills the density bulges that
  come from dwelling at up/down turnarounds. Residual (uncrossed): taper-vs-
  cylinder, rotation-legibility, and perspective are mutually-trading complaints
  at the headless 2-still ceiling for a swept-point dust vortex; the GPT scorer
  is itself unstable on this frame class (5/6/7 across identical-config runs).

Mechanism facts discovered by the eval itself:
- ~~**0005 psec twin is STATEFUL**~~ **CORRECTED 2026-07-19 (e13 probe session)**:
  `tc Particular-0005` is **"Emitter Type Old"** — a legacy 1..10 popup (TSV idx 6),
  NOT Particles/sec. Every historical claim about "0005 live psec" was misattribution:
  **0146 IS the one true live Particles/sec** (verified: virgin instance, 0146=2000,
  Point type, velocity 0 → particles emit but STACK ON ONE PIXEL, reading as a single
  dot — the round-10 "0146 alone leaves near-zero emission" myth came from exactly this
  stacked-emission illusion; the light-path revival credited to "0005" was actually the
  0581 position expression spreading the stack out). The "Can not set value" errors on
  0005 = range violations (>10) or legacy-popup write locks. Plans must NEVER touch 0005.
- **Text/Mask emitter (0782=7) is UI-gated — mechanism now fully mapped (e13 probe
  session 2026-07-19)**:
  - The bake EVENT fires headless on *entry into type 7* — but ONLY if 0641 already
    points at the source layer (write-order rule: **connect 0641 first, set 0782=7
    last**; the original plan order 0782→0641 misses the event entirely). Firing is
    observable: the plugin synchronously creates a locked+shy sourceless LIGHT layer
    `TextLayerEmit [<name>]`.
  - Headless the bake produces EMPTY geometry (zero emission at any density); the
    actual glyph-outline extraction runs only on the UI thread's dropdown-selection
    event. Param refire / type retoggle / fx toggle / video toggle / mask donor /
    precomp donor / openInViewer+idle: all swept, none trigger extraction.
  - **0658 "Use Primary Layer"=1** (visible only on non-solid hosts — param visibility
    depends on HOST LAYER TYPE, new ontology axis) emits the plugin's FACTORY DEFAULT
    text geometry ("Trapcode"), proving the emission pipeline itself is healthy headless.
  - Under type 7 emission density is governed by 0780/0781 (edges/faces densities),
    not psec.
  - **HAZARD — instance wedge**: an effect instance that has entered type 7 headless
    can stop rendering ANY emitter type afterward (Box sanity probe: black). Recovery:
    delete comp + rebuild on a virgin instance. Never enter 7 speculatively.
  - **Layer emitter (0782=6) also fails to sample its connected layer headless** (valid
    connect at 0115, precomp source, video on/off, healthy 0146) — the v18 layer-source
    emitters appear to share the UI-side bake pipeline. Same UI-gate class.
  - Layer-INDEX selectors (6421 class) go stale when the layer stack shifts (helper
    insertion moved BG under the selector). Product rule: re-assert connects after any
    layer insert/remove.
  Round-11: UI-assisted observer diff remains the unlock path for this class.
- **Disc direction 0113=4 works headless** — expanding concentric ripple
  rings on a plane verified (e20's rings under an elevated camera).
- **tune_loop's applier cannot target instance N in a multi-instance stack**
  (e20: three iterations of suggestions, three pixel-identical renders) —
  harness fix: index-aware suggestion targeting.
- Noise HLS Auto2 Lightness renders ~6x its nominal scale; FN Fractal Type 2
  collapses to uniform at high contrast (degenerate-generator class); Emboss's
  grey blend desaturates duotones; fast small particles vanish under motion
  blur (dilution).
- Vague prompts (e22): the planner should adapt the closest CURATED recipe
  wholesale, not improvise particle-craft — three self-authored directions all
  missed taste.

Fail worklist by yield: (1) harness multi-instance targeting (unblocks e17/
e19/e20 class), (2) 0524 aspect/streak probe (rain-streak read), (3) Text/Mask
UI unlock, (4) tornado multi-system recipe authoring (core+wisps+debris — the
documented moat work), (5) pattern-generator class for print/geometric asks
(e24/e11 wanted crisp graphic bases native FN barely provides).
