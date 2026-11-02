// Chat bridge, web side: imports the OFFICIAL data exports of the providers'
// web/desktop chat apps into the app's history. There is no official API to read
// or write a personal claude.ai / chatgpt.com / gemini.google.com chat history, so
// the app never scrapes those sites; you download your export and pick the file.
//
//   ChatGPT   Settings → Data controls → Export data  → zip with conversations.json
//   Claude    Settings → Privacy → Export data         → zip with conversations.json
//   Gemini    Google Takeout → My Activity → Gemini Apps (JSON) → MyActivity.json
//   DeepSeek  Settings → Data → Export data            → zip/JSON
//   Other     any JSON with conversations that contain messages (best effort)
const zlib = require('node:zlib');

const MAX_MSG = 8000;
const clip = (s) => { const t = String(s || '').trim(); return t.length > MAX_MSG ? `${t.slice(0, MAX_MSG)} …[trimmed]` : t; };
const iso = (v) => {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ---- Minimal ZIP reader (stored + deflate; what the exports use) ----
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Damaged zip file.');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (csize === 0xffffffff || off === 0xffffffff) throw new Error('This zip is too large (ZIP64). Extract it and pick the .json file inside.');
    entries.push({
      name,
      size: usize,
      data() {
        if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error('Damaged zip entry.');
        const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
        const raw = buf.slice(start, start + csize);
        if (method === 0) return raw;
        if (method === 8) return zlib.inflateRawSync(raw);
        throw new Error(`Unsupported zip compression (${method}).`);
      },
    });
  }
  return entries;
}

// ---- ChatGPT (and DeepSeek, which uses a similar tree) ----
function nodeText(msg) {
  const c = msg?.content;
  if (!c) return '';
  if (Array.isArray(c.parts)) return c.parts.filter((x) => typeof x === 'string').join('\n');
  if (typeof c.text === 'string') return c.text;
  if (typeof c === 'string') return c;
  if (Array.isArray(msg.fragments)) return msg.fragments.map((f) => f?.content || '').join('\n');
  return '';
}

function walkMapping(conv) {
  const map = conv.mapping || {};
  let chain = [];
  let id = conv.current_node;
  const seen = new Set();
  while (id && map[id] && !seen.has(id)) { seen.add(id); chain.unshift(map[id]); id = map[id].parent; }
  if (!chain.length) chain = Object.values(map).sort((a, b) => (a.message?.create_time || 0) - (b.message?.create_time || 0));
  const out = [];
  for (const node of chain) {
    const m = node?.message;
    if (!m) {
      continue;
    }
    if (m.metadata?.is_visually_hidden_from_conversation) continue;
    const role = m.author?.role || m.role;
    if (role !== 'user' && role !== 'assistant') {
      // DeepSeek-style fragments carry REQUEST/RESPONSE instead of roles.
      if (Array.isArray(m.fragments)) {
        for (const f of m.fragments) {
          const r = f?.type === 'REQUEST' ? 'user' : f?.type === 'RESPONSE' ? 'assistant' : null;
          if (r && f.content) out.push({ role: r, text: clip(f.content), at: iso(m.inserted_at || m.create_time) });
        }
      }
      continue;
    }
    const text = nodeText(m);
    if (text.trim()) out.push({ role, text: clip(text), at: iso(m.create_time) });
  }
  return out;
}

function parseChatGPT(data, provider = 'openai') {
  if (!Array.isArray(data)) throw new Error('conversations.json should be a list of conversations.');
  return data.filter((c) => c && c.mapping).map((c) => {
    const id = String(c.conversation_id || c.id || '');
    return {
      provider,
      sessionId: id,
      title: c.title || null,
      startedAt: iso(c.create_time || c.inserted_at),
      updatedAt: iso(c.update_time || c.updated_at),
      messages: walkMapping(c),
      openUrl: provider === 'openai' && /^[A-Za-z0-9-]{8,64}$/.test(id) ? `https://chatgpt.com/c/${id}` : provider === 'deepseek' && /^[A-Za-z0-9-]{8,64}$/.test(id) ? `https://chat.deepseek.com/a/chat/s/${id}` : null,
    };
  }).filter((c) => c.messages.length);
}

// ---- Claude (claude.ai data export) ----
function parseClaude(data) {
  if (!Array.isArray(data)) throw new Error('conversations.json should be a list of conversations.');
  return data.filter((c) => c && Array.isArray(c.chat_messages)).map((c) => {
    const id = String(c.uuid || c.id || '');
    return {
      provider: 'anthropic',
      sessionId: id,
      title: c.name || null,
      startedAt: iso(c.created_at),
      updatedAt: iso(c.updated_at),
      messages: c.chat_messages.map((m) => {
        const text = typeof m.text === 'string' && m.text ? m.text : (Array.isArray(m.content) ? m.content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '');
        return { role: m.sender === 'human' ? 'user' : 'assistant', text: clip(text), at: iso(m.created_at) };
      }).filter((m) => m.text),
      openUrl: /^[0-9a-f-]{36}$/i.test(id) ? `https://claude.ai/chat/${id}` : null,
    };
  }).filter((c) => c.messages.length);
}

// ---- Gemini (Google Takeout → My Activity → Gemini Apps, JSON format) ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m))
    .replace(/\n{3,}/g, '\n\n').trim();
}

