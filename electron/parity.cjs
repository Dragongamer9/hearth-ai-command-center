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

const KEY_NAMES = ['google', 'openai', 'xai', 'mistral'];
const whoName = { owner: 'Owner', system: 'App', anthropic: 'Claude', openai: 'ChatGPT', google: 'Gemini', xai: 'Grok', mistral: 'Mistral', qwen: 'Qwen', perplexity: 'Perplexity', deepseek: 'DeepSeek', ollama: 'Local AI' };
const uid = () => crypto.randomBytes(5).toString('hex');

function transcriptOf(messages, max = 12000) {
  const out = [];
  let n = 0;
  for (const m of [...(messages || [])].reverse()) {
    if (m.local || m.deleted) continue;
    const t = `${whoName[m.who] || m.who}: ${String(m.text || '').slice(0, 4000)}`;
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
    const provider = pickProvider(o.provider, makers.IMAGE_PROVIDERS);
    let image = null;
    if (o.edit) {
      const r = resolveItem(chatId, o.edit);
      if (!r.ok || !/^image\//.test(r.mime)) return { ok: false, error: { message: 'There\'s no picture to edit.' } };
      image = { buf: fs.readFileSync(r.file), mime: r.mime, name: r.name };
    }
    const r = await makers.generateImage({ provider, key: secrets.get(provider), prompt: o.prompt, image });
    if (!r.ok) return { ...r, provider };
    return { ok: true, provider, via: r.via, item: media.storeBuffer(root, String(chatId), `${o.edit ? 'edited' : 'image'}-${Date.now()}.${r.mime.includes('jpeg') ? 'jpg' : 'png'}`, r.buf) };
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
      if (g?.ok) for (const m of g.messages) { const t = String(m.text || ''); const lo = t.toLowerCase(); const i = words.map((w) => lo.indexOf(w)).find((x) => x >= 0); if (i >= 0 && i !== undefined) { snippets.push(`${whoName[m.who] || m.who} (${String(m.at || '').slice(0, 10)}): ${t.slice(Math.max(0, i - 120), i + 280).replace(/\s+/g, ' ')}`); if (snippets.length >= 3) break; } }
      return { id: h.id, title: e?.title || h.id, repo: e?.repo || null, updatedAt: e?.updatedAt || null, snippets: snippets.length ? snippets : [h.snippet].filter(Boolean) };
    });
  });
  handle('chats:readOther', (id) => { const e = chats.entry(String(id)); const g = e ? chats.get(String(id)) : null; return g?.ok ? { ok: true, title: e.title, text: transcriptOf(g.messages, 12000) } : { ok: false, message: 'Not found.' }; });

  // ---- per-chat knowledge: instructions and pinned reference files ----
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

  return { memory, scheduler, connectors, docText, mcpForRun: (dir) => connectors.forRun(dir), stop() { scheduler.stop(); makers.stopSpeaking(); } };
}

module.exports = { register, transcriptOf, KEY_NAMES };
