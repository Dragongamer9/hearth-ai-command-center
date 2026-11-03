// Duplicate-task check: plain word overlap between a new task and the open ones.
// Pure functions (unit tested).
const STOP = new Set('a an the and or of to for in on at by with from into is are be it its this that as task tasks add make fix new should when so not no'.split(' '));

export function words(text) {
  return new Set(String(text || '').toLowerCase().replace(/t-[a-z0-9]{4,12}/g, ' ').split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)));
}

// 0..1. Titles count most; descriptions add a little.
export function similarity(a, b) {
  const jac = (x, y) => {
    if (!x.size || !y.size) return 0;
    let both = 0;
    for (const w of x) if (y.has(w)) both++;
    return both / (x.size + y.size - both);
  };
  const t = jac(words(a.title), words(b.title));
  const d = jac(words(`${a.title} ${a.description || ''}`), words(`${b.title} ${b.description || ''}`));
  return Math.max(t, 0.7 * t + 0.3 * d);
}

const CLOSED = ['approved', 'rejected'];

// The open task the new one most looks like, or null.
export function findDuplicate(task, tasks = [], threshold = 0.6) {
  let best = null;
  for (const t of tasks) {
    if (!t || CLOSED.includes(t.stage) || (task.id && t.id === task.id)) continue;
    const exact = String(t.title || '').trim().toLowerCase() === String(task.title || '').trim().toLowerCase();
    const score = exact ? 1 : similarity(task, t);
    if (score >= threshold && (!best || score > best.score)) best = { task: t, score };
  }
  return best;
}
