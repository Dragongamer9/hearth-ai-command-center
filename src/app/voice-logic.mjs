// Voice chat logic with no DOM (tested in test/voice-chat.test.mjs):
// - which voice speaks a message (a character's own voice in roleplay, a voice per AI teammate,
//   an optional narrator for *asterisk* text);
// - which provider may speak it (Venice, Civitai and his GPU server never go to OpenAI unless he
//   allowed it);
// - hands-free turn taking (voice activity detection) and barge-in (talking over a reply stops it).
export const PROVIDERS = ['elevenlabs', 'openai', 'local'];
export const PROVIDER_NAMES = { elevenlabs: 'ElevenLabs', openai: 'OpenAI', local: 'this PC' };
export const UNCENSORED = ['venice', 'civitai', 'gpu'];
export const VOICE_DEFAULTS = Object.freeze({ stt: 'auto', tts: 'local', turn: 'auto', bargeIn: true, narration: 'same', openaiForUncensored: false, keepAudio: false, elevenModel: 'eleven_flash_v2_5', openaiModel: 'gpt-4o-mini-tts', sttModel: 'gpt-transcribe' });

// The voice settings as the main process gives them (its defaults, if they are missing).
export function voiceSettings(settings) {
  const v = settings?.voice && typeof settings.voice === 'object' ? settings.voice : {};
  return { ...VOICE_DEFAULTS, ...v, voices: v.voices && typeof v.voices === 'object' ? v.voices : {} };
}

// Who may speak this message: the provider he picked, unless it has no key, or it is OpenAI and
// the message comes from an uncensored teammate he hasn't allowed to go to OpenAI.
export function routeFor({ who, settings, keys = {}, names = {} }) {
  const v = voiceSettings(settings);
  let provider = v.tts;
  let notice = null;
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
const idOf = (v, provider) => (provider === 'elevenlabs' ? v?.elevenlabs?.id : v?.[provider]) || null;

// The voice for one message part. msg: { who, char }; cards: the chat's characters.
// Order: the character's own voice, then the teammate's voice, then the default voice, then an
// automatic pick from the provider's list.
export function voiceFor({ msg, part = 'speech', cards = [], settings, provider, list = [] }) {
  const v = voiceSettings(settings);
  const card = msg?.char ? cards.find((c) => c.id === msg.char) : null;
  const own = card?.ownerVoice || null;
  if (part === 'narration' && v.narration === 'narrator') {
    const n = v.voices.narrator;
    const id = idOf(n, provider);
    if (id) return { provider, voice: id, speed: n.speed, pitch: n.pitch, narrator: true };
  }
  // A character with no voice of its own gets an automatic one (so a group never sounds alike);
  // an AI teammate falls back to the default voice first.
  const chain = card ? [own] : [v.voices[msg?.who], v.voices.default];
  for (const c of chain.filter(Boolean)) { const id = idOf(c, provider); if (id) return { provider, voice: id, speed: c.speed, pitch: c.pitch }; }
  const ids = list.map((x) => x.id);
  const auto = autoPick(card ? `card:${card.id}` : `ai:${msg?.who || 'x'}`, ids) || idOf(v.voices.default, provider);
  return { provider, voice: auto, speed: own?.speed ?? v.voices.default?.speed, pitch: own?.pitch ?? v.voices.default?.pitch, auto: true };
}

// Text cut into spoken parts: *narration* and the rest (speech). Code and links are left out.
export function speechParts(text, { narration = 'same' } = {}) {
  const t = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' ').replace(/\*\*([^*]+)\*\*/g, '$1');
  const out = [];
  const push = (kind, s) => {
    const x = s.replace(/[#_`>|~*]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!x || !/[\p{L}\p{N}]/u.test(x)) return;
    if (kind === 'narration' && narration === 'skip') return;
    const k = narration === 'same' ? 'speech' : kind;
    const last = out[out.length - 1];
    if (last && last.kind === k && (last.text.length + x.length) < 600) last.text = `${last.text} ${x}`;
    else out.push({ kind: k, text: x });
  };
  let rest = t;
  const re = /\*([^*\n]+)\*/g;
  let m;
  let at = 0;
  while ((m = re.exec(rest))) { push('speech', rest.slice(at, m.index)); push('narration', m[1]); at = m.index + m[0].length; }
  push('speech', rest.slice(at));
  // Long parts are cut at sentence ends, so speaking starts sooner.
  const split = [];
  for (const p of out) {
    if (p.text.length <= 400) { split.push(p); continue; }
    let buf = '';
    for (const s of p.text.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) || [p.text]) {
      if ((buf + s).length > 400 && buf) { split.push({ kind: p.kind, text: buf.trim() }); buf = ''; }
      buf += s;
    }
    if (buf.trim()) split.push({ kind: p.kind, text: buf.trim() });
  }
  return split;
}

// The spoken plan for a set of replies: [{ msgId, who, char, kind, text, provider, voice, ... }].
export function speechPlan({ msgs, cards = [], settings, keys = {}, lists = {}, names = {} }) {
  const v = voiceSettings(settings);
  const plan = [];
  const notices = new Set();
  for (const m of msgs) {
    if (!m || m.who === 'owner' || m.who === 'system' || m.err) continue;
    const r = routeFor({ who: m.who, settings, keys, names });
    if (r.notice) notices.add(r.notice);
    for (const p of speechParts(m.text, { narration: v.narration })) {
      const sel = voiceFor({ msg: m, part: p.kind, cards, settings, provider: r.provider, list: lists[r.provider] || [] });
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
          if (long) { onEnd(t); return 'end'; }
          return 'short';
        }
      } else st.belowSince = null;
      return null;
    },
  };
}

// The queue of parts being spoken. stop() (a barge-in, Stop, closing the view) ends the current
// part and drops the rest at once.
export function createSpeechQueue({ play, cancel = () => {}, onState = () => {} }) {
  let items = [];
  let current = null;
  let gen = 0;
  async function next(g) {
    if (g !== gen) return;
    current = items.shift() || null;
    if (!current) { onState('idle'); return; }
    onState('speaking', current);
    try { await play(current); } catch {}
    if (g === gen) next(g);
  }
  return {
    get current() { return current; },
    get pending() { return items.length; },
    get busy() { return Boolean(current) || items.length > 0; },
    enqueue(parts) { const was = Boolean(current) || items.length > 0; items.push(...parts); if (!was) next(gen); },
    stop() { gen++; items = []; const c = current; current = null; if (c) cancel(c); onState('idle'); return Boolean(c); },
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
