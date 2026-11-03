// Team requests: Local AI presets and fit, @mentions, capabilities, progress lines,
// attachment sizes, IMAGE REQUEST lines, checkpoint reports, action results.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOCAL_PRESETS, validTag, fitCheck, resolveLocalModel, localMayReview, setLocalConfig, paramsOf, resolveMention, unknownMentions, capabilities, canSeeImages, splitProgress, requestedSize, belowRequested, fmtBytes, parseImageRequests, pickImageAI, checkpointReport, result, extrasRules, CAPS } from '../src/ops/extras.mjs';
import { mentions, buildPrompt } from '../src/chat.mjs';
import { aliasOf } from '../src/registry.mjs';
import { leadDecision } from '../src/lead.mjs';
import { buildTaskBrief } from '../src/team.mjs';

test('Local AI presets use real Ollama tags, every size discussed', () => {
  const tags = LOCAL_PRESETS.map((p) => p.tag);
  assert.deepEqual(tags, ['qwen2.5-coder:3b', 'qwen2.5-coder:7b', 'qwen2.5-coder:14b', 'qwen2.5-coder:32b', 'llama3.1:8b', 'llama3.1:70b', 'deepseek-r1:7b', 'deepseek-r1:8b', 'deepseek-r1:14b', 'deepseek-r1:32b', 'deepseek-r1:70b']);
  for (const p of LOCAL_PRESETS) { assert.ok(validTag(p.tag), p.tag); assert.ok(p.sizeGb > 0); }
  assert.deepEqual(LOCAL_PRESETS.filter((p) => p.params === 70).map((p) => p.sizeGb), [40, 40]);
  assert.equal(validTag('mistral-nemo:12b'), true);
  assert.equal(validTag('bad tag; rm -rf'), false);
});

test("fit labels on the owner's machines", () => {
  const p = (t) => LOCAL_PRESETS.find((x) => x.tag === t);
  const rtx = { ramGb: 32, vramGb: 12, discrete: true };
  assert.equal(fitCheck(p('qwen2.5-coder:14b'), rtx).label, 'fits on the graphics card');
  assert.equal(fitCheck(p('qwen2.5-coder:32b'), rtx).label, 'fits using graphics card + RAM');
  assert.equal(fitCheck(p('llama3.1:70b'), rtx).label, 'too big for this computer');
  const small = { ramGb: 8 };
  assert.equal(fitCheck(p('qwen2.5-coder:3b'), small).fit, 'fits-ram');
  assert.equal(fitCheck(p('qwen2.5-coder:7b'), small).label, 'tight');
  assert.equal(fitCheck(p('qwen2.5-coder:14b'), small).label, 'too big for this computer');
  // An integrated / shared-memory GPU (Ally, Intel laptop) counts RAM only.
  assert.equal(fitCheck(p('qwen2.5-coder:14b'), { ramGb: 16, vramGb: 4, discrete: false }).fit, 'fits-ram');
  assert.equal(fitCheck(p('qwen2.5-coder:32b'), { ramGb: 16, vramGb: 12, discrete: false }).fit, 'too-big', 'shared VRAM is not counted twice');
  assert.equal(fitCheck(p('qwen2.5-coder:7b'), {}).fit, 'unknown');
});

test('the saved Local AI model is kept; a missing one falls back with a notice', () => {
  assert.deepEqual(resolveLocalModel('qwen2.5-coder:7b', ['qwen2.5-coder:3b', 'qwen2.5-coder:7b']), { use: 'qwen2.5-coder:7b', saved: 'qwen2.5-coder:7b', notice: null });
  const gone = resolveLocalModel('qwen2.5-coder:14b', ['qwen2.5-coder:3b']);
  assert.equal(gone.use, 'qwen2.5-coder:3b');
  assert.equal(gone.saved, 'qwen2.5-coder:14b', 'the choice is not changed');
  assert.match(gone.notice, /isn't installed; using qwen2\.5-coder:3b .*your choice is kept/);
  assert.equal(resolveLocalModel('llama3.1:8b', ['llama3.1:8b:latest'.replace(':8b:latest', ':8b')]).notice, null);
  assert.equal(resolveLocalModel(null, ['a:1b', 'b:2b'], { 'a:1b': false }).use, 'b:2b', 'presets switched off are not offered');
  const src = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  assert.match(src, /localReviewCode: s\.localReviewCode === true,/, 'code-review switch is off unless set, and read back');
  assert.match(src, /if \('localReviewCode' in patch\) s\.localReviewCode = patch\.localReviewCode === true;/);
});

test('review rules by Local AI model size', () => {
  const docs = { action: 'docs' };
  const code = { action: 'code' };
  assert.equal(localMayReview(docs, { model: 'qwen2.5-coder:3b' }).ok, false);
  assert.equal(localMayReview(docs, { model: 'qwen2.5-coder:7b' }).ok, true);
  assert.equal(localMayReview(code, { model: 'qwen2.5-coder:32b' }).ok, false, 'code needs the owner switch');
  assert.equal(localMayReview(code, { model: 'qwen2.5-coder:32b', allowCode: true }).ok, true);
  assert.equal(localMayReview(code, { model: 'qwen2.5-coder:3b', allowCode: true }).ok, false);
  assert.equal(paramsOf('mistral-nemo:12b'), 12);
  const on = { lead: 'anthropic', enabled: true };
  const t = (action) => ({ id: 'ABC123', title: 'x', stage: 'approval', assignee: 'openai', reviewer: 'ollama', action, policy: { ok: true, block: [], warn: [] }, runs: [], ws: { branch: 'hearth/abc123' }, reviewVerdict: { verdict: 'approve', by: 'ollama', sha: 'b'.repeat(40) } });
  setLocalConfig({ model: 'qwen2.5-coder:3b' });
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: t('docs') }).ok, false);
  setLocalConfig({ model: 'qwen2.5-coder:14b' });
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: t('docs') }).ok, true, '7B+ reviews docs');
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: t('code') }).ok, false);
  setLocalConfig({ model: 'qwen2.5-coder:14b', allowCode: true });
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: t('code') }).ok, true);
  setLocalConfig({});
});

