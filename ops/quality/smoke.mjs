// Real-model end-to-end test for one provider: `node smoke.mjs claude|cursor|codex [--modules <node_modules>]`.
// Builds a throwaway repository with a deliberate bug and a stale document, then runs a
// full checkpoint (triage → clean → docs → checks → auto-apply). Never touches application code.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const provider = process.argv[2] || 'claude';
// Node modules with typescript and tsx for the fixture's checks: --modules <dir>, else the current repository's.
const modulesIndex = process.argv.indexOf('--modules');
const modules = path.resolve(modulesIndex > 0 ? process.argv[modulesIndex + 1] : path.join(process.cwd(), 'node_modules'));
if (!fs.existsSync(path.join(modules, 'typescript')) || !fs.existsSync(path.join(modules, 'tsx'))) {
  console.error(`smoke needs typescript and tsx in ${modules}; pass --modules <node_modules dir>`);
  process.exit(2);
}
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `agent-quality-smoke-${provider}-`));
process.env.AGENT_QUALITY_HOME ||= path.join(sandbox, 'home');
process.env.AGENT_QUALITY_WORK ||= path.join(sandbox, 'work');
const { git } = await import('./util.mjs');
const { processRepo } = await import('./pipeline.mjs');

const repo = path.join(sandbox, 'repo');
const write = (name, content) => { fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true }); fs.writeFileSync(path.join(repo, name), content); };
write('.gitignore', 'node_modules/\n');
write('package.json', JSON.stringify({ name: 'quality-smoke-fixture', private: true, type: 'module' }, null, 2));
write('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', types: ['node'], strict: true, skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true }, include: ['src/**/*.ts'] }, null, 2));
write('AGENTS.md', 'Isolated quality smoke fixture. Domain contract: average([]) returns 0; otherwise the arithmetic mean. `summarize` returns { count, mean, max } for a list of order totals. docs/knowledge/services/orders.md owns the documentation.\n');
write('.cursor/agents/docs-keeper.md', 'Keep docs/knowledge/services/orders.md accurate for src/orders.ts. Update only documentation.\n');
write('docs/knowledge/services/orders.md', '# Orders\n\n`average(values)` returns the sum of the values.\n');
write('src/orders.ts', 'export function average(values: number[]): number {\n  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;\n}\n');
write('src/orders.test.ts', "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { average } from './orders.ts';\ntest('average', () => { assert.equal(average([2, 4]), 3); assert.equal(average([]), 0); });\n");
write('.quality.config.json', JSON.stringify({
  mode: 'act', quietSeconds: { idle: 0, end: 0 },
  docsContract: '.cursor/agents/docs-keeper.md',
  checks: [
    { name: 'typecheck', command: ['node', 'node_modules/typescript/bin/tsc', '--noEmit'], files: 'none', parser: 'tsc' },
    { name: 'tests', command: ['node', '--import', 'tsx', '--test'], files: 'related-tests', parser: 'node-test' }
  ]
}, null, 2));
git(repo, ['init', '-q']);
git(repo, ['config', 'core.autocrlf', 'true']);
git(repo, ['add', '-A']);
git(repo, ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'baseline']);
fs.symlinkSync(modules, path.join(repo, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
await processRepo({ repo, provider }); // first sighting: reviewed point = HEAD

// The "session's" work: an off-by-one bug, a function mixing parsing, policy and formatting, and a now-stale doc.
write('src/orders.ts', `export function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / (values.length + 1);
}

export function summarize(raw: string): string {
  const parts = raw.split(',');
  const nums: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!isNaN(n)) nums.push(n);
  }
  let m = 0;
  for (const x of nums) if (x > m) m = x;
  const mean = average(nums);
  return 'count=' + nums.length + ' mean=' + mean.toFixed(2) + ' max=' + m;
}
`);
const started = Date.now();
const report = await processRepo({ repo, provider, reason: 'smoke' });
console.log(JSON.stringify({
  provider, seconds: Math.round((Date.now() - started) / 1000), status: report.status, stage: report.stage, error: report.error,
  decision: report.decision, touched: report.touched, checks: report.checks?.map(check => `${check.name}:${check.passed ? 'pass' : 'FAIL'}`),
  directory: report.directory, repo
}, null, 2));
if (report.status === 'applied') console.log('\n--- src/orders.ts after apply ---\n' + fs.readFileSync(path.join(repo, 'src/orders.ts'), 'utf8') + '\n--- docs/knowledge/services/orders.md ---\n' + fs.readFileSync(path.join(repo, 'docs/knowledge/services/orders.md'), 'utf8'));
if (report.status !== 'applied') process.exitCode = 1;
