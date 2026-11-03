// Guards in the app code that can't run outside Electron: checked in the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); const j = src.indexOf(b, i + a.length); return src.slice(i, j < 0 ? undefined : j); };

test('upgrading never turns pushes on: lead GitHub is off until the owner turns it on, and autoPush=false always wins', () => {
  assert.match(main, /leadGitHub: s\.leadGitHub === true,/);
  assert.match(ui, /const leadGitHubOn = \(\) => settings\.leadGitHub === true;/);
  const body = between(ui, 'async function autoPush(taskId) {', '\n}\n');
  const off = body.indexOf("if (settings.autoPush === false) return null;");
  assert.ok(off > 0 && off < body.indexOf('gitLeadSync') && off < body.indexOf('gitPushTask'), 'checked before any push');
});

test('merges send the approved commit; the main process checks it and the lead switch itself', () => {
  for (const call of ['api.gitMergeApproved(t.id, { sha: approvedSha(t) })', 'api.gitPrMerge(pr.number, { sha: approvedSha(t) })', 'api.gitMergeApproved(t.id, { byLead: true, sha: approvedSha(t) })', 'api.gitPrMerge(pr.number, { byLead: true, sha: approvedSha(t) })']) assert.ok(ui.includes(call), call);
  const merge = between(main, "handle('git:mergeApproved'", "handle('git:");
  assert.match(merge, /rev-parse', 'HEAD'\]\)\)\.out !== sha/);
  assert.match(merge, /if \(s\.leadActions !== true\) return/);
  assert.match(between(main, "handle('git:prMerge'", "handle('git:"), /if \(s\.leadActions !== true\) return/);
  assert.match(between(main, "handle('git:leadSync'", "handle('git:"), /if \(s\.leadGitHub !== true\) return/);
});

test('Approve only and Combine recheck approvals first and never snapshot dirty workspaces', () => {
  const approve = between(ui, '  if (d.approve) {', '  if (d.reject)');
  assert.ok(approve.indexOf('recheckApprovals') < approve.indexOf("t.decision = 'approved'"));
  const combine = between(ui, '  if (d.releasebranch !== undefined) {', '  if (d.approvemerge)');
  assert.ok(combine.indexOf('await recheckApprovals()') < combine.indexOf('gitReleaseBranch'));
  assert.doesNotMatch(combine, /api\.checkpoint/);
  assert.match(combine, /sha: approvedSha\(t\)/);
  assert.match(between(main, "handle('git:releaseBranch'", "handle('git:"), /has unsaved changes/);
});

test('Update from main refuses while the task is running', () => {
  const up = between(ui, '  if (d.updatemain) {', '  if (d.releasebranch');
  assert.ok(up.indexOf('if (ui.running[t.id])') > 0 && up.indexOf('if (ui.running[t.id])') < up.indexOf('gitUpdateFromMain'));
  assert.doesNotMatch(up, /api\.checkpoint/);
});

test('no Undo once a lead approval is on the release branch', () => {
  assert.match(ui, /if \(t\.integratedInto\) \{ entry\.undo = null;/);
  assert.match(between(ui, "} else if (u.kind === 'stage') {", '} else'), /if \(t\.integratedInto\) return toast/);
});

test('a failed key Test sets the shared sign-in hold', () => {
  const t = between(ui, 'if (d.testkey) {', 'if (d.rmkey) {');
  assert.match(t, /authProblem\(test\.result\?\.error, \{ method: 'api' \}\)/);
  assert.match(t, /setHold\(p, problem\)/);
});
