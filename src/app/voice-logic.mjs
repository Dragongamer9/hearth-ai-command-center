// Voice chat logic with no DOM (tested in test/voice-chat.test.mjs):
// - which voice speaks a message (a character's own voice in roleplay, a voice per AI teammate,
//   an optional narrator for *asterisk* text);
// - which provider may speak it (Venice, Civitai and his GPU server never go to OpenAI unless he
//   allowed it);
// - hands-free turn taking (voice activity detection) and barge-in (talking over a reply stops it).
// - speech servers (Kokoro, Chatterbox, Sesame CSM, Dia, CosyVoice2, Orpheus on his own PCs):
//   provider 'server:<id>', a voice per server in voices[k].servers[<id>], and a voice choice may
//   name its own server (use), so different characters can use different engines.
export const PROVIDERS = ['elevenlabs', 'openai', 'local', 'hearth'];
export const PROVIDER_NAMES = { elevenlabs: 'ElevenLabs', openai: 'OpenAI', local: 'this PC', hearth: 'Hearth devices' };
export const UNCENSORED = ['venice', 'civitai', 'gpu', 'hearth'];
export const VOICE_DEFAULTS = Object.freeze({ stt: 'auto', tts: 'local', turn: 'auto', bargeIn: true, narration: 'same', openaiForUncensored: false, keepAudio: false, elevenModel: 'eleven_flash_v2_5', openaiModel: 'gpt-4o-mini-tts', sttModel: 'gpt-transcribe', sttLocal: 'fast', speed: 1 });

// The voice settings as the main process gives them (its defaults, if they are missing).
export function voiceSettings(settings) {
  const v = settings?.voice && typeof settings.voice === 'object' ? settings.voice : {};
  return { ...VOICE_DEFAULTS, ...v, voices: v.voices && typeof v.voices === 'object' ? v.voices : {}, servers: Array.isArray(v.servers) ? v.servers : [] };
}
export const isServer = (p) => /^server:[a-z0-9]{6,16}$/.test(String(p || ''));
export const serverIdOf = (p) => (isServer(p) ? String(p).slice(7) : null);
export function serverFor(p, settings) { const id = serverIdOf(p); return id ? voiceSettings(settings).servers.find((x) => x.id === id) || null : null; }
export function providerName(p, settings) { return isServer(p) ? serverFor(p, settings)?.name || 'a speech server' : PROVIDER_NAMES[p] || String(p || ''); }
// May this teammate's text go to that server? Only a server at OpenAI's own address (hosts from
// voice:status) falls under the rule for Venice, Civitai and his GPU server.
export function serverAllowed(p, { who, settings, hosts = {} }) {
  const srv = serverFor(p, settings);
  if (!srv) return false;
  return !(hosts[srv.id]?.openaiHost && UNCENSORED.includes(who) && !voiceSettings(settings).openaiForUncensored);
}

// Who may speak this message: the provider he picked, unless it has no key, or it is OpenAI and
// the message comes from an uncensored teammate he hasn't allowed to go to OpenAI.
export function routeFor({ who, settings, keys = {}, names = {}, hosts = {} }) {
  const v = voiceSettings(settings);
  let provider = v.tts;
  let notice = null;
  if (isServer(provider)) {
    if (serverAllowed(provider, { who, settings, hosts })) return { provider, notice };
    const gone = !serverFor(provider, settings);
    provider = keys.elevenlabs && !gone ? 'elevenlabs' : 'local';
    notice = gone ? 'The speech server you picked was removed, so a voice on this PC is used. Pick another in Settings › Voice.' : `${names[who] || who}'s replies aren't sent to OpenAI, so this one is spoken by ${PROVIDER_NAMES[provider]}.`;
    return { provider, notice };
  }
  if (provider === 'openai' && UNCENSORED.includes(who) && !v.openaiForUncensored) {
    provider = keys.elevenlabs ? 'elevenlabs' : 'local';
    notice = `${names[who] || who}'s replies aren't sent to OpenAI, so this one is spoken by ${PROVIDER_NAMES[provider]}. You can allow OpenAI for them in Settings › Voice.`;
  }
  if (provider === 'elevenlabs' && !keys.elevenlabs) { provider = 'local'; notice = 'No ElevenLabs key yet, so a voice on this PC is used. Add the key in Settings › Voice.'; }
  if (provider === 'openai' && !keys.openai) { provider = 'local'; notice = 'No OpenAI key yet, so a voice on this PC is used. Add the key in Settings › Voice.'; }
  return { provider, notice };
}

