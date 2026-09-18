import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';

export function commandFor(provider) {
  if (provider === 'codex') return { command: process.env.VANTAGE_CODEX_BIN || 'codex', prefix: [] };
  if (provider !== 'cursor') throw new Error(`Unknown provider: ${provider}`);
  if (process.env.VANTAGE_CURSOR_BIN) return { command: process.env.VANTAGE_CURSOR_BIN, prefix: [] };
  if (process.platform !== 'win32') return { command: 'agent', prefix: [] };
  const directory = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'cursor-agent', 'versions');
  const versions = fs.readdirSync(directory).filter(name => /^\d{4}\.\d{2}\.\d{2}-/.test(name)).sort().reverse();
  if (!versions.length) throw new Error('Cursor CLI is missing. Install agent or set VANTAGE_CURSOR_BIN.');
  const version = path.join(directory, versions[0]);
  return { command: path.join(version, 'node.exe'), prefix: [path.join(version, 'index.js')] };
}
export function modelEnvironment(root) {
  // Only import the requested Cursor credential, never the server's production environment.
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|SYSTEMDRIVE|LANG|TERM|CODEX_HOME|CURSOR_API_KEY|OPENAI_API_KEY|HTTP_PROXY|HTTPS_PROXY|NO_PROXY)$/i.test(key)) env[key] = value;
  }
  if (!env.CURSOR_API_KEY && fs.existsSync(path.join(root, '.env'))) {
    env.CURSOR_API_KEY = parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8')).CURSOR_API_KEY;
  }
  return { ...env, VANTAGE_QUALITY_CHILD: '1', TEST_MODE: 'true', SHEET_SYNC_MODE: 'disabled', CI: 'true' };
}
export function runProcess(command, args, { cwd, env, input, log, timeoutMs = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const output = fs.openSync(log, 'w');
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['pipe', output, output] });
    let timedOut = false;
    let closed = false;
    const closeOutput = () => { if (!closed) { closed = true; fs.closeSync(output); } };
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { child.kill(); }
      } else child.kill('SIGTERM');
    }, timeoutMs);
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('error', error => { clearTimeout(timer); closeOutput(); reject(error); });
    child.on('close', code => { clearTimeout(timer); closeOutput(); resolve({ code, timedOut, log }); });
  });
}
export async function runModel({ provider, root, workspace, prompt, output, readOnly = false, model }) {
  const { command, prefix } = commandFor(provider);
  const args = provider === 'codex'
    ? ['exec', '--ephemeral', '--disable', 'hooks', '-c', 'approval_policy="never"', '-s', readOnly ? 'read-only' : 'workspace-write', '-C', workspace, '--output-last-message', output, ...(model ? ['-m', model] : []), '-']
    : ['--print', '--trust', '--output-format', 'json', '--workspace', workspace, ...(readOnly ? ['--mode', 'ask'] : ['--force']), ...(model ? ['--model', model] : []), prompt];
  const result = await runProcess(command, [...prefix, ...args], { cwd: workspace, env: modelEnvironment(root), input: provider === 'codex' ? prompt : undefined, log: `${output}.log` });
  if (result.code !== 0 || result.timedOut) throw new Error(`${provider} failed (exit ${result.code}, timeout ${result.timedOut}); see ${result.log}`);
  if (provider === 'cursor') {
    const response = JSON.parse(fs.readFileSync(result.log, 'utf8'));
    if (response.is_error || typeof response.result !== 'string') throw new Error(`Cursor did not return a successful result: ${result.log}`);
    fs.writeFileSync(output, response.result);
  }
  if (!fs.existsSync(output) || !fs.readFileSync(output, 'utf8').trim()) throw new Error(`${provider} returned no report`);
  return fs.readFileSync(output, 'utf8');
}
