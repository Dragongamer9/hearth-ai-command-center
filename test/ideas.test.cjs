// Hearth Ideas' hand-off (electron/ideas.cjs): only a real idea file is taken, and its message keeps the owner's rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseIdea, ideaArg, messageFor, createIdeas } = require('../electron/ideas.cjs');

const good = { format: 1, key: 'idea-812', title: 'Instant replay', brief: 'Record the last 30 seconds of a game.', repo: 'Dragongamer9/hearth-os', base: 'bughunt', branch: 'idea/instant-replay', lead: 'claude', checks: 'chatgpt' };

test('a real idea file is read', () => {
  const i = parseIdea(JSON.stringify(good));
  assert.equal(i.branch, 'idea/instant-replay');
  assert.equal(i.base, 'bughunt');
});

test('anything else is refused', () => {
  assert.equal(parseIdea('nope'), null);
  assert.equal(parseIdea(JSON.stringify({ ...good, format: 2 })), null);
  assert.equal(parseIdea(JSON.stringify({ ...good, branch: 'main' })), null, 'never main');
  assert.equal(parseIdea(JSON.stringify({ ...good, branch: 'bughunt' })), null, 'never its own base');
  assert.equal(parseIdea(JSON.stringify({ ...good, branch: 'a/../b' })), null);
  assert.equal(parseIdea(JSON.stringify({ ...good, repo: 'x; rm -rf /' })), null);
  assert.equal(parseIdea(JSON.stringify({ ...good, lead: 'Claude; echo' })), null);
});

test('--idea is found either way', () => {
  assert.equal(ideaArg(['app', '--idea=/tmp/a.json']), '/tmp/a.json');
  assert.equal(ideaArg(['app', '--idea', '/tmp/b.json']), '/tmp/b.json');
  assert.equal(ideaArg(['app', '--mini']), null);
});

test('the message names the lead, the checker and the rules', () => {
  const m = messageFor(parseIdea(JSON.stringify(good)));
  assert.match(m, /^@claude /);
  assert.match(m, /ChatGPT checks/);
  assert.match(m, /idea\/instant-replay/);
  assert.match(m, /Never pick or change a version number, never merge, tag or release/);
  assert.doesNotMatch(m, /mockup first/i);
  assert.match(messageFor(parseIdea(JSON.stringify({ ...good, mockupFirst: true }))), /Draw a mockup first/);
});

test('an idea keeps its chat, and an unreadable file is never overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideas-'));
  const a = createIdeas(dir);
  a.remember('idea-812', 'c0123456789');
  assert.equal(createIdeas(dir).chatFor('idea-812'), 'c0123456789');
  fs.writeFileSync(path.join(dir, 'ideas.json'), '{broken');
  const b = createIdeas(dir);
  assert.throws(() => b.remember('x', 'cabc'));
  assert.equal(fs.readFileSync(path.join(dir, 'ideas.json'), 'utf8'), '{broken');
});
