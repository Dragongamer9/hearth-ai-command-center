// Present the same availability used by scheduling without claiming that a
// provider's quota has reset when only the app's retry window is known.
export function teamPresence(status, out) {
  if (out) {
    const until = new Date(out.outUntil);
    return { text: 'Out of usage', cls: 'bad', detail: `Retry after ${until.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} (estimated)${out.reason ? ` · ${out.reason}` : ''}` };
  }
  if (status.live) return { ...status, text: 'Busy', detail: status.text };
  const labels = {
    linked: 'Ready', 'linked (API key)': 'Ready', running: 'Ready',
    'signed out': 'Needs sign-in', 'needs sign-in': 'Needs sign-in',
    'installed · hands-on': 'Hands-on only',
    'installed · sign-in not checkable': 'Sign-in unknown',
  };
  return { ...status, text: labels[status.text] || status.text };
}
