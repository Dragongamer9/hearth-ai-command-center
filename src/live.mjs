// The Live view (2.9): every AI as an animated "core" with its own shape, colour and
// talking motion. Pure HTML builders (unit tested in test/live.test.mjs); main.js
// passes in what it knows (status, who is working, who is speaking, last lines).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Each AI: a shape, a colour (r,g,b) and a talking motion. All different.
export const CORES = {
  anthropic: { shape: 'gyro', rgb: '255,179,71', talk: 'tFlare .9s ease-in-out' },
  openai: { shape: 'hex', rgb: '79,224,192', talk: 'tSnap 1.1s steps(4)' },
  google: { shape: 'atom', rgb: '127,178,255', talk: 'tOrbit 1.6s linear' },
  free: { shape: 'orbit', rgb: '111,227,154', talk: 'tBounce .6s ease-in-out' },
  xai: { shape: 'square', rgb: '217,222,230', talk: 'tGlitch .35s steps(5)' },
  mistral: { shape: 'sun', rgb: '255,122,47', talk: 'tSun 1.2s ease-in-out' },
  perplexity: { shape: 'radar', rgb: '47,212,230', talk: 'tPing .9s ease-in-out' },
  deepseek: { shape: 'tri', rgb: '109,132,255', talk: 'tTilt 1s ease-in-out' },
  qwen: { shape: 'crystal', rgb: '166,139,255', talk: 'tShimmer .8s ease-in-out' },
  venice: { shape: 'eye', rgb: '255,90,79', talk: 'tWiden .9s ease-in-out' },
  civitai: { shape: 'spiral', rgb: '74,163,255', talk: 'tVortex .9s linear' },
  freebuff: { shape: 'cube', rgb: '255,214,64', talk: 'tFlip 1.3s ease-in-out' },
  gpu: { shape: 'wire', rgb: '232,214,110', talk: 'tHum .18s ease-in-out' },
  comfy: { shape: 'grid', rgb: '255,95,210', talk: 'tPixel .5s steps(3)' },
  voice: { shape: 'wave', rgb: '255,154,168', talk: 'tWobble .5s ease-in-out' },
  listen: { shape: 'ripple', rgb: '156,245,214', talk: 'tSwell 1.2s ease-in-out' },
  hearth: { shape: 'nebula', rgb: '255,138,76', talk: 'tNebula 1.1s ease-in-out' },
  ollama: { shape: 'stack', rgb: '242,239,232', talk: 'tStack .8s ease-in-out' },
};
const FALLBACK = { shape: 'stack', rgb: '201,163,114', talk: 'tPing .9s ease-in-out' };
export const coreOf = (id) => CORES[id] || FALLBACK;

// The AIs on the Live screen (the helpers comfy, voice and listen are added by main.js).
export const LIVE_AIS = ['anthropic', 'openai', 'google', 'free', 'xai', 'mistral', 'perplexity', 'deepseek', 'qwen', 'freebuff', 'venice', 'civitai', 'gpu', 'hearth', 'ollama'];

// Where each one lives on the Live screen.
export const GROUPS = [
  ['cloud', 'In the cloud', ['anthropic', 'openai', 'google', 'free', 'xai', 'mistral', 'perplexity', 'deepseek', 'qwen', 'freebuff', 'venice', 'civitai']],
  ['pc', 'Your PCs at home', ['gpu', 'comfy', 'voice', 'listen', 'hearth']],
  ['here', 'This computer', ['ollama']],
];

const ring = (l, w, extra) => `<i style="left:${l}%;top:${l}%;width:${w}%;height:${w}%;${extra}"></i>`;

