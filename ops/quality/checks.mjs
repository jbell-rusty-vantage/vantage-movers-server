import fs from 'node:fs';
import path from 'node:path';
import { runProcess } from './providers.mjs';
import { git, matchesAny } from './util.mjs';

const JS = /\.(ts|tsx|js|mjs|cjs|jsx)$/;
const extensionOf = file => path.extname(file);

function walkTests(root, directory, found, limit) {
  if (found.length >= limit || !fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (found.length >= limit) return;
    if (entry.isDirectory()) {
      if (!/^(node_modules|\.git|\.quality|dist|\.next|coverage|\.venv|venv|target|build)$/.test(entry.name)) walkTests(root, path.join(directory, entry.name), found, limit);
    } else if (/\.(test|spec)\.(ts|tsx|mjs|js|cjs|jsx)$/.test(entry.name)) found.push(path.relative(root, path.join(directory, entry.name)).replaceAll('\\', '/'));
  }
}

/**
 * Tests for edited files: edited test files, tests found by the configured sibling
 * patterns ({dir}, {name}, {ext}), and (JS/TS) test files that import an edited module.
 */
export function relatedTests(workspace, edited, config) {
  const { patterns, importSearch, maxFiles } = config.relatedTests;
  const selected = new Set();
  const existing = edited.filter(file => fs.existsSync(path.join(workspace, file)));
  const sources = existing.filter(file => matchesAny(file, config.gate.sourceGlobs));
  for (const file of sources) {
    if (matchesAny(file, config.gate.testGlobs)) { selected.add(file); continue; }
    const dir = path.posix.dirname(file);
    const ext = extensionOf(file).slice(1);
    const name = path.posix.basename(file, extensionOf(file));
    for (const pattern of patterns) {
      const candidate = pattern.replaceAll('{dir}', dir).replaceAll('{name}', name).replaceAll('{ext}', ext).replace(/^\.\//, '');
      if (fs.existsSync(path.join(workspace, candidate))) selected.add(path.posix.normalize(candidate));
    }
  }
  const modules = sources.filter(file => JS.test(file) && !matchesAny(file, config.gate.testGlobs)).map(file => path.basename(file).replace(JS, '')).filter(name => name.length >= 4);
  if (importSearch && modules.length && selected.size < maxFiles) {
    const tests = [];
    walkTests(workspace, workspace, tests, 5000);
    const pattern = new RegExp(`from\\s+['"][^'"]*/(?:${modules.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:\\.[cm]?[jt]sx?)?['"]`);
    for (const test of tests) {
      if (selected.size >= maxFiles) break;
      if (pattern.test(fs.readFileSync(path.join(workspace, test), 'utf8'))) selected.add(test);
    }
  }
  return [...selected].slice(0, maxFiles);
}

/** Failure signatures without positions or durations, so the same failure compares equal across edits. */
export function failureSignatures(parser, output) {
  const lines = output.split(/\r?\n/);
  let signatures;
  if (parser === 'tsc') signatures = lines.filter(line => /error TS\d+/.test(line)).map(line => line.replace(/\(\d+,\d+\)/, ''));
  else if (parser === 'eslint') {
    // ESLint's stylish output: a file header line, then indented "line:col  level  message  rule" lines.
    let file = '';
    signatures = [];
    for (const line of lines) {
      const problem = /^\s+\d+:\d+\s+(error|warning)\s+(.*)$/.exec(line);
      if (problem) signatures.push(`${file}: ${problem[1]} ${problem[2].replace(/\s{2,}/g, ' ').trim()}`);
      else if (/^\S/.test(line) && !/^✖|\bproblems?\b/.test(line)) file = line.trim();
    }
  } else if (parser === 'node-test') {
    signatures = lines.filter(line => /^\s*(✖|not ok)\s/.test(line)).map(line => line.trim().replace(/\s*\([\d.]+m?s\)\s*$/, '').replace(/^not ok \d+ - /, 'not ok '));
  } else {
    // Generic: lines that report an error or failure, with positions and timings removed.
    signatures = lines.filter(line => /\b(error|errors|fail|failed|failure|exception)\b/i.test(line))
      .map(line => line.replace(/:\d+(:\d+)?/g, '').replace(/\(\d+,\d+\)/g, '').replace(/\s*\(?[\d.]+\s?m?s\)?\s*$/, ''));
  }
  return [...new Set(signatures.map(line => line.trim()).filter(Boolean))];
}

const DEFAULT_PARSER = { typecheck: 'tsc', lint: 'eslint', tests: 'node-test' };

async function runCheck(check, args, { workspace, env, directory, timeoutMs, suffix = '' }) {
  const stdoutFile = path.join(directory, `${check.name}${suffix}.log`);
  const [executable, ...rest] = args;
  const command = executable === 'node' ? process.execPath : executable;
  const result = await runProcess(command, rest, { cwd: workspace, env, stdoutFile, timeoutMs });
  const output = fs.readFileSync(stdoutFile, 'utf8');
  const parser = check.parser || DEFAULT_PARSER[check.name] || 'lines';
  return { name: check.name, code: result.code, timedOut: result.timedOut, log: stdoutFile, failures: failureSignatures(parser, output) };
}

/** The configured checks with their file arguments resolved; checks whose tool is not installed are skipped. */
export function plannedChecks(workspace, edited, config) {
  if (!edited.some(file => matchesAny(file, config.gate.sourceGlobs))) return [];
  const planned = [];
  for (const check of config.checks || []) {
    const script = check.command[0] === 'node' && check.command[1] && !check.command[1].startsWith('-') ? check.command[1] : null;
    if (script && !fs.existsSync(path.join(workspace, script))) continue;
    let files = [];
    if (check.files === 'edited') {
      files = edited.filter(file => fs.existsSync(path.join(workspace, file)) && (!check.extensions || check.extensions.includes(extensionOf(file))));
      if (!files.length) continue;
    } else if (check.files === 'related-tests') {
      files = relatedTests(workspace, edited, config);
      if (!files.length) continue;
    }
    planned.push({ check, args: [...check.command, ...files], files });
  }
  return planned;
}

/**
 * Runs checks on the edited workspace. A failing check is re-run on the
 * unedited input (stash) and passes when it introduced no new failure.
 */
export async function runChecks({ workspace, edited, config, env, directory }) {
  const timeoutMs = config.timeouts.checkMinutes * 60_000;
  const results = [];
  for (const { check, args, files } of plannedChecks(workspace, edited, config)) {
    const after = await runCheck(check, args, { workspace, env, directory, timeoutMs });
    if (after.code === 0 && !after.timedOut) { results.push({ ...after, passed: true }); continue; }
    if (after.timedOut) { results.push({ ...after, passed: false, note: 'timed out' }); continue; }
    git(workspace, ['stash', 'push', '-u', '-q']);
    let before;
    try {
      // Re-run only on files that exist in the input; the edited list may include new files.
      const inputArgs = args.filter((argument, index) => index < args.length - files.length || fs.existsSync(path.join(workspace, argument)));
      before = await runCheck(check, inputArgs, { workspace, env, directory, timeoutMs, suffix: '.input' });
    } finally { git(workspace, ['stash', 'pop', '-q']); }
    const introduced = after.failures.filter(signature => !before.failures.includes(signature));
    const passed = before.code !== 0 && !introduced.length && (after.failures.length > 0 || before.failures.length === 0);
    results.push({ ...after, passed, inputCode: before.code, introduced, note: passed ? 'pre-existing failures only' : 'new failures' });
  }
  return results;
}

/** Relative Markdown links in edited docs that point at missing files. */
export function brokenLinks(workspace, edited) {
  const broken = [];
  for (const file of edited.filter(name => /\.mdc?$/.test(name) && fs.existsSync(path.join(workspace, name)))) {
    const text = fs.readFileSync(path.join(workspace, file), 'utf8');
    for (const match of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
      const target = match[1];
      if (/^[a-z]+:/i.test(target) || target.startsWith('/')) continue;
      let decoded = target;
      try { decoded = decodeURI(target); } catch { /* keep the raw target */ }
      if (!fs.existsSync(path.resolve(path.dirname(path.join(workspace, file)), decoded))) broken.push(`${file} → ${target}`);
    }
  }
  return broken;
}
