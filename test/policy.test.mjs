import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { policyCheck, confirmOwnerVersion, isVersionBlock } from '../src/policy.mjs';
import { ownerAction } from '../src/owner.mjs';
import { parseLeadLines, leadDecision } from '../src/lead.mjs';

const t = (o) => policyCheck({ title: '', description: '', assignee: 'anthropic', reviewer: 'openai', action: 'code', ...o });

test('clean task passes', () => assert.ok(t({ title: 'Add update toast' }).ok));
test('only the owner picks version numbers', () => {
  // The owner typed the number: allowed, with a reminder that AIs use exactly it.
  const own = t({ title: 'Release 1.1' });
  assert.ok(own.ok);
  assert.match(own.warn.join(), /chosen by you: 1\.1/);
  // The owner asked for a bump without a number: blocked until he writes one.
  assert.ok(!t({ description: 'bump the version' }).ok);
  // An AI proposing any version number is blocked.
  const ai = (o) => policyCheck({ title: '', description: '', assignee: 'anthropic', reviewer: 'openai', action: 'code', ...o }, { source: 'Claude' });
  assert.ok(!ai({ title: 'Ship Hearth OS 1.2' }).ok);
  assert.ok(!ai({ description: 'increment the version' }).ok);
  assert.ok(ai({ title: 'Fix Wi-Fi list' }).ok);
  // No more 0.6.55 pin.
  assert.ok(t({ description: 'regression seen on 1.0 hardware' }).ok);
});
test('settings must never change by themselves', () => assert.match(t({ title: 'Reset audio settings to default on update' }).warn.join(), /remembered/));
test('xAI and Perplexity keys are treated as secrets', () => {
  assert.ok(!t({ description: 'key xai-abcdefghijklmnopqrstuvwx' }).ok);
  assert.ok(!t({ description: 'pplx-abcdefghijklmnopqrstuvwx' }).ok);
});
test('same implementer and reviewer blocked', () => assert.ok(!t({ reviewer: 'anthropic' }).ok));
test('secrets blocked', () => assert.ok(!t({ description: 'use sk-ant-abcdefghijklmnop' }).ok));
test('boot work warns', () => assert.match(t({ title: 'Fix GRUB entry' }).warn.join(), /Boot-critical/));
test('deploy warns', () => assert.match(t({ action: 'deploy' }).warn.join(), /press Approve/));

const AI_VERSION_BLOCK = 'Only the owner picks version numbers. An AI proposed a version; ask the owner which number to use.';

