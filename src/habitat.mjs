// The Habitat page: a cozy top-down pixel world where each AI has its own room
// and a desk in the shared workroom. Rendering only; the world logic lives in
// ./habitat/world.mjs (pure, unit tested). All art is original and drawn in code.
import { TILE, T, buildWorld, behaviourOf, newActor, stepActor, closedDoors, walkFrame, deskOf, roomOf, newPet, stepPet, kitchenSpot } from './habitat/world.mjs';
import { undoLast, setLock, freeOwnerProps, clearBoard, clearJournal, isLocked, relDay } from './habitat/actions.mjs';
import { SPRITES, SLEEP, ICONS, ICONS2, PET, glyph, textWidth } from './habitat/sprites.mjs';
import { lightAt, weatherAt, migrateStore, reconcile, resetStore, applyUnlocks, layoutOf, gardenState, moodOf, MOOD_SPEED, deskLight, opsCi, visitsFrom, effectFor, busiestAi, petGoal, boardNotes, noteText, canPlace, roomLocal, TROPHIES, ACHIEVEMENTS, UNLOCK_EVERY, unlockedCount, hashStr } from './habitat/life.mjs';

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
  } else if (kind === 'coffee') {
    px(ctx, x + 1, y + 9, 14, 6, o); px(ctx, x + 2, y + 10, 12, 4, th.wood);
    px(ctx, x + 3, y + 1, 10, 10, o); px(ctx, x + 4, y + 2, 8, 8, '#3d4650'); px(ctx, x + 4, y + 2, 8, 2, '#56616d');
    px(ctx, x + 6, y + 5, 4, 1, th.night ? '#ffb347' : '#e06c4f'); px(ctx, x + 7, y + 7, 2, 2, '#e9e2d6'); px(ctx, x + 7, y + 6, 2, 1, '#6b4a2f');
  } else if (kind === 'counter') {
    px(ctx, x, y + 6, 16, 9, o); px(ctx, x + 1, y + 7, 14, 7, th.wood); px(ctx, x + 1, y + 7, 14, 2, shade(th.wood, 0.2));
    px(ctx, x + 3, y + 3, 3, 4, '#e9e2d6'); px(ctx, x + 2, y + 4, 1, 2, '#e9e2d6'); px(ctx, x + 9, y + 2, 4, 5, '#c25b4e'); px(ctx, x + 10, y + 1, 2, 1, o);
  } else if (kind === 'fridge') {
    px(ctx, x + 2, y - 4, 12, 19, o); px(ctx, x + 3, y - 3, 10, 17, '#e8edf1'); px(ctx, x + 3, y + 3, 10, 1, '#b9c2ca');
    px(ctx, x + 11, y - 1, 1, 3, '#8a96a1'); px(ctx, x + 11, y + 6, 1, 4, '#8a96a1'); px(ctx, x + 5, y - 1, 3, 2, color);
  } else if (kind === 'heater') {
    px(ctx, x + 2, y + 4, 12, 11, o); for (let i = 0; i < 5; i++) px(ctx, x + 3 + i * 2, y + 5, 1, 9, th.night ? '#f2a65a' : '#d9d2c6');
    px(ctx, x + 3, y + 13, 10, 1, '#9a8f84');
  } else if (kind === 'tree') {
    px(ctx, x + 7, y + 9, 3, 6, '#7a5236'); const lf = th.dark ? '#3f7d4a' : '#5aa65e';
    px(ctx, x + 2, y - 4, 12, 13, o); px(ctx, x + 3, y - 3, 10, 11, lf); px(ctx, x + 4, y - 2, 4, 3, shade(lf, 0.2)); px(ctx, x + 9, y + 3, 2, 2, '#e46a5a');
  } else if (kind === 'bench') {
    px(ctx, x + 1, y + 6, 14, 5, o); px(ctx, x + 2, y + 7, 12, 3, th.wood); px(ctx, x + 2, y + 11, 2, 4, o); px(ctx, x + 12, y + 11, 2, 4, o);
  } else if (kind === 'fern') {
    px(ctx, x + 5, y + 11, 6, 4, o); px(ctx, x + 6, y + 11, 4, 3, '#8a6a9a');
    const lf = th.dark ? '#58a564' : '#4f9a58'; for (let i = 0; i < 5; i++) px(ctx, x + 2 + i * 2, y + 3 + Math.abs(2 - i), 2, 8 - Math.abs(2 - i), lf);
  } else if (kind === 'globe') {
    px(ctx, x + 6, y + 12, 4, 3, o); px(ctx, x + 4, y + 2, 9, 9, o); px(ctx, x + 5, y + 3, 7, 7, '#5a8fc2'); px(ctx, x + 6, y + 4, 3, 2, '#6fae6a'); px(ctx, x + 9, y + 7, 2, 2, '#6fae6a');
  } else if (kind === 'radio') {
    px(ctx, x + 2, y + 7, 12, 8, o); px(ctx, x + 3, y + 8, 10, 6, '#b5653f'); px(ctx, x + 4, y + 9, 5, 4, '#3a2a22'); px(ctx, x + 10, y + 9, 2, 2, '#e3c06b'); px(ctx, x + 11, y + 2, 1, 5, o);
  } else if (kind === 'teapot') {
    px(ctx, x + 4, y + 8, 8, 7, o); px(ctx, x + 5, y + 9, 6, 5, color); px(ctx, x + 12, y + 9, 2, 2, o); px(ctx, x + 2, y + 10, 2, 2, o); px(ctx, x + 7, y + 7, 2, 1, o);
  } else if (kind === 'easel') {
    px(ctx, x + 4, y + 10, 1, 5, o); px(ctx, x + 11, y + 10, 1, 5, o); px(ctx, x + 3, y + 1, 10, 10, o); px(ctx, x + 4, y + 2, 8, 8, '#f6f0e2');
    px(ctx, x + 5, y + 6, 6, 3, '#6fae6a'); px(ctx, x + 8, y + 3, 2, 2, '#f2c14e'); px(ctx, x + 5, y + 5, 3, 1, color);
  } else if (kind === 'fishbowl') {
    px(ctx, x + 3, y + 5, 10, 10, o); px(ctx, x + 4, y + 6, 8, 8, '#a8d8f0'); px(ctx, x + 4, y + 6, 8, 2, '#d6eef9'); px(ctx, x + 6, y + 9, 3, 2, '#f08a4b'); px(ctx, x + 9, y + 9, 1, 2, '#f08a4b');
  } else if (kind === 'cushion') {
    px(ctx, x + 2, y + 7, 12, 8, o); px(ctx, x + 3, y + 8, 10, 6, shade(color, 0.2)); px(ctx, x + 7, y + 10, 2, 2, shade(color, -0.2));
  } else if (kind === 'lantern') {
    px(ctx, x + 7, y + 1, 2, 2, o); px(ctx, x + 5, y + 3, 6, 10, o); px(ctx, x + 6, y + 4, 4, 8, th.night ? '#ffd27a' : '#f0d9a0'); px(ctx, x + 5, y + 13, 6, 2, o);
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

const inRect = (r, x, y) => x >= r.x0 && x < r.x0 + r.w && y >= r.y0 && y < r.y0 + r.h;

function drawPlant(ctx, X, Y, stage, wilt, i, th) {
  px(ctx, X + 1, Y + 1, 14, 14, th.dark ? '#4a3527' : '#8a6446'); px(ctx, X + 2, Y + 2, 12, 12, th.dark ? '#5a4030' : '#9c7352');
  for (let k = 0; k < 3; k++) px(ctx, X + 3 + k * 4, Y + 11, 2, 1, th.dark ? '#3c2a1f' : '#7a5538');
  const leaf = wilt === 2 ? '#8a7a3a' : wilt === 1 ? (th.dark ? '#6a8a3e' : '#8aa04a') : (th.dark ? '#4f9a5a' : '#5fae63');
  const leaf2 = shade(leaf, -0.2);
  const cx = X + 8; const droop = wilt ? 1 : 0;
  if (stage <= 0) { px(ctx, cx - 2, Y + 9, 4, 2, th.dark ? '#6b4b36' : '#b08560'); px(ctx, cx - 1, Y + 8, 1, 1, leaf); return; }
  px(ctx, cx, Y + 13 - stage * 3, 1, stage * 3, leaf2);
  if (stage >= 1) { px(ctx, cx - 2, Y + 10 + droop, 2, 1, leaf); px(ctx, cx + 1, Y + 9 + droop, 2, 1, leaf); }
  if (stage >= 2) { px(ctx, cx - 4, Y + 6 + droop, 3, 2, leaf); px(ctx, cx + 1, Y + 5 + droop, 4, 2, leaf); px(ctx, cx - 3, Y + 7 + droop, 1, 1, leaf2); }
  if (stage >= 3) {
    const fl = ['#f2c14e', '#f08aa0', '#c9a0f0', '#ff9c84', '#8fd0f0'][i % 5];
    const fy = Y + 1 + droop * 2;
    px(ctx, cx - 2, fy, 5, 3, wilt === 2 ? shade(fl, -0.35) : fl); px(ctx, cx - 1, fy - 1, 3, 5, wilt === 2 ? shade(fl, -0.35) : fl); px(ctx, cx, fy + 1, 1, 1, '#fff6d8');
  }
}

function drawWindow(ctx, X, Y, w, light, th) {
  // A small window in the back wall's face: the sky, and stars at night.
  const x = X + 3; const y = Y + 9; const ww = w - 6; const h = 6;
  px(ctx, x - 1, y - 1, ww + 2, h + 2, th.wallLine); px(ctx, x, y, ww, h, light.sky);
  if (light.stars) for (let i = 0; i < ww; i += 3) { const k = hash(X + i, Y) % 7; if (k < 3) px(ctx, x + i + (k % 2), y + 1 + k, 1, 1, '#fff6d8'); }
  if (light.phase === 'day') px(ctx, x + 1, y + 1, 3, 1, '#ffffff');
  px(ctx, x + Math.floor(ww / 2), y, 1, h, th.wallLine);
}

function drawBoard(ctx, world, th, notes) {
  const b = world.hall.board; const x = b.x * TILE; const y = b.y * TILE;
  px(ctx, x + 1, y + 1, b.w * TILE - 2, 26, th.outline); px(ctx, x + 2, y + 2, b.w * TILE - 4, 24, '#b98a5e'); px(ctx, x + 2, y + 2, b.w * TILE - 4, 1, '#d4a676');
  px(ctx, x + 6, y + 27, 2, 4, th.outline); px(ctx, x + b.w * TILE - 8, y + 27, 2, 4, th.outline);
  const rects = [];
  notes.forEach((n, i) => {
    const nx = x + 4 + i * 20; const ny = y + 4 + (i % 2);
    const paper = ['#fff3c4', '#d8f0ff', '#ffe0e6'][i % 3];
    px(ctx, nx, ny, 18, 20, shade(paper, -0.15)); px(ctx, nx, ny, 18, 19, paper); px(ctx, nx + 8, ny - 1, 2, 2, '#c25b4e');
    const t = noteText(n.text, 12);
    for (let l = 0; l < 3; l++) drawText(ctx, t.slice(l * 4, l * 4 + 4), nx + 2, ny + 2 + l * 6, th.plateInk);
    rects.push({ x: nx, y: ny - 1, w: 18, h: 21, note: n });
  });
  if (!notes.length) drawText(ctx, 'NO NEWS', x + 18, y + 11, th.plateInk);
  return rects;
}

function drawShelf(ctx, world, th, store) {
  const s = world.hall.shelf; const x = s.x * TILE; const y = s.y * TILE;
  px(ctx, x + 1, y + 2, s.w * TILE - 2, 13, th.outline); px(ctx, x + 2, y + 3, s.w * TILE - 4, 11, shade(th.wood, -0.1));
  px(ctx, x + 2, y + 8, s.w * TILE - 4, 1, th.outline); px(ctx, x + 2, y + 13, s.w * TILE - 4, 1, shade(th.wood, 0.15));
  const pal = { o: th.outline, y: '#ffd166' };
  TROPHIES.forEach((tr, i) => {
    const tx = x + 4 + i * 12; const ty = y + 2;
    if (store.trophies[tr.id]) drawMap(ctx, ICONS2.trophy, tx, ty, i === 0 ? { o: th.outline, y: '#e9eef2' } : pal);
    else px(ctx, tx + 2, ty + 4, 3, 2, alpha(th.outline, 0.35));
  });
}

function drawPlaques(ctx, room, th, ai) {
  // Each AI's own achievements as small medals on its room's visible wall.
  const got = ACHIEVEMENTS.filter((a) => ai?.ach?.[a.id]);
  if (!got.length) return;
  const y = room.side === 'top' ? (room.y0 - 1) * TILE + 9 : room.door.y * TILE + 9;
  const x0 = room.side === 'top' ? (room.x0 + 3) * TILE + 2 : room.x0 * TILE + 2;
  got.forEach((a, i) => drawMap(ctx, ICONS2.medal, x0 + i * 6, y, { o: th.outline, y: ['#ffd166', '#e9eef2', '#e3a06b', '#9fe0a8', '#c9a0f0'][i % 5] }));
}

function buildStatic(world, th, agents, extra = {}) {
  const light = extra.light || lightAt(new Date(), { dark: th.dark });
  const store = extra.store || migrateStore(null);
  const bedIdx = new Map((world.courtyard?.beds || []).map((b, i) => [`${b.x},${b.y}`, i]));
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
      const inCourt = world.courtyard && inRect(world.courtyard, x, y);
      if (bedIdx.has(`${x},${y}`)) {
        px(ctx, X, Y, TILE, TILE, th.grass);
      } else if (inCourt) {
        px(ctx, X, Y, TILE, TILE, th.grass);
        const h = hash(x, y);
        for (let i = 0; i < 3; i++) px(ctx, X + ((h >> (i * 4)) & 15), Y + ((h >> (i * 4 + 2)) & 15), 1, 2, th.grass2);
        if (t === T.PATH) { px(ctx, X + 2, Y + 3, 6, 4, th.dark ? '#6b6f7a' : '#c9c4ba'); px(ctx, X + 9, Y + 9, 5, 4, th.dark ? '#5d616b' : '#bdb7ac'); }
      } else if (t === T.KITCHEN || (t === T.PROP && world.kitchen && inRect(world.kitchen, x, y))) {
        px(ctx, X, Y, TILE, TILE, (x + y) % 2 ? mix('#e8d9bf', th.bg, th.dark ? 0.55 : 0.1) : mix('#c9b08a', th.bg, th.dark ? 0.55 : 0.1));
      } else if (t === T.GARDEN) {
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
    const mine = store.ai[r.id] || {};
    drawRug(ctx, mine.rug != null ? { ...r.rug, style: mine.rug } : r.rug, th, color);
    drawBed(ctx, r, th, color);
    const lit = mine.lamp ? { ...th, night: mine.lamp === 'on' } : th;
    for (const p of r.props) drawProp(ctx, p.kind, p.x * TILE, p.y * TILE, p.kind === 'lamp' ? lit : th, color);
    drawPlate(ctx, r, mine.plate || agents[r.id]?.name || r.id, color, th);
  }
  for (const d of world.decor) drawProp(ctx, d.kind, d.x * TILE, d.y * TILE, th, th.accent);
  for (const r of world.rooms) {
    const color = agents[r.id]?.color || '#888888';
    const lit = store.ai[r.id]?.lamp ? { ...th, night: store.ai[r.id].lamp === 'on' } : th;
    for (const p of r.extras || []) drawProp(ctx, p.kind, p.x * TILE, p.y * TILE, p.kind === 'lantern' ? lit : th, color);
    if (r.side === 'top') drawWindow(ctx, r.x0 * TILE, (r.y0 - 1) * TILE, 2 * TILE + 8, light, th);
    drawPlaques(ctx, r, th, store.ai[r.id]);
  }
  const k = world.kitchen;
  if (k) {
    drawWindow(ctx, k.window.x * TILE, k.window.y * TILE, k.window.w * TILE, light, th);
    const rx = k.rug.x * TILE + 2; const ry = k.rug.y * TILE + 3;
    px(ctx, rx, ry, k.rug.w * TILE - 4, 11, '#a8553f'); px(ctx, rx + 1, ry + 1, k.rug.w * TILE - 6, 9, '#d07a54'); for (let i = 4; i < k.rug.w * TILE - 8; i += 6) px(ctx, rx + i, ry + 4, 3, 3, '#f0b07a');
    const tx = k.table.x * TILE; const ty = k.table.y * TILE;
    px(ctx, tx + 1, ty + 2, 30, 28, th.outline); px(ctx, tx + 2, ty + 3, 28, 22, th.deskTop); px(ctx, tx + 2, ty + 25, 28, 4, th.desk);
    px(ctx, tx + 7, ty + 9, 4, 4, '#e9e2d6'); px(ctx, tx + 20, ty + 13, 4, 4, '#e9e2d6'); px(ctx, tx + 12, ty + 6, 8, 5, '#f2c14e'); px(ctx, tx + 13, ty + 5, 6, 1, '#d29a3a');
    for (const p of k.props) drawProp(ctx, p.kind, p.x * TILE, p.y * TILE, th, th.accent);
  }
  if (world.courtyard) {
    const g = gardenState(store, world.courtyard.beds.length);
    world.courtyard.beds.forEach((b, i) => drawPlant(ctx, b.x * TILE, b.y * TILE, g.stages[i], g.wilt, i, th));
    for (const p of world.courtyard.props) drawProp(ctx, p.kind, p.x * TILE, p.y * TILE, th, th.accent);
    // A little arch over the courtyard gate.
    const gx = world.courtyard.gate.x * TILE; const gy = world.courtyard.gate.y * TILE;
    px(ctx, gx, gy, TILE, TILE, th.dark ? '#5d616b' : '#c9c4ba'); px(ctx, gx, gy, 2, TILE, th.wallLine); px(ctx, gx + 14, gy, 2, TILE, th.wallLine);
    const kd = world.kitchen.door; px(ctx, kd.x * TILE, kd.y * TILE, TILE, TILE, th.tileA); px(ctx, kd.x * TILE, kd.y * TILE, 2, TILE, th.wallLine); px(ctx, kd.x * TILE + 14, kd.y * TILE, 2, TILE, th.wallLine);
  }
  if (world.hall) { c.boardRects = drawBoard(ctx, world, th, extra.notes || []); drawShelf(ctx, world, th, store); }
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

const LIGHT_COLORS = { green: '#4fd47a', amber: '#ffb547', red: '#ff5a5a' };
function drawDeskLight(ctx, desk, light, th) {
  // Status light on the desk's left corner: tests and CI on this AI's current task.
  const x = desk.tiles[0].x * TILE + 4; const y = desk.tiles[0].y * TILE + 5;
  px(ctx, x - 1, y - 1, 5, 5, th.outline);
  px(ctx, x, y, 3, 3, light ? LIGHT_COLORS[light] : (th.dark ? '#2c3540' : '#56616d'));
  if (light) px(ctx, x, y, 1, 1, '#ffffff');
}

function drawPet(ctx, pet, th, t, reduced) {
  const x = Math.round(pet.x * TILE) + 2; const y = Math.round(pet.y * TILE) + 5;
  const pal = { o: th.outline, F: '#e98a4a', f: '#c26a34', c: '#fbe7cf', e: th.outline, n: '#e8728a', t: '#fff3e0' };
  px(ctx, x + 1, y + 10, 10, 1, alpha('#000000', 0.18));
  if (pet.pose === 'walk') {
    const f = Math.floor(pet.anim * 5) % 2;
    drawMap(ctx, PET.walk[f], x, y, pal, { mirror: pet.dir === 'left' });
  } else if (pet.pose === 'nap') {
    drawMap(ctx, PET.nap, x, y, pal);
    if (!reduced) { const k = (t / 1100) % 1; drawText(ctx, 'Z', x + 9 + Math.round(k * 3), y - Math.round(k * 5), alpha(th.dark ? '#dfe8ff' : '#3b4a7a', 1 - k * 0.6)); } else drawText(ctx, 'Z', x + 10, y - 2, th.dark ? '#dfe8ff' : '#3b4a7a');
  } else drawMap(ctx, PET.sit, x, y, pal);
}

function drawEffects(ctx, list, th, t) {
  for (const e of list) {
    const k = Math.min(1, (t - e.t0) / (e.ttl * 1000));
    if (e.kind === 'paper') drawMap(ctx, ICONS2.paper, e.x, e.y, { o: th.outline, w: '#fffaf0', k: '#9aa5b1' });
    else if (e.kind === 'fly') {
      const p = e.anim ? Math.min(1, k * 1.25) : 1;
      const x = e.from.x + (e.to.x - e.from.x) * p; const y = e.from.y + (e.to.y - e.from.y) * p - (e.anim ? Math.sin(p * Math.PI) * 18 : 0);
      drawMap(ctx, ICONS2.paper, Math.round(x), Math.round(y), { o: th.outline, w: '#fffaf0', k: '#9aa5b1' });
    } else if (e.kind === 'stamp') {
      drawMap(ctx, ICONS2.paper, e.x, e.y + 2, { o: th.outline, w: '#fffaf0', k: '#9aa5b1' });
      const sc = e.anim ? Math.max(1, Math.round(3 - k * 6)) : 1;
      const rows = ICONS2.stamp;
      ctx.save(); ctx.globalAlpha = e.anim ? Math.min(1, 0.4 + k * 2) : 1;
      for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c]; if (ch === '.') continue;
        ctx.fillStyle = ch === 'o' ? th.outline : ch === 'r' ? '#d9473f' : '#ffe3dc';
        ctx.fillRect(e.x - 1 + c * sc - (sc - 1) * 3, e.y - 1 + r * sc - (sc - 1) * 3, sc, sc);
      }
      ctx.restore();
    }
  }
}

