import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Isolate machine-wide state before any module reads it.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-quality-test-'));
process.env.AGENT_QUALITY_HOME = path.join(sandbox, 'home');
process.env.AGENT_QUALITY_WORK = path.join(sandbox, 'work');

const { git, globToRegExp, matchesAny, rootTouchesRepo, allowedFile, writeJson, readJson } = await import('./util.mjs');
const { DEFAULTS, loadRepoConfig, modelFor } = await import('./config.mjs');
const { gate } = await import('./gate.mjs');
const { decideHook, hookOutput, pendingNotices, sessionFile } = await import('./hook-core.mjs');
const { validateDecision, extractJson } = await import('./triage.mjs');
const { mergeHooks, stripHooks, MARKER } = await import('./install.mjs');
const { snapshotTree, diffEntries, readReviewed, branchName, initialTree } = await import('./git-snapshot.mjs');
const { processRepo, retryPendingApplies } = await import('./pipeline.mjs');
const { purgeHome, purgeRepo } = await import('./retention.mjs');
const { failureSignatures, runChecks, relatedTests } = await import('./checks.mjs');
const { pendingTrigger } = await import('./worker.mjs');

const config = { ...DEFAULTS, gate: { ...DEFAULTS.gate } };
const entry = (file, added, deleted = 0, status = 'M') => ({ path: file, added, deleted, status, binary: false });
const commit = (repo, message) => {
  git(repo, ['add', '-A']);
  git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', message]);
};
const lines = (count, prefix = 'line') => Array.from({ length: count }, (_, index) => `export const ${prefix}${index} = ${index};`).join('\n') + '\n';

function fixture({ crlf = true, qualityConfig = {} } = {}) {
  const repo = fs.mkdtempSync(path.join(sandbox, 'repo-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'core.autocrlf', crlf ? 'true' : 'false']);
  fs.writeFileSync(path.join(repo, '.gitignore'), '.env\nnode_modules/\n');
  fs.writeFileSync(path.join(repo, '.quality.config.json'), JSON.stringify({ mode: 'act', quietSeconds: { idle: 0, end: 0 }, ...qualityConfig }));
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'value.ts'), lines(5));
  fs.writeFileSync(path.join(repo, 'docs', 'value.md'), '# Value\nDescribes src/value.ts.\n');
  commit(repo, 'baseline');
  processRepoSync.init(repo);
  return repo;
}
// First sighting sets the reviewed point to HEAD; do it explicitly so tests start clean.
const processRepoSync = { init: repo => processRepo({ repo, provider: 'claude', modelRunner: async () => { throw new Error('no model'); } }) };

const decision = (clean, docs, extra = {}) => ({ significance: 'meaningful', clean_code: { run: clean, focus_files: ['src/value.ts'], concerns: ['x'] }, docs: { run: docs, focus_docs: ['docs/value.md'], reason: 'r' }, reason: 'test', ...extra });
function fakeModel({ triage = decision(true, false), clean, docs } = {}) {
  const calls = [];
  const runner = async input => {
    calls.push(input);
    if (input.role === 'triage' && input.schema) return { text: '', structured: triage };
    if (/FIX AND CLEAN CODE/.test(input.prompt)) { await clean?.(input); return { text: 'cleaned' }; }
    if (/DOCUMENTATION UPDATE/.test(input.prompt)) { await docs?.(input); return { text: 'docs updated' }; }
    return { text: 'QUALITY_RESULT: PASS' };
  };
  runner.calls = calls;
  return runner;
}
const passingChecks = async () => [{ name: 'fixture', passed: true, code: 0 }];

test('globs match paths the way the configuration means them', () => {
  assert.ok(globToRegExp('docs/**').test('docs/a/b.md'));
  assert.ok(matchesAny('src/a.test.ts', ['**/*.test.*']));
  assert.ok(matchesAny('pnpm-lock.yaml', ['**/pnpm-lock.yaml']));
  assert.ok(!matchesAny('src/docs.ts', ['docs/**']));
  assert.ok(matchesAny('eslint.config.mjs', ['eslint.config.*']));
});

