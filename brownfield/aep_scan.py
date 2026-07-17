#!/usr/bin/env python3
"""Static RIFX scan of .aep projects — read-only brownfield perception, no AE needed.

An .aep is a big-endian RIFF ("RIFX", form type "Egg!"). Everything we need for a
usage survey is reachable without decoding the deep binary payloads:

  tdmn  null-padded matchName tokens naming the property group/leaf that FOLLOWS
        (effects show up as their effect-level matchName, e.g. "tc Particular",
        "ADBE Gaussian Blur 2"; params as "<effect>-0123")
  Utf8  names (attributed to comp/folder/footage/layer via the enclosing LIST
        context) and expression source (classified by regex — expressions live in
        Utf8 chunks under property LISTs)
  idta  item type (1 folder / 4 comp / 7 footage) inside an Item LIST
  cdta/ldta  comp / layer records (counted; cdta also yields WxH + fps once the
        offsets are pinned — see decode_cdta)
  alas  footage file references (JSON blob with fullpath in modern AE)
  XMP   trailing packet: creator tool + full save history w/ software agents

Usage:
  python3 brownfield/aep_scan.py file.aep [file2.aep ...] \
      [--inventory introspect/installed_effects.json] [--outdir brownfield/survey]

Writes <outdir>/<aep-basename>.json per project and prints a one-screen summary.
Source files are opened strictly read-only (mmap ACCESS_READ).
"""
import sys, os, json, mmap, re, struct, argparse
from collections import Counter, defaultdict

EXPR_RE = re.compile(
    r'wiggle\s*\(|loopOut|loopIn|valueAtTime|thisComp|thisLayer|posterizeTime|'
    r'seedRandom|toComp\s*\(|fromComp|linear\s*\(|ease\s*\(|Math\.|time\s*[*+/-]|'
    r'effect\s*\(|transform\.|sampleImage|clamp\s*\(|random\s*\(')
PARAM_SUFFIX_RE = re.compile(r'-\d{3,4}$')
# structural / housekeeping matchNames that are neither effects nor their params
STRUCTURAL_PREFIXES = (
    'ADBE Root Vectors', 'ADBE Vector', 'ADBE Transform', 'ADBE Effect Parade',
    'ADBE Mask', 'ADBE Time Remapping', 'ADBE MTrackers', 'ADBE Marker',
    'ADBE Layer', 'ADBE Audio', 'ADBE Material', 'ADBE Camera', 'ADBE Light',
    'ADBE Text', 'ADBE Extrsn', 'ADBE Plane', 'ADBE Envir', 'ADBE Anchor',
    'ADBE Position', 'ADBE Scale', 'ADBE Rotate', 'ADBE Orientation', 'ADBE Opacity',
    'ADBE Goo', 'ADBE Paint', 'ADBE Motion Blur',
)


def u16(b, o): return struct.unpack_from('>H', b, o)[0]
def u32(b, o): return struct.unpack_from('>I', b, o)[0]
def f64(b, o): return struct.unpack_from('>d', b, o)[0]


def walk(buf, off, end, ctx, out):
    """Iterate sibling chunks in [off,end); recurse into LISTs carrying a context
    stack of list types. Attributes Utf8 payloads by enclosing context."""
    while off + 8 <= end:
        cc = buf[off:off + 4]
        size = u32(buf, off + 4)
        data0, data1 = off + 8, off + 8 + size
        if data1 > end:
            break
        if cc == b'LIST':
            ltype = buf[data0:data0 + 4].decode('latin1')
            if ltype == 'Item':
                out['_item_type'] = None  # reset; idta inside will set it
            if ltype == 'Layr':
                out['chains'].append([])   # effect chain of the layer being entered
                out['_layr_depth'] = len(ctx) + 1
            walk(buf, data0 + 4, data1, ctx + [ltype], out)
        else:
            handle(buf, cc, data0, size, ctx, out)
        off = data1 + (size & 1)


