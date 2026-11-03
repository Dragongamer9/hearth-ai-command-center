// Habitat 3D: procedural canvas textures (wood grain, planks, stone, knitted
// rugs, grass, labels, icons, glows). All original, drawn in code at runtime.
import * as THREE from '../vendor/three/three.module.min.js';

const cache = new Map();
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { repeat = null, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function once(key, make) { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); }
export function disposeTextures() { for (const t of cache.values()) t.dispose?.(); cache.clear(); }

const hsl = (h, s, l) => `hsl(${h},${s}%,${l}%)`;

// Long wood grain (beams, furniture). base: hue/sat/light of the wood.
export function woodTex(kind = 'oak') {
  return once(`wood:${kind}`, () => {
    seed = kind.length * 977;
    const W = { oak: [28, 45, 42], dark: [22, 40, 24], light: [34, 48, 60], walnut: [18, 38, 30] }[kind] || [28, 45, 42];
    const c = canvas(256, 256); const g = c.getContext('2d');
    g.fillStyle = hsl(W[0], W[1], W[2]); g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 70; i++) {
      const y = rnd() * 256; const amp = 2 + rnd() * 6; const l = W[2] + (rnd() - 0.5) * 14;
      g.strokeStyle = hsl(W[0] + (rnd() - 0.5) * 6, W[1], l); g.lineWidth = 0.6 + rnd() * 2.2; g.globalAlpha = 0.35 + rnd() * 0.4;
      g.beginPath();
      for (let x = 0; x <= 256; x += 8) g.lineTo(x, y + Math.sin(x / (18 + rnd() * 30) + i) * amp);
      g.stroke();
    }
    for (let i = 0; i < 4; i++) { // knots
      const x = rnd() * 256; const y = rnd() * 256;
      g.globalAlpha = 0.5; g.fillStyle = hsl(W[0] - 4, W[1], W[2] - 14);
      g.beginPath(); g.ellipse(x, y, 6 + rnd() * 6, 2 + rnd() * 3, 0, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    return tex(c, { repeat: [1, 1] });
  });
}

// Floor planks with seams and slight per-board colour variation.
export function planksTex(kind = 'floor') {
  return once(`planks:${kind}`, () => {
    seed = 4242 + kind.length;
    const base = kind === 'kitchen' ? [30, 32, 58] : kind === 'room' ? [26, 42, 46] : [27, 44, 40];
    const c = canvas(512, 512); const g = c.getContext('2d');
    const rows = 8; const h = 512 / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * 200;
      while (x < 512) {
        const w = 140 + rnd() * 160; const l = base[2] + (rnd() - 0.5) * 10;
        g.fillStyle = hsl(base[0] + (rnd() - 0.5) * 5, base[1], l); g.fillRect(x, r * h, w, h);
        for (let i = 0; i < 9; i++) { g.strokeStyle = hsl(base[0], base[1], l - 6 - rnd() * 5); g.globalAlpha = 0.35; g.lineWidth = 1; g.beginPath(); const yy = r * h + rnd() * h; g.moveTo(x, yy); g.bezierCurveTo(x + w / 3, yy + 3, x + (2 * w) / 3, yy - 3, x + w, yy + 1); g.stroke(); }
        g.globalAlpha = 1; g.fillStyle = 'rgba(30,18,10,.55)'; g.fillRect(x, r * h, 2, h);
        x += w;
      }
      g.fillStyle = 'rgba(30,18,10,.6)'; g.fillRect(0, r * h, 512, 2);
    }
    return tex(c, { repeat: [1, 1] });
  });
}

