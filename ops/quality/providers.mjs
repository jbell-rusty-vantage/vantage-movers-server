import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { CHILD_FLAG } from './util.mjs';

export const PROVIDERS = ['claude', 'cursor', 'codex'];
const localAppData = () => process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

/** Executable (and argument prefix) for a provider CLI. Each can be overridden with AGENT_QUALITY_<PROVIDER>_BIN. */
export function commandFor(provider) {
  const override = process.env[`AGENT_QUALITY_${provider.toUpperCase()}_BIN`];
  if (override) return { command: override, prefix: [] };
  if (provider === 'claude') {
    const local = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
    return { command: fs.existsSync(local) ? local : 'claude', prefix: [] };
  }
  if (provider === 'cursor') {
    if (process.platform !== 'win32') return { command: 'agent', prefix: [] };
    // Spawn the bundled Node launcher directly; the .cmd/PowerShell wrappers cannot be spawned without a shell.
    const directory = path.join(localAppData(), 'cursor-agent', 'versions');
    const versions = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => /^\d{4}\.\d{2}\.\d{2}-/.test(name)).sort().reverse() : [];
    if (!versions.length) throw new Error('Cursor CLI is missing. Install agent or set AGENT_QUALITY_CURSOR_BIN.');
    const version = path.join(directory, versions[0]);
    return { command: path.join(version, 'node.exe'), prefix: [path.join(version, 'index.js')] };
  }
  if (provider === 'codex') {
    // The Codex app installs versioned binaries under a hash folder that changes on update; it is not on PATH.
    const directory = path.join(localAppData(), 'OpenAI', 'Codex', 'bin');
    const candidates = fs.existsSync(directory)
      ? fs.readdirSync(directory).map(name => path.join(directory, name, process.platform === 'win32' ? 'codex.exe' : 'codex')).filter(file => fs.existsSync(file))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      : [];
    return { command: candidates[0] || 'codex', prefix: [] };
  }
  throw new Error(`Unknown provider: ${provider}`);
}

const SAFE_ENV = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|COMMONPROGRAMFILES|COMMONPROGRAMFILES\(X86\)|PSMODULEPATH|OS|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS|USERNAME|USERDOMAIN|COMPUTERNAME|LANG|LC_ALL|TERM|TZ|HTTP_PROXY|HTTPS_PROXY|NO_PROXY|CODEX_HOME|CLAUDE_CONFIG_DIR|CLAUDE_CODE_GIT_BASH_PATH|NODE_EXTRA_CA_CERTS)$/i;

/**
 * Environment for a model or check child: an allowlist, never the repository's
 * runtime secrets. Repository config adds `childEnv` (e.g. TEST_MODE) and lists
 * `secretsEnvFiles`, from which ONLY CURSOR_API_KEY is read, and only for Cursor.
 * ANTHROPIC_API_KEY is never passed (it would override the Claude subscription login).
 */
export function childEnvironment(provider, repo, config = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (SAFE_ENV.test(key)) env[key] = value;
  if (provider === 'cursor') {
    let key = process.env.CURSOR_API_KEY;
    for (const relative of config.secretsEnvFiles || ['.env']) {
      if (key) break;
      const file = repo ? path.resolve(repo, relative) : null;
      if (file && fs.existsSync(file)) key = parseEnv(fs.readFileSync(file, 'utf8')).CURSOR_API_KEY;
    }
    if (key) env.CURSOR_API_KEY = key;
  }
  return { ...env, ...(config.childEnv || {}), CI: 'true', [CHILD_FLAG]: '1', VANTAGE_QUALITY_CHILD: '1' };
}

export function killTree(child) {
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { child.kill(); }
  } else child.kill('SIGTERM');
}

/** Runs a process with stdout and stderr captured to files; resolves with the exit code. */
export function runProcess(command, args, { cwd, env, input, stdoutFile, stderrFile, timeoutMs = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(stdoutFile), { recursive: true });
    const out = fs.openSync(stdoutFile, 'w');
    const err = fs.openSync(stderrFile || stdoutFile, stderrFile ? 'w' : 'a');
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['pipe', out, err] });
    let timedOut = false;
    let closed = false;
    const close = () => { if (!closed) { closed = true; fs.closeSync(out); if (err !== out) fs.closeSync(err); } };
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
    child.on('error', error => { clearTimeout(timer); close(); reject(error); });
    child.on('close', code => { clearTimeout(timer); close(); resolve({ code, timedOut }); });
  });
}

