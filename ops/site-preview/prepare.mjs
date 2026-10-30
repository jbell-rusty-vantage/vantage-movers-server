import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, appendFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Export committed files only: unrelated local edits and .env never ship.
const repo = resolve(import.meta.dirname, '../..');
const stage = mkdtempSync(join(tmpdir(), 'vantage-site-preview-'));
const archive = join(stage, 'source.tar');
execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, 'HEAD'], { cwd: repo });
execFileSync('tar', ['-xf', archive, '-C', stage]);
copyFileSync(join(stage, 'vercel.preview.json'), join(stage, 'vercel.json'));
writeFileSync(join(stage, 'api/index.ts'), 'export { default } from "../src/sitePreviewApp";\n');
appendFileSync(join(stage, '.vercelignore'), '\nsource.tar\napi/queues/\n');
console.log(stage);
