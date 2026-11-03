// The Habitat page: a cozy top-down pixel world where each AI has its own room
// and a desk in the shared workroom. Rendering only; the world logic lives in
// ./habitat/world.mjs (pure, unit tested). All art is original and drawn in code.
import { TILE, T, buildWorld, behaviourOf, newActor, stepActor, closedDoors, walkFrame, deskOf } from './habitat/world.mjs';
import { SPRITES, SLEEP, ICONS, glyph, textWidth } from './habitat/sprites.mjs';

let H = null; // survives page re-renders so characters keep their places
const POLL_MS = 400;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- colors ----------
function rgb(c) {
  const s = String(c || '').trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((x) => x + x).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [128, 128, 128];
}
const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => { const x = rgb(a); const y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
const shade = (c, t) => (t < 0 ? mix(c, '#000000', -t) : mix(c, '#ffffff', t));
const alpha = (c, a) => { const [r, g, b] = rgb(c); return `rgba(${r},${g},${b},${a})`; };

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => cs.getPropertyValue(n).trim() || d;
  const dark = document.documentElement.dataset.mode !== 'light';
  const bg = v('--bg', dark ? '#1b2838' : '#eef2f6');
  const accent = v('--accent', '#1a9fff');
  // Cozy wood and stone, nudged toward the app's own background so it sits in the Hearth look.
  return {
    dark, bg, accent, text: v('--text', '#c7d5e0'),
    outside: v('--bg-2', dark ? '#171a21' : '#dfe6ee'),
    wallTop: mix(dark ? '#4a3d52' : '#d9c8b4', bg, 0.25),
    wallFace: mix(dark ? '#2e2535' : '#b39a82', bg, 0.2),
    wallLine: dark ? '#1c1622' : '#8f7762',
    wood: dark ? '#6e4c35' : '#c99a6b',
    woodLine: dark ? '#573a28' : '#b38457',
    tileA: mix(dark ? '#3a4a5c' : '#e3eaf1', bg, 0.3),
    tileB: mix(dark ? '#334253' : '#d6dfe8', bg, 0.3),
    grass: dark ? '#2d4f37' : '#86b673',
    grass2: dark ? '#355c40' : '#94c381',
    desk: dark ? '#9a6844' : '#b97d50',
    deskTop: dark ? '#b07a52' : '#d29a6a',
    outline: dark ? '#15111a' : '#2b2230',
    face: '#f6e6cc',
    boots: '#4a3426',
    plateInk: '#15111a',
    night: dark,
  };
}

// ---------- pixel helpers ----------
function px(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
function drawMap(ctx, rows, x, y, pal, { mirror = false, maxRows = rows.length } = {}) {
  for (let r = 0; r < Math.min(rows.length, maxRows); r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const k = row[mirror ? row.length - 1 - c : c];
      if (k === '.' || !pal[k]) continue;
      ctx.fillStyle = pal[k];
      ctx.fillRect(x + c, y + r, 1, 1);
    }
  }
}
function drawText(ctx, s, x, y, c) {
  ctx.fillStyle = c;
  let cx = x;
  for (const ch of String(s)) {
    const g = glyph(ch);
    for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(cx + (i % 3), y + Math.floor(i / 3), 1, 1);
    cx += 4;
  }
}
const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

// ---------- static layer: floors, walls, rugs, beds, props, plates ----------
function floorAt(world, x, y) {
  return world.rooms.find((r) => x >= r.x0 && x < r.x0 + r.w && y >= r.y0 && y < r.y0 + r.h) || null;
}