// The moving parts of one shape (absolutely placed <i> elements; see .core i in styles.css).
function shapeHtml(shape) {
  switch (shape) {
    case 'gyro': return ring(0, 100, 'border:1px solid var(--c8);box-shadow:0 0 18px var(--c4);animation:spinX 14s linear infinite') + ring(7, 86, 'border:2px dashed var(--c7);animation:spinY 10s linear infinite') + ring(14, 72, 'border:1px solid var(--c5);animation:spinT 18s linear infinite') + ring(22, 56, 'border:1px dotted var(--c7);animation:spinZr 22s linear infinite');
    case 'hex': return `<i class="hex" style="left:4%;top:4%;width:92%;height:92%;background:var(--c8);animation:spinZ 16s linear infinite"></i><i class="hex" style="left:7%;top:7%;width:86%;height:86%;background:var(--hole);animation:spinZ 16s linear infinite"></i><i class="hex" style="left:18%;top:18%;width:64%;height:64%;background:var(--c5);animation:spinZr 10s linear infinite"></i><i class="hex" style="left:21%;top:21%;width:58%;height:58%;background:var(--hole);animation:spinZr 10s linear infinite"></i>`;
    case 'atom': return `<i style="left:0;top:0;width:100%;height:100%;border:0;animation:spinZ 12s linear infinite"><i style="left:0;top:32%;width:100%;height:36%;border:1.5px solid var(--c8)"></i><i style="left:0;top:32%;width:100%;height:36%;border:1.5px solid var(--c7);transform:rotate(60deg)"></i><i style="left:0;top:32%;width:100%;height:36%;border:1.5px solid var(--c5);transform:rotate(120deg)"></i><i class="dot" style="left:93%;top:46%;width:8%;height:8%"></i></i>`;
    case 'orbit': return ring(6, 88, 'border:1px dashed var(--c5)') + `<i style="left:0;top:0;width:100%;height:100%;animation:spinZ 6s linear infinite"><i class="dot" style="left:44%;top:2%;width:12%;height:12%"></i></i>` + ring(20, 60, 'border:1px solid var(--c7)');
    case 'square': return `<i class="sq" style="left:16%;top:16%;width:68%;height:68%;border:1.5px solid var(--c8);animation:spinZ 9s linear infinite"></i><i class="sq" style="left:16%;top:16%;width:68%;height:68%;border:1.5px solid var(--c5);animation:spinZr 13s linear infinite"></i><i class="sq" style="left:28%;top:28%;width:44%;height:44%;border:1px dashed var(--c7);animation:spinZ 5s linear infinite"></i>`;
    case 'sun': return `<i style="left:0;top:0;width:100%;height:100%;animation:spinZ 20s linear infinite">${[0, 45, 90, 135].map((d) => `<i class="ray" style="transform:rotate(${d}deg)"></i>`).join('')}</i>` + ring(22, 56, 'border:2px solid var(--c7)');
    case 'radar': return ring(4, 92, 'border:1px solid var(--c5)') + ring(22, 56, 'border:1px solid var(--c4)') + ring(4, 92, 'background:conic-gradient(var(--c7),transparent 25%);animation:spinZ 3s linear infinite');
    case 'tri': return `<i class="tri" style="left:6%;top:6%;width:88%;height:80%;background:var(--c8);animation:spinZ 14s linear infinite"></i><i class="tri" style="left:16%;top:22%;width:68%;height:58%;background:var(--hole);animation:spinZ 14s linear infinite"></i><i class="tri down" style="left:10%;top:14%;width:80%;height:76%;background:var(--c4);animation:spinZr 20s linear infinite"></i>`;
    case 'crystal': return `<i style="left:0;top:0;width:100%;height:100%;transform-style:preserve-3d;animation:spinYfull 6s linear infinite"><i class="gem" style="background:linear-gradient(135deg,var(--c8),var(--c4))"></i><i class="gem" style="background:linear-gradient(225deg,var(--c7),transparent);transform:rotateY(90deg)"></i></i>`;
    case 'eye': return `<i style="left:2%;top:26%;width:96%;height:48%;border:2px solid var(--c8);box-shadow:0 0 16px var(--c4);animation:blink 6s ease-in-out infinite"></i>` + ring(10, 80, 'border:1px dashed var(--c5);animation:spinZ 24s linear infinite');
    case 'spiral': return ring(2, 96, 'border:3px solid transparent;border-top-color:var(--c);border-right-color:var(--c5);animation:spinZ 2.2s linear infinite') + ring(14, 72, 'border:3px solid transparent;border-bottom-color:var(--c);border-left-color:var(--c5);animation:spinZr 1.6s linear infinite') + ring(26, 48, 'border:2px solid transparent;border-top-color:var(--c8);animation:spinZ 1.1s linear infinite');
    case 'cube': return `<i style="left:0;top:0;width:100%;height:100%;transform-style:preserve-3d;animation:spinYfull 7s linear infinite"><i class="sq" style="left:18%;top:18%;width:64%;height:64%;border:1.5px solid var(--c8);box-shadow:0 0 12px var(--c4)"></i><i class="sq" style="left:18%;top:18%;width:64%;height:64%;border:1.5px solid var(--c5);transform:rotateY(90deg)"></i></i><i class="sq" style="left:30%;top:30%;width:40%;height:40%;border:1px dashed var(--c7);transform:rotate(45deg);animation:spinZr 6s linear infinite"></i>`;
    case 'wire': return ring(4, 92, 'border:1px solid var(--c8)') + `<i style="left:4%;top:26%;width:92%;height:48%;border:1px solid var(--c5)"></i><i style="left:4%;top:42%;width:92%;height:16%;border:1px solid var(--c4)"></i><i style="left:0;top:0;width:100%;height:100%;transform-style:preserve-3d;animation:spinYfull 8s linear infinite">${ring(4, 92, 'border:1px solid var(--c7);transform:rotateY(60deg)')}${ring(4, 92, 'border:1px solid var(--c7);transform:rotateY(120deg)')}</i>`;
    case 'grid': return `<i class="px" style="left:16%;top:16%;width:68%;height:68%;animation:spinZ 30s linear infinite">${Array.from({ length: 16 }, (_, i) => `<b style="background:var(--c${[8, 4, 7, 5][i % 4]});animation:flick ${(1.1 + (i * 7 % 17) / 10).toFixed(1)}s infinite"></b>`).join('')}</i>`;
    case 'wave': return ring(6, 88, 'border:1px solid var(--c4)') + `<i class="bars">${[50, 90, 70, 100, 60, 80].map((h, i) => `<b style="height:${h}%;animation:bar ${(0.5 + i * 0.08).toFixed(2)}s ease-in-out infinite ${(i * 0.07).toFixed(2)}s"></b>`).join('')}</i>`;
    case 'ripple': return [0, 0.8, 1.6].map((dl) => ring(0, 100, `border:2px solid var(--c8);animation:ripple 2.4s ease-out infinite ${dl}s`)).join('');
    case 'nebula': return `<i style="left:6%;top:6%;width:88%;height:88%;animation:spinZ 9s linear infinite"><i style="left:0;top:20%;width:60%;height:50%;background:var(--c7);filter:blur(9px)"></i><i style="left:40%;top:36%;width:60%;height:50%;background:var(--c4);filter:blur(9px)"></i></i>` + ring(10, 80, 'border:1px dotted var(--c8);animation:spinZr 14s linear infinite');
    default: return [[4, 92, 5, 0], [16, 68, 7, 0.4], [28, 44, 8, 0.8]].map(([l, w, c, dl]) => ring(l, w, `border:1px solid var(--c${c});animation:breathe 2.4s ease-in-out infinite ${dl}s`)).join('');
  }
}

