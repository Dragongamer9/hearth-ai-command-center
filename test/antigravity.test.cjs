const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const agents = require('../electron/agents.cjs');

// Scratch stays in this task's workspace.
const dir = fs.mkdtempSync(path.join(__dirname, '.agy-test-'));
const bin = path.join(dir, 'agy');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
fs.writeFileSync(bin, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('/usage')) {
  if (process.env.FAKE_AGY_AUTH === 'missing') { console.error('Authentication required'); process.exit(1); }
  console.log(JSON.stringify({ status: 'SUCCESS', response: 'Usage available' }));
} else console.log(JSON.stringify({status:'SUCCESS', conversation_id:'conversation-1234', response:JSON.stringify(args)}));
`, { mode: 0o700 });

test('Antigravity mode, prompt, model, directory and conversation flags', async () => {
  for (const [mode, expected] of [['read', 'plan'], ['standard', 'accept-edits'], ['full', 'auto']]) {
    const r = await agents.runAgent({ agent: 'google', bin, cwd: dir, prompt: 'the complete prompt', mode, resumeId: 'conversation-1234', extraDirs: [dir], model: 'test-model' });
    assert.equal(r.ok, true);
    assert.equal(r.sessionId, 'conversation-1234');
    const args = JSON.parse(r.text);
    assert.equal(args[args.indexOf('--mode') + 1], expected);
    assert.equal(args[args.indexOf('-p') + 1], 'the complete prompt');
    assert.ok(args.includes('--conversation'));
    assert.ok(args.includes('--add-dir'));
    assert.ok(args.includes('--model'));
    assert.ok(!args.includes('--approval-mode'));
    assert.equal(args.includes('--sandbox'), mode === 'full');
  }
});
test('Antigravity auth check reports missing login and ready status', async () => {
  assert.equal((await agents.status('google', bin)).signedIn, true);
  process.env.FAKE_AGY_AUTH = 'missing';
  try { assert.equal((await agents.status('google', bin)).signedIn, false); }
  finally { delete process.env.FAKE_AGY_AUTH; }
});
test('Antigravity non-success envelope is an error even with partial output', () => {
  assert.ok(agents.parseGemini('{"status":"WAITING","response":"partial","conversation_id":"abc"}').error);
});
test('Antigravity is preferred over legacy Gemini anywhere on PATH', () => {
  const old = process.env.PATH;
  process.env.PATH = `${path.join(__dirname, 'fixtures')}:${dir}:${old}`;
  try { assert.equal(agents.findBinary('google'), bin); }
  finally { process.env.PATH = old; }
});