// A stable pick from a list (so characters with no voice set still sound different from each
// other, the same every time). Nothing is saved.
export function autoPick(key, list) {
  if (!list?.length) return null;
  let h = 2166136261;
  for (const ch of String(key)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return list[Math.abs(h) % list.length];
}
// 3.7: an AI's own pick ({ provider, voice }) as a voice choice; it counts only while that provider speaks.
export function pickEntry(pick) {
  if (!pick?.provider || !pick.voice) return null;
  if (pick.provider === 'elevenlabs') return { elevenlabs: { id: pick.voice } };
  if (isServer(pick.provider)) return { servers: { [serverIdOf(pick.provider)]: pick.voice } };
  return { [pick.provider]: pick.voice };
}
// 3.7: "VOICE: <id>" lines in an AI's reply: its pick (the last one), and the text without them.
export function voiceLines(text) {
  let pick = null;
  const kept = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.replace(/^[\s*\-•`>]+/, '').replace(/[`*]+$/, '').match(/^VOICE:\s*(.{1,200}?)\s*$/i);
    if (m) pick = m[1].replace(/^["'`]|["'`]$/g, ''); else kept.push(line);
  }
  return { text: pick === null ? String(text || '') : kept.join('\n').trim(), pick };
}
// 3.7: what an AI is told about picking its voice: the voices it can pick from (by id), unless he picked one for it.
export function voiceMenu({ who, settings, provider, list = [], picks = {}, max = 40 }) {
  const v = voiceSettings(settings);
  if (idOf(v.voices[who], provider)) return '';
  const mine = picks[who]?.provider === provider ? picks[who].voice : null;
  const opts = list.slice(0, max).map((x) => `${x.id}${x.name && x.name !== x.id ? ` (${x.name})` : ''}`).join('; ');
  if (!opts) return '';
  return `YOUR VOICE: your replies are read aloud. You may pick the voice you speak with: put one line VOICE: <id> in a reply (it isn't shown in the chat), from these: ${opts}.${mine ? ` You picked ${mine}; pick again any time to change it.` : ''} The owner can always change it to another one.`;
}
// 3.7: who he's talking to in Talk: "Gemini, …", "Hey Codex …", "Claude and Grok: …" at the start. A name needs a
// greeting before it or a comma, colon or question mark after it, so "Claude Code broke" isn't a name. aliasOf(word)
// gives an AI's id or null.
export function spokenTo(text, aliasOf) {
  const words = String(text || '').trim().split(/\s+/).slice(0, 8);
  const ids = [];
  let greeted = false;
  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const w = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!ids.length && !greeted && /^(hey|hi|hello|ok|okay|yo|so)$/.test(w)) { greeted = true; continue; }
    if (ids.length && (w === 'and' || w === '&')) continue;
    const id = w ? aliasOf(w) : null;
    if (!id) break;
    const marked = /[,:?!]$/.test(raw);
    const next = words[i + 1] ? words[i + 1].toLowerCase().replace(/[^a-z0-9&]/g, '') : '';
    if (!greeted && !marked && !(next === 'and' || next === '&')) break;
    if (!ids.includes(id)) ids.push(id);
    if (marked) break;
  }
  return ids;
}
export const idOf = (v, provider) => (provider === 'elevenlabs' ? v?.elevenlabs?.id : isServer(provider) ? v?.servers?.[serverIdOf(provider)] : v?.[provider]) || null;

