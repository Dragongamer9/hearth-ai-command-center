// 2.2.1: each chat keeps its own settings (src/app/chat-prefs.mjs and its wiring in the window).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defaultsFrom, cleanPrefs, prefsFor, prefsOf, samePrefs, applyPrefs, rememberPrefs } from '../src/app/chat-prefs.mjs';

const settings = { tools: { web: true, build: false } };
// The window's steps, as main.js does them: open a chat, change a switch, go home.
const openChat = (S, R) => applyPrefs(S, prefsFor(R, settings));
const change = (S, R, k, v) => { S[k] = v; rememberPrefs(R, S); };

test('switching chats restores each chat\'s own AI selection and switches', () => {
  const S = { ...defaultsFrom(settings) };
  const grok = { sessions: {} };
  const team = { sessions: {} };
  openChat(S, grok);
  change(S, grok, 'mode', 'xai');
  change(S, grok, 'web', false);
  openChat(S, team);
  assert.deepEqual(prefsOf(S), { mode: 'team', web: true, build: false, deep: false }, 'the Grok choice doesn\'t leak into the other chat');
  change(S, team, 'deep', true);
  openChat(S, grok);
  assert.deepEqual(prefsOf(S), { mode: 'xai', web: false, build: false, deep: false });
  openChat(S, team);
  assert.equal(S.deep, true);
  assert.equal(S.mode, 'team');
});
test('a new chat uses the owner\'s defaults, never the last chat\'s; old chats get nothing saved until changed', () => {
  const S = { ...defaultsFrom(settings) };
  const grok = { sessions: { _prefs: { mode: 'xai', web: false } } };
  openChat(S, grok);
  assert.equal(S.mode, 'xai');
  applyPrefs(S, defaultsFrom(settings)); // goHome
  assert.deepEqual(prefsOf(S), { mode: 'team', web: true, build: false, deep: false });
  const old = { sessions: { _models: { anthropic: 'opus' } } };
  openChat(S, old);
  assert.equal(old.sessions._prefs, undefined, 'opening an old chat saves nothing');
  assert.deepEqual(old.sessions._models, { anthropic: 'opus' });
});
test('saved choices are checked; bad ones fall back to the defaults', () => {
  assert.equal(cleanPrefs('x'), null);
  assert.deepEqual(cleanPrefs({ mode: 'DROP TABLE', web: 'yes', deep: true }), { deep: true });
  assert.deepEqual(prefsFor({ sessions: { _prefs: { mode: '../x' } } }, {}), { mode: 'team', web: true, build: true, deep: false });
  assert.ok(samePrefs(defaultsFrom({}), { mode: 'team', web: true, build: true, deep: false }));
});
test('window wiring: opening a chat applies its prefs, going home resets, changes are saved with the chat', () => {
  const m = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(m, /applyPrefs\(S, prefsFor\(R, S\.settings\)\)/);
  assert.match(m, /function goHome\(\) \{[^}]*\n[^\n]*\n\s*applyPrefs\(S, defaultsFrom\(S\.settings\)\)/);
  for (const a of ['set-mode', 'toggle-web', 'toggle-build', 'toggle-deep']) assert.match(m, new RegExp(`case '${a}':[^\\n]*keepPrefs\\(\\)`), a);
  assert.match(m, /function keepPrefs\(\) \{[^\n]*rememberPrefs\(R, S\)\) saveRt\(R\)/);
});
