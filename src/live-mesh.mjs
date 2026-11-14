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

// 3.8: little electric currents on a lit line: three jagged sparks from the AI to the station, seeded by the station so
// a redraw looks the same, shown one after another (CSS) so they crackle.
function seedOf(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function boltPaths(x1, y1, x2, y2, key, { count = 3, steps = 18, jag = 3.2 } = {}) {
  const dx = x2 - x1; const dy = y2 - y1; const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; const ny = dx / len;
  const out = [];
  let r = seedOf(key);
  const rnd = () => { r = (Math.imul(r ^ (r >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return r / 4294967296; };
  for (let b = 0; b < count; b++) {
    const pts = [[x1, y1]];
    for (let i = 1; i < steps; i++) {
      const t = i / steps; const o = (rnd() - 0.5) * 2 * jag * Math.min(1, Math.sin(Math.PI * t) * 1.6);
      pts.push([x1 + dx * t + nx * o, y1 + dy * t + ny * o]);
    }
    pts.push([x2, y2]);
    out.push(`M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L')}`);
  }
  return out;
}

// The mesh. capsule items get { name, html } from main.js (their core); rgbOf(id) gives an AI's colour.
// 3.9: Ithil's own station (the top-left corner, outside the ring of stations): her mood and newest thought from Hearth AI's live events. It glows sage green
// for a few seconds after each new thought, and dims while she sleeps, rests or is offline.
export const ITHIL_AT = [10, 12]; // where her line ends (her station's middle, about)
export function ithilStationHtml(it, { avatar = '' } = {}) {
  if (!it) return '';
  const cls = !it.online ? 'off' : it.state !== 'awake' ? 'rest' : it.think ? 'think' : 'awake';
  return `<div class="mesh-st mesh-ithil ${cls}" title="Ithil (Hearth AI): ${esc(it.label)}"><div class="mesh-st-h">${avatar}<b>Ithil</b><span>${esc(it.online ? (it.mood || it.state) : 'offline')}</span></div><div class="mesh-ith-t">${esc(it.online ? (it.thought ? `“${it.thought}”` : it.label) : 'Hearth AI isn\'t running')}</div></div>`;
}

export function meshHtml({ stations, capsule, ithil = null }, { rgbOf = () => '201,163,114', nameOf = (id) => id, coreOf = () => '', ithilAvatar = '' } = {}) {
  const n = capsule.length;
  const spot = (i) => (n <= 1 ? 50 : 50 + (i - (n - 1) / 2) * Math.min(9, 36 / n));
  const at = new Map(capsule.map((c, i) => [c.id, spot(i)]));
  const lines = stations.map((s) => {
    const from = s.active && at.has(s.by) ? at.get(s.by) : 50;
    const col = s.active ? `rgb(${rgbOf(s.by)})` : 'rgba(201,163,114,.16)';
    return `<line x1="${from}" y1="50" x2="${s.x}" y2="${s.y}" stroke="${col}" stroke-width="${s.active ? 2 : 1}" vector-effect="non-scaling-stroke"></line>`;
  }).join('');
  const bolts = stations.filter((s) => s.active).map((s) => {
    const from = at.has(s.by) ? at.get(s.by) : 50;
    return boltPaths(from, 50, s.x, s.y, `${s.id}:${s.by}`).map((d, k) => `<path class="mesh-bolt b${k}" d="${d}" style="color:rgb(${rgbOf(s.by)})" vector-effect="non-scaling-stroke"></path>`).join('');
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
  const ith = ithil ? ithilStationHtml(ithil, { avatar: ithilAvatar }) : '';
  const ithLine = ithil && ithil.online ? `<line x1="50" y1="50" x2="${ITHIL_AT[0]}" y2="${ITHIL_AT[1]}" stroke="${ithil.think || ithil.busy ? 'rgb(156,196,156)' : 'rgba(156,196,156,.22)'}" stroke-width="${ithil.think || ithil.busy ? 2 : 1}" stroke-dasharray="${ithil.state === 'awake' ? '' : '3 4'}" vector-effect="non-scaling-stroke"></line>` : '';
  const ithBolts = ithil && ithil.online && (ithil.think || ithil.busy) ? boltPaths(50, 50, ITHIL_AT[0], ITHIL_AT[1], 'ithil').map((dd, k) => `<path class="mesh-bolt b${k}" d="${dd}" style="color:rgb(156,196,156)" vector-effect="non-scaling-stroke"></path>`).join('') : '';
  return `<div class="mesh" role="img" aria-label="Live mesh: ${n} AI${n === 1 ? '' : 's'} working; ${stations.filter((s) => s.active).map((s) => s.title).join(', ') || 'no station'} lit"><svg class="mesh-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}${ithLine}<g class="mesh-bolts">${bolts}${ithBolts}</g></svg>${pulses}<div class="mesh-cap">${caps}</div>${boxes}${ith}</div>`;
}
