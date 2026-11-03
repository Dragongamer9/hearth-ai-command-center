// Image sizes, hardware detection, Real-ESRGAN release parsing, background jobs and the
// checkpoint excluding .hearth-ai/ even when .gitignore is edited.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const media = require('../electron/ops/media.cjs');
const { createJobs, jobStatus } = require('../electron/ops/jobs.cjs');
const workspace = require('../electron/workspace.cjs');

test('image dimensions from PNG, GIF, JPEG and WebP headers', () => {
  const png = Buffer.alloc(32); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(1920, 16); png.writeUInt32BE(1080, 20);
  assert.deepEqual(media.imageSize(png), { width: 1920, height: 1080 });
  const gif = Buffer.alloc(32); gif.write('GIF89a'); gif.writeUInt16LE(640, 6); gif.writeUInt16LE(480, 8);
  assert.deepEqual(media.imageSize(gif), { width: 640, height: 480 });
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(media.imageSize(jpg), { width: 1920, height: 1080 });
  const webp = Buffer.alloc(32); webp.write('RIFF'); webp.write('WEBP', 8); webp.write('VP8X', 12); webp.writeUIntLE(3839, 24, 3); webp.writeUIntLE(2159, 27, 3);
  assert.deepEqual(media.imageSize(webp), { width: 3840, height: 2160 });
  assert.equal(media.imageSize(Buffer.from('hello world, not an image')), null);
});

test('hardware: NVIDIA and big AMD cards count as graphics memory, APUs as RAM', () => {
  assert.deepEqual(media.parseHardware({ totalBytes: 32 * 2 ** 30, nvidiaMiB: '12227\n' }), { ramGb: 32, vramGb: 12, discrete: true, gpu: 'NVIDIA' });
  assert.equal(media.parseHardware({ totalBytes: 16 * 2 ** 30, amdVramBytes: [16 * 2 ** 30] }).discrete, true);
  const ally = media.parseHardware({ totalBytes: 16 * 2 ** 30, amdVramBytes: [4 * 2 ** 30] });
  assert.equal(ally.discrete, false);
  assert.equal(media.parseHardware({ totalBytes: 8 * 2 ** 30 }).gpu, null);
});

test('Real-ESRGAN: the Linux zip from the release, with its sha256 when published', () => {
  const rel = { assets: [{ name: 'realesrgan-ncnn-vulkan-20220424-windows.zip' }, { name: 'realesrgan-ncnn-vulkan-20220424-ubuntu.zip', browser_download_url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip', digest: `sha256:${'a'.repeat(64)}` }] };
  assert.deepEqual(media.pickEsrganAsset(rel), { name: 'realesrgan-ncnn-vulkan-20220424-ubuntu.zip', url: rel.assets[1].browser_download_url, sha256: 'a'.repeat(64) });
  assert.equal(media.pickEsrganAsset({ assets: [{ ...rel.assets[1], digest: null }] }).sha256, null);
  assert.equal(media.pickEsrganAsset({}), null);
  assert.deepEqual(media.ffmpegScaleArgs('in.png', 'out.png', 2160), ['-y', '-i', 'in.png', '-vf', 'scale=-2:2160:flags=lanczos', 'out.png']);
  assert.deepEqual(media.TARGETS, { '1080p': 1080, '1440p': 1440, '4k': 2160 });
});

test('jobs: detached, listed across restarts, lost when the process vanished, cancellable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-'));
  let alive = true;
  const j = createJobs({ dir, spawnRunner: () => 999999, isAlive: () => alive });
  const a = j.start({ agent: 'google', kind: 'image', title: 'icon', prompt: 'draw' });
  assert.equal(a.status, 'running');
  const again = createJobs({ dir, spawnRunner: () => 1, isAlive: () => alive }); // "app restarted"
  assert.equal(again.list()[0].id, a.id);
  fs.writeFileSync(path.join(dir, `${a.id}.result.json`), JSON.stringify({ ok: true, text: 'ATTACH: .hearth-ai/assets/google/icon.png', at: 'x' }));
  assert.equal(again.list()[0].status, 'done');
  const b = j.start({ agent: 'openai', kind: 'background', title: 'research' });
  alive = false;
  assert.equal(j.list().find((x) => x.id === b.id).status, 'lost');
  const c = j.start({ agent: 'openai', kind: 'background', title: 'more' });
  assert.equal(j.cancel(c.id).job.status, 'cancelled');
  assert.equal(jobStatus({ status: 'running', pid: 1 }, { ok: false }, () => true), 'failed');
  const runner = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ops', 'job-runner.cjs'), 'utf8');
  assert.match(runner, /agents\.runAgent/);
  const index = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ops', 'index.cjs'), 'utf8');
  assert.match(index, /detached: true, stdio: 'ignore'/);
  assert.match(index, /child\.unref\(\)/);
});

test('checkpoints never commit .hearth-ai/, even if .gitignore is edited; they list the files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.name', 'T'); g('config', 'user.email', 't@x');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a'); g('add', '.'); g('commit', '-qm', 'init');
  fs.mkdirSync(path.join(dir, '.hearth-ai', 'assets', 'google'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.hearth-ai', 'assets', 'google', 'x.png'), 'img');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
  const cp = await workspace.checkpoint(dir, { message: 'work' });
  assert.ok(cp.sha);
  assert.deepEqual(cp.files.sort(), ['b.txt'], 'the tracked .gitignore is never edited');
  assert.equal(fs.existsSync(path.join(dir, '.gitignore')), false);
  fs.writeFileSync(path.join(dir, '.gitignore'), '!.hearth-ai/\n'); // the owner or an AI edits it
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c');
  const cp2 = await workspace.checkpoint(dir, { message: 'more' });
  assert.ok(!cp2.files.some((f) => f.startsWith('.hearth-ai')));
  assert.ok(!g('ls-files').includes('.hearth-ai'));
});
