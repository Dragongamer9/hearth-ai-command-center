// How a team-chat round runs. Pure functions (unit tested).
import { mentions } from './chat.mjs';

// "@everyone", "@all", "@team" or addressing "everyone" in plain words.
export function asksEveryone(text) {
  return /(^|\s)@(everyone|all|team)\b/i.test(String(text || '')) || /\beveryone\b/i.test(String(text || ''));
}

// Who answers the owner's message, and whether they answer one after another or
// all at once. Default: the lead answers first; others join only when mentioned or
// handed off (each sees the replies posted before its turn). Two or more @mentions,
// or "everyone", ask those AIs at once: they answer in parallel and independently.
export function chatPlan(text, live = [], target = 'all', lead = 'anthropic') {
  const named = mentions(text).filter((a) => live.includes(a));
  if (asksEveryone(text) && live.length) {
    return { parallel: live.length > 1, queue: [lead, ...live.filter((a) => a !== lead)].filter((a) => live.includes(a)) };
  }
  if (named.length >= 2) return { parallel: true, queue: named };
  if (named.length === 1) return { parallel: false, queue: named };
  if (target !== 'all' && target !== 'relay') return { parallel: false, queue: live.includes(target) ? [target] : [] };
  const first = live.includes(lead) ? lead : live[0];
  return { parallel: false, queue: first ? [first] : [] };
}

// The owner can always send: only an empty draft stops it, never AI activity.
export function canOwnerSend(draft) {
  return String(draft || '').trim().length > 0;
}

export function newRound(id = 'R') {
  return { id, stop: false, stoppedByOwner: false, started: [], waiting: [], next: [], runs: {} };
}

// The owner wrote while a round was running: the AIs that have not started yet in
// this round are cancelled, the ones already typing finish, and the round restarts
// with his message as the newest. Returns who was cancelled.
export function ownerInterrupt(round, job) {
  if (!round) return { cancelled: [], restart: false };
  const cancelled = round.waiting.filter((a) => !round.started.includes(a));
  round.stop = true;
  round.waiting = [];
  round.next = [job];
  return { cancelled, restart: true };
}

// The owner pressed Stop: nothing else starts and nothing restarts.
export function stopRound(round) {
  if (!round) return { cancelled: [] };
  const cancelled = round.waiting.filter((a) => !round.started.includes(a));
  round.stop = true;
  round.stoppedByOwner = true;
  round.waiting = [];
  round.next = [];
  return { cancelled };
}

// A reply whose turn started before the owner's newest message is marked so.
export function cameAfterOwner(chat = [], turnStartedAt = '') {
  return chat.some((m) => m.who === 'owner' && !m.auto && String(m.at) > String(turnStartedAt));
}
