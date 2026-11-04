// The team workflow in the window: the task truth card, run gates and enforcement
// (verify only, docs and research, the review lock and the sha lock), the verified
// starting workspace, the instruction log, the review packet, blockers, the asset
// pipeline, the Jobs panel, the release gate and tags made outside the app.
// Rules live in workflow.mjs (pure, unit tested); main.js passes its helpers in.
import { short } from '../owner.mjs';
import * as W from './workflow.mjs';

export function createWorkflow(C) {
  const local = { truth: {}, jobs: [], preview: null, previewBusy: false, previewVersion: '', overrideReason: '', tagsBusy: false };
  const call = (name, ...a) => (typeof C.api?.[name] === 'function' ? C.api[name](...a).catch((e) => ({ ok: false, message: String(e?.message || e) })) : Promise.resolve(null));
  const S = () => C.state();
  const esc = (s) => C.esc(s);
  const N = (a) => C.NAMES[a] || a || 'nobody';
  const open = (t) => !['approved', 'rejected'].includes(t.stage);
  const task = (id) => S().tasks.find((x) => x.id === id);
  const note = (t, who, text, err = false) => { t.notes = t.notes || []; t.notes.push({ at: C.now(), who, text, ...(err ? { err: true } : {}) }); };

  // ---------- A. truth card ----------
  async function refreshTruth(ids = S().tasks.filter((t) => open(t) && t.ws).map((t) => t.id)) {
    if (!ids.length) return;
    const r = await call('opsTruth', ids);
    if (r && typeof r === 'object' && !r.message) Object.assign(local.truth, r);
  }
  const facts = (t) => (local.truth[t.id]?.known ? local.truth[t.id] : {});
  function truthBadges(t) {
    if (!t.ws) return '';
    const c = W.truthCard(t, facts(t));
    if (!c.known) return '';
    const tcls = { passed: 'good', failed: 'bad', blocked: 'warn' }[c.tests.status] || '';
    return `<span class="wf-truth"><span class="badge mono" title="Branch head (from git)">@${esc(short(c.head))}</span>${c.behind ? `<span class="badge warn" title="Commits on main this branch doesn't have">behind main by ${c.behind}</span>` : ''}<span class="badge ${tcls}" title="Test result at exactly this commit">${c.tests.exact ? `tests ${esc(c.tests.status)}` : 'no test at this sha'}</span>${c.review ? `<span class="badge ${c.review.accepted && !c.review.stale ? (c.review.verdict === 'approve' ? 'good' : 'warn') : ''}" title="${esc(c.review.why || '')}">${c.review.verdict === 'approve' ? '✓' : '✗'} ${esc(N(c.review.by))} @${esc(short(c.review.sha) || '?')}${c.review.accepted ? '' : ' (refused)'}</span>` : ''}${c.merged ? `<span class="badge accent">on ${esc(c.merged)}</span>` : ''}</span>`;
  }
  function truthCard(t) {
    if (!t.ws) return '';
    const c = W.truthCard(t, facts(t));
    const rv = c.review;
    const blockers = blockersHtml(t);
    return `<div class="wf-card" id="wf-truth-${esc(t.id)}"><div class="sect">Task truth <span class="faint">(from git, not from AI reports)</span> <button class="btn small link" data-wf="truth" data-arg="${esc(t.id)}">Refresh</button></div>
      <div class="kv">
        <span class="k">Branch</span><span class="mono">${esc(c.branch || '?')}${c.dirty ? ' <span class="badge warn">uncommitted changes</span>' : ''}</span>
        <span class="k">Head</span><span class="mono">${esc(c.head || 'unknown')}</span>
        <span class="k">vs main</span><span>${c.known ? `behind ${c.behind ?? '?'} · ahead ${c.ahead ?? '?'}${c.stat ? ` · ${esc(c.stat)}` : ''}` : '—'}</span>
        <span class="k">Tests</span><span>${c.tests.exact ? `<span class="badge ${{ passed: 'good', failed: 'bad', blocked: 'warn' }[c.tests.status] || ''}">${esc(c.tests.status)}</span> at <span class="mono">${esc(short(c.tests.sha))}</span>${c.tests.command ? ` · <span class="mono">${esc(c.tests.command)}</span>` : ''}` : '<span class="faint">not run at this commit</span>'}</span>
        <span class="k">Review</span><span>${rv ? `${rv.verdict === 'approve' ? 'APPROVE' : 'CHANGES'} by ${esc(N(rv.by))} on <span class="mono">${esc(short(rv.sha) || '?')}</span> — ${rv.accepted ? `<span class="badge good">accepted</span>${rv.stale ? ' <span class="badge warn">head moved since</span>' : ''}` : `<span class="badge bad">refused</span> ${esc(rv.why)}`}${t.heldApproval ? ` <span class="badge accent">held for ${esc(short(t.heldApproval.sha))}</span>` : ''}` : '<span class="faint">no verdict yet</span>'}</span>
        <span class="k">Merged</span><span>${c.merged ? `<span class="badge accent">${esc(c.merged)}</span>` : 'neither release/next nor main'}</span>
      </div>${blockers}</div>`;
  }
  // The compact lines the lead and reviewers get for the tasks they handle.
  const truthLine = (t) => W.truthLine(t, facts(t));

  // ---------- E/F. gates ----------
  function gate(t, mode, agent) {
    const g = W.runGate(t, { mode });
    if (!g.ok) {
      C.audit('Run refused', t.id, `${N(agent)} (${W.RUN_MODES[mode] || mode}): ${g.reason}`, agent);
      C.toast(g.reason);
      note(t, 'System', `Run refused: ${g.reason}.`);
    }
    return g;
  }
  const modeBrief = (t, mode) => (mode === 'verify'
    ? `# RUN MODE: Verify only\nRun the checks and report what you find. You cannot edit files or commit in this run: any change or commit is discarded and reported as a violation. The app runs the test suite at the current commit itself. If it's ready, say so; if not, list exactly what fails.`
    : mode === 'docs'
      ? `# RUN MODE: Docs and research\nYou may only change docs files (${C.docsPaths()}). Changes to anything else are put back and reported. Put research findings in a Markdown file.`
      : '');

  // ---------- D. verified starting workspace ----------
  async function prepare(t, agent, mode) {
    if (mode === 'verify') return { ok: true };
    const r = await call('opsPrepareRun', t.id);
    if (!r || r.message) return { ok: true }; // not available (preview): don't block
    if (r.facts?.known) local.truth[t.id] = r.facts;
    t.blockers = (r.blockers || []).map((b) => ({ ...b, at: C.now() }));
    if (r.merge?.ok && r.merge.merged) { note(t, 'System', `Before the run: ${r.merge.note}.`); C.audit('Main merged into the task branch', t.id, r.merge.note, agent); }
    if (r.sync?.moved) C.audit('Local main fast-forwarded', null, r.sync.note);
    if (!r.ok) {
      const c = (r.blockers || []).find((b) => b.kind === 'conflict');
      note(t, 'System', `Run not started: ${c?.detail || r.merge?.reason}. ${c?.next || ''}`, true);
      C.post({ who: 'system', text: `T-${t.id} “${t.title}”: ${N(agent)}'s run didn't start: ${c?.detail || r.merge?.reason}. ${c?.next || ''}` });
      C.audit('Run stopped: conflict with main', t.id, c?.detail || '', agent);
    }
    return r;
  }

  // ---------- E/J. enforcement after the run (before anything is saved) ----------
  async function snapshot(t) { return (await call('opsSnapshot', t.id)) || null; }
  async function enforce(t, agent, mode, before, run) {
    if (!before?.head || mode === 'normal') return '';
    if (mode === 'verify') {
      const r = await call('opsEnforceVerify', t.id, before);
      if (!r || r.ok !== false) return '';
      const text = `Verify-only run violation: ${N(agent)} ${r.commits.length ? `made ${r.commits.length} commit(s) (${r.commits.join('; ')})` : ''}${r.commits.length && r.files.length ? ' and ' : ''}${r.files.length ? `changed ${r.files.length} file(s)` : ''}. All of it was discarded${r.backupRef ? ` (commits kept on ${r.backupRef})` : ''}${r.stash ? ' (edits kept in a git stash)' : ''}; the branch is back at ${short(before.head)}.`;
      run.violation = text;
      note(t, 'System', text, true);
      C.audit('Verify-only run violation', t.id, text, agent);
      return text;
    }
    const r = await call('opsEnforceDocs', t.id, before.head);
    if (!r || r.ok !== false) return '';
    const text = `Docs and research run: ${N(agent)} changed files outside the docs paths, so they were put back: ${r.discarded.join(', ')}.`;
    run.violation = text;
    note(t, 'System', text, true);
    C.audit('Docs-only run: changes discarded', t.id, r.discarded.join(', '), agent);
    return text;
  }

  // ---------- K. asset pipeline ----------
  async function assets(id, agent, text, sinceMs, already = []) {
    const t = task(id) || null;
    const list = await call('opsCollectAssets', id, agent, text, sinceMs);
    const atts = [];
    for (const f of Array.isArray(list) ? list : []) {
      if (already.includes(f.rel) || already.includes(f.from)) continue;
      const r = await call('attachFromAgent', f.rel, id);
      if (r?.ok) {
        atts.push({ ...r.att, from: f.from || f.rel });
        C.audit('Routine: captured a generated file', t?.id || null, `${N(agent)}: ${f.from || f.rel}${f.moved ? ` → ${f.rel}` : ''} (no approval needed)`, agent);
      }
    }
    return atts;
  }

  // ---------- C. instruction log ----------
  function instruct(t, from, kind, text) {
    const e = W.addInstruction(t, { from, kind, text, at: C.now() });
    if (e) C.audit('Task instruction logged', t.id, `${e.id} · ${from}: ${e.text.slice(0, 160)}`);
    return e;
  }
  // Only the owner's messages that name a task go into its log (the lead and reviewers
  // use explicit TASK NOTE: lines, so ordinary mentions never become instructions).
  function captureChat(who, text) {
    if (who !== 'owner') return;
    for (const id of W.taskIds(text)) {
      const t = task(id);
      if (!t || !open(t)) continue;
      const line = W.linesAbout(text, id);
      if (line) instruct(t, 'Owner', 'owner', line);
    }
  }
  // The verify instruction is done when the verify run ends.
  function closeVerify(t) {
    for (const i of t.instructions || []) if (!i.acked && i.kind === 'verify') i.acked = { at: C.now(), by: 'system', auto: true };
  }
  // Only the assignee's own runs acknowledge instructions.
  function acks(t, text, agent, run) {
    if (agent !== t.assignee) { run.acked = []; run.unacked = W.openInstructions(t).map((i) => i.id); return { acked: [], missing: run.unacked }; }
    const r = W.applyAcks(t, text, { at: C.now(), by: agent });
    run.acked = r.acked;
    run.unacked = r.missing;
    return r;
  }

  // ---------- workflow lines: TASK NOTE / VERIFY / MERGE MAIN / REVERT ----------
  async function lines(agent, text) {
    const lead = S().lead;
    const leadOn = C.settings().leadActions === true && agent === lead;
    for (const cmd of W.parseWorkflowLines(text)) {
      const t = task(cmd.id);
      const res = (ok, reason) => C.actionResult(agent, cmd.line, ok, reason, t?.id || null);
      if (!t) { res(false, `unknown task id T-${cmd.id}`); continue; }
      if (!open(t)) { res(false, `T-${t.id} is already ${t.stage}`); continue; }
      if (cmd.kind === 'note') {
        if (agent !== lead && agent !== t.reviewer) { res(false, `only the lead (${N(lead)}) or T-${t.id}'s reviewer (${N(t.reviewer)}) can add task notes`); continue; }
        if (W.grantsPermission(cmd.text)) { res(false, 'a task note can\'t approve a permission request; only the Owner (or the lead with APPROVE: R-<id>) answers those'); continue; }
        const e = instruct(t, `${N(agent)} (${agent === lead ? 'lead' : 'reviewer'})`, 'ainote', cmd.text);
        res(true, e ? `logged as ${e.id}; the runner must acknowledge it` : 'already in the log');
      } else if (cmd.kind === 'verify') {
        if (!W.mayRequestVerify(t, agent, lead)) { res(false, `only the lead or T-${t.id}'s reviewer (${N(t.reviewer)}) can ask for a verify run`); continue; }
        const r = await verify(t, agent);
        res(r.ok, r.reason);
      } else {
        if (!leadOn) { res(false, agent !== lead ? `only the lead (${N(lead)}) can do that` : 'ignored because the lead switch is off'); continue; }
        if (C.ui().running[t.id]) { res(false, `T-${t.id} has a run in progress`); continue; }
        if (['review', 'testing', 'checkpoint', 'approval'].includes(t.stage)) { res(false, `T-${t.id} is in ${t.stage}; its branch is locked to the commit under review (ask for CHANGES or VERIFY: T-${t.id} instead)`); continue; }
        const r = await call('opsLeadTaskGit', cmd.kind, t.id, cmd.sha);
        if (!r?.ok) { res(false, r?.reason || r?.message || 'not available'); continue; }
        const what = cmd.kind === 'mergemain' ? (r.merged ? r.note : r.note || 'already up to date') : r.message;
        note(t, `${N(lead)} (lead)`, what);
        // Undo: a REVERT is undone by reverting the revert; a MERGE MAIN by resetting to the
        // commit before it (only while nothing came after it and it isn't pushed).
        if (r.merged || r.reverted) C.leadRecord(cmd.kind, `T-${t.id}`, `— ${what}`, cmd.kind === 'revert' ? { kind: 'revert', id: t.id, sha: r.head } : { kind: 'undomerge', id: t.id, merge: r.head, before: r.before });
        if (r.merged || r.reverted) instruct(t, `${N(lead)} (lead)`, 'note', cmd.kind === 'revert' ? `Reverted ${short(r.reverted)} (out of scope)${cmd.text ? `: ${cmd.text}` : ''}. Don't bring it back.` : 'Main was merged into this branch; continue on top of it.');
        res(true, `Routine (standing permission): ${what}`);
        refreshTruth([t.id]).then(() => C.render());
      }
    }
  }
  // Undo of a lead REVERT: revert the revert.
  async function undoRevert(u) {
    const r = u.kind === 'undomerge' ? await call('opsLeadTaskGit', 'undomerge', u.id, { merge: u.merge, before: u.before }) : await call('opsLeadTaskGit', 'revert', u.id, u.sha);
    return r?.ok ? { ok: true, message: r.message } : { ok: false, message: r?.reason || 'not available' };
  }

  // E. A verify-only run (owner button, VERIFY: from the lead or the reviewer).
  async function verify(t, by) {
    const who = [t.assignee, t.reviewer, S().lead].find((a) => C.EDITORS.includes(a) && C.canRun(a) && C.isFree(a)) || [t.assignee, t.reviewer].find((a) => C.canRun(a));
    if (!who) return { ok: false, reason: 'no AI is free to run it right now' };
    if (C.ui().running[t.id]) return { ok: false, reason: `T-${t.id} already has a run in progress` };
    if (!C.isFree(who)) return { ok: false, reason: `${N(who)} is busy; ask again when it's free` };
    instruct(t, by === 'owner' ? 'Owner' : `${N(by)}`, 'verify', 'Verify only: run the checks and report; do not change anything.');
    setTimeout(() => C.runTask(t, who, null, 0, 'verify'), 0);
    return { ok: true, reason: `verify-only run started with ${N(who)} (read-only; nothing can be changed)` };
  }
  // After a verify run: the app runs the tests at the head and records the result.
  async function verifyTests(t, run) {
    const r = await call('opsTestRun', t.id, run.head);
    if (!r) return null;
    const b = r.status === 'failed' ? W.classifyFailure(r.log) : null;
    W.recordTest(t, run.head, { status: r.status, command: r.command, blocker: b && b.kind !== 'code' ? b.title : null });
    run.appTests = r.status;
    run.testCommand = r.command || null;
    run.testLog = String(r.log || '').slice(-20000);
    return r;
  }

  // B. Lines that look like actions but got no ✓/✗: say so.
  function ensureResults(agent, text, taskId = null) {
    for (const l of W.unanswered(text, C.turnResults(agent))) C.actionResult(agent, l, false, 'not understood: write it exactly as in the rules, one action per line (e.g. "APPROVE: T-ABC123 @1a2b3c4")', taskId);
  }

  // ---------- G. the review packet ----------
  async function packet(t, who) {
    const head = facts(t).head || (await call('workspaceHead', t.id)) || null;
    const signed = W.lastSigned(t, who);
    const changes = (t.reviews || []).filter((r) => r.by === who && r.verdict === 'changes' && r.sha).map((r) => r.sha);
    const d = (await call('opsReviewData', t.id, signed?.sha || null, changes)) || {};
    const text = W.reviewPacket({ task: t, by: who, sha: head, base: d.base, baseLabel: d.baseLabel || 'main', stat: d.stat, diff: d.diff, log: d.log, commitsAfter: d.commitsAfter || {}, facts: facts(t).known ? facts(t) : null });
    W.markPinged(t, head, C.now());
    t.reviewPing.packet = text.slice(0, 12000);
    return { text, head };
  }

  // ---------- H. blockers ----------
  function blockersHtml(t) {
    const list = [...(t.blockers || []), ...(t.testBlocker ? [t.testBlocker] : [])];
    if (!list.length) return '';
    return `<div class="wf-blockers">${list.map((b) => `<div class="policy ${b.kind === 'code' ? 'block' : 'warn'} wf-blocker" data-kind="${esc(b.kind)}"><b>${esc(W.BLOCKER_LABEL[b.kind] || b.kind)}: ${esc(b.title)}</b>${b.detail ? ` — ${esc(b.detail)}` : ''}<br><span class="faint">Next:</span> ${esc(b.next || '')}${b.kind !== 'code' ? ' <span class="badge">not the implementer\'s code failure</span>' : ''}</div>`).join('')}</div>`;
  }
  const blockerBadge = (t) => { const b = [...(t.blockers || []), ...(t.testBlocker ? [t.testBlocker] : [])][0]; return b ? `<span class="badge warn" title="${esc(b.next || '')}">${esc(W.BLOCKER_LABEL[b.kind] || b.kind)}</span>` : ''; };

  // ---------- drawer extras ----------
  function drawerExtras(t) {
    const instr = (t.instructions || []).slice(-8).reverse();
    const pk = t.reviewPing?.packet;
    const locked = W.runGate(t, { mode: 'normal' });
    return `${truthCard(t)}
      ${!locked.ok ? `<div class="policy info wf-lock">${esc(locked.reason)}.${['review', 'approval', 'testing', 'checkpoint'].includes(t.stage) ? ` <button class="btn small" data-wf="reopen" data-arg="${esc(t.id)}">Reopen for the implementer</button>` : ''}</div>` : ''}
      ${t.ws && !['approved', 'rejected'].includes(t.stage) ? `<div class="row wf-modes"><button class="btn small" data-wf="verify" data-arg="${esc(t.id)}">${esc(W.RUN_MODES.verify)}</button><span class="faint" style="font-size:12px">Default mode: ${esc(W.RUN_MODES[W.defaultMode(t, t.assignee)])}</span></div>` : ''}
      ${instr.length ? `<div class="sect">Instruction log <span class="faint">(read at the top of every run; the runner acknowledges each)</span></div>${instr.map((i) => `<div class="note wf-instr"><div class="who">${esc(i.id)} · ${esc(i.from)}${i.kind ? ` · ${esc(i.kind)}` : ''} · ${esc(C.time(i.at))} · ${i.acked ? `<span class="badge good">${i.acked.dismissed ? 'dismissed' : i.acked.auto ? 'closed' : 'acknowledged'}</span>` : `<span class="badge warn">new</span> <button class="btn small link" data-wf="dismiss" data-arg="${esc(t.id)}:${esc(i.id)}">Dismiss</button>`}</div>${i.kind === 'ainote' ? '<span class="faint">AI note (notes can\'t grant permissions): </span>' : ''}${esc(i.text)}</div>`).join('')}` : ''}
      ${pk ? `<details class="wf-packet"><summary>Review packet sent to ${esc(N(t.reviewer))} for ${esc(short(t.reviewPing.sha) || 'this run')}</summary><pre class="note mono">${esc(pk)}</pre></details>` : ''}`;
  }

  // ---------- L. Jobs panel ----------
  async function pollJobs() { const l = await call('opsJobs'); if (Array.isArray(l)) local.jobs = l; return local.jobs; }
  function viewJobs() {
    const list = local.jobs || [];
    const cls = { running: 'accent', done: 'good', failed: 'bad', lost: 'warn', cancelled: '' };
    return `<div class="card wf-jobs"><div class="row"><h3 style="flex:1">Background jobs</h3><button class="btn small ghost" data-wf="jobsrefresh">Refresh</button></div>
      ${list.length ? `<table class="ops-table"><thead><tr><th>Status</th><th>AI</th><th>Job</th><th>Progress</th><th>Output files</th><th>Restarts survived</th><th></th></tr></thead><tbody>${list.map((j) => `<tr data-job="${esc(j.id)}"><td><span class="badge ${cls[j.status] || ''}">${esc(j.status)}</span><div class="faint mono" style="font-size:11px">${esc(j.id)}${j.retryOf ? ` · retry of ${esc(j.retryOf)}` : ''}</div></td><td>${C.agentChip(j.agent)}</td><td>${esc(j.title || j.kind)}<div class="faint" style="font-size:11px">${esc(j.kind)}${j.taskId ? ` · T-${esc(j.taskId)}` : ''} · started ${esc(C.ago(j.startedAt))}</div>${j.error ? `<div class="bad-t" style="font-size:11.5px">${esc(j.error.message)}</div>` : ''}</td><td><pre class="wf-progress">${esc((j.progress || []).slice(-5).join('\n') || '—')}</pre></td><td>${(j.outputs || []).map((f) => `<div class="mono" style="font-size:11px">${esc(String(f).split('/').pop())}</div>`).join('') || '<span class="faint">none yet</span>'}</td><td>${Number(j.restarts || 0)}</td><td>${j.status === 'running' ? `<button class="btn small ghost" data-wf="jobcancel" data-arg="${esc(j.id)}">Cancel</button>` : `<button class="btn small" data-wf="jobretry" data-arg="${esc(j.id)}">Retry</button>`}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No background jobs. AIs start them with BACKGROUND: or IMAGE REQUEST: lines; they keep running across turns and restarts, and their progress is saved as it comes in.</div>'}</div>`;
  }

  // ---------- I. release gate + tags made outside the app ----------
  function viewRelease() {
    const p = local.preview;
    const next = C.nextVersion();
    const ver = local.previewVersion || next || '';
    const ok = p?.gate?.ok;
    return `<div class="card wf-release"><h3>Release preview</h3>
      <div class="faint ops-note">Before any tag or release (yours, the lead's, or the release workflow started from here), the app checks the exact commit to be tagged. The release waits until the checklist passes, or you override it explicitly. Version numbers are always yours: set the Next version on the Project page.</div>
      <div class="row" style="margin:10px 0"><label class="faint">Version</label><input id="wf-relver" class="mono" style="width:120px" value="${esc(ver)}" placeholder="${esc(next || 'Next version')}"><button class="btn primary small" data-wf="preview" ${local.previewBusy ? 'disabled' : ''}>${local.previewBusy ? 'Checking… (runs the full test suite)' : 'Preview release'}</button></div>
      ${p ? (p.ok === false ? `<div class="policy block">${esc(p.message)}</div>` : `
      <div class="kv"><span class="k">Commit to tag</span><span class="mono">${esc(p.sha)} <span class="faint">(${esc(p.ref)})</span></span><span class="k">Since</span><span>${esc(p.lastTag || 'the first commit')} · ${p.commits.length} commit(s)</span><span class="k">Tasks</span><span>${p.tasks.length ? p.tasks.map((t) => `<span class="badge">T-${esc(t.id)} ${esc(t.title)}</span>`).join(' ') : '<span class="faint">no task merges</span>'}</span></div>
      <div class="sect">Checklist</div>
      <div class="wf-checklist">${p.list.map((c) => `<div class="wf-check ${c.ok ? 'ok' : 'no'}"><span>${c.ok ? '✓' : '✗'}</span> <b>${esc(c.label)}</b><div class="faint">${esc(c.detail)}</div></div>`).join('')}</div>
      <div class="sect">Release notes <span class="faint mono">${esc(p.notesRel)}</span></div>
      ${p.notes == null ? '<div class="policy warn">No release notes file at that commit.</div>' : `<div class="wf-notes">${(p.list.find((c) => c.id === 'notes')?.lines || []).map((l) => `<div class="${l.ok ? '' : 'wf-unmatched'}">${l.ok ? '✓' : '✗'} ${esc(l.text)}${l.ok ? ` <span class="faint mono">${esc(l.match || '')}</span>` : ' <span class="badge bad">no merged commit matches</span>'}</div>`).join('')}</div>`}
      <div class="policy ${ok ? 'ok' : 'block'}" style="margin-top:10px">${ok ? `Ready: ${esc(p.gate.reason)}. Tags and releases of v${esc(p.version)} at ${esc(short(p.sha))} are allowed now.` : `The release waits: ${esc(p.gate?.reason || '')}.`}</div>
      ${ok ? '' : `<div class="row" style="margin-top:8px"><input id="wf-override" placeholder="Why override? (Owner only)" style="flex:1" value="${esc(local.overrideReason)}"><button class="btn danger small" data-wf="override">Override checklist</button></div>`}`) : ''}
    </div>
    <div class="card"><h3>Tags and releases on GitHub</h3><div class="faint ops-note">Checked every few minutes. A tag or release the app didn't make is flagged here, on the Overview and in Team chat.</div>${tagsHtml()}<div class="row" style="margin-top:8px"><button class="btn small ghost" data-wf="tags" ${local.tagsBusy ? 'disabled' : ''}>Check now</button></div></div>`;
  }
  function tagsHtml() {
    const st = S().wfTags || {};
    const out = (st.outside || []).filter((x) => !x.dismissed);
    return out.length ? out.map((x) => `<div class="policy warn wf-outside">${esc(x.name)}${x.release ? ' (GitHub release)' : ''} appeared on GitHub${x.sha ? ` at ${esc(short(x.sha))}` : ''}, but the app didn't make it (seen ${esc(C.ago(x.at))}). <button class="btn small link" data-wf="tagok" data-arg="${esc(x.name)}">I know about it</button></div>`).join('') : '<div class="faint">No tags or releases from outside the app.</div>';
  }
  function overviewCard() {
    const out = ((S().wfTags || {}).outside || []).filter((x) => !x.dismissed);
    return out.length ? `<div class="card mb wf-outside-card"><h3>Made outside the app</h3>${tagsHtml()}</div>` : '';
  }
  async function pollTags() {
    if (local.tagsBusy) return;
    local.tagsBusy = true;
    const r = await call('opsRemoteTags');
    local.tagsBusy = false;
    if (!r?.ok && !r?.tags?.length) return;
    const st = S();
    const w = (st.wfTags = st.wfTags || { baseline: null, made: [], outside: [] });
    const names = r.tags.map((t) => t.name);
    // First check: whatever exists now is the baseline (nothing to warn about yet).
    if (!w.baseline) { w.baseline = names; await C.save(); return; }
    const fresh = W.unknownTags(r.tags, { baseline: w.baseline, made: w.made, seen: w.outside.map((x) => x.name) });
    for (const t of fresh) {
      w.outside.push({ name: t.name, sha: t.sha, release: Boolean(t.release), at: C.now() });
      C.post({ who: 'system', text: `Heads-up: ${t.name}${t.release ? ' (a GitHub release)' : ''} appeared on GitHub${t.sha ? ` at ${short(t.sha)}` : ''}, but the app didn't make it. Check the Release gate page before tagging or merging more.` });
      C.audit('Tag or release made outside the app', null, `${t.name}${t.sha ? ` at ${t.sha}` : ''}`);
    }
    if (fresh.length) { await C.save(); C.render(); }
  }
  // The app made this tag/release itself (lead or owner): never flag it.
  function madeTag(version) {
    const st = S();
    const w = (st.wfTags = st.wfTags || { baseline: null, made: [], outside: [] });
    const v = `v${String(version).replace(/^v/, '')}`;
    if (!w.made.includes(v)) w.made.push(v);
  }
  // Checked here too, so a blocked release is refused before the main process is asked.
  function releaseAllowed(version) {
    const p = local.preview;
    const v = String(version || '').replace(/^v/, '');
    if (!p || p.ok === false || p.version !== v) return { ok: false, reason: `run the release preview for v${v} first (Release gate page)` };
    return p.gate?.ok ? { ok: true } : { ok: false, reason: p.gate?.reason || 'release checklist failed' };
  }

  // ---------- clicks ----------
  async function onClick(e) {
    const b = e.target.closest?.('[data-wf]');
    if (!b) return;
    const k = b.dataset.wf;
    const arg = b.dataset.arg;
    if (k === 'truth') { await refreshTruth([arg]); return C.render(); }
    if (k === 'verify') { const t = task(arg); if (!t) return; const r = await verify(t, 'owner'); C.audit('Owner asked for a verify-only run', t.id, r.reason); C.toast(r.reason); return C.render(); }
    if (k === 'reopen') {
      const t = task(arg);
      if (!t || !confirm(`Reopen T-${t.id} for ${N(t.assignee)}? The review lock lifts and any approval is cleared.`)) return;
      t.stage = 'implementing';
      delete t.reviewVerdict;
      delete t.heldApproval;
      delete t.reviewWaiting;
      instruct(t, 'Owner', 'owner', 'The Owner reopened this task for more work.');
      C.audit('Owner reopened the task', t.id, '');
      await C.save();
      return C.render();
    }
    if (k === 'dismiss') {
      const [tid, nid] = String(arg).split(':');
      const i = (task(tid)?.instructions || []).find((x) => x.id === nid);
      if (i && !i.acked) { i.acked = { at: C.now(), by: 'owner', dismissed: true }; C.audit('Owner dismissed a task instruction', tid, `${nid}: ${i.text.slice(0, 120)}`); await C.save(); }
      return C.render();
    }
    if (k === 'jobsrefresh') { await pollJobs(); return C.render(); }
    if (k === 'jobcancel') { const r = await call('opsJobCancel', arg); C.toast(r?.ok ? 'Cancelled.' : r?.message || 'Not cancelled.'); C.audit('Owner cancelled a job', null, arg); await pollJobs(); return C.render(); }
    if (k === 'jobretry') { const r = await call('opsJobRetry', arg); C.toast(r?.id ? `Retrying as ${r.id}.` : r?.message || 'Not retried.'); if (r?.id) C.audit('Owner retried a job', null, `${arg} → ${r.id}`); await pollJobs(); return C.render(); }
    if (k === 'preview') {
      local.previewVersion = (document.getElementById('wf-relver')?.value || '').trim().replace(/^v/, '');
      local.previewBusy = true;
      C.render();
      local.preview = await call('opsReleasePreview', local.previewVersion);
      local.previewBusy = false;
      if (local.preview?.ok) C.audit('Release preview', null, `v${local.preview.version} at ${local.preview.sha}: ${local.preview.gate.ok ? 'checklist passed' : local.preview.gate.reason}`);
      return C.render();
    }
    if (k === 'override') {
      const p = local.preview;
      local.overrideReason = (document.getElementById('wf-override')?.value || '').trim();
      if (!p?.ok) return;
      const r = await call('opsReleaseOverride', p.version, local.overrideReason);
      if (r?.ok) { p.gate = r.gate; C.audit('Owner overrode the release checklist', null, `v${p.version}: ${local.overrideReason}`); await C.save(); } else C.toast(r?.message || 'Not overridden.');
      return C.render();
    }
    if (k === 'tags') { await pollTags(); return C.render(); }
    if (k === 'tagok') { const x = ((S().wfTags || {}).outside || []).find((y) => y.name === arg); if (x) { x.dismissed = true; C.audit('Owner acknowledged an outside tag', null, arg); await C.save(); } return C.render(); }
  }

  return {
    nav: [['jobs', '◷', 'Jobs'], ['release', '⚑', 'Release gate']],
    titles: { jobs: ['Jobs', 'Every background job: status, progress, output files, restarts survived; Cancel and Retry'], release: ['Release gate', 'The exact commit, tasks, notes and checklist before any tag or release'] },
    views: { jobs: viewJobs, release: viewRelease },
    refreshTruth, facts, truthBadges, truthCard, truthLine, gate, modeBrief, prepare, snapshot, enforce, assets, instruct, captureChat, closeVerify, acks, lines, undoRevert, verify, verifyTests, ensureResults, packet, blockersHtml, blockerBadge, drawerExtras, overviewCard, pollTags, madeTag, releaseAllowed, pollJobs, jobsRunning: () => (local.jobs || []).filter((j) => j.status === 'running').length,
    defaultMode: W.defaultMode,
    boot() {
      document.addEventListener('click', onClick);
      setTimeout(() => { refreshTruth().then(() => C.render()); pollTags(); pollJobs(); }, 3000);
      // Live: re-read git facts every 30 s (redrawn on the board only, never over a draft).
      setInterval(() => refreshTruth().then(() => { const u = C.ui(); if (u.view === 'board' && !u.selected && !u.modal) C.render(); }), 30000);
      setInterval(pollTags, 5 * 60000);
      setInterval(() => { pollJobs().then(() => { const u = C.ui(); if (u.view === 'jobs' || (u.panel === 'jobs' && document.activeElement?.id !== 'chat-text')) C.render(); }); }, 10000);
    },
  };
}
