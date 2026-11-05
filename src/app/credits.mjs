// Credits and licences for the free voice engines and the server programs the app can talk to
// (shown in Settings › App updates › Credits). None of their code is in the app: the speech
// servers are reached over HTTP on the owner's own PCs, and the tools on this PC run as separate
// programs. This file is the one place that names a copyleft licence (the guard test in
// test/roleplay-cards.test.cjs allows it here only).
export const VOICE_CREDITS = [
  // Engines (the voice models)
  { kind: 'engine', name: 'Kokoro (Kokoro-82M)', by: 'hexgrad', licence: 'Apache License 2.0' },
  { kind: 'engine', name: 'Chatterbox', by: 'Resemble AI', licence: 'MIT License' },
  { kind: 'engine', name: 'Sesame CSM (CSM-1B)', by: 'Sesame AI Labs', licence: 'Apache License 2.0' },
  { kind: 'engine', name: 'Dia (Dia-1.6B)', by: 'Nari Labs', licence: 'Apache License 2.0' },
  { kind: 'engine', name: 'CosyVoice2', by: 'FunAudioLLM (Alibaba Tongyi Lab)', licence: 'Apache License 2.0' },
  { kind: 'engine', name: 'Orpheus TTS', by: 'Canopy Labs', licence: 'Apache License 2.0 (code); the model weights are a Llama 3.2 fine-tune under Meta\'s Llama 3.2 Community License (see the model card)' },
  // Server programs (reached over HTTP only)
  { kind: 'server', name: 'Kokoro-FastAPI', by: 'remsky', licence: 'Apache License 2.0' },
  { kind: 'server', name: 'chatterbox-tts-api', by: 'travisvn', licence: 'GNU Affero General Public License v3.0 (AGPL-3.0)', note: 'The app only talks to it over HTTP; none of its code is used or copied.' },
  { kind: 'server', name: 'Chatterbox-TTS-Server', by: 'devnen', licence: 'MIT License' },
  { kind: 'server', name: 'Dia-TTS-Server', by: 'devnen', licence: 'MIT License' },
  { kind: 'server', name: 'Orpheus-FastAPI', by: 'Lex-au', licence: 'Apache License 2.0' },
  { kind: 'server', name: 'sesame_csm_openai', by: 'phildougherty', licence: 'See its repository (not confirmed when this list was made)' },
  { kind: 'server', name: 'CosyVoice FastAPI server', by: 'FunAudioLLM (part of CosyVoice)', licence: 'Apache License 2.0' },
  // On this PC (run as separate programs, found if installed)
  { kind: 'local', name: 'whisper.cpp', by: 'ggml-org', licence: 'MIT License' },
  { kind: 'local', name: 'Piper', by: 'Rhasspy / Open Home Foundation', licence: 'MIT License (newer piper1-gpl releases: GPL-3.0)' },
  { kind: 'local', name: 'eSpeak NG', by: 'the eSpeak NG authors', licence: 'GPL-3.0 or later' },
];
const KINDS = { engine: 'Voice engines', server: 'Speech server programs (on your PCs, reached over HTTP)', local: 'Programs on this PC (run separately when installed)' };

export function creditsHtml(esc) {
  return `<div class="box" id="credits"><h3>Credits</h3>
    <p class="fine">The free voices come from these open-source projects. None of their code is inside the app: speech servers run on your own PCs and are reached over HTTP, and the tools on this PC run as separate programs.</p>
    ${Object.entries(KINDS).map(([k, title]) => `<div class="mh">${esc(title)}</div><table class="credits"><thead><tr><th>Project</th><th>By</th><th>Licence</th></tr></thead><tbody>${VOICE_CREDITS.filter((c) => c.kind === k).map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.by)}</td><td>${esc(c.licence)}${c.note ? `<div class="faint">${esc(c.note)}</div>` : ''}</td></tr>`).join('')}</tbody></table>`).join('')}</div>`;
}
