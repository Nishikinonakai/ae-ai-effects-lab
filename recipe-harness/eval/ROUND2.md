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

---

## Why the loop stalls at 5–7 — adversarial multi-agent diagnosis

*2026-07-20 · 5 investigators × independent verifiers × synthesis, over 24 loop dirs / 50 reviews /
124 suggestions. Full report: workflow `wf_5691bf0f-0c1`.*

**Method caveat first:** only 1 of 33 candidate findings survived the adversarial verify pass. That
verifier was told to default to `survives=false` when uncertain, which was too harsh — most value
came from the synthesis stage doing its own primary measurement rather than from the surviving set.
Read the numbers below as *measured by one agent and re-verified by me in the code*, not as
consensus.

### The premise was half wrong

Round-2 concluded "structure is mostly right, the gap is parameter values." The evidence only half
supports that. The loop **is** closing the value gap it can see — eval-e05 bisected its way to a
pass. What remains at 7 is a mix of **harness measurement artifacts** and **"reads as X, not Y"**
character complaints, and the second is not a scalar at all:

> e02 *"particles read as soft glowing dots rather than distinct small bubbles"* · e06 *"更像发光LED
> 网格"* · e19 *"更像数字下落字符而非连续的高速雨线"* · e24 *"Emboss 的混合量…削弱了严格双色"*

Bubbles-vs-dots is a particle-type choice. Strict duotone vs Emboss mid-tones is a **stack-order**
problem. The suggestion vocabulary has `param`/`expression`/`effect`(add-only)/`camera`/`background`
— no remove, no reorder, no type change. That is a capability the loop does not have, not a bug.

### Four defects found and fixed (each verified in the code first)

| # | defect | fix |
|---|---|---|
| 1 | **`run_eval.mjs` discarded the planner's sampling choice on every prompt** — `defaults.renderFrames` is `[1,4]` and always truthy. Mine, written the same day. | precedence inverted; planner now chooses |
| 2 | the planner was never told **when** to sample | `plan_recipe` now states the three constraints |
| 3 | `gpt_score` **silently drops the last frame** on `image_parse_error` — no trace in `review.json`. 4 reviews complain the second frame was absent while both PNGs sit valid on disk. | records `_degraded`; `tune_loop` warns loudly |
| 4 | `tune_loop.finalize()` reported `best: iter N` and **left the comp in its LAST state** | restores the best plan (its brownfield twin already did) |

**Why #1/#2 matter more than they look.** 23 of 24 prompts phrase a motion criterion against the
sampled pair, and `t=1` sits inside the emitter fill transient — with particle life 7.5–9s in a 6s
comp, the first sample holds a fraction of steady-state population. The scorer then correctly
reports *"t1 is extremely sparse"* as a defect **no birth-rate nudge can remove**: e02 drove
Particles/sec 28→34→48 and the t1:t4 ratio got *worse* (5.54× → 6.01×), scoring 7, 7, 7.

The positive control: e05 passed at exactly the iteration its ratio collapsed — life 6→2 took the
ratio 5.06× → 1.32× and the score 7 → 8. *"Population density is now reasonably consistent between
t1 and t4, avoiding the earlier accumulation problem."* **The pass was bought by making the pair
measurable, not by making the render prettier.**

Confidence: moderate, not high. n=1 causal control, and two facts cut against it — e21 passed at
9/10 with a 2.92× ratio, and e01 improved 5→7 while its ratio worsened. The honest claim is *largest
tractable contributor with a demonstrated escape route*, not majority cause.

### Also true, not yet fixed

- **`maxIters` counts RENDERS, so `--max-iters=3` buys two tuning rounds, not three.** 38 of 124
  suggestions were emitted at a terminal iteration and discarded. Worse, e01 ran at 2 and e15/e19 at
  **1** — one render, zero tuning — and are recorded as `fail_max_iters`, inflating the plateau.
  Now recorded in `summary.json` as `renders` / `tuning_rounds` / `discarded_terminal_suggestions`.
