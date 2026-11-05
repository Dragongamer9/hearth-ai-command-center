// Everything the AIs' own apps can do, wired into the chats (registered from main.cjs):
// memory across chats, scheduled tasks, connectors (MCP), pictures/videos/files in the
// chat (hearth-media: scheme), image and video generation, screenshots, read aloud,
// skills, search past chats, per-chat knowledge, export, temporary chats' media, and the
// Habitat's saved store. Nothing here writes settings; each store writes only on a real
// change (electron/jsonfile.cjs).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const media = require('./media.cjs');
const makers = require('./makers.cjs');
const { createMemory } = require('./memory-store.cjs');
const { createScheduler } = require('./schedule.cjs');
const { createConnectors } = require('./connectors.cjs');
const { createJsonFile } = require('./jsonfile.cjs');
const { createTeammates } = require('./teammates.cjs');
const cardsLib = require('./cards.cjs');

const KEY_NAMES = ['google', 'openai', 'xai', 'mistral'];
const whoName = { owner: 'Owner', system: 'App', anthropic: 'Claude', openai: 'ChatGPT', google: 'Gemini', xai: 'Grok', mistral: 'Mistral', qwen: 'Qwen', perplexity: 'Perplexity', deepseek: 'DeepSeek', ollama: 'Local AI', venice: 'Venice', civitai: 'Civitai', gpu: 'Your GPU server' };
// Teammates whose output never reaches the other AIs (the same rule as src/app/brief.mjs).
const UNFILTERED = ['venice', 'civitai', 'gpu'];
const uid = () => crypto.randomBytes(5).toString('hex');

// A chat as text for an AI that is NOT one of the unfiltered teammates: their messages and
// pictures (and the owner's messages only to them) become short placeholders.
function shieldLine(m) {
  const n = whoName[m.who] || m.who;
  if (UNFILTERED.includes(m.who)) { const pics = (m.media || []).filter((x) => x.kind !== 'file').length; return `${n}: ${pics ? `[${pics > 1 ? `${pics} images` : 'image'} by ${n}]` : `[content from ${n}, not shown]`}`; }
  if (m.who === 'owner' && Array.isArray(m.to) && m.to.length && m.to.every((a) => UNFILTERED.includes(a))) return `Owner: [message to ${m.to.map((a) => whoName[a] || a).join(', ')}, not shown]`;
  return null;
}
function transcriptOf(messages, max = 12000) {
  const out = [];
  let n = 0;
  for (const m of [...(messages || [])].reverse()) {
    if (m.local || m.deleted) continue;
    const t = shieldLine(m) || `${whoName[m.who] || m.who}: ${String(m.text || '').slice(0, 4000)}`;
    if (n + t.length > max && out.length) break;
    out.unshift(t);
    n += t.length;
  }
  return out.join('\n\n');
}

