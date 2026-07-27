// temporal.mjs — is this intent about TIME, not just a look?
//
// KNOWN_ISSUES #13: the loop judged everything on before/after stills, and a temporal ask
// ("消散得更留恋一点") was silently optimised in its spatial projection — the product neither
// refused nor upgraded its evidence. This is the detector that triggers the upgrade: when the
// intent speaks in motion words, verify_edit samples several AFTER frames across time and hands
// the scorer a sequence instead of a single look.
//
// The cue list leans INCLUSIVE by design. The costs are asymmetric: a false positive renders a
// few extra frames (~a second of wall time, ~$0.001 of image tokens); a false negative judges
// motion blind — the exact §E.2-C failure. When unsure, sample.
import { classifyDelta } from './frame_delta.mjs';

const CUES = [
  // zh — motion / evolution / rhythm
  '消散', '渐渐', '逐渐', '越来越', '慢慢', '缓缓', '呼吸', '起伏', '节奏', '律动', '闪烁',
  '飘', '摇曳', '摆动', '晃动', '抖动', '留恋', '淡入', '淡出', '渐入', '渐出', '循环',
  '加速', '减速', '忽明忽暗', '脉冲', '脉动', '流动', '滚动', '波动', '颤',
  // en
  'gradually', 'slowly', 'over time', 'breath', 'breathing', 'pulse', 'pulsing', 'puls',
  'flicker', 'drift', 'sway', 'wobble', 'shake', 'linger', 'fade in', 'fade out', 'fades',
  'loop', 'rhythm', 'speed up', 'slow down', 'accelerat', 'oscillat', 'throb', 'evolv',
  'scroll', 'flow', 'wave', 'ripple',
];

export function temporalCues(intent) {
  const s = String(intent || '').toLowerCase();
  const hits = [];
  for (const c of CUES) if (s.indexOf(c) !== -1) hits.push(c);
  return hits;
}

export function isTemporalIntent(intent) {
  return temporalCues(intent).length > 0;
}

// Motion can be introduced BY THE PLAN even when the artist's wording is purely emotional or
// spatial ("make it tense"). Once an expression, keyframed edit, particle system, shake or glitch
// exists in the validated plan, judging only the current still is no longer valid evidence.
const TEMPORAL_EFFECT = /(?:camera.?shake|shake|jitter|glitch|damaged|particular|form|motion|tile|wave|ripple|turbulent|wiggle|echo|time)/i;

export function temporalEditCues(edits) {
  const hits = [];
  for (const e of edits || []) {
    if (!e) continue;
    if (e.op === 'expression' || e.expression !== undefined) {
      hits.push(`edit:expression:${e.target || e.paramMatchName || 'property'}`);
    }
    if (e.keyframeMode || e.op === 'param-scale' || e.op === 'param-setAtTime') {
      hits.push(`edit:keyframes:${e.paramMatchName || e.param || 'property'}`);
    }
    const fx = e.effectMatchName || e.effect || '';
    if (fx && TEMPORAL_EFFECT.test(fx)) hits.push(`edit:effect:${fx}`);
  }
  return [...new Set(hits)];
}

export function temporalFramesChanged(deltas) {
  return (deltas || []).some(d => {
    const c = classifyDelta(d);
    return c !== null && c !== 'inert';
  });
}
