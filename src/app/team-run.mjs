// Several chats working at once (pure logic, unit tested with a fake app bridge).
// Every chat has its own runtime: messages, AI sessions, the step stream of the AI working
// now, its Stop flag and the messages the owner sent while it was busy. Nothing here looks
// at "the open chat": results always land in the runtime (and the saved file) of the chat
// the run was started for, whichever chat the window shows at that moment.
// The owner's limit on chats working at the same time is a waiting line: a chat over the
// limit waits its turn and says so; it is never refused.
import { AGENTS, UNFILTERED } from '../registry.mjs';
import { planTurn, handoffs, pickReviewer, brief, turnPrompt, transcript, name as aiName, mentionsIn, teamReports, readMessage } from './brief.mjs';
import { extractPreviews, kindOf } from './previews.mjs';
import { parseActs, makeAct } from './act.mjs';
import { outcomeSteps } from './steps.mjs';
import { parseTools } from './tools.mjs';
import { plainError } from './errors.mjs';

export function newRuntime(id, extra = {}) {
  return { id, msgs: [], sessions: {}, loaded: false, readOnly: false, copy: null, busy: null, stop: false, queued: [], round: false, waiting: false, unseen: false, temp: false, helpers: 0, chain: Promise.resolve(), ...extra };
}

export function createRoundQueue({ limit = () => 3 } = {}) {
  const active = new Set();
  const line = [];
  const lim = () => Math.max(1, Number(limit()) || 3);
  return {
    active, line,
    // 'start' (a slot is free), 'wait' (in line) or 'running' (already working).
    want(id) {
      if (active.has(id)) return 'running';
      if (active.size < lim() && !line.length) { active.add(id); return 'start'; }
      if (!line.includes(id)) line.push(id);
      return 'wait';
    },
    // A chat finished: the next ones in line that fit start now.
    done(id) {
      active.delete(id);
      const i = line.indexOf(id);
      if (i >= 0) line.splice(i, 1);
      const next = [];
      while (line.length && active.size < lim()) { const n = line.shift(); active.add(n); next.push(n); }
      return next;
    },
    cancel(id) { const i = line.indexOf(id); if (i >= 0) line.splice(i, 1); },
    position: (id) => line.indexOf(id) + 1,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ctx: the window's side (IPC and settings). See src/main.js for the real one.
export function createTeamRunner(ctx) {
  const runtimes = new Map();
  const queue = createRoundQueue({ limit: () => ctx.settings().maxChats || 3 });
  const uid = ctx.uid || (() => Math.random().toString(36).slice(2, 10));
  const now = ctx.now || (() => new Date().toISOString());
  const rt = (id, extra) => { if (!runtimes.has(id)) runtimes.set(id, newRuntime(id, extra)); return runtimes.get(id); };

  // Who is working right now (2.10: several at once). R.busy stays the newest one, for the views that show one.
  function setBusy(R, b) { R.working = [...(R.working || []).filter((x) => x.runId !== b.runId), b]; R.busy = b; ctx.render(R); return b; }
  function clearBusy(R, b) { R.working = (R.working || []).filter((x) => x !== b); R.busy = R.working[R.working.length - 1] || null; }

  function post(R, m) {
    const msg = { id: uid(), at: now(), ...m };
    R.msgs.push(msg);
    if (ctx.openId() !== R.id && !m.local) R.unseen = true;
    ctx.render(R);
    return msg;
  }

  // The owner's message: start a round now, or wait in line, or (busy) answer it right after.
  async function start(R, text, opts = {}) {
    if (R.round || R.waiting) { R.queued.push(text); ctx.render(R); return 'queued'; }
    R.pending = { text, opts };
    const w = queue.want(R.id);
    if (w === 'wait') { R.waiting = true; ctx.render(R); return 'waiting'; }
    await round(R);
    return 'done';
  }

  async function round(R) {
    R.waiting = false;
    R.round = true;
    R.stop = false;
    ctx.call('chatBusy', R.id, true);
    ctx.render(R);
    let ok = true;
    try {
      let next = R.pending;
      R.pending = null;
      while (next && !R.stop) {
        ok = ctx.isRoleplay?.(R) ? await ctx.roleplayTurn(R, next.text, next.opts || {}) : await runTeam(R, next.text, next.opts || {});
        next = R.queued.length && !R.stop ? { text: R.queued.splice(0).join('\n\n'), opts: {} } : null;
      }
    } finally {
      R.queued = R.stop ? [] : R.queued;
      R.round = false;
      R.busy = null;
      R.working = [];
      ctx.call('chatBusy', R.id, false);
      ctx.render(R);
      ctx.onRoundDone?.(R, { ok, stopped: R.stop });
      for (const id of queue.done(R.id)) { const N = rt(id); round(N); }
    }
  }

  async function runTeam(R, text, opts = {}) {
    await ctx.beforeRound?.(R);
    const t = ctx.team();
    const L = ctx.live();
    const mode = opts.mode || ctx.modeFor(R);
    const order = opts.only ? [opts.only].filter((a) => L.includes(a)) : planTurn({ text, mode, team: t, live: L });
    if (!order.length) {
      const named = mentionsIn(text).find((a) => !L.includes(a));
      post(R, { who: 'system', text: named && AGENTS[named]?.kind === 'api' ? `${aiName(named)} isn't set up: ${ctx.setupHint?.(named) || `add your ${aiName(named)} key in Settings › Accounts`}.` : L.length ? 'The AI you picked isn\'t ready. Set it up in Settings › Accounts, or pick another one.' : 'No AI is ready yet. Sign in to Claude (or another AI) in Settings › Accounts.' });
      await ctx.save(R);
      return false;
    }
    // Every teammate in this turn shows as waiting, working, blocked, failed or done, with a
    // plain reason and Retry (src/main.js). A Retry updates its own row; a new message starts fresh.
    const blockedNamed = mentionsIn(text).filter((x) => !L.includes(x) && AGENTS[x] && x !== 'none');
    if (opts.retry && R.turnState) {
      for (const a of order) setState(R, a, 'waiting', '');
    } else {
      R.turnState = { text, at: now(), list: order.map((a) => ({ agent: a, state: 'waiting', reason: '' })) };
    }
    // 3.4.1: every @-named teammate that can't answer is in the turn's list AND named once in the chat, with what
    // it needs (it used to be left out, so 18 named teammates just never answered).
    if (!opts.retry) notReached(R, blockedNamed);
    ctx.render(R);
    const done = [];
    let changed = null;
    let ok = true;
    // A teammate that fails no longer stops the others: everyone named still gets a turn.
    for (let i = 0; i < order.length && !R.stop; i++) {
      const agent = order[i];
      const role = mode === 'team' && agent === t.lead ? 'lead' : 'member';
      const task = opts.task && i === 0 ? opts.task : (i > 0 && role !== 'lead' ? handoffTask(R, agent) : '');
      setState(R, agent, 'working', '');
      let r = await turn(R, agent, { role, task, regenerate: opts.regenerate && i === 0 ? opts.regenerate : null });
      done.push(agent);
      // App lines that need an answer (search past chats, helpers): one more turn, at most twice.
      for (let loop = 0; loop < 2 && r?.ok !== false && r?.followUp && !R.stop; loop++) r = await turn(R, agent, { role, task: r.followUp, isFollowUp: true }) || { ok: false };
      if (!r || r.ok === false) {
        ok = false;
        const pe = r?.plain || { state: 'failed', reason: `${aiName(agent)} didn't answer.` };
        setState(R, agent, R.stop ? 'failed' : pe.state, R.stop ? 'Stopped by you.' : pe.reason, r?.raw, R.stop ? null : pe.fix);
        continue;
      }
      setState(R, agent, 'done', '');
      if (r.changes?.files?.length) changed = { by: agent, msgId: r.msgId };
      if (role === 'lead' && !opts.regenerate) {
        const picked = handoffs(r.text, { team: t, live: L, done: [...done, ...order] });
        // Named in the lead's hand-off but not connected, or not in the team: in the list as not reached, with what it
        // needs, and named once in the chat (3.4.1: teammates outside the team used to vanish without a word).
        const missed = namedIn(r.text).filter((h) => !picked.includes(h) && !done.includes(h) && !order.includes(h) && !L.includes(h));
        notReached(R, missed);
        R.notReached = missed;
        if (picked.length && parallelOn() && !R.stop) {
          // 2.10: everyone the lead picked works AT THE SAME TIME, each in its own copy of the files; the app merges
          // their work, then the lead checks it all and answers the owner.
          for (const h of picked) addState(R, h);
          const from = R.msgs.length;
          const res = await parallel(R, picked, { lead: agent });
          for (const x of res) { done.push(x.agent); if (x.r?.changes?.files?.length) changed = { by: x.agent, msgId: x.r.msgId }; if (!x.r || x.r.ok === false) ok = false; }
          const merge = await mergeLanes(R, picked);
          if (merge.changed) changed = { by: merge.by || picked[0], msgId: null };
          if (!R.stop) {
            setState(R, agent, 'working', '');
            // Their replies go into the lead's prompt itself (labelled, whole), so they're left out of the chat part.
            const theirs = R.msgs.slice(from).filter((m) => picked.includes(m.who));
            let w = await turn(R, agent, { role: 'lead', task: wrapUpTask(R, res, merge, theirs, agent, R.notReached || []), exclude: new Set(theirs.map((m) => m.id)) });
            // READ MESSAGE (a reply too long to send whole) and other app lines: answered, then it goes on (at most twice).
            for (let loop = 0; loop < 2 && w && w.ok !== false && w.followUp && !R.stop; loop++) w = await turn(R, agent, { role: 'lead', task: w.followUp, isFollowUp: true }) || { ok: false };
            setState(R, agent, w && w.ok !== false ? 'done' : 'failed', w && w.ok !== false ? '' : (w?.plain?.reason || ''));
            if (w?.changes?.files?.length) changed = { by: agent, msgId: w.msgId };
          }
        } else for (const h of picked) { order.push(h); addState(R, h); }
      }
    }
    if (R.stop && R.turnState) for (const x of R.turnState.list) if (x.state === 'waiting') { x.state = 'skipped'; x.reason = 'Stopped by you before its turn.'; }
    const reviewer = changed && mode === 'team' && !R.stop ? pickReviewer({ team: t, live: L, author: changed.by }) : null;
    if (reviewer && !UNFILTERED.includes(reviewer)) {
      const d = await ctx.call('chatDiff', R.id);
      const diff = String(d?.diff || '').slice(0, 40000);
      await turn(R, reviewer, { role: 'reviewer', task: `Review ${aiName(changed.by)}'s changes on this chat's branch. Say plainly if they are right and what (if anything) must change. Keep it short. Don't edit files.\n\nTHE CHANGES:\n${diff || '(no diff available)'}`, readOnly: true });
    }
    return ok;
  }

  // Every @Name on the lead's hand-off lines (any AI in the app, in the team or not).
  function namedIn(reply) {
    const lines = String(reply || '').split('\n').filter((l) => /^\s*[-*]?\s*@[A-Za-z]/.test(l));
    return [...new Set(lines.flatMap((l) => mentionsIn(l)))].filter((a) => AGENTS[a] && a !== 'none');
  }
  // Why a teammate can't answer this turn, in plain words, and the one fix for it (src/main.js turns it into a button).
  function whyNot(a) {
    const inTeam = ctx.team().members.includes(a);
    const st = ctx.statusOf?.(a) || {};
    if (!inTeam) return { label: 'not in your team', why: 'turn it on in Settings › AI team', fix: 'team' };
    const label = st.label && st.label !== 'checking…' ? st.label : 'not connected';
    const why = st.why || ctx.setupHint?.(a) || 'set it up in Settings › Accounts';
    const fix = st.state === 'signin' ? 'signin' : st.state === 'cli' && /install/i.test(why) ? 'install' : 'accounts';
    return { label, why: why.replace(/\.$/, ''), fix };
  }
  function notReached(R, ids) {
    const list = [...new Set(ids)].filter((a) => AGENTS[a]);
    if (!list.length) return;
    for (const a of list) { const w = whyNot(a); addState(R, a, 'blocked', `${w.label}: ${w.why}.`); const x = R.turnState?.list.find((y) => y.agent === a); if (x) { x.state = 'blocked'; x.reason = `${w.label}: ${w.why}.`; x.fix = w.fix; } }
    post(R, { who: 'system', text: `${list.length === 1 ? 'This teammate was' : `These ${list.length} teammates were`} named but can't answer:\n${list.map((a) => { const w = whyNot(a); return `- ${aiName(a)}: ${w.label}, ${w.why}.`; }).join('\n')}`, fixes: list.map((a) => ({ agent: a, fix: whyNot(a).fix })) });
  }

  function setState(R, agent, state, reason, raw, fix = null) {
    if (!R.turnState) R.turnState = { text: '', at: now(), list: [] };
    const x = R.turnState.list.find((y) => y.agent === agent) || (R.turnState.list.push({ agent }), R.turnState.list[R.turnState.list.length - 1]);
    Object.assign(x, { state, reason: reason || '', raw: raw || undefined, at: now(), fix: fix || undefined });
    ctx.render(R);
  }
  function addState(R, agent, state = 'waiting', reason = '') {
    if (R.turnState && !R.turnState.list.some((y) => y.agent === agent)) R.turnState.list.push({ agent, state, reason });
  }
  // Retry one teammate of the last turn (its row's Retry button).
  async function retry(R, agent) {
    const text = R.turnState?.text || [...R.msgs].reverse().find((m) => m.who === 'owner')?.text || '';
    if (!text) return 'nothing';
    return start(R, text, { only: agent, retry: true });
  }

  // What the lead asked a teammate to do (its @Name line), for a teammate that only makes pictures.
  function handoffTask(R, agent) {
    const lead = [...R.msgs].reverse().find((m) => m.role === 'lead');
    const line = String(lead?.text || '').split('\n').find((l) => mentionsIn(l).includes(agent));
    return line ? line.replace(/@[A-Za-z][\w-]{1,20}/g, '').replace(/^\s*[-*]\s*/, '').trim() : '';
  }

  const parallelOn = () => ctx.settings().teamParallel !== false;
  // Everyone the lead picked, at once. A teammate's own failure never stops the others.
  async function parallel(R, agents, { lead }) {
    const others = (a) => agents.filter((x) => x !== a).map(aiName);
    return Promise.all(agents.map(async (a) => {
      setState(R, a, 'working', '');
      const own = handoffTask(R, a);
      const task = `${own ? `Your part, from ${aiName(lead)}: ${own}\n\n` : ''}You're working AT THE SAME TIME as ${others(a).length ? others(a).join(', ') : 'no one else'}${others(a).length ? ', each in your own copy of the files' : ''}. Do only your part; don't redo the others'. The app merges everyone's changes when you're all done, and ${aiName(lead)} checks the result.`;
      let mark = R.msgs.length;
      let r = await turn(R, a, { role: 'member', task, lane: true });
      // Done: it reports to the lead straight away and the lead answers it (others keep working). The lead can give
      // it more to do with an @line, up to twice; nobody waits for the owner.
      for (let more = 0; more < 3 && !R.stop; more++) {
        for (let loop = 0; loop < 2 && r?.ok !== false && r?.followUp && !R.stop; loop++) r = await turn(R, a, { role: 'member', task: r.followUp, isFollowUp: true, lane: true }) || { ok: false };
        if (!r || r.ok === false || R.stop) break;
        setState(R, a, 'done', 'reported to the lead');
        const reply = await leadReplies(R, lead, a, r, R.msgs.slice(mark).filter((m) => m.who === a));
        const next = reply && reply.ok !== false && more < 2 ? handoffs(reply.text || '', { team: ctx.team(), live: ctx.live(), done: [] }).includes(a) : false;
        if (!next) break;
        setState(R, a, 'working', `more from ${aiName(lead)}`);
        mark = R.msgs.length;
        r = await turn(R, a, { role: 'member', task: `${aiName(lead)} answered your report and gave you more: ${lineFor(reply.text, a) || 'see its last message'}\n\nYou're still working at the same time as the others, in your own copy.`, lane: true });
      }
      if (!r || r.ok === false) {
        const pe = r?.plain || { state: 'failed', reason: `${aiName(a)} didn't answer.` };
        setState(R, a, R.stop ? 'failed' : pe.state, R.stop ? 'Stopped by you.' : pe.reason, r?.raw, R.stop ? null : pe.fix);
      } else setState(R, a, 'done', '');
      return { agent: a, r };
    }));
  }
  // The lead answers one teammate's report while the rest work. One reply at a time (they queue), read-only.
  function leadReplies(R, lead, a, r, report) {
    const run = async () => {
      if (R.stop) return null;
      const still = (R.working || []).filter((b) => b.lane && b.agent !== a).map((b) => aiName(b.agent));
      const task = `${aiName(a)} just finished its part and reported${r.changes?.files?.length ? `, changing ${r.changes.files.length} file(s) in its own copy` : ''}. ${still.length ? `Still working: ${[...new Set(still)].join(', ')}.` : 'Everyone else is done.'}\n\n${aiName(a).toUpperCase()}'S REPORT:\n${teamReports(report, [a], { forAgent: lead, room: 16000 })}\n\nAnswer ${aiName(a)} in one to three lines: say what's good, what's wrong or missing. If it should do more, start a line with @${aiName(a).replace(/\s+/g, '')} and the next step. Don't wait for the owner and don't redo its work. Your full check comes after everyone is done.`;
      let w = await turn(R, lead, { role: 'lead', task, quick: true, exclude: new Set(report.map((m) => m.id)) });
      if (w && w.ok !== false && w.followUp && !R.stop) w = await turn(R, lead, { role: 'lead', task: w.followUp, quick: true, isFollowUp: true }) || { ok: false };
      return w;
    };
    const p = (R.leadChain || Promise.resolve()).then(run, run);
    R.leadChain = p.catch(() => null);
    return p;
  }
  const lineFor = (text, a) => String(text || '').split('\n').find((l) => mentionsIn(l).includes(a))?.replace(/@[A-Za-z][\w-]{1,20}/g, '').trim() || '';

  // Their lanes into the chat's branch (only chats with a repo have lanes).
  async function mergeLanes(R, agents) {
    if (!R.copy && !ctx.entry(R.id)?.repo && !ctx.entry(R.id)?.repoDir) return { changed: false, merged: [], conflicts: [], empty: [] };
    const m = await ctx.call('chatLanesMerge', R.id, agents, Object.fromEntries(agents.map((a) => [a, aiName(a)]))) || { ok: false };
    if (!m.ok) { post(R, { who: 'system', text: `The teammates' changes couldn't be put together: ${m.message || 'unknown error'}. Their work is still on their own branches.` }); return { changed: false, merged: [], conflicts: [], empty: [] }; }
    if (m.status) R.copy = { ...m.status, exists: true };
    const lines = [];
    for (const x of m.merged || []) lines.push(`${aiName(x.agent)}'s changes were merged (${x.files.length} file${x.files.length === 1 ? '' : 's'}).`);
    for (const x of m.conflicts || []) lines.push(`${aiName(x.agent)}'s changes clash with another teammate's in ${x.files.slice(0, 4).join(', ')}${x.files.length > 4 ? '…' : ''}. They're kept on the branch ${x.branch} for the lead.`);
    if (lines.length) post(R, { who: 'system', text: lines.join('\n') });
    await ctx.save(R);
    return { changed: Boolean((m.merged || []).length), by: (m.merged || [])[0]?.agent, merged: m.merged || [], conflicts: m.conflicts || [], empty: m.empty || [] };
  }
  function wrapUpTask(R, res, merge, theirs = [], lead = null, missed = []) {
    const lines = [
      ...res.map((x) => `- ${aiName(x.agent)}: ${!x.r || x.r.ok === false ? 'did not finish (its error is below)' : x.r.changes?.files?.length ? `changed ${x.r.changes.files.length} file(s)` : 'answered'}`),
      ...missed.map((a) => { const w = whyNot(a); return `- ${aiName(a)}: NOT REACHED (${w.label}: ${w.why}); list it in your answer so the owner knows`; }),
    ];
    const clash = merge.conflicts.length ? `\nClashes the app couldn't merge (fix them in the chat's copy: run \`git merge <branch>\` and resolve, or redo that part):\n${merge.conflicts.map((c) => `- ${aiName(c.agent)}: ${c.files.join(', ')} (branch ${c.branch})`).join('\n')}` : '';
    return `Your teammates have finished working at the same time:\n${lines.join('\n')}${merge.merged.length ? `\nMerged into this chat's branch: ${merge.merged.map((m) => aiName(m.agent)).join(', ')}.` : ''}${clash}\n\nTHEIR REPLIES, IN FULL (each teammate's own words, errors and refusals included):\n${teamReports(theirs, res.map((x) => x.agent), { forAgent: lead })}\n\nCheck their work together, fix anything wrong or missing, and give the owner ONE short answer: what was done, by whom, and what's left. Don't hand the same work out again.`;
  }

  async function turn(R, agent, { role = 'member', task = '', readOnly = false, isFollowUp = false, regenerate = null, lane = false, quick = false, exclude = null } = {}) {
    const c = ctx.entry(R.id);
    if (!c) return null;
    // A teammate that only makes pictures (Civitai, a ComfyUI server): the request is the picture.
    if (ctx.imagesOnly?.(agent)) {
      const lastOwner = [...R.msgs].reverse().find((m) => m.who === 'owner');
      const prompt = (task || String(lastOwner?.text || '')).replace(/@[A-Za-z][\w-]{1,20}/g, '').trim();
      const me = setBusy(R, { agent, role, runId: `${uid()}i`, steps: [{ kind: 'image', label: 'Making a picture', detail: aiName(agent) }], startedAt: Date.now() });
      const r = await ctx.makeImage(R, { agent, prompt });
      clearBusy(R, me);
      const msg = post(R, r.ok ? { who: agent, role, text: r.text || 'Here it is.', via: r.via, media: r.items || [] } : { who: agent, role, err: true, text: r.message || 'No picture came back.' });
      await ctx.save(R);
      return r.ok ? { text: msg.text, msgId: msg.id } : { ok: false, plain: plainError(agent, { message: r.message || 'No picture came back.' }), raw: r.message };
    }
    const runId = `${uid().replace(/[^a-z0-9]/gi, '').slice(0, 10)}r`;
    const me = setBusy(R, { agent, role, runId, steps: [], startedAt: Date.now(), lane });
    // A quick reply (the lead answering a teammate while others work) runs read-only beside them, in a fresh session.
    const resumeId = typeof R.sessions[agent] === 'string' && !regenerate && !quick ? R.sessions[agent] : null;
    const all = regenerate ? R.msgs.slice(0, R.msgs.findIndex((m) => m.id === regenerate)) : R.msgs;
    const upto = exclude?.size ? all.filter((m) => !exclude.has(m.id)) : all;
    const build = ctx.buildFor(R) && !readOnly && !quick;
    const web = ctx.webFor(R);
    const opts = { agent, role, chat: c, copy: R.copy ? { base: R.copy.base, work: R.copy.work } : null, build, web, quickChecks: ctx.settings().tools?.quickChecks || [], team: ctx.team(), live: ctx.live(), actForMe: ctx.settings().actForMe === true, apiOnly: ctx.method(agent) === 'api', status: ctx.statusMap?.() || {}, missing: ctx.missingChecks?.() || [], canPush: Boolean(c.repo || c.repoDir) && !c.temp, autoPush: ctx.settings().autoPush !== false, uncensored: ctx.settings().uncensored?.on === true };
    const extra = (await ctx.briefExtra?.(R, agent, role, Boolean(resumeId))) || '';
    const briefText = brief({ ...opts, extra });
    const prompt = turnPrompt({ agent, role, messages: upto, briefText, resumed: Boolean(resumeId), task });
    const fallbackPrompt = turnPrompt({ agent, role, messages: upto, briefText, resumed: false, task });
    const lastOwner = [...upto].reverse().find((m) => m.who === 'owner');
    const atts = [...(lastOwner?.attachments || []), ...(ctx.refsFor?.(R) || [])];
    const model = ctx.modelFor?.(R, agent) || undefined;
    let r;
    for (let tries = 0; ; tries++) {
      r = await ctx.call('chatRun', {
        chatId: R.id, agent, runId, prompt: prompt.slice(-58000), fallbackPrompt: fallbackPrompt.slice(-58000), resumeId,
        images: atts.filter((a) => a.kind === 'image').map((a) => a.path).concat(atts.filter((a) => a.kind === 'video').flatMap((a) => a.frames || [])),
        files: atts.filter((a) => a.kind === 'file' || (a.kind === 'video' && agent === 'google')).map((a) => a.path),
        web, build, title: c.title, historyText: lastOwner?.text || '', ...(model ? { model } : {}), ...(lane ? { lane: true } : {}), ...(quick ? { helper: true } : {}),
      }) || { ok: false, error: { message: 'The app could not start the AI.' } };
      // A scheduled task took the last free slot: wait for it, then go on.
      if (r.ok || r.error?.kind !== 'queue' || R.stop || tries > 90) break;
      me.note = r.error.message;
      ctx.render(R);
      await sleep(ctx.queueRetryMs ?? 4000);
    }
    const steps = me.steps || [];
    clearBusy(R, me);
    if (r.sessionId && !quick) R.sessions[agent] = r.sessionId;
    if (r.status) R.copy = { ...r.status, exists: true };
    const media = Array.isArray(r.media) ? r.media : [];
    if (r.settingsUndone) post(R, { who: 'system', text: `${aiName(agent)} changed your settings file during its turn. The change was undone at once; your settings are as you left them. Settings › Saved data shows it in the change log.` });
    if (!r.ok) {
      // Known raw errors in plain words (src/app/errors.mjs); the raw text stays under "Details".
      const pe = plainError(agent, r.error || {});
      post(R, { who: agent, role, err: true, ...(pe.fix ? { fix: pe.fix } : {}), text: pe.reason + (r.partial ? `\n\n${r.partial}` : ''), rawError: pe.raw && pe.raw !== pe.reason ? pe.raw.slice(0, 2000) : undefined, retryable: r.error?.kind !== 'cancelled', steps, outcome: outcomeSteps(r), ...(media.length ? { media } : {}), ...(r.changes?.files?.length ? { changes: changesOf(R, r) } : {}) });
      await ctx.save(R);
      ctx.afterSave?.(R);
      return { ok: false, plain: pe, raw: pe.raw };
    }
    let raw = showMedia(r.text || '', media);
    if (ctx.afterReply) raw = ctx.afterReply(R, agent, raw);
    const { text: noPreview, previews: fenced } = extractPreviews(raw);
    const { text: noTools, tools, followUps } = parseTools(noPreview, { agent });
    // A big preview (over 1 MB) is a file in the chat's media folder: no content in the chat file.
    const previews = [...(r.previews || []), ...fenced].map((p) => (p.file || p.tooBig || p.original
      ? { id: uid(), name: p.name, kind: p.kind || kindOf(p.name), size: p.size || 0, ...(p.file ? { file: p.file } : {}), ...(p.original ? { original: p.original } : {}), ...(p.extracted ? { extracted: p.extracted } : {}), ...(p.tooBig ? { tooBig: { reason: String(p.tooBig.reason || ''), limit: p.tooBig.limit || null } } : {}) }
      : { id: uid(), name: p.name, kind: p.kind || kindOf(p.name), content: p.content }));
    const { acts, refused } = parseActs(noTools, { agent, enabled: ctx.settings().actForMe === true });
    const shown = noTools.split('\n').filter((l) => !/^\s*ACT FOR OWNER:/i.test(l.replace(/[*`]/g, ''))).join('\n').trim();
    const fields = {
      who: agent, role, text: shown || (previews.length ? 'Here\'s the preview.' : media.length ? 'Here it is.' : tools.some((x) => x.kind === 'readmsg') ? 'Reading the rest of a long reply…' : '(no text)'), via: r.via, steps, web,
      outcome: outcomeSteps({ ...r, previews }), previews,
      ...(media.length ? { media } : {}),
      ...(Array.isArray(r.mediaProblems) && r.mediaProblems.length ? { mediaProblems: r.mediaProblems.slice(0, 10) } : {}),
      ...(followUps.length ? { followUps } : {}),
      ...(Array.isArray(r.citations) && r.citations.length ? { citations: r.citations.slice(0, 12) } : {}),
      ...(r.changes?.files?.length ? { changes: changesOf(R, r) } : {}),
      ...(r.pushed?.ok ? { actions: { branch: r.pushed.branch, sha: r.pushed.sha, state: 'queued', since: now() } } : {}),
      ...(acts.length ? { acts: acts.map((a) => makeAct(a.kind, { chatId: R.id, sha: r.status?.head || null })) } : {}),
      ...(refused.length ? { refusedActs: refused } : {}),
      ...(model ? { model } : {}),
      ...(quick ? { quick: true } : {}),
    };
    let msg;
    if (regenerate) {
      // Retry: the answer becomes a new version of the same message (← 1/2 →).
      msg = R.msgs.find((m) => m.id === regenerate);
      if (msg) {
        const keep = (m) => ({ text: m.text, via: m.via, steps: m.steps, outcome: m.outcome, previews: m.previews, media: m.media, followUps: m.followUps, at: m.at, who: m.who, err: m.err });
        const versions = msg.versions?.length ? msg.versions : [keep(msg)];
        Object.assign(msg, { err: false, media: undefined, followUps: undefined }, fields, { at: now() });
        msg.versions = [...versions, keep(msg)].slice(-10);
        msg.v = msg.versions.length - 1;
        if (ctx.openId() !== R.id) R.unseen = true;
        ctx.render(R);
      }
    }
    if (!msg) msg = post(R, fields);
    if (previews.length) ctx.onPreview?.(R, msg);
    let followUp = null;
    if (tools.length) {
      const helpers = tools.filter((x) => x.kind === 'helper' && role === 'lead');
      const reads = tools.filter((x) => x.kind === 'readmsg');
      const other = tools.filter((x) => x.kind !== 'helper' && x.kind !== 'readmsg');
      if (reads.length) {
        followUp = `THE MESSAGES YOU ASKED TO READ (read-only; now go on with your answer):\n\n${reads.map((x) => readMessage(R.msgs, x.id, { from: x.from, forAgent: agent })).join('\n\n')}`;
        msg.steps = [...(msg.steps || []), { kind: 'read', label: 'Read a long reply', detail: reads.map((x) => x.id).join(', ') }];
      }
      if (helpers.length) { const f = await runHelpers(R, msg, helpers); if (f) followUp = followUp ? `${followUp}\n\n${f}` : f; }
      if (other.length) { const f = await ctx.onTools?.(R, msg, other, agent); if (f) followUp = followUp ? `${followUp}\n\n${f}` : f; }
    }
    await ctx.save(R);
    ctx.afterSave?.(R, msg);
    return { text: shown, changes: r.changes, msgId: msg.id, followUp: followUp && !followUp.trim() ? null : followUp };
  }

  // Side tasks in parallel: each helper works read-only and reports back as a collapsible step.
  async function runHelpers(R, msg, list) {
    const L = ctx.live();
    const t = ctx.team();
    const picks = list.map((h) => ({ ...h, agent: h.to && L.includes(h.to) && !UNFILTERED.includes(h.to) ? h.to : (t.members.find((a) => a !== msg.who && L.includes(a) && !UNFILTERED.includes(a)) || msg.who) }));
    msg.helpers = picks.map((p) => ({ id: uid(), agent: p.agent, task: p.task, state: 'working' }));
    R.helpers += picks.length;
    ctx.render(R);
    const c = ctx.entry(R.id);
    const results = await Promise.all(picks.map(async (p, i) => {
      const h = msg.helpers[i];
      const briefText = brief({ agent: p.agent, role: 'member', chat: c, copy: null, build: false, web: ctx.webFor(R), team: t, live: L, apiOnly: ctx.method(p.agent) === 'api', uncensored: ctx.settings().uncensored?.on === true });
      const prompt = `${briefText}\n\nYou are a HELPER for ${aiName(msg.who)} in this chat. Work read-only (no edits, no pushes) and report back briefly and plainly.\n\nTHE CHAT SO FAR:\n${transcript(R.msgs, { forAgent: p.agent, max: 16000 })}\n\nYOUR SIDE TASK: ${p.task}`;
      const r = await ctx.call('chatRun', { chatId: R.id, agent: p.agent, runId: `${uid().replace(/[^a-z0-9]/gi, '').slice(0, 10)}h`, helper: true, prompt: prompt.slice(-58000), web: ctx.webFor(R), build: false, title: c?.title || '' }) || { ok: false, error: { message: 'Could not start.' } };
      Object.assign(h, { state: r.ok ? 'done' : 'failed', text: r.ok ? String(r.text || '').slice(0, 20000) : r.error?.message || 'failed', via: r.via, ...(Array.isArray(r.media) && r.media.length ? { media: r.media } : {}) });
      ctx.render(R);
      return h;
    }));
    R.helpers -= picks.length;
    return `HELPER REPORTS (your side tasks are done; use them in your answer to the owner):\n${results.map((h) => `--- ${aiName(h.agent)} on "${h.task.slice(0, 120)}" (${h.state}) ---\n${String(h.text || '').slice(0, 8000)}`).join('\n\n')}`;
  }

  function changesOf(R, r) {
    return { ...r.changes, head: r.status?.head || null, unpushed: Boolean(r.status?.unpushed), pushed: r.pushed?.ok ? r.pushed.branch : null, base: r.changes?.base || r.status?.base, repo: ctx.entry(R.id)?.repo || null };
  }

  // Stop one chat (its helpers too). Other chats keep working.
  async function stop(R) {
    R.stop = true;
    if (R.waiting) { queue.cancel(R.id); R.waiting = false; R.pending = null; R.queued = []; ctx.render(R); return; }
    await ctx.call('chatCancel', R.id);
  }

  // A step streamed from the main process: only the chat it belongs to gets it.
  function onStep(e) {
    const R = e && runtimes.get(e.chatId);
    const b = R && ((R.working || []).find((x) => x.runId === e.runId) || (R.busy && R.busy.runId === e.runId ? R.busy : null));
    if (!b || !e.step) return false;
    b.steps.push(e.step);
    ctx.render(R);
    return true;
  }

  return { rt, runtimes, queue, start, stop, turn, runTeam, onStep, post, retry, busyIds: () => [...runtimes.values()].filter((R) => R.round || R.waiting).map((R) => R.id) };
}

