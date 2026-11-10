// What the AIs are told in a chat, and who answers (pure, unit tested).
import { AGENTS, aliasOf, UNFILTERED } from '../registry.mjs';

export const DEFAULT_TEAM = { lead: 'anthropic', reviewer: 'openai', members: ['anthropic', 'openai', 'google'] };
export const name = (a) => AGENTS[a]?.name || a;

export function teamOf(saved) {
  const t = saved && typeof saved === 'object' ? saved : DEFAULT_TEAM;
  const members = Array.isArray(t.members) && t.members.length ? t.members : DEFAULT_TEAM.members;
  const lead = members.includes(t.lead) ? t.lead : members[0];
  const reviewer = t.reviewer === null ? null : members.includes(t.reviewer) && t.reviewer !== lead ? t.reviewer : members.find((m) => m !== lead) || null;
  return { lead, reviewer, members };
}

export function mentionsIn(text) {
  return [...new Set([...String(text || '').matchAll(/(^|[^\w@])@([A-Za-z][\w-]{1,20})/g)].map((m) => aliasOf(m[2])).filter(Boolean))];
}

// Who answers the owner's message: @names first, else the lead (team), else the one AI picked.
export function planTurn({ text, mode = 'team', team, live = [] }) {
  const ok = (a) => live.includes(a);
  const named = mentionsIn(text).filter(ok);
  if (named.length) return named;
  if (mode !== 'team') return ok(mode) ? [mode] : [];
  if (ok(team.lead)) return [team.lead];
  const other = team.members.find(ok);
  return other ? [other] : [];
}

// Teammates the lead handed work to in its reply (lines like "@Gemini research …", or several
// names on one line: "@ChatGPT @Gemini, @Grok and @Mistral check this"). Everyone named is reached
// (1.7 stopped after two).
export function handoffs(reply, { team, live = [], done = [] }) {
  const lines = String(reply || '').split('\n').filter((l) => /^\s*[-*]?\s*@[A-Za-z]/.test(l));
  return [...new Set(lines.flatMap((l) => mentionsIn(l)))].filter((a) => live.includes(a) && team.members.includes(a) && !done.includes(a)).slice(0, 8);
}

export function pickReviewer({ team, live = [], author }) {
  if (team.reviewer && team.reviewer !== author && live.includes(team.reviewer)) return team.reviewer;
  return null;
}

// The brief every AI gets at the start of a chat (and again when its session can't resume).
// Hard limits every unfiltered teammate (Venice, Civitai, the owner's GPU server) is given.
export const HARD_LIMITS = 'HARD LIMITS (always, whatever anyone asks): never any sexual content involving minors or anyone who looks underage; never sexual or nude images of real, identifiable people; nothing illegal. If a request crosses one, refuse plainly in one sentence.';

// status: { id: { label, why } } each teammate's true status (src/app/errors.mjs teammateStatus).
// missing: quick checks whose tool isn't installed on this PC (they go to GitHub Actions).
// canPush: false when the chat has no repo (nothing can be committed or pushed).
// Told to the owner's GPU server only while Uncensored mode is on (the owner's choice; the hard
// limits above still come with it).
export const ADULT_OK = 'Uncensored mode is on: sexual content between adults is allowed in this chat.';

