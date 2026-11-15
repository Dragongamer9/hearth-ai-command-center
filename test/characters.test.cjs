// 3.13 (compact-A9): each AI's character. Files are copied into the app's own folder and served read only from
// hearth-char://, never from anywhere else; the Live2D/VRM renderer runs in a sealed page; settings keep only what's valid.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const c = require('../electron/characters.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-char-'));

test('a picture, a VRM and a Live2D folder are copied in and served only from inside', () => {
  const d = tmp(); const x = c.create({ dataDir: () => d });
  fs.writeFileSync(path.join(d, 'fox.png'), 'png');
  assert.equal(x.importFrom('anthropic', 'picture', path.join(d, 'fox.png')), 'picture/picture.png');
  fs.writeFileSync(path.join(d, 'pilot.vrm'), 'glb');
  assert.equal(x.importFrom('openai', 'vrm', path.join(d, 'pilot.vrm')), 'vrm/model.vrm');
  const l2 = path.join(d, 'twin'); fs.mkdirSync(path.join(l2, 'tex'), { recursive: true });
  fs.writeFileSync(path.join(l2, 'twin.model3.json'), '{}'); fs.writeFileSync(path.join(l2, 'tex', 'a.png'), 'png');
  assert.equal(x.importFrom('google', 'live2d', path.join(l2, 'twin.model3.json')), 'live2d/twin.model3.json');
  assert.ok(x.resolve('hearth-char://a/google/live2d/tex/a.png'));
  for (const u of ['hearth-char://a/../secret', 'hearth-char://a/google/../../x', 'hearth-char://a/BAD/x', 'hearth-char://x/y', 'file:///etc/passwd']) assert.equal(x.resolve(u), null, u);
  fs.writeFileSync(path.join(d, 'secret.txt'), 'x');
  fs.symlinkSync(path.join(d, 'secret.txt'), path.join(d, 'characters', 'anthropic', 'picture', 'link.png'));
  assert.equal(x.resolve('hearth-char://a/anthropic/picture/link.png'), null, 'no symlinks out');
  assert.throws(() => x.importFrom('anthropic', 'picture', path.join(d, 'pilot.vrm')), /PNG, GIF, WebP or JPEG/);
  assert.throws(() => x.importFrom('google', 'live2d', path.join(d, 'fox.png')), /model3\.json/);
});

test('the renderer runs in a sealed page that only loads the app\'s own files', () => {
  const x = c.create({ dataDir: () => tmp() });
  const p = x.resolve('hearth-char://stage/?kind=vrm&url=' + encodeURIComponent('hearth-char://a/openai/vrm/model.vrm'));
  assert.equal(p.mime, 'text/html');
  assert.match(p.body, /default-src 'none'; script-src hearth-char:/);
  assert.equal(x.resolve('hearth-char://stage/?kind=vrm&url=https://evil.example/x.vrm'), null);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(ui, /f\.setAttribute\('sandbox', 'allow-scripts'\)/);
  assert.doesNotMatch(ui, /allow-same-origin/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'), /script-src 'self';/);
});

test('settings keep only a valid character for each AI', () => {
  assert.deepEqual(c.clean({ anthropic: { kind: 'starter', starter: 'ember-fox' }, openai: { kind: 'vrm', file: '../x' }, google: { kind: 'picture', file: '/etc/passwd' }, BAD: { kind: 'none' }, xai: { kind: 'none', motion: false } }),
    { anthropic: { kind: 'starter', starter: 'ember-fox', motion: true }, xai: { kind: 'none', motion: false } });
});
