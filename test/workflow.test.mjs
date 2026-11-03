import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as wf0 from '../src/ops/workflow.mjs';
import { createRequire } from 'node:module';
const gate = createRequire(import.meta.url)('../electron/ops/gate.cjs');
const wf = { ...wf0, ...gate };
import { parseVerdicts, applyVerdict } from '../src/owner.mjs';
import { leadDecision } from '../src/lead.mjs';
import { describeMedia, aspect, attachmentLine } from '../src/media.mjs';
import { teamHabitat, teamHabitatLine, whereIs } from '../src/habitat/status.mjs';

const pol = { ok: true, block: [], warn: [] };
const mk = (o = {}) => ({ id: 'ABC123', title: 'Fix the Wi-Fi list', stage: 'review', assignee: 'anthropic', reviewer: 'openai', action: 'code', policy: pol, notes: [], runs: [], ...o });
const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);

// ---------- A ----------
test('A: truth card comes from git facts: branch, head, behind/ahead, tests at that exact sha, last review, merged', () => {
  const t = mk();
  wf.recordTest(t, H1, { status: 'passed', command: 'npm test' });
  wf.recordReview(t, { by: 'openai', verdict: 'approve', sha: H1, accepted: true });
  const c = wf.truthCard(t, { branch: 'hearth/abc123-wifi', head: H1, behind: 2, ahead: 3, stat: '3 files, +10 −2', merged: null });
  assert.equal(c.tests.status, 'passed');
  assert.equal(c.tests.exact, true);
  assert.equal(c.review.accepted, true);
  assert.equal(c.behind, 2);
  const moved = wf.truthCard(t, { head: H2, behind: 0, ahead: 4 });
  assert.equal(moved.tests.status, 'not run at this commit', 'a test result never carries over to another commit');
  assert.equal(moved.review.stale, true);
  const line = wf.truthLine(t, { branch: 'hearth/abc123-wifi', head: H1, behind: 2, ahead: 3, merged: 'release/next' });
  assert.match(line, /behind main 2, ahead 3/);
  assert.match(line, /tests passed @aaaaaaa/);
  assert.match(line, /APPROVE by ChatGPT @aaaaaaa \(accepted\)/);
  assert.match(line, /merged: release\/next/);
});

// ---------- B ----------
test('B: verdict lines may name the sha they reviewed', () => {
  assert.deepEqual(parseVerdicts('APPROVE: T-ABC123 @1a2b3c4 looks good'), [{ verdict: 'approve', taskId: 'ABC123', reason: 'looks good', sha: '1a2b3c4' }]);
  assert.deepEqual(parseVerdicts('CHANGES: T-ABC123 add a test'), [{ verdict: 'changes', taskId: 'ABC123', reason: 'add a test' }]);
});

test('B: a reviewer APPROVE on a stopped task is held against its sha, never lost, and applies when it reaches review at that sha', () => {
  const t = mk({ stage: 'implementing', runs: [{ agent: 'anthropic', status: 'cancelled' }] });
  const r = applyVerdict(t, { by: 'openai', verdict: 'approve', sha: H1 });
  assert.equal(r.ok, false, 'not reviewable yet');
  wf.recordReview(t, { by: 'openai', verdict: 'approve', sha: H1, accepted: false, why: r.reason });
  assert.equal(wf.holdApproval(t, { by: 'openai', sha: H1 }), true);
  assert.equal(wf.lastReview(t).held, true);
  t.stage = 'review';
  const u = wf.useHeldApproval(t, H1);
  assert.deepEqual(u, { applied: true, by: 'openai', sha: H1 });
  assert.equal(t.stage, 'approval');
  assert.equal(t.reviewVerdict.sha, H1);
});

test('B: a held approval is dropped with the exact reason when the head moved', () => {
  const t = mk({ stage: 'implementing' });
  wf.holdApproval(t, { by: 'openai', sha: H1 });
  const u = wf.useHeldApproval(t, H2);
  assert.equal(u.dropped, true);
  assert.equal(u.why, 'head moved since your review (aaaaaaa→bbbbbbb)');
  assert.equal(t.heldApproval, undefined);
  assert.equal(wf.holdApproval(mk({ stage: 'implementing' }), { by: 'xai', sha: H1 }), false, 'not the assigned reviewer');
});

