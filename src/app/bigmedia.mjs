// Big media in chat (pure, unit tested): which picture URL to show, the clear "too big" card,
// the gallery for many pictures, and its keyboard and controller keys.
// Pictures are files in the chat's media folder, shown through hearth-media:
//   hearth-media://c/<chat>/<file>  the original (streamed from disk, Range for video/audio)
//   hearth-media://t/<chat>/<file>  a small thumbnail (made once, kept on disk)
//   hearth-media://v/<chat>/<file>  a screen-sized copy (made once) for very big pictures
import { fmtBytes } from './groups.mjs';

export const SAFE_MEDIA = /^(hearth-media:\/\/[ctv]\/[A-Za-z0-9-]+\/[A-Za-z0-9%._ -]+|data:(image|video|audio)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+|blob:[a-z0-9:/.-]+)$/i;
// A message with this many pictures or more shows them as a gallery grid.
export const GALLERY_MIN = 5;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isMediaUrl = (u) => /^hearth-media:\/\/c\//.test(String(u || ''));
export const thumbUrl = (x) => (isMediaUrl(x?.url) ? x.url.replace('hearth-media://c/', 'hearth-media://t/') : x?.url || '');
// What the chat shows for a picture: the screen-sized copy when the original is very big.
export const shownUrl = (x) => (x?.view && isMediaUrl(x.url) ? x.url.replace('hearth-media://c/', 'hearth-media://v/') : x?.url || '');

// The card for anything over a limit: name, size, the limit, why, and what he can do.
// o: { name, size, limit, reason, kind, file, source, chatId, actions: ['browser','open','reveal','save','revealSource'] }
export function tooBigCard(o, icon = () => '') {
  const k = o.kind || 'file';
  const what = { html: 'Live preview', svg: 'Live preview', markdown: 'Live preview', image: 'Picture', video: 'Video', audio: 'Sound' }[k] || 'File';
  const f = esc(o.file || '');
  const n = esc(o.name || '');
  const btn = {
    browser: o.file ? `<button class="btn p" data-a="media-browser" data-f="${f}">${icon('globe', 'sm')}Open in browser</button>` : '',
    open: o.file ? `<button class="btn" data-a="media-open" data-f="${f}">Open</button>` : '',
    reveal: o.file ? `<button class="btn" data-a="media-reveal" data-f="${f}">${icon('doc', 'sm')}Show in folder</button>` : '',
    save: o.file ? `<button class="btn" data-a="media-save" data-f="${f}" data-n="${n}">${icon('dl', 'sm')}Save as…</button>` : '',
    revealSource: o.source ? `<button class="btn" data-a="media-reveal-src" data-src="${esc(o.source)}">${icon('doc', 'sm')}Show in folder</button>` : '',
  };
  const acts = (o.actions || []).map((a) => btn[a] || '').join('');
  const sizes = [o.size ? fmtBytes(o.size) : '', o.limit ? `limit ${fmtBytes(o.limit)}` : ''].filter(Boolean).join(' · ');
  return `<div class="card toobig" data-toobig="${esc(k)}"><div class="hd">${icon('flag', 'sm')}<div class="fn"><b>${n || 'This file'}</b><span class="faint">${esc(what)}${sizes ? ` · ${esc(sizes)}` : ''}</span></div><span class="grow"></span><span class="chip b">Too big to show here</span></div><p class="tb-why">${esc(o.reason || 'It is over the size the chat can show.')}</p>${acts ? `<div class="ft">${acts}</div>` : ''}</div>`;
}

// A preview stored as a file (over 1 MB): its card when it can't be shown in the panel.
export function previewTooBig(p, icon) {
  return tooBigCard({ name: p.name, size: p.size, limit: p.tooBig?.limit, reason: `Can't show it in the chat: ${p.tooBig?.reason || 'it is too big'}.`, kind: p.kind, file: p.original || null, actions: p.original ? (p.kind === 'html' || p.kind === 'svg' ? ['browser', 'reveal', 'save'] : ['open', 'reveal', 'save']) : [] }, icon);
}

// A file the AI made that couldn't be put in the chat (over the limit, or no disk space).
export function problemCard(p, icon) {
  const name = p.name || String(p.path || '').split(/[\\/]/).pop();
  const kind = /\.(png|jpe?g|gif|webp|avif)$/i.test(name) ? 'image' : /\.(mp4|webm|m4v|mov)$/i.test(name) ? 'video' : /\.(mp3|wav|ogg|m4a|flac|opus)$/i.test(name) ? 'audio' : /\.html?$/i.test(name) ? 'html' : 'file';
  return tooBigCard({ name, size: p.size, limit: p.limit, reason: `Can't put ${p.path} in the chat: ${p.reason}.`, kind, source: p.source, actions: p.source ? ['revealSource'] : [] }, icon);
}

// A picture too big to decode, or anything in m.media marked huge.
export function hugePictureCard(x, icon) {
  return tooBigCard({ name: x.name, size: x.size, reason: `${x.huge}. Open the original in your picture viewer instead.`, kind: 'image', file: x.file, actions: ['open', 'reveal', 'save'] }, icon);
}

// Every picture in a chat (newest last), for the chat's gallery.
export function galleryItems(msgs = []) {
  const out = [];
  for (const m of msgs) {
    if (!m || m.deleted) continue;
    for (const x of m.media || []) if (x && x.kind === 'image' && !x.huge && SAFE_MEDIA.test(String(x.url || ''))) out.push({ url: x.url, view: Boolean(x.view), name: x.name, file: x.file || '', size: x.size || 0, width: x.width || null, height: x.height || null, msg: m.id });
  }
  return out;
}