function drawProp(ctx, kind, x, y, th, color) {
  const o = th.outline;
  if (kind === 'bookshelf') {
    px(ctx, x + 1, y, 14, 15, o); px(ctx, x + 2, y + 1, 12, 13, shade(th.wood, -0.15));
    const books = ['#c25b4e', '#5a8fc2', '#d9b44a', '#6fae6a', color, '#9a6fc2'];
    for (let s = 0; s < 3; s++) {
      const sy = y + 1 + s * 4;
      for (let b = 0; b < 5; b++) px(ctx, x + 3 + b * 2, sy + (b % 2), 2, 4 - (b % 2), books[(b + s * 2) % books.length]);
      px(ctx, x + 2, sy + 4, 12, 1, th.wood);
    }
  } else if (kind === 'plant') {
    px(ctx, x + 5, y + 10, 6, 5, o); px(ctx, x + 6, y + 10, 4, 4, '#c0714a'); px(ctx, x + 5, y + 10, 6, 1, '#d9875c');
    const leaf = th.dark ? '#4f9a5a' : '#5fae63'; const leaf2 = th.dark ? '#3c7a46' : '#4a9450';
    px(ctx, x + 4, y + 4, 8, 6, leaf2); px(ctx, x + 3, y + 6, 3, 3, leaf); px(ctx, x + 10, y + 5, 3, 3, leaf); px(ctx, x + 6, y + 2, 4, 4, leaf); px(ctx, x + 7, y + 1, 2, 2, leaf2);
  } else if (kind === 'lamp') {
    if (th.night) { ctx.fillStyle = 'rgba(255,214,140,.16)'; ctx.beginPath(); ctx.arc(x + 8, y + 9, 14, 0, Math.PI * 2); ctx.fill(); }
    px(ctx, x + 7, y + 6, 2, 8, o); px(ctx, x + 5, y + 13, 6, 2, o);
    px(ctx, x + 4, y + 1, 8, 6, o); px(ctx, x + 5, y + 2, 6, 4, th.night ? '#ffe2a0' : '#f3d79a'); px(ctx, x + 5, y + 2, 6, 1, '#fff3cf');
  } else if (kind === 'chest') {
    px(ctx, x + 2, y + 5, 12, 10, o); px(ctx, x + 3, y + 6, 10, 8, th.wood); px(ctx, x + 3, y + 6, 10, 3, shade(th.wood, 0.15));
    px(ctx, x + 3, y + 9, 10, 1, '#c9a35a'); px(ctx, x + 7, y + 8, 2, 3, '#e3c06b');
  } else if (kind === 'cooler') {
    px(ctx, x + 4, y + 7, 8, 8, o); px(ctx, x + 5, y + 8, 6, 6, '#e8edf1'); px(ctx, x + 5, y + 1, 6, 7, o); px(ctx, x + 6, y + 2, 4, 5, '#7cc4ef'); px(ctx, x + 6, y + 2, 1, 4, '#bfe6fb'); px(ctx, x + 7, y + 10, 2, 1, '#5a8fc2');
  }
}

function drawRug(ctx, rug, th, color) {
  const x = rug.x * TILE + 2; const y = rug.y * TILE + 2; const w = rug.w * TILE - 4; const h = rug.h * TILE - 4;
  const base = mix(color, th.dark ? '#2a2030' : '#ffffff', th.dark ? 0.35 : 0.35);
  const edge = shade(color, -0.25);
  if (rug.style === 1) {
    px(ctx, x + 3, y, w - 6, h, edge); px(ctx, x, y + 3, w, h - 6, edge); px(ctx, x + 1, y + 2, w - 2, h - 4, edge);
    px(ctx, x + 4, y + 1, w - 8, h - 2, base); px(ctx, x + 1, y + 4, w - 2, h - 8, base); px(ctx, x + 2, y + 3, w - 4, h - 6, base);
    px(ctx, x + 10, y + 8, w - 20, h - 16, shade(base, 0.2));
  } else {
    px(ctx, x, y, w, h, edge); px(ctx, x + 1, y + 1, w - 2, h - 2, base);
    if (rug.style === 0) for (let i = 4; i < h - 2; i += 6) px(ctx, x + 2, y + i, w - 4, 2, shade(base, -0.15));
    else for (let i = 0; i < 4; i++) { const cx = x + w / 2; const cy = y + h / 2; px(ctx, cx - 8 + i * 2, cy - i, 16 - i * 4, i * 2 + 1, shade(base, 0.18)); }
    for (let i = 0; i < w; i += 3) { px(ctx, x + i, y - 1, 1, 1, edge); px(ctx, x + i, y + h, 1, 1, edge); }
  }
}

function drawBed(ctx, room, th, color) {
  const top = Math.min(room.bed[0].y, room.bed[1].y);
  const x = room.bed[0].x * TILE + 1; const y = top * TILE + 1;
  px(ctx, x, y, 14, 30, th.outline); px(ctx, x + 1, y + 1, 12, 28, shade(th.wood, -0.1));
  px(ctx, x + 2, y + 2, 10, 6, '#f2efe8'); px(ctx, x + 2, y + 7, 10, 1, '#d8d2c6');
  px(ctx, x + 1, y + 10, 12, 18, shade(color, -0.2)); px(ctx, x + 1, y + 10, 12, 2, shade(color, 0.15));
}

