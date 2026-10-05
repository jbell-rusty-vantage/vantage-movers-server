import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { git, hash, normalizePath } from './util.mjs';

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const IDENTITY = ['-c', 'user.name=Agent Quality', '-c', 'user.email=quality@localhost', '-c', 'commit.gpgsign=false'];

export function toplevel(directory) {
  if (!directory || !fs.existsSync(directory)) return null;
  return git(directory, ['rev-parse', '--show-toplevel'], { allowFail: true })?.trim() || null;
}
export function headCommit(repo) {
  return git(repo, ['rev-parse', '-q', '--verify', 'HEAD'], { allowFail: true })?.trim() || null;
}
export function branchName(repo) {
  const branch = git(repo, ['symbolic-ref', '--short', '-q', 'HEAD'], { allowFail: true })?.trim();
  return branch || `detached-${(headCommit(repo) || 'unborn').slice(0, 12)}`;
}

/** Runs Git with a private copy of the index so the user's index and HEAD are never touched. */
function withTemporaryIndex(repo, work) {
  const temporary = path.join(os.tmpdir(), `agent-quality-index-${process.pid}-${crypto.randomUUID()}`);
  try { return work({ GIT_INDEX_FILE: temporary }, temporary); }
  finally { fs.rmSync(temporary, { force: true }); fs.rmSync(`${temporary}.lock`, { force: true }); }
}

/** Tree id of the whole working state (tracked + untracked, .gitignore respected). */
export function snapshotTree(repo) {
  return withTemporaryIndex(repo, (env, temporary) => {
    const index = path.resolve(repo, git(repo, ['rev-parse', '--git-path', 'index']).trim());
    // Starting from the real index reuses its stat cache, so only changed files are hashed.
    if (fs.existsSync(index)) fs.copyFileSync(index, temporary);
    git(repo, ['add', '-A', '--ignore-errors'], { env, allowFail: true });
    return git(repo, ['write-tree'], { env }).trim();
  });
}
/** `base` tree with the working-tree versions of `paths` (used to fold applied edits into the reviewed point). */
export function treeWithPaths(repo, base, paths) {
  return withTemporaryIndex(repo, env => {
    git(repo, ['read-tree', base], { env });
    for (let index = 0; index < paths.length; index += 200) {
      git(repo, ['add', '-A', '--ignore-errors', '--', ...paths.slice(index, index + 200).map(literal)], { env, allowFail: true });
    }
    return git(repo, ['write-tree'], { env }).trim();
  });
}
/**
 * Writes a tree's files into `target` in their repository (normalized, LF) form, so
 * patches made there apply through `git apply` regardless of the user's core.autocrlf.
 */
export function checkoutTree(repo, tree, target) {
  withTemporaryIndex(repo, env => {
    git(repo, ['read-tree', tree], { env });
    const prefix = target.replaceAll('\\', '/').replace(/\/?$/, '/');
    git(repo, ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'checkout-index', '-a', '-f', `--prefix=${prefix}`], { env });
  });
}
export const literal = file => `:(literal)${file}`;

export function worktreeKey(repo) {
  return hash(normalizePath(repo)).slice(0, 12);
}
export function reviewedRef(repo, branch) {
  const safe = branch.replace(/[^A-Za-z0-9._/-]/g, '-').replace(/\.\.+/g, '-').replace(/\/+/g, '/').replace(/^[/.]+|[/.]+$/g, '') || 'unnamed';
  return `refs/agent-quality/reviewed/${worktreeKey(repo)}/${safe}`;
}
export function readReviewed(repo, branch) {
  const ref = reviewedRef(repo, branch);
  const commit = git(repo, ['rev-parse', '-q', '--verify', `${ref}^{commit}`], { allowFail: true })?.trim();
  if (!commit) return null;
  const tree = git(repo, ['rev-parse', `${commit}^{tree}`]).trim();
  const parent = git(repo, ['rev-parse', '-q', '--verify', `${commit}^`], { allowFail: true })?.trim() || null;
  return { ref, commit, tree, head: parent };
}
/** Stores the reviewed point as a commit wrapping `tree`, parented on the HEAD it was taken at. */
export function writeReviewed(repo, branch, tree, head, note) {
  const ref = reviewedRef(repo, branch);
  const message = `agent-quality reviewed ${normalizePath(repo)} ${branch}${note ? `\n\n${note}` : ''}`;
  const commit = git(repo, [...IDENTITY, 'commit-tree', tree, ...(head ? ['-p', head] : []), '-m', message]).trim();
  git(repo, ['update-ref', ref, commit]);
  return { ref, commit, tree, head };
}
/** The tree first sighting of a branch starts from: committed state, so uncommitted work is reviewed. */
export function initialTree(repo) {
  const head = headCommit(repo);
  return head ? git(repo, ['rev-parse', `${head}^{tree}`]).trim() : EMPTY_TREE;
}

/**
 * Changed files between two trees: status from --name-status, line counts with
 * whitespace ignored (-w), so whitespace-only edits count zero lines.
 */
