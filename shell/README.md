# shell — the product shell (PRD §七 / §9.3 item 1)

The lab could already do everything except **be used without an agent session driving it**. This is
that missing wrapper: an artist types a sentence into a panel inside After Effects, and the
validated loop runs to completion on its own.

```
AE panel (thin client)  ──request.json──▶  kernel (brain)  ──ae-mcp-bridge──▶  After Effects
   ae-ai-panel.jsx      ◀──state.json───   kernel.mjs                            ▲
   input · progress                        perceive → plan → act → verify        │
   preview · keep/undo                     → converge → present                  │
                                                    │                            │
                                        plan_edit.mjs (the new piece)────────────┘
```

## The three pieces

| piece | where it runs | what it owns |
|---|---|---|
| `panel/ae-ai-panel.jsx` | inside AE (ScriptUI palette) | the intent box, progress, the preview frame, Keep / Roll back. Decides nothing — renders `state.json`. |
| `kernel.mjs` | Node, outside AE | the pipeline, the session, rollback. Everything that can't run in AE's script engine. |
| `plan_edit.mjs` | Node, outside AE | **intent + perception + essence index → a validated edit spec.** |

`plan_edit` is the piece the lab never had. Every other stage was already headless; deciding *what
to change* was always the agent reasoning in-session, which is exactly why the lab needed a human in
the loop to do anything at all.

## Run it

```bash
./shell/shell_up.sh          # bridge + panel + kernel, idempotent
./shell/shell_up.sh --no-panel   # kernel only (headless testing)
```

Then in AE: select a layer, type what you want, press **Make it**. Watch the preview. **Keep it** or
**Roll back**. A zero-edit handoff instead offers **Helpful / Not enough**; those usefulness labels
go to `~/Documents/ae-ai-shell/handoff_feedback.jsonl`, separate from visual decisions.

Pieces can also be driven directly:

```bash
node brownfield/dump_comp.mjs --out=/tmp/w
node shell/plan_edit.mjs --intent="soft dreamy bloom" --state=/tmp/w/*_state.json --frame=/tmp/w/*_frame.png --out=/tmp/w/spec.json
node brownfield/tune_edit.mjs --seed=/tmp/w/spec.json --intent="soft dreamy bloom" --layer=1
```

## Safety properties

These are the ones that decide whether this is usable on real work, so they are tested, not assumed:

- **Rollback undoes the whole request**, not one iteration — every edit the request applied, newest
  first, via `apply_edit`'s recorded inverses rather than AE's undo stack (which any stray user
  action would bury).
- **The session survives a kernel restart.** `session.json` records what is applied and unaccepted.
  A kernel that dies mid-review would otherwise strand the artist with edits the product can no
  longer undo. *Verified: killed the kernel with an edit pending, started a fresh process, pressed
  Roll back — comp restored to its exact original param values.*
- **The loop returns its best state, not its last.** A tune that peaks then tries a worse idea rolls
  back to the peak before handing over.
- **A second request never orphans the first.** Asking another question while an edit is still
  unaccepted carries the earlier rollback reports forward rather than overwriting them, so Roll back
  unwinds everything the product did, newest first. The panel says how much that covers.
- **Opaque cores are refused, not bluffed.** If the load-bearing state isn't scriptable (an unpainted
  Roto matte, an unbuilt Element 3D scene), the plan comes back empty with a `handoff` phase naming
  what the artist must do — rather than applying a param edit that looks like work and does nothing.
- **Every matchName is validated against perception before anything is applied.** A hallucinated
  param is dropped at planning time instead of burning an apply→render→verify cycle.

## Tests

`node test/smoke.mjs` — 39 offline assertions, no AE required, covering the pure logic the loop
trusts without checking: the frame-delta inert/weak/changed classification at both bit depths, the
guarantee that a *failed* comparison reports `ok:false` rather than a fabricated "inert", and the
essence lookup's three-way lever split (usable / gated / unreachable).

## Status

End-to-end verified on a live comp: Chinese and English intents, plan → apply → self-verify →
accept, and rollback from a restarted kernel. What has *not* been exercised yet is the panel's own
UI under a human hand (the agent had no screen access this session) and a 4K/146-layer real project
through the full shell — `dogfooding` is the next step, per PRD §9.3 item 3.

Known gaps: single request at a time; no cost/latency budgeting; BYOK only (reads
`recipe-harness/.env.api`); AE 2022 paths hard-coded in `shell_up.sh`.
