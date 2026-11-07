// Images & Videos (2.2.1): the page, as pure functions of its state (unit tested).
// The main process (electron/studio.cjs) does the checks, the queue and the ComfyUI runs; this
// only draws what it reports and the request form.
import { esc } from './text.mjs';
import { icon } from '../icons.mjs';

export const PICTURE_SIZES = [['1344x768', '1344 × 768 (wide)'], ['1024x1024', '1024 × 1024 (square)'], ['768x1344', '768 × 1344 (tall)']];
export const VIDEO_SIZES = [['832x480', 'Wide 832 × 480'], ['480x832', 'Tall 480 × 832']];
export const COUNTS = [1, 2, 4];
export const FILTERS = [['all', 'All'], ['image', 'Pictures'], ['video', 'Videos']];

const GB = 1024 ** 3;
export const fmtSecs = (s) => (!(s >= 0) ? '' : s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`);

export function filterItems(items = [], filter = 'all') {
  return filter === 'image' || filter === 'video' ? items.filter((x) => x.kind === filter) : items.slice();
}
// How far along a running job is, from its time so far and the average of the last ones like it.
// null when there's nothing to compare with yet (the bar then just moves).
export function progressOf(job) {
  if (!job || job.state !== 'running' || !(job.estimate > 0)) return null;
  return Math.max(2, Math.min(95, Math.round((100 * (job.elapsed || 0)) / job.estimate)));
}
export function jobLine(job) {
  if (!job) return '';
  if (job.state === 'waiting') return 'waiting';
  const phase = { checking: 'checking your PC', queued: 'in ComfyUI\'s queue', generating: job.kind === 'video' ? 'making the video' : 'making the picture', downloading: 'downloading' }[job.phase] || 'starting';
  const t = fmtSecs(job.elapsed || 0);
  return `${phase}${t ? ` · ${t}` : ''}${job.estimate ? ` of about ${fmtSecs(job.estimate)}` : ''}`;
}
export function statusPill(st) {
  if (!st) return `<div class="st-pill"><span class="dotx"></span><span class="faint">checking your PC…</span></div>`;
  if (!st.ok) return `<div class="st-pill off" title="${esc(st.message || '')}"><span class="dotx bad"></span><b>${esc(st.host || 'Your PC')}</b><span class="faint">${st.kind === 'not_set' ? 'no address yet' : 'offline'}</span></div>`;
  const mem = st.vramTotal ? ` · ${((st.vramFree || 0) / GB).toFixed(1)} GB graphics memory free` : '';
  return `<div class="st-pill"><span class="dotx good"></span><b>${esc(st.host || 'Your PC')}</b><span class="faint">${esc((st.gpu || 'GPU').replace(/^NVIDIA GeForce /, ''))} · online${mem}</span></div>`;
}

// The queue (patched on its own while jobs run, so playing videos in the gallery aren't reset).
export function queueHtml(jobs = []) {
  return jobs.length ? `<section class="st-sec" aria-label="Queue"><h2>On your PC now</h2>${jobs.map((j) => { const pct = progressOf(j); return `<div class="st-job ${j.state}"><span class="st-tag ${j.kind}">${j.kind === 'video' ? 'VIDEO' : 'PICTURE'}</span><span class="st-jp">${esc(j.prompt)}${j.of > 1 ? ` <span class="faint">(${j.n} of ${j.of})</span>` : ''}</span>${j.state === 'running' ? `<div class="st-bar ${pct === null ? 'busy' : ''}" role="progressbar" aria-label="Progress" ${pct === null ? '' : `aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"`}><div style="width:${pct === null ? 30 : pct}%"></div></div>` : ''}<span class="faint st-jl">${esc(jobLine(j))}</span><button class="mini" data-a="st-cancel" data-id="${esc(j.id)}">${j.state === 'running' ? 'Stop' : 'Remove'}</button></div>`; }).join('')}</section>` : '';
}

// The whole page. f: the form ({ kind, prompt, size, count, model, negative, seed, steps, start,
// startName, more }); data: { items, jobs, uncensored }; st: the PC's status; filter; models:
// the picture models on the server (or null); shown: ids of 18+ items he clicked to show.
export function studioView({ f = {}, data = {}, st = null, filter = 'all', models = null, shown = new Set(), gallery = [] } = {}) {
  const kind = f.kind === 'video' ? 'video' : 'image';
  const jobs = data.jobs || [];
  const items = filterItems(data.items || [], filter);
  const sizes = kind === 'video' ? VIDEO_SIZES : PICTURE_SIZES;
  const size = sizes.some(([id]) => id === f.size) ? f.size : sizes[0][0];
  const picks = (data.items || []).filter((x) => x.kind === 'image').slice(0, 30);
  const form = `<section class="st-form" aria-label="New request">
    <div class="st-kinds" role="group" aria-label="Picture or video"><button class="btn ${kind === 'image' ? 'p' : ''}" data-a="st-kind" data-v="image" aria-pressed="${kind === 'image'}">Picture</button><button class="btn ${kind === 'video' ? 'p' : ''}" data-a="st-kind" data-v="video" aria-pressed="${kind === 'video'}">Video</button>${data.uncensored ? `<span class="st-18" title="Uncensored mode is on (Settings › Uncensored mode)">18+ Uncensored mode</span>` : ''}</div>
    ${kind === 'video' ? `<div class="st-start"><span class="lbl">Start from</span><button class="mini ${f.start ? '' : 'on'}" data-a="st-start-none">Text only</button><select data-a="st-start-item" aria-label="Animate a picture from Made so far"><option value="">A picture from Made so far…</option>${picks.map((x) => `<option value="item:${esc(x.id)}" ${f.start === `item:${x.id}` ? 'selected' : ''}>${esc(x.prompt.slice(0, 60))}${x.adult ? ' (18+)' : ''}</option>`).join('')}</select><button class="mini" data-a="st-start-file">${icon('clip', 'sm')}A picture file…</button>${f.start ? `<span class="faint">Animating: ${esc(f.startName || 'your picture')}</span>` : ''}</div>` : ''}
    <label class="st-lbl">What should it show?<textarea id="st-prompt" rows="3" placeholder="${kind === 'video' ? 'A steam locomotive crossing a snowy viaduct at dusk, smoke drifting, camera slowly following' : 'A steam locomotive crossing a snowy viaduct at dusk, warm light from the cab'}">${esc(f.prompt || '')}</textarea></label>
    <div class="st-grid">
      <label class="st-lbl">Size<select id="st-size">${sizes.map(([id, label]) => `<option value="${id}" ${id === size ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      ${kind === 'image' ? `<label class="st-lbl">Model<select id="st-model"><option value="">${data.uncensored ? 'Your 18+ picture model, else your ComfyUI default' : 'Your ComfyUI default'}</option>${(models || []).map((m) => `<option ${f.model === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
      <label class="st-lbl">How many<select id="st-count">${COUNTS.map((n) => `<option ${Number(f.count || 1) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : `<div class="st-lbl">Length<span class="st-fixed">about 5 s (81 frames, 16 a second)</span></div>`}
    </div>
    <details class="st-more" ${f.more ? 'open' : ''}><summary data-a="st-more">More options (leave out, seed${kind === 'image' ? ', steps' : ''})</summary>
      <div class="st-grid"><label class="st-lbl">Leave out<input id="st-neg" value="${esc(f.negative || '')}" placeholder="things you don't want in it"></label><label class="st-lbl">Seed<input id="st-seed" inputmode="numeric" value="${esc(f.seed ?? '')}" placeholder="random"></label>${kind === 'image' ? `<label class="st-lbl">Steps<input id="st-steps" inputmode="numeric" value="${esc(f.steps ?? '')}" placeholder="your default"></label>` : ''}</div>
      <p class="fine">Minors are always left out, and nothing sexual is ever made with anyone who looks under 18 or with real people. ${data.uncensored ? 'Uncensored mode is on: 18+ content is allowed for adults.' : 'Nudity is left out unless Uncensored mode is on (Settings).'}</p></details>
    <div class="st-go"><span class="faint">${kind === 'video' ? `Wan 2.2 14B ${f.start ? 'picture to video' : 'text to video'}${data.uncensored ? ' · uncensored LoRA' : ''} · 4 steps · about 5 s at 832 × 480` : 'ComfyUI on your PC'}</span><span class="grow"></span><button class="btn p st-make" data-a="st-make">Make it</button></div>
  </section>`;
  const filt = FILTERS.map(([k, label]) => `<button class="st-f ${filter === k ? 'on' : ''}" data-a="st-filter" data-v="${k}" aria-pressed="${filter === k}">${label}</button>`).join('');
  const card = (x) => {
    const hide = x.adult && !shown.has(x.id);
    const mediaHtml = x.kind === 'video'
      ? `<video src="${esc(x.url)}" ${hide ? '' : 'controls'} preload="metadata" muted playsinline></video>`
      : `<img src="${esc(x.url)}" alt="${esc(x.prompt.slice(0, 120))}" loading="lazy">`;
    return `<figure class="st-item ${hide ? 'hidden18' : ''}" data-id="${esc(x.id)}">
      <div class="st-media">${mediaHtml}${hide ? `<button class="st-reveal" data-a="st-show" data-id="${esc(x.id)}">${icon('eye', 'sm')}18+ · show</button>` : ''}${x.adult ? '<span class="st-mark" title="Made in Uncensored mode">18+</span>' : ''}${x.kind === 'video' ? `<span class="st-dur">${icon('play', 'sm')}${x.frames ? `0:0${Math.round(x.frames / 16)}` : 'video'}</span>` : ''}</div>
      <figcaption><span class="st-cap" title="${esc(x.prompt)}">${esc(x.prompt)}</span><span class="faint st-meta">${esc([x.model, x.width && x.height ? `${x.width}×${x.height}` : '', x.secs ? fmtSecs(x.secs) : '', `seed ${x.seed}`].filter(Boolean).join(' · '))}</span>
      <span class="st-acts"><button class="lnk" data-a="st-save" data-id="${esc(x.id)}">Save</button><span aria-hidden="true">·</span><button class="lnk" data-a="st-send" data-id="${esc(x.id)}" ${x.adult ? 'disabled title="18+ items stay here: never sent to Claude, ChatGPT or Gemini"' : ''}>Send to a chat</button><span aria-hidden="true">·</span><button class="lnk" data-a="st-again" data-id="${esc(x.id)}">Again</button>${x.kind === 'image' ? `<span aria-hidden="true">·</span><button class="lnk" data-a="st-animate" data-id="${esc(x.id)}">Animate</button>` : ''}<span class="grow"></span><button class="lnk dim" data-a="st-remove" data-id="${esc(x.id)}" aria-label="Delete">${icon('trash', 'sm')}</button></span></figcaption></figure>`;
  };
  const made = `<section class="st-sec" aria-label="Made so far"><div class="st-mh"><h2>Made so far</h2><span class="grow"></span>${filt}</div>${items.length ? `<div class="st-gal">${items.map(card).join('')}</div>` : `<p class="faint">${(data.items || []).length ? 'Nothing here with this filter.' : 'Nothing yet. What you make shows up here, and stays until you delete it.'}</p>`}${data.broken ? `<div class="note warn">${esc(data.broken)}</div>` : ''}</section>`;
  return `<div class="studio"><header class="st-hd"><h1>Images &amp; Videos</h1><span class="grow"></span>${statusPill(st)}<button class="ib" data-a="st-refresh" aria-label="Check your PC again" title="Check your PC again">${icon('refresh', 'sm')}</button></header>${form}<div id="st-queue">${queueHtml(jobs)}</div>${made}</div>`;
}

// The request the window sends (the main process checks everything again).
export function requestFrom(f = {}, doc = null) {
  // From the page when there is one; otherwise from the form object, by element id ('st-prompt') or by its own name
  // ('prompt'): the window keeps what was typed as f.prompt, f.size... (2.2.1 sent an empty prompt from there).
  const NAMES = { 'st-neg': 'negative' };
  const val = (id) => {
    if (doc) { const e = doc.getElementById(id); if (e) return e.value ?? ''; }
    return f[id] ?? f[NAMES[id] || id.replace(/^st-/, '')] ?? '';
  };
  const kind = f.kind === 'video' ? 'video' : 'image';
  return {
    kind,
    prompt: String(val('st-prompt')).trim(),
    size: val('st-size'),
    count: kind === 'image' ? Number(val('st-count')) || 1 : 1,
    model: kind === 'image' ? val('st-model') : '',
    negative: val('st-neg'),
    seed: String(val('st-seed')).trim() === '' ? null : Number(val('st-seed')),
    steps: kind === 'image' && String(val('st-steps')).trim() !== '' ? Number(val('st-steps')) : null,
    start: kind === 'video' ? f.start || null : null,
  };
}
