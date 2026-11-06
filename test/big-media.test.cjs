// Big media and previews: the limits, the clear too-big card, the locked-down protocol
// (path traversal, Range), data: picture extraction, gallery thumbnails made once, streamed
// writes of a big file (simulated with a fake fs, nothing big is written), the disk-space check.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Readable, Writable } = require('node:stream');
const big = require('../electron/bigfiles.cjs');
const media = require('../electron/media.cjs');
const previews = require('../electron/previews.cjs');
const attachments = require('../electron/attachments.cjs');
const { createChats } = require('../electron/chats.cjs');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-big-')); made.push(d); return d; };
const CHAT = 'c0000000001';
const noRange = { get: () => '' };
const range = (v) => ({ get: (k) => (k === 'range' ? v : '') });
const readAll = async (r) => { const out = []; for await (const c of r.stream()) out.push(c); return Buffer.concat(out); };

// A real (tiny) PNG with any width/height in its header.
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const t = Buffer.from(type); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([l, t, data, c]); }
function png(w = 2, h = 2, pad = 0) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc((w * 3 + 1) * Math.min(h, 4)))), ...(pad ? [chunk('tEXt', crypto.randomBytes(pad))] : []), chunk('IEND', Buffer.alloc(0))]);
}

test('LIMITS: 10 GB per stored file, previews 1 MB inline and 2 MB of page from disk, paste 200 MB, picked 10 GB', () => {
  assert.equal(big.MAX_STORED, 10 * 1024 ** 3);
  assert.equal(media.MAX_FILE, big.MAX_STORED, 'pictures, videos, audio and files the AIs post');
  assert.equal(attachments.MAX_PICKED, big.MAX_STORED, 'files picked with the Attach button');
  assert.equal(attachments.MAX_BYTES, 200 * 1024 * 1024, 'pasted or dropped files (one IPC message from the window)');
  assert.equal(previews.MAX_FILE, 1024 * 1024, 'inline previews (in the chat file, editable in the canvas)');
  assert.equal(previews.MARKUP_MAX, 2 * 1024 * 1024, 'the measured responsive page size');
  assert.equal(media.kindOf('song.mp3'), 'audio');
  assert.equal(media.kindOf('pic.avif'), 'image');
  assert.match(media.whyNot(tmp(), 'nope.png'), /missing/);
  assert.match(big.tooBigMessage(12 * 1024 ** 3), /12 GB; the limit is 10 GB per file/);
});

test('PROTOCOL: only that chat\'s media folder; traversal, other chats, hidden part files, cache folder and symlinks are refused', () => {
  const d = tmp();
  const root = media.mediaRoot(d);
  const item = media.storeBuffer(root, CHAT, 'pic.png', png());
  media.storeBuffer(root, 'c0000000002', 'other.png', png(3, 3));
  fs.writeFileSync(path.join(d, 'secret.txt'), 'x');
  fs.writeFileSync(path.join(root, CHAT, '.part-abc'), 'half');
  fs.mkdirSync(path.join(root, CHAT, '.r'));
  fs.writeFileSync(path.join(root, CHAT, '.r', 't320-x.png.jpg'), 'thumb');
  const bad = [
    `hearth-media://c/${CHAT}/..%2F..%2Fsecret.txt`, `hearth-media://c/${CHAT}/%2e%2e%2fsecret.txt`, 'hearth-media://c/../secret.txt',
    `hearth-media://t/${CHAT}/..%2F..%2Fsecret.txt`, `hearth-media://v/${CHAT}/%2Fetc%2Fpasswd`,
    `hearth-media://c/${CHAT}/.part-abc`, `hearth-media://c/${CHAT}/.r%2Ft320-x.png.jpg`, `hearth-media://c/${CHAT}/.r/t320-x.png.jpg`,
    `hearth-media://c/c0000000002/${item.file}`, `hearth-media://x/${CHAT}/${item.file}`, `https://c/${CHAT}/${item.file}`, 'file:///etc/passwd',
  ];
  for (const u of bad) assert.equal(media.resolve(u, root).ok, false, u);
  fs.symlinkSync(path.join(d, 'secret.txt'), path.join(root, CHAT, 'abcdef1234-link.png'));
  assert.equal(media.resolve(`hearth-media://c/${CHAT}/abcdef1234-link.png`, root).ok, false, 'symlinks refused');
  assert.equal(media.respond({ url: `hearth-media://t/${CHAT}/abcdef1234-link.png`, headers: noRange }, root).status, 403);
  const ok = media.respond({ url: item.url, headers: noRange }, root);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['content-type'], 'image/png');
  assert.equal(ok.headers['x-content-type-options'], 'nosniff');
  assert.match(ok.headers['content-security-policy'], /sandbox/);
});

