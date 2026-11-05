// Rich answers in chat (pure, unit tested in Node; DOMPurify adds a second pass in the window).
// - Markdown (GitHub flavour: tables, task lists, strikethrough) through the bundled marked.
// - Raw HTML from an AI is never rendered: it is shown as text.
// - Links: https only, opened outside the app. Pictures: only the app's own hearth-media:
//   files (and small data: pictures); a picture on the web shows a "Load picture" button
//   that fetches it into the app's media folder first (never a direct web request).
// - Code: syntax highlighting (bundled highlight.js) with a Copy button.
// - Math: $…$, $$…$$, \(…\) and \[…\] through the bundled KaTeX (trust off).
// - ```chart blocks (JSON) become a simple SVG chart drawn here from numbers only.
// - ```mermaid blocks become a placeholder; the window draws them in a sandboxed frame.
import { Marked } from '../vendor/marked/marked.esm.js';
import katex from '../vendor/katex/katex.mjs';
import hljs from '../vendor/highlight/highlight.min.js';
import DOMPurify from '../vendor/dompurify/purify.es.mjs';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const b64 = (s) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'));

const SAFE_IMG = /^(hearth-media:\/\/c\/[A-Za-z0-9-]+\/[A-Za-z0-9%._ -]+|data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+)$/;
const SAFE_LINK = /^(https:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+)$/i;

function tex(src, display) {
  try {
    return katex.renderToString(String(src), { displayMode: display, throwOnError: false, trust: false, strict: 'ignore', output: 'htmlAndMathml', maxSize: 50, maxExpand: 500 });
  } catch { return `<code>${esc(src)}</code>`; }
}

