# Brownfield E2E findings — full loop on a real project

Two end-to-end runs of the product's core loop on the user's **real** KillKiss PV (copy-then-open,
edits discarded, original never touched). The loop:

> perception (time-aware) → essence routing → create-vs-modify → reversible act → visual self-verify → accept/tune/rollback

## E2E #1 (KillKiss, pre-tooling) — surfaced F1 + F2

- **F1 — the visual loop is load-bearing.** Essence says "Threshold gates the glow," but the *right
  value* is content-dependent; only the render tells you. → built `verify_edit.mjs`.
- **F2 — verifying an edit needs the frame actually live at comp.time**, not every layer that exists
  somewhere on the timeline. → added `activeNow`/`activeCount` to `dump_comp`.

## E2E #2 (KillKiss FinalComp, full matured loop) — 2026-07-19

Ran the *whole* loop on the real 4K/146-layer final comp at t=104.7s. **It worked end-to-end** and
the pieces corroborated each other on real content:

- **Perception nailed it:** 146 layers, `dump_comp` reported only **13 live** at this frame (F2
  earning its keep — the rest correctly `·trimmed-out`). It read the real BCC Cross Glitch param
  values, and the layer structure **matched the BCC Cross Glitch essence card's documented pattern
  exactly** (even lyric twin = Ramp+Textures base look; odd twin = Cross Glitch + Fill + Camera-Shake
  OFF). Card ↔ real data agreement.
- **Create-vs-modify decided from perception:** BCC Fast Film Glow *exists* (live, static 34) → MODIFY;
  the active lyric's glitch *exists* but is keyframed → different story (see finding #2).
- **Act + rollback validated on real content:** glow 34→65→100 applied via `apply_edit`, then rolled
  back 100→65→34 — confirmed restored to the **original 34** on the real 146-layer comp.
- **Self-verify earned its keep:** the essence-reasoned 34→65 was too timid; the visual scorer caught
  it ("nearly indistinguishable... stronger glow not achieved") and gave the exact mechanical nudge
  (→100). F1 in action on real content.

### Six gaps surfaced (what breaks)

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | **Footage locality** — copying only the `.aep` breaks relative-linked footage → AE renders missing media as color-bar placeholders → the visual verify judges garbage. | High for the demo path | **FIXED** — `dump_comp` flags `sourceMissing` per live layer + a `missingLive` count + a loud "do not trust the render" warning; product ensures footage resolves or warns |
| 2 | **Keyframed look-params** — the active lyric's Glitch Intensity has 2 keyframes (an animated burst envelope, =0 at this still). `apply_edit`'s `param` op is a plain `setValue`, which **can't touch a keyframed property**. Real projects animate their look-driving params constantly. | High | **FIXED** — see "Keyframe-aware act" below |
| 3 | **Async `saveFrameToPng` not awaited** — the ExtendScript returns before the PNG finishes (a 4K frame takes ~12s). A half-written frame (bottom rows black) got scored **0/10 "catastrophically broken"** — a false negative that would derail the tune loop. | **Critical** | **FIXED** — `apply_edit` now `waitForFrameSettle` (size stable across 2 reads, resolution-agnostic) before trusting a frame |
| 4 | **4K frames too big for the vision API** — a 28MB PNG is ~37MB base64, past the per-image limit. Had to downscale by hand. | High | **FIXED** — `verify_edit` downscales a COPY to `--maxdim` (default 1600) via `sips` before scoring; originals untouched |
| 5 | **Iterative-tune baseline** — verify compared the tune's *intermediate* before (65) vs after (100), a small delta, so convergence looked invisible (3/10 "indistinguishable"). The verify "before" should be the **original baseline**, not the previous iteration's state. | Medium | **FIXED** — `verify_edit --baseline=<first report.json or orig .png>` judges the AFTER against the ORIGINAL baseline, so cumulative convergence is visible across a multi-step tune |
| 6 | **Single-lever chase plateaus** — "dreamy bloom" really wants **Glow Radius (softness)**, not just Intensity; the scorer kept climbing Intensity (34→65→100→150) with little visible gain. Essence routing should offer *multiple* levers per intent, and the loop should switch levers when one plateaus. | Medium | **ADDRESSED** — `tune_edit.mjs` auto-tunes MULTIPLE levers per iteration (validated: scorer raised Radius+Intensity together, 4→9). Remaining: feed essence `config_recipes` co-levers to the scorer so it can pivot to levers not yet in the plan |

