// card_lookup.mjs — reusable structural truth from introspection cards.
//
// installed_effects.json proves an effect exists; cards/<matchName>.json proves which of its
// properties are writable scalar/vector leaves. This distinction prevents a fresh-effect plan
// from treating a GROUP/CUSTOM header as a value merely because its matchName shares the prefix.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CARDS = path.join(__dirname, 'cards');

export function loadParamCards(cardsDir = DEFAULT_CARDS) {
  const out = new Map();
  let files = [];
  try { files = fs.readdirSync(cardsDir).filter(f => f.endsWith('.json')); } catch { return out; }
  for (const file of files) {
    try {
      const card = JSON.parse(fs.readFileSync(path.join(cardsDir, file), 'utf8'));
      const match = card?.effect?.matchName;
      if (match && Array.isArray(card.params)) out.set(match, card);
    } catch { /* one corrupt card must not disable every other effect */ }
  }
  return out;
}

function valueShapeMatches(type, value) {
  if (type === '1D' || type === 'LAYER_INDEX' || type === 'MASK_INDEX') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'COLOR') return Array.isArray(value) && (value.length === 3 || value.length === 4) && value.every(Number.isFinite);
  if (type === '2D' || type === '2D_SPATIAL') return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
  if (type === '3D' || type === '3D_SPATIAL') return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  return true;
}

export function cardParamProblem(card, paramMatchName, value) {
  if (!card) return null;
  const p = (card.params || []).find(x => x.matchName === paramMatchName);
  if (!p) return `param ${paramMatchName} is absent from the introspected ${card.effect?.name || 'effect'} card`;
  if (p.type === 'GROUP' || p.type === 'CUSTOM' || p.type === 'MARKER') {
    return `param ${paramMatchName} "${p.name || ''}" is ${p.type}, not a writable value leaf`;
  }
  if (p.settable === 'n/a' || p.settable === 'no') {
    return `param ${paramMatchName} "${p.name || ''}" is not settable on the introspected default instance`;
  }
  if (!valueShapeMatches(p.type, value)) {
    return `param ${paramMatchName} "${p.name || ''}" expects ${p.type}, but the plan supplied ${Array.isArray(value) ? `an array of ${value.length}` : typeof value}`;
  }
  if ((p.type === '1D' || p.type === 'LAYER_INDEX' || p.type === 'MASK_INDEX')
      && ((p.min !== undefined && value < p.min) || (p.max !== undefined && value > p.max))) {
    return `param ${paramMatchName} "${p.name || ''}" value ${value} is outside the introspected range ${p.min ?? '-∞'}..${p.max ?? '∞'}`;
  }
  return null;
}

export function compactCardBlock(card, limit = 90) {
  if (!card) return '';
  const writable = (card.params || [])
    .filter(p => p.matchName && p.name && p.type !== 'GROUP' && p.type !== 'CUSTOM' && p.type !== 'MARKER')
    .filter(p => p.settable !== 'n/a' && p.settable !== 'no')
    .slice(0, limit)
    .map(p => `  · ${p.name} [${p.matchName}] ${p.type}`
      + (p.min !== undefined && p.max !== undefined ? ` range=${p.min}..${p.max}` : '')
      + (p.settable === 'hidden' ? ' ⟨gated/hidden by default⟩' : ''));
  const opaque = (card.params || [])
    .filter(p => p.matchName && p.name && (p.type === 'GROUP' || p.type === 'CUSTOM' || p.type === 'MARKER'))
    .slice(0, 30)
    .map(p => `  × ${p.name} [${p.matchName}] ${p.type} — UNSCRIPTABLE with setValue`);
  return [
    `=== PARAM CARD: ${card.effect?.name || ''} [${card.effect?.matchName || ''}] ===`,
    ...writable,
    ...(opaque.length ? ['  UNSCRIPTABLE STRUCTURE:', ...opaque] : []),
  ].join('\n');
}