// ---- simple charts from a JSON block ----
const PALETTE = ['#e07a52', '#4b8fd0', '#59a96a', '#c9a227', '#9b6bd2', '#d04b7a'];
export function chartSvg(spec) {
  let s = spec;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch { return null; } }
  if (!s || typeof s !== 'object') return null;
  const type = ['bar', 'line', 'pie'].includes(s.type) ? s.type : 'bar';
  const labels = (Array.isArray(s.labels) ? s.labels : []).slice(0, 40).map((l) => String(l).slice(0, 24));
  const series = (Array.isArray(s.series) ? s.series : []).slice(0, 6).map((x, i) => ({ name: String(x?.name || `Series ${i + 1}`).slice(0, 40), data: (Array.isArray(x?.data) ? x.data : []).slice(0, labels.length || 40).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)) })).filter((x) => x.data.length);
  if (!series.length) return null;
  const n = Math.max(labels.length, ...series.map((x) => x.data.length));
  const W = 560; const H = 280; const L = 46; const B = 40; const T = s.title ? 30 : 12; const R = 12;
  const title = s.title ? `<text x="${W / 2}" y="18" text-anchor="middle" class="ct">${esc(String(s.title).slice(0, 80))}</text>` : '';
  const legend = series.length > 1 || type === 'pie' ? series.map((x, i) => `<tspan fill="${PALETTE[i % 6]}">■</tspan> ${esc(x.name)}`).join('   ') : '';
  if (type === 'pie') {
    const data = series[0].data.map((v) => Math.max(0, v));
    const total = data.reduce((a, b) => a + b, 0) || 1;
    let a0 = -Math.PI / 2;
    const cx = W / 2; const cy = (H + T) / 2; const r = Math.min(W, H - T) / 2 - 16;
    const parts = data.map((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = data.length === 1 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PALETTE[i % 6]}"/>` : `<path d="M${cx},${cy} L${(cx + r * Math.cos(a0)).toFixed(1)},${(cy + r * Math.sin(a0)).toFixed(1)} A${r},${r} 0 ${large} 1 ${(cx + r * Math.cos(a1)).toFixed(1)},${(cy + r * Math.sin(a1)).toFixed(1)} Z" fill="${PALETTE[i % 6]}"><title>${esc(labels[i] || '')}: ${v}</title></path>`;
      a0 = a1;
      return p;
    }).join('');
    const keys = labels.slice(0, data.length).map((l, i) => `<tspan fill="${PALETTE[i % 6]}">■</tspan> ${esc(l)}`).join('   ');
    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H + 24}" role="img" aria-label="${esc(s.title || 'Chart')}">${title}${parts}<text x="${W / 2}" y="${H + 16}" text-anchor="middle" class="cl">${keys}</text></svg>`;
  }
  const all = series.flatMap((x) => x.data);
  const max = Math.max(0, ...all); const min = Math.min(0, ...all);
  const span = max - min || 1;
  const y = (v) => T + (H - T - B) * (1 - (v - min) / span);
  const step = (W - L - R) / n;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + span * f);
  const fmt = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v * 100) / 100);
  const grid = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="cg"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="cl">${fmt(v)}</text>`).join('');
  const xl = labels.map((l, i) => `<text x="${(L + step * (i + 0.5)).toFixed(1)}" y="${H - B + 16}" text-anchor="middle" class="cl">${esc(n > 12 ? l.slice(0, 6) : l)}</text>`).join('');
  let marks = '';
  if (type === 'bar') {
    const bw = (step * 0.8) / series.length;
    marks = series.map((x, si) => x.data.map((v, i) => { const x0 = L + step * i + step * 0.1 + bw * si; const y0 = y(Math.max(v, 0)); const h = Math.abs(y(v) - y(0)); return `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${PALETTE[si % 6]}" rx="2"><title>${esc(labels[i] || '')}: ${v}</title></rect>`; }).join('')).join('');
  } else {
    marks = series.map((x, si) => `<polyline fill="none" stroke="${PALETTE[si % 6]}" stroke-width="2.5" points="${x.data.map((v, i) => `${(L + step * (i + 0.5)).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>${x.data.map((v, i) => `<circle cx="${(L + step * (i + 0.5)).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${PALETTE[si % 6]}"><title>${esc(labels[i] || '')}: ${v}</title></circle>`).join('')}`).join('');
  }
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H + (legend ? 20 : 0)}" role="img" aria-label="${esc(s.title || 'Chart')}">${title}${grid}${marks}${xl}${legend ? `<text x="${W / 2}" y="${H + 12}" text-anchor="middle" class="cl">${legend}</text>` : ''}</svg>`;
}

// ---- math as marked extensions ----
const mathBlock = {
  name: 'mathBlock',
  level: 'block',
  start(src) { const m = src.match(/\$\$|\\\[/); return m ? m.index : undefined; },
  tokenizer(src) {
    const m = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src) || /^\\\[([\s\S]+?)\\\][ \t]*(?:\n|$)/.exec(src);
    if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
    return undefined;
  },
  renderer(t) { return `<div class="math">${tex(t.text, true)}</div>`; },
};
const mathInline = {
  name: 'mathInline',
  level: 'inline',
  start(src) { const m = src.match(/\$|\\\(/); return m ? m.index : undefined; },
  tokenizer(src) {
    let m = /^\$\$([^$]+?)\$\$/.exec(src);
    if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: true };
    m = /^\$(?![\s$])([^$\n]{1,400}?)(?<![\s\\])\$(?![\d$])/.exec(src);
    if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: false };
    m = /^\\\(([\s\S]{1,400}?)\\\)/.exec(src);
    if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: false };
    return undefined;
  },
  renderer(t) { return tex(t.text, t.display); },
};

