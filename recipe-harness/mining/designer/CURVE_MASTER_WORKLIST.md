# Curve-Master Worklist — over-life curves to draw for the master-clone route

Turns "over-life curves are extractable" (see `REPORT.md`) into "here are the exact masters
to draw." Over-life curves (Color/Opacity/Size/Velocity over Life) are AE `CUSTOM_VALUE`
properties that **cannot be set by script** — the only route is master-clone: an artist draws
the curve **once** in the AE UI on a master layer in `library/particular-masters.aep`, saves,
and recipes reference it via `master:{library,comp,layer}`. This file transcribes real vendor
curve data (from `mining/designer/extracted/**`) so an artist can reproduce each shape exactly.

## How to read the transcribed data

- **Color rows** are `pos% (R,G,B 0-255)`. Designer stores gradient position on a 0-200 scale;
  `pos% = PosP ÷ 2` (200 = end of life). A stop's color **holds** from its position to the next
  stop (and past the last stop to end-of-life). Enter these in Particular ▸ Particle ▸
  **Color over Life** gradient (R,G,B 0-255 as shown; AE's picker is 0-255).
- **Scalar rows** are `[life%, value]` pairs downsampled evenly from the vendor 201-pt LUT.
  Opacity value 1.0 = 100%; Size value is a fraction of the Size param (1.0 = full). Enter as an
  Arb curve in Particular ▸ Particle ▸ **Opacity over Life** / **Size over Life** — place a
  control point at each `life%` and drag to `value`; the shape between is a smooth spline.
- Curves flagged **[default rainbow — skip]** are the un-authored factory gradient
  (red→yellow→green→cyan→blue at 0/25/50/75/100%); do **not** transcribe them as color — those
  presets were chosen only for their authored *scalar* (size/opacity) curves.

## Master inventory (per project memory + recipe refs)

| Master comp | status | this worklist |
|---|---|---|
| `MASTER_particular_base` | EXISTS (clone source) | duplicate this for every new master |
| `MASTER_particular_S2` | EXISTS (aux/second system) | unchanged |
| `MASTER_particular_cloud` | EXISTS | **verify/refine** smoke size-grow + opacity curves below |
| `MASTER_particular_fire` | EXISTS | **verify/refine** black→orange→amber + fade curves below |
| `MASTER_particular_spark` | **NEW** | author from §3 |
| `MASTER_particular_dust` | **NEW** | author from §4 |
| `MASTER_particular_magic` | **NEW** | author from §5 |

> Note: **aux emission-over-life** (`FXid_EmissionOverParentParticleLifeArb`, 235 presets) was
> checked — it is **flat in 235/235** (no preset authored it), so there is no aux-emission
> curve to draw. Aux behaviour stays on `MASTER_particular_S2`'s existing params.

---

## 1. FIRE — black→orange→amber color + shrink/fade  ·  master EXISTS (`MASTER_particular_fire`)

Curves to set: **Color over Life** (warm gradient), **Opacity over Life** (fade), **Size over
Life** (shrink). The classic combustion signature: dark at birth, flash to saturated orange,
cool to amber, shrink and fade out.

### Exemplar A — Candle Flame (poster child, Glow Sphere, no sprite dep)
`extracted/TC14/smoke-and-fire-candle-flame.json`

Color over Life (black → saturated orange → amber):
```
  0%   (0,0,0)        black at birth
 18%   (255,42,0)     flash to saturated orange-red
 29%   (239,79,21)    orange
 84%   (213,141,56)   cool amber (holds to end)
```
Size over Life — smooth full shrink 1.0 → 0:
```
[[0,1.0],[10,0.91],[20,0.82],[30,0.73],[40,0.66],[50,0.59],[60,0.52],[70,0.43],[80,0.30],[90,0.16],[100,0.0]]
```
Opacity over Life — fast fade, long low tail:
```
[[0,1.0],[10,0.93],[20,0.82],[30,0.68],[40,0.47],[50,0.32],[60,0.24],[70,0.19],[80,0.15],[90,0.09],[100,0.01]]
```
Shape in words: color = black→orange-red by 18%→amber by 29%, hold amber; opacity = ~100%
held briefly then steep fade to ~30% by 50%, thin trailing wisp to 0; size = near-linear shrink
to nothing.

### Exemplar B — Simple Fire (Cloudlet flame, softer body)
`extracted/TC14/simple-fire.json`

Color over Life (2-stop tight orange):
```
 25%   (255,97,0)     orange
 75%   (243,68,0)     deeper red-orange (holds to end)
```
Size over Life — linear shrink `[[0,1.0],[20,0.80],[40,0.60],[60,0.40],[80,0.20],[100,0.01]]`
Opacity over Life — **in-out bell, peak@30%** (fades IN then out, unlike Candle Flame):
```
[[0,0.01],[10,0.57],[20,0.81],[30,0.88],[40,0.81],[50,0.61],[60,0.43],[70,0.31],[80,0.21],[90,0.11],[100,0.0]]
```

**Set on master**: use Exemplar A's color + size + opacity as the canonical fire master; keep
Exemplar B's in-out opacity bell as an alternate for soft cloudlet flames (rising fire).
**Unblocks** (scores.json): `fluid-shape`[5] (candle-flame, ink-drop, melted, bow-shock,
horizontal-stream), `fire-shape`[3] (hazy-fire, rocket-fire, smokey-fire), `aux-burst-density`[3]
(explosion-trail, fire-trails-1, fire-trails-2). **≈11 partials/fails.**
**Mined drafts that reference it**: `simple-fire`, `horizontal-fire`, `fire-motion`, `fireplace`,
`point-smoke` (all currently point at `MASTER_particular_fire`/`_S2`).

---

## 2. SMOKE / CLOUD — size grow-bell + opacity fade  ·  master EXISTS (`MASTER_particular_cloud`)

Curves to set: **Size over Life** (grow from a seed, then hold/settle — the expanding puff),
**Opacity over Life** (fade, or fade-in-then-out for a rising plume). Leave Color neutral/gray
unless a tinted smoke is wanted.

### Exemplar A — Smoke Hit (clean expanding puff, size-grow reference)
`extracted/TC14/smoke-hit.json`  · color = **[default rainbow — skip]**

Size over Life — grows fast then holds (the definitive smoke expansion):
```
[[0,0.01],[10,0.58],[20,0.89],[30,1.0],[40,1.0],[50,1.0],[60,1.0],[70,1.0],[80,1.0],[90,1.0],[100,1.0]]
```
Opacity over Life — linear fade full→0:
```
[[0,1.0],[10,0.90],[20,0.80],[30,0.70],[40,0.60],[50,0.50],[60,0.40],[70,0.30],[80,0.20],[90,0.10],[100,0.01]]
```

### Exemplar B — Dark Rising Smoke (Cloudlet plume, opacity fade-IN)
`extracted/TC14/dark-rising-smoke.json`  · color = **[default rainbow — skip]**

Opacity over Life — **in-out bell peak@30%** (fades in as it enters frame, then dissipates):
```
[[0,0.0],[10,0.40],[20,0.80],[30,0.93],[40,0.80],[50,0.67],[60,0.54],[70,0.40],[80,0.27],[90,0.14],[100,0.01]]
```
Size over Life — gentle shrink `[[0,1.0],[20,0.94],[40,0.84],[60,0.73],[80,0.47],[100,0.0]]`

### Exemplar C — Smoke Magic 2 (Cloudlet, real settling size-bell)
`extracted/TC14/smoke-magic-2.json`

Size over Life — grow to a peak@30% then settle (bell, not a hard hold):
```
[[0,0.02],[10,0.68],[20,0.91],[30,0.97],[40,0.96],[50,0.93],[60,0.91],[70,0.83],[80,0.73],[90,0.60],[100,0.48]]
```
Opacity over Life — linear fade `[[0,1.0],[20,0.82],[40,0.62],[60,0.42],[80,0.22],[100,0.02]]`
(Its color cyan→teal→rust is a magic-smoke tint — optional, not part of the neutral smoke master.)

**Set on master**: Exemplar A size-grow-and-hold + Exemplar A opacity-fade as the canonical
cloud/smoke curves; add Exemplar B's fade-in opacity bell as the "rising plume" variant.
**Unblocks**: `cloudlet-texture`[8] (fire-burst-1, ignition, smoke-puff-1, simple-smoke,
smoke-plume, smoke-rising-1, smoke-rising-2, smoke-trail), `size-over-life`[1] (basic-rising-smoke),
`cloud-merge`[3] (explode-out, explode-up, explode-up-dark), `blowout` smoke-explosion[1].
**≈13 partials/fails — the single largest curve-blocked bucket.**
**Mined drafts**: `cloud-cover`, `clouds`, `point-smoke`, `horizontal-smoke-2`, `basic-rising-smoke`.

---

## 3. SPARK / EMBER — sharp opacity fade + size shrink + hot color  ·  **NEW `MASTER_particular_spark`**

Curves to set: **Opacity over Life** (steep near-linear fade — the twinkle/burn-out),
**Size over Life** (linear shrink), **Color over Life** (gold→amber→red hot-ember gradient).

### Exemplar A — Spark Blast 2 (Glow Sphere, real ember color + sharp fade)
`extracted/TC14/spark-blast-2.json`

Color over Life (pale gold → amber → red — a cooling ember):
```
  1%   (226,212,97)   pale gold
 36%   (237,184,23)   amber
 82%   (255,45,5)      hot red (holds to end)
```
Opacity over Life — steep linear fade full→0 (each spark burns out fast):
```
[[0,1.0],[10,0.90],[20,0.80],[30,0.70],[40,0.60],[50,0.50],[60,0.40],[70,0.30],[80,0.20],[90,0.10],[100,0.01]]
```

### Exemplar B — Blast Sparks 2 (size-shrink reference)
`extracted/TC14/blast-sparks-2.json`  · color = **[default rainbow — skip]**

Size over Life — linear shrink 1.0 → 0 (spark contracts as it dies):
```
[[0,1.0],[10,0.90],[20,0.80],[30,0.70],[40,0.60],[50,0.50],[60,0.40],[70,0.30],[80,0.20],[90,0.10],[100,0.01]]
```

**Set on master**: Exemplar A color + opacity + Exemplar B size (they are parallel linear ramps —
color, opacity and size all decay together, giving a crisp fading spark). Falling Sparks
(`extracted/TC14/falling-sparks.json`) is pure opacity-fade only — the minimal "dim-faint" case.
**Unblocks**: `burst-streaks`[4] (blast-sparks-1, blast-sparks-2, spark-directional, spark-single),
`dim-faint`[1] (falling-sparks), `burst-spike-over`[1] (floating-cells), `ok` rising-embers[1].
**≈7 partials — highest-leverage NEW master.**

---

## 4. SNOW / DUST — gentle opacity in/out, size hold/settle  ·  **NEW `MASTER_particular_dust`**

Curves to set: **Opacity over Life** (soft symmetric fade-in / fade-out bell — particles ease in
and ease out, no hard pop), **Size over Life** (hold, optionally settle-shrink for dust).
Leave color neutral (white snow / warm-gray dust).

### Exemplar A — Large Snow 2D (canonical gentle bell)
`extracted/TC14/large-snow-2d.json`  · color = **[default rainbow — skip]** · size flat (hold)

Opacity over Life — symmetric in-out, wide plateau (peak 30–70%):
```
[[0,0.0],[10,0.35],[20,0.90],[30,1.0],[40,1.0],[50,1.0],[60,1.0],[70,1.0],[80,0.90],[90,0.35],[100,0.0]]
```
Shape: fades in over first ~25%, holds full through the middle, fades out over last ~25% —
particles never pop on/off. Size held flat at 1.0.

### Exemplar B — Dust Hit 01 (dust settle — same opacity bell + size settle-shrink)
`extracted/TC14/dust-hit-01.json`  · color = **[default rainbow — skip]**

Opacity over Life — same in-out bell as A:
```
[[0,0.0],[10,0.36],[20,0.90],[30,1.0],[40,1.0],[50,1.0],[60,1.0],[70,1.0],[80,0.90],[90,0.36],[100,0.0]]
```
Size over Life — hold then settle-shrink (dust drifts down and shrinks late):
```
[[0,1.0],[10,1.0],[20,1.0],[30,1.0],[40,1.0],[50,0.76],[60,0.48],[70,0.28],[80,0.14],[90,0.04],[100,0.0]]
```

**Set on master**: Exemplar A opacity bell + flat size = the snow master; add Exemplar B's late
size-shrink as the "settling dust" variant.
**Unblocks**: `dust-column`[1] (floating-dust), `blowout` large-snow-3d[1], `ok-partial`
blowing-seeds-wide[1], plus **8 reference-blocked `no-thumb` dust drafts** (dust-in-the-wind,
moon-dust, sparkle-dust, horizontal-dust, glitter, confetti, dust-hit-02, dust-hit-03) that gain
correct fade behaviour once the master exists. **≈3 direct + 8 latent.**
**Mined drafts**: `blizzard`, `blowing-snow`, `large-snow-2d`, `snowy-night-1`, `snowy-night-2`.

---

## 5. MAGIC / ENERGY — saturated color-over-life + soft pulse  ·  **NEW `MASTER_particular_magic`**

Curves to set: **Color over Life** (bright saturated multi-hue gradient — the defining trait),
**Opacity over Life** (in-out bell so glows twinkle), optionally **Size over Life** (pulse bell).

### Exemplar A — Magic Disc (Glow Sphere, cream → mint → orange)
`extracted/TC14/magic-disc.json`

Color over Life (bright, luminous 3-hue sweep):
```
  0%   (250,245,176)   pale cream-yellow
 47%   (113,234,162)   mint green
100%   (255,106,0)     orange
```
Opacity over Life — in-out bell (glow twinkles on and off):
```
[[0,0.0],[10,0.35],[20,0.90],[30,1.0],[40,1.0],[50,1.0],[60,1.0],[70,1.0],[80,0.90],[90,0.35],[100,0.0]]
```

### Exemplar B — Green Pixie (white-hot core → lime → green, with size pulse)
`extracted/TC14/green-pixie.json`

Color over Life:
```
  3%   (255,245,254)   white-hot core
 36%   (178,250,0)     lime
 84%   (76,222,28)     green (holds to end)
```
Size over Life — pulse bell (grows in, shrinks out): `[[0,0.0],[20,0.90],[30,1.0],[70,1.0],[80,0.90],[100,0.0]]`
Opacity over Life — bell peak@30%:
`[[0,0.06],[10,0.40],[20,0.80],[30,0.93],[50,0.67],[70,0.40],[90,0.14],[100,0.03]]`

### Exemplar C — Confetti (5-stop saturated multi-hue, for rainbow-energy variant)
`extracted/TC14/confetti.json` — a genuinely authored 5-color gradient (not the default rainbow):
```
  0%   (232,36,0)      red
 25%   (178,250,207)   pale mint
 50%   (0,86,201)      blue
 81%   (238,233,68)    yellow
100%   (204,32,92)     magenta-pink
```

**Set on master**: Exemplar A color + opacity as the canonical magic glow; keep Exemplar B
(white-core→lime→green + size pulse) and Exemplar C (5-hue confetti) as saved gradient variants.
**Unblocks**: `color-gradient`[3] (pastel-dots, simple-dots, northern-lights), `ok` magic-disc[1].
**≈4 partials** (plus improves fidelity of the 13 `magic` mined drafts: basic-magic, green-pixie,
energy-stream, glowfield, love-hearts, magical, particle-swarm, starflight, …).

---

## 6. Authoring procedure (per master)

1. Open `library/particular-masters.aep` in After Effects.
2. In the Project panel, **duplicate `MASTER_particular_base`** (Cmd-D) and **rename** the copy
   to the target comp name (`MASTER_particular_spark` / `_dust` / `_magic`; for fire/cloud open
   the existing comp to refine).
3. Select the Particular layer, open **Effect Controls ▸ Particular ▸ Particle**.
4. For each curve in the archetype's spec above:
   - **Color over Life** → open the gradient editor, place a stop at each `pos%` and set its
     R,G,B (0-255). Delete the factory rainbow stops first.
   - **Opacity over Life** / **Size over Life** → switch the graph to Arb/curve mode, then place
     a control point at each `life%` and drag to the listed `value` (opacity 1.0 = 100%; size
     1.0 = full Size). The spline between points reproduces the shape.
5. **Save** the .aep (same file, same layer index — recipes reference `layer:1`).
6. Recipes then reference it via `master:{ "library":"library/particular-masters.aep",
   "comp":"MASTER_particular_<name>", "layer":1 }` (same shape already used by
   `recipes/mined/simple-fire.json`).

## 7. Priority order (by curve-addressable partials in `scores.json`; 108 partial + 11 fail)

| # | Master | New? | Direct unblock | Why first |
|---|---|---|---|---|
| 1 | `MASTER_particular_cloud` (SMOKE) | refine | **≈13** | Largest bucket — `cloudlet-texture`[8] + `cloud-merge`[3] + size-over-life + smoke-explosion. Author the size-grow-and-hold + opacity-fade curves. |
| 2 | `MASTER_particular_fire` (FIRE) | refine | **≈11** | `fluid-shape`[5] + `fire-shape`[3] + `aux-burst-density`[3]. Verify black→orange→amber + fade. |
| 3 | `MASTER_particular_spark` (SPARK) | **NEW** | **≈7** | Highest-leverage new master: `burst-streaks`[4] + dim-faint + floating-cells + rising-embers. |
| 4 | `MASTER_particular_magic` (MAGIC) | **NEW** | **≈4** | `color-gradient`[3] + magic-disc; lifts 13 magic drafts' fidelity. |
| 5 | `MASTER_particular_dust` (DUST) | **NEW** | **≈3 (+8 latent)** | `dust-column` + large-snow-3d + blowing-seeds-wide; unlocks 8 no-thumb dust drafts. |

**Total curve-addressable: ≈38 of the 119 partial/fail recipes** (smoke 13 + fire 11 + spark 7 +
magic 4 + dust 3), on 2 refined + 3 new masters.
