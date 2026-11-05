// Who may use the microphone: only the app's own window, its own page (main frame), and audio
// only. Live previews (hearth-preview: frames), the Find characters windows and the official
// web app windows never get it (those have their own sessions that refuse it too).
// Other permissions keep working as before for the app's own window only.
const OTHER_OK_ELSEWHERE = ['clipboard-sanitized-write', 'fullscreen'];

function isAppUrl(url, devUrl = process.env.VITE_DEV_SERVER_URL) {
  const u = String(url || '');
  return u.startsWith('file://') || Boolean(devUrl && u.startsWith(devUrl));
}

// The request handler's answer: (webContents, permission, details) -> true/false.
function allowRequest({ wc, appWc, permission, details = {}, devUrl }) {
  const ours = Boolean(wc && appWc && wc === appWc);
  if (permission === 'media') {
    const types = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    return ours && details.isMainFrame !== false && isAppUrl(details.requestingUrl, devUrl) && types.length > 0 && types.every((t) => t === 'audio');
  }
  if (!ours) return OTHER_OK_ELSEWHERE.includes(permission);
  return true;
}
// The check handler's answer (Chromium asks before enumerating devices and so on).
function allowCheck({ wc, appWc, permission, origin, details = {}, devUrl }) {
  const ours = Boolean(wc && appWc && wc === appWc);
  if (permission === 'media') return ours && details.mediaType !== 'video' && isAppUrl(details.requestingUrl || origin, devUrl) && details.isMainFrame !== false;
  if (!ours) return OTHER_OK_ELSEWHERE.includes(permission);
  return true;
}

// Installs both handlers on the app window's session.
function install(win, { devUrl } = {}) {
  const sess = win.webContents.session;
  sess.setPermissionRequestHandler((wc, permission, cb, details) => cb(allowRequest({ wc, appWc: win.isDestroyed() ? null : win.webContents, permission, details, devUrl })));
  sess.setPermissionCheckHandler((wc, permission, origin, details) => allowCheck({ wc, appWc: win.isDestroyed() ? null : win.webContents, permission, origin, details, devUrl }));
}

module.exports = { allowRequest, allowCheck, install, isAppUrl };
