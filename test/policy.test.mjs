import test from 'node:test';
import assert from 'node:assert';
import { policyCheck } from '../src/policy.mjs';

const t = (o) => policyCheck({ title: '', description: '', assignee: 'anthropic', reviewer: 'openai', action: 'code', ...o });

test('clean task passes', () => assert.ok(t({ title: 'Add update toast' }).ok));
test('Hearth OS version change is blocked', () => {
  assert.ok(!t({ title: 'Release 0.6.56' }).ok);
  assert.ok(!t({ description: 'bump the version' }).ok);
  assert.ok(t({ description: 'test on 0.6.55' }).ok);
});
test('same implementer and reviewer blocked', () => assert.ok(!t({ reviewer: 'anthropic' }).ok));
test('secrets blocked', () => assert.ok(!t({ description: 'use sk-ant-abcdefghijklmnop' }).ok));
test('boot work warns', () => assert.match(t({ title: 'Fix GRUB entry' }).warn.join(), /Boot-critical/));
test('deploy warns', () => assert.match(t({ action: 'deploy' }).warn.join(), /owner approval/));
