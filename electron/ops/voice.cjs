// Voice notes: transcribed on this computer (whisper.cpp, faster-whisper from the app's Install
// button, or openai-whisper when installed). Audio never goes to a cloud service.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CPP_BINS = ['whisper-cli', 'whisper-cpp', 'whisper.cpp'];
// 3.8: Fast (the default: base first, quick on a laptop's processor) or Most accurate (the biggest model he has), or one
// model he named. whisper.cpp's own test files (for-tests-…) are never used.
const MODEL_ACCURATE = ['large-v3-turbo', 'large-v3-turbo-q8_0', 'large-v3-turbo-q5_0', 'large-v3', 'large-v2', 'medium.en', 'medium', 'small.en', 'small', 'base.en', 'base', 'tiny.en', 'tiny'];
const MODEL_FAST = ['base.en', 'base', 'small.en', 'small', 'tiny.en', 'tiny', 'large-v3-turbo-q5_0', 'large-v3-turbo-q8_0', 'large-v3-turbo', 'medium.en', 'medium', 'large-v3', 'large-v2'];
const MODEL_PREF = MODEL_FAST;
const modelName = (f) => path.basename(String(f || '')).replace(/^ggml-/, '').replace(/\.bin$/, '');
const threads = () => Math.max(1, Math.min(16, (os.cpus?.() || []).length || 4));

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

function pickModel(files, prefer = 'fast') {
  const ggml = files.filter((f) => /^ggml-[\w.-]+\.bin$/.test(path.basename(f)));
  const named = prefer && !['fast', 'accurate'].includes(prefer) ? ggml.find((f) => modelName(f) === prefer) : null;
  if (named) return named;
  for (const p of prefer === 'accurate' ? MODEL_ACCURATE : MODEL_FAST) {
    const hit = ggml.find((f) => path.basename(f) === `ggml-${p}.bin`);
    if (hit) return hit;
  }
  return ggml[0] || null;
}

// find(bin) -> path|null; list(dir) -> file names (or [] when missing).
// 3.7: the Install button beside the mic puts faster-whisper in the app's own folder (no root, no build tools).
const FW_VERSION = '1.1.1';
const fwDir = (home = os.homedir()) => path.join(home, '.local', 'share', 'hearth-ai', 'whisper');
const FW_SCRIPT = `import sys, os
from faster_whisper import WhisperModel
root = os.path.dirname(os.path.abspath(__file__))
m = WhisperModel('base', device='cpu', compute_type='int8', download_root=os.path.join(root, 'models'))
if len(sys.argv) > 1 and sys.argv[1] == '--download':
    print('ok')
    sys.exit(0)
segs, _ = m.transcribe(sys.argv[1], vad_filter=True)
print(' '.join(s.text.strip() for s in segs))
`;
function fwInstalled({ home, exists = fs.existsSync } = {}) {
  const d = fwDir(home);
  const py = path.join(d, 'venv', 'bin', 'python');
  const script = path.join(d, 'transcribe.py');
  return exists(py) && exists(script) && exists(path.join(d, 'installed.json')) ? { py, script } : null;
}
// The install's steps: [label, bin, args, timeout ms]. run(bin, args, { timeoutMs }) -> { ok, err }.
async function fwInstall({ run, home, python = '/usr/bin/python3', writeFile = fs.writeFileSync, mkdir = fs.mkdirSync, onStep = () => {} } = {}) {
  const d = fwDir(home);
  mkdir(d, { recursive: true, mode: 0o700 });
  const py = path.join(d, 'venv', 'bin', 'python');
  const steps = [
    ['Making a Python folder for it', python, ['-m', 'venv', path.join(d, 'venv')], 300000],
    ['Downloading faster-whisper', py, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', `faster-whisper==${FW_VERSION}`], 1200000],
  ];
  for (const [label, bin, args, timeoutMs] of steps) {
    onStep(label);
    const r = await run(bin, args, { timeoutMs });
    if (!r.ok) return { ok: false, message: `${label} didn't work: ${String(r.err || '').trim().split('\n').slice(-1)[0] || 'no reason given'}` };
  }
  writeFile(path.join(d, 'transcribe.py'), FW_SCRIPT, { mode: 0o600 });
  onStep('Downloading the speech model (about 150 MB)');
  const m = await run(py, [path.join(d, 'transcribe.py'), '--download'], { timeoutMs: 1200000 });
  if (!m.ok) return { ok: false, message: `Downloading the speech model didn't work: ${String(m.err || '').trim().split('\n').slice(-1)[0] || 'no reason given'}` };
  writeFile(path.join(d, 'installed.json'), JSON.stringify({ tool: 'faster-whisper', version: FW_VERSION, at: new Date().toISOString() }), { mode: 0o600 });
  return { ok: true };
}

function detect({ find, list, home, exists, prefer = 'fast' } = {}) {
  const models = [];
  for (const d of modelDirs(home)) for (const f of list(d)) models.push(path.join(d, f));
  const model = pickModel(models, prefer);
  const have = [...new Set(models.filter((f) => /^ggml-[\w.-]+\.bin$/.test(path.basename(f))).map(modelName))];
  for (const b of CPP_BINS) {
    const bin = find(b);
    if (bin) return model ? { tool: 'whisper.cpp', bin, model, name: modelName(model), models: have, fast: prefer !== 'accurate' } : { tool: null, missing: `whisper.cpp is installed (${b}) but no ggml model was found; download one (e.g. ggml-base.en.bin) into ~/.cache/whisper.cpp` };
  }
  const fw = fwInstalled({ home, exists });
  if (fw) return { tool: 'faster-whisper', bin: fw.py, script: fw.script };
  const py = find('whisper');
  if (py) return { tool: 'whisper', bin: py };
  return { tool: null, canInstall: true, missing: 'transcription unavailable: install whisper.cpp, or press Install speech to text beside the mic' };
}

// 3.8: every processor thread (it used 4), and Fast decodes greedily (one guess instead of five).
function cppArgs(model, wav, { fast = true, n = threads() } = {}) {
  return ['-m', model, '-f', wav, '-nt', '-np', '-l', 'auto', '-t', String(n), ...(fast ? ['-bs', '1', '-bo', '1'] : [])];
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

module.exports = { modelName, MODEL_FAST, MODEL_ACCURATE, threads, detect, fwInstall, fwInstalled, fwDir, FW_SCRIPT, FW_VERSION, cppArgs, pyArgs, cleanTranscript, pickModel, modelDirs, listDir, CPP_BINS };
