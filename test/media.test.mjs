import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAttachLines, mediaFor, ATTACH_RULE } from '../src/media.mjs';
import { buildPrompt } from '../src/chat.mjs';
import { buildTaskBrief } from '../src/team.mjs';

test('an ATTACH line becomes an attachment and leaves the text', () => {
  const r = parseAttachLines('Here is the new panel.\nATTACH: shots/panel.png\n![the chart](out/chart.webp)\nATTACH: notes.txt\n![remote](https://x.y/a.png)');
  assert.deepEqual(r.files, [{ path: 'shots/panel.png', caption: '' }, { path: 'out/chart.webp', caption: 'the chart' }]);
  assert.match(r.text, /Here is the new panel/);
  assert.doesNotMatch(r.text, /ATTACH: shots/);
  assert.match(r.text, /ATTACH: notes\.txt/, 'unsupported types are left as text');
});

test('the other AIs receive attachments on their turns (owner and AI alike)', () => {
  const chat = [
    { who: 'google', text: 'earlier' },
    { who: 'owner', text: 'look', attachments: [{ kind: 'image', name: 'bug.png', path: '/w/a/bug.png' }] },
    { who: 'anthropic', text: 'recorded it', attachments: [{ kind: 'video', name: 'run.mp4', path: '/w/a/run.mp4', duration: 12, frames: ['/w/a/run-frame1.jpg', '/w/a/run-frame2.jpg'] }] },
  ];
  const g = mediaFor('google', chat, { anthropic: 'Claude' });
  assert.deepEqual(g.images, ['/w/a/bug.png', '/w/a/run-frame1.jpg', '/w/a/run-frame2.jpg']);
  assert.match(g.note, /The Owner attached an image: bug\.png/);
  assert.match(g.note, /Claude attached a video: run\.mp4 \[MP4 video · 12\.0 s · [^\]]*\] \(2 still frames/);
  const c = mediaFor('anthropic', chat, {});
  assert.deepEqual(c.images, [], 'an AI does not get its own attachment back, nor ones from before its turn');
  const v = mediaFor('openai', [{ who: 'owner', attachments: [{ kind: 'video', name: 'x.mov', frames: [], note: 'video attached (frames unavailable: install ffmpeg)' }] }]);
  assert.match(v.note, /install ffmpeg/);
});

test('every AI is told how to attach, and to attach screenshots for UI work', () => {
  assert.match(ATTACH_RULE, /ATTACH: <path/);
  assert.match(buildPrompt('openai', []), /ATTACH: <path relative to your workspace>/);
  assert.match(buildPrompt('openai', []), /screenshot/);
  assert.match(buildTaskBrief({ task: { id: 'ABC123', title: 't', action: 'code' }, agent: 'anthropic' }), /ATTACH: <path/);
});