test('session roots touch a repository when equal, containing, or inside it', () => {
  assert.ok(rootTouchesRepo('C:/work/vantage', 'C:\\work\\vantage\\server'));
  assert.ok(rootTouchesRepo('c:/work/vantage/server/src', 'C:/work/vantage/server'));
  assert.ok(!rootTouchesRepo('C:/work/vantage/admin', 'C:/work/vantage/server'));
  assert.ok(!rootTouchesRepo('C:/work/vantage/server-old', 'C:/work/vantage/server'));
});

test('secret, dependency and log paths never reach a model', () => {
  for (const name of ['.env', '.env.local', 'keys/a.pem', 'x/service-account.json', 'node_modules/a.js', 'a.log', 'hidden_credentials.md']) assert.equal(allowedFile(name), false);
  assert.equal(allowedFile('.env.example'), true);
});

test('gate: unchanged, noise, whitespace and docs-only changes are skipped without a model', () => {
  assert.equal(gate([], config).result, 'unchanged');
  assert.deepEqual([gate([entry('pnpm-lock.yaml', 500)], config).result, gate([entry('pnpm-lock.yaml', 500)], config).advance], ['noise', true]);
  assert.equal(gate([entry('src/a.ts', 0, 0)], config).result, 'noise');
  assert.equal(gate([entry('docs/a.md', 300), entry('AGENTS.md', 4)], config).result, 'docs-only');
  assert.equal(gate([entry('docs/a.md', 300)], { ...config, gate: { ...config.gate, triageDocsOnly: true } }).result, 'triage');
});

test('gate: trivial edits do not advance, so they accumulate', () => {
  const small = gate([entry('src/a.ts', 3, 1)], config);
  assert.deepEqual([small.result, small.advance], ['trivial', false]);
  assert.equal(gate([entry('src/a.ts', 10), entry('src/b.ts', 10)], config).result, 'triage');
  assert.equal(gate([entry('src/new.ts', 2, 0, 'A')], config).result, 'triage', 'a new source file is never trivial');
  assert.equal(gate([entry('src/a.test.ts', 2, 0, 'A')], config).result, 'trivial', 'a small new test is trivial');
});

test('gate: oversized change sets still triage, flagged for diffstat only', () => {
  const many = Array.from({ length: 90 }, (_, index) => entry(`src/f${index}.ts`, 1));
  const verdict = gate(many, config);
  assert.equal(verdict.result, 'triage');
  assert.equal(verdict.oversized, true);
});

test('hooks: child sessions, Claude registrations inside Cursor, and stop loops are ignored', () => {
  assert.equal(decideHook({ provider: 'claude', event: 'idle', env: { AGENT_QUALITY_CHILD: '1' } }).act, false);
  assert.equal(decideHook({ provider: 'claude', event: 'idle', env: { VANTAGE_QUALITY_CHILD: '1' } }).act, false, 'retired child flag still honoured');
  assert.equal(decideHook({ provider: 'claude', event: 'idle', payload: { cursor_version: '3.1' } }).act, false);
  assert.equal(decideHook({ provider: 'codex', event: 'idle', env: { CURSOR_VERSION: '3.1' } }).act, false);
  assert.equal(decideHook({ provider: 'cursor', event: 'idle', payload: { cursor_version: '3.1', loop_count: 1 } }).act, false);
  assert.equal(decideHook({ provider: 'claude', event: 'idle', payload: { stop_hook_active: true } }).act, false);
  assert.equal(decideHook({ provider: 'claude', event: 'bogus' }).act, false);
});

