// The Live view (2.9): every AI as an animated "core" with its own shape, colour and
// talking motion. Pure HTML builders (unit tested in test/live.test.mjs); main.js
// passes in what it knows (status, who is working, who is speaking, last lines).

import { SHAPES, svgCore } from './live-shapes.mjs';

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
  // 3.4: the AIs added in 3.3/3.4, drawn as line art (src/live-shapes.mjs).
  cursor: { shape: 'prism', rgb: '159,179,200', talk: 'tKCursor 0.5s ease-in-out' },
  ghcopilot: { shape: 'twin', rgb: '139,148,158', talk: 'tKGhcopilot 1.2s linear' },
  kiro: { shape: 'blueprint', rgb: '123,97,255', talk: 'tKKiro 0.6s steps(3)' },
  kimi: { shape: 'crescent', rgb: '63,181,255', talk: 'tKKimi 1.3s ease-out' },
  aider: { shape: 'pair', rgb: '20,184,138', talk: 'tKAider 0.7s steps(4)' },
  opencode: { shape: 'brackets', rgb: '198,198,198', talk: 'tKOpencode 1.4s ease-in-out' },
  goose: { shape: 'vee', rgb: '217,194,122', talk: 'tKGoose 0.8s linear' },
  cline: { shape: 'steps', rgb: '91,141,239', talk: 'tKCline 1.5s steps(3)' },
  crush: { shape: 'shards', rgb: '255,110,199', talk: 'tKCrush 0.9s ease-out' },
  openhands: { shape: 'fan', rgb: '255,210,63', talk: 'tKOpenhands 1.6s steps(4)' },
  amp: { shape: 'bolt', rgb: '255,79,63', talk: 'tKAmp 1.0s ease-in-out' },
  auggie: { shape: 'plus', rgb: '74,222,128', talk: 'tKAuggie 1.7s linear' },
  droid: { shape: 'gear', rgb: '229,229,229', talk: 'tKDroid 1.1s steps(3)' },
  warp: { shape: 'tunnel', rgb: '1,164,255', talk: 'tKWarp 0.5s ease-out' },
  openrouter: { shape: 'routes', rgb: '139,143,247', talk: 'tKOpenrouter 1.2s steps(4)' },
  glm: { shape: 'lattice', rgb: '47,124,255', talk: 'tKGlm 0.6s ease-in-out' },
  cohere: { shape: 'petals', rgb: '57,166,139', talk: 'tKCohere 1.3s linear' },
  ai21: { shape: 'scroll', rgb: '232,93,155', talk: 'tKAi21 0.7s steps(3)' },
  minimax: { shape: 'pulse', rgb: '255,92,122', talk: 'tKMinimax 1.4s ease-out' },
  nova: { shape: 'star4', rgb: '255,159,28', talk: 'tKNova 0.8s steps(4)' },
  nvidia: { shape: 'eye2', rgb: '118,185,0', talk: 'tKNvidia 1.5s ease-in-out' },
  groq: { shape: 'speed', rgb: '245,80,54', talk: 'tKGroq 0.9s linear' },
  cerebras: { shape: 'wafer', rgb: '240,90,40', talk: 'tKCerebras 1.6s steps(3)' },
  v0: { shape: 'frame', rgb: '232,232,232', talk: 'tKV0 1.0s ease-out' },
  devin: { shape: 'cloudring', rgb: '46,196,182', talk: 'tKDevin 1.7s steps(4)' },
  jules: { shape: 'comet', rgb: '161,66,244', talk: 'tKJules 1.1s ease-in-out' },
  lovable: { shape: 'heartgrid', rgb: '255,122,182', talk: 'tKLovable 0.5s linear' },
  replit: { shape: 'blocks', rgb: '242,98,7', talk: 'tKReplit 1.2s steps(3)' },
  bolt: { shape: 'zig', rgb: '78,92,255', talk: 'tKBolt 0.6s ease-out' },
  firebase: { shape: 'flame', rgb: '255,202,40', talk: 'tKFirebase 1.3s steps(4)' },
  phi: { shape: 'quad', rgb: '0,164,239', talk: 'tKPhi 0.7s ease-in-out' },
  flux: { shape: 'flow', rgb: '192,132,252', talk: 'tKFlux 1.4s linear' },
  stability: { shape: 'dunes', rgb: '163,230,53', talk: 'tKStability 0.8s steps(3)' },
  ideogram: { shape: 'glyph', rgb: '34,211,238', talk: 'tKIdeogram 1.5s ease-out' },
  leonardo: { shape: 'compass', rgb: '251,191,36', talk: 'tKLeonardo 0.9s steps(4)' },
  runway: { shape: 'reel', rgb: '244,114,182', talk: 'tKRunway 1.6s ease-in-out' },
  luma: { shape: 'halo', rgb: '147,197,253', talk: 'tKLuma 1.0s linear' },
  kling: { shape: 'film', rgb: '52,211,153', talk: 'tKKling 1.7s steps(3)' },
  pika: { shape: 'spark', rgb: '251,113,133', talk: 'tKPika 1.1s ease-out' },
};
const FALLBACK = { shape: 'stack', rgb: '201,163,114', talk: 'tPing .9s ease-in-out' };
export const coreOf = (id) => CORES[id] || FALLBACK;