export function diffEntries(repo, from, to) {
  const entries = new Map();
  const status = git(repo, ['diff', '--name-status', '-z', '-M', '--no-ext-diff', from, to]).split('\0');
  for (let index = 0; index < status.length - 1;) {
    const code = status[index++];
    if (!code) continue;
    const kind = code[0];
    if (kind === 'R' || kind === 'C') {
      const from = status[index++];
      const file = status[index++];
      entries.set(file, { path: file, from, status: kind, added: 0, deleted: 0, binary: false });
    } else {
      const file = status[index++];
      entries.set(file, { path: file, status: kind, added: 0, deleted: 0, binary: false });
    }
  }
  const numbers = git(repo, ['diff', '--numstat', '-z', '-M', '-w', '--no-ext-diff', from, to]).split('\0');
  for (let index = 0; index < numbers.length - 1;) {
    const head = numbers[index++];
    if (!head) continue;
    const [added, deleted, inline] = head.split('\t');
    let file = inline;
    if (!inline) { index++; file = numbers[index++]; }
    const entry = entries.get(file);
    if (!entry) continue;
    entry.binary = added === '-';
    entry.added = entry.binary ? 0 : Number(added);
    entry.deleted = entry.binary ? 0 : Number(deleted);
  }
  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
}
/** Unified diff for selected paths, truncated per file and overall. */
export function diffPatch(repo, from, to, files, { perFile = 12_000, total = 45_000 } = {}) {
  let output = '';
  for (const file of files) {
    if (output.length >= total) { output += `\n[diff truncated: ${files.length} files selected]\n`; break; }
    let text = git(repo, ['diff', '-M', '--no-ext-diff', from, to, '--', literal(file)], { allowFail: true }) || '';
    if (text.length > perFile) text = text.slice(0, perFile) + `\n[... ${file} diff truncated]\n`;
    output += text;
  }
  return output;
}
export function binaryPatch(repo, from, to) {
  return git(repo, ['diff', '--binary', '--no-ext-diff', from, to]);
}
export function statusSummary(repo, maxLines = 120) {
  const lines = (git(repo, ['status', '--porcelain=v2', '--branch'], { allowFail: true }) || '').split('\n').filter(Boolean);
  return lines.length > maxLines ? [...lines.slice(0, maxLines), `[... ${lines.length - maxLines} more]`].join('\n') : lines.join('\n');
}
export function upstreamSummary(repo) {
  const counts = git(repo, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], { allowFail: true })?.trim();
  if (!counts) return 'no upstream';
  const [behind, ahead] = counts.split(/\s+/);
  return `ahead ${ahead}, behind ${behind}`;
}
export function logSince(repo, from) {
  if (!from) return '';
  return git(repo, ['log', '--oneline', '-n', '30', `${from}..HEAD`], { allowFail: true })?.trim() || '';
}
/** Blob id of `file` in `tree`, or null when absent. */
export function blobInTree(repo, tree, file) {
  return git(repo, ['rev-parse', '-q', '--verify', `${tree}:${file}`], { allowFail: true })?.trim() || null;
}
/** Blob id the working-tree file would have after clean filters, or null when absent. */
export function workingBlob(repo, file) {
  if (!fs.existsSync(path.join(repo, file))) return null;
  return git(repo, ['hash-object', '--', file], { allowFail: true })?.trim() || null;
}
export function worktreePaths(repo) {
  const text = git(repo, ['worktree', 'list', '--porcelain'], { allowFail: true }) || '';
  return text.split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9).trim());
}
export function listReviewedRefs(repo) {
  const text = git(repo, ['for-each-ref', '--format=%(refname)', 'refs/agent-quality/reviewed/'], { allowFail: true }) || '';
  return text.split('\n').filter(Boolean);
}
export function deleteRef(repo, ref) {
  git(repo, ['update-ref', '-d', ref], { allowFail: true });
}
export function branchExists(repo, branch) {
  return Boolean(git(repo, ['show-ref', '--verify', '-q', `refs/heads/${branch}`], { allowFail: true }) !== null);
}

/**
 * Deterministic owning-document hints: knowledge docs and rules that mention a
 * changed path or its module name. Saves the model a search.
 */
export function documentHints(repo, files, { roots = ['docs/knowledge', '.cursor/rules', 'docs'], maxPerFile = 4, maxDocs = 800 } = {}) {
  const documents = [];
  const seen = new Set();
  const walk = directory => {
    if (documents.length >= maxDocs || !fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (!/^(node_modules|\.git|evidence|history)$/.test(entry.name)) walk(full); }
      else if (/\.(md|mdc)$/.test(entry.name) && !seen.has(full)) { seen.add(full); documents.push(full); }
      if (documents.length >= maxDocs) return;
    }
  };
  for (const root of roots) walk(path.join(repo, root));
  const contents = documents.map(file => ({ file: path.relative(repo, file).replaceAll('\\', '/'), text: fs.readFileSync(file, 'utf8') }));
  const hints = {};
  for (const file of files) {
    const base = path.basename(file).replace(/\.(test|spec)?\.?[^.]+$/, '');
    const needles = [file, ...(base.length >= 6 ? [base] : [])];
    const matches = contents.filter(document => document.file !== file && needles.some(needle => document.text.includes(needle))).map(document => document.file);
    if (matches.length) hints[file] = matches.slice(0, maxPerFile);
  }
  return hints;
}
