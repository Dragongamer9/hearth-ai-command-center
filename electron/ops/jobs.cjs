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

function createJobs({ dir, spawnRunner, isAlive = alive }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = (id) => path.join(dir, `${id}.json`);
  const resFile = (id) => path.join(dir, `${id}.result.json`);
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const write = (id, j) => fs.writeFileSync(file(id), JSON.stringify(j, null, 1), { mode: 0o600 });

  function start(spec) {
    const id = `J${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const job = { id, status: 'running', startedAt: new Date().toISOString(), startedMs: Date.now(), ...spec, file: file(id), resultFile: resFile(id) };
    write(id, job);
    job.pid = spawnRunner(file(id));
    write(id, job);
    return view(job);
  }
  function view(job) {
    const result = read(resFile(job.id));
    const status = jobStatus(job, result, isAlive);
    return { id: job.id, base: job.base || null, kind: job.kind, agent: job.agent, title: job.title, taskId: job.taskId || null, requestId: job.requestId || null, startedAt: job.startedAt, status, finishedAt: result?.at || job.cancelledAt || null, text: result?.ok ? result.text : null, error: result && !result.ok ? result.error : status === 'lost' ? { kind: 'lost', message: 'The job stopped without a result (the computer restarted or it was killed).' } : null };
  }
  function list() {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => /^J[0-9A-F]{8}\.json$/.test(n)); } catch {}
    return names.map((n) => read(path.join(dir, n))).filter(Boolean).map(view).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 50);
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
  return { start, list, cancel };
}

module.exports = { createJobs, jobStatus, alive, ownsPid, ID_RE };