// HABITAT: actions: emote and wave bubbles, the pet's heart, watering drops.
const EMOTE_ICON = { happy: 'smile', thinking: 'dots', tired: 'cloud', celebrate: 'sparkle' };
function drawLifeFx(ctx, list, th, t, reduced) {
  for (const e of list) {
    const k = Math.min(1, (t - e.t0) / (e.ttl * 1000));
    const bob = reduced ? 0 : Math.round(Math.sin(t / 250) * 1);
    if (e.kind === 'bubble') {
      const a = H.actors.get(e.who); if (!a) continue;
      const x = Math.round(a.x * TILE) + 2; const y = Math.round(a.y * TILE) - 16 + bob;
      px(ctx, x - 1, y - 1, 14, 12, th.outline); px(ctx, x, y, 12, 10, '#ffffff'); px(ctx, x + 3, y + 10, 3, 2, th.outline);
      if (e.icon === 'wave') drawText(ctx, 'HI', x + 2, y + 3, th.plateInk);
      else { const rows = ICONS2[EMOTE_ICON[e.icon]] || ICONS2.smile; drawMap(ctx, rows, x + 6 - Math.floor(rows[0].length / 2), y + 5 - Math.floor(rows.length / 2), { o: th.outline, y: '#ffd166', w: '#ffffff', k: th.outline }); }
    } else if (e.kind === 'heart' && H.pet) {
      const x = Math.round(H.pet.x * TILE) + 4; const y = Math.round(H.pet.y * TILE) - 4 - (reduced ? 0 : Math.round(k * 8));
      drawMap(ctx, ICONS2.heart, x, y, { o: th.outline, r: '#ff6b8a' });
    } else if (e.kind === 'water' && H.world.courtyard) {
      for (const [i, b] of H.world.courtyard.beds.entries()) {
        if (i % 2) continue;
        const fall = reduced ? 4 : Math.round(((t / 120) + i * 3) % 10);
        drawMap(ctx, ICONS2.drop, b.x * TILE + 6 + (i % 3) * 2, b.y * TILE + fall, { b: '#7cc4ef' });
      }
    }
  }
}

