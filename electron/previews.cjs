// Live previews (artifacts). An AI makes one by writing an HTML, SVG or Markdown file into
// .hearth-preview/ in its working folder, or by a fenced block whose info string says
// "preview" (src/app/previews.mjs). The window shows them in a sandboxed iframe served
// from the hearth-preview: scheme with its own Content-Security-Policy:
// - the iframe has sandbox="allow-scripts" only (no same-origin, no popups, no top
//   navigation), so the page can't reach the app, its preload bridge or Node;
// - preloads never run in sub-frames (nodeIntegrationInSubFrames stays off);
// - network is blocked by CSP unless the owner turned on "Previews may load from the
//   internet" (Settings › Tools), checked here in the main process, not by the window.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEME = 'hearth-preview';
const DIR = '.hearth-preview';
const KINDS = { html: 'html', htm: 'html', svg: 'svg', md: 'markdown', markdown: 'markdown' };
const MAX_FILE = 1024 * 1024;
const MAX_PAGE = 6 * 1024 * 1024;

function csp(allowNet = false) {
  const net = allowNet ? ' https:' : '';
  return [
    "default-src 'none'",
    `img-src data: blob:${net}`,
    `media-src data: blob:${net}`,
    `font-src data:${net}`,
    `style-src 'unsafe-inline'${net}`,
    `script-src 'unsafe-inline'${net}`,
    `connect-src ${allowNet ? 'https:' : "'none'"}`,
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

// Files an AI wrote into .hearth-preview/ during this turn.
function collect(dir, sinceMs = 0, { max = 6 } = {}) {
  const d = path.join(String(dir || ''), DIR);
  let names = [];
  try { names = fs.readdirSync(d); } catch { return []; }
  const out = [];
  for (const name of names) {
    const kind = KINDS[path.extname(name).slice(1).toLowerCase()];
    if (!kind || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,100}$/.test(name)) continue;
    const f = path.join(d, name);
    let st;
    try { st = fs.lstatSync(f); } catch { continue; }
    if (!st.isFile() || st.size > MAX_FILE || st.mtimeMs < sinceMs - 2000) continue;
    out.push({ name, kind, content: fs.readFileSync(f, 'utf8'), at: st.mtime.toISOString(), mtime: st.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, max).map(({ mtime, ...p }) => p);
}

// Pages the window asked to show. Kept in memory only, newest 30.
function createPreviewStore() {
  const pages = new Map();
  return {
    add(html, allowNet) {
      const text = String(html || '');
      if (Buffer.byteLength(text) > MAX_PAGE) throw new Error('That preview is too big to show.');
      const id = crypto.randomBytes(8).toString('hex');
      pages.set(id, { html: text, allowNet: allowNet === true });
      while (pages.size > 30) pages.delete(pages.keys().next().value);
      return `${SCHEME}://${id}/`;
    },
    // The protocol handler: the page with its CSP as a real header.
    respond(url) {
      let id = '';
      try { id = new URL(String(url)).host; } catch {}
      const p = pages.get(id);
      if (!p) return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'Preview not found.' };
      return {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': csp(p.allowNet),
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'cache-control': 'no-store',
        },
        body: p.html,
      };
    },
    size: () => pages.size,
  };
}

module.exports = { SCHEME, DIR, KINDS, csp, collect, createPreviewStore, MAX_FILE };
