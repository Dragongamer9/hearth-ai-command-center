// The lead's owner switches (merge, release, tag), the owner's Next version, and that no AI
// path can change settings or the version.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leadDecision, parseLeadLines, leadRules, leadUndoable } from '../src/lead.mjs';
import { setLeadPowers, leadVersionCheck, leadMayApprove, OWNER_ONLY } from '../src/ops/approval.mjs';
import { buildPrompt } from '../src/chat.mjs';

const ok = { ok: true, block: [], warn: [] };
const task = (o = {}) => ({ id: 'ABC123', title: 'Status panel', stage: 'approval', assignee: 'openai', reviewer: 'google', action: 'code', policy: ok, runs: [], ws: { branch: 'hearth/abc123' }, reviewVerdict: { verdict: 'approve', by: 'google', sha: 'b'.repeat(40) }, ...o });
const base = { lead: 'anthropic', enabled: true };
const OFF = { merge: false, release: false, tag: false, nextVersion: '0.9.0' };
const ON = { merge: true, release: true, tag: true, nextVersion: '0.9.0' };

test('each switch off: merge, release and tag are refused', () => {
  assert.match(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...base, task: task(), powers: OFF }).reason, /Lead may merge to main/);
  assert.match(leadDecision({ kind: 'release', version: 'v0.9.0' }, { ...base, powers: OFF }).reason, /Lead may publish releases/);
  assert.match(leadDecision({ kind: 'tag', version: 'v0.9.0' }, { ...base, powers: OFF }).reason, /Lead may create tags/);
  assert.equal(leadDecision({ kind: 'release', version: 'v0.9.0' }, { lead: 'anthropic', enabled: false, powers: ON }).ok, false, 'lead switch off too');
  setLeadPowers(OFF);
  assert.equal(leadMayApprove({ kind: 'merge', what: 'merge hearth/x into main' }).ok, false);
  setLeadPowers({ ...OFF, merge: true });
  assert.equal(leadMayApprove({ kind: 'merge', what: 'merge hearth/x into main' }).ok, true, 'merge cards become the lead\'s with the switch');
  setLeadPowers({});
});

test('releases and tags: only the owner\'s Next version', () => {
  assert.deepEqual(leadDecision({ kind: 'release', version: 'v0.9.0' }, { ...base, powers: ON }), { ok: true, action: 'release', version: '0.9.0' });
  assert.match(leadDecision({ kind: 'release', version: 'v0.9.1' }, { ...base, powers: ON }).reason, /only v0\.9\.0/);
  assert.match(leadDecision({ kind: 'release', version: 'v0.9.0' }, { ...base, powers: { ...ON, nextVersion: '' } }).reason, /not set a Next version/);
  assert.equal(leadDecision({ kind: 'tag', version: 'v0.9.0' }, { ...base, powers: ON }).ok, true);
  for (const bad of ['v1.0.0', 'latest', 'v0.9.0-rc1', '0.9', 'refs/tags/v0.9.0']) assert.equal(leadVersionCheck('tag', bad, ON).ok, false, bad);
  assert.deepEqual(parseLeadLines('RELEASE: v0.9.0\nTAG: v0.9.0.\nREWRITE: T-ABC123'), [{ kind: 'release', id: null, version: 'v0.9.0' }, { kind: 'tag', id: null, version: 'v0.9.0' }, { kind: 'rewrite', id: 'ABC123' }]);
  for (const a of ['merge', 'release', 'tag', 'rewrite']) assert.equal(leadUndoable(a), false, `no undo after ${a}`);
});

test('a lead merge still needs an independent review and the exact sha', () => {
  const p = { ...base, powers: ON };
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...p, task: task() }).action, 'merge');
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...p, task: task({ reviewVerdict: undefined }) }).ok, false);
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...p, task: task({ reviewVerdict: { verdict: 'approve', by: 'anthropic' } }) }).ok, false, 'not the lead\'s own review');
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...p, task: task({ assignee: 'anthropic', reviewVerdict: undefined }) }).ok, false, 'never its own unreviewed work');
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...p, task: task({ reviewVerdict: { verdict: 'approve', by: 'ollama' } }) }).ok, false, 'not the local model for code');
  const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const merge = main.slice(main.indexOf("handle('git:mergeApproved'"), main.indexOf("handle('git:leadSync'"));
  assert.match(merge, /rev-parse', 'HEAD'\]\)\)\.out !== sha/, 'exact approved sha');
  assert.match(merge, /if \(s\.leadMerge !== true\) return/);
  assert.match(main.slice(main.indexOf("handle('git:prMerge'")), /if \(s\.leadMerge !== true\) return/);
  assert.match(readFileSync(new URL('../electron/git.cjs', import.meta.url), 'utf8'), /'push', '--no-follow-tags'/);
});

test('no AI path can change the Next version or settings', () => {
  for (const line of ['VERSION: 1.0.0', 'SET NEXT VERSION: 1.0.0', 'SETTINGS: leadMerge on', 'BUMP: 1.0.0']) assert.deepEqual(parseLeadLines(line), [], line);
  assert.deepEqual(OWNER_ONLY.filter((k) => ['version', 'settings'].includes(k)), ['version', 'settings']);
  setLeadPowers(ON);
  for (const kind of ['version', 'settings']) assert.equal(leadMayApprove({ kind, what: 'x' }).ok, false, kind);
  setLeadPowers({});
  const ui = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const lead = ui.slice(ui.indexOf('async function leadAct('), ui.indexOf('function aliasOrNone('));
  for (const call of ['setSettings', 'opsProjectSettings']) assert.ok(!lead.includes(call), `leadAct never calls ${call}`);
  const handlers = ui.slice(ui.indexOf('function handleLeadLines('), ui.indexOf('function leadRecord('));
  assert.ok(!handlers.includes('setSettings') && !handlers.includes('opsProjectSettings'));
  const ops = readFileSync(new URL('../src/ops/ui.mjs', import.meta.url), 'utf8');
  const phone = ops.slice(ops.indexOf('async function onPhone('), ops.indexOf('// ---------- voice'));
  assert.ok(!phone.includes('setSettings') && !phone.includes('opsProjectSettings'), 'phone actions never change settings');
});

test('the switches persist and default off', () => {
  const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  for (const k of ['leadMerge', 'leadRelease', 'leadTag']) assert.match(main, new RegExp(`${k}: s\\.${k} === true,`), k);
  assert.match(main, /for \(const k of \['leadMerge', 'leadRelease', 'leadTag'\]\) if \(k in patch\) s\[k\] = patch\[k\] === true;/);
});

test('the lead is told about powers only when they are on', () => {
  setLeadPowers(OFF);
  const off = leadRules('anthropic');
  assert.doesNotMatch(off, /RELEASE: v|TAG: v|turned on "Lead may merge/);
  assert.match(off, /merging to main, releases, tags/);
  setLeadPowers(ON);
  const on = leadRules('anthropic');
  assert.match(on, /RELEASE: v0\.9\.0/);
  assert.match(on, /TAG: v0\.9\.0/);
  assert.match(on, /never edit or bump version numbers/);
  assert.match(buildPrompt('anthropic', [], { lead: 'anthropic', leadActions: true }), /Lead may merge to main/);
  setLeadPowers({});
});
