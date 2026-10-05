import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const hash = value => crypto.createHash('sha256').update(value).digest('hex');

/** The folder holding this tool (hook.mjs, worker.mjs, …); hooks are installed to point here. */
export const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Set in every model and check child; hooks seeing it do nothing. VANTAGE_QUALITY_CHILD is the retired name. */
export const CHILD_FLAG = 'AGENT_QUALITY_CHILD';
export const isQualityChild = env => env[CHILD_FLAG] === '1' || env.VANTAGE_QUALITY_CHILD === '1';

export function git(cwd, args, { env, input, allowFail = false } = {}) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, input,
      stdio: ['pipe', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : process.env
    });
  } catch (error) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')} failed: ${String(error.stderr || error.message).trim()}`);
  }
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return fallback; throw error; }
}
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}
export function appendJsonLine(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(value) + '\n');
}

export function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
/** Exclusive file lock owned by this process; a lock left by a dead process is taken over. */
export function acquireLock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = readJson(file);
    if (owner && processAlive(owner.pid)) return null;
    fs.rmSync(file, { force: true });
    return acquireLock(file);
  }
  return () => { if (readJson(file)?.pid === process.pid) fs.rmSync(file, { force: true }); };
}
export function lockHeld(file) {
  const owner = readJson(file);
  return Boolean(owner && processAlive(owner.pid));
}

/** Machine-wide state: hook shim, config, session files, worker lock and log, notices. */
export function homeDirectory() {
  return process.env.AGENT_QUALITY_HOME || path.join(os.homedir(), '.agent-quality');
}
/** Large disposable checkouts live outside every repository so children inherit no parent instructions. */
export function workDirectory() {
  return process.env.AGENT_QUALITY_WORK || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'agent-quality');
}
/** Per-worktree state (reports, triage log, pause marker) under the Git directory. */
export function repoStateDirectory(repo) {
  return path.resolve(repo, git(repo, ['rev-parse', '--git-path', 'agent-quality']).trim());
}
export function samePath(a, b) {
  return normalizePath(a) === normalizePath(b);
}
export function normalizePath(value) {
  const resolved = path.resolve(value).replaceAll('\\', '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
/** True when a session root and a repository overlap: same folder, the root contains it, or the root is inside it. */
export function rootTouchesRepo(root, repo) {
  const r = normalizePath(root);
  const p = normalizePath(repo);
  return r === p || p.startsWith(r + '/') || r.startsWith(p + '/');
}

/** Paths never shown to a model: secrets, dependencies, build output and logs. */
export function allowedFile(file) {
  return !/(^|\/)(node_modules|\.git|\.quality|dist|coverage|\.vercel|\.next)(\/|$)/.test(file)
    && (!/(^|\/)\.env(\.|$)/.test(file) || file.endsWith('.env.example'))
    && !/(^|\/)([^/]*service-account[^/]*\.json|client_secret[^/]*|credentials\.json|ringcentral-credentials\.json|[^/]*token-cache[^/]*\.json|hidden_credentials[^/]*)$/i.test(file)
    && !/\.(pem|key|p12|pfx|log|tsbuildinfo)$/.test(file);
}

const globCache = new Map();
export function globToRegExp(glob) {
  if (globCache.has(glob)) return globCache.get(glob);
  let source = '';
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      if (glob[index + 2] === '/') { source += '(?:.*/)?'; index += 2; }
      else { source += '.*'; index += 1; }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const expression = new RegExp(`^${source}$`);
  globCache.set(glob, expression);
  return expression;
}
export function matchesAny(file, globs = []) {
  return globs.some(glob => globToRegExp(glob).test(file));
}

export function directorySize(directory) {
  let total = 0;
  if (!fs.existsSync(directory)) return 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    total += entry.isDirectory() ? directorySize(full) : fs.statSync(full).size;
  }
  return total;
}
