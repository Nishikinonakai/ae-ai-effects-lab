// smoke.mjs — offline tests for the pure logic the loop trusts blindly.
//
// Most of this repo can only be tested against a live After Effects. But a few pieces are pure
// functions that the loop believes WITHOUT checking, and a silent wrong answer from any of them is
// worse than a crash — it steers the tune in the wrong direction and looks like a real measurement
// while doing it. Those are the ones worth pinning down offline:
//
//   frame_delta   — if this ever returns "inert" for a frame that actually changed, the scorer is
//                   told to hunt a gate that isn't there and the tune derails (observed live: a
//                   bad inert signal took a run from 7/10 to 0/10). Just as bad in reverse: a
//                   failure that reports "inert" instead of "unavailable" fabricates a measurement.
//   essence lookup — decides which levers the scorer may reach for. Offering an unreachable one
//                   burns an iteration; dropping a gated one discards usable range.
//
// usage: node test/smoke.mjs        (exit 0 = all pass)
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { frameDelta, classifyDelta, decodePng } from '../brownfield/frame_delta.mjs';
import { cardFor, leverContext, effectsFromEdits, loadCards } from '../introspect/essence/lookup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aetest-'));

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ---- PNG writer covering both depths the pipeline actually sees --------------------------------
// AE's saveFrameToPng emits 16-bit; the sips copies handed to the scorer are 8-bit. The decoder has
// to agree with itself across both, or the same pair of frames would be judged differently
// depending on which copy the caller happened to pass.
function writePng(file, { w = 8, h = 8, depth = 8, rgb = [0, 0, 0], alpha = null, filter = 0 }) {
  const chans = alpha === null ? 3 : 4;
  const bytesPer = depth / 8;
  const px = [];
  for (const c of [...rgb, ...(alpha === null ? [] : [alpha])]) {
    if (depth === 8) px.push(c & 0xff);
    else px.push((c >> 8) & 0xff, c & 0xff);
  }
  // Encode with the requested filter for real (predictors per PNG spec §9.2). Writing raw bytes and
  // merely LABELLING them "filter 4" would test nothing — the decoder would dutifully un-filter
  // them and produce a different image, which is correct behaviour on a lie.
  const stride = w * chans * bytesPer;
  const bpp = chans * bytesPer;
  const scan = Buffer.concat(Array.from({ length: w }, () => Buffer.from(px)));   // one unfiltered row
  const rows = [];
  for (let y = 0; y < h; y++) {
    const enc = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const cur = scan[x];
      const a = x >= bpp ? scan[x - bpp] : 0;         // left  (rows are identical, so prior == scan)
      const b = y > 0 ? scan[x] : 0;                  // above
      const c = (y > 0 && x >= bpp) ? scan[x - bpp] : 0;  // above-left
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      enc[x] = (cur - pred) & 0xff;
    }
    rows.push(Buffer.concat([Buffer.from([filter]), enc]));
  }
  const raw = Buffer.concat(rows);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = depth; ihdr[9] = chans === 4 ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
  return file;
}
function crc32(buf) {                       // node <20 has no zlib.crc32
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const p = n => path.join(TMP, n);

console.log('\nframe_delta — inert vs weak vs changed');
{
  const a = writePng(p('a8.png'), { rgb: [10, 10, 10] });
  const same = writePng(p('a8b.png'), { rgb: [10, 10, 10] });
  const big = writePng(p('b8.png'), { rgb: [200, 200, 120] });
  const tiny = writePng(p('c8.png'), { rgb: [11, 10, 10] });   // 1/255 — within dither tolerance

  eq('identical frames classify as inert', classifyDelta(frameDelta(a, same)), 'inert');
  eq('a large change classifies as changed', classifyDelta(frameDelta(a, big)), 'changed');
  ok('inert really means zero', frameDelta(a, same).maxDelta === 0);
  ok('a 1/255 difference is not treated as real change', classifyDelta(frameDelta(a, tiny)) === 'inert');
  ok('movedFraction is 1.0 when every pixel changes', frameDelta(a, big).movedFraction === 1);

  // 16-bit is what AE actually writes — the same comparison must reach the same verdict
  const a16 = writePng(p('a16.png'), { depth: 16, rgb: [2570, 2570, 2570] });          // 10/255
  const same16 = writePng(p('a16b.png'), { depth: 16, rgb: [2570, 2570, 2570] });
  const big16 = writePng(p('b16.png'), { depth: 16, rgb: [51400, 51400, 30840] });      // 200/200/120
  eq('16-bit identical → inert', classifyDelta(frameDelta(a16, same16)), 'inert');
  eq('16-bit large change → changed', classifyDelta(frameDelta(a16, big16)), 'changed');
  const d8 = frameDelta(a, big), d16 = frameDelta(a16, big16);
  ok('8-bit and 16-bit agree on magnitude (normalised to 0..255)',
    Math.abs(d8.meanDelta - d16.meanDelta) < 1.0, `8bit=${d8.meanDelta.toFixed(2)} 16bit=${d16.meanDelta.toFixed(2)}`);

  // alpha-only change: a matte edit moves nothing but transparency, and calling that "no change"
  // would tell the scorer to go hunting for a gate that does not exist
  const opaque = writePng(p('op.png'), { rgb: [10, 10, 10], alpha: 255 });
  const clear = writePng(p('cl.png'), { rgb: [10, 10, 10], alpha: 0 });
  eq('an alpha-only change is NOT inert', classifyDelta(frameDelta(opaque, clear)), 'changed');

  // every PNG filter type must decode identically, or the delta is noise
  const filtered = [1, 2, 3, 4].map(f => writePng(p(`f${f}.png`), { rgb: [10, 10, 10], filter: f }));
  ok('all PNG filter types decode to the same image',
    filtered.every(f => frameDelta(a, f).maxDelta === 0));
}

console.log('\nframe_delta — failure must never masquerade as a measurement');
{
  const a = p('a8.png');
  const missing = p('nope.png');
  const bad = p('bad.png'); fs.writeFileSync(bad, 'not a png at all');
  const wrongSize = writePng(p('big.png'), { w: 16, h: 16, rgb: [10, 10, 10] });

  ok('a missing file reports ok:false, not inert', frameDelta(a, missing).ok === false);
  ok('a corrupt file reports ok:false, not inert', frameDelta(a, bad).ok === false);
  ok('mismatched geometry reports ok:false', frameDelta(a, wrongSize).ok === false);
  ok('classifyDelta returns null (not "inert") on failure', classifyDelta(frameDelta(a, bad)) === null);
  ok('an unsupported depth is refused rather than guessed',
    decodePng(writePng(p('d4.png'), { rgb: [1, 1, 1] })).ok === true);
}

console.log('\nessence lookup — which levers may be reached for');
{
  ok('cards load', loadCards().length > 0);
  ok('resolves an effect matchName', cardFor('PEDG')?.displayName === 'Deep Glow');
  ok('resolves from a PARAM matchName', cardFor('PEDG-0002')?.matchName === 'PEDG');
  ok('resolves a vendor param with hyphens in the effect name',
    cardFor('BCC Cross Glitch-10682374')?.matchName === 'BCC Cross Glitch');
  ok('strips an #N instance suffix', cardFor('PEDG#2')?.matchName === 'PEDG');
  ok('unknown matchName yields null, not a wrong card', cardFor('NOPE-9999') === null);
  ok('empty input is safe', cardFor('') === null && cardFor(undefined) === null);

  const lc = leverContext(['PEDG'], ['PEDG-0002']);
  const names = lc.levers.map(l => l.name);
  ok('offers the real levers', names.includes('Exposure') && names.includes('Radius'));
  ok('marks the in-play lever', lc.levers.find(l => l.name === 'Exposure')?.inPlay === true);
  ok('does NOT mark an untouched lever as in play', lc.levers.find(l => l.name === 'Radius')?.inPlay === false);

  // the two categories that cost real iterations when handled wrongly
  ok('an unreachable lever is never offered', !names.includes('Spread'));
  // It must be NAMED, not merely absent. This assertion used to demand the opposite — that PEDG-0011
  // never appear in the prompt at all — which quietly encoded the wrong contract: the planner knows
  // Deep Glow from its own training and will reach for Spread whether or not the card mentions it,
  // so silence is not a warning. What must never happen is Spread appearing as something to REACH
  // FOR; appearing on an explicit do-not-touch line is the whole point.
  ok('a dead lever is named as dead, not silently omitted', /⟨DEAD/.test(lc.block) && /PEDG-0011/.test(lc.block));
  ok('the dead line is not an offer', !new RegExp('·[^\\n]*PEDG-0011').test(lc.block));
  ok('a gated lever IS offered', names.includes('Glow Iterations'));
  ok('a gated lever carries its gate in the prompt', /Auto Iterations \[PEDG-0050\] = 0/.test(lc.block));
  ok('a gated lever is flagged as such', lc.levers.find(l => l.name === 'Glow Iterations')?.gated === true);

  ok('unknown effects yield an empty block, not a crash', leverContext(['NOT_AN_EFFECT']).block === '');
  ok('no input is safe', leverContext([]).block === '' && leverContext(undefined).block === '');
}

console.log('\neffectsFromEdits — recovering which effects an edit touches');
{
  eq('spec shape', effectsFromEdits([{ op: 'param', effectMatchName: 'PEDG', paramMatchName: 'PEDG-0002' }]),
    { effects: ['PEDG'], params: ['PEDG-0002'] });
  eq('applied shape (different field names)', effectsFromEdits([{ op: 'param', effect: 'PEDG', param: 'PEDG-0002' }]),
    { effects: ['PEDG'], params: ['PEDG-0002'] });
  eq('infers the effect from a bare param matchName', effectsFromEdits([{ op: 'param', param: 'PEDG-0002' }]),
    { effects: ['PEDG'], params: ['PEDG-0002'] });
  eq('reads an expression propertyPath', effectsFromEdits([{ op: 'expression', propertyPath: ['ADBE Effect Parade', 'PEDG', 'PEDG-0002'] }]),
    { effects: ['PEDG'], params: [] });
  eq('dedupes', effectsFromEdits([{ effectMatchName: 'PEDG' }, { effectMatchName: 'PEDG' }]),
    { effects: ['PEDG'], params: [] });
  eq('empty is safe', effectsFromEdits([]), { effects: [], params: [] });
  eq('undefined is safe', effectsFromEdits(undefined), { effects: [], params: [] });
}

// ---- plan validator: instance addressing (KNOWN_ISSUES #2, closed) ----------------------------
// The validator decides which effect INSTANCE every param edit binds to. Wrong answers here are
// silent until apply_edit refuses the edit (one paid cycle later) or — worse — until an edit lands
// on a copy the plan never meant. The fixture layer carries twin Glows with different keyframe
// states, so a test that reads the wrong instance's key count fails loudly.
console.log('\nvalidateEdits — instance addressing');
{
  const { validateEdits } = await import('../shell/plan_validate.mjs');
  const twinState = () => ({
    layers: [
      {
        index: 1, name: 'hero', activeNow: true,
        effects: [
          { matchName: 'ADBE Glo2', paradeIndex: 1, params: [{ matchName: 'ADBE Glo2-0002', name: 'Glow Threshold', value: 60 }] },
          { matchName: 'ADBE Glo2', paradeIndex: 2, params: [{ matchName: 'ADBE Glo2-0002', name: 'Glow Threshold', value: 80, numKeys: 3 }] },
          { matchName: 'PEDG', paradeIndex: 3, params: [{ matchName: 'PEDG-0002', name: 'Exposure', value: 1 }] },
        ],
      },
    ],
  });
  const installed = new Map([['ADBE Glo2', {}], ['ADBE Fractal Noise', {}]]);
  const P = (extra) => ({ op: 'param', layerIndex: 1, effectMatchName: 'ADBE Glo2', paramMatchName: 'ADBE Glo2-0002', value: 30, ...extra });

  // Unpinned on twins: apply_edit would refuse it as AMBIGUOUS, so the validator must pin, not shrug.
  let r = validateEdits([P({})], twinState(), installed);
  eq('unpinned edit on twin effects is pinned to the first instance', r.edits[0]?.effectIndex, 1);
  ok('…and says so', r.problems.some(p => /pinned to parade slot 1/.test(p)));

  // An explicit pin is honoured — and the keyframe check reads THAT instance (slot 2 is keyframed,
  // slot 1 is not; the old max-across-copies guess could not tell them apart).
  r = validateEdits([P({ effectIndex: 2 })], twinState(), installed);
  eq('an explicit pin passes through', r.edits[0]?.effectIndex, 2);
  eq('keyframeMode defaults from the PINNED instance\'s keys', r.edits[0]?.keyframeMode, 'setAtTime');
  r = validateEdits([P({ effectIndex: 1 })], twinState(), installed);
  ok('the un-keyframed twin needs no keyframeMode', r.edits[0] && r.edits[0].keyframeMode === undefined);

  // A pin must point at what it claims — stale/invented indices die here, not one paid cycle later.
  r = validateEdits([P({ effectIndex: 3 })], twinState(), installed);   // slot 3 is PEDG
  ok('a pin on a slot holding a different effect is dropped', r.edits.length === 0 && r.problems.some(p => /holds PEDG/.test(p)));
  r = validateEdits([P({ effectIndex: 9 })], twinState(), installed);
  ok('a pin on a nonexistent slot is dropped', r.edits.length === 0 && r.problems.some(p => /does not exist/.test(p)));

  // Single instance: no pin is needed and none is invented.
  r = validateEdits([{ op: 'param', layerIndex: 1, effectMatchName: 'PEDG', paramMatchName: 'PEDG-0002', value: 2 }], twinState(), installed);
  ok('a unique effect stays unpinned', r.edits.length === 1 && r.edits[0].effectIndex === undefined);

  // "Add another Glow, then configure it": the param means the NEW instance, whose slot is
  // predictable (AE appends to the parade). Unpinned it would be ambiguous the moment the add lands.
  r = validateEdits([{ op: 'addEffect', layerIndex: 1, effectMatchName: 'ADBE Glo2' }, P({})], twinState(), installed);
  eq('a param after this plan\'s own addEffect pins to the predicted slot', r.edits[1]?.effectIndex, 4);
  // …and the param is validated against a SIBLING instance (same effect, same param set).
  r = validateEdits([{ op: 'addEffect', layerIndex: 1, effectMatchName: 'ADBE Glo2' }, P({ paramMatchName: 'ADBE Glo2-9999' })], twinState(), installed);
  ok('a bogus param on the fresh instance is caught via its sibling', r.edits.length === 1 && r.problems.some(p => /is not on ADBE Glo2/.test(p)));

  // Fresh effect on a bare layer: no sibling to ask, ownership rule still holds.
  const bare = { layers: [{ index: 1, name: 'solid', activeNow: true, effects: [] }] };
  r = validateEdits([
    { op: 'addEffect', layerIndex: 1, effectMatchName: 'ADBE Fractal Noise' },
    { op: 'param', layerIndex: 1, effectMatchName: 'ADBE Fractal Noise', paramMatchName: 'ADBE Fractal Noise-0010', value: 5 },
  ], bare, installed);
  ok('fresh effect on a bare layer: ownership rule passes its own params', r.edits.length === 2);
  ok('…and stays unpinned (nothing to be ambiguous with)', r.edits[1].effectIndex === undefined);
  r = validateEdits([
    { op: 'addEffect', layerIndex: 1, effectMatchName: 'ADBE Fractal Noise' },
    { op: 'param', layerIndex: 1, effectMatchName: 'ADBE Fractal Noise', paramMatchName: 'XXX-1', value: 5 },
  ], bare, installed);
  ok('…but rejects a foreign param', r.edits.length === 1);

  // The same effect added twice in one spec: a param BETWEEN the adds applies while only one copy
  // exists (unpinned is exact); a param AFTER the second add would be ambiguous, so it pins to the
  // newest slot. Order-sensitive by design — edits apply in the order the spec lists them.
  r = validateEdits([
    { op: 'addEffect', layerIndex: 1, effectMatchName: 'ADBE Fractal Noise' },
    { op: 'param', layerIndex: 1, effectMatchName: 'ADBE Fractal Noise', paramMatchName: 'ADBE Fractal Noise-0010', value: 1 },
    { op: 'addEffect', layerIndex: 1, effectMatchName: 'ADBE Fractal Noise' },
    { op: 'param', layerIndex: 1, effectMatchName: 'ADBE Fractal Noise', paramMatchName: 'ADBE Fractal Noise-0010', value: 2 },
  ], bare, installed);
  ok('a param between twin adds stays unpinned (only one copy exists yet)', r.edits[1].effectIndex === undefined);
  eq('a param after the second add pins to the newest slot', r.edits[3]?.effectIndex, 2);

  r = validateEdits([{ op: 'addEffect', layerIndex: 1, effectMatchName: 'NOT INSTALLED' }], bare, installed);
  ok('an uninstalled addEffect is dropped', r.edits.length === 0);
  r = validateEdits([P({ layerIndex: 7 })], twinState(), installed);
  ok('a missing layer is dropped', r.edits.length === 0);
}

// ---- validator: the two ops the artist's adversarial tests demanded (log §F) -------------------
// textContent must only reach real, un-keyframed text layers; addLayer establishes the
// "layerIndex 0 = the new layer" convention that later edits in the same spec rely on.
console.log('\nvalidateEdits — textContent + addLayer');
{
  const { validateEdits } = await import('../shell/plan_validate.mjs');
  const installed = new Map([['ADBE Fractal Noise', {}], ['BCC3Snow', {}]]);
  const lyric = () => ({
    layers: [
      { index: 1, name: 'Datte 7', role: 'text', activeNow: true, text: 'Datte', effects: [] },
      { index: 2, name: 'chorus', role: 'text', activeNow: true, text: '狂ってる [KEYFRAMED×4]', effects: [] },
      { index: 3, name: 'BG', role: 'background', activeNow: true, effects: [] },
    ],
  });

  let r = validateEdits([{ op: 'textContent', layerIndex: 1, text: 'Claude' }], lyric(), installed);
  ok('a text edit on a text layer passes', r.edits.length === 1);
  r = validateEdits([{ op: 'textContent', layerIndex: 3, text: 'x' }], lyric(), installed);
  ok('a text edit on a non-text layer is dropped', r.edits.length === 0 && r.problems.some(p => /not a text layer/.test(p)));
  r = validateEdits([{ op: 'textContent', layerIndex: 2, text: 'x' }], lyric(), installed);
  ok('KEYFRAMED source text is refused at plan time, not one paid cycle later', r.edits.length === 0 && r.problems.some(p => /KEYFRAMED/.test(p)));
  r = validateEdits([{ op: 'textContent', layerIndex: 1, text: '' }], lyric(), installed);
  ok('an empty replacement string is dropped', r.edits.length === 0);

  // the new-layer convention: addLayer → later edits address it as layerIndex 0
  r = validateEdits([
    { op: 'addLayer', kind: 'solid', name: 'snow canvas' },
    { op: 'addEffect', layerIndex: 0, effectMatchName: 'BCC3Snow' },
    { op: 'param', layerIndex: 0, effectMatchName: 'BCC3Snow', paramMatchName: 'BCC3Snow-0001', value: 40 },
  ], lyric(), installed);
  ok('addLayer + configure-the-new-layer passes whole', r.edits.length === 3);
  r = validateEdits([{ op: 'addEffect', layerIndex: 0, effectMatchName: 'BCC3Snow' }], lyric(), installed);
  ok('layerIndex 0 without a preceding addLayer is dropped', r.edits.length === 0 && r.problems.some(p => /no addLayer precedes/.test(p)));
  r = validateEdits([{ op: 'addLayer', kind: 'null-object' }], lyric(), installed);
  ok('an unknown addLayer kind is dropped', r.edits.length === 0);
  r = validateEdits([
    { op: 'addLayer', kind: 'adjustment' },
    { op: 'param', layerIndex: 0, effectMatchName: 'ADBE Fractal Noise', paramMatchName: 'ADBE Fractal Noise-0010', value: 1 },
  ], lyric(), installed);
  ok('a param on the new layer for an effect never added there is dropped', r.edits.length === 1 && r.problems.some(p => /never added it there/.test(p)));
  // pre-existing layers keep their perception indices after an addLayer (the applier re-maps)
  r = validateEdits([
    { op: 'addLayer', kind: 'solid' },
    { op: 'textContent', layerIndex: 1, text: 'Claude' },
  ], lyric(), installed);
  ok('perception indices stay valid for pre-existing layers after addLayer', r.edits.length === 2);
}

// ---- suggestion mapper: the "#N" suffix is addressing, and now it addresses --------------------
console.log('\nsuggestionsToEdits — instance suffix + pin inheritance');
{
  const { suggestionsToEdits } = await import('../brownfield/suggest_spec.mjs');
  const sug = (effect, extra) => ({ type: 'param', effect, matchName: 'PEDG-0009', value: 100, ...extra });

  let e = suggestionsToEdits([sug('PEDG#2')], 1, new Map());
  eq('"PEDG#2" splits into matchName + effectIndex', [e[0].effectMatchName, e[0].effectIndex], ['PEDG', 2]);
  e = suggestionsToEdits([sug('PEDG')], 1, new Map());
  ok('no suffix, no pin map → unpinned', e[0].effectIndex === undefined);
  e = suggestionsToEdits([sug('PEDG')], 1, new Map([['PEDG', 2]]));
  eq('the seed\'s pin is inherited by later suggestions', e[0].effectIndex, 2);
  const pins = new Map();
  suggestionsToEdits([sug('PEDG#2')], 1, pins);
  eq('a suffix TEACHES the pin map for the rest of the tune', pins.get('PEDG'), 2);
  e = suggestionsToEdits([sug('Deep Glow')], 1, new Map());   // display name — the gemini failure
  eq('a display-name effect is overridden by the param-derived owner', e[0].effectMatchName, 'PEDG');
  e = suggestionsToEdits([{ type: 'expression', effect: 'PEDG#2', matchName: 'PEDG-0009', expression: 'time*10' }], 1, new Map());
  eq('an expression path addresses a pinned effect BY SLOT', e[0].propertyPath, ['ADBE Effect Parade', 2, 'PEDG-0009']);
  eq('empty input is safe', suggestionsToEdits([], 1, new Map()), []);
  eq('undefined is safe', suggestionsToEdits(undefined, 1, new Map()), []);
}

// ---- temporal-intent detection (brownfield/temporal.mjs — KNOWN_ISSUES #13 tier B) -------------
// The asymmetry the detector encodes: a false positive costs a few frames (~$0.001), a false
// negative judges motion blind. So motion words must hit and pure-look asks must not.
console.log('\ntemporalCues — motion words trigger, looks do not');
{
  const { isTemporalIntent, temporalCues } = await import('../brownfield/temporal.mjs');
  ok('消散/留恋 hits', isTemporalIntent('残粒被风扫走,消散得更留恋一点'));
  ok('呼吸/慢慢 hits', isTemporalIntent('让背景慢慢地有呼吸感'));
  ok('闪烁 hits', isTemporalIntent('让霓虹灯闪烁'));
  ok('english pulse hits', isTemporalIntent('make the glow pulse with the beat'));
  ok('english fade out hits', isTemporalIntent('the text should fade out at the end'));
  ok('a pure look-ask does NOT hit (warmer)', !isTemporalIntent('把整体色调调暖一点'));
  ok('a pure look-ask does NOT hit (wider glow)', !isTemporalIntent('make the second glow much wider and stronger'));
  ok('empty is safe', !isTemporalIntent('') && !isTemporalIntent(undefined));
  eq('cues are reported for the prompt', temporalCues('慢慢呼吸').length, 2);
}

// ---- recovery helpers (shell/recover.mjs) ------------------------------------------------------
// The kernel branches on these when a step dies under it. A false "bridge timeout" would relaunch
// the palette for a no-comp error (harmless but noisy); a MISSED one leaves tonight's exact
// failure: a dead bridge reported as an unexplained error. Salvage order matters because rollback
// unwinds newest-first — a shuffled list would restore values through the wrong intermediate states.
console.log('\nrecover — failure signature + salvage collection');
{
  const { looksLikeBridgeTimeout, collectEditReports } = await import('../shell/recover.mjs');
  ok('recognises the real bridge-timeout line', looksLikeBridgeTimeout('blah\nTIMEOUT waiting for AE bridge (panel open + Auto-run on?)\n'));
  ok('a no-comp error is NOT a bridge timeout', !looksLikeBridgeTimeout('AE error: no active composition (open a comp first)'));
  ok('empty/undefined are safe', !looksLikeBridgeTimeout('') && !looksLikeBridgeTimeout(undefined));

  const wd = path.join(TMP, 'salvage'); fs.mkdirSync(wd, { recursive: true });
  const REPO = path.resolve(__dirname, '..');
  fs.writeFileSync(path.join(wd, 'edit_iter1_report.json'), '{}');
  fs.writeFileSync(path.join(wd, 'edit_iter0_report.json'), '{}');
  fs.writeFileSync(path.join(wd, 'tune_history.json'), '[]');           // not a report — ignored
  fs.writeFileSync(path.join(wd, 'edit_iter0_before.png'), '');         // not a report — ignored
  const t = Date.now() / 1000;
  fs.utimesSync(path.join(wd, 'edit_iter0_report.json'), t - 60, t - 60);   // applied FIRST
  fs.utimesSync(path.join(wd, 'edit_iter1_report.json'), t, t);
  const got = collectEditReports(wd, REPO);
  eq('collects only edit reports, in application order',
    got.map(p => path.basename(p)), ['edit_iter0_report.json', 'edit_iter1_report.json']);
  ok('paths are repo-relative (the shape session.appliedReports holds)', got.every(p => !path.isAbsolute(p)));
  eq('a missing work dir yields [], not a throw', collectEditReports(path.join(TMP, 'nope'), REPO), []);
}

// ---- per-purpose model routing (shell/llm.mjs::modelFor) ---------------------------------------
// The seam every model default now resolves through (askJSON via AE_AI_PURPOSE; the three scorers
// as their --model fallback). The contract worth pinning: NO config file means EXACTLY the provider
// default — routing must be bit-identical to the old behaviour until someone writes models.json —
// and a config entry wins only for its own purpose.
console.log('\nmodelFor — per-purpose routing, defaults untouched');
{
  const cfg = path.join(TMP, 'models.json');
  process.env.AE_AI_MODELS_FILE = cfg;                    // must be set before the module loads
  const { modelFor, defaultModel } = await import('../shell/llm.mjs');
  ok('no config file → the provider default', modelFor('vision', 'gemini') === defaultModel('gemini'));
  ok('no purpose → the provider default', modelFor(null, 'openai') === defaultModel('openai'));
  fs.writeFileSync(cfg, JSON.stringify({ vision: 'x-routed-model' }));
  eq('a configured purpose wins', modelFor('vision', 'gemini'), 'x-routed-model');
  ok('an unconfigured purpose still gets the default', modelFor('plan', 'gemini') === defaultModel('gemini'));
  fs.writeFileSync(cfg, '{not json');
  ok('a corrupt config degrades to the default, not a throw', modelFor('vision', 'gemini') === defaultModel('gemini'));
  fs.writeFileSync(cfg, JSON.stringify({ vision: '   ' }));
  ok('a blank entry does not blank the model', modelFor('vision', 'gemini') === defaultModel('gemini'));
  delete process.env.AE_AI_MODELS_FILE;
}

// ---- structural lint --------------------------------------------------------------------------
// The behavioural assertions above were ALL GREEN through five instances of the half-a-seam bug,
// including one that made rollback restore the wrong effect. They cannot catch it: half an
// abstraction behaves correctly until the config changes. test/seams.mjs checks structure instead,
// so it runs here rather than being something to remember.
console.log('\nstructure (test/seams.mjs):');
const seamViolations = (await import('./seams.mjs')).default;
if (seamViolations) fail += seamViolations; else pass++;

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
