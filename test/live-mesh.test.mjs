// 3.7 Live › Mesh (mockup live-mesh.png): stations count this chat's steps, light up in the colour of the AI using
// them, and the HTML is escaped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATIONS, stationOf, stepLine, meshState, meshHtml } from '../src/live-mesh.mjs';
import { liveStageHtml } from '../src/live.mjs';

test('every station in the mockup is there', () => {
  assert.deepEqual(STATIONS.map((s) => s[1]), ['You', 'Replies', 'Files', 'Search', 'Shell', 'Checks', 'Web', 'Git', 'Helpers', 'Tools', 'Make', 'Memory']);
});

test('steps go to their station', () => {
  const k = (kind, label = '') => stationOf({ kind, label });
  assert.equal(k('edit'), 'files'); assert.equal(k('read'), 'files');
  assert.equal(k('search'), 'search'); assert.equal(k('web-search'), 'search');
  assert.equal(k('web-read'), 'web'); assert.equal(k('run'), 'shell');
  assert.equal(k('check'), 'checks'); assert.equal(k('actions'), 'checks');
  assert.equal(k('push'), 'git'); assert.equal(k('commit'), 'git'); assert.equal(k('pr'), 'git');
  assert.equal(k('task'), 'helpers'); assert.equal(k('tool'), 'tools'); assert.equal(k('image'), 'make');
  assert.equal(k('search', 'Searched your chats'), 'memory'); assert.equal(k('read', 'Read another chat'), 'memory');
  assert.equal(stepLine({ kind: 'edit', label: 'Edited', detail: 'BatteryWatch.qml' }), 'Edited BatteryWatch.qml');
  assert.equal(stepLine({ kind: 'web-read', label: 'Read a web page', detail: 'upower.freedesktop.org' }), 'Read upower.freedesktop.org');
  assert.equal(stepLine({ kind: 'push', label: 'Pushed', detail: 'git push origin x' }), 'Pushed');
});

test('counts are the chat\'s and the working AIs light their newest stations', () => {
  const R = {
    msgs: [{ who: 'owner', text: 'fix the battery' }, { who: 'anthropic', text: 'done', steps: [{ kind: 'read', label: 'Read', detail: 'a.qml' }] }, { who: 'owner', text: 'thanks' }],
    working: [
      { agent: 'anthropic', steps: [{ kind: 'edit', label: 'Edited', detail: 'BatteryWatch.qml' }, { kind: 'check', label: 'Ran checks locally' }] },
      { agent: 'openai', steps: [{ kind: 'push', label: 'Pushed' }] },
    ],
  };
  const m = meshState(R, { isAgent: (w) => ['anthropic', 'openai'].includes(w) });
  const s = Object.fromEntries(m.stations.map((x) => [x.id, x]));
  assert.equal(s.you.n, 2); assert.equal(s.replies.n, 1); assert.equal(s.files.n, 2);
  assert.equal(s.files.last, 'Edited BatteryWatch.qml');
  assert.ok(s.checks.active && s.checks.pulse && s.checks.by === 'anthropic');
  assert.ok(s.files.active && !s.files.pulse);
  assert.ok(s.git.active && s.git.by === 'openai');
  assert.ok(!s.web.active && s.web.n === 0);
  assert.deepEqual(m.capsule.map((c) => [c.id, c.status]), [['anthropic', 'Ran checks locally'], ['openai', 'Pushed']]);
  const quiet = meshState({ msgs: [] }, { lead: 'anthropic' });
  assert.deepEqual(quiet.capsule, [{ id: 'anthropic', status: 'lead · ready', state: 'ready' }]);
});

test('the mesh and the Mesh / Cores switch', () => {
  const m = meshState({ msgs: [], working: [{ agent: 'x', steps: [{ kind: 'edit', label: 'Edited', detail: '<img src=x onerror=1>' }] }] });
  const h = meshHtml(m, { nameOf: () => '<b>AI</b>' });
  assert.doesNotMatch(h, /<img|<b>AI/);
  assert.match(h, /mesh-st lit/); assert.match(h, /mesh-pulse/);
  const stage = liveStageHtml({ who: [], caption: null, chatTitle: 'Low battery fix', counts: { total: 46, working: 3 }, canTalk: true, mode: 'mesh', mesh: '<div class="mesh"></div>' });
  assert.match(stage, /data-a="live-mode" data-v="mesh" aria-pressed="true"/);
  assert.match(stage, /class="mesh"/);
  assert.doesNotMatch(liveStageHtml({ who: [], caption: null, chatTitle: '', counts: { total: 0, working: 0 }, canTalk: false }), /class="mesh"/);
});

test('3.8: a lit line gets three jagged electric sparks, the same on every redraw', async () => {
  const { boltPaths } = await import('../src/live-mesh.mjs');
  const a = boltPaths(50, 50, 86, 31, 'files:anthropic'); const b = boltPaths(50, 50, 86, 31, 'files:anthropic');
  assert.equal(a.length, 3); assert.deepEqual(a, b);
  assert.match(a[0], /^M50\.00 50\.00 L.* L86\.00 31\.00$/);
  assert.notEqual(a[0], a[1]);
  const m = meshState({ msgs: [], working: [{ agent: 'x', steps: [{ kind: 'run', label: 'Ran' }] }] });
  assert.equal((meshHtml(m).match(/class="mesh-bolt b/g) || []).length, 3);
});