function drawPlate(ctx, room, name, color, th) {
  const label = String(name).toUpperCase().slice(0, 11);
  const w = textWidth(label) + 4;
  const cx = room.plate.x * TILE + (room.plate.w * TILE) / 2;
  const x = Math.round(cx - w / 2); const y = room.plate.y * TILE + 4;
  px(ctx, x - 1, y - 1, w + 2, 9, th.outline); px(ctx, x, y, w, 7, color); px(ctx, x, y + 6, w, 1, shade(color, -0.25));
  drawText(ctx, label, x + 2, y + 1, th.plateInk);
}

function buildStatic(world, th, agents) {
  const c = document.createElement('canvas');
  c.width = world.w * TILE; c.height = world.h * TILE;
  const ctx = c.getContext('2d');
  px(ctx, 0, 0, c.width, c.height, th.outside);
  const isWall = (x, y) => y >= 0 && y < world.h && x >= 0 && x < world.w && world.grid[y][x] === T.WALL;
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const t = world.grid[y][x]; const X = x * TILE; const Y = y * TILE;
      const room = floorAt(world, x, y);
      const color = room ? agents[room.id]?.color || '#888888' : null;
      if (t === T.GARDEN) {
        px(ctx, X, Y, TILE, TILE, th.grass);
        const h = hash(x, y);
        for (let i = 0; i < 4; i++) px(ctx, X + ((h >> (i * 4)) & 15), Y + ((h >> (i * 4 + 2)) & 15), 1, 2, th.grass2);
        if (h % 5 === 0) { px(ctx, X + 6, Y + 6, 3, 3, h % 2 ? '#f2c14e' : '#f08aa0'); px(ctx, X + 7, Y + 7, 1, 1, '#fff6d8'); }
      } else if (t === T.WALL) {
        px(ctx, X, Y, TILE, TILE, th.wallTop);
        px(ctx, X, Y + 15, TILE, 1, th.wallLine);
        if (!isWall(x, y + 1) && y + 1 < world.h) { px(ctx, X, Y + 9, TILE, 7, th.wallFace); px(ctx, X, Y + 9, TILE, 1, th.wallLine); for (let i = 0; i < 16; i += 8) px(ctx, X + i + ((y % 2) * 4), Y + 12, 1, 4, th.wallLine); }
      } else if (room || (t === T.PROP && room)) {
        px(ctx, X, Y, TILE, TILE, mix(th.wood, color, 0.12));
        for (let i = 3; i < 16; i += 4) px(ctx, X, Y + i, TILE, 1, mix(th.woodLine, color, 0.1));
        px(ctx, X + ((x * 5 + y * 3) % 12), Y + 4, 1, 3, mix(th.woodLine, color, 0.1));
      } else {
        px(ctx, X, Y, TILE, TILE, (x + y) % 2 ? th.tileA : th.tileB);
        px(ctx, X, Y, TILE, 1, alpha('#000000', 0.06));
      }
      if (t === T.DOOR) {
        px(ctx, X, Y, TILE, TILE, th.tileA);
        px(ctx, X, Y, 2, TILE, th.wallLine); px(ctx, X + 14, Y, 2, TILE, th.wallLine);
      }
    }
  }
  for (const r of world.rooms) {
    const color = agents[r.id]?.color || '#888888';
    drawRug(ctx, r.rug, th, color);
    drawBed(ctx, r, th, color);
    for (const p of r.props) drawProp(ctx, p.kind, p.x * TILE, p.y * TILE, th, color);
    drawPlate(ctx, r, agents[r.id]?.name || r.id, color, th);
  }
  for (const d of world.decor) drawProp(ctx, d.kind, d.x * TILE, d.y * TILE, th, th.accent);
  return c;
}

// ---------- dynamic layer ----------
function spritePal(color, th) {
  return { o: th.outline, C: color, D: shade(color, -0.28), w: shade(color, 0.45), s: th.face, e: th.outline, b: th.boots };
}
const ICON_PAL = (th) => ({ o: th.outline, y: '#ffd166', w: '#ffffff', k: th.outline });

