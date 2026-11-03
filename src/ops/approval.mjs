// Approval levels: routine actions never ask, major ones ask the owner (or the lead
// while the lead switch is on), owner-only ones always need the owner. Pure and unit
// tested. The owner can move a category between Routine and Major in Settings (saved
// in settings.json by the main process); nothing moves out of Owner-only.
export const CATEGORIES = {
  // Routine by default
  attach: { label: 'Post images, video or files from the project in team chat (ATTACH lines)', level: 'routine' },
  read: { label: 'Read project files', level: 'routine' },
  tests: { label: "Run the project's tests", level: 'routine' },
  edit: { label: "Edit and commit on the AI's own task branch", level: 'routine' },
  review: { label: 'Comments and reviews', level: 'routine' },
  screenshot: { label: 'Take screenshots of the app', level: 'routine' },
  // Major by default
  install: { label: 'Install software', level: 'major' },
  outside: { label: 'Commands outside the project workspace', level: 'major' },
  command: { label: 'Other risky commands', level: 'major' },
  delete: { label: "Delete files outside the AI's own branch or worktree", level: 'major' },
  secrets: { label: 'Anything touching secrets, keys or credentials', level: 'major' },
  network: { label: "Network access beyond the AI's own tool", level: 'major' },
  push: { label: "Push anywhere except the lead's allowed task and release branches", level: 'major' },
  boot: { label: 'Boot-critical change (the owner answers; the lead cannot)', level: 'major', ownerAnswers: true },
  other: { label: 'Anything else an AI asks about', level: 'major' },
  // Owner-only, always
  merge: { label: 'Merge to main', level: 'owner' },
  release: { label: 'Releases', level: 'owner' },
  version: { label: 'Version numbers', level: 'owner' },
  tag: { label: 'Tags', level: 'owner' },
  settings: { label: 'Changing app settings', level: 'owner' },
};
export const LEVELS = ['routine', 'major', 'owner'];
export const OWNER_ONLY = Object.keys(CATEGORIES).filter((k) => CATEGORIES[k].level === 'owner');
export const MOVABLE = Object.keys(CATEGORIES).filter((k) => CATEGORIES[k].level !== 'owner' && k !== 'other');
export const DEFAULT_LEVELS = Object.fromEntries(Object.entries(CATEGORIES).map(([k, c]) => [k, c.level]));

// The owner's saved choices, merged over the defaults. Owner-only stays owner-only;
// unknown categories and values are dropped.
export function cleanLevels(saved) {
  const out = { ...DEFAULT_LEVELS };
  if (saved && typeof saved === 'object') {
    for (const k of MOVABLE) if (saved[k] === 'routine' || saved[k] === 'major') out[k] = saved[k];
  }
  return out;
}

// Only the differences from the defaults are saved, so later defaults don't overwrite choices.
export function levelPatch(levels, key, level) {
  if (!MOVABLE.includes(key) || !['routine', 'major'].includes(level)) return { ok: false, reason: OWNER_ONLY.includes(key) ? `${CATEGORIES[key].label} is always the owner's` : 'unknown category' };
  const next = { ...cleanLevels(levels), [key]: level };
  return { ok: true, saved: Object.fromEntries(MOVABLE.filter((k) => next[k] !== DEFAULT_LEVELS[k]).map((k) => [k, next[k]])), levels: next };
}

let current = { ...DEFAULT_LEVELS };
export function setLevels(saved) { current = cleanLevels(saved); return current; }
export function getLevels() { return current; }
export const levelOf = (kind, levels = current) => cleanLevels(levels)[kind] || 'major';

// Pushes that are really merges or releases: never something the lead may allow.
const DANGEROUS_PUSH = /\b(main|master)\b|--tags|\btags?\b|--force|\s-f\b|--mirror|\bdelete\b|:refs\//i;

