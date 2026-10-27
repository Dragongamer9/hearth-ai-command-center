const test = require('node:test');
const assert = require('node:assert');
const v = require('../electron/validate.cjs');

test('provider whitelist', () => {
  assert.equal(v.validateProvider('openai'), 'openai');
  assert.throws(() => v.validateProvider('../../etc/passwd'));
  assert.throws(() => v.validateProvider('freebuff', { liveOnly: true }));
});
test('api key format', () => {
  assert.equal(v.validateApiKey('  abcdefgh12345 '), 'abcdefgh12345');
  assert.throws(() => v.validateApiKey('short'));
  assert.throws(() => v.validateApiKey('has space inside'));
  assert.throws(() => v.validateApiKey({}));
});
test('model names', () => {
  assert.equal(v.validateModel('claude-sonnet-5-5'), 'claude-sonnet-5-5');
  assert.throws(() => v.validateModel('rm -rf /; x'));
});
test('state shape and size', () => {
  assert.ok(v.validateState({ tasks: [], audit: [] }));
  assert.throws(() => v.validateState([]));
  assert.throws(() => v.validateState({ tasks: 'x', audit: [] }));
  assert.throws(() => v.validateState({ tasks: [], audit: [], big: 'x'.repeat(6 * 1024 * 1024) }));
});
test('prompt', () => {
  assert.throws(() => v.validatePrompt('   '));
  assert.throws(() => v.validatePrompt('x'.repeat(60001)));
});