test('RANGE: videos and audio seek (206, suffix, open-ended), bad ranges get 416', async () => {
  const root = media.mediaRoot(tmp());
  const buf = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
  const v = media.storeBuffer(root, CHAT, 'clip.mp4', buf);
  const a = media.storeBuffer(root, CHAT, 'song.mp3', buf.subarray(0, 500));
  assert.equal(v.kind, 'video');
  assert.equal(a.kind, 'audio');
  const r1 = media.respond({ url: v.url, headers: range('bytes=100-199') }, root);
  assert.equal(r1.status, 206);
  assert.equal(r1.headers['content-range'], 'bytes 100-199/1000');
  assert.equal(r1.headers['content-length'], '100');
  assert.deepEqual(await readAll(r1), buf.subarray(100, 200));
  const r2 = media.respond({ url: v.url, headers: range('bytes=-50') }, root);
  assert.equal(r2.headers['content-range'], 'bytes 950-999/1000');
  const r3 = media.respond({ url: v.url, headers: range('bytes=900-') }, root);
  assert.equal(r3.headers['content-range'], 'bytes 900-999/1000');
  assert.equal(media.respond({ url: v.url, headers: range('bytes=2000-') }, root).status, 416);
  assert.equal(media.respond({ url: v.url, headers: range('bytes=-') }, root).status, 416);
  const r4 = media.respond({ url: a.url, headers: range('bytes=0-9') }, root);
  assert.equal(r4.headers['content-type'], 'audio/mpeg');
  assert.equal(r4.headers['accept-ranges'], 'bytes');
});

test('THUMBNAILS: made once with nativeImage (fake here), kept on disk; a picture too big to decode is never decoded', async () => {
  const root = media.mediaRoot(tmp());
  const pic = media.storeBuffer(root, CHAT, 'photo.png', png(5000, 3000, 300 * 1024));
  assert.equal(pic.width, 5000);
  assert.equal(pic.view, true, 'over 4096 px: the chat shows a screen-sized copy');
  let calls = 0;
  const render = (file, side) => { calls++; assert.ok(fs.existsSync(file)); return { buf: Buffer.from(`thumb-${side}`), ext: 'png' }; };
  const t = pic.url.replace('://c/', '://t/');
  const r1 = media.respond({ url: t, headers: noRange }, root, { render });
  assert.equal(r1.status, 200);
  assert.equal((await readAll(r1)).toString(), `thumb-${big.THUMB_SIDE}`);
  const r2 = media.respond({ url: t, headers: noRange }, root, { render });
  assert.equal((await readAll(r2)).toString(), `thumb-${big.THUMB_SIDE}`);
  assert.equal(calls, 1, 'the second time it comes from the cache on disk');
  assert.ok(fs.existsSync(path.join(root, CHAT, '.r', `t${big.THUMB_SIDE}-${pic.file}.png`)));
  const v = media.respond({ url: pic.url.replace('://c/', '://v/'), headers: noRange }, root, { render });
  assert.equal((await readAll(v)).toString(), `thumb-${big.VIEW_SIDE}`);
  assert.equal(calls, 2);
  // A small picture is its own thumbnail (nothing decoded).
  const small = media.storeBuffer(root, CHAT, 'icon.png', png(64, 64));
  assert.equal(small.view, undefined);
  const rs = media.respond({ url: small.url.replace('://c/', '://t/'), headers: noRange }, root, { render });
  assert.equal(rs.headers['content-type'], 'image/png');
  assert.equal(calls, 2);
  // 40000 x 40000: never decoded; the chat gets the clear card instead.
  const huge = media.storeBuffer(root, CHAT, 'giant.png', png(40000, 40000));
  assert.match(huge.huge, /too many to open in the app/);
  assert.equal(media.respond({ url: huge.url.replace('://c/', '://t/'), headers: noRange }, root, { render }).status, 415);
  assert.equal(calls, 2, 'the huge picture was never handed to the decoder');
  assert.equal(media.respond({ url: huge.url, headers: noRange }, root).status, 200, 'the original can still be saved or opened outside');
});