function drawWeather(ctx, world, kind, t) {
  if (kind === 'clear' || !world.courtyard) return;
  const c = world.courtyard;
  const x0 = c.x0 * TILE; const y0 = c.y0 * TILE; const w = c.w * TILE; const h = c.h * TILE;
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
  ctx.fillStyle = kind === 'snow' ? 'rgba(255,255,255,.9)' : 'rgba(170,205,255,.7)';
  for (let i = 0; i < 46; i++) {
    const hx = hashStr(`w${i}`);
    const sp = kind === 'snow' ? 10 + (hx % 8) : 90 + (hx % 40);
    const yy = (((hx >>> 4) % h) + (t / 1000) * sp) % h;
    const drift = kind === 'snow' ? Math.sin(t / 900 + i) * 3 : -yy * 0.15;
    const xx = ((((hx >>> 12) % w) + drift) % w + w) % w;
    if (kind === 'snow') ctx.fillRect(x0 + Math.round(xx), y0 + Math.round(yy), hx % 3 ? 1 : 2, hx % 3 ? 1 : 2);
    else ctx.fillRect(x0 + Math.round(xx), y0 + Math.round(yy), 1, 3);
  }
  ctx.restore();
}

function drawLighting(ctx, world, light, lamps, th) {
  if (light.tint) { ctx.fillStyle = light.tint; ctx.fillRect(0, 0, world.w * TILE, world.h * TILE); }
  if (!light.lamps) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const l of lamps) {
    const g = ctx.createRadialGradient(l.x, l.y, 1, l.x, l.y, l.r);
    g.addColorStop(0, l.c); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  ctx.restore();
}

