import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './util.mjs';

/**
 * Defaults for `.quality.config.json`. A repository opts in by having that file;
 * keys it sets replace these (objects are merged one level deep).
 */
export const DEFAULTS = {
  enabled: true,
  // 'act' runs the stages and auto-applies; 'dry-run' records triage decisions only.
  mode: 'act',
  autoApply: true,
  verify: false,
  models: {
    claude: { triage: 'claude-sonnet-5-5', edit: 'claude-sonnet-5-5' },
    cursor: { triage: 'grok-4.7-medium', edit: 'grok-4.7-high' },
    codex: { triage: 'gpt-5.6-terra', edit: 'gpt-5.6-terra' }
  },
  quietSeconds: { idle: 120, end: 20 },
  gate: {
    minChangedLines: 15,
    maxTrivialFiles: 2,
    maxFiles: 80,
    maxLines: 4000,
    triageDocsOnly: false,
    noiseGlobs: ['**/*.log', '**/pnpm-lock.yaml', '**/package-lock.json', '**/yarn.lock', '**/poetry.lock', '**/uv.lock', '**/Cargo.lock', '**/go.sum', '**/evidence/**', '.codex/**', '**/*.snap', '**/PACKET-MANIFEST.json'],
    testGlobs: ['**/*.test.*', '**/*.spec.*', 'tests/**', '**/__tests__/**', '**/test_*.py', '**/*_test.py', '**/*_test.go'],
    // Files whose edits make checks run (and that the clean-code stage works on).
    sourceGlobs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx', '**/*.py', '**/*.go', '**/*.rs', '**/*.java', '**/*.kt', '**/*.rb', '**/*.php', '**/*.cs', '**/*.swift']
  },
  docsOwnership: ['docs/**', '.cursor/rules/**', '.cursor/agents/**', 'CONTEXT.md', 'AGENTS.md', 'CLAUDE.md', 'README.md'],
  // Files the stages start from, in reading order (repository-relative; .quality/ holds copied inputs).
  instructions: ['AGENTS.md', '.quality/docs-contract.md'],
  // Documentation contract copied to .quality/docs-contract.md (repository-relative; may point outside it).
  // Null uses the generic docs-contract.md shipped with the tool.
  docsContract: null,
  // Shared glossary copied to .quality/glossary.md when present (repository-relative).
  glossary: 'CONTEXT.md',
  // Extra environment for model and check children (e.g. a test mode that disables side effects).
  childEnv: {},
  // Files (repository-relative) from which ONLY CURSOR_API_KEY is read when it is not exported.
  secretsEnvFiles: ['.env'],
  // Paths no stage may edit. A repository's list adds to these; it cannot remove them.
  protectedGlobs: ['.codex/**', '.claude/**', '.github/**', '.gitlab-ci.yml', '.quality.config.json', '.cursor/hooks.json', '.cursor/mcp.json', '.mcp.json', 'ops/quality/**',
    '**/package.json', '**/pnpm-lock.yaml', '**/pnpm-workspace.yaml', '**/yarn.lock', '**/package-lock.json', '**/pyproject.toml', '**/requirements*.txt', '**/go.mod', '**/Cargo.toml',
    'eslint.config.*', 'tsconfig*.json', '.env*'],
  // Each check: command ('node' = this Node binary), files: 'none' | 'edited' | 'related-tests',
  // optional extensions (for 'edited') and parser: 'tsc' | 'eslint' | 'node-test' | 'lines'.
  // A check whose Node script is missing (tool not installed) is skipped.
  checks: [
    { name: 'typecheck', command: ['node', 'node_modules/typescript/bin/tsc', '--noEmit'], files: 'none', parser: 'tsc' },
    { name: 'lint', command: ['node', 'node_modules/eslint/bin/eslint.js', '--max-warnings', '0', '--no-warn-ignored'], files: 'edited', extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx'], parser: 'eslint' },
    { name: 'tests', command: ['node', '--import', 'tsx', '--test'], files: 'related-tests', parser: 'node-test' }
  ],
  // Sibling test patterns for 'related-tests' ({dir}, {name}, {ext}); importSearch adds JS/TS importers.
  relatedTests: {
    patterns: ['{dir}/{name}.test.{ext}', '{dir}/{name}.spec.{ext}', '{dir}/__tests__/{name}.test.{ext}', '{dir}/test_{name}.py', '{dir}/{name}_test.py', 'tests/test_{name}.py', '{dir}/{name}_test.go'],
    importSearch: true,
    maxFiles: 40
  },
  timeouts: { triageMinutes: 10, stageMinutes: 45, checkMinutes: 15 },
  pendingApplyHours: 2,
  retention: { sessionHours: 24, staleBusyHours: 6, noticeHours: 24, runDays: 14, keepRuns: 50, workspaceDays: 3, logMb: 5 }
};

export function configFile(repo) {
  return path.join(repo, '.quality.config.json');
}
export function optedIn(repo) {
  return fs.existsSync(configFile(repo));
}
export function loadRepoConfig(repo) {
  const own = readJson(configFile(repo), null);
  if (!own) return null;
  const merged = { ...DEFAULTS };
  for (const [key, value] of Object.entries(own)) {
    merged[key] = value && typeof value === 'object' && !Array.isArray(value) && DEFAULTS[key] && typeof DEFAULTS[key] === 'object' && !Array.isArray(DEFAULTS[key])
      ? { ...DEFAULTS[key], ...value }
      : value;
  }
  // Protection only ever widens: a repository adds paths (locked contracts, packets) but cannot drop the defaults.
  merged.protectedGlobs = [...new Set([...DEFAULTS.protectedGlobs, ...(Array.isArray(own.protectedGlobs) ? own.protectedGlobs : [])])];
  return merged;
}
/** A provider's model for a role; config may give one string for both roles. */
export function modelFor(config, provider, role) {
  const entry = config.models?.[provider] ?? DEFAULTS.models[provider];
  return typeof entry === 'string' ? entry : entry?.[role] ?? DEFAULTS.models[provider][role];
}
