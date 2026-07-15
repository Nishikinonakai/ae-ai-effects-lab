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
