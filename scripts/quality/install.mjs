import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readJson, writeJson } from './state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const entry = path.join(root, 'scripts/quality/hook-entry.mjs').replaceAll('\\', '/');
const marker = 'scripts/quality/hook-entry.mjs';
const configFile = path.join(os.homedir(), '.codex', 'config.toml');
const projectKey = process.platform === 'win32' ? root.toLowerCase() : root;
let existingConfig = fs.readFileSync(configFile, 'utf8');
if (!existingConfig.includes(`[projects.'${projectKey}']`) && !existingConfig.includes(`[projects.${JSON.stringify(projectKey)}]`)) {
  fs.copyFileSync(configFile, `${configFile}.vantage-backup-${Date.now()}`);
  existingConfig += `\n[projects.${JSON.stringify(projectKey)}]\ntrust_level = "trusted"\n`;
  fs.writeFileSync(configFile, existingConfig);
}
const mappings = {
  codex: { SessionStart: 'start', UserPromptSubmit: 'prompt', PreToolUse: 'tool-start', PostToolUse: 'activity', Stop: 'stop', SessionEnd: 'end', Interrupt: 'interrupt' },
  cursor: { sessionStart: 'start', beforeSubmitPrompt: 'prompt', preToolUse: 'tool-start', postToolUse: 'activity', stop: 'stop', sessionEnd: 'end' }
};

function configuration(provider, baseCommand, previous = {}) {
  const config = { ...previous, ...(provider === 'cursor' ? { version: 1 } : {}), hooks: { ...previous.hooks } };
  for (const [name, event] of Object.entries(mappings[provider])) {
    const command = `${baseCommand} --provider ${provider} --event ${event}`;
    const other = (config.hooks[name] || []).filter(item => provider === 'cursor'
      ? !item.command?.includes(marker) : !item.hooks?.some(hook => hook.command?.includes(marker)));
    config.hooks[name] = [...other, provider === 'cursor' ? { command, timeout: 3 }
      : { hooks: [{ type: 'command', command, timeout: 3, statusMessage: 'Record Vantage checkpoint activity' }] }];
  }
  return config;
}

async function codexHooks() {
  const child = spawn(process.env.VANTAGE_CODEX_BIN || 'codex', ['app-server', '--stdio'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
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
  const timeout = setTimeout(() => { for (const item of pending.values()) item.reject(new Error(`Codex hook inspection timed out: ${stderr.slice(-500)}`)); child.kill(); }, 30_000);
  try {
    await request('initialize', { clientInfo: { name: 'vantage-quality-installer', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write('{"jsonrpc":"2.0","method":"initialized"}\n');
    return await request('hooks/list', { cwds: [root, path.dirname(root)] });
  } finally { clearTimeout(timeout); child.kill(); }
}

for (const provider of ['codex', 'cursor']) {
  const projectFile = path.join(root, `.${provider}`, 'hooks.json');
  writeJson(projectFile, configuration(provider, 'node scripts/quality/hook-entry.mjs', readJson(projectFile, {})));
  const userFile = path.join(os.homedir(), `.${provider}`, 'hooks.json');
  if (fs.existsSync(userFile)) fs.copyFileSync(userFile, `${userFile}.vantage-backup-${Date.now()}`);
  writeJson(userFile, configuration(provider, `node "${entry}"`, readJson(userFile, {})));
}

const listed = await codexHooks();
const owned = listed.data.flatMap(item => item.hooks).filter(hook => hook.command?.includes(marker));
const unique = [...new Map(owned.map(hook => [hook.key, hook])).values()];
if (!unique.length) throw new Error('Codex did not discover the installed hooks');
let config = fs.readFileSync(configFile, 'utf8');
fs.copyFileSync(configFile, `${configFile}.vantage-backup-${Date.now()}`);
const start = '# BEGIN VANTAGE QUALITY HOOK TRUST';
const end = '# END VANTAGE QUALITY HOOK TRUST';
const existing = config.indexOf(start);
if (existing >= 0) config = config.slice(0, existing) + config.slice(config.indexOf(end, existing) + end.length);
config += `\n${start}\n` + unique.map(hook => `[hooks.state.${JSON.stringify(hook.key)}]\nenabled = true\ntrusted_hash = ${JSON.stringify(hook.currentHash)}\n`).join('\n') + `${end}\n`;
fs.writeFileSync(configFile, config);
const verified = await codexHooks();
const verifiedOwned = verified.data.flatMap(item => item.hooks).filter(hook => hook.command?.includes(marker));
if (verifiedOwned.some(hook => hook.trustStatus !== 'trusted')) throw new Error('Some Vantage hook definitions are still untrusted');
console.log(JSON.stringify({ installed: true, trustedCodexHooks: new Set(verifiedOwned.map(hook => hook.key)).size, cwds: verified.data.map(item => ({ cwd: item.cwd, errors: item.errors, warnings: item.warnings })) }, null, 2));
