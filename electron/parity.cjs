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
const big = require('./bigfiles.cjs');
const { pathToFileURL } = require('node:url');
const makers = require('./makers.cjs');
const { createMemory } = require('./memory-store.cjs');
const { createScheduler } = require('./schedule.cjs');
const { createConnectors } = require('./connectors.cjs');
const { createJsonFile } = require('./jsonfile.cjs');
const { createTeammates } = require('./teammates.cjs');
const cardsLib = require('./cards.cjs');
const voiceChat = require('./voice-chat.cjs');
const { createHearthDevices } = require('./hearth-devices.cjs');
const comfy = require('./comfy.cjs');
const scene = require('./scene.cjs');
const hnet = require('./hearth-net.cjs');
const { createStudio, NOT_REAL_TEXT } = require('./studio.cjs');

// elevenlabs: voice chat's most realistic voices (electron/voice-chat.cjs).
const KEY_NAMES = ['google', 'openai', 'xai', 'mistral', 'elevenlabs'];
const whoName = { owner: 'Owner', system: 'App', anthropic: 'Claude', openai: 'ChatGPT', google: 'Gemini', xai: 'Grok', mistral: 'Mistral', qwen: 'Qwen', perplexity: 'Perplexity', deepseek: 'DeepSeek', ollama: 'Local AI', venice: 'Venice', civitai: 'Civitai', gpu: 'Your GPU server', hearth: 'Hearth devices', free: 'Free AI' };
// Teammates whose output never reaches the other AIs (the same rule as src/app/brief.mjs).
const UNFILTERED = ['venice', 'civitai', 'gpu', 'hearth'];
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
  // Hearth devices: the AI his Hearth OS machines share (electron/hearth-devices.cjs).
  const hearth = d.hearth || createHearthDevices({ settings: () => readSettings().hearthDevices, secrets, ...(d.fetchImpl ? { fetchImpl: d.fetchImpl } : {}), ...(d.sleep ? { sleep: d.sleep } : {}) });
  const entryOf = (id) => v2().entryOf(String(id));
  const attachRoot = () => attachments.attachDir(worktreeRoot());

  // ---- pictures, videos and files in the chat ----
  // Thumbnails and screen-sized copies of pictures: Electron's nativeImage, no extra native deps.
  const nativeImage = d.nativeImage !== undefined ? d.nativeImage : (() => { try { return require('electron').nativeImage || null; } catch { return null; } })();
  const render = d.renderPicture || (nativeImage ? (file, side) => {
    const im = nativeImage.createFromPath(file);
    if (!im || im.isEmpty()) return null;
    const { width, height } = im.getSize();
    const k = Math.min(1, side / Math.max(width, height));
    const small = k < 1 ? im.resize({ width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), quality: 'good' }) : im;
    return /\.jpe?g$/i.test(file) ? { buf: small.toJPEG(82), ext: 'jpg' } : { buf: small.toPNG(), ext: 'png' };
  } : null);
  if (protocol?.handle) {
    protocol.handle(media.SCHEME, (req) => {
      const r = media.respond(req, root, { render });
      return new Response(r.stream ? Readable.toWeb(r.stream()) : r.body, { status: r.status, headers: r.headers });
    });
  }
  const resolveItem = (chatId, file) => media.resolve(media.urlFor(String(chatId), String(file)), root);
  handle('media:open', (chatId, file) => { const r = resolveItem(chatId, file); if (!r.ok) return { ok: false, message: 'Not found.' }; shell.openPath(r.file); return { ok: true }; });
  // Too big for the chat: open it in the browser (HTML) or show it in its folder.
  handle('media:openBrowser', (chatId, file) => { const r = resolveItem(chatId, file); if (!r.ok) return { ok: false, message: 'Not found.' }; shell.openExternal(pathToFileURL(r.file).href); return { ok: true }; });
  handle('media:reveal', (chatId, file) => { const r = resolveItem(chatId, file); if (!r.ok) return { ok: false, message: 'Not found.' }; shell.showItemInFolder(r.file); return { ok: true }; });
  handle('media:save', async (chatId, file, name) => {
    const r = resolveItem(chatId, file);
    if (!r.ok) return { ok: false, message: 'Not found.' };
    const s = await dialog.showSaveDialog(getWindow(), { title: 'Save', defaultPath: path.join(os.homedir(), 'Downloads', media.safeName(name || file.replace(/^[0-9a-f]{10}-/, ''))) });
    if (s.canceled || !s.filePath) return { ok: false, cancelled: true };
    const space = await big.checkSpace(path.dirname(s.filePath), r.size);
    if (!space.ok) return { ok: false, message: space.message };
    // Copied off the main thread (a big video doesn't freeze the window).
    await fs.promises.copyFile(r.file, s.filePath);
    return { ok: true, file: s.filePath };
  });
  handle('media:toRepo', async (chatId, file, rel) => {
    const r = resolveItem(chatId, file);
    if (!r.ok) return { ok: false, message: 'Not found.' };
    const e = entryOf(chatId);
    if (!e.repo && !e.repoDir) return { ok: false, message: 'Connect this chat to a repo first.' };
    try { await v2().copyFor(e); } catch (err) { return { ok: false, message: err.message }; }
    if (r.size > 100 * 1024 * 1024) return { ok: false, message: `That file is ${big.fmtBytes(r.size)}; files over 100 MB don't belong in a git repo. Use Save as… instead.` };
    return v2().copies.writeFile(e.id, String(rel || ''), fs.readFileSync(r.file));
  });
  // A picture, video or sound an AI linked on the web: fetched only when the owner clicks.
  // Streamed straight to the chat's media folder (up to big.MAX_STORED, with a free-space
  // check), with progress; media:cancelFetch stops it.
  const fetches = new Map();
  handle('media:fetchRemote', async (chatId, url) => {
    const e = entryOf(chatId);
    let u;
    try { u = new URL(String(url)); } catch { return { ok: false, message: 'Bad link.' }; }
    if (u.protocol !== 'https:') return { ok: false, message: 'Only https links.' };
    const ctl = new AbortController();
    fetches.get(e.id)?.abort();
    fetches.set(e.id, ctl);
    try {
      const res = await (d.fetchImpl || fetch)(u.href, { redirect: 'follow', signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(30000)]) });
      const type = String(res.headers.get('content-type') || '').split(';')[0];
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mp4': 'm4a' }[type];
      if (!res.ok || !ext || !res.body) return { ok: false, message: 'That link isn\'t a picture, video or sound.' };
      const len = Number(res.headers.get('content-length')) || null;
      const name = `${(u.pathname.split('/').pop() || 'web').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 40) || 'web'}.${ext}`;
      // The 30 s limit is for the answer to start; a big download may take longer (Cancel stops it).
      const r = await big.streamToFile(Readable.fromWeb(res.body), path.join(root, e.id), name, { expected: len, signal: ctl.signal, onProgress: (p) => send('media:progress', { chatId: e.id, name, done: p.done, total: p.total ?? len, finished: p.finished === true, fetch: true }) });
      if (!r.ok) return { ok: false, message: r.code === 'too-big' ? `Too big: ${r.message.replace(/^it is too large /, '')}.` : r.message };
      return { ok: true, item: media.describe(path.join(root, e.id), { kind: media.kindOf(name), name, file: r.file, size: r.size, mime: media.mimeOf(name), url: media.urlFor(e.id, r.file) }) };
    } catch { return { ok: false, message: ctl.signal.aborted ? 'Download stopped.' : 'Couldn\'t download it.' }; } finally { if (fetches.get(e.id) === ctl) fetches.delete(e.id); send('media:progress', { chatId: e.id, fetch: true, finished: true }); }
  });
  handle('media:cancelFetch', (chatId) => { fetches.get(String(chatId))?.abort(); return true; });
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
    // Hearth devices: ComfyUI on the best device that shares it.
    if (o.provider === 'hearth') {
      const r = await hearth.image({ prompt: String(o.prompt || ''), negative: `${scene.NEG_MINOR}, blurry, low quality` });
      if (!r.ok) return { ok: false, provider: 'hearth', error: { kind: r.kind, message: r.message } };
      const items = r.images.map((im, i) => media.storeBuffer(root, String(chatId), `hearth-${Date.now()}-${i + 1}.${/jpeg/.test(im.mime) ? 'jpg' : /webp/.test(im.mime) ? 'webp' : 'png'}`, im.buf)).filter(Boolean);
      return { ok: true, provider: 'hearth', via: r.via, item: items[0], items };
    }
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
    // Thumbnails (t) and screen-sized copies (v) export as their original picture.
    const MEDIA_URL = /hearth-media:\/\/[ctv]\/[A-Za-z0-9-]+\/[^\s"')<>]+/g;
    const orig = (u) => u.replace(/^hearth-media:\/\/[tv]\//, 'hearth-media://c/');
    // Big files are copied next to the export instead of being put inside it.
    const filesDir = `${s.filePath.replace(/\.(md|html|pdf)$/i, '')}_files`;
    const copyOut = (r) => { fs.mkdirSync(filesDir, { recursive: true }); const dest = path.join(filesDir, r.name); if (!fs.existsSync(dest)) fs.copyFileSync(r.file, dest); return `${path.basename(filesDir)}/${encodeURIComponent(r.name)}`; };
    if (fmt === 'md') {
      const dir = filesDir;
      const md = String(payload.markdown || '').replace(MEDIA_URL, (u) => {
        const r = media.resolve(orig(u), root);
        if (!r.ok) return u;
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(r.file, path.join(dir, r.name));
        return `${path.basename(dir)}/${encodeURIComponent(r.name)}`;
      });
      fs.writeFileSync(s.filePath, md, { mode: 0o644 });
      return { ok: true, file: s.filePath };
    }
    const html = String(payload.html || '').replace(MEDIA_URL, (u) => { const r = media.resolve(orig(u), root); if (!r.ok) return ''; return media.dataUri(orig(u), root) || (fmt === 'html' ? copyOut(r) : ''); });
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
  handle('teammates:status', () => { const st = teammates.status(); return { ...st, ready: { ...st.ready, hearth: hearth.configured() }, imagesOnly: { ...st.imagesOnly, hearth: false } }; });
  // ---- Hearth devices (Settings › Accounts › Hearth devices) ----
  handle('hearth:status', (o = {}) => hearth.status({ probe: o.probe === true, fresh: o.fresh === true }));
  handle('hearth:shareCode', (code) => hearth.setShareCode(code === null ? null : String(code ?? '')));
  handle('teammates:setKey', (agent, key) => teammates.setKey(String(agent), key));
  handle('teammates:removeKey', (agent) => teammates.removeKey(String(agent)));
  handle('teammates:addServer', (spec) => teammates.addServer(spec || {}));
  handle('teammates:removeServer', (id) => teammates.removeServer(String(id)));
  handle('teammates:updateServer', (id, patch) => teammates.updateServer(String(id), patch || {}));
  handle('teammates:listModels', (q) => teammates.listModels(q || {}));

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
  // Collections (the owner's own groups): a card leaves only the collection he removes it from.
  handle('cards:collections', () => cards.collections());
  handle('cards:collectionNew', (name) => cards.addCollection(name));
  handle('cards:collectionDelete', (id) => cards.removeCollection(String(id)));
  handle('cards:collectionAdd', (id, ids) => cards.addToCollection(String(id), ids));
  handle('cards:collectionRemove', (id, ids) => cards.removeFromCollection(String(id), ids));
  handle('cards:collectionRestore', (id, ids, before) => cards.restoreToCollection(String(id), ids, before));
  // Owner only: clears a false "under 18" alarm by confirming the character's adult age.
  handle('cards:confirmAdult', (id, age, on) => {
    const c = cards.confirmAdult(String(id), age, on !== false);
    if (typeof d.audit === 'function') d.audit(on === false ? 'Adult confirmation removed' : 'Character confirmed as an adult by the owner', `${c.name}${on === false ? '' : ` (age ${c.limits?.adultConfirmed?.age})`}`);
    return c;
  });
  // A character's voice (voice chat): kept with the character in this app, never in exported cards.
  handle('cards:setVoice', (id, voice) => cards.setVoice(String(id), voice));
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
    // Each character's look: the saved appearance, else only the visual details of the card
    // (no roleplay instructions, backstory or dialogue; card text stays untrusted prompt text).
    const user = cards.persona()?.name || 'the user';
    const looks = list.map((c) => { const l = scene.lookOf(c, user); return l ? `${c.name}: ${l}` : c.name; }).join('\n');
    const setting = list[0]?.scenario ? scene.visualOrPlace(list[0].scenario, list[0], user) : '';
    const prompt = (o.kind === 'scene' ? `A scene${note ? `: ${note}` : ''}. Characters:\n${looks}${setting ? `\nSetting: ${setting}` : ''}` : `A portrait of ${looks}${note ? `\n${note}` : ''}`).slice(0, 3000);
    const chk = cardsLib.checkRequest({ cards: list, text: `${prompt}\n${note}`, image: true });
    if (!chk.ok) return { ok: false, error: { kind: chk.kind, message: chk.message } };
    const provider = String(o.provider || '');
    if (provider === 'hearth') {
      const sc = scene.checkScene({ cards: list, prompt });
      if (!sc.ok) return { ok: false, error: { kind: sc.kind, message: sc.message } };
      const r = await hearth.image({ prompt, negative: sc.negative });
      if (!r.ok) return { ok: false, provider, error: { kind: r.kind, message: r.message } };
      const items = r.images.map((im, i) => media.storeBuffer(root, String(chatId), `${o.kind === 'scene' ? 'scene' : 'portrait'}-${Date.now()}-${i + 1}.${/jpeg/.test(im.mime) ? 'jpg' : 'png'}`, im.buf)).filter(Boolean);
      return { ok: true, provider, via: r.via, items, safe: sc.safe };
    }
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
  // ---- Characters chat scene pictures (ComfyUI; electron/scene.cjs, electron/comfy.cjs) ----
  // The character's look (appearance text, seed, keep the same seed): his edits and buttons only.
  handle('cards:setLook', (id, patch) => cards.setLook(String(id), patch && typeof patch === 'object' ? patch : {}));
  // Where a scene can be made: his ComfyUI server, his GPU servers set up as ComfyUI, Hearth devices.
  function sceneSources() {
    const out = [];
    const c = readSettings().comfy || {};
    if (c.url) out.push({ id: 'comfy', name: `Your ComfyUI server (${hnet.hostOf(c.url)})`, seed: true });
    for (const s of teammates.list().filter((x) => x.type === 'comfy')) out.push({ id: `gpu:${s.id}`, name: `${s.name} (your GPU server, ComfyUI)`, seed: true });
    if (hearth.configured()) out.push({ id: 'hearth', name: 'Hearth devices (ComfyUI on the best device)', seed: true });
    return out;
  }
  handle('rp:sceneSources', () => sceneSources());
  // The prompt built here from the cards and the recent messages; the window shows it to edit.
  handle('rp:scenePrompt', (ids, messages) => {
    const list = cardsOf(ids);
    const msgs = (Array.isArray(messages) ? messages : []).slice(-20).map((m) => ({ who: String(m?.who || ''), text: String(m?.text || '').slice(0, 4000), err: m?.err === true }));
    return { prompt: scene.buildScenePrompt({ cards: list, messages: msgs, persona: cards.persona() }), negativeBase: scene.negativeFor(list), settings: comfy.effective(readSettings().comfy), looks: list.map((c) => ({ id: c.id, name: c.name, look: c.ownerLook || null })) };
  });
  // The checkpoints on his ComfyUI server (its address from his settings only).
  const comfyConn = (c) => ({ base: c.url, allow: comfy.allowOnly(c.url), fetchImpl: d.fetchImpl || ((...a) => fetch(...a)), name: 'Your ComfyUI server' });
  handle('comfy:checkpoints', async () => {
    const c = readSettings().comfy || {};
    if (!c.url) return hnet.fail('Type your ComfyUI server\'s address first.', 'not_set');
    return comfy.listCheckpoints(comfyConn(c));
  });
  // Test Connection: online, the GPU and its free/total graphics memory (GET /system_stats),
  // and the model list. Reads only; nothing is saved.
  handle('comfy:test', async () => {
    const c = readSettings().comfy || {};
    if (!c.url) return hnet.fail(`Type your ComfyUI server's address first (like ${comfy.DEFAULTS.url}).`, 'not_set');
    const r = await comfy.testConnection(comfyConn(c));
    if (r.ok && c.checkpoint && !r.checkpoints.includes(c.checkpoint)) return { ...r, missing: c.checkpoint, warning: `Your default model ${c.checkpoint} isn't on the server any more. Pick another one.` };
    return r;
  });
  // Live free graphics memory (for the note in Generate scene). Reads only.
  handle('comfy:stats', async () => {
    const c = readSettings().comfy || {};
    if (!c.url) return hnet.fail('No ComfyUI server set up.', 'not_set');
    return comfy.systemStats(comfyConn(c));
  });

  // Scene jobs running now (so Cancel can reach one): job id -> AbortController.
  const sceneJobs = new Map();
  const JOB_RE = /^[A-Za-z0-9_-]{4,40}$/;
  async function makeScene(o = {}, { signal, onProgress } = {}) {
    // Every check here runs in the main process before any request. Card text only ever becomes
    // prompt text: nothing in a card can change a setting or skip a check.
    const list = cardsOf(o.cardIds);
    const prompt = String(o.prompt || '').trim().slice(0, 2500);
    const chk = scene.checkScene({ cards: list, prompt });
    if (!chk.ok) return { ok: false, error: { kind: chk.kind, message: chk.message } };
    // His own negative words go after the built-in safety terms (they can only take things out).
    const mine = scene.ownNegative(o.negative);
    if (mine) chk.negative = `${chk.negative}, ${mine}`;
    // The seed: the one he typed or kept for the first character, else a new one (not saved).
    const look = list[0]?.ownerLook || {};
    const typed = o.seed === null || o.seed === '' || o.seed === undefined ? NaN : Number(o.seed);
    const seed = Number.isInteger(typed) && typed >= 0 && typed < 2 ** 48 ? typed : look.keepSeed !== false && Number.isInteger(look.seed) ? look.seed : null;
    // Size, steps and cfg: his settings (defaults filled in at read time), or the values of the
    // picture being regenerated (checked the same way).
    const eff = comfy.effective(readSettings().comfy);
    const size = comfy.SIZE_CHOICES.find((x) => x.width === Number(o.width) && x.height === Number(o.height));
    const steps = Number.isInteger(Number(o.steps)) && Number(o.steps) >= 4 && Number(o.steps) <= 60 ? Number(o.steps) : eff.steps;
    const cfg = Number.isFinite(Number(o.cfg)) && o.cfg !== null && o.cfg !== '' && Number(o.cfg) >= 1 && Number(o.cfg) <= 15 ? Number(o.cfg) : eff.cfg;
    const look2 = { width: size ? size.width : eff.width, height: size ? size.height : eff.height, steps, cfg, sampler: eff.sampler, scheduler: eff.scheduler };
    const src = String(o.source || '');
    const fetchImpl = d.fetchImpl || ((...a) => fetch(...a));
    const extra = { ...(d.sleep ? { sleep: d.sleep } : {}), ...(d.maxPolls ? { maxPolls: d.maxPolls } : {}), signal, onProgress };
    if (src === 'hearth') { const r = await hearth.image({ prompt, negative: chk.negative, seed, signal, onProgress, width: look2.width, height: look2.height, steps, cfg }); return r.ok ? { ...r, safe: chk.safe } : r; }
    if (src === 'comfy') {
      const c = readSettings().comfy || {};
      if (!c.url) return hnet.fail('Add your ComfyUI server in Settings › Accounts first.', 'not_set');
      // A model he picked must still be on the server (else a clear "model missing").
      const ckpt = typeof o.checkpoint === 'string' && o.checkpoint ? o.checkpoint : c.checkpoint || null;
      const r = await comfy.generate({ ...comfyConn(c), checkpoint: ckpt, strictCheckpoint: Boolean(ckpt), prompt, negative: chk.negative, seed, ...look2, checkVram: true, ...extra });
      return r.ok ? { ...r, safe: chk.safe, via: `Your ComfyUI server · ${r.checkpoint} · seed ${r.seed}` } : r;
    }
    const m = src.match(/^gpu:([a-f0-9]{8})$/);
    const s = m ? teammates.list().find((x) => x.id === m[1] && x.type === 'comfy') : null;
    if (!s) return hnet.fail('Pick where to make the scene (add a ComfyUI server in Settings › Accounts).', 'not_set');
    const key = secrets.get(`server.${s.id}`);
    const h = hnet.hostOf(s.url);
    const r = await comfy.generate({ base: s.url, allow: (host) => host === h, headers: key ? { authorization: `Bearer ${key}` } : {}, checkpoint: s.model || null, prompt, negative: chk.negative, seed, ...look2, checkVram: true, fetchImpl, name: s.name, ...extra });
    return r.ok ? { ...r, safe: chk.safe, via: `${s.name} · ComfyUI · ${r.checkpoint} · seed ${r.seed}` } : r;
  }
  // A scene picture: checked against the hard limits here, then saved with the chat (its media
  // folder). Progress goes to the window as rp:sceneProgress; rp:sceneCancel stops it. The
  // result carries what was used (seed, model, size, steps, cfg, sampler, both prompts) for the
  // message: it's kept with the chat, never in his settings.
  handle('rp:scene', async (chatId, o = {}) => {
    entryOf(chatId);
    const job = JOB_RE.test(String(o.job || '')) ? String(o.job) : `j${Date.now().toString(36)}`;
    const ac = new AbortController();
    sceneJobs.set(job, ac);
    let r;
    try {
      r = await makeScene(o, { signal: ac.signal, onProgress: (p) => { try { send('rp:sceneProgress', { chatId: String(chatId), job, ...p }); } catch {} } });
    } catch (e) {
      r = hnet.fail(`The picture failed: ${e?.message || e}`);
    } finally { sceneJobs.delete(job); }
    if (!r.ok) return r.error ? { ...r, job } : { ok: false, job, error: { kind: r.kind, message: r.message } };
    const items = r.images.map((im, i) => media.storeBuffer(root, String(chatId), `scene-${Date.now()}-${i + 1}.${/jpeg/.test(im.mime) ? 'jpg' : /webp/.test(im.mime) ? 'webp' : 'png'}`, im.buf)).filter(Boolean);
    if (!items.length) return { ok: false, job, error: { kind: 'failed', message: 'The picture couldn\'t be saved with the chat.' } };
    const meta = { seed: r.seed, checkpoint: r.checkpoint || null, width: r.width || null, height: r.height || null, steps: r.steps || null, cfg: r.cfg || null, sampler: r.sampler || null, scheduler: r.scheduler || null, positive: r.positive || String(o.prompt || '').slice(0, 2500), negative: r.negative || '', ownNegative: scene.ownNegative(o.negative), source: String(o.source || ''), cardIds: cardsOf(o.cardIds).map((c) => c.id) };
    return { ok: true, job, items, via: r.via || `seed ${r.seed}`, seed: r.seed, checkpoint: r.checkpoint, meta, vramNote: r.vram?.note || null };
  });
  // ---- Images & Videos (2.2.1; electron/studio.cjs): ComfyUI pictures and Wan 2.2 videos ----
  const studio = createStudio({ dataDir, readSettings, send, fetchImpl: d.fetchImpl || ((...x) => fetch(...x)) });
  handle('studio:list', () => studio.list());
  handle('studio:status', () => studio.status());
  // A picture file from outside the app starting a video in Uncensored mode: he confirms each time,
  // in a native box the window can't answer for him (never remembered between files).
  handle('studio:add', (req) => {
    const r = req && typeof req === 'object' ? { ...req } : {};
    delete r.notReal;
    const unc = readSettings().uncensored || {};
    if (r.kind === 'video' && typeof r.start === 'string' && r.start.startsWith('pick:') && unc.on === true) {
      const c = dialog.showMessageBoxSync(getWindow(), { type: 'question', message: 'Is this picture a real person?', detail: NOT_REAL_TEXT, buttons: ['Cancel', 'Confirm'], defaultId: 0, cancelId: 0 });
      if (c !== 1) return { ok: false, cancelled: true, message: 'Not made: you didn\'t confirm the picture.' };
      r.notReal = true;
    }
    return studio.add(r);
  });
  handle('studio:cancel', (id) => studio.cancel(id));
  handle('studio:remove', (id) => studio.remove(id));
  handle('studio:again', (id) => studio.again(id));
  handle('studio:pickImage', async () => {
    const r = await dialog.showOpenDialog(getWindow(), { title: 'Pick a picture to animate', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    return studio.pickToken(r.filePaths[0]);
  });
  handle('rp:sceneCancel', (job) => { const ac = sceneJobs.get(String(job || '')); if (!ac) return { ok: false }; ac.abort(); return { ok: true }; });

  // Roleplay turns are checked against the hard limits before and after the AI writes.
  function rpGuard(agent, rp, phase, text) {
    const list = cardsOf(rp?.cardIds);
    if (!list.length) return { ok: true };
    if (phase === 'before' && UNFILTERED.includes(agent)) {
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

  // ---- voice chat: speech to text, voices, cloning (electron/voice-chat.cjs) ----
  // CosyVoice2 voice clips (his, with consent) live in voice-clips/<server id>/, never in settings.
  const voice = voiceChat.register({ handle, secrets, readSettings, send, which: makers.which, media, mediaRoot: root, dialog, getWindow, clipsDir: path.join(dataDir(), 'voice-clips'), hearth });

  return { studio, memory, scheduler, connectors, teammates, hearth, makeScene, cards, rpGuard, docText, mcpForRun: (dir) => connectors.forRun(dir), stop() { scheduler.stop(); makers.stopSpeaking(); voice.stop(); } };
}

module.exports = { register, transcriptOf, shieldLine, KEY_NAMES, UNFILTERED };
