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
