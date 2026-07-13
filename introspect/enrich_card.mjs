// enrich_card.mjs — merge structural card + vision descriptions into an enriched effect card.
//
// The enriched card is the ontology artifact an LLM consumes to drive the effect: structure
// (from introspect) + semantics (from the vision loop). Enum params gain per-value labels;
// context/temporal caveats are carried through so the planner doesn't trust a degenerate probe.
//
// usage: node enrich_card.mjs cards/<effect>.json enrichment/<effect>.descriptions.json
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENRICH = path.join(__dirname, 'enrichment');

const [cardArg, descArg] = process.argv.slice(2);
if (!cardArg || !descArg) { console.error('usage: node enrich_card.mjs <card.json> <descriptions.json>'); process.exit(1); }

const card = JSON.parse(fs.readFileSync(cardArg, 'utf8'));
const desc = JSON.parse(fs.readFileSync(descArg, 'utf8'));
const D = desc.descriptions || {};

let enrichedCount = 0;
const params = card.params.map(p => {
  if (p.type === 'GROUP') return p;
  const d = D[p.matchName];
  if (!d) return p;
  enrichedCount++;
  return {
    ...p,
    semantics: {
      role: d.param,
      enum: d.values || undefined,
      note: d.note || undefined,
      caveat: d.caveat || undefined,
    },
  };
});

const enriched = {
  effect: card.effect,
  counts: { ...card.counts, enriched: enrichedCount },
  ontologySource: { structure: 'introspect', semantics: desc.backend || 'vision' },
  params,
};

const outSafe = card.effect.matchName.replace(/[^a-zA-Z0-9]+/g, '_');
const outPath = path.join(ENRICH, outSafe + '.enriched.json');
fs.writeFileSync(outPath, JSON.stringify(enriched, null, 2));

// human summary
console.log(`enriched card: ${card.effect.name}  (${enrichedCount} params semantically labeled)`);
for (const p of params) {
  if (!p.semantics) continue;
  console.log(`\n  ${p.semantics.role}  [${p.type}]`);
  if (p.semantics.enum) for (const [v, label] of Object.entries(p.semantics.enum)) console.log(`    ${v} = ${label}`);
  if (p.semantics.caveat) console.log(`    ⚠ ${p.semantics.caveat}`);
}
console.log(`\n-> ${outPath}`);
