// "Encryption is not available" on PCs where only Electron's newer async keyring API works:
// keys are saved with encryptStringAsync, old keys are still read, and with no keyring at all
// nothing is saved unless the owner chose basic protection.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { createSecretStore, ASYNC_TAG } = require('../electron/secrets.cjs');

const enc = (p, s) => Buffer.from(`${p}:${s}`);
const dec = (p, b) => { const t = b.toString(); if (!t.startsWith(`${p}:`)) throw new Error('bad'); return t.slice(p.length + 1); };
function fake({ sync = false, async = true, plain = false } = {}) {
  const f = { plainUsed: false };
  f.isEncryptionAvailable = () => sync || f.plainUsed;
  f.encryptString = (s) => { if (!sync && !f.plainUsed) throw new Error('Error while encrypting the text provided to safeStorage.encryptString. Encryption is not available.'); return enc('S', s); };
  f.decryptString = (b) => { if (!sync) throw new Error('not available'); return dec('S', b); };
  f.isAsyncEncryptionAvailable = async () => async;
  f.encryptStringAsync = async (s) => { if (!async) throw new Error('no async'); return enc('A', s); };
  f.decryptStringAsync = async (b) => { if (!async) throw new Error('no async'); const t = b.toString(); return t.startsWith('S:') ? { shouldReEncrypt: true, result: dec('S', b) } : { shouldReEncrypt: false, result: dec('A', b) }; };
  if (plain) f.setUsePlainTextEncryption = (v) => { f.plainUsed = v; };
  f.getSelectedStorageBackend = () => (f.plainUsed ? 'basic_text' : 'gnome_libsecret');
  return f;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sec-'));

test('only the async keyring works (the owner\'s PC): the key saves and reads back', async () => {
  const dir = tmp();
  const s = createSecretStore({ safeStorage: fake({ sync: false, async: true }), dir });
  await s.set('elevenlabs', 'sk_abc');
  assert.equal(s.get('elevenlabs'), 'sk_abc');
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'));
  assert.ok(raw.elevenlabs.startsWith(ASYNC_TAG));
  assert.doesNotMatch(JSON.stringify(raw), /sk_abc/, 'never plain text on disk');
  const s2 = createSecretStore({ safeStorage: fake({ sync: false, async: true }), dir });
  await s2.load();
  assert.equal(s2.get('elevenlabs'), 'sk_abc', 'after a restart');
});

test('keys saved by older versions (sync API) are still read, then re-saved with the async API', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ openai: enc('S', 'sk_old').toString('base64') }));
  const s = createSecretStore({ safeStorage: fake({ sync: false, async: true }), dir });
  await s.load();
  assert.equal(s.get('openai'), 'sk_old');
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')).openai.startsWith(ASYNC_TAG));
});

test('no keyring at all: nothing is saved, with a clear reason, unless basic protection is chosen', async () => {
  const dir = tmp();
  const none = createSecretStore({ safeStorage: fake({ sync: false, async: false, plain: true }), dir });
  await assert.rejects(none.set('venice', 'k'), /no keyring/);
  assert.equal(fs.existsSync(path.join(dir, 'secrets.json')), false);
  const ss = fake({ sync: false, async: false, plain: true });
  const basic = createSecretStore({ safeStorage: ss, dir, allowBasic: () => true });
  await basic.set('venice', 'k2');
  assert.equal(ss.plainUsed, true);
  assert.equal(basic.weak(), true);
  assert.equal(basic.get('venice'), 'k2');
});

test('the app turns basic protection on only from the owner\'s setting', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /allowBasic: \(\) => readSettings\(\)\.secretsBasic === true/);
  assert.match(main, /secretsBasic: s\.secretsBasic === true/);
  assert.match(main, /await secrets\.load\(\)/);
});
