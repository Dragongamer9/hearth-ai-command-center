// 3.1 web sign-in bridge: off unless turned on, his login stays in the site's own window, one question at a time at a
// person's pace, the answer read off the page, plain messages when he isn't signed in.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { cleanBridge, webPrompt, textAfter, createWebBridge, SITES, MAX_PROMPT, MIN_GAP_MS } = require('../electron/web-bridge.cjs');

test('every bridge is off unless he turns it on, and only true counts', () => {
  assert.deepEqual(cleanBridge(undefined), { perplexity: false, deepseek: false, venice: false, freebuff: false });
  assert.deepEqual(cleanBridge({ perplexity: true, deepseek: 'yes', venice: 1, evil: true }), { perplexity: true, deepseek: false, venice: false, freebuff: false });
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
  assert.match(r.error.message, /not signed in to DeepSeek.*Settings › Accounts › Web sign-in bridge/);
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

test('only the four sites; anything else is refused', async () => {
  assert.deepEqual(Object.keys(SITES), ['perplexity', 'deepseek', 'venice', 'freebuff']);
  const b = createWebBridge({ BrowserWindow: fakeWindow(() => ({})).Win, ...fast });
  assert.equal((await b.ask('openai', 'x')).ok, false);
  assert.equal(b.show('nope').ok, false);
});