// Fieldstone for the fireplace, chimney and the hill path.
export function stoneTex(kind = 'warm') {
  return once(`stone:${kind}`, () => {
    seed = 99 + kind.length;
    const c = canvas(256, 256); const g = c.getContext('2d');
    g.fillStyle = '#4a4440'; g.fillRect(0, 0, 256, 256);
    let y = 0;
    while (y < 256) {
      const h = 26 + rnd() * 18; let x = -rnd() * 30;
      while (x < 256) {
        const w = 30 + rnd() * 34; const l = 44 + rnd() * 20; const hue = kind === 'warm' ? 25 + rnd() * 15 : 210;
        g.fillStyle = hsl(hue, 10 + rnd() * 10, l);
        g.beginPath(); g.roundRect(x + 2, y + 2, w - 4, h - 4, 8); g.fill();
        const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(0,0,0,.18)');
        g.fillStyle = gr; g.beginPath(); g.roundRect(x + 2, y + 2, w - 4, h - 4, 8); g.fill();
        x += w;
      }
      y += h;
    }
    return tex(c, { repeat: [1, 1] });
  });
}

// A knitted rug in the AI's colour: rows of little V stitches with a border.
export function knitTex(color, style = 0) {
  return once(`knit:${color}:${style}`, () => {
    const c = canvas(256, 192); const g = c.getContext('2d');
    const col = new THREE.Color(color);
    const hs = {}; col.getHSL(hs);
    const tone = (dl, ds = 0) => hsl(Math.round(hs.h * 360), Math.round(Math.min(90, hs.s * 100 * 0.8 + ds)), Math.round(Math.max(12, Math.min(88, hs.l * 100 + dl))));
    g.fillStyle = tone(-8); g.fillRect(0, 0, 256, 192);
    const sw = 8; const sh = 8;
    for (let y = 0; y < 192; y += sh) {
      for (let x = 0; x < 256; x += sw) {
        let dl = 4;
        const band = Math.floor(y / 24);
        if (style === 0 && band % 2) dl = 22;
        if (style === 1) { const dx = x - 128; const dy = (y - 96) * 1.33; const r = Math.sqrt(dx * dx + dy * dy); if (Math.floor(r / 22) % 2) dl = 22; }
        if (style === 2) { if ((Math.abs(x - 128) + Math.abs(y - 96) * 1.33) % 64 < 22) dl = 24; }
        if (x < 16 || x > 236 || y < 16 || y > 172) dl = -18;
        g.fillStyle = tone(dl); g.beginPath(); g.moveTo(x, y); g.lineTo(x + sw / 2, y + sh); g.lineTo(x + sw / 2, y + sh - 2); g.lineTo(x + 1, y); g.fill();
        g.fillStyle = tone(dl - 8); g.beginPath(); g.moveTo(x + sw, y); g.lineTo(x + sw / 2, y + sh); g.lineTo(x + sw / 2, y + sh - 2); g.lineTo(x + sw - 1, y); g.fill();
      }
    }
    return tex(c);
  });
}

export function grassTex() {
  return once('grass', () => {
    seed = 31;
    const c = canvas(256, 256); const g = c.getContext('2d');
    g.fillStyle = '#4f7a3a'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1800; i++) { g.fillStyle = hsl(90 + rnd() * 30, 35 + rnd() * 20, 26 + rnd() * 22); g.fillRect(rnd() * 256, rnd() * 256, 1.5, 3 + rnd() * 4); }
    return tex(c, { repeat: [6, 6] });
  });
}
export function soilTex() {
  return once('soil', () => {
    seed = 77;
    const c = canvas(128, 128); const g = c.getContext('2d');
    g.fillStyle = '#4a3122'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 600; i++) { g.fillStyle = hsl(22, 35, 14 + rnd() * 18); g.fillRect(rnd() * 128, rnd() * 128, 2, 2); }
    return tex(c, { repeat: [1, 1] });
  });
}
// Woven fabric for cushions, blankets and curtains.
export function fabricTex(color) {
  return once(`fabric:${color}`, () => {
    const c = canvas(64, 64); const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 64; i += 4) { g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(i, 0, 2, 64); g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, i, 64, 2); }
    return tex(c, { repeat: [2, 2] });
  });
}