- **Causal mis-attribution.** e07's complaint is blown-out particle cores; the loop drove Deep Glow's
  Exposure 0.65→0.35→0.12→0 while the blowout came from Particular's own additive Glow Sphere,
  never touched. e02's criterion is per-particle sway; the loop escalated Wind X, which translates
  the whole field uniformly and can never produce individual arcs. **The values are applied
  faithfully to the wrong parameters.**
- **param/expression collision:** a `param` nudge on an expression-driven property is a silent no-op
  reported `ok:true` (2 of 69). Do *not* fix by deleting the param row — three collisions in the
  corpus are intentional base-plus-modulation where the expression reads the static value.

### ⚠ Data integrity — `loop/eval-*` is NOT the round-2 record

Four directories disagree with `results_r2.jsonl` (e03 `[3,3,3]`→`[6,7,7]`, e24 `[3]`→`[5,7,6]`,
e04, e08) because the native-card follow-up **re-ran those four in place** while logging to a
separate ledger. The directory also still holds July-18 agent-backend runs (e09–e14, e16, e18, e23)
and dev runs at `max_iters` 1 and 5. Round-2 proper is the 11 ledger rows.

Consequence: any aggregate computed over `loop/eval-*` mixes four experiments. **Re-run round-2 into
a clean directory before the next investigation** — effects smaller than ~2 points are currently
unmeasurable.

### The experiment to run next

Re-render the existing failing plans **byte-for-byte unchanged** — no planner change, no param
change — moving *only* the sample times, and re-score. ~10 runs, no new planning. If e01/e02/e07
move off 7, sampling is the binding constraint. If they hold, the residual is causal mis-attribution
and structural vocabulary, and effort should go there instead. **Run this before building anything
else on #1.**

---

## The sampling experiment — the lead hypothesis does NOT survive

*2026-07-20 · `eval/exp_sampling.mjs`, plans byte-for-byte unchanged, only `renderFrames` differs,
both arms scored by the same backend in the same run.*

The plateau diagnosis named the sampling protocol as its lead cause: t=1 sits inside the emitter fill
transient (particle life 7.5–9s in a 6s comp), so the first sample holds a fraction of the eventual
population and the scorer reports "t1 is extremely sparse" as a defect no parameter can fix. It
rested on n=1 and said so. This tested it.

**Result: mean delta −0.03. It does not hold.**

| id | control `[1,4]` | treatment `[4,5]` | delta | sep |
|---|---|---|---|---|
| e01 | 7±0 `[7,7,7,7,7]` | 7.4±0.55 `[7,8,7,8,7]` | +0.4 | 1.03 |
| e07 | 6.2±0.45 | 6±0 | −0.2 | 0.63 |
| e24 | 7±0 | 6.2±0.45 | **−0.8** | 2.51 |
| e02 | 6.5±0.71 | 7±0 | +0.5 | 1.00 |

Two up, two down, signs inconsistent, aggregate zero. Only **e01** shows a plausible positive — and
it is the most extreme fill-transient case (life 9 in a 6s comp), where P(score≥8) moved 0 → 0.4.
That single case may be worth a larger n. The hypothesis as stated is not supported.

### The methodology finding, which matters more than the result

**The first run of this experiment reported the opposite.** Single draws: `e01 7→8, e07 6→7,
e24 6→7` — "3 of 3 improved, one cleared the bar." Every one of those was noise.

What exposed it: e24 is a static-ish native stack, and its two frames were pixel-identical in *both*
arms — yet it "improved" by +1. An unintentional negative control. Re-scoring one unchanged frame
pair eight times then settled it:

```
control frames   × 8 → 7 7 7 7 7 7 8 7
treatment frames × 8 → 7 7 8 7 7 7 7 7
```

**Identical distributions. The scorer emits an 8 roughly one time in eight on its own.** The
"winning" case was a draw from a distribution both arms shared.

