// 3.10: "Add Ithil to the team" and her switch in Settings › AI team were dropped when the settings were saved
// (cleanTeam only kept TEAM_IDS, which hadn't got her). She's kept as a member, never as the lead or reviewer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');

function cleanTeamFn() {
  const a = src.indexOf('const TEAM_IDS = ');
  const b = src.indexOf('// Plain JSON only', a);
  const code = src.slice(a, b).replace(/^const /gm, 'var ').replace(/^function /gm, 'function ');
  const more = { TEAM: [], WEB_IDS: [] };
  const ctx = { more };
  vm.runInNewContext(code + '\nthis.cleanTeam = cleanTeam;', ctx);
  return ctx.cleanTeam;
}

test('Ithil stays in the team once added', () => {
  const cleanTeam = cleanTeamFn();
  const t = cleanTeam({ lead: 'anthropic', reviewer: 'openai', members: ['anthropic', 'openai', 'ithil'] });
  assert.deepEqual([...t.members], ['anthropic', 'openai', 'ithil']);
});

test('she is never the lead or the reviewer', () => {
  const cleanTeam = cleanTeamFn();
  const t = cleanTeam({ lead: 'ithil', reviewer: 'ithil', members: ['ithil'] });
  assert.equal(t.lead, 'anthropic');
  assert.equal(t.reviewer, 'openai');
  assert.deepEqual([...t.members], ['ithil']);
});
