// Background worker: one per machine. Started detached by hooks; exits when idle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeDirectory, readJson, writeJson, acquireLock, rootTouchesRepo, normalizePath, repoStateDirectory, TOOL_DIR } from './util.mjs';
import { loadRepoConfig, optedIn, DEFAULTS } from './config.mjs';
import { toplevel, snapshotTree } from './git-snapshot.mjs';
import { processRepo, retryPendingApplies, busySessions } from './pipeline.mjs';
import { purgeHome, purgeRepo } from './retention.mjs';

const TICK_MS = 10_000;
const IDLE_EXIT_MS = 10 * 60_000;
const STABLE_MS = 20_000;
// Retention runs in short slices so a large backlog never delays a checkpoint.
const PURGE_EVERY_MS = 10 * 60_000;
const PURGE_BUDGET_MS = 30_000;
const log = message => process.stdout.write(`${new Date().toISOString()} ${message}\n`);

export function readSessions(home) {
  const directory = path.join(home, 'sessions');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => readJson(path.join(directory, name))).filter(Boolean);
}

/** Configured repositories plus opted-in worktrees that sessions are working in. */
export function candidateRepos(config, sessions, cache = new Map()) {
  const repos = new Map((config?.repos || []).filter(repo => fs.existsSync(repo)).map(repo => [normalizePath(repo), repo]));
  for (const root of sessions.flatMap(session => session.roots || [])) {
    if (!cache.has(root)) cache.set(root, toplevel(root));
    const top = cache.get(root);
    if (top && optedIn(top)) repos.set(normalizePath(top), top);
  }
  return [...repos.values()];
}

/**
 * The trigger a repository is waiting on: the newest turn end / session end from a
 * session touching it, or null when none is newer than the last handled one.
 */
export function pendingTrigger(repo, sessions, handledAt, { now = Date.now(), staleBusyHours = 6 } = {}) {
  const touching = sessions.filter(session => (session.roots || []).some(root => rootTouchesRepo(root, repo)));
  const busy = touching.some(session => session.state === 'busy' && now - session.at < staleBusyHours * 3_600_000);
  const latest = touching.filter(session => session.trigger).sort((a, b) => b.at - a.at)[0];
  if (!latest || latest.at <= handledAt) return { busy, trigger: null };
  return { busy, trigger: latest };
}

export async function runWorker() {
  const home = homeDirectory();
  const release = acquireLock(path.join(home, 'worker.lock'));
  if (!release) return;
  const stop = () => { release(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  log(`worker ${process.pid} started (tool ${TOOL_DIR})`);
  const memory = new Map();
  const rootCache = new Map();
  let lastActivity = Date.now();
  let lastPurge = 0;
  try {
    while (true) {
      const now = Date.now();
      const config = readJson(path.join(home, 'config.json'), { repos: [] });
      const sessions = readSessions(home);
      const repos = candidateRepos(config, sessions, rootCache);
      if (now - lastPurge > PURGE_EVERY_MS) {
        lastPurge = now;
        try {
          const removed = [...purgeHome(home, { now }), ...repos.flatMap(repo => purgeRepo(repo, { now, deadline: now + PURGE_BUDGET_MS, retention: loadRepoConfig(repo)?.retention || DEFAULTS.retention }))];
          if (removed.length) log(`retention removed ${removed.length} item(s)`);
        } catch (error) { log(`retention failed: ${error.message}`); }
      }
      let waiting = false;
      for (const repo of repos) {
        const repoConfig = loadRepoConfig(repo);
        if (!repoConfig?.enabled) continue;
        try {
          for (const result of retryPendingApplies(repo, { now })) log(`${path.basename(repo)} pending run ${result.id}: ${result.status}`);
          const statePath = path.join(repoStateDirectory(repo), 'worker-state.json');
          const repoState = readJson(statePath, { handledAt: 0 });
          const { busy, trigger } = pendingTrigger(repo, sessions, repoState.handledAt, { now, staleBusyHours: repoConfig.retention.staleBusyHours });
          if (busy) { waiting = true; lastActivity = now; }
          if (!trigger) continue;
          waiting = true;
          lastActivity = now;
          if (busy) continue;
          const quiet = (trigger.state === 'ended' ? repoConfig.quietSeconds.end : repoConfig.quietSeconds.idle) * 1000;
          if (now - trigger.at < quiet) continue;
          // The working tree must also hold still for the quiet window.
          const tree = snapshotTree(repo);
          const seen = memory.get(repo);
          if (!seen || seen.tree !== tree) { memory.set(repo, { tree, since: now }); continue; }
          if (now - seen.since < STABLE_MS) continue;
          writeJson(statePath, { handledAt: trigger.at, handledRun: now });
          memory.delete(repo);
          if (busySessions(repo, { now }).length) continue;
          log(`${path.basename(repo)}: checkpoint after ${trigger.provider} ${trigger.state} (${trigger.session})`);
          const result = await processRepo({ repo, provider: trigger.provider, reason: trigger.state === 'ended' ? 'session-end' : 'turn-end' });
          log(`${path.basename(repo)}: ${result.status}${result.id ? ` run ${result.id}` : ''}${result.error ? ` — ${result.error}` : ''}`);
        } catch (error) { log(`${path.basename(repo)}: worker error ${error.stack || error.message}`); }
      }
      if (!waiting && Date.now() - lastActivity > IDLE_EXIT_MS) { log('idle, exiting'); return; }
      await new Promise(resolve => setTimeout(resolve, TICK_MS));
    }
  } finally { release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runWorker();
