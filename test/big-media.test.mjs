// The window's side of big media: the clear too-big card, which picture URL is shown, the
// gallery (thumbnails, one full picture at a time) and its keyboard and controller keys.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { SAFE_MEDIA, GALLERY_MIN, thumbUrl, shownUrl, tooBigCard, previewTooBig, problemCard, hugePictureCard, galleryItems, galleryGrid, galleryViewer, galleryKey, padActions, galleryStep, progressLine } from '../src/app/bigmedia.mjs';

const GB = 1024 ** 3;

test('TOO BIG CARD: name, size, limit, why, and the actions (never silently nothing)', () => {
  const h = tooBigCard({ name: 'report.html', size: 2.8 * 1024 * 1024, limit: 2 * 1024 * 1024, reason: 'its page is 2.8 MB of HTML', kind: 'html', file: 'abc-report.html', actions: ['browser', 'reveal', 'save'] });
  for (const t of ['report.html', 'Live preview', '2.8 MB', 'limit 2.0 MB', 'its page is 2.8 MB of HTML', 'Too big to show here', 'Open in browser', 'Show in folder', 'Save as…', 'data-a="media-browser"', 'data-f="abc-report.html"']) assert.ok(h.includes(t), t);
  const p = previewTooBig({ name: 'big.html', kind: 'html', size: 12 * GB, tooBig: { reason: 'it is too large (12 GB; the limit is 10 GB per file)', limit: 10 * GB } });
  assert.match(p, /12\.0 GB/);
  assert.match(p, /limit 10\.0 GB/);
  assert.doesNotMatch(p, /Open in browser/, 'no file was kept, so no button that would fail');
  const v = problemCard({ path: '.hearth-media/huge.mp4', reason: 'it is too large (12 GB; the limit is 10 GB per file)', tooBig: true, size: 12 * GB, limit: 10 * GB, source: '.hearth-media/huge.mp4' });
  assert.match(v, /Video/);
  assert.match(v, /data-a="media-reveal-src" data-src="\.hearth-media\/huge\.mp4"/);
  assert.match(problemCard({ path: 'a.mp3', reason: 'x', tooBig: true }), /Sound/);
  assert.match(problemCard({ path: 'p.png', reason: "there isn't enough free disk space", noSpace: true, size: 5 * GB }), /free disk space/);
  const pic = hugePictureCard({ name: 'giant.png', size: 900 * 1024 * 1024, file: 'f-giant.png', huge: '40000×40000 pixels is too many to open in the app (up to 100 megapixels)' });
  assert.match(pic, /Picture/);
  assert.match(pic, /open the original/i);
  assert.match(pic, /data-a="media-open"/);
  assert.doesNotMatch(tooBigCard({ name: '<img src=x onerror=alert(1)>', reason: '"><script>' }), /<img src=x|<script>/, 'escaped');
});

test('PICTURE URLS: thumbnails and screen-sized copies come from hearth-media t/ and v/; others are left alone', () => {
  const x = { url: 'hearth-media://c/c0000000001/abc-photo.png', view: true };
  assert.equal(thumbUrl(x), 'hearth-media://t/c0000000001/abc-photo.png');
  assert.equal(shownUrl(x), 'hearth-media://v/c0000000001/abc-photo.png');
  assert.equal(shownUrl({ url: x.url }), x.url, 'a normal picture is shown as it is');
  assert.equal(thumbUrl({ url: 'data:image/png;base64,AAAA' }), 'data:image/png;base64,AAAA');
  for (const u of ['hearth-media://c/c0000000001/a.png', 'hearth-media://t/c0000000001/a.png', 'hearth-media://v/c0000000001/a.png', 'data:audio/mpeg;base64,AAAA']) assert.ok(SAFE_MEDIA.test(u), u);
  for (const u of ['hearth-media://x/c0000000001/a.png', 'file:///etc/passwd', 'https://evil/a.png', 'javascript:alert(1)']) assert.ok(!SAFE_MEDIA.test(u), u);
});