function actorBox(a) { return { x: Math.round(a.x * TILE), y: Math.round(a.y * TILE) }; }

function drawDesk(ctx, desk, beh, th, t, reduced) {
  const x = desk.tiles[0].x * TILE; const y = desk.tiles[0].y * TILE;
  const on = Boolean(beh?.monitor);
  if (on) {
    const pulse = reduced ? 0.22 : 0.18 + 0.06 * Math.sin(t / 400);
    ctx.fillStyle = alpha(th.accent, pulse); ctx.beginPath(); ctx.ellipse(x + 24, y + 14, 30, 16, 0, 0, Math.PI * 2); ctx.fill();
  }
  px(ctx, x, y + 3, 48, 12, th.outline); px(ctx, x + 1, y + 4, 46, 6, th.deskTop); px(ctx, x + 1, y + 10, 46, 4, th.desk);
  px(ctx, x + 3, y + 14, 2, 2, th.outline); px(ctx, x + 43, y + 14, 2, 2, th.outline);
  // Monitor
  px(ctx, x + 16, y - 6, 16, 11, th.outline); px(ctx, x + 23, y + 5, 2, 2, th.outline);
  const scr = on ? th.accent : (th.dark ? '#26313d' : '#3b4754');
  px(ctx, x + 17, y - 5, 14, 9, scr);
  if (on) {
    px(ctx, x + 17, y - 5, 14, 1, shade(th.accent, 0.4));
    for (let i = 0; i < 3; i++) px(ctx, x + 19, y - 3 + i * 2, 4 + ((i * 5 + Math.floor(reduced ? 0 : t / 300)) % 8), 1, shade(th.accent, 0.55));
    const label = `T-${beh.monitor.id}`.slice(0, 11);
    drawText(ctx, label, x + 24 - Math.floor(textWidth(label) / 2), y + 9, '#fff8e8');
  } else {
    px(ctx, x + 18, y - 4, 3, 1, alpha('#ffffff', 0.15));
  }
  // Keyboard and mug
  px(ctx, x + 18, y + 6, 12, 2, th.dark ? '#2c3540' : '#56616d'); px(ctx, x + 36, y + 5, 3, 3, '#e9e2d6');
}

function drawChairSeat(ctx, seat, th) { const x = seat.x * TILE; const y = seat.y * TILE; px(ctx, x + 3, y + 6, 10, 8, th.outline); px(ctx, x + 4, y + 7, 8, 6, '#5b6b7c'); }
function drawChairBack(ctx, seat, th) { const x = seat.x * TILE; const y = seat.y * TILE; px(ctx, x + 2, y + 11, 12, 5, th.outline); px(ctx, x + 3, y + 12, 10, 3, '#6d7f92'); }

function drawIcon(ctx, name, cx, y, th, t, reduced) {
  if (name === 'zzz') {
    const k = reduced ? 0 : (t / 900) % 1;
    for (let i = 0; i < 3; i++) {
      const p = (k + i / 3) % 1;
      drawText(ctx, 'Z', cx + 2 + Math.round(p * 6), y + 4 - Math.round(p * 10), alpha(th.dark ? '#dfe8ff' : '#3b4a7a', 1 - p * 0.7));
    }
    return;
  }
  const rows = ICONS[name];
  if (!rows) return;
  const bob = reduced ? 0 : Math.round(Math.sin(t / 300));
  drawMap(ctx, rows, Math.round(cx - rows[0].length / 2), y - rows.length + bob, { ...ICON_PAL(th), o: name === 'ask' ? '#ffd166' : th.outline });
}