// One core. o: { id, name, size, state: 'ready'|'working'|'speaking'|'off', status, action, data }
export function coreHtml(o) {
  const c = coreOf(o.id);
  const a = (k) => `rgba(${c.rgb},${k})`;
  const talking = o.state === 'speaking' || o.state === 'working';
  const vars = `--c:rgb(${c.rgb});--c8:${a(0.85)};--c7:${a(0.7)};--c5:${a(0.5)};--c4:${a(0.38)};width:${o.size}px;height:${o.size}px`;
  return `<button class="core ${o.state || 'ready'}" style="${vars}" data-a="${esc(o.action || 'live-pick')}" data-v="${esc(o.id)}" ${o.data || ''} aria-label="${esc(o.name)}: ${esc(o.status || '')}" title="${esc(o.name)} · ${esc(o.status || '')}">
    <span class="core-in" style="${talking ? `animation:${c.talk} infinite` : ''}">
      <i class="halo"></i>
      ${o.state === 'speaking' ? '<i class="emit"></i><i class="emit late"></i>' : ''}
      ${shapeHtml(c.shape)}
      <i class="iris ${talking ? 'talk' : ''}"></i>
    </span>
  </button>`;
}

// A small core for lists (team rows, Accounts, the start screen).
export function miniCore(id, name, size = 34, state = 'ready') {
  return coreHtml({ id, name, size, state, status: state, action: 'live-pick' }).replace('class="core ', 'class="core mini ');
}

// The whole stage. who: [{ id, name, state, status, big? }], speaking: { id, name, line, voice } | null
export function liveStageHtml({ who, caption, chatTitle, counts, canTalk }) {
  const byId = new Map(who.map((w) => [w.id, w]));
  const groups = GROUPS.map(([key, label, ids]) => {
    const list = ids.map((id) => byId.get(id)).filter(Boolean);
    if (!list.length) return '';
    return `<section class="live-group g-${key}" aria-label="${esc(label)}"><div class="live-h">◢ ${esc(label)}</div><div class="live-cores">${list.map((w) => `<div class="live-ai ${w.big ? 'lead' : ''}">${coreHtml({ ...w, size: w.big ? 210 : 96 })}<b style="color:${w.state === 'speaking' || w.state === 'working' ? `rgb(${coreOf(w.id).rgb})` : ''}">${esc(w.name)}</b><span>${esc(w.status || '')}</span></div>`).join('')}</div></section>`;
  }).join('');
  const cap = caption
    ? `<div class="live-cap" aria-live="polite"><span class="live-bars" style="--c:rgb(${coreOf(caption.id).rgb})"><b></b><b></b><b></b><b></b><b></b></span><div class="grow"><div><b style="color:rgb(${coreOf(caption.id).rgb})">${esc(caption.name)}</b>${caption.note ? `<span class="faint"> · ${esc(caption.note)}</span>` : ''}</div><div class="live-line">${esc(caption.line)}</div></div>${canTalk ? '<button class="live-mic" data-a="talk" title="Talk to the team" aria-label="Talk to the team"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path></svg></button>' : ''}</div>`
    : '';
  return `<div class="live-stage"><div class="live-top"><span class="live-tag">◢ LIVE · ${counts.total} AIs · ${counts.working} working</span><b class="live-title">${esc(chatTitle || 'No chat open')}</b></div>${cap}${groups}<div class="fine live-hint">Click a core to hear its newest line${canTalk ? ' · the mic talks to the whole team' : ''}</div></div>`;
}
