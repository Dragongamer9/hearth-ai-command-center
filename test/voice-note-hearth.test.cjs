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
  assert.match(save, /set up Hearth devices/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /hearth: \(\) => parityApi\?\.hearth \|\| null/);
});