// Soft round glow used for lamp halos, fire bloom and light pools on the floor.
export function glowTex(inner = 'rgba(255,214,150,1)', outer = 'rgba(255,170,90,0)') {
  return once(`glow:${inner}:${outer}`, () => {
    const c = canvas(128, 128); const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, inner); gr.addColorStop(0.35, inner.replace(/,[\d.]+\)$/, ',.45)')); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return tex(c);
  });
}
// Blob contact shadow under figures and furniture (cheap ambient occlusion).
export function blobTex() {
  return once('blob', () => {
    const c = canvas(64, 64); const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return tex(c, { srgb: false });
  });
}

// A small text label (nameplates, monitors, board notes). Not cached: content changes.
export function labelTex(lines, { w = 256, h = 96, bg = '#f3e6cc', fg = '#3a2616', font = 'bold 34px system-ui, sans-serif', border = null, align = 'center' } = {}) {
  const c = canvas(w, h); const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  if (border) { g.strokeStyle = border; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); }
  g.fillStyle = fg; g.font = font; g.textAlign = align; g.textBaseline = 'middle';
  const list = Array.isArray(lines) ? lines : [lines];
  const lh = h / (list.length + 0.6);
  list.forEach((s, i) => {
    let t = String(s ?? '');
    while (t.length > 1 && g.measureText(t).width > w - 20) t = `${t.slice(0, -2)}…`;
    g.fillText(t, align === 'center' ? w / 2 : 12, lh * (i + 0.8));
  });
  return tex(c);
}

