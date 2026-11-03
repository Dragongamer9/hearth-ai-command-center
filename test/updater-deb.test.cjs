// In-app updates for .deb installs: detection, release choice, checksums, install command, no downgrade.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const u = require('../electron/updater-deb.cjs');

const rel = (tag, o = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets: [{ name: `Hearth-AI-Command-Center-${tag.slice(1)}-amd64.deb`, browser_download_url: 'https://github.com/x/y/releases/download/a.deb' }, { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/x/y/s' }], ...o });

test('install type: AppImage, .deb (path plus dpkg -S), or other', () => {
  assert.equal(u.detectInstall({ env: { APPIMAGE: '/home/o/Hearth.AppImage' }, execPath: '/tmp/.mount/x' }), 'appimage');
  assert.equal(u.detectInstall({ env: {}, execPath: '/opt/Hearth AI Command Center/hearth-ai-command-center', dpkgOwns: () => true }), 'deb');
  assert.equal(u.detectInstall({ env: {}, execPath: '/usr/lib/hearth-ai-command-center/hearth', dpkgOwns: () => true }), 'deb');
  assert.equal(u.detectInstall({ env: {}, execPath: '/opt/x/hearth', dpkgOwns: () => false }), 'other', 'not owned by a package');
  assert.equal(u.detectInstall({ env: {}, execPath: '/home/o/apps/hearth', dpkgOwns: () => true }), 'other');
});

test('the release: newest published, never a draft or pre-release, never older (no downgrade)', () => {
  const list = [rel('v0.9.1'), rel('v1.0.0', { draft: true }), rel('v0.9.2', { prerelease: true }), rel('v0.8.0'), rel('v0.9.0')];
  assert.equal(u.pickRelease(list, '0.9.0').tag_name, 'v0.9.1');
  assert.equal(u.pickRelease(list, '0.9.1'), null, 'already newest');
  assert.equal(u.pickRelease([rel('v0.8.0')], '0.9.0'), null, 'never a downgrade');
  assert.equal(u.pickRelease([rel('v0.10.0'), rel('v0.9.9')], '0.9.0').tag_name, 'v0.10.0', 'numeric, not text, order');
  assert.equal(u.pickRelease([{ ...rel('v1.0.0'), assets: [{ name: 'x.AppImage' }] }], '0.9.0'), null, 'needs a .deb');
});

test('checksum: pass, mismatch and missing all handled', () => {
  const buf = Buffer.from('deb bytes');
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const sums = u.parseSums(`${sha}  Hearth-AI-Command-Center-0.9.1-amd64.deb\n${'b'.repeat(64)}  Hearth-AI-Command-Center-0.9.1-x86_64.AppImage\n`);
  assert.equal(u.verify(buf, 'Hearth-AI-Command-Center-0.9.1-amd64.deb', sums).ok, true);
  assert.match(u.verify(Buffer.from('tampered'), 'Hearth-AI-Command-Center-0.9.1-amd64.deb', sums).message, /failed its checksum check/);
  assert.match(u.verify(buf, 'other.deb', sums).message, /publishes no checksum/);
});

test('install command is an argument array (no shell); dpkg only if apt-get is missing', () => {
  assert.deepEqual(u.installCommands('/tmp/u/Hearth-0.9.1-amd64.deb'), [['pkexec', ['apt-get', 'install', '-y', '/tmp/u/Hearth-0.9.1-amd64.deb']]]);
  assert.deepEqual(u.installCommands('/tmp/u/a.deb', { hasAptGet: false }), [['pkexec', ['dpkg', '-i', '/tmp/u/a.deb']]]);
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'updater-deb.cjs'), 'utf8');
  assert.ok(!/shell:\s*true|\bexec\(|sh', \['-c'/.test(src), 'never through a shell');
});

test('the flow refuses a release without checksums and never installs on a mismatch', async () => {
  const events = [];
  const bad = Buffer.from('tampered');
  const fetchFn = async (url) => ({
    ok: true,
    json: async () => [rel('v0.9.1')],
    text: async () => `${'a'.repeat(64)}  Hearth-AI-Command-Center-0.9.1-amd64.deb\n`,
    arrayBuffer: async () => bad.buffer.slice(bad.byteOffset, bad.byteOffset + bad.length),
  });
  const d = u.createDebUpdater({ app: { getVersion: () => '0.9.0' }, emit: (e) => events.push(e), fetchFn, tmpDir: fs.mkdtempSync('/tmp/deb-') });
  await d.check();
  assert.equal(events.at(-1).state, 'available');
  const r = await d.download();
  assert.equal(r.ok, false);
  assert.match(events.at(-1).message, /checksum/);
  assert.equal((await d.install()).ok, false, 'nothing to install');
  const updater = fs.readFileSync(path.join(__dirname, '..', 'electron', 'updater.cjs'), 'utf8');
  assert.match(updater, /autoUpdater\.allowDowngrade = false/, 'the AppImage path is unchanged');
});

test('CI checks that the published checksums cover the .deb', () => {
  const rel = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(rel, /release\/SHA256SUMS\.txt; do/, 'SHA256SUMS.txt is uploaded as a release asset');
  assert.match(rel, /grep -qE '\^\[0-9a-f\]\{64\}  \.\*\\\.deb\$' release\/SHA256SUMS\.txt/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'build-deb-test.yml'), 'utf8'), /u\.verify\(/);
});
