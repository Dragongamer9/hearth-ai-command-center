// Hearth logs straight in: a GitHub repo of device logs laid out as
// logs/<date>/<code>.txt (the owner's is Dragongamer9/hearth-logs). Pure helpers.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[A-Za-z0-9_.-]{1,64}$/;

function parseLogPath(p) {
  const m = String(p || '').match(/^logs\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9_.-]{1,64})\.txt$/);
  return m ? { date: m[1], code: m[2], path: m[0] } : null;
}

// Newest dates first, at most `max` of them.
function recentDates(entries = [], max = 5) {
  return (Array.isArray(entries) ? entries : []).filter((e) => e && e.type === 'dir' && DATE_RE.test(e.name)).map((e) => e.name).sort().reverse().slice(0, max);
}

function newLogs(seen, paths) {
  const s = seen instanceof Set ? seen : new Set(seen || []);
  return paths.map(parseLogPath).filter((x) => x && !s.has(x.path));
}

// Device, Hearth OS version and the top error lines, for the task description.
function summarizeLog(text) {
  const lines = String(text || '').split(/\r?\n/);
  const find = (res) => {
    for (const l of lines) for (const re of res) { const m = l.match(re); if (m) return m[1].trim().slice(0, 120); }
    return null;
  };
  const device = find([/^\s*(?:device|model|product(?: name)?|board|hardware)\s*[:=]\s*(.+)$/i, /\bDMI:\s*(.+?)(?:,|$)/]);
  const version = find([/^\s*(?:hearth(?: os)?(?: version)?|version|os version|VERSION_ID)\s*[:=]\s*"?([^"\n]+)"?/i, /\bHearth OS\s+v?(\d[\w.-]*)/i]);
  const seenErr = new Set();
  const errors = [];
  for (const l of lines) {
    if (!/\b(error|failed|failure|fatal|panic|segfault|exception|denied|timed out|oops)\b/i.test(l)) continue;
    const key = l.replace(/^\S*\d{2}:\d{2}:\d{2}\S*\s*/, '').replace(/\d+/g, '#').trim().slice(0, 160);
    if (!key || seenErr.has(key)) continue;
    seenErr.add(key);
    errors.push(l.trim().slice(0, 240));
    if (errors.length >= 5) break;
  }
  return { device, version, errors };
}

module.exports = { parseLogPath, recentDates, newLogs, summarizeLog, DATE_RE, CODE_RE };