> **Within-arm sd is 0.27–0.71, and ±1 swings occur on byte-identical inputs.**
>
> Every single-shot score in this repo carries that. `results_r2.jsonl`, the round-2 pass rates, the
> per-prompt trajectories — all single draws. A trajectory reading `7 → 7 → 7` is consistent with a
> loop that changed nothing AND with a loop whose changes are smaller than the measurement. **No
> comparison at an effect size near 1 point means anything without repeated scoring.** Any future
> experiment here uses `--repeats`; the flag exists now and defaults to 5.

### Where this redirects the work

Sampling is off the list. The remaining candidates from the diagnosis are the ones it labelled
*genuinely hard*, and they now inherit the whole residual:

- **#5 causal mis-attribution** — e07's blown cores blamed on Deep Glow's Exposure (driven 0.65 →
  0.35 → 0.12 → 0) while the blowout came from Particular's own additive Glow Sphere, never touched.
  e02's per-particle sway criterion answered with Wind X, which translates the whole field uniformly
  and can never produce individual arcs.
- **#4 missing structural vocabulary** — "reads as X not Y" complaints are particle-type choices and
  stack-order problems, and the suggestion schema has no remove, no reorder, no type change.

Both are about *which lever*, not *what value*. That is the same conclusion the panel dogfooding
reached from the other direction: the product added Particular correctly and then faked convergence
with a layer-scale animation, because nothing told it that inward emission is the real technique.

---

## The lever experiment — the wire works, but only as well as the ontology behind it

*2026-07-20 · `eval/exp_levers.mjs`, frames FIXED, 5 scorings per arm, scoring key PRE-REGISTERED by
an independent multi-agent analysis before the experiment ran.*

### Pre-registration

Three analysts (one per case, each adjudicated by an independent verifier against the param dumps
and the rendered pixels) named the lever that *physically* causes each stalled defect. They were not
told the hypothesis. All three converged on the same structural claim:

| case | defect | correct levers | what the loop actually pushed |
|---|---|---|---|
| e02 | bubbles read as glowing dots | `0029` Sphere Feather, `0703` Particle Type, `0069` Blend Mode | `0749` Wind X, `0711` Turbulence, `0146` Particles/sec |
| e06 | silk reads as an LED bead curtain | Form `0033` Size, `0007` Particles in X, `0310` Shading, `0313` Specular, `0025` Feather | three Deep Glow params |
| e07 | flakes read as blown orbs | `0703` Particle Type, `0216`/`0215` per-particle glow, `0027` Size, `0002` Life | Deep Glow Exposure, `0146` |

**The pattern is one sentence: every stalled defect is a SHADING-stage defect, and the loop spent its
whole budget on emitter- and physics-stage levers.** Particles/sec changes how many dots exist; it
cannot change what one dot looks like. Wind translates the field rigidly; it cannot produce
per-particle variation. A downstream Deep Glow cannot remove a halo the particle itself emitted.

The e02 analysis measured it rather than asserting it: sampling a particle's radial profile in the
actual render gave r90/r10 = 0.44, matching `Sphere Feather = 50` (a ramp over half the radius) to
within measurement error — and Sphere Feather was **never written by any of the three plans**. It
also showed why Size cannot substitute: feather is a *percentage of radius*, so Size 7 → 9 moved the
normalised profile 0.44 → 0.46. Same soft bell, bigger.

### Run 1 — negative, and the negative was informative

Injecting the essence lever list moved the correct-lever hit rate **20% → 13%**. Before concluding
the scorer was not vocabulary-constrained, I checked whether the list actually contained the answers:

| case | correct levers present in the offered list |
|---|---|
| e02 | 2/3 — `0029` Sphere Feather missing |
| e06 | **0/5** — there was no `tc Form` essence card at all |
| e07 | 4/5 — `0216` Glow Opacity missing (the card had merged Glow Size and Glow Opacity into one entry, so `0216` had no matchName of its own) |

