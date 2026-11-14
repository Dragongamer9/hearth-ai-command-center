// Plain words for what went wrong with a teammate, and each teammate's true status
// (pure, unit tested in test/ai-fixes.test.mjs).
import { AGENTS } from '../registry.mjs';

const nm = (a) => AGENTS[a]?.name || a;

// Known raw errors from the AI tools, in plain words. First match wins.
const KNOWN = [
  [/headless mode cannot prompt|auto-?denied|cannot prompt for (approval|permission)|requires? (user )?approval|permission (was )?denied|not (on|in) (the|its) allow-?list|tool .* (was )?(denied|blocked)|denied by (the )?(policy|user)/i,
    (a) => `${nm(a)} needed permission for a command, file or web page that isn't on its allow-list, so its tool refused it.${a === 'google' ? ' agy only says which kind of permission it needed (not which command or file) and stops its whole run. If Run & build is off, Gemini runs in plan mode, which may refuse commands even when they are allowed: turn on Run & build and retry, or run the Tool test in Settings › AI team, which tries each step on its own. Set up Gemini\'s allow-list in Settings › Permissions if you haven\'t yet.' : ' Check what it may do in Settings › Permissions.'}`, 'blocked'],
  [/jetski/i, (a) => `${nm(a)}'s tool (agy) stopped with an internal error ("jetski" comes from inside agy, not from the app). Press Retry; if it keeps happening, update agy.`, 'failed'],
  [/eligibility check failed|not eligible/i, (a) => `${nm(a)}: Google says this account can't use the Antigravity CLI right now. Sign in again in a terminal (run agy).`, 'blocked'],
  [/out of usage|usage limit|rate[ _-]?limit|quota|\b429\b/i, (a) => `${nm(a)} is out of usage for now.`, 'blocked'],
  [/not signed in|not logged in|unauthori[sz]ed|\b401\b|invalid api key|authenticat/i, (a) => `${nm(a)} isn't signed in. Sign in under Settings › Accounts.`, 'blocked'],
  [/is not installed|could not be started|ENOENT|command not found/i, (a) => `${nm(a)}'s app (CLI) isn't installed on this PC. Install it in Settings › Accounts.`, 'blocked'],
  [/took too long|timed? ?out|ETIMEDOUT/i, (a) => `${nm(a)} took too long and was stopped.`, 'failed'],
  [/unreachable|ECONNREFUSED|ENOTFOUND|ECONNRESET|network|fetch failed|50[0234]|overloaded/i, (a) => `${nm(a)}'s service is unreachable or having problems right now.`, 'failed'],
];

// { state: 'failed' | 'blocked', reason, raw }
export function plainError(agent, error = {}) {
  const pe = plainErrorOnly(agent, error);
  // 3.4.1: the one fix for it, shown as a button right in the error: open the AI's web page (web sign-in), sign in,
  // install, or its row in Settings › Accounts.
  const kind = error?.kind;
  const fix = error?.fix === 'open' ? 'open' : kind === 'not_installed' || /isn't installed/.test(pe.reason) ? 'install' : kind === 'auth' || /isn't signed in/.test(pe.reason) ? (AGENTS[agent]?.kind === 'api' ? 'accounts' : 'signin') : kind === 'no_key' ? 'accounts' : null;
  return fix ? { ...pe, fix } : pe;
}
function plainErrorOnly(agent, error = {}) {
  const raw = String(error?.message || error || '').trim();
  const kind = error?.kind;
  // 3.9: Hearth AI words its own errors (not running, key not accepted, connections off, already busy, her limits).
  if (agent === 'ithil' && raw && kind !== 'cancelled') return { state: ['auth', 'busy', 'off', 'offline', 'refused'].includes(kind) ? 'blocked' : 'failed', reason: raw, raw };
  // The web sign-in bridge words its own errors (signed out vs. no chat box vs. no answer, and where it got to).
  if (error?.fix === 'open' && raw) return { state: kind === 'auth' ? 'blocked' : 'failed', reason: raw, raw };
  if (kind === 'page') return { state: 'failed', reason: raw || `${nm(agent)}'s page didn't show its chat box.`, raw };
  if (kind === 'cancelled') return { state: 'failed', reason: 'Stopped.', raw };
  if (kind === 'limit') return { state: 'blocked', reason: `${nm(agent)} is out of usage${error.reset ? ` (${error.reset})` : ''}.`, raw };
  if (kind === 'auth') return { state: 'blocked', reason: `${nm(agent)} isn't signed in. Sign in under Settings › Accounts.`, raw };
  if (kind === 'not_installed') return { state: 'blocked', reason: `${nm(agent)}'s app (CLI) isn't installed on this PC. Install it in Settings › Accounts.`, raw };
  if (kind === 'timeout') return { state: 'failed', reason: `${nm(agent)} took too long and was stopped. Its work so far is kept.`, raw };
  if (kind === 'refused') return { state: 'failed', reason: `${nm(agent)} refused: ${raw}`, raw };
  if (kind === 'wrong_repo') return { state: 'blocked', reason: raw, raw };
  for (const [re, say, state] of KNOWN) if (re.test(raw)) return { state, reason: say(agent), raw };
  if (kind === 'outage') return { state: 'failed', reason: `${nm(agent)}'s service is unreachable or having problems right now.`, raw };
  return { state: 'failed', reason: raw ? `${nm(agent)} stopped with an error: ${raw.slice(0, 240)}` : `${nm(agent)} stopped without saying why.`, raw };
}

// A teammate's true status for the team lists.
// info: { inTeam, kind: 'cli'|'api'|'local'|'manual'|'teammate', installed, signedIn, keySaved, ready }
export function teammateStatus(id, info = {}) {
  if (!info.inTeam) return { state: 'off', label: 'off', why: 'Not in your team (Settings › AI team).' };
  if (info.ready) return { state: 'connected', label: 'connected', why: '' };
  if (info.kind === 'teammate') return { state: 'key', label: id === 'gpu' || id === 'hearth' ? 'needs a server' : 'needs a key', why: id === 'gpu' ? 'Add your GPU server in Settings › Accounts.' : id === 'hearth' ? 'Type your Home server\'s address in Settings › Accounts › Hearth devices.' : `Add your ${nm(id)} key in Settings › Accounts.` };
  if (info.kind === 'api') return { state: 'key', label: 'needs a key', why: `Add your ${nm(id)} API key in Settings › Accounts.` };
  if (info.kind === 'local') return { state: 'cli', label: 'not running', why: 'Ollama isn\'t running on this PC.' };
  if (info.kind === 'manual') return { state: 'off', label: 'terminal only', why: 'FreeBuff only works in a terminal.' };
  if (!info.installed) return { state: 'cli', label: 'CLI missing', why: `Install ${AGENTS[id]?.tool || nm(id)} in Settings › Accounts.` };
  if (info.signedIn === false) return { state: 'signin', label: 'not signed in', why: `Sign in to ${nm(id)} in Settings › Accounts.` };
  return { state: 'cli', label: 'checking…', why: '' };
}

// The words for each turn state in the chat.
export const TURN_LABEL = { waiting: 'waiting', working: 'working', blocked: 'blocked', failed: 'failed', done: 'done', skipped: 'skipped' };
