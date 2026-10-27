// In-app updates via electron-updater + GitHub Releases.
// - Never downloads or installs without the user clicking a button.
// - Disabled in development / unpackaged runs and when not running as an AppImage.
// - Only published (non-draft, non-prerelease) GitHub Releases are offered.
function createUpdater({ app, send }) {
  let autoUpdater = null;
  let status = { state: 'idle', version: null, percent: 0, message: null };

  const enabled = app.isPackaged && Boolean(process.env.APPIMAGE);
  const reason = !app.isPackaged
    ? 'Updates are disabled in development builds.'
    : !process.env.APPIMAGE
      ? 'Updates only work when running the .AppImage file.'
      : null;

  function emit(patch) {
    status = { ...status, ...patch };
    send('updater:status', status);
  }

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
    info: () => ({ enabled, reason, status }),
    async check() {
      if (!enabled) return { ok: false, message: reason };
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
      // User explicitly chose to restart now.
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return { ok: true };
    },
  };
}

module.exports = { createUpdater };
