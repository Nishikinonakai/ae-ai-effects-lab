# Planner-eval round-2 — the headless baseline

*2026-07-20 · `node recipe-harness/eval/run_eval.mjs --tier=T1 --max-iters=3` · ledger `results_r2.jsonl`*

## What this measures, and what it does not

Round-1's planner was **the agent reasoning in session** — a far stronger reasoner than anything a
shipped product can contain, driven one prompt at a time. Round-2's planner is `plan_recipe.mjs`
running headless on gpt-5.6-terra. So this is **not** a rematch showing whether the stack improved.
It is the first measurement of a different and more product-relevant question:

> with nobody in the loop, what does the thing actually do?

## Result — T1 tier, 11 prompts

| | round-1 (agent planner) | round-2 (headless) |
|---|---|---|
| T1 one-shot | 82%* | **9%** |
| T1 pass@3 | 82% | **18%** |

\*round-1 reported pass@3 per tier; the one-shot figure was 46% across all tiers.

By family: particular 40% pass@3 (2/5) · native 0% (0/4) · form 0% (0/1) · vague 0% (0/1).

Trajectories tell the story better than the rate:

```
e21  9              one-shot pass
e05  6 → 7 → 8      the loop earning its keep
e01  5 → 7          (ran at max-iters=2 — disadvantaged)
e02  7 → 7 → 7      the known 7-plateau
e07  7 → 6 → 5      actively degraded
e03  3 → 3 → 3      flat: nothing the loop touched mattered
e24  3              stalled after one iteration
```

## The finding

**The planner is now the bottleneck, not the tune loop.**

Round-1's conclusion — *"the library gets the structure right, the visual loop closes the last 20%"*
— held while the agent was choosing the structure. Headless, the structure is often wrong from the
start, and a param loop cannot rescue a wrong structure. That is exactly what the flat trajectories
are: `3 → 3 → 3` is a loop dutifully nudging parameters on a stack that was never going to work.

This does not invalidate the moat thesis; it relocates the work. The visual loop is demonstrably
sound (e05 climbing 6→7→8 is it working as designed, and the brownfield loop hit 1→7→9 on a
purpose-built diagnostic this same session). What is missing is the reasoning that picks the stack.

## The most actionable signal: native 0/4 vs particular 2/5

The essence index currently holds a deep card for Particular (written this session), cards for five
BCC effects, Deep Glow, and three spatial/ML cards. **It holds no card for a single native effect
the native prompts need** — Fractal Noise, Mosaic, Posterize, Emboss, Tint, Ramp. The planner had
matchNames and ranges for those but no causal model, and went 0/4.

That is the strongest available evidence for PRD §八's "shallow essence for breadth" plan, and it
suggests the order: **breadth before more depth.** One more deep card is worth less than twenty
shallow ones covering the native stack the library actually leans on.

Caveat worth keeping: one prompt (e03, a native-class flowing nebula) was planned as `tc Particular`
— consistent with the planner reaching for the effect it has a causal model of. With n=1 that is a
hypothesis, not a result; a breadth pass over native effects would test it directly.

## Reproducing / extending

```bash
node recipe-harness/eval/run_eval.mjs --tier=T1 --max-iters=3   # resumable; skips completed ids
node recipe-harness/eval/run_eval.mjs                            # the full 24
node recipe-harness/eval/run_eval.mjs --only=e03 --replan        # re-plan one prompt
```

The ledger is append-only JSONL; the rollup recomputes from it, so an interrupted run just resumes.
