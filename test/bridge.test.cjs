// Chat bridge: CLI session discovery and parsing (Claude Code, Codex, Gemini CLI, generic).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bridge = require('../electron/bridge.cjs');

const S = path.join(__dirname, 'fixtures', 'sessions');
const read = (f) => fs.readFileSync(path.join(S, f), 'utf8');

test('Claude Code transcript: text only, no tool results, sidechains or thinking', () => {
  const c = bridge.parseClaudeSession(read('claude.jsonl'), { file: '/x/11111111-2222-3333-4444-555555555555.jsonl' });
  assert.equal(c.provider, 'anthropic');
  assert.equal(c.sessionId, '11111111-2222-3333-4444-555555555555');
  assert.equal(c.cwd, '/home/owner/Projects/hearth-os');
  assert.equal(c.title, 'Fix Wi-Fi refresh');
  assert.deepStrictEqual(c.messages.map((m) => [m.role, m.text]), [
    ['user', 'Why does the Wi-Fi list not refresh after resume?'],
    ['assistant', 'NetworkManager emits a signal we ignore.'],
    ['assistant', 'Fixed it in wifi.rs.'],
  ]);
  assert.equal(c.startedAt, '2026-11-01T10:00:00.000Z');
});

test('Codex rollout: session meta, skips environment context, prefers response items', () => {
  const c = bridge.parseCodexSession(read('codex.jsonl'), { file: '/x/rollout-2026-11-01T09-00-00-0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000.jsonl' });
  assert.equal(c.sessionId, '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000');
  assert.equal(c.cwd, '/home/owner/Projects/hearth-os');
  assert.deepStrictEqual(c.messages.map((m) => m.text), ['Add a Storage page to Settings', 'Added StoragePage with drive list.']);
  assert.equal(c.title, 'Add a Storage page to Settings');
});

test('Codex rollout with only event messages still yields the conversation', () => {
  const t = [
    JSON.stringify({ type: 'session_meta', payload: { id: 'abcd1234-0000-0000-0000-000000000000', cwd: '/p' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'hello' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'hi there' } }),
  ].join('\n');
  assert.deepStrictEqual(bridge.parseCodexSession(t).messages.map((m) => m.role), ['user', 'assistant']);
});

test('Gemini CLI: saved sessions and /chat save checkpoints', () => {
  const s = bridge.parseGeminiSession(read('gemini-session.json'), { file: '/h/.gemini/tmp/abc/chats/session-1.json' });
  assert.equal(s.sessionId, '9f0e8d7c-1111-2222-3333-444455556666');
  assert.deepStrictEqual(s.messages.map((m) => m.role), ['user', 'assistant']);
  const c = bridge.parseGeminiSession(read('gemini-checkpoint.json'), { file: '/h/.gemini/tmp/abc/checkpoint-boot.json' });
  assert.equal(c.sessionId, 'checkpoint:boot');
  assert.equal(c.messages[1].text, 'Use a GRUB theme, keep the menu visible.');
  const q = bridge.parseGeminiSession(read('gemini-session.json'), { provider: 'qwen' });
  assert.equal(q.provider, 'qwen');
});

test('generic parser handles unknown JSON / JSONL layouts and junk safely', () => {
  const j = bridge.generic(JSON.stringify({ session_id: 'g-123456', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: [{ type: 'text', text: 'b' }] }] }), { provider: 'xai' });
  assert.equal(j.sessionId, 'g-123456');
  assert.equal(j.messages.length, 2);
  assert.ok(j.bestEffort);
  const l = bridge.generic('{"type":"user","text":"x"}\n{"type":"assistant","text":"y"}\nnot json', { provider: 'xai', file: 'abc123.jsonl' });
  assert.equal(l.messages.length, 2);
  assert.equal(bridge.generic('garbage', { provider: 'xai' }), null);
  assert.equal(bridge.parseClaudeSession('nope\n{bad'), null);
});

test('resume commands are argv arrays with validated ids only', () => {
  assert.deepStrictEqual(bridge.resumeArgs('anthropic', '11111111-2222-3333-4444-555555555555'), ['--resume', '11111111-2222-3333-4444-555555555555']);
  assert.deepStrictEqual(bridge.resumeArgs('openai', 'abc-1234'), ['resume', 'abc-1234']);
  assert.deepStrictEqual(bridge.resumeArgs('google', 'abcd-1234'), ['--resume', 'abcd-1234']);
  assert.deepStrictEqual(bridge.resumeArgs('xai', 'abcd-1234'), ['--resume', 'abcd-1234']);
  assert.equal(bridge.resumeArgs('anthropic', 'x; rm -rf ~'), null);
  assert.equal(bridge.resumeArgs('anthropic', '--dangerously-skip-permissions'), null);
  assert.equal(bridge.resumeArgs('perplexity', 'abcd-1234'), null);
});

test('scanAll finds sessions started outside the app in each CLI\'s own folder', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-scan-'));
  const old = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, CODEX_HOME: process.env.CODEX_HOME, GROK_HOME: process.env.GROK_HOME };
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR; delete process.env.CODEX_HOME; delete process.env.GROK_HOME;
  try {
    const project = '/home/owner/Projects/hearth-os';
    const hash = bridge.projectHash(project);
    const put = (rel, text) => { const f = path.join(home, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
    put('.claude/projects/-home-owner-Projects-hearth-os/11111111-2222-3333-4444-555555555555.jsonl', read('claude.jsonl'));
    put('.codex/sessions/2026/11/01/rollout-2026-11-01T09-00-00-0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000.jsonl', read('codex.jsonl'));
    put(`.gemini/tmp/${hash}/chats/session-2026-10-30.json`, read('gemini-session.json').replace('PLACEHOLDER', hash));
    put(`.gemini/tmp/${hash}/checkpoint-boot.json`, read('gemini-checkpoint.json'));
    put('.grok/sessions/s1.json', JSON.stringify({ session_id: 'grok-5555', messages: [{ role: 'user', content: 'hi grok' }, { role: 'assistant', content: 'hello' }] }));
    const found = bridge.scanAll({ knownDirs: [project] });
    const by = (p) => found.filter((c) => c.provider === p);
    assert.equal(by('anthropic').length, 1);
    assert.equal(by('openai').length, 1);
    assert.equal(by('google').length, 2);
    assert.equal(by('xai').length, 1);
    const g = by('google').find((c) => !c.checkpoint);
    assert.equal(g.cwd, project, 'Gemini project hash mapped back to the folder');
    assert.ok(g.resumable);
    assert.equal(by('google').find((c) => c.checkpoint).resumable, false);
    assert.ok(found.every((c) => c.source === 'cli'));
  } finally {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(home, { recursive: true, force: true });
  }
});