test('@local, @ollama, @localai and display names work; unknown names get suggestions', () => {
  for (const w of ['local', 'Ollama', 'LOCALAI', 'Local_AI']) assert.equal(aliasOf(w), 'ollama', w);
  assert.equal(aliasOf('Claude'), 'anthropic');
  assert.equal(aliasOf('ChatGPT'), 'openai');
  assert.deepEqual(mentions('@LocalAI and @Gemini look'), ['ollama', 'google']);
  assert.equal(resolveMention('local-ai'), 'ollama');
  const u = unknownMentions('hey @gemni and @claude, mail me at a@b.com');
  assert.equal(u.length, 1);
  assert.equal(u[0].name, 'gemni');
  assert.ok(u[0].suggest.includes('@gemini'));
});

test('capabilities: from the registry and recorded outcomes; unknown stays unknown', () => {
  assert.equal(CAPS.xai.imageIn, false);
  assert.equal(canSeeImages('anthropic'), true);
  assert.equal(canSeeImages('xai'), false);
  assert.equal(canSeeImages('openai', true), false, 'API connections get no images');
  const c = capabilities('google', { tasks: [{ runs: [{ agent: 'google', status: 'done', at: '2026-11-02T10:00:00Z' }] }], chat: [{ who: 'google', at: '2026-11-02T11:00:00Z', attachments: [{ kind: 'image', from: '.hearth-ai/assets/google/cat.png' }] }] });
  assert.equal(c.imageOut, true, 'it attached an image it made');
  assert.equal(c.lastOk, '2026-11-02T11:00:00Z');
  assert.equal(capabilities('anthropic', {}).imageOut, 'unknown');
  assert.equal(pickImageAI(['mistral', 'anthropic', 'google'], { mistral: { imageOut: 'unknown', edits: true }, anthropic: { imageOut: 'unknown', edits: true }, google: { imageOut: true } }), 'google');
  assert.equal(pickImageAI(['perplexity'], { perplexity: { imageOut: false } }), null);
});

test('progress lines fold; requested sizes flag small attachments; bytes read nicely', () => {
  const s = splitProgress('PROGRESS: reading files\nPROGRESS: running tests\nDone: the panel works.');
  assert.deepEqual(s.progress, ['reading files', 'running tests']);
  assert.equal(s.body, 'Done: the panel works.');
  assert.deepEqual(requestedSize('make it 1920x1080 please'), { w: 1920, h: 1080 });
  assert.deepEqual(requestedSize('a 4K wallpaper'), { w: 3840, h: 2160 });
  assert.deepEqual(requestedSize('1080p screenshot'), { w: 1920, h: 1080 });
  assert.equal(requestedSize('no size here'), null);
  assert.equal(belowRequested({ width: 1280, height: 720 }, { w: 1920, h: 1080 }), true);
  assert.equal(belowRequested({ width: 1080, height: 1920 }, { w: 1920, h: 1080 }), false, 'portrait of the same size is fine');
  assert.equal(belowRequested({}, { w: 1, h: 1 }), false);
  assert.equal(fmtBytes(2.5 * 1048576), '2.5 MB');
});

test('IMAGE REQUEST lines, checkpoint reports, results, and what the AIs are told', () => {
  assert.deepEqual(parseImageRequests('ok\n- IMAGE REQUEST: a cozy hearth icon | size: 1024x1024 | for: T-ABC123\nIMAGE REQUEST: | size: 1x1'), [{ prompt: 'a cozy hearth icon', size: '1024x1024', for: 'T-ABC123' }]);
  assert.equal(checkpointReport({ sha: 'abcdef1234', files: ['a.js', 'b.js', 'c.js', 'd.js', 'e.js'] }, 'Claude'), 'Checkpoint abcdef1 (Claude): 5 files changed — a.js, b.js, c.js, d.js, +1 more.');
  assert.equal(checkpointReport(null), null);
  assert.deepEqual(result('ATTACH: x.png', false, 'File not found'), { line: 'ATTACH: x.png', ok: false, reason: 'File not found' });
  assert.match(extrasRules('mistral'), /\.hearth-ai\/assets\/mistral\//);
  assert.match(buildPrompt('openai', []), /IMAGE REQUEST: <prompt> \| size: <WxH>/);
  assert.match(buildTaskBrief({ task: { id: 'T1', title: 't', runs: [], notes: [] }, agent: 'google' }), /HEARTH_AI_ASSETS/);
  assert.match(buildPrompt('openai', [{ id: 'S1', who: 'system', report: true, text: 'Checkpoint abc1234: 2 files changed' }, { id: 'S2', who: 'system', text: 'hidden' }]), /Checkpoint abc1234/);
  assert.doesNotMatch(buildPrompt('openai', [{ id: 'S2', who: 'system', text: 'hidden note' }]), /hidden note/);
});

test('every action line gets a visible result in main.js (source guards)', () => {
  const ui = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  for (const s of ["ops.actionResult(agent, vline, false, `unknown task id", "ops.actionResult(agent, `ATTACH: ${f.path}`", "'ignored because the lead switch is off'", "only the lead (${NAMES[state.lead]}) can do that", "ops.actionResult(agent, `EDIT #${e.id}`", "ops.actionResult(agent, `HANDOFF: @${h.to}`", "ops.actionResult(agent, `TASK: ${p.title}`"]) assert.ok(ui.includes(s), s);
});