function register(d) {
  const { handle, dataDir, readSettings, chats, secrets, shell, dialog, getWindow, send, protocol, attachments, worktreeRoot, BrowserWindow, v2 } = d;
  const root = media.mediaRoot(dataDir());
  const memory = createMemory(path.join(dataDir(), 'memory.json'));
  const connectors = createConnectors({ file: path.join(dataDir(), 'connectors.json'), secrets });
  const habitat = createJsonFile(path.join(dataDir(), 'habitat.json'), { empty: () => null, check: (j) => typeof j === 'object', label: 'Your Habitat file' });
  const teammates = d.teammates || createTeammates({ secrets, file: path.join(dataDir(), 'servers.json'), settings: readSettings });
  const entryOf = (id) => v2().entryOf(String(id));
  const attachRoot = () => attachments.attachDir(worktreeRoot());

  // ---- pictures, videos and files in the chat ----
  if (protocol?.handle) {
    protocol.handle(media.SCHEME, (req) => {
      const r = media.respond(req, root);
      return new Response(r.stream ? Readable.toWeb(r.stream()) : r.body, { status: r.status, headers: r.headers });
    });
  }
  const resolveItem = (chatId, file) => media.resolve(media.urlFor(String(chatId), String(file)), root);
  handle('media:open', (chatId, file) => { const r = resolveItem(chatId, file); if (!r.ok) return { ok: false, message: 'Not found.' }; shell.openPath(r.file); return { ok: true }; });
  handle('media:save', async (chatId, file, name) => {
    const r = resolveItem(chatId, file);
    if (!r.ok) return { ok: false, message: 'Not found.' };
    const s = await dialog.showSaveDialog(getWindow(), { title: 'Save', defaultPath: path.join(os.homedir(), 'Downloads', media.safeName(name || file.replace(/^[0-9a-f]{10}-/, ''))) });
    if (s.canceled || !s.filePath) return { ok: false, cancelled: true };
    fs.copyFileSync(r.file, s.filePath);
    return { ok: true, file: s.filePath };
  });
  handle('media:toRepo', async (chatId, file, rel) => {
    const r = resolveItem(chatId, file);
    if (!r.ok) return { ok: false, message: 'Not found.' };
    const e = entryOf(chatId);
    if (!e.repo && !e.repoDir) return { ok: false, message: 'Connect this chat to a repo first.' };
    try { await v2().copyFor(e); } catch (err) { return { ok: false, message: err.message }; }
    return v2().copies.writeFile(e.id, String(rel || ''), fs.readFileSync(r.file));
  });
  // A picture or video an AI linked on the web: fetched only when the owner clicks.
  handle('media:fetchRemote', async (chatId, url) => {
    entryOf(chatId);
    let u;
    try { u = new URL(String(url)); } catch { return { ok: false, message: 'Bad link.' }; }
    if (u.protocol !== 'https:') return { ok: false, message: 'Only https links.' };
    try {
      const res = await fetch(u.href, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
      const type = String(res.headers.get('content-type') || '').split(';')[0];
      if (!res.ok || !/^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm))$/.test(type)) return { ok: false, message: 'That link isn\'t a picture or video.' };
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 25 * 1024 * 1024) return { ok: false, message: 'Too big (over 25 MB).' };
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' }[type];
      return { ok: true, item: media.storeBuffer(root, String(chatId), `${(u.pathname.split('/').pop() || 'web').replace(/\.[^.]*$/, '').slice(0, 40) || 'web'}.${ext}`, buf) };
    } catch { return { ok: false, message: 'Couldn\'t download it.' }; }
  });
  // A file the app makes for the owner (a deep research report, an export of a canvas).
  handle('media:saveText', (chatId, name, text) => { entryOf(chatId); const item = media.storeBuffer(root, String(chatId), media.safeName(name), Buffer.from(String(text || '').slice(0, 5e6), 'utf8')); return item ? { ok: true, item } : { ok: false }; });

  // ---- keys for pictures, videos and OCR (encrypted, like the AI keys) ----
  handle('media:keys', async () => ({ encryption: await secrets.available(), keys: Object.fromEntries(KEY_NAMES.map((k) => [k, secrets.has(k)])), screenshot: Boolean(makers.which(makers.BROWSERS)), tts: makers.ttsTool() ? path.basename(makers.ttsTool()) : null, pdftotext: Boolean(makers.which(['pdftotext'])) }));
  handle('media:setKey', async (name, key) => {
    if (!KEY_NAMES.includes(name)) throw new Error('bad key name');
    const k = String(key || '').trim();
    if (k.length < 10 || k.length > 400 || /\s/.test(k)) throw new Error('That doesn\'t look like an API key.');
    await secrets.set(name, k);
    return { ok: true };
  });
  handle('media:removeKey', (name) => { if (!KEY_NAMES.includes(name)) throw new Error('bad key name'); secrets.remove(name); return { ok: true }; });
  const pickProvider = (want, list) => (list.includes(want) && secrets.has(want) ? want : list.find((p) => secrets.has(p)) || (list.includes(want) ? want : list[0]));
  // A picture made (or edited) by an AI that can, posted into the chat.
  handle('media:image', async (chatId, o = {}) => {
    entryOf(chatId);
    // The unfiltered teammates (Venice, Civitai, the owner's GPU server) make pictures their own way.
    if (teammates.IDS.includes(o.provider)) {
      const r = await teammates.image(o.provider, { prompt: o.prompt });
      if (!r.ok) return { ...r, provider: o.provider };
      const items = r.images.map((im, i) => media.storeBuffer(root, String(chatId), `${o.provider}-${Date.now()}-${i + 1}.${/jpeg/.test(im.mime) ? 'jpg' : /webp/.test(im.mime) ? 'webp' : 'png'}`, im.buf)).filter(Boolean);
      return { ok: true, provider: o.provider, via: r.via, item: items[0], items, notes: r.notes || [] };
    }
    const provider = pickProvider(o.provider, makers.IMAGE_PROVIDERS);
    let image = null;
    if (o.edit) {
      const r = resolveItem(chatId, o.edit);
      if (!r.ok || !/^image\//.test(r.mime)) return { ok: false, error: { message: 'There\'s no picture to edit.' } };
      image = { buf: fs.readFileSync(r.file), mime: r.mime, name: r.name };
    }
    const r = await makers.generateImage({ provider, key: secrets.get(provider), prompt: o.prompt, image });
    if (!r.ok) return { ...r, provider };
    const item = media.storeBuffer(root, String(chatId), `${o.edit ? 'edited' : 'image'}-${Date.now()}.${r.mime.includes('jpeg') ? 'jpg' : 'png'}`, r.buf);
    return { ok: true, provider, via: r.via, item, items: [item].filter(Boolean) };
  });
  const videoJobs = new Map();
  handle('media:video', async (chatId, o = {}) => {
    entryOf(chatId);
    const provider = pickProvider(o.provider, makers.VIDEO_PROVIDERS);
    const ctl = new AbortController();
    videoJobs.set(String(chatId), ctl);
    try {
      const r = await makers.generateVideo({ provider, key: secrets.get(provider), prompt: o.prompt, signal: ctl.signal });
      if (!r.ok) return { ...r, provider };
      return { ok: true, provider, via: r.via, item: media.storeBuffer(root, String(chatId), `video-${Date.now()}.mp4`, r.buf) };
    } finally { videoJobs.delete(String(chatId)); }
  });
  handle('media:cancel', (chatId) => { videoJobs.get(String(chatId))?.abort(); return true; });
  handle('media:screenshot', async (chatId, url) => {
    entryOf(chatId);
    const out = path.join(os.tmpdir(), `hearth-shot-${uid()}.png`);
    const r = await makers.screenshot(url, out);
    if (!r.ok) return r;
    try { const item = media.storeBuffer(root, String(chatId), `screenshot-${new URL(url).hostname}.png`, fs.readFileSync(out)); return { ok: true, item, via: r.via }; } finally { try { fs.unlinkSync(out); } catch {} }
  });

  // A PDF attachment: its text for the AIs (pdftotext, else Mistral OCR with his key).
  async function docText(file) {
    const t = makers.pdfText(file);
    if (t && t.trim()) return { text: t, via: 'pdftotext' };
    const key = secrets.get('mistral');
    if (key) { const r = await makers.mistralOcr({ key, buf: fs.readFileSync(file), mime: 'application/pdf' }); if (r.ok) return { text: r.text, via: r.via }; }
    return { text: '', via: null };
  }

  // ---- read aloud ----
  handle('tts:speak', (text) => makers.speak(String(text || '')));
  handle('tts:stop', () => makers.stopSpeaking());

  // ---- memory across chats ----
  handle('memory:list', () => memory.list());
  handle('memory:add', (text) => memory.add(text, { by: 'owner' }));
  handle('memory:update', (id, text) => memory.update(String(id), text));
  handle('memory:remove', (id) => memory.remove(String(id)));
  handle('memory:propose', (text, agent, chatId) => memory.propose(text, { agent, chatId }));
  // Only from the owner's Yes/No on the card (or in Settings › Memory).
  handle('memory:decide', (id, yes) => memory.decide(String(id), yes === true));
  handle('memory:prompt', () => memory.promptLines());

  // ---- search past chats (read-only) ----
  handle('chats:recall', (q, exclude) => {
    const query = String(q || '').slice(0, 200);
    const hits = chats.search(query).filter((h) => h.id !== exclude).slice(0, 8);
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    return hits.map((h) => {
      const e = chats.entry(h.id);
      const g = chats.get(h.id);
      const snippets = [];
      if (g?.ok) for (const m of g.messages) { if (shieldLine(m)) continue; const t = String(m.text || ''); const lo = t.toLowerCase(); const i = words.map((w) => lo.indexOf(w)).find((x) => x >= 0); if (i >= 0 && i !== undefined) { snippets.push(`${whoName[m.who] || m.who} (${String(m.at || '').slice(0, 10)}): ${t.slice(Math.max(0, i - 120), i + 280).replace(/\s+/g, ' ')}`); if (snippets.length >= 3) break; } }
      return { id: h.id, title: e?.title || h.id, repo: e?.repo || null, updatedAt: e?.updatedAt || null, snippets: snippets.length ? snippets : [h.snippet].filter(Boolean) };
    });
  });
  handle('chats:readOther', (id) => { const e = chats.entry(String(id)); const g = e ? chats.get(String(id)) : null; return g?.ok ? { ok: true, title: e.title, text: transcriptOf(g.messages, 12000) } : { ok: false, message: 'Not found.' }; });

  // ---- per-chat knowledge: instructions and pinned reference files ----
  // Make a chat a roleplay chat (or change its characters, players, order, lorebooks).
  handle('chats:rp', (id, rp) => { const e = chats.entry(String(id)); if (!e) throw new Error('unknown chat'); return chats.update(e.id, { rp: rp || null }); });
  handle('chats:knowledge', (id, k = {}) => {
    const e = chats.entry(String(id));
    if (!e) throw new Error('unknown chat');
    const patch = {};
    if ('instructions' in k) patch.instructions = String(k.instructions || '');
    if ('refs' in k) patch.refs = (Array.isArray(k.refs) ? k.refs : []).filter((r) => r && typeof r.path === 'string' && attachments.inside(r.path, [attachRoot()]));
    return chats.update(e.id, patch);
  });

  // ---- skills ----
  handle('skills:list', (chatId) => {
    const dirs = [{ dir: path.join(os.homedir(), '.claude', 'skills'), where: 'yours (~/.claude/skills)' }];
    try { const e = chatId ? entryOf(chatId) : null; if (e && v2().copies.exists(e.id)) dirs.push({ dir: path.join(v2().copies.dirOf(e.id), '.claude', 'skills'), where: `this repo (${e.repo || 'local'})` }); } catch {}
    return makers.listSkills(dirs);
  });

  // ---- connectors (MCP) ----
  handle('connectors:list', () => ({ list: connectors.list(), broken: connectors.broken() }));
  handle('connectors:add', (spec) => connectors.add(spec || {}));
  handle('connectors:remove', (id) => connectors.remove(String(id)));
  handle('connectors:enable', (id, on) => connectors.setEnabled(String(id), on === true));

  // ---- scheduled tasks (run in the main process; results land in their own chat) ----
  const scheduler = createScheduler({
    file: path.join(dataDir(), 'schedules.json'),
    run: async (t) => {
      const e = chats.entry(t.chatId);
      if (!e) return { ok: false, message: 'Its chat was deleted.' };
      const V = v2();
      if (V.running.has(t.chatId) || V.busyChats.has(t.chatId)) return { retry: true };
      const g = chats.get(t.chatId);
      if (!g?.ok || g.readOnly) return { ok: false, message: 'Its chat could not be read.' };
      const s = readSettings();
      const lead = s.team?.lead || 'anthropic';
      const prompt = [
        `You are ${whoName[lead] || lead}, the lead AI in the owner's chat "${e.title}" in Hearth AI Command Center. This is a SCHEDULED TASK the owner set up in Settings › Scheduled; he isn't watching right now, so report plainly what you did and found.`,
        'Rules: never pick or bump version numbers; never push to main or a tag; never merge, release or tag; commits only as the owner with no AI lines; never claim something was done unless it was.',
        memory.promptLines(3000),
        `THE CHAT SO FAR:\n${transcriptOf(g.messages, 12000)}`,
        `THE SCHEDULED TASK: ${t.prompt}`,
      ].filter(Boolean).join('\n\n');
      const r = await V.runChat({ chatId: t.chatId, agent: lead, prompt, web: s.tools.web, build: false, title: e.title });
      if (!r.ok && ['queue', 'busy'].includes(r.error?.kind)) return { retry: true };
      const g2 = chats.get(t.chatId);
      if (!g2?.ok) return { ok: false, message: 'Its chat could not be read.' };
      const at = new Date().toISOString();
      const added = [
        { id: uid(), who: 'system', text: `Scheduled task “${t.title}” ran.`, at, scheduled: t.id },
        { id: uid(), who: lead, role: 'lead', at, via: r.via, err: !r.ok, scheduled: t.id, text: r.ok ? String(r.text || '(no text)') : `The scheduled task didn't finish: ${r.error?.message || 'something went wrong'}`, ...(r.media?.length ? { media: r.media } : {}) },
      ];
      chats.save(t.chatId, { messages: [...g2.messages, ...added], sessions: g2.sessions || {} });
      send('chat:external', { chatId: t.chatId, title: e.title, scheduled: true, ok: r.ok });
      return { ok: r.ok, message: r.error?.message };
    },
  });
  scheduler.start();
  handle('schedule:list', () => ({ list: scheduler.list(), broken: scheduler.broken() }));
  handle('schedule:add', (spec) => scheduler.add(spec || {}));
  handle('schedule:update', (id, patch) => scheduler.update(String(id), patch || {}));
  handle('schedule:remove', (id) => scheduler.remove(String(id)));

  // ---- export a chat ----
  handle('chat:export', async (chatId, format, payload = {}) => {
    const e = entryOf(chatId);
    const fmt = ['md', 'html', 'pdf'].includes(format) ? format : 'md';
    const base = media.safeName(e.title || 'chat').replace(/\s+/g, '-');
    const s = await dialog.showSaveDialog(getWindow(), { title: 'Export this chat', defaultPath: path.join(os.homedir(), 'Downloads', `${base}.${fmt}`) });
    if (s.canceled || !s.filePath) return { ok: false, cancelled: true };
    const MEDIA_URL = /hearth-media:\/\/c\/[A-Za-z0-9-]+\/[^\s"')<>]+/g;
    if (fmt === 'md') {
      const dir = `${s.filePath.replace(/\.md$/i, '')}_files`;
      const md = String(payload.markdown || '').replace(MEDIA_URL, (u) => {
        const r = media.resolve(u, root);
        if (!r.ok) return u;
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(r.file, path.join(dir, r.name));
        return `${path.basename(dir)}/${encodeURIComponent(r.name)}`;
      });
      fs.writeFileSync(s.filePath, md, { mode: 0o644 });
      return { ok: true, file: s.filePath };
    }
    const html = String(payload.html || '').replace(MEDIA_URL, (u) => media.dataUri(u, root) || '');
    if (fmt === 'html') { fs.writeFileSync(s.filePath, html, { mode: 0o644 }); return { ok: true, file: s.filePath }; }
    // PDF: the same page printed by a hidden window with no scripts and no network.
    const tmp = path.join(os.tmpdir(), `hearth-export-${uid()}.html`);
    fs.writeFileSync(tmp, html, { mode: 0o600 });
    const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    w.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, cb) => cb({ cancel: true }));
    try {
      await w.loadFile(tmp);
      const pdf = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
      fs.writeFileSync(s.filePath, pdf, { mode: 0o644 });
      return { ok: true, file: s.filePath };
    } finally { w.destroy(); try { fs.unlinkSync(tmp); } catch {} }
  });

  // ---- more teammates: Venice, Civitai, the owner's GPU servers ----
  handle('teammates:status', () => teammates.status());
  handle('teammates:setKey', (agent, key) => teammates.setKey(String(agent), key));
  handle('teammates:removeKey', (agent) => teammates.removeKey(String(agent)));
  handle('teammates:addServer', (spec) => teammates.addServer(spec || {}));
  handle('teammates:removeServer', (id) => teammates.removeServer(String(id)));

  // ---- roleplay: character cards, lorebooks, persona (electron/cards.cjs) ----
  const cards = cardsLib.createCards({ dataDir: dataDir() });
  const cardsOf = (ids) => (Array.isArray(ids) ? ids : []).map((id) => cards.get(String(id))).filter(Boolean);
  handle('cards:list', () => ({ list: cards.list(), broken: cards.broken() }));
  handle('cards:import', (name, data) => cards.importFile(String(name || 'card'), Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data || [])));
  handle('cards:pick', async () => {
    const r = await dialog.showOpenDialog(getWindow(), { title: 'Import character cards or lorebooks', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Character cards and lorebooks', extensions: ['png', 'json'] }] });
    if (r.canceled) return [];
    const out = [];
    for (const f of r.filePaths.slice(0, 20)) { try { out.push({ ok: true, ...cards.importFile(path.basename(f), fs.readFileSync(f)) }); } catch (e) { out.push({ ok: false, message: `${path.basename(f)}: ${e.message}` }); } }
    return out;
  });
  handle('cards:save', (card) => cards.save(card || {}));
  // Find characters: card sites in the sandboxed web window; a downloaded card is imported.
  const finder = require('./card-finder.cjs');
  const openSite = BrowserWindow ? finder.createFinder({
    BrowserWindow, shell, iconPath: path.join(__dirname, '..', 'dist', 'icon.png'), send,
    importFile: (name, buf) => cards.importFile(name, buf),
    setPicture: (id, buf) => cards.save({ id, avatarData: `data:${buf[0] === 0x89 ? 'image/png' : buf[0] === 0xff ? 'image/jpeg' : 'image/webp'};base64,${buf.toString('base64')}` }),
  }) : null;
  handle('cards:findSites', () => ({ sites: Object.entries(finder.SITES).map(([id, x]) => ({ id, ...x })), notListed: finder.NOT_LISTED, maxMb: finder.MAX_CARD / 1048576 }));
  handle('cards:findOpen', (id) => (openSite ? openSite(String(id)) : { ok: false, message: 'Not available here.' }));
  handle('cards:remove', (id) => cards.remove(String(id)));
  handle('cards:export', async (id, fmt) => {
    const x = cards.exportCard(String(id), fmt === 'json' ? 'json' : 'png');
    const s2 = await dialog.showSaveDialog(getWindow(), { title: 'Export character card', defaultPath: path.join(os.homedir(), 'Downloads', media.safeName(x.name)) });
    if (s2.canceled || !s2.filePath) return { ok: false, cancelled: true };
    fs.writeFileSync(s2.filePath, x.buf);
    return { ok: true, file: s2.filePath };
  });
  handle('lore:list', () => cards.bookList());
  handle('lore:save', (b) => cards.saveBook(b || {}));
  handle('lore:remove', (id) => cards.removeBook(String(id)));
  handle('lore:import', (name, data) => cards.importBook(String(name || 'lorebook.json'), Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data || [])));
  handle('lore:fromCard', (id) => { const c = cards.get(String(id)); if (!c?.character_book) return { ok: false, message: 'That card has no lorebook.' }; return { ok: true, book: cards.addBook({ ...c.character_book, name: c.character_book.name || `${c.name}'s lorebook` }) }; });
  handle('lore:export', async (id) => {
    const x = cards.exportBook(String(id));
    const s2 = await dialog.showSaveDialog(getWindow(), { title: 'Export lorebook', defaultPath: path.join(os.homedir(), 'Downloads', media.safeName(x.name)) });
    if (s2.canceled || !s2.filePath) return { ok: false, cancelled: true };
    fs.writeFileSync(s2.filePath, x.buf);
    return { ok: true, file: s2.filePath };
  });
  handle('rp:persona', () => cards.persona());
  handle('rp:setPersona', (p) => cards.setPersona(p || {}));
  handle('rp:check', (ids, text) => cardsLib.checkRequest({ cards: cardsOf(ids), text: String(text || '') }));
  // A roleplay picture: the hard limits are checked here, in the main process, before any request.
  handle('rp:image', async (chatId, o = {}) => {
    entryOf(chatId);
    const list = cardsOf(o.cardIds);
    const note = String(o.note || '').slice(0, 1500);
    const looks = list.map((c) => `${c.name}: ${String(c.description || c.personality || '').replace(/\{\{char\}\}/gi, c.name).slice(0, 600)}`).join('\n');
    const prompt = (o.kind === 'scene' ? `A scene${note ? `: ${note}` : ''}. Characters:\n${looks}${list[0]?.scenario ? `\nSetting: ${list[0].scenario.slice(0, 400)}` : ''}` : `A portrait of ${looks}${note ? `\n${note}` : ''}`).slice(0, 3000);
    const chk = cardsLib.checkRequest({ cards: list, text: `${prompt}\n${note}`, image: true });
    if (!chk.ok) return { ok: false, error: { kind: chk.kind, message: chk.message } };
    const provider = String(o.provider || '');
    if (teammates.IDS.includes(provider)) {
      const r = await teammates.image(provider, { prompt, safe: chk.safe });
      if (!r.ok) return { ...r, provider };
      const items = r.images.map((im, i) => media.storeBuffer(root, String(chatId), `${o.kind === 'scene' ? 'scene' : 'portrait'}-${Date.now()}-${i + 1}.${/jpeg/.test(im.mime) ? 'jpg' : 'png'}`, im.buf)).filter(Boolean);
      return { ok: true, provider, via: r.via, items, safe: chk.safe };
    }
    if (!makers.IMAGE_PROVIDERS.includes(provider)) return { ok: false, error: { kind: 'unsupported', message: 'Pick a teammate that makes pictures.' } };
    const r = await makers.generateImage({ provider, key: secrets.get(provider), prompt });
    if (!r.ok) return { ...r, provider };
    return { ok: true, provider, via: r.via, items: [media.storeBuffer(root, String(chatId), `portrait-${Date.now()}.png`, r.buf)].filter(Boolean) };
  });
  // Roleplay turns are checked against the hard limits before and after the AI writes.
  function rpGuard(agent, rp, phase, text) {
    const list = cardsOf(rp?.cardIds);
    if (!list.length) return { ok: true };
    if (phase === 'before' && teammates.IDS.includes(agent)) {
      const young = list.find((c) => cardsLib.cardLimits(c).minor);
      if (young) return { ok: false, kind: 'minor', message: `Blocked: ${young.name} reads as under 18 (${cardsLib.cardLimits(young).minorWhy}), so ${whoName[agent] || agent} (an uncensored teammate) can't play in this story. Pick Claude, ChatGPT or Gemini to play it as a non-sexual story.` };
    }
    const chk = cardsLib.checkRequest({ cards: list, text: String(text || '') });
    return chk.ok ? { ok: true } : { ok: false, kind: chk.kind, message: chk.message };
  }

  // ---- desktop notifications (Settings › Notifications; on unless the owner turns it off) ----
  handle('notify:show', (o = {}) => {
    if (readSettings().notify === false || !d.Notification?.isSupported?.()) return { ok: false };
    const w = getWindow();
    const n = new d.Notification({ title: String(o.title || 'Hearth AI').slice(0, 120), body: String(o.body || '').slice(0, 300), silent: false });
    n.on('click', () => { if (w && !w.isDestroyed()) { w.show(); w.focus(); send('notify:open', String(o.chatId || '')); } });
    n.show();
    return { ok: true };
  });

  // ---- the Habitat's saved store (rooms, garden, journals) ----
  handle('habitat:get', () => {
    const cur = habitat.read();
    if (cur) return { store: cur, from: 'habitat.json', broken: habitat.broken() };
    // First time in 2.x: the Habitat from the old project board, read-only (nothing written).
    let old = null;
    try { old = d.oldHabitat?.() || null; } catch {}
    return { store: old, from: old ? 'old board' : null, broken: habitat.broken() };
  });
  handle('habitat:save', (store) => {
    if (!store || typeof store !== 'object' || Array.isArray(store)) throw new Error('bad Habitat store');
    const t = JSON.stringify(store);
    if (t.length > 2 * 1024 * 1024) throw new Error('Habitat store too big');
    habitat.write(JSON.parse(t));
    return { ok: true };
  });

  return { memory, scheduler, connectors, teammates, cards, rpGuard, docText, mcpForRun: (dir) => connectors.forRun(dir), stop() { scheduler.stop(); makers.stopSpeaking(); } };
}

module.exports = { register, transcriptOf, shieldLine, KEY_NAMES, UNFILTERED };
