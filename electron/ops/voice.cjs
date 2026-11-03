// Voice notes: transcribed on this computer only (whisper.cpp or openai-whisper when
// installed). Audio never goes to a cloud service.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CPP_BINS = ['whisper-cli', 'whisper-cpp', 'whisper.cpp'];
const MODEL_PREF = ['base.en', 'base', 'small.en', 'small', 'tiny.en', 'tiny', 'medium.en', 'medium'];

function modelDirs(home = os.homedir()) {
  return [
    path.join(home, '.cache', 'whisper.cpp'),
    path.join(home, '.cache', 'whisper'),
    path.join(home, '.local', 'share', 'whisper.cpp', 'models'),
    path.join(home, 'whisper.cpp', 'models'),
    '/usr/share/whisper.cpp/models',
    '/usr/local/share/whisper.cpp/models',
    '/usr/share/whisper-cpp/models',
  ];
}

function pickModel(files) {
  const ggml = files.filter((f) => /ggml-[\w.-]+\.bin$/.test(path.basename(f)));
  for (const p of MODEL_PREF) {
    const hit = ggml.find((f) => path.basename(f) === `ggml-${p}.bin`);
    if (hit) return hit;
  }
  return ggml[0] || null;
}

// find(bin) -> path|null; list(dir) -> file names (or [] when missing).
function detect({ find, list, home } = {}) {
  const models = [];
  for (const d of modelDirs(home)) for (const f of list(d)) models.push(path.join(d, f));
  const model = pickModel(models);
  for (const b of CPP_BINS) {
    const bin = find(b);
    if (bin) return model ? { tool: 'whisper.cpp', bin, model } : { tool: null, missing: `whisper.cpp is installed (${b}) but no ggml model was found; download one (e.g. ggml-base.en.bin) into ~/.cache/whisper.cpp` };
  }
  const py = find('whisper');
  if (py) return { tool: 'whisper', bin: py };
  return { tool: null, missing: 'transcription unavailable: install whisper.cpp' };
}

function cppArgs(model, wav) {
  return ['-m', model, '-f', wav, '-nt', '-np', '-l', 'auto'];
}
function pyArgs(file, outDir) {
  return [file, '--model', 'base', '--output_format', 'txt', '--output_dir', outDir, '--fp16', 'False', '--verbose', 'False'];
}

function cleanTranscript(text) {
  return String(text || '')
    .replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE)\]|\((?:music|silence|noise)\)/gi, ' ')
    .replace(/^\s*\[[\d:.\s>-]+\]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);
}

const listDir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };

module.exports = { detect, cppArgs, pyArgs, cleanTranscript, pickModel, modelDirs, listDir, CPP_BINS };
