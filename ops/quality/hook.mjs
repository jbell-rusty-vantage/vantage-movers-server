// Hook entry for Claude Code, Cursor and Codex. Must stay fast (no git, no model):
// it records the session state, starts the background worker, and may print a notice.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decideHook, sessionFile, pendingNotices, hookOutput } from './hook-core.mjs';
import { homeDirectory, readJson, writeJson, lockHeld } from './util.mjs';

const option = name => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? undefined : process.argv[index + 1]; };

export function startWorker(home) {
  if (lockHeld(path.join(home, 'worker.lock'))) return;
  fs.mkdirSync(home, { recursive: true });
  const log = fs.openSync(path.join(home, 'worker.log'), 'a');
  const worker = path.join(path.dirname(fileURLToPath(import.meta.url)), 'worker.mjs');
  const child = spawn(process.execPath, [worker], { cwd: path.dirname(worker), detached: true, windowsHide: true, stdio: ['ignore', log, log] });
  child.unref();
  fs.closeSync(log);
}

async function main() {
  let output = {};
  try {
    const provider = option('provider');
    const event = option('event');
    let input = '';
    if (!process.stdin.isTTY) for await (const chunk of process.stdin) input += chunk;
    let payload = {};
    try { payload = input.trim() ? JSON.parse(input) : {}; } catch { payload = {}; }
    const decision = decideHook({ provider, event, payload, env: process.env });
    if (decision.act) {
      const home = homeDirectory();
      const file = sessionFile(home, provider, decision.session);
      const previous = readJson(file, {});
      const notices = event === 'start' || event === 'busy' ? pendingNotices(home, decision.roots, previous.shown || []) : [];
      writeJson(file, {
        provider, session: decision.session, state: decision.state, trigger: decision.trigger, at: Date.now(),
        roots: decision.roots.length ? decision.roots : previous.roots || [], shown: [...(previous.shown || []), ...notices.map(notice => notice.id)].slice(-200)
      });
      if (decision.trigger) startWorker(home);
      output = hookOutput(provider, event, payload, notices.map(notice => notice.text).join('\n'));
    }
  } catch (error) {
    // Hooks fail open: never block the user's session.
    try { fs.appendFileSync(path.join(homeDirectory(), 'hook-errors.log'), `${new Date().toISOString()} ${error.stack || error}\n`); } catch { /* nothing else to do */ }
  }
  process.stdout.write(JSON.stringify(output) + '\n');
}

await main();
