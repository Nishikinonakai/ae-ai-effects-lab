// introspect_effect.mjs — generic effect ontology extractor.
//
// Works on ANY effect (native AE or third-party) via AE's uniform property API.
// Applies the effect to a throwaway solid, recursively walks its property tree, and
// writes a machine-readable "effect card": every param's matchName, type, value,
// range, units, and whether it animates. This is the automatic replacement for the
// hand-authored Particular dump — write once, run on any effect.
//
// usage: node introspect_effect.mjs "<effectNameOrMatchName>" ["<another>" ...]
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARDS = path.join(__dirname, 'cards');
fs.mkdirSync(CARDS, { recursive: true });
const BRIDGE = path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');
const CMD = path.join(BRIDGE, 'ae_command.json');
const RES = path.join(BRIDGE, 'ae_mcp_result.json');

const effects = process.argv.slice(2);
if (!effects.length) { console.error('usage: node introspect_effect.mjs "<effect>" ...'); process.exit(1); }

// ExtendScript: apply effect to a clean solid, walk the tree, write card JSON to a file.
function buildScript(effectName, cardPath) {
  return String.raw`(function () {
  var esc = function (s) { return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\"').replace(/[\r\n\t]/g, " "); };

  function typeName(pvt) {
    var T = PropertyValueType;
    if (pvt === T.NO_VALUE) return "GROUP";
    if (pvt === T.OneD) return "1D";
    if (pvt === T.TwoD) return "2D";
    if (pvt === T.TwoD_SPATIAL) return "2D_SPATIAL";
    if (pvt === T.ThreeD) return "3D";
    if (pvt === T.ThreeD_SPATIAL) return "3D_SPATIAL";
    if (pvt === T.COLOR) return "COLOR";
    if (pvt === T.CUSTOM_VALUE) return "CUSTOM";
    if (pvt === T.LAYER_INDEX) return "LAYER_INDEX";
    if (pvt === T.MASK_INDEX) return "MASK_INDEX";
    if (pvt === T.MARKER) return "MARKER";
    if (pvt === T.SHAPE) return "SHAPE";
    if (pvt === T.TEXT_DOCUMENT) return "TEXT";
    return "OTHER(" + pvt + ")";
  }

  var lines = [];
  var counts = { total: 0, leaf: 0, groups: 0, animatable: 0, custom: 0 };

  function walk(group, depth, pathPrefix) {
    for (var i = 1; i <= group.numProperties; i++) {
      var p;
      try { p = group.property(i); } catch (e) { continue; }
      counts.total++;
      var here = pathPrefix ? (pathPrefix + " / " + p.name) : p.name;

      if (p.propertyType === PropertyType.PROPERTY) {
        counts.leaf++;
        var pvt = "", val = "", mn = "", units = "", hasMin = false, hasMax = false, mn2 = "", mx = "", canExpr = false, canAnim = false;
        try { pvt = typeName(p.propertyValueType); } catch (e) { pvt = "?"; }
        try { mn = p.matchName; } catch (e) {}
        try { canAnim = p.canVaryOverTime; if (canAnim) counts.animatable++; } catch (e) {}
        try { canExpr = p.canSetExpression; } catch (e) {}
        try { units = p.unitsText || ""; } catch (e) {}
        try { if (p.propertyValueType === PropertyValueType.CUSTOM_VALUE) counts.custom++; } catch (e) {}
        try {
          if (p.propertyValueType !== PropertyValueType.NO_VALUE &&
              p.propertyValueType !== PropertyValueType.CUSTOM_VALUE &&
              p.propertyValueType !== PropertyValueType.MARKER) {
            val = esc(String(p.value)).substring(0, 40);
          }
        } catch (e) { val = "<unreadable>"; }
        try { hasMin = p.hasMin; if (hasMin) mn2 = String(p.minValue); } catch (e) {}
        try { hasMax = p.hasMax; if (hasMax) mx = String(p.maxValue); } catch (e) {}

        lines.push('{"depth":' + depth +
          ',"name":"' + esc(p.name) + '"' +
          ',"matchName":"' + esc(mn) + '"' +
          ',"type":"' + pvt + '"' +
          ',"value":"' + val + '"' +
          (hasMin ? ',"min":' + mn2 : '') +
          (hasMax ? ',"max":' + mx : '') +
          (units ? ',"units":"' + esc(units) + '"' : '') +
          ',"animatable":' + canAnim +
          ',"expr":' + canExpr + '}');
      } else {
        counts.groups++;
        lines.push('{"depth":' + depth + ',"name":"' + esc(here.split(" / ").pop()) + '","type":"GROUP","matchName":"' + esc(p.matchName) + '"}');
        walk(p, depth + 1, here);
      }
    }
  }

  try {
    app.beginUndoGroup("Introspect");
    // find-or-create a scratch comp + solid
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof CompItem && it.name === "__Introspect") { comp = it; break; }
    }
    if (!comp) comp = app.project.items.addComp("__Introspect", 640, 360, 1, 2, 30);
    var solid = null;
    for (var L = 1; L <= comp.numLayers; L++) if (comp.layer(L).name === "probe") solid = comp.layer(L);
    if (!solid) solid = comp.layers.addSolid([0.5,0.5,0.5], "probe", 640, 360, 1, 2);

    // strip any existing effects for a clean read
    while (solid.Effects.numProperties > 0) solid.Effects.property(1).remove();

    var fx = solid.Effects.addProperty("__EFFECT__");
    var effName = fx.name, effMatch = fx.matchName;
    walk(fx, 0, "");
    app.endUndoGroup();

    var card = '{"effect":{"name":"' + esc(effName) + '","matchName":"' + esc(effMatch) + '"}' +
      ',"counts":{"total":' + counts.total + ',"leaf":' + counts.leaf + ',"groups":' + counts.groups +
      ',"animatable":' + counts.animatable + ',"customValue":' + counts.custom + '}' +
      ',"params":[' + lines.join(",") + ']}';

    var f = new File("__CARDPATH__");
    f.encoding = "UTF-8"; f.open("w"); f.write(card); f.close();

    return '{"status":"ok","effect":"' + esc(effName) + '","matchName":"' + esc(effMatch) + '","total":' + counts.total + ',"leaf":' + counts.leaf + ',"animatable":' + counts.animatable + ',"customValue":' + counts.custom + '}';
  } catch (e) {
    try { app.endUndoGroup(); } catch (e2) {}
    return '{"status":"error","message":"' + esc(String(e)) + '"}';
  }
})();`
    .replace('__EFFECT__', effectName.replace(/\\/g, '\\\\').replace(/"/g, '\\"'))
    .replace('__CARDPATH__', cardPath.replace(/\\/g, '\\\\'));
}

async function send(script, timeoutSec = 60) {
  fs.writeFileSync(RES, JSON.stringify({ status: 'waiting' }));
  fs.writeFileSync(CMD, JSON.stringify({ command: 'runScript', args: { script }, timestamp: new Date().toISOString(), status: 'pending' }, null, 2));
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1200));
    try {
      const cmd = JSON.parse(fs.readFileSync(CMD, 'utf8'));
      if (cmd.status === 'completed' || cmd.status === 'error') return JSON.parse(fs.readFileSync(RES, 'utf8'));
    } catch {}
  }
  return { status: 'timeout' };
}

for (const eff of effects) {
  const safe = eff.replace(/[^a-zA-Z0-9]+/g, '_');
  const cardPath = path.join(CARDS, safe + '.json');
  const res = await send(buildScript(eff, cardPath));
  if (res.status === 'ok') {
    console.log(`✓ ${res.effect}  [${res.matchName}]  params=${res.total} leaf=${res.leaf} animatable=${res.animatable} customValue=${res.customValue}  → cards/${safe}.json`);
  } else {
    console.log(`✗ "${eff}"  — ${res.message || res.status}`);
  }
}
