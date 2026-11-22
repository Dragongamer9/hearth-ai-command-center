// 3.14: your keys stay readable on every desktop.
//
// Electron picks the password store its keys are locked with from the desktop it's started on: KDE Plasma gets KDE's
// wallet (KWallet), other desktops (Mantel, Firehold on labwc) GNOME Keyring. Keys saved on one were "lost" on the
// other (the owner, Nov 21, 2026: his GPU servers' keys were saved on KDE Plasma on Nov 14 and Mantel asked GNOME
// Keyring). So the store the keys were saved in is remembered here (keyring.json next to secrets.json, no secrets in
// it) and the app always starts with that store (Chromium's --password-store), whatever the desktop.
//
// A PC whose keys were saved before 3.14 doesn't have keyring.json yet: when none of the saved keys can be read, the
// app starts itself once more with the other store; if that one reads them, it's remembered. It tries once (never a
// loop) and writes down that it tried, so it never restarts by itself again for the same keys. Nothing is deleted or
// re-saved over the keys that couldn't be read.
const fs = require('node:fs');
const path = require('node:path');

const FILE = 'keyring.json';
const PROBE_ENV = 'HEARTH_CC_KEYRING_PROBE';
// safeStorage.getSelectedStorageBackend() name -> Chromium's --password-store value.
const SWITCH_OF = { gnome_libsecret: 'gnome-libsecret', kwallet: 'kwallet', kwallet5: 'kwallet5', kwallet6: 'kwallet6' };
const STORES = new Set(Object.values(SWITCH_OF));

const fileIn = (dir) => path.join(dir, FILE);
function read(dir) {
  try { const j = JSON.parse(fs.readFileSync(fileIn(dir), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
}
function write(dir, data) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = fileIn(dir);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, f);
}
const givenOnCommandLine = (argv) => argv.some((a) => /^--password-store(=|$)/.test(String(a)));

// Before the app is ready: start with the remembered store (unless one was given on the command line).
function applyAtStart({ app, dir, argv = process.argv }) {
  if (givenOnCommandLine(argv)) return null;
  const s = read(dir).store;
  if (!STORES.has(s)) return null;
  app.commandLine.appendSwitch('password-store', s);
  return s;
}

// The other store to try for keys saved before 3.14.
const otherThan = (backend) => (String(backend || '').startsWith('kwallet') ? 'gnome-libsecret' : 'kwallet6');

// After the keys were loaded. read: how many could be read; saved: how many are saved; backend: the store in use.
// Returns 'remembered' | 'relaunch' | 'tried' | 'nothing'.
function afterLoad({ app, dir, read: nRead, saved, backend, env = process.env, argv = process.argv }) {
  const cur = read(dir);
  const sw = SWITCH_OF[backend];
  if (nRead > 0 && sw) {
    if (cur.store !== sw) write(dir, { store: sw, at: new Date().toISOString() });
    return 'remembered';
  }
  if (saved === 0 || nRead > 0) return 'nothing';
  // Keys are saved but none could be read here.
  // Tried once for these keys (how many are saved): never again by itself, on any desktop.
  const these = String(saved);
  if (STORES.has(cur.store) || env[PROBE_ENV] || cur.tried === these) return 'tried';
  const other = otherThan(backend);
  write(dir, { ...cur, tried: these, at: new Date().toISOString() });
  env[PROBE_ENV] = '1';
  const args = argv.slice(1).filter((a) => !/^--password-store(=|$)/.test(String(a)));
  app.relaunch({ ...(env.APPIMAGE ? { execPath: env.APPIMAGE } : {}), args: [...args, `--password-store=${other}`] });
  app.exit(0);
  return 'relaunch';
}

module.exports = { applyAtStart, afterLoad, otherThan, read, FILE, PROBE_ENV, SWITCH_OF };
