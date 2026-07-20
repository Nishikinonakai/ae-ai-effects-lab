// lookup.mjs — the RUNTIME READ SIDE of the essence index.
//
// The essence cards (introspect/essence/*.essence.json) were built as knowledge artifacts: one card
// per effect, holding the causal model (what each lever does, what a config for a given feel looks
// like, where the opaque core starts). Until now they were read by humans and by the planner. This
// module makes them readable by the LOOP — specifically by the visual scorer.
//
// WHY (E2E finding #6, the last open one): tune_edit's multi-lever pivot is bounded by what the
// scorer can SEE. review_schema tells the scorer "only reference param matchNames visible in the
// plan" — a deliberate guard against hallucinated matchNames — but it also means a tune that seeds
// with `Exposure` can only ever push Exposure. When Exposure plateaus (the classic single-lever
// high-plateau from the KillKiss E2E), the scorer has no vocabulary to say "stop pushing brightness,
// widen the Radius instead". The knowledge to pivot exists — in the card — it just never reached the
// request. This module is that wire: it turns the hit cards into a CO-LEVER block the scorer may
// pivot to, with real matchNames and ranges, so the guard stays intact (no invention) while the
// vocabulary widens.
//
// api:
//   loadCards()                              → [card, ...] (each with _file)
//   cardFor(matchName)                       → card | null   (accepts effect OR param matchName)
//   leverContext(effectMatchNames, usedParams) → { block, cards, levers }
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _cards = null;
export function loadCards(dir = __dirname) {
  if (_cards) return _cards;
  _cards = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.essence.json'))) {
    try {
      const card = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      card._file = f;
      _cards.push(card);
    } catch (e) { console.error(`essence: skipping unreadable card ${f}: ${e.message}`); }
  }
  return _cards;
}

const cardKey = c => c.matchName || c.primaryMatchName || '';

