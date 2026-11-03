// Assign by strength: outcomes per AI and task kind (review approvals vs changes
// requested, app test pass rate, time taken) and a suggested builder + reviewer for a
// new task. Never the same AI for both. Pure, unit tested.
export const KINDS = ['code', 'review', 'docs', 'ui', 'tests'];

export function inferKind(task = {}) {
  const text = `${(task.labels || []).join(' ')} ${task.title || ''}`.toLowerCase();
  if (/\b(tests?|specs?|coverage|unit test|e2e|ci)\b/.test(text)) return 'tests';
  if (/\b(ui|ux|page|layout|css|style|theme|screen|dialog|button|icon|menu|panel|animation|look)\b/.test(text)) return 'ui';
  if (task.action === 'docs' || /\b(docs?|readme|guide|documentation|research|notes|write-?up)\b/.test(text)) return 'docs';
  if (/\b(review|audit)\b/.test(text)) return 'review';
  return 'code';
}

const blank = () => ({ runs: 0, ms: 0, passed: 0, failed: 0, approved: 0, changes: 0, ciFailed: 0, reviewsGiven: 0 });

// tasks: board tasks (runs carry agent, ms and the app's test result);
// log: state.opsLog events { ev: 'verdict', builder, reviewer, verdict, kind } and
// { ev: 'ci', author, ok, kind }.
export function outcomes(tasks = [], log = []) {
  const out = {};
  const cell = (a, k) => { out[a] = out[a] || {}; out[a][k] = out[a][k] || blank(); return out[a][k]; };
  for (const t of tasks) {
    const k = inferKind(t);
    for (const r of t.runs || []) {
      if (!r.agent || r.status === 'running') continue;
      const c = cell(r.agent, k);
      c.runs++;
      c.ms += Number(r.ms) || 0;
      if (r.appTests === 'passed') c.passed++;
      if (r.appTests === 'failed') c.failed++;
    }
  }
  for (const e of log) {
    if (e.ev === 'verdict' && e.builder) {
      const c = cell(e.builder, e.kind || 'code');
      if (e.verdict === 'approve') c.approved++; else c.changes++;
      if (e.reviewer) cell(e.reviewer, 'review').reviewsGiven++;
    }
    if (e.ev === 'ci' && e.author && e.ok === false) cell(e.author, e.kind || 'code').ciFailed++;
  }
  return out;
}

export function score(c = blank()) {
  const approval = (c.approved + 1) / (c.approved + c.changes + 2);
  const pass = (c.passed + 1) / (c.passed + c.failed + 2);
  const avgMin = c.runs ? c.ms / c.runs / 60000 : 0;
  const speed = c.runs && c.ms ? 1 / (1 + avgMin / 30) : 0.5;
  return Math.round((0.45 * approval + 0.4 * pass + 0.15 * speed - Math.min(0.15, 0.03 * c.ciFailed)) * 1000) / 1000;
}

const headroomOf = (b, a) => (b?.[a]?.headroom ?? 1);

export function suggest({ task = {}, builders = [], reviewers = [], stats = {}, budgets = {} }) {
  const kind = inferKind(task);
  const rank = (list, val) => list.map((a, i) => ({ a, i, v: val(a) })).filter((x) => headroomOf(budgets, x.a) > 0).sort((x, y) => y.v - x.v || x.i - y.i);
  const b = rank(builders, (a) => score(stats[a]?.[kind]) * (0.5 + 0.5 * headroomOf(budgets, a)))[0]?.a || builders[0] || null;
  const r = rank(reviewers.filter((a) => a !== b), (a) => {
    const g = stats[a]?.review?.reviewsGiven || 0;
    return ((g + 1) / (g + 3)) * (0.5 + 0.5 * headroomOf(budgets, a));
  })[0]?.a || reviewers.find((a) => a !== b) || null;
  const why = b ? `Best ${kind} record${stats[b]?.[kind]?.runs ? ` (${stats[b][kind].runs} runs)` : ''} and ${Math.round(headroomOf(budgets, b) * 100)}% headroom` : 'No AI is free';
  return { kind, builder: b, reviewer: r, why };
}
