// API keys are encrypted with Electron safeStorage and stored in a 0600 file. Plaintext keys
// are only ever held in the main process.
//
// Electron's async API is used (encryptStringAsync / decryptStringAsync): on Linux it reaches
// more keyrings (the Secret portal, the Secret Service, KWallet) than the old sync API, which
// threw "Encryption is not available" on PCs where only the newer ones work. Keys saved by the
// old sync API are still read (the docs say decryptStringAsync reads them) and are re-saved
// with the async API the next time they are read or changed.
//
// Decrypted keys are kept in memory after load() so callers can read them synchronously.
// If this PC has no keyring at all, nothing is saved unless the owner explicitly chooses basic
// protection (Settings › Accounts), which is weak and shown as such.
const fs = require('node:fs');
const path = require('node:path');

const ASYNC_TAG = 'a1:'; // entries written with encryptStringAsync

function createSecretStore({ safeStorage, dir, allowBasic = () => false }) {
  const file = path.join(dir, 'secrets.json');
  const cache = new Map();
  let loaded = false;

  function readAll() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  }
  function writeAll(data) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  }
  function backend() {
    try { return safeStorage.getSelectedStorageBackend?.() ?? 'unknown'; } catch { return 'unknown'; }
  }
  const hasAsync = () => typeof safeStorage.encryptStringAsync === 'function' && typeof safeStorage.decryptStringAsync === 'function';

  async function available() {
    try {
      if (typeof safeStorage.isAsyncEncryptionAvailable === 'function' && await safeStorage.isAsyncEncryptionAvailable()) return true;
    } catch {}
    try { if (safeStorage.isEncryptionAvailable?.()) return true; } catch {}
    // No keyring: only with the owner's explicit choice of basic (weak) protection.
    if (allowBasic() && typeof safeStorage.setUsePlainTextEncryption === 'function') {
      try { safeStorage.setUsePlainTextEncryption(true); return true; } catch {}
    }
    return false;
  }

  async function encrypt(text) {
    if (hasAsync()) {
      try { return ASYNC_TAG + (await safeStorage.encryptStringAsync(text)).toString('base64'); } catch (e) { if (!safeStorage.isEncryptionAvailable?.()) throw e; }
    }
    return safeStorage.encryptString(text).toString('base64');
  }
  async function decrypt(stored) {
    const s = String(stored || '');
    const isAsync = s.startsWith(ASYNC_TAG);
    const buf = Buffer.from(isAsync ? s.slice(ASYNC_TAG.length) : s, 'base64');
    if (hasAsync()) {
      try {
        const r = await safeStorage.decryptStringAsync(buf);
        const result = typeof r === 'string' ? r : r?.result;
        if (typeof result === 'string') return { text: result, reencrypt: !isAsync || Boolean(r?.shouldReEncrypt) };
      } catch {}
    }
    if (!isAsync) { try { return { text: safeStorage.decryptString(buf), reencrypt: false }; } catch {} }
    return null;
  }

  return {
    available,
    // 'basic_text' means no keyring was found and encryption is weak.
    weak() { return backend() === 'basic_text'; },
    backend,
    // Decrypt every saved key once (after app ready), so get() can answer synchronously.
    async load() {
      const data = readAll();
      let changed = false;
      for (const [k, v] of Object.entries(data)) {
        const d = await decrypt(v);
        if (!d) continue;
        cache.set(k, d.text);
        if (d.reencrypt) { try { data[k] = await encrypt(d.text); changed = true; } catch {} }
      }
      if (changed) { try { writeAll(data); } catch {} }
      loaded = true;
      return cache.size;
    },
    async set(provider, key) {
      if (!(await available())) throw new Error('This PC has no keyring for encrypted secrets (GNOME Keyring, KWallet or the Secret portal), so the key was not saved. Unlock or install a keyring, or choose basic protection in Settings › Accounts.');
      const data = readAll();
      data[provider] = await encrypt(key);
      writeAll(data);
      cache.set(provider, key);
    },
    get(provider) {
      if (cache.has(provider)) return cache.get(provider);
      if (loaded) return null;
      // Before load(): the old sync path (keys from older versions).
      const enc = readAll()[provider];
      if (!enc || String(enc).startsWith(ASYNC_TAG)) return null;
      try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
    },
    has(provider) { return Boolean(readAll()[provider]); },
    remove(provider) {
      const data = readAll();
      delete data[provider];
      writeAll(data);
      cache.delete(provider);
    },
  };
}

module.exports = { createSecretStore, ASYNC_TAG };