// The voice for one message part. msg: { who, char }; cards: the chat's characters.
// Order: the character's own voice, then the teammate's voice, then the default voice, then an
// automatic pick from the provider's list.
// A voice choice that names its own speech server (use) speaks there when canUse allows it.
export function voiceFor({ msg, part = 'speech', cards = [], settings, provider, list = [], canUse = () => false, picks = {} }) {
  const v = voiceSettings(settings);
  const card = msg?.char ? cards.find((c) => c.id === msg.char) : null;
  const own = card?.ownerVoice || null;
  const provOf = (c) => (c?.use && isServer(c.use) && canUse(c.use) ? c.use : provider);
  if (part === 'narration' && v.narration === 'narrator') {
    const n = v.voices.narrator;
    const p = provOf(n);
    const id = idOf(n, p);
    if (id || p !== provider) return { provider: p, voice: id, speed: n.speed, pitch: n.pitch, narrator: true, ...(id ? {} : { auto: true }) };
  }
  // A character with no voice of its own gets an automatic one (so a group never sounds alike);
  // an AI teammate falls back to the default voice first.
  // 3.7: his voice for this AI, then the voice the AI picked for itself, then his default.
  const chain = card ? [own] : [v.voices[msg?.who], pickEntry(picks[msg?.who]), v.voices.default];
  for (const c of chain.filter(Boolean)) {
    const p = provOf(c);
    const id = idOf(c, p);
    // On its own server with no voice picked yet: that server's first voice.
    if (id || p !== provider) return { provider: p, voice: id, speed: c.speed, pitch: c.pitch, ...(id ? {} : { auto: true }) };
  }
  const ids = list.map((x) => x.id);
  const auto = autoPick(card ? `card:${card.id}` : `ai:${msg?.who || 'x'}`, ids) || idOf(v.voices.default, provider);
  return { provider, voice: auto, speed: own?.speed ?? v.voices.default?.speed, pitch: own?.pitch ?? v.voices.default?.pitch, auto: true };
}

// 3.7: what is read aloud. Code blocks and tables are skipped, links say only their words, bare addresses are
// left out, and Markdown's symbols (headings, bullets, bold, quotes, rules) go; a line without an end gets one, so a
// list is read as separate sentences. *Narration* stays for speechParts.
export function speakable(text) {
  let t = String(text || '').replace(/\r/g, '');
  t = t.replace(/```[\s\S]*?(```|$)/g, '\n').replace(/~~~[\s\S]*?(~~~|$)/g, '\n');
  t = t.replace(/^[ \t]*\|.*\|?[ \t]*$/gm, '').replace(/^[ \t]*:?-{3,}:?([ \t]*\|[ \t]*:?-{3,}:?)+[ \t]*$/gm, '');
  t = t.replace(/<\/[a-z][^>]*>|<[a-z]+\s[^>]*>|<(br|hr|p|div|span)\s*\/?>/gi, ' ');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<https?:[^>]+>/g, ' ').replace(/\bhttps?:\/\/\S+/g, ' ').replace(/\bwww\.\S+/g, ' ');
  t = t.replace(/`([^`\n]+)`/g, '$1');
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '').replace(/^[ \t]*>[ \t]?/gm, '').replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, '');
  t = t.replace(/^[ \t]*[-+•][ \t]+/gm, '').replace(/^[ \t]*\*[ \t]+/gm, '').replace(/^[ \t]*\d{1,3}[.)][ \t]+/gm, '').replace(/^[ \t]*\[[ xX]\][ \t]+/gm, '');
  t = t.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2').replace(/~~(?=\S)([^~]*?\S)~~/g, '$1');
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.map((l, i) => (i === lines.length - 1 || /[.!?…:;,]["')\]]*$/.test(l) || /\*$/.test(l) ? l : `${l}.`)).join('\n');
}

// 3.7: a part cut into sentences, so the first one goes to the voice while the rest are still being made. Short bits
// ("Yes.", "Mr.") join the next sentence.
const ABBR = /\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|etc|approx|no|e\.g|i\.e)\.$/i;
export function sentences(text) {
  const raw = String(text || '').split(/(?<=[.!?…]["')\]]*)\s+(?=["'(\[<]?[\p{Lu}\p{N}])/u);
  const out = [];
  let buf = '';
  for (const r of raw) {
    buf = buf ? `${buf} ${r}` : r;
    if (buf.length < 24 || ABBR.test(buf)) continue;
    out.push(buf.trim()); buf = '';
  }
  if (buf.trim()) { if (out.length && buf.length < 24) out[out.length - 1] = `${out[out.length - 1]} ${buf.trim()}`; else out.push(buf.trim()); }
  return out;
}

// Text cut into spoken parts: *narration* and the rest (speech), one sentence each (3.7).
export function speechParts(text, { narration = 'same' } = {}) {
  const t = speakable(text);
  const out = [];
  const push = (kind, s) => {
    // Expressive tags like <laugh> survive for the engines that perform them (Orpheus).
    const x = s.replace(/<([a-z]{3,12})>/gi, '\u0001$1\u0002').replace(/[#_`>|~*]/g, ' ').replace(/\u0001([a-z]{3,12})\u0002/gi, '<$1>').replace(/\s+/g, ' ').trim();
    if (!x || !/[\p{L}\p{N}]/u.test(x)) return;
    if (kind === 'narration' && narration === 'skip') return;
    const k = narration === 'same' ? 'speech' : kind;
    const last = out[out.length - 1];
    if (last && last.kind === k) last.text = `${last.text} ${x}`;
    else out.push({ kind: k, text: x });
  };
  let rest = t;
  const re = /\*([^*\n]+)\*/g;
  let m;
  let at = 0;
  while ((m = re.exec(rest))) { push('speech', rest.slice(at, m.index)); push('narration', m[1]); at = m.index + m[0].length; }
  push('speech', rest.slice(at));
  // 3.7: every part is cut into sentences, so speaking starts after the first one (the rest are made meanwhile).
  return out.flatMap((p) => sentences(p.text).map((x) => ({ kind: p.kind, text: x })));
}

