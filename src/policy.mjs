// Local policy & scope check run when a task is created (step 2 of the flow).
// Pure function so it can be unit tested.

const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/,
  /sk-(proj-)?[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /xai-[A-Za-z0-9]{20,}/,
  /pplx-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

// Version numbers mentioned next to a version-ish word (v1.1, version 1.2, Hearth OS 1.1, release 2.0).
const VERSION_RE = /\b(?:v|version\s+|release\s+|hearth\s*os\s+|update\s+)(\d+\.\d+(?:\.\d+)?)\b/gi;
export function mentionedVersions(text) {
  return [...String(text).matchAll(VERSION_RE)].map((m) => m[1]);
}

// source: 'Owner' when the owner typed the task, otherwise the AI that proposed it.
export function policyCheck(task, { source = 'Owner' } = {}) {
  const text = `${task.title || ''}\n${task.description || ''}`;
  const block = [];
  const warn = [];
  const byOwner = source === 'Owner';

  if (SECRET_PATTERNS.some((re) => re.test(text))) {
    block.push('Looks like it contains an API key or secret. Remove it — keys belong in Agents → API key, never in tasks.');
  }

  const versions = mentionedVersions(text);
  const bump = /\b(bump|change|set|raise|increment)\b[^.\n]{0,40}\bversion\b/i.test(text);
  if (byOwner && versions.length) {
    warn.push(`Version number chosen by you: ${[...new Set(versions)].join(', ')}. The AIs use exactly this and never pick another.`);
  } else if (byOwner && bump) {
    block.push('Only the owner picks version numbers — write the exact version you want in the task.');
  } else if (!byOwner && (versions.length || bump)) {
    block.push('Only the owner picks version numbers. An AI proposed a version; ask the owner which number to use.');
  }

  if (task.assignee && task.reviewer && task.assignee !== 'none' && task.assignee === task.reviewer) {
    block.push('Independent review required: reviewer must be a different agent than the implementer.');
  }

  if (/\b(boot|bootloader|grub|systemd-boot|initramfs|kernel|boot ?menu|rollback|bootc|ostree|session start)\b/i.test(text)) {
    warn.push('Boot-critical: an update must never leave a device unable to start. Keep the previous version startable and test on a spare device first.');
  }

  if (/\b(setting|settings|config|preference)s?\b/i.test(text) && /\b(reset|default|migrat|change|overwrite)\w*/i.test(text)) {
    warn.push('Settings: every Hearth OS setting must be remembered and never change by itself.');
  }

  if (['merge', 'release', 'deploy'].includes(task.action)) {
    warn.push(`High-impact action (${task.action}). Runs only after you press Approve in this app${task.action === 'release' ? ', and a release also needs the version typed by you' : ''}.`);
  }

  if (/\b(delete|drop|force[- ]push|rm -rf|wipe)\b/i.test(text)) {
    warn.push('Destructive operation mentioned. Confirm backups before approving.');
  }

  return { ok: block.length === 0, block, warn };
}

const VERSION_NUM = /^\d{1,4}\.\d{1,4}(?:\.\d{1,4})?$/;
// Complete tokens only: 1.2 must not match the 1.2 inside 1.2.0.
const BARE_VERSION = /\bv?(\d+\.\d+(?:\.\d+)?)(?!\.\d)/gi;
export function isVersionBlock(task) {
  return (task?.policy?.block || []).some((b) => /Only the owner picks version numbers/i.test(b));
}
function versionTokens(text) {
  const found = new Set(mentionedVersions(text));
  for (const m of String(text || '').matchAll(BARE_VERSION)) found.add(m[1]);
  return [...found].sort((a, b) => b.length - a.length || b.localeCompare(a));
}
function rewriteVersions(text, version, from) {
  const alts = [...new Set(from)].filter(Boolean).sort((a, b) => b.length - a.length).map((o) => o.replace(/\./g, '\\.'));
  if (!alts.length) return String(text || '');
  const re = new RegExp(`\\b(v?)(${alts.join('|')})(?!\\.\\d)`, 'gi');
  return String(text || '').replace(re, (_, p) => `${p}${version}`);
}
// Owner-only. The dialog in main.js is the only caller, and it always passes
// by: 'Owner'. An AI name, a lead line, or any other by-value is refused.
// policyCheck's AI block text is not edited; the previous block array is left
// as it was and a new check is stored with the owner as the source.
export function confirmOwnerVersion(task, { version, by, at = new Date().toISOString() } = {}) {
  if (!task) return { ok: false, reason: 'no such task' };
  if (by !== 'Owner') return { ok: false, reason: 'Only the owner can confirm a version number' };
  if (!isVersionBlock(task)) return { ok: false, reason: 'This task is not waiting on a version number' };
  const v = String(version || '').trim().replace(/^v/i, '');
  if (!VERSION_NUM.test(v)) return { ok: false, reason: 'Write the exact version you want (MAJOR.MINOR)' };
  const from = versionTokens(`${task.title}\n${task.description}`);
  let title = rewriteVersions(task.title, v, from);
  let description = rewriteVersions(task.description, v, from);
  if (!mentionedVersions(`${title}\n${description}`).length) {
    description = [description, `Version ${v}.`].filter(Boolean).join('\n').trim();
  }
  const policy = policyCheck({ ...task, title, description }, { source: 'Owner' });
  if (isVersionBlock({ policy })) return { ok: false, reason: 'That version did not clear the block' };
  task.title = title;
  task.description = description;
  policy.source = 'Owner';
  task.policy = policy;
  task.policySource = 'Owner';
  task.updatedAt = at;
  task.notes = task.notes || [];
  task.notes.push({ at, who: 'Owner', text: `Confirmed version ${v}.` });
  return { ok: true, version: v, policy };
}
