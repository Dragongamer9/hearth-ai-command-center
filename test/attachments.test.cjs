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

test('images reach the CLIs from a data folder with spaces in its path', () => {
  const spaced = path.join(tmp, 'config', 'Hearth AI Command Center', 'workspaces');
  const img = att.saveBuffer(spaced, 'shot one.png', Buffer.from('png')).att.path;
  assert.match(img, / /);
  assert.deepEqual(agents.imageInputs('openai', [img]).args, ['--image', img], 'one argv entry per flag value, spaces intact');
  const claude = agents.imageInputs('anthropic', [img]);
  assert.ok(claude.prompt.split('\n').includes(img), 'Claude gets the whole path on its own line');
  assert.deepEqual(claude.dirs, [path.dirname(img)]);
  const escaped = img.replace(/ /g, '\\ ');
  assert.ok(agents.imageInputs('google', [img], { agy: true }).prompt.includes(`@${escaped}`), 'agy @path has escaped spaces');
  assert.ok(agents.imageInputs('qwen', [img]).pArg.includes(`@${escaped}`));
});

test("ATTACH paths: no absolute paths or '..', and a symlink is judged by what it points to", () => {
  assert.equal(att.agentPath(project, '/etc/passwd').ok, false);
  assert.equal(att.agentPath(project, '../outside.png').ok, false);
  assert.equal(att.agentPath(project, 'shots/../../x.png').ok, false);
  assert.equal(att.agentPath(project, 'shots/ui.png').file, path.join(project, 'shots', 'ui.png'));
  fs.writeFileSync(path.join(tmp, '.env'), 'SECRET=1');
  fs.symlinkSync('../.env', path.join(project, 'shot.png'));
  const r = att.saveFromPath(root, path.join(project, 'shot.png'), { roots: [project, root] });
  assert.equal(r.ok, false, 'shot.png -> ../.env is refused');
  const inner = path.join(project, 'real.png');
  fs.writeFileSync(inner, 'png');
  fs.symlinkSync('real.png', path.join(project, 'alias.png'));
  const ok = att.saveFromPath(root, path.join(project, 'alias.png'), { roots: [project, root] });
  assert.equal(ok.ok, true);
  assert.equal(fs.readFileSync(ok.att.path, 'utf8'), 'png', 'the real file is copied');
});

test('ffmpeg reads only the one local file with a fixed format', async () => {
  const ff = path.join(tmp, 'ffmpeg-log');
  const log = path.join(tmp, 'ff-args.log');
  fs.writeFileSync(ff, `#!/usr/bin/env node
const a = process.argv.slice(2);
require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
if (!a.includes('-frames:v')) { console.error('Duration: 00:00:06.00'); process.exit(1); }
require('fs').writeFileSync(a[a.length - 1], 'jpg');
`, { mode: 0o755 });
  const video = att.saveBuffer(root, 'clip.webm', Buffer.from('v')).att.path;
  await att.extractFrames(video, { ffmpeg: ff, count: 3 });
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(calls.length, 4);
  for (const a of calls) {
    assert.equal(a[a.indexOf('-protocol_whitelist') + 1], 'file');
    assert.equal(a[a.indexOf('-f') + 1], 'matroska');
    assert.equal(a[a.indexOf('-i') + 1], `file:${video}`);
  }
});
