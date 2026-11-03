// In-app updates via electron-updater + GitHub Releases.
// - Never downloads or installs without the user clicking a button.
// - Disabled in development / unpackaged runs and when not running as an AppImage.
// - Only published (non-draft, non-prerelease) GitHub Releases are offered.
const path = require('node:path');
const os = require('node:os');
const debUp = require('./updater-deb.cjs');

function createUpdater({ app, send }) {
  let autoUpdater = null;
  let status = { state: 'idle', version: null, percent: 0, message: null };

  // How the app was installed: AppImage (electron-updater, unchanged), .deb (updater-deb.cjs), or other.
  const install = app.isPackaged ? debUp.detectInstall({ dpkgOwns: debUp.dpkgOwnsSync }) : 'dev';
  const enabled = install === 'appimage' || install === 'deb';
  const reason = !app.isPackaged
    ? 'Updates are disabled in development builds.'
    : !enabled
      ? 'Download the new version from the release page.'
      : null;
  const link = install === 'other' ? debUp.RELEASES_PAGE : null;

  function emit(patch) {
    status = { ...status, ...patch };
    send('updater:status', status);
  }
  const deb = install === 'deb' ? debUp.createDebUpdater({ app, emit, tmpDir: path.join(os.tmpdir(), `hearth-update-${process.getuid?.() ?? 'u'}`) }) : null;

  function init() {
    if (!enabled || autoUpdater) return;
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = null;

    autoUpdater.on('checking-for-update', () => emit({ state: 'checking', message: null }));
    autoUpdater.on('update-available', (info) => emit({ state: 'available', version: info.version }));
    autoUpdater.on('update-not-available', () => emit({ state: 'none', message: 'You are on the latest version.' }));
    autoUpdater.on('download-progress', (p) => emit({ state: 'downloading', percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', (info) => emit({ state: 'ready', version: info.version, percent: 100 }));
    autoUpdater.on('error', (err) => emit({ state: 'error', message: friendly(err) }));
  }

  function friendly(err) {
    const msg = String(err?.message || err || 'Unknown error');
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR/i.test(msg)) return 'Offline or GitHub unreachable.';
    if (/404|latest-linux\.yml/i.test(msg)) return 'No published release found yet.';
    if (/sha512|checksum/i.test(msg)) return 'Downloaded update failed its integrity check and was discarded.';
    return msg.split('\n')[0].slice(0, 200);
  }

  return {
    info: () => ({ enabled, reason, status, install, link }),
    async check() {
      if (!enabled) return { ok: false, message: reason };
      if (deb) return deb.check();
      init();
      try {
        await autoUpdater.checkForUpdates();
        return { ok: true };
      } catch (e) {
        emit({ state: 'error', message: friendly(e) });
        return { ok: false, message: friendly(e) };
      }
    },
    async download() {
      if (!enabled || status.state !== 'available') return { ok: false, message: 'No update to download.' };
      if (deb) return deb.download();
      try {
        emit({ state: 'downloading', percent: 0 });
        await autoUpdater.downloadUpdate();
        return { ok: true };
      } catch (e) {
        emit({ state: 'error', message: friendly(e) });
        return { ok: false, message: friendly(e) };
      }
    },
    install() {
      if (!enabled || status.state !== 'ready') return { ok: false, message: 'No downloaded update to install.' };
      if (deb) return deb.install();
      // User explicitly chose to restart now.
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return { ok: true };
    },
    // After a .deb install: the owner presses Restart now.
    restart() {
      if (status.state !== 'installed') return { ok: false, message: 'Nothing to restart for.' };
      setImmediate(() => { app.relaunch(); app.exit(0); });
      return { ok: true };
    },
  };
}

module.exports = { createUpdater };
