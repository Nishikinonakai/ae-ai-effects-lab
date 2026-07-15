# AE AI Effects Lab

Research lab for an NL-controlled After Effects effects system: describe an effect in natural
language → an LLM plans it (effect stacks, parameters, expressions, camera rigs) → a bridge
executes it inside AE → rendered frames are visually scored against the intent.

Everything here was built and verified against a live After Effects 2022 install with the
Trapcode suite, driven end-to-end through the bridge. One day of work (2026-07-13), but every
claim below is backed by a rendered frame or a machine-readable artifact in this repo.

## Architecture

```
                     NL request
                         |
                 [planner: LLM]  <-- reads enriched effect cards + recipe library
                         |
              plan / recipe JSON (effect stacks, params by matchName,
                         |         expressions, camera rig)
                         v
     recipe-harness/runner/recipe_runner.mjs  -- compiles to idempotent ExtendScript
                         |
        ~/Documents/ae-mcp-bridge/ae_command.json   (file bridge, polled)
                         |
        AE 2022 + mcp-bridge-auto.jsx panel (forked: + runScript)
                         |
              saveFrameToPng (async) -> output/*.png
                         |
                 [vision scorer: LLM]  -- same seam also enriches ontology cards
```

## Directory map

| dir | what it is |
|---|---|
| `after-effects-mcp/` | Vendored fork of Dakkshin/after-effects-mcp (see `patches/UPSTREAM.md`). Adds `runScript` — arbitrary ExtendScript through the bridge; everything else depends on it. |
| `gap-test/` | The 3-tier capability test that de-risked the product thesis, plus all rendered evidence frames (T1 dust / T2 beam / T3 tornado v1–v14). |
| `recipe-harness/` | Declarative recipe/plan runner (effect **stacks**, ordered params, expressions, camera rigs, frame renders; idempotent) + **`tune_loop.mjs`, the auto visual-tune loop** (render → vision-score vs intent → mechanical nudges → re-render until pass). Recipes: golden-dust, tornado, embers (loop-produced). Plans: smoke-bg, embers. |
| `introspect/` | Automatic effect-ontology pipeline: generic introspector (any effect → structural card) + visual causal probe (enum semantics from renders) + enrichment merger + production Claude-vision backend. |
| `patches/` | The fork's diff vs upstream + reproduction instructions. |

## What was established (each with evidence)

1. **Gap test — the difficulty cliff** (`gap-test/`): texture effects converge in ~2
   visual-loop iterations, path effects in ~3, compositional effects (tornado) do NOT converge
   from naive parameter search. The moat is structural knowledge, not parameter access.
2. **Hard Particular facts** (memory + `gap-test/particular_params_fixed.tsv`): 7657 flat
   params (8 systems × ~950); display names collide — ontology must key on matchNames; hidden
   params gated by mode enums; CUSTOM_VALUE curves unscriptable (→ .ffx presets); World
   Transform is a rigid render transform, not a force; funnels are painted by swept-angle
   emitters; Particular auto-uses the comp camera.
3. **Recipe harness** (`recipe-harness/`): one declarative schema covers both texture-class
   (golden-dust, 20/20 params) and compositional-class (tornado: expression + camera, 17/17).
   Idempotent re-runs (verified: no duplicate comps).
4. **Automatic ontology** (`introspect/`): one generic introspector generalizes across 7
   effects (7→107 params); the visual probe recovers enum semantics AE's API can't expose
   (Fractal Noise types → "soft clouds / block mosaic / marble veins / woven grid") and
   auto-surfaces its own blind spots (temporal enums, context-gated params) as card caveats.
5. **First end-to-end NL loop** (`recipe-harness/plans/plan-smoke-bg.json`): "深青蓝色缓慢流动
   的烟雾背景" → card-guided plan (Fractal Noise form + Tint color as an effect stack +
   evolution/drift expressions) → 10/10 params → frames verified against intent, one shot.
   Native effects proved far more LLM-tractable than third-party (semantic names, real ranges).
6. **The tune loop, closed** (`recipe-harness/runner/tune_loop.mjs`, 2026-07-15): plan →
   render → vision-score vs intent → typed suggestions applied mechanically → re-render,
   as a re-entrant state machine with two interchangeable scorer backends (in-session agent /
   Claude API) writing one review schema. Verified live: embers plan, 6/10 → 8/10 PASS in
   2 iterations, promoted to `recipes/embers.json`. Recipes are now GROWN by the loop.
7. **Zero-manual-step bridge bootstrap** (`bridge_up.sh`, 2026-07-15): the bridge panel is a
   plain ScriptUI palette, so AppleScript `DoScriptFile` can launch it — no Window-menu
   click. A cold Mac reaches a live bridge fully unattended.

## Running

Prereqs: AE 2022 installed with the bridge panel (see `patches/UPSTREAM.md`), "Allow Scripts
to Write Files and Access Network" enabled, Node 18+.

```bash
# bring the bridge up from cold — launches AE + the panel, no manual clicks
./bridge_up.sh

# recipes / plans
node recipe-harness/runner/recipe_runner.mjs recipe-harness/recipes/golden-dust.json
node recipe-harness/runner/recipe_runner.mjs recipe-harness/plans/plan-smoke-bg.json

# auto visual-tune loop (agent backend pauses for in-session review; api is headless)
node recipe-harness/runner/tune_loop.mjs recipe-harness/plans/plan-embers.json
node recipe-harness/runner/tune_loop.mjs recipe-harness/plans/plan-embers.json --backend=api

# ontology pipeline for any effect
node introspect/introspect_effect.mjs "ADBE Fractal Noise"
node introspect/auto_probe.mjs introspect/cards/ADBE_Fractal_Noise.json
# vision step: in-session agent, or production backend:
#   ANTHROPIC_API_KEY=... node introspect/vision/claude_describe.mjs introspect/enrichment/<eff>.manifest.json
node introspect/enrich_card.mjs introspect/cards/<eff>.json introspect/enrichment/<eff>.descriptions.json
```

## Known frontier (next work)

- ~~`.ffx` preset capture/apply for CUSTOM_VALUE curves~~ — SOLVED 2026-07-15: master-layer
  library (`recipe-harness/library/`, clone-into-comp carries curves) + `presets`/.ffx field,
  both verified. Remaining: the artist curve pass on the masters + mining the 586 vendor
  Designer presets (plain-JSON .xbxc) as recipe material.
- Animated + context-conditioned probing (temporal enums; gated params like Overflow@Contrast)
- Batch-enrich the native effect set into a browsable card library for the planner
- Multi-layer/multi-system plans (portfolio tornado = core + wisps + debris + matte)
- Brownfield: perceive existing projects (selection, layer stacks, non-destructive edits) —
  the wedge product is greenfield-on-selected-layer; arbitrary-project editing is the north star.