// The thumbnail grid: lazy, small thumbnails only (the full picture loads in the viewer).
export function galleryGrid(items, { msg = '', limit = 0 } = {}) {
  const list = limit ? items.slice(0, limit) : items;
  const more = limit && items.length > limit ? `<button class="gal-more" data-a="gallery" data-m="${esc(msg)}" data-i="${limit}">+${items.length - limit} more</button>` : '';
  return `<div class="gal" role="list">${list.map((x, i) => `<button class="gal-t" role="listitem" data-a="gallery" data-m="${esc(msg)}" data-i="${i}" title="${esc(x.name)}"><img src="${esc(thumbUrl(x))}" alt="${esc(x.name)}" loading="lazy" decoding="async" width="160" height="160"></button>`).join('')}${more}</div>`;
}

// The viewer: one full picture at a time.
export function galleryViewer(g, icon = () => '') {
  const x = g.items[g.i];
  if (!x) return '';
  const zoom = Math.max(0.25, Math.min(8, g.zoom || 1));
  const fit = zoom === 1;
  return `<div class="scrim dark lb" data-a="close-modal"></div><div class="gviewer" id="gviewer" role="dialog" aria-label="Gallery" tabindex="-1">
    <div class="gv-stage ${fit ? 'fit' : 'zoomed'}" data-a="gal-zoom-toggle"><img src="${esc(shownUrl(x))}" alt="${esc(x.name)}" decoding="async" style="${fit ? '' : `width:${Math.round(zoom * 100)}%;max-width:none;max-height:none`}"></div>
    <button class="gv-nav prev" data-a="gal-prev" aria-label="Previous picture" ${g.i === 0 ? 'disabled' : ''}>‹</button>
    <button class="gv-nav next" data-a="gal-next" aria-label="Next picture" ${g.i >= g.items.length - 1 ? 'disabled' : ''}>›</button>
    <div class="lb-bar"><span><b>${esc(x.name)}</b> <span class="faint">${g.i + 1} of ${g.items.length}${x.width ? ` · ${x.width}×${x.height}` : ''}${x.size ? ` · ${esc(fmtBytes(x.size))}` : ''}${x.view ? ' · showing a screen-sized copy' : ''}</span></span><span class="grow"></span>
      <button class="ib sm" data-a="gal-zoom" data-d="-1" title="Zoom out (-)" aria-label="Zoom out">−</button><span class="faint gv-z">${Math.round(zoom * 100)}%</span><button class="ib sm" data-a="gal-zoom" data-d="1" title="Zoom in (+)" aria-label="Zoom in">+</button>
      ${x.file ? `<button class="btn" data-a="media-save" data-f="${esc(x.file)}" data-n="${esc(x.name)}">${icon('dl', 'sm')}Save as…</button><button class="btn" data-a="media-reveal" data-f="${esc(x.file)}">${icon('doc', 'sm')}Show in folder</button>` : ''}
      <button class="btn ghost" data-a="close-modal">${icon('x', 'sm')}Close</button></div>
    <div class="fine gv-keys">← → next/previous · + − zoom · 0 fit · Esc close · controller: D-pad or LB/RB, A zoom, B close</div></div>`;
}

// Keys in the viewer -> what to do.
export function galleryKey(key) {
  return ({ ArrowRight: 'next', ArrowDown: 'next', PageDown: 'next', ' ': 'next', ArrowLeft: 'prev', ArrowUp: 'prev', PageUp: 'prev', Home: 'first', End: 'last', '+': 'in', '=': 'in', '-': 'out', _: 'out', 0: 'fit', '0': 'fit', Escape: 'close', Enter: 'toggle' })[key] || null;
}
// Standard-mapping gamepad buttons pressed since the last poll -> what to do.
export function padActions(pressed = [], before = []) {
  const now = (i) => Boolean(pressed[i]) && !before[i];
  const out = [];
  if (now(15) || now(5)) out.push('next');
  if (now(14) || now(4)) out.push('prev');
  if (now(12)) out.push('in');
  if (now(13)) out.push('out');
  if (now(0)) out.push('toggle');
  if (now(1)) out.push('close');
  return out;
}
// The viewer's state after an action (pure).
export function galleryStep(g, act) {
  const last = g.items.length - 1;
  switch (act) {
    case 'next': return { ...g, i: Math.min(last, g.i + 1), zoom: 1 };
    case 'prev': return { ...g, i: Math.max(0, g.i - 1), zoom: 1 };
    case 'first': return { ...g, i: 0, zoom: 1 };
    case 'last': return { ...g, i: last, zoom: 1 };
    case 'in': return { ...g, zoom: Math.min(8, (g.zoom || 1) * 1.5) };
    case 'out': return { ...g, zoom: Math.max(0.25, (g.zoom || 1) / 1.5) };
    case 'fit': return { ...g, zoom: 1 };
    case 'toggle': return { ...g, zoom: (g.zoom || 1) === 1 ? 2 : 1 };
    default: return g;
  }
}

// Copy progress (big files streamed into the chat): one line.
export function progressLine(p) {
  if (!p) return '';
  const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
  return `${p.fetch ? 'Downloading' : 'Copying'} ${p.name} ${p.attach ? 'to attach' : 'into the chat'}: ${fmtBytes(p.done)}${p.total ? ` of ${fmtBytes(p.total)} (${pct}%)` : ''}`;
}
