import fs from 'node:fs';
import path from 'node:path';
import { homeDirectory, readJson, writeJson, lockHeld, repoStateDirectory, directorySize, workDirectory } from './util.mjs';
import { loadRepoConfig, optedIn, DEFAULTS } from './config.mjs';
import { toplevel, branchName, readReviewed } from './git-snapshot.mjs';
import { processRepo, recentTriage, tryApply, triageLog } from './pipeline.mjs';
import { purgeHome, purgeRepo } from './retention.mjs';
import { readSessions } from './worker.mjs';
import { install } from './install.mjs';
import { PROVIDERS } from './providers.mjs';

const args = process.argv.slice(2);
const command = args[0] || 'status';
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index < 0 ? fallback : args[index + 1]; };
const flag = name => args.includes(`--${name}`);
const configuredRepos = () => readJson(path.join(homeDirectory(), 'config.json'), {})?.repos || [];

/** Repository for a command: --repo, else the current directory's opted-in checkout. */
function targetRepo() {
  const explicit = option('repo');
  const candidate = toplevel(explicit ? path.resolve(explicit) : process.cwd());
  if (candidate && optedIn(candidate)) return candidate;
  throw new Error(`${explicit || process.cwd()} is not inside an opted-in repository (no .quality.config.json). Use --repo <path>.`);
}
function detectProvider() {
  const explicit = option('provider');
  if (explicit) {
    if (!PROVIDERS.includes(explicit)) throw new Error(`--provider must be one of ${PROVIDERS.join(', ')}`);
    return explicit;
  }
  if (process.env.CURSOR_AGENT || process.env.CURSOR_VERSION || process.env.CURSOR_TRACE_ID) return 'cursor';
  if (process.env.CODEX_THREAD_ID || process.env.CODEX_SANDBOX || process.env.CODEX_MANAGED_BY_NPM) return 'codex';
  return 'claude';
}

function repoStatus(repo, now) {
  const state = repoStateDirectory(repo);
  const branch = branchName(repo);
  const runs = path.join(state, 'runs');
  const latestRun = fs.existsSync(runs) ? fs.readdirSync(runs).sort().reverse().map(id => readJson(path.join(runs, id, 'report.json'))).find(Boolean) : null;
  const pending = fs.existsSync(runs) ? fs.readdirSync(runs).map(id => readJson(path.join(runs, id, 'report.json'))).filter(report => report?.status === 'stale-pending').map(report => report.id) : [];
  return {
    repo, branch, enabled: Boolean(loadRepoConfig(repo)?.enabled), mode: loadRepoConfig(repo)?.mode, paused: fs.existsSync(path.join(state, 'paused')),
    reviewed: readReviewed(repo, branch)?.commit || null,
    recentTriage: recentTriage(repo, 10).map(item => `${item.at} ${item.result}${item.provider ? ` (${item.provider})` : ''}${item.reason_text ? ` — ${item.reason_text}` : item.error ? ` — ${item.error}` : ''}`),
    latestRun: latestRun && { id: latestRun.id, status: latestRun.status, stage: latestRun.stage, provider: latestRun.provider, touched: latestRun.touched, error: latestRun.error, directory: latestRun.directory, ageMinutes: Math.round((now - Date.parse(latestRun.startedAt)) / 60_000) },
    pendingApplies: pending,
    storage: { runsMb: +(directorySize(runs) / 1048576).toFixed(1), triageLogKb: fs.existsSync(triageLog(repo)) ? Math.round(fs.statSync(triageLog(repo)).size / 1024) : 0 }
  };
}

async function main() {
  const home = homeDirectory();
  const now = Date.now();
  if (command === 'install') {
    const extra = args.flatMap((value, index) => args[index - 1] === '--repo' ? [path.resolve(value)] : []);
    console.log(JSON.stringify(await install({ extraRepos: extra, skipCodexTrust: flag('skip-codex-trust') }), null, 2));
    return;
  }
  if (command === 'status') {
    const sessions = readSessions(home);
    const counts = sessions.reduce((all, session) => ({ ...all, [session.state]: (all[session.state] || 0) + 1 }), {});
    console.log(JSON.stringify({
      home, worker: { running: lockHeld(path.join(home, 'worker.lock')), log: path.join(home, 'worker.log') }, sessions: counts,
      activeSessions: sessions.filter(session => now - session.at < 3_600_000).map(session => `${session.provider} ${session.state} ${Math.round((now - session.at) / 60_000)}m ${session.roots.join(', ')}`),
      storage: { homeKb: Math.round(directorySize(home) / 1024), workspacesMb: +(directorySize(path.join(workDirectory(), 'runs')) / 1048576).toFixed(1) },
      repos: configuredRepos().filter(repo => fs.existsSync(repo)).map(repo => repoStatus(repo, now))
    }, null, 2));
    return;
  }
  if (command === 'run') {
    const repo = targetRepo();
    const actions = option('actions')?.split(',').map(value => value.trim()).filter(Boolean) || null;
    if (actions?.some(action => !['clean', 'docs'].includes(action))) throw new Error('--actions takes clean, docs or clean,docs');
    const report = await processRepo({ repo, provider: detectProvider(), reason: 'manual', force: true, actions, dryRun: flag('dry-run') });
    console.log(JSON.stringify(report, null, 2));
    if (['failed', 'stale', 'busy', 'disabled'].includes(report.status)) process.exitCode = 1;
    return;
  }
  if (command === 'apply') {
    const repo = targetRepo();
    const id = args[1];
    const file = path.join(repoStateDirectory(repo), 'runs', id || '', 'report.json');
    const report = readJson(file);
    if (!report?.patchFile) throw new Error(`No patch for run ${id}`);
    const result = tryApply({ repo, run: report, ignoreBusy: true });
    if (result.status === 'applied') { report.status = 'applied'; writeJson(file, report); }
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'applied') process.exitCode = 1;
    return;
  }
  if (command === 'pause' || command === 'resume') {
    const repo = targetRepo();
    const marker = path.join(repoStateDirectory(repo), 'paused');
    if (command === 'pause') { fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, new Date().toISOString()); }
    else fs.rmSync(marker, { force: true });
    console.log(`${repo}: ${command === 'pause' ? 'paused' : 'resumed'}`);
    return;
  }
  if (command === 'prune') {
    const dryRun = flag('dry-run');
    const removed = [...purgeHome(home, { now, dryRun }), ...configuredRepos().filter(repo => fs.existsSync(repo)).flatMap(repo => purgeRepo(repo, { now, dryRun, retention: loadRepoConfig(repo)?.retention || DEFAULTS.retention }))];
    console.log(JSON.stringify({ dryRun, removed }, null, 2));
    return;
  }
  if (command === 'worker') { const { runWorker } = await import('./worker.mjs'); await runWorker(); return; }
  throw new Error(`Unknown command: ${command}. Use status | run | apply <id> | pause | resume | prune | install`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