function lampList(world, store = null) {
  const out = [];
  const warm = 'rgba(255,196,120,.30)';
  for (const r of world.rooms) if (store?.ai?.[r.id]?.lamp !== 'off') for (const p of [...r.props, ...(r.extras || [])]) if (p.kind === 'lamp' || p.kind === 'lantern') out.push({ x: p.x * TILE + 8, y: p.y * TILE + 5, r: 26, c: warm });
  if (world.kitchen) { const h = world.kitchen.props.find((p) => p.kind === 'heater'); out.push({ x: h.x * TILE + 8, y: h.y * TILE + 9, r: 22, c: 'rgba(255,150,80,.28)' }); out.push({ x: world.kitchen.table.x * TILE + 16, y: world.kitchen.table.y * TILE + 12, r: 30, c: 'rgba(255,214,150,.20)' }); }
  for (const d of world.desks) out.push({ x: d.monitor.x * TILE + 8, y: d.monitor.y * TILE + 2, r: 14, c: 'rgba(255,220,170,.10)', desk: d.id });
  return out;
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

function drawActor(ctx, a, agent, beh, th, t, reduced, extra = {}) {
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
  if (a.errand && a.pose === 'walk') drawMap(ctx, ICONS2.paper, x + 11, y + 6, { o: th.outline, w: '#fffaf0', k: '#9aa5b1' });
  const icon = beh.icon && beh.icon !== 'lock' ? beh.icon : null;
  if (!icon && extra.chat) drawMap(ctx, ICONS2.dots, x + 4, y - 7 + (reduced ? 0 : Math.round(Math.sin(t / 350))), { o: th.outline, w: '#ffffff', k: th.outline });
  if (extra.mood === 'tired' && a.pose !== 'sleep') drawMap(ctx, ICONS2.cloud, x - 6, y - 3, { o: alpha(th.outline, 0.8), w: th.dark ? '#aeb8c4' : '#d5dbe2' });
  if (extra.mood === 'pleased' && a.pose !== 'sleep' && (reduced || Math.floor(t / 500) % 2 === 0)) drawMap(ctx, ICONS2.sparkle, x + 13, y - 2, { y: '#ffe08a' });
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
    drawDeskLight(b, d, H.lights[d.id], th);
    drawChairSeat(b, d.seat, th);
  }
  H.effects = H.effects.filter((e) => t - e.t0 < e.ttl * 1000);
  drawEffects(b, H.effects.filter((e) => e.kind === 'paper'), th, t);
  const chatting = kitchenChat();
  const list = [...H.actors.values(), ...(H.pet ? [H.pet] : [])].sort((p, q) => p.y - q.y);
  for (const a of list) {
    if (a === H.pet) { drawPet(b, a, th, t, reduced); continue; }
    const agent = H.agents[a.id]; const beh = H.behs[a.id];
    if (!agent || !beh) continue;
    drawActor(b, a, agent, beh, th, t, reduced, { mood: H.moods[a.id], chat: chatting.has(a.id) && (reduced || Math.floor(t / 2200) % 2 === [...chatting].indexOf(a.id) % 2) });
    if (a.pose === 'sit' && a.mode === 'desk') drawChairBack(b, deskOf(world, a.id).seat, th);
  }
  for (const d of world.desks) {
    const a = H.actors.get(d.id);
    if (!(a && a.pose === 'sit' && a.mode === 'desk')) drawChairBack(b, d.seat, th);
  }
  drawEffects(b, H.effects.filter((e) => e.kind !== 'paper' && !LIFE_FX.has(e.kind)), th, t);
  drawLifeFx(b, H.effects.filter((e) => LIFE_FX.has(e.kind)), th, t, reduced);
  drawWeather(b, world, H.weather, t);
  drawLighting(b, world, H.light, H.lamps, th);
  if (H.rearrange) drawRearrange(b, th);
  if (H.hover) {
    const r = H.hover.rect;
    b.strokeStyle = th.accent; b.lineWidth = 1; b.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, H.canvas.width, H.canvas.height);
  ctx.drawImage(base, 0, 0, base.width * H.scale, base.height * H.scale);
}

const LIFE_FX = new Set(['bubble', 'heart', 'water']);
// AIs on a coffee break together in the break room (two or more) chat.
function kitchenChat() {
  const k = H.world?.kitchen;
  const ids = k ? [...H.actors.values()].filter((a) => (a.goal === 'coffee' || a.goal === 'visit') && !a.path.length && a.x >= k.x0 && a.x < k.x0 + k.w && a.y >= k.y0 && a.y < k.y0 + k.h).map((a) => a.id) : [];
  return new Set(ids.length >= 2 ? ids : []);
}

function drawRearrange(ctx, th) {
  const room = roomOf(H.world, H.rearrange.id);
  if (!room) return;
  ctx.save();
  ctx.strokeStyle = alpha(th.accent, 0.55); ctx.lineWidth = 1;
  for (let y = room.y0; y < room.y0 + room.h; y++) for (let x = room.x0; x < room.x0 + room.w; x++) ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
  const sel = room.extras[H.rearrange.sel];
  if (sel) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.strokeRect(sel.x * TILE + 1, sel.y * TILE + 1, TILE - 2, TILE - 2); }
  ctx.restore();
}

// ---------- state ----------
function themeKey() {
  const cs = getComputedStyle(document.documentElement);
  return [document.documentElement.dataset.mode, ...['--bg', '--bg-2', '--accent', '--text'].map((n) => cs.getPropertyValue(n).trim())].join('|');
}
const clock = () => (H.clockAt != null ? new Date(H.clockAt) : new Date());

function saveStore() {
  H.store.rev = (H.store.rev || 0) + 1;
  H.opts.saveStore?.(JSON.parse(JSON.stringify(H.store)));
}

// HABITAT: actions the AIs wrote in team chat, played once each (instantly with reduced motion).
function playLife(ev, reduced) {
  const t = performance.now();
  const visit = (id, to, secs) => { const a = H.actors.get(id); if (a && to && H.behs[id]?.mode === 'idle') { a.visit = { to: { x: to.x, y: to.y }, until: Date.now() + secs * 1000 }; a.goal = a.goal === 'visit' ? 'rest' : a.goal; } };
  const w = H.world;
  if (ev.kind === 'go') {
    const to = ev.place === 'desk' ? deskOf(w, ev.who)?.seat : ev.place === 'room' ? roomOf(w, ev.who)?.rugSpot : ev.place === 'kitchen' ? kitchenSpot(w, new Set([...H.actors.values()].filter((a) => a.dest).map((a) => a.dest)))
      : ev.place === 'garden' ? { x: w.courtyard.x0 + 1, y: w.courtyard.y0 + 2 } : { x: w.hall.board.x + 1, y: w.hall.board.y + 2 };
    visit(ev.who, to, 45);
  } else if (ev.kind === 'coffee') {
    const k = w.kitchen;
    visit(ev.who, k.spots[0], 40); visit(ev.with, k.spots[1], 40);
  } else if (ev.kind === 'water') {
    visit(ev.who, { x: w.courtyard.x0 + 2, y: w.courtyard.y0 + 2 }, 15);
    H.effects.push({ kind: 'water', t0: t, ttl: reduced ? 4 : 5 });
  } else if (ev.kind === 'pet') H.effects.push({ kind: 'heart', t0: t, ttl: 3 });
  else if (ev.kind === 'emote') H.effects.push({ kind: 'bubble', who: ev.who, icon: ev.emote, t0: t, ttl: 5 });
  else if (ev.kind === 'wave') { H.effects.push({ kind: 'bubble', who: ev.who, icon: 'wave', t0: t, ttl: 5 }); H.effects.push({ kind: 'bubble', who: ev.to, icon: 'happy', t0: t + 600, ttl: 4 }); }
  H.lifePlayed.push({ ...ev });
  if (H.lifePlayed.length > 30) H.lifePlayed.splice(0, H.lifePlayed.length - 30);
}

