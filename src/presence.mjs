// The team status panel above the chat (pure helpers, unit tested).

// One short state per AI, from the same status line the rest of the app uses.
// Usage pauses show the app's retry estimate, never a promised reset time.
export function panelState(status, out = null) {
  if (out) {
    const when = new Date(out.outUntil).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return { text: 'Out of usage', cls: 'bad', detail: `until about ${when} (estimate)${out.reason ? ` · ${out.reason}` : ''}` };
  }
  if (status.live) return { text: 'Busy', cls: 'accent', live: true, detail: status.text };
  const ready = ['linked', 'linked (API key)', 'running'];
  if (ready.includes(status.text)) return { text: 'Ready', cls: 'good' };
  if (['signed out', 'needs sign-in'].includes(status.text)) return { text: 'Needs sign-in', cls: 'warn' };
  return { text: status.text, cls: status.cls || '' };
}

// Status from a saved sign-in hold. A saved key that was refused reads
// "API key rejected" (never "Ready") until the key or sign-in changes.
export function holdStatus(hold, hasKey = false) {
  if (!hold?.badge) return null;
  const text = hold.badge === 'needs API key' && hasKey ? 'API key rejected' : hold.badge;
  return { text, cls: 'warn' };
}

// The result line under an API key field (updated in place, never a full redraw).
export function keyTestLine(test, esc = (x) => String(x)) {
  if (test?.busy) return '<div class="note">Testing the saved key…</div>';
  const r = test?.result;
  if (!r) return '';
  return `<div class="note ${r.ok ? '' : 'err'}">${esc(r.ok ? 'Connection successful.' : r.error?.message || 'The connection test failed.')}</div>`;
}