test('B: CHANGES are tied to the commit they were given for, so APPROVE at the same commit is refused', () => {
  const t = mk({ stage: 'review' });
  assert.equal(applyVerdict(t, { by: 'openai', verdict: 'changes', reason: 'add a test', sha: H1 }).ok, true);
  assert.equal(t.changesSince.sha, H1);
  const again = applyVerdict(t, { by: 'openai', verdict: 'approve', sha: H1 });
  assert.equal(again.ok, false);
  assert.match(again.reason, /no new commit since changes were requested/);
  assert.equal(applyVerdict(t, { by: 'openai', verdict: 'approve', sha: H2 }).ok, true);
});

test('B: the lead APPROVE on a task stopped after CHANGES is refused with the reason instead of quietly resuming it', () => {
  const t = mk({ stage: 'implementing', reviewer: 'openai', changesSince: { sha: H1, by: 'openai' }, reviewVerdict: { verdict: 'changes', by: 'openai' } });
  const d = leadDecision({ kind: 'approve', id: t.id }, { lead: 'anthropic', enabled: true, task: t, resumable: true, powers: { merge: false } });
  assert.equal(d.ok, false);
  assert.match(d.reason, /not the assigned reviewer \(ChatGPT\)/);
  const plain = mk({ stage: 'implementing' });
  assert.equal(leadDecision({ kind: 'approve', id: plain.id }, { lead: 'anthropic', enabled: true, task: plain, resumable: true, powers: {} }).action, 'resume', 'a plainly stopped task still resumes');
});

test('B: every action-looking line without a result is found', () => {
  const text = 'Done.\nAPPROVE: T-ABC123\nSTART: T-XYZ999\nTASK NOTE: T-ABC123 merge main first\nHABITAT: go garden\nI will approve later.';
  const missing = wf.unanswered(text, [{ line: 'APPROVE: T-ABC123', ok: false }]);
  assert.deepEqual(missing, ['START: T-XYZ999', 'TASK NOTE: T-ABC123 merge main first']);
  assert.deepEqual(wf.unanswered('RELEASE: v1.2', [{ line: 'RELEASE: v1.2', ok: true }]), []);
});