def handle(buf, cc, o, size, ctx, out):
    top = ctx[-1] if ctx else ''
    if cc == b'tdmn':
        name = buf[o:o + size].split(b'\x00')[0].decode('latin1', 'replace')
        if name and name != 'ADBE Group End':
            out['tdmn'][name] += 1
            # effect-level tokens inside a layer, in document order = the stack
            if (out['chains'] and 'Layr' in ctx and name in out['inv']
                    and not PARAM_SUFFIX_RE.search(name)):
                out['chains'][-1].append(name)
    elif cc == b'idta' and size >= 2:
        t = u16(buf, o)
        out['_item_type'] = t
        out['item_types'][t] += 1
    elif cc == b'cdta':
        out['cdta'].append((o, size))
    elif cc == b'ldta':
        out['n_layers'] += 1
    elif cc == b'Utf8':
        s = buf[o:o + size].decode('utf-8', 'replace').strip('\x00')
        if not s or s == '-_0_/-':          # placeholder AE writes for unnamed
            return
        if EXPR_RE.search(s) and ('(' in s or '=' in s):
            out['expressions'].append(s)
        elif top == 'Item':
            t = out.get('_item_type')
            key = {1: 'folders', 4: 'comps', 7: 'footage'}.get(t, 'other_items')
            if len(s) < 300:
                out[key].append(s)
        elif top == 'Layr' and len(s) < 300:
            out['layer_names'].append(s)
    elif cc == b'alas':
        s = buf[o:o + size].decode('utf-8', 'replace')
        m = re.search(r'"fullpath"\s*:\s*"([^"]+)"', s)
        if m:
            out['footage_paths'].append(m.group(1))
        else:
            for p in re.findall(r'(/(?:[^\x00-\x1f"<>|]+/)*[^\x00-\x1f"<>|]+)', s):
                if len(p) > 6:
                    out['footage_paths'].append(p)
                    break


def decode_cdta(buf, o, size):
    """Comp record. Width/height pinned empirically at +140 (u16 pair voted
    unanimously across the 2022-family survey projects: 3840x2160 / 1920x1080)."""
    if size >= 144:
        w, h = u16(buf, o + 140), u16(buf, o + 142)
        if 16 <= w <= 16384 and 16 <= h <= 16384:
            return [(140, w, h)]
    return []