test('hooks: a turn end triggers, a prompt marks busy, roots come from cwd or workspace roots', () => {
  const idle = decideHook({ provider: 'claude', event: 'idle', payload: { session_id: 's1', cwd: '/c/work/vantage' } });
  assert.deepEqual([idle.act, idle.state, idle.trigger, idle.session, idle.roots], [true, 'idle', true, 's1', ['c:/work/vantage']]);
  const cursor = decideHook({ provider: 'cursor', event: 'busy', payload: { conversation_id: 'c1', cursor_version: '3', workspace_roots: ['C:/a', 'C:/b'] } });
  assert.deepEqual([cursor.state, cursor.trigger, cursor.roots], ['busy', false, ['C:/a', 'C:/b']]);
  assert.equal(decideHook({ provider: 'codex', event: 'end', payload: { session_id: 'x' } }).trigger, true);
  assert.deepEqual(decideHook({ provider: 'claude', event: 'idle', payload: { session_id: 'd', cwd: 'C:\\w\\v' }, env: { CLAUDE_PROJECT_DIR: 'C:/w/v' } }).roots.length, 1, 'one root per folder');
  assert.equal(decideHook({ provider: 'codex', event: 'interrupt', payload: { session_id: 'x' } }).trigger, false);
});

test('hooks: notices are emitted once per session in each tool\'s output shape', () => {
  const home = path.join(sandbox, 'notice-home');
  writeJson(path.join(home, 'notices', 'r1.json'), { id: 'r1', repo: 'C:/work/vantage/server', at: Date.now(), text: 'applied' });
  writeJson(path.join(home, 'notices', 'r2.json'), { id: 'r2', repo: 'C:/work/other', at: Date.now(), text: 'other' });
  assert.deepEqual(pendingNotices(home, ['C:/work/vantage']).map(notice => notice.id), ['r1']);
  assert.deepEqual(pendingNotices(home, ['C:/work/vantage'], ['r1']), []);
  assert.deepEqual(hookOutput('claude', 'busy', { hook_event_name: 'UserPromptSubmit' }, 'hi'), { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'hi' } });
  assert.deepEqual(hookOutput('codex', 'idle', {}, 'hi'), {});
  assert.deepEqual(hookOutput('cursor', 'start', {}, 'hi'), { additional_context: 'hi' });
  assert.ok(sessionFile(home, 'cursor', 'a/b:c').endsWith('cursor-a_b_c.json'));
});

test('triage: decisions are validated and fail closed', () => {
  const valid = validateDecision(decision(true, false));
  assert.equal(valid.clean_code.run, true);
  assert.throws(() => validateDecision({ significance: 'huge' }));
  assert.throws(() => validateDecision({ significance: 'minor', clean_code: { run: 'yes' }, docs: { run: false } }));
  assert.deepEqual(extractJson('noise\n```json\n{"a":1}\n```\nmore ```json\n{"b":2}\n```'), { b: 2 });
  assert.deepEqual(extractJson('Answer: {"a":{"b":1}} done'), { a: { b: 1 } });
  assert.throws(() => extractJson('no json here'));
});

