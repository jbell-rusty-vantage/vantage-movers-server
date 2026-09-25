import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { capture, stateDirectory, readJson, writeJson, acquireLock, events, activity, processAlive } from './state.mjs';
import { runCheckpoint } from './pipeline.mjs';
import { checkpointDue } from './schedule.mjs';

const self = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(self), '../..');
const args = process.argv.slice(2);
const command = args[0] || 'status';
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index < 0 ? fallback : args[index + 1]; };

function startWorker(state) {
  fs.mkdirSync(state, { recursive: true });
  const log = fs.openSync(path.join(state, 'worker.log'), 'a');
  const child = spawn(process.execPath, [self, 'worker'], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
  child.on('error', error => fs.appendFileSync(path.join(state, 'worker.log'), `${error.message}\n`));
  child.unref();
  fs.closeSync(log);
}
async function recordHook(state) {
  if (process.env.VANTAGE_QUALITY_CHILD === '1') return;
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const payload = input.trim() ? JSON.parse(input) : {};
  const provider = option('provider', 'codex');
  const event = option('event', 'activity');
  const at = Date.now();
  // Store metadata only: never persist prompt text, tool arguments, or transcript contents.
  writeJson(path.join(state, 'events', `${at}-${crypto.randomUUID()}.json`), {
    provider, event, at, session: payload.session_id || payload.conversation_id || 'unknown',
    source: payload.source, reason: payload.reason
  });
  startWorker(state);
}
async function worker(state) {
  const release = acquireLock(path.join(state, 'worker.lock'));
  if (!release) return;
  const finish = () => { release(); process.exit(0); };
  process.on('SIGTERM', finish);
  process.on('SIGINT', finish);
  let observedFingerprint;
  let stableSince = Date.now();
  try {
    while (true) {
      const config = readJson(path.join(root, '.quality.config.json'));
      if (!config?.enabled || fs.existsSync(path.join(state, 'paused'))) return;
      if (!readJson(path.join(state, 'baseline.json'))) writeJson(path.join(state, 'baseline.json'), capture(root, state));
      const eventList = events(state);
      const { latest } = activity(eventList);
      const snapshot = capture(root, state);
      if (snapshot.fingerprint !== observedFingerprint) {
        observedFingerprint = snapshot.fingerprint;
        stableSince = Date.now();
      }
      const previous = readJson(path.join(state, 'latest.json'));
      const reason = checkpointDue({ eventList, snapshot, previous, stableSince, config });
      if (reason) {
        const result = await runCheckpoint({ root, state, provider: latest.provider, reason, autoApply: config.autoApply, model: config.models?.[latest.provider] });
        if (!['unchanged', 'busy'].includes(result.status)) process.stdout.write(`${JSON.stringify(result)}\n`);
      }
      await new Promise(resolve => setTimeout(resolve, 15_000));
    }
  } finally { release(); }
}
async function main() {
  const state = stateDirectory(root);
  if (command === 'hook') { await recordHook(state); process.stdout.write('{}\n'); return; }
  if (command === 'worker') return worker(state);
  if (command === 'init') {
    if (!readJson(path.join(state, 'baseline.json'))) writeJson(path.join(state, 'baseline.json'), capture(root, state));
    startWorker(state);
    console.log(`Quality baseline initialized. State: ${state}`);
    return;
  }
  if (command === 'pause') { fs.mkdirSync(state, { recursive: true }); fs.writeFileSync(path.join(state, 'paused'), ''); return; }
  if (command === 'resume') { fs.rmSync(path.join(state, 'paused'), { force: true }); startWorker(state); return; }
  if (command === 'run') {
    const provider = option('provider', 'codex');
    const config = readJson(path.join(root, '.quality.config.json'));
    const report = await runCheckpoint({ root, state, provider, autoApply: !args.includes('--no-apply'), model: option('model', config?.models?.[provider]) });
    console.log(JSON.stringify(report, null, 2));
    if (!['complete', 'unchanged', 'initialized', 'patch-ready'].includes(report.status)) process.exitCode = 1;
    return;
  }
  if (command === 'status') {
    const workerPid = readJson(path.join(state, 'worker.lock'))?.pid;
    console.log(JSON.stringify({ root, state, initialized: Boolean(readJson(path.join(state, 'baseline.json'))), worker: { pid: workerPid, alive: Boolean(workerPid && processAlive(workerPid)) }, paused: fs.existsSync(path.join(state, 'paused')), activity: activity(events(state)), latest: readJson(path.join(state, 'latest.json')) }, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
