// Live › Mesh (the approved mockup live-mesh.png): the AIs working now in a capsule in the middle, and around them
// the "stations" (Files, Search, Shell, Checks, Web, Git, Helpers, Tools, Make, Memory, You and Replies). A station
// lights up in the colour of the AI that just used it, with a line and a pulse running from that AI to it. Counts are
// this chat's. Pure builders (unit tested in test/live-mesh.test.mjs); main.js passes in the chat and coreHtml.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// [id, title, what it is when nothing has happened yet, x %, y %] — placed around the capsule as in the mockup.
export const STATIONS = [
  ['you', 'You', 'you wrote', 50, 12],
  ['replies', 'Replies', 'the team replied', 71, 17],
  ['files', 'Files', 'read & edit', 86, 31],
  ['search', 'Search', 'the repo & the web', 92, 50],
  ['shell', 'Shell', 'commands', 86, 69],
  ['checks', 'Checks', 'tests & Actions', 71, 83],
  ['web', 'Web', 'web pages', 50, 88],
  ['git', 'Git', 'commit, push & PRs', 29, 83],
  ['helpers', 'Helpers', 'helpers it asked', 14, 69],
  ['tools', 'Tools', 'MCP & more', 8, 50],
  ['make', 'Make', 'pictures & video', 14, 31],
  ['memory', 'Memory', 'your other chats', 29, 17],
];

// Which station a step belongs to.
export function stationOf(step) {
  if (!step || !step.kind) return null;
  const label = String(step.label || '');
  if (/your chats|another chat/i.test(label)) return 'memory';
  switch (step.kind) {
    case 'read': case 'edit': case 'edit-summary': return 'files';
    case 'search': case 'web-search': return 'search';
    case 'web-read': return 'web';
    case 'run': return 'shell';
    case 'check': case 'actions': return 'checks';
    case 'push': case 'pushed': case 'commit': case 'pr': return 'git';
    case 'task': return 'helpers';
    case 'tool': case 'copy': return 'tools';
    case 'image': case 'preview': return 'make';
    default: return null;
  }
}

// What a station says it last did: "Edited BatteryWatch.qml", "Read upower.freedesktop.org", "Pushed".
export function stepLine(step) {
  if (!step) return '';
  const label = String(step.label || '').trim();
  const detail = String(step.detail || '').trim();
  if (step.kind === 'web-read') return detail ? `Read ${detail}` : 'Read a web page';
  if (['read', 'edit'].includes(step.kind) && detail) return `${label} ${detail}`;
  return label;
}

// The mesh's data from a chat runtime. R: { msgs: [{ who, text, steps, media }], working: [{ agent, steps, status? }] };
// isAgent(who) tells an AI from the owner. Returns { stations, capsule }.
export function meshState(R, { isAgent = (w) => w && w !== 'owner', lead = null } = {}) {
  const st = new Map(STATIONS.map(([id, title, idle, x, y]) => [id, { id, title, idle, x, y, n: 0, last: '', by: null, active: false, pulse: false }]));
  const bump = (id, line, by) => { const s = st.get(id); if (!s) return; s.n += 1; if (line) s.last = line; if (by) s.by = by; };
  for (const m of R?.msgs || []) {
    if (m.who === 'owner') { if (m.text) bump('you', 'You wrote'); continue; }
    if (!isAgent(m.who)) continue;
    for (const s of m.steps || []) { const id = stationOf(s); if (id) bump(id, stepLine(s), m.who); }
    if (Array.isArray(m.media) && m.media.length) bump('make', 'Made a picture', m.who);
    if (m.text && !m.err) bump('replies', 'Replied', m.who);
  }
  const working = [...new Map((R?.working?.length ? R.working : R?.busy ? [R.busy] : []).map((b) => [b.agent, b])).values()];
  for (const b of working) {
    // Steps of a turn still running aren't in a message yet: count them, and light the AI's two newest stations.
    const steps = b.steps || [];
    for (const s of steps) { const id = stationOf(s); if (id) bump(id, stepLine(s), b.agent); }
    const lit = [];
    for (let i = steps.length - 1; i >= 0 && lit.length < 2; i--) { const id = stationOf(steps[i]); if (id && !lit.includes(id)) lit.push(id); }
    lit.forEach((id, k) => { const s = st.get(id); if (s.active && s.by !== b.agent) return; s.active = true; s.by = b.agent; s.pulse = k === 0; });
  }
  const capsule = working.map((b) => ({ id: b.agent, status: (b.steps || []).length ? stepLine(b.steps[b.steps.length - 1]) : 'working…', state: 'working' }));
  if (!capsule.length && lead) capsule.push({ id: lead, status: 'lead · ready', state: 'ready' });
  return { stations: [...st.values()], capsule };
}

// The mesh. capsule items get { name, html } from main.js (their core); rgbOf(id) gives an AI's colour.
export function meshHtml({ stations, capsule }, { rgbOf = () => '201,163,114', nameOf = (id) => id, coreOf = () => '' } = {}) {
  const n = capsule.length;
  const spot = (i) => (n <= 1 ? 50 : 50 + (i - (n - 1) / 2) * Math.min(9, 36 / n));
  const at = new Map(capsule.map((c, i) => [c.id, spot(i)]));
  const lines = stations.map((s) => {
    const from = s.active && at.has(s.by) ? at.get(s.by) : 50;
    const col = s.active ? `rgb(${rgbOf(s.by)})` : 'rgba(201,163,114,.16)';
    return `<line x1="${from}" y1="50" x2="${s.x}" y2="${s.y}" stroke="${col}" stroke-width="${s.active ? 2 : 1}" vector-effect="non-scaling-stroke"></line>`;
  }).join('');
  const pulses = stations.filter((s) => s.active && s.pulse).map((s) => `<i class="mesh-pulse" style="--c:rgb(${rgbOf(s.by)});--x1:${at.get(s.by) ?? 50}%;--y1:50%;--x2:${s.x}%;--y2:${s.y}%"></i>`).join('');
  const boxes = stations.map((s) => {
    const lit = s.active;
    const style = `left:${s.x}%;top:${s.y}%;${lit ? `--c:rgb(${rgbOf(s.by)});` : ''}`;
    return `<div class="mesh-st ${lit ? 'lit' : s.n ? 'used' : 'idle'}" style="${style}" title="${esc(s.title)}: ${s.n} in this chat${s.by ? ` · last by ${esc(nameOf(s.by))}` : ''}"><div class="mesh-st-h"><b>${esc(s.title)}</b><span>${s.n}</span></div><div class="mesh-st-l">${esc(s.n ? s.last : s.idle)}</div></div>`;
  }).join('');
  const caps = n
    ? capsule.map((c) => `<div class="mesh-ai" style="--c:rgb(${rgbOf(c.id)})">${coreOf(c)}<b>${esc(nameOf(c.id))}</b><span>${esc(c.status)}</span></div>`).join('')
    : '<div class="mesh-none">Nobody is working right now</div>';
  return `<div class="mesh" role="img" aria-label="Live mesh: ${n} AI${n === 1 ? '' : 's'} working; ${stations.filter((s) => s.active).map((s) => s.title).join(', ') || 'no station'} lit"><svg class="mesh-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${pulses}<div class="mesh-cap">${caps}</div>${boxes}</div>`;
}
