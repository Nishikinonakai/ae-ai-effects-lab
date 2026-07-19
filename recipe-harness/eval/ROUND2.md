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

---

## Follow-up: does breadth actually help? (same day, n=4)

The 0/4 native result implied a fix — shallow essence cards for the native set — so the index went
from 9 cards to 28 and the four native prompts were re-planned and re-run.

| prompt | before | after | best |
|---|---|---|---|
| e03 nebula | `3 → 3 → 3` | `6 → 7 → 7` | 3 → **7** |
| e04 old film | `5 → 5 → 4` | `6 → 4 → 5` | 5 → 6 |
| e08 signal glitch | `3 → 5 → 6` | `4 → 5 → 5` | 6 → 5 |
| e24 duotone poster | `3` (stalled) | `5 → 7 → 6` | 3 → **7** |

**Pass rate: still 0/4.** Mean best score 4.25 → 6.25. So this is not a fix, and the cards should
not be credited with one — nothing crossed the bar. What did change is worth recording:

1. **The flat trajectories are gone.** `3 → 3 → 3` was a loop nudging params on a stack that could
   never work. Every prompt now moves under tuning, which is the loop having something real to
   work with.
2. **The routing-bias hypothesis is confirmed.** e03 went from `tc Particular → BCC_TEXTURES` — a
   particle system for a flowing nebula, chosen because Particular was the only effect with a
   causal model — to `Fractal Noise → Tint → Turbulent Displace → Deep Glow → Noise HLS`. Give the
   planner a causal model of the right family and it routes to the right family. The n=1 caution in
   the section above is now resolved: **an index with uneven depth biases routing toward whatever
   it knows deeply.**
3. **e24 rediscovered the architecture round-1 found by hand** — Fractal Noise → Mosaic → Posterize
   → Emboss → Tint, the binarize-before-emboss duotone relief — and scored 7. Round-1 reached 9/10
   on that stack with hand-tuned params. The structure is now reachable headlessly; the parameter
   values are not yet.

Which sharpens the round-2 finding rather than overturning it: **structure is now mostly reachable;
the gap is parameter values.** That is a different problem from "the planner picks the wrong stack",
and it is much closer to what the visual loop is actually designed to close — so the next question
is why the loop stalls at 5-7 instead of climbing, not why the plan is wrong.

n=4, single run, no repeats. Treat the direction as real and the magnitude as noisy.
