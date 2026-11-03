import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leadOn, parseLeadLines, leadDecision, leadLabel, leadUndoable, leadBuilt } from '../src/lead.mjs';
import { parseVerdicts } from '../src/owner.mjs';
import { chatRules, buildPrompt, buildDelta } from '../src/chat.mjs';

const ok = { ok: true, block: [], warn: [] };
const mk = (o = {}) => ({ id: 'ABC123', title: 'Status panel', stage: 'approval', assignee: 'openai', reviewer: 'google', action: 'code', policy: ok, runs: [], ws: { branch: 'hearth/abc123' }, reviewVerdict: { verdict: 'approve', by: 'google', sha: 'b'.repeat(40) }, ...o });
const on = { lead: 'anthropic', enabled: true };

test('switch off: lead lines are ignored', () => {
  assert.equal(leadOn({ enabled: false, agent: 'anthropic', lead: 'anthropic' }), false);
  assert.equal(leadOn({ enabled: true, agent: 'openai', lead: 'anthropic' }), false, 'only the lead counts');
  assert.equal(leadOn({ enabled: true, agent: 'anthropic', lead: 'anthropic' }), true);
  const off = leadDecision({ kind: 'approve', id: 'ABC123' }, { lead: 'anthropic', enabled: false, task: mk() });
  assert.equal(off.ok, false);
  assert.equal(off.ignored, true);
  assert.equal(leadDecision({ kind: 'add', title: 'x' }, { lead: 'anthropic' }).ignored, true, 'off by default');
});

test('parses START, APPROVE/DENY R-, ADD TASK; APPROVE/CHANGES T- stay with parseVerdicts', () => {
  const text = 'Plan:\nSTART: T-abc123\n- APPROVE: R-q1w2e3\n**DENY: R-ZZZ999 too risky**\nADD TASK: Dark mode toggle — add it to Settings | implementer: gemini | reviewer: grok | action: code\nAPPROVE: T-ABC123 looks good';
  assert.deepEqual(parseLeadLines(text), [
    { kind: 'start', id: 'ABC123' },
    { kind: 'allow', id: 'Q1W2E3', reason: '' },
    { kind: 'deny', id: 'ZZZ999', reason: 'too risky' },
    { kind: 'add', title: 'Dark mode toggle', details: 'add it to Settings', implementer: 'gemini', reviewer: 'grok', action: 'code' },
  ]);
  assert.deepEqual(parseVerdicts(text), [{ verdict: 'approve', taskId: 'ABC123', reason: 'looks good' }]);
});

test('the lead approves a reviewed task like "Approve to merge"', () => {
  assert.deepEqual(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: mk() }), { ok: true, action: 'merge' });
  assert.deepEqual(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: mk({ ws: null }) }), { ok: true, action: 'approve' });
  assert.deepEqual(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: mk({ stage: 'implementing' }), resumable: true }), { ok: true, action: 'resume' });
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: mk({ stage: 'implementing' }) }).ok, false);
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: mk({ stage: 'review', reviewer: 'anthropic' }) }).skip, true, 'its own reviewer sign-off uses applyVerdict');
});

test('the lead can never approve its own work', () => {
  const own = mk({ assignee: 'anthropic', reviewVerdict: undefined });
  const r = leadDecision({ kind: 'approve', id: own.id }, { ...on, task: own });
  assert.equal(r.ok, false);
  assert.match(r.reason, /can't approve its own work/);
  const ranIt = mk({ runs: [{ agent: 'anthropic', status: 'done' }], reviewVerdict: undefined });
  assert.equal(leadBuilt(ranIt, 'anthropic'), true);
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: ranIt }).ok, false);
  // Its own approving review does not count either
  assert.equal(leadDecision({ kind: 'approve', id: own.id }, { ...on, task: { ...own, reviewVerdict: { verdict: 'approve', by: 'anthropic' } } }).ok, false);
  // Another AI's approving review plus the lead's approval is enough
  assert.equal(leadDecision({ kind: 'approve', id: own.id }, { ...on, task: { ...own, reviewVerdict: { verdict: 'approve', by: 'google' } } }).ok, true);
  // Nor approve its own permission request
  assert.equal(leadDecision({ kind: 'allow', id: 'R1' }, { ...on, request: { id: 'R1', agent: 'anthropic', kind: 'delete', status: 'pending' } }).ok, false);
  assert.equal(leadDecision({ kind: 'deny', id: 'R1' }, { ...on, request: { id: 'R1', agent: 'anthropic', kind: 'delete', status: 'pending' } }).ok, true);
});

