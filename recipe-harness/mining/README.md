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
