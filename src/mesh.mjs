// The Live mesh (3.6): the AIs working now in the middle, and around them the places their work goes: You (your
// messages), Replies, Files, Search, Shell, Checks, Web, Git, Helpers, Tools, Make, Memory. Each station counts what
// happened in this chat and lights up, with a pulse from the AI that did it, the moment something new happens.
// The idea comes from Command Mesh (github.com/Deemer15/command-mesh, MIT); no code was copied. Pure HTML builders,
// unit tested in test/mesh.test.mjs; main.js passes in the chat and remembers when each event was first seen.

import { coreHtml, coreOf } from './live.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// [id, label, what it means]
export const STATIONS = [
  ['you', 'You', 'your messages'],
  ['model', 'Replies', 'answers'],
  ['files', 'Files', 'read & edited'],
  ['search', 'Search', 'the repo'],
  ['shell', 'Shell', 'commands'],
  ['checks', 'Checks', 'tests & builds'],
  ['web', 'Web', 'searches & pages'],
  ['git', 'Git', 'commits & pushes'],
  ['agents', 'Helpers', 'sub-agents'],
  ['tools', 'Tools', 'MCP & more'],
  ['make', 'Make', 'pictures & video'],
  ['memory', 'Memory', 'your other chats'],
];
const STATION_IDS = STATIONS.map((s) => s[0]);

// A step's kind (electron/steps.cjs, main.js) → its station.
export function stationOf(step) {
  const k = step?.kind || '';
  if (step?.label === 'Searched your chats' || step?.label === 'Read another chat') return 'memory';
  if (k === 'read' || k === 'edit') return 'files';
  if (k === 'search') return 'search';
  if (k === 'run') return 'shell';
  if (k === 'check') return 'checks';
  if (k === 'web-search' || k === 'web-read') return 'web';
  if (k === 'push' || k === 'commit' || k === 'pr' || k === 'actions') return 'git';
  if (k === 'task') return 'agents';
  if (k === 'image') return 'make';
  return 'tools';
}

// Every event in a chat, oldest first: { key, agent, station, label }. agents: the AI ids (anything else is skipped).
export function meshEvents(R, agents = {}) {
  const out = [];
  const isAi = (w) => Boolean(agents[w]);
  for (const m of R?.msgs || []) {
    const id = m.id || '';
    if (m.who === 'owner' && m.text) out.push({ key: `${id}:you`, agent: 'owner', station: 'you', label: 'You wrote' });
    if (!isAi(m.who)) continue;
    (m.steps || []).forEach((s, i) => out.push({ key: `${id}:s${i}`, agent: m.who, station: stationOf(s), label: s.label || '' }));
    if (m.text && !m.err) out.push({ key: `${id}:reply`, agent: m.who, station: 'model', label: 'Replied' });
  }
  for (const b of R?.working?.length ? R.working : R?.busy ? [R.busy] : []) {
    if (!isAi(b.agent)) continue;
    (b.steps || []).forEach((s, i) => out.push({ key: `${b.runId || b.agent}:b${i}`, agent: b.agent, station: stationOf(s), label: s.label || '' }));
  }
  return out;
}

// How many of each, and the newest one per station.
export function meshCounts(events, ids = STATION_IDS) {
  const counts = Object.fromEntries(ids.map((s) => [s, 0]));
  const last = {};
  for (const e of events) { counts[e.station] = (counts[e.station] || 0) + 1; last[e.station] = e; }
  return { counts, last };
}

// Where each station sits: around an ellipse, starting at the top, in percent of the stage.
export function stationSpots(n = STATIONS.length) {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return { x: +(50 + Math.cos(a) * 42).toFixed(2), y: +(50 + Math.sin(a) * 38).toFixed(2) };
  });
}

export const PULSE_MS = 1600;     // a pulse travels from the AI to the station
export const HOT_MS = 4500;       // a station stays lit this long after something new

// The mesh. events: meshEvents(); seen: { key: when it was first seen (ms) } (0 = was there before the screen
// opened: counted, never animated); cores: [{ id, name, state, status }] for the middle; now: Date.now().
// stations: another set of [id, label, what] (Hearth OS's Server mode shows your devices instead).
export function meshHtml({ events, seen = {}, cores = [], now = Date.now(), reduced = false, stations = STATIONS }) {
  const STATION_IDS = stations.map((s) => s[0]);
  const { counts, last } = meshCounts(events, STATION_IDS);
  const spots = stationSpots(stations.length);
  const rgb = (a) => (a === 'owner' ? '230,236,242' : coreOf(a).rgb);
  const recent = events.filter((e) => seen[e.key] && now - seen[e.key] < HOT_MS);
  const hotBy = {};
  for (const e of recent) hotBy[e.station] = e;
  const lines = spots.map((p, i) => {
    const st = STATION_IDS[i];
    const hot = hotBy[st];
    return `<line x1="50" y1="50" x2="${p.x}" y2="${p.y}" class="${hot ? 'hot' : ''}" style="${hot ? `stroke:rgb(${rgb(hot.agent)})` : ''}"></line>`;
  }).join('');
  const pulses = reduced ? '' : recent.filter((e) => now - seen[e.key] < PULSE_MS).slice(-24).map((e) => {
    const p = spots[STATION_IDS.indexOf(e.station)];
    return `<i class="mesh-pulse" style="--x:${p.x}%;--y:${p.y}%;--c:rgb(${rgb(e.agent)});animation-delay:-${now - seen[e.key]}ms"></i>`;
  }).join('');
  const boxes = stations.map(([id, label, what], i) => {
    const p = spots[i];
    const hot = hotBy[id];
    const l = last[id];
    const sub = hot ? `${hot.agent === 'owner' ? 'you' : esc(hot.label || what)}` : l ? esc(l.label || what) : esc(what);
    return `<div class="mesh-st ${hot ? 'hot' : ''} ${counts[id] ? '' : 'idle'}" style="left:${p.x}%;top:${p.y}%;${hot ? `--c:rgb(${rgb(hot.agent)})` : ''}" title="${esc(label)} · ${esc(what)}"><b>${esc(label)}</b><em>${counts[id]}</em><span>${sub}</span></div>`;
  }).join('');
  const mid = cores.slice(0, 4);
  const size = mid.length > 2 ? 64 : mid.length === 2 ? 80 : 104;
  const center = mid.length
    ? `<div class="mesh-bus">${mid.map((c) => `<div class="mesh-core">${coreHtml({ ...c, size })}<b>${esc(c.name)}</b><span>${esc(c.status || '')}</span></div>`).join('')}</div>`
    : '<div class="mesh-bus empty"><b>Nobody working</b><span>Send a message and the team lights up here</span></div>';
  return `<div class="mesh" aria-label="What the team is doing"><svg class="mesh-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${pulses}${boxes}${center}</div>`;
}

// What main.js keeps between renders: when each event was first seen. Events there before the screen opened count as 0.
export function markSeen(seen, events, now = Date.now(), first = false) {
  const next = { ...seen };
  for (const e of events) if (!(e.key in next)) next[e.key] = first ? 0 : now;
  return next;
}
