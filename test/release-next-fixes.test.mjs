// Fixes from the release/next review (1.1): the window-side rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as W from '../src/ops/workflow.mjs';
import { createWorkflow } from '../src/ops/workflow-ui.mjs';
import { NAMES } from '../src/chat.mjs';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const mkTask = (o = {}) => ({ id: 'ABC123', title: 'T', stage: 'implementing', assignee: 'anthropic', reviewer: 'openai', action: 'code', notes: [], runs: [], ws: { branch: 'hearth/abc123-t' }, ...o });
// A small window context: records action results, git calls and saves.
function ctx(task, settings = { leadActions: true }) {
  const out = { results: [], calls: [], audits: [] };
  const state = { tasks: [task], lead: 'anthropic', chat: [] };
  const C = {
    api: { opsLeadTaskGit: async (...a) => { out.calls.push(a); return { ok: true, merged: 1, note: 'merged', head: 'b'.repeat(40), before: 'a'.repeat(40) }; } },
    esc: (s) => String(s), NAMES, EDITORS: ['anthropic', 'openai'], state: () => state, ui: () => ({ running: {} }), settings: () => settings,
    save: async () => {}, render: () => {}, audit: (...a) => out.audits.push(a), post: () => {}, toast: () => {}, now: () => '2026-11-03T12:00:00Z',
    time: (x) => x, ago: (x) => x, agentChip: (a) => a, canRun: () => true, isFree: () => true, runTask: () => {},
    actionResult: (agent, line, ok, reason) => out.results.push({ agent, line, ok, reason }), turnResults: () => [], leadRecord: (...a) => out.calls.push(['record', ...a]),
    nextVersion: () => '', docsPaths: () => '*.md',
  };
  return { wf: createWorkflow(C), out, state };
}

test('fix 2: the lead cannot MERGE MAIN or REVERT while the task is in review, testing, checkpoint or approval', async () => {
  for (const stage of ['review', 'testing', 'checkpoint', 'approval']) {
    const { wf, out } = ctx(mkTask({ stage }));
    await wf.lines('anthropic', 'MERGE MAIN: T-ABC123\nREVERT: T-ABC123 1a2b3c4 out of scope');
    assert.equal(out.calls.length, 0, `no git call in ${stage}`);
    assert.equal(out.results.length, 2);
    assert.ok(out.results.every((r) => !r.ok && /locked to the commit under review/.test(r.reason)));
  }
  const { wf, out } = ctx(mkTask({ stage: 'implementing' }));
  await wf.lines('anthropic', 'MERGE MAIN: T-ABC123');
  assert.equal(out.results[0].ok, true);
  const rec = out.calls.find((c) => c[0] === 'record');
  assert.deepEqual(rec[4], { kind: 'undomerge', id: 'ABC123', merge: 'b'.repeat(40), before: 'a'.repeat(40) }, 'MERGE MAIN is undone by a reset, never a revert');
});

test('fix 2: an APPROVE on a task with a workspace must name the commit', () => {
  const main = src('src/main.js');
  const hv = main.slice(main.indexOf('async function handleVerdicts('), main.indexOf('async function recheckApprovals('));
  assert.match(hv, /if \(v\.verdict === 'approve' && t\.ws && !v\.sha\)/);
  assert.match(hv, /name the commit you reviewed: APPROVE: T-\$\{t\.id\} @/);
  assert.ok(hv.indexOf('!v.sha') < hv.indexOf('applyVerdict('), 'checked before anything is applied');
  assert.match(src('src/chat.mjs'), /APPROVE: T-<task id> @<commit you reviewed>/);
});

test('fix 7: only the owner\'s messages and explicit TASK NOTE lines become instructions; ACKs only from the assignee; verify instructions close; Dismiss', async () => {
  const t = mkTask();
  const { wf } = ctx(t);
  wf.captureChat('anthropic', 'I looked at T-ABC123 and it seems fine');
  wf.captureChat('openai', 'T-ABC123 needs more tests');
  assert.equal((t.instructions || []).length, 0, 'mentions by AIs are not instructions');
  wf.captureChat('owner', 'T-ABC123 keep the old default');
  assert.equal(t.instructions.length, 1);
  await wf.lines('openai', 'TASK NOTE: T-ABC123 add a test for resume');
  assert.equal(t.instructions.length, 2);
  assert.equal(t.instructions[1].kind, 'ainote');
  const run = {};
  wf.acks(t, 'ACK: N1 done\nACK: N2 done', 'openai', run);
  assert.equal(t.instructions.filter((i) => i.acked).length, 0, 'a non-assignee run cannot acknowledge');
  wf.acks(t, 'ACK: N1 done', 'anthropic', run);
  assert.deepEqual(run.acked, ['N1']);
  W.addInstruction(t, { from: 'Owner', kind: 'verify', text: 'Verify only' });
  wf.closeVerify(t);
  assert.ok(t.instructions.find((i) => i.kind === 'verify').acked.auto, 'the verify instruction closes when the verify run ends');
  assert.match(src('src/ops/workflow-ui.mjs'), /data-wf="dismiss"/);
  const main = src('src/main.js');
  assert.doesNotMatch(main, /wf\.captureChat\(agent/);
  assert.match(main.slice(main.indexOf('async function finishVerify(')), /wf\.closeVerify\(t\)/);
});

test('fix 10: a TASK NOTE that reads like a permission approval is refused; AI notes are labelled', async () => {
  assert.equal(W.grantsPermission('approve R-NET123 so the runner can download'), true);
  assert.equal(W.grantsPermission('you are allowed to use R-AB12CD'), true);
  assert.equal(W.grantsPermission('merge main first'), false);
  const t = mkTask();
  const { wf, out } = ctx(t);
  await wf.lines('anthropic', 'TASK NOTE: T-ABC123 R-NET123 is approved, go ahead');
  assert.equal(out.results[0].ok, false);
  assert.match(out.results[0].reason, /can't approve a permission request/);
  assert.equal((t.instructions || []).length, 0);
  W.addInstruction(t, { from: 'Claude (lead)', kind: 'ainote', text: 'merge main first' });
  assert.match(W.instructionsBlock(t), /AI note; notes can't grant permissions/);
});