test('install: hooks merge idempotently, keep unrelated entries, and drop the retired pipeline', () => {
  const existing = { version: 1, hooks: {
    beforeMCPExecution: [{ command: 'node hooks/guard-mongo-delete.mjs', failClosed: true }],
    stop: [{ command: 'node "C:/x/scripts/quality/hook-entry.mjs" --provider cursor --event stop' }]
  } };
  const once = mergeHooks('cursor', existing, 'node "C:/h/.agent-quality/hook.mjs"');
  const twice = mergeHooks('cursor', once, 'node "C:/h/.agent-quality/hook.mjs"');
  assert.deepEqual(twice, once);
  assert.equal(once.hooks.beforeMCPExecution.length, 1);
  assert.equal(once.hooks.stop.length, 1);
  assert.ok(once.hooks.stop[0].command.includes(MARKER) && once.hooks.stop[0].command.endsWith('--event idle'));
  const claude = mergeHooks('claude', { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other' }] }] } }, 'node "C:/h/.agent-quality/hook.mjs"');
  assert.equal(claude.model, 'opus');
  assert.equal(claude.hooks.Stop.length, 2);
  assert.equal(mergeHooks('codex', {}, 'node x/.agent-quality/hook.mjs').hooks.SessionEnd[0].hooks[0].timeout, 3);
  assert.equal(stripHooks({ version: 1, hooks: { stop: [{ command: 'node ops/quality/hook-entry.mjs --event stop' }] } }), null);
});

test('config: repository values override defaults one level deep', () => {
  const repo = fs.mkdtempSync(path.join(sandbox, 'config-'));
  fs.writeFileSync(path.join(repo, '.quality.config.json'), JSON.stringify({ gate: { minChangedLines: 3 }, models: { cursor: 'grok-4.7-low' } }));
  const loaded = loadRepoConfig(repo);
  assert.equal(loaded.gate.minChangedLines, 3);
  assert.equal(loaded.gate.maxFiles, DEFAULTS.gate.maxFiles);
  assert.equal(modelFor(loaded, 'cursor', 'edit'), 'grok-4.7-low');
  assert.equal(modelFor(loaded, 'claude', 'triage'), 'claude-sonnet-5-5');
  fs.writeFileSync(path.join(repo, '.quality.config.json'), JSON.stringify({ protectedGlobs: ['docs/locked/**'] }));
  const widened = loadRepoConfig(repo).protectedGlobs;
  assert.ok(widened.includes('docs/locked/**') && widened.includes('**/package.json'), 'repository protection adds to, never replaces, the defaults');
});

test('pipeline: the docs stage may not edit protected documents inside its own scope', async () => {
  const repo = fixture({ qualityConfig: { mode: 'act', quietSeconds: { idle: 0, end: 0 }, protectedGlobs: ['docs/locked/**'] } });
  fs.writeFileSync(path.join(repo, 'src', 'value.ts'), lines(30));
  const model = fakeModel({ triage: decision(false, true), docs: input => { fs.mkdirSync(path.join(input.cwd, 'docs', 'locked'), { recursive: true }); fs.writeFileSync(path.join(input.cwd, 'docs', 'locked', 'contract.md'), 'rewritten'); } });
  const report = await processRepo({ repo, provider: 'claude', modelRunner: model, checkRunner: passingChecks });
  assert.equal(report.status, 'failed');
  assert.match(report.error, /docs\/locked\/contract\.md/);
});

test('snapshot: untracked files count, ignored files do not, whitespace edits are zero lines', () => {
  const repo = fixture();
  const base = snapshotTree(repo);
  fs.writeFileSync(path.join(repo, '.env'), 'SECRET=1\n');
  fs.writeFileSync(path.join(repo, 'src', 'new.ts'), lines(3, 'n'));
  fs.writeFileSync(path.join(repo, 'src', 'value.ts'), lines(5).replaceAll(' = ', '  =  '));
  const entries = diffEntries(repo, base, snapshotTree(repo));
  assert.deepEqual(entries.map(item => [item.path, item.status, item.added + item.deleted]), [['src/new.ts', 'A', 3], ['src/value.ts', 'M', 0]]);
  assert.equal(git(repo, ['status', '--porcelain']).includes('new.ts'), true, 'the user index is untouched');
  assert.equal(git(repo, ['diff', '--cached', '--name-only']).trim(), '');
});

test('pipeline: a meaningful change is triaged, cleaned, checked and auto-applied; its own edits are not re-triaged', async () => {
  const repo = fixture();
  fs.writeFileSync(path.join(repo, 'src', 'value.ts'), lines(30));
  const model = fakeModel({ clean: input => fs.writeFileSync(path.join(input.cwd, 'src', 'value.ts'), lines(30).replace('line0 = 0', 'line0 = 100')) });
  const report = await processRepo({ repo, provider: 'claude', reason: 'turn-end', modelRunner: model, checkRunner: passingChecks });
  assert.equal(report.status, 'applied', report.error || JSON.stringify(report.staleBecause));
  assert.deepEqual(report.touched, ['src/value.ts']);
  assert.match(fs.readFileSync(path.join(repo, 'src', 'value.ts'), 'utf8'), /line0 = 100;\r\n/, 'applied with the working tree line endings');
  assert.equal(git(repo, ['diff', '--cached', '--name-only']).trim(), '', 'nothing staged');
  const again = await processRepo({ repo, provider: 'claude', modelRunner: fakeModel(), checkRunner: passingChecks });
  assert.equal(again.status, 'unchanged');
  const notices = fs.readdirSync(path.join(process.env.AGENT_QUALITY_HOME, 'notices'));
  assert.ok(notices.includes(`${report.id}.json`));
});

test('pipeline: small edits accumulate until they cross the threshold', async () => {
  const repo = fixture();
  const model = fakeModel({ triage: decision(false, false) });
  fs.appendFileSync(path.join(repo, 'src', 'value.ts'), 'export const a = 1;\n');
  assert.equal((await processRepo({ repo, provider: 'cursor', modelRunner: model })).status, 'trivial');
  fs.appendFileSync(path.join(repo, 'src', 'value.ts'), lines(20, 'more'));
  const report = await processRepo({ repo, provider: 'cursor', modelRunner: model });
  assert.equal(report.status, 'skipped');
  assert.equal(model.calls.length, 1, 'one triage call for the accumulated change');
  assert.equal(report.decision.reason, 'test');
});

test('pipeline: a triage failure advances the reviewed point and is not retried on the same input', async () => {
  const repo = fixture();
  fs.writeFileSync(path.join(repo, 'src', 'value.ts'), lines(40));
  const failing = async () => { throw new Error('model unavailable'); };
  const first = await processRepo({ repo, provider: 'codex', modelRunner: failing });
  assert.equal(first.status, 'failed');
  assert.equal(readReviewed(repo, branchName(repo)).tree, snapshotTree(repo));
  assert.equal((await processRepo({ repo, provider: 'codex', modelRunner: failing })).status, 'unchanged');
});

test('pipeline: a file edited during the run makes the patch stale and keeps it', async () => {
  const repo = fixture();
  fs.writeFileSync(path.join(repo, 'src', 'value.ts'), lines(30));
  const model = fakeModel({ clean: input => {
    fs.writeFileSync(path.join(input.cwd, 'src', 'value.ts'), lines(31));
    fs.appendFileSync(path.join(repo, 'src', 'value.ts'), '// user kept typing\n');
  } });
  const report = await processRepo({ repo, provider: 'claude', modelRunner: model, checkRunner: passingChecks });
  assert.equal(report.status, 'stale');
  assert.ok(fs.existsSync(report.patchFile));
  assert.match(fs.readFileSync(path.join(repo, 'src', 'value.ts'), 'utf8'), /user kept typing/);
});

test('pipeline: a busy session defers the apply, which lands once the session is idle', async () => {
  const repo = fixture();
  fs.writeFileSync(path.join(repo, 'src', 'value.ts'), lines(30));
  const busy = sessionFile(process.env.AGENT_QUALITY_HOME, 'claude', 'busy-test');
  writeJson(busy, { provider: 'claude', session: 'busy-test', state: 'busy', at: Date.now(), roots: [repo] });
  const model = fakeModel({ clean: input => fs.writeFileSync(path.join(input.cwd, 'src', 'value.ts'), lines(32)) });
  const report = await processRepo({ repo, provider: 'claude', modelRunner: model, checkRunner: passingChecks });
  assert.equal(report.status, 'stale-pending');
  fs.rmSync(busy);
  const [retried] = retryPendingApplies(repo);
  assert.equal(retried.status, 'applied');
  assert.equal(fs.readFileSync(path.join(repo, 'src', 'value.ts'), 'utf8').replaceAll('\r\n', '\n'), lines(32));
});

test('pipeline: the docs stage may only edit documentation; the clean stage may not edit protected paths', async () => {
  const repo = fixture();
  fs.writeFileSync(path.join(repo, 'src', 'value.ts'), lines(30));
  const docsOutside = fakeModel({ triage: decision(false, true), docs: input => fs.writeFileSync(path.join(input.cwd, 'src', 'value.ts'), 'changed by docs\n') });
  const report = await processRepo({ repo, provider: 'claude', modelRunner: docsOutside, checkRunner: passingChecks });
  assert.equal(report.status, 'failed');
  assert.match(report.error, /outside documentation ownership/);
  const repo2 = fixture();
  fs.writeFileSync(path.join(repo2, 'src', 'value.ts'), lines(30));
  const cleanProtected = fakeModel({ clean: input => fs.writeFileSync(path.join(input.cwd, 'package.json'), '{}') });
  const second = await processRepo({ repo: repo2, provider: 'claude', modelRunner: cleanProtected, checkRunner: passingChecks });
  assert.match(second.error, /protected paths: package.json/);
  assert.equal(fs.existsSync(path.join(repo2, 'package.json')), false, 'nothing applied');
});

test('pipeline: the docs stage updates documentation and applies it', async () => {
  const repo = fixture();
  fs.writeFileSync(path.join(repo, 'src', 'value.ts'), lines(30));
  const model = fakeModel({ triage: decision(false, true), docs: input => fs.writeFileSync(path.join(input.cwd, 'docs', 'value.md'), '# Value\nThirty exported constants in src/value.ts.\n') });
  const report = await processRepo({ repo, provider: 'cursor', modelRunner: model, checkRunner: passingChecks });
  assert.equal(report.status, 'applied', report.error);
  assert.match(fs.readFileSync(path.join(repo, 'docs', 'value.md'), 'utf8'), /Thirty/);
});

test('pipeline: dry-run mode records the decision without editing', async () => {
  const repo = fixture({ qualityConfig: { mode: 'dry-run' } });
  fs.writeFileSync(path.join(repo, 'src', 'value.ts'), lines(30));
  const report = await processRepo({ repo, provider: 'claude', modelRunner: fakeModel() });
  assert.equal(report.status, 'dry-run');
  assert.equal(fs.readFileSync(path.join(repo, 'src', 'value.ts'), 'utf8').replaceAll('\r\n', '\n'), lines(30));
});

test('checks: failure signatures ignore positions and durations', () => {
  assert.deepEqual(failureSignatures('tsc', 'src/a.ts(10,4): error TS2322: bad\nok'), ['src/a.ts: error TS2322: bad']);
  const stylish = '\nC:\\w\\src\\a.ts\n  3:9   error  Unexpected any   @typescript-eslint/no-explicit-any\n\n✖ 1 problem (1 error, 0 warnings)\n';
  assert.deepEqual(failureSignatures('eslint', stylish), ['C:\\w\\src\\a.ts: error Unexpected any @typescript-eslint/no-explicit-any']);
  assert.deepEqual(failureSignatures('node-test', '  ✖ adds numbers (12.5ms)\n✔ other'), ['✖ adds numbers']);
});

test('checks: pre-existing failures pass, introduced failures fail', async () => {
  const repo = fixture({ crlf: false });
  const workspace = fs.mkdtempSync(path.join(sandbox, 'checks-'));
  git(workspace, ['init', '-q']);
  git(workspace, ['config', 'core.autocrlf', 'input']);
  fs.writeFileSync(path.join(workspace, 'check.mjs'), "import fs from 'node:fs'; const t = fs.readFileSync('src/a.ts','utf8'); let bad = 0; for (const m of t.matchAll(/BAD(\\d)/g)) { console.log(`src/a.ts(${m.index},1): error TS100${m[1]}: bad`); bad++; } process.exit(bad ? 2 : 0);\n");
  fs.mkdirSync(path.join(workspace, 'src'));
  fs.writeFileSync(path.join(workspace, 'src', 'a.ts'), 'BAD1\n');
  commit(workspace, 'input');
  const checkConfig = { ...loadRepoConfig(repo), checks: [{ name: 'typecheck', command: ['node', 'check.mjs'], files: 'none', parser: 'tsc' }, { name: 'lint', command: ['node', 'missing.js'], files: 'edited' }] };
  const directory = path.join(sandbox, 'check-logs');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'src', 'a.ts'), 'x\nBAD1\n');
  const preExisting = await runChecks({ workspace, edited: ['src/a.ts'], config: checkConfig, env: process.env, directory });
  assert.equal(preExisting[0].passed, true, 'only the failure the input already had');
  fs.writeFileSync(path.join(workspace, 'src', 'a.ts'), 'BAD1\nBAD2\n');
  const introduced = await runChecks({ workspace, edited: ['src/a.ts'], config: checkConfig, env: process.env, directory });
  assert.equal(introduced[0].passed, false);
  assert.deepEqual(introduced[0].introduced, ['src/a.ts: error TS1002: bad']);
  assert.equal(fs.readFileSync(path.join(workspace, 'src', 'a.ts'), 'utf8'), 'BAD1\nBAD2\n', 'stash restored the edit');
});