function poll() {
  H.lastPoll = performance.now();
  const snap = H.opts.snapshot();
  H.snap = snap;
  const now = clock();
  const tasks = Array.isArray(snap.tasks) ? snap.tasks : [];
  const ids = snap.agents.map((a) => a.id);
  const tk = themeKey();
  // Saved progress: loaded once, then only changed by real task events or the owner.
  // AIs' HABITAT: actions change the saved store from team chat: a newer revision wins.
  if (!H.store || (Number(snap.store?.rev) || 0) > (H.store.rev || 0)) { H.store = migrateStore(snap.store); H.layoutKey = H.layoutKey === null ? null : `${H.layoutKey}*`; }
  const rec = reconcile(H.store, tasks, now.getTime());
  H.store = rec.store;
  let dirty = rec.changed;
  const open = {};
  for (const t of tasks) if (t.assignee && !['approved', 'rejected'].includes(t.stage)) open[t.assignee] = (open[t.assignee] || 0) + 1;
  H.agents = Object.fromEntries(snap.agents.map((a) => [a.id, { ...a, open: open[a.id] || 0 }]));
  H.behs = Object.fromEntries(snap.agents.map((a) => [a.id, behaviourOf(a)]));
  H.facts = Object.fromEntries(tasks.map((t) => [t.id, t]));
  let layoutKey = JSON.stringify(layoutOf(H.store));
  const rebuild = !H.world || ids.join(',') !== H.world.ids.join(',') || layoutKey !== H.layoutKey;
  if (rebuild) {
    H.world = buildWorld(ids, layoutOf(H.store));
    const un = applyUnlocks(H.store, H.world);
    if (un.changed) { H.store = un.store; dirty = true; layoutKey = JSON.stringify(layoutOf(H.store)); H.world = buildWorld(ids, layoutOf(H.store)); }
    H.layoutKey = layoutKey;
    const old = H.actors;
    H.actors = new Map(H.world.ids.map((id) => [id, old?.get(id) && old.get(id).x < H.world.w ? old.get(id) : newActor(H.world, id, H.behs[id])]));
    for (const a of H.actors.values()) { a.path = []; a.mode = null; }
    H.pet = null;
    H.lamps = lampList(H.world, H.store);
    H.base = null;
  }
  if (dirty) saveStore();
  const reduced = Boolean(snap.reduced);
  H.light = lightAt(now, { dark: document.documentElement.dataset.mode !== 'light' });
  H.weather = weatherAt(now, { reduced });
  // Moods and desk lights come straight from real counters and task results.
  H.moods = Object.fromEntries(ids.map((id) => [id, moodOf(H.store.ai[id], now.getTime())]));
  H.lights = Object.fromEntries(ids.map((id) => {
    const a = H.agents[id];
    const cur = (a.task && H.facts[a.task.id]) || tasks.filter((t) => t.assignee === id && !['approved', 'rejected'].includes(t.stage)).sort((p, q) => String(q.updatedAt || '').localeCompare(String(p.updatedAt || '')))[0];
    if (!cur) return [id, null];
    return [id, deskLight({ running: Boolean(a.task) || cur.running, tests: cur.tests, ci: cur.ci || opsCi(snap.ops, cur.id) })];
  }));
  // Visits mirror the hand-offs that just happened in this session.
  if (H.prevTasks) for (const ev of visitsFrom(H.prevTasks, tasks)) playEvent(ev, reduced);
  H.prevTasks = tasks;
  for (const ev of H.store.life?.events || []) {
    if (H.lifeSeen.has(ev.id)) continue;
    H.lifeSeen.add(ev.id);
    if (Date.now() - ev.at < 120000) playLife(ev, reduced);
  }
  const notes = boardNotes(snap.chat || [], tasks, H.store.board);
  const g = gardenState(H.store, H.world.courtyard?.beds.length);
  const sk = [tk, snap.agents.map((a) => `${a.id}:${a.color}:${a.name}`).join(','), H.light.phase, layoutKey, g.stages.join(''), g.wilt, Object.keys(H.store.trophies).join(), JSON.stringify(Object.values(H.store.ai).map((x) => Object.keys(x.ach).length)), JSON.stringify(notes), JSON.stringify(Object.values(H.store.ai).map((x) => [x.plate, x.rug, x.lamp])), H.store.relief].join('#');
  if (rebuild || sk !== H.staticKey || !H.staticLayer) {
    H.lamps = lampList(H.world, H.store);
    H.staticKey = sk;
    H.th = readTheme();
    H.th.night = H.light.lamps;
    H.notes = notes;
    H.staticLayer = buildStatic(H.world, H.th, H.agents, { light: H.light, store: H.store, notes });
    H.base = null;
  }
  if (H.th) H.th.night = H.light.lamps;
  if (!H.base) {
    H.base = document.createElement('canvas');
    H.base.width = H.world.w * TILE; H.base.height = H.world.h * TILE;
    resize();
  }
}

function deskPaperSpot(id, dx = 36) { const d = deskOf(H.world, id); return d ? { x: d.tiles[0].x * TILE + dx, y: d.tiles[0].y * TILE + 2 } : null; }

function playEvent(ev, reduced) {
  const t = performance.now();
  const eff = effectFor(ev, { reduced });
  if (ev.kind === 'review-visit') {
    const a = H.actors.get(ev.from); const d = deskOf(H.world, ev.to);
    if (!d) return;
    if (eff.walk && a) a.errand = { to: { x: d.seat.x + 1, y: d.seat.y }, task: ev.task, deskOf: ev.to };
    else { const p = deskPaperSpot(ev.to, 6); if (p) H.effects.push({ kind: 'paper', ...p, t0: t, ttl: eff.ttl }); }
    H.visits.push({ ...ev, at: Date.now() });
  } else if (ev.kind === 'stamp') {
    const p = deskPaperSpot(ev.who, 36);
    if (p) H.effects.push({ kind: 'stamp', ...p, t0: t, ttl: eff.ttl, anim: eff.anim });
    H.visits.push({ ...ev, at: Date.now() });
  } else if (ev.kind === 'handover') {
    const from = deskPaperSpot(ev.from, 28); const to = deskPaperSpot(ev.to, 28);
    if (from && to) H.effects.push({ kind: 'fly', from, to, t0: t, ttl: eff.ttl, anim: eff.fly });
    if (to) H.effects.push({ kind: 'paper', ...to, t0: t + (eff.fly ? eff.ttl * 800 : 0), ttl: 6 });
    H.visits.push({ ...ev, at: Date.now() });
  } else if (ev.kind === 'coffee' && eff.walk) {
    const a = H.actors.get(ev.who); if (a) a.coffeeNext = true;
  }
  if (H.visits.length > 20) H.visits.splice(0, H.visits.length - 20);
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
  const taken = new Set([...H.actors.values()].filter((a) => a.goal === 'coffee' && a.dest).map((a) => a.dest));
  for (const a of H.actors.values()) {
    stepActor(H.world, a, H.behs[a.id], dt, { reduced, closed, social: true, speed: MOOD_SPEED[H.moods[a.id]] || 1, taken, now: Date.now() });
    if (a.goal === 'coffee' && a.dest) taken.add(a.dest);
    if (a.delivered) {
      const p = deskPaperSpot(a.delivered.deskOf, 6);
      if (p) H.effects.push({ kind: 'paper', ...p, t0: t, ttl: 8 });
      a.delivered = null;
    }
  }
  const busy = busiestAi(Object.values(H.agents));
  const goal = petGoal(H.world, { busiest: busy, lamps: H.light.lamps, closed });
  if (!H.pet) H.pet = newPet(H.world, goal);
  stepPet(H.world, H.pet, goal, dt, { reduced, closed });
  if (!H.headless) draw(t); // the 3D lodge view reads the same state and draws it itself
  if (reduced) H.timer = setTimeout(() => { H.timer = 0; if (H) H.raf = requestAnimationFrame(tick); }, POLL_MS);
  else H.raf = requestAnimationFrame(tick);
}