// The spoken plan for a set of replies: [{ msgId, who, char, kind, text, provider, voice, ... }].
// chatVoice: this chat's own choice (the chat window's Voice button): { provider, voice, speed }. Its voice speaks for the
// AI teammates (a character keeps its own); its speed is for everyone in the chat.
export function withChatVoice(sel, msg, chatVoice) {
  if (!chatVoice) return sel;
  const out = { ...sel };
  if (chatVoice.voice && !msg?.char) { out.provider = chatVoice.provider || out.provider; out.voice = chatVoice.voice; out.auto = false; }
  const sp = Number(chatVoice.speed);
  if (sp >= 0.5 && sp <= 2) out.speed = sp;
  return out;
}

export function speechPlan({ msgs, cards = [], settings, keys = {}, lists = {}, names = {}, hosts = {}, chatVoice = null, picks = {} }) {
  const v = voiceSettings(settings);
  const plan = [];
  const notices = new Set();
  for (const m of msgs) {
    if (!m || m.who === 'owner' || m.who === 'system' || m.err) continue;
    const r = routeFor({ who: m.who, settings, keys, names, hosts });
    if (r.notice) notices.add(r.notice);
    const canUse = (p) => serverAllowed(p, { who: m.who, settings, hosts });
    for (const p of speechParts(m.text, { narration: v.narration })) {
      const sel = withChatVoice(voiceFor({ msg: m, part: p.kind, cards, settings, provider: r.provider, list: lists[r.provider] || [], canUse, picks }), m, chatVoice);
      // 3.8: his default speed for everyone, unless the voice or this chat has its own.
      if (!(Number(sel.speed) >= 0.5 && Number(sel.speed) <= 2) && Number(v.speed) !== 1 && Number(v.speed) >= 0.5 && Number(v.speed) <= 2) sel.speed = Number(v.speed);
      plan.push({ msgId: m.id, who: m.who, char: m.char || null, kind: p.kind, text: p.text, ...sel });
    }
  }
  return { plan, notices: [...notices] };
}

// ---------- turn taking ----------
// Feed it the microphone level (0..1, RMS) every frame. Hands-free: it says when speech starts
// and ends. While a reply is being spoken, talking louder than the reply's echo for a moment is
// a barge-in.
export function createTurnTaker({ threshold = 0.035, startMs = 160, endMs = 900, minSpeechMs = 300, bargeFactor = 2.2, bargeMs = 260, onStart = () => {}, onEnd = () => {}, onBarge = () => {} } = {}) {
  const st = { speaking: false, inSpeech: false, aboveSince: null, belowSince: null, speechSince: null, bargeSince: null, bargeIn: true, mode: 'auto', noise: threshold * 0.5 };
  return {
    state: st,
    setSpeaking(on) { st.speaking = Boolean(on); st.bargeSince = null; st.aboveSince = null; },
    setMode(mode) { st.mode = mode === 'ptt' ? 'ptt' : 'auto'; },
    setBargeIn(on) { st.bargeIn = on !== false; },
    reset() { st.inSpeech = false; st.aboveSince = null; st.belowSince = null; st.speechSince = null; st.bargeSince = null; },
    feed(level, t) {
      const thr = Math.max(threshold, st.noise * 2.5);
      if (st.speaking) {
        if (!st.bargeIn) return null;
        if (level > thr * bargeFactor) { st.bargeSince ??= t; if (t - st.bargeSince >= bargeMs) { st.bargeSince = null; st.speaking = false; st.inSpeech = true; st.speechSince = t; st.belowSince = null; onBarge(t); return 'barge'; } }
        else st.bargeSince = null;
        return null;
      }
      if (!st.inSpeech && level < thr) st.noise = st.noise * 0.98 + level * 0.02;
      if (st.mode === 'ptt') return null;
      if (!st.inSpeech) {
        if (level > thr) { st.aboveSince ??= t; if (t - st.aboveSince >= startMs) { st.inSpeech = true; st.speechSince = st.aboveSince; st.belowSince = null; onStart(t); return 'start'; } }
        else st.aboveSince = null;
        return null;
      }
      if (level < thr * 0.8) {
        st.belowSince ??= t;
        if (t - st.belowSince >= endMs) {
          const long = st.belowSince - st.speechSince >= minSpeechMs;
          st.inSpeech = false; st.aboveSince = null; st.belowSince = null;
          if (long) { onEnd(t, t - endMs); return 'end'; }
          return 'short';
        }
      } else st.belowSince = null;
      return null;
    },
  };
}

