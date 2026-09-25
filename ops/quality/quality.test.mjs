import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { capture, writeJson, stateDirectory, git, activity, allowedFile, validatedBaseline } from './state.mjs';
import { runCheckpoint } from './pipeline.mjs';
import { checkpointDue } from './schedule.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-quality-test-'));
  git(root, 'init', '-q');
  git(root, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(root, '.gitignore'), '.env\nnode_modules/\n');
  fs.writeFileSync(path.join(root, 'value.txt'), 'before\n');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'baseline');
  const state = stateDirectory(root);
  writeJson(path.join(state, 'baseline.json'), capture(root, state));
  fs.writeFileSync(path.join(root, 'value.txt'), 'user change\n');
  return { root, state };
}
const checks = async () => [{ name: 'fixture', code: 0, timedOut: false }];
function model(extra = () => {}) {
  return async input => {
    const stage = path.basename(input.output, '.md');
    if (stage === 'cleanup') fs.writeFileSync(path.join(input.workspace, 'value.txt'), 'cleaned\n');
    await extra(input, stage);
    return stage === 'verify' ? 'QUALITY_RESULT: PASS' : 'Completed';
  };
}

test('stop is idle, not an immediate checkpoint; another active session keeps the workspace active', () => {
  assert.equal(activity([{ provider: 'cursor', session: 'a', event: 'start' }]).active, true);
  assert.equal(activity([{ provider: 'codex', session: 'a', event: 'prompt' }, { provider: 'cursor', session: 'b', event: 'stop' }]).active, true);
  assert.equal(activity([{ provider: 'codex', session: 'a', event: 'prompt' }, { provider: 'codex', session: 'a', event: 'activity' }]).active, true);
  assert.equal(activity([{ provider: 'codex', session: 'a', event: 'stop' }]).active, false);
});
test('secret and generated paths are excluded from snapshots', () => {
  for (const name of ['.env', '.env.local', 'keys/a.pem', 'x/service-account.json', '.quality/review.md']) assert.equal(allowedFile(name), false);
  assert.equal(allowedFile('src/services/value.ts'), true);
  assert.equal(allowedFile('src/services/credentials.ts'), true);
  assert.equal(allowedFile('.env.example'), true);
});
test('inactivity is debounced by prompts and file changes; end has a grace period', () => {
  const setup = { eventList: [{ provider: 'codex', session: 'a', event: 'stop', at: 1000 }], snapshot: { fingerprint: 'new' }, stableSince: 1000, config: { idleMinutes: 20, endGraceSeconds: 60 } };
  assert.equal(checkpointDue({ ...setup, now: 2000 }), null);
  assert.equal(checkpointDue({ ...setup, now: 1_201_000 }), 'inactivity');
  assert.equal(checkpointDue({ ...setup, stableSince: 1_200_000, now: 1_201_000 }), null);
  assert.equal(checkpointDue({ ...setup, eventList: [...setup.eventList, { provider: 'codex', session: 'a', event: 'prompt', at: 1_200_000 }], now: 9_000_000 }), null);
  const ended = { ...setup, eventList: [{ provider: 'codex', session: 'a', event: 'end', at: 1000 }] };
  assert.equal(checkpointDue({ ...ended, now: 60_999 }), null);
  assert.equal(checkpointDue({ ...ended, now: 61_000 }), 'session-end');
  assert.equal(checkpointDue({ ...ended, now: 61_000, previous: { inputFingerprint: 'new', status: 'failed' } }), null);
});
test('advancing a checkpoint never adopts concurrent unreviewed files into the baseline', () => {
  const input = { head: 'head', files: { 'a.ts': 'old-a', 'b.ts': 'old-b' } };
  const output = { files: { 'a.ts': 'new-a', 'b.ts': 'old-b' } };
  const applied = { files: { 'a.ts': 'new-a', 'b.ts': 'unreviewed-b', 'c.ts': 'unreviewed-c' } };
  const next = validatedBaseline(input, output, applied, ['a.ts'], 'unused');
  assert.deepEqual(next.files, { 'a.ts': 'new-a', 'b.ts': 'old-b' });
});
test('validated edits apply without changing HEAD or staging user work, then deduplicate', async () => {
  const { root, state } = fixture();
  const head = git(root, 'rev-parse', 'HEAD');
  const result = await runCheckpoint({ root, state, modelRunner: model(), checkRunner: checks });
  assert.equal(result.status, 'complete', result.error);
  assert.equal(fs.readFileSync(path.join(root, 'value.txt'), 'utf8'), 'cleaned\n');
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(root, 'diff', '--cached'), '');
  assert.equal((await runCheckpoint({ root, state, modelRunner: model(), checkRunner: checks })).status, 'unchanged');
});
test('changes committed after baseline and new files reach the reviewer', async () => {
  const { root, state } = fixture();
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'user commit');
  fs.writeFileSync(path.join(root, 'new.txt'), 'new content\n');
  const result = await runCheckpoint({ root, state, modelRunner: model((input, stage) => {
    if (stage === 'review') {
      const diff = fs.readFileSync(path.join(input.workspace, '.quality/session.diff'), 'utf8');
      assert.match(diff, /user change/);
      assert.match(diff, /new content/);
    }
  }), checkRunner: checks });
  assert.equal(result.status, 'complete', result.error);
});
test('already-tracked files remain reviewable even if an ignore rule matches them', async () => {
  const { root, state } = fixture();
  fs.appendFileSync(path.join(root, '.gitignore'), 'value.txt\n');
  writeJson(path.join(state, 'baseline.json'), capture(root, state));
  fs.writeFileSync(path.join(root, 'value.txt'), 'tracked despite ignore\n');
  const result = await runCheckpoint({ root, state, modelRunner: model((input, stage) => {
    if (stage === 'review') assert.match(fs.readFileSync(path.join(input.workspace, '.quality/session.diff'), 'utf8'), /tracked despite ignore/);
  }), checkRunner: checks });
  assert.equal(result.status, 'complete', result.error);
});
test('concurrent source changes retain the patch and never overwrite user work', async () => {
  const { root, state } = fixture();
  const result = await runCheckpoint({ root, state, modelRunner: model((_, stage) => {
    if (stage === 'cleanup') fs.writeFileSync(path.join(root, 'value.txt'), 'new user work\n');
  }), checkRunner: checks });
  assert.equal(result.status, 'stale');
  assert.equal(fs.readFileSync(path.join(root, 'value.txt'), 'utf8'), 'new user work\n');
  assert.ok(fs.existsSync(path.join(result.directory, 'changes.patch')));
});
test('failing checks prevent application even if the model says PASS', async () => {
  const { root, state } = fixture();
  const result = await runCheckpoint({ root, state, modelRunner: model(), checkRunner: async () => [{ code: 1 }] });
  assert.equal(result.status, 'failed');
  assert.equal(fs.readFileSync(path.join(root, 'value.txt'), 'utf8'), 'user change\n');
});
test('read-only review mutation fails closed', async () => {
  const { root, state } = fixture();
  const result = await runCheckpoint({ root, state, modelRunner: model((input, stage) => {
    if (stage === 'review') fs.writeFileSync(path.join(input.workspace, 'value.txt'), 'oops');
  }), checkRunner: checks });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /Read-only/);
});
test('documentation stage cannot change runtime code', async () => {
  const { root, state } = fixture();
  const result = await runCheckpoint({ root, state, modelRunner: model((input, stage) => {
    if (stage === 'docs') fs.writeFileSync(path.join(input.workspace, 'value.txt'), 'wrong ownership');
  }), checkRunner: checks });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /ownership/);
});
test('worker cannot modify hook scripts or dependency manifests', async () => {
  const { root, state } = fixture();
  const result = await runCheckpoint({ root, state, modelRunner: model((input, stage) => {
    if (stage === 'cleanup') fs.writeFileSync(path.join(input.workspace, 'package.json'), '{}');
  }), checkRunner: checks });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.blockedEdits, ['package.json']);
});
