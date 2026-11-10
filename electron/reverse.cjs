// Reverse Engineering: REA ("Reverse Engineer Anything", github.com/morluto/rea, MIT) as a
// connector for chats started from this section only. REA runs on this PC (npx, pinned version)
// and reads the program you pick; deep native work goes through your own Ghidra. REA's own
// `setup` is never run: nothing is written into Claude Code's, Codex's or Gemini's own config.
// Saved: reverse.json (atomic, .bak; an unreadable file is never overwritten) holds only what
// the owner chose: on/off, his Ghidra folder, and his projects (a program + its chat).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { createJsonFile } = require('./jsonfile.cjs');

const REA_VERSION = '6.8.0'; // pinned: updated on purpose, never "latest"
const NODE_MIN = { 22: [23, 4], 24: [22, 1], 26: [12, 1] }; // rea-agents' engines field
const MAX_PROJECTS = 200;

function nodeOk(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  if (!m) return false;
  const [maj, min, pat] = m.slice(1).map(Number);
  if (maj > 26) return true;
  const need = NODE_MIN[maj];
  if (!need) return false;
  return min > need[0] || (min === need[0] && pat >= need[1]);
}

// What kind of program a file is, from its first bytes (and name), for the project list.
function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  let head = Buffer.alloc(0);
  try { const fd = fs.openSync(file, 'r'); try { head = Buffer.alloc(4); fs.readSync(fd, head, 0, 4, 0); } finally { fs.closeSync(fd); } } catch { /* unreadable */ }
  const magic = head.toString('latin1');
  if (ext === '.apk') return 'Android app';
  if (ext === '.asar') return 'Electron app';
  if (ext === '.jar') return 'Java program';
  if (ext === '.pcap' || ext === '.pcapng') return 'Network capture';
  if (magic.startsWith('MZ')) return ext === '.dll' ? 'Windows library (DLL)' : 'Windows program';
  if (magic === '\x7fELF') return ext === '.so' || /\.so(\.\d+)*$/.test(file) ? 'Linux library' : 'Linux program';
  if (ext === '.js' || ext === '.mjs') return 'JavaScript';
  if (['.bin', '.img', '.fw'].includes(ext)) return 'Firmware';
  return 'File';
}

function createReverse({ file, chats, run = (cmd, args) => new Promise((res) => execFile(cmd, args, { timeout: 8000 }, (e, so, se) => res(e ? null : `${so}${se}`))) }) {
  const f = createJsonFile(file, { empty: () => ({ version: 1, enabled: false, ghidraDir: null, projects: [] }), check: (j) => Array.isArray(j.projects), label: 'Your Reverse Engineering file' });
  const read = () => f.read();
  const save = (next) => f.write({ version: 1, ...read(), ...next });

  function ghidraOk(dir) {
    if (!dir || !path.isAbsolute(dir)) return false;
    return fs.existsSync(path.join(dir, 'support', 'analyzeHeadless')) && fs.existsSync(path.join(dir, 'Ghidra', 'application.properties'));
  }
  async function status() {
    const j = read();
    const node = await run('node', ['--version']);
    const npx = await run('npx', ['--version']);
    const java = await run('java', ['-version']);
    const onPath = await run('sh', ['-c', 'command -v ghidraRun || command -v ghidra']);
    const nodeV = node ? node.trim().split('\n')[0] : null;
    return {
      enabled: j.enabled === true, version: REA_VERSION, broken: Boolean(f.broken()),
      node: { found: Boolean(nodeV), version: nodeV, ok: nodeOk(nodeV) },
      npx: Boolean(npx),
      java: java ? (/version "([^"]+)"/.exec(java)?.[1] || 'found') : null,
      ghidra: { dir: j.ghidraDir, ok: ghidraOk(j.ghidraDir), onPath: onPath ? onPath.trim().split('\n')[0] : null },
      projects: j.projects.map((p) => ({ ...p, exists: fs.existsSync(p.path), chat: Boolean(chats.entry?.(p.chatId)) })),
    };
  }
  // His own switches; each is a press in the window.
  function setEnabled(on) { save({ enabled: on === true }); return { ok: true }; }
  function setGhidra(dir) {
    if (dir == null || dir === '') { save({ ghidraDir: null }); return { ok: true }; }
    const d = path.resolve(String(dir));
    if (!ghidraOk(d)) throw new Error('That folder isn\'t a Ghidra installation (it needs support/analyzeHeadless). Pick the folder you unpacked Ghidra into.');
    save({ ghidraDir: d });
    return { ok: true, dir: d };
  }
  // A new project: the program he picked, and a chat for it.
  function addProject(target) {
    const p = path.resolve(String(target || ''));
    let st;
    try { st = fs.statSync(p); } catch { throw new Error('That file can\'t be read.'); }
    if (!st.isFile() && !(st.isDirectory() && /\.app$/i.test(p))) throw new Error('Pick a program file (an .exe, .dll, Linux program, .apk, .asar, .jar…).');
    const j = read();
    if (j.projects.length >= MAX_PROJECTS) throw new Error(`You have ${MAX_PROJECTS} projects; remove one first.`);
    const name = path.basename(p).slice(0, 80);
    const e = chats.create({ repo: null, branch: null, title: `Reverse engineering: ${name}` });
    if (!e?.id) throw new Error('A chat for it couldn\'t be made.');
    const proj = { id: crypto.randomBytes(4).toString('hex'), name, path: p, kind: kindOf(p), chatId: e.id, addedAt: new Date().toISOString() };
    save({ projects: [...j.projects, proj] });
    return { ok: true, project: proj, chat: e };
  }
  // Only the project goes from this list; its chat stays in Chats like any other.
  function removeProject(id) { save({ projects: read().projects.filter((p) => p.id !== id) }); return { ok: true }; }
  const projectFor = (chatId) => read().projects.find((p) => p.chatId === chatId) || null;

  // The connector for one run: only for a chat that belongs to a project, and only while on.
  function serverFor(chatId) {
    const j = read();
    if (j.enabled !== true || !chatId || !projectFor(chatId)) return null;
    const env = {};
    if (ghidraOk(j.ghidraDir)) env.GHIDRA_INSTALL_DIR = j.ghidraDir;
    return { name: 'rea', type: 'stdio', command: 'npx', args: ['-y', `rea-agents@${REA_VERSION}`, 'mcp'], plainEnv: env };
  }
  // The first message, put in his message box (sent only when he presses Send).
  function firstMessage(p) {
    return `Use the REA tools to look at ${p.path} (${p.kind}). Tell me what it is, what it was built with, and its main parts, with the evidence for each. Only read it: don't change, run or patch the file.`;
  }
  return { status, setEnabled, setGhidra, addProject, removeProject, projectFor, serverFor, firstMessage, broken: () => f.broken() };
}

module.exports = { createReverse, nodeOk, kindOf, REA_VERSION };