// ---------- C ----------
test('C: instruction log: messages, stops, CHANGES and permissions are appended, shown first, and must be acknowledged', () => {
  const t = mk({ stage: 'implementing' });
  wf.addInstruction(t, { from: 'Owner', kind: 'owner', text: 'T-ABC123 keep the old list as fallback' });
  wf.addInstruction(t, { from: 'Claude (lead)', kind: 'note', text: 'merge main first' });
  assert.equal(wf.addInstruction(t, { from: 'Claude (lead)', kind: 'note', text: 'merge main first' }), null, 'no duplicates');
  wf.addInstruction(t, { from: 'Owner', kind: 'stop', text: 'The Owner stopped the run' });
  const block = wf.instructionsBlock(t);
  assert.match(block, /^# Instructions for T-ABC123/);
  assert.match(block, /N1 NEW · Owner \(owner\)/);
  assert.match(block, /ACK: N1/);
  const r = wf.applyAcks(t, 'did it\nACK: N1 kept it\n- ACK: N2, N3 merged main');
  assert.deepEqual(r.acked, ['N1', 'N2', 'N3']);
  assert.deepEqual(r.missing, []);
  wf.addInstruction(t, { from: 'ChatGPT (review)', kind: 'changes', text: 'add a test' });
  assert.deepEqual(wf.applyAcks(t, 'nothing').missing, ['N4']);
  assert.match(wf.instructionsBlock(t), /N1 \(done\)/);
});

test('C: TASK NOTE / VERIFY / MERGE MAIN / REVERT lines and T-id mentions', () => {
  assert.deepEqual(wf.parseWorkflowLines('TASK NOTE: T-abc123 verify only\n- VERIFY: T-ABC123\nMERGE MAIN: T-ABC123\nREVERT: T-ABC123 1a2b3c4d out of scope').map((x) => x.kind), ['note', 'verify', 'mergemain', 'revert']);
  assert.equal(wf.parseWorkflowLines('REVERT: T-ABC123 1A2B3C4D why')[0].sha, '1a2b3c4d');
  assert.deepEqual(wf.taskIds('see T-ABC123 and T-XYZ789, T-ABC123'), ['ABC123', 'XYZ789']);
  assert.equal(wf.linesAbout('hi\nT-ABC123 needs a test\nbye', 'ABC123'), 'T-ABC123 needs a test');
});

// ---------- E / F / J ----------
test('E/F: while a review is pending or after APPROVE, only verify runs may start (sha lock)', () => {
  assert.equal(wf.runGate(mk({ stage: 'implementing' })).ok, true);
  const review = wf.runGate(mk({ stage: 'review', done: { sha: H1 } }));
  assert.equal(review.ok, false);
  assert.equal(review.lock, 'review');
  assert.match(review.reason, /only verify runs can start until the reviewer posts CHANGES or the Owner reopens it/);
  const approved = wf.runGate(mk({ stage: 'approval', reviewVerdict: { verdict: 'approve', by: 'openai', sha: H1 } }));
  assert.equal(approved.ok, false);
  assert.equal(approved.lock, 'sha');
  assert.match(approved.reason, /approved at aaaaaaa; commits after approval are refused/);
  assert.equal(wf.runGate(mk({ stage: 'approval', reviewVerdict: { verdict: 'approve', sha: H1 } }), { mode: 'verify' }).ok, true);
  assert.equal(wf.runGate(mk({ stage: 'approved' }), { mode: 'verify' }).ok, false);
});

test('J/E: default run modes and who may ask for a verify run', () => {
  assert.equal(wf.defaultMode(mk({ action: 'docs' }), 'openai'), 'docs');
  assert.equal(wf.defaultMode(mk({ title: 'Research GRUB theme formats' }), 'google'), 'docs');
  assert.equal(wf.defaultMode(mk({ title: 'Research GRUB theme formats' }), 'openai'), 'normal');
  assert.equal(wf.defaultMode(mk(), 'google'), 'normal');
  const t = mk();
  assert.equal(wf.mayRequestVerify(t, 'openai', 'anthropic'), true, 'reviewer');
  assert.equal(wf.mayRequestVerify(t, 'anthropic', 'anthropic'), true, 'lead');
  assert.equal(wf.mayRequestVerify(t, 'xai', 'anthropic'), false);
});

// ---------- G ----------
test('G: one review ping per commit, with the packet: sha, diff, tests at that sha, earlier CHANGES and whether each was addressed', () => {
  const t = mk({ stage: 'review' });
  assert.equal(wf.shouldPing(t, H1), true);
  wf.markPinged(t, H1);
  assert.equal(wf.shouldPing(t, H1), false, 'no second ping for the same commit');
  assert.equal(wf.shouldPing(t, H2), true);
  wf.recordReview(t, { by: 'openai', verdict: 'changes', sha: H1, reason: 'add a test', accepted: true });
  wf.recordReview(t, { by: 'openai', verdict: 'changes', sha: H2, reason: 'rename x', accepted: true });
  wf.recordTest(t, H2, { status: 'failed', command: 'npm test' });
  const p = wf.reviewPacket({ task: t, by: 'openai', sha: H2, base: H1, baseLabel: 'your last sign-off', stat: 'a.js | 2 +-', diff: '+x', log: 'bbbbbbb fix', commitsAfter: { [H1]: ['bbbbbbb add the test'], [H2]: [] } });
  assert.match(p, /Review exactly this commit: b{40}/);
  assert.match(p, /Tests at bbbbbbb: failed — `npm test`/);
  assert.match(p, /Changes since your last sign-off \(aaaaaaa\)/);
  assert.match(p, /ADDRESSED \(asked at aaaaaaa\): add a test\n {2}by: bbbbbbb add the test/);
  assert.match(p, /NOT ADDRESSED \(asked at bbbbbbb\): rename x/);
  assert.match(p, /APPROVE: T-ABC123 @bbbbbbb/);
});

// ---------- H ----------
test('H: blockers are told apart from code failures, each with its next action', () => {
  assert.equal(wf.classifyFailure("Could not find '/repo/test/*.test.*'").kind, 'environment');
  assert.equal(wf.classifyFailure('npm ERR! engine "node" is incompatible with this module. Expected version ">=22"').kind, 'environment');
  const dep = wf.classifyFailure("Error: Cannot find module 'electron-builder'");
  assert.equal(dep.kind, 'dependency');
  assert.match(dep.next, /npm ci && npm test/);
  assert.equal(wf.classifyFailure('sh: 1: vite: not found').kind, 'tool');
  assert.equal(wf.classifyFailure('Error: EACCES: permission denied, open /etc/x').kind, 'permission');
  assert.equal(wf.classifyFailure('Error: cannot open display :0').kind, 'environment');
  assert.equal(wf.classifyFailure('not ok 3 - storage remembers drives\n# fail 1').kind, 'code');
});

// ---------- I ----------
const commits = [{ sha: H1, subject: 'Merge hearth/7vpj34-text-size-option-for-the-command-center (approved in Hearth AI Command Center)' }, { sha: H2, subject: 'Habitat logs a coffee only once when two AIs pick each other — progress' }];
test('I: the notes validator flags release-note lines that match no merged commit', () => {
  const v = wf.validateNotes('# v1.1\n\n- Text size option for the Command Center\n- Habitat coffee is logged once\n- Brand new cloud sync\n', commits, [{ id: '7VPJ34', title: 'text size option for the command center' }]);
  assert.deepEqual(v.unmatched, ['Brand new cloud sync']);
  assert.equal(v.lines.length, 3);
  assert.equal(wf.validateNotes('- T-7VPJ34 text size', [], [{ id: '7VPJ34', title: 'x' }]).unmatched.length, 0);
});

test('I: the release gate blocks on a version mismatch, unmatched notes, failing tests or authorship; only an explicit owner override passes it', () => {
  const good = { version: '1.1.0', next: '1.1.0', fileVersion: '1.1.0', sha: H1, notes: '- Text size option for the Command Center', commits, tasks: [], tests: { status: 'passed' }, authorship: { ok: true } };
  assert.equal(wf.releaseGate(wf.releaseChecklist(good)).ok, true);
  const mismatch = wf.releaseChecklist({ ...good, fileVersion: '1.0.0' });
  assert.equal(mismatch.find((c) => c.id === 'version').ok, false);
  const gate = wf.releaseGate(mismatch);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /Version files equal the Next version/);
  assert.equal(wf.releaseChecklist({ ...good, notes: '- Brand new cloud sync' }).find((c) => c.id === 'notes').ok, false);
  assert.equal(wf.releaseChecklist({ ...good, notes: null }).find((c) => c.id === 'notes').ok, false);
  assert.equal(wf.releaseChecklist({ ...good, tests: { status: 'not run' } }).find((c) => c.id === 'tests').ok, false);
  assert.equal(wf.releaseChecklist({ ...good, authorship: { ok: false, problems: ['x by Claude'] } }).find((c) => c.id === 'authorship').ok, false);
  assert.equal(wf.releaseGate(mismatch, { by: 'lead', reason: 'please' }).ok, false, 'the lead cannot override');
  assert.equal(wf.releaseGate(mismatch, { by: 'owner', reason: '' }).ok, false, 'an override needs a reason');
  assert.equal(wf.releaseGate(mismatch, { by: 'owner', reason: 'hotfix' }).overridden, true);
  assert.equal(wf.releaseGate([]).ok, false, 'no preview, no release');
});