### Net

The core loop **coheres on real content** — that was the thing to prove, and it did, including the
self-correcting visual safety net. The gaps are exactly the kind a real project surfaces that a
throwaway comp can't: animated params, async render timing, resolution, iterative-baseline, and
lever-choice. **All six now addressed**: #1 (footage-missing perception), #2 (keyframe-aware act,
high — below), #3 (critical async frame), #4 (4K downscale), #5 (verify baseline), #6 (multi-lever
tuning via `tune_edit.mjs`). The edit protocol is now a self-converging loop: `tune_edit.mjs`
composes apply → verify(vs original baseline) → apply-the-scorer's-suggestions → repeat, with
revert-on-decline, so the manual tune the E2E did by hand is automatic (validated 4→9 on a dreamy-
bloom intent, tuning Radius+Intensity together). The only remaining refinement is feeding essence
`config_recipes` co-levers to the scorer so it can pivot to levers not yet in the plan.

## Keyframe-aware act (finding #2, fixed + adversarially reviewed)

Real look-driving params are animated, so the act must edit *keyframes*, not just static values.

- **Perception**: `dump_comp` now reports `numKeys` per param → the planner knows a param is animated
  before editing (a plain `setValue` throws on a keyframed property).
- **Act** (`apply_edit` `param` op, keyframed branch):
  - **`scale`** (value = factor) — multiplies every keyframe value via `setValueAtKey`; preserves
    timing, ease, and interpolation type. The natural "make the animated look stronger/weaker."
    Inverse `restoreKeyValues` sets each value back by index.
  - **`setAtTime`** (value = absolute) — sets/adds a key at the playhead. add-vs-overwrite decided by
    **key count** before/after (not a fooled time-tolerance). On overwrite it captures and re-applies
    the prior key **shape** (interpolation type + temporal ease). Inverse `restoreKeyAtTime` removes
    an added key, or restores prior value + shape.
  - Keyframed edits **require an explicit `keyframeMode`** (no silent scale-vs-absolute inference).
  - **Refuses** edits on an expression-driven param (no visible effect).

Validated live: scale (envelope+ease+HOLD preserved, exact restore), setAtTime add (add→remove),
setAtTime overwrite of a **HOLD** key (stays HOLD through apply *and* rollback), require-mode + the
expression guard both fire.

### Adversarial review (workflow: 4 lenses → per-finding verification)

Live testing alone missed edge cases, so an adversarial-review workflow attacked the inverse logic —
**6 confirmed defects, all fixed**:
1. **(HIGH, ×2 lenses)** `setAtTime` overwrite lost keyframe **interpolation type** — a HOLD/stepped
   glitch key came back as a bezier ramp after rollback. Fixed: capture + restore interp type
   (ease only re-applied when both ends were bezier).
2. **(HIGH)** Default `keyframeMode='scale'` silently reinterpreted an intended-absolute value as a
   ×factor (a `value:100` → ×100 the whole animation). Fixed: require explicit mode.
3. **(MEDIUM)** add-vs-overwrite used a time-tolerance a near-but-not-at key could fool. Fixed:
   key-count comparison.
4. **(MEDIUM)** Static-param rollback `setValue` was unguarded — if the param later gained keyframes,
   one throw aborted the whole rollback loop. Fixed: per-op try/catch → reported skip.
5. **(MEDIUM)** No guard for editing a param under a live expression (no visible effect). Fixed: refuse.

The one class of bug live testing can't reliably surface (silent inverse corruption on an untested
key type) is exactly what the adversarial pass caught.

---

## Round 3 — closing finding #6 (co-lever pivot), 2026-07-19

Finding #6 was "the scorer can only ever suggest levers the seed plan already touched". Closing it
turned into a four-part fix, because a **controlled A/B on a purpose-built fixture** kept exposing
the next layer down. Fixture: `fixtures/colever_glow_stage.json` — a bright disc under a Deep Glow
that is weak *in the wrong dimension* (Exposure already fine at 1.6; Radius choked to 60; Threshold
parked at 260% so **no pixel qualifies at all**). The intent "a wide, soft, dreamy bloom" is
therefore unreachable by pushing the seeded lever, and the seed touches only Exposure.