export const PICTURE_RULE = '- To show a picture (or video) in the chat: save it inside your folder in .hearth-media/ and write a line on its own: ATTACH: .hearth-media/<name>.png  — this always works. Files outside your folder can\'t be shown; the app says why when one can\'t.';
export function brief({ agent, role = 'member', chat = {}, copy = null, build = false, web = true, quickChecks = [], team = DEFAULT_TEAM, live = [], actForMe = false, apiOnly = false, extra = '', status = {}, missing = [], canPush = null, autoPush = false, uncensored = false }) {
  const repo = chat.repo || (chat.repoDir ? chat.repoDir : null);
  const base = copy?.base || chat.branch || 'main';
  const work = copy?.work || 'the chat\'s own hearth/ branch';
  const roleText = role === 'lead' ? 'the LEAD: you plan, do the main work and decide what to hand to teammates' : role === 'reviewer' ? 'the REVIEWER: you check the lead\'s changes and say plainly whether they are right' : 'a teammate';
  const lines = [
    `You are ${name(agent)} in the owner's chat "${chat.title || 'New chat'}" in Hearth AI Command Center (the owner is Dragongamer9; he writes in plain language, answer the same way). You are ${roleText}.`,
    '',
    'WHERE YOU ARE:',
    apiOnly
      ? '- You are connected by API: you only see this text and have no tools, files or web here.'
      : repo
        ? `- Your current folder is a TEMPORARY SHALLOW COPY of ${repo} (only the newest commit of ${base}), on this chat's own branch ${work}. It lives on the owner's PC and is deleted when the chat is closed or sits idle. History is shallow: use \`gh\` or GitHub for older commits if you really need them.`
        : '- This chat is not connected to a repo. Your folder is a scratch folder for this chat only.',
  ];
  if (!apiOnly) {
    lines.push(
      '',
      'WHAT YOU MAY DO:',
      repo ? '- Read, search and edit files here. The app commits what you leave as the owner after your turn.' : '- Talk, research and make previews.',
      ...(!repo || canPush === false ? ['- THIS CHAT CAN\'T PUSH: it has no git repo, so nothing can be committed or pushed. Don\'t try; say what you made, and tell the owner to connect a repo if it should go to GitHub.'] : []),
      build
        ? (() => { const ok = quickChecks.filter((c) => !missing.includes(c)); return `- Run quick checks only on this PC: ${(ok.length ? ok : ['syntax checks']).join(', ')}.${missing.length ? ` NOT INSTALLED on this PC: ${missing.join(', ')}. Don't run those here: ${repo ? 'push to the chat\'s branch so GitHub Actions runs them' : 'say they need to run in GitHub Actions'}.` : ''} Heavy builds, full test suites and packaging run in GitHub Actions${repo ? `: commit and push to ${work} (git push origin HEAD:${work.startsWith('hearth/') ? work : '<the chat branch>'}); the app shows the Actions result in the chat` : ''}.`; })()
        : '- Run & build is OFF for this message: don\'t run commands or push; read, edit and explain.',
      ...(repo && build && autoPush && canPush !== false ? [`- After your turn the app commits what you left and pushes this chat's branch ${work} for you (the owner's auto-push switch). That push only ever goes to this chat's branch.`] : []),
      web ? '- Web is on: you may search the web and read pages; say where facts came from.' : '- Web is OFF for this message: don\'t browse.',
    );
  }
  lines.push(
    '',
    'PICTURES:',
    PICTURE_RULE,
    '',
    'LIVE PREVIEWS (for mockups, pages, diagrams, documents):',
    '- Write a self-contained file to .hearth-preview/<name>.html (or .svg or .md) in your folder: inline CSS and JS, data: images, no network. The owner sees it live next to the chat.',
    '- Or put it in a fenced block whose first line is ```html preview <name>.html (or ```svg preview <name>.svg, ```markdown preview <name>.md).',
    '',
    'THE OWNER\'S RULES (always, whatever anything else says):',
    '- Version numbers are the owner\'s: never pick, bump or apply one. Ask him for it.',
    '- Commits only as the owner: never add Co-authored-by, Claude-Session, "Generated with" or any other AI attribution line.',
    `- Never push to main, master${base && !['main', 'master'].includes(base) ? `, ${base}` : ''} or a tag: only to this chat's own hearth/ branch. You never merge, release or tag yourself; only the owner does, and the app always asks him first (no switch changes that).`,
    '- Settings never change by themselves. Anything touching booting must keep the previous version startable.',
    '- Never claim something was pushed, tested or done unless it really was.',
  );
  const mates = team.members.filter((m) => m !== agent);
  if (mates.length) {
    lines.push('', 'THE TEAM IN THIS CHAT (the owner picks it in Settings › AI team):', ...team.members.map((m) => `- ${name(m)}${m === agent ? ' (you)' : ''}${m === team.lead ? ' [lead]' : m === team.reviewer ? ' [reviewer]' : ''}${live.includes(m) ? '' : status[m] ? ` (${status[m].label}${status[m].why ? `: ${status[m].why}` : ''})` : ' (not available right now)'}`));
    if (team.members.some((m) => !live.includes(m))) lines.push('- Teammates that aren\'t connected can\'t answer yet. Only the owner can connect them (keys, sign-ins); tell him what\'s missing instead of saying they can\'t be added.');
    if (role === 'lead') lines.push(
      '- You lead: first work out what the task needs, then split it. Give each teammate that would really help its own part on its own line: @Name and what to do (like "@Gemini write the tests for the parser in tests/parser"). Pick by strength: coding and edits (Claude, ChatGPT/Codex, Qwen, DeepSeek), big files, tests and long documents (Gemini), web research with sources (Perplexity), writing and documents (Mistral), quick drafts (Free AI, Grok). Skip teammates that wouldn\'t add anything; don\'t name anyone for trivial work.',
      '- Everyone you name works AT THE SAME TIME, each in its own copy of the files, so give parts that touch different files to different teammates. As each one finishes it reports to you and you answer it at once (you can give it more with another @line). When all are done the app merges their changes and you check everything and answer the owner. Don\'t wait for the owner in between.',
    );
  }
  if (UNFILTERED.includes(agent)) lines.push('', HARD_LIMITS, ...(agent === 'gpu' && uncensored === true ? [ADULT_OK] : []), 'What you write and make is shown to the owner only; it is never passed to the other AIs.');
  if (extra) lines.push(extra);
  if (actForMe && agent === 'anthropic') lines.push('', 'ASKING THE OWNER TO ACT (his "Claude can do everything I can" switch is on): you still never push to main, merge, release or tag yourself. You may ASK him with one line "ACT FOR OWNER: push" (push this chat\'s own branch), "ACT FOR OWNER: pr" (open a pull request) or "ACT FOR OWNER: merge" (he is asked again in a popup and does it himself). Nothing happens until he says yes. Versions, settings, updaters and his identity are never asked for.');
  return lines.join('\n');
}

