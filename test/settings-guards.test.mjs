// Guards in the app code that can't run outside Electron: checked in the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); const j = src.indexOf(b, i + a.length); return src.slice(i, j < 0 ? undefined : j); };

test('upgrading never turns pushes on: lead GitHub is off until the owner turns it on, and autoPush=false always wins', () => {
  assert.match(main, /leadGitHub: s\.leadGitHub === true,/);
});

test('merges send the approved commit; the main process checks it and the lead switch itself', () => {
  const merge = between(main, "handle('git:mergeApproved'", "handle('git:");
  assert.match(merge, /rev-parse', 'HEAD'\]\)\)\.out !== sha/);
  assert.match(merge, /if \(s\.leadActions !== true\) return/);
  assert.match(between(main, "handle('git:prMerge'", "handle('git:"), /if \(s\.leadActions !== true\) return/);
  assert.match(between(main, "handle('git:leadSync'", "handle('git:"), /if \(s\.leadGitHub !== true\) return/);
});

test('Combining branches refuses workspaces with unsaved changes (main process)', () => {
  assert.match(between(main, "handle('git:releaseBranch'", "handle('git:"), /has unsaved changes/);
});

test('text size is opt-in, validated, persisted and restored on renderer load', () => {
  assert.match(main, /const TEXT_SIZES = \[100, 115, 130, 150\]/);
  assert.match(main, /textSize: TEXT_SIZES.includes\(s.textSize\) \? s.textSize : 100/);
  assert.match(main, /on\('did-finish-load', \(\) => \{\s*mainWindow.webContents.setZoomFactor\(readSettings\(\).textSize \/ 100\)/);
  const setter = between(main, "handle('settings:set',", "handle('settings:addDir'");
  assert.match(setter, /if \(!TEXT_SIZES.includes\(patch.textSize\)\) throw/);
  assert.ok(setter.indexOf('writeSettings(s)') < setter.indexOf('setZoomFactor'));
});

test('saved text size survives unrelated edits and is reapplied on renderer recovery', () => {
  let saved = { textSize: 100, theme: 'hearth' };
  let zoom = 1;
  let setSettings;
  let restore;
  const context = {
    TEXT_SIZES: [100, 115, 130, 150], THEMES: ['hearth'],
    readSettings: () => structuredClone(saved),
    writeSettings: (value) => { saved = structuredClone(value); },
    handle: (_name, handler) => { setSettings = handler; },
    mainWindow: { webContents: {
      setZoomFactor: (value) => { zoom = value; },
      on: (_event, handler) => { restore = handler; },
    } },
  };
  runInNewContext(between(main, "handle('settings:set',", "handle('settings:addDir'"), context);
  for (const size of [100, 115, 130, 150]) {
    setSettings({ textSize: size });
    assert.equal(saved.textSize, size);
    assert.equal(zoom, size / 100);
  }
  setSettings({ chatResume: false });
  assert.equal(saved.textSize, 150);
  for (const invalid of [0, 125, '150', null]) {
    assert.throws(() => setSettings({ textSize: invalid }), /Invalid text size/);
    assert.equal(saved.textSize, 150);
    assert.equal(zoom, 1.5);
  }
  zoom = 1;
  runInNewContext(between(main, "mainWindow.webContents.on('did-finish-load'", "mainWindow.once('ready-to-show'"), context);
  restore();
  assert.equal(zoom, 1.5);
  assert.equal(saved.textSize, 150);
});

