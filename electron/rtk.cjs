// rtk (github.com/rtk-ai/rtk, the Apache-2.0 "oss" edition): trims the command output the AI agents read
// (test runs, git, ls, grep, builds…), which saves tokens. An optional switch in Settings › Tools, off by default.
//
// The owner's rules here:
// - Off by default; the setting is saved only when he flips it (main.cjs settings:set, merged and atomic).
// - Only the one verified build is ever downloaded (v1.2.0, rtk-oss-x86_64-unknown-linux-musl.tar.gz, SHA-256 below,
//   the value in that release's checksums.txt), into the app's own data folder (<userData>/rtk). Never system-wide.
// - It's used only by the agents the Command Center starts, and only for those runs:
//     Claude Code  -> rtk's own PreToolUse hook (`rtk hook claude`) in the per-run --settings file this app already
//                     passes, kept inside <userData>/rtk. ~/.claude/settings.json is never touched.
//     other CLIs   -> rtk on that run's PATH, plus rtk's short "prefix commands with rtk" note (rtk's rules-file
//                     integration, hooks/rtk-awareness-full.md) at the top of the prompt.
//   `rtk init` is never run (it edits global agent files and offers the proxy).
// - Never telemetry (RTK_TELEMETRY_DISABLED=1 on every run; `rtk telemetry` is never called) and never rtk-proxy
//   (a separate download that routes API traffic; nothing here fetches or starts it).
// - Nothing is lost: rtk keeps the full output of what it trims (`rtk recall <hash>`, `rtk bypass <cmd>`), and a
//   failing test's own failure lines are always kept.
// - Turning the switch off removes everything this file added: the whole <userData>/rtk folder.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');

const VERSION = '1.2.0';
const ASSET = 'rtk-oss-x86_64-unknown-linux-musl.tar.gz';
const DOWNLOAD_URL = `https://github.com/rtk-ai/rtk/releases/download/v${VERSION}/${ASSET}`;
const SHA256 = 'a28407dc13038bdc9c2a1f5a047b0c636e0c1d495b15523576e2adb992a06a17';
const MAX_DOWNLOAD = 40 * 1024 * 1024;

// For agents without a hook: rtk's own rules-file text, shortened (hooks/rtk-awareness-full.md).
const NOTE = [
  'Command output on this computer can be trimmed by rtk to save tokens. Prefix external programs with `rtk`',
  '(`rtk git status`, `rtk cargo test`, `rtk npm test`, `rtk ls src/`); programs rtk has no filter for run as-is.',
  "Don't prefix shell builtins (cd, echo, export, test, source). Trimmed output says how to get the full version;",
  'if a result looks empty or wrong, run it again as `rtk bypass <command>` for the full, unfiltered output.',
].join(' ');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function verify(buf, expected = SHA256) {
  const got = sha256(buf);
  return { ok: got === expected, got };
}