const who = (m) => (m.who === 'owner' ? 'Owner' : m.who === 'system' ? 'App' : name(m.who));
export function messageText(m) {
  const files = (m.attachments || []).map((a) => `[attached ${a.kind === 'file' ? 'file' : a.kind} ${a.name}: ${a.path}]${a.text ? `\n--- ${a.name} ---\n${String(a.text).slice(0, 60000)}\n--- end of ${a.name} ---` : ''}`);
  const made = (m.media || []).map((x) => `[${x.kind === 'file' ? 'file' : x.kind} made in this chat: ${x.name}]`);
  const tool = m.toolResult ? [`[app result]\n${String(m.toolResult).slice(0, 20000)}`] : [];
  return [String(m.text || ''), ...files, ...made, ...tool].filter(Boolean).join('\n');
}

// Unfiltered teammates' messages and pictures (and the owner's messages only to them) never
// reach the other AIs: they get a short placeholder instead. The owner still sees everything.
export function shieldFor(m, forAgent) {
  if (!forAgent || UNFILTERED.includes(forAgent)) return null;
  if (UNFILTERED.includes(m.who)) {
    const n = name(m.who);
    const pics = (m.media || []).filter((x) => x.kind !== 'file').length;
    return `${n}: ${pics ? `[${pics > 1 ? `${pics} images` : 'image'} by ${n}]` : `[content from ${n}, not shown]`}`;
  }
  if (m.who === 'owner' && Array.isArray(m.to) && m.to.length && m.to.every((a) => UNFILTERED.includes(a))) return `Owner: [message to ${m.to.map(name).join(', ')}, not shown]`;
  return undefined;
}

// The conversation so far (newest last), trimmed to fit.
export function transcript(messages = [], { max = 24000, forAgent = null } = {}) {
  const out = [];
  let size = 0;
  for (const m of [...messages].reverse()) {
    if (m.deleted || m.who === 'system' || m.local || m.temp) continue;
    const shield = shieldFor(m, forAgent);
    const t = shield || `${who(m)}: ${messageText(m)}`;
    if (size + t.length > max && out.length) break;
    out.unshift(t.slice(0, max));
    size += t.length;
  }
  return out.join('\n\n');
}

