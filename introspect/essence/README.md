# Essence index — per-plugin causal cards for the runtime router

The **essence card** is the compressed, reasoning-ready understanding of one effect: not its full
parameter dump (that's the `cards/` introspect card), but *what it fundamentally does, which few
params are the real levers, and how to configure it for a stated intent*. This is the artifact the
product's runtime router retrieves (coarse→fine) to turn "I want X feeling" into a configured
effect — and it's how the **causal-param-ontology moat generalises from Particular to every plugin**
(see PRD §八). Shallow-for-breadth (one essence card per installed effect, for routing) + deep only
for the Particular-class hard cases.

## The pipeline (cheap, because pro plugins have semantic names)

1. **introspect** (`introspect_effect.mjs "<effect>"`) → `cards/<Effect>.json`: every param's
   **semantic name** + matchName + type + range + default + enum span. For a professional plugin
   (BCC / Sapphire / Universe) this alone recovers most of the meaning — the params are named
   ("Glitch Intensity", "Block Size 1-7"), not opaque. (A live-project dump only shows numeric
   matchNames, which is why the essence step needs the introspect card's name↔matchName map.)
2. **visual probe** (only for the uncertain bits): sweep the look-driving params + small-range
   enums, render on a *textured* surface (a flat solid shows nothing for a glitch/displace effect),
   vision-read the deltas → ground "Block Size 1 = thin stripes, 7 = chunky blocks" etc.
3. **synthesize** → `essence/<Effect>.essence.json`: essence sentence, `when_to_use` routing tags,
   `key_levers` (name + matchName + range + plain effect), `enums_to_verify`, `config_recipes`
   (concrete param sets per intent), and `reasoning_hooks` ("make it subtler" → which dial, which way).

## Card format

See `BCC_Cross_Glitch.essence.json` (the reference implementation, 2026-07-19). Required:
`matchName`, `essence`, `when_to_use`, `key_levers[]` (each with matchName so the runtime can set it),
`config_recipes`, `reasoning_hooks`, `grounding` (how it was earned + confidence).

## Status

- **BCC Cross Glitch** — done (introspect + probe + synth). The user's most-used third-party effect
  (KillKiss ×49). Closes the "I read the values but not the meaning" gap surfaced by the brownfield
  dump: now `BCC Cross Glitch-10682371=95` reads as `Glitch Duration = 95`, and "make it subtler"
  maps to a concrete dial move.
- **Deep Glow** (`PEDG`) — done (introspect + 5-frame probe + synth). Bloom/glow. Fully semantic
  introspect; probe grounded Exposure=intensity (0 off / 6 blown white), Radius=reach (1500 wide
  wash), Threshold=luminance gate (200% → only brightest bloom). See `Deep_Glow.essence.json`.
- **BCC Textures** (`BCC_TEXTURES`) — done (introspect + 5-frame probe + synth). Grunge/texture
  overlay. Probe grounded Amount=overlay strength (0/40/100), Complexity=detail, View 2 = isolated
  texture map; Texture itself is a UI-only preset picker (CUSTOM, default canvas weave). See
  `BCC_Textures.essence.json`.
- **BCC Camera Shake** (`BCC_CAMERASHAKE`) — done (introspect + 2-frame static confirm + synth).
  MOTION effect — static probe only confirms frame displacement/overscan; shake dynamics
  (Amplitude/Speed) grounded on semantic names + model prior (limitation noted in card). Live dials
  are the `-10xx` group + Beat Reactor for audio-sync. See `BCC_Camera_Shake.essence.json`.
- **BCC Damaged TV** (`BCC4Damaged TV`) — done (introspect + 6-frame probe + synth). All-in-one
  broken-CRT composite (198 leaf params). Probe isolated each artifact generator: noise=snow,
  scanline alpha=CRT lines, color-gun offset=RGB split, lines=diagonal interference, degrade=
  desaturate; default composite = warp+roll-bar+torn edge. Break/roll are time-driven (noted). See
  `BCC_Damaged_TV.essence.json`.

## Card sub-types

- **effect card** (the 5 below): one third-party/native effect. `key_levers` = param dials.
- **expression-rig card** (`cardType: "expression-rig"`): a CLUSTER of expression-control
  pseudo-effects that together form a technique (a layout/transition rig, a template knob kit).
  Its generative payload is `driver_expression_patterns` — the reusable expressions the product
  can EMIT onto a target layer to reproduce the technique (PRD §八 D). See
  `Layout_Animator_Rig.essence.json`. Decoded statically from the user's own project bytes
  (ghost_effect_groups + expressions_unique) — no live probe; the rig IS its expressions.
- **spatial/ML card** (`cardType: "spatial-ml"`): effects whose LOAD-BEARING STATE is not scalar
  params but a mask / solve / mesh+pins / 3D scene (Roto Brush, 3D Camera Tracker, Puppet,
  Element 3D). The scalar card silently assumed "the effect's meaning IS its params"; here that
  breaks — the params are a *finishing/settings surface layered on an opaque core*. So the card's
  job is to draw the **capability boundary**, not describe more dials. New fields beyond the scalar
  card: `state_model` (WHERE the load-bearing state lives + structural proof), `scriptable_surface`
  (the partition the product CAN author, each tagged `phase: pre_handoff|post_handoff`),
  `opaque_core` (what it CANNOT create/edit), `capability_boundary` (`product_can[]` +
  `product_must_defer[]`, each defer = `{task, deferral_reason, user_action_asked, then_product_can}`),
  `perception_signal` + `state_gate` (the runtime predicate: is the core state present? → automate,
  else → issue the handoff). Reference: `Roto_Brush.essence.json`.

  **Product principle (this class establishes it): "gate the core, own the surface — never bluff the
  state."** When a request routes to an opaque-core effect, the product treats the load-bearing
  state as a *verified precondition*, not an assumption: run `state_gate` first; if the core is
  absent, DON'T synthesize a fake matte/solve/scene and DON'T silently apply the finishing surface as
  a result — pre-stage every setting it legitimately can, issue the single precise handoff (exact
  clicks), and resume automation the instant the state exists. The card tells the router *what it
  can't fake* — so "generalize to any plugin" never degrades into confidently applying dials to a
  matte that was never painted (PRD §八).

  **3-tier classification of the class** (by automatable share):
  - **Tier A — fully-scriptable** (`state_model: in-params`): **Bezier Warp** (all mesh points are
    animatable params → author any warp from scratch; only deferral is a `perceptual-judgment` to
    conform to image content); **BCC Chroma Key** (the *control case* — a keyer that looks spatial
    but is scalar-param; **stays a normal effect card**, the boundary marker proving the new fields
    are only needed once `state_model ≠ in-params`).
  - **Tier B — hybrid** (own settings + finishing + can pre-stage; defer the CREATE/SOLVE):
    **Puppet** (defer rig creation; once pins exist the whole motion is in-params), **3D Camera
    Tracker** (defer the Analyze solve + Create-Camera extract; pre-stage Shot Type/Angle before,
    drive the extracted Camera/Nulls after), **Roto Brush** (defer paint+propagate; own the 23-knob
    refine/decontaminate/motion-blur finishing surface after).
  - **Tier C — opaque-core-must-defer**: **Element 3D** (all 2431 params are inert until the user
    builds a scene in the modal Scene Setup — an `external-authoring` + `linked-file` handoff).
  Fingerprint the tier structurally: `customValue == 0` + all-scalar leaves ⇒ Tier A; a `customValue`
  param or a valueless data-group (Roto "Strokes", Element "Scene Settings", Puppet "ARAP") ⇒ opaque
  core ⇒ Tier B/C.

## Coverage so far

5 effect cards = the AMV third-party backbone: **BCC Cross Glitch, BCC Camera Shake, BCC Textures,
Deep Glow, BCC Damaged TV** (all introspect + probe + synth, all with semantic param names).

1 expression-rig card: **Layout / In-Out Transition Animator** (`Pseudo/0e3wiwbivl` + kit) — the
user's own MG rig, cross-genre-verified (AnoBando AMV ×1477 uses AND 语音房 marketing ×12). Maps
each opaque `Pseudo/<id>` matchName → its display name (Position In/Out, Corner Pin, Skew, Scale,
Optics, Mirror Edges, Motion Blur, Target, Angle Precision) and captures the driver-expression
templates that place driven layers off named controls. First card in the "generate + apply
expressions" capability.

1 spatial/ML card: **Roto Brush & Refine Edge** (`ADBE Samurai`) — the reference for the
`spatial-ml` cardType (canonical opaque-core hybrid). Draws the capability boundary: opaque core
(strokes+matte, fingerprinted by customValue 0 + valueless Strokes group) vs a 23-knob scriptable
finishing surface, with 4 precise handoffs (paint+propagate / re-propagate / fix-slipping-frame /
freeze) and a `state_gate`. Built from introspect + the state-model workflow (6 effects analyzed,
all with structural perception fingerprints) — no visual probe; the meaning is the boundary, not a
sweep. The other 5 (3D Tracker, Puppet, Bezier Warp, Element 3D, BCC Chroma Key) are
introspect-carded + tier-classified above, essence-synthesized on demand.

## Next candidates

- The other spatial/ML cards on demand: **Element 3D** as the Tier-C stress test (external-authoring
  + linked-file + the opaque `Scene Settings` blob), **Bezier Warp** as the minimal Tier-A contrast
  (fully in-params, `perceptual-judgment`-only deferral). Puppet + 3D Tracker when a request routes there.
- Wire `perception_signal`/`state_gate` into `dump_comp` so it flags opaque-core effects + whether
  their state is present (customValue / valueless-group detection) — the perception side of "gate the core".
- More of the user's OWN rigs from the same kit / other projects (the float-id Corner-Pin / Optics
  internals need the .ffx or a live UI read to fully enumerate — MEDIUM-confidence in the current card).
- AESweets Glitch 7in1, `uni.Unmult` (Universe) — other real-usage third-party effects.
- Filter suites at large (BCC/Sapphire/Universe, ~900 effects) stay introspect-card-only, essence-
  synthesized ON DEMAND when a request routes to them (the whole point of shallow-for-breadth).