test('DATA: IMAGES: big embedded pictures are pulled out into files; scripts and small icons are left alone', () => {
  const pic = png(10, 10, 9000).toString('base64');
  const icon = png(1, 1).toString('base64');
  const html = `<html><body><img src="data:image/png;base64,${pic}"><img src='data:image/png;base64,${icon}'><div style="background:url(data:image/png;base64,${pic})"></div><script>const s = "data:image/png;base64,${pic}";</script></body></html>`;
  const stored = [];
  const r = previews.extractDataMedia(html, (name, buf) => { stored.push({ name, buf }); return `abc${stored.length}-${name}`; }, { base: 'page' });
  assert.equal(r.extracted, 2);
  assert.equal(stored[0].name, 'page-1.png');
  assert.deepEqual(stored[0].buf, Buffer.from(pic, 'base64'));
  assert.match(r.html, /<img src="a\/abc1-page-1\.png">/);
  assert.match(r.html, /url\(a\/abc2-page-2\.png\)/);
  assert.ok(r.html.includes(`data:image/png;base64,${icon}`), 'a small icon stays inline');
  assert.ok(r.html.includes(`const s = "data:image/png;base64,${pic}"`), 'a script keeps its own data URL');
});

test('BIG PREVIEW: a 2.8 MB page with an embedded picture is stored, pulled apart and served from disk with its pictures', async () => {
  const d = tmp();
  const root = media.mediaRoot(d);
  const cwd = path.join(d, 'work', '.hearth-preview');
  fs.mkdirSync(cwd, { recursive: true });
  const pic = png(64, 64, Math.round(2.2 * 1024 * 1024));
  fs.writeFileSync(path.join(cwd, 'report.html'), `<!doctype html><html><head><title>R</title></head><body><h1>Report</h1><img src="data:image/png;base64,${pic.toString('base64')}"></body></html>`);
  const got = previews.collect(path.dirname(cwd), Date.now() - 60e3);
  assert.equal(got.length, 1);
  assert.equal(got[0].big, true);
  assert.ok(got[0].size > 2.7 * 1024 * 1024);
  const p = await previews.storeBig({ root, chatId: CHAT, name: got[0].name, kind: got[0].kind, src: got[0].path });
  assert.equal(p.tooBig, undefined, 'it shows');
  assert.equal(p.extracted, 1);
  assert.ok(p.markup < 1024, 'what is left of the page is tiny');
  assert.ok(p.original && p.file && p.file !== p.original);
  assert.equal(p.content, undefined, 'no content goes into the chat file');
  const store = previews.createPreviewStore({ mediaRoot: root });
  const url = store.addFile(CHAT, p.file, 'html', false);
  const page = store.respond(url, noRange);
  assert.equal(page.status, 200);
  const id = new URL(url).host;
  assert.match(page.headers['content-security-policy'], new RegExp(`img-src data: blob: hearth-preview://${id}`));
  assert.match(page.headers['content-security-policy'], /connect-src 'none'/, 'still no network');
  const body = (await readAll(page)).toString();
  const asset = body.match(/src="a\/([^"]+)"/)[1];
  const a = store.respond(`${url}a/${asset}`, noRange);
  assert.equal(a.status, 200);
  assert.equal(a.headers['content-type'], 'image/png');
  assert.deepEqual(await readAll(a), pic);
  // Only this chat's media folder: nothing else through a/.
  const other = media.storeBuffer(root, 'c0000000002', 'other.png', png(3, 3));
  for (const bad of [`${url}a/..%2F..%2Fsecret`, `${url}a/../${p.file}`, `${url}a/%2e%2e%2fx`, `${url}a/`, `${url}a/sub/x.png`, `${url}other.html`]) assert.equal(store.respond(bad, noRange).status, 404, bad);
  assert.equal(store.respond(`${url}a/${other.file}`, noRange).status, 404, 'another chat\'s picture is refused');
  assert.throws(() => store.addFile('c0000000002', p.file, 'html'), /gone/);
  assert.throws(() => store.addFile(CHAT, '../x.html', 'html'), /gone/);
});

