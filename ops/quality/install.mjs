import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readJson, writeJson, homeDirectory, normalizePath, samePath, git, TOOL_DIR } from './util.mjs';
import { optedIn } from './config.mjs';
import { commandFor } from './providers.mjs';
import { branchName, headCommit, readReviewed, writeReviewed, snapshotTree, toplevel } from './git-snapshot.mjs';

export const MARKER = '.agent-quality/hook.mjs';
// Earlier registrations this installer replaces: the retired per-repo pipeline and the first shim location.
const LEGACY = /quality\/hook-entry\.mjs|\.vantage-quality\/hook\.mjs/;

/** Tool event name → normalized event, per tool. */
export const EVENT_MAP = {
  claude: { SessionStart: 'start', UserPromptSubmit: 'busy', Stop: 'idle', SessionEnd: 'end' },
  cursor: { sessionStart: 'start', beforeSubmitPrompt: 'busy', stop: 'idle', sessionEnd: 'end' },
  codex: { SessionStart: 'start', UserPromptSubmit: 'busy', Stop: 'idle', SessionEnd: 'end', Interrupt: 'interrupt' }
};
const commandsOf = item => [item?.command, ...(item?.hooks || []).map(hook => hook?.command)].filter(Boolean);
const ours = item => commandsOf(item).some(command => command.includes(MARKER) || LEGACY.test(command));

/**
 * Returns the tool's hook configuration with our entries replaced and every
 * unrelated entry preserved. Idempotent.
 */
export function mergeHooks(tool, existing = {}, shimCommand) {
  const config = { ...existing, ...(tool === 'cursor' ? { version: existing.version || 1 } : {}), hooks: {} };
  for (const [event, list] of Object.entries(existing.hooks || {})) {
    const kept = (list || []).filter(item => !ours(item));
    if (kept.length) config.hooks[event] = kept;
  }
  for (const [event, normalized] of Object.entries(EVENT_MAP[tool])) {
    const command = `${shimCommand} --provider ${tool} --event ${normalized}`;
    // Codex SessionEnd/Interrupt allow at most 3 s; the hook returns in well under 1 s.
    const timeout = tool === 'codex' && (event === 'SessionEnd' || event === 'Interrupt') ? 3 : 5;
    const entry = tool === 'cursor'
      ? { command, timeout }
      : { hooks: [{ type: 'command', command, timeout, ...(tool === 'codex' ? { statusMessage: 'Quality checkpoint' } : {}) }] };
    config.hooks[event] = [...(config.hooks[event] || []), entry];
  }
  return config;
}
/** Removes our (and the retired pipeline's) entries; null when nothing is left. */
export function stripHooks(existing = {}) {
  const hooks = {};
  for (const [event, list] of Object.entries(existing.hooks || {})) {
    const kept = (list || []).filter(item => !ours(item));
    if (kept.length) hooks[event] = kept;
  }
  const rest = Object.keys(existing).filter(key => !['hooks', 'version', 'description'].includes(key));
  return Object.keys(hooks).length || rest.length ? { ...existing, hooks } : null;
}

export const SHIM = `// Installed by the quality-checkpoints install.mjs. Do not edit; re-run the installer instead.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
try {
  const config = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
  await import(pathToFileURL(path.join(config.toolDir, 'hook.mjs')).href);
} catch (error) {
  try { fs.appendFileSync(new URL('./hook-errors.log', import.meta.url), new Date().toISOString() + ' shim: ' + (error.stack || error) + '\\n'); } catch {}
  process.stdout.write('{}\\n');
}
`;

