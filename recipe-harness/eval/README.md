# Planner eval — does the product loop work on novel requests?

Everything so far measured the LAB (can we translate vendor presets / probe params).
This measures the PRODUCT: NL request → **model-planned** recipe → render → vision
score → tune loop. The planner is the model reasoning over the enriched cards +
the recipe library as reference material — per the 2026-07-17 generalization
decision, recipes are priors the model reasons FROM, not tables it looks up.

## Question under test

Given the current library (55 Particular + 44 Form mined + 12 native stacks +
3 hand-grown + 21 cards), what fraction of realistic NL requests does the stack
land — one-shot, and within 3 tune-loop iterations? Where does it break: planning
(wrong structure), ontology (wrong params), or rendering class residue
(cloudlet/smoke etc.)?

## Prompt set

`prompts.json` — 24 prompts across three axes:

- **tier**: T1 texture/ambient (11) / T2 path+rig (7) / T3 compositional (6) —
  mirrors the original gap-test tiers, where the difficulty cliff lives.
- **family**: particular 12 / native 6 / form 3 / mixed 2 / any 1.
- **dist** (distance from the library): `in` 6 (a recipe covers it — sanity floor,
  should one-shot), `near` 11 (recombination: palette/motion/density deltas, e.g.
  fireflies = dust + flicker), `ood` 6 (no close recipe: fireworks, portal,
  rain-ripples, Text/Mask emitter), `vague` 1 (underspecified on purpose — tests
  curated defaults).

Expectations going in: in-dist one-shot ≥80% (anything less = harness/planner
bug, not knowledge gap); near pass@3 high; ood is the honest frontier — e20
(rain ripples, linked systems) is expected to fail and marks headroom.

## Protocol

Per prompt, in order:

1. **Plan** (in-session agent = the planner, same seat the product model takes):
   read the relevant recipes/cards first, then author
   `eval/plans/eval-<id>.json` — tune_loop plan schema (`intent`,
   `pass_criteria` copied from prompts.json, `name: "eval-<id>"`) plus
   provenance: `_planner_rationale` (choice → evidence) and `_planner_sources`
   (the recipe/card files actually consulted). Sources are a metric, not
   decoration — they measure library leverage.
2. **Run**: `node runner/tune_loop.mjs eval/plans/eval-<id>.json --max-iters=3
   --backend=agent --timeout=180` (bridge up first: `../bridge_up.sh`).
3. **Score** (agent backend): the loop exits 2 with
   `loop/eval-<id>/iterN/review_request.json`; the agent reads the FRAMES ONLY
   and writes `review.json` per `runner/review_schema.mjs`. Honesty rules:
   judge against `pass_criteria` literally; any core criterion absent caps the
   score at 5; pass threshold is the schema's verdict (embers precedent:
   8/10 = pass); remember stills under-sell lateral motion — read drift from
   population lean and t1-vs-t4 deltas before penalizing.
4. Repeat the tune_loop command until exit 0 (pass) or 1 (max-iters/dead-end).

Scorer and planner are the same agent — the guard is that scoring happens
against frames + written criteria, not intentions. Suggestion quality feeds the
loop exactly as in production.

## Ledger

`node eval/eval_status.mjs` scans `loop/eval-*/iter*/review.json` against
`prompts.json` and writes `eval/results.json` + prints the summary: per-prompt
rows (scores per iter, first/final verdict, pass iter) and breakdowns by
tier/family/dist — one-shot rate, pass@3, mean iters-to-pass, plus a
library-leverage column (#sources cited per plan).

## Output interpretation

- **one-shot rate by dist** = how far library+cards carry pure planning.
- **pass@3 − one-shot** = what the visual loop is worth (the moat's third layer).
- **ood failures** = the next mining/probing worklist, ranked by user value
  instead of vendor-preset frequency — this replaces the round-N queue as the
  source of work once mining saturates.
