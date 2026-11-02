// Turns Hearth desktop theme tokens (already validated by the main process)
// into CSS custom properties. Pure, unit tested.
const MAP = {
  bg: '--bg', bg2: '--bg-2', panel: '--panel', panel2: '--panel-2', line: '--line',
  text: '--text', muted: '--muted', faint: '--faint', accent: '--accent', accent2: '--accent-2',
  accentInk: '--accent-ink', good: '--good', warn: '--warn', bad: '--bad',
};
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\)|hsla?\(\s*[\d.\s,%deg]+\))$/i;

export function tokensToCss(tokens = {}) {
  const decl = [];
  for (const [k, v] of Object.entries(MAP)) if (typeof tokens[k] === 'string' && COLOR.test(tokens[k])) decl.push(`${v}: ${tokens[k]};`);
  if (typeof tokens.text === 'string' && COLOR.test(tokens.text)) decl.push(`--strong: ${tokens.text};`);
  if (typeof tokens.accent === 'string' && COLOR.test(tokens.accent)) decl.push(`--accent-soft: color-mix(in srgb, ${tokens.accent} 15%, transparent);`);
  if (Number.isFinite(tokens.r) && tokens.r >= 0 && tokens.r <= 24) decl.push(`--r: ${tokens.r}px;`);
  if (Array.isArray(tokens.font) && tokens.font.length) {
    const fams = tokens.font.filter((f) => /^[A-Za-z0-9 _-]{1,60}$/.test(f)).map((f) => `"${f}"`);
    if (fams.length) decl.push(`--font: ${fams.join(', ')}, 'Inter', system-ui, sans-serif;`);
  }
  return decl.length ? `:root:root { ${decl.join(' ')} }` : '';
}

// Which palette to show. mode: 'hearth' (follow the desktop) | 'dark' | 'light' | 'system'.
export function pickMode(mode, { found = false, tokens = {}, systemDark = true } = {}) {
  if (mode === 'dark' || mode === 'light') return mode;
  if (mode === 'system') return systemDark ? 'dark' : 'light';
  if (found && (tokens.mode === 'light' || tokens.mode === 'dark')) return tokens.mode;
  return 'dark';
}
