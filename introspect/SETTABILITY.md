# Settability — what "this param exists" is actually worth

*2026-07-19/20 · method, results, and the one place the method is known to be wrong*

## Why this exists

Introspection reads an effect's property tree and gets, for every param, a name, a type, a range,
units and a live value. It is tempting — and the essence cards did this — to treat that as the
effect's control surface. It is not. **Readable does not imply writable.**

Deep Glow reports `Spread`: range 0.01–100, units percent, current value 33. Every `setValue` on it
throws *"the property or a parent property is hidden."* The essence card listed it as a key lever,
the scorer pivoted to it during a tune, the edit threw, and the iteration was wasted.

So the ontology needs three states, not one:

| state | measured by | means |
|---|---|---|
| **readable** | property-tree walk | the param exists and reports metadata |
| **writable** | settability probe (below) | `setValue` succeeds *in this instance's current state* |
| **effective** | the render | changing it actually alters the frame |

`frame_delta.mjs` measures the third one; this document is about the second.

## Method

`introspect_effect.mjs` runs an identity `setValue(p.value)` on every leaf param — same value in,
same value out, so the probe cannot change anything — and classifies any throw:

- `hidden` → the param or a parent is hidden: not writable right now
- `driven` → keyframes/expression hold it: writable in principle
- `n/a` → no-value/custom/marker types, which have no `setValue`

**It must be a second bridge round-trip.** A plugin computes param visibility in a UI pass AE runs
*after* the creating script returns. Probed inside that script every param reports settable; probed
on the very next round-trip the same Deep Glow instance reports 9 hidden. The first implementation
did it in-script and confidently reported `hidden=0` for everything.

> **ExtendScript hazard found here:** a chained ternary `a ? x : (b) ? y : z` returned `y` with `a`
> demonstrably true (`indexOf` returned 113). Every hidden param was silently mislabelled `driven`.
> Use `if/else` in this engine.

## Survey result — 81 effects, stratified across vendor families

`node introspect/survey_settable.mjs --per-family=10` → `settability_survey.json`

| family | effects | ≥1 not-writable | params | not writable |
|---|---|---|---|---|
| Trapcode | 10 | 3 | 9072 | 2340 (25.8%) |
| Video Copilot | 2 | 2 | 1698 | 317 (18.7%) |
| FxFactory | 10 | 3 | 344 | 43 (12.5%) |
| Sapphire | 10 | 2 | 534 | 29 (5.4%) |
| Boris BCC | 10 | 2 | 866 | 4 (0.5%) |
| AE native | 10 | 1 | 95 | 2 (2.1%) |
| Cycore (CC) | 10 | 0 | 112 | 0 |
| RG Universe | 10 | 0 | 376 | 0 |

**14 of 81 effects expose at least one param that is not writable in the default state.** The
param-level figure (20.3%) is dominated by Trapcode Form alone (2080 of 2458) and should not be read
as an ecosystem rate — the per-effect figure is the meaningful one.

## The known blind spot — read this before trusting a "dead param" claim

"Not writable **now**" and "not writable **ever**" are different claims, and only the first is
measured. Params can be *conditionally gated*: hidden until a parent enum or toggle opens them.
That is the "hidden parameter gating" the causal ontology exists to capture, and those params are
perfectly usable once the gate is set.

`probe_gates.mjs` was written to separate the two: flip every small-integer param (enums and
checkboxes) to each of its values and re-measure what opens. **It found zero conditionally-gated
params across 105 flips on three effects — and that result is wrong.**

The counter-example is decisive:

- `tc Form-0005` (Base Form Size Y) probes as `hidden`.
- `probe_gates` flipped `tc Form-0489` (Base Form Size) to 2 and saw nothing open.
- But **49 shipped recipes set `tc Form-0005`, and a live run confirms it applies**: the runner
  sets `tc Form-0489 = 2` and then `Size Y = 700` ✓ `Size Z = 200` ✓ in the same script — while
  `tc Form-0010` in that same run fails ✗ with the hidden error, so the effect is genuinely
  discriminating, not universally permissive.

Same gate, same value, opposite outcome in the two contexts. Whatever `probe_gates` is missing about
the instance or the ordering, it is not yet a reliable instrument.

**Consequences for anything reading this data:**

1. `settable: "hidden"` is a warning, not a verdict. Do not offer such a param as a lever — but do
   not delete it from the ontology either.
2. A negative `probe_gates` result establishes nothing about permanence. Deep Glow's `Spread` is
   *treated* as unreachable on that basis, and its card says so explicitly.
3. The reliable escalation is the one the tune loop already implements: attempt the edit, and when
   the frame does not move, use the measured inert signal to go hunting for the gate. Ground truth
   is the render.

## Open

- Why the recipe context can write `tc Form-0005` and the probe context cannot — instance state,
  param ordering, or something about the host layer. Resolving this fixes `probe_gates`.
- Re-run the survey with a working gate probe to get the real conditional/permanent split.