// A plain-words ASK ("ASK: other | post a screenshot") about something routine is
// recognised as routine; anything with a major signal stays as asked.
const MAJOR_WORDS = /install|apt|dnf|pacman|pip |sudo|rm\s|delete|remove|secret|token|credential|password|api key|ssh key|\bkey\b|curl|wget|download|upload|push|merge|release|version|\btag\b|setting|outside|\/etc\/|home folder|boot|grub|format/i;
const ROUTINE_WORDS = [
  ['attach', /\b(attach|post|share|upload to (the )?chat)\b.*\b(image|screenshot|video|file|recording|png|jpg|gif|mp4)\b|\bATTACH:/i],
  ['screenshot', /\bscreenshots?\b|screen ?capture|screen recording/i],
  ['tests', /\b(run|running)\b.*\btests?\b|npm test|node --test|pytest|cargo test/i],
  ['review', /\b(review|comment)\b/i],
  ['edit', /\b(edit|change|commit|modify)\b.*\b(my|own|this|the task'?s?)\b.*\b(branch|worktree|files?)\b/i],
  ['read', /\b(read|open|look at|inspect)\b.*\b(files?|code|project|repo)\b/i],
];
export function classifyAsk(ask) {
  const kind = CATEGORIES[ask?.kind] ? ask.kind : 'other';
  if (kind !== 'other') return kind;
  const text = `${ask?.what || ''} ${ask?.why || ''}`;
  if (MAJOR_WORDS.test(ask?.what || '')) return 'other';
  for (const [k, re] of ROUTINE_WORDS) if (re.test(text)) return k;
  return 'other';
}

// Split an AI's ASK lines: routine ones never become an approval card (they are only
// recorded in the Audit log); the rest are cards.
export function splitAsks(asks = [], levels = current) {
  const cards = [];
  const routine = [];
  for (const a of asks) {
    const kind = classifyAsk(a);
    if (levelOf(kind, levels) === 'routine') routine.push({ ...a, kind });
    else cards.push({ ...a, kind });
  }
  return { cards, routine };
}

// What the lead (switch on) may answer: major categories except secrets, boot and
// "other"; pushes only to hearth/ or release/ branches, with no main, tags or force.
export const LEAD_NEVER = ['secrets', 'boot', 'other'];
export const VERSION_RE = /^\d{1,4}\.\d{1,4}(\.\d{1,6})?$/;
// The owner's lead switches (off by default) and the owner-set Next version. Set from
// Settings and the Project page only; no AI line, card or lead action changes them.
let powers = { merge: false, release: false, tag: false, nextVersion: '' };
export function setLeadPowers(p = {}) {
  powers = { merge: p.merge === true, release: p.release === true, tag: p.tag === true, nextVersion: typeof p.nextVersion === 'string' && VERSION_RE.test(p.nextVersion) ? p.nextVersion : '' };
  return powers;
}
export const getLeadPowers = () => powers;
// RELEASE: v<x> / TAG: v<x> from the lead: only with the switch on and only the owner's Next version.
export function leadVersionCheck(kind, version, p = powers) {
  const v = String(version || '').replace(/^v/, '');
  if (kind === 'release' && !p.release) return { ok: false, reason: 'publishing releases is the Owner\'s unless "Lead may publish releases" is on' };
  if (kind === 'tag' && !p.tag) return { ok: false, reason: 'creating tags is the Owner\'s unless "Lead may create tags" is on' };
  if (!p.nextVersion) return { ok: false, reason: 'the Owner has not set a Next version' };
  if (!VERSION_RE.test(v) || v !== p.nextVersion) return { ok: false, reason: `only v${p.nextVersion} (the Owner's Next version) is allowed, not ${version}` };
  return { ok: true, version: v };
}
const BRANCHES = /(?<![\w:/.-])[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]*[A-Za-z0-9_-]/g;
export function pushTargetsOk(what) {
  const text = String(what || '');
  if (DANGEROUS_PUSH.test(text)) return { ok: false, reason: 'pushes that touch main, tags or force stay with the Owner' };
  const refs = (text.match(BRANCHES) || []).filter((b) => !/^(origin|upstream)\//.test(b) || /^(origin|upstream)\/(hearth|release)\//.test(b)).map((b) => b.replace(/^(origin|upstream)\//, ''));
  if (!refs.length) return { ok: false, reason: 'the branch is unclear; only pushes to hearth/ or release/ branches can be answered by the lead' };
  const bad = refs.find((b) => !/^(hearth|release)\/[A-Za-z0-9._/-]+$/.test(b));
  if (bad) return { ok: false, reason: `${bad} is not a hearth/ or release/ branch` };
  return { ok: true, branches: refs };
}
export function leadMayApprove(request, levels = current) {
  if (!request) return { ok: false, reason: 'no request' };
  const kind = CATEGORIES[request.kind] ? request.kind : 'other';
  const lv = levelOf(kind, levels);
  if (kind === 'merge' && powers.merge) return { ok: true, note: 'merge to main through the approved-commit path' };
  if (lv === 'owner' || LEAD_NEVER.includes(kind)) return { ok: false, reason: `${kind} requests stay with the Owner` };
  if (kind === 'push') return pushTargetsOk(request.what);
  if (DANGEROUS_PUSH.test(String(request.what || '')) && /\bpush\b/i.test(String(request.what || ''))) return { ok: false, reason: `${kind} requests that push to main, tags or with force stay with the Owner` };
  return { ok: true };
}

// What every AI is told, so it stops asking for routine things.
export function policyText(levels = current, { leadActions = false } = {}) {
  const l = cleanLevels(levels);
  const of = (lv) => Object.keys(CATEGORIES).filter((k) => k !== 'other' && l[k] === lv).map((k) => CATEGORIES[k].label.replace(/ \(.*\)$/, ''));
  const asks = Object.keys(CATEGORIES).filter((k) => l[k] !== 'routine').join('|');
  return [
    'APPROVAL LEVELS (set by the Owner):',
    `- ROUTINE, just do it, never ask (it is recorded in the Audit log): ${of('routine').join('; ')}.`,
    `- MAJOR, ask first and stop until answered: ${of('major').join('; ')}. Write one line: ASK: <${asks}> | <exactly what you want to do> | <why>`,
    `- OWNER-ONLY, always the Owner (never do these yourself): ${of('owner').join('; ')}.`,
    leadActions
      ? '- After an ASK line, do NOT do that action in this reply. The Owner or the lead answers (the lead only for major requests it is allowed to answer); you will be told the answer.'
      : '- After an ASK line, do NOT do that action in this reply. The Owner answers Approve / Deny / Ask why; you will be told the answer.',
  ].join('\n');
}
