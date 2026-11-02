// Pull-request tracking, owner-approved merges and releases, with a mocked `gh`.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const g = require('../electron/git.cjs');

const PR = (o = {}) => ({
  number: 12, title: 'Settings › Storage page', url: 'https://github.com/o/r/pull/12', state: 'OPEN', isDraft: false,
  headRefName: 'hearth/k7q2ma-storage', baseRefName: 'main', reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://x/1' },
    { __typename: 'StatusContext', context: 'lint', state: 'SUCCESS' },
  ],
  reviews: [{ author: { login: 'Dragongamer9' }, state: 'COMMENTED' }, { author: { login: 'Dragongamer9' }, state: 'APPROVED', submittedAt: '2026-11-01T10:00:00Z' }],
  updatedAt: '2026-11-01T10:00:00Z', ...o,
});

// Fake gh: logs its arguments and answers from FAKE_GH_PR (JSON) / FAKE_GH_LIST.
function fakeGh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-gh-'));
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh
echo "$*" >> "${log}"
case "$1 $2" in
  "pr view") if [ -n "$FAKE_GH_NOPR" ]; then echo "no pull requests found for branch" >&2; exit 1; fi; printf '%s' "$FAKE_GH_PR";;
  "pr list") printf '%s' "$FAKE_GH_LIST";;
  "pr merge") echo "Merged"; exit 0;;
  "release create") echo "https://github.com/o/r/releases/tag/$3";;
  *) echo "unexpected: $*" >&2; exit 2;;
esac
`);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  return { dir, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []), restore: () => { process.env.PATH = oldPath; } };
}

test('summarizePr: state label, check counts and latest review per person', () => {
  const s = g.summarizePr(PR());
  assert.equal(s.label, 'approved');
  assert.deepStrictEqual([s.checks.total, s.checks.passed, s.checks.failed, s.checks.pending], [2, 2, 0, 0]);
  assert.deepStrictEqual(s.reviews.map((r) => [r.who, r.state]), [['Dragongamer9', 'APPROVED']]);
  assert.equal(g.summarizePr(PR({ statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'FAILURE' }] })).label, 'checks failing');
  assert.equal(g.summarizePr(PR({ statusCheckRollup: [{ name: 'build', status: 'IN_PROGRESS', conclusion: '' }], reviewDecision: '' })).label, 'checks running');
  assert.equal(g.summarizePr(PR({ state: 'MERGED' })).label, 'merged');
  assert.equal(g.summarizePr(PR({ isDraft: true })).label, 'draft');
  assert.equal(g.summarizePr(PR({ reviewDecision: 'CHANGES_REQUESTED' })).label, 'changes requested');
  assert.equal(g.summarizePr(null), null);
});

test('prView / prList read gh JSON; missing PR is a friendly message', async () => {
  const gh = fakeGh();
  try {
    process.env.FAKE_GH_PR = JSON.stringify(PR());
    process.env.FAKE_GH_LIST = JSON.stringify([PR(), PR({ number: 13, state: 'CLOSED' })]);
    const v = await g.prView(gh.dir, 'hearth/k7q2ma-storage');
    assert.ok(v.ok);
    assert.equal(v.pr.number, 12);
    const l = await g.prList(gh.dir);
    assert.deepStrictEqual(l.prs.map((p) => p.label), ['approved', 'closed']);
    process.env.FAKE_GH_NOPR = '1';
    assert.equal((await g.prView(gh.dir, 'nope')).message, 'No pull request for this branch yet.');
    delete process.env.FAKE_GH_NOPR;
    assert.equal((await g.prView(gh.dir, 'x; rm -rf ~')).ok, false);
    assert.ok(gh.calls().every((c) => c.startsWith('pr view') || c.startsWith('pr list')));
  } finally { gh.restore(); }
});

test('merge only open PRs with no failing checks, as a normal merge (never --admin/--auto)', async () => {
  const gh = fakeGh();
  try {
    process.env.FAKE_GH_PR = JSON.stringify(PR({ statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'FAILURE' }] }));
    let r = await g.prMerge(gh.dir, 12);
    assert.equal(r.ok, false);
    assert.match(r.message, /failing checks/);
    process.env.FAKE_GH_PR = JSON.stringify(PR({ state: 'CLOSED' }));
    assert.equal((await g.prMerge(gh.dir, 12)).ok, false);
    process.env.FAKE_GH_PR = JSON.stringify(PR());
    r = await g.prMerge(gh.dir, 12);
    assert.ok(r.ok, r.message);
    const merges = gh.calls().filter((c) => c.startsWith('pr merge'));
    assert.deepStrictEqual(merges, ['pr merge 12 --merge']);
    assert.equal((await g.prMerge(gh.dir, '12 --admin')).ok, false);
  } finally { gh.restore(); }
});

test('releases need an owner-typed MAJOR.MINOR version and default to drafts', async () => {
  const gh = fakeGh();
  try {
    for (const bad of ['', 'latest', 'v1.1', '1', '1.1; rm -rf ~', '1.1.1.1']) assert.equal((await g.releaseCreate(gh.dir, { version: bad, target: 'main' })).ok, false, bad);
    assert.equal(gh.calls().length, 0, 'nothing ran for bad versions');
    const r = await g.releaseCreate(gh.dir, { version: '1.1', target: 'main', notes: 'Storage page' });
    assert.ok(r.ok);
    assert.equal(r.tag, 'v1.1');
    assert.match(gh.calls()[0], /^release create v1\.1 --target main --title v1\.1 --notes Storage page --draft$/);
    const p = await g.releaseCreate(gh.dir, { version: '1.2', target: 'main', draft: false });
    assert.ok(p.ok);
    assert.doesNotMatch(gh.calls()[1], /--draft/);
  } finally { gh.restore(); }
});
