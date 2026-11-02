// The app's own chat history store.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHistory } = require('../electron/history.cjs');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-hist-')), 'chat-history.json');

test('app conversations are appended, searchable and survive a restart', () => {
  const f = tmp();
  const h = createHistory(f);
  h.append({ provider: 'anthropic', sessionId: 'sess-1111', title: 'Team chat — hearth-os', resumable: true, messages: [{ role: 'user', text: 'plan the storage page' }, { role: 'assistant', text: 'Three tasks: drives, sizes, move games.' }] });
  h.append({ provider: 'anthropic', sessionId: 'sess-1111', title: 'ignored later title', messages: [{ role: 'user', text: 'and cleanup?' }, { role: 'assistant', text: 'Add a cleanup tab.' }] });
  const again = createHistory(f);
  const [hit] = again.search('move games');
  assert.equal(hit.key, 'anthropic:sess-1111');
  assert.equal(hit.title, 'Team chat — hearth-os');
  assert.equal(hit.count, 4);
  assert.match(hit.snippet, /move games/);
  assert.equal(again.search('nothing like this').length, 0);
});

test('merging the CLI transcript keeps the app details; imports never collide with CLI ids', () => {
  const h = createHistory(tmp());
  h.append({ provider: 'openai', sessionId: 'abc-12345', title: 'T-K7Q2MA: Remap page', taskId: 'K7Q2MA', resumable: true, messages: [{ role: 'user', text: 'brief' }] });
  h.upsertMany([{ provider: 'openai', sessionId: 'abc-12345', source: 'cli', title: 'brief', resumable: true, messages: [{ role: 'user', text: 'brief' }, { role: 'assistant', text: 'done' }] }]);
  const c = h.get('openai:abc-12345');
  assert.equal(c.source, 'app');
  assert.equal(c.title, 'T-K7Q2MA: Remap page');
  assert.equal(c.taskId, 'K7Q2MA');
  assert.equal(c.messages.length, 2);
  h.upsert({ provider: 'openai', sessionId: 'abc-12345', source: 'import:chatgpt', title: 'web chat', messages: [{ role: 'user', text: 'x' }] });
  assert.ok(h.get('openai:imp:abc-12345'));
  assert.equal(h.search('', { source: 'import' }).length, 1);
  assert.equal(h.search('', { source: 'app' }).length, 1);
  assert.equal(h.search('', { provider: 'anthropic' }).length, 0);
  assert.deepStrictEqual(h.stats().by.openai, { app: 1, cli: 0, import: 1 });
});

test('secrets are redacted before anything is saved', () => {
  const f = tmp();
  const h = createHistory(f);
  h.append({ provider: 'xai', sessionId: 'api-chat-1', title: 'keys', messages: [{ role: 'user', text: 'my key is sk-ant-abcdefghijklmnopqrstuvwxyz' }] });
  assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /sk-ant-abc/);
  assert.match(fs.readFileSync(f, 'utf8'), /REDACTED/);
  assert.ok(h.remove('xai:api-chat-1'));
  assert.equal(h.search('').length, 0);
});
