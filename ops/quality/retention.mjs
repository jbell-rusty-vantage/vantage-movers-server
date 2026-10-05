import fs from 'node:fs';
import path from 'node:path';
import { readJson, repoStateDirectory, workDirectory, normalizePath, git } from './util.mjs';
import { DEFAULTS } from './config.mjs';
import { listReviewedRefs, deleteRef, worktreePaths, worktreeKey, branchExists } from './git-snapshot.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function remove(target, removed, dryRun) {
  removed.push(target);
  if (!dryRun) fs.rmSync(target, { recursive: true, force: true });
}
function rotate(file, limitBytes, removed, dryRun) {
  if (!fs.existsSync(file) || fs.statSync(file).size < limitBytes) return;
  const older = file.replace(/(\.[^.]+)$/, '.1$1');
  removed.push(`${file} (rotated)`);
  if (dryRun) return;
  fs.rmSync(older, { force: true });
  fs.renameSync(file, older);
}

/** Machine-wide stores: session files, notices, worker log. */
export function purgeHome(home, { now = Date.now(), retention = DEFAULTS.retention, dryRun = false } = {}) {
  const removed = [];
  const sessions = path.join(home, 'sessions');
  if (fs.existsSync(sessions)) {
    for (const name of fs.readdirSync(sessions)) {
      const file = path.join(sessions, name);
      const session = readJson(file);
      const at = session?.at ?? fs.statSync(file).mtimeMs;
      // Any session silent for sessionHours is gone or crashed (busy markers stop counting after staleBusyHours).
      if (now - at > retention.sessionHours * HOUR) remove(file, removed, dryRun);
    }
  }
  const notices = path.join(home, 'notices');
  if (fs.existsSync(notices)) {
    for (const name of fs.readdirSync(notices)) {
      const file = path.join(notices, name);
      const at = readJson(file)?.at ?? fs.statSync(file).mtimeMs;
      if (now - at > retention.noticeHours * HOUR) remove(file, removed, dryRun);
    }
  }
  for (const log of ['worker.log', 'hook-errors.log']) rotate(path.join(home, log), retention.logMb * 1024 * 1024, removed, dryRun);
  return removed;
}

/** Per-repository stores: triage log, run reports, disposable workspaces, reviewed refs, legacy state. */
/** `deadline` bounds one pass (large legacy runs take seconds each); the next pass continues. */
export function purgeRepo(repo, { now = Date.now(), retention = DEFAULTS.retention, dryRun = false, deadline = Infinity } = {}) {
  const removed = [];
  const state = repoStateDirectory(repo);
  rotate(path.join(state, 'triage.jsonl'), retention.logMb * 1024 * 1024, removed, dryRun);
  // State from the retired pipeline: append-only events, content blobs, its baseline and lock.
  for (const legacy of ['events', 'blobs', 'baseline.json', 'worker.lock', 'worker.log', 'lifecycle-codex.log', 'lifecycle-cursor.log']) {
    const target = path.join(state, legacy);
    if (fs.existsSync(target)) remove(target, removed, dryRun);
  }
  // The first installation kept its state under .git/vantage-quality, holding full run checkouts; remove it in slices.
  const legacyState = path.resolve(repo, git(repo, ['rev-parse', '--git-path', 'vantage-quality']).trim());
  if (legacyState !== state && fs.existsSync(legacyState)) {
    const legacyRuns = path.join(legacyState, 'runs');
    for (const id of fs.existsSync(legacyRuns) ? fs.readdirSync(legacyRuns) : []) {
      if (Date.now() > deadline) break;
      remove(path.join(legacyRuns, id), removed, dryRun);
    }
    if (!dryRun && (!fs.existsSync(legacyRuns) || !fs.readdirSync(legacyRuns).length) && Date.now() <= deadline) {
      // A worktree registered inside the old folder (task-sources/) is left in place; only the rest goes.
      for (const name of fs.readdirSync(legacyState)) if (name !== 'task-sources') remove(path.join(legacyState, name), removed, dryRun);
    }
  }
  const runs = path.join(state, 'runs');
  if (fs.existsSync(runs)) {
    const ids = fs.readdirSync(runs).sort().reverse();
    ids.forEach((id, index) => {
      if (Date.now() > deadline) return;
      const directory = path.join(runs, id);
      const report = readJson(path.join(directory, 'report.json'));
      const started = Number(id.split('-')[0]) || fs.statSync(directory).mtimeMs;
      // A run still 'running' after a day belonged to a crashed worker.
      if (report?.status === 'stale-pending' || (report?.status === 'running' && now - started < DAY)) return;
      if (index >= retention.keepRuns || now - started > retention.runDays * DAY) remove(directory, removed, dryRun);
    });
  }
  const workspaces = path.join(workDirectory(), 'runs', path.basename(repo));
  if (fs.existsSync(workspaces)) {
    for (const id of fs.readdirSync(workspaces)) {
      if (Date.now() > deadline) break;
      const report = readJson(path.join(runs, id, 'report.json'));
      const started = Number(id.split('-')[0]) || 0;
      const finished = report && !['running', 'stale-pending'].includes(report.status);
      const keepForInspection = report && ['failed', 'stale'].includes(report.status) && now - started < retention.workspaceDays * DAY;
      if (!report ? now - started > HOUR : finished && !keepForInspection) remove(path.join(workspaces, id), removed, dryRun);
    }
  }
  const liveKeys = new Set(worktreePaths(repo).map(worktreeKey));
  const ownKey = worktreeKey(repo);
  for (const ref of listReviewedRefs(repo)) {
    const [, , , key, ...branch] = ref.split('/');
    const gone = !liveKeys.has(key) || (key === ownKey && !branch.join('/').startsWith('detached-') && !branchExists(repo, branch.join('/')));
    if (gone) { removed.push(ref); if (!dryRun) deleteRef(repo, ref); }
  }
  return removed;
}

export function sameRepo(a, b) { return normalizePath(a) === normalizePath(b); }
