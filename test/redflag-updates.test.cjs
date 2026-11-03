// RED FLAG guard: the app must always be updatable from within the app, AppImage and .deb.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('RED FLAG: the in-app update path exists for AppImage and .deb', () => {
  const up = read('electron/updater.cjs');
  assert.match(up, /require\('electron-updater'\)/, 'AppImage updates use electron-updater');
  assert.match(up, /require\('\.\/updater-deb\.cjs'\)/, '.deb updates use updater-deb.cjs');
  assert.match(up, /install === 'appimage' \|\| install === 'deb'/, 'both install kinds can update');
  const main = read('electron/main.cjs');
  for (const ch of ['updater:check', 'updater:download', 'updater:install', 'updater:restart']) assert.ok(main.includes(`'${ch}'`), `${ch} handler`);
  const pre = read('electron/preload.cjs');
  for (const fn of ['checkForUpdates', 'downloadUpdate', 'installUpdate']) assert.ok(pre.includes(fn), `${fn} exposed to the window`);
  assert.ok(read('package.json').includes('"electron-updater"'), 'electron-updater is a dependency');
});

test('RED FLAG: the .deb updater keeps its checksum check and argument-array install', () => {
  const deb = require('../electron/updater-deb.cjs');
  const src = read('electron/updater-deb.cjs');
  assert.match(src, /SHA256SUMS\.txt/);
  assert.match(src, /createHash\('sha256'\)/);
  assert.match(src, /const v = verify\(buf, asset\.name, sums\)/, 'the download is verified before it is saved');
  const buf = Buffer.from('deb');
  assert.equal(deb.verify(buf, 'x.deb', deb.parseSums(`${'0'.repeat(64)}  x.deb`)).ok, false, 'a wrong checksum is refused');
  assert.deepEqual(deb.installCommands('/tmp/a b.deb'), [['pkexec', ['apt-get', 'install', '-y', '/tmp/a b.deb']]], 'argument array, no shell');
  assert.match(src, /spawn\(file, args, \{/, 'installed with spawn and an argument array');
  assert.doesNotMatch(src, /shell:\s*true/);
});

test('RED FLAG: release.yml uploads the .deb, AppImage, latest-linux.yml and SHA256SUMS.txt and checks the sums', () => {
  const y = read('.github/workflows/release.yml');
  assert.match(y, /electron-builder --linux AppImage deb/, 'builds both');
  assert.match(y, /for f in release\/\*\.AppImage release\/\*\.deb release\/latest-linux\.yml release\/SHA256SUMS\.txt; do/, 'uploads all four assets');
  assert.match(y, /sha256sum "\$\(basename "\$f"\)" "\$\(basename "\$d"\)"/, 'SHA256SUMS covers both files');
  assert.match(y, /grep -qE '\^\[0-9a-f\]\{64\}  \.\*\\\.deb\$' release\/SHA256SUMS\.txt/, 'checks the .deb is in SHA256SUMS');
  assert.match(y, /grep -qE '\^\[0-9a-f\]\{64\}  \.\*\\\.AppImage\$' release\/SHA256SUMS\.txt/, 'checks the AppImage is in SHA256SUMS');
});

test('RED FLAG: CLAUDE.md and the seeded PROJECT.md carry the rule', () => {
  const c = read('CLAUDE.md');
  for (const s of ['In-app updates must always work', 'owner picks every version number', 'Commits only as the owner', 'Settings never change by themselves']) assert.ok(c.includes(s), s);
  assert.match(require('../electron/ops/memory.cjs').seed({}), /always be updatable from within the app \(AppImage and \.deb\)/);
});
