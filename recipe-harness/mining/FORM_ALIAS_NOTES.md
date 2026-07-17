# Form FXid → matchName alias map — offline curation notes (2026-07-18)

Scope: the 161 worklist FXids (`form_fxid_worklist.json`) mapped against the live card
`introspect/cards/tc_Form.json` (3021 params, F1 block + global tail = the settable scope;
F2..F8 are " FN"-suffixed clone blocks, never targeted). Evidence = normalized-name
correspondence + **modal-value vs card-default pairing computed from all 77 raw xbxc**
(re-tallied, reconciles exactly with the worklist n's) + the Designer group identifier each
FXid block carries **inside the preset itself** (`root.groups[].identifier`: Base Form /
particle / shading / Disperse and Twist / Fluid / Fractal Field / Spherical Field /
kaleidospace / Transform / World Transform) — that structural context resolves nearly every
display-name collision without guessing. **Nothing is settability-probed**; offline
lockedness is undetectable (Particular 0531/0694 lesson).

## Coverage (161 worklist ids)

| | count |
|---|---|
| mapped | **157** (via exact-name 86, default-pair 64, ranked-candidate 7) |
| skip (no runtime param) | 4 — `SE_Emitter` (aux/multi-form, always 0 in packs), `TextLayerSampling`, `FluidDensityBlendMode`, `FluidFrame0Attribs` |
| confidence | high **129** / med **28** / low **4** |
| enum +1 suspects | **28** (all flagged `enumOffsetSuspect`) |

67 default-pair claims verified numerically (modal(+offset) == card default) by the builder.
Plus **11 extra entries** not in the worklist recon (vector/color/layer-ref FXids found in the
raw packs — see below), total 172 keys in `form_alias_map.json`.

Low-confidence: `OBJSequenceControlType`→0541?, `FluidDensity`→0570 Buoyancy?, `TextDensity`
(0579 vs 0596 twin), `TextLayerSampling` (skip).

## Duplicate-display-name collisions (F1 scope)

Every one is group-disambiguated in the map; `candidates[]` lists all homes. The dangerous
ones (same Designer concept could live in either):

- **Shadowlet twins — the Unmult-class trap**: `Options_SmokeletShadow_{Color,ColorStrength,Opacity}`
  → Shading > Shadowlet Settings **0420/0421/0422** (defaults black/100/5 = Designer modals)
  vs Particle-level **0258/0259/0260** (grey/50/50). Default-pairing picks 042x, but
  Particular's precedent picked the particle-level home (0210-0212), and 23/77 presets author
  Opacity=50 — exactly 0260's default. MUST probe which is live.
- **Position two-homes**: 3D combiners vs legacy XY+Z pairs — 0517 Position vs 0010/0011
  (Base Form), 0527/0528 Sphere 1/2 Position vs 0188+0189 / 0196+0197, 0608 Kaleidospace
  Center Position vs 0206 Center XY. Which one scripts live is unprobed.
- Text density twins 0579 Edges / 0596 Faces (both default 100).
- Group-resolved name repeats: Size (0033 particle / 0252 glow), Opacity (0035/0253/0260/0422/0289),
  Color ×3, Color Strength ×2, Blend Mode (0037/0255/0279), Size Random (0017 strings / 0034),
  Random Seed (0301 texture d=1 / 0604 particle d=0 / 0290 streaklet / 0593 fluid),
  X/Y/Z Rotation ×3 (base form / sphere1 / sphere2), Strength ×9, Radius/Feather/Scale XYZ ×2,
  plus the layer-map/reactor repeat families (Layer, Map Over, Time Span, Invert Map,
  Strength Over/Curve/Offset ×5, reactor params ×5). And **every name recurs 7 more times**
  as F2..F8 clones — never target 2xxx+ ids.
- F1 has exactly ONE `Unmult` (0538) and ONE `Particle Type` (0024) — no hidden legacy twin
  *inside* F1 (unlike Particular), but lockedness still unprobed.

## Enum +1 suspects (28, Designer 0-based → AE popup 1-based)

BaseShape→0003[1..5], BaseShapeSizeOption→0489[1..2], OBJEmitFrom→0486[1..4],
StringTaperSize/Opac→0019/0020[1..3], PType→0024[1..12], PTMode→0037[1..4],
PLayerTime→0028[1..4], Glow_TransferMode→0255[1..3], SizeOver→0492[1..5],
OpacityCurveOver→0531[1..5], ColorMapOver→0042 Set Color[1..6], PShadow→0417[1..2],
PShadow_ZPos→0425 Placement[1..4], DisperseStrengthOver→0496[1..5],
FAffectPosPopup→0165[1..3], FractalABS→0175[1..2], FractalStrengthOver→0499[1..5],
KMode→0204[1..4], KBehaviour→0205[1..2], OBJSequenceControlType→0541[1..2],
PUnmult→0538[1..2], FluidMotionType→0555 Fluid Force[1..4], FluidForceOption→0591[1..2],
FluidRandomSwirlOption→0595[1..2], TextEmitFrom→0578[1..2], TextPathLoop→0586[1..2],
TextRGBUsage→0581[1..4].

All observed Designer value sets fit the +1 window (e.g. ColorMapOver {0,1,2,4}→⊆[1..6],
DisperseStrengthOver {0,1,3}→⊆[1..5]). **PType table** (best reconstruction, [1..12]):
1 Sphere / 2 Glow Sphere / 3 Star / 4 Cloudlet / 5 Streaklet / 6 Sprite / 7 Sprite Colorize /
8 Sprite Fill / 9–11 Textured Polygon variants / 12 Square — Form keeps variant types in the
popup (no Particular-style 0700/0701 booleans exist in the card). Pack evidence: Designer 4 =
Streaklet ("Streaklet Twist"), Designer 5/6/7 all carry sprite assets. Booleans mapping to
[0..1] ints (Normalize, Invert Z, Subframe, Flow Loop, Stroke Sequentially, Fluid Motion…)
take **no** offset.

## Layer/asset FXids (layer-connect route)

The packs never author Layer Maps or Audio React — Form's 122 LAYER_INDEX params have **no**
FXids here. The two real refs ride non-FXid keys:

- `FXid_PLayer` → **0027** Particle > Texture > Layer (`layerConnect:true`); the asset path is
  in `params["rg.p.sprite.id"]` `{uuid,footage}` with `${RootAssetPack}` (29 sprite refs:
  Bokeh/2D-Shapes PNGs). Texture opts (0028 Time Sampling, 0029 Clips, 0030 Subframe,
  0301 Seed) are sprite-gated: connect 0027 FIRST (Particular round-7 hidden-param lesson).
- `FXid_OBJLayer` → **0465** 3D Model > Model (`layerConnect:true`); path in
  `params["rg.bf.obj.id"]` (.obj files). AE can't script-import OBJ → expect the use-comp
  master route (Particular round-7a). 9 OBJ presets (BaseShape=3).

## CUSTOM / curve FXids (out of scope, inventoried)

`SizeCurveArb`→0493 Size Curve, `AlphaMapArb`→0481 Opacity Curve, `ColorMapArb`→0482 Color
Over (gradient; flatten → 0036 Color + Set Color 0042=1, same recipe as Particular),
`DisperseStrengthCurveArb`→0497, `FractalStrengthCurveArb`→0500. All are AE CUSTOM (90 on the
card incl. audio Strength Curves 0503+ and F2+ clones) — master-clone territory. The scalar
`*CurveOffset` companions ARE mapped (0494/0495/0498/0501, defaults 100).
`SizeCurveOffset` n=82 > 77: five presets carry a doubled Size/Rotation block.

## Extras (11 raw-pack FXids absent from the worklist recon)

`PColor`→0036 (flat color home), `Options_SmokeletShadow_Color`→0420 (twin 0258),
`BaseShapeCenter`→0010+0011 (3D twin 0517), `D1Pos`→0527, `D2Pos`→0528, `KCenter`→0608,
`KCenterXY`→0206, `RelativePosition`→0542, `FluidVortexRelPos`→0590, `PLayer`→0027,
`OBJLayer`→0465. **Value conventions**: centers are NORMALIZED comp fractions
([0.5,0.5,0] = center → x·W, y·H); inactive spheres/kaleido park at sentinel
**[-960,-540,540]** (do not translate blindly); PColor is {r,g,b,0-255}.

## Gating / write-order rules for the miner

1. Set **0003 Base Form** first — it gates String (0016-0020) / 3D Model (0459-0488) /
   Text-Mask (0577-0601) sub-blocks.
2. Set **0489 Base Form Size = 2** before writing Size Y/Z (0005/0006) — Particular-0577-class gate.
3. Sprite: connect **0027** before 0028/0030/0301; PType (Designer ≥5) must be set for the
   Sprite group to exist at all.
4. Shadowlets: **0310 Shading** (default 1 = off?) has NO FXid — when PShadow=1 (5 presets),
   0310=2 may need forcing.
5. Fluid: enable **0553** before other fluid params; Viscosity/Fidelity/TimeFactor/FlowSpeed
   live in **Global Fluid Controls** (instance-wide, not per-form).
6. Inert-at-default writes (IsPositionRelative, RWRelative*, all Text params, PLayerMultiClips…)
   can simply be dropped when value == card default.

## Probe worklist (MUST settability/effect-probe on a live bridge before trusting)

1. **0553 Fluid Motion** — locked-switch risk (Particular's Physics Model 0119 was locked).
2. **Shadowlet twins** 0420/0421/0422 vs 0258/0259/0260 (+ whether 0310/0417 gate them).
3. **0024 PType** full +1 table, especially 5..8 (sprite variants) — a wrong type = white-card class.
4. **0037 ← PTMode** blend-mode hypothesis (66/77 presets would flip to Add — high blast radius).
5. **0489 size gate** behavior and write order.
6. Position two-homes (0517 vs 0010/0011; 0527/0528; 0608 vs 0206).
7. "Over" popup option lists (0492/0531/0496/0499, 0042 Set Color) — +1 spot-check one of each.
8. 0543/0544 Relative-To-Primary on the primary form (possibly hidden/locked; values inert anyway).
9. 0538 Unmult settability (single instance, but Particular twin history).
10. Low-confidence trio: FluidDensity→0570 Buoyancy (sign semantics?), OBJSequenceControlType→0541,
    TextDensity→0579-vs-0596.

## Card-topology decode (reusable for future cards)

Named GROUP rows open topics, unnamed GROUP rows close them (id-block pairing, e.g. String
Settings 0015→0021, Audio React 0085→0157); **buttons are dumped as named GROUP rows with no
end marker** — Create Null 0609, Refresh 0466, Sprite (Choose Sprite) 0534, Light Name 0491 —
and 0490/0533 are unnamed hidden starts. The builder's stack walk with those six as no-ops
reproduces the full F1 topology (spot-asserted in `build_form_alias.mjs`, scratchpad).
