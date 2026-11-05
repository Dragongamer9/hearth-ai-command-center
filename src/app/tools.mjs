// App lines an AI can write in its reply (pure, unit tested). The app does the work and the
// lines are taken out of the text the owner reads. Nothing here can merge, push, release,
// tag, change settings or pick a version number: those stay with the owner.
//   MAKE IMAGE: <description>            a picture by an image-capable teammate
//   MAKE IMAGE @Venice: <description>    … by that teammate
//   EDIT IMAGE: <instruction>            edit the newest picture in this chat
//   MAKE VIDEO: <description>            a short video (only with the owner's own key)
//   SCREENSHOT: https://…                a picture of a web page (headless browser)
//   REMEMBER: <fact>                     a memory suggestion: saved only after the owner's yes
//   SEARCH CHATS: <words>                look through the owner's other chats (read-only)
//   READ CHAT: <title>                   read one other chat (read-only)
//   HELPER @Name: <side task>            a teammate works on it in parallel and reports back
//   FOLLOW-UPS: one | two | three        suggestion chips under the answer
import { aliasOf } from '../registry.mjs';

const RX = {
  image: /^MAKE\s+(?:AN?\s+)?(IMAGE|PICTURE)(?:\s+@([A-Za-z][\w-]{1,20}))?\s*:\s*(.+)$/i,
  edit: /^EDIT\s+(?:THE\s+)?(?:IMAGE|PICTURE)(?:\s+@([A-Za-z][\w-]{1,20}))?\s*:\s*(.+)$/i,
  video: /^MAKE\s+(?:A\s+)?VIDEO(?:\s+@([A-Za-z][\w-]{1,20}))?\s*:\s*(.+)$/i,
  shot: /^SCREENSHOT\s*:\s*(https?:\/\/\S+)\s*$/i,
  remember: /^REMEMBER\s*:\s*(.+)$/i,
  search: /^SEARCH\s+(?:PAST\s+)?CHATS\s*:\s*(.+)$/i,
  read: /^READ\s+CHAT\s*:\s*(.+)$/i,
  helper: /^HELPER(?:\s+@([A-Za-z][\w-]{1,20}))?\s*:\s*(.+)$/i,
  follow: /^FOLLOW[- ]?UPS?\s*:\s*(.+)$/i,
};
export const LIMITS = { image: 3, edit: 2, video: 1, shot: 3, remember: 3, search: 2, read: 2, helper: 3 };

const clean = (l) => l.replace(/^\s*[-*>]\s+/, '').replace(/[*`_]/g, '').trim();

export function parseTools(text, { agent = null } = {}) {
  const tools = [];
  const kept = [];
  let follow = [];
  const count = {};
  const room = (k) => { count[k] = (count[k] || 0) + 1; return count[k] <= LIMITS[k]; };
  let fence = false;
  for (const raw of String(text || '').split('\n')) {
    if (/^\s*```/.test(raw)) fence = !fence;
    if (fence) { kept.push(raw); continue; }
    const l = clean(raw);
    let m;
    if ((m = l.match(RX.image))) { if (room('image')) tools.push({ kind: 'image', to: m[2] ? aliasOf(m[2]) || m[2].toLowerCase() : null, prompt: m[3].trim().slice(0, 2000), by: agent }); continue; }
    if ((m = l.match(RX.edit))) { if (room('edit')) tools.push({ kind: 'edit', to: m[1] ? aliasOf(m[1]) || m[1].toLowerCase() : null, prompt: m[2].trim().slice(0, 2000), by: agent }); continue; }
    if ((m = l.match(RX.video))) { if (room('video')) tools.push({ kind: 'video', to: m[1] ? aliasOf(m[1]) || m[1].toLowerCase() : null, prompt: m[2].trim().slice(0, 2000), by: agent }); continue; }
    if ((m = l.match(RX.shot))) { if (room('shot')) tools.push({ kind: 'shot', url: m[1].replace(/[).,]+$/, ''), by: agent }); continue; }
    if ((m = l.match(RX.remember))) { if (room('remember')) tools.push({ kind: 'remember', text: m[1].trim().slice(0, 500), by: agent }); continue; }
    if ((m = l.match(RX.search))) { if (room('search')) tools.push({ kind: 'search', query: m[1].trim().slice(0, 200), by: agent }); continue; }
    if ((m = l.match(RX.read))) { if (room('read')) tools.push({ kind: 'read', chat: m[1].trim().replace(/^["“]|["”]$/g, '').slice(0, 120), by: agent }); continue; }
    if ((m = l.match(RX.helper))) { if (room('helper')) tools.push({ kind: 'helper', to: m[1] ? aliasOf(m[1]) || m[1].toLowerCase() : null, task: m[2].trim().slice(0, 3000), by: agent }); continue; }
    if ((m = l.match(RX.follow))) { follow = m[1].split('|').map((x) => x.trim().replace(/^["“]|["”]$/g, '')).filter((x) => x.length > 1).slice(0, 4).map((x) => x.slice(0, 120)); continue; }
    kept.push(raw);
  }
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), tools, followUps: follow };
}

// Who makes a picture: the named teammate if it can, else the first image-capable one that
// is set up (a key saved), in the owner's team order.
export function pickMaker(want, { capable = [], ready = () => false } = {}) {
  if (want && capable.includes(want) && ready(want)) return want;
  if (want && capable.includes(want)) return null;
  return capable.find((a) => ready(a)) || null;
}

// What the AIs are told about the app lines (in every full brief).
export function toolsBrief({ role = 'member', memory = true, images = [], video = [], screenshots = false } = {}) {
  const l = ['', 'APP LINES (write each on its own line; the app does it and removes the line):'];
  l.push(images.length ? `- MAKE IMAGE: <what it shows>  (made by ${images.join(', ')}; add @Name to pick one). EDIT IMAGE: <change> edits the newest picture in this chat.` : '- Pictures: no image maker is set up (the owner adds a key in Settings › Accounts); say so if asked.');
  if (video.length) l.push(`- MAKE VIDEO: <what happens>  (made by ${video.join(', ')} with the owner's own key; slow and billed to him: only when he asks for a video).`);
  if (screenshots) l.push('- SCREENSHOT: https://… takes a picture of a web page.');
  l.push('- Files you make for the owner (reports, CSVs, charts, pictures): save them in .hearth-out/ (or .hearth-media/ for pictures and videos) in your folder; they show in the chat with Open and Save buttons. Simple charts: a ```chart block with JSON {"type":"bar|line|pie","title":"…","labels":[…],"series":[{"name":"…","data":[…]}]}. Diagrams: a ```mermaid block. Math: $…$ or $$…$$.');
  if (memory) l.push('- REMEMBER: <fact>  suggests a memory for all chats; it is saved only if the owner says yes.');
  l.push('- SEARCH CHATS: <words> or READ CHAT: <title> lets you look at the owner\'s other chats (read-only); you get the result right after.');
  if (role === 'lead') l.push('- HELPER @Name: <side task> hands a side task to a teammate who works in parallel (read-only) and reports back to you.');
  l.push('- End a normal answer with FOLLOW-UPS: <short next question> | <another> | <another> (the owner sees them as buttons).');
  return l.join('\n');
}
