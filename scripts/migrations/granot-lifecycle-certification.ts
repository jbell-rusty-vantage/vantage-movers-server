import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { getGranotLifecycleFlags, GRANOT_LIFECYCLE_FLAG_NAMES } from "../../src/config/domain/granotLifecycle.js";
import { getMongoDatabaseName, isTestMode } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { getGranotLifecycleActivationModel } from "../../src/models/GranotLifecycleActivation.js";
import { getSynchronizationDecisionModel } from "../../src/models/SynchronizationDecision.js";
import { maskLifecycleId } from "../../src/services/granotLifecycle/safeLogging.js";
import { assertGranotLifecycleDatabaseAllowed, granotLifecycleOutputDirectory } from "./granot-lifecycle-migration.lib.js";
import { stableHash } from "./granot-lifecycle-shadow.lib.js";
import { buildUnit31Certification, certificationMarkdown, scanUnit31Artifact, sha256Text, type PrivacyFinding } from "./granot-lifecycle-certification.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("granot-lifecycle-certification");
const MIGRATIONS = [
  { command: "receipts", directory: "granot-lifecycle-receipts" },
  { command: "sources", directory: "granot-lifecycle-source-registry" },
  { command: "leads", directory: "granot-lifecycle-lead-provenance" },
  { command: "revisions", directory: "granot-lifecycle-aggregate-revisions" },
  { command: "indexes", directory: "granot-lifecycle-indexes" },
] as const;

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

async function loadMigrationManifests(expectedDatabase: string): Promise<Array<{ command: string; mode: string; file_hash: string; verify_ok?: boolean }>> {
  const result = [];
  for (const migration of MIGRATIONS) {
    const directory = granotLifecycleOutputDirectory(migration.directory);
    let files: string[] = [];
    try { files = (await readdir(directory)).filter((name) => name.endsWith(".json")); } catch { /* reported as incomplete */ }
    const manifests = [];
    for (const filename of files.sort()) {
      const text = await readFile(path.join(directory, filename), "utf8");
      try {
        const value = JSON.parse(text) as { mode?: unknown; database_name?: unknown };
        if (["report", "apply", "verify"].includes(String(value.mode)) && value.database_name === expectedDatabase) {
          manifests.push({ filename, text, mode: value.mode as "report" | "apply" | "verify" });
        }
      } catch { /* malformed artifacts cannot satisfy certification */ }
    }
    for (const mode of ["report", "apply", "verify"] as const) {
      const manifest = manifests.filter((item) => item.mode === mode).at(-1);
      if (!manifest) continue;
      const { text } = manifest;
      result.push({
        command: migration.command,
        mode,
        file_hash: sha256Text(text),
        ...(mode === "verify" ? { verify_ok: !/"ok"\s*:\s*false/.test(text) } : {}),
      });
    }
  }
  return result;
}

async function scanGeneratedArtifacts(): Promise<PrivacyFinding[]> {
  const findings: PrivacyFinding[] = [];
  for (const migration of [...MIGRATIONS.map((item) => item.directory), "granot-lifecycle-shadow"]) {
    const directory = granotLifecycleOutputDirectory(migration);
    let files: string[] = [];
    try { files = await readdir(directory); } catch { continue; }
    for (const filename of files.filter((name) => name.endsWith(".json"))) {
      const artifact = `${migration}/${filename}`;
      findings.push(...scanUnit31Artifact({ artifact, text: await readFile(path.join(directory, filename), "utf8") }));
    }
  }
  return findings.sort((a, b) => `${a.artifact}:${a.code}`.localeCompare(`${b.artifact}:${b.code}`));
}

