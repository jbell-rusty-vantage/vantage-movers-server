import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandFor, modelEnvironment, runProcess } from './providers.mjs';
import { events, stateDirectory } from './state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const provider = process.argv[2] || 'codex';
const state = stateDirectory(root);
fs.mkdirSync(state, { recursive: true });
const started = Date.now();
const { command, prefix } = commandFor(provider);
const env = modelEnvironment(root);
delete env.VANTAGE_QUALITY_CHILD;
const prompt = 'Reply exactly VANTAGE_LIFECYCLE_OK. Do not use tools, edit files, or run a quality checkpoint. This tests lifecycle delivery only.';
const args = provider === 'codex'
  ? ['exec', '--ephemeral', '-s', 'read-only', '-C', root, '-c', 'approval_policy="never"', prompt]
  : ['--print', '--trust', '--force', '--output-format', 'json', '--workspace', root, prompt];
const result = await runProcess(command, [...prefix, ...args], { cwd: root, env, log: path.join(state, `lifecycle-${provider}.log`), timeoutMs: 180_000 });
const delivered = events(state).filter(event => event.provider === provider && event.at >= started);
console.log(JSON.stringify({ ...result, delivered: delivered.map(({ event, session }) => ({ event, session })) }, null, 2));
if (result.code !== 0 || !delivered.some(event => event.event === 'start') || !delivered.some(event => ['stop', 'end'].includes(event.event))) process.exitCode = 1;