def scan(path, inventory):
    st = os.stat(path)
    with open(path, 'rb') as f:
        buf = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    if buf[:4] != b'RIFX':
        return {'file': path, 'error': 'not RIFX'}
    total = u32(buf, 4)
    inv_set = {e['match'] for e in inventory}
    out = {
        'tdmn': Counter(), 'item_types': Counter(), 'cdta': [], 'n_layers': 0,
        'expressions': [], 'comps': [], 'folders': [], 'footage': [],
        'other_items': [], 'layer_names': [], 'footage_paths': [],
        'chains': [], 'inv': inv_set,
    }
    walk(buf, 12, min(8 + total, len(buf)), ['Egg!'], out)

    # project-level XMP lives AFTER the RIFX payload (an xpacket found inside the
    # payload belongs to embedded footage metadata, e.g. a PSD's — ignore those)
    xmp = {}
    x = buf[min(8 + total, len(buf)):].decode('utf-8', 'replace')
    i = x.find('<?xpacket begin')
    if i != -1:
        x = x[i:]
        # AE writes XMP in element form; CreatorTool carries a bogus Photoshop
        # string on AE 22.x — softwareAgent history entries are the real tool ids
        for tag in ('CreateDate', 'ModifyDate'):
            m = re.search(rf'{tag}>([^<]+)<', x)
            if m:
                xmp[tag] = m.group(1)
        xmp['agents'] = sorted(set(re.findall(r'softwareAgent>([^<]+)<', x)))
        whens = sorted(re.findall(r'stEvt:when>([^<]+)<', x))
        if whens:
            xmp['first_save'], xmp['last_save'] = whens[0], whens[-1]
            xmp['n_saves'] = len(whens)

    # classify tdmn: effect-level (in inventory) / param-level / structural / unknown
    inv = {e['match'] for e in inventory}
    effects, params_of, unknown = Counter(), Counter(), Counter()
    for name, n in out['tdmn'].items():
        if name in inv:
            effects[name] += n
        elif PARAM_SUFFIX_RE.search(name):
            params_of[PARAM_SUFFIX_RE.sub('', name)] += n
        elif name.startswith(STRUCTURAL_PREFIXES) or name.startswith('ADBE '):
            pass
        else:
            unknown[name] += n
    # third-party effects present only as param groups (effect tdmn missing from
    # inventory => uninstalled plugin): parents seen in params_of but not effects
    ghost = {k: v for k, v in params_of.items() if k not in effects and k not in inv}

    name_by_match = {e['match']: e['name'] for e in inventory}
    comp_dims = Counter()
    for o, size in out['cdta']:
        for off, w, h in decode_cdta(buf, o, size):
            comp_dims[(off, w, h)] += 1

    rec = {
        'file': path,
        'size_mb': round(st.st_size / 1e6, 1),
        'mtime': __import__('datetime').datetime.fromtimestamp(st.st_mtime).isoformat(),
        'xmp': xmp,
        'items': {'comps': out['item_types'].get(4, 0),
                  'folders': out['item_types'].get(1, 0),
                  'footage': out['item_types'].get(7, 0)},
        'n_layers': out['n_layers'],
        'comp_names': out['comps'],
        'effects': {m: {'name': name_by_match.get(m, m), 'n': n}
                    for m, n in effects.most_common()},
        'ghost_effect_groups': dict(sorted(ghost.items(), key=lambda kv: -kv[1])),
        'unknown_tdmn_top': dict(unknown.most_common(40)),
        'n_expressions': len(out['expressions']),
        'expressions_unique': sorted(set(out['expressions']))[:400],
        'footage_paths': sorted(set(out['footage_paths'])),
        'footage_ext': dict(Counter(
            os.path.splitext(p)[1].lower() for p in out['footage_paths']).most_common()),
        'layer_name_sample': out['layer_names'][:60],
        'comp_dims_raw': {f'{off}:{w}x{h}': n for (off, w, h), n in comp_dims.most_common(12)},
        'effect_chains': [c for c in out['chains'] if c],
    }
    buf.close()
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('aeps', nargs='+')
    ap.add_argument('--inventory', default=os.path.join(
        os.path.dirname(__file__), '..', 'introspect', 'installed_effects.json'))
    ap.add_argument('--outdir', default=os.path.join(os.path.dirname(__file__), 'survey'))
    a = ap.parse_args()
    inventory = json.load(open(a.inventory))['effects']
    os.makedirs(a.outdir, exist_ok=True)
    for p in a.aeps:
        rec = scan(p, inventory)
        slug = re.sub(r'[^\w.-]+', '_', os.path.splitext(os.path.basename(p))[0])
        outp = os.path.join(a.outdir, slug + '.json')
        json.dump(rec, open(outp, 'w'), ensure_ascii=False, indent=1)
        if 'error' in rec:
            print(f"!! {p}: {rec['error']}")
            continue
        print(f"== {os.path.basename(p)}  {rec['size_mb']}MB  "
              f"comps={rec['items']['comps']} layers={rec['n_layers']} "
              f"footage={rec['items']['footage']} expr={rec['n_expressions']}")
        top = list(rec['effects'].items())[:12]
        for m, info in top:
            print(f"   {info['n']:5d}  {info['name']}  [{m}]")
        if rec['ghost_effect_groups']:
            print(f"   ghosts: {list(rec['ghost_effect_groups'])[:6]}")
        print(f"   -> {outp}")


if __name__ == '__main__':
    main()
