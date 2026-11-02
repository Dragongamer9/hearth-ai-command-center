import test from 'node:test';
import assert from 'node:assert';
import { policyCheck } from '../src/policy.mjs';

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
