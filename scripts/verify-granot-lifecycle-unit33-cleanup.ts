import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Finding = {
  rule: string;
  path: string;
  line?: number;
};

const repoRoot = process.cwd();
const lifecycleArchivePrefix =
  "scripts/prototypes/granot-lead-lifecycle/";
const retainedHistoryPrefixes = [
  `${lifecycleArchivePrefix}delivery/`,
  `${lifecycleArchivePrefix}specs/`,
];

const findings: Finding[] = [];

function worktreeFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
    cwd: repoRoot,
    encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean)
    .filter((path) => existsSync(resolve(repoRoot, path)));
}

function activeTextFiles(files: readonly string[]): string[] {
  return files.filter((path) => {
    if (path === "scripts/verify-granot-lifecycle-unit33-cleanup.ts") {
      return false;
    }
    if (retainedHistoryPrefixes.some((prefix) => path.startsWith(prefix))) {
      return false;
    }
    return /(?:^package\.json$|\.(?:ts|tsx|js|jsx|json|md|mdc))$/i.test(path);
  });
}

function scan(
  paths: readonly string[],
  rule: string,
  pattern: RegExp,
): void {
  for (const path of paths) {
    const lines = readFileSync(resolve(repoRoot, path), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      pattern.lastIndex = 0;
      if (pattern.test(line)) findings.push({ rule, path, line: index + 1 });
    });
  }
}

function requireAbsent(path: string, rule: string): void {
  if (existsSync(resolve(repoRoot, path))) findings.push({ rule, path });
}

const worktree = worktreeFiles();
const active = activeTextFiles(worktree);

scan(
  active,
  "retired_receipt_alias",
  /GranotWebhookReceipt|getGranotWebhookReceiptModel|GranotWebhookReceiptDocument/,
);
scan(
  active,
  "superseded_lifecycle_vocabulary",
  /Booking Intake|Cancellation Intake|Cancel Intake|GranotBookingIntakeCase|generic lifecycle (?:engine|status|enum)/i,
);
scan(
  active,
  "retired_prototype_command",
  /prototype:granot-lifecycle|granot:lifecycle:dry-run|granot:lifecycle:seed-official-sources/,
);

const receiptRuntimeFiles = [
  "src/models/GranotObservationReceipt.ts",
  "src/services/granotLifecycle/capture.ts",
  "scripts/dump-operations-name-link-inventory.ts",
].filter((path) => existsSync(resolve(repoRoot, path)));
scan(
  receiptRuntimeFiles,
  "retired_receipt_runtime_field",
  /\b(?:event_type|received_at|schema_version|processing_status|processing_attempts|processed_at|processing_error)\b/,
);

for (const path of [
  `${lifecycleArchivePrefix}cli.ts`,
  `${lifecycleArchivePrefix}domain.ts`,
  `${lifecycleArchivePrefix}fixtures.ts`,
  `${lifecycleArchivePrefix}scenarios.ts`,
  `${lifecycleArchivePrefix}dry-runs/run.ts`,
  "src/services/granotWebhooks/granotWebhookCapture.service.ts",
]) {
  requireAbsent(path, "retired_file_present");
}

const extensionPackagePath = resolve(
  repoRoot,
  "../granot_sync_extensions_and_services/package.json",
);
if (existsSync(extensionPackagePath)) {
  const extensionPackage = JSON.parse(
    readFileSync(extensionPackagePath, "utf8"),
  ) as { version?: unknown };
  if (extensionPackage.version !== "0.2.8") {
    findings.push({
      rule: "extension_version_not_0_2_8",
      path: "../granot_sync_extensions_and_services/package.json",
    });
  }
}

const summary = {
  worktree_file_count: worktree.length,
  active_text_file_count: active.length,
  finding_count: findings.length,
  findings: findings.sort((left, right) =>
    `${left.rule}:${left.path}:${left.line ?? 0}`.localeCompare(
      `${right.rule}:${right.path}:${right.line ?? 0}`,
    ),
  ),
};

console.log(JSON.stringify(summary, null, 2));
if (findings.length > 0) process.exitCode = 1;
