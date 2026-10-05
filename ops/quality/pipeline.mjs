import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { git, readJson, writeJson, appendJsonLine, acquireLock, repoStateDirectory, workDirectory, homeDirectory, matchesAny, rootTouchesRepo, TOOL_DIR } from './util.mjs';
import { loadRepoConfig, modelFor } from './config.mjs';
import { gate } from './gate.mjs';
import {
  snapshotTree, branchName, headCommit, readReviewed, writeReviewed, initialTree, diffEntries, diffPatch, statusSummary,
  upstreamSummary, logSince, documentHints, checkoutTree, blobInTree, workingBlob, treeWithPaths
} from './git-snapshot.mjs';
import { buildBrief, diffOrder, runTriage } from './triage.mjs';
import { stagePrompt } from './prompts.mjs';
import { runModel, childEnvironment } from './providers.mjs';
import { runChecks, brokenLinks } from './checks.mjs';

const IDENTITY = ['-c', 'user.name=Agent Quality', '-c', 'user.email=quality@localhost', '-c', 'commit.gpgsign=false'];
const CONTROL_FILES = ['.claude', '.cursor/hooks.json', '.cursor/mcp.json', '.mcp.json', '.codex'];

export function triageLog(repo) { return path.join(repoStateDirectory(repo), 'triage.jsonl'); }
export function recentTriage(repo, count = 3) {
  const file = triageLog(repo);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).slice(-count).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}
function record(repo, entry) { appendJsonLine(triageLog(repo), { at: new Date().toISOString(), ...entry }); }
function repoName(repo) { return path.basename(repo); }

/** Sessions currently marked busy for this repository (stale busy markers are ignored). */
export function busySessions(repo, { now = Date.now(), staleBusyHours = 6 } = {}) {
  const directory = path.join(homeDirectory(), 'sessions');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => readJson(path.join(directory, name)))
    .filter(session => session?.state === 'busy' && now - session.at < staleBusyHours * 3_600_000 && (session.roots || []).some(root => rootTouchesRepo(root, repo)));
}

