// A small, safe Markdown renderer for chat messages and Markdown previews (pure, tested).
// Everything is escaped first; only https links become links (opened outside the app).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function inline(s, { links = true } = {}) {
  let t = esc(s);
  const codes = [];
  t = t.replace(/`([^`\n]+)`/g, (_m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>');
  if (links) {
    t = t.replace(/\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]{1,500})\)/g, (_m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    t = t.replace(/(^|[\s(])(https:\/\/[^\s<)]{3,500})/g, (_m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  }
  return t.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
}

export function md(text, opts = {}) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map((l) => inline(l, opts)).join('<br>')}</p>`); para = []; } };
  while (i < lines.length) {
    const l = lines[i];
    const fence = l.match(/^```\s*([\w+-]*)/);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre class="code"><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.+)$/);
    if (h) { flush(); out.push(`<h${h[1].length + 2}>${inline(h[2], opts)}</h${h[1].length + 2}>`); i++; continue; }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      flush();
      const ordered = /^\s*\d+[.)]\s+/.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x, opts)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^>\s?/.test(l)) { flush(); const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${q.map((x) => inline(x, opts)).join('<br>')}</blockquote>`); continue; }
    if (!l.trim()) { flush(); i++; continue; }
    para.push(l);
    i++;
  }
  flush();
  return out.join('');
}

export { esc };
