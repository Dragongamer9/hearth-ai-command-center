// Rich answers, app lines, sources and follow-ups (src/app/rich.mjs, src/app/tools.mjs), and
// the unfiltered teammates' output kept out of the other AIs' context (src/app/brief.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rich, chartSvg, sourcesOf, plainText } from '../src/app/rich.mjs';
import { parseTools, pickMaker, toolsBrief } from '../src/app/tools.mjs';
import { transcript, brief, HARD_LIMITS } from '../src/app/brief.mjs';

// Every real tag in the output (escaped text like &lt;script&gt; is fine).
const tags = (html) => [...html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)].map((m) => ({ tag: m[1].toLowerCase(), attrs: m[2] }));
function assertSafe(html) {
  for (const t of tags(html)) {
    assert.ok(!['script', 'iframe', 'object', 'embed', 'form', 'style', 'svg'].includes(t.tag) || (t.tag === 'svg' && /class="chart-svg"/.test(t.attrs)), `no <${t.tag}>`);
    assert.doesNotMatch(t.attrs, /\son[a-z]+\s*=/i, `no event handler on <${t.tag}>`);
    assert.doesNotMatch(t.attrs, /(href|src)\s*=\s*"\s*(javascript|vbscript|data:text|file):/i, `no script URL on <${t.tag}>`);
  }
}

test('SANITIZING: no script runs from AI markdown (raw HTML, SVG, links, pictures)', () => {
  const evil = [
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<svg onload=alert(1)><circle/></svg>', '<iframe src="javascript:alert(1)"></iframe>',
    '[click](javascript:alert(1))', '[x](data:text/html,<script>alert(1)</script>)', '![p](javascript:alert(1))', '![p](file:///etc/passwd)',
    '<a href="javascript:alert(1)">a</a>', '```html\n<script>alert(1)</script>\n```', '$\\href{javascript:alert(1)}{x}$', '<style>body{display:none}</style>',
    '```mermaid\ngraph TD; A["<img src=x onerror=alert(1)>"]\n```', '```chart\n{"type":"bar","title":"<script>alert(1)</script>","labels":["<img onerror=x>"],"series":[{"name":"s","data":[1]}]}\n```',
  ];
  for (const e of evil) assertSafe(rich(e));
  assert.match(rich('[ok](https://example.com)'), /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">ok<\/a>/);
  assert.match(rich('![web](https://e.com/a.png)'), /data-a="load-remote"/, 'a picture on the web is never loaded directly');
  assert.match(rich('![m](hearth-media://c/c0000000001/ab-x.png)'), /<img class="md-img" src="hearth-media:/);
});

test('rich answers: tables, highlighted code with Copy, math, mermaid placeholder, charts', () => {
  const h = rich('| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\nEuler: $e^{i\\pi}+1=0$, price $5 and $10.\n\n$$\\int_0^1 x\\,dx$$\n\n```mermaid\ngraph TD; A-->B\n```');
  assert.match(h, /<div class="tbl-wrap"><table>/);
  assert.match(h, /<span class="hljs-keyword">const<\/span>/);
  assert.match(h, /data-a="copy-code"/);
  assert.match(h, /class="katex"/);
  assert.match(h, /price \$5 and \$10/, 'money is not math');
  assert.match(h, /class="math"/);
  assert.match(h, /class="mermaid-box" data-src="/);
  const svg = chartSvg({ type: 'line', title: 'T', labels: ['a', 'b'], series: [{ name: 's', data: [1, 'x'] }] });
  assert.match(svg, /<polyline/);
  assert.equal(chartSvg('not json'), null);
  assert.match(chartSvg({ type: 'pie', labels: ['a', 'b'], series: [{ data: [1, 2] }] }), /<path/);
});

test('sources under answers: pages read and links in the text, https only, deduplicated', () => {
  const s = sourcesOf({ text: 'See https://a.org/x. and [B](https://b.com/y) and http://insecure.com and https://a.org/x', steps: [{ url: 'https://c.dev/d', detail: 'c.dev' }] });
  assert.deepEqual(s.map((x) => x.url), ['https://c.dev/d', 'https://b.com/y', 'https://a.org/x']);
  assert.equal(plainText('# Hi **there** [x](https://a)'), 'Hi there x');
});

test('app lines: pictures, video, screenshots, memory, past chats, helpers, follow-ups; taken out of the text', () => {
  const r = parseTools('Here you go.\nMAKE IMAGE: a red fox in snow\nMAKE IMAGE @Venice: a castle\nEDIT IMAGE: make it night\nMAKE VIDEO: waves\nSCREENSHOT: https://hearthos.fun\nREMEMBER: He uses 4 spaces.\nSEARCH CHATS: wifi bug\nREAD CHAT: "Storage page mockup"\nHELPER @Gemini: check the docs\nFOLLOW-UPS: Make it bigger | Add a test | Ship it\n```\nMAKE IMAGE: inside code stays\n```', { agent: 'anthropic' });
  assert.deepEqual(r.tools.map((t) => t.kind), ['image', 'image', 'edit', 'video', 'shot', 'remember', 'search', 'read', 'helper']);
  assert.equal(r.tools[1].to, 'venice');
  assert.equal(r.tools[8].to, 'google');
  assert.equal(r.tools[7].chat, 'Storage page mockup');
  assert.deepEqual(r.followUps, ['Make it bigger', 'Add a test', 'Ship it']);
  assert.match(r.text, /^Here you go\.\n```\nMAKE IMAGE: inside code stays\n```$/);
  assert.equal(parseTools('MAKE IMAGE: a\nMAKE IMAGE: b\nMAKE IMAGE: c\nMAKE IMAGE: d').tools.length, 3, 'a limit per answer');
  assert.equal(pickMaker('venice', { capable: ['openai', 'venice'], ready: (a) => a === 'openai' }), null, 'a named maker that isn\'t ready is not swapped silently');
  assert.equal(pickMaker(null, { capable: ['openai', 'google'], ready: (a) => a === 'google' }), 'google');
  assert.match(toolsBrief({ images: [] }), /no image maker is set up/);
  assert.doesNotMatch(toolsBrief({ role: 'member' }), /HELPER/, 'only the lead hands out side tasks');
});

test('ADULT CONTENT: Venice, Civitai and the GPU server never reach Claude, ChatGPT or Gemini context', () => {
  const msgs = [
    { who: 'owner', text: 'Plan the release.' },
    { who: 'owner', text: '@Venice an explicit picture of a dragon lady', to: ['venice'] },
    { who: 'venice', text: 'explicit words here', media: [{ kind: 'image', name: 'v.png' }] },
    { who: 'civitai', text: 'Made', media: [{ kind: 'image' }, { kind: 'image' }] },
    { who: 'gpu', text: 'raw server text' },
    { who: 'anthropic', text: 'Release plan.' },
  ];
  for (const a of ['anthropic', 'openai', 'google', 'xai']) {
    const t = transcript(msgs, { forAgent: a });
    assert.doesNotMatch(t, /explicit|dragon lady|raw server text/, a);
    assert.match(t, /Venice: \[image by Venice\]/);
    assert.match(t, /Civitai: \[2 images by Civitai\]/);
    assert.match(t, /Your GPU server: \[content from Your GPU server, not shown\]/);
    assert.match(t, /Owner: \[message to Venice, not shown\]/);
    assert.match(t, /Release plan\./);
  }
  assert.match(transcript(msgs, { forAgent: 'venice' }), /explicit words here/, 'Venice sees its own chat');
  const b = brief({ agent: 'venice', chat: { title: 'x' } });
  assert.ok(b.includes(HARD_LIMITS));
  assert.match(HARD_LIMITS, /minors[\s\S]*real, identifiable people[\s\S]*illegal/);
  assert.ok(!brief({ agent: 'anthropic', chat: {} }).includes('HARD LIMITS'), 'only the unfiltered teammates need it spelled out');
});
