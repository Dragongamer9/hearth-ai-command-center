// 3.1 web sign-in bridge: off unless turned on, his login stays in the site's own window, one question at a time at a
// person's pace, the answer read off the page, plain messages when he isn't signed in.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { cleanBridge, webPrompt, textAfter, createWebBridge, SITES, IDS, MAX_PROMPT, MIN_GAP_MS, mediaType, mediaHostOk, kindOf, newText, stageNote, MAX_PAGES } = require('../electron/web-bridge.cjs');
const allOff = Object.fromEntries(IDS.map((id) => [id, false]));

test('every bridge is off unless he turns it on, and only true counts', () => {
  assert.deepEqual(cleanBridge(undefined), allOff);
  assert.deepEqual(cleanBridge({ perplexity: true, deepseek: 'yes', venice: 1, kling: true, evil: true }), { ...allOff, perplexity: true, kling: true });
});

test('the question typed into a website is short and ends with the task', () => {
  const q = webPrompt(`${'x'.repeat(20000)}\nTHE TASK: find the Trainz config format`);
  assert.ok(q.length <= MAX_PROMPT);
  assert.match(q, /THE TASK: find the Trainz config format$/);
  assert.match(q, /^You are helping a small team of AIs/);
});

test('the fallback answer is the new text after the question', () => {
  assert.equal(textAfter('Hello\nwhat is 2+2?\n4, of course.', 'what is 2+2?'), '4, of course.');
  assert.equal(textAfter('nothing here', 'what is 2+2?'), '');
});

test('the bridge window shares only the site\'s own sandboxed profile, with nothing from this app', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'web-bridge.cjs'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /partition: `persist:web-\$\{id\}`/);
  assert.match(src, /contextIsolation: true, nodeIntegration: false, sandbox: true/);
  assert.doesNotMatch(src, /preload|cookies\.get|session\.cookies|localStorage/);
  assert.ok(MIN_GAP_MS >= 10000, 'a person\'s pace');
});

function fakeWindow(script) {
  const typed = [];
  const keys = [];
  let n = 0;
  class Win {
    constructor(o) { this.o = o; this.url = ''; const self = this; this.webContents = {
      on(ev, f) { if (ev === 'did-finish-load') self.onload = f; }, removeListener() {},
      setWindowOpenHandler() {}, getURL: () => self.url,
      executeJavaScript: async (code) => { if (/el\.focus\(\)/.test(code)) return true; if (/b\.click\(\)/.test(code)) return false; return script(n++, typed); },
      insertText: async (t) => { typed.push(t); }, sendInputEvent: (e) => keys.push(e.type),
    }; Win.made.push(this); }
    loadURL(u) { this.url = u; setTimeout(() => this.onload && this.onload(), 1); return Promise.resolve(); }
    isDestroyed() { return false; } destroy() {} show() {} focus() {}
  }
  Win.made = [];
  return { Win, typed, keys };
}
let clock = 0;
const fast = { now: () => clock, sleep: async (ms) => { clock += ms; } };

test('asking: it types the question, presses Enter and reads the answer once it stops changing', async () => {
  const f = fakeWindow((i, typed) => (typed.length === 0 ? { input: true, answer: '', busy: false, page: '', url: 'https://www.perplexity.ai/' }
    : i < 6 ? { input: true, answer: 'The format is', busy: true, page: '' } : { input: true, answer: 'The format is a tag list. [1]', busy: false, page: '' }));
  const b = createWebBridge({ BrowserWindow: f.Win, ...fast });
  const r = await b.ask('perplexity', 'THE TASK: find it');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'The format is a tag list. [1]');
  assert.match(r.via, /web sign-in/);
  assert.equal(f.typed.length, 1);
  assert.match(f.typed[0], /THE TASK: find it$/);
  assert.deepEqual(f.keys, ['keyDown', 'char', 'keyUp']);
  assert.equal(f.Win.made[0].o.webPreferences.partition, 'persist:web-perplexity');
  assert.equal(f.Win.made[0].o.show, false);
});

test('not signed in: a plain message that says what to do', async () => {
  const f = fakeWindow(() => ({ input: false, answer: '', busy: false, page: '', url: 'https://chat.deepseek.com/sign_in' }));
  const b = createWebBridge({ BrowserWindow: f.Win, ...fast });
  const r = await b.ask('deepseek', 'hi');
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'auth');
  assert.match(r.error.message, /not signed in to DeepSeek on its website\. Press Open page/);
  assert.equal(r.error.fix, 'open');
  assert.equal(f.typed.length, 0, 'nothing typed');
});

test('one question at a time per site, at least the minimum gap apart', async () => {
  const starts = [];
  const f = fakeWindow((i, typed) => { if (i === 0 || typed.length > starts.length) starts.push(clock); return { input: true, answer: typed.length ? `answer ${typed.length}` : '', busy: false, page: '' }; });
  const b = createWebBridge({ BrowserWindow: f.Win, ...fast });
  const [x, y] = await Promise.all([b.ask('venice', 'one'), b.ask('venice', 'two')]);
  assert.equal(x.ok && y.ok, true);
  assert.equal(f.typed.length, 2);
  assert.match(f.typed[0], /one$/); assert.match(f.typed[1], /two$/);
});