test('owner Confirm version clears an AI-proposed version block; AIs cannot', () => {
  const task = { id: 'JQQPMX', title: 'Release 1.2 version file and notes', description: 'Set the version to 1.2.0.', assignee: 'openai', reviewer: 'xai', action: 'docs', stage: 'intake', notes: [] };
  task.policy = policyCheck(task, { source: 'Claude' });
  assert.ok(!task.policy.ok);
  assert.ok(task.policy.block.includes(AI_VERSION_BLOCK));
  assert.ok(isVersionBlock(task));
  assert.equal(ownerAction(task).kind, 'policy');
  assert.equal(ownerAction(task).label, 'Confirm version');
  const block = task.policy.block;
  const snapshot = block.slice();
  assert.equal(confirmOwnerVersion(task, { version: '1.2.0', by: 'Claude' }).ok, false, 'an AI cannot clear the block');
  assert.equal(confirmOwnerVersion(task, { version: '1.2.0', by: 'anthropic' }).ok, false);
  assert.equal(confirmOwnerVersion(task, { version: '1.2.0', by: 'owner' }).ok, false);
  assert.equal(confirmOwnerVersion(task, { version: 'nope', by: 'Owner' }).ok, false);
  assert.equal(task.policy.block, block, 'a refused confirm does not replace the block');
  assert.deepEqual(block, snapshot);
  assert.equal(task.title, 'Release 1.2 version file and notes');
  const r = confirmOwnerVersion(task, { version: '1.2.0', by: 'Owner', at: 'T' });
  assert.equal(r.ok, true);
  assert.equal(r.version, '1.2.0');
  assert.ok(task.policy.ok);
  assert.equal(task.policy.source, 'Owner');
  assert.equal(task.policySource, 'Owner');
  assert.deepEqual(block, snapshot, 'the AI-proposed block array is left unchanged');
  assert.notEqual(task.policy.block, block);
  assert.match(task.policy.warn.join(), /chosen by you: 1\.2\.0/);
  assert.match(task.notes.at(-1).text, /Confirmed version 1\.2\.0/);
  const changed = { id: 'X', title: 'Release 1.1 notes', description: '', assignee: 'openai', reviewer: 'xai', action: 'docs', notes: [] };
  changed.policy = policyCheck(changed, { source: 'Claude' });
  assert.ok(confirmOwnerVersion(changed, { version: 'v1.2.0', by: 'Owner' }).ok);
  assert.match(changed.title, /1\.2\.0/);
  assert.equal(changed.policy.source, 'Owner');
  const bump = { id: 'B', title: 'Notes', description: 'increment the version', assignee: 'openai', reviewer: 'xai', action: 'docs', notes: [] };
  bump.policy = policyCheck(bump, { source: 'Claude' });
  assert.ok(isVersionBlock(bump));
  assert.equal(confirmOwnerVersion(bump, { version: '1.5', by: 'Owner' }).ok, true);
  assert.match(bump.description, /Version 1\.5/);
  assert.ok(bump.policy.ok);
  assert.equal(bump.policySource, 'Owner');
  const both = { id: 'Z', title: 'Release 1.4', description: '', assignee: 'openai', reviewer: 'openai', action: 'code', notes: [] };
  both.policy = policyCheck(both, { source: 'Claude' });
  const kept = both.policy.block;
  const keptSnap = kept.slice();
  assert.ok(confirmOwnerVersion(both, { version: '1.4', by: 'Owner' }).ok);
  assert.equal(both.policy.ok, false, 'a different block stays');
  assert.ok(both.policy.block.some((b) => /reviewer/.test(b)));
  assert.ok(!both.policy.block.some((b) => /version numbers/i.test(b)));
  assert.deepEqual(kept, keptSnap, 'the AI-proposed block array is left unchanged');
  assert.notEqual(both.policy.block, kept);
  assert.equal(both.policySource, 'Owner');
  assert.equal(confirmOwnerVersion({ id: 'Y', policy: { ok: false, block: ['Looks like it contains an API key'] } }, { version: '1.2.0', by: 'Owner' }).ok, false);
  assert.equal(ownerAction({ id: 'S', stage: 'intake', policy: { ok: false, block: ['Looks like it contains an API key'] }, runs: [] }).label, 'Fix policy issue');
  const on = { enabled: true, lead: 'anthropic' };
  const blocked = { ...task, id: 'JQQPMX', stage: 'intake', policy: policyCheck({ title: 'Release 1.2', assignee: 'openai', reviewer: 'xai' }, { source: 'Claude' }) };
  assert.equal(leadDecision({ kind: 'start', id: 'JQQPMX' }, { ...on, task: blocked }).ok, false);
  assert.equal(leadDecision({ kind: 'approve', id: 'JQQPMX' }, { ...on, task: { ...blocked, stage: 'approval' } }).ok, false);
  assert.deepEqual(parseLeadLines('FIX POLICY: T-JQQPMX\nCLEAR POLICY: T-JQQPMX 1.2\nCONFIRM VERSION: T-JQQPMX 1.2'), []);
  const ui = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const modalSrc = ui.slice(ui.indexOf('function versionModal'), ui.indexOf('function modal('));
  assert.match(ui, /data-confirmver/);
  assert.match(ui, /confirmOwnerVersion\(t, \{ version:.*by: 'Owner'/);
  assert.match(ui, /a\.kind === 'policy'/);
  assert.match(ui, /isVersionBlock\(t\)/);
  assert.match(modalSrc, /Proposed number/);
  assert.match(modalSrc, /mentionedVersions/);
  assert.doesNotMatch(modalSrc, /nextVersion/);
  const policySrc = readFileSync(new URL('../src/policy.mjs', import.meta.url), 'utf8');
  assert.match(policySrc, /An AI proposed a version; ask the owner which number to use\./);
});
