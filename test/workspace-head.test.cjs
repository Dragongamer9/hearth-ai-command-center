const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ws = require('../electron/workspace.cjs');

test('task branch heads are stored as full commit shas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-head-'));
  execFileSync('git', ['init', '-q', dir]);
  fs.writeFileSync(path.join(dir, 'a'), '1');
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x', '--allow-empty'], { cwd: dir });
  const h = await ws.head(dir);
  assert.match(h, /^[0-9a-f]{40}$/);
  assert.equal(await ws.head(path.join(dir, 'missing')), null);
});
