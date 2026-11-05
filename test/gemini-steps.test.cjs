// agy stops its whole headless run at the first refused tool and only names the kind of
// permission. The team test runs Gemini (agy) one step per run, and a refusal in chat keeps
// agy's own lines plus the mode it ran in.
const test = require('node:test');
const assert = require('node:assert/strict');
const { stepwiseText, STEP_PROMPTS, judge } = require('../electron/team-check.cjs');
const { agyRefusalDetail } = require('../electron/agents.cjs');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');

test('Gemini test: one prompt per step, each asking for exactly one step', () => {
  const p = STEP_PROMPTS('ab12cd');
  assert.equal(p.length, 4);
  p.forEach((x, i) => { assert.match(x, new RegExp(`step ${i + 1} only`, 'i')); assert.match(x, /Do nothing else/); });
  assert.match(p[2], /node --check hearth-check\.js/);
  assert.match(p[3], /rm hearth-check\.js/);
});

test('a refused step fails on its own; the other steps keep their own results', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsteps-'));
  const text = stepwiseText([
    { ok: true, text: 'STEP 1: PASS token ab12cd' },
    { ok: true, text: 'STEP 2: PASS https://example.org/x' },
    { ok: false, error: { message: "a tool required the 'command' permission that headless mode cannot prompt for" } },
    { ok: true, text: 'STEP 4: PASS' },
  ]);
  const steps = judge({ r: { ok: true, text }, token: 'ab12cd', dir });
  assert.equal(steps[0].pass, true);
  assert.equal(steps[1].pass, true);
  assert.equal(steps[2].pass, false);
  assert.match(steps[2].detail, /command' permission/);
  assert.equal(steps[3].pass, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a refusal in chat keeps agy\'s own lines and says which mode it ran in', () => {
  const res = { err: "Error: a tool required the 'command' permission that headless mode cannot prompt for, so it was auto-denied.\nother noise", out: '' };
  const plan = agyRefusalDetail('blocked', res, 'plan');
  assert.match(plan, /command' permission/);
  assert.match(plan, /plan mode/);
  assert.doesNotMatch(plan, /other noise/);
  assert.match(agyRefusalDetail('blocked', res, 'accept-edits'), /accept-edits mode/);
});

test('still never the bypass flag for agy', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'agents.cjs'), 'utf8');
  const agy = src.slice(src.indexOf("if (agent === 'google' && isAgy(file)) {"), src.indexOf("if (agent === 'google' || agent === 'qwen') {"));
  assert.doesNotMatch(agy, /args\.push\('--dangerously-skip-permissions'\)/);
});
