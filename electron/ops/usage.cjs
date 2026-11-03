// Usage as a CLI reports it (agy answers `/usage`). Only numbers the tool states.
function parseUsage(text) {
  const s = String(text || '');
  let usedPct = null;
  let m = s.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:of\s+\w+\s+)?(used|consumed)/i);
  if (m) usedPct = Number(m[1]);
  else if ((m = s.match(/\b(?:used|consumed)\s+(\d{1,3}(?:\.\d+)?)\s*%/i))) usedPct = Number(m[1]);
  else if ((m = s.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(remaining|left|available)/i))) usedPct = 100 - Number(m[1]);
  else if ((m = s.match(/(\d[\d,]*)\s*(?:\/|of)\s*(\d[\d,]*)\s*(requests|credits|tokens|messages)?\s*(used)?/i))) {
    const a = Number(m[1].replace(/,/g, ''));
    const b = Number(m[2].replace(/,/g, ''));
    if (b > 0 && a <= b) usedPct = Math.round((a / b) * 1000) / 10;
  }
  const r = s.match(/(resets?|renews?)\s+((?:at|in|on)\s+)?([^.\n|"]{1,40})/i);
  if (usedPct !== null && (usedPct < 0 || usedPct > 100)) usedPct = null;
  return { usedPct, reset: r ? `${r[1]} ${(r[2] || '').trim()} ${r[3]}`.replace(/\s+/g, ' ').trim() : null };
}

// Claude Code's JSON result reports tokens and cost; other tools don't.
function claudeUsage(raw) {
  const u = raw && typeof raw === 'object' ? raw.usage : null;
  if (!u) return null;
  const tokens = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((n, k) => n + (Number(u[k]) || 0), 0);
  return { tokens, costUsd: Number.isFinite(Number(raw.total_cost_usd)) ? Number(raw.total_cost_usd) : null };
}

module.exports = { parseUsage, claudeUsage };