function backupAndWrite(file, value) {
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const after = JSON.stringify(value, null, 2) + '\n';
  if (before === after) return false;
  if (before !== null) fs.copyFileSync(file, `${file}.vantage-backup-${Date.now()}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, after);
  return true;
}

async function codexHookList(cwds) {
  const { command } = commandFor('codex');
  const child = spawn(command, ['app-server', '--stdio'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buffer = '';
  let id = 0;
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const request = pending.get(message.id);
      if (request) { pending.delete(message.id); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); }
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const current = ++id;
    pending.set(current, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: current, method, params })}\n`);
  });
  const timer = setTimeout(() => { for (const item of pending.values()) item.reject(new Error(`Codex hook inspection timed out: ${stderr.slice(-500)}`)); child.kill(); }, 30_000);
  try {
    await request('initialize', { clientInfo: { name: 'agent-quality-installer', version: '2.0.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write('{"jsonrpc":"2.0","method":"initialized"}\n');
    return await request('hooks/list', { cwds });
  } finally { clearTimeout(timer); child.kill(); }
}

const TRUST_START = '# BEGIN AGENT QUALITY HOOK TRUST';
const TRUST_END = '# END AGENT QUALITY HOOK TRUST';
// Every trust block this installer has written, under any name; two blocks would declare the same TOML tables twice.
const TRUST_BLOCK = /\n*# BEGIN (?:AGENT|VANTAGE) QUALITY HOOK TRUST\n[\s\S]*?# END (?:AGENT|VANTAGE) QUALITY HOOK TRUST\n?/g;

/** Codex config text with all our trust blocks removed and, when given, one fresh block appended. */
export function withTrustBlock(text, hooks = []) {
  let result = text.replace(TRUST_BLOCK, '\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
  if (hooks.length) result += `\n${TRUST_START}\n` + hooks.map(hook => `[hooks.state.${JSON.stringify(hook.key)}]\nenabled = true\ntrusted_hash = ${JSON.stringify(hook.currentHash)}\n`).join('\n') + `${TRUST_END}\n`;
  return result;
}

/** Codex skips hooks until their exact definition is trusted by hash. */
async function trustCodexHooks(cwds) {
  const configFile = path.join(os.homedir(), '.codex', 'config.toml');
  const original = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : '';
  if (original) fs.copyFileSync(configFile, `${configFile}.vantage-backup-${Date.now()}`);
  // Clear old blocks first: a config Codex cannot parse lists no hooks at all.
  fs.writeFileSync(configFile, withTrustBlock(original));
  const listed = await codexHookList(cwds);
  const owned = [...new Map(listed.data.flatMap(item => item.hooks).filter(hook => hook.command?.includes(MARKER)).map(hook => [hook.key, hook])).values()];
  if (!owned.length) throw new Error('Codex did not discover the installed hooks');
  fs.writeFileSync(configFile, withTrustBlock(fs.readFileSync(configFile, 'utf8'), owned));
  const verified = (await codexHookList(cwds)).data.flatMap(item => item.hooks).filter(hook => hook.command?.includes(MARKER));
  if (!verified.length) throw new Error('Codex lists no hooks after trusting them; check ~/.codex/config.toml parses');
  const untrusted = verified.filter(hook => hook.trustStatus !== 'trusted');
  if (untrusted.length) throw new Error(`Codex hooks still untrusted: ${untrusted.map(hook => hook.key).join(', ')}`);
  return new Set(verified.map(hook => hook.key)).size;
}

/**
 * Opted-in repositories: previously configured ones, --repo arguments, the repository
 * of the current directory and of the tool, and opted-in siblings of all of those
 * (a multi-repo workspace folder opts in repository by repository).
 */
export function discoverRepos({ previous = [], extra = [], cwd = process.cwd() } = {}) {
  const seeds = [...previous, ...extra, toplevel(cwd), toplevel(TOOL_DIR)].filter(Boolean).map(repo => path.resolve(repo));
  const siblings = [...new Set(seeds.map(repo => path.dirname(repo)))].flatMap(parent => {
    try { return fs.readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(parent, entry.name)); }
    catch { return []; }
  });
  const all = [...seeds, ...siblings].filter(repo => fs.existsSync(repo) && optedIn(repo) && toplevel(repo) && samePath(toplevel(repo), repo));
  return [...new Map(all.map(repo => [normalizePath(repo), repo.replaceAll('\\', '/')])).values()];
}

/** One-time move from the first installation's names (~/.vantage-quality, refs/vantage-quality). */
function migrateLegacy(home, repos) {
  const legacyHome = path.join(os.homedir(), '.vantage-quality');
  const previous = readJson(path.join(legacyHome, 'config.json'), {})?.repos || [];
  if (fs.existsSync(legacyHome) && !samePath(legacyHome, home)) fs.rmSync(legacyHome, { recursive: true, force: true });
  for (const repo of repos) {
    const refs = (git(repo, ['for-each-ref', '--format=%(refname)', 'refs/vantage-quality/'], { allowFail: true }) || '').split('\n').filter(Boolean);
    for (const ref of refs) git(repo, ['update-ref', '-d', ref], { allowFail: true });
  }
  return previous;
}

export async function install({ extraRepos = [], skipCodexTrust = false, cwd = process.cwd() } = {}) {
  const home = homeDirectory();
  const configPath = path.join(home, 'config.json');
  const legacyRepos = readJson(path.join(os.homedir(), '.vantage-quality', 'config.json'), {})?.repos || [];
  const repos = discoverRepos({ previous: [...(readJson(configPath, {})?.repos || []), ...legacyRepos], extra: extraRepos, cwd });
  migrateLegacy(home, repos);
  fs.mkdirSync(home, { recursive: true });
  writeJson(configPath, { toolDir: TOOL_DIR.replaceAll('\\', '/'), repos, installedAt: new Date().toISOString() });
  fs.writeFileSync(path.join(home, 'hook.mjs'), SHIM);
  const shimCommand = `node "${path.join(home, 'hook.mjs').replaceAll('\\', '/')}"`;
  const changed = {};
  const userFiles = {
    claude: path.join(os.homedir(), '.claude', 'settings.json'),
    cursor: path.join(os.homedir(), '.cursor', 'hooks.json'),
    codex: path.join(os.homedir(), '.codex', 'hooks.json')
  };
  for (const [tool, file] of Object.entries(userFiles)) changed[file] = backupAndWrite(file, mergeHooks(tool, readJson(file, {}), shimCommand));
  // Project-level registrations of the retired pipeline would fire a second time.
  for (const repo of repos) {
    for (const file of [path.join(repo, '.cursor', 'hooks.json'), path.join(repo, '.codex', 'hooks.json')]) {
      if (!fs.existsSync(file)) continue;
      const stripped = stripHooks(readJson(file, {}));
      if (stripped) changed[file] = backupAndWrite(file, stripped);
      else { fs.rmSync(file); changed[file] = 'removed'; }
    }
  }
  // Work that already exists at install time is the baseline; only later changes are checkpointed.
  const baselines = {};
  for (const repo of repos) {
    const branch = branchName(repo);
    if (readReviewed(repo, branch)) { baselines[repo] = 'kept'; continue; }
    writeReviewed(repo, branch, snapshotTree(repo), headCommit(repo), 'baseline at install');
    baselines[repo] = `baseline ${branch}`;
  }
  let codexTrusted = 'skipped';
  if (!skipCodexTrust) codexTrusted = await trustCodexHooks([...new Set([...repos, ...repos.map(repo => path.dirname(repo))])]);
  return { home, toolDir: TOOL_DIR, repos, changed, baselines, codexTrusted };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const extra = process.argv.flatMap((value, index, all) => all[index - 1] === '--repo' ? [value] : []);
  console.log(JSON.stringify(await install({ extraRepos: extra, skipCodexTrust: process.argv.includes('--skip-codex-trust') }), null, 2));
}