// Status icons above heads, drawn as little bubbles (all original shapes).
export function iconTex(name) {
  return once(`icon:${name}`, () => {
    const c = canvas(128, 128); const g = c.getContext('2d');
    const bubble = (fill = '#fff8ec') => {
      g.fillStyle = 'rgba(40,24,14,.25)'; g.beginPath(); g.ellipse(66, 58, 50, 42, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = fill; g.beginPath(); g.ellipse(64, 54, 50, 42, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(50, 88); g.lineTo(44, 114); g.lineTo(70, 92); g.fill();
    };
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (name === 'star') {
      g.fillStyle = '#ffd25e'; g.strokeStyle = '#a86a12'; g.lineWidth = 7;
      g.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 24 : 56; const a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(64 + Math.cos(a) * r, 66 + Math.sin(a) * r); }
      g.closePath(); g.stroke(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(52, 50, 10, 6, -0.5, 0, Math.PI * 2); g.fill();
    } else if (name === 'zzz') {
      g.fillStyle = '#cfe0ff'; g.strokeStyle = '#2b3c6e'; g.lineWidth = 6; g.font = 'bold 54px system-ui, sans-serif';
      for (const [s, x, y] of [['z', 24, 104], ['z', 56, 74], ['Z', 82, 44]]) { g.strokeText(s, x, y); g.fillText(s, x, y); }
    } else if (name === 'lock') {
      g.fillStyle = '#e9b949'; g.strokeStyle = '#5a3b10'; g.lineWidth = 7;
      g.beginPath(); g.arc(64, 52, 20, Math.PI, 0); g.stroke();
      g.beginPath(); g.roundRect(34, 52, 60, 48, 8); g.fill(); g.stroke();
      g.fillStyle = '#5a3b10'; g.beginPath(); g.arc(64, 72, 7, 0, Math.PI * 2); g.fill(); g.fillRect(61, 74, 6, 14);
    } else {
      bubble();
      g.strokeStyle = '#5a3a24'; g.fillStyle = '#5a3a24'; g.lineWidth = 7;
      if (name === 'bubble' || name === 'chat') { for (const x of [42, 64, 86]) { g.beginPath(); g.arc(x, 54, 7, 0, Math.PI * 2); g.fill(); } }
      if (name === 'magnifier') { g.beginPath(); g.arc(58, 48, 18, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(71, 61); g.lineTo(88, 78); g.stroke(); }
      if (name === 'ask') { g.font = 'bold 60px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('?', 64, 76); }
      if (name === 'happy') { g.beginPath(); g.arc(64, 46, 22, 0.2, Math.PI - 0.2); g.stroke(); g.beginPath(); g.arc(52, 40, 4, 0, 7); g.arc(76, 40, 4, 0, 7); g.fill(); }
      if (name === 'wave') { g.beginPath(); for (let i = 0; i < 3; i++) { g.moveTo(40 + i * 16, 70); g.quadraticCurveTo(48 + i * 16, 30, 56 + i * 16, 70); } g.stroke(); }
      if (name === 'heart') { g.fillStyle = '#e45a6a'; g.beginPath(); g.moveTo(64, 82); g.bezierCurveTo(20, 50, 40, 18, 64, 40); g.bezierCurveTo(88, 18, 108, 50, 64, 82); g.fill(); }
      if (name === 'sad' || name === 'tired') { g.beginPath(); g.arc(64, 74, 18, Math.PI + 0.4, -0.4); g.stroke(); }
      if (name === 'idea') { g.fillStyle = '#ffcf4a'; g.beginPath(); g.arc(64, 46, 18, 0, 7); g.fill(); g.fillStyle = '#5a3a24'; g.fillRect(56, 64, 16, 10); }
    }
    return tex(c);
  });
}

// Monitor screen with the task id (or a soft idle glow).
export function screenTex(text, kind = 'task') {
  return labelTex(text ? [kind === 'review' ? 'REVIEW' : 'TASK', `T-${text}`] : [''], { w: 128, h: 80, bg: text ? (kind === 'review' ? '#24364a' : '#1d3a2c') : '#141a22', fg: text ? '#bff3d0' : '#2c3644', font: 'bold 22px ui-monospace, monospace' });
}

// Roof shingles (warm clay-brown rows of rounded tiles).
export function roofTex() {
  return once('roof', () => {
    seed = 555;
    const c = canvas(256, 256); const g = c.getContext('2d');
    g.fillStyle = '#5a3324'; g.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 10; r++) {
      const y = r * 26; const off = r % 2 ? 16 : 0;
      for (let x = -32 + off; x < 256; x += 32) {
        g.fillStyle = hsl(14 + rnd() * 10, 38 + rnd() * 10, 26 + rnd() * 10);
        g.beginPath(); g.moveTo(x + 1, y); g.lineTo(x + 31, y); g.lineTo(x + 31, y + 18); g.quadraticCurveTo(x + 16, y + 30, x + 1, y + 18); g.fill();
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 1, y, 30, 3);
      }
    }
    return tex(c, { repeat: [8, 3] });
  });
}
// A small framed painting: soft original landscapes tinted by a colour.
export function artTex(color, n = 0) {
  return once(`art:${color}:${n % 4}`, () => {
    const c = canvas(128, 96); const g = c.getContext('2d');
    const col = new THREE.Color(color); const hs = {}; col.getHSL(hs); const H = Math.round(hs.h * 360);
    const sky = g.createLinearGradient(0, 0, 0, 96); sky.addColorStop(0, hsl((H + 200) % 360, 40, 78)); sky.addColorStop(1, hsl((H + 30) % 360, 55, 82));
    g.fillStyle = sky; g.fillRect(0, 0, 128, 96);
    g.fillStyle = hsl(45, 90, 85); g.beginPath(); g.arc(30 + (n % 4) * 20, 30, 10, 0, 7); g.fill();
    for (let i = 0; i < 3; i++) { g.fillStyle = hsl(H, 35 + i * 10, 55 - i * 12); g.beginPath(); g.moveTo(0, 96); for (let x = 0; x <= 128; x += 16) g.lineTo(x, 55 + i * 12 + Math.sin(x / 20 + i * 2 + n) * 10); g.lineTo(128, 96); g.fill(); }
    return tex(c);
  });
}
