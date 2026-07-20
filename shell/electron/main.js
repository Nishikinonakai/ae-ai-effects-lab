// main.js — the Electron wrapper, deliberately thin.
//
// The shell's UI is a page the kernel already serves on loopback (shell/dashboard.mjs). That was a
// choice, not a shortcut: it can be built and verified with no dependency at all, which matters
// because this session already shipped UI code that had never been executed once. So Electron's only
// job is to put that page in a window and supervise the kernel process.
//
// It also keeps the memory story honest. Measured on this machine, the CEP (Chromium) panels hosted
// INSIDE After Effects hold ~538MB across 12 processes — more than AE's own 361MB — and you pay it
// for as long as AE is open. This window is a separate app: close it and the cost goes away, while
// the kernel keeps serving the AE panel.
//
// run:  npm i electron  &&  npx electron shell/electron
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.AE_AI_DASHBOARD_PORT || 7867);
const URL = `http://127.0.0.1:${PORT}/`;
let kernel = null;

// Reuse a kernel that is already running (the artist may have started it from a terminal, or
// shell_up.sh may own it) rather than starting a second one — two kernels would race the same
// request file and the same rollback stack.
function dashboardAlive() {
  return new Promise(resolve => {
    const req = http.get(URL + 'api/settings', r => { r.resume(); resolve(r.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

async function ensureKernel() {
  if (await dashboardAlive()) return 'existing';
  // AE_AI_ORPHAN_EXIT makes the kernel watch its parent and exit when orphaned. The signal
  // handlers below are not enough on their own: measured live, a SIGTERM to the Electron process
  // killed it without ever running them (Chromium's own signal disposition wins), and the spawned
  // kernel outlived its window — two kernels then raced the same request file. The child watching
  // its parent covers signals AND a hard crash; the handlers just make the graceful path prompt.
  kernel = spawn('node', [path.join(REPO, 'shell', 'kernel.mjs')],
    { cwd: REPO, stdio: 'inherit', env: { ...process.env, AE_AI_ORPHAN_EXIT: '1' } });
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 400));
    if (await dashboardAlive()) return 'started';
  }
  return 'failed';
}

async function createWindow() {
  const how = await ensureKernel();
  const win = new BrowserWindow({
    width: 900, height: 680, title: 'AE AI',
    backgroundColor: '#1e1e1e',
    // The page is ours and loopback-only, but it has no need for Node either way.
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  // external links open in the real browser, never in this window
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL(how === 'failed'
    ? 'data:text/html,<body style="background:%231e1e1e;color:%23d4d4d4;font:14px -apple-system;padding:40px">Could not reach the kernel on ' + PORT + '. Start it with <code>node shell/kernel.mjs</code>.</body>'
    : URL);
}

app.whenReady().then(createWindow);

// Only stop the kernel if THIS process started it — the AE panel may still be relying on one that
// was already running.
function stopOwnKernel() {
  if (kernel) { try { kernel.kill('SIGTERM'); } catch { /* already gone */ } kernel = null; }
}
app.on('window-all-closed', () => { stopOwnKernel(); app.quit(); });
// The first live run of this file found the cleanup above only covered the graceful path: a
// SIGTERM to the Electron process (kill, logout, supervisor) skips 'window-all-closed' entirely,
// and the spawned kernel outlived its window — measured: two kernels then raced the same request
// file, the exact state ensureKernel() exists to prevent. Signals must run the same cleanup.
// (A hard crash of this process still leaks the kernel; that gap is documented, not solved.)
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => { stopOwnKernel(); app.quit(); });
}
