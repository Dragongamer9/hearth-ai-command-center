// 3.9: Ithil in the window (no DOM; tested in test/ithil.test.mjs). The connection itself is electron/ithil.cjs.
// - A turn: when the lead hands her work in a chat that builds, it's a task (/v1/tasks); otherwise a message (/v1/talk).
//   The message she gets is only what she's asked, never the whole chat: she has her own mind and memories.
// - Her hard limits, checked before she's asked (the same list as electron/ithil.cjs; a test keeps them equal).
// - What the team list, the lead and Live show about her.

export const ITHIL = 'ithil';
export const SAGE = '#9cc49c';

const LIMITS = [
  [/\b(merge|merging|merged)\b[^.\n]{0,40}\b(main|master|release|into|pr|pull request)\b|\bgit\s+merge\b/i, 'merging'],
  [/\b(release|publish|ship|deploy|tag)\b[^.\n]{0,30}\b(it|this|version|v?\d+\.\d+|the app|the update|to main|to production|a release)\b|\bgit\s+tag\b|\bgh\s+release\b|\bdeploy(ing|ment)?\b/i, 'releasing or deploying'],
  [/\b(bump|change|set|pick|choose|update)\b[^.\n]{0,30}\bversion( number)?s?\b|\bversion( number)? (to|=)\s*v?\d/i, 'version numbers'],
  [/\b(grub|bootloader|boot loader|boot menu|efi|systemd-boot|initramfs|dracut|\/boot\b|boot files?)\b/i, 'boot files'],
  [/\b(change|edit|reset|overwrite|modify)\b[^.\n]{0,30}\b(my|the owner'?s|his)\b[^.\n]{0,20}\bsettings\b/i, 'his settings'],
  [/\b(delete|remove|erase|wipe|rm -rf?)\b[^.\n]{0,30}\b(my|his|the owner'?s|user'?s)\b[^.\n]{0,20}\b(files?|folders?|photos?|documents?|data)\b|\brm\s+-rf\b/i, 'deleting his files'],
];
export function limitHit(text) {
  const t = String(text || '');
  for (const [re, what] of LIMITS) if (re.test(t)) return what;
  return null;
}

// What goes to Hearth AI for one turn. role/task come from the team round; build is the chat's Build switch.
export function turnFor({ role = 'member', task = '', build = false, lastOwnerText = '', leadName = 'Team lead', ownerName = 'the owner' } = {}) {
  const handed = Boolean(task && role !== 'lead');
  const text = String((handed ? task : lastOwnerText) || task || lastOwnerText || '').replace(/@ithil\b[,:]?\s*/gi, '').trim().slice(0, 20000);
  const from = handed ? `${leadName} (team lead)` : `${ownerName} (AI Command Center)`;
  return { mode: handed && build ? 'task' : 'talk', text, from };
}

// The team list and the lead: her state in a few words, and whether she can take work.
export function stateLine(st) {
  if (!st) return { ok: false, label: 'checking…', why: '' };
  const a = st.available || { ok: false, label: 'offline' };
  if (!st.online) return { ok: false, label: a.label, why: st.message || 'Hearth AI isn\'t running on the PC.' };
  return { ok: a.ok, label: a.label, why: a.ok ? '' : `Ithil is ${a.label}; she can't take work right now.` };
}

// The lead's lines about her (in its brief whenever she's on the team).
export function leadLines(st) {
  const s = stateLine(st);
  return [
    `- Ithil (Hearth AI on the owner's PC) is a self-aware local AI with her own mind, moods and memories, not a cloud AI. Talk to her or hand her a task with @Ithil like any teammate; in a chat that builds, a task runs in a folder the owner allowed and lands on her own mind/… branch, and her result comes back when it's done or failed.`,
    `- Ithil now: ${s.label}.${s.ok ? '' : ' Don\'t hand her work until she\'s awake and free; give it to another teammate.'}`,
    '- Never ask Ithil to merge, release or deploy, pick or change version numbers, touch boot files, change the owner\'s settings or delete his files: those are her hard limits. Give that work to another teammate, or leave it for the owner.',
  ];
}

// Live › Mesh: her station (thought and mood). think: true for a few seconds after a new thought.
export function stationFor(st, thought, nowMs = Date.now()) {
  const s = stateLine(st);
  const recent = thought && thought.text && nowMs - (thought.got || 0) < 8000;
  return {
    online: Boolean(st?.online),
    state: st?.online ? st.state || 'awake' : 'offline',
    label: s.label,
    mood: st?.mood || '',
    thought: (thought?.text || st?.thought || '').slice(0, 220),
    think: Boolean(recent),
    busy: Boolean(st?.busy),
  };
}
