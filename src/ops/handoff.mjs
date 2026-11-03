// Automatic retry and hand-off: a run that crashed, stalled or hit a limit resumes
// from its last checkpoint on another AI with the same role. At most 2 hand-offs per
// task; after that the owner is asked. Pure, unit tested.
export const HANDOFF_KINDS = ['limit', 'stalled', 'failed', 'timeout', 'outage'];
export const MAX_HANDOFFS = 2;
export const REASON = { limit: 'ran out of usage', stalled: 'stalled (no output or file changes)', failed: 'crashed', timeout: 'ran too long and was stopped', outage: 'its provider is having problems' };

// candidates: AIs that can run now and have the same kind of role (caller filters).
export function decideHandoff({ task, from, kind, candidates = [], budgets = {}, autoHandoff = true }) {
  if (!task || !HANDOFF_KINDS.includes(kind) || autoHandoff === false) return { action: 'none' };
  const done = task.handoffs || [];
  if (done.length >= MAX_HANDOFFS) return { action: 'ask', reason: `T-${task.id} was already handed off ${done.length} times` };
  const tried = new Set(done.flatMap((h) => [h.from, h.to]));
  const pool = candidates
    .filter((a) => a !== from && a !== task.reviewer && (budgets[a]?.headroom ?? 1) > 0)
    .map((a, i) => ({ a, i, tried: tried.has(a) ? 1 : 0, h: budgets[a]?.headroom ?? 1 }))
    .sort((x, y) => x.tried - y.tried || y.h - x.h || x.i - y.i);
  if (!pool.length) return { action: 'none' };
  return { action: 'handoff', to: pool[0].a, record: { from, to: pool[0].a, kind, n: done.length + 1 } };
}

// Owner's card after the cap: hand to someone else, or leave it.
export function askCard(task, from, kind, options = []) {
  return {
    id: `HO${task.id}`.slice(0, 12),
    type: 'handoff',
    taskId: task.id,
    status: 'pending',
    text: `T-${task.id} “${task.title}” ${REASON[kind] || kind} again after ${MAX_HANDOFFS} hand-offs. Who should continue it?`,
    options: [...options.map((a) => ({ value: `to:${a}`, label: a })), { value: 'leave', label: 'Leave it with me' }],
  };
}
