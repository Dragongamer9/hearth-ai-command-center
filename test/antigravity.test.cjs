// Gemini via Google's Antigravity CLI (agy), with a fake agy that echoes its arguments.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const agents = require('../electron/agents.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-agy-'));
const bin = path.join(dir, 'agy');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
fs.writeFileSync(bin, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('/usage')) {
  if (process.env.FAKE_AGY_SIGNED_OUT) { console.log(JSON.stringify({ status: 'ERROR', error: 'Please sign in' })); process.exit(1); }
  console.log(JSON.stringify({ status: 'SUCCESS', response: 'Usage: 12% of today' }));
} else console.log(JSON.stringify({ status: 'SUCCESS', conversation_id: 'conv-1234', response: JSON.stringify(args) }));
`, { mode: 0o755 });

const runArgs = async (o) => {
  const r = await agents.runAgent({ agent: 'google', bin, cwd: dir, prompt: 'the brief', ...o });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { r, args: JSON.parse(r.text) };
};

test('agy is detected and run headless with JSON output and its own modes', async () => {
  assert.equal(agents.isAgy(bin), true);
  assert.equal(agents.isAgy('/usr/bin/gemini'), false);
  for (const [mode, expected] of [['read', 'plan'], ['standard', 'accept-edits'], ['full', 'auto']]) {
    const { r, args } = await runArgs({ mode, resumeId: 'conv-1234', model: 'gemini-x', extraDirs: [dir] });
    assert.equal(r.via, 'Antigravity CLI');
    assert.equal(r.sessionId, 'conv-1234');
    assert.equal(args[args.indexOf('-p') + 1], 'the brief');
    assert.equal(args[args.indexOf('--output-format') + 1], 'json');
    assert.equal(args[args.indexOf('--mode') + 1], expected);
    assert.equal(args[args.indexOf('--conversation') + 1], 'conv-1234');
    assert.equal(args[args.indexOf('--add-dir') + 1], dir);
  }
});

test('full access adds --dangerously-skip-permissions and never --sandbox', async () => {
  const full = (await runArgs({ mode: 'full' })).args;
  assert.ok(full.includes('--dangerously-skip-permissions'));
  assert.ok(!full.includes('--sandbox'));
  for (const mode of ['read', 'standard']) {
    const a = (await runArgs({ mode })).args;
    assert.ok(!a.includes('--dangerously-skip-permissions'));
    assert.ok(!a.includes('--sandbox'));
  }
});

test('sign-in check runs agy -p /usage (no token file)', async () => {
  assert.equal((await agents.status('google', bin)).signedIn, true);
  process.env.FAKE_AGY_SIGNED_OUT = '1';
  try { assert.equal((await agents.status('google', bin)).signedIn, false); } finally { delete process.env.FAKE_AGY_SIGNED_OUT; }
});

test('a non-SUCCESS agy reply is an error, and "not eligible" is a sign-in problem', () => {
  assert.ok(agents.parseGemini('{"status":"WAITING","response":"partial"}').error);
  assert.equal(agents.parseGemini('{"status":"SUCCESS","response":"hi","conversation_id":"c1"}').sessionId, 'c1');
});

test('long prompts stay under the 128 KiB single-argument limit, keeping the newest context', async () => {
  const MAX_ARG_STRLEN = 128 * 1024;
  const prompt = `RULES AT THE TOP\n${'older chat é漢 '.repeat(20000)}\nNEWEST MESSAGE 🙂`;
  const capped = agents.capArgPrompt(prompt);
  assert.ok(Buffer.byteLength(capped) + 1 < MAX_ARG_STRLEN);
  assert.ok(capped.startsWith('RULES AT THE TOP'));
  assert.ok(capped.endsWith('NEWEST MESSAGE 🙂'));
  assert.match(capped, /older context trimmed/);
  assert.ok(!capped.includes('�'));
  assert.equal(agents.capArgPrompt('short'), 'short');
  const { args } = await runArgs({ prompt, mode: 'read' });
  assert.ok(args[args.indexOf('-p') + 1].endsWith('NEWEST MESSAGE 🙂'), 'the real argument reached agy');
});

test('agy is preferred over the old gemini when both are on the search path', () => {
  const old = process.env.PATH;
  process.env.PATH = `${path.join(__dirname, 'fixtures')}:${dir}:${old}`;
  try { assert.equal(agents.findBinary('google'), bin); } finally { process.env.PATH = old; }
});

test('an image under a folder with spaces reaches agy as an escaped @path', async () => {
  const spaced = path.join(dir, 'Hearth AI Command Center', '.hearth-ai', 'attachments');
  fs.mkdirSync(spaced, { recursive: true });
  const img = path.join(spaced, 'ab12-screen shot.png');
  fs.writeFileSync(img, 'png');
  const { args } = await runArgs({ mode: 'read', images: [img] });
  assert.ok(args[args.indexOf('-p') + 1].includes(`@${img.replace(/ /g, '\\ ')}`));
});
