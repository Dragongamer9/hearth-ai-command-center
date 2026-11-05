// Several chats working at once (pure logic, unit tested with a fake app bridge).
// Every chat has its own runtime: messages, AI sessions, the step stream of the AI working
// now, its Stop flag and the messages the owner sent while it was busy. Nothing here looks
// at "the open chat": results always land in the runtime (and the saved file) of the chat
// the run was started for, whichever chat the window shows at that moment.
// The owner's limit on chats working at the same time is a waiting line: a chat over the
// limit waits its turn and says so; it is never refused.
import { AGENTS, UNFILTERED } from '../registry.mjs';
import { planTurn, handoffs, pickReviewer, brief, turnPrompt, transcript, name as aiName, mentionsIn } from './brief.mjs';
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
    const blockedNamed = mentionsIn(text).filter((x) => !L.includes(x) && AGENTS[x]);
    if (opts.retry && R.turnState) {
      for (const a of order) setState(R, a, 'waiting', '');
    } else {
      R.turnState = { text, at: now(), list: [...order.map((a) => ({ agent: a, state: 'waiting', reason: '' })), ...blockedNamed.map((a) => ({ agent: a, state: 'blocked', reason: ctx.statusOf?.(a)?.why || ctx.setupHint?.(a) || 'not set up' }))] };
    }
    // Teammates in the team that can't answer yet are named once, plainly.
    for (const a of blockedNamed.filter((x) => AGENTS[x]?.kind === 'api' && UNFILTERED.includes(x))) post(R, { who: 'system', text: `${aiName(a)} was skipped: ${ctx.setupHint?.(a) || 'not set up'}.` });
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
        setState(R, agent, R.stop ? 'failed' : pe.state, R.stop ? 'Stopped by you.' : pe.reason, r?.raw);
        continue;
      }
      setState(R, agent, 'done', '');
      if (r.changes?.files?.length) changed = { by: agent, msgId: r.msgId };
      if (role === 'lead' && !opts.regenerate) {
        for (const h of handoffs(r.text, { team: t, live: L, done: [...done, ...order] })) { order.push(h); addState(R, h); }
        // Named in the lead's hand-off but not connected: blocked, with what it needs.
        for (const h of handoffs(r.text, { team: t, live: t.members, done: [...done, ...order] })) if (!L.includes(h)) addState(R, h, 'blocked', ctx.statusOf?.(h)?.why || ctx.setupHint?.(h) || 'not set up');
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

  function setState(R, agent, state, reason, raw) {
    if (!R.turnState) R.turnState = { text: '', at: now(), list: [] };
    const x = R.turnState.list.find((y) => y.agent === agent) || (R.turnState.list.push({ agent }), R.turnState.list[R.turnState.list.length - 1]);
    Object.assign(x, { state, reason: reason || '', raw: raw || undefined, at: now() });
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

  async function turn(R, agent, { role = 'member', task = '', readOnly = false, isFollowUp = false, regenerate = null } = {}) {
    const c = ctx.entry(R.id);
    if (!c) return null;
    // A teammate that only makes pictures (Civitai, a ComfyUI server): the request is the picture.
    if (ctx.imagesOnly?.(agent)) {
      const lastOwner = [...R.msgs].reverse().find((m) => m.who === 'owner');
      const prompt = (task || String(lastOwner?.text || '')).replace(/@[A-Za-z][\w-]{1,20}/g, '').trim();
      R.busy = { agent, role, runId: `${uid()}i`, steps: [{ kind: 'image', label: 'Making a picture', detail: aiName(agent) }], startedAt: Date.now() };
      ctx.render(R);
      const r = await ctx.makeImage(R, { agent, prompt });
      R.busy = null;
      const msg = post(R, r.ok ? { who: agent, role, text: r.text || 'Here it is.', via: r.via, media: r.items || [] } : { who: agent, role, err: true, text: r.message || 'No picture came back.' });
      await ctx.save(R);
      return r.ok ? { text: msg.text, msgId: msg.id } : { ok: false, plain: plainError(agent, { message: r.message || 'No picture came back.' }), raw: r.message };
    }
    const runId = `${uid().replace(/[^a-z0-9]/gi, '').slice(0, 10)}r`;
    R.busy = { agent, role, runId, steps: [], startedAt: Date.now() };
    ctx.render(R);
    const resumeId = typeof R.sessions[agent] === 'string' && !regenerate ? R.sessions[agent] : null;
    const upto = regenerate ? R.msgs.slice(0, R.msgs.findIndex((m) => m.id === regenerate)) : R.msgs;
    const build = ctx.buildFor(R) && !readOnly;
    const web = ctx.webFor(R);
    const opts = { agent, role, chat: c, copy: R.copy ? { base: R.copy.base, work: R.copy.work } : null, build, web, quickChecks: ctx.settings().tools?.quickChecks || [], team: ctx.team(), live: ctx.live(), actForMe: ctx.settings().actForMe === true, apiOnly: ctx.method(agent) === 'api', status: ctx.statusMap?.() || {}, missing: ctx.missingChecks?.() || [], canPush: Boolean(c.repo || c.repoDir) && !c.temp, autoPush: ctx.settings().autoPush !== false };
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
        web, build, title: c.title, historyText: lastOwner?.text || '', ...(model ? { model } : {}),
      }) || { ok: false, error: { message: 'The app could not start the AI.' } };
      // A scheduled task took the last free slot: wait for it, then go on.
      if (r.ok || r.error?.kind !== 'queue' || R.stop || tries > 90) break;
      if (R.busy) R.busy.note = r.error.message;
      ctx.render(R);
      await sleep(ctx.queueRetryMs ?? 4000);
    }
    const steps = R.busy?.steps || [];
    R.busy = null;
    if (r.sessionId) R.sessions[agent] = r.sessionId;
    if (r.status) R.copy = { ...r.status, exists: true };
    const media = Array.isArray(r.media) ? r.media : [];
    if (r.settingsUndone) post(R, { who: 'system', text: `${aiName(agent)} changed your settings file during its turn. The change was undone at once; your settings are as you left them. Settings › Saved data shows it in the change log.` });
    if (!r.ok) {
      // Known raw errors in plain words (src/app/errors.mjs); the raw text stays under "Details".
      const pe = plainError(agent, r.error || {});
      post(R, { who: agent, role, err: true, text: pe.reason + (r.partial ? `\n\n${r.partial}` : ''), rawError: pe.raw && pe.raw !== pe.reason ? pe.raw.slice(0, 2000) : undefined, retryable: r.error?.kind !== 'cancelled', steps, outcome: outcomeSteps(r), ...(media.length ? { media } : {}), ...(r.changes?.files?.length ? { changes: changesOf(R, r) } : {}) });
      await ctx.save(R);
      ctx.afterSave?.(R);
      return { ok: false, plain: pe, raw: pe.raw };
    }
    let raw = showMedia(r.text || '', media);
    if (ctx.afterReply) raw = ctx.afterReply(R, agent, raw);
    const { text: noPreview, previews: fenced } = extractPreviews(raw);
    const { text: noTools, tools, followUps } = parseTools(noPreview, { agent });
    const previews = [...(r.previews || []), ...fenced].map((p) => ({ id: uid(), name: p.name, kind: p.kind || kindOf(p.name), content: p.content }));
    const { acts, refused } = parseActs(noTools, { agent, enabled: ctx.settings().actForMe === true });
    const shown = noTools.split('\n').filter((l) => !/^\s*ACT FOR OWNER:/i.test(l.replace(/[*`]/g, ''))).join('\n').trim();
    const fields = {
      who: agent, role, text: shown || (previews.length ? 'Here\'s the preview.' : media.length ? 'Here it is.' : '(no text)'), via: r.via, steps, web,
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
      const other = tools.filter((x) => x.kind !== 'helper');
      if (helpers.length) followUp = await runHelpers(R, msg, helpers);
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
      const briefText = brief({ agent: p.agent, role: 'member', chat: c, copy: null, build: false, web: ctx.webFor(R), team: t, live: L, apiOnly: ctx.method(p.agent) === 'api' });
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
    if (!R?.busy || e.runId !== R.busy.runId || !e.step) return false;
    R.busy.steps.push(e.step);
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
