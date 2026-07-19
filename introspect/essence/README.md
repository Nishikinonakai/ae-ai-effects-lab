# Essence index — per-plugin causal cards for the runtime router

The **essence card** is the compressed, reasoning-ready understanding of one effect: not its full
parameter dump (that's the `cards/` introspect card), but *what it fundamentally does, which few
params are the real levers, and how to configure it for a stated intent*. This is the artifact the
product's runtime router retrieves (coarse→fine) to turn "I want X feeling" into a configured
effect — and it's how the **causal-param-ontology moat generalises from Particular to every plugin**
(see PRD §八). Shallow-for-breadth (one essence card per installed effect, for routing) + deep only
for the Particular-class hard cases.

## The pipeline (cheap, because pro plugins have semantic names)

1. **introspect** (`introspect_effect.mjs "<effect>"`) → `cards/<Effect>.json`: every param's
   **semantic name** + matchName + type + range + default + enum span. For a professional plugin
   (BCC / Sapphire / Universe) this alone recovers most of the meaning — the params are named
   ("Glitch Intensity", "Block Size 1-7"), not opaque. (A live-project dump only shows numeric
   matchNames, which is why the essence step needs the introspect card's name↔matchName map.)
2. **visual probe** (only for the uncertain bits): sweep the look-driving params + small-range
   enums, render on a *textured* surface (a flat solid shows nothing for a glitch/displace effect),
   vision-read the deltas → ground "Block Size 1 = thin stripes, 7 = chunky blocks" etc.
3. **synthesize** → `essence/<Effect>.essence.json`: essence sentence, `when_to_use` routing tags,
   `key_levers` (name + matchName + range + plain effect), `enums_to_verify`, `config_recipes`
   (concrete param sets per intent), and `reasoning_hooks` ("make it subtler" → which dial, which way).

## Card format

See `BCC_Cross_Glitch.essence.json` (the reference implementation, 2026-07-19). Required:
`matchName`, `essence`, `when_to_use`, `key_levers[]` (each with matchName so the runtime can set it),
`config_recipes`, `reasoning_hooks`, `grounding` (how it was earned + confidence).

## Status

- **BCC Cross Glitch** — done (introspect + probe + synth). The user's most-used third-party effect
  (KillKiss ×49). Closes the "I read the values but not the meaning" gap surfaced by the brownfield
  dump: now `BCC Cross Glitch-10682371=95` reads as `Glitch Duration = 95`, and "make it subtler"
  maps to a concrete dial move.

## Next candidates (by the user's real usage)

BCC Camera Shake, BCC Textures, Deep Glow (`PEDG`), BCC Damaged TV — the AMV backbone; then the
user's OWN `Pseudo/*` expression-control rigs (harder: no model prior — read the pseudo-effect
definition + probe). Filter suites at large stay introspect-card-only until a request needs them.
