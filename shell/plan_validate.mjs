// plan_validate.mjs — the mechanical guard between the planner's JSON and apply_edit.
//
// Extracted from plan_edit.mjs so the offline tests can hold it still (this is exactly the kind of
// pure loop-trusted logic test/smoke.mjs exists to pin), and extended with INSTANCE ADDRESSING —
// the last third of KNOWN_ISSUES #2. dump_comp emits paradeIndex and apply_edit accepts
// effectIndex (refusing ambiguity otherwise); this is the piece that joins them: the planner's
// edits leave here with an effectIndex whenever one is needed, so an edit on a layer carrying two
// Glows no longer reaches apply_edit as a guaranteed "AMBIGUOUS" refusal — a whole
// apply→render→verify cycle wasted on an addressing gap the validator could see coming.
//
// Validation is IN ORDER, because an effect added by edit N is legitimately present for edit N+1.
export function validateEdits(rawEdits, state, installedByMatch) {
  const layerByIndex = new Map((state.layers || []).map(l => [l.index, l]));
  const problems = [];
  // Where a freshly-added effect will land: AE appends to the parade, so its slot is the layer's
  // current effect count plus how many this spec has already added there. apply_edit verifies the
  // matchName at any pinned slot, so if this arithmetic is ever wrong it fails loudly, not silently.
  const addsPerLayer = new Map();  // layerIndex -> adds so far in this spec (any effect — slot arithmetic)
  const addedSlot = new Map();     // "<layerIndex>|<matchName>" -> predicted parade slot of the NEWEST add
  const addedCount = new Map();    // "<layerIndex>|<matchName>" -> how many this spec has added

  const edits = (rawEdits || []).filter(e => {
    const L = layerByIndex.get(e.layerIndex);
    if (!L) { problems.push(`layer ${e.layerIndex} does not exist — edit dropped`); return false; }
    if (!L.activeNow) problems.push(`layer ${e.layerIndex} "${L.name}" is not live at this frame — the edit may be invisible`);
    if (e.op === 'addEffect') {
      if (!installedByMatch.has(e.effectMatchName)) {
        problems.push(`effect ${e.effectMatchName} is not installed on this machine — edit dropped`);
        return false;
      }
      const adds = (addsPerLayer.get(e.layerIndex) || 0) + 1;
      addsPerLayer.set(e.layerIndex, adds);
      addedSlot.set(`${e.layerIndex}|${e.effectMatchName}`, (L.effects || []).length + adds);
      addedCount.set(`${e.layerIndex}|${e.effectMatchName}`, (addedCount.get(`${e.layerIndex}|${e.effectMatchName}`) || 0) + 1);
      return true;
    }
    if (e.op === 'expression') return true;
    if (e.op === 'param') {
      const addKey = `${e.layerIndex}|${e.effectMatchName}`;
      const matches = (L.effects || []).filter(f => f.matchName === e.effectMatchName);
      const predicted = addedSlot.get(addKey);   // set only when THIS spec added one on this layer

      // -- resolve WHICH instance the edit means ------------------------------------------------
      // fx = the perception entry to validate params against; null = the freshly-added instance
      // (perception predates it — a sibling instance or the ownership rule validates instead).
      let fx = null, fresh = false;
      if (predicted && (e.effectIndex == null || e.effectIndex === predicted)) {
        // This spec itself added an instance. A param op that follows means the NEW one — you add
        // an effect in order to configure it. Pinning only matters when the effect will be
        // DUPLICATED by the time this edit applies (a pre-existing copy, or this spec adding two):
        // then an unpinned edit is ambiguous the moment the add lands, so pin it to the slot the
        // newest add will occupy. On a bare layer the unique-match path downstream is already exact.
        const copiesAtApply = matches.length + (addedCount.get(addKey) || 0);
        if (e.effectIndex == null && copiesAtApply > 1) {
          e.effectIndex = predicted;
          problems.push(`param ${e.paramMatchName} follows this plan's own addEffect — pinned to the new ${e.effectMatchName} at parade slot ${predicted}`);
        }
        fresh = true;
      } else if (e.effectIndex != null) {
        // The plan says WHICH existing instance. Hold it to the perception dump: the slot must
        // exist and must hold this effect — a stale or invented index would otherwise surface
        // downstream as apply_edit's refusal, one paid cycle too late.
        const pinned = (L.effects || []).find(f => f.paradeIndex === e.effectIndex);
        if (!pinned) { problems.push(`effectIndex ${e.effectIndex} does not exist on layer ${e.layerIndex} — edit dropped`); return false; }
        if (pinned.matchName !== e.effectMatchName) { problems.push(`effectIndex ${e.effectIndex} on layer ${e.layerIndex} holds ${pinned.matchName}, not ${e.effectMatchName} — edit dropped`); return false; }
        fx = pinned;
      } else if (matches.length > 1) {
        // apply_edit REFUSES an unpinned edit when the matchName is duplicated (rollback
        // correctness — C.3(b)), so "targets the first" was never what happened; the cycle just
        // died. Pin deterministically to the first instance and say so. The planner was shown
        // every paradeIndex, so a plan that MEANT the second instance can say so next round.
        if (matches[0].paradeIndex != null) {
          e.effectIndex = matches[0].paradeIndex;
          problems.push(`layer ${e.layerIndex} has ${matches.length} copies of ${e.effectMatchName} and the plan did not say which — pinned to parade slot ${e.effectIndex}`);
        } else {
          problems.push(`layer ${e.layerIndex} has ${matches.length} copies of ${e.effectMatchName}; the perception dump carries no paradeIndex, so this cannot be pinned — apply will refuse it`);
        }
        fx = matches[0];
      } else if (matches.length === 1) {
        fx = matches[0];
      } else {
        problems.push(`effect ${e.effectMatchName} is not on layer ${e.layerIndex} — edit dropped`);
        return false;
      }

      // -- validate the param on the resolved instance ------------------------------------------
      if (fresh) {
        // The instance does not exist yet. A sibling copy carries the same effect's param set, so
        // check against it when one is present; otherwise fall back to the ownership rule (a param
        // matchName must belong to its effect). A brand-new effect has no keyframes, so no
        // keyframeMode is needed either way.
        if (matches.length) {
          if (!(matches[0].params || []).find(q => q.matchName === e.paramMatchName)) {
            problems.push(`param ${e.paramMatchName} is not on ${e.effectMatchName} — edit dropped`);
            return false;
          }
        } else if (!String(e.paramMatchName || '').startsWith(e.effectMatchName)) {
          problems.push(`param ${e.paramMatchName} does not belong to ${e.effectMatchName} — edit dropped`);
          return false;
        }
        return true;
      }
      const p = (fx.params || []).find(q => q.matchName === e.paramMatchName);
      if (!p) { problems.push(`param ${e.paramMatchName} is not on ${e.effectMatchName} — edit dropped`); return false; }
      // A keyframed param needs an explicit mode or apply_edit will refuse it. The edit is now
      // pinned to ONE instance, so that instance's own key count is the truth (the old max-across-
      // copies guess existed only because the edit could land anywhere). Defaulting the mode is
      // harmless while omitting it is a hard refusal downstream.
      if (p.numKeys && !e.keyframeMode) {
        e.keyframeMode = 'setAtTime';
        problems.push(`param ${e.paramMatchName} is keyframed (${p.numKeys} keys) and no keyframeMode was given — defaulted to setAtTime`);
      }
      return true;
    }
    problems.push(`unknown op "${e.op}" — edit dropped`);
    return false;
  });

  return { edits, problems };
}