// The one regular file named `rtk` in a .tar.gz (ustar), as a Buffer; null if it isn't there.
// Names are never used as paths, so nothing in the archive can write outside the app's folder.
function extractRtk(tgz) {
  let tar;
  try { tar = zlib.gunzipSync(tgz); } catch { return null; }
  const str = (b, a, n) => b.subarray(a, a + n).toString('utf8').replace(/\0.*$/s, '');
  for (let off = 0; off + 512 <= tar.length;) {
    const h = tar.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const name = `${str(h, 345, 155) ? `${str(h, 345, 155)}/` : ''}${str(h, 0, 100)}`.replace(/^\.\//, '');
    const size = parseInt(str(h, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    if (!Number.isFinite(size) || size < 0) return null;
    const body = off + 512;
    if (body + size > tar.length) return null;
    if (name === 'rtk' && (type === '0' || type === '\0')) return Buffer.from(tar.subarray(body, body + size));
    off = body + Math.ceil(size / 512) * 512;
  }
  return null;
}

// expect: the archive's SHA-256 (always rtk 1.2.0's published one in the app; tests pass their own archive's).
function create({ dir, enabled, fetchFn = (...a) => fetch(...a), platform = process.platform, arch = process.arch, expect = SHA256 } = {}) {
  const root = () => (typeof dir === 'function' ? dir() : dir);
  const isOn = () => { try { return typeof enabled === 'function' ? enabled() === true : enabled === true; } catch { return false; } };
  const supported = platform === 'linux' && arch === 'x64';
  const paths = () => {
    const r = root();
    return { root: r, binDir: path.join(r, 'bin'), bin: path.join(r, 'bin', 'rtk'), meta: path.join(r, 'installed.json'), db: path.join(r, 'history.db'), recall: path.join(r, 'recall.db'), tee: path.join(r, 'tee'), claude: path.join(r, 'claude-settings.json') };
  };
  // The binary is checked against the hash saved at install (once per change of the file, not every run).
  let checked = null;
  function installed() {
    const p = paths();
    let meta;
    let st;
    try { meta = JSON.parse(fs.readFileSync(p.meta, 'utf8')); st = fs.statSync(p.bin); } catch { return null; }
    if (!meta || meta.version !== VERSION || meta.assetSha256 !== expect || !/^[0-9a-f]{64}$/.test(meta.binSha256 || '')) return null;
    const key = `${st.size}:${st.mtimeMs}:${st.ino}`;
    if (checked?.key !== key) {
      let ok = false;
      try { ok = sha256(fs.readFileSync(p.bin)) === meta.binSha256; } catch {}
      checked = { key, ok };
    }
    return checked.ok ? { version: meta.version, bin: p.bin, at: meta.at || null } : null;
  }
  // Every rtk process the app starts (and every agent run that uses it) gets these.
  function env() {
    const p = paths();
    return { RTK_TELEMETRY_DISABLED: '1', RTK_ONRAMP_DISABLED: '1', RTK_SUPPRESS_HOOK_WARNING: '1', RTK_PRO_HINT: '0', RTK_DB_PATH: p.db, RTK_RECALL_DB: p.recall, RTK_TEE_DIR: p.tee };
  }
  const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  // Claude Code's per-run settings with rtk's hook added (the attribution settings are kept as they are).
  function claudeSettings(base) {
    const p = paths();
    const settings = { ...(base || {}), hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `${shq(p.bin)} hook claude`, timeout: 10 }] }] } };
    const tmp = `${p.claude}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    fs.writeFileSync(tmp, JSON.stringify(settings), { mode: 0o600 });
    fs.renameSync(tmp, p.claude);
    return p.claude;
  }
  // What one agent run gets. null (and nothing on disk read or written) while the switch is off.
  // pathDirs: the run's own PATH entries, which rtk's folder goes in front of.
  function forRun({ agent, builder = false, pathDirs = [] } = {}) {
    if (!isOn() || !supported || builder) return null;
    const inst = installed();
    if (!inst) return null;
    const p = paths();
    return {
      env: { ...env(), PATH: [p.binDir, ...pathDirs.filter((d) => d !== p.binDir)].join(path.delimiter) },
      hook: agent === 'anthropic',
      note: agent === 'anthropic' ? '' : NOTE,
      claudeSettings,
    };
  }
  function runRtk(args, timeout = 8000) {
    return new Promise((resolve) => {
      execFile(paths().bin, args, { env: { ...process.env, ...env() }, timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.message) || '') }));
    });
  }
  async function gain() {
    if (!installed()) return null;
    const r = await runRtk(['gain', '--format', 'json']);
    try {
      const s = JSON.parse(r.out).summary || {};
      const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      return { commands: n(s.total_commands), saved: n(s.total_saved), input: n(s.total_input), pct: Math.round(n(s.avg_savings_pct) * 10) / 10 };
    } catch { return null; }
  }
  // Leftovers count too: a folder that's still there while the switch is off can be removed from Settings.
  const present = () => { try { return fs.existsSync(root()); } catch { return false; } };
  async function status({ withGain = true } = {}) {
    const on = isOn();
    const inst = on ? installed() : null;
    return { on, supported, version: VERSION, asset: ASSET, installed: Boolean(inst), leftover: !on && present(), gain: on && inst && withGain ? await gain() : null };
  }
  // Only from his button, only while the switch is on: the one verified build, checked before anything is saved.
  async function download() {
    if (!isOn()) return { ok: false, message: 'Turn on "Trim command output for agents (rtk)" first.' };
    if (!supported) return { ok: false, message: 'rtk is downloaded only for Linux on x86_64 PCs.' };
    let buf;
    try {
      const r = await fetchFn(DOWNLOAD_URL, { headers: { 'User-Agent': 'hearth-ai-command-center' }, redirect: 'follow' });
      if (!r || !r.ok) return { ok: false, message: `The download failed (HTTP ${r ? r.status : '?'}). Nothing was saved.` };
      buf = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      return { ok: false, message: `The download failed: ${String(e?.message || e).slice(0, 200)}. Nothing was saved.` };
    }
    if (buf.length > MAX_DOWNLOAD) return { ok: false, message: 'The download was far bigger than rtk is. Nothing was saved.' };
    const v = verify(buf, expect);
    if (!v.ok) return { ok: false, message: `The download didn't match rtk ${VERSION}'s published checksum, so it was thrown away. Nothing was saved.` };
    const bin = extractRtk(buf);
    if (!bin || bin.length < 1024) return { ok: false, message: 'The download had no rtk program in it. Nothing was saved.' };
    const p = paths();
    fs.mkdirSync(p.binDir, { recursive: true, mode: 0o700 });
    const tmp = `${p.bin}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, bin, { mode: 0o755 });
    fs.renameSync(tmp, p.bin);
    const meta = { version: VERSION, asset: ASSET, assetSha256: expect, binSha256: sha256(bin), at: new Date().toISOString() };
    const mt = `${p.meta}.tmp-${process.pid}`;
    fs.writeFileSync(mt, JSON.stringify(meta, null, 2), { mode: 0o600 });
    fs.renameSync(mt, p.meta);
    checked = null;
    const ver = await runRtk(['--version'], 5000);
    if (!ver.ok || !ver.out.includes(VERSION)) {
      remove();
      return { ok: false, message: `rtk didn't start on this PC (${(ver.err || ver.out).trim().slice(0, 160) || 'no answer'}), so it was removed again.` };
    }
    return { ok: true, version: VERSION };
  }
  // Removes everything the app added for rtk (the one folder). Never touches anything outside it.
  function remove() {
    const r = root();
    checked = null;
    if (!r || path.basename(r) !== 'rtk') return { ok: false };
    try { fs.rmSync(r, { recursive: true, force: true }); return { ok: true }; } catch (e) { return { ok: false, message: String(e?.message || e) }; }
  }
  return { forRun, status, download, remove, installed, gain, env, paths, supported };
}

// The app's one instance (main.cjs configures it; agents.cjs asks it per run). Off until configured.
let shared = null;
const configure = (opts) => (shared = create(opts));
const forRun = (o) => (shared ? shared.forRun(o) : null);
const instance = () => shared;

module.exports = { create, configure, forRun, instance, verify, extractRtk, sha256, VERSION, ASSET, DOWNLOAD_URL, SHA256, NOTE };