test('only the listed sites, all https; anything else is refused', async () => {
  assert.deepEqual(IDS.slice(0, 4), ['perplexity', 'deepseek', 'venice', 'freebuff']);
  for (const id of ['glm', 'minimax', 'cohere', 'nova', 'groq', 'cerebras', 'openrouter', 'v0', 'devin', 'jules', 'flux', 'stability', 'ideogram', 'leonardo', 'runway', 'luma', 'kling', 'pika']) assert.ok(IDS.includes(id), id);
  for (const id of IDS) assert.match(SITES[id].url, /^https:\/\//);
  const b = createWebBridge({ BrowserWindow: fakeWindow(() => ({})).Win, ...fast });
  assert.equal((await b.ask('openai', 'x')).ok, false);
  assert.equal(b.show('nope').ok, false);
});

test('3.3: the Settings list is the same list, in the same order', async () => {
  const { BRIDGE } = await import('../src/registry.mjs');
  assert.deepEqual(BRIDGE.map(([id]) => id), IDS);
});

test('3.3: picture and video sites get just the description; agents are told to open a pull request', () => {
  assert.equal(kindOf('kling'), 'video'); assert.equal(kindOf('ideogram'), 'image'); assert.equal(kindOf('devin'), 'agent'); assert.equal(kindOf('glm'), 'text');
  assert.equal(webPrompt('A red fox in snow', 'image'), 'A red fox in snow');
  assert.match(webPrompt('Fix the bug', 'agent'), /open a pull request[\s\S]*Fix the bug$/);
});

test('3.3: a picked-up file is judged by its first bytes, and only fetched from the site\'s own hosts', () => {
  assert.equal(mediaType(Buffer.from('89504e470d0a1a0a0000000d', 'hex')).mime, 'image/png');
  assert.equal(mediaType(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42xxxx')])).kind, 'video');
  assert.equal(mediaType(Buffer.from('<html><body>nope</body></html>')), null);
  assert.equal(mediaHostOk('leonardo', 'https://cdn.leonardo.ai/a.png'), true);
  assert.equal(mediaHostOk('leonardo', 'https://leonardo.ai.evil.com/a.png'), false);
  assert.equal(mediaHostOk('leonardo', 'http://cdn.leonardo.ai/a.png'), false);
  assert.equal(mediaHostOk('kling', 'https://example.com/v.mp4'), false);
});

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d', 'hex'), Buffer.alloc(64)]);
test('3.3: a picture site: it types the description and saves only the NEW picture once it has loaded', async () => {
  const old = { tag: 'img', src: 'https://cdn.leonardo.ai/old.png', done: true };
  const made = { tag: 'img', src: 'https://cdn.leonardo.ai/new.png', done: true };
  const grabbed = [];
  const f = fakeWindow((i, typed) => (typed.length === 0 ? { input: true, answer: '', busy: false, page: '', url: SITES.leonardo.url, media: [old] }
    : i < 5 ? { input: true, busy: true, media: [old, { ...made, done: false }] } : { input: true, busy: false, media: [old, made] }));
  const b = createWebBridge({ BrowserWindow: class extends f.Win { constructor(o) { super(o); const ej = this.webContents.executeJavaScript; this.webContents.executeJavaScript = async (code) => { if (/FileReader/.test(code)) { grabbed.push(code); return { data: PNG.toString('base64') }; } return ej(code); }; } }, ...fast });
  const r = await b.ask('leonardo', 'A lighthouse at dusk');
  assert.equal(r.ok, true);
  assert.equal(r.files.length, 1);
  assert.equal(r.files[0].mime, 'image/png');
  assert.equal(f.typed[0], 'A lighthouse at dusk');
  assert.equal(grabbed.length, 1);
  assert.match(grabbed[0], /new\.png/);
  assert.doesNotMatch(grabbed[0], /old\.png/);
});

test('3.3: a cloud agent on its site: waits until it goes quiet and passes on the pull request link', async () => {
  const f = fakeWindow((i, typed) => (typed.length === 0 ? { input: true, answer: '', busy: false, page: '', url: SITES.devin.url }
    : { input: true, answer: 'Done: fixed the loader and opened a PR.', busy: false, page: '', url: 'https://app.devin.ai/sessions/abc', prs: ['https://github.com/Dragongamer9/hearth-os/pull/42'] }));
  const b = createWebBridge({ BrowserWindow: f.Win, ...fast });
  const t0 = clock;
  const r = await b.ask('devin', 'Fix the loader');
  assert.equal(r.ok, true);
  assert.match(r.text, /fixed the loader/);
  assert.match(r.text, /Pull request: https:\/\/github\.com\/Dragongamer9\/hearth-os\/pull\/42/);
  assert.match(r.text, /https:\/\/app\.devin\.ai\/sessions\/abc/);
  assert.ok(clock - t0 >= 120000, 'waited for it to stay quiet');
});

test('3.3: picture and video sites never answer a chat message; the app only asks them for files', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(src, /webBridge\[agent\] === true && !\['image', 'video'\]\.includes\(webBridgeLib\.kindOf\(agent\)\)/);
});

// 3.4.1 (bugs found testing every teammate in one round)
test('3.4.1: a page without its chat box is NOT called a sign-in problem, and says where it got to', async () => {
  const f = fakeWindow(() => ({ input: false, answer: '', busy: false, page: 'Welcome', url: 'https://chat.cerebras.ai/' }));
  const r = await createWebBridge({ BrowserWindow: f.Win, ...fast }).ask('cerebras', 'hi');
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'page');
  assert.equal(r.error.fix, 'open');
  assert.doesNotMatch(r.error.message, /not signed in/);
  assert.match(r.error.message, /didn't show its chat box \(page loaded \(chat\.cerebras\.ai\) · chat box not found · message not sent\)/);
});

test('3.4.1: a timeout says whether the page loaded, the box was found and the message sent', async () => {
  const f = fakeWindow(() => ({ input: true, answer: '', busy: false, page: 'same page', url: 'https://openrouter.ai/chat' }));
  const r = await createWebBridge({ BrowserWindow: f.Win, ...fast }).ask('openrouter', 'hello');
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'timeout');
  assert.match(r.error.message, /page loaded \(openrouter\.ai\/chat\) · chat box found · message sent · nothing changed on the page after sending/);
});

test('3.4.1: the answer is found even when the site reformats the question (new text since sending)', () => {
  assert.equal(newText('Hello there', 'Hello there You asked: hi Sure: CHECK-123', 'something the page shows differently'), 'You asked: hi Sure: CHECK-123');
  assert.equal(newText('same', 'same', 'q'), '');
  assert.match(stageNote({ loaded: true, url: 'https://x.ai/a/', box: true, typed: true, sent: true, changed: true }, 'X'), /X started answering/);
});

test('3.4.1: at most a couple of bridge pages work at once, whatever the round size', async () => {
  assert.ok(MAX_PAGES >= 1 && MAX_PAGES <= 3);
  let most = 0;
  let b = null;
  class Win {
    constructor() { const self = this; this.n = 0; this.webContents = { on(ev, f) { if (ev === 'did-finish-load') self.onload = f; }, removeListener() {}, setWindowOpenHandler() {}, getURL: () => self.url,
      executeJavaScript: async (code) => { if (/el\.focus\(\)/.test(code)) return true; if (/b\.click\(\)/.test(code)) return false; self.n++; return self.n < 3 ? { input: true, answer: '', busy: false, page: '', url: self.url } : { input: true, answer: `answer`, busy: false, page: '', url: self.url }; },
      insertText: async () => {}, sendInputEvent: () => {} }; }
    loadURL(u) { this.url = u; most = Math.max(most, b.pagesInUse()); setTimeout(() => this.onload && this.onload(), 1); return Promise.resolve(); }
    isDestroyed() { return false; } destroy() {} show() {} focus() {}
  }
  b = createWebBridge({ BrowserWindow: Win, ...fast });
  const ids = ['glm', 'groq', 'nova', 'openrouter', 'cohere', 'cerebras'];
  const rs = await Promise.all(ids.map((id) => b.ask(id, 'hi')));
  assert.equal(rs.every((r) => r.ok), true);
  assert.ok(most <= MAX_PAGES, `at most ${MAX_PAGES} at once (saw ${most})`);
});

test('3.4.1: a page torn down before sending is tried again in a fresh window; after sending it is never sent twice', async () => {
  let made = 0;
  const typed = [];
  class Win {
    constructor() { made++; const self = this; const first = made === 1; this.n = 0; this.webContents = { on(ev, f) { if (ev === 'did-finish-load') self.onload = f; }, removeListener() {}, setWindowOpenHandler() {}, getURL: () => self.url,
      executeJavaScript: async (code) => { if (/el\.focus\(\)/.test(code)) return true; if (/b\.click\(\)/.test(code)) return false; self.n++; return typed.length ? { input: true, answer: 'ok', busy: false, page: '' } : { input: true, answer: '', busy: false, page: '', url: self.url }; },
      insertText: async (t) => { if (first) throw new Error('Render frame was disposed before WebFrameMain could be accessed'); typed.push(t); }, sendInputEvent: () => {} }; }
    loadURL(u) { this.url = u; setTimeout(() => this.onload && this.onload(), 1); return Promise.resolve(); }
    isDestroyed() { return false; } destroy() {} show() {} focus() {}
  }
  const r = await createWebBridge({ BrowserWindow: Win, ...fast }).ask('nova', 'hi');
  assert.equal(r.ok, true);
  assert.equal(made, 2, 'a fresh window');
  assert.equal(typed.length, 1, 'typed once');
  made = 5;
  class Win2 extends Win { constructor() { super(); this.webContents.sendInputEvent = () => { throw new Error('Render frame was disposed'); }; } }
  const r2 = await createWebBridge({ BrowserWindow: Win2, ...fast }).ask('groq', 'hi');
  assert.equal(r2.ok, false);
  assert.match(r2.error.message, /page closed or reloaded/);
});
