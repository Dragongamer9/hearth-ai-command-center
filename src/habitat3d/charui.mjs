// Habitat 3D (2.4): the Characters page. The 12 ready-made originals (Give to…),
// who plays whom, and the creator with a live preview. Plain HTML; saving goes back
// through the view's savePrefs (the settings helpers), never from here.
import { HAIR, ACCESSORIES, EXPRESSIONS, HAIR_COLORS, EYE_COLORS, SKINS, OUTFITS, ROSTER, normChar, randomChar, outfitColors } from './castlemap.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// A small flat chibi in SVG for the cards and the creator's live preview.
export function chibiSvg(raw, size = 120) {
  const c = normChar(raw); const o = outfitColors(c); const h = c.hairColor;
  const back = c.hair === 'long' ? `<rect x="28" y="40" width="64" height="62" rx="24" fill="${h}"/>`
    : c.hair === 'pony' ? `<path d="M86 42 q22 18 6 56 q-8 -24 -14 -40z" fill="${h}"/>`
      : c.hair === 'twin' ? `<ellipse cx="22" cy="66" rx="10" ry="22" fill="${h}"/><ellipse cx="98" cy="66" rx="10" ry="22" fill="${h}"/>` : '';
  const top = c.hair === 'spiky' ? `<path d="M26 52 l6 -26 l10 14 l8 -22 l10 18 l10 -20 l8 22 l10 -14 l6 28z" fill="${h}"/>`
    : c.hair === 'bob' ? `<path d="M24 64 q0 -40 36 -40 q36 0 36 40 v16 h-10 v-26 h-52 v26 h-10z" fill="${h}"/>`
      : `<path d="M26 60 q0 -36 34 -36 q34 0 34 36 q-14 -12 -34 -12 q-20 0 -34 12z" fill="${h}"/>`;
  const mouth = c.expression === 'happy' ? '<path d="M53 80 q7 8 14 0z" fill="#c0563f"/>'
    : c.expression === 'focused' ? '<path d="M54 82 h12" stroke="#2a2230" stroke-width="2.5" stroke-linecap="round"/>'
      : c.expression === 'calm' ? '<path d="M54 81 q6 3 12 0" stroke="#2a2230" stroke-width="2.5" fill="none" stroke-linecap="round"/>'
        : '<path d="M53 80 q7 6 14 0" stroke="#2a2230" stroke-width="2.5" fill="none" stroke-linecap="round"/>';
  const eye = (x) => c.expression === 'happy' ? `<path d="M${x - 6} 68 q6 -7 12 0" stroke="#2a2230" stroke-width="3" fill="none" stroke-linecap="round"/>`
    : `<ellipse cx="${x}" cy="68" rx="6.5" ry="8.5" fill="#2a2230"/><ellipse cx="${x}" cy="69.5" rx="4.6" ry="6.2" fill="${c.eyes}"/><circle cx="${x - 2}" cy="65.5" r="2" fill="#fff"/><circle cx="${x + 2}" cy="72" r="1" fill="#fff"/>`;
  const acc = c.accessory === 'glasses' ? '<g fill="none" stroke="#2a2230" stroke-width="2"><circle cx="47" cy="68" r="9"/><circle cx="73" cy="68" r="9"/><path d="M56 68 h8"/></g>'
    : c.accessory === 'catears' ? `<path d="M30 40 l4 -20 l14 12z M90 40 l-4 -20 l-14 12z" fill="${h}" stroke="#2a2230" stroke-width="2"/>`
      : c.accessory === 'headphones' ? '<path d="M24 64 q0 -44 36 -44 q36 0 36 44" fill="none" stroke="#3a3f55" stroke-width="5"/><rect x="18" y="58" width="12" height="18" rx="5" fill="#ec7552"/><rect x="90" y="58" width="12" height="18" rx="5" fill="#ec7552"/>'
        : c.accessory === 'ribbon' ? '<path d="M76 30 l14 -10 v20z M76 30 l-14 -10 v20z" fill="#e0607e" stroke="#2a2230" stroke-width="1.5"/>' : '';
  return `<svg class="hab3d-chibi" viewBox="0 0 120 156" width="${size}" height="${Math.round(size * 1.3)}" role="img" aria-label="${esc(c.name || 'Character')}">`
    + `${back}<path d="M36 104 q24 -14 48 0 l6 40 h-60z" fill="${o.outfit}" stroke="#2a2230" stroke-width="2.5"/><rect x="34" y="124" width="52" height="7" fill="${o.trim}"/>`
    + `<circle cx="60" cy="64" r="34" fill="${c.skin}" stroke="#2a2230" stroke-width="2.5"/>${top}${eye(47)}${eye(73)}`
    + '<ellipse cx="40" cy="80" rx="5" ry="3" fill="#ff8fb1" opacity=".5"/><ellipse cx="80" cy="80" rx="5" ry="3" fill="#ff8fb1" opacity=".5"/>'
    + `${mouth}${acc}</svg>`;
}

const opts = (list, val, label = cap) => list.map((v) => `<option value="${esc(v)}"${v === val ? ' selected' : ''}>${esc(label(v))}</option>`).join('');
const swatches = (field, list, val) => `<div class="hab3d-sw" role="radiogroup">${list.map((c) => `<button type="button" class="hab3d-swb${c === val ? ' on' : ''}" data-cf="${field}" data-v="${c}" style="background:${c}" aria-label="${field} ${c}" aria-pressed="${c === val}"></button>`).join('')}</div>`;