test('BIG PREVIEW: too big for the panel means the clear card (with the original kept for Open in browser)', async () => {
  const root = media.mediaRoot(tmp());
  const row = '<tr><td>row</td><td>12345</td></tr>';
  const page = Buffer.from(`<table>${row.repeat(Math.ceil((previews.MARKUP_MAX + 10) / row.length))}</table>`);
  const p = await previews.storeBig({ root, chatId: CHAT, name: 'table.html', kind: 'html', buf: page });
  assert.ok(p.tooBig);
  assert.equal(p.tooBig.limit, previews.MARKUP_MAX);
  assert.match(p.tooBig.reason, /the chat shows up to 2\.0 MB/);
  assert.ok(p.original, 'the original is kept so Open in browser and Save as work');
  assert.ok(fs.existsSync(path.join(root, CHAT, p.original)));
  const store = previews.createPreviewStore({ mediaRoot: root });
  assert.throws(() => store.addFile(CHAT, p.original, 'html'), /shows pages up to/, 'the cap applies when it is read, too');
  const mdp = await previews.storeBig({ root, chatId: CHAT, name: 'notes.md', kind: 'markdown', buf: Buffer.alloc(previews.MAX_FILE + 5, 'a') });
  assert.match(mdp.tooBig.reason, /Markdown/);
});

