# Trapcode Recipe Harness (MVP)

Declarative recipes → reproducible After Effects / Trapcode Particular renders, driven
through the MCP file bridge. This is the MVP substrate for the NL-controlled effects plugin:
a recipe captures the **structural knowledge** (param sets, procedural expressions, camera
rigs) that param-name reasoning alone cannot supply, and the runner makes it reproducible
and inspectable.

## Why this exists

The gap test (see project memory) established a clean difficulty cliff:

| class | example | converges from param search? |
|-------|---------|-------------------------------|
| texture | golden dust | yes, ~2 visual-loop iterations |
| path | light beam | yes, ~2–3 iterations |
| **compositional** | **tornado** | **no** — needs a swept-angle emitter expression + a 3D camera rig |

The recipe is what encodes the compositional structure. `tornado.json` is the proof: it is
not a pile of tuned numbers, it's the *technique* (emitter sweeps angle to paint a cone;
comp camera reprojects it upright) frozen into a portable artifact.

## Usage

Prereq: AE open with **Window ▸ mcp-bridge-auto.jsx** panel, "Auto-run commands" checked.

```bash
node runner/recipe_runner.mjs recipes/golden-dust.json
node runner/recipe_runner.mjs recipes/tornado.json --timeout=180
```

Frames render to `output/<name>_t<time>.png`. The runner prints a per-parameter ok/fail
report (with value read-back) and the frame paths.

## Recipe schema

```jsonc
{
  "name": "golden-dust",              // used for comp/camera naming and output filenames
  "compName": "Recipe_GoldenDust",    // find-or-create target (idempotent)
  "comp": { "width": 1280, "height": 720, "fps": 30, "duration": 6 },
  "background": [0.02, 0.015, 0.01],  // BG solid RGB 0..1 (Particular renders on transparency); null to skip
  "effect": "tc Particular",          // effect matchName applied to the host solid
  "hostName": "Dust",                 // particle host solid layer name
  "params": [                         // [matchName, value, humanLabel]
    ["tc Particular-0146", 350, "Particles/sec"]
  ],
  "expressions": [                    // [matchName, exprString, humanLabel] — procedural motion
    ["tc Particular-0581", "…[x,y,z]", "Emitter Position"]
  ],
  "camera": {                         // null = no camera (texture/path effects); object = 3D rig
    "position": [640, 380, -1150],
    "pointOfInterest": [640, 430, 0],
    "zoom": null
  },
  "renderFrames": [4]                 // seconds; one PNG per entry
}
```

## Design decisions (each earned in the gap test)

- **File bridge, not MCP client.** The runner writes `ae_command.json` directly and polls
  `ae_mcp_result.json`; no MCP host needed. The bridge was forked to add a `runScript` case
  (arbitrary ExtendScript) — the stock whitelist can't enumerate params or save frames.
- **`params` is an ordered array, not an object.** Set order matters: some params are hidden
  until a mode enum reveals them. Arrays preserve order; objects don't guarantee it.
- **Per-param `try/catch` + value read-back.** A batch `setValue` dies silently on the first
  hidden/locked param and abandons the rest. The runner reports each param independently, so a
  recipe never fails opaquely.
- **`find-or-create` everything (comp, BG, host, effect).** The file bridge has no command-id
  idempotency — a retried write re-executes. Idempotent ExtendScript means re-running a recipe
  updates in place instead of spawning duplicate comps. (Verified: two runs → one comp.)
- **Expressions are first-class.** Procedural motion (swept emitters, wander, lean) is the only
  scriptable route to compositional structure. **Curves/gradients (Opacity/Color/Size over Life,
  CUSTOM_VALUE) are NOT scriptable** — those must ship as `.ffx` presets (next milestone).
- **Camera is a recipe field.** Particular auto-uses the comp camera; there is no "use comp cam"
  param. Adding a camera reprojects the particles, which is mandatory for any volumetric effect.

## Known gaps / next milestones

1. **`.ffx` preset application** — for curve/gradient params the expression route can't reach.
   Recipe would gain a `presets: [path, …]` field applied via `layer.applyPreset`.
2. **Hidden-param prober tool** — runtime probe of the mode→visibility dependency graph and
   undocumented enum ranges (e.g. Emitter Size mode 0577 only accepts 1–2).
3. **Multi-system / multi-layer recipes** — a portfolio tornado needs core + wisps + debris as
   separate systems plus a matte; the schema currently targets one effect on one host.
4. **Visual-loop scoring** — the runner renders frames; a scoring/critique step (LLM-in-the-loop)
   would close the tune loop automatically instead of a human reading each frame.
