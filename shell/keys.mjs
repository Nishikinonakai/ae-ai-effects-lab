// keys.mjs — credential storage, macOS Keychain first, plaintext file as the migration path.
//
// The lab kept keys in a gitignored `recipe-harness/.env.api`. That is right for a lab: one machine,
// one operator, and .gitignore covers the one failure mode that matters there. It is not right for a
// product. A plaintext key on disk is exposed to every backup, every cloud-sync folder, every
// screen-share, and every "just send me your config" — none of which .gitignore touches. And this
// project has already had one key rotated in a single day.
//
// So: read from the Keychain when the entry exists, fall back to the file otherwise, and provide a
// one-command migration that stores the file's keys and offers to remove it. Fallback is deliberate —
// the harness scripts, the eval runners and every experiment in this repo read `.env.api` today, and
// silently breaking all of them to make a security point would be a bad trade.
//
// Keychain reads shell out to `security`, which is the only interface macOS exposes without a native
// module. `security find-generic-password -w` prints the secret to stdout, so it is passed through
// the child's stdout ONLY — never a shell string, never an argv, never a log line.
//
// usage:
//   node shell/keys.mjs status              what is stored where
//   node shell/keys.mjs migrate             move .env.api into the Keychain
//   node shell/keys.mjs set GEMINI_API_KEY  read a value from stdin and store it
//   node shell/keys.mjs forget GEMINI_API_KEY
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const ENV_FILE = path.join(REPO, 'recipe-harness', '.env.api');
const SERVICE = 'ae-ai-effects-lab';

export const KNOWN = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_BASE_URL', 'OPENAI_BASE_URL'];

const isMac = process.platform === 'darwin';

export function keychainGet(name) {
  if (!isMac) return null;
  const r = spawnSync('security', ['find-generic-password', '-s', SERVICE, '-a', name, '-w'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const v = (r.stdout || '').replace(/\n$/, '');
  return v || null;
}

export function keychainSet(name, value) {
  if (!isMac) throw new Error('Keychain storage is macOS-only; keep using recipe-harness/.env.api');
  // -U updates in place if the entry exists. The secret goes in as an argv here, which is the one
  // unavoidable exposure (it is briefly visible to `ps`); everything downstream reads it back via
  // stdout instead.
  const r = spawnSync('security', ['add-generic-password', '-s', SERVICE, '-a', name, '-w', value, '-U'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`keychain write failed: ${(r.stderr || '').trim()}`);
  return true;
}

export function keychainForget(name) {
  if (!isMac) return false;
  return spawnSync('security', ['delete-generic-password', '-s', SERVICE, '-a', name], { encoding: 'utf8' }).status === 0;
}

function fileValues() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

// The one function everything else should call. Precedence: process env (an explicit override for a
// single run) → Keychain → the legacy file.
export function loadCredentials() {
  const found = {};
  const fromFile = fileValues();
  for (const name of KNOWN) {
    if (process.env[name]) { found[name] = 'env'; continue; }
    const kc = keychainGet(name);
    if (kc) { process.env[name] = kc; found[name] = 'keychain'; continue; }
    if (fromFile[name]) { process.env[name] = fromFile[name]; found[name] = 'file'; }
  }
  return found;
}

// never print a secret — only whether one exists and how long it is
const redact = v => (v ? `set (${v.length} chars, ends …${v.slice(-4)})` : 'not set');

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const cmd = process.argv[2] || 'status';

  if (cmd === 'status') {
    const fromFile = fileValues();
    console.log(`keychain service: ${SERVICE}${isMac ? '' : '  (unavailable — not macOS)'}`);
    console.log(`legacy file:      ${fs.existsSync(ENV_FILE) ? ENV_FILE : '(none)'}\n`);
    console.log(`${'name'.padEnd(20)} ${'keychain'.padEnd(28)} legacy file`);
    for (const name of KNOWN) {
      const kc = keychainGet(name);
      if (!kc && !fromFile[name]) continue;
      console.log(`${name.padEnd(20)} ${redact(kc).padEnd(28)} ${redact(fromFile[name])}`);
    }
    const src = loadCredentials();
    console.log(`\nin use: ${Object.entries(src).map(([k, v]) => `${k}←${v}`).join('  ') || '(nothing found)'}`);
    if (fs.existsSync(ENV_FILE) && Object.values(src).includes('file')) {
      console.log(`\n⚠ a key is still being read from plaintext. \`node shell/keys.mjs migrate\` moves it.`);
    }

  } else if (cmd === 'migrate') {
    const fromFile = fileValues();
    const names = Object.keys(fromFile).filter(n => KNOWN.includes(n));
    if (!names.length) { console.log('nothing in the legacy file to migrate.'); process.exit(0); }
    for (const n of names) { keychainSet(n, fromFile[n]); console.log(`  stored ${n} in the Keychain`); }
    // The file is NOT deleted automatically. Every eval runner and experiment in this repo still
    // reads it, and a migration that quietly breaks half the tooling is worse than the exposure it
    // fixes. Say what to do and let the operator choose the moment.
    console.log(`\n${names.length} key(s) migrated. The plaintext file is untouched:`);
    console.log(`  ${ENV_FILE}`);
    console.log('Verify with `node shell/keys.mjs status` (in-use should say ←keychain), then delete it.');

  } else if (cmd === 'set') {
    const name = process.argv[3];
    if (!KNOWN.includes(name)) { console.error(`unknown key "${name}". One of: ${KNOWN.join(', ')}`); process.exit(1); }
    // read the secret from STDIN so it never appears in shell history or the process list
    const value = fs.readFileSync(0, 'utf8').trim();
    if (!value) { console.error('no value on stdin. Use:  echo -n "<key>" | node shell/keys.mjs set ' + name); process.exit(1); }
    keychainSet(name, value);
    console.log(`stored ${name} — ${redact(value)}`);

  } else if (cmd === 'forget') {
    const name = process.argv[3];
    console.log(keychainForget(name) ? `removed ${name} from the Keychain` : `${name} was not in the Keychain`);

  } else {
    console.error('usage: node shell/keys.mjs [status|migrate|set <NAME>|forget <NAME>]');
    process.exit(1);
  }
}
