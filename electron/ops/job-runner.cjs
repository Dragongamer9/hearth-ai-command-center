// Runs one background job in its own detached process (started by jobs.cjs with
// ELECTRON_RUN_AS_NODE). Uses the same agent runner as normal runs and writes the
// result next to the job file, so the app can pick it up even after a restart.
const fs = require('node:fs');
const agents = require('../agents.cjs');
const { redact } = require('../store.cjs');

(async () => {
  const jobFile = process.argv[2];
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  let r;
  try {
    r = await agents.runAgent({ agent: job.agent, prompt: job.prompt, cwd: job.cwd, mode: job.mode || 'read', timeoutMs: job.timeoutMs || 2 * 3600e3, bin: job.bin, extraDirs: job.extraDirs || [], extraEnv: job.extraEnv || {} });
  } catch (e) {
    r = { ok: false, error: { kind: 'failed', message: String(e?.message || e) } };
  }
  const out = r.ok ? { ok: true, text: redact(r.text), via: r.via, at: new Date().toISOString() } : { ok: false, error: { kind: r.error?.kind || 'failed', message: redact(r.error?.message || 'failed') }, at: new Date().toISOString() };
  fs.writeFileSync(job.resultFile, JSON.stringify(out), { mode: 0o600 });
  process.exit(0);
})();
