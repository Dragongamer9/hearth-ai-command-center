// Local policy & scope check run when a task is created (step 2 of the flow).
// Pure function so it can be unit tested.
export const HEARTH_OS_PIN = '0.6.55';

const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/,
  /sk-(proj-)?[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export function policyCheck(task) {
  const text = `${task.title || ''}\n${task.description || ''}`;
  const block = [];
  const warn = [];

  if (SECRET_PATTERNS.some((re) => re.test(text))) {
    block.push('Looks like it contains an API key or secret. Remove it — keys belong in Agents → API key, never in tasks.');
  }

  const versions = text.match(/\b0\.6\.\d+\b/g) || [];
  const otherVersion = versions.find((v) => v !== HEARTH_OS_PIN);
  if (otherVersion || /\b(bump|change|set|raise)\b[^.\n]{0,40}\bversion\b/i.test(text)) {
    block.push(`Hearth OS is pinned to ${HEARTH_OS_PIN}. Only the owner picks version numbers — ask before any version change.`);
  }

  if (task.assignee && task.reviewer && task.assignee === task.reviewer) {
    block.push('Independent review required: reviewer must be a different agent than the implementer.');
  }

  if (/\b(boot|bootloader|grub|systemd-boot|initramfs|peppermint|boot ?menu)\b/i.test(text)) {
    warn.push('Boot-critical: keep the previous version startable and test on a spare device first.');
  }

  if (['merge', 'release', 'deploy'].includes(task.action)) {
    warn.push(`High-impact action (${task.action}). Requires explicit owner approval; this app never executes it automatically.`);
  }

  if (/\b(delete|drop|force[- ]push|rm -rf|wipe)\b/i.test(text)) {
    warn.push('Destructive operation mentioned. Confirm backups before approving.');
  }

  return { ok: block.length === 0, block, warn };
}