test('I: tags the app did not make are flagged once', () => {
  const remote = [{ name: 'v0.9.0', sha: H1 }, { name: 'v1.0.0', sha: H2 }, { name: 'v1.0.1', sha: H2 }];
  assert.deepEqual(wf.unknownTags(remote, { baseline: ['v0.9.0'], made: ['v1.0.1'] }).map((t) => t.name), ['v1.0.0']);
  assert.deepEqual(wf.unknownTags(remote, { baseline: ['v0.9.0'], made: ['v1.0.1'], seen: ['v1.0.0'] }), []);
});

// ---------- M ----------
test('M: attachments describe format, dimensions, aspect ratio, size, colour depth, and video duration and resolution', () => {
  assert.equal(aspect(1920, 1080), '16:9');
  assert.equal(aspect(1366, 768), '1.78:1');
  assert.equal(describeMedia({ kind: 'image', name: 's.png', format: 'PNG', width: 1920, height: 1080, size: 2411724, depth: 8, color: 'RGBA' }), 'PNG · 1920×1080 (16:9) · 2.3 MB · 8-bit RGBA');
  assert.equal(describeMedia({ kind: 'video', name: 'r.mp4', width: 1280, height: 720, duration: 12.44, size: 4300000 }), 'MP4 video · 12.4 s · 1280×720 (16:9) · 4.1 MB');
  assert.match(attachmentLine('The Owner', { kind: 'image', name: 'bug.png', width: 800, height: 600 }), /bug\.png \[PNG · 800×600 \(4:3\)\]/);
});

