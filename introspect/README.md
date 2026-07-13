# Automatic Effect-Ontology Pipeline

Point it at **any** AE effect (native or third-party) → get a machine-readable **enriched
effect card**: full parameter structure + the perceptual semantics AE won't tell you. This is
the layer that scales the product beyond hand-authored Particular knowledge — no per-effect
manual dumping.

## The loop

```
introspect_effect.mjs   structure   any effect -> cards/<eff>.json
        |                            (every param: matchName, type, value, range, units, animatable)
        v
auto_probe.mjs          render      card -> pick enum-like params -> sweep values -> frames/ + manifest
        |                            (automates "what to probe": the params AE can't label)
        v
[vision backend]        semantics   manifest -> descriptions.json
        |                            in-session: the agent reads frames (this session)
        |                            production: vision/claude_describe.mjs (Claude API, headless)
        v
enrich_card.mjs         merge       card + descriptions -> enrichment/<eff>.enriched.json
                                     (enum values labeled; temporal/context caveats carried through)
```

## Why each stage exists

- **introspect** — AE exposes a *uniform* property API across all effects, so ONE recursive
  walker replaces per-effect hand dumps. Verified across Gaussian Blur (7 params), Fractal
  Noise (35), Glow (18), CC Particle World (107), Turbulent Displace (18).
- **the gap it leaves** — AE (esp. 2022) cannot read enum/dropdown **labels**. `Fractal
  Type = 1..20` but "what is 7?" is unknowable structurally. Same wall that blocked Particular
  `0577`. Everything else (names, ranges, units, hierarchy) comes free from introspect.
- **auto_probe + vision** — closes the label gap empirically: render the effect at each enum
  value, let a vision model read the deltas. Recovers semantics with zero documentation.
- **enrich_card** — fuses structure + semantics into the artifact the planner LLM consumes.

## Two vision backends, one schema

The vision step is a seam. Both write the identical `descriptions.json` schema, so
`enrich_card.mjs` is backend-agnostic:

- **agent-vision (in-session)** — the agent reads the frames directly. Used to develop/verify
  the loop. `enrichment/ADBE_Fractal_Noise.descriptions.json` was produced this way.
- **claude-api (production)** — `vision/claude_describe.mjs`, batched per-param so the model
  compares an enum's values together (catches identical/degenerate ones). Needs
  `ANTHROPIC_API_KEY` + `npm i @anthropic-ai/sdk`.

## What the loop discovered (Fractal Noise, live)

- **Fractal Type**: soft clouds (low) → dynamic blur (mid) → marble veins (~13) → woven grid
  (high). Distinct look-families, NOT a smooth continuum.
- **Noise Type**: value 2 = hard block mosaic; 1/3/4 = soft clouds (interpolation quality).
- Two honest method limits, auto-surfaced and carried into the card as caveats:
  - **temporal**: Fractal Type 4/6/10 are identical when STATIC — differ only under Evolution.
    → probe needs an animated mode (render several frames over Evolution/seed).
  - **context-gated**: Overflow looks inert at default Contrast (nothing overflows 0..1).
    → re-probe under a param context that exercises it (high Contrast).

## Native effects are the easy case

Native AE effects carry semantic names, real ranges, and clean hierarchy (contrast Particular's
7657 flat colliding params). For most native effects the introspect card + LLM training
knowledge likely suffices; the probe is reserved for enums, obscure params, and third-party
plugins with opaque ontologies.

## Next

1. Wire `claude_describe.mjs` as the default backend (headless enrichment of any effect).
2. **Animated probe mode** — multi-frame over Evolution/seed to disambiguate temporal enums.
3. **Context probing** — probe a param inside a state that exercises it (Overflow @ high Contrast).
4. Batch-enrich AE's native effect set into a card library the planner can browse.
5. Same vision seam = the recipe **visual scorer** (does this render match intent?) — one component, two jobs.
