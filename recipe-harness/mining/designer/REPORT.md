# Trapcode Designer Preset Mine — format & extraction report

`parse_designer.mjs` walks every preset under
`/Users/Shared/Red Giant/Trapcode Packs/*/Presets/**` (read-only) and emits:

- `index.json` — one metadata row per preset (file, pack, effect, emitter/particle type,
  paramCount, hasCurveData, archetype, curveKinds, scene-system count, thumbnail flag).
- `extracted/<pack>/<slug>.json` — a normalized `{FXid → value}` param dump per preset,
  with sprite/footage refs bucketed under `refs` and **all over-life curve blobs preserved
  verbatim under `curves`**. Provenance is carried in `_mined_from` (full source path),
  `_pack`, `_category`, `_effect`, mirroring the `_mined_from` convention of `recipes/mined/`.

Re-run: `node mining/designer/parse_designer.mjs`. Pure file work; nothing touches AE or git.

## Format findings

Both extensions are **plain JSON** (UTF-8, no wrapper, no binary) — **625/625 parsed, 0 failures**.

| ext | what | container shape |
|-----|------|-----------------|
| `.xbxc` (263) | single-system "customs" | `{version,name,identifier,helpText,preview, groups[]}`; params at `groups[].blocks[].groups{}.params{}` |
| `.xbxs` (362) | multi-system "full scenes" | adds `customOptions`, `effectChains[<=16]`, `settingsBlock`; each chain is one system with the same `groups[].blocks[]...params{}` shape |

- **Effect identity**: `.xbxs` chains self-identify via `identifier` (`com.redgiant.tc.par.*`
  = Particular, `tc.form.*` = Form); `.xbxc` has no such marker, so effect is taken from the
  path (`/Presets/Particular/` vs `/Presets/Form/`) and cross-checked against the FXid
  namespace (`FXid_BaseShape*` => Form, `FXid_PType`/`FXid_EmitterBehaviour` => Particular).
- **`.xbxs` scenes are compositional**: the 16 chain slots are mostly default template stubs
  (often renamed "Untitled"); a chain counts as a real system only if it set an
  emitter/particle param. **334 of 362 scenes run 2-5 populated systems** (max 11:
  `Travel Plans`; 9: `Dramatic Explosion 2`, `Flashback`). This is exactly the multi-system
  layered-technique class the harness README flags as an open milestone — never mined before
  (the old `mine_xbxc.mjs` cataloged `.xbxs` by name only). `parse_designer.mjs` extracts each
  scene's **primary** (first populated) system and records `populatedSystems`.
- **522/625 carry an embedded base64 preview thumbnail** (`preview.b64data`) — vendor
  ground-truth renders. The extractor stores only a boolean, not the base64, to stay lean.
- Params are Designer `FXid_*` ids kept verbatim (no matchName mapping — that lives downstream
  in the recipe drafts). Colors are `{r,g,b}` 0-255 or arrays; vectors are arrays.

## Distributions (from `index.json._stats`)

- **Effect family**: Particular 548, Form 77. (No Mir/Tao — those products aren't in these
  packs. `.xbxc` customs are TC14/TC15; `.xbxs` scenes are TC14/TC17.)
- **Archetype guess** (name + category + hints): abstract 317, fire 89, magic 73, other 41,
  space 33, smoke 31, text 28, snow 9, rain 4.
- **Emitter types** (Particular, Designer enum): Point 207, Box 126, Sphere 110, Grid 24,
  Layer 24, Text 21, OBJ/Layer-Grid ~30. **Particle types**: Sphere 299, Streaklet 114,
  Glow Sphere 111, Sprite 52, Star 24.

## Curve-data encoding — the headline

**Over-life curves are fully readable structured data, and there are ~20 distinct curve
properties** (far more than the color-only picture in the old miner's notes). **624/625
presets carry at least one actively-authored over-life curve.** Two shapes:

**1. Color / gradient curves** — control points:
`{ PosP[] (life position), PosR[], PosG[], PosB[] (channel 0-1) }`.
Keys: `FXid_PColorOverLifeArb` (472), `FXid_SE_PColorOverLifeArb` (316, aux),
`FXid_ColorMapArb` (77, Form), `rg.custom.col.life[.aux]`.
Example — Candle Flame's flame gradient: `PosP [0,36,57,168]`,
`R [0,1,0.94,0.84] G [0,0.16,0.31,0.55] B [0,0,0.08,0.22]` = black->saturated-orange->amber.

**2. Scalar over-life curves** — dual form:
`{ isCurveMode, curveX[]/curveY[] (control points), samples[201] (baked LUT) }`.
The **201-point `samples` array is always present**, so a curve is recoverable as a lookup
even when control points are empty. Keys: `FXid_PSizeOverLifeArb` (472),
`FXid_POpacityOverLifeArb` (471), `FXid_PTModeOverLifeArb` (472, blend-mode-over-life),
`FXid_VelocityOverLifeArb` (229), `FXid_EmissionOverParentParticleLifeArb` (235, aux),
`FXid_SE_P{Opacity,Size}OverLifeArb` (316 each), plus Form's `FXid_SizeCurveArb`,
`FXid_AlphaMapArb`, `FXid_DisperseStrengthCurveArb`, `FXid_FractalStrengthCurveArb` (77-181),
and the parallel `rg.custom.{op,size,xfer}.life[.aux]` home.

**Answer for the lab**: yes — over-life curves (color gradient, opacity fade, size shrink/grow,
velocity, blend-mode, aux emission) can be extracted directly for master authoring. Each is
both an authoring representation (control points) and a ready-to-use 201-sample LUT. They are
still **not script-settable** into AE's CUSTOM_VALUE properties, so application stays on the
master-clone route — but the extracted blobs are exactly what's needed to *author* those
masters (fire gradient, cloud size-bell + opacity-fade) and to give the planner curve priors.

## Five recipe candidates

1. **Candle Flame** (TC14 Particular, `extracted/TC14/smoke-and-fire-candle-flame.json`) —
   single-system fire, Glow Sphere (no sprite dependency), carrying the **complete over-life
   triplet**: a real black->orange->amber color gradient + opacity fade + size curve. The poster
   child for authoring a `MASTER_particular_fire` curve set from vendor data.
2. **Dramatic Explosion 2** (TC14 Particular `.xbxs`, `dramatic-explosion-2.json`) —
   **9 populated systems** (core + sprites + debris + smoke), size+opacity+color curves. The
   canonical multi-system compositional recipe (README known-gap #3) — impossible from param
   search, exactly what a recipe must encode.
3. **Dark Rising Smoke** (TC14 Particular `.xbxs`, `dark-rising-smoke.json`) — Cloudlet smoke
   plume with size+opacity+color over life. Direct raw material for the still-open
   cloudlet-texture / size-over-life master class the harness flagged in rounds 9-10.
4. **Blizzard** (TC14 Particular, `blizzard.json`) — Box emitter, Sphere particles, 20 000
   particles/sec, all three scalar curves + `col.life`, **no sprite/footage refs**. Clean,
   immediately runnable weather effect — a low-risk validation win and a reusable snow element.
5. **Flight Landscape** (TC14 Form, `flight-landscape.json`) — effect-diversity pick: a Form
   Box-Grid terrain with color-over-life, representing the newly-extracted Form curve corpus
   (77 presets) and the compositional 3D-landscape technique.
