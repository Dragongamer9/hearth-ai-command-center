// Background jobs (image generation, deep research): each runs in its own detached
// process (job-runner.cjs), so it keeps going across chat turns and app restarts. A job
// is a JSON file; the runner writes <id>.result.json when it finishes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ID_RE = /^J[0-9A-F]{8}$/;
// A pid only counts as this job's process if /proc says it is our runner for this job file
// (pids get reused after a restart).
function ownsPid(pid, jobFile, readCmd = (p) => fs.readFileSync(`/proc/${p}/cmdline`, 'utf8')) {
  if (!pid) return false;
  try { const cmd = readCmd(pid); return cmd.includes('job-runner.cjs') && cmd.includes(jobFile); } catch { return false; }
}
const alive = (pid, jobFile) => ownsPid(pid, jobFile);

function jobStatus(job, result, isAlive = alive) {
  if (job.status === 'cancelled') return 'cancelled';
  if (result) return result.ok ? 'done' : 'failed';
  return isAlive(job.pid, job.file) ? 'running' : 'lost';
}

// The runner's progress log: the last 40 output lines, written at most every 2 s.
const MAX_LINES = 40;
function createProgress(file, { now = Date.now, every = 2000 } = {}) {
  let buf = [];
  let partial = '';
  let last = 0;
  const flush = () => { try { fs.writeFileSync(file, buf.join('\n'), { mode: 0o600 }); } catch {} last = now(); };
  const push = (l) => { const t = String(l).replace(/\s+$/, ''); if (!t) return; buf.push(t.slice(0, 300)); if (buf.length > MAX_LINES) buf = buf.slice(-MAX_LINES); };
  return {
    line(l) { push(`[${new Date(now()).toISOString().slice(11, 19)}] ${l}`); flush(); },
    chunk(d) {
      if (d == null) return;
      const parts = (partial + String(d)).split('\n');
      partial = parts.pop().slice(-2000);
      for (const p of parts) push(p);
      if (now() - last >= every) flush();
    },
    flush() { if (partial) { push(partial); partial = ''; } flush(); },
    lines: () => [...buf],
  };
}
const OUT_EXT = /\.(png|jpe?g|webp|gif|mp4|webm|mov|md|txt|json|csv|pdf|svg)$/i;

function createJobs({ dir, spawnRunner, isAlive = alive }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = (id) => path.join(dir, `${id}.json`);
  const resFile = (id) => path.join(dir, `${id}.result.json`);
  const progFile = (id) => path.join(dir, `${id}.progress.log`);
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const write = (id, j) => fs.writeFileSync(file(id), JSON.stringify(j, null, 1), { mode: 0o600 });
  const allJobs = () => { try { return fs.readdirSync(dir).filter((n) => /^J[0-9A-F]{8}\.json$/.test(n)).map((n) => read(path.join(dir, n))).filter(Boolean); } catch { return []; } };
  // The app (re)started: every job still running has survived one more restart.
  for (const j of allJobs()) {
    if (j.status === 'cancelled' || read(resFile(j.id)) || !isAlive(j.pid, j.file)) continue;
    j.restarts = (j.restarts || 0) + 1;
    write(j.id, j);
  }
  // Files the job made: new files in its assets folder since it started.
  const outputs = (job) => {
    const d = job.extraEnv?.HEARTH_AI_ASSETS;
    if (!d) return [];
    try { return fs.readdirSync(d).filter((n) => OUT_EXT.test(n)).map((n) => path.join(d, n)).filter((f) => { try { return fs.statSync(f).mtimeMs >= (job.startedMs || 0) - 1000; } catch { return false; } }).slice(0, 12); } catch { return []; }
  };

  function start(spec) {
    const id = `J${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const job = { id, status: 'running', startedAt: new Date().toISOString(), startedMs: Date.now(), ...spec, file: file(id), resultFile: resFile(id), progressFile: progFile(id) };
    write(id, job);
    job.pid = spawnRunner(file(id));
    write(id, job);
    return view(job);
  }
  function view(job) {
    const result = read(resFile(job.id));
    const status = jobStatus(job, result, isAlive);
    let progress = [];
    try { progress = fs.readFileSync(progFile(job.id), 'utf8').split('\n').filter(Boolean).slice(-8); } catch {}
    return { id: job.id, base: job.base || null, kind: job.kind, agent: job.agent, title: job.title, taskId: job.taskId || null, requestId: job.requestId || null, retryOf: job.retryOf || null, restarts: job.restarts || 0, progress, outputs: outputs(job), startedAt: job.startedAt, status, finishedAt: result?.at || job.cancelledAt || null, text: result?.ok ? result.text : null, error: result && !result.ok ? result.error : status === 'lost' ? { kind: 'lost', message: 'The job stopped without a result (the computer restarted or it was killed).' } : null };
  }
  function list() {
    return allJobs().map(view).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 50);
  }
  // Retry: the same job again (a finished, failed, lost or cancelled one; never a running one).
  function retry(id) {
    if (!ID_RE.test(String(id))) return { ok: false, message: 'No such job.' };
    const job = read(file(String(id)));
    if (!job) return { ok: false, message: 'No such job.' };
    if (view(job).status === 'running') return { ok: false, message: 'That job is still running.' };
    const { id: _i, status: _s, startedAt: _a, startedMs: _m, file: _f, resultFile: _r, progressFile: _p, pid: _pid, cancelledAt: _c, restarts: _x, ...spec } = job;
    return start({ ...spec, retryOf: job.id });
  }
  function cancel(id) {
    if (!ID_RE.test(String(id))) return { ok: false, message: 'No such job.' };
    const job = read(file(String(id)));
    if (!job) return { ok: false, message: 'No such job.' };
    // Signal only if that pid is still this job's runner.
    if (isAlive(job.pid, job.file)) { try { process.kill(-job.pid, 'SIGTERM'); } catch { try { process.kill(job.pid, 'SIGTERM'); } catch {} } }
    job.status = 'cancelled';
    job.cancelledAt = new Date().toISOString();
    write(job.id, job);
    return { ok: true, job: view(job) };
  }
  return { start, list, cancel, retry };
}

module.exports = { createProgress, createJobs, jobStatus, alive, ownsPid, ID_RE };
