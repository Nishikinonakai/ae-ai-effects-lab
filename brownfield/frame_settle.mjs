// frame_settle.mjs — wait until a PNG AE is writing has actually finished.
//
// saveFrameToPng is ASYNC: the ExtendScript returns before the file is complete (a 4K frame takes
// ~12s), and reading too early hands a half-written frame (bottom rows black) to the scorer, which
// then FALSE-fails the visual check — KillKiss E2E finding #3. Size-stable-across-two-reads is
// resolution-agnostic where any fixed byte threshold is not. Extracted from apply_edit.mjs when
// verify_edit grew its own frame rendering (temporal sampling) — one settle rule, not two copies.
import fs from 'fs';

export async function waitForFrameSettle(fp, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let prev = -1, stable = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 800));
    let sz = 0; try { sz = fs.statSync(fp).size; } catch { sz = 0; }
    if (sz > 0 && sz === prev) { if (++stable >= 2) return sz; }
    else stable = 0;
    prev = sz;
  }
  return -1;   // never settled — caller decides whether a possibly-partial frame is usable
}
