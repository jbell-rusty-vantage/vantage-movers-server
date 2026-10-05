import fs from 'node:fs';
import path from 'node:path';
import { categorize } from './gate.mjs';
import { matchesAny } from './util.mjs';
import { TRIAGE_SCHEMA, TRIAGE_REPLY_FORMAT, triagePrompt } from './prompts.mjs';
import { runModel } from './providers.mjs';
import { modelFor } from './config.mjs';

export function buildBrief({ repoName, branch, head, upstream, status, log, entries, oversized, patch, hints, history, reason }) {
  const rows = entries.map(entry => `| ${entry.path}${entry.from ? ` (from ${entry.from})` : ''} | ${entry.status} | ${entry.binary ? 'binary' : `+${entry.added} −${entry.deleted}`} | ${entry.category}${entry.protected ? ' (protected)' : ''} |`);
  const hintLines = Object.entries(hints).map(([file, docs]) => `- ${file} → ${docs.join(', ')}`);
  const historyLines = history.map(item => `- ${item.at}: ${item.result}${item.decision ? ` clean=${item.decision.clean_code.run} docs=${item.decision.docs.run}` : ''}${item.reason ? ` — ${item.reason}` : ''}`);
  return `# Quality triage brief

Repository: ${repoName}
Branch: ${branch} at ${head || 'unborn'} (${upstream})
Trigger: ${reason}
Changes since the last reviewed point: ${entries.length} files, ${entries.reduce((sum, entry) => sum + entry.added + entry.deleted, 0)} changed lines (whitespace ignored)${oversized ? '\n**Oversized change set: only the diffstat is included. Pick at most 15 focus files or skip with reason "oversized".**' : ''}

## git status --porcelain=v2 --branch
\`\`\`
${status}
\`\`\`

## Commits since the last reviewed point
\`\`\`
${log || '(none: all changes are uncommitted)'}
\`\`\`

## Changed files
Rows marked (protected) cannot be edited by any stage (hooks, tooling, manifests, locked contracts); never pick them as clean-code focus.

| Path | Status | Lines | Category |
| --- | --- | --- | --- |
${rows.join('\n')}

## Documents that mention changed paths (text search)
${hintLines.join('\n') || '(none found)'}

## Recent triage decisions for this repository
${historyLines.join('\n') || '(none)'}

${oversized ? '' : `## Diff (source files first, truncated)\n\`\`\`diff\n${patch}\n\`\`\`\n`}`;
}

/** Orders files for the diff: source code first, then tests, config, docs; deletions last. */
export function diffOrder(entries, config) {
  const rank = { code: 0, test: 1, config: 2, generated: 3, docs: 4, deleted: 5 };
  return entries.map(entry => ({ ...entry, category: categorize(entry, config), protected: matchesAny(entry.path, config.protectedGlobs) }))
    .sort((a, b) => rank[a.category] - rank[b.category] || (b.added + b.deleted) - (a.added + a.deleted));
}

/** Last fenced JSON block, else the last balanced {...} in the text. */
export function extractJson(text) {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  for (const fence of fences.reverse()) {
    try { return JSON.parse(fence[1]); } catch { /* try the next candidate */ }
  }
  const end = text.lastIndexOf('}');
  for (let start = text.lastIndexOf('{', end); start >= 0; start = text.lastIndexOf('{', start - 1)) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* widen */ }
  }
  throw new Error('No JSON decision found in the reply');
}

/** Normalizes a decision; throws on anything that does not match the contract (fail closed). */
export function validateDecision(value) {
  const fail = message => { throw new Error(`Invalid triage decision: ${message}`); };
  if (!value || typeof value !== 'object') fail('not an object');
  if (!['trivial', 'minor', 'meaningful', 'major'].includes(value.significance)) fail('significance');
  const strings = list => Array.isArray(list) && list.every(item => typeof item === 'string');
  const clean = value.clean_code;
  const docs = value.docs;
  if (!clean || typeof clean.run !== 'boolean') fail('clean_code.run');
  if (!docs || typeof docs.run !== 'boolean') fail('docs.run');
  if (clean.focus_files !== undefined && !strings(clean.focus_files)) fail('clean_code.focus_files');
  if (clean.concerns !== undefined && !strings(clean.concerns)) fail('clean_code.concerns');
  if (docs.focus_docs !== undefined && !strings(docs.focus_docs)) fail('docs.focus_docs');
  return {
    significance: value.significance,
    clean_code: { run: clean.run, focus_files: (clean.focus_files || []).slice(0, 15), concerns: clean.concerns || [] },
    docs: { run: docs.run, focus_docs: docs.focus_docs || [], reason: typeof docs.reason === 'string' ? docs.reason : '' },
    reason: typeof value.reason === 'string' ? value.reason : ''
  };
}

export async function runTriage({ provider, repo, runDirectory, brief, config, modelRunner = runModel }) {
  const briefFile = path.join(runDirectory, 'triage-brief.md');
  fs.writeFileSync(briefFile, brief);
  const prompt = provider === 'cursor'
    ? `${triagePrompt({ briefPath: briefFile.replaceAll('\\', '/') })}\n\n${TRIAGE_REPLY_FORMAT}`
    : triagePrompt({ brief });
  const { text, structured } = await modelRunner({
    provider, role: 'triage', cwd: repo, prompt, model: modelFor(config, provider, 'triage'), schema: TRIAGE_SCHEMA,
    output: path.join(runDirectory, 'triage.out'), addDirs: [runDirectory], repo, config, timeoutMs: config.timeouts.triageMinutes * 60_000
  });
  return validateDecision(structured ?? extractJson(text));
}
