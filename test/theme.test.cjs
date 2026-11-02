// Following the Hearth OS desktop theme (~/.config/hearth/theme.json / theme.css).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const theme = require('../electron/theme.cjs');

test('tokens: only colors, a radius and font names get through; aliases work', () => {
  const t = theme.sanitizeTokens({ tokens: { bg: '#171a21', panel: 'rgba(42, 71, 94, .5)', text: 'red; background:url(http://x)', accent: '#1a9fff', r: 3, font: 'Inter, "Noto Sans", evil;}' }, mode: 'light', name: 'Steam' });
  assert.deepStrictEqual(t, { bg: '#171a21', panel: 'rgba(42, 71, 94, .5)', accent: '#1a9fff', r: 3, font: ['Inter', 'Noto Sans'], mode: 'light', name: 'Steam' });
  assert.deepStrictEqual(theme.sanitizeTokens({ background: '#000', foreground: '#fff', radius: '4', fontFamily: 'Cantarell' }), { bg: '#000', text: '#fff', r: 4, font: ['Cantarell'] });
  assert.equal(theme.sanitizeTokens({ r: 99 }).r, undefined);
});

test('theme.css cannot load outside resources', () => {
  const css = theme.sanitizeCss('@import url(http://evil/x.css); .a{background:url("https://evil/p.png")} .b{background:url(data:image/png;base64,AA)} </style><script>');
  assert.doesNotMatch(css, /@import|https?:\/\/evil|<\/style/);
  assert.match(css, /data:image\/png/);
});

test('reads ~/.config/hearth and reports when nothing is there', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-theme-'));
  assert.equal(theme.readTheme(dir).found, false);
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ bg: '#101010', accent: '#ff5d5d', mode: 'dark' }));
  fs.writeFileSync(path.join(dir, 'theme.css'), '.nav{letter-spacing:1px}');
  const t = theme.readTheme(dir);
  assert.ok(t.found);
  assert.equal(t.tokens.accent, '#ff5d5d');
  assert.match(t.css, /letter-spacing/);
  fs.writeFileSync(path.join(dir, 'theme.json'), '{broken');
  assert.deepStrictEqual(theme.readTheme(dir).tokens, {});
});

test('live updates fire when the desktop theme changes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-theme-'));
  let got = null;
  const stop = theme.watchTheme((t) => { got = t; }, dir);
  try {
    fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ accent: '#00ff00' }));
    for (let i = 0; i < 60 && !got; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(got?.tokens.accent, '#00ff00');
  } finally { stop(); }
});

test('detects Hearth OS from os-release (display only)', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-os-')), 'os-release');
  fs.writeFileSync(f, 'NAME="Hearth OS"\nID=hearth\nID_LIKE=debian\nVERSION_ID="1.0"\nPRETTY_NAME="Hearth OS 1.0"\n');
  assert.deepStrictEqual(theme.hearthOsRelease(f), { name: 'Hearth OS 1.0', version: '1.0' });
  fs.writeFileSync(f, 'NAME="Debian GNU/Linux"\nID=debian\n');
  assert.equal(theme.hearthOsRelease(f), null);
  assert.equal(theme.hearthOsRelease('/nonexistent'), null);
});

test('renderer turns tokens into CSS variables and picks light/dark', async () => {
  const { tokensToCss, pickMode } = await import('../src/theme.mjs');
  const css = tokensToCss({ bg: '#171a21', accent: '#1a9fff', r: 2, font: ['Inter'], text: 'bad;' });
  assert.match(css, /--bg: #171a21;/);
  assert.match(css, /--accent: #1a9fff;/);
  assert.match(css, /--r: 2px;/);
  assert.match(css, /--font: "Inter"/);
  assert.doesNotMatch(css, /bad/);
  assert.equal(tokensToCss({}), '');
  assert.equal(pickMode('hearth', { found: true, tokens: { mode: 'light' } }), 'light');
  assert.equal(pickMode('hearth', { found: false }), 'dark');
  assert.equal(pickMode('system', { systemDark: false }), 'light');
  assert.equal(pickMode('light'), 'light');
});
