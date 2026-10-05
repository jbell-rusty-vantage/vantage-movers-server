// Copies the quality tool between locations (skill tool/ ⇄ a vendored copy such as <repo>/ops/quality).
// Usage: node sync-tool.mjs <source-dir> <target-dir> [--dry-run]
// Copies *.mjs and docs-contract.md; reports files only in the target (it never deletes them).
import fs from 'node:fs';
import path from 'node:path';

const [source, target] = process.argv.slice(2).filter(argument => !argument.startsWith('--'));
const dryRun = process.argv.includes('--dry-run');
if (!source || !target) { console.error('usage: node sync-tool.mjs <source-dir> <target-dir> [--dry-run]'); process.exit(2); }
const wanted = name => name.endsWith('.mjs') || name === 'docs-contract.md';
const sourceFiles = fs.readdirSync(source).filter(wanted);
if (!sourceFiles.includes('hook.mjs') || !sourceFiles.includes('pipeline.mjs')) { console.error(`${source} does not look like the quality tool`); process.exit(2); }
fs.mkdirSync(target, { recursive: true });
let changed = 0;
for (const name of sourceFiles) {
  const from = fs.readFileSync(path.join(source, name), 'utf8').replaceAll('\r\n', '\n');
  const destination = path.join(target, name);
  const to = fs.existsSync(destination) ? fs.readFileSync(destination, 'utf8').replaceAll('\r\n', '\n') : null;
  if (from === to) continue;
  changed++;
  console.log(`${to === null ? 'add   ' : 'update'} ${name}`);
  if (!dryRun) fs.writeFileSync(destination, from);
}
const extra = fs.readdirSync(target).filter(wanted).filter(name => !sourceFiles.includes(name));
for (const name of extra) console.log(`only in target (left in place): ${name}`);
console.log(`${changed} file(s) ${dryRun ? 'would change' : 'synced'}. Run: node --test ${path.join(target, 'quality.test.mjs')} and re-run install if this copy is the installed toolDir.`);
