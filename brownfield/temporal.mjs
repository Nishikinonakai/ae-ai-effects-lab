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
