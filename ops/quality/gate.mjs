import { allowedFile, matchesAny } from './util.mjs';

/**
 * Gate 0: decides, without a model, whether accumulated changes deserve triage.
 *
 * `advance` says whether the reviewed point may move to the current tree.
 * Trivial changes do not advance, so small edits accumulate until together
 * they cross the threshold.
 */
export function gate(entries, config) {
  const { gate: rules, docsOwnership } = config;
  if (!entries.length) return { result: 'unchanged', advance: false };
  const reviewable = entries.filter(entry => allowedFile(entry.path) && !matchesAny(entry.path, rules.noiseGlobs));
  // Zero lines with -w on a modification means whitespace only.
  const meaningful = reviewable.filter(entry => entry.binary || entry.added + entry.deleted > 0 || entry.status !== 'M');
  if (!meaningful.length) return { result: 'noise', advance: true };
  const isDocs = entry => matchesAny(entry.path, docsOwnership);
  const isTest = entry => matchesAny(entry.path, rules.testGlobs);
  if (meaningful.every(isDocs) && !rules.triageDocsOnly) return { result: 'docs-only', advance: true, files: meaningful.length };
  const lines = meaningful.reduce((sum, entry) => sum + entry.added + entry.deleted, 0);
  const sourceAddedOrDeleted = meaningful.some(entry => ['A', 'D'].includes(entry.status) && !isDocs(entry) && !isTest(entry));
  const summary = { files: meaningful.length, lines };
  if (lines < rules.minChangedLines && meaningful.length <= rules.maxTrivialFiles && !sourceAddedOrDeleted) {
    return { result: 'trivial', advance: false, ...summary };
  }
  const oversized = meaningful.length > rules.maxFiles || lines > rules.maxLines;
  return { result: 'triage', advance: true, oversized, entries: meaningful, ...summary };
}

export function categorize(entry, config) {
  if (entry.status === 'D') return 'deleted';
  if (matchesAny(entry.path, config.docsOwnership)) return 'docs';
  if (matchesAny(entry.path, config.gate.testGlobs)) return 'test';
  if (/\.(json|ya?ml|toml|ini|env\.example)$|(^|\/)\.[^/]+rc$/.test(entry.path)) return 'config';
  if (/(^|\/)(generated|__generated__)\//.test(entry.path) || /\.generated\./.test(entry.path)) return 'generated';
  return 'code';
}
