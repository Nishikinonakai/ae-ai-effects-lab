// intent_effects.mjs — recover effect names the artist explicitly wrote in the request.
//
// This is intentionally narrower than general style understanding. It answers only a mechanical
// contract question: if the artist said "Lumetri", may the planner silently use Tint instead? No.
// Installed display names provide the vocabulary; overlapping names prefer the longest match so
// "Deep Glow" does not also become a request for the built-in "Glow".

function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[®™]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function occurrences(text, phrase) {
  const found = [];
  let from = 0;
  while (from <= text.length - phrase.length) {
    const start = text.indexOf(phrase, from);
    if (start < 0) break;
    const end = start + phrase.length;
    const first = phrase[0], last = phrase[phrase.length - 1];
    const before = start ? text[start - 1] : '';
    const after = end < text.length ? text[end] : '';
    const badBefore = /[a-z0-9]/.test(first) && /[a-z0-9]/.test(before);
    const badAfter = /[a-z0-9]/.test(last) && /[a-z0-9]/.test(after);
    if (!badBefore && !badAfter) found.push({ start, end });
    from = start + 1;
  }
  return found;
}

function negated(text, start) {
  const prefix = text.slice(Math.max(0, start - 18), start);
  return /(?:不要(?:用)?|不用|别用|不是|而非)\s*$|(?:not|no|without|don'?t use|do not use)\s*$/i.test(prefix);
}

export function mentionedInstalledEffects(intent, installedEffects) {
  const text = normalise(intent);
  if (!text) return [];

  // phrase -> all installed effects carrying that display name/alias. Duplicate display names are
  // legitimate, so the contract accepts any of their matchNames.
  const byPhrase = new Map();
  for (const fx of installedEffects || []) {
    const full = normalise(fx?.name);
    if (full.length < 4 || !fx?.match) continue;
    const aliases = [full];
    // Artists routinely say "Lumetri"; AE's installed display name is "Lumetri Color".
    if (full.endsWith(' color') && full.slice(0, -6).length >= 6) aliases.push(full.slice(0, -6));
    for (const phrase of aliases) {
      if (!byPhrase.has(phrase)) byPhrase.set(phrase, { phrase, names: new Set(), matchNames: new Set() });
      byPhrase.get(phrase).names.add(fx.name);
      byPhrase.get(phrase).matchNames.add(fx.match);
    }
  }

  const hits = [];
  for (const item of byPhrase.values()) {
    for (const span of occurrences(text, item.phrase)) {
      if (!negated(text, span.start)) hits.push({ ...span, ...item });
    }
  }

  // Suppress nested shorter effect names at the same location: Deep Glow wins over Glow.
  const maximal = hits.filter(a => !hits.some(b =>
    b !== a && b.start <= a.start && b.end >= a.end && (b.end - b.start) > (a.end - a.start)));

  const unique = new Map();
  for (const h of maximal) {
    const key = `${h.start}|${h.end}|${h.phrase}`;
    if (!unique.has(key)) unique.set(key, {
      phrase: h.phrase,
      displayNames: [...h.names],
      matchNames: [...h.matchNames],
    });
  }
  return [...unique.values()];
}

export function explicitEffectProblems(intent, installedEffects, edits) {
  const mentions = mentionedInstalledEffects(intent, installedEffects);
  if (!mentions.length) return [];

  const touched = new Set();
  for (const e of edits || []) {
    if (e.effectMatchName) touched.add(e.effectMatchName);
    const pathEffect = e.propertyPath?.[1];
    if (typeof pathEffect === 'string') touched.add(pathEffect);
  }

  return mentions
    .filter(m => !m.matchNames.some(match => touched.has(match)))
    .map(m => {
      const expected = m.displayNames.join(' / ');
      const actual = [...touched].join(', ') || 'no effect';
      return `intent explicitly names ${expected} [${m.matchNames.join(' | ')}], but the validated plan touches ${actual}`;
    });
}