test('a release is never triggered by the lead', () => {
  for (const action of ['release', 'deploy']) {
    const r = leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: mk({ action }) });
    assert.equal(r.ok, false);
    assert.match(r.reason, /stay with the Owner/);
    assert.equal(leadDecision({ kind: 'add', title: 'Publish 0.8', action }, { ...on, tasks: [] }).ok, false);
    assert.equal(leadDecision({ kind: 'start', id: 'ABC123' }, { ...on, task: mk({ action, stage: 'intake' }) }).ok, false);
  }
  for (const kind of ['release', 'merge', 'boot']) {
    assert.equal(leadDecision({ kind: 'allow', id: 'R1' }, { ...on, request: { id: 'R1', agent: 'openai', kind, status: 'pending' } }).ok, false);
  }
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: mk({ policy: { ok: false, block: ['Only the owner picks version numbers.'], warn: [] } }) }).ok, false, 'version numbers stay with the owner');
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const leadCode = src.slice(src.indexOf('// ---------- the lead acting for the owner'), src.indexOf('// ---------- views ----------'));
  assert.ok(leadCode.length > 500);
  assert.doesNotMatch(leadCode, /gitRelease|releaseCreate|data-release/, 'lead code never calls the release path');
  const mainSrc = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const rel = mainSrc.slice(mainSrc.indexOf("handle('git:release'"), mainSrc.indexOf("handle('git:release'") + 600);
  assert.doesNotMatch(rel, /byLead/, 'the release handler has no lead bypass');
});

test('new lead tasks go through the duplicate check', () => {
  const r = leadDecision({ kind: 'add', title: 'Status panel', details: '' }, { ...on, tasks: [mk({ stage: 'implementing' })] });
  assert.equal(r.ok, false);
  assert.equal(r.duplicate, 'ABC123');
  assert.deepEqual(leadDecision({ kind: 'add', title: 'Dark mode toggle', action: 'code' }, { ...on, tasks: [mk()] }), { ok: true, action: 'add' });
});

test('start, deny and changes', () => {
  assert.deepEqual(leadDecision({ kind: 'start', id: 'ABC123' }, { ...on, task: mk({ stage: 'intake' }) }), { ok: true, action: 'start' });
  assert.equal(leadDecision({ kind: 'start', id: 'ABC123' }, { ...on, task: mk({ stage: 'intake', policy: { ok: false, block: ['x'], warn: [] } }) }).ok, false);
  assert.deepEqual(leadDecision({ kind: 'deny', id: 'R1' }, { ...on, request: { id: 'R1', agent: 'openai', kind: 'push', status: 'pending' } }), { ok: true, action: 'denyperm' });
  assert.equal(leadDecision({ kind: 'deny', id: 'R1' }, { ...on, request: { id: 'R1', agent: 'openai', kind: 'push', status: 'denied' } }).ok, false);
  assert.equal(leadDecision({ kind: 'changes', id: 'ABC123', reason: '' }, { ...on, task: mk() }).ok, false);
  assert.deepEqual(leadDecision({ kind: 'changes', id: 'ABC123', reason: 'add a test' }, { ...on, task: mk() }), { ok: true, action: 'changes' });
});