function start() {
  if (!H || H.raf || H.timer || document.hidden) return;
  H.last = 0;
  H.raf = requestAnimationFrame(tick);
}

// ---------- pointer ----------
function basePoint(ev) {
  const r = H.canvas.getBoundingClientRect();
  return { bx: ((ev.clientX - r.left) / r.width) * H.base.width, by: ((ev.clientY - r.top) / r.height) * H.base.height };
}
function hitTest(ev) {
  const { bx, by } = basePoint(ev);
  const inside = (q) => bx >= q.x && bx < q.x + q.w && by >= q.y && by < q.y + q.h;
  const tx = Math.floor(bx / TILE); const ty = Math.floor(by / TILE);
  if (H.rearrange) {
    const room = roomOf(H.world, H.rearrange.id);
    if (room && inRect(room, tx, ty)) return { kind: 'tile', id: room.id, x: tx, y: ty, rect: { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE } };
    return null;
  }
  if (H.pet) {
    const rect = { x: Math.round(H.pet.x * TILE) + 1, y: Math.round(H.pet.y * TILE) + 4, w: 14, h: 12 };
    if (inside(rect)) return { kind: 'pet', rect };
  }
  const list = [...H.actors.values()].sort((p, q) => q.y - p.y);
  for (const a of list) {
    const { x, y } = actorBox(a);
    const rect = a.pose === 'sleep' ? { x, y, w: 16, h: 28 } : { x, y: y - 4, w: 16, h: 20 };
    if (inside(rect)) return { kind: 'actor', id: a.id, rect };
  }
  for (const n of H.staticLayer?.boardRects || []) if (inside(n)) return { kind: 'note', note: n.note, rect: n };
  const sh = H.world.hall?.shelf;
  if (sh) { const rect = { x: sh.x * TILE, y: sh.y * TILE, w: sh.w * TILE, h: TILE }; if (inside(rect)) return { kind: 'shelf', rect }; }
  const gd = H.world.courtyard;
  if (gd && inRect(gd, tx, ty)) return { kind: 'garden', rect: { x: gd.x0 * TILE, y: gd.y0 * TILE, w: gd.w * TILE, h: gd.h * TILE } };
  const kt = H.world.kitchen;
  if (kt && inRect(kt, tx, ty)) return { kind: 'kitchen', rect: { x: kt.x0 * TILE, y: kt.y0 * TILE, w: kt.w * TILE, h: kt.h * TILE } };
  for (const d of H.world.desks) {
    const rect = { x: d.tiles[0].x * TILE, y: d.tiles[0].y * TILE - 6, w: 48, h: 22 };
    if (inside(rect)) return { kind: 'desk', id: d.id, rect };
  }
  for (const rm of H.world.rooms) {
    const rect = { x: rm.door.x * TILE, y: rm.door.y * TILE, w: 16, h: 16 };
    if (H.behs[rm.id]?.door === 'locked' && inside(rect)) return { kind: 'door', id: rm.id, rect };
    if (inRect(rm, tx, ty)) return { kind: 'room', id: rm.id, rect: { x: rm.x0 * TILE, y: rm.y0 * TILE, w: rm.w * TILE, h: rm.h * TILE } };
  }
  return null;
}

const LIGHT_TEXT = { green: 'tests passing', amber: 'running', red: 'tests or CI failing' };
const MOOD_TEXT = { tired: 'Looks a little tired (repeated test failures or hand-offs)', pleased: 'Looks pleased (a task was approved recently)' };
function tipHtml(hit) {
  const st = H.store;
  if (hit.kind === 'pet') return `<b>${esc(st.pet.name || 'Your critter')}</b><div>${H.pet?.pose === 'nap' ? 'Napping on the warmest rug' : busiestAi(Object.values(H.agents)) ? `Keeping ${esc(H.agents[busiestAi(Object.values(H.agents))]?.name)} company` : 'Strolling about'}</div><div class="faint">Click to ${st.pet.name ? 'rename' : 'name'} it</div>`;
  if (hit.kind === 'note' && hit.note.kind === 'pin') return `<b>Note from ${esc(H.agents[hit.note.who]?.name || hit.note.who)}</b><div>${esc(hit.note.text)}</div><div class="faint">Pinned with HABITAT: note · Habitat options can clear the board</div>`;
  if (hit.kind === 'note') return `<b>${hit.note.kind === 'chat' ? `Team chat · ${esc(H.agents[hit.note.who]?.name || hit.note.who)}` : `Task T-${esc(hit.note.id)}`}</b><div>${esc(hit.note.text.slice(0, 140))}</div><div class="faint">Click to open</div>`;
  if (hit.kind === 'shelf') return `<b>Trophy shelf</b>${TROPHIES.map((tr) => `<div>${st.trophies[tr.id] ? '★' : '·'} ${esc(tr.label)}${st.trophies[tr.id] ? ` <span class="faint">${esc(new Date(st.trophies[tr.id]).toLocaleDateString())}</span>` : ''}</div>`).join('')}`;
  if (hit.kind === 'garden') { const g = gardenState(st, H.world.courtyard.beds.length); return `<b>Garden courtyard</b><div>${st.finished} task${st.finished === 1 ? '' : 's'} finished · grows one stage per finished task</div>${g.wilt ? `<div>Wilting a little: ${st.failStreak} failed test or CI results in a row</div>` : ''}${H.weather !== 'clear' ? `<div class="faint">Light ${H.weather} today</div>` : ''}`; }
  if (hit.kind === 'kitchen') return '<b>Break room</b><div>Idle AIs come here for a coffee and a chat, and after finishing a task.</div>';
  if (hit.kind === 'room') {
    const a = H.agents[hit.id]; const ai = st.ai[hit.id];
    const ach = ACHIEVEMENTS.filter((x) => ai?.ach?.[x.id]).map((x) => x.label);
    const done = ai?.done || 0; const next = (unlockedCount(done) + 1) * UNLOCK_EVERY;
    return `<b class="hab-name"><i style="background:${esc(a?.color)}"></i>${esc(a?.name)}’s room</b><div>${done} task${done === 1 ? '' : 's'} done${ach.length ? ` · ${esc(ach.join(', '))}` : ''}</div>${isLocked(st, hit.id) ? '<div>Locked: the AI can’t rearrange it</div>' : ''}${(st.journal[hit.id] || []).length ? `<div class="faint">Latest: ${esc(st.journal[hit.id].slice(-1)[0].text)}</div>` : ''}<div class="faint">${unlockedCount(done) < 8 ? `Next prop at ${next} tasks · ` : ''}Click for its journal, to rearrange or lock</div>`;
  }
  const a = H.agents[hit.id]; const beh = H.behs[hit.id];
  if (!a || !beh) return '';
  const lines = [];
  const task = a.task || a.reviewing;
  if (hit.kind === 'desk' && !beh.monitor) lines.push(`${esc(a.name)}’s desk · empty`);
  if (hit.kind === 'desk' && H.lights[hit.id]) lines.push(`Status light: ${LIGHT_TEXT[H.lights[hit.id]]}`);
  if (beh.mode === 'sleep') lines.push('Out of usage, sleeping');
  if (beh.mode === 'locked') lines.push(a.status === 'hold' ? 'Sign-in hold: door locked' : 'Signed out: door locked');
  if (a.task) lines.push(`Working on <b>T-${esc(a.task.id)}</b> ${esc(a.task.title)}`);
  if (a.reviewing) lines.push(`Reviewing <b>T-${esc(a.reviewing.id)}</b> ${esc(a.reviewing.title)}`);
  if (task?.branch) lines.push(`<span class="mono">${esc(task.branch)}</span>`);
  if (a.typing) lines.push('Typing in team chat');
  if (a.waiting) lines.push('Waiting for your answer');
  const act = H.actors.get(hit.id);
  if (act?.errand) lines.push(`Taking T-${esc(act.errand.task)} to ${esc(H.agents[act.errand.deskOf]?.name || '')} for review`);
  if (act?.goal === 'coffee') lines.push('On a coffee break');
  if (H.moods[hit.id]) lines.push(`<span class="faint">${MOOD_TEXT[H.moods[hit.id]]}</span>`);
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
  if (!hit || hit.kind === 'tile') { tip.hidden = true; if (H.snap?.reduced) draw(performance.now()); return; }
  tip.innerHTML = tipHtml(hit);
  tip.hidden = false;
  const host = H.el.getBoundingClientRect();
  const x = Math.min(ev.clientX - host.left + 14, host.width - tip.offsetWidth - 4);
  tip.style.left = `${Math.max(4, x)}px`;
  tip.style.top = `${ev.clientY - host.top + 14}px`;
  if (H.snap?.reduced) draw(performance.now());
}