test('checks: a failing check on a clean workspace re-runs without a stash and still reports', async () => {
  const repo = fixture({ crlf: false });
  const workspace = fs.mkdtempSync(path.join(sandbox, 'checks-clean-'));
  git(workspace, ['init', '-q']);
  git(workspace, ['config', 'core.autocrlf', 'input']);
  fs.writeFileSync(path.join(workspace, 'check.mjs'), "console.log('src/a.ts(1,1): error TS1001: bad'); process.exit(2);\n");
  fs.mkdirSync(path.join(workspace, 'src'));
  fs.writeFileSync(path.join(workspace, 'src', 'a.ts'), 'BAD1\n');
  commit(workspace, 'input');
  const checkConfig = { ...loadRepoConfig(repo), checks: [{ name: 'typecheck', command: ['node', 'check.mjs'], files: 'none', parser: 'tsc' }] };
  const directory = path.join(sandbox, 'check-clean-logs');
  fs.mkdirSync(directory, { recursive: true });
  // Nothing to stash (the edit is already committed): `stash push` is a no-op and `stash pop` must not run.
  const results = await runChecks({ workspace, edited: ['src/a.ts'], config: checkConfig, env: process.env, directory });
  assert.equal(results[0].passed, true, 'the failure already existed in the input');
  assert.equal(git(workspace, ['stash', 'list']).trim(), '', 'no stash entry is left behind');
});

