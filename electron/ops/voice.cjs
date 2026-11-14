// Voice notes: transcribed on this computer (whisper.cpp, faster-whisper from the app's Install
// button, or openai-whisper when installed). Audio never goes to a cloud service.
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

function detect({ find, list, home, exists } = {}) {
  const models = [];
  for (const d of modelDirs(home)) for (const f of list(d)) models.push(path.join(d, f));
  const model = pickModel(models);
  for (const b of CPP_BINS) {
    const bin = find(b);
    if (bin) return model ? { tool: 'whisper.cpp', bin, model } : { tool: null, missing: `whisper.cpp is installed (${b}) but no ggml model was found; download one (e.g. ggml-base.en.bin) into ~/.cache/whisper.cpp` };
  }
  const fw = fwInstalled({ home, exists });
  if (fw) return { tool: 'faster-whisper', bin: fw.py, script: fw.script };
  const py = find('whisper');
  if (py) return { tool: 'whisper', bin: py };
  return { tool: null, canInstall: true, missing: 'transcription unavailable: install whisper.cpp, or press Install speech to text beside the mic' };
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

module.exports = { detect, fwInstall, fwInstalled, fwDir, FW_SCRIPT, FW_VERSION, cppArgs, pyArgs, cleanTranscript, pickModel, modelDirs, listDir, CPP_BINS };
