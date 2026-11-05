// Part C: "Claude can do everything I can (asks me first every time)".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACT_AGENT, ACT_TTL_MS, parseActLines, makeActRequest, typedDecision, stillValid, settle, undoEntry, hardLimit, describe } from '../src/ops/actforme.mjs';

const ui = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const mainProc = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const opsMain = readFileSync(new URL('../electron/ops/index.cjs', import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const task = { id: 'ST0002', title: 'Storage page', ws: { branch: 'hearth/st0002-storage' } };
const ctx = (o = {}) => ({ agent: 'anthropic', on: true, projectId: 'default', chatId: 'c0123456789', nextVersion: '1.3.1', tasks: [task], permissions: [{ id: 'R1NET', agent: 'google', status: 'pending', what: 'download' }], settings: { autoPush: true, theme: 'dark' }, projectSettings: { stallMin: 45 }, agents: ['anthropic', 'openai'], shaOf: () => 'c0ffee15d9a3b2e4f6', now: NOW, ...o });
const one = (line, o) => makeActRequest(parseActLines(line)[0], ctx(o));

test('off by default, and only the owner can turn it on (native confirmation in the main process)', () => {
  assert.match(mainProc, /actForMe: s\.actForMe === true/, 'reads as off unless saved as true');
  const set = mainProc.slice(mainProc.indexOf("handle('settings:set'"), mainProc.indexOf("handle('settings:addDir'"));
  assert.match(set, /'actForMe' in patch[\s\S]*showMessageBoxSync/, 'turning it on asks in a native dialog');
  assert.equal(one('ACT FOR OWNER: merge T-ST0002', { on: false }).ok, false);
  assert.match(one('ACT FOR OWNER: merge T-ST0002', { on: false }).reason, /is off/);
  // No AI path can flip it: it is a hard limit for Claude's setting requests.
  assert.match(one('ACT FOR OWNER: setting actForMe off').reason, /only you can turn/);
});

test('only Claude may ask (the owner asked for Claude), and a request is just a request', () => {
  assert.equal(ACT_AGENT, 'anthropic');
  assert.match(one('ACT FOR OWNER: merge T-ST0002', { agent: 'openai' }).reason, /only Claude/);
  const r = one('ACT FOR OWNER: merge T-ST0002');
  assert.equal(r.ok, true);
  assert.equal(r.request.status, 'pending');
  assert.equal(r.request.sha, 'c0ffee15d9a3b2e4f6');
  assert.equal(r.request.branch, 'hearth/st0002-storage');
  assert.equal(r.request.level, 'owner', 'uses the approval levels: merge is Owner-only');
});

test('nothing runs without a yes: the action runs only after Allow (popup) or a typed yes', () => {
  const decide = ui.slice(ui.indexOf('async function decideAct('), ui.indexOf('function ownerClick('));
  assert.ok(decide.indexOf("settle(req, 'allow'") < decide.indexOf('runAct('), 'runs only after it was allowed');
  assert.equal((ui.match(/await runAct\(/g) || []).length, 1, 'one call site');
  assert.doesNotMatch(ui.slice(ui.indexOf('function actLines('), ui.indexOf('function actCard(')), /runAct\(/, 'asking never runs anything');
  assert.doesNotMatch(ui, /allow all|allowAll/i, 'never "allow all"');
});

test('a typed yes from an AI, a relayed post or a quote is ignored; only the owner\'s own exact yes counts', () => {
  const pending = [{ id: 'AAB12CD', status: 'pending' }];
  assert.equal(typedDecision({ who: 'anthropic', text: 'yes' }, pending), null);
  assert.equal(typedDecision({ who: 'system', text: 'approve' }, pending), null);
  assert.equal(typedDecision({ who: 'owner', relayed: true, text: 'yes' }, pending), null, 'Post as FreeBuff');
  assert.equal(typedDecision({ who: 'owner', auto: true, text: 'yes' }, pending), null, 'auto messages');
  assert.equal(typedDecision({ who: 'owner', text: '> yes' }, pending), null, 'a quote');
  assert.equal(typedDecision({ who: 'owner', text: 'yes, and also merge T-X' }, pending), null, 'only an exact yes');
  assert.deepEqual(typedDecision({ who: 'owner', text: 'Yes' }, pending), { decision: 'allow', id: 'AAB12CD' });
  assert.deepEqual(typedDecision({ who: 'owner', text: 'deny' }, pending), { decision: 'deny', id: 'AAB12CD' });
  const two = [...pending, { id: 'AZZ99YY', status: 'pending' }];
  assert.match(typedDecision({ who: 'owner', text: 'yes' }, two).error, /2 requests are waiting/);
  assert.deepEqual(typedDecision({ who: 'owner', text: 'approve AZZ99YY' }, two), { decision: 'allow', id: 'AZZ99YY' });
  // Only sendChat (the owner's composer) reads typed answers; AI turns never do.
  assert.equal((ui.match(/typedDecision\(/g) || []).length, 1);
  const send = ui.slice(ui.indexOf('async function sendChat()'), ui.indexOf('// The room.'));
  assert.match(send, /typedDecision\(/);
});

test('an approval is bound to its commit, target, project and chat; an expired one is refused; used once', () => {
  const r = one('ACT FOR OWNER: merge T-ST0002').request;
  const cur = { now: NOW + 60000, projectId: 'default', chatId: 'c0123456789', sha: 'c0ffee15d9a3b2e4f6', nextVersion: '1.3.1' };
  assert.equal(stillValid(r, cur).ok, true);
  assert.match(stillValid(r, { ...cur, sha: 'deadbeef00' }).reason, /moved from c0ffee1 to deadbee/);
  assert.match(stillValid(r, { ...cur, now: NOW + ACT_TTL_MS + 1 }).reason, /expired/);
  assert.match(stillValid(r, { ...cur, projectId: 'b7c1d2e3' }).reason, /project changed/);
  assert.match(stillValid(r, { ...cur, chatId: 'team-default' }).reason, /another chat/);
  settle(r, 'allow', { now: NOW });
  assert.equal(r.status, 'allowed');
  assert.match(stillValid(r, cur).reason, /already answered/, "can't be reused");
  const s = one('ACT FOR OWNER: setting autoPush off').request;
  assert.match(stillValid(s, { ...cur, settingNow: false }).reason, /changed since/);
  assert.equal(stillValid(s, { ...cur, settingNow: true }).ok, true);
});

test('version numbers and the updaters are refused even with permission', () => {
  assert.match(one('ACT FOR OWNER: release v2.0.0').reason, /only release your Next version v1\.3\.1/);
  assert.match(one('ACT FOR OWNER: tag v1.3.2').reason, /never picks a version/);
  assert.match(one('ACT FOR OWNER: release v1.3.1', { nextVersion: '' }).reason, /not set a Next version/);
  assert.equal(one('ACT FOR OWNER: release v1.3.1').ok, true);
  for (const k of ['nextVersion', 'versionFile', 'autoUpdate', 'updaterChannel', 'ownerIdentity', 'commitAuthor', 'releaseCommand']) assert.ok(hardLimit(k), k);
  assert.match(one('ACT FOR OWNER: project setting nextVersion 9.9.9').reason, /version number/);
  assert.match(one('ACT FOR OWNER: setting autoUpdate on').reason, /updaters/);
  assert.match(one('ACT FOR OWNER: setting ownerIdentity x').reason, /identity/);
  const r = one('ACT FOR OWNER: release v1.3.1').request;
  assert.match(stillValid(r, { now: NOW, projectId: 'default', chatId: 'c0123456789', nextVersion: '1.3.2' }).reason, /no longer v1\.3\.1/);
  // The main process checks it again (Next version, a native confirmation, the release gate).
  const act = opsMain.slice(opsMain.indexOf("handle('ops:actRelease'"), opsMain.indexOf('async function releaseOrTag'));
  assert.match(act, /ps\.nextVersion !== ver/);
  assert.match(act, /showMessageBoxSync/);
  assert.match(act, /s\.actForMe !== true/);
  // The updaters aren't reachable from Claude's actions at all.
  const acts = ui.slice(ui.indexOf('async function runAct('), ui.indexOf('async function undoAct('));
  assert.doesNotMatch(acts, /updater|Updater/);
});

test('a settings change made with permission is recorded (who, old → new) and undoable in one click', () => {
  const req = one('ACT FOR OWNER: project setting stallMin 60').request;
  assert.deepEqual([req.key, req.before, req.after], ['stallMin', 45, 60]);
  const e = undoEntry(req, NOW);
  assert.equal(e.by, 'Claude, with your yes');
  assert.deepEqual([e.before, e.after, e.scope, e.undone], [45, 60, 'project', false]);
  const d = describe(req, { projectName: 'hearth-os' });
  assert.ok(d.facts.some(([k, v]) => k === 'Old value' && v === '45'));
  assert.ok(d.facts.some(([k, v]) => k === 'New value' && v === '60'));
  const run = ui.slice(ui.indexOf('async function runAct('), ui.indexOf('async function undoAct('));
  assert.match(run, /state\.actLog = \[undoEntry\(req\)/);
  assert.match(run, /audit\(`Setting changed by Claude with your yes/);
  const undo = ui.slice(ui.indexOf('async function undoAct('), ui.indexOf('function audit('));
  assert.match(undo, /\[e\.key\]: e\.before/);
  assert.match(undo, /e\.undone = true/);
});

test('parsing: every owner action Claude may ask for', () => {
  const kinds = parseActLines([
    'ACT FOR OWNER: approve T-AB12', 'ACT FOR OWNER: merge T-AB12', 'ACT FOR OWNER: reject T-AB12', 'ACT FOR OWNER: changes T-AB12 — fix the test',
    'ACT FOR OWNER: push T-AB12', 'ACT FOR OWNER: pr T-AB12', 'ACT FOR OWNER: start T-AB12', 'ACT FOR OWNER: stop T-AB12', 'ACT FOR OWNER: assign T-AB12 to @openai',
    'ACT FOR OWNER: allow R-AB12', 'ACT FOR OWNER: deny R-AB12', 'ACT FOR OWNER: release v1.3.1', 'ACT FOR OWNER: tag 1.3.1',
    'ACT FOR OWNER: setting autoPush off', 'ACT FOR OWNER: project setting stallMin 60', 'just text', 'ACT FOR OWNER: format the disk',
  ].join('\n')).map((c) => c.kind);
  assert.deepEqual(kinds, ['approve', 'merge', 'reject', 'changes', 'push', 'pr', 'start', 'stop', 'assign', 'allow', 'deny', 'release', 'tag', 'setting', 'projectsetting', 'unknown']);
  assert.match(one('ACT FOR OWNER: allow R-NOPE1').reason, /no pending/);
  assert.equal(one('ACT FOR OWNER: allow R-R1NET').ok, true);
  assert.match(one('ACT FOR OWNER: allow R-R1NET', { permissions: [{ id: 'R1NET', agent: 'anthropic', status: 'pending' }] }).reason, /its own permission/);
});
