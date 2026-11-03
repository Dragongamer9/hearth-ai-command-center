// Budget awareness from what the app already knows: limit hits and reset hints, run
// counts and durations, and /usage where a CLI reports it (agy). Pure, unit tested.
export const WINDOW_MS = 5 * 3600e3; // most plans reset over a few hours
export const DEFAULT_CAP = 40; // runs per window before we know better
export const NEAR = 0.2;

const ts = (iso) => { const n = Date.parse(iso || ''); return Number.isFinite(n) ? n : null; };

export function runsOf(tasks = [], agent) {
  const out = [];
  for (const t of tasks) for (const r of t.runs || []) if (r.agent === agent && r.status !== 'running' && ts(r.at) !== null) out.push({ ...r, taskId: t.id });
  return out.sort((a, b) => ts(a.at) - ts(b.at));
}

// Capacity: how many runs fit in a window before past limit hits (median), else the default.
export function estimateCap(runs) {
  const caps = [];
  for (const hit of runs.filter((r) => r.status === 'limit')) {
    const at = ts(hit.at);
    const n = runs.filter((r) => ts(r.at) > at - WINDOW_MS && ts(r.at) <= at).length;
    if (n > 0) caps.push(n);
  }
  if (!caps.length) return DEFAULT_CAP;
  caps.sort((a, b) => a - b);
  return Math.max(3, caps[Math.floor(caps.length / 2)]);
}

export function budgetFor({ agent, tasks = [], agentStatus = {}, usage = {}, now = Date.now() }) {
  const runs = runsOf(tasks, agent);
  const recent = runs.filter((r) => ts(r.at) > now - WINDOW_MS);
  const hits = runs.filter((r) => r.status === 'limit');
  const st = agentStatus[agent] || {};
  const outUntil = ts(st.outUntil);
  const out = outUntil !== null && outUntil > now;
  const cap = estimateCap(runs);
  const u = usage[agent];
  let headroom;
  let source;
  if (out) { headroom = 0; source = 'limit'; }
  else if (u && Number.isFinite(u.usedPct)) { headroom = Math.max(0, Math.min(1, (100 - u.usedPct) / 100)); source = 'usage'; }
  else { headroom = Math.max(0, Math.min(1, 1 - recent.length / cap)); source = 'runs'; }
  return {
    agent,
    runs: runs.length,
    recent: recent.length,
    cap,
    limitHits: hits.length,
    lastLimitAt: hits.length ? hits[hits.length - 1].at : null,
    out,
    reset: out ? st.reason || `until ${new Date(outUntil).toISOString()}` : (u?.reset || null),
    outUntil: out ? st.outUntil : null,
    usedPct: u && Number.isFinite(u.usedPct) ? u.usedPct : null,
    ms: recent.reduce((n, r) => n + (Number(r.ms) || 0), 0),
    headroom: Math.round(headroom * 100) / 100,
    near: headroom < NEAR,
    source,
  };
}

export function budgets({ agents = [], ...rest }) {
  return Object.fromEntries(agents.map((a) => [a, budgetFor({ agent: a, ...rest })]));
}

// Most headroom first; ties keep the given order. Null when nobody has any left.
export function pickByHeadroom(candidates = [], b = {}) {
  const ranked = candidates.map((a, i) => ({ a, i, h: b[a]?.headroom ?? 1 })).filter((x) => x.h > 0).sort((x, y) => y.h - x.h || x.i - y.i);
  return ranked[0]?.a || null;
}

const LONG_WORDS = /\b(refactor|rewrite|port|migrat|overhaul|redesign|implement|build|whole|entire|all)\w*/i;
export function looksLong(task) {
  if (!task || ['docs'].includes(task.action)) return false;
  const runs = (task.runs || []).filter((r) => Number(r.ms) > 0);
  const avg = runs.length ? runs.reduce((n, r) => n + Number(r.ms), 0) / runs.length : 0;
  return avg > 20 * 60000 || String(task.description || '').length > 600 || LONG_WORDS.test(task.title || '');
}

export function nearLimitWarning(task, agent, b = {}, names = {}) {
  const x = b[agent];
  if (!x || !x.near || !looksLong(task)) return null;
  return `${names[agent] || agent} is near its usage limit (${Math.round(x.headroom * 100)}% headroom${x.reset ? `, ${x.reset}` : ''}) and T-${task.id} looks long.`;
}
