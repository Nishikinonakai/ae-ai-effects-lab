#!/usr/bin/env python3
"""Extract per-instance effect PARAM VALUES from an .aep (read-only, no AE).

Linear document-order state machine over the RIFX chunk stream:
  tdmn "<target>"          -> opens an effect instance (inside the current layer)
  tdmn "<target>-NNNN"     -> selects the param; the following tdbs LIST carries
      cdat   static value  (big-endian f64 array, one per dimension)
      Utf8   expression source (when inside the tdbs)
      LIST list            keyframe data (presence recorded, not decoded)
  any other effect-level tdmn closes the instance.

Param ids are named via a dump table (TSV idx/name/matchName/type/value or an
introspect card JSON), which also supplies defaults so the digest can show only
what the artist actually touched.

Usage:
  python3 brownfield/aep_params.py project.aep "tc Particular" \
      --table gap-test/particular_params_fixed.tsv [--outdir brownfield/survey]
"""
import sys, os, re, json, mmap, struct, argparse
from collections import OrderedDict


def u32(b, o): return struct.unpack_from('>I', b, o)[0]


def load_table(path):
    """-> {matchName: (displayName, defaultValueString, typeCode)}"""
    table = {}
    if path.endswith('.tsv'):
        for line in open(path, encoding='utf-8').read().split('\n')[1:]:
            parts = line.split('\t')
            if len(parts) >= 5:
                _, name, match, typ, val = parts[:5]
                if match:
                    table[match] = (name, val, typ)
    else:
        for p in json.load(open(path))['params']:
            table[p['matchName']] = (p.get('name', ''), str(p.get('value', '')),
                                     p.get('type', ''))
    return table


class Extractor:
    def __init__(self, buf, target):
        self.buf = buf
        self.target = target
        self.prefix = target + '-'
        self.instances = []
        self.cur = None            # open instance dict
        self.cur_param = None      # open param id within cur
        self.comp = None
        self.layer = None
        self._item_stack = []      # pending name slots for Item LISTs
        self._layer_instances = [] # instances awaiting the layer-name Utf8
        self._dims = 1             # from the param's tdb4 header

    def close_instance(self):
        if self.cur and self.cur['params']:
            self.instances.append(self.cur)
            self._layer_instances.append(self.cur)   # layer name backfills later
        self.cur = None
        self.cur_param = None

    def walk(self, off, end, ctx):
        buf = self.buf
        while off + 8 <= end:
            cc = buf[off:off + 4]
            size = u32(buf, off + 4)
            d0, d1 = off + 8, off + 8 + size
            if d1 > end:
                break
            if cc == b'LIST':
                ltype = buf[d0:d0 + 4].decode('latin1')
                if ltype == 'Item':
                    self._item_stack.append(None)
                if ltype == 'Layr':
                    self.layer = None
                    self._layer_instances = []
                self.walk(d0 + 4, d1, ctx + [ltype])
                if ltype == 'Item':
                    self._item_stack.pop()
                if ltype == 'Layr':
                    self.close_instance()
                    for inst in self._layer_instances:   # name arrives after the
                        inst['layer'] = self.layer       # property tree
                    self._layer_instances = []
            else:
                self.chunk(cc, d0, size, ctx)
            off = d1 + (size & 1)

    def chunk(self, cc, o, size, ctx):
        buf, top = self.buf, (ctx[-1] if ctx else '')
        if cc == b'tdmn':
            name = buf[o:o + size].split(b'\x00')[0].decode('latin1', 'replace')
            if name == self.target:
                self.close_instance()
                if 'Layr' in ctx:   # skip the EfdG project-level defaults blob
                    self.cur = {'comp': self.comp, 'layer': self.layer,
                                'params': OrderedDict()}
            elif self.cur is not None and name.startswith(self.prefix):
                self.cur_param = name
                self.cur['params'][name] = {}
            elif self.cur is not None and not name.startswith('ADBE Effect'):
                self.close_instance()
        elif cc == b'tdb4' and self.cur_param and size >= 4:
            self._dims = struct.unpack_from('>H', buf, o + 2)[0] or 1
        elif cc == b'cdat' and self.cur_param:
            n = min(size // 8, self._dims, 8)
            vals = [round(struct.unpack_from('>d', buf, o + 8 * i)[0], 6)
                    for i in range(max(n, 1))]
            self.cur['params'][self.cur_param]['value'] = (
                vals[0] if len(vals) == 1 else vals)
        elif cc == b'Utf8':
            s = buf[o:o + size].decode('utf-8', 'replace').strip('\x00')
            if not s:
                return
            if top == 'tdbs' and self.cur_param:
                self.cur['params'][self.cur_param]['expr'] = s
            elif top == 'Item' and self._item_stack and self._item_stack[-1] is None:
                self._item_stack[-1] = s
                self.comp = s
            elif top == 'Layr' and self.layer is None and len(s) < 300:
                self.layer = s
        elif cc == b'lhd3' and self.cur_param:
            self.cur['params'][self.cur_param]['keyframed'] = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('aep')
    ap.add_argument('target')
    ap.add_argument('--table', required=True)
    ap.add_argument('--outdir', default=os.path.join(os.path.dirname(__file__), 'survey'))
    ap.add_argument('--all', action='store_true', help='include params at default')
    a = ap.parse_args()
    table = load_table(a.table)
    with open(a.aep, 'rb') as f:
        buf = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    ex = Extractor(buf, a.target)
    ex.walk(12, min(8 + u32(buf, 4), len(buf)), ['Egg!'])
    ex.close_instance()

    digest = []
    for inst in ex.instances:
        rows = OrderedDict()
        for pid, info in inst['params'].items():
            name, default, typ = table.get(pid, (pid, None, ''))
            if typ in ('GROUP', '6412'):
                continue
            v = info.get('value')
            changed = True
            if v is not None and default not in (None, ''):
                v0 = v[0] if isinstance(v, list) else v
                try:
                    changed = abs(float(v0) - float(default)) > 1e-6
                except (ValueError, TypeError):
                    changed = str(v) != default
            elif v is None and 'expr' not in info and 'keyframed' not in info:
                changed = False               # empty slot (curve/custom data)
            if a.all or changed or 'expr' in info or 'keyframed' in info:
                rows[pid] = {'name': name, **info,
                             **({'default': default} if default not in (None, '') else {})}
        digest.append({'comp': inst['comp'], 'layer': inst['layer'],
                       'n_params_present': len(inst['params']), 'touched': rows})

    slug = re.sub(r'[^\w.-]+', '_', os.path.splitext(os.path.basename(a.aep))[0])
    tslug = re.sub(r'[^\w.-]+', '_', a.target)
    os.makedirs(a.outdir, exist_ok=True)
    outp = os.path.join(a.outdir, f'params_{slug}_{tslug}.json')
    json.dump(digest, open(outp, 'w'), ensure_ascii=False, indent=1)
    print(f"{a.target}: {len(digest)} instances -> {outp}")
    for inst in digest:
        interesting = {v['name'] or k: (v.get('value'), '(kf)' if v.get('keyframed') else '',
                       (v.get('expr') or '')[:40])
                       for k, v in inst['touched'].items()}
        print(f"\n[{inst['comp']}] layer='{inst['layer']}' "
              f"({len(inst['touched'])}/{inst['n_params_present']} touched)")
        for n, (v, kf, e) in list(interesting.items())[:25]:
            print(f"   {n} = {v} {kf} {e}".rstrip())


if __name__ == '__main__':
    main()