function prepareWorkspace(repo, tree, runId, directory, config) {
  const workspace = path.join(workDirectory(), 'runs', repoName(repo), runId, 'workspace');
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  checkoutTree(repo, tree, workspace);
  for (const name of CONTROL_FILES) fs.rmSync(path.join(workspace, name), { recursive: true, force: true });
  git(workspace, ['init', '-q']);
  // A model writing CRLF must not turn every line into a change: compare in LF form.
  git(workspace, ['config', 'core.autocrlf', 'input']);
  git(workspace, ['config', 'core.hooksPath', path.join(directory, 'no-git-hooks')]);
  fs.appendFileSync(path.join(workspace, '.git', 'info', 'exclude'), '\n.quality/\nnode_modules/\n');
  git(workspace, ['add', '-A']);
  git(workspace, [...IDENTITY, 'commit', '-qm', 'Checkpoint input', '--allow-empty']);
  git(workspace, ['tag', 'input']);
  const modules = path.join(repo, 'node_modules');
  if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(workspace, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(path.join(workspace, '.quality'), { recursive: true });
  // Inputs that may live outside the repository (a workspace glossary, a shared docs contract) are copied in.
  const glossary = config.glossary && path.resolve(repo, config.glossary);
  if (glossary && fs.existsSync(glossary)) fs.copyFileSync(glossary, path.join(workspace, '.quality', 'glossary.md'));
  const contract = config.docsContract ? path.resolve(repo, config.docsContract) : path.join(TOOL_DIR, 'docs-contract.md');
  fs.copyFileSync(fs.existsSync(contract) ? contract : path.join(TOOL_DIR, 'docs-contract.md'), path.join(workspace, '.quality', 'docs-contract.md'));
  return workspace;
}
/** Files changed in the workspace relative to `base` (tracked edits, deletions and new untracked files). */
function changedSince(workspace, base) {
  git(workspace, ['add', '-A', '-N']);
  return git(workspace, ['diff', '--name-only', '-z', base]).split('\0').filter(Boolean);
}
function commitStage(workspace, message) {
  git(workspace, ['add', '-A']);
  git(workspace, [...IDENTITY, 'commit', '-qm', message, '--allow-empty']);
}

/**
 * Applies a run's patch to the repository when every touched file still has its
 * triaged content and no session for the repository is busy. Folds the applied
 * edits into the reviewed point so the worker never re-triages its own work.
 */
export function tryApply({ repo, run, now = Date.now(), staleBusyHours = 6, ignoreBusy = false }) {
  const changed = run.touched.filter(file => blobInTree(repo, run.tree, file) !== workingBlob(repo, file));
  if (changed.length) return { status: 'stale', changed };
  if (!ignoreBusy && busySessions(repo, { now, staleBusyHours }).length) return { status: 'stale-pending', reason: 'session busy' };
  try {
    git(repo, ['apply', '--check', '--whitespace=nowarn', run.patchFile]);
    git(repo, ['apply', '--whitespace=nowarn', run.patchFile]);
  } catch (error) { return { status: 'stale', error: error.message }; }
  const branch = branchName(repo);
  const reviewed = readReviewed(repo, branch);
  if (reviewed && reviewed.tree === run.tree) {
    writeReviewed(repo, branch, treeWithPaths(repo, run.tree, run.touched), headCommit(repo), `applied ${run.id}`);
  }
  return { status: 'applied' };
}

/** Best effort: a model CLI that lingers can hold the folder open; retention removes it later. */
function removeWorkspace(repo, id) {
  try { fs.rmSync(path.join(workDirectory(), 'runs', repoName(repo), id), { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }); }
  catch { /* left for retention */ }
}

function notify(run, text) {
  writeJson(path.join(homeDirectory(), 'notices', `${run.id}.json`), { id: run.id, repo: run.repo, at: Date.now(), text });
}
function summaryLine(report) {
  const where = `${repoName(report.repo)} run ${report.id}`;
  if (report.status === 'applied') return `Quality worker (${where}, ${report.provider}) applied edits to ${report.touched.join(', ')}. Re-read those files before editing them. Report: ${report.directory}`;
  if (report.status === 'stale') return `Quality worker (${where}) produced edits but the files changed meanwhile; the patch is kept: pnpm quality:apply ${report.id}. Report: ${report.directory}`;
  if (report.status === 'failed') return `Quality worker (${where}) failed at ${report.stage}: ${report.error || 'checks failed'}. Report: ${report.directory}`;
  return null;
}
function finish(report, directory) {
  report.finishedAt = new Date().toISOString();
  writeJson(path.join(directory, 'report.json'), report);
  const lines = [`# ${report.id}: ${report.status}`, '', `- repo: ${report.repo}`, `- provider: ${report.provider}`, `- reason: ${report.reason}`,
    report.decision ? `- triage: ${report.decision.significance}; clean=${report.decision.clean_code.run} docs=${report.decision.docs.run} — ${report.decision.reason}` : null,
    report.touched?.length ? `- touched: ${report.touched.join(', ')}` : null, report.error ? `- error: ${report.error}` : null,
    report.checks?.length ? `- checks: ${report.checks.map(check => `${check.name}=${check.passed ? 'pass' : 'FAIL'}`).join(', ')}` : null].filter(Boolean);
  fs.writeFileSync(path.join(path.dirname(path.dirname(directory)), 'latest.md'), lines.join('\n') + '\n');
  const line = summaryLine(report);
  if (line) notify(report, line);
  return report;
}

/**
 * One checkpoint for one repository: Gate 0 → triage → clean/docs stages →
 * checks → auto-apply. `force` skips Gate 0; `actions` skips triage.
 */
export async function processRepo({ repo, provider, reason = 'manual', force = false, actions = null, dryRun = false,
  modelRunner = runModel, checkRunner = runChecks, now = Date.now() }) {
  const config = loadRepoConfig(repo);
  if (!config?.enabled) return { status: 'disabled', repo };
  const stateDirectory = repoStateDirectory(repo);
  if (fs.existsSync(path.join(stateDirectory, 'paused'))) return { status: 'paused', repo };
  const release = acquireLock(path.join(stateDirectory, 'pipeline.lock'));
  if (!release) return { status: 'busy', repo };
  try {
    const branch = branchName(repo);
    const head = headCommit(repo);
    let reviewed = readReviewed(repo, branch);
    if (!reviewed) reviewed = writeReviewed(repo, branch, initialTree(repo), head, 'first sighting of this branch');
    const tree = snapshotTree(repo);
    if (tree === reviewed.tree) return { status: 'unchanged', repo };
    const entries = diffEntries(repo, reviewed.tree, tree);
    const verdict = force ? { result: 'triage', advance: true, entries, files: entries.length, lines: entries.reduce((sum, entry) => sum + entry.added + entry.deleted, 0), oversized: entries.length > config.gate.maxFiles } : gate(entries, config);
    if (verdict.result !== 'triage') {
      record(repo, { provider, reason, branch, tree, result: verdict.result, files: verdict.files, lines: verdict.lines });
      if (verdict.advance) writeReviewed(repo, branch, tree, head, verdict.result);
      return { status: verdict.result, repo };
    }
    const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const directory = path.join(stateDirectory, 'runs', id);
    fs.mkdirSync(directory, { recursive: true });
    const report = { id, repo, provider, reason, branch, head, tree, reviewedTree: reviewed.tree, status: 'running', stage: 'triage', startedAt: new Date().toISOString(), directory, changed: verdict.entries.map(entry => entry.path) };
    writeJson(path.join(directory, 'report.json'), report);
    const ordered = diffOrder(verdict.entries, config);
    const brief = buildBrief({
      repoName: repoName(repo), branch, head, upstream: upstreamSummary(repo), status: statusSummary(repo), log: logSince(repo, reviewed.head),
      entries: ordered, oversized: verdict.oversized, reason,
      patch: verdict.oversized ? '' : diffPatch(repo, reviewed.tree, tree, ordered.filter(entry => entry.category !== 'deleted').map(entry => entry.path)),
      hints: documentHints(repo, ordered.slice(0, 60).map(entry => entry.path)), history: recentTriage(repo)
    });
    try {
      report.decision = actions
        ? { significance: 'meaningful', clean_code: { run: actions.includes('clean'), focus_files: [], concerns: [] }, docs: { run: actions.includes('docs'), focus_docs: [], reason: 'requested' }, reason: `explicit --actions ${actions.join(',')}` }
        : await runTriage({ provider, repo, runDirectory: directory, brief, config, modelRunner });
      fs.writeFileSync(path.join(directory, 'triage-brief.md'), brief);
    } catch (error) {
      record(repo, { provider, reason, branch, tree, result: 'triage-failed', error: error.message, run: id });
      writeReviewed(repo, branch, tree, head, 'triage failed');
      report.status = 'failed';
      report.error = error.message;
      return finish(report, directory);
    }
    // The reviewed point moves now: a later failure is reported, never retried on the same input.
    writeReviewed(repo, branch, tree, head, `triaged ${id}`);
    const wantsClean = report.decision.clean_code.run;
    const wantsDocs = report.decision.docs.run;
    record(repo, { provider, reason, branch, tree, result: wantsClean || wantsDocs ? 'act' : 'skip', decision: report.decision, run: id, reason_text: report.decision.reason });
    if (!wantsClean && !wantsDocs) { report.status = 'skipped'; return finish(report, directory); }
    if (dryRun || config.mode === 'dry-run') { report.status = 'dry-run'; return finish(report, directory); }
    try {
      return await runActions({ repo, provider, reason, config, report, directory, brief, reviewed, tree, modelRunner, checkRunner });
    } catch (error) {
      report.status = 'failed';
      report.stage = error.stage || report.stage;
      report.error = error.message;
      if (report.workspace && fs.existsSync(path.join(report.workspace, '.git'))) {
        try { fs.writeFileSync(path.join(directory, 'changes.patch'), git(report.workspace, ['diff', '--binary', 'input'])); } catch { /* the original failure stays authoritative */ }
      }
      return finish(report, directory);
    }
  } finally { release(); }
}

async function runActions({ repo, provider, reason, config, report, directory, brief, reviewed, tree, modelRunner, checkRunner }) {
  const { id } = report;
  const wantsClean = report.decision.clean_code.run;
  const wantsDocs = report.decision.docs.run;
  report.stage = 'workspace';
  const workspace = prepareWorkspace(repo, tree, id, directory, config);
  report.workspace = workspace;
  const qualityDirectory = path.join(workspace, '.quality');
  writeJson(path.join(qualityDirectory, 'triage.json'), report.decision);
  fs.writeFileSync(path.join(qualityDirectory, 'brief.md'), brief);
  fs.writeFileSync(path.join(qualityDirectory, 'session.diff'), git(repo, ['diff', '--binary', '--no-ext-diff', reviewed.tree, tree]));
  const context = { repoName: repoName(repo), reason, changed: report.changed, instructions: config.instructions, docsOwnership: config.docsOwnership };
  const runStage = async (stage, role = 'edit') => {
    report.stage = stage;
    writeJson(path.join(directory, 'report.json'), report);
    const output = path.join(directory, `${stage}.md`);
    const prompt = stagePrompt(stage, context);
    const { text } = await modelRunner({ provider, role, cwd: workspace, prompt, model: modelFor(config, provider, 'edit'), output, repo, config, timeoutMs: config.timeouts.stageMinutes * 60_000 });
    fs.writeFileSync(path.join(qualityDirectory, `${stage}.md`), text);
    return text;
  };

  if (wantsClean) {
    await runStage('clean');
    const edited = changedSince(workspace, 'input');
    const protectedEdits = edited.filter(file => matchesAny(file, config.protectedGlobs));
    if (protectedEdits.length) throw Object.assign(new Error(`clean stage edited protected paths: ${protectedEdits.join(', ')}`), { stage: 'clean' });
    fs.writeFileSync(path.join(qualityDirectory, 'clean.diff'), git(workspace, ['diff', '--binary', 'input']));
    commitStage(workspace, 'Clean stage');
  } else fs.writeFileSync(path.join(qualityDirectory, 'clean.md'), 'The clean-code stage did not run (triage decided docs only).\n');
  if (wantsDocs) {
    const linksBefore = new Set(brokenLinks(workspace, git(workspace, ['ls-files']).split('\n').filter(file => matchesAny(file, config.docsOwnership))));
    await runStage('docs');
    const edited = changedSince(workspace, 'HEAD');
    const outside = edited.filter(file => !matchesAny(file, config.docsOwnership) || matchesAny(file, config.protectedGlobs));
    if (outside.length) throw Object.assign(new Error(`docs stage edited files outside documentation ownership: ${outside.join(', ')}`), { stage: 'docs' });
    const newBroken = brokenLinks(workspace, edited).filter(link => !linksBefore.has(link));
    if (newBroken.length) throw Object.assign(new Error(`docs stage introduced broken links: ${newBroken.slice(0, 10).join('; ')}`), { stage: 'docs' });
    commitStage(workspace, 'Docs stage');
  }

  const touched = changedSince(workspace, 'input');
  report.touched = touched;
  if (!touched.length) { report.status = 'no-changes'; return finish(report, directory); }
  report.stage = 'checks';
  writeJson(path.join(directory, 'report.json'), report);
  const env = childEnvironment('checks', repo, config);
  const checkDirectory = path.join(directory, 'checks');
  fs.mkdirSync(checkDirectory, { recursive: true });
  report.checks = await checkRunner({ workspace, edited: touched, config, env, directory: checkDirectory });
  writeJson(path.join(qualityDirectory, 'checks.json'), report.checks);
  if (report.checks.some(check => !check.passed)) throw Object.assign(new Error('checks introduced new failures'), { stage: 'checks' });
  if (config.verify) {
    fs.writeFileSync(path.join(qualityDirectory, 'final.diff'), git(workspace, ['diff', '--binary', 'input', 'HEAD']));
    const verdictText = await runStage('verify', 'triage');
    if (!/QUALITY_RESULT: PASS\s*$/.test(verdictText.trim())) throw Object.assign(new Error('final review did not pass'), { stage: 'verify' });
  }
  report.patchFile = path.join(directory, 'changes.patch');
  fs.writeFileSync(report.patchFile, git(workspace, ['diff', '--binary', 'input', 'HEAD']));
  report.stage = 'apply';
  if (!config.autoApply) { report.status = 'patch-ready'; return finish(report, directory); }
  const applied = tryApply({ repo, run: report, staleBusyHours: config.retention.staleBusyHours });
  report.status = applied.status;
  if (applied.status === 'stale-pending') report.pendingUntil = Date.now() + config.pendingApplyHours * 3_600_000;
  if (applied.status === 'stale') report.staleBecause = applied.changed || applied.error;
  if (applied.status === 'applied') removeWorkspace(repo, id);
  if (applied.status !== 'stale-pending') return finish(report, directory);
  writeJson(path.join(directory, 'report.json'), report);
  return report;
}

/** Retries stale-pending applies for a repository; gives up as stale after the pending window. */
export function retryPendingApplies(repo, { now = Date.now() } = {}) {
  const config = loadRepoConfig(repo);
  const runs = path.join(repoStateDirectory(repo), 'runs');
  if (!config || !fs.existsSync(runs)) return [];
  const results = [];
  for (const id of fs.readdirSync(runs)) {
    const directory = path.join(runs, id);
    const report = readJson(path.join(directory, 'report.json'));
    if (report?.status !== 'stale-pending') continue;
    const applied = tryApply({ repo, run: report, now, staleBusyHours: config.retention.staleBusyHours });
    if (applied.status === 'stale-pending' && now < report.pendingUntil) continue;
    report.status = applied.status === 'stale-pending' ? 'stale' : applied.status;
    if (applied.status === 'stale') report.staleBecause = applied.changed || applied.error;
    if (report.status === 'applied') removeWorkspace(repo, id);
    results.push(finish(report, directory));
  }
  return results;
}