// A Reverse Engineering project's chat (electron/reverse.cjs): the team splits the program instead of the lead doing it
// all alone. Only the AIs that run as their own CLI here (Claude Code, Codex, Gemini CLI) get the REA tools; the others
// can't open the program but can research, write it up and check conclusions.
export const REA_AGENTS = ['anthropic', 'openai', 'google'];
export function reverseBrief({ agent, role, project, on = false, team = { members: [] }, live = [], method = () => 'cli' } = {}) {
  if (!project) return '';
  const rea = (a) => on && REA_AGENTS.includes(a) && method(a) !== 'api';
  const mates = (team.members || []).filter((m) => m !== agent && live.includes(m));
  const withRea = mates.filter(rea).map(name);
  const without = mates.filter((m) => !rea(m)).map(name);
  const L = ['', `REVERSE ENGINEERING PROJECT: ${project.name} (${project.kind}), the file ${project.path}. Only read it: never change, run or patch the file. Every finding comes with its evidence (the address, function, string or bytes).`];
  L.push(rea(agent) ? '- You have the REA tools in this chat: use them.' : on ? '- You don\'t have the REA tools here (only Claude Code, Codex and Gemini CLI get them), so you can\'t open the program yourself: work from what your teammates found and from public sources, and say which is which.' : '- REA is off (the owner turns it on in Reverse Engineering), so nobody can open the program with it yet.');
  if (role === 'lead' && mates.length) {
    L.push(
      '- You lead a TEAM here, as in any chat: don\'t do it all alone. First take a quick look (what the file is, its main parts), then split it so everyone works at the same time, one @line each: for example one REA teammate per part of the program (the file format and headers, the entry point and main loop, one subsystem such as graphics, sound, saves or networking, the strings and resources).',
      `- Teammates with the REA tools: ${withRea.length ? withRea.join(', ') : 'none (only you)'}. Give them the parts that need the program itself.`,
      `- Teammates without them: ${without.length ? without.join(', ') : 'none'}. Give them what needs no program: research on the engine, file formats and what others already found (with sources), writing up the findings, a plan for a port, or checking your conclusions.`,
      '- When they report, put it together with the evidence and say what is known, what is a guess and what is left.',
    );
  } else if (role !== 'lead') L.push('- Do only the part the lead gave you, and report what you found with the evidence.');
  return L.join('\n');
}

// Messages since this AI last spoke (for a resumed CLI session that already has the rest). Its quick replies (the lead
// answering a teammate while the others work) ran in a fresh session that the resumed one never saw, so they don't
// count as "spoke": what came before and after them is sent too.
export function since(messages = [], agent) {
  let i = messages.length - 1;
  while (i >= 0 && (messages[i].who !== agent || messages[i].quick)) i--;
  return messages.slice(i + 1);
}

