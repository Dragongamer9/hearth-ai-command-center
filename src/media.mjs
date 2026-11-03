// Images and videos in team chat (pure helpers, unit tested).
export const MEDIA_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mov'];
const extOk = (p) => MEDIA_EXT.includes(String(p).split('.').pop().toLowerCase());

// An AI posts a file with "ATTACH: <path>" or Markdown "![caption](path)" (paths
// relative to its workspace). Returns the files and the text without ATTACH lines.
export function parseAttachLines(text) {
  const files = [];
  const kept = [];
  for (const raw of String(text || '').split('\n')) {
    const m = raw.trim().replace(/^[*`>-]+\s*/, '').match(/^ATTACH\s*:\s*(.+?)\s*$/i);
    if (m && extOk(m[1].replace(/[`*]/g, ''))) { files.push({ path: m[1].replace(/[`*]/g, '').trim(), caption: '' }); continue; }
    kept.push(raw);
  }
  for (const m of String(text || '').matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:\/\//i.test(m[2]) || !extOk(m[2])) continue;
    if (!files.some((f) => f.path === m[2])) files.push({ path: m[2], caption: m[1] });
  }
  return { files: files.slice(0, 6), text: kept.join('\n').trim() };
}

// Visual facts about an attachment (format, dimensions, aspect ratio, size, colour depth;
// duration and resolution for video), so AIs can fact-check visuals without opening them.
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export function aspect(w, h) {
  if (!(w > 0 && h > 0)) return '';
  const g = gcd(w, h);
  const [x, y] = [w / g, h / g];
  return x <= 32 && y <= 32 ? `${x}:${y}` : `${(w / h).toFixed(2)}:1`;
}
const bytes = (n) => (!(n >= 0) ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export function describeMedia(a = {}) {
  const ext = String(a.name || a.path || '').split('.').pop().toUpperCase();
  const fmt = a.format || (ext === 'JPEG' ? 'JPG' : ext) || '?';
  const dims = a.width && a.height ? `${a.width}×${a.height} (${aspect(a.width, a.height)})` : 'dimensions unknown';
  const parts = a.kind === 'video'
    ? [`${fmt} video`, a.duration ? `${Number(a.duration).toFixed(1)} s` : 'duration unknown', dims]
    : [fmt, dims];
  if (a.size) parts.push(bytes(a.size));
  if (a.depth) parts.push(`${a.depth}-bit${a.color ? ` ${a.color}` : ''}`);
  return parts.join(' · ');
}

// One line describing an attachment, for the AIs' prompts.
export function attachmentLine(who, a) {
  if (a.kind === 'video') {
    return `${who} attached a video: ${a.name} [${describeMedia(a)}]${a.frames?.length ? ` (${a.frames.length} still frames attached as images)` : ` (${a.note || 'frames unavailable'})`}`;
  }
  return `${who} attached an image: ${a.name} [${describeMedia(a)}]`;
}

// What an AI receives on its turn: every attachment posted by someone else since its
// own last message (owner's and other AIs' alike). Images, plus video frames.
export function mediaFor(agent, messages = [], names = {}) {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].who === agent && !messages[i].auto) { start = i + 1; break; }
  const images = [];
  const lines = [];
  for (const m of messages.slice(start)) {
    if (m.who === agent || m.deleted || !m.attachments?.length) continue;
    const who = m.who === 'owner' ? 'The Owner' : names[m.who] || m.who;
    for (const a of m.attachments) {
      lines.push(attachmentLine(who, a));
      if (a.kind === 'image' && a.path) images.push(a.path);
      if (a.kind === 'video') images.push(...(a.frames || []));
    }
  }
  return { images: images.slice(-8), note: lines.length ? `\n\nAttachments in the chat since your last turn:\n${lines.map((l) => `- ${l}`).join('\n')}` : '' };
}

export const ATTACH_RULE = '- To post an image or video you made or found in the workspace (a screenshot, chart, generated image or screen recording), write a line: ATTACH: <path relative to your workspace> (png, jpg, webp, gif, mp4, webm, mov; up to 200 MB; only files inside the project workspace). When you report UI work, attach a screenshot of it.';