function makeMarked() {
  const marked = new Marked({ gfm: true, breaks: true, async: false });
  marked.use({
    extensions: [mathBlock, mathInline],
    renderer: {
      // Raw HTML in an answer is shown as text, never rendered.
      html({ text }) { return esc(text); },
      link({ href, title, tokens }) {
        const label = this.parser.parseInline(tokens);
        const h = String(href || '').trim();
        if (!SAFE_LINK.test(h)) return label;
        return `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${esc(title)}"` : ''}>${label}</a>`;
      },
      image({ href, text }) {
        const h = String(href || '').trim();
        if (SAFE_IMG.test(h)) return `<img class="md-img" src="${esc(h)}" alt="${esc(text || '')}" data-a="lightbox" data-src="${esc(h)}">`;
        if (/^https:\/\//i.test(h)) return `<button class="remote-img" data-a="load-remote" data-url="${esc(h)}" title="${esc(h)}">Load picture${text ? `: ${esc(text)}` : ''} <span class="faint">(${esc(hostOf(h))})</span></button>`;
        return text ? `<span class="faint">[picture: ${esc(text)}]</span>` : '';
      },
      code({ text, lang }) {
        const l = String(lang || '').trim().split(/\s+/)[0].toLowerCase();
        if (l === 'mermaid') return `<div class="mermaid-box" data-src="${esc(b64(text))}"><pre class="code"><code>${esc(text)}</code></pre></div>`;
        if (l === 'chart') { const svg = chartSvg(text); if (svg) return `<figure class="chart">${svg}</figure>`; }
        let body = esc(text);
        if (l && hljs.getLanguage(l)) { try { body = hljs.highlight(text, { language: l, ignoreIllegals: true }).value; } catch {} }
        return `<div class="codeblock"><div class="cb-hd"><span>${esc(l || 'text')}</span><button class="mini" data-a="copy-code">Copy</button></div><pre class="code"><code class="hljs">${body}</code></pre></div>`;
      },
    },
  });
  return marked;
}

let M = null;
const PURIFY = {
  ALLOWED_URI_REGEXP: /^(?:https:|mailto:|hearth-media:|data:image\/(?:png|jpeg|gif|webp);base64,|#)/i,
  ADD_ATTR: ['target', 'data-a', 'data-src', 'data-url'],
  FORBID_TAGS: ['style', 'form', 'input', 'textarea', 'select', 'iframe', 'object', 'embed', 'script'],
  FORBID_ATTR: ['style'],
};
// KaTeX's own markup needs its inline sizes; it is made from math text by the library, never by the AI.
const PURIFY_MATH = { ...PURIFY, FORBID_ATTR: [] };

export function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }

// Markdown to safe HTML for the window.
export function rich(text) {
  if (!M) M = makeMarked();
  let html = '';
  try { html = M.parse(String(text ?? '').replace(/\r\n/g, '\n')); } catch { html = `<p>${esc(text)}</p>`; }
  html = html.replace(/<table>/g, '<div class="tbl-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  if (DOMPurify && DOMPurify.isSupported) html = DOMPurify.sanitize(html, /class="katex/.test(html) ? PURIFY_MATH : PURIFY);
  return html;
}

// Web links an answer used: the pages the AI read (steps) and the links in its text.
export function sourcesOf({ text = '', steps = [], max = 12 } = {}) {
  const out = [];
  const seen = new Set();
  const add = (u, title = '') => {
    const s = String(u || '').replace(/[).,;:'"\]]+$/, '');
    if (!/^https:\/\/[^\s<>"']{4,}$/i.test(s) || seen.has(s) || out.length >= max) return;
    seen.add(s);
    out.push({ url: s, host: hostOf(s), title: String(title || '').slice(0, 120) });
  };
  for (const st of steps || []) if (st && /^https:/.test(String(st.url || ''))) add(st.url, st.detail);
  for (const m of String(text).matchAll(/\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]{3,500})\)/g)) add(m[2], m[1]);
  for (const m of String(text).matchAll(/(^|[\s(<\[])(https:\/\/[^\s<>)\]]{3,500})/g)) add(m[2]);
  return out;
}

// Text for reading aloud and for copying as plain words.
export function plainText(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, ' (code) ').replace(/\$\$[\s\S]*?\$\$/g, ' (formula) ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' link ').replace(/[#*_`>|]/g, ' ').replace(/\s+/g, ' ').trim();
}
