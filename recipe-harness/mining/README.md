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
