// suggest_spec.mjs — the scorer's typed suggestions -> apply_edit ops, as a pure function.
//
// Extracted from tune_edit.mjs so test/smoke.mjs can pin it: this is loop-trusted logic in the
// hottest path (every tune iteration flows through it), and its two known failure modes are both
// SILENT — a wrong owner sends an edit to an effect that isn't there (a wasted iteration), and an
// unparsed "#N" instance suffix used to travel whole into effectMatchName, where findFxAt would
// search for a literal matchName "PEDG#2" and fail every time. The suffix was documented as
// "addressing, not naming" — but nothing downstream ever did the addressing.
//
// pinnedSlot (effect matchName -> parade slot) carries the tune's instance decisions: seeded from
// the planner's effectIndex pins, widened when a suggestion carries "#N". Without inheriting it,
// every scorer-suggested nudge on a twinned effect would reach apply_edit unpinned and be refused
// as AMBIGUOUS — the planner's disambiguation would last exactly one iteration.
export function suggestionsToEdits(suggestions, targetLayer, pinnedSlot = new Map()) {
  const edits = [];
  for (const s of suggestions || []) {
    if (s.type === 'param' && s.matchName && s.value !== undefined) {
      // THE PARAM matchName IS GROUND TRUTH FOR ITS OWNER. Vendor param matchNames are
      // `<effect matchName>-<digits>`, so the effect is derivable and does not have to be trusted
      // from the scorer's `effect` field — which is wrong often enough to matter: gemini returned
      // the DISPLAY name ("Deep Glow") where apply_edit looks up by matchName ("PEDG"), so all
      // three edits of an iteration failed with "effect not found", the report carried no inverse,
      // and the whole iteration was silently wasted. The old fallback only fired when `effect` was
      // ABSENT, not when it was wrong.
      const rawGiven = String(s.effect || '');
      const sufMatch = rawGiven.match(/^(.*?)#(\d+)$/);
      const given = sufMatch ? sufMatch[1] : rawGiven;
      const slotFromSuffix = sufMatch ? Number(sufMatch[2]) : null;
      const derived = String(s.matchName).replace(/-\d+$/, '');
      const fx = (given && given === derived) ? given : (derived || given);
      if (given && fx !== given) console.log(`  (scorer named effect "${given}" for ${s.matchName}; using "${fx}" derived from the param)`);
      const slot = slotFromSuffix ?? pinnedSlot.get(fx) ?? null;
      if (slotFromSuffix != null) pinnedSlot.set(fx, slotFromSuffix);
      edits.push({ op: 'param', layerIndex: targetLayer, effectMatchName: fx, paramMatchName: s.matchName, value: s.value, ...(slot != null ? { effectIndex: slot } : {}) });
    } else if (s.type === 'effect' && s.matchName) {
      edits.push({ op: 'addEffect', layerIndex: targetLayer, effectMatchName: s.matchName });
    } else if (s.type === 'expression' && s.matchName && s.expression) {
      // A pinned effect's expression path addresses the parade BY SLOT (ExtendScript's property()
      // takes a 1-based index as happily as a matchName); by name it would bind to the first
      // instance, silently.
      const em = String(s.effect || '').match(/^(.*?)#(\d+)$/);
      const fxEl = em ? Number(em[2]) : (pinnedSlot.get(String(s.effect || '')) ?? s.effect);
      edits.push({ op: 'expression', layerIndex: targetLayer, propertyPath: ['ADBE Effect Parade', fxEl, s.matchName], expression: s.expression });
    }
  }
  return edits;
}
