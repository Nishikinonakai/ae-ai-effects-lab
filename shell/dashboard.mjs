// dashboard.mjs — the shell's window, served as a local page instead of shipped as an app.
//
// PRD §12.3 wants three surfaces: cost, history, settings. Building them as an Electron app first
// would mean a ~200MB dependency and a UI I could not run until it was installed — and this session
// has already paid for shipping UI code that had never been executed (the panel button that did
// nothing). So the UI is a plain page the kernel serves on localhost: verifiable today, zero new
// dependencies, and Electron later becomes a thirty-line wrapper that loads this URL.
//
// It also happens to be the right answer on cost. Measured on this machine: the CEP (Chromium) panels
// hosted inside AE hold ~538MB across 12 processes — more than AE's own 361MB — and you pay it for as
// long as AE is open. A page you open when you want it and close when you don't costs nothing the
// rest of the time.
//
// BINDS TO 127.0.0.1 ONLY. And the settings view never transmits a key: source, length and last four
// characters, which is what you need to answer "is the right credential loaded" and nothing more.
import fs from 'fs';
import os from 'os';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { spendSummary } from './llm.mjs';
import { activeConfig } from './llm.mjs';
import { KNOWN, keychainGet } from './keys.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SHELL_DIR = path.join(os.homedir(), 'Documents', 'ae-ai-shell');
const LEDGER = path.join(SHELL_DIR, 'spend.jsonl');
const WORK = path.join(SHELL_DIR, 'work');

// ---- data ---------------------------------------------------------------------------------------

function ledgerRows(sinceMs = 7 * 24 * 3600 * 1000) {
  if (!fs.existsSync(LEDGER)) return [];
  const cutoff = Date.now() - sinceMs;
  const out = [];
  for (const line of fs.readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (Date.parse(r.ts) >= cutoff) out.push(r); } catch { /* skip */ }
  }
  return out;
}

// One row per request: what was asked, what it did, what it scored, what it cost, and whether the
// artist kept it. This IS the dogfooding log — the thing PRD §12.3 wants recorded without asking the
// artist to keep notes, and the thing that decides whether a 7/10 is good enough in practice.
function history(limit = 40, sinceMs = null) {
  if (!fs.existsSync(WORK)) return [];
  const cutoff = sinceMs === null ? 0 : Date.now() - sinceMs;
  const dirs = fs.readdirSync(WORK).filter(d => d.startsWith('req_'))
    .map(d => ({ d, p: path.join(WORK, d) }))
    .filter(x => { try { return fs.statSync(x.p).isDirectory() && fs.statSync(x.p).mtimeMs >= cutoff; } catch { return false; } })
    .sort((a, b) => fs.statSync(b.p).mtimeMs - fs.statSync(a.p).mtimeMs)
    .slice(0, limit);

  return dirs.map(({ d, p }) => {
    const row = { id: d, at: new Date(fs.statSync(p).mtimeMs).toISOString() };
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(p, 'plan_spec.json'), 'utf8'));
      row.intent = spec._intent;
      row.rationale = spec._rationale;
      row.edits = (spec.edits || []).length;
      row.model = spec._model;
    } catch { /* a request that died before planning */ }
    try {
      const sum = JSON.parse(fs.readFileSync(path.join(p, 'tune_summary.json'), 'utf8'));
      row.score = sum.bestScore;
      row.trace = (sum.trace || []).map(t => t.score);
      row.accepted = sum.accepted;
    } catch { /* never got to tuning */ }
    const png = fs.existsSync(p) ? fs.readdirSync(p).filter(f => /_panel\d+\.png$/.test(f)).sort().pop() : null;
    if (png) row.frame = path.join(p, png);
    return row;
  });
}

function settings() {
  const cfg = activeConfig();
  // never the value — only enough to answer "is the right credential loaded"
  const creds = KNOWN.filter(n => n.endsWith('_API_KEY')).map(name => {
    const kc = keychainGet(name);
    const env = process.env[name];
    const v = env || kc;
    return { name, present: !!v, source: env ? 'env' : (kc ? 'keychain' : 'none'), hint: v ? `…${v.slice(-4)} (${v.length})` : null };
  });
  let state = {};
  try { state = JSON.parse(fs.readFileSync(path.join(SHELL_DIR, 'state.json'), 'utf8')); } catch { /* no state yet */ }
  return { ...cfg, creds, phase: state.phase || 'unknown', engine: state.engine || null, shellDir: SHELL_DIR };
}