test('checks: related tests include siblings and importers', () => {
  const workspace = fs.mkdtempSync(path.join(sandbox, 'related-'));
  fs.mkdirSync(path.join(workspace, 'src', 'x'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'src', 'value.ts'), '');
  fs.writeFileSync(path.join(workspace, 'src', 'value.test.ts'), '');
  fs.writeFileSync(path.join(workspace, 'src', 'x', 'user.test.ts'), "import { a } from '../value';\n");
  fs.writeFileSync(path.join(workspace, 'src', 'x', 'unrelated.test.ts'), "import { a } from './other';\n");
  assert.deepEqual(relatedTests(workspace, ['src/value.ts'], config).sort(), ['src/value.test.ts', 'src/x/user.test.ts']);
});

test('worker: a trigger waits while any session for the repository is busy', () => {
  const now = Date.now();
  const sessions = [
    { provider: 'claude', session: 'a', state: 'idle', trigger: true, at: now - 1000, roots: ['C:/w/vantage'] },
    { provider: 'cursor', session: 'b', state: 'busy', trigger: false, at: now - 500, roots: ['C:/w/vantage/server'] },
    { provider: 'codex', session: 'c', state: 'busy', trigger: false, at: now - 7 * 3_600_000, roots: ['C:/w/vantage/server'] }
  ];
  const pending = pendingTrigger('C:/w/vantage/server', sessions, 0, { now });
  assert.deepEqual([pending.busy, pending.trigger.session], [true, 'a']);
  assert.equal(pendingTrigger('C:/w/vantage/server', sessions.slice(0, 1), now).trigger, null, 'already handled');
  assert.equal(pendingTrigger('C:/w/vantage/server', [sessions[0], sessions[2]], 0, { now }).busy, false, 'stale busy markers are ignored');
});

