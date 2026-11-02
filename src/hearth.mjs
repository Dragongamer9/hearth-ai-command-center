// What the AIs are told about Hearth OS 1.0, and the owner's red-flag rules.
// Pure data (unit tested through policy/chat/team). No version pin: the app
// never changes Hearth OS versions; it only reminds everyone who picks them.
export const HEARTH_OS = {
  name: 'Hearth OS',
  line: '1.x',
  base: 'Debian',
  desktop: 'Mantel (the only desktop; Steam-style look by default, the warm Hearth look stays as an option)',
  gameMode: 'Steam Game Mode (Hearth\'s own Game Mode is archived; if Steam Game Mode can\'t start, it falls back to Mantel)',
  plugins: 'Decky Loader is installed automatically; Hearth plugins: Hearth Sync (syncs non-Steam games into Steam\'s library), Hearth Link, Hearth Music (game theme songs)',
  versioning: 'MAJOR.MINOR with a date (e.g. "1.1 — 2026-11-14"): the first number is a major release, the second counts small updates and fixes. The owner chooses every number.',
  scope: 'This Command Center is a standalone tool for working on the Hearth OS project (its own repo). It is NOT part of Hearth OS: never add it to the Hearth OS image, repo, installer or app store.',
};

export const RED_FLAGS = [
  'The owner picks every Hearth OS version number. Never choose, bump or apply a version number yourself; ask the owner for it.',
  'An update must never leave a device unable to start. Treat anything touching booting (GRUB, boot menu, initramfs, kernel, image/rollback, Steam Game Mode session start) with extreme care and keep the previous version startable.',
  'All Hearth OS settings must be remembered and must never change by themselves.',
  'Commits are authored and committed only as Dragongamer9, with no AI attribution: no Co-authored-by lines, no "Generated with" footers, no AI names as authors.',
];

export function hearthFacts() {
  return [
    `HEARTH OS ${HEARTH_OS.line} FACTS: ${HEARTH_OS.base}-only base; desktop ${HEARTH_OS.desktop}; ${HEARTH_OS.gameMode}; ${HEARTH_OS.plugins}. Versions: ${HEARTH_OS.versioning}`,
    HEARTH_OS.scope,
    'OWNER\'S RED-FLAG RULES (never break these):',
    ...RED_FLAGS.map((r) => `- ${r}`),
  ].join('\n');
}
