// API keys are encrypted with Electron safeStorage (the OS keyring on Linux:
// GNOME Keyring / KWallet) and stored in a 0600 file. Plaintext keys are only
// ever held in the main process.
const fs = require('node:fs');
const path = require('node:path');

function createSecretStore({ safeStorage, dir }) {
  const file = path.join(dir, 'secrets.json');

  function readAll() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  }

  function writeAll(data) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  }

  function backend() {
    try {
      return safeStorage.getSelectedStorageBackend?.() ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  return {
    async available() {
      if (typeof safeStorage.isAsyncEncryptionAvailable === 'function') {
        return safeStorage.isAsyncEncryptionAvailable();
      }
      return safeStorage.isEncryptionAvailable();
    },
    // 'basic_text' means no keyring was found and encryption is weak.
    weak() {
      return backend() === 'basic_text';
    },
    async set(provider, key) {
      if (!(await this.available())) throw new Error('OS encryption is not available; key not saved');
      const data = readAll();
      data[provider] = safeStorage.encryptString(key).toString('base64');
      writeAll(data);
    },
    get(provider) {
      const enc = readAll()[provider];
      if (!enc) return null;
      try {
        return safeStorage.decryptString(Buffer.from(enc, 'base64'));
      } catch {
        return null;
      }
    },
    has(provider) {
      return Boolean(readAll()[provider]);
    },
    remove(provider) {
      const data = readAll();
      delete data[provider];
      writeAll(data);
    },
  };
}

module.exports = { createSecretStore };
