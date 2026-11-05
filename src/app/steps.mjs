// An AI turn's steps as compact rows (pure, unit tested). Raw steps come from the main
// process (electron/steps.cjs); consecutive steps of the same kind become one row:
// "Read  WifiPage.qml, nm-watch.py, test_wifi.py".

export const STEP_ICON = { search: 'search', read: 'doc', 'web-search': 'globe', 'web-read': 'globe', edit: 'pencil', check: 'play', run: 'play', push: 'push', commit: 'check', actions: 'play', pr: 'branch', copy: 'db', task: 'users', tool: 'cpu', preview: 'eye' };

const uniq = (a) => [...new Set(a.filter(Boolean))];
const list = (names, max = 3) => (names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', '));

export function groupSteps(steps = []) {
  const rows = [];
  for (const s of steps) {
    if (!s || !s.kind) continue;
    const last = rows[rows.length - 1];
    const mergeable = ['read', 'edit', 'search', 'web-read', 'web-search', 'check'].includes(s.kind);
    if (last && mergeable && last.kind === s.kind) { last.items.push(s); continue; }
    rows.push({ kind: s.kind, items: [s] });
  }
  return rows.map(rowOf);
}

function rowOf({ kind, items }) {
  const first = items[0];
  const details = uniq(items.map((i) => i.detail));
  const files = uniq(items.map((i) => i.file || i.detail));
  switch (kind) {
    case 'read': return { kind, icon: STEP_ICON.read, label: first.label === 'Read' || items.length > 1 ? 'Read' : first.label, detail: list(uniq(files.map((f) => String(f).split('/').pop()))), note: '' };
    case 'edit': return { kind, icon: STEP_ICON.edit, label: files.length > 1 ? `Edited ${files.length} files` : `${first.label}`, detail: files.length > 1 ? list(files.map((f) => String(f).split('/').pop())) : String(files[0] || '').split('/').pop(), note: '' };
    case 'search': return { kind, icon: STEP_ICON.search, label: first.label, detail: list(details, 2), note: items.length > 1 ? `${items.length} searches` : '' };
    case 'web-search': return { kind, icon: STEP_ICON['web-search'], label: 'Searched the web', detail: list(details, 2), note: 'web' };
    case 'web-read': return { kind, icon: STEP_ICON['web-read'], label: items.length > 1 ? `Read ${items.length} web pages` : 'Read a web page', detail: list(details, 3), note: 'web', url: first.url || '' };
    case 'check': return { kind, icon: STEP_ICON.check, label: 'Ran checks locally', detail: list(details, 2), note: 'on this PC' };
    default: return { kind, icon: STEP_ICON[kind] || 'cpu', label: first.label, detail: first.detail || '', note: first.note || '', ok: first.ok, url: first.url || '' };
  }
}

// Steps the app adds after a turn, from what really happened (git, the push, Actions).
export function outcomeSteps(r = {}) {
  const out = [];
  const files = r.changes?.files || [];
  if (files.length) out.push({ kind: 'edit-summary', icon: 'pencil', label: `Edited ${files.length} file${files.length > 1 ? 's' : ''}`, detail: r.changes.branch ? `on branch ${r.changes.branch}` : '', note: '✓ committed as you', ok: true });
  if (r.pushed?.ok) out.push({ kind: 'pushed', icon: 'push', label: 'Pushed to GitHub', detail: r.pushed.branch, note: '✓ on GitHub', ok: true });
  else if (r.pushed && !r.pushed.ok && !r.pushed.nothing) out.push({ kind: 'pushed', icon: 'push', label: 'Not pushed', detail: r.pushed.message || '', note: '', bad: true });
  for (const p of r.previews || []) out.push({ kind: 'preview', icon: 'eye', label: 'Made a live preview', detail: p.name, note: 'open →', open: p.id || p.name });
  return out;
}