// ---- page ---------------------------------------------------------------------------------------
// Self-contained: no CDN, no build step, no framework. It has to survive being opened from a file
// path, from Electron, and from a browser with no network.
const PAGE = `<!doctype html><meta charset="utf-8"><title>AE AI — shell</title>
<style>
 :root{--bg:#1e1e1e;--fg:#d4d4d4;--dim:#8a8a8a;--line:#333;--accent:#4a9eff;--good:#5cb85c;--warn:#d9a441}
 *{box-sizing:border-box} body{margin:0;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;background:var(--bg);color:var(--fg)}
 header{display:flex;gap:4px;padding:10px 14px;border-bottom:1px solid var(--line);align-items:center}
 header b{margin-right:12px;font-weight:600}
 .tab{padding:5px 12px;border:1px solid transparent;border-radius:4px;cursor:pointer;color:var(--dim)}
 .tab.on{background:#2d2d2d;color:var(--fg);border-color:var(--line)}
 main{padding:14px}
 .big{font-size:30px;font-weight:600} .sub{color:var(--dim)}
 table{border-collapse:collapse;width:100%;margin-top:10px} th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}
 th{color:var(--dim);font-weight:500;font-size:12px} td.num{text-align:right;font-variant-numeric:tabular-nums}
 .card{background:#252525;border:1px solid var(--line);border-radius:6px;padding:12px 14px;margin-bottom:12px}
 .row{display:flex;gap:20px;flex-wrap:wrap}
 .bar{height:6px;background:#333;border-radius:3px;overflow:hidden;margin-top:4px}
 .bar>i{display:block;height:100%;background:var(--accent)}
 img{max-width:240px;max-height:96px;object-fit:cover;border-radius:4px;border:1px solid var(--line);display:block}
 code{color:var(--accent)} .ok{color:var(--good)} .warn{color:var(--warn)} .dim{color:var(--dim)}
 .intent{font-weight:500} .trace{font-variant-numeric:tabular-nums;color:var(--dim)}
</style>
<header><b>AE AI</b>
 <span class="tab on" data-v="cost">Cost</span>
 <span class="tab" data-v="history">History</span>
 <span class="tab" data-v="settings">Settings</span>
 <span style="flex:1"></span><span class="sub" id="tick"></span>
</header><main id="out">loading…</main>
<script>
let view='cost';
const esc=s=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const money=n=>'$'+(n||0).toFixed(n<1?4:2);

async function draw(){
  const d=await (await fetch('/api/'+view)).json();
  const out=document.getElementById('out');
  if(view==='cost'){
    const rows=Object.entries(d.byPurpose||{}).sort((a,b)=>b[1]-a[1]);
    const max=rows.length?rows[0][1]:1;
    out.innerHTML='<div class="card"><div class="big">'+money(d.today.total)+'</div>'+
      '<div class="sub">today · '+d.today.calls+' calls</div></div>'+
      '<div class="row"><div class="card" style="flex:1"><div class="sub">7 days</div><div class="big">'+money(d.week.total)+'</div>'+
      '<div class="sub">'+d.week.calls+' calls · '+money(d.week.calls?d.week.total/d.week.calls:0)+' each</div></div>'+
      '<div class="card" style="flex:1"><div class="sub">per request (plan+tune)</div><div class="big">'+
      (d.perRequest==null?'<span class="dim">—</span>':money(d.perRequest))+'</div>'+
      '<div class="sub">'+(d.perRequest==null?'no priced calls in this window':d.requests+' requests in 7 days')+'</div></div></div>'+
      '<div class="card"><div class="sub">where it went (7 days)</div><table>'+
      rows.map(([k,v])=>'<tr><td>'+esc(k)+'</td><td class="num">'+money(v)+'</td><td style="width:45%"><div class="bar"><i style="width:'+(100*v/max)+'%"></i></div></td></tr>').join('')+
      '</table></div>'+
      (d.week.unpriced?'<div class="card warn">'+d.week.unpriced+' call(s) had no price entry — model missing from the table in shell/llm.mjs</div>':'');
  }
  if(view==='history'){
    out.innerHTML=d.length?('<table><tr><th>when</th><th>asked for</th><th>did</th><th>score</th><th></th></tr>'+
      d.map(r=>'<tr><td class="dim">'+esc(r.at.slice(5,16).replace('T',' '))+'</td>'+
      '<td><div class="intent'+(r.intent?'':' dim')+'">'+esc(r.intent||'(never got to planning — cancelled or failed)')+'</div>'+
      '<div class="dim">'+esc(r.rationale||'')+'</div></td>'+
      '<td class="dim">'+(r.edits!=null?r.edits+' edits':'—')+'<br>'+esc(r.model||'')+'</td>'+
      '<td class="num">'+(r.score!=null?r.score+'/10':'—')+
        (r.trace&&r.trace.length>1?'<div class="trace">'+r.trace.join(' → ')+'</div>':'')+
        (r.accepted?'<div class="ok">accepted</div>':'')+'</td>'+
      '<td>'+(r.frame?'<img src="/frame?p='+encodeURIComponent(r.frame)+'">':'')+'</td></tr>').join('')+'</table>')
      :'<div class="card dim">No requests yet. Ask the panel for something.</div>';
  }
  if(view==='settings'){
    out.innerHTML='<div class="card"><div class="sub">engine</div><div class="big">'+esc(d.provider||'none')+'</div>'+
      '<div class="sub">model <code>'+esc(d.model||'—')+'</code> · key from <code>'+esc(d.keySource)+'</code> · kernel <code>'+esc(d.phase)+'</code></div></div>'+
      '<div class="card"><div class="sub">credentials</div><table>'+
      d.creds.map(c=>'<tr><td>'+esc(c.name)+'</td><td class="'+(c.present?'ok':'dim')+'">'+(c.present?'set':'not set')+'</td>'+
      '<td class="dim">'+esc(c.source)+'</td><td class="dim">'+esc(c.hint||'')+'</td></tr>').join('')+
      '</table><div class="sub" style="margin-top:8px">Values are never sent to this page — only length and last four. '+
      'Manage with <code>node shell/keys.mjs</code>.</div></div>'+
      '<div class="card"><div class="sub">channel</div><code>'+esc(d.shellDir)+'</code></div>';
  }
  document.getElementById('tick').textContent=new Date().toLocaleTimeString();
}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
  t.classList.add('on'); view=t.dataset.v; draw();
});
draw(); setInterval(draw,4000);
</script>`;