function drawActor(ctx, a, agent, beh, th, t, reduced) {
  const { x, y } = actorBox(a);
  const pal = spritePal(agent.color, th);
  if (a.pose === 'sleep') {
    drawMap(ctx, SLEEP, x, y + 1, pal, { maxRows: 9 });
    const bx = x + 1; px(ctx, bx, y + 9, 14, 18, shade(agent.color, -0.2)); px(ctx, bx, y + 9, 14, 2, shade(agent.color, 0.15));
    px(ctx, bx, y + 9, 1, 18, th.outline); px(ctx, bx + 13, y + 9, 1, 18, th.outline);
  } else if (a.pose === 'sit' && a.mode === 'desk') {
    drawMap(ctx, SPRITES.up[0], x, y - 4, pal, { maxRows: 14 });
  } else if (a.pose === 'sit') {
    drawMap(ctx, SPRITES.down[0], x, y + 1, pal, { maxRows: 14 });
    px(ctx, x + 4, y + 14, 8, 1, pal.o);
  } else {
    const f = walkFrame(a);
    const dir = a.dir === 'left' ? 'right' : a.dir;
    const rows = (SPRITES[dir] || SPRITES.down)[f];
    const bob = f % 2 ? -1 : 0;
    px(ctx, x + 4, y + 15, 8, 1, alpha('#000000', 0.18));
    drawMap(ctx, rows, x, y + bob, pal, { mirror: a.dir === 'left' });
  }
  const icon = beh.icon && beh.icon !== 'lock' ? beh.icon : null;
  if (a.pose === 'sit' && a.mode === 'desk') {
    // Beside the head, so the task id on the desk stays readable.
    if (icon) drawIcon(ctx, icon, x + 21, y + 4, th, t, reduced);
    if (beh.star) drawMap(ctx, ICONS.star, x - 7, y - 1, ICON_PAL(th));
    return;
  }
  const top = a.pose === 'sleep' ? y - 2 : y - 1;
  if (icon) drawIcon(ctx, icon, x + 8, top, th, t, reduced);
  if (beh.star) drawMap(ctx, ICONS.star, x + (icon ? 13 : 4), top - (icon ? 4 : 7), ICON_PAL(th));
}

function drawDoor(ctx, room, th) {
  const X = room.door.x * TILE; const Y = room.door.y * TILE;
  px(ctx, X + 1, Y, 14, TILE, th.outline); px(ctx, X + 2, Y + 1, 12, 14, shade(th.wood, -0.05));
  for (let i = 5; i < 14; i += 4) px(ctx, X + i, Y + 1, 1, 14, shade(th.wood, -0.25));
  px(ctx, X + 11, Y + 8, 2, 2, '#e3c06b');
  drawMap(ctx, ICONS.lock, X + 4, Y + 4, ICON_PAL(th));
}

function draw(t) {
  const { ctx, base, world, staticLayer, th, snap } = H;
  const b = base.getContext('2d');
  b.imageSmoothingEnabled = false;
  b.drawImage(staticLayer, 0, 0);
  const reduced = Boolean(snap.reduced);
  for (const r of world.rooms) if (H.behs[r.id]?.door === 'locked') drawDoor(b, r, th);
  for (const d of world.desks) {
    drawDesk(b, d, H.behs[d.id], th, t, reduced);
    drawChairSeat(b, d.seat, th);
  }
  const list = [...H.actors.values()].sort((p, q) => p.y - q.y);
  for (const a of list) {
    const agent = H.agents[a.id]; const beh = H.behs[a.id];
    if (!agent || !beh) continue;
    drawActor(b, a, agent, beh, th, t, reduced);
    if (a.pose === 'sit' && a.mode === 'desk') drawChairBack(b, deskOf(world, a.id).seat, th);
  }
  for (const d of world.desks) {
    const a = H.actors.get(d.id);
    if (!(a && a.pose === 'sit' && a.mode === 'desk')) drawChairBack(b, d.seat, th);
  }
  if (H.hover) {
    const r = H.hover.rect;
    b.strokeStyle = th.accent; b.lineWidth = 1; b.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, H.canvas.width, H.canvas.height);
  ctx.drawImage(base, 0, 0, base.width * H.scale, base.height * H.scale);
}

// ---------- state ----------
function themeKey() {
  const cs = getComputedStyle(document.documentElement);
  return [document.documentElement.dataset.mode, ...['--bg', '--bg-2', '--accent', '--text'].map((n) => cs.getPropertyValue(n).trim())].join('|');
}

