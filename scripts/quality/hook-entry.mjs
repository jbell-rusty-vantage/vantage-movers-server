import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// User-level hooks also serve the multi-repo workspace. Unrelated projects are ignored.
const installedRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (process.env.VANTAGE_QUALITY_CHILD !== '1') {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const payload = text.trim() ? JSON.parse(text) : {};
  const candidates = [payload.cwd, ...(payload.workspace_roots || []), process.cwd()].filter(Boolean);
  let target;
  for (const candidate of candidates) {
    let directory = path.resolve(candidate);
    if (directory === path.dirname(installedRoot)) { target = installedRoot; break; }
    while (true) {
      const pkg = path.join(directory, 'package.json');
      if (fs.existsSync(path.join(directory, '.quality.config.json')) && fs.existsSync(pkg)
        && JSON.parse(fs.readFileSync(pkg, 'utf8')).name === 'vantage_movers_server') { target = directory; break; }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    if (target) break;
  }
  if (target) {
    const result = spawnSync(process.execPath, [path.join(target, 'scripts/quality/cli.mjs'), 'hook', ...process.argv.slice(2)], {
      cwd: target, input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true, timeout: 2000
    });
    if (result.status !== 0) process.stderr.write(result.stderr || result.error?.message || 'Quality hook failed');
  }
}
process.stdout.write('{}\n');
