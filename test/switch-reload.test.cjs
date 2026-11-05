// Switching projects or chats reloads the window. In 1.3 and 1.4 the window's navigation guard
// (will-navigate → preventDefault) also blocked that reload, so a switch only showed after
// restarting the app. The reload now goes through the main process, and the guard lets the
// app's own page reload while still blocking any other navigation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const main = read('electron/main.cjs');
const preload = read('electron/preload.cjs');
const ui = read('src/main.js');
const ops = read('src/ops/ui.mjs');

test('the navigation guard allows reloading the app page and blocks everything else', () => {
  const m = main.match(/function sameDocument\(a, b\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'sameDocument exists');
  const sameDocument = new Function(`${m[0]}; return sameDocument;`)();
  const app = 'file:///opt/Hearth%20AI/resources/app.asar/dist/index.html';
  assert.equal(sameDocument(app, app), true, 'reload of the same page');
  assert.equal(sameDocument(`${app}#chat`, app), true, 'same page with a hash');
  assert.equal(sameDocument('https://evil.example/', app), false, 'another site');
  assert.equal(sameDocument('file:///etc/passwd', app), false, 'another file');
  assert.equal(sameDocument('not a url', app), false);
  assert.match(main, /on\('will-navigate', \(e, url\) => \{ if \(!sameDocument\(url, mainWindow\.webContents\.getURL\(\)\)\) e\.preventDefault\(\); \}\)/);
  assert.doesNotMatch(main, /mainWindow\.webContents\.on\('will-navigate', \(e\) => e\.preventDefault\(\)\)/, 'the old guard that blocked reloads is gone');
});

test('the window reloads through the main process after a project or chat switch', () => {
  assert.match(main, /handle\('app:reload', \(\) => \{[^\n]*webContents\.reload\(\)/);
  assert.match(preload, /reloadWindow: \(\) => ipcRenderer\.invoke\('app:reload'\)/);
  assert.match(ui, /function reloadApp\(\)/);
  const bare = ui.split('\n').filter((l) => l.includes('location.reload()') && !l.includes('catch(() => location.reload())') && !/^\s*return location\.reload\(\);/.test(l));
  assert.deepEqual(bare, [], 'every reload in the window goes through reloadApp');
  const sw = ops.slice(ops.indexOf("if (op === 'switch') {"), ops.indexOf("if (op === 'addfolder'"));
  assert.match(sw, /reloadWindow/, 'the project switch reloads through the main process');
});