function onClick(ev, forced) {
  const hit = forced !== undefined ? forced : hitTest(ev);
  if (H.rearrange) {
    if (!hit) return;
    const room = roomOf(H.world, H.rearrange.id);
    const idx = room.extras.findIndex((p) => p.x === hit.x && p.y === hit.y);
    if (idx >= 0) { H.rearrange.sel = idx; H.rearrange.msg = 'Now click a free tile to move it there.'; return renderPop(); }
    if (H.rearrange.sel == null) { H.rearrange.msg = 'Click one of the unlocked props first.'; return renderPop(); }
    const props = H.store.ai[room.id]?.props || [];
    const sel = room.extras[H.rearrange.sel];
    const pi = props.findIndex((p) => p.x === sel.lx && p.y === sel.ly && p.kind === sel.kind);
    const l = roomLocal(room, { x: hit.x, y: hit.y });
    if (pi < 0 || !canPlace(room, props, pi, l.x, l.y)) { H.rearrange.msg = 'That tile is taken or would block the way. Try another.'; return renderPop(); }
    // The owner's own placement wins: the AI can't move this prop until he frees it.
    props[pi] = { kind: props[pi].kind, x: l.x, y: l.y, owner: true };
    H.rearrange.sel = null; H.rearrange.msg = 'Moved and saved.';
    H.opts.audit?.(`Owner moved ${H.agents[room.id]?.name || room.id}’s ${props[pi].kind}`, `to ${l.x},${l.y}`);
    saveStore();
    poll();
    return renderPop();
  }
  if (!hit) return;
  if (hit.kind === 'pet') return openPop({ kind: 'pet', draft: H.store.pet.name });
  if (hit.kind === 'note' && hit.note.kind === 'pin') return;
  if (hit.kind === 'note') return hit.note.kind === 'task' ? H.opts.openTask(hit.note.id) : H.opts.openChat?.(hit.note.id);
  if (hit.kind === 'room') return openPop({ kind: 'room', id: hit.id });
  if (['shelf', 'garden', 'kitchen'].includes(hit.kind)) return;
  const a = H.agents[hit.id];
  const task = a?.task || a?.reviewing;
  if (task) H.opts.openTask(task.id); else H.opts.openAgent(hit.id);
}

// ---------- small owner menus (DOM, kept across page re-renders) ----------
function openPop(p) { H.pop = p; renderPop(); }
function renderPop() {
  const el = H.el?.querySelector('.hab-pop');
  if (!el) return;
  const p = H.pop; const r = H.rearrange;
  if (r) {
    const room = roomOf(H.world, r.id);
    const n = room?.extras.length || 0;
    el.innerHTML = `<b>Rearranging ${esc(H.agents[r.id]?.name || r.id)}’s room</b><div>${n ? esc(r.msg || 'Click an unlocked prop, then a free tile.') : `No props unlocked yet: one arrives every ${UNLOCK_EVERY} finished tasks.`}</div><div class="hab-row"><button class="btn small primary" data-hab="done">Done</button></div>`;
    el.hidden = false;
    return;
  }
  if (!p) { el.hidden = true; el.innerHTML = ''; return; }
  if (p.kind === 'room') {
    const st = H.store; const name = esc(H.agents[p.id]?.name || p.id);
    const j = (st.journal[p.id] || []).slice(-12).reverse();
    const ownerProps = (st.ai[p.id]?.props || []).filter((x) => x.owner).length;
    const undo = st.life?.undo?.[p.id];
    el.innerHTML = `<b>${name}’s room</b><div class="faint">Move its unlocked props on the room grid. Saved, and they never move by themselves.</div>
      <div class="hab-row"><button class="btn small primary" data-hab="rearrange">Rearrange</button><button class="btn small" data-hab="lock">${isLocked(st, p.id) ? 'Unlock room' : 'Lock room'}</button><button class="btn small" data-hab="close">Close</button></div>
      ${st.lockAll ? '<div class="faint">All rooms are locked from Habitat options.</div>' : ''}
      ${ownerProps ? `<div class="hab-row"><span class="faint">${ownerProps} prop${ownerProps > 1 ? 's' : ''} placed by you (the AI can’t move them)</span><button class="btn small" data-hab="freeprops">Let ${name} move them</button></div>` : ''}
      ${undo && !undo.undone ? `<div class="hab-row"><span class="faint">Last change: ${esc(undo.label)}</span><button class="btn small" data-hab="undo">Undo</button></div>` : ''}
      <div><b>Journal</b>${j.length ? `<div class="hab-journal">${j.map((e) => `<div><span class="faint">${esc(relDay(e.at, clock().getTime()))}</span> ${esc(e.text)}</div>`).join('')}</div>` : '<div class="faint">Nothing yet. HABITAT: actions, unlocks and medals are written here.</div>'}</div>
      ${j.length ? (p.confirmClear ? `<div class="hab-row"><span>Clear ${name}’s journal?</span><button class="btn small danger" data-hab="clearjournal">Clear</button><button class="btn small" data-hab="keepjournal">Keep</button></div>` : '<div class="hab-row"><button class="btn small" data-hab="askclearjournal">Clear journal…</button></div>') : ''}`;
  }
  else if (p.kind === 'pet') el.innerHTML = `<b>Name your critter</b><div class="hab-row"><input class="hab-input" maxlength="24" placeholder="e.g. Ember" value="${esc(p.draft || '')}"><button class="btn small primary" data-hab="savepet">Save</button><button class="btn small" data-hab="close">Cancel</button></div>`;
  else if (p.kind === 'menu') el.innerHTML = `<b>Habitat options</b><div class="hab-col"><button class="btn small" data-hab="namepet">Name the pet…</button><button class="btn small" data-hab="lockall">${H.store.lockAll ? 'Unlock all rooms' : 'Lock all rooms'}</button>${Object.keys(H.store.board || {}).length ? '<button class="btn small" data-hab="clearboard">Clear the AIs’ board notes</button>' : ''}${Object.entries(H.store.life?.undo || {}).filter(([, u]) => !u.undone).map(([id, u]) => `<button class="btn small" data-hab="undo:${esc(id)}">Undo ${esc(H.agents[id]?.name || id)}: ${esc(u.label)}</button>`).join('')}<button class="btn small danger" data-hab="askreset">Reset Habitat progress…</button><button class="btn small" data-hab="close">Close</button></div>`;
  else if (p.kind === 'reset') el.innerHTML = `<b>Reset Habitat progress?</b><div>This clears the garden, trophies, achievements, unlocked props and their layout, room locks, board notes, every AI’s Habitat journal, and the pet’s name. Your tasks and chat are not touched.</div><div class="hab-row"><button class="btn small danger" data-hab="reset">Reset</button><button class="btn small" data-hab="close">Cancel</button></div>`;
  el.hidden = false;
  const input = el.querySelector('.hab-input');
  if (input) { input.addEventListener('input', () => { p.draft = input.value; }); input.addEventListener('keydown', (e) => { if (e.key === 'Enter') popAction('savepet'); if (e.key === 'Escape') popAction('close'); }); setTimeout(() => input.focus(), 0); }
}
// Save a store an owner tool already gave a new revision.
function saveStoreAs() { H.store.rev -= 1; saveStore(); H.layoutKey = `${H.layoutKey}*`; poll(); }
function popAction(act) {
  if (act === 'close') { H.pop = null; }
  else if (act === 'done') { H.rearrange = null; }
  else if (act === 'rearrange') { H.rearrange = { id: H.pop.id, sel: null, msg: '' }; H.pop = null; }
  else if (act === 'namepet') { H.pop = { kind: 'pet', draft: H.store.pet.name }; }
  else if (act === 'savepet') { H.store.pet.name = String(H.pop?.draft || '').trim().slice(0, 24); saveStore(); H.pop = null; }
  else if (act === 'askreset') { H.pop = { kind: 'reset' }; }
  else if (act === 'reset') { H.store = resetStore(H.snap.tasks || [], clock().getTime()); saveStore(); H.pop = null; H.rearrange = null; H.layoutKey = null; poll(); }
  else if (act === 'menu') { H.pop = H.pop?.kind === 'menu' ? null : { kind: 'menu' }; }
  else if (act === 'lock' && H.pop?.id) { const on = !isLocked(H.store, H.pop.id); H.store = setLock(H.store, H.pop.id, on); saveStoreAs(); H.opts.audit?.(`Owner ${on ? 'locked' : 'unlocked'} ${H.agents[H.pop.id]?.name || H.pop.id}’s Habitat room`); }
  else if (act === 'lockall') { const on = !H.store.lockAll; H.store = setLock(H.store, '*', on); saveStoreAs(); H.opts.audit?.(`Owner ${on ? 'locked' : 'unlocked'} all Habitat rooms`); }
  else if (act === 'freeprops' && H.pop?.id) { H.store = freeOwnerProps(H.store, H.pop.id); saveStoreAs(); H.opts.audit?.(`Owner let ${H.agents[H.pop.id]?.name || H.pop.id} move the props he placed`); }
  else if (act === 'clearboard') { H.store = clearBoard(H.store); saveStoreAs(); H.opts.audit?.('Owner cleared the Habitat board notes'); }
  else if (act === 'askclearjournal') { H.pop.confirmClear = true; }
  else if (act === 'keepjournal') { H.pop.confirmClear = false; }
  else if (act === 'clearjournal' && H.pop?.id) { H.store = clearJournal(H.store, H.pop.id); H.pop.confirmClear = false; saveStoreAs(); H.opts.audit?.(`Owner cleared ${H.agents[H.pop.id]?.name || H.pop.id}’s Habitat journal`); }
  else if (act === 'undo' || act.startsWith('undo:')) {
    const id = act === 'undo' ? H.pop?.id : act.slice(5);
    const r = undoLast(H.store, id, clock().getTime(), Object.fromEntries(Object.entries(H.agents).map(([k, v]) => [k, v.name])));
    if (r.ok) { H.store = r.store; saveStoreAs(); H.opts.audit?.(`Owner undid: ${r.label}`); }
  }
  renderPop();
  draw(performance.now());
}

