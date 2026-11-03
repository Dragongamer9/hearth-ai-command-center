// "While you were away": what each AI did since the owner last looked, built from the
// audit log and the board (not by an AI). Pure, unit tested.
const after = (iso, since) => String(iso || '') > String(since || '');

export function buildSummary({ audit = [], tasks = [], permissions = [], cards = [], since = '', now = new Date().toISOString(), agents = [] }) {
  const events = audit.filter((e) => after(e.at, since));
  const title = (id) => tasks.find((t) => t.id === id)?.title || '';
  const per = Object.fromEntries(agents.map((a) => [a, { agent: a, finished: 0, done: 0, reviews: 0, merges: 0, handoffs: 0, failures: 0, runs: 0, ms: 0, limits: 0, tokens: 0 }]));
  const row = (a) => (a && per[a]) || null;
  const failed = [];
  let merges = 0;
  for (const e of events) {
    const r = row(e.actor);
    const ev = String(e.event || '');
    if (/ finished a run$/.test(ev) && r) r.finished++;
    if (/ reviewed$/.test(ev) && r) r.reviews++;
    if (/merged/i.test(ev)) { merges++; if (r) r.merges++; }
    if (/^Hand-off/.test(ev) && r) r.handoffs++; // actor = the AI that stopped
    if (/ stopped \(|^Done report refused$|^Tests failed$|^CI failed$/.test(ev)) {
      if (r) r.failures++;
      failed.push({ taskId: e.taskId, title: title(e.taskId), what: ev, detail: String(e.detail || '').slice(0, 200), at: e.at, actor: e.actor });
    }
  }
  for (const t of tasks) {
    for (const run of t.runs || []) {
      const r = row(run.agent);
      if (!r || !after(run.at, since) || run.status === 'running') continue;
      r.runs++;
      r.ms += Number(run.ms) || 0;
      r.tokens += Number(run.usage?.tokens) || 0;
      if (run.status === 'limit') r.limits++;
    }
    if (t.done && after(t.done.at, since) && row(t.done.by)) row(t.done.by).done++;
  }
  const waiting = {
    approvals: tasks.filter((t) => t.stage === 'approval').map((t) => ({ id: t.id, title: t.title, assignee: t.assignee })),
    permissions: permissions.filter((p) => p.status === 'pending').map((p) => ({ id: p.id, agent: p.agent, kind: p.kind, what: p.what })),
    cards: cards.filter((c) => c.status === 'pending').map((c) => ({ id: c.id, text: c.text })),
  };
  const list = Object.values(per).filter((r) => r.finished || r.done || r.reviews || r.merges || r.handoffs || r.failures || r.runs);
  return {
    since,
    until: now,
    agents: list,
    waiting,
    waitingCount: waiting.approvals.length + waiting.permissions.length + waiting.cards.length,
    failed: failed.slice(0, 30),
    totals: {
      runs: list.reduce((n, r) => n + r.runs, 0),
      ms: list.reduce((n, r) => n + r.ms, 0),
      done: list.reduce((n, r) => n + r.done, 0),
      reviews: list.reduce((n, r) => n + r.reviews, 0),
      merges,
      tokens: list.reduce((n, r) => n + r.tokens, 0),
      failures: failed.length,
    },
    quiet: !events.length && !list.length,
  };
}