test('FENCED BLOCKS over 1 MB come out of the reply text (a note stays) and are stored like a big preview', () => {
  const body = `<p>${'x'.repeat(previews.MAX_FILE + 10)}</p>`;
  const text = `Here:\n\n\`\`\`html preview big page\n${body}\n\`\`\`\n\nand a small one:\n\n\`\`\`html preview small.html\n<p>hi</p>\n\`\`\``;
  const r = previews.bigFences(text);
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].name, 'big-page.html');
  assert.equal(r.blocks[0].buf.toString(), body);
  assert.match(r.text, /\*\(Live preview: big-page\.html\)\*/);
  assert.match(r.text, /```html preview small\.html/, 'the small one stays for the window');
  assert.ok(r.text.length < 1000);
});

// A fake fs that keeps nothing: a 200 MB file is streamed through it chunk by chunk.
function fakeFs() {
  const st = { written: 0, files: new Map(), unlinked: [], maxChunk: 0 };
  const impl = {
    createWriteStream: (p) => new Writable({ write(c, _e, cb) { st.written += c.length; st.maxChunk = Math.max(st.maxChunk, c.length); st.files.set(p, (st.files.get(p) || 0) + c.length); cb(); } }),
    createReadStream: () => { throw new Error('not used'); },
    promises: {
      mkdir: async () => {},
      unlink: async (p) => { st.unlinked.push(p); st.files.delete(p); },
      rename: async (a, b) => { st.files.set(b, st.files.get(a)); st.files.delete(a); },
      stat: async (p) => { if (!st.files.has(p)) { const e = new Error('nope'); e.code = 'ENOENT'; throw e; } return { size: st.files.get(p), isFile: () => true }; },
    },
  };
  return { st, impl };
}
const gen = (total, chunk = 1024 * 1024) => { let sent = 0; return new Readable({ read() { if (sent >= total) return this.push(null); const n = Math.min(chunk, total - sent); const b = Buffer.alloc(n, sent / chunk & 255); sent += n; this.push(b); } }); };
const plenty = async () => ({ bavail: 1e9, bsize: 4096 });

test('STREAMED WRITES: 200 MB goes to disk in chunks, hashed on the way, with progress; never held in memory', async () => {
  const total = 200 * 1024 * 1024;
  const { st, impl } = fakeFs();
  const progress = [];
  const before = process.memoryUsage().rss;
  const r = await big.streamToFile(gen(total), '/fake/media/c0000000001', 'movie.mp4', { expected: total, fsImpl: impl, statfs: plenty, onProgress: (p) => progress.push(p), every: 0 });
  const grew = process.memoryUsage().rss - before;
  assert.equal(r.ok, true, r.message);
  assert.equal(r.size, total);
  assert.equal(st.written, total);
  assert.ok(st.maxChunk <= 1024 * 1024, 'written chunk by chunk');
  assert.ok(grew < 150 * 1024 * 1024, `memory grew ${Math.round(grew / 1048576)} MB`);
  const h = crypto.createHash('sha256');
  for await (const c of gen(total)) h.update(c);
  const hex = h.digest('hex');
  assert.equal(r.hash, hex);
  assert.equal(r.file, `${hex.slice(0, 10)}-movie.mp4`, 'named by its content, like every media file');
  assert.ok(st.files.has(path.join('/fake/media/c0000000001', r.file)), 'the part file was renamed when complete');
  assert.ok(progress.length > 10 && progress.at(-1).finished);
});

test('STREAMED WRITES: Stop cancels and removes the part file; a stream that grows over the limit is refused', async () => {
  const { st, impl } = fakeFs();
  const ctl = new AbortController();
  const r = await big.streamToFile(gen(200 * 1024 * 1024), '/fake/m', 'big.webm', { fsImpl: impl, statfs: plenty, signal: ctl.signal, onProgress: (p) => { if (p.done > 50 * 1024 * 1024) ctl.abort(); }, every: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'cancelled');
  assert.equal(st.unlinked.length, 1);
  assert.equal(st.files.size, 0, 'nothing left behind');
  const f2 = fakeFs();
  const r2 = await big.streamToFile(gen(30 * 1024 * 1024), '/fake/m', 'x.mp4', { fsImpl: f2.impl, statfs: plenty, max: 20 * 1024 * 1024 });
  assert.equal(r2.code, 'too-big');
  assert.match(r2.message, /the limit is 20 MB per file/);
  assert.equal(f2.st.files.size, 0);
  const r3 = await big.streamToFile(gen(10), '/fake/m', 'x.mp4', { fsImpl: fakeFs().impl, statfs: plenty, expected: big.MAX_STORED + 1 });
  assert.equal(r3.code, 'too-big', 'a known size over 10 GB is refused before anything is written');
});

test('DISK SPACE: checked before copying; not enough room means a clear message and nothing written', async () => {
  const tiny = async () => ({ bavail: 1000, bsize: 4096 }); // about 4 MB free
  const c = await big.checkSpace('/x', 100 * 1024 * 1024, { statfs: tiny });
  assert.equal(c.ok, false);
  assert.match(c.message, /isn't enough free disk space: it needs 100 MB .* only 3\.9 MB is free/);
  const { st, impl } = fakeFs();
  const r = await big.streamToFile(gen(100 * 1024 * 1024), '/fake/m', 'v.mp4', { expected: 100 * 1024 * 1024, fsImpl: impl, statfs: tiny });
  assert.equal(r.code, 'no-space');
  assert.equal(st.written, 0);
  assert.equal((await big.checkSpace('/x', 10, { statfs: plenty })).ok, true);
  const real = await big.freeSpace(path.join(tmp(), 'not', 'made', 'yet'));
  assert.ok(real === null || real > 0, 'a folder that does not exist yet is checked on its parent');
});

test('COLLECT: a big file the AI made is streamed into the chat (progress); over the limit or no room gives the card data', async () => {
  const d = tmp();
  const cwd = path.join(d, 'work');
  fs.mkdirSync(path.join(cwd, '.hearth-media'), { recursive: true });
  const root = media.mediaRoot(d);
  const vid = Buffer.alloc(big.SMALL + 1024 * 1024, 7);
  fs.writeFileSync(path.join(cwd, '.hearth-media', 'clip.mp4'), vid);
  fs.writeFileSync(path.join(cwd, 'huge.mp4'), '');
  fs.truncateSync(path.join(cwd, 'huge.mp4'), media.MAX_FILE + 1); // sparse: takes no disk space
  const progress = [];
  const r = await media.collectAll({ cwd, sinceMs: Date.now() - 60e3, text: 'ATTACH: huge.mp4', chatId: CHAT, root, onProgress: (p) => progress.push(p) });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].kind, 'video');
  assert.equal(r.items[0].size, vid.length);
  assert.ok(progress.some((p) => p.name === 'clip.mp4' && p.finished));
  const p = r.problems.find((x) => x.path === 'huge.mp4');
  assert.ok(p, JSON.stringify(r.problems));
  assert.equal(p.tooBig, true);
  assert.equal(p.size, media.MAX_FILE + 1);
  assert.equal(p.limit, media.MAX_FILE);
  assert.equal(p.source, 'huge.mp4', 'Show in folder finds it in the AI\'s folder');
  assert.equal(r.problems.filter((x) => /huge/.test(x.path)).length, 1, 'reported once (named and scanned)');
  const full = await media.collectAll({ cwd, sinceMs: Date.now() - 60e3, text: '', chatId: 'c0000000003', root, statfs: async () => ({ bavail: 10, bsize: 4096 }) });
  const ns = full.problems.find((x) => x.noSpace);
  assert.ok(ns, JSON.stringify(full.problems));
  assert.match(ns.reason, /isn't enough free disk space/);
});

test('CHAT DELETE: media stays while the chat can be restored, and goes when it falls out of the bin', () => {
  const d = tmp();
  const gone = [];
  let t = 0;
  const chats = createChats(d, { onPurge: (id) => gone.push(id), now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString() });
  const ids = [];
  for (let i = 0; i < 52; i++) { const c = chats.create(); ids.push(c.id); }
  for (const id of ids) chats.remove(id);
  assert.deepEqual(gone.sort(), ids.slice(0, 2).sort(), 'the two oldest deleted chats left the bin; their media goes');
});
