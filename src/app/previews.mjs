// Live previews (pure, unit tested). The convention the AIs are told about:
//   1. a file in .hearth-preview/ of their working folder (name.html, name.svg, name.md), or
//   2. a fenced block whose info string is "<html|svg|markdown> preview <name>":
//        ```html preview storage-page.html
//        <!doctype html> …
//        ```
// Previews render in an iframe with sandbox="allow-scripts" only (never allow-same-origin),
// served from hearth-preview: with a CSP that blocks the network unless the owner allows it.
import { md } from './text.mjs';

const FENCE = /^```[ \t]*(html|svg|markdown|md)[ \t]+preview(?:[ \t]+([^\n`]{1,100}))?[ \t]*\n([\s\S]*?)\n```[ \t]*$/gim;
const EXT = { html: 'html', svg: 'svg', markdown: 'md', md: 'md' };
const KIND = { html: 'html', svg: 'svg', markdown: 'markdown', md: 'markdown' };
export const SANDBOX = 'allow-scripts';
export const PREVIEW_DIR = '.hearth-preview';

const cleanName = (n, kind, i) => {
  const s = String(n || '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(0, 80);
  const ext = EXT[kind === 'markdown' ? 'md' : kind];
  if (!s) return `preview-${i + 1}.${ext}`;
  return /\.[A-Za-z0-9]{1,8}$/.test(s) ? s : `${s}.${ext}`;
};

// Pull preview blocks out of a reply; the text keeps a short note where each one was.
export function extractPreviews(text) {
  const previews = [];
  const out = String(text || '').replace(FENCE, (_m, lang, name, body) => {
    const kind = KIND[lang.toLowerCase()];
    const p = { name: cleanName(name, kind, previews.length), kind, content: body.slice(0, 1024 * 1024) };
    previews.push(p);
    return `*(Live preview: ${p.name})*`;
  });
  return { text: out, previews };
}

export function kindOf(name) {
  const e = String(name || '').split('.').pop().toLowerCase();
  return e === 'svg' ? 'svg' : e === 'md' || e === 'markdown' ? 'markdown' : 'html';
}

export function cspMeta(allowNet = false) {
  const net = allowNet ? ' https:' : '';
  return `default-src 'none'; img-src data: blob:${net}; media-src data: blob:${net}; font-src data:${net}; style-src 'unsafe-inline'${net}; script-src 'unsafe-inline'${net}; connect-src ${allowNet ? 'https:' : "'none'"}; frame-src 'none'; form-action 'none'; base-uri 'none'`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The full document shown in the frame. The CSP is also set as a meta tag (the
// hearth-preview: scheme sends it as a header too).
export function previewDoc({ kind, content, name = '', allowNet = false, dark = true }) {
  const meta = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${cspMeta(allowNet)}"><meta name="viewport" content="width=device-width,initial-scale=1">`;
  if (kind === 'svg') return `<!doctype html><html><head>${meta}<title>${esc(name)}</title><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:${dark ? '#151311' : '#fff'}}svg{max-width:100%;max-height:100vh}</style></head><body>${String(content || '').replace(/<script[\s\S]*?<\/script>/gi, '')}</body></html>`;
  if (kind === 'markdown') return `<!doctype html><html><head>${meta}<title>${esc(name)}</title><style>body{font:15px/1.6 system-ui,sans-serif;max-width:760px;margin:28px auto;padding:0 20px;color:${dark ? '#e9e2d7' : '#2d2822'};background:${dark ? '#1d1a17' : '#fffdf9'}}code,pre{font-family:ui-monospace,monospace;background:${dark ? '#26221e' : '#f1ece3'};border-radius:6px}pre{padding:12px;overflow:auto}code{padding:1px 4px}a{color:#ec7552}h1,h2,h3{line-height:1.25}</style></head><body>${md(content, { links: false })}</body></html>`;
  const html = String(content || '');
  // Put the CSP first in <head> (a page can only add restrictions after it, never lift them).
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (h) => `${h}${meta}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (h) => `${h}<head>${meta}</head>`);
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

// The iframe for a preview: never same-origin, never popups or top navigation.
export function frameHtml({ url = null, srcdoc = null, title = 'Live preview' }) {
  const src = url && /^hearth-preview:\/\/[a-f0-9]{16}\/$/.test(url) ? `src="${esc(url)}"` : `srcdoc="${esc(srcdoc || '')}"`;
  return `<iframe class="pv-frame" title="${esc(title)}" sandbox="${SANDBOX}" referrerpolicy="no-referrer" ${src}></iframe>`;
}