const CLAUDE_READ_TOOLS = 'Read,Grep,Glob';
const CLAUDE_EDIT_TOOLS = 'Read,Grep,Glob,Edit,MultiEdit,Write,Bash(git diff:*),Bash(git status:*),Bash(node:*),Bash(npx tsc:*),Bash(npx eslint:*),Bash(pnpm typecheck:*),Bash(pnpm lint:*)';

/** Argument lists per provider and role. `role` is 'triage' (read-only, structured) or 'edit'. */
export function modelArguments({ provider, role, cwd, model, schemaFile, schema, output, addDirs = [], prompt }) {
  if (provider === 'claude') {
    return [
      '-p', '--model', model, '--output-format', 'json',
      '--permission-mode', 'dontAsk', '--allowedTools', role === 'triage' ? CLAUDE_READ_TOOLS : CLAUDE_EDIT_TOOLS,
      '--strict-mcp-config', '--settings', JSON.stringify({ disableAllHooks: true }), '--setting-sources', 'project',
      '--no-session-persistence', '--effort', role === 'triage' ? 'medium' : 'high',
      ...(schema ? ['--json-schema', JSON.stringify(schema)] : []),
      ...addDirs.flatMap(directory => ['--add-dir', directory])
    ];
  }
  if (provider === 'cursor') {
    return [
      '-p', '--trust', '--output-format', 'json', '--workspace', cwd, '--model', model,
      ...(role === 'triage' ? ['--mode', 'ask'] : ['--force']),
      ...addDirs.flatMap(directory => ['--add-dir', directory]),
      prompt
    ];
  }
  if (provider === 'codex') {
    return [
      'exec', '--ephemeral', '--disable', 'hooks', '-c', 'approval_policy="never"',
      '-c', `model_reasoning_effort="${role === 'triage' ? 'medium' : 'high'}"`,
      '-s', role === 'triage' ? 'read-only' : 'workspace-write', '-C', cwd, '-m', model,
      ...(schemaFile ? ['--output-schema', schemaFile] : []),
      '-o', output, '-'
    ];
  }
  throw new Error(`Unknown provider: ${provider}`);
}

/**
 * Runs one model session and returns { text, structured? }. Claude and Codex take the
 * prompt on stdin; Cursor takes it as an argument (keep Cursor prompts short and point at files).
 */
export async function runModel({ provider, role, cwd, prompt, model, schema, output, addDirs = [], repo, config, timeoutMs }) {
  const { command, prefix } = commandFor(provider);
  let schemaFile;
  if (schema && provider === 'codex') {
    schemaFile = `${output}.schema.json`;
    fs.writeFileSync(schemaFile, JSON.stringify(schema));
  }
  const args = modelArguments({ provider, role, cwd, model, schema: provider === 'claude' ? schema : undefined, schemaFile, output, addDirs, prompt });
  const stdoutFile = `${output}.stdout.log`;
  const stderrFile = `${output}.stderr.log`;
  const result = await runProcess(command, [...prefix, ...args], {
    cwd, env: childEnvironment(provider, repo, config), input: provider === 'cursor' ? '' : prompt, stdoutFile, stderrFile, timeoutMs
  });
  if (result.timedOut) throw new Error(`${provider} timed out after ${Math.round(timeoutMs / 60_000)} min; see ${stdoutFile}`);
  if (result.code !== 0) throw new Error(`${provider} exited ${result.code}; see ${stderrFile}`);
  let text;
  let structured;
  if (provider === 'codex') {
    text = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
    if (schema) structured = JSON.parse(text);
  } else {
    const response = JSON.parse(fs.readFileSync(stdoutFile, 'utf8').trim().split('\n').at(-1));
    if (response.is_error || typeof response.result !== 'string') throw new Error(`${provider} returned an error result; see ${stdoutFile}`);
    text = response.result;
    if (provider === 'claude' && schema) structured = response.structured_output;
    fs.writeFileSync(output, text);
  }
  if (!text.trim() && !structured) throw new Error(`${provider} returned no output`);
  return { text, structured };
}
