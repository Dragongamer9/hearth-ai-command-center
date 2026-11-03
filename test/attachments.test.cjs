const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const att = require('../electron/attachments.cjs');
const agents = require('../electron/agents.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-att-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const root = path.join(tmp, 'workspaces');
const project = path.join(tmp, 'project');
fs.mkdirSync(project, { recursive: true });

test('pasted images and videos are stored in .hearth-ai/attachments', () => {
  const r = att.saveBuffer(root, 'Screen Shot 1.png', Buffer.from([137, 80, 78, 71]));
  assert.equal(r.ok, true);
  assert.equal(r.att.kind, 'image');
  assert.ok(r.att.path.startsWith(path.join(root, '.hearth-ai', 'attachments') + path.sep));
  assert.ok(fs.existsSync(r.att.path));
  assert.match(path.basename(r.att.path), /^[0-9a-f]{10}-Screen_Shot_1\.png$/);
  assert.equal(att.saveBuffer(root, 'clip.mov', Buffer.from('x')).att.kind, 'video');
  assert.equal(att.saveBuffer(root, 'notes.txt', Buffer.from('x')).ok, false, 'only images and videos');
  assert.equal(att.saveBuffer(root, '../../evil.png', Buffer.from('x')).att.path.includes('..'), false);
});

test('size cap: 200 MB per file, with a clear message', () => {
  assert.equal(att.MAX_BYTES, 200 * 1024 * 1024);
  const r = att.saveBuffer(root, 'big.mp4', Buffer.alloc(2048), { max: 1024 });
  assert.equal(r.ok, false);
  assert.match(r.message, /attachments can be up to/);
  const big = path.join(project, 'big.webm');
  fs.writeFileSync(big, Buffer.alloc(4096));
  assert.match(att.saveFromPath(root, big, { roots: [project], max: 1024 }).message, /up to/);
});

test("an AI's file is copied in from the workspace; paths outside it are refused", () => {
  const shot = path.join(project, 'shots', 'ui.png');
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  fs.writeFileSync(shot, 'png');
  const r = att.saveFromPath(root, shot, { roots: [project, root] });
  assert.equal(r.ok, true);
  fs.unlinkSync(shot);
  assert.ok(fs.existsSync(r.att.path), 'the chat keeps it even if the AI deletes the original');
  const outside = path.join(tmp, 'outside.png');
  fs.writeFileSync(outside, 'png');
  const no = att.saveFromPath(root, outside, { roots: [project, root] });
  assert.equal(no.ok, false);
  assert.match(no.message, /inside the project workspace/);
  const sneaky = path.join(project, '..', 'outside.png');
  assert.equal(att.saveFromPath(root, sneaky, { roots: [project, root] }).ok, false);
  fs.symlinkSync(outside, path.join(project, 'link.png'));
  assert.equal(att.saveFromPath(root, path.join(project, 'link.png'), { roots: [project, root] }).ok, false, 'symlinks out of the workspace are refused');
});

test('video frames come from ffmpeg (mocked); a missing ffmpeg says so', async () => {
  const ff = path.join(tmp, 'ffmpeg');
  fs.writeFileSync(ff, `#!/usr/bin/env node
const a = process.argv.slice(2);
if (!a.includes('-frames:v')) { console.error('  Duration: 00:00:12.00, start: 0.000000'); process.exit(1); }
require('fs').writeFileSync(a[a.length - 1], 'jpg');
`, { mode: 0o755 });
  const video = att.saveBuffer(root, 'demo.mp4', Buffer.from('video')).att.path;
  const r = await att.extractFrames(video, { ffmpeg: ff, count: 4 });
  assert.equal(r.ok, true);
  assert.equal(r.duration, 12);
  assert.equal(r.frames.length, 4);
  for (const f of r.frames) assert.ok(fs.existsSync(f));
  assert.equal((await att.extractFrames(video, { ffmpeg: ff, count: 10 })).frames.length, 6, 'at most 6');
  const none = await att.extractFrames(video, { ffmpeg: null });
  assert.equal(none.ok, false);
  assert.equal(none.note, 'video attached (frames unavailable: install ffmpeg)');
});

test('each CLI gets images the way it supports', () => {
  const img = att.saveBuffer(root, 'a.png', Buffer.from('png')).att.path;
  const claude = agents.imageInputs('anthropic', [img]);
  assert.match(claude.prompt, new RegExp(img.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.deepEqual(claude.dirs, [path.dirname(img)]);
  assert.deepEqual(agents.imageInputs('openai', [img]).args, ['--image', img]);
  assert.match(agents.imageInputs('google', [img], { agy: true }).prompt, new RegExp(`@${img.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(agents.imageInputs('qwen', [img]).pArg, /@\//);
  assert.match(agents.imageInputs('xai', [img]).prompt, /can't view images here/);
  assert.deepEqual(agents.imageInputs('openai', ['/no/such/file.png']).args, [], 'missing files are dropped');
  assert.deepEqual(agents.imageInputs('openai', ['relative.png']).args, []);
});