// ---------- public ----------
export function viewHabitat() {
  return `<div class="habitat card" id="habitat"><canvas aria-label="Habitat: each AI's room, the shared workroom, the break room and the garden" role="img"></canvas><div class="hab-tip" hidden></div><div class="hab-pop" hidden></div></div>
    <div class="hab-foot"><p class="faint hab-legend">Hover an AI, a desk, the board or the garden for details; click to open. Desk lights: green tests passing · amber running · red tests or CI failing. Speech bubble: typing · magnifier: reviewing · Zzz: out of usage · lock: signed out · ★ lead. The garden grows with every finished task.</p><button class="btn small" data-hab="menu">Habitat options</button></div>`;
}

export function mountHabitat(el, opts) {
  if (!el) return stopHabitat();
  if (!H) H = { actors: new Map(), behs: {}, agents: {}, snap: { agents: [] }, effects: [], visits: [], moods: {}, lights: {}, lamps: [], light: lightAt(new Date()), weather: 'clear', store: null, pop: null, rearrange: null, clockAt: null, lifeSeen: new Set(), lifePlayed: [] };
  H.ro?.disconnect();
  H.el = el; H.opts = opts; H.canvas = el.querySelector('canvas'); H.ctx = H.canvas.getContext('2d');
  H.canvas.addEventListener('mousemove', onMove);
  H.canvas.addEventListener('mouseleave', () => { H.hover = null; const tip = H.el.querySelector('.hab-tip'); if (tip) tip.hidden = true; });
  H.canvas.addEventListener('click', onClick);
  const host = el.parentElement || document;
  host.querySelectorAll('[data-hab]').forEach((b) => { if (!el.contains(b)) b.addEventListener('click', () => popAction(b.dataset.hab)); });
  el.querySelector('.hab-pop').addEventListener('click', (e) => { const b = e.target.closest('[data-hab]'); if (b) popAction(b.dataset.hab); });
  // For the CI screenshot harness: where things are and what the Habitat shows.
  const toPage = (x, y) => { const r = H.canvas.getBoundingClientRect(); const k = r.width / H.base.width; return { x: r.left + x * k, y: r.top + y * k }; };
  H.canvas.habitat = {
    at: (id) => { const a = H.actors.get(id); return a ? toPage(a.x * TILE + 8, a.y * TILE + 6) : null; },
    behaviour: (id) => H.behs[id] || null,
    actor: (id) => ({ ...H.actors.get(id) }),
    pet: () => (H.pet ? { ...H.pet, page: toPage(H.pet.x * TILE + 8, H.pet.y * TILE + 10) } : null),
    room: (id) => { const r = roomOf(H.world, id); return r ? toPage(r.bed[0].x * TILE + 8, r.bed[0].y * TILE + 8) : null; }, // the bed: never under an awake AI
    tile: (x, y) => toPage(x * TILE + 8, y * TILE + 8),
    extras: (id) => roomOf(H.world, id)?.extras.map((p) => ({ ...p })) || [],
    note: (i) => { const n = H.staticLayer?.boardRects?.[i]; return n ? toPage(n.x + 9, n.y + 10) : null; },
    store: () => JSON.parse(JSON.stringify(H.store)),
    light: () => ({ ...H.light }), weather: () => H.weather,
    deskLight: (id) => H.lights[id] || null, mood: (id) => H.moods[id] || null,
    visits: () => H.visits.map((v) => ({ ...v })), effects: () => H.effects.map((e) => e.kind),
    setClock: (ms) => { H.clockAt = ms; poll(); draw(performance.now()); },
    // Send idle AIs on a coffee break now (the same walk they take on their own).
    breakFor: (ids) => { for (const id of ids) { const a = H.actors.get(id); if (a && H.behs[id]?.mode === 'idle') { a.coffeeNext = true; a.mode = null; } } },
    kitchenIds: () => { const k = H.world.kitchen; return [...H.actors.values()].filter((a) => a.x >= k.x0 && a.x < k.x0 + k.w && a.y >= k.y0 && a.y < k.y0 + k.h).map((a) => a.id); },
    life: () => H.lifePlayed.map((e) => ({ ...e })),
    lifeFx: () => H.effects.filter((e) => LIFE_FX.has(e.kind)).map((e) => e.kind),
    journal: (id) => (H.store.journal[id] || []).map((e) => ({ ...e })),
    roomRect: (id) => { const r = roomOf(H.world, id); return r ? { x0: r.x0, y0: r.y0, side: r.side } : null; },
  };
  poll();
  resize();
  renderPop();
  if ('ResizeObserver' in window) { H.ro = new ResizeObserver(() => { resize(); draw(performance.now()); }); H.ro.observe(el); }
  draw(performance.now());
  start();
}

// The 3D lodge (src/habitat3d/) shows this same simulation: it reads the live
// state here and sends clicks back, so 2D and 3D always agree.
export function habitatEngine() {
  if (!H) return null;
  return {
    get world() { return H.world; }, get actors() { return H.actors; }, get pet() { return H.pet; }, get behs() { return H.behs; },
    get agents() { return H.agents; }, get moods() { return H.moods; }, get lights() { return H.lights; }, get light() { return H.light; },
    get weather() { return H.weather; }, get store() { return H.store; }, get effects() { return H.effects; }, get notes() { return H.notes || []; },
    get reduced() { return Boolean(H.snap?.reduced); }, get tasks() { return H.snap?.tasks || []; }, get visits() { return H.visits; }, get rearranging() { return Boolean(H.rearrange); }, get running() { return Boolean(H.raf || H.timer); },
    setHeadless(on) { H.headless = Boolean(on); if (!on && H.canvas && H.base) draw(performance.now()); },
    tip: (hit) => tipHtml(hit),
    click: (hit) => onClick(null, hit),
    clock: () => clock(),
    setClock: (ms) => { H.clockAt = ms; poll(); },
  };
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
