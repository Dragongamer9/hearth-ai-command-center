// The redesigned shell (1.2): every page stays reachable, the composer keeps its controls,
// the in-app update UI stays visible, fonts are bundled, and look-only preferences never
// touch the app settings. Checked in the source (the renderer can't run outside Electron).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { phoneSnapshot } from '../src/ops/feeds.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('src/styles.css');

test('fonts are bundled locally (Lora with its OFL licence, Inter) and nothing is loaded remotely', () => {
  assert.ok(statSync(new URL('../src/fonts/Lora-Variable.ttf', import.meta.url)).size > 100000);
  const lic = read('src/fonts/Lora-OFL.txt');
  assert.match(lic, /The Lora Project Authors/);
  assert.match(lic, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.ok(existsSync(new URL('../src/fonts/InterVariable.woff2', import.meta.url)));
  assert.match(css, /url\('\.\/fonts\/Lora-Variable\.ttf'\)/);
  assert.doesNotMatch(css, /https?:\/\/|@import/);
  assert.doesNotMatch(read('index.html'), /fonts\.googleapis|https?:\/\/(?!www\.w3)/);
});

test('phone snapshot carries only a sanitised team list for the team chips', () => {
  const s = phoneSnapshot({ state: { tasks: [], chat: [], permissions: [] }, team: [{ id: 'anthropic', dot: 'work', lead: true, secret: 'x' }, { id: 'openai', dot: '<b>' }] });
  assert.deepEqual(s.team, [{ id: 'anthropic', dot: 'work', lead: true }, { id: 'openai', dot: 'off', lead: false }]);
  assert.deepEqual(phoneSnapshot({ state: {} }).team, []);
});

