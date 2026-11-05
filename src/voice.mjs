// Voice chat in the window: the Talk view (big mic, waveform, hands-free or push to talk,
// barge-in), dictation into the message box, read aloud, Settings › Voice and the character
// voice picker. The logic without the DOM is in src/app/voice-logic.mjs; the main process side
// (speech to text, voices, keys) is electron/voice-chat.cjs.
// Nothing here writes settings: saving is done only by main.js, from the owner's clicks.
import { voiceSettings, speechPlan, createTurnTaker, createSpeechQueue, newReplies, uncensoredOnly, PROVIDER_NAMES, UNCENSORED, voiceFor, routeFor } from './app/voice-logic.mjs';

const PHASE_TEXT = { off: 'Microphone off', listening: 'Listening…', hearing: 'Hearing you…', transcribing: 'Turning your words into text…', thinking: 'Waiting for the reply…', speaking: 'Speaking', ptt: 'Hold the mic (or Space) to talk' };

export function createVoice(ctx) {
  const { call, api, esc, icon, toast } = ctx;
  const V = {
    open: false, chatId: null, phase: 'off', heard: '', error: '', notice: '', speakingWho: null, speakingName: '', status: null, lists: { elevenlabs: null, openai: null, local: null }, listErr: {},
    readingId: null, dictating: null, sttLabel: '', ttsLabel: '',
  };
  let mic = null; // { stream, ac, analyser, src }
  let rec = null; // { mr, parts, discard }
  let raf = 0;
  let thinking = null; // { chatId, since, idleAt }
  let playCtx = null;
  const pending = new Map(); // stream token -> { chunks: [], ended: null, onChunk, onEnd }
  const settings = () => voiceSettings(ctx.settings());
  const keys = () => V.status?.keys || {};

  // ---------- streamed audio from the main process ----------
  api?.onVoiceChunk?.((e) => { const p = pending.get(e.token) || pending.set(e.token, { chunks: [], ended: null }).get(e.token); if (p.onChunk) p.onChunk(e.data); else p.chunks.push(e.data); });
  api?.onVoiceEnd?.((e) => { const p = pending.get(e.token) || pending.set(e.token, { chunks: [], ended: null }).get(e.token); p.ended = e; p.onEnd?.(e); setTimeout(() => pending.delete(e.token), 30000); });

  function audioCtx() { if (!playCtx) { try { playCtx = new AudioContext(); } catch { playCtx = null; } } return playCtx; }
  let playing = null; // { audio, analyser, token, done }
  function playAudioEl(audio, token) {
    return new Promise((resolve) => {
      const ac = audioCtx();
      let analyser = null;
      if (ac) { try { const src = ac.createMediaElementSource(audio); analyser = ac.createAnalyser(); analyser.fftSize = 1024; src.connect(analyser); analyser.connect(ac.destination); ac.resume?.(); } catch { analyser = null; } }
      const done = () => { if (playing?.audio === audio) playing = null; try { URL.revokeObjectURL(audio.src); } catch {} resolve(); };
      playing = { audio, analyser, token, done };
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    });
  }
  function playStream(token, mime) {
    const p = pending.get(token) || pending.set(token, { chunks: [], ended: null }).get(token);
    const audio = new Audio();
    if (window.MediaSource && MediaSource.isTypeSupported(mime)) {
      const ms = new MediaSource();
      audio.src = URL.createObjectURL(ms);
      const queue = [...p.chunks];
      p.chunks = [];
      let sb = null;
      let ended = Boolean(p.ended);
      const pump = () => {
        if (!sb || sb.updating) return;
        if (queue.length) { try { sb.appendBuffer(queue.shift()); } catch { queue.length = 0; } return; }
        if (ended && ms.readyState === 'open') { try { ms.endOfStream(); } catch {} }
      };
      ms.addEventListener('sourceopen', () => { try { sb = ms.addSourceBuffer(mime); sb.addEventListener('updateend', pump); pump(); } catch {} }, { once: true });
      p.onChunk = (d) => { queue.push(d); pump(); };
      p.onEnd = () => { ended = true; pump(); };
      return playAudioEl(audio, token);
    }
    // No streaming playback: play when the whole reply is in.
    return new Promise((resolve) => {
      const finish = () => { const blob = new Blob(p.chunks, { type: mime }); audio.src = URL.createObjectURL(blob); playAudioEl(audio, token).then(resolve); };
      if (p.ended) finish(); else p.onEnd = finish;
    });
  }
  function speakSystem(text, voiceId, part) {
    const synth = window.speechSynthesis;
    const name = String(voiceId || '').startsWith('system:') ? voiceId.slice(7) : null;
    if (synth && synth.getVoices().length) {
      return new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        const v = name ? synth.getVoices().find((x) => x.name === name) : null;
        if (v) u.voice = v;
        if (part?.speed) u.rate = part.speed;
        if (part?.pitch) u.pitch = part.pitch;
        u.onend = resolve; u.onerror = resolve;
        playing = { system: true, done: resolve };
        synth.speak(u);
      });
    }
    // speech-dispatcher / espeak by themselves (no waveform; ends after a rough time).
    return call('ttsSpeak', text).then((r) => {
      if (!r?.ok) { V.notice = r?.message || 'No voice on this PC: install espeak-ng, Piper or Kokoro, or pick ElevenLabs or OpenAI in Settings › Voice.'; ctx.renderOverlay(); return null; }
      return new Promise((resolve) => { const t = setTimeout(resolve, Math.min(60000, 800 + text.split(/\s+/).length * 380)); playing = { system: true, done: () => { clearTimeout(t); resolve(); } }; });
    });
  }
  async function playPart(part) {
    V.speakingWho = part.who; V.speakingChar = part.char || null;
    V.speakingName = part.narrator ? 'Narrator' : part.char ? (ctx.cardById(part.char)?.name || '') : ctx.aiName(part.who);
    if (part.kind === 'narration' && !part.narrator) V.speakingName = `${V.speakingName} (narration)`;
    ctx.renderOverlay();
    const r = await call('voiceSpeak', { provider: part.provider, voice: part.voice, speed: part.speed, pitch: part.pitch, text: part.text, who: part.who, chatId: V.chatId || ctx.openId() });
    if (!r?.ok) { V.notice = r?.message || 'Couldn\'t speak this part.'; ctx.renderOverlay(); return; }
    V.ttsLabel = r.system ? 'your system voice' : PROVIDER_NAMES[part.provider];
    if (r.system) return speakSystem(part.text, part.voice, part);
    if (r.audio) { const a = new Audio(URL.createObjectURL(new Blob([r.audio], { type: r.mime || 'audio/wav' }))); return playAudioEl(a, null); }
    if (r.token) return playStream(r.token, r.mime || 'audio/mpeg');
  }
  function cancelPart() {
    const p = playing;
    playing = null;
    if (!p) return;
    if (p.system) { try { window.speechSynthesis?.cancel(); } catch {} call('ttsStop'); }
    if (p.audio) { try { p.audio.pause(); } catch {} }
    if (p.token) call('voiceCancel', p.token);
    p.done?.();
  }
  const queue = createSpeechQueue({
    play: playPart,
    cancel: cancelPart,
    onState: (s) => {
      if (s === 'idle') {
        V.speakingWho = null; V.speakingChar = null; V.speakingName = ''; V.readingId = null;
        turn.setSpeaking(false);
        if (V.open && V.phase === 'speaking') { stopRecording(true).then(() => { if (V.open && V.phase !== 'hearing') resumeListening(); }); V.phase = settings().turn === 'ptt' ? 'ptt' : 'listening'; }
        ctx.rerender();
      } else if (V.open) {
        V.phase = 'speaking'; turn.setSpeaking(true);
        // Recording while a reply plays (echo cancelled), so a barge-in keeps his first words.
        if (settings().bargeIn && settings().turn !== 'ptt' && !rec) startRecording();
      }
    },
  });

  // ---------- turn taking ----------
  const turn = createTurnTaker({
    onStart: () => { if (V.open && V.phase === 'listening') { V.phase = 'hearing'; ctx.renderOverlay(); } },
    onEnd: () => { if (V.open && V.phase === 'hearing') finishRecording(); },
    // Phase first, so stopping the reply keeps the recording that holds his first words.
    onBarge: () => { if (!V.open) return; V.phase = 'hearing'; queue.stop(); if (!rec) startRecording(); V.notice = ''; ctx.renderOverlay(); },
  });

  async function ensureMic() {
    if (mic) return mic;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Voice isn\'t available here.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const ac = new AudioContext();
    const src = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    mic = { stream, ac, analyser, src, buf: new Float32Array(analyser.fftSize) };
    return mic;
  }
  function releaseMic() {
    if (!mic) return;
    try { mic.stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { mic.ac.close(); } catch {}
    mic = null;
  }
  function resumeListening() {
    const ptt = settings().turn === 'ptt';
    V.phase = ptt ? 'ptt' : 'listening';
    turn.reset();
    if (!ptt) startRecording();
  }
  function startRecording() {
    if (!mic || rec) return;
    const mime = MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    const mr = new MediaRecorder(mic.stream, mime ? { mimeType: mime } : undefined);
    const r = { mr, parts: [], discard: false, at: Date.now() };
    mr.ondataavailable = (e) => { if (e.data?.size) r.parts.push(e.data); };
    mr.start(250);
    rec = r;
  }
  function stopRecording(discard = false) {
    const r = rec;
    rec = null;
    if (!r) return Promise.resolve(null);
    r.discard = discard;
    return new Promise((resolve) => { r.mr.onstop = () => resolve(discard ? null : new Blob(r.parts, { type: r.mr.mimeType || 'audio/webm' })); try { r.mr.stop(); } catch { resolve(null); } });
  }
  async function transcribe(blob) {
    const c = ctx.entry(V.chatId || ctx.openId());
    const r = await call('voiceTranscribe', await blob.arrayBuffer(), { mime: blob.type, chatId: c?.temp ? null : c?.id, uncensoredOnly: uncensoredOnly({ chat: c, mode: ctx.mode() }) });
    if (r?.via) V.sttLabel = r.via;
    return r;
  }
  async function finishRecording() {
    V.phase = 'transcribing';
    ctx.renderOverlay();
    const blob = await stopRecording();
    if (!V.open) return;
    if (!blob || blob.size < 2500) { resumeListening(); ctx.renderOverlay(); return; }
    const r = await transcribe(blob);
    if (!V.open) return;
    if (!r?.ok || !String(r.text || '').trim()) {
      V.error = r?.ok ? '' : (r?.message || 'Couldn\'t turn that into text.');
      resumeListening();
      ctx.renderOverlay();
      return;
    }
    V.error = '';
    V.heard = r.text;
    const R = ctx.rt(V.chatId);
    thinking = { chatId: V.chatId, since: R ? R.msgs.length : 0, at: Date.now(), idleAt: null };
    V.phase = 'thinking';
    ctx.renderOverlay();
    await ctx.send(r.text, r.item ? { media: [r.item] } : null);
  }
  // A reply round is over: speak every new reply (all characters in a group, in order).
  function roundDone(R) {
    if (!thinking || !V.open || R.id !== thinking.chatId) return false;
    const msgs = newReplies(R.msgs, thinking.since);
    thinking = null;
    if (!msgs.length || !speak(msgs)) { resumeListening(); ctx.renderOverlay(); return true; }
    return true;
  }

  // ---------- the frame loop: level, VAD, waveform ----------
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (!V.open) return;
    let level = 0;
    if (mic) { mic.analyser.getFloatTimeDomainData(mic.buf); let s = 0; for (const x of mic.buf) s += x * x; level = Math.sqrt(s / mic.buf.length); }
    if (V.phase === 'listening' || V.phase === 'hearing' || V.phase === 'speaking') turn.feed(level, t);
    // Nothing said for a while: start a fresh recording so it never grows large.
    if (V.phase === 'listening' && rec && Date.now() - rec.at > 30000 && !turn.state.inSpeech) { stopRecording(true); startRecording(); }
    // A round that ended without the runner telling us (an error, nothing to say).
    if (thinking && Date.now() - thinking.at > 1500) {
      const R = ctx.rt(thinking.chatId);
      const idle = R && !R.round && !R.waiting && !R.busy;
      if (idle) { thinking.idleAt ??= Date.now(); if (Date.now() - thinking.idleAt > 1200) roundDone(R); } else if (thinking) thinking.idleAt = null;
    }
    draw(level);
  }
  function draw(level) {
    const cv = document.getElementById('vwave');
    if (!cv) return;
    const g = cv.getContext('2d');
    const w = cv.width = cv.clientWidth * (window.devicePixelRatio || 1);
    const h = cv.height = cv.clientHeight * (window.devicePixelRatio || 1);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(cv);
    const an = V.phase === 'speaking' && playing?.analyser ? playing.analyser : mic?.analyser;
    g.lineWidth = 2 * (window.devicePixelRatio || 1);
    g.strokeStyle = css.getPropertyValue(V.phase === 'speaking' ? '--vw-speak' : '--vw-listen').trim() || '#e08a4c';
    g.beginPath();
    if (an) {
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) { const x = (i / (buf.length - 1)) * w; const y = h / 2 + buf[i] * h * 0.9; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    } else { g.moveTo(0, h / 2); g.lineTo(w, h / 2); }
    g.stroke();
    const ring = document.getElementById('vmic');
    if (ring) ring.style.setProperty('--lvl', String(Math.min(1, level * 9)));
  }

  // ---------- public ----------
  async function loadStatus() { V.status = (await call('voiceStatus')) || V.status; return V.status; }
  async function loadList(provider, fresh = false) {
    const r = await call('voiceVoices', provider, fresh);
    if (r?.ok) { V.lists[provider] = r.voices; V.listErr[provider] = null; } else { V.lists[provider] = V.lists[provider] || []; V.listErr[provider] = r?.message || null; }
    if (provider === 'local') {
      const sys = (window.speechSynthesis?.getVoices?.() || []).map((v) => ({ id: `system:${v.name}`, name: `${v.name} (system voice)`, engine: 'system', pitch: true }));
      V.lists.local = [...V.lists.local, ...sys];
    }
    return V.lists[provider];
  }
  async function loadLists() { await loadStatus(); await Promise.all(['local', 'openai', ...(keys().elevenlabs ? ['elevenlabs'] : [])].map((p) => loadList(p))); }
  function speak(msgs) {
    const s = ctx.settings();
    const { plan, notices } = speechPlan({ msgs, cards: ctx.cards(), settings: s, keys: keys(), lists: V.lists, names: Object.fromEntries(UNCENSORED.map((a) => [a, ctx.aiName(a)])) });
    if (notices.length) { V.notice = notices[0]; if (!V.open) toast(notices[0]); }
    if (!plan.length) return false;
    queue.enqueue(plan);
    return true;
  }
  async function openView(chatId) {
    if (V.open) return;
    V.open = true; V.chatId = chatId; V.heard = ''; V.error = ''; V.notice = '';
    V.phase = 'listening';
    ctx.rerender();
    try { await ensureMic(); } catch (e) { V.error = `Microphone: ${String(e?.message || e)}`; V.phase = 'off'; ctx.renderOverlay(); }
    turn.setMode(settings().turn); turn.setBargeIn(settings().bargeIn); turn.reset();
    if (V.phase !== 'off') resumeListening();
    if (!raf) raf = requestAnimationFrame(frame);
    loadLists().then(() => ctx.renderOverlay());
    ctx.renderOverlay();
  }
  function closeView() {
    if (!V.open) return;
    V.open = false; thinking = null;
    queue.stop();
    stopRecording(true);
    releaseMic();
    call('voiceStopAll');
    cancelAnimationFrame(raf); raf = 0;
    V.phase = 'off';
    ctx.rerender();
  }
  // Push to talk (the mic button held, or Space held, in the Talk view).
  async function pttDown() {
    if (!V.open || !mic) return;
    if (V.phase === 'transcribing' || V.phase === 'thinking') return;
    V.phase = 'hearing';
    if (queue.busy) queue.stop();
    await stopRecording(true);
    startRecording();
    ctx.renderOverlay();
  }
  function pttUp() { if (V.open && V.phase === 'hearing' && settings().turn === 'ptt') finishRecording(); }
  // The composer's mic: what he says goes into the message box.
  async function dictate() {
    if (V.dictating) { const blob = await stopRecordingDictation(); return blob; }
    try {
      const m = await ensureMic();
      const mime = MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const mr = new MediaRecorder(m.stream, mime ? { mimeType: mime } : undefined);
      const parts = [];
      mr.ondataavailable = (e) => { if (e.data?.size) parts.push(e.data); };
      mr.onstop = async () => {
        V.dictating = null;
        if (!V.open) releaseMic();
        ctx.rerender();
        const blob = new Blob(parts, { type: mr.mimeType || 'audio/webm' });
        if (blob.size < 2500) return toast('Too short. Click the mic, talk, then click it again.');
        toast('Turning your voice into text…');
        const r = await transcribe(blob);
        if (r?.ok && r.text) ctx.addDraft(r.text, r.via);
        else toast(r?.message || 'No words were heard.');
      };
      mr.start(250);
      V.dictating = mr;
      ctx.rerender();
    } catch (e) { toast(`Microphone: ${String(e?.message || e)}`); }
    return null;
  }
  function stopRecordingDictation() { try { V.dictating?.stop(); } catch {} return null; }
  // Read aloud one message (the button on a message), or stop it.
  async function readAloud(m) {
    if (!m) return;
    if (V.readingId === m.id) { queue.stop(); return; }
    queue.stop();
    if (!V.status) await loadStatus();
    const prov = routeFor({ who: m.who, settings: ctx.settings(), keys: keys() }).provider;
    if (!V.lists[prov]) await loadList(prov);
    V.readingId = m.id;
    if (!speak([m])) V.readingId = null;
    ctx.rerender();
  }
  function stopSpeaking() { queue.stop(); }
  // A short sample of a voice (Settings › Voice, the character editor).
  async function preview(spec, text) {
    queue.stop();
    if (!V.status) await loadStatus();
    queue.enqueue([{ msgId: null, who: spec.who || 'owner', char: null, kind: 'speech', text: text || 'Hello! This is how I sound. The fire is warm and the road is long.', provider: spec.provider, voice: spec.voice, speed: spec.speed, pitch: spec.pitch }]);
  }

  // ---------- HTML ----------
  function castHtml() {
    const c = ctx.entry(V.chatId);
    const s = ctx.settings();
    const rows = [];
    const add = (msg, label, avatar) => {
      const r = routeFor({ who: msg.who, settings: s, keys: keys() });
      const sel = voiceFor({ msg, cards: ctx.cards(), settings: s, provider: r.provider, list: V.lists[r.provider] || [] });
      const vn = (V.lists[r.provider] || []).find((x) => x.id === sel.voice)?.name || (sel.voice ? String(sel.voice).replace(/^(kokoro|piper|espeak|system):/, '').split('/').pop() : 'system voice');
      rows.push(`<div class="vcast-it ${V.speakingWho === msg.who && (V.speakingChar || null) === (msg.char || null) ? 'on' : ''}">${avatar}<b>${esc(label)}</b><span class="faint">${esc(vn)}${sel.auto ? ' (auto)' : ''} · ${esc(PROVIDER_NAMES[r.provider])}</span></div>`);
    };
    if (c?.rp) for (const id of c.rp.characters || []) { const card = ctx.cardById(id); if (card) add({ who: c.rp.players?.[id] || ctx.lead(), char: id }, card.name, ctx.avatar(card)); }
    else for (const a of ctx.members()) add({ who: a }, ctx.aiName(a), ctx.mono(a));
    return rows.length ? `<div class="vcast" id="vcast">${rows.join('')}</div>` : '';
  }
  function viewHtml() {
    if (!V.open) return '';
    const s = settings();
    const c = ctx.entry(V.chatId);
    const ptt = s.turn === 'ptt';
    const phaseText = V.phase === 'speaking' ? `${V.speakingName || 'Speaking'}…` : PHASE_TEXT[V.phase] || '';
    const st = V.status;
    const sttNow = V.sttLabel || st?.stt?.using || st?.stt?.problem || 'checking…';
    const prov = s.tts;
    const ttsNow = `${PROVIDER_NAMES[prov]}${prov === 'local' ? ' (free, nothing leaves your PC)' : `: the reply text goes to ${PROVIDER_NAMES[prov]}`}`;
    const recent = (ctx.rt(V.chatId)?.msgs || []).filter((m) => !m.deleted && m.who !== 'system').slice(-4);
    return `<div class="voice" id="voice-view" role="dialog" aria-label="Talk">
      <div class="voice-hd"><b>${icon('mic', 'sm')}Talk</b><span class="faint">${esc(c?.title || '')}</span><span class="grow"></span>
        <button class="chip ${ptt ? '' : 'on'}" data-a="voice-turn" data-v="auto" title="It listens and answers when you stop talking">Hands-free</button><button class="chip ${ptt ? 'on' : ''}" data-a="voice-turn" data-v="ptt" title="Hold the mic or Space while you talk">Push to talk</button>
        <button class="chip sw ${s.bargeIn ? 'on' : ''}" data-a="voice-barge" aria-pressed="${s.bargeIn}" title="Talking over a reply stops it">Interrupt by talking</button>
        <button class="ib" data-a="voice-close" title="Close (Esc)" aria-label="Close">${icon('x', 'sm')}</button></div>
      ${castHtml()}
      <div class="voice-mid">
        <button class="vmic ${V.phase}" id="vmic" data-vptt="1" aria-label="${ptt ? 'Hold to talk' : 'Microphone'}" title="${ptt ? 'Hold to talk' : V.phase === 'speaking' ? 'Click to stop the reply' : 'Listening'}">${icon(V.phase === 'speaking' ? 'stop' : 'mic')}</button>
        <canvas id="vwave" class="vwave" aria-hidden="true"></canvas>
        <div class="vphase" id="vphase">${esc(phaseText)}</div>
        ${V.heard ? `<div class="vheard">“${esc(V.heard.slice(0, 300))}”</div>` : ''}
        ${V.error ? `<div class="note bad">${esc(V.error)}</div>` : ''}${V.notice ? `<div class="note warn">${esc(V.notice)}</div>` : ''}
      </div>
      <div class="vlog">${recent.map((m) => `<div class="vl ${m.who === 'owner' ? 'me' : ''}"><b>${esc(m.who === 'owner' ? 'You' : m.char ? (ctx.cardById(m.char)?.name || '') : ctx.aiName(m.who))}</b> ${esc(String(m.text || '').replace(/\s+/g, ' ').slice(0, 220))}</div>`).join('')}</div>
      <div class="voice-ft" id="voice-privacy">${icon('eye', 'sm')}<span>Speech to text: <b>${esc(sttNow)}</b> · Voices: <b>${esc(ttsNow)}</b> · ${s.keepAudio ? 'recordings are kept in the chat\'s media folder' : 'only the transcript is saved, no audio'}</span><button class="mini" data-a="voice-settings">Settings › Voice</button></div>
    </div>`;
  }

  // A voice picker for one key: 'set:default', 'set:narrator', 'set:<agent>' or 'card'.
  function pickerHtml(key, provider, current, { label = '', who = '' } = {}) {
    const list = V.lists[provider];
    const curId = provider === 'elevenlabs' ? current?.elevenlabs?.id : current?.[provider];
    const opts = (list || []).map((v) => `<option value="${esc(v.id)}" ${v.id === curId ? 'selected' : ''}>${esc(v.name)}${v.category && v.category !== 'premade' ? ` · ${esc(v.category)}` : ''}</option>`).join('');
    const missing = curId && !(list || []).some((v) => v.id === curId) ? `<option value="${esc(curId)}" selected>${esc(current?.elevenlabs?.name || curId)}</option>` : '';
    return `<span class="vpick">${label ? `<span class="d">${esc(label)}</span>` : ''}<select data-vpick="${esc(key)}" data-prov="${provider}" aria-label="Voice${label ? ` for ${esc(label)}` : ''}"><option value="">${provider === 'local' ? 'automatic' : 'automatic'}</option>${missing}${opts}</select><button class="mini" data-a="voice-preview" data-k="${esc(key)}" data-prov="${provider}" data-who="${esc(who)}" title="Hear it">${icon('play', 'sm')}Preview</button></span>`;
  }
  function settingsHtml({ tog, team, mono, aiName, mediaKeys }) {
    const s = settings();
    const st = V.status || {};
    const k = st.keys || {};
    const prov = s.tts;
    const prows = [
      ['elevenlabs', 'ElevenLabs', 'the most realistic voices · your own ElevenLabs key · the reply text goes to ElevenLabs'],
      ['openai', 'OpenAI', 'natural preset voices · your OpenAI key · the reply text goes to OpenAI'],
      ['local', 'This PC (free)', `${[st.local?.kokoro ? 'Kokoro' : '', st.local?.piper ? `Piper (${st.local.piper} voice${st.local.piper > 1 ? 's' : ''})` : '', st.local?.espeak || ''].filter(Boolean).join(', ') || 'system voices (Web Speech / speech-dispatcher)'} · runs on the CPU · nothing leaves your PC`],
    ];
    const listNote = V.listErr[prov] ? `<div class="note warn">${esc(V.listErr[prov])}</div>` : '';
    const sttLocal = st.stt?.local?.tool ? `${st.stt.local.tool} found` : (st.stt?.local?.missing || 'not found');
    return `<h1>Voice</h1>
      <div class="box" id="voice-how"><h3>${icon('mic', 'sm')}Voice chat</h3>
        <p class="fine">Press <b>Talk</b> next to the message box. You speak, the app turns it into text, the chat's AI or characters answer, and the answer is spoken in their voices. Talk over a reply to interrupt it.</p>
        <div class="srow">Taking turns<span class="d">hands-free listens and answers when you stop talking; push to talk waits while you hold the mic or Space</span><span class="grow"></span><select data-a="voice-set" data-k="turn"><option value="auto" ${s.turn === 'auto' ? 'selected' : ''}>Hands-free</option><option value="ptt" ${s.turn === 'ptt' ? 'selected' : ''}>Push to talk</option></select></div>
        <div class="srow">Interrupt by talking<span class="d">talking over a reply stops it and listens</span><span class="grow"></span>${tog(s.bargeIn, 'voice-barge')}</div>
        <div class="srow">Read every answer aloud<span class="d">also outside the Talk view (off: use the read-aloud button on any answer)</span><span class="grow"></span>${tog(ctx.settings().autoRead === true, 'auto-read')}</div></div>
      <div class="box" id="voice-stt"><h3>${icon('doc', 'sm')}Speech to text</h3>
        <div class="srow">Use<span class="d">whisper.cpp on this PC is free and private; OpenAI uses your OpenAI key</span><span class="grow"></span><select data-a="voice-set" data-k="stt"><option value="auto" ${s.stt === 'auto' ? 'selected' : ''}>Automatic (this PC when installed)</option><option value="local" ${s.stt === 'local' ? 'selected' : ''}>This PC only (whisper.cpp)</option><option value="openai" ${s.stt === 'openai' ? 'selected' : ''}>OpenAI</option></select></div>
        <div class="srow">Now in use<span class="d"><b>${esc(st.stt?.using || st.stt?.problem || 'checking…')}</b></span></div>
        <div class="srow">On this PC<span class="d">${esc(sttLocal)}${st.stt?.local?.tool === 'whisper.cpp' && !st.stt?.ffmpeg ? ' · ffmpeg is missing (needed to read recordings)' : ''}</span></div>
        <div class="srow">OpenAI model<span class="d">used only when OpenAI does the speech to text</span><span class="grow"></span><select data-a="voice-set" data-k="sttModel">${(st.sttModels || ['gpt-transcribe']).map((m) => `<option ${s.sttModel === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div></div>
      <div class="box" id="voice-tts"><h3>${icon('users', 'sm')}Voices</h3>
        <div class="vprov">${prows.map(([id, name, sub]) => `<button class="vp ${prov === id ? 'on' : ''}" data-a="voice-set" data-k="tts" data-v="${id}" aria-pressed="${prov === id}"><b>${esc(name)}</b><small>${esc(sub)}</small>${id !== 'local' ? `<span class="chip ${k[id] ? 'g' : 'b'}">${k[id] ? 'key saved' : 'needs a key'}</span>` : ''}</button>`).join('')}</div>
        <div class="srow">ElevenLabs API key<span class="d">${k.elevenlabs ? 'saved, encrypted on this PC' : 'not set'}${st.encryption === false ? ' · OS encryption is unavailable, so keys can\'t be saved' : ''}</span><span class="grow"></span><input type="password" class="vkey" id="vkey-elevenlabs" placeholder="${k.elevenlabs ? 'Paste a new key to replace it' : 'Paste your ElevenLabs key'}" autocomplete="off" spellcheck="false" aria-label="ElevenLabs API key"><button class="mini" data-a="voice-key" data-k="elevenlabs">Save</button>${k.elevenlabs ? '<button class="mini" data-a="voice-key-remove" data-k="elevenlabs">Remove</button>' : ''}</div>
        <div class="srow">OpenAI API key<span class="d">${k.openai ? 'saved (the same key as pictures in Settings › Accounts)' : 'not set'}</span><span class="grow"></span><input type="password" class="vkey" id="vkey-openai" placeholder="${k.openai ? 'Paste a new key to replace it' : 'Paste your OpenAI key'}" autocomplete="off" spellcheck="false" aria-label="OpenAI API key"><button class="mini" data-a="voice-key" data-k="openai">Save</button></div>
        ${prov === 'elevenlabs' ? `<div class="srow">ElevenLabs model<span class="d">Flash is fastest (best for talking); Multilingual v2 sounds richest</span><span class="grow"></span><select data-a="voice-set" data-k="elevenModel">${(st.elevenModels || ['eleven_flash_v2_5']).map((m) => `<option ${s.elevenModel === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>` : ''}
        ${prov === 'openai' ? `<div class="srow">OpenAI model<span class="d">gpt-4o-mini-tts sounds most natural</span><span class="grow"></span><select data-a="voice-set" data-k="openaiModel">${(st.openaiModels || ['gpt-4o-mini-tts']).map((m) => `<option ${s.openaiModel === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>` : ''}
        ${prov === 'local' && st.local?.notes?.length ? `<div class="note">${st.local.notes.map(esc).join('<br>')}</div>` : ''}
        ${listNote}
        <div class="srow">Default voice<span class="d">for anyone without their own voice</span><span class="grow"></span>${pickerHtml('set:default', prov, s.voices.default)}</div>
        <div class="srow">Narration (*text in asterisks*)<span class="d">read in the same voice, by a narrator, or skipped</span><span class="grow"></span><select data-a="voice-set" data-k="narration"><option value="same" ${s.narration === 'same' ? 'selected' : ''}>Same voice</option><option value="narrator" ${s.narration === 'narrator' ? 'selected' : ''}>Narrator voice</option><option value="skip" ${s.narration === 'skip' ? 'selected' : ''}>Skip it</option></select></div>
        ${s.narration === 'narrator' ? `<div class="srow">Narrator voice<span class="grow"></span>${pickerHtml('set:narrator', prov, s.voices.narrator)}</div>` : ''}
        <div class="mh">A voice per AI teammate (normal chats)</div>
        ${team.members.map((a) => `<div class="srow mem">${mono(a)}<b>${esc(aiName(a))}</b>${UNCENSORED.includes(a) && prov === 'openai' && !s.openaiForUncensored ? `<span class="d">spoken by ${k.elevenlabs ? 'ElevenLabs' : 'this PC'}, not OpenAI</span>` : ''}<span class="grow"></span>${pickerHtml(`set:${a}`, UNCENSORED.includes(a) ? routeFor({ who: a, settings: ctx.settings(), keys: k }).provider : prov, s.voices[a], { who: a })}</div>`).join('')}
        <div class="fine">Characters' voices are picked in each character's editor (Characters › Edit) and kept with the character in this app, never in exported card files.</div></div>
      <div class="box" id="voice-privacy-box"><h3>${icon('eye', 'sm')}Privacy and cost</h3>
        <div class="srow">Who gets what<span class="d">your voice: ${esc(st.stt?.using || 'whisper.cpp on this PC, or OpenAI')} · reply text to speak: ${esc(prov === 'local' ? 'nobody (this PC)' : PROVIDER_NAMES[prov])}</span></div>
        <div class="srow">Venice, Civitai and your GPU server with OpenAI<span class="d">${s.openaiForUncensored ? 'allowed: their replies (and your voice in chats only with them) may go to OpenAI' : 'not allowed: their replies are spoken by ElevenLabs or this PC, never sent to OpenAI'}</span><span class="grow"></span>${tog(s.openaiForUncensored, 'voice-uncensored')}</div>
        ${s.openaiForUncensored ? '<div class="note warn">Their replies are then sent to OpenAI to be spoken. OpenAI may refuse or flag adult text.</div>' : ''}
        <div class="srow">Keep voice recordings<span class="d">${s.keepAudio ? 'on: your recordings and the spoken replies are kept in the chat\'s media folder' : 'off: only the transcript is saved in the chat; no audio is kept'}</span><span class="grow"></span>${tog(s.keepAudio, 'voice-keep')}</div>
        <div class="srow">Cost<span class="d">this PC: free · ElevenLabs and OpenAI charge your own accounts per character spoken (and OpenAI per minute heard)</span></div></div>
      <div class="box" id="voice-clone"><h3>${icon('user', 'sm')}Add your own voice (ElevenLabs)</h3>
        <p class="fine">ElevenLabs can learn a voice from a few clean recordings (one to five files, up to 10 MB each). Only your own voice, or a voice whose owner has given you permission. ElevenLabs needs a paid plan for this and may ask to verify the voice.</p>
        <div class="srow"><input id="clone-name" placeholder="Name for the voice (e.g. My voice)" maxlength="60"><label class="day"><input type="checkbox" id="clone-consent">This is my own voice, or I have the speaker's permission to use it</label><span class="grow"></span><button class="btn" data-a="voice-clone" ${k.elevenlabs ? '' : 'disabled title="Add your ElevenLabs key first"'}>Pick recordings and add</button></div></div>`;
  }
  // The character editor's voice box.
  function cardHtml(card) {
    const s = settings();
    const prov = s.tts;
    const v = card.ownerVoice || (card.voice ? { local: `system:${card.voice}` } : {});
    const speedOk = true;
    const pitchOk = prov === 'local' && /^(espeak|system):/.test(String(v.local || 'system:'));
    return `<div class="box vcard" id="card-voice"><b>${icon('mic', 'sm')}Voice</b>
      <div class="fine">Spoken with ${esc(PROVIDER_NAMES[prov])} (change in Settings › Voice). Kept with the character in this app, not in exported cards.</div>
      ${pickerHtml('card', prov, v)}
      ${speedOk ? `<label class="field">Speed <span class="faint">${esc(String(v.speed || 1))}×</span><input type="range" min="0.7" max="1.3" step="0.05" value="${esc(String(v.speed || 1))}" data-cvoice="speed"></label>` : ''}
      ${pitchOk ? `<label class="field">Pitch <span class="faint">${esc(String(v.pitch || 1))}</span><input type="range" min="0.6" max="1.4" step="0.05" value="${esc(String(v.pitch || 1))}" data-cvoice="pitch"></label>` : '<div class="fine">Pitch can be changed with espeak-ng and system voices only.</div>'}</div>`;
  }

  // Push to talk: hold the big mic, or Space (not while typing). In hands-free mode a click on
  // the mic while a reply plays stops it.
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', (ev) => {
      if (!V.open || !ev.target.closest?.('[data-vptt]')) return;
      ev.preventDefault();
      if (settings().turn === 'ptt') pttDown(); else if (queue.busy) queue.stop();
    });
    document.addEventListener('pointerup', () => { if (V.open) pttUp(); });
    const typing = (t) => /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName || '') || t?.isContentEditable;
    document.addEventListener('keydown', (ev) => { if (V.open && ev.code === 'Space' && !ev.repeat && !typing(ev.target) && settings().turn === 'ptt') { ev.preventDefault(); pttDown(); } });
    document.addEventListener('keyup', (ev) => { if (V.open && ev.code === 'Space' && !typing(ev.target)) { ev.preventDefault(); pttUp(); } });
  }

  return {
    state: V, isOpen: () => V.open, chatId: () => V.chatId, openView, closeView, roundDone, speak, readAloud, stopSpeaking, dictate, preview, pttDown, pttUp,
    loadStatus, loadList, loadLists, viewHtml, settingsHtml, cardHtml, pickerHtml, isReading: (id) => V.readingId === id, dictating: () => Boolean(V.dictating),
    queue, turn, setTurn(mode) { turn.setMode(mode); if (V.open && !queue.busy && !thinking) { stopRecording(true).then(() => { if (V.open) { resumeListening(); ctx.renderOverlay(); } }); } }, setBarge(on) { turn.setBargeIn(on); },
  };
}
