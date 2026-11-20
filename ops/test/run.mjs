#!/usr/bin/env node
/**
 * Default offline suite runner (`pnpm test`).
 *
 * Starting one Node + tsx process per test file used to cost most of the run:
 * the test bodies take about a minute in total, but 376 cold module graphs took
 * three to five minutes in CI. This runner splits the files into two groups:
 *
 *   shared   — files that only import and assert. They run together in one
 *              process (`--test-isolation=none`), so the app graph loads once.
 *   isolated — files that change process-wide state: environment variables,
 *              module mocks, `…ForTests()` hooks, Mongoose connections or global
 *              objects. Each keeps its own process, exactly as before.
 *
 * Classification is by source text (STATEFUL below), so a new test file lands in
 * the right group without editing a list. Add the comment `// test-isolation: process`
 * to force a file into its own process if a shared run ever shows cross-file leakage.
 *
 * `*.replica.test.ts` files are not part of the default suite: they skip without
 * the csi01 loopback replica, and the replica runners (`pnpm test:granot-lifecycle:replica`,
 * `pnpm vantage -- test sheet-sync --suite replica`, …) execute them by name.
 *
 * Usage: pnpm test [-- --isolate-all] [any node --test flag, e.g. --test-name-pattern=…]
 */
import { spawnSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";

const PATTERNS = [
  "src/**/*.test.ts",
  "api/queues/**/*.test.ts",
  "ops/lib/*.test.ts",
  "ops/vantage/*.test.ts",
  "ops/local-runtime.test.ts",
];

const STATEFUL = new RegExp(
  [
    String.raw`process\.env(\.\w+|\[[^\]]+\])\s*(=[^=]|\?\?=|\|\|=)`,
    String.raw`delete process\.env`,
    String.raw`Object\.assign\(process\.env`,
    String.raw`mock\.(module|method|timers)`,
    String.raw`\.mock\(`,
    String.raw`Object\.defineProperty`,
    String.raw`globalThis\.\w+\s*=[^=]`,
    String.raw`mongoose\.(model|connect)`,
    String.raw`setTestMode`,
    String.raw`install[A-Z]\w*\(`,
    String.raw`For(Tests?|Testing)\(`,
    String.raw`process\.(on|once|chdir)\(`,
    String.raw`test-isolation: process`,
  ].join("|"),
);

const argv = process.argv.slice(2);
const isolateAll = argv.includes("--isolate-all");
const passThrough = argv.filter((arg) => arg !== "--isolate-all");

const files = [...new Set(PATTERNS.flatMap((pattern) => globSync(pattern)))]
  .map((file) => file.replaceAll("\\", "/"))
  .filter((file) => !file.endsWith(".replica.test.ts"))
  .sort();

const shared = [];
const isolated = [];
for (const file of files) {
  (isolateAll || STATEFUL.test(readFileSync(file, "utf8")) ? isolated : shared).push(file);
}

const base = ["--import", "tsx", "--import", "./ops/test-setup.ts", "--test", ...passThrough];

function run(label, extra, group) {
  if (group.length === 0) return 0;
  console.log(`\n# ${label}: ${group.length} files`);
  const result = spawnSync(process.execPath, [...base, ...extra, ...group], { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const sharedStatus = run("shared process", ["--test-isolation=none"], shared);
const isolatedStatus = run("isolated processes", [], isolated);

console.log(`\n# test groups: shared ${shared.length} files exit ${sharedStatus}; isolated ${isolated.length} files exit ${isolatedStatus}`);
process.exitCode = sharedStatus || isolatedStatus;