function poll() {
  H.lastPoll = performance.now();
  const snap = H.opts.snapshot();
  H.snap = snap;
  const ids = snap.agents.map((a) => a.id);
  const tk = themeKey();
  const rebuild = !H.world || ids.join(',') !== H.world.ids.join(',');
  H.agents = Object.fromEntries(snap.agents.map((a) => [a.id, a]));
  H.behs = Object.fromEntries(snap.agents.map((a) => [a.id, behaviourOf(a)]));
  if (rebuild) {
    H.world = buildWorld(ids);
    H.actors = new Map(H.world.ids.map((id) => [id, newActor(H.world, id, H.behs[id])]));
    H.base = null;
  }
  const colors = snap.agents.map((a) => `${a.id}:${a.color}:${a.name}`).join(',');
  if (rebuild || tk !== H.themeKey || colors !== H.colors || !H.staticLayer) {
    H.themeKey = tk; H.colors = colors;
    H.th = readTheme();
    H.staticLayer = buildStatic(H.world, H.th, H.agents);
    H.base = null;
  }
  if (!H.base) {
    H.base = document.createElement('canvas');
    H.base.width = H.world.w * TILE; H.base.height = H.world.h * TILE;
    resize();
  }
}

function resize() {
  if (!H?.canvas || !H.world) return;
  const dpr = window.devicePixelRatio || 1;
  const bw = H.world.w * TILE; const bh = H.world.h * TILE;
  const rect = H.el.getBoundingClientRect();
  const availW = Math.max(160, H.el.clientWidth - 2);
  const availH = Math.max(200, window.innerHeight - rect.top - 70);
  const s = Math.max(1, Math.floor(Math.min((availW * dpr) / bw, (availH * dpr) / bh)));
  H.scale = s;
  H.canvas.width = bw * s; H.canvas.height = bh * s;
  H.canvas.style.width = `${(bw * s) / dpr}px`; H.canvas.style.height = `${(bh * s) / dpr}px`;
  H.ctx = H.canvas.getContext('2d');
}

function tick(t) {
  H.raf = 0;
  if (!H.canvas?.isConnected) return stopHabitat();
  if (document.hidden) return; // resumed by visibilitychange
  const dt = Math.min(0.1, Math.max(0, (t - (H.last || t)) / 1000));
  H.last = t;
  if (t - (H.lastPoll || 0) >= POLL_MS || !H.world) poll();
  const closed = closedDoors(H.behs);
  const reduced = Boolean(H.snap.reduced);
  for (const a of H.actors.values()) stepActor(H.world, a, H.behs[a.id], dt, { reduced, closed });
  draw(t);
  if (reduced) H.timer = setTimeout(() => { H.timer = 0; if (H) H.raf = requestAnimationFrame(tick); }, POLL_MS);
  else H.raf = requestAnimationFrame(tick);
}

function start() {
  if (!H || H.raf || H.timer || document.hidden) return;
  H.last = 0;
  H.raf = requestAnimationFrame(tick);
}

// ---------- pointer ----------
function hitTest(ev) {
  const r = H.canvas.getBoundingClientRect();
  const bx = ((ev.clientX - r.left) / r.width) * H.base.width;
  const by = ((ev.clientY - r.top) / r.height) * H.base.height;
  const inside = (q) => bx >= q.x && bx < q.x + q.w && by >= q.y && by < q.y + q.h;
  const list = [...H.actors.values()].sort((p, q) => q.y - p.y);
  for (const a of list) {
    const { x, y } = actorBox(a);
    const rect = a.pose === 'sleep' ? { x, y, w: 16, h: 28 } : { x, y: y - 4, w: 16, h: 20 };
    if (inside(rect)) return { kind: 'actor', id: a.id, rect };
  }
  for (const d of H.world.desks) {
    const rect = { x: d.tiles[0].x * TILE, y: d.tiles[0].y * TILE - 6, w: 48, h: 22 };
    if (inside(rect)) return { kind: 'desk', id: d.id, rect };
  }
  for (const rm of H.world.rooms) {
    const rect = { x: rm.door.x * TILE, y: rm.door.y * TILE, w: 16, h: 16 };
    if (H.behs[rm.id]?.door === 'locked' && inside(rect)) return { kind: 'door', id: rm.id, rect };
  }
  return null;
}