**#6a — the scorer had no vocabulary to pivot.** `introspect/essence/lookup.mjs` reads the essence
cards for the effects in play and injects their verified levers + config recipes into the review
request. The anti-hallucination guard survives (matchNames still come from ground truth, now the
index rather than only the plan) while the pivot vocabulary widens.

> **A/B, identical frames and intent.** Levers OFF: score 3/10, and the only suggestion it could
> make was `PEDG-0002 → 8`, described as *"increase the bloom/spread control"* — it wanted spread,
> could only see Exposure, and so would have applied a **causally wrong** edit. Levers ON: pivoted
> to `PEDG-0001` Radius → 1300 and `PEDG-0011` Spread → 70, neither in the plan.

**#6b — the scorer cannot tell "did very little" from "did literally nothing".** Both read to it as
"visually indistinguishable", and it answers both the same way: push harder. But they need opposite
responses — a zero delta means a lever is INERT and no magnitude can help. `frame_delta.mjs`
(dependency-free 8/16-bit PNG decode + diff) measures it and **tells** the scorer instead of asking
it to perceive it. Also revealed: an inert frame has two causes, and the edit report distinguishes
them — if the param never took its value the edit was gated; if it *did* take its value and the
frame still did not move, the lever is real but absorbed/saturated in this state.

**#6c — essence cards advertised levers that can never move.** The pivot at #6a picked `PEDG-0011`
Spread… and `setValue` threw *"the property or a parent property is hidden"*. Deep Glow exposes 9
params to the scripting API — full name, range, units, live value — that it never opens for writing.
Probed against Blend Mode, Auto Iterations, View, Unmult, Fixed Steps and Enable Dither, on fresh
instances and after renders: they stay shut in every combination. Two fixes: `introspect_effect.mjs`
now records **settability**, and unreachable levers are filtered out of what the scorer is offered.

> **The settability probe must be a SECOND bridge round-trip.** A plugin decides which params to
> hide in its own params-UI pass, which AE runs *after* the creating script returns. Probed inside
> that script, every param reports settable; probed on the very next round-trip, the same instance
> reports 9 hidden. Measured directly — this is why the first implementation reported `hidden=0`.
>
> **ExtendScript bug found en route:** a chained ternary
> `a ? x : (b) ? y : z` evaluated to `y` with `a` demonstrably true (`indexOf` returned 113).
> Every hidden param was silently mislabelled `driven`. Use if/else in ExtendScript.

**#6d — the scorer was diagnosing causality blind.** The plan shows only what the current edit
touched, so every other lever arrived as a name and a range with no idea where it *sits*. With
Threshold parked at 260 and invisible, "which lever is the gate?" was guesswork — and it showed as
high run-to-run variance. `verify_edit` now reads the live values of the offered levers in one
round-trip and annotates the block `NOW=260`, turning inference into observation.

### Result — same fixture, same seed, same intent

| build | trajectory | outcome |
|---|---|---|
| before (levers off) | 3 → 3 → 3 → 3 | never converged; its one suggestion was causally mislabelled |
| \+ co-levers (#6a) | 3 → 3 → 3 → 3 | pivoted correctly, but the shut gate was invisible |
| \+ inert detection (#6b) | 2 → 4 → 9 | diagnosed the gate, converged |
| \+ settability (#6c) | 3 → 3 → 3 → 8 | no move wasted on a phantom lever; still variable |
| \+ live values (#6d) | **1 → 7 → 9** | correct diagnosis on the **first** review, converged in 2 iters |

Two loop-mechanics bugs fixed alongside, both surfaced by these runs:

- **The loop returned its LAST state, not its BEST.** A tune that peaked at 7/10 then tried a worse
  idea handed back the worse one, silently. It now rolls back to the best-scoring state on exit
  (an ACCEPT still keeps everything).
- **Enabling moves were discarded.** Opening a gate usually does not raise the score *by itself* —
  it makes the *next* lever able to work. Strict "keep only if better" threw exactly those away
  (observed: the loop rolled back the Threshold fix on a tie, then needed a longer route). A tie now
  survives when the frame actually changed; ties that changed nothing are still reverted.

### What generalises

- **Measure what the model is bad at, don't ask it to perceive it.** Inert-vs-weak is a pixel diff.
- **Readable ≠ writable ≠ effective.** Three distinct states, and the ontology needs all three:
  introspection gives readable, the settability probe gives writable, only the render gives effective.
- **Show current state, not just capability.** A causal model plus a live value is a diagnosis; a
  causal model alone is a guess.