// Accepts either an effect matchName ("PEDG") or a param matchName ("PEDG-0002"). Vendor param
// matchNames are `<effect matchName>-<digits>` across every family we have cards for (PEDG-0002,
// BCC Cross Glitch-10682374, ADBE Samurai-0009), so stripping one trailing -<digits> group is the
// general un-suffix rule. Falls back to displayName so a card can be found from a UI-facing name.
export function cardFor(matchName, dir = __dirname) {
  if (!matchName) return null;
  const cards = loadCards(dir);
  const mn = String(matchName).trim();
  // an "#2"-style instance suffix (review_schema's Nth-instance addressing) is not part of the key
  const base = mn.replace(/#\d+$/, '');
  return cards.find(c => cardKey(c) === base)
      || cards.find(c => cardKey(c) === base.replace(/-\d+$/, ''))
      || cards.find(c => (c.displayName || '').toLowerCase() === base.toLowerCase())
      || null;
}

const clip = (s, n = 170) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function rangeStr(l) {
  if (!Array.isArray(l.range)) return '';
  const u = l.units ? ` ${l.units}` : '';
  return ` range ${l.range[0]}..${l.range[1]}${u}${l.default !== undefined ? `, default ${l.default}` : ''}`;
}

// Build the scorer-facing co-lever block for the effects in play.
//   effectMatchNames : effects the current edit/plan touches (order preserved, deduped)
//   usedParams       : param matchNames the plan ALREADY moves — marked "in play" rather than
//                      offered, so the scorer sees what it has been pushing vs what it hasn't.
export function leverContext(effectMatchNames, usedParams = [], dir = __dirname) {
  const used = new Set((usedParams || []).map(p => String(p).trim()));
  const seen = new Set();
  const lines = [];
  const hitCards = [];
  const levers = [];

  for (const raw of effectMatchNames || []) {
    const card = cardFor(raw, dir);
    if (!card || seen.has(cardKey(card))) continue;
    seen.add(cardKey(card));
    hitCards.push(card);

    lines.push(`${card.displayName || cardKey(card)} [${cardKey(card)}] — ${clip(card.essence, 200)}`);

    // Levers the card records as UNREACHABLE never reach the scorer. Some plugins expose params to
    // the scripting API that they never open for writing (Deep Glow has 9: they report a name, a
    // range, units and a live value, and reject every setValue). Offering one is worse than saying
    // nothing — the scorer picks the plausible-sounding lever, the edit throws, and the iteration
    // is spent. Belt and braces: filter them out of key_levers too, in case a card lists both.
    const unreachable = new Set((card.unreachable_levers || []).map(u => u.matchName));
    for (const l of (card.key_levers || [])) {
      if (unreachable.has(l.matchName)) continue;
      const inPlay = used.has(l.matchName);
      levers.push({ effect: cardKey(card), name: l.name, matchName: l.matchName, inPlay });
      lines.push(`  ${inPlay ? '·(in play)' : '·'} ${l.name} [${l.matchName}]${rangeStr(l)}${l.enum ? ' ENUM' : ''} — ${clip(l.effect)}`);
    }

    // NAME the dead ones. Filtering them out silently is only half the job: the planner knows these
    // effects from its own training and will reach for Deep Glow's Spread whether or not this card
    // mentions it — absence is not instruction. The filter above has in fact never fired, because
    // dead levers were deleted from key_levers outright, which means until now this knowledge was
    // stored and never delivered. One line is cheap; a wasted tune iteration is not.
    const dead = (card.unreachable_levers || []).filter(u => u.matchName);
    if (dead.length) {
      lines.push(`  ⟨DEAD — readable but never writable; do NOT reach for these⟩ ${dead.map(u => `${u.name} [${u.matchName}]`).join(', ')}`);
    }

    // --- gated levers: real, useful, but they need their gate opened FIRST ---
    // These are the "hidden parameter gating" cases the ontology exists to hold. Hiding them would
    // throw away usable range; offering them naked would produce an edit that throws. So they are
    // offered WITH their gate, as a two-step instruction.
    for (const g of card.gated_levers || []) {
      levers.push({ effect: cardKey(card), name: g.name, matchName: g.matchName, inPlay: used.has(g.matchName), gated: true });
      const gate = g.gate ? ` — GATED: set ${g.gate.name} [${g.gate.matchName}] = ${g.gate.setTo} FIRST, in the same edit, or this write throws` : '';
      lines.push(`  ·⟨gated⟩ ${g.name} [${g.matchName}]${rangeStr(g)} — ${clip(g.effect, 140)}${gate}`);
    }

    // --- spatial-ml cards: the surface is phase-gated, so say which phase each band needs ---
    for (const s of card.scriptable_surface || []) {
      const phase = s.phase ? ` (phase: ${s.phase})` : '';
      lines.push(`  · ${clip(s.controls, 130)}${phase}${s.example_params ? ` — params: ${clip(s.example_params, 150)}` : ''}`);
    }
    if (card.state_gate) {
      const g = typeof card.state_gate === 'string' ? card.state_gate : (card.state_gate.summary || JSON.stringify(card.state_gate));
      lines.push(`  ⟨GATE⟩ ${clip(g, 220)} — do NOT suggest params that need state the user has not created yet.`);
    }

    // --- config_recipes: the "for THIS feel, set THESE together" knowledge — the pivot fuel ---
    const cr = card.config_recipes;
    if (cr && typeof cr === 'object') {
      const entries = Array.isArray(cr) ? cr.map((v, i) => [String(i), v]) : Object.entries(cr);
      if (entries.length) {
        lines.push('  config recipes (co-lever combinations that produce a named feel):');
        for (const [k, v] of entries) lines.push(`    - ${k}: ${clip(typeof v === 'string' ? v : JSON.stringify(v), 200)}`);
      }
    }
  }

  if (!lines.length) return { block: '', cards: [], levers: [] };

  const block = [
    'AVAILABLE LEVERS (from the essence index — the causal model of the effects already in this plan).',
    'These matchNames are VERIFIED to exist on these effects: you MAY suggest any of them, including',
    'levers the plan is not yet touching. This overrides the "only matchNames visible in the plan"',
    'restriction for these effects ONLY — do not invent matchNames that appear nowhere.',
    'IMPORTANT: if a lever marked "(in play)" has already been pushed across iterations without the',
    'frame improving, that lever is PLATEAUED — pivot to a different lever from this list (or a',
    'config-recipe combination) rather than nudging the same one again.',
    '',
    ...lines,
  ].join('\n');

  return { block, cards: hitCards, levers };
}

// Collect the effect matchNames + already-moved param matchNames from an apply_edit spec/report.
// Handles both the spec shape (effectMatchName/paramMatchName) and the applied shape (effect/param).
export function effectsFromEdits(edits = []) {
  const effects = [];
  const params = [];
  for (const e of edits || []) {
    const fx = e.effectMatchName || e.effect;
    const pm = e.paramMatchName || e.param;
    if (fx) effects.push(fx);
    if (pm) { params.push(pm); if (!fx) effects.push(String(pm).replace(/-\d+$/, '')); }
    if (Array.isArray(e.propertyPath) && e.propertyPath[1]) effects.push(e.propertyPath[1]);
  }
  return { effects: [...new Set(effects)], params: [...new Set(params)] };
}

// CLI: node introspect/essence/lookup.mjs PEDG "BCC Cross Glitch-10682374"
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  if (!args.length) {
    const cards = loadCards();
    console.log(`${cards.length} essence cards:`);
    for (const c of cards) console.log(`  ${cardKey(c).padEnd(26)} ${c.cardType || 'effect'}  ${c.displayName || ''}`);
  } else {
    const { block } = leverContext(args);
    console.log(block || '(no card matched)');
  }
}
