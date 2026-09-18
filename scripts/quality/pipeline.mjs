import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { capture, changedFiles, materialize, git, writeJson, readJson, acquireLock, events, activity, validatedBaseline } from './state.mjs';
import { runModel, runProcess, modelEnvironment } from './providers.mjs';
import { promptFor } from './prompts.mjs';

function stageSnapshot(workspace, snapshot, intentOnly = false) {
  const names = Object.keys(snapshot.files).filter(name => fs.existsSync(path.join(workspace, name)));
  const list = path.join(workspace, '.git', 'quality-paths');
  fs.writeFileSync(list, names.join('\0') + '\0');
  if (names.length) git(workspace, 'add', ...(intentOnly ? ['-N'] : []), '-f', '--pathspec-from-file', list, '--pathspec-file-nul');
}
function checkpointCommit(workspace, message, snapshot) {
  stageSnapshot(workspace, snapshot);
  git(workspace, 'add', '-u');
  git(workspace, '-c', 'user.name=Vantage Quality Snapshot', '-c', 'user.email=quality@localhost', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', message);
}
function removeSnapshotHooks(workspace) {
  for (const name of ['.codex/hooks.json', '.codex/config.toml', '.cursor/hooks.json', '.cursor/mcp.json', '.mcp.json']) {
    fs.rmSync(path.join(workspace, name), { force: true });
  }
}
function createWorkspace(root, state, directory, baseline, current) {
  const workspace = path.join(directory, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  materialize(baseline, state, workspace);
  removeSnapshotHooks(workspace);
  git(workspace, 'init', '-q');
  git(workspace, 'config', 'core.autocrlf', 'false');
  git(workspace, 'config', 'core.hooksPath', path.join(directory, 'disabled-git-hooks'));
  fs.appendFileSync(path.join(workspace, '.git', 'info', 'exclude'), '\n.quality/\nnode_modules/\n');
  checkpointCommit(workspace, 'Session baseline', baseline);
  for (const name of Object.keys(baseline.files)) {
    if (!current.files[name]) fs.rmSync(path.join(workspace, name), { force: true });
  }
  materialize(current, state, workspace);
  removeSnapshotHooks(workspace);
  const contextDir = path.join(workspace, '.quality');
  fs.mkdirSync(contextDir, { recursive: true });
  // -N includes newly created files in the session diff without excluding staged edits.
  stageSnapshot(workspace, current, true);
  fs.writeFileSync(path.join(contextDir, 'session.diff'), git(workspace, 'diff', 'HEAD', '--binary'));
  checkpointCommit(workspace, 'Checkpoint input', current);
  const modules = path.join(root, 'node_modules');
  if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(workspace, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const glossary = path.resolve(root, '..', 'CONTEXT.md');
  if (fs.existsSync(glossary)) fs.copyFileSync(glossary, path.join(contextDir, 'CONTEXT.md'));
  return workspace;
}

export async function runChecks(root, workspace, directory) {
  const env = modelEnvironment(root);
  delete env.CURSOR_API_KEY;
  delete env.OPENAI_API_KEY;
  const pkg = readJson(path.join(workspace, 'package.json'));
  const checks = [
    ['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']],
    ['lint', ['node_modules/eslint/bin/eslint.js', 'src', 'api', 'scripts/quality', '--max-warnings', '0']],
    ['test', ['--run', 'test']],
    ['quality-tests', ['--test', 'scripts/quality/quality.test.mjs']]
  ];
  if (!pkg.scripts.test) throw new Error('Missing offline test script');
  const results = [];
  for (const [name, args] of checks) {
    const result = await runProcess(process.execPath, args, { cwd: workspace, env, log: path.join(directory, `${name}.log`), timeoutMs: 10 * 60_000 });
    results.push({ name, ...result });
  }
  return results;
}

function protectedEdit(file) {
  return /^(\.codex\/|\.github\/|\.quality\.config\.json$|\.cursor\/(hooks\.json|mcp\.json)|scripts\/quality\/|package\.json$|pnpm-lock\.yaml$|eslint\.config\.mjs$)/.test(file);
}

export async function runCheckpoint({ root, state, provider = 'codex', reason = 'manual', autoApply = true, model, modelRunner = runModel, checkRunner = runChecks }) {
  const release = acquireLock(path.join(state, 'pipeline.lock'));
  if (!release) return { status: 'busy' };
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const directory = path.join(state, 'runs', id);
  const report = { id, provider, reason, status: 'running', startedAt: new Date().toISOString(), directory };
  let current;
  try {
    const baseline = readJson(path.join(state, 'baseline.json'));
    current = capture(root, state);
    if (!baseline) {
      writeJson(path.join(state, 'baseline.json'), current);
      return { status: 'initialized', message: 'Baseline saved; subsequent changes will be reviewed.' };
    }
    const changed = changedFiles(baseline, current);
    if (!changed.length) return { status: 'unchanged' };
    fs.mkdirSync(directory, { recursive: true });
    report.inputFingerprint = current.fingerprint;
    report.inputHead = current.head;
    report.changed = changed;
    writeJson(path.join(directory, 'report.json'), report);
    writeJson(path.join(state, 'latest.json'), report);
    const workspace = createWorkspace(root, state, directory, baseline, current);
    const context = { reason, changed, baselineHead: baseline.head, currentHead: current.head };
    writeJson(path.join(workspace, '.quality', 'context.json'), context);
    for (const stage of ['review', 'cleanup', 'docs']) {
      report.stage = stage;
      writeJson(path.join(state, 'latest.json'), report);
      if (stage === 'docs') {
        git(workspace, 'add', '-N', '.');
        fs.writeFileSync(path.join(workspace, '.quality', 'cleanup.diff'), git(workspace, 'diff', '--binary', 'HEAD'));
      }
      const before = capture(workspace, state);
      const text = await modelRunner({ provider, root, workspace, prompt: promptFor(stage, context), output: path.join(directory, `${stage}.md`), readOnly: stage === 'review', model });
      const edits = changedFiles(before, capture(workspace, state));
      if (stage === 'review' && edits.length) throw new Error('Read-only reviewer modified files');
      if (stage === 'docs' && edits.some(file => !/^(docs\/|\.cursor\/rules\/|CONTEXT\.md$|AGENTS\.md$|README\.md$)/.test(file))) throw new Error('Documentation stage changed files outside its ownership');
      fs.writeFileSync(path.join(workspace, '.quality', `${stage}.md`), text);
    }
    report.stage = 'checks';
    writeJson(path.join(state, 'latest.json'), report);
    report.checks = await checkRunner(root, workspace, directory);
    writeJson(path.join(workspace, '.quality', 'checks.json'), report.checks);
    git(workspace, 'add', '-N', '.');
    fs.writeFileSync(path.join(workspace, '.quality', 'final.diff'), git(workspace, 'diff', '--binary', 'HEAD~1'));
    report.stage = 'verify';
    writeJson(path.join(state, 'latest.json'), report);
    const beforeVerification = capture(workspace, state);
    const verification = await modelRunner({ provider, root, workspace, prompt: promptFor('verify', context), output: path.join(directory, 'verify.md'), readOnly: true, model });
    if (changedFiles(beforeVerification, capture(workspace, state)).length) throw new Error('Final reviewer modified files after validation');
    git(workspace, 'add', '-N', '.');
    const edited = git(workspace, 'diff', '--name-only', 'HEAD', '-z').split('\0').filter(Boolean);
    const patch = git(workspace, 'diff', '--binary', 'HEAD');
    const patchFile = path.join(directory, 'changes.patch');
    fs.writeFileSync(patchFile, patch);
    report.edited = edited;
    const blocked = edited.filter(protectedEdit);
    const checksPassed = report.checks.every(check => check.code === 0 && !check.timedOut);
    const reviewPassed = /QUALITY_RESULT: PASS\s*$/.test(verification.trim());
    const latest = capture(root, state);
    const isStable = latest.fingerprint === current.fingerprint && latest.head === current.head;
    const hasActiveSession = reason !== 'manual' && activity(events(state)).active;
    if (!checksPassed || !reviewPassed || blocked.length) {
      report.status = 'failed';
      report.blockedEdits = blocked;
    } else if (!isStable || hasActiveSession) report.status = 'stale';
    else if (!autoApply) report.status = 'patch-ready';
    else {
      if (patch.trim()) {
        git(root, 'apply', '--check', '--whitespace=nowarn', patchFile);
        git(root, 'apply', '--whitespace=nowarn', patchFile);
      }
      report.status = 'complete';
      writeJson(path.join(state, 'baseline.json'), validatedBaseline(current, beforeVerification, capture(root, state), edited, state));
    }
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    const workspace = path.join(directory, 'workspace');
    if (fs.existsSync(path.join(workspace, '.git'))) {
      try {
        git(workspace, 'add', '-N', '.');
        fs.writeFileSync(path.join(directory, 'changes.patch'), git(workspace, 'diff', '--binary', 'HEAD'));
      } catch { /* The original failure remains authoritative; the snapshot is retained. */ }
    }
  } finally {
    if (fs.existsSync(directory)) {
      report.finishedAt = new Date().toISOString();
      writeJson(path.join(directory, 'report.json'), report);
      writeJson(path.join(state, 'latest.json'), report);
    }
    release();
  }
  return report;
}
