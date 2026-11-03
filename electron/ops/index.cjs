// Team ops in the main process: projects, project memory, the app's own test runs,
// stall watchdog, CI watch, Hearth logs, voice notes, phone view, CLI usage.
// main.cjs calls register() once and uses the few helpers it returns.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { createProjects } = require('./projects.cjs');
const tests = require('./tests.cjs');
const ci = require('./ci.cjs');
const logs = require('./logs.cjs');
const voice = require('./voice.cjs');
const memory = require('./memory.cjs');
const usage = require('./usage.cjs');
const { createWatchdog } = require('./watchdog.cjs');
const { createPhone } = require('./phone.cjs');

function exec(file, args, { cwd, timeoutMs = 60000, env, maxBuffer = 16 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, timeout: timeoutMs, maxBuffer, env: env || { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' } }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: String(stdout), err: String(stderr).trim() || (error ? error.message : '') });
    });
  });
}

let projects = null;
let phone = null;
const testRuns = new Map(); // taskId -> AbortController

// Which state file the app should open (before the window exists).
function stateFile(dataDir, legacyDir) {
  projects = projects || createProjects(dataDir);
  const reg = projects.load(legacyDir);
  return projects.stateFile(reg.active);
}

function register(d) {
  const { handle, dataDir, readSettings, useProject, setStore, taskDir, worktreeRoot, gitops, workspace, agents, attachments, redact, send, dialog, getWindow } = d;
  projects = projects || createProjects(dataDir());
  const gh = () => gitops.find('gh');
  const ghApi = (args, timeoutMs = 30000) => {
    const bin = gh();
    if (!bin) return Promise.resolve({ ok: false, err: 'GitHub CLI (gh) is not installed.' });
    return exec(bin, ['api', ...args], { timeoutMs });
  };
  const active = () => projects.active();
  const projectDir = () => readSettings().project;
  const memFile = (dir = projectDir()) => (dir ? path.join(dir, memory.MEMORY_REL) : null);
  const readMemory = () => { try { return fs.readFileSync(memFile(), 'utf8'); } catch { return ''; } };

  // ---- projects ----
  const listProjects = () => {
    const reg = projects.get();
    return { active: reg.active, list: reg.list.map((p) => ({ ...p, dir: p.id === reg.active ? projectDir() || p.dir : p.dir })) };
  };
  handle('ops:projects', () => listProjects());
  handle('ops:projectAdd', async (kind, input) => {
    let dir = null;
    if (kind === 'clone') {
      const r = await gitops.clone(String(input || ''), path.join(os.homedir(), 'HearthProjects'));
      if (!r.ok) return r;
      dir = r.dir;
    } else {
      const r = await dialog.showOpenDialog(getWindow(), { title: 'Add a project folder (a git repository)', properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
      dir = r.filePaths[0];
      if (!(await workspace.isRepo(dir))) return { ok: false, message: `${dir} isn't a git repository yet. Start tracking it with git first (Settings › Project folder offers that).` };
    }
    const p = projects.add({ dir });
    return { ok: true, project: p, ...listProjects() };
  });
  // Switching: the current project keeps its folder; the new one's board, chat and folder load.
  handle('ops:projectSwitch', (id) => {
    const cur = active();
    const target = projects.byId(String(id));
    if (!target) throw new Error('Unknown project.');
    projects.setDir(cur.id, projectDir());
    projects.switchTo(target.id);
    setStore(projects.stateFile(target.id));
    if (target.dir) useProject(target.dir);
    return { ok: true, ...listProjects() };
  });
  handle('ops:projectRename', (id, name) => { projects.rename(String(id), name); return listProjects(); });
  handle('ops:projectSettings', (patch) => { projects.setSettings(active().id, patch); return listProjects(); });

  // ---- project memory ----
  handle('ops:memoryGet', async (decisions) => {
    const file = memFile();
    if (!file) return { ok: false, message: 'Pick a project folder first.' };
    let seeded = false;
    if (!fs.existsSync(file)) {
      const ls = await workspace.git(projectDir(), ['ls-tree', '--name-only', 'HEAD']);
      const layout = ls.ok ? ls.out.split('\n').filter(Boolean).slice(0, 40) : [];
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, memory.seed({ name: active().name, layout, decisions: (Array.isArray(decisions) ? decisions : []).map((x) => String(x).slice(0, 200)) }));
      seeded = true;
      // Keep it out of `git status` (local exclude only; never committed for you).
      try {
        const ex = path.join(projectDir(), '.git', 'info', 'exclude');
        if (fs.existsSync(path.dirname(ex)) && !(fs.existsSync(ex) && /^\.hearth-ai\/$/m.test(fs.readFileSync(ex, 'utf8')))) fs.appendFileSync(ex, '\n.hearth-ai/\n');
      } catch {}
    }
    return { ok: true, file, text: readMemory(), seeded };
  });
  handle('ops:memorySave', (text) => {
    const file = memFile();
    if (!file) return { ok: false, message: 'Pick a project folder first.' };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, redact(String(text || '')).slice(0, 100000));
    return { ok: true, text: readMemory() };
  });
  // Only from the owner's Approve on a lead proposal card.
  handle('ops:memoryApply', (proposal) => {
    const file = memFile();
    if (!file) return { ok: false, message: 'Pick a project folder first.' };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, memory.applyProposal(readMemory(), redact(String(proposal || ''))));
    return { ok: true, text: readMemory() };
  });

  // ---- the app's own test run ----
  handle('ops:testRun', async (taskId, sha) => {
    const dir = taskDir(String(taskId));
    if (!fs.existsSync(dir)) return { status: 'not run', log: 'This task has no workspace.', command: null };
    const command = tests.resolveTestCommand(active().settings.testCommand, dir);
    if (!command) return { status: 'not run', log: 'No test command for this project (set one on the Project page).', command: null };
    const head = (await workspace.git(dir, ['rev-parse', 'HEAD'])).out;
    if (typeof sha === 'string' && /^[0-9a-f]{7,40}$/.test(sha) && !head.startsWith(sha)) return { status: 'not run', log: `The worktree is at ${head.slice(0, 7)}, not the reported commit ${sha.slice(0, 7)}.`, command };
    testRuns.get(taskId)?.abort();
    const controller = new AbortController();
    testRuns.set(taskId, controller);
    try {
      const r = await tests.runTests({ command, cwd: dir, timeoutMs: active().settings.testTimeoutMin * 60000, signal: controller.signal });
      if (/^npm /.test(command) && !fs.existsSync(path.join(dir, 'node_modules'))) r.log = `Note: this worktree has no node_modules. If the tests need dependencies, set the test command to e.g. "npm ci && npm test".\n${r.log}`;
      return { ...r, log: redact(r.log), sha: head };
    } finally {
      if (testRuns.get(taskId) === controller) testRuns.delete(taskId);
    }
  });
  handle('ops:testCancel', (taskId) => { testRuns.get(String(taskId))?.abort(); return true; });

  // ---- CI watch (GitHub Actions via gh REST) ----
  const ciSeen = new Map(); // runId -> failure details
  const repoOf = async () => {
    const dir = projectDir();
    if (!dir) return null;
    const r = await workspace.git(dir, ['remote', 'get-url', 'origin']);
    return r.ok ? ci.parseRemote(r.out) : null;
  };
  handle('ops:ciPoll', async (branches) => {
    if (!active().settings.ciWatch) return { ok: false, off: true, results: [] };
    const repo = await repoOf();
    if (!repo || !gh()) return { ok: false, message: 'No GitHub remote or gh sign-in.', results: [] };
    const results = [];
    for (const b of (Array.isArray(branches) ? branches : []).filter(ci.safeBranch).slice(0, 30)) {
      const r = await ghApi(['-X', 'GET', `repos/${repo.owner}/${repo.repo}/actions/runs`, '-f', `branch=${b}`, '-f', 'per_page=10']);
      if (!r.ok) continue;
      let j = null;
      try { j = JSON.parse(r.out); } catch { continue; }
      const agg = ci.aggregate(j.workflow_runs);
      const out = { branch: b, state: agg.state, sha: agg.sha, runs: agg.runs, runId: agg.failedRun?.id || agg.runs[0]?.id || null, url: agg.failedRun?.url || agg.runs[0]?.url || null };
      if (agg.state === 'failure' && agg.failedRun) {
        if (!ciSeen.has(agg.failedRun.id)) {
          const jr = await ghApi([`repos/${repo.owner}/${repo.repo}/actions/runs/${agg.failedRun.id}/jobs`]);
          let job = null;
          try { job = ci.failedJob(JSON.parse(jr.out)); } catch {}
          let tail = '';
          if (job) {
            const lr = await ghApi([`repos/${repo.owner}/${repo.repo}/actions/jobs/${job.id}/logs`], 60000);
            tail = lr.ok ? ci.logTail(lr.out) : '';
          }
          ciSeen.set(agg.failedRun.id, { job, tail: redact(tail), workflow: agg.failedRun.name });
        }
        Object.assign(out, ciSeen.get(agg.failedRun.id));
      }
      results.push(out);
    }
    return { ok: true, repo: `${repo.owner}/${repo.repo}`, results };
  });

  // ---- Hearth logs ----
  const seenFile = () => path.join(dataDir(), 'ops-logs-seen.json');
  const readSeen = () => { try { return JSON.parse(fs.readFileSync(seenFile(), 'utf8')); } catch { return {}; } };
  handle('ops:logsPoll', async () => {
    const s = active().settings;
    if (!s.logsOn || !s.logsRepo) return { ok: false, off: true, created: [] };
    if (!gh()) return { ok: false, message: 'GitHub CLI (gh) is not installed.', created: [] };
    const top = await ghApi([`repos/${s.logsRepo}/contents/logs`]);
    if (!top.ok) return { ok: false, message: `Couldn't read ${s.logsRepo}: ${top.err.split('\n')[0]}`, created: [] };
    let dates = [];
    try { dates = logs.recentDates(JSON.parse(top.out)); } catch {}
    const paths = [];
    for (const date of dates) {
      const r = await ghApi([`repos/${s.logsRepo}/contents/logs/${date}`]);
      try { for (const f of JSON.parse(r.out)) if (f.type === 'file') paths.push(f.path); } catch {}
    }
    const all = readSeen();
    const key = `${active().id}:${s.logsRepo}`;
    const baseline = !Array.isArray(all[key]);
    const seen = new Set(all[key] || []);
    const fresh = logs.newLogs(seen, paths);
    const created = [];
    if (!baseline) {
      for (const l of fresh.slice(0, 10)) {
        const r = await ghApi(['-H', 'Accept: application/vnd.github.raw', `repos/${s.logsRepo}/contents/${l.path}`], 60000);
        if (!r.ok) continue;
        const text = redact(r.out.slice(0, 1024 * 1024));
        const dir = path.join(dataDir(), 'hearth-logs', s.logsRepo.replace('/', '_'), l.date);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const file = path.join(dir, `${l.code}.txt`);
        fs.writeFileSync(file, text, { mode: 0o600 });
        created.push({ ...l, file, summary: logs.summarizeLog(text), excerpt: text.slice(0, 4000) });
        seen.add(l.path);
      }
    } else for (const l of fresh) seen.add(l.path);
    all[key] = [...seen].slice(-5000);
    fs.writeFileSync(seenFile(), JSON.stringify(all), { mode: 0o600 });
    return { ok: true, repo: s.logsRepo, baseline, skipped: baseline ? fresh.length : 0, created };
  });

  // ---- voice notes (local transcription only) ----
  const voiceTools = () => voice.detect({ find: gitops.find, list: voice.listDir });
  handle('ops:voiceTools', () => voiceTools());
  handle('ops:voiceSave', async (data) => {
    const buf = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data || []);
    if (!buf.length || buf.length > 50 * 1024 * 1024) return { ok: false, message: 'Voice note is empty or too long.' };
    const dir = attachments.attachDir(worktreeRoot());
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = crypto.randomBytes(5).toString('hex');
    const file = path.join(dir, `${id}-voice-note.webm`);
    fs.writeFileSync(file, buf, { mode: 0o600 });
    const att = { id, kind: 'audio', name: 'voice-note.webm', size: buf.length, path: file, url: pathToFileURL(file).href };
    const tool = voiceTools();
    if (!tool.tool) return { ok: true, att, transcript: '', note: tool.missing };
    const env = tests.cleanEnv(process.env, os.tmpdir());
    try {
      if (tool.tool === 'whisper.cpp') {
        const ffmpeg = gitops.find('ffmpeg');
        if (!ffmpeg) return { ok: true, att, transcript: '', note: 'transcription unavailable: install ffmpeg (whisper.cpp needs a WAV file)' };
        const wav = path.join(os.tmpdir(), `hearth-voice-${id}.wav`);
        const c = await exec(ffmpeg, ['-y', '-i', file, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeoutMs: 60000, env });
        if (!c.ok) return { ok: true, att, transcript: '', note: 'transcription unavailable: ffmpeg could not read the recording' };
        const r = await exec(tool.bin, voice.cppArgs(tool.model, wav), { timeoutMs: 180000, env });
        try { fs.unlinkSync(wav); } catch {}
        const text = voice.cleanTranscript(r.out);
        return { ok: true, att, transcript: text, note: text ? '' : 'transcription came back empty' };
      }
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-voice-'));
      const r = await exec(tool.bin, voice.pyArgs(file, out), { timeoutMs: 300000, env: { ...env, HOME: os.homedir() } });
      let text = '';
      try { text = voice.cleanTranscript(fs.readFileSync(path.join(out, `${path.basename(file, '.webm')}.txt`), 'utf8')); } catch {}
      fs.rmSync(out, { recursive: true, force: true });
      return { ok: true, att, transcript: text, note: text ? '' : `transcription failed: ${r.err.split('\n').slice(-1)[0] || 'no text'}` };
    } catch (e) {
      return { ok: true, att, transcript: '', note: `transcription failed: ${e.message}` };
    }
  });

  // ---- CLI usage (agy answers /usage) ----
  handle('ops:usage', async (agent) => {
    if (agent !== 'google') return { ok: false, message: 'This tool reports no usage numbers.' };
    const file = agents.findBinary('google', readSettings().bins.google);
    if (!file || !agents.isAgy(file)) return { ok: false, message: 'Only the Antigravity CLI (agy) reports usage.' };
    const r = await agents.run(file, ['-p', '/usage', '--output-format', 'json'], { timeoutMs: 30000 });
    const parsed = agents.parseGemini(r.out);
    const u = usage.parseUsage(`${parsed.text || ''}\n${r.out}`);
    return { ok: u.usedPct !== null, ...u, at: new Date().toISOString() };
  });

  // ---- phone view ----
  let phoneSnap = null;
  phone = createPhone({ file: path.join(dataDir(), 'ops-phone.json'), getSnapshot: () => phoneSnap, onAction: (a) => send('ops:phoneAction', a) });
  handle('ops:phoneStatus', () => phone.status());
  handle('ops:phoneEnable', () => phone.enable());
  handle('ops:phoneDisable', () => phone.disable());
  handle('ops:phoneNewCode', () => phone.newCode());
  handle('ops:phoneForget', () => phone.forget());
  handle('ops:phoneRemove', (id) => phone.removeDevice(String(id)));
  handle('ops:phonePush', (snap) => { if (snap && typeof snap === 'object') phoneSnap = JSON.parse(redact(JSON.stringify(snap)).slice(0, 2e6)); return true; });
  phone.boot();

  // Helpers for main.cjs.
  return {
    withMemory: (prompt) => memory.withMemory(prompt, readMemory()),
    // Stall watchdog for an editing run in a task worktree.
    watchdog(cwd, onStall) {
      const idleMs = active().settings.stallMin * 60000;
      if (!idleMs || !cwd) return null;
      return createWatchdog({
        idleMs,
        onStall,
        probe: async () => {
          const a = await workspace.git(cwd, ['status', '--porcelain']);
          const b = await workspace.git(cwd, ['diff', 'HEAD', '--shortstat']);
          const c = await workspace.git(cwd, ['rev-parse', 'HEAD']);
          return `${a.out}|${b.out}|${c.out}`;
        },
      });
    },
    stallMinutes: () => active().settings.stallMin,
    stop() { for (const c of testRuns.values()) c.abort(); phone?.stop(); },
  };
}

module.exports = { register, stateFile };
