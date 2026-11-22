// 3.14: the approved Claude app look (docs/mockups/claude-look-*.png). Checked in the source, like the other UI tests
// (the renderer can't run outside Electron; the screenshots workflow renders it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const main = read('src/main.js');
const mainCjs = read('electron/main.cjs');
const css = read('src/styles.css');

test('the Claude app look is the only look (the owner, Nov 22)', () => {
  assert.match(mainCjs, /design: 'claude',/);
  assert.doesNotMatch(mainCjs, /patch\.design/);
  assert.match(main, /const designOf = \(\) => 'claude';/);
  assert.doesNotMatch(main, /data-a="design-pick"/);
  assert.match(main, /grp\('Look', \[row\('Colour mode'/);
});

test('new Appearance settings are validated and only change when he changes them', () => {
  assert.match(mainCjs, /chatFont: \['serif', 'sans', 'dyslexic'\]\.includes\(s\.chatFont\) \? s\.chatFont : 'serif'/);
  assert.match(mainCjs, /sendOnEnter: s\.sendOnEnter !== false/);
  assert.match(mainCjs, /composerCores: s\.composerCores !== false/);
  for (const k of ['chat-font', 'send-enter', 'composer-cores']) assert.match(main, new RegExp(`case '${k}': return setSettings`));
});

test('the team picker\'s switches are kept with the chat, not in settings, and team runs honour them', () => {
  assert.match(main, /R\.sessions\._off = \[\.\.\.off\]; save\(\);/);
  assert.match(main, /if \(S\.homeOff\.length\) R\.sessions\._off = \[\.\.\.S\.homeOff\]/);
  assert.doesNotMatch(main, /setSettings\(\{ _off/);
  const run = read('src/app/team-run.mjs');
  assert.equal((run.match(/ctx\.live\(\)\.filter\(\(a\) => !\(R\.sessions\?\._off \|\| \[\]\)\.includes\(a\)\)/g) || []).length, 2);
});

test('every place stays reachable from the sidebar, and the mockups and checklist are in the repo', () => {
  for (const a of ['new-chat', 'repo-pop', 'studio', 'live', 'habitat', 'reverse', 'go-set', 'characters', 'temp-chat', 'settings']) assert.ok(main.includes(`'${a}'`) || main.includes(`"${a}"`), a);
  for (let i = 1; i <= 12; i++) assert.ok(read('docs/mockups/checklists/claude-look.md').includes(`claude-look-${i}-`), `checklist names screen ${i}`);
  const names = ['1-home-dark', '2-chat-repo', '3-light', '4-team-picker', '5-settings', '6-studio', '7-live', '8-habitat', '9-reverse-engineering', '10-agent-desktop', '11-characters', '12-accounts'];
  for (const n of names) assert.ok(existsSync(new URL(`../docs/mockups/claude-look-${n}.png`, import.meta.url)), n);
  assert.match(css, /:root\[data-design="claude"\]\[data-mode="light"\]/);
  // Its own colours and the bundled fonts only: no pictures or logos in the look.
  assert.doesNotMatch(css.slice(css.indexOf('3.14: the Claude app look')), /url\(/);
});
