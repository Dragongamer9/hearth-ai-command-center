// Cost and time per task and per AI: elapsed time, runs, retries, hand-offs, and tokens
// only where a CLI reports them. Pure, unit tested.
const ts = (iso) => { const n = Date.parse(iso || ''); return Number.isFinite(n) ? n : null; };
const OK = ['done', 'ok', 'continue'];

export function taskStats(t, now = Date.now()) {
  const runs = (t.runs || []).filter((r) => r.status !== 'running');
  let retries = 0;
  for (let i = 1; i < runs.length; i++) if (!OK.includes(runs[i - 1].status) || runs[i - 1].refused) retries++;
  const closed = ['approved', 'rejected'].includes(t.stage) ? ts(t.updatedAt) : null;
  const start = ts(t.createdAt);
  const tokens = runs.reduce((n, r) => n + (Number(r.usage?.tokens) || 0), 0);
  return {
    id: t.id,
    title: t.title,
    stage: t.stage,
    elapsedMs: start === null ? 0 : Math.max(0, (closed ?? now) - start),
    workMs: runs.reduce((n, r) => n + (Number(r.ms) || 0), 0),
    runs: runs.length,
    retries,
    handoffs: (t.handoffs || []).length,
    tokens: tokens || null,
  };
}

export function agentTotals(tasks = []) {
  const out = {};
  const row = (a) => (out[a] = out[a] || { agent: a, runs: 0, ms: 0, retries: 0, handoffsFrom: 0, handoffsTo: 0, tokens: 0, tasks: new Set() });
  for (const t of tasks) {
    const runs = (t.runs || []).filter((r) => r.status !== 'running');
    runs.forEach((r, i) => {
      const x = row(r.agent);
      x.runs++;
      x.ms += Number(r.ms) || 0;
      x.tokens += Number(r.usage?.tokens) || 0;
      x.tasks.add(t.id);
      if (i > 0 && (!OK.includes(runs[i - 1].status) || runs[i - 1].refused) && runs[i - 1].agent === r.agent) x.retries++;
    });
    for (const h of t.handoffs || []) { row(h.from).handoffsFrom++; row(h.to).handoffsTo++; }
  }
  return Object.values(out).map((x) => ({ ...x, tasks: x.tasks.size, tokens: x.tokens || null })).sort((a, b) => b.runs - a.runs);
}

export function fmtMs(ms) {
  const m = Math.round((Number(ms) || 0) / 60000);
  if (m < 1) return ms > 0 ? '<1 min' : '0 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}
