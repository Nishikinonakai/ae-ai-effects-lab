#!/usr/bin/env python3
"""make_sheets.py — analysis + contact sheets for the draft validation batch.

Reads validation/results.jsonl, computes pixel stats per rendered t4 frame
(auto-flagging EMPTY renders), and builds contact sheets pairing each render
with its vendor thumbnail — 8 pairs per sheet, grouped by pack/category —
for batch visual scoring. Outputs:
  validation/stats.json    per-slug pixel stats + auto flags
  validation/sheets/sheet_NN.png
"""
import json, os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
VAL = os.path.join(HERE, "validation")

# optional: --only=<json with {"changed":[...],"new":[...]}> --outdir=<sheets dir name>
only = None
outname = "sheets"
for a in sys.argv[1:]:
    if a.startswith("--only="):
        j = json.load(open(a.split("=", 1)[1]))
        only = set(j.get("changed", [])) | set(j.get("new", []))
    elif a.startswith("--outdir="):
        outname = a.split("=", 1)[1]
SHEETS = os.path.join(VAL, outname)
os.makedirs(SHEETS, exist_ok=True)

results = [json.loads(l) for l in open(os.path.join(VAL, "results.jsonl")) if l.strip()]
results = [r for r in results if r.get("status") == "done" and (only is None or r["slug"] in only)]
results.sort(key=lambda r: (r["pack"], r["category"], r["slug"]))

def pixel_stats(path):
    im = Image.open(path).convert("RGB").resize((160, 90))
    px = list(im.getdata())
    lit = [p for p in px if max(p) > 16]
    coverage = len(lit) / len(px)
    mean = tuple(round(sum(c[i] for c in lit) / len(lit)) if lit else 0 for i in range(3))
    return {"coverage": round(coverage, 4), "mean_rgb": mean}

stats = {}
for r in results:
    fr = r.get("frames", [])
    last = fr[-1] if fr else None          # renderFrames order -> last = latest comp time
    fp = os.path.join(VAL, last["path"]) if last else None
    if not fp or not os.path.exists(fp):
        stats[r["slug"]] = {"flag": "no_frame"}
        continue
    s = pixel_stats(fp)
    s["flag"] = "empty" if s["coverage"] < 0.0005 else ("faint" if s["coverage"] < 0.01 else "ok")
    s["frame"] = fp
    stats[r["slug"]] = s

json.dump(stats, open(os.path.join(VAL, "stats.json"), "w"), indent=1)

# ---- contact sheets: [label | render 320x180 | thumb 222x180] x 4 rows x 2 cols ----
CELL_W, CELL_H, LABEL_H = 552, 180, 22
PAD = 8
COLS, ROWS = 2, 4
SHEET_W = COLS * (CELL_W + PAD) + PAD
SHEET_H = ROWS * (CELL_H + LABEL_H + PAD) + PAD

def load_scaled(path, w, h):
    try:
        im = Image.open(path).convert("RGB")
        return im.resize((w, h))
    except Exception:
        ph = Image.new("RGB", (w, h), (40, 0, 0))
        ImageDraw.Draw(ph).text((10, h // 2), "MISSING", fill=(255, 80, 80))
        return ph

sheet_idx, cell = 0, 0
sheet = None
manifest = []
for r in results:
    if cell == 0:
        sheet = Image.new("RGB", (SHEET_W, SHEET_H), (12, 12, 14))
    col, row = cell % COLS, cell // COLS
    x = PAD + col * (CELL_W + PAD)
    y = PAD + row * (CELL_H + LABEL_H + PAD)
    st = stats.get(r["slug"], {})
    render = load_scaled(st.get("frame", ""), 320, 180)
    thumb_rel = r.get("thumb")
    thumb = load_scaled(os.path.join(HERE, thumb_rel) if thumb_rel else "", 222, 180)
    sheet.paste(render, (x, y + LABEL_H))
    sheet.paste(thumb, (x + 326, y + LABEL_H))
    d = ImageDraw.Draw(sheet)
    flag = st.get("flag", "?")
    color = {"ok": (180, 220, 180), "faint": (230, 200, 120), "empty": (255, 100, 100), "no_frame": (255, 100, 100)}.get(flag, (200, 200, 200))
    d.text((x, y + 4), f"{r['slug']}  [{r['pack']}/{r['category']}]  {r['params_ok']}/{r['params_total']}p  cov={st.get('coverage', '?')} {flag}", fill=color)
    d.text((x + 326, y + 4), "vendor thumb →", fill=(140, 140, 160))
    manifest.append({"sheet": sheet_idx, "pos": cell, "slug": r["slug"], "flag": flag})
    cell += 1
    if cell == COLS * ROWS:
        sheet.save(os.path.join(SHEETS, f"sheet_{sheet_idx:02d}.png"))
        sheet_idx, cell = sheet_idx + 1, 0
if cell:
    sheet.save(os.path.join(SHEETS, f"sheet_{sheet_idx:02d}.png"))
    sheet_idx += 1

json.dump(manifest, open(os.path.join(SHEETS, "manifest.json"), "w"), indent=1)
flags = {}
for s in stats.values():
    flags[s.get("flag")] = flags.get(s.get("flag"), 0) + 1
print(f"{len(results)} rendered drafts -> {sheet_idx} sheets in {SHEETS}")
print("auto flags:", json.dumps(flags))