function tipHtml(hit) {
  const a = H.agents[hit.id]; const beh = H.behs[hit.id];
  if (!a || !beh) return '';
  const lines = [];
  const task = a.task || a.reviewing;
  if (hit.kind === 'desk' && !beh.monitor) lines.push(`${esc(a.name)}’s desk · empty`);
  if (beh.mode === 'sleep') lines.push('Out of usage, sleeping');
  if (beh.mode === 'locked') lines.push(a.status === 'hold' ? 'Sign-in hold: door locked' : 'Signed out: door locked');
  if (a.task) lines.push(`Working on <b>T-${esc(a.task.id)}</b> ${esc(a.task.title)}`);
  if (a.reviewing) lines.push(`Reviewing <b>T-${esc(a.reviewing.id)}</b> ${esc(a.reviewing.title)}`);
  if (task?.branch) lines.push(`<span class="mono">${esc(task.branch)}</span>`);
  if (a.typing) lines.push('Typing in team chat');
  if (a.waiting) lines.push('Waiting for your answer');
  if (!lines.length) lines.push(a.note ? esc(a.note) : 'Idle in its room');
  else if (a.note && beh.mode === 'locked') lines.push(`<span class="faint">${esc(a.note)}</span>`);
  return `<b class="hab-name"><i style="background:${esc(a.color)}"></i>${esc(a.name)}${a.lead ? ' <span title="Lead">★ lead</span>' : ''}</b>${lines.map((l) => `<div>${l}</div>`).join('')}<div class="faint">${task ? 'Click to open the task' : 'Click to open its card'}</div>`;
}

function onMove(ev) {
  const hit = hitTest(ev);
  H.hover = hit;
  H.canvas.style.cursor = hit ? 'pointer' : 'default';
  const tip = H.el.querySelector('.hab-tip');
  if (!tip) return;
  if (!hit) { tip.hidden = true; return; }
  tip.innerHTML = tipHtml(hit);
  tip.hidden = false;
  const host = H.el.getBoundingClientRect();
  const x = Math.min(ev.clientX - host.left + 14, host.width - tip.offsetWidth - 4);
  tip.style.left = `${Math.max(4, x)}px`;
  tip.style.top = `${ev.clientY - host.top + 14}px`;
  if (H.snap?.reduced) draw(performance.now());
}

function onClick(ev) {
  const hit = hitTest(ev);
  if (!hit) return;
  const a = H.agents[hit.id];
  const task = a?.task || a?.reviewing;
  if (task) H.opts.openTask(task.id); else H.opts.openAgent(hit.id);
}

// ---------- public ----------
export function viewHabitat() {
  return `<div class="habitat card" id="habitat"><canvas aria-label="Habitat: each AI's room and the shared workroom" role="img"></canvas><div class="hab-tip" hidden></div></div>
    <p class="faint hab-legend">Hover an AI or a desk for details; click to open its task or its card. Desks glow while an AI works · speech bubble: typing in team chat · magnifier: reviewing · Zzz: out of usage · lock: signed out · ★ lead.</p>`;
}

export function mountHabitat(el, opts) {
  if (!el) return stopHabitat();
  if (!H) H = { actors: new Map(), behs: {}, agents: {}, snap: { agents: [] } };
  H.ro?.disconnect();
  H.el = el; H.opts = opts; H.canvas = el.querySelector('canvas'); H.ctx = H.canvas.getContext('2d');
  H.canvas.addEventListener('mousemove', onMove);
  H.canvas.addEventListener('mouseleave', () => { H.hover = null; const tip = H.el.querySelector('.hab-tip'); if (tip) tip.hidden = true; });
  H.canvas.addEventListener('click', onClick);
  // For the CI screenshot harness: where an AI is on screen.
  H.canvas.habitat = { at: (id) => { const a = H.actors.get(id); if (!a) return null; const r = H.canvas.getBoundingClientRect(); const k = r.width / H.base.width; return { x: r.left + (a.x * TILE + 8) * k, y: r.top + (a.y * TILE + 6) * k }; }, behaviour: (id) => H.behs[id] || null, actor: (id) => ({ ...H.actors.get(id) }) };
  poll();
  resize();
  if ('ResizeObserver' in window) { H.ro = new ResizeObserver(() => { resize(); draw(performance.now()); }); H.ro.observe(el); }
  draw(performance.now());
  start();
}

export function stopHabitat() {
  if (!H) return;
  if (H.raf) cancelAnimationFrame(H.raf);
  if (H.timer) clearTimeout(H.timer);
  H.raf = 0; H.timer = 0;
  H.ro?.disconnect(); H.ro = null;
  H.canvas = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden && H?.canvas?.isConnected) start(); });
  window.addEventListener('resize', () => { if (H?.canvas?.isConnected) { resize(); draw(performance.now()); } });
}

