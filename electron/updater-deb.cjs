// In-app updates for .deb installs (the AppImage path stays in updater.cjs, unchanged).
// Newest published GitHub release only (never drafts or pre-releases, never older), the
// .deb is checked against the release's SHA256SUMS.txt, and installed with pkexec: the
// system's own password dialog appears; the app never sees or stores the password.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');

const REPO = 'Dragongamer9/hearth-ai-command-center';
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

function detectInstall({ env = process.env, execPath = process.execPath, dpkgOwns = () => false } = {}) {
  if (env.APPIMAGE) return 'appimage';
  if (/^\/(opt|usr\/lib)\//.test(String(execPath)) && dpkgOwns(execPath)) return 'deb';
  return 'other';
}
const dpkgOwnsSync = (file) => {
  try { require('node:child_process').execFileSync('dpkg', ['-S', file], { stdio: 'ignore', timeout: 10000 }); return true; } catch { return false; }
};

const parseVer = (v) => String(v || '').replace(/^v/, '').split(/[.+-]/).slice(0, 3).map((n) => Number(n) || 0);
function newer(a, b) {
  const x = parseVer(a);
  const y = parseVer(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
// The newest published release that is newer than what's running (never a draft, a
// pre-release, or an older version), and that has a .deb.
function pickRelease(releases = [], current) {
  const ok = (releases || []).filter((r) => r && !r.draft && !r.prerelease && /^v?\d+\.\d+(\.\d+)?$/.test(r.tag_name || '') && (r.assets || []).some((a) => /\.deb$/.test(a.name)));
  ok.sort((a, b) => (newer(a.tag_name, b.tag_name) ? -1 : newer(b.tag_name, a.tag_name) ? 1 : 0));
  const best = ok[0];
  return best && newer(best.tag_name, current) ? best : null;
}

// "<sha256>  <file>" lines (sha256sum format).
function parseSums(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(\S+)$/i);
    if (m) out[path.basename(m[2])] = m[1].toLowerCase();
  }
  return out;
}
function verify(buf, name, sums) {
  const want = sums[name];
  if (!want) return { ok: false, message: `The release publishes no checksum for ${name}, so it was not installed.` };
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  return got === want ? { ok: true, sha256: got } : { ok: false, message: `${name} failed its checksum check and was not installed.` };
}

// The install command, as argument arrays (no shell).
function installCommands(debFile, { hasAptGet = true } = {}) {
  const abs = path.resolve(debFile);
  return hasAptGet ? [['pkexec', ['apt-get', 'install', '-y', abs]]] : [['pkexec', ['dpkg', '-i', abs]]];
}

function which(bin) {
  for (const d of ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin']) { const p = path.join(d, bin); try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {} }
  return null;
}
function run(file, args) {
  return new Promise((resolve) => {
    const c = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    c.on('error', (e) => resolve({ ok: false, err: e.message }));
    c.on('close', (code) => resolve({ ok: code === 0, code, err }));
  });
}

function createDebUpdater({ app, emit, fetchFn = fetch, tmpDir }) {
  let release = null;
  let deb = null;
  const get = (url, accept = 'application/vnd.github+json') => fetchFn(url, { headers: { Accept: accept, 'User-Agent': 'hearth-ai-command-center' } });
  return {
    async check() {
      emit({ state: 'checking', message: null });
      const r = await get(`https://api.github.com/repos/${REPO}/releases?per_page=30`).catch(() => null);
      if (!r?.ok) { emit({ state: 'error', message: 'Offline or GitHub unreachable.' }); return { ok: false }; }
      release = pickRelease(await r.json(), app.getVersion());
      if (!release) { emit({ state: 'none', message: 'You are on the latest version.' }); return { ok: true }; }
      emit({ state: 'available', version: release.tag_name.replace(/^v/, '') });
      return { ok: true };
    },
    async download() {
      if (!release) return { ok: false, message: 'No update to download.' };
      const asset = release.assets.find((a) => /\.deb$/.test(a.name));
      const sumsAsset = release.assets.find((a) => a.name === 'SHA256SUMS.txt');
      if (!sumsAsset) { emit({ state: 'error', message: 'This release publishes no checksums, so it cannot be installed from the app.' }); return { ok: false }; }
      emit({ state: 'downloading', percent: 0 });
      const sums = parseSums(await (await get(sumsAsset.browser_download_url, 'application/octet-stream')).text());
      const res = await get(asset.browser_download_url, 'application/octet-stream').catch(() => null);
      if (!res?.ok) { emit({ state: 'error', message: 'Download failed.' }); return { ok: false }; }
      const buf = Buffer.from(await res.arrayBuffer());
      const v = verify(buf, asset.name, sums);
      if (!v.ok) { emit({ state: 'error', message: v.message }); return { ok: false, message: v.message }; }
      fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
      deb = path.join(tmpDir, path.basename(asset.name));
      fs.writeFileSync(deb, buf, { mode: 0o600 });
      emit({ state: 'ready', version: release.tag_name.replace(/^v/, ''), percent: 100, deb: true });
      return { ok: true };
    },
    async install() {
      if (!deb || !fs.existsSync(deb)) return { ok: false, message: 'No downloaded update to install.' };
      emit({ state: 'installing', message: 'Your computer asks for your password to install the update.' });
      for (const [cmd, args] of installCommands(deb, { hasAptGet: Boolean(which('apt-get')) })) {
        const bin = which(cmd);
        if (!bin) { emit({ state: 'error', message: 'pkexec is missing; install the .deb from the release page instead.' }); return { ok: false }; }
        const r = await run(bin, args);
        if (!r.ok) { emit({ state: 'error', message: r.code === 126 || r.code === 127 ? 'The install was cancelled.' : `The install failed: ${String(r.err).split('\n').slice(-2).join(' ').slice(0, 200)}` }); return { ok: false }; }
      }
      try { fs.rmSync(deb, { force: true }); } catch {}
      emit({ state: 'installed', message: 'Installed. Restart to use the new version.' });
      return { ok: true };
    },
  };
}

module.exports = { REPO, RELEASES_PAGE, detectInstall, dpkgOwnsSync, newer, pickRelease, parseSums, verify, installCommands, createDebUpdater, execFile };