// Pictures in the AI's text: a Markdown link to a file the app collected now points at the
// app's own copy (so it shows right there), and an ATTACH:/FILE: line that worked is dropped
// (the picture shows under the message). Lines that didn't work stay, with the reason shown.
export function showMedia(text, media = []) {
  let out = String(text || '');
  const byFrom = new Map(media.filter((m) => m && m.from && m.url).flatMap((m) => [m.from, ...(m.alsoFrom || [])].map((f) => [f, m])));
  if (!byFrom.size) return out;
  const clean = (p) => String(p || '').trim().replace(/^[<"'`]+|[>"'`.,;]+$/g, '').replace(/^\.\//, '');
  out = out.replace(/!\[([^\]\n]{0,200})\]\(<?([^)\s>]{1,300})>?(\s+"[^"]*")?\)/g, (all, alt, href) => {
    const m = byFrom.get(href) || byFrom.get(clean(href));
    return m && m.kind === 'image' ? `![${alt}](${m.url})` : all;
  });
  return out.split('\n').filter((l) => {
    const mm = l.replace(/[*`]/g, '').trim().replace(/^(?:[-+>•]|\d+[.)])\s*/, '').match(/^(?:FILE|ATTACH)\s*:\s*(.+)$/i);
    if (!mm) return true;
    const p = mm[1].trim().replace(/\s+\([^)]*\)\s*$/, '');
    return !(byFrom.has(p) || byFrom.has(clean(p)) || [...byFrom.keys()].some((k) => clean(p) === clean(k)));
  }).join('\n');
}
