// The phone page must not redraw or scroll while the owner is typing a chat message:
// redrawing every 5 seconds closed the phone's keyboard mid-sentence.
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { PHONE_HTML } = require('../electron/ops/phone-page.cjs');

function fakePage(state) {
  const els = {};
  const el = (id) => (els[id] = els[id] || {
    id, hidden: false, value: '', textContent: '', disabled: false, dataset: {}, classList: { toggle() {} },
    _html: '', writes: 0, listeners: {},
    set innerHTML(v) { this._html = v; this.writes++; }, get innerHTML() { return this._html; },
    addEventListener(type, fn) { this.listeners[type] = fn; }, focus() { doc.activeElement = this; },
  });
  const timers = [];
  let scrolls = 0;
  const doc = {
    activeElement: null, title: '', body: { scrollHeight: 2000 },
    getElementById: el, querySelectorAll: () => [], addEventListener() {},
  };
  const ctx = {
    document: doc, navigator: {}, console,
    window: { innerHeight: 800, scrollY: 1200, scrollTo() { scrolls++; } },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, setInterval: () => 0,
    fetch: async () => ({ json: async () => state.snap }),
  };
  const script = PHONE_HTML.split('<script>')[1].split('</script>')[0];
  vm.runInNewContext(`${script}\nthis.__t={load,render,setTab:(x)=>{tab=x;}};`, ctx);
  return { ctx, el, doc, get scrolls() { return scrolls; } };
}

const snapWith = (texts) => ({ ok: true, project: 'p', device: 'phone', names: {}, waiting: { permissions: [], approvals: [], cards: [] }, board: [], chat: texts.map((t, i) => ({ who: 'anthropic', at: `2026-11-03T08:0${i}:00Z`, text: t })) });

test('phone chat is not redrawn or scrolled while the owner is typing', async () => {
  const state = { snap: snapWith(['hi']) };
  const page = fakePage(state);
  await new Promise((r) => setImmediate(r));
  page.ctx.__t.setTab('chat');
  page.ctx.__t.render(true);
  const main = page.el('main');
  const writes = main.writes;
  const scrolls = page.scrolls;
  // Owner focuses the box and starts typing; a new message arrives on the next refresh.
  page.el('msg').focus();
  page.el('msg').value = 'half a sente';
  state.snap = snapWith(['hi', 'a new message from Claude']);
  await page.ctx.__t.load();
  assert.equal(main.writes, writes, 'no redraw while typing');
  assert.equal(page.scrolls, scrolls, 'no scroll while typing');
  assert.equal(page.el('msg').value, 'half a sente', 'typed text kept');
});

test('phone chat refresh does nothing when nothing changed, and redraws when not typing', async () => {
  const state = { snap: snapWith(['hi']) };
  const page = fakePage(state);
  await new Promise((r) => setImmediate(r));
  page.ctx.__t.setTab('chat');
  page.ctx.__t.render(true);
  const main = page.el('main');
  const writes = main.writes;
  await page.ctx.__t.load();
  assert.equal(main.writes, writes, 'identical content is not rewritten');
  state.snap = snapWith(['hi', 'new']);
  await page.ctx.__t.load();
  assert.equal(main.writes, writes + 1, 'new content is drawn when the owner is not typing');
});

test('the send button keeps the keyboard open and Enter sends', () => {
  assert.match(PHONE_HTML, /enterkeyhint="send"/);
  assert.match(PHONE_HTML, /getElementById\('send'\)\.addEventListener\('pointerdown',\(e\)=>e\.preventDefault\(\)\)/);
  assert.match(PHONE_HTML, /e\.key==='Enter'/);
});