// state: { tab: 'roster' | 'creator', draft, who }
export function charactersPanel({ people = [], chars = {}, raids = {}, state = {} }) {
  const tab = state.tab || 'roster';
  const who = state.who || people[1]?.[0] || 'owner';
  const draft = normChar(state.draft || chars[who] || ROSTER[0]);
  const giveTo = (i) => `<select class="hab3d-give" data-ri="${i}" aria-label="Give ${esc(ROSTER[i].name)} to"><option value="">Give to…</option>${people.map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join('')}</select>`;
  const cast = people.map(([id, n]) => `<li><span class="hab3d-mini">${chibiSvg(chars[id], 40)}</span><b>${esc(n)}</b> plays <i>${esc(chars[id]?.name || '—')}</i>${id !== 'owner' ? ` <small>· raiders defeated: ${Number(raids[id]) || 0}</small>` : ''}</li>`).join('');
  const roster = `<div class="hab3d-roster">${ROSTER.map((r, i) => `<figure class="hab3d-card">${chibiSvg(r, 96)}<figcaption><b>${esc(r.name)}</b><small>${esc(r.role)}</small>${giveTo(i)}</figcaption></figure>`).join('')}</div><h4>Who plays whom</h4><ul class="hab3d-cast">${cast}</ul>`;
  const creator = `<div class="hab3d-creator"><div class="hab3d-preview">${chibiSvg(draft, 180)}</div><form class="hab3d-cform" onsubmit="return false">
    <label>Name <input data-cf="name" maxlength="24" value="${esc(draft.name)}"></label>
    <label>For <select data-cf="who">${people.map(([id, n]) => `<option value="${esc(id)}"${id === who ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    <label>Hair <select data-cf="hair">${opts(HAIR, draft.hair)}</select></label>
    <span class="hab3d-flabel">Hair colour</span>${swatches('hairColor', HAIR_COLORS, draft.hairColor)}
    <span class="hab3d-flabel">Eyes</span>${swatches('eyes', EYE_COLORS, draft.eyes)}
    <span class="hab3d-flabel">Skin</span>${swatches('skin', SKINS, draft.skin)}
    <label>Outfit <select data-cf="outfit">${opts(Object.keys(OUTFITS), draft.outfit, (k) => OUTFITS[k].label)}</select></label>
    <label>Accessory <select data-cf="accessory">${opts(ACCESSORIES, draft.accessory, (a) => (a === 'catears' ? 'Cat ears' : cap(a)))}</select></label>
    <label>Expression <select data-cf="expression">${opts(EXPRESSIONS, draft.expression)}</select></label>
    <div class="hab3d-cact"><button type="button" class="btn" data-ca="surprise">Surprise me</button><button type="button" class="btn primary" data-ca="save">Save</button></div>
    <p class="hab3d-saved" role="status">${state.saved ? `Saved for ${esc(people.find(([id]) => id === state.saved)?.[1] || state.saved)}.` : ''}</p></form></div>`;
  return `<div class="hab3d-charpage" role="dialog" aria-label="Characters"><header><h3>Characters</h3>
    <nav><button type="button" class="btn small${tab === 'roster' ? ' primary' : ''}" data-ct="roster">Roster</button><button type="button" class="btn small${tab === 'creator' ? ' primary' : ''}" data-ct="creator">Creator</button></nav>
    <button type="button" class="btn small" data-ca="close" aria-label="Close">×</button></header>
    <p class="muted">Original characters only. Pick one for each AI and for yourself, or make your own.</p>${tab === 'roster' ? roster : creator}</div>`;
}

export function bindCharacters(el, { chars = {}, state = {}, save, close, rerender }) {
  const who = state.who || el.querySelector('[data-cf="who"]')?.value || 'owner';
  let draft = normChar(state.draft || chars[who] || ROSTER[0]);
  const st = (extra) => ({ ...state, who, draft, ...extra });
  el.querySelectorAll('[data-ct]').forEach((b) => b.addEventListener('click', () => rerender(st({ tab: b.dataset.ct, saved: '' }))));
  el.querySelector('[data-ca="close"]')?.addEventListener('click', () => close());
  el.querySelectorAll('.hab3d-give').forEach((s) => s.addEventListener('change', () => {
    if (!s.value) return; const spec = normChar(ROSTER[Number(s.dataset.ri)]); save(s.value, spec);
    rerender({ ...state, tab: 'roster' });
  }));
  const preview = () => { const p = el.querySelector('.hab3d-preview'); if (p) p.innerHTML = chibiSvg(draft, 180); };
  el.querySelectorAll('.hab3d-cform [data-cf]').forEach((f) => {
    const field = f.dataset.cf;
    if (f.tagName === 'BUTTON') f.addEventListener('click', () => { draft = normChar({ ...draft, [field]: f.dataset.v }); el.querySelectorAll(`[data-cf="${field}"]`).forEach((b) => { b.classList.toggle('on', b === f); b.setAttribute('aria-pressed', String(b === f)); }); preview(); });
    else if (field === 'who') f.addEventListener('change', () => rerender({ ...state, tab: 'creator', who: f.value, draft: chars[f.value] }));
    else f.addEventListener('input', () => { draft = normChar({ ...draft, [field]: f.value }); preview(); });
  });
  el.querySelector('[data-ca="surprise"]')?.addEventListener('click', () => { const r = randomChar(Date.now() % 100000); rerender(st({ tab: 'creator', draft: { ...r, name: draft.name || r.name }, saved: '' })); });
  el.querySelector('[data-ca="save"]')?.addEventListener('click', () => { save(who, draft); rerender(st({ tab: 'creator', saved: who })); });
}