test('every lead action is audited as "Claude (lead) …", with Undo where it can be undone', () => {
  assert.equal(leadLabel('anthropic', 'merge', 'T-ABC123'), 'Claude (lead) approved and merged T-ABC123');
  assert.equal(leadLabel('anthropic', 'denyperm', 'R-Q1W2E3'), 'Claude (lead) denied R-Q1W2E3');
  assert.equal(leadLabel('anthropic', 'start', 'T-ABC123'), 'Claude (lead) started T-ABC123');
  assert.equal(leadLabel('anthropic', 'add', 'T-ABC123', '“Dark mode”'), 'Claude (lead) added T-ABC123 “Dark mode”');
  assert.equal(leadLabel('google', 'approve', 'T-ABC123'), 'Gemini (lead) approved T-ABC123', 'follows whoever is lead');
  for (const a of ['denyperm', 'start', 'add']) assert.equal(leadUndoable(a), true);
  for (const a of ['merge', 'allowperm']) assert.equal(leadUndoable(a), false, 'no undo after a completed merge');
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const rec = src.slice(src.indexOf('function leadRecord('), src.indexOf('// Carries out an allowed lead action'));
  assert.match(rec, /audit\(label/);
  assert.match(rec, /post\(\{ who: 'system', text: label/);
});

test('the lead prompt mentions the ability only while the switch is on', () => {
  assert.doesNotMatch(chatRules('anthropic', 'anthropic'), /START: T-/);
  assert.match(chatRules('anthropic', 'anthropic', { leadActions: true }), /START: T-<id>/);
  assert.match(chatRules('anthropic', 'anthropic', { leadActions: true }), /cannot approve your own work/);
  assert.doesNotMatch(chatRules('openai', 'anthropic', { leadActions: true }), /START: T-/, 'only the lead is told');
  assert.match(buildPrompt('anthropic', [], { lead: 'anthropic', leadActions: true }), /ADD TASK:/);
  assert.doesNotMatch(buildPrompt('anthropic', [], { lead: 'anthropic' }), /ADD TASK:/);
  assert.match(buildDelta('anthropic', [], { lead: 'anthropic', leadActions: true }), /ADD TASK:/);
  assert.doesNotMatch(buildDelta('anthropic', [], { lead: 'anthropic' }), /ADD TASK:/);
});

import { pickReviewer } from '../src/lead.mjs';
test('the lead cannot approve push, command or outside requests (e.g. git push origin main --tags)', () => {
  for (const kind of ['push', 'command', 'outside']) {
    const r = leadDecision({ kind: 'allow', id: 'R1' }, { ...on, request: { id: 'R1', agent: 'openai', kind, what: 'git push origin main --tags', status: 'pending' } });
    assert.equal(r.ok, false, kind);
    assert.match(r.reason, /stay with the Owner/);
  }
  assert.equal(leadDecision({ kind: 'allow', id: 'R1' }, { ...on, request: { id: 'R1', agent: 'openai', kind: 'delete', status: 'pending' } }).ok, true);
});
test('the lead never merges on its own word, and the local model is not a code reviewer', () => {
  const selfReviewed = mk({ reviewer: 'anthropic', reviewVerdict: { verdict: 'approve', by: 'anthropic', sha: 'a'.repeat(40) } });
  const r = leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: selfReviewed });
  assert.equal(r.ok, false);
  assert.match(r.reason, /reviewed T-ABC123 itself/);
  const local = mk({ reviewer: 'ollama', reviewVerdict: { verdict: 'approve', by: 'ollama' } });
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: local }).ok, false);
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: mk({ reviewVerdict: undefined }) }).ok, false, 'no review: no lead merge');
  assert.equal(leadDecision({ kind: 'approve', id: 'ABC123' }, { ...on, task: mk({ reviewVerdict: { verdict: 'approve', by: 'google' } }) }).ok, true);
});
test('reviewer is never the implementer, and preferably not the lead or the local model', () => {
  const all = ['anthropic', 'openai', 'google', 'ollama'];
  assert.equal(pickReviewer('openai', { candidates: all, lead: 'anthropic' }), 'google');
  assert.equal(pickReviewer('openai', { requested: 'openai', candidates: all, lead: 'anthropic' }), 'google', 'a lead ADD TASK naming the implementer as reviewer is corrected');
  assert.equal(pickReviewer('openai', { requested: 'anthropic', candidates: all }), 'anthropic', 'an explicit choice is kept');
  assert.equal(pickReviewer('openai', { candidates: ['openai', 'anthropic'] }), 'anthropic');
  assert.equal(pickReviewer('openai', { candidates: ['openai'] }), 'none');
});
