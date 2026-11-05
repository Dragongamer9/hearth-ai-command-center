// Electron has no window.prompt: keys and tokens are asked in the app's own dialog.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('no window.prompt anywhere in the window code; keys use the app dialog', () => {
  const dir = path.join(__dirname, '..', 'src');
  const files = [path.join(dir, 'main.js'), ...fs.readdirSync(path.join(dir, 'app')).map((f) => path.join(dir, 'app', f))].filter((f) => /\.(m?js)$/.test(f));
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(code, /window\.prompt\s*\(|window\.prompt\?\.\(/, f);
  }
  const main = fs.readFileSync(path.join(dir, 'main.js'), 'utf8');
  assert.match(main, /function secretPrompt\(label/);
  assert.match(main, /type="password" id="secret-in"/);
});