test('retention: old sessions, notices, runs and legacy state are purged; pending runs are kept', () => {
  const home = path.join(sandbox, 'retention-home');
  const now = Date.now();
  writeJson(path.join(home, 'sessions', 'old.json'), { state: 'idle', at: now - 30 * 3_600_000 });
  writeJson(path.join(home, 'sessions', 'new.json'), { state: 'busy', at: now - 60_000 });
  writeJson(path.join(home, 'notices', 'n.json'), { at: now - 30 * 3_600_000 });
  const removed = purgeHome(home, { now });
  assert.equal(removed.length, 2);
  assert.ok(fs.existsSync(path.join(home, 'sessions', 'new.json')));
  const repo = fixture();
  const state = path.resolve(repo, git(repo, ['rev-parse', '--git-path', 'agent-quality']).trim());
  fs.mkdirSync(path.join(state, 'events'), { recursive: true });
  fs.writeFileSync(path.join(state, 'events', '1.json'), '{}');
  writeJson(path.join(state, 'runs', `${now - 20 * 86_400_000}-old`, 'report.json'), { status: 'applied' });
  writeJson(path.join(state, 'runs', `${now - 20 * 86_400_000}-pend`, 'report.json'), { status: 'stale-pending' });
  writeJson(path.join(state, 'runs', `${now}-new`, 'report.json'), { status: 'skipped' });
  git(repo, ['update-ref', `refs/agent-quality/reviewed/000000000000/gone`, 'HEAD']);
  purgeRepo(repo, { now });
  assert.equal(fs.existsSync(path.join(state, 'events')), false);
  assert.deepEqual(fs.readdirSync(path.join(state, 'runs')).sort(), [`${now - 20 * 86_400_000}-pend`, `${now}-new`].sort());
  assert.equal(git(repo, ['for-each-ref', 'refs/agent-quality/reviewed/000000000000/']).trim(), '', 'refs of vanished worktrees are deleted');
  assert.ok(readReviewed(repo, branchName(repo)), 'the live reviewed ref is kept');
});

