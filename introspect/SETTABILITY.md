# Settability — what "this param exists" is actually worth

*2026-07-19/20 · method, results, and the measurement requirement that makes them mean anything*

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

**It must be a second bridge round-trip, on a displayed comp.** A plugin computes param visibility
in a UI pass AE runs *after* the creating script returns — and only for a comp that is being shown.
Probed inside the creating script, every param reports settable; probed on the very next round-trip
the same Deep Glow instance reports 9 hidden. The first implementation did it in-script and
confidently reported `hidden=0` for everything. See "the measurement requirement" below — the
display half of this rule is the one that took longest to find.

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

## The measurement requirement — display, or you measure nothing

**Settability is only meaningful on a comp that has been DISPLAYED in a viewer.**

AE runs a plugin's params-UI pass — the code that decides which params to hide — only when the comp
is shown. On a comp that has never been displayed, *every* param reports settable. That is not a
measurement; it is a permissive default, and it looks exactly like a real result.

Verified directly, and it cost most of a day to find:

| context | Deep Glow `Spread` |
|---|---|
| virgin comp, never displayed | **OPEN** (false) |
| same comp, after rendering a frame | **OPEN** (rendering is not the trigger) |
| same comp, after `openInViewer()` + selecting the layer | **hidden** (true) |

The same applies to *changing* a gate: the probe must re-assert display on every measurement,
because another comp being fronted in between leaves you re-reading stale visibility.

`introspect_effect.mjs` and `probe_gates.mjs` both assert display on every probe. Anything else
reading param state should assume the permissive fiction until it does the same.

## Gated vs unreachable — the split, now measured

`probe_gates.mjs` flips every enum/checkbox param through its values, with display asserted, and
re-measures what opens. Its first version reused a scratch comp that other steps kept pushing out
of the viewer, so it re-read stale visibility and reported "0 conditionally gated" across 105 flips
— confidently wrong. Fixed, it reproduces both known-good cases:

- **Trapcode Form** — `Base Form Size` (linked → individual) opens `Size Y` and `Size Z`, while
  `Center XY` correctly stays shut. This matches ground truth: 49 shipped recipes set `Size Y`, and
  a live run confirms the runner sets the gate first, then writes Y ✓ Z ✓ while `Center XY` fails ✗.
- **Deep Glow** — `Auto Iterations = 0` opens `Glow Iterations`. The remaining 8 params resist all
  19 gates and are treated as unreachable.

So both categories are real, and the essence cards now carry both:

```
key_levers          usable now
gated_levers        usable AFTER opening a named gate, in the same edit
unreachable_levers  never offer — no gate found
```

Offering a gated lever naked produces an edit that throws; hiding it throws away usable range.
Recording the gate is the whole point — this is the "hidden parameter gating" the causal ontology
exists to hold.

**Caveat that remains:** single-gate flips only. A param needing two gates open together still
reads as unreachable. Form's 2078 remaining shut params are mostly this plus per-form-type
branches — the per-effect count is the meaningful figure, not the param percentage.

## What generalises

- **An instrument that has never produced a known-good positive is not an instrument.** The gate
  probe's "0 across 105 flips" looked like a finding and was a bug. It only became trustworthy once
  it reproduced two cases whose answers were already known from shipped recipes.
- **Introspection reports capability, not availability.** Three states, three measurements:
  readable (property walk), writable (this probe, on a displayed comp), effective (the render).
- The reliable escalation in the product is still the loop's: attempt the edit, and when the frame
  does not move, use the measured inert signal to hunt the gate. The render is ground truth.
