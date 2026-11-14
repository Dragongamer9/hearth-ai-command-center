// 3.7: a voice note on a computer without whisper is turned into text by Speech to text on his Hearth devices
// (the PC's whisper) instead of stopping at "install whisper.cpp".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('voice notes fall back to the Hearth devices\' Speech to text', () => {
  const ops = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ops', 'index.cjs'), 'utf8');
  const save = ops.slice(ops.indexOf("handle('ops:voiceSave'"), ops.indexOf("handle('ops:usage'"));
  assert.match(save, /if \(!tool\.tool\) \{[\s\S]*hearthOf\(\)[\s\S]*\.transcribe\(\{ buf/);
  assert.match(save, /canInstall: true/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /hearth: \(\) => parityApi\?\.hearth \|\| null/);
});

const voice = require('../electron/ops/voice.cjs');

test('Install speech to text: faster-whisper into the app\'s own folder, step by step', async () => {
  const calls = [];
  const files = {};
  const r = await voice.fwInstall({ home: '/h', run: async (bin, args) => { calls.push([bin, ...args].join(' ')); return { ok: true, out: '', err: '' }; }, writeFile: (f, c) => { files[f] = c; }, mkdir: () => {} });
  assert.equal(r.ok, true);
  assert.match(calls[0], /^\/usr\/bin\/python3 -m venv \/h\/\.local\/share\/hearth-ai\/whisper\/venv$/);
  assert.match(calls[1], /venv\/bin\/python -m pip install .*faster-whisper==1\.1\.1$/);
  assert.match(calls[2], /transcribe\.py --download$/);
  assert.ok(files['/h/.local/share/hearth-ai/whisper/installed.json']);
  const bad = await voice.fwInstall({ home: '/h', run: async () => ({ ok: false, err: 'no venv module' }), writeFile: () => {}, mkdir: () => {} });
  assert.deepEqual(bad, { ok: false, message: 'Making a Python folder for it didn\'t work: no venv module' });
});

test('detect finds the installed faster-whisper and says when it can be installed', () => {
  const none = voice.detect({ find: () => null, list: () => [], home: '/h', exists: () => false });
  assert.equal(none.tool, null); assert.equal(none.canInstall, true);
  const fw = voice.detect({ find: () => null, list: () => [], home: '/h', exists: () => true });
  assert.equal(fw.tool, 'faster-whisper'); assert.match(fw.script, /transcribe\.py$/);
  const cpp = voice.detect({ find: (b) => (b === 'whisper-cli' ? '/usr/bin/whisper-cli' : null), list: (d) => (d.endsWith('.cache/whisper.cpp') ? ['ggml-base.en.bin'] : []), home: '/h', exists: () => true });
  assert.equal(cpp.tool, 'whisper.cpp');
});