test('first sighting of a branch reviews only uncommitted work', () => {
  const repo = fixture();
  git(repo, ['checkout', '-q', '-b', 'feature']);
  assert.equal(readReviewed(repo, 'feature'), null);
  assert.equal(initialTree(repo), git(repo, ['rev-parse', 'HEAD^{tree}']).trim());
  void readJson;
});

test('checks: related tests follow configured patterns for other languages; the generic parser ignores positions', () => {
  const workspace = fs.mkdtempSync(path.join(sandbox, 'related-py-'));
  fs.mkdirSync(path.join(workspace, 'app'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'app', 'orders.py'), '');
  fs.writeFileSync(path.join(workspace, 'app', 'test_orders.py'), '');
  assert.deepEqual(relatedTests(workspace, ['app/orders.py'], config), ['app/test_orders.py']);
  assert.deepEqual(failureSignatures('lines', 'app/orders.py:12:4: error E501 line too long (0.3s)\nall good'), ['app/orders.py: error E501 line too long']);
});

test('retention: the first installation\'s state folder is removed', () => {
  const repo = fixture();
  const legacy = path.resolve(repo, git(repo, ['rev-parse', '--git-path', 'vantage-quality']).trim());
  fs.mkdirSync(path.join(legacy, 'runs', 'old-run', 'workspace'), { recursive: true });
  fs.mkdirSync(path.join(legacy, 'events'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'latest.json'), '{}');
  purgeRepo(repo, { now: Date.now() });
  assert.deepEqual(fs.readdirSync(legacy), [], 'runs, events and files are gone');
});

test('install: Codex trust blocks are replaced, never duplicated, under the old or new name', async () => {
  const { withTrustBlock } = await import('./install.mjs');
  const hook = { key: 'C:\h\hooks.json:stop:0:0', currentHash: 'abc' };
  const old = 'model = "x"\n\n# BEGIN VANTAGE QUALITY HOOK TRUST\n[hooks.state."k"]\nenabled = true\n# END VANTAGE QUALITY HOOK TRUST\n';
  const once = withTrustBlock(old, [hook]);
  const twice = withTrustBlock(once, [hook]);
  assert.equal(twice, once);
  assert.equal((once.match(/# BEGIN/g) || []).length, 1);
  assert.ok(!once.includes('VANTAGE') && once.startsWith('model = "x"\n'));
  assert.equal(withTrustBlock(once), 'model = "x"\n');
});

test('install: uninstall leaves unrelated hooks and nothing of ours', () => {
  const merged = mergeHooks('codex', { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other' }] }] } }, 'node "C:/h/.agent-quality/hook.mjs"');
  const stripped = stripHooks(merged);
  assert.deepEqual(stripped.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'other' }] }] });
});