function parseGeminiTakeout(data, { gapMinutes = 30 } = {}) {
  if (!Array.isArray(data)) throw new Error('MyActivity.json should be a list of activity items.');
  const items = data
    .filter((x) => x && /gemini|bard/i.test(`${x.header || ''} ${(x.products || []).join(' ')}`) && typeof x.title === 'string')
    .map((x) => ({
      at: iso(x.time),
      prompt: x.title.replace(/^(Prompted|Asked|Searched for)\s+/i, ''),
      reply: htmlToText((x.safeHtmlItem || []).map((h) => h?.html || '').join('\n')),
    }))
    .filter((x) => x.at && x.prompt)
    .sort((a, b) => a.at.localeCompare(b.at));
  // Takeout has no conversation ids; turns close together become one conversation.
  const convs = [];
  let cur = null;
  for (const it of items) {
    if (!cur || Date.parse(it.at) - Date.parse(cur.updatedAt) > gapMinutes * 60000) {
      cur = { provider: 'google', sessionId: `takeout-${it.at}`, title: null, startedAt: it.at, updatedAt: it.at, messages: [], openUrl: 'https://gemini.google.com/app' };
      convs.push(cur);
    }
    cur.messages.push({ role: 'user', text: clip(it.prompt), at: it.at });
    if (it.reply) cur.messages.push({ role: 'assistant', text: clip(it.reply), at: it.at });
    cur.updatedAt = it.at;
  }
  return convs;
}

// ---- Anything with conversations → messages (best effort) ----
function parseGeneric(data, provider = 'other') {
  const list = Array.isArray(data) ? data : Array.isArray(data?.conversations) ? data.conversations : [data];
  return list.map((c, i) => {
    const msgs = Array.isArray(c?.messages) ? c.messages : [];
    return {
      provider,
      sessionId: String(c?.id || c?.uuid || c?.conversation_id || `item-${i}`),
      title: c?.title || c?.name || null,
      startedAt: iso(c?.create_time || c?.created_at),
      updatedAt: iso(c?.update_time || c?.updated_at),
      messages: msgs.map((m) => ({ role: /user|human/i.test(m?.role || m?.sender || m?.author || '') ? 'user' : 'assistant', text: clip(typeof m?.content === 'string' ? m.content : m?.text || ''), at: iso(m?.create_time || m?.created_at || m?.timestamp) })).filter((m) => m.text),
    };
  }).filter((c) => c.messages.length);
}

// What kind of export this JSON is.
function detect(data, name = '') {
  if (/myactivity/i.test(name) || (Array.isArray(data) && data[0]?.header && data[0]?.title)) return 'gemini';
  if (Array.isArray(data) && data.some((c) => c?.chat_messages)) return 'claude';
  if (Array.isArray(data) && data.some((c) => c?.mapping)) return data.some((c) => c?.inserted_at || Object.values(c.mapping || {}).some((n) => n?.message?.fragments)) ? 'deepseek' : 'chatgpt';
  return 'generic';
}

function parseExport(data, { name = '', kind = 'auto' } = {}) {
  const k = kind === 'auto' ? detect(data, name) : kind;
  const convs = {
    chatgpt: () => parseChatGPT(data, 'openai'),
    deepseek: () => (Array.isArray(data) && data.some((c) => c?.mapping) ? parseChatGPT(data, 'deepseek') : parseGeneric(data, 'deepseek')),
    claude: () => parseClaude(data),
    gemini: () => parseGeminiTakeout(data),
    generic: () => parseGeneric(data),
  }[k]?.() || [];
  for (const c of convs) {
    const firstUser = c.messages.find((m) => m.role === 'user');
    c.title = String(c.title || firstUser?.text || 'Untitled').replace(/\s+/g, ' ').slice(0, 120);
    c.startedAt = c.startedAt || c.messages[0]?.at || null;
    c.updatedAt = c.updatedAt || c.messages[c.messages.length - 1]?.at || c.startedAt;
    c.source = `import:${k}`;
    c.resumable = false;
  }
  return { kind: k, conversations: convs };
}

// A picked file (zip or json) → conversations. Looks for the known file names inside zips.
function importFile(buf, { name = '', kind = 'auto' } = {}) {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
    const entries = readZip(buf);
    const pick = entries.find((e) => /(^|\/)conversations\.json$/i.test(e.name))
      || entries.find((e) => /(^|\/)MyActivity\.json$/i.test(e.name) && /gemini|bard/i.test(e.name))
      || entries.find((e) => /(^|\/)MyActivity\.json$/i.test(e.name))
      || entries.find((e) => /\.json$/i.test(e.name) && e.size > 2);
    if (!pick) throw new Error('No conversations file found in this zip (looked for conversations.json or MyActivity.json).');
    if (pick.size > 300 * 1024 * 1024) throw new Error('That export is too large to import at once.');
    return parseExport(JSON.parse(pick.data().toString('utf8')), { name: pick.name, kind });
  }
  let data;
  try { data = JSON.parse(buf.toString('utf8')); } catch {
    if (/<html/i.test(buf.slice(0, 2000).toString('utf8'))) throw new Error('This is the HTML version of the export. In Google Takeout choose JSON as the format for My Activity, then import MyActivity.json.');
    throw new Error('Not a JSON or zip export.');
  }
  return parseExport(data, { name, kind });
}

module.exports = { readZip, importFile, parseExport, parseChatGPT, parseClaude, parseGeminiTakeout, parseGeneric, detect, htmlToText };