async function main(): Promise<void> {
  const configuredDatabase = getMongoDatabaseName();
  assertGranotLifecycleDatabaseAllowed(configuredDatabase);
  if (!isTestMode()) throw new Error("Unit 31 certification requires TEST_MODE=true.");
  if (process.env.SHEET_SYNC_MODE !== "disabled") throw new Error("Unit 31 certification requires SHEET_SYNC_MODE=disabled.");
  await connectMongo();
  if (mongoose.connection.db?.databaseName !== configuredDatabase) throw new Error("Connected database does not match certification preflight database.");
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello?.setName) throw new Error("Unit 31 certification requires a replica set.");
  const activation = await getGranotLifecycleActivationModel().findOne({ key: "granot_lifecycle" }).select({ _id: 1, processor_version: 1 }).lean();
  const decisionModes = await getSynchronizationDecisionModel().aggregate<{ _id: string; count: number }>([{ $group: { _id: "$execution_mode", count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
  const db = mongoose.connection.db;
  const openCaseCount = await db.collection("granot_booking_reconciliation_cases").countDocuments({ state: "open" }) + await db.collection("granot_release_reconciliation_cases").countDocuments({ state: "open" });
  const openDiscrepancyCount = await db.collection("granot_booking_discrepancies").countDocuments({ state: "open" }) + await db.collection("granot_release_discrepancies").countDocuments({ state: "open" });
  const deadLetterCount = await db.collection("granot_webhook_receipts").countDocuments({ "processing.state": "dead_letter" });
  const shadowPath = path.join(granotLifecycleOutputDirectory("granot-lifecycle-shadow"), "latest-report.json");
  let shadow: { report_hash: string; passed: boolean; selected_count: number; zero_forbidden_effects: boolean; activation_unchanged: boolean } | undefined;
  try {
    const text = await readFile(shadowPath, "utf8");
    const value = JSON.parse(text) as { passed?: boolean; selection?: { selected_count?: number }; forbidden_effects?: { unchanged?: boolean }; activation_unchanged?: boolean };
    shadow = { report_hash: sha256Text(text), passed: value.passed === true, selected_count: value.selection?.selected_count ?? 0, zero_forbidden_effects: value.forbidden_effects?.unchanged === true, activation_unchanged: value.activation_unchanged === true };
  } catch { /* absent shadow keeps certification failed */ }
  const serverRepo = process.cwd();
  const adminRepo = path.resolve(serverRepo, "..", "vantage-admin");
  const flags = getGranotLifecycleFlags();
  const flagMap = Object.fromEntries(GRANOT_LIFECYCLE_FLAG_NAMES.map((name) => {
    const fields = Object.keys(flags) as Array<keyof typeof flags>;
    const normalized = name.replace("GRANOT_LIFECYCLE_", "").toLowerCase();
    const field = fields.find((candidate) => candidate === normalized);
    return [name, field ? flags[field] : false];
  }));
  const report = buildUnit31Certification({
    repositories: [serverRepo, adminRepo].map((repo, index) => ({ name: index === 0 ? "vantage-main-server" : "vantage-admin", branch: git(repo, ["branch", "--show-current"]), commit: git(repo, ["rev-parse", "--short=12", "HEAD"]), dirty: git(repo, ["status", "--porcelain"]).length > 0 })),
    environment: { database_mode: "test", database_name: configuredDatabase, replica_set: true, sheet_sync_mode: "disabled", external_delivery: "disabled" },
    flags: flagMap,
    activation: activation ? { present: true, masked_id: maskLifecycleId(String(activation._id)), processor_version: activation.processor_version } : { present: false },
    migration_manifests: await loadMigrationManifests(configuredDatabase),
    ...(shadow ? { shadow } : {}),
    health: { dead_letter_count: deadLetterCount, open_case_count: openCaseCount, open_discrepancy_count: openDiscrepancyCount, decision_mode_counts: Object.fromEntries(decisionModes.map((item) => [item._id, item.count])) },
    privacy_findings: await scanGeneratedArtifacts(),
  });
  await mkdir(OUTPUT_DIR, { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(path.join(OUTPUT_DIR, "unit-31-certification.json"), json, { encoding: "utf8", mode: 0o600 });
  await writeFile(path.join(OUTPUT_DIR, "unit-31-certification.md"), certificationMarkdown(report), { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, report_hash: stableHash(report), privacy_finding_count: report.privacy.finding_count }));
  if (!report.passed) process.exitCode = 1;
}

main().catch(() => { console.error("Unit 31 certification failed with a bounded technical error."); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect().catch(() => undefined); });