// The queue of parts being spoken. stop() (a barge-in, Stop, closing the view) ends the current
// part and drops the rest at once.
// 3.7: prepare(item) starts making a part's audio (the voice server's request) before its turn: the current part and
// the next `ahead` ones, so the next sentence is ready when this one ends. play(item, prepared) plays it; discard(item,
// prepared) drops audio made for a part that was never played (a stop).
export function createSpeechQueue({ play, prepare = null, discard = () => {}, cancel = () => {}, onState = () => {}, ahead = 2 }) {
  let items = [];
  let current = null;
  let gen = 0;
  const ready = new Map(); // item -> Promise of what prepare made
  const warm = () => { if (!prepare) return; for (const it of [current, ...items.slice(0, ahead)]) if (it && !ready.has(it)) ready.set(it, Promise.resolve().then(() => prepare(it)).catch(() => null)); };
  async function next(g) {
    if (g !== gen) return;
    current = items.shift() || null;
    if (!current) { onState('idle'); return; }
    warm();
    onState('speaking', current);
    const it = current;
    try { const made = ready.has(it) ? await ready.get(it) : undefined; ready.delete(it); if (g === gen) await play(it, made); } catch {}
    if (g === gen) next(g);
  }
  return {
    get current() { return current; },
    get pending() { return items.length; },
    get busy() { return Boolean(current) || items.length > 0; },
    enqueue(parts) { const was = Boolean(current) || items.length > 0; items.push(...parts); if (!was) next(gen); else warm(); },
    stop() {
      gen++;
      for (const [it, p] of ready) p.then((made) => { if (made) discard(it, made); });
      ready.clear();
      items = []; const c = current; current = null; if (c) cancel(c); onState('idle'); return Boolean(c);
    },
  };
}

// 3.7: time from the end of his speech to the first sound, per turn (kept in memory, shown in the Talk view).
export function createLatencyMeter({ keep = 20, now = () => performance.now() } = {}) {
  let start = null;
  const list = [];
  return {
    endOfSpeech(t = now()) { start = t; },
    firstSound(t = now()) { if (start === null) return null; const ms = Math.max(0, Math.round(t - start)); start = null; list.push(ms); if (list.length > keep) list.shift(); return ms; },
    cancel() { start = null; },
    get waiting() { return start !== null; },
    get last() { return list.length ? list[list.length - 1] : null; },
    get list() { return list.slice(); },
    get median() { if (!list.length) return null; const a = list.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2); },
  };
}

// The new replies since the owner's message (all of them in a group chat).
export function newReplies(msgs, sinceIndex) {
  return (msgs || []).slice(Math.max(0, sinceIndex)).filter((m) => m && m.who !== 'owner' && m.who !== 'system' && !m.err && !m.local && String(m.text || '').trim());
}
// Does this chat talk only to uncensored teammates (then his voice isn't sent to OpenAI either)?
export function uncensoredOnly({ chat, mode }) {
  const players = chat?.rp ? Object.values(chat.rp.players || {}) : [];
  if (players.length) return players.every((a) => UNCENSORED.includes(a));
  return UNCENSORED.includes(mode);
}