test('GALLERY: hundreds of pictures are small lazy thumbnails; the viewer loads one full picture', () => {
  const msgs = [{ id: 'm1', media: Array.from({ length: 300 }, (_, i) => ({ kind: 'image', name: `p${i}.png`, file: `abcdef${String(i).padStart(4, '0')}-p${i}.png`, url: `hearth-media://c/c0000000001/abcdef${String(i).padStart(4, '0')}-p${i}.png`, size: 1000 })) }, { id: 'm2', media: [{ kind: 'image', name: 'giant.png', url: 'hearth-media://c/c0000000001/x-giant.png', huge: 'too many' }, { kind: 'video', name: 'v.mp4', url: 'hearth-media://c/c0000000001/v.mp4' }] }, { id: 'm3', deleted: true, media: [{ kind: 'image', name: 'gone.png', url: 'hearth-media://c/c0000000001/g.png' }] }];
  const items = galleryItems(msgs);
  assert.equal(items.length, 300, 'no huge, video or deleted pictures');
  assert.ok(GALLERY_MIN <= 5);
  const grid = galleryGrid(items, { msg: 'm1', limit: 60 });
  assert.equal((grid.match(/<img /g) || []).length, 60, 'a message shows at most 60 thumbnails, then "+N more"');
  assert.match(grid, /\+240 more/);
  assert.equal((grid.match(/loading="lazy"/g) || []).length, 60);
  assert.ok(!grid.includes('hearth-media://c/'), 'only thumbnails in the grid, never the originals');
  const all = galleryGrid(items);
  assert.equal((all.match(/<img /g) || []).length, 300);
  const v = galleryViewer({ items, i: 5, zoom: 1 });
  assert.equal((v.match(/<img /g) || []).length, 1, 'one full picture at a time');
  for (const t of ['6 of 300', 'Save as…', 'Show in folder', 'Previous picture', 'Next picture', 'Zoom in', 'controller']) assert.ok(v.includes(t), t);
  assert.match(galleryViewer({ items: [{ ...items[0], view: true, url: items[0].url }], i: 0 }), /hearth-media:\/\/v\//);
});

test('GALLERY KEYS: arrows, zoom, Escape; controller D-pad, LB/RB, A zoom, B close (only on a new press)', () => {
  assert.equal(galleryKey('ArrowRight'), 'next');
  assert.equal(galleryKey('ArrowLeft'), 'prev');
  assert.equal(galleryKey('+'), 'in');
  assert.equal(galleryKey('-'), 'out');
  assert.equal(galleryKey('0'), 'fit');
  assert.equal(galleryKey('Escape'), 'close');
  assert.equal(galleryKey('q'), null);
  const press = (...i) => { const b = Array(17).fill(false); for (const x of i) b[x] = true; return b; };
  assert.deepEqual(padActions(press(15), press()), ['next']);
  assert.deepEqual(padActions(press(4), press()), ['prev']);
  assert.deepEqual(padActions(press(0), press()), ['toggle']);
  assert.deepEqual(padActions(press(1), press()), ['close']);
  assert.deepEqual(padActions(press(15), press(15)), [], 'held, not pressed again');
  let g = { items: [1, 2, 3], i: 0, zoom: 1 };
  g = galleryStep(g, 'prev'); assert.equal(g.i, 0);
  g = galleryStep(g, 'next'); g = galleryStep(g, 'next'); g = galleryStep(g, 'next'); assert.equal(g.i, 2);
  g = galleryStep(g, 'in'); assert.equal(g.zoom, 1.5);
  g = galleryStep(g, 'fit'); assert.equal(g.zoom, 1);
  g = galleryStep(g, 'toggle'); assert.equal(g.zoom, 2);
  g = galleryStep(g, 'first'); assert.equal(g.i, 0); assert.equal(g.zoom, 1);
  for (let k = 0; k < 20; k++) g = galleryStep(g, 'in');
  assert.equal(g.zoom, 8);
});

test('PROGRESS: a plain line for copies and downloads', () => {
  assert.equal(progressLine({ name: 'movie.mp4', done: 2 * GB, total: 4 * GB }), 'Copying movie.mp4 into the chat: 2.0 GB of 4.0 GB (50%)');
  assert.match(progressLine({ name: 'x.png', done: 1024 * 1024, fetch: true }), /^Downloading x\.png into the chat: 1\.0 MB$/);
  assert.match(progressLine({ name: 'v.mp4', done: 1, total: 2, attach: true }), /to attach/);
});

test('WIRING: the window uses the card, the gallery, file-backed previews and the paste limit', () => {
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(src, /previewServeFile/);
  assert.match(src, /if \(p\.tooBig\) return previewTooBig\(p, icon\)/);
  assert.match(src, /p\.tooBig \|\| p\.noSpace \? problemCard\(p, icon\)/);
  assert.match(src, /S\.modal\?\.kind === 'gallery'/);
  assert.match(src, /PASTE_MAX = 200 \* 1024 \* 1024/);
  const pre = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  for (const k of ['previewServeFile', 'mediaOpenBrowser', 'mediaReveal', 'mediaRevealSource', 'mediaCancelFetch', 'attachCancel', 'onMediaProgress']) assert.match(pre, new RegExp(`${k}:`), k);
});
