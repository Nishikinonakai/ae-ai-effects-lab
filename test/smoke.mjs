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
  ok('Spread is absent from the prompt text too', !/PEDG-0011/.test(lc.block));
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
