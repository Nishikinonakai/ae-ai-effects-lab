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
| 1 | **Footage locality** — copying only the `.aep` breaks relative-linked footage → AE renders missing media as color-bar placeholders → the visual verify judges garbage. (Fix: copy into the original folder / keep footage resolvable, or relink.) | High for the demo path | Documented; product must ensure footage resolves (or perceive `footageMissing` and warn) |
| 2 | **Keyframed look-params** — the active lyric's Glitch Intensity has 2 keyframes (an animated burst envelope, =0 at this still). `apply_edit`'s `param` op is a plain `setValue`, which **can't touch a keyframed property**. Real projects animate their look-driving params constantly. | High | **OPEN** — needs a keyframe-aware act (scale keys / `setValueAtTime`, or add-effect-on-top), plus perception already flags `numKeys` |
| 3 | **Async `saveFrameToPng` not awaited** — the ExtendScript returns before the PNG finishes (a 4K frame takes ~12s). A half-written frame (bottom rows black) got scored **0/10 "catastrophically broken"** — a false negative that would derail the tune loop. | **Critical** | **FIXED** — `apply_edit` now `waitForFrameSettle` (size stable across 2 reads, resolution-agnostic) before trusting a frame |
| 4 | **4K frames too big for the vision API** — a 28MB PNG is ~37MB base64, past the per-image limit. Had to downscale by hand. | High | **FIXED** — `verify_edit` downscales a COPY to `--maxdim` (default 1600) via `sips` before scoring; originals untouched |
| 5 | **Iterative-tune baseline** — verify compared the tune's *intermediate* before (65) vs after (100), a small delta, so convergence looked invisible (3/10 "indistinguishable"). The verify "before" should be the **original baseline**, not the previous iteration's state. | Medium | **OPEN** — add a `--baseline=<original report/frame>` to `verify_edit` for multi-step tunes |
| 6 | **Single-lever chase plateaus** — "dreamy bloom" really wants **Glow Radius (softness)**, not just Intensity; the scorer kept climbing Intensity (34→65→100→150) with little visible gain. Essence routing should offer *multiple* levers per intent, and the loop should switch levers when one plateaus. | Medium | **OPEN** — essence `config_recipes` should bundle co-levers; tune loop should detect plateau and pivot lever |

### Net

The core loop **coheres on real content** — that was the thing to prove, and it did, including the
self-correcting visual safety net. The gaps are exactly the kind a real project surfaces that a
throwaway comp can't: animated params, async render timing, resolution, iterative-baseline, and
lever-choice. Two are fixed in-session (#3 critical, #4 high); four are on the roadmap (#1 handling,
#2 keyframe-aware act, #5 baseline, #6 multi-lever routing).
