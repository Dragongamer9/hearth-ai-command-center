// Cloud coding agents (3.3): Devin and Jules take a job, work on the owner's GitHub repo in their
// own cloud, and come back (usually with a pull request). The app starts the job with his own key,
// checks on it every 30 seconds, and posts what came back: the agent's last message, the pull
// request link and a link to watch the job on the company's own site.
//   Devin: POST /v1/sessions {prompt} -> {session_id, url}; GET /v1/sessions/{id} until
//          status_enum is "finished" or "blocked" (docs.devin.ai, API v1).
//   Jules: GET /v1alpha/sources (the GitHub repos he connected in Jules), POST /v1alpha/sessions
//          {prompt, sourceContext, automationMode: AUTO_CREATE_PR}; activities until
//          sessionCompleted; outputs[].pullRequest (developers.google.com/jules/api).
// Each key only ever goes to its own host; nothing is stored here.
const more = require('./more-ais.cjs');

const POLL_MS = 30000;
const MAX_WAIT_MS = 90 * 60000;
const fail = (kind, message) => ({ ok: false, error: { kind, message: String(message).slice(0, 400) } });
async function jsonOf(res) { try { return await res.json(); } catch { return null; } }
const kindOf = (status) => (status === 401 || status === 403 ? 'auth' : status === 429 ? 'rate_limit' : status >= 500 ? 'server' : 'request');
const httpsOn = (host) => (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' && (x.hostname === host || x.hostname.endsWith(`.${host}`)) ? x.href : null; } catch { return null; } };
const githubUrl = httpsOn('github.com');

function wait(ms, sleep, signal) {
  return sleep(ms).then(() => (signal?.aborted ? Promise.reject(Object.assign(new Error('stopped'), { name: 'AbortError' })) : undefined));
}

function report(name, { message, pr, watch, still }) {
  const lines = [];
  if (message) lines.push(String(message).trim().slice(0, 20000));
  if (pr) lines.push(`Pull request: ${pr}`);
  if (watch) lines.push(`${still ? `${name} is still working: watch it` : `The whole job`} on ${name}'s site: ${watch}`);
  return lines.join('\n\n') || `${name} finished without a message.`;
}

async function devin({ key, prompt, repo, fetchImpl, sleep, signal, now }) {
  const base = more.CLOUD.devin.base;
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  const res = await fetchImpl(`${base}/sessions`, { method: 'POST', headers, body: JSON.stringify({ prompt: repo ? `Repository: ${repo}\n\n${prompt}` : prompt, idempotent: false }), signal });
  const j = await jsonOf(res);
  if (!res.ok || !j?.session_id) return fail(kindOf(res.status), j?.detail || j?.message || `Devin didn't start the job (HTTP ${res.status}).`);
  const id = String(j.session_id);
  const watch = httpsOn('devin.ai')(j.url);
  const start = now();
  while (now() - start < MAX_WAIT_MS) {
    await wait(POLL_MS, sleep, signal);
    const st = await fetchImpl(`${base}/sessions/${encodeURIComponent(id)}`, { headers, signal });
    const s = await jsonOf(st);
    if (!st.ok || !s) continue;
    const status = String(s.status_enum || '').toLowerCase();
    if (['finished', 'blocked', 'expired', 'stopped'].includes(status)) {
      const msgs = Array.isArray(s.messages) ? s.messages.filter((m) => m && /devin/i.test(String(m.type || m.origin || '')) && typeof m.message === 'string') : [];
      const pr = githubUrl(s.pull_request?.url);
      const message = msgs.length ? msgs[msgs.length - 1].message : (s.structured_output ? JSON.stringify(s.structured_output).slice(0, 4000) : '');
      return { ok: true, text: report('Devin', { message: status === 'blocked' ? `Devin is waiting for you (it says it's blocked).\n\n${message}` : message, pr, watch }), via: 'Devin API', sessionId: id };
    }
  }
  return { ok: true, text: report('Devin', { message: 'Devin is still working after 90 minutes.', watch, still: true }), via: 'Devin API', sessionId: id };
}

async function jules({ key, prompt, repo, fetchImpl, sleep, signal, now }) {
  const base = more.CLOUD.jules.base;
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': key };
  if (!repo) return fail('request', 'Jules works on a GitHub repo: use it in a chat that has one.');
  const sr = await fetchImpl(`${base}/sources?pageSize=100`, { headers, signal });
  const sj = await jsonOf(sr);
  if (!sr.ok) return fail(kindOf(sr.status), sj?.error?.message || `Jules didn't list your repos (HTTP ${sr.status}).`);
  const want = String(repo).toLowerCase();
  const source = (Array.isArray(sj?.sources) ? sj.sources : []).find((x) => String(x?.name || '').toLowerCase() === `sources/github/${want}`);
  if (!source) return fail('request', `Jules can't see ${repo} yet: connect it in Jules (its GitHub app) first.`);
  const cr = await fetchImpl(`${base}/sessions`, { method: 'POST', headers, signal, body: JSON.stringify({ prompt, title: prompt.split('\n').find((l) => l.trim())?.slice(0, 80) || 'Hearth AI job', sourceContext: { source: source.name, githubRepoContext: { startingBranch: 'main' } }, automationMode: 'AUTO_CREATE_PR' }) });
  const cj = await jsonOf(cr);
  const id = String(cj?.id || cj?.name || '').replace(/^sessions\//, '');
  if (!cr.ok || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) return fail(kindOf(cr.status), cj?.error?.message || `Jules didn't start the job (HTTP ${cr.status}).`);
  const watch = httpsOn('jules.google.com')(cj?.url) || `https://jules.google.com/session/${id}`;
  const start = now();
  while (now() - start < MAX_WAIT_MS) {
    await wait(POLL_MS, sleep, signal);
    const ar = await fetchImpl(`${base}/sessions/${id}/activities?pageSize=50`, { headers, signal });
    const aj = await jsonOf(ar);
    const acts = Array.isArray(aj?.activities) ? aj.activities : [];
    const done = acts.find((a) => a?.sessionCompleted || a?.sessionFailed);
    if (!done) continue;
    const s = await jsonOf(await fetchImpl(`${base}/sessions/${id}`, { headers, signal }));
    const pr = (Array.isArray(s?.outputs) ? s.outputs : []).map((o) => githubUrl(o?.pullRequest?.url)).find(Boolean) || null;
    const said = acts.map((a) => a?.agentMessaged?.agentMessage || a?.progressUpdated?.description || '').filter((x) => typeof x === 'string' && x.trim());
    const message = done.sessionFailed ? `Jules couldn't finish: ${done.sessionFailed.reason || 'no reason given'}` : said[said.length - 1] || '';
    return { ok: true, text: report('Jules', { message, pr, watch }), via: 'Jules API', sessionId: id };
  }
  return { ok: true, text: report('Jules', { message: 'Jules is still working after 90 minutes.', watch, still: true }), via: 'Jules API', sessionId: id };
}

async function run({ provider, key, prompt, repo = null, signal = null, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() }) {
  if (!key) return fail('no_key', `Add your ${more.CLOUD[provider]?.name || provider} API key in Settings › Accounts first.`);
  const safeRepo = typeof repo === 'string' && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo) ? repo : null;
  try {
    if (provider === 'devin') return await devin({ key, prompt: String(prompt || ''), repo: safeRepo, fetchImpl, sleep, signal, now });
    if (provider === 'jules') return await jules({ key, prompt: String(prompt || ''), repo: safeRepo, fetchImpl, sleep, signal, now });
    return fail('unsupported', 'Not a cloud agent.');
  } catch (e) {
    if (e?.name === 'AbortError') return fail('cancelled', 'Stopped.');
    return fail('network', `Couldn't reach ${more.CLOUD[provider]?.name || provider}.`);
  }
}

module.exports = { run, POLL_MS, MAX_WAIT_MS };