So run 1 tested the wire against a vocabulary that omitted the words. And the omissions were not
random: **`0029` feather, `0216` per-particle glow, Form's Size / Shading / Specular — every missing
lever is a shading-stage lever.** The essence index covered emitter → birth → physics well and
shading badly, which is precisely the stage where "reads as X not Y" defects live.

### Run 2 — same wire, same key, same script; only the cards changed

Added the four missing Particular shading levers (splitting the merged Glow entry) and authored a
`tc Form` card. Lever coverage went 6/13 → 13/13.

| case | correct-lever hit rate | levers hit |
|---|---|---|
| e02 | 0% → **100%** | `0029` Sphere Feather |
| e06 | 0% → **100%** | Form `0033`, `0025`, `0310`, `0313`, `0007` — all five |
| e07 | 0% → **40%** | `0703`, `0027` |
| **mean** | **0% → 80%** | |

e06 also stopped hallucinating: with no Form card it reached for `ADBE Gaussian Blur`, `ADBE
Transform`, `ADBE Fast Blur`, `ADBE Directional Blur` — effects not in the plan at all — and
off-plan reach fell 13 → 7 once it had real Form levers to name.

Scores stayed flat (6→6, 4→3.6, 6.6→5.2). **That is the expected result and not a disappointment:**
the measured noise floor is ±0.5 with ±1 swings on identical input, so the score could not have
shown this either way. The lever is the metric.

### The caveat, stated plainly

**The cards were authored after reading the pre-registration analysis of these same three cases.** I
wrote "THIS is why particles read as glowing dots" into the `0029` entry, and e02's critique is
about dots. The scorer still had to pick `0029` out of 24 offered levers and did so in 100% of runs,
which is not nothing — but this run cannot distinguish "the ontology now describes the shading
stage" from "the answer was written into the card".

**A clean test needs held-out cases**: score stalled runs whose defects were *not* consulted while
writing the cards. e04, e08, e20, e22 are available and untouched by this analysis. Until that runs,
the honest claim is narrow:

> The lever wire functions, and it is bounded by ontology coverage rather than by the scorer's
> willingness to use it. Run 1 and run 2 differ *only* in card content and differ by 67 points of
> hit rate.

---

## A harness bug that explains two of the four held-out failures

*2026-07-20 · found by the held-out pre-registration, verified in code and on a live comp.*

The blind analysts diagnosing e20 and e22 both reported the same thing, and it is not about levers
at all:

> "Only one Particular instance exists — the runner's first-match effect lookup collapses both plan
> specs onto it, so the plan's SECOND Particular is silently never created."

**Confirmed in `recipe_runner.mjs`.** The effect lookup broke on the first matchName match, so a plan
carrying two `tc Particular` entries bound BOTH specs to instance 1. The second spec overwrote the
first, and its system was never created. Every param reported `ok`, the report looked clean, and half
the composition did not exist.

e20 and e22 both plan two Particular systems — falling rain plus splash rings. Only the rings
rendered. The critique across five iterations was *"no falling rain is ever visible"*, and the loop
spent all five adjusting parameters of a system that was never the problem: **the rain it was asked
for had no emitter.**

Fixed by counting occurrences — the Nth spec of a matchName binds to the Nth instance, creating one
only when the comp has fewer than the plan asks for. Verified live on e20's plan: the host layer now
carries two Particular instances, the second spec's 17 params apply under a `#2` tag, and three
consecutive runs leave the count at 2, so idempotency survives.

**Consequence for the eval:** e20 and e22 are not valid tests of any lever or ontology hypothesis.
Their defect was structural and upstream of every knob. Any multi-instance plan in the corpus —
core+wisps, rain+splash, the tornado recipes — has been silently running at half strength, so those
rows need re-running before their scores mean anything.

This is the third time a "the model chose badly" reading has turned out to be a harness defect
(after the silently-dropped frame and the param/expression collision). Worth stating as a rule:
**before concluding the intelligence is wrong, check that what it asked for is what actually ran.**