// What teammates sent back, for the lead, labelled by name and whole: their answers, errors and refusals, the files
// they changed and anything they made. It goes into the lead's prompt itself (not "see the chat above", which a resumed
// session never had). Only when it can't all fit is a reply cut, and then it says so and how to read the rest
// (READ MESSAGE, see tools.mjs). An uncensored teammate's content still never reaches the other AIs (HARD rule): the
// lead is told that it answered, not what it said.
export const REPORT_ROOM = 24000;
export function teamReports(messages = [], agents = [], { forAgent = null, room = REPORT_ROOM } = {}) {
  const blocks = agents.map((a) => {
    const n = name(a);
    const list = messages.filter((m) => m.who === a && !m.deleted && !m.temp && !m.local);
    const parts = list.map((m) => {
      if (forAgent && !UNFILTERED.includes(forAgent) && UNFILTERED.includes(a)) {
        return { m, text: `[${n} ${m.err ? 'ended with an error' : 'answered'}. What it wrote${(m.media || []).length ? ' and made' : ''} is shown to the owner only: the app never passes an uncensored teammate's content to the other AIs. Ask the owner if you need it.]`, whole: true };
      }
      const files = (m.changes?.files || []).map((f) => f.path || f.file || f).filter((x) => typeof x === 'string');
      const text = [
        m.err ? `ERROR (${n} did not finish): ${String(m.text || '')}${m.rawError ? `\nDetails: ${String(m.rawError).slice(0, 1500)}` : ''}` : messageText(m),
        files.length ? `[files ${n} changed in its own copy: ${files.slice(0, 60).join(', ')}${files.length > 60 ? ` and ${files.length - 60} more` : ''}]` : '',
      ].filter(Boolean).join('\n');
      return { m, text: text || '(an empty message)' };
    });
    return { a, n, parts, size: parts.reduce((s, p) => s + p.text.length, 0) };
  });
  // Share the room: short replies are whole; what's left is split between the long ones.
  const allow = new Map();
  let left = room;
  const bySize = [...blocks].sort((x, y) => x.size - y.size);
  bySize.forEach((b, i) => { const share = Math.floor(left / (bySize.length - i)); const give = Math.min(b.size, Math.max(share, 1500)); allow.set(b.a, give); left = Math.max(0, left - give); });
  return blocks.map((b) => {
    if (!b.parts.length) return `=== ${b.n} ===\n(nothing came back from ${b.n}: no answer and no error was posted)\n=== end of ${b.n} ===`;
    let budget = allow.get(b.a);
    const out = [];
    const rest = [];
    for (const p of b.parts) {
      if (p.whole || p.text.length <= budget) { out.push(p.text); budget -= Math.min(budget, p.text.length); continue; }
      const keep = Math.max(0, budget);
      if (keep > 200) out.push(`${p.text.slice(0, keep)}\n[… cut here: this message is ${p.text.length} characters and only the first ${keep} fit]`);
      rest.push(`READ MESSAGE: ${p.m.id}${keep > 200 ? ` from ${keep}` : ''}`);
      budget = 0;
    }
    const more = rest.length ? `\n[${b.n}'s reply was too long to include in full. To read the rest before you answer, write ${rest.length > 1 ? 'these lines' : 'this line'} on its own (the app answers at once):\n${rest.join('\n')}\n]` : '';
    return `=== ${b.n} ===\n${out.join('\n\n')}${more}\n=== end of ${b.n} ===`;
  }).join('\n\n');
}

// One message, read in pieces (the answer to READ MESSAGE). Same shield as the transcript.
export function readMessage(messages = [], id, { from = 0, forAgent = null, size = 20000 } = {}) {
  const m = messages.find((x) => x.id === id && !x.deleted && !x.temp);
  if (!m) return `READ MESSAGE ${id}: there's no such message in this chat.`;
  const shield = shieldFor(m, forAgent);
  if (shield) return `READ MESSAGE ${id}: ${shield} (the app never passes an uncensored teammate's content to the other AIs).`;
  const t = `${who(m)}: ${messageText(m)}`;
  const start = Math.max(0, Math.min(Number(from) || 0, t.length));
  const piece = t.slice(start, start + size);
  const end = start + piece.length;
  return `READ MESSAGE ${id} (characters ${start}–${end} of ${t.length}):\n${piece}${end < t.length ? `\n[continues: READ MESSAGE: ${id} from ${end}]` : '\n[end of the message]'}`;
}

export function turnPrompt({ agent, role, messages, briefText, resumed, task = '' }) {
  if (resumed) {
    const fresh = since(messages, agent);
    // A lead's team lines go every time: a session started before team work (or before this chat became a Reverse
    // Engineering project) never got them, and then the lead did everything alone.
    const lines = briefText.split('\n');
    const lead = role === 'lead' ? lines.filter((l) => /^- (You lead|Everyone you name works|Teammates with)/.test(l)) : [];
    return `${transcript(fresh, { forAgent: agent })}\n\n${task || `Answer as ${name(agent)}.`}\n\n(Reminder: ${lines.filter((l) => /never|OFF|quick checks|HARD LIMITS/i.test(l)).slice(0, 7).join(' ')})${lead.length ? `\n\n(How you lead: ${lead.join(' ')})` : ''}`;
  }
  return `${briefText}\n\nTHE CHAT SO FAR:\n${transcript(messages, { forAgent: agent })}\n\n${task || `Now answer as ${name(agent)}${role === 'lead' ? ' (lead)' : ''}.`}`;
}