// ---------- N ----------
test('N: passive Habitat status: location, activity and the latest hall board notes', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  const store = { journal: { openai: [{ at: '2026-11-03T11:30:00Z', text: 'went to the garden' }] }, board: { anthropic: { text: 'Release prep today', at: '2026-11-03T11:00:00Z' } } };
  const agents = [{ id: 'anthropic', status: 'idle', task: { id: 'ABC123' } }, { id: 'openai', status: 'idle' }, { id: 'google', status: 'out' }];
  const t = teamHabitat(store, agents, { anthropic: 'Claude', openai: 'ChatGPT', google: 'Gemini' }, now);
  assert.deepEqual(t.rows.map((r) => [r.place, r.activity]), [['desk', 'working on T-ABC123'], ['garden', 'idle'], ['room', 'out of usage']]);
  assert.equal(t.board[0].text, 'Release prep today');
  const line = teamHabitatLine(store, agents, { anthropic: 'Claude', openai: 'ChatGPT', google: 'Gemini' }, now);
  assert.match(line, /Claude at the desk \(working on T-ABC123\); ChatGPT in the garden \(idle\)/);
  assert.match(line, /Hall board: Claude: 'Release prep today'/);
  assert.equal(whereIs(store, { id: 'openai', status: 'idle' }, now + 5 * 3600e3).place, 'room', 'old walks expire');
});

test('N: Habitat presence line starts with You: <place> and still lists everyone else', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  const store = { journal: { openai: [{ at: '2026-11-03T11:30:00Z', text: 'went to the garden' }], xai: [{ at: '2026-11-03T11:40:00Z', text: 'went to the garden' }] }, board: { anthropic: { text: 'Release prep today', at: '2026-11-03T11:00:00Z' } } };
  const agents = [{ id: 'anthropic', status: 'idle', task: { id: 'ABC123' } }, { id: 'openai', status: 'idle' }, { id: 'google', status: 'out' }, { id: 'xai', status: 'idle' }];
  const names = { anthropic: 'Claude', openai: 'ChatGPT', google: 'Gemini', xai: 'Grok' };
  const line = teamHabitatLine(store, agents, names, now, 360, 'xai');
  assert.match(line, /^You \(Grok\): in the garden \(idle\)\. /);
  assert.match(line, /Team in the Habitat now: Claude at the desk \(working on T-ABC123\); ChatGPT in the garden \(idle\); Gemini in its room \(out of usage\)\./);
  assert.doesNotMatch(line, /Team in the Habitat now:.*Grok /);
  assert.match(line, /Hall board: Claude: 'Release prep today'/);
  const alone = teamHabitatLine({ journal: {} }, [{ id: 'xai', status: 'idle' }], names, now, 360, 'xai');
  assert.equal(alone, 'You (Grok): in your room (idle).');
  const working = teamHabitatLine(store, agents, names, now, 360, 'anthropic');
  assert.match(working, /^You \(Claude\): at the desk \(working on T-ABC123\)\. Team in the Habitat now:/);
  const ui = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const prompt = ui.slice(ui.indexOf('function habitatPrompt('), ui.indexOf('function updatePanel('));
  assert.match(prompt, /teamHabitatLine\(state\.habitat, snap\.agents, NAMES, Date\.now\(\), 360, agent\)/, 'each turn names the speaker before the team list');
});

// ---------- wiring checks (the window code) ----------
test('wiring: runs pass through the gate, verify/docs enforcement, the instruction log and the review packet', () => {
  const ui = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const run = ui.slice(ui.indexOf('async function runTask('), ui.indexOf('async function openInFreebuff('));
  assert.ok(run.indexOf('wf.gate(') > 0 && run.indexOf('wf.gate(') < run.indexOf('callAgent('), 'gate before the call');
  assert.ok(run.indexOf('wf.prepare(') < run.indexOf('callAgent('), 'verified workspace before the call');
  assert.ok(run.indexOf('wf.enforce(') > run.indexOf('callAgent(') && run.indexOf('wf.enforce(') < run.indexOf('api.checkpoint(t.id, agent'), 'enforced before the checkpoint');
  assert.ok(run.includes("mode === 'verify' ? 'read'"), 'verify runs use read-only access');
  assert.ok(run.includes('instructionsBlock(t)'), 'instructions at the top of every run');
  const review = ui.slice(ui.indexOf('async function askForTask('), ui.indexOf('async function runTask('));
  assert.ok(review.includes('wf.packet(') && review.includes('shouldPing('), 'review packet, one ping per sha');
});
