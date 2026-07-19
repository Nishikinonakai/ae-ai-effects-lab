// frame_delta.mjs — "did the frame actually change, and by how much?", with no dependencies.
//
// WHY this exists: the visual loop's whole premise is that the render is the ground truth. But the
// scorer is a language model looking at two images, and it turns out it is BAD at one specific
// judgement that matters enormously — distinguishing "this edit did very little" from "this edit did
// LITERALLY NOTHING". Both read to it as "visually indistinguishable", and it responds the same way
// to both: push the magnitude lever harder.
//
// Those two cases need OPPOSITE responses. A small change means the lever is right, the amount is
// low. A zero change means the lever is INERT — something is gating the effect entirely (a threshold
// nobody meets, a disabled toggle, a view mode, zero opacity, an opaque core with no state) — and
// pushing magnitude is guaranteed to waste every remaining iteration. That is exactly the failure
// observed on the co-lever fixture: Deep Glow with Threshold 260% gates out every pixel, so Radius
// 60→1300 changed nothing, and the loop burned all its iterations cycling Exposure↔Radius↔Spread.
//
// A pixel diff answers this question exactly, cheaply, and without a model. So we compute it and
// tell the scorer the answer instead of asking it to perceive it.
//
// Decodes non-interlaced RGB/RGBA PNGs at 8 OR 16 bits per channel. Both depths are load-bearing:
// AE's saveFrameToPng writes 16-bit, while the sips -Z copies the scorer is fed are 8-bit, and the
// loop compares whichever pair it has. Anything else returns {ok:false} and the caller simply skips
// the check — a missing signal must never be mistaken for a zero signal.
import fs from 'fs';
import zlib from 'zlib';

function readChunks(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const out = { idat: [] };
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      out.width = data.readUInt32BE(0);
      out.height = data.readUInt32BE(4);
      out.depth = data[8];
      out.colorType = data[9];
      out.interlace = data[12];
    } else if (type === 'IDAT') out.idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  return out;
}

// Undo the per-scanline PNG filters (spec §9.2). Returns a tightly packed pixel buffer.
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const o = y * stride;
    const prior = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[o + x - bpp] : 0;
      const b = prior ? prior[x] : 0;
      const c = (prior && x >= bpp) ? prior[x - bpp] : 0;
      let v = line[x];
      switch (filter) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
      }
      out[o + x] = v & 0xff;
    }
  }
  return out;
}

export function decodePng(file) {
  const meta = readChunks(fs.readFileSync(file));
  if ((meta.depth !== 8 && meta.depth !== 16) || meta.interlace !== 0 || (meta.colorType !== 2 && meta.colorType !== 6)) {
    return { ok: false, why: `unsupported PNG (depth ${meta.depth}, colorType ${meta.colorType}, interlace ${meta.interlace})` };
  }
  const channels = meta.colorType === 6 ? 4 : 3;
  const bpp = channels * (meta.depth / 8);           // BYTES per pixel — what the filter step works in
  const raw = zlib.inflateSync(Buffer.concat(meta.idat));
  return { ok: true, width: meta.width, height: meta.height, depth: meta.depth, channels, bpp, pixels: unfilter(raw, meta.width, meta.height, bpp) };
}

// Compare two frames. Differences are reported on a normalised 0..255 scale regardless of the source
// bit depth, so the same thresholds read the same for an 8-bit sips copy and a 16-bit AE frame.
// Alpha is included when both images carry it — an edit can change only transparency (a matte edit is
// exactly that), and calling that "no change" would be wrong.
export function frameDelta(fileA, fileB) {
  let A, B;
  try { A = decodePng(fileA); B = decodePng(fileB); }
  catch (e) { return { ok: false, why: e.message }; }
  if (!A.ok) return A;
  if (!B.ok) return B;
  if (A.width !== B.width || A.height !== B.height || A.channels !== B.channels || A.depth !== B.depth) {
    return { ok: false, why: `frame geometry differs (${A.width}x${A.height} ${A.channels}ch@${A.depth} vs ${B.width}x${B.height} ${B.channels}ch@${B.depth})` };
  }
  const wide = A.depth === 16;
  const norm = wide ? 257 : 1;                       // 16-bit full range 65535 → 255
  const sample = (buf, byteIdx) => wide ? buf.readUInt16BE(byteIdx) : buf[byteIdx];
  let sum = 0, max = 0, moved = 0;
  const n = A.pixels.length, step = wide ? 2 : 1;
  for (let i = 0; i < n; i += A.bpp) {
    let d = 0;
    for (let c = 0; c < A.channels; c++) {
      const dc = Math.abs(sample(A.pixels, i + c * step) - sample(B.pixels, i + c * step));
      if (dc > d) d = dc;
    }
    d /= norm;
    sum += d; if (d > max) max = d; if (d > 1) moved++;   // >1 tolerates render dither/rounding
  }
  const pixels = n / A.bpp;
  return { ok: true, meanDelta: sum / pixels, maxDelta: max, movedFraction: moved / pixels, width: A.width, height: A.height, depth: A.depth };
}

// Classify a delta into what the SCORER needs to be told. The thresholds are deliberately blunt:
// the point is separating "inert" from "weak", not grading magnitude — the model does that part well.
export function classifyDelta(d) {
  if (!d.ok) return null;
  if (d.maxDelta <= 1) return 'inert';       // pixel-identical within dither: the edit did nothing at all
  if (d.movedFraction < 0.001 && d.maxDelta < 12) return 'negligible';
  return 'changed';
}

// CLI: node brownfield/frame_delta.mjs a.png b.png
if (process.argv[1] && process.argv[1].endsWith('frame_delta.mjs')) {
  const [a, b] = process.argv.slice(2);
  if (!a || !b) { console.error('usage: node brownfield/frame_delta.mjs <before.png> <after.png>'); process.exit(1); }
  const d = frameDelta(a, b);
  if (!d.ok) { console.error(`cannot compare: ${d.why}`); process.exit(1); }
  console.log(`${d.width}x${d.height}  mean=${d.meanDelta.toFixed(3)}  max=${d.maxDelta}  moved=${(d.movedFraction * 100).toFixed(3)}%  → ${classifyDelta(d)}`);
}
