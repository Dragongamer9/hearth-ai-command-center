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

// May the lead (switch on) allow this request? Never owner-only ones, boot-critical
// ones, or pushes that are really a merge/release (main, tags, force).
export function leadMayApprove(request, levels = current) {
  if (!request) return { ok: false, reason: 'no request' };
  const kind = CATEGORIES[request.kind] ? request.kind : 'other';
  if (levelOf(kind, levels) === 'owner') return { ok: false, reason: `${kind} requests stay with the Owner` };
  if (CATEGORIES[kind].ownerAnswers) return { ok: false, reason: `${kind} requests stay with the Owner` };
  if (DANGEROUS_PUSH.test(String(request.what || ''))) return { ok: false, reason: `${kind} requests that touch main, tags or force-pushes stay with the Owner` };
  return { ok: true };
}

// What every AI is told, so it stops asking for routine things.
export function policyText(levels = current) {
  const l = cleanLevels(levels);
  const of = (lv) => Object.keys(CATEGORIES).filter((k) => k !== 'other' && l[k] === lv).map((k) => CATEGORIES[k].label.replace(/ \(.*\)$/, ''));
  const asks = Object.keys(CATEGORIES).filter((k) => l[k] !== 'routine').join('|');
  return [
    'APPROVAL LEVELS (set by the Owner):',
    `- ROUTINE, just do it, never ask (it is recorded in the Audit log): ${of('routine').join('; ')}.`,
    `- MAJOR, ask first and stop until answered: ${of('major').join('; ')}. Write one line: ASK: <${asks}> | <exactly what you want to do> | <why>`,
    `- OWNER-ONLY, always the Owner (never do these yourself): ${of('owner').join('; ')}.`,
    '- After an ASK line, do NOT do that action in this reply. You will be told the answer.',
  ].join('\n');
}