// ---- server -------------------------------------------------------------------------------------

export function startDashboard(port = 7867) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (obj, type = 'application/json') => {
      res.writeHead(200, { 'Content-Type': type });
      res.end(type === 'application/json' ? JSON.stringify(obj) : obj);
    };

    if (url.pathname === '/') return send(PAGE, 'text/html; charset=utf-8');

    if (url.pathname === '/api/cost') {
      const week = spendSummary({ sinceMs: 7 * 24 * 3600 * 1000 });
      const rows = ledgerRows();
      // "per request" is the number an artist can act on — a single call price means nothing when a
      // request is one plan plus several scorings. NUMERATOR AND DENOMINATOR MUST SHARE A WINDOW:
      // dividing a week of spend by every request ever made produced $0.0033/request against a real
      // figure near $0.027, because the ledger had been cleared while the request folders had not.
      // The denominator must be the requests the LEDGER ACTUALLY COVERS, not a fixed window. These
      // two records can drift apart — the ledger was cleared mid-session here while the request
      // folders survived, and dividing 6 calls of spend by 15 requests produced $0.0033 against a
      // real figure near $0.027. Anchor to the ledger's own earliest entry: outside that span there
      // is no cost data, so those requests cannot be in the average.
      const earliest = rows.length ? Math.min(...rows.map(r => Date.parse(r.ts))) : null;
      const span = earliest ? Date.now() - earliest + 60_000 : 0;   // +1min so the first request isn't clipped
      const requests = span ? new Set(history(500, span).map(h => h.id)).size : 0;
      return send({
        today: spendSummary({ sinceMs: 24 * 3600 * 1000 }),
        week,
        byPurpose: week.byPurpose,
        requests,
        // Only meaningful when the ledger actually covers those requests; null says "cannot say"
        // rather than printing a confidently wrong number.
        perRequest: requests && week.calls ? week.total / requests : null,
        _rows: rows.length,
      });
    }

    if (url.pathname === '/api/history') return send(history());
    if (url.pathname === '/api/settings') return send(settings());

    // Frames only, and only from inside the shell's own work directory — this server has no auth
    // because it is loopback-only, but "loopback-only" is not a reason to serve arbitrary paths.
    if (url.pathname === '/frame') {
      const p = path.resolve(url.searchParams.get('p') || '');
      if (!p.startsWith(WORK) || !fs.existsSync(p)) { res.writeHead(404); return res.end('no'); }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(fs.readFileSync(p));
    }

    res.writeHead(404); res.end('not found');
  });

  return new Promise(resolve => {
    server.on('error', e => { console.error(`dashboard could not start: ${e.message}`); resolve(null); });
    server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${port}/`));
  });
}

// CLI: node shell/dashboard.mjs  — run it standalone without the kernel
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const url = await startDashboard(Number(process.argv[2]) || 7867);
  console.log(url ? `dashboard: ${url}` : 'failed to start');
}
