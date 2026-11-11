// 3.4.1 Test team: every teammate is asked to reply with its own check word, and the owner gets one table: passed,
// failed (with the reason), not signed in, not connected, not in the team, or skipped (and why). Pure logic, unit
// tested in test/rollcall.test.mjs; src/main.js runs it through the same chatRun path a real chat uses.
import { AGENTS } from '../registry.mjs';

const nm = (a) => AGENTS[a]?.name || a;
export const handleOf = (a) => nm(a).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12);

// A word nobody would write by chance: HEARTH-<AI>-<4 letters/digits>.
export function checkWord(agent, rand = Math.random) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let tail = '';
  for (let i = 0; i < 4; i++) tail += abc[Math.floor(rand() * abc.length) % abc.length];
  return `HEARTH-${handleOf(agent)}-${tail}`;
}

export const CHECK_PROMPT = (word) => `This is an automatic check from the Hearth AI Command Center, to see that you're connected. Don't use any tools and don't change anything. Reply with exactly this one word and nothing else:\n${word}`;

// Who gets asked, and why the others aren't. info(a): { inTeam, ready, status: { state, label, why }, imagesOnly,
// cloud, builder, bridge }. scope 'team' = the owner's team only; 'all' = every AI in the app.
export function planCheck(ids, info) {
  return ids.filter((a) => AGENTS[a] && a !== 'none').map((a) => {
    const i = info(a) || {};
    const base = { agent: a, bridge: Boolean(i.bridge) };
    if (!i.inTeam) return { ...base, run: false, state: 'offteam', reason: 'Not in your team (Settings › AI team).', fix: 'team' };
    if (i.imagesOnly) return { ...base, run: false, state: 'skipped', reason: 'Makes pictures only: no check word.' };
    if (i.cloud) return { ...base, run: false, state: 'skipped', reason: 'A cloud agent: asking it would start a whole (paid) job on its site.' };
    if (i.builder) return { ...base, run: false, state: 'skipped', reason: 'An app builder: it builds apps on its own site, so there\'s no check word.' };
    if (i.ready) return { ...base, run: true, state: 'waiting', reason: '' };
    const st = i.status || {};
    if (st.state === 'signin') return { ...base, run: false, state: 'signin', reason: st.why || 'Not signed in.', fix: 'signin' };
    return { ...base, run: false, state: 'notconnected', reason: st.why || 'Not connected: set it up in Settings › Accounts.', fix: st.state === 'cli' && /install/i.test(st.why || '') ? 'install' : 'accounts' };
  });
}

// Did the reply carry the word? (Case and stray punctuation don't matter; an error is a fail with its reason.)
export function judgeReply(r, word) {
  if (!r) return { state: 'failed', reason: 'No answer came back.' };
  if (r.ok === false) {
    const msg = String(r.error?.message || 'It stopped with an error.').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (r.error?.kind === 'auth' && !r.error?.fix) return { state: 'signin', reason: msg, fix: 'signin' };
    return { state: 'failed', reason: msg, fix: r.error?.fix || null };
  }
  const text = String(r.text || '');
  const flat = text.toUpperCase().replace(/[^A-Z0-9-]/g, ' ');
  if (flat.split(/\s+/).includes(word.toUpperCase())) return { state: 'passed', reason: text.trim().length > word.length + 40 ? 'Gave the word (with more text around it).' : '' };
  return { state: 'failed', reason: text.trim() ? `Answered without the check word: “${text.replace(/\s+/g, ' ').trim().slice(0, 160)}”` : 'Answered with nothing.' };
}

// Run the asks: web-bridge teammates a couple at a time (their pages time out when many open at once), the others a
// few at a time. run(row) resolves to the chatRun result. onUpdate() after every change.
export async function runCheck(rows, { run, judge = judgeReply, words, bridgeAtOnce = 2, othersAtOnce = 4, timeoutMs = 6 * 60000, onUpdate = () => {}, wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() }) {
  const todo = rows.filter((r) => r.run);
  const lanes = [todo.filter((r) => r.bridge), todo.filter((r) => !r.bridge)];
  const worker = async (list, size) => {
    const queue = [...list];
    await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
      while (queue.length) {
        const row = queue.shift();
        row.state = 'working';
        const t0 = now();
        onUpdate();
        const late = wait(timeoutMs).then(() => ({ ok: false, error: { kind: 'timeout', message: `No answer within ${Math.round(timeoutMs / 60000)} minutes.` } }));
        let r;
        try { r = await Promise.race([run(row), late]); } catch (e) { r = { ok: false, error: { message: String(e?.message || e) } }; }
        Object.assign(row, judge(r, words[row.agent]), { ms: now() - t0, via: r?.via || '' });
        onUpdate();
      }
    }));
  };
  await Promise.all([worker(lanes[0], bridgeAtOnce), worker(lanes[1], othersAtOnce)]);
  return rows;
}

// The table's order and words.
export const CHECK_ORDER = ['failed', 'signin', 'notconnected', 'passed', 'working', 'waiting', 'offteam', 'skipped'];
export const CHECK_LABEL = { passed: 'passed', failed: 'failed', signin: 'not signed in', notconnected: 'not connected', offteam: 'not in the team', skipped: 'skipped', working: 'asking…', waiting: 'waiting' };
export function summary(rows) {
  const n = (s) => rows.filter((r) => r.state === s).length;
  return [['passed', n('passed')], ['failed', n('failed')], ['not signed in', n('signin')], ['not connected', n('notconnected')], ['not in the team', n('offteam')], ['skipped', n('skipped')]].filter(([, c]) => c).map(([l, c]) => `${c} ${l}`).join(' · ');
}
