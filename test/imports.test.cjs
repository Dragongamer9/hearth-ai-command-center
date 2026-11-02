// Official chat-export import: ChatGPT, Claude, Gemini (Takeout), DeepSeek, zip files.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const im = require('../electron/imports.cjs');

const chatgpt = [{
  id: 'conv-aaaa-1111', title: 'Boot menu theme', create_time: 1761984000, update_time: 1761984600, current_node: 'n4',
  mapping: {
    root: { id: 'root', message: null, parent: null, children: ['n1'] },
    n1: { id: 'n1', parent: 'root', children: ['n2', 'n2b'], message: { author: { role: 'system' }, content: { content_type: 'text', parts: [''] }, metadata: { is_visually_hidden_from_conversation: true } } },
    n2: { id: 'n2', parent: 'n1', children: ['n3'], message: { author: { role: 'user' }, create_time: 1761984001, content: { content_type: 'text', parts: ['How do I theme GRUB?'] } } },
    n2b: { id: 'n2b', parent: 'n1', children: [], message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['abandoned branch'] } } },
    n3: { id: 'n3', parent: 'n2', children: ['n4'], message: { author: { role: 'assistant' }, create_time: 1761984002, content: { content_type: 'text', parts: ['Set GRUB_THEME in /etc/default/grub.'] } } },
    n4: { id: 'n4', parent: 'n3', children: [], message: { author: { role: 'user' }, create_time: 1761984003, content: { content_type: 'multimodal_text', parts: [{ asset_pointer: 'file-x' }, 'Thanks'] } } },
  },
}];

const claude = [{ uuid: '0b1c2d3e-0000-1111-2222-333344445555', name: 'Mantel icons', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:10:00Z', chat_messages: [
  { uuid: 'm1', sender: 'human', text: 'Draw a folder icon', created_at: '2026-10-01T10:00:00Z' },
  { uuid: 'm2', sender: 'assistant', text: '', content: [{ type: 'text', text: 'Here is an SVG.' }, { type: 'tool_use' }], created_at: '2026-10-01T10:00:05Z' },
] }];

const takeout = [
  { header: 'Gemini Apps', title: 'Prompted What is Mantel?', time: '2026-10-02T10:00:00.000Z', products: ['Gemini Apps'], safeHtmlItem: [{ html: '<p>Mantel is the <b>Hearth</b> desktop &amp; shell.</p>' }] },
  { header: 'Gemini Apps', title: 'Prompted And Steam Game Mode?', time: '2026-10-02T10:05:00.000Z', products: ['Gemini Apps'], safeHtmlItem: [{ html: 'It runs <i>gamescope</i>.' }] },
  { header: 'Gemini Apps', title: 'Prompted Unrelated next day', time: '2026-10-03T09:00:00.000Z', products: ['Gemini Apps'] },
  { header: 'Search', title: 'Searched for cats', time: '2026-10-02T10:01:00.000Z' },
];

const deepseek = [{ id: 'ds-0001-abcd', title: 'Rust help', inserted_at: '2026-10-05T10:00:00Z', mapping: {
  root: { id: 'root', parent: null, children: ['1'], message: null },
  1: { id: '1', parent: 'root', children: [], message: { inserted_at: '2026-10-05T10:00:00Z', fragments: [{ type: 'REQUEST', content: 'Explain lifetimes' }, { type: 'RESPONSE', content: 'They describe how long references live.' }] } },
}, current_node: '1' }];

test('ChatGPT export follows the current branch only and keeps text parts', () => {
  const { kind, conversations: [c] } = im.parseExport(chatgpt);
  assert.equal(kind, 'chatgpt');
  assert.equal(c.provider, 'openai');
  assert.deepStrictEqual(c.messages.map((m) => m.text), ['How do I theme GRUB?', 'Set GRUB_THEME in /etc/default/grub.', 'Thanks']);
  assert.equal(c.openUrl, 'https://chatgpt.com/c/conv-aaaa-1111');
  assert.equal(c.source, 'import:chatgpt');
  assert.equal(c.resumable, false);
});

test('Claude export maps human/assistant and content blocks', () => {
  const { kind, conversations: [c] } = im.parseExport(claude);
  assert.equal(kind, 'claude');
  assert.deepStrictEqual(c.messages.map((m) => [m.role, m.text]), [['user', 'Draw a folder icon'], ['assistant', 'Here is an SVG.']]);
  assert.equal(c.openUrl, 'https://claude.ai/chat/0b1c2d3e-0000-1111-2222-333344445555');
  assert.equal(c.title, 'Mantel icons');
});

test('Gemini Takeout: turns close together become one conversation; HTML becomes text', () => {
  const { kind, conversations } = im.parseExport(takeout, { name: 'Takeout/My Activity/Gemini Apps/MyActivity.json' });
  assert.equal(kind, 'gemini');
  assert.equal(conversations.length, 2);
  assert.deepStrictEqual(conversations[0].messages.map((m) => m.text), ['What is Mantel?', 'Mantel is the Hearth desktop & shell.', 'And Steam Game Mode?', 'It runs gamescope.']);
  assert.equal(conversations[1].messages.length, 1);
});

test('DeepSeek export with request/response fragments', () => {
  const { kind, conversations: [c] } = im.parseExport(deepseek);
  assert.equal(kind, 'deepseek');
  assert.equal(c.provider, 'deepseek');
  assert.deepStrictEqual(c.messages.map((m) => m.role), ['user', 'assistant']);
});

// Minimal zip writer for the test (deflate), like the real exports.
function zip(files) {
  const locals = [];
  const centrals = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const comp = zlib.deflateRawSync(data);
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, n, comp);
    centrals.push(ch, n);
    off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('zip exports: finds conversations.json among other files', () => {
  const buf = zip({ 'user.json': '{"email":"x"}', 'chat.html': '<html></html>', 'conversations.json': JSON.stringify(chatgpt) });
  const r = im.importFile(buf, { name: 'export.zip' });
  assert.equal(r.kind, 'chatgpt');
  assert.equal(r.conversations.length, 1);
  const g = im.importFile(zip({ 'Takeout/My Activity/Gemini Apps/MyActivity.json': JSON.stringify(takeout) }));
  assert.equal(g.kind, 'gemini');
});

test('bad inputs give clear errors', () => {
  assert.throws(() => im.importFile(Buffer.from('<html><body>My Activity</body></html>')), /choose JSON/);
  assert.throws(() => im.importFile(Buffer.from('nope')), /Not a JSON or zip/);
  assert.throws(() => im.importFile(zip({ 'readme.txt': 'hi' })), /No conversations file/);
  assert.deepStrictEqual(im.parseExport({ nothing: true }).conversations, []);
});
