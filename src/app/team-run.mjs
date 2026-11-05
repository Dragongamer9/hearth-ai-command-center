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
    // Teammates in the team that can't answer yet are named once, plainly.
    for (const a of mentionsIn(text).filter((x) => !L.includes(x) && AGENTS[x]?.kind === 'api' && UNFILTERED.includes(x))) post(R, { who: 'system', text: `${aiName(a)} was skipped: ${ctx.setupHint?.(a) || 'not set up'}.` });
    const done = [];
    let changed = null;
    let ok = true;
    for (let i = 0; i < order.length && !R.stop; i++) {
      const agent = order[i];
      const role = mode === 'team' && agent === t.lead ? 'lead' : 'member';
      const task = opts.task && i === 0 ? opts.task : (i > 0 && role !== 'lead' ? handoffTask(R, agent) : '');
      let r = await turn(R, agent, { role, task, regenerate: opts.regenerate && i === 0 ? opts.regenerate : null });
      done.push(agent);
      if (!r) { ok = false; break; }
      // App lines that need an answer (search past chats, helpers): one more turn, at most twice.
      for (let loop = 0; loop < 2 && r?.followUp && !R.stop; loop++) r = await turn(R, agent, { role, task: r.followUp, isFollowUp: true }) || null;
      if (!r) { ok = false; break; }
      if (r.changes?.files?.length) changed = { by: agent, msgId: r.msgId };
      if (role === 'lead' && !opts.regenerate) for (const h of handoffs(r.text, { team: t, live: L, done: [...done, ...order] })) order.push(h);
    }
    const reviewer = changed && mode === 'team' && !R.stop ? pickReviewer({ team: t, live: L, author: changed.by }) : null;
    if (reviewer && !UNFILTERED.includes(reviewer)) {
      const d = await ctx.call('chatDiff', R.id);
      const diff = String(d?.diff || '').slice(0, 40000);
      await turn(R, reviewer, { role: 'reviewer', task: `Review ${aiName(changed.by)}'s changes on this chat's branch. Say plainly if they are right and what (if anything) must change. Keep it short. Don't edit files.\n\nTHE CHANGES:\n${diff || '(no diff available)'}`, readOnly: true });
    }
    return ok;
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
      return r.ok ? { text: msg.text, msgId: msg.id } : null;
    }
    const runId = `${uid().replace(/[^a-z0-9]/gi, '').slice(0, 10)}r`;
    R.busy = { agent, role, runId, steps: [], startedAt: Date.now() };
    ctx.render(R);
    const resumeId = typeof R.sessions[agent] === 'string' && !regenerate ? R.sessions[agent] : null;
    const upto = regenerate ? R.msgs.slice(0, R.msgs.findIndex((m) => m.id === regenerate)) : R.msgs;
    const build = ctx.buildFor(R) && !readOnly;
    const web = ctx.webFor(R);
    const opts = { agent, role, chat: c, copy: R.copy ? { base: R.copy.base, work: R.copy.work } : null, build, web, quickChecks: ctx.settings().tools?.quickChecks || [], team: ctx.team(), live: ctx.live(), actForMe: ctx.settings().actForMe === true, apiOnly: ctx.method(agent) === 'api' };
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
    if (!r.ok) {
      const kind = r.error?.kind;
      const why = kind === 'limit' ? `${aiName(agent)} is out of usage${r.error.reset ? ` (${r.error.reset})` : ''}.` : kind === 'auth' ? `${aiName(agent)} isn't signed in. Sign in under Settings › Accounts.` : kind === 'cancelled' ? 'Stopped.' : kind === 'wrong_repo' ? r.error.message : kind === 'refused' ? `${aiName(agent)} refused: ${r.error.message}` : r.error?.message || 'Something went wrong.';
      post(R, { who: agent, role, err: true, text: why + (r.partial ? `\n\n${r.partial}` : ''), steps, outcome: outcomeSteps(r), ...(media.length ? { media } : {}), ...(r.changes?.files?.length ? { changes: changesOf(R, r) } : {}) });
      await ctx.save(R);
      ctx.afterSave?.(R);
      return null;
    }
    let raw = r.text || '';
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

  return { rt, runtimes, queue, start, stop, turn, runTeam, onStep, post, busyIds: () => [...runtimes.values()].filter((R) => R.round || R.waiting).map((R) => R.id) };
}