// The AIs on the Live screen (the helpers comfy, voice and listen, and the picture and video makers, are added by main.js).
export const LIVE_AIS = ['anthropic', 'openai', 'google', 'xai', 'mistral', 'qwen', 'freebuff',
  'cursor', 'ghcopilot', 'kiro', 'kimi', 'aider', 'opencode', 'goose', 'cline', 'crush', 'openhands', 'amp', 'auggie', 'droid', 'warp',
  'perplexity', 'deepseek', 'free', 'openrouter', 'glm', 'cohere', 'ai21', 'minimax', 'nova', 'nvidia', 'groq', 'cerebras',
  'devin', 'jules', 'lovable', 'replit', 'v0', 'bolt', 'firebase', 'venice', 'civitai', 'gpu', 'hearth', 'ollama', 'phi'];
export const MAKER_IDS = ['flux', 'stability', 'ideogram', 'leonardo', 'runway', 'luma', 'kling', 'pika'];

// 3.4: where each one lives on the Live screen: [key, title, what they do, ids].
export const GROUPS = [
  ['coders', 'Coding tools', 'work right in your folders', ['anthropic', 'openai', 'google', 'xai', 'mistral', 'qwen', 'freebuff', 'cursor', 'ghcopilot', 'kiro', 'kimi', 'aider', 'opencode', 'goose', 'cline', 'crush', 'openhands', 'amp', 'auggie', 'droid', 'warp']],
  ['chat', 'Chat & review', 'answer, check and research', ['perplexity', 'deepseek', 'free', 'openrouter', 'glm', 'cohere', 'ai21', 'minimax', 'nova', 'nvidia', 'groq', 'cerebras']],
  ['cloud', 'Cloud agents', 'take a job, come back with a pull request', ['devin', 'jules']],
  ['builders', 'App builders', 'make whole apps and sites', ['lovable', 'replit', 'v0', 'bolt', 'firebase']],
  ['makers', 'Makers', 'pictures and video', ['venice', 'civitai', ...MAKER_IDS]],
  ['pc', 'Your PCs', 'your own machines', ['gpu', 'hearth', 'comfy', 'voice', 'listen']],
  ['here', 'This computer', 'runs right here, free', ['ollama', 'phi']],
];

const ring = (l, w, extra) => `<i style="left:${l}%;top:${l}%;width:${w}%;height:${w}%;${extra}"></i>`;

// The moving parts of one shape (absolutely placed <i> elements; see .core i in styles.css).
function shapeHtml(shape) {
  if (SHAPES[shape]) return svgCore(shape);
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

// The whole stage (3.4). who: [{ id, name, state, status, big? }]; lead at the top with what the team is doing,
// then every AI as a card in its group. counts: { total, working, team, credit? }.
export function liveStageHtml({ who, caption, chatTitle, counts, canTalk }) {
  const byId = new Map(who.map((w) => [w.id, w]));
  const lead = who.find((w) => w.big) || null;
  const busy = who.filter((w) => !w.big && (w.state === 'working' || w.state === 'speaking'));
  const rgb = (id) => coreOf(id).rgb;
  const card = (w) => `<div class="lv-card ${esc(w.state || 'ready')}" style="--c:rgb(${rgb(w.id)})">${coreHtml({ ...w, size: 56 })}<b>${esc(w.name)}</b><span>${esc(w.status || '')}</span></div>`;
  const groups = GROUPS.map(([key, label, what, ids]) => {
    const list = ids.map((id) => byId.get(id)).filter((w) => w && !w.big);
    if (!list.length) return '';
    return `<section class="live-group g-${key}" aria-label="${esc(label)}"><div class="live-h"><b>${esc(label)}</b><span>${esc(what)} · ${list.length}</span><i></i></div><div class="lv-grid">${list.map(card).join('')}</div></section>`;
  }).join('');
  const flow = busy.length ? `<div class="lv-flow">${busy.slice(0, 6).map((w) => `<span style="--c:rgb(${rgb(w.id)})"><b>${esc(w.name)}</b> ${esc(w.status || '')}</span>`).join('<em>→</em>')}${busy.length > 6 ? `<em>+${busy.length - 6}</em>` : ''}</div>` : '';
  const head = lead ? `<div class="lv-lead" style="--c:rgb(${rgb(lead.id)})">${coreHtml({ ...lead, size: 124 })}<div class="grow"><div class="lv-lt">Team lead · ${esc(lead.name)}</div><div class="lv-ls">${esc(lead.status || '')}${chatTitle ? ` · ${esc(chatTitle)}` : ''}</div>${flow}</div>
    <div class="lv-stats"><div><b>${counts.working}</b><span>working</span></div><div><b>${counts.team ?? counts.total}</b><span>on the team</span></div>${counts.credit ? `<div><b>${esc(counts.credit)}</b><span>of your API credit</span></div>` : ''}</div></div>` : '';
  const cap = caption
    ? `<div class="live-cap" aria-live="polite"><span class="live-bars" style="--c:rgb(${rgb(caption.id)})"><b></b><b></b><b></b><b></b><b></b></span><div class="grow"><div><b style="color:rgb(${rgb(caption.id)})">${esc(caption.name)}</b>${caption.note ? `<span class="faint"> · ${esc(caption.note)}</span>` : ''}</div><div class="live-line">${esc(caption.line)}</div></div>${canTalk ? '<button class="live-mic" data-a="talk" title="Talk to the team" aria-label="Talk to the team"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path></svg></button>' : ''}</div>`
    : '';
  return `<div class="live-stage"><div class="live-top"><span class="live-tag">◢ LIVE · ${counts.total} AIs · ${counts.working} working</span><b class="live-title">${esc(chatTitle || 'No chat open')}</b><span class="grow"></span><span class="fine">lit up = working · dim = not set up</span></div>${head}${cap}${groups}<div class="fine live-hint">Click a core to hear its newest line${canTalk ? ' · the mic talks to the whole team' : ''}</div></div>`;
}
