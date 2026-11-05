// The sidebar: chats grouped Pinned / Today / Yesterday / Earlier (pure, unit tested).
import { sortChats } from '../chats.mjs';

const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

export function groupChats(list = [], { now = new Date(), query = '', hits = null } = {}) {
  const q = String(query || '').toLowerCase().trim();
  const shown = list.filter((c) => !c.hidden && (!q || (hits ? hits.has(c.id) : `${c.title} ${c.repo || ''}`.toLowerCase().includes(q))));
  const sorted = sortChats(shown);
  const today = dayStart(now);
  const yesterday = today - 86400e3;
  const groups = [
    { key: 'pinned', label: 'Pinned', items: [] },
    { key: 'today', label: 'Today', items: [] },
    { key: 'yesterday', label: 'Yesterday', items: [] },
    { key: 'earlier', label: 'Earlier', items: [] },
  ];
  for (const c of sorted) {
    if (c.pinned) { groups[0].items.push(c); continue; }
    const t = Date.parse(c.updatedAt || c.createdAt || '') || 0;
    groups[t >= today ? 1 : t >= yesterday ? 2 : 3].items.push(c);
  }
  return groups.filter((g) => g.items.length);
}

// The short repo name shown next to a chat ("hearth-os"), or the folder name for a local repo.
export function repoHint(c) {
  if (!c) return '';
  if (c.repo) return String(c.repo).split('/')[1] || c.repo;
  if (c.repoDir) return String(c.repoDir).split('/').filter(Boolean).pop() || '';
  return '';
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1048576) return `${(v / 1024).toFixed(0)} KB`;
  if (v < 1073741824) return `${(v / 1048576).toFixed(v < 10485760 ? 1 : 0)} MB`;
  return `${(v / 1073741824).toFixed(1)} GB`;
}

export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!t) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days`;
}
