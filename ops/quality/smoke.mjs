import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { git, capture, stateDirectory, writeJson } from './state.mjs';
import { runCheckpoint } from './pipeline.mjs';
import { runModel } from './providers.mjs';

// An explicit, paid real-model test. Ordinary quality:test never calls a model.
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const provider = process.argv[2] || 'codex';
const root = fs.mkdtempSync(path.join(os.tmpdir(), `vantage-quality-${provider}-e2e-`));
function write(name, content) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), content); }
write('.gitignore', 'node_modules/\n');
write('package.json', JSON.stringify({ name: 'quality-smoke-fixture', scripts: { test: 'node --import tsx --test src/average.test.ts' } }));
write('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', types: ['node'], strict: true, skipLibCheck: true, noEmit: true }, include: ['src/**/*.ts'] }));
write('eslint.config.mjs', fs.readFileSync(path.join(source, 'eslint.config.mjs'), 'utf8'));
write('AGENTS.md', 'This is an isolated offline quality smoke fixture. The only domain contract: average([]) returns 0; otherwise average returns arithmetic mean. Keep the public export average. docs/knowledge/services/average.md owns its documentation. No other product work.\n');
write('docs/index.md', '# Services\n- [Average](knowledge/services/average.md)\n');
write('.cursor/agents/docs-keeper.md', 'Update docs/knowledge/services/average.md to describe the implemented arithmetic mean and empty-input behavior. Do not change runtime code.\n');
write('.cursor/rules/documentation-maintenance.mdc', 'Average behavior belongs to docs/knowledge/services/average.md.\n');
write('docs/knowledge/services/average.md', '# Average\nComputes the sum of the input values.\n');
write('src/average.ts', 'export function average(values: number[]): number { return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length; }\n');
write('src/average.test.ts', "import { strict as assert } from 'node:assert';\nimport { test } from 'node:test';\nimport { average } from './average';\ntest('arithmetic mean and empty input', () => { assert.equal(average([2, 4]), 3); assert.equal(average([]), 0); });\n");
write('api/placeholder.ts', 'export {};\n');
write('ops/quality/quality.test.mjs', "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('fixture harness',()=>assert.ok(true));\n");
git(root, 'init', '-q');
git(root, 'config', 'core.autocrlf', 'false');
git(root, 'add', '.');
git(root, '-c', 'user.name=Quality smoke', '-c', 'user.email=quality@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture baseline');
const state = stateDirectory(root);
writeJson(path.join(state, 'baseline.json'), capture(root, state));
write('src/average.ts', 'export function average(values: number[]): number { const x = values.reduce((a, b) => a + b, 0); return x / (values.length + 1); }\n');
fs.symlinkSync(path.join(source, 'node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
console.log(JSON.stringify({ provider, root, state }));
const result = await runCheckpoint({ root, state, provider, modelRunner: input => runModel({ ...input, root: source }) });
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'complete') process.exitCode = 1;
