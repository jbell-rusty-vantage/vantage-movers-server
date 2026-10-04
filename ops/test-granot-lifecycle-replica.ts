/**
 * Granot lifecycle replica sweep: `pnpm test:granot-lifecycle:replica`.
 *
 * Restored from the pre-slimming `scripts/test-granot-lifecycle-replica.ts` (lost when `scripts/*` became
 * gitignored) and kept in tracked `ops/`. It refuses anything but a disposable test database on a replica set,
 * forces the safe lifecycle gate posture, runs every lifecycle replica proof in one serial pass (sheet sync
 * disabled), then re-runs the queued-effect proofs with sheet sync queued (test-setup blocks publication and
 * Google delivery). The per-unit selection of the original is gone: the sweep is the whole set.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { getMongoDatabaseName, isTestMode } from "../src/config/domain/runtime";
import { connectMongo } from "../src/db";

const ROOT = path.resolve(__dirname, "..");
const FORBIDDEN_DB = /^(vantagemovers|historical|prod|production)/i;
const ALLOWED_DB = /^(testvantagemovers)(_[a-z0-9]+)?$/i;

const LIFECYCLE_DIR = "src/services/granotLifecycle";
const OTHER_FILES = [
  "src/services/leads/leadProvenance.replica.test.ts",
  "src/services/ringcentral/call-log-sync-state.store.test.ts",
  "src/services/ringcentral/call-log-sync-lease.replica.test.ts",
  "src/services/ringcentral/callLeadConvergence.replica.test.ts",
  // Local operator proofs (gitignored `scripts/`): run when present.
  "scripts/migrations/granot-lifecycle-shadow.replica.test.ts",
  "scripts/migrations/granot-lifecycle-lead-provenance.replica.test.ts",
  "scripts/migrations/granot-lifecycle-revisions.replica.test.ts",
] as const;
const QUEUED_EFFECT_FILES = [
  "src/services/granotLifecycle/bookingConfirmation.replica.test.ts",
  "src/services/granotLifecycle/releaseOwnerCommands.replica.test.ts",
  "src/services/granotLifecycle/referralBooking.replica.test.ts",
] as const;

function sweepFiles(): string[] {
  const lifecycle = readdirSync(path.join(ROOT, LIFECYCLE_DIR))
    .filter((name) => name.endsWith(".replica.test.ts"))
    .sort()
    .map((name) => `${LIFECYCLE_DIR}/${name}`);
  return [...lifecycle, ...OTHER_FILES.filter((file) => existsSync(path.join(ROOT, file)))];
}

async function assertSafeReplica(): Promise<void> {
  if (!isTestMode()) throw new Error("Refusing replica runner: TEST_MODE must be true.");
  const configured = getMongoDatabaseName();
  if (FORBIDDEN_DB.test(configured) || !ALLOWED_DB.test(configured)) {
    throw new Error(`Refusing non-disposable database name: ${configured}`);
  }
  await connectMongo();
  const connected = mongoose.connection.db?.databaseName;
  if (!connected || FORBIDDEN_DB.test(connected) || !ALLOWED_DB.test(connected)) {
    throw new Error(`Refusing connected database: ${connected ?? "unknown"}`);
  }
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello || hello.setName == null) throw new Error("Refusing: connected Mongo is not a replica set.");
}

function runFiles(files: readonly string[], sheetSyncMode: "disabled" | "queued"): Promise<number> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--import", "./ops/test-setup.ts", "--test", "--test-force-exit", "--test-concurrency=1", ...files],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        GRANOT_LIFECYCLE_REPLICA_TESTS: "true",
        // Replica proofs own their gate posture; never inherit live-rollout values from .env.
        GRANOT_LIFECYCLE_PROCESSING_ENABLED: "true",
        GRANOT_LIFECYCLE_SHADOW_MODE: "true",
        GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED: "false",
        GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED: "false",
        GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED: "false",
        GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED: "false",
        GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED: "false",
        GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED: "false",
        GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED: "false",
        GRANOT_LIFECYCLE_EMAIL_ENABLED: "false",
        MONGO_DB_NAME: getMongoDatabaseName(),
        RINGCENTRAL_COLLECTION_MODE: "test",
        RINGCENTRAL_GRANOT_ADOPTION_ENABLED: "true",
        SHEET_SYNC_MODE: sheetSyncMode,
      },
    },
  );
  return new Promise<number>((resolve) => {
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
}

async function main(): Promise<void> {
  await assertSafeReplica();
  await mongoose.disconnect().catch(() => undefined);
  let code = await runFiles(sweepFiles(), "disabled");
  if (code === 0) code = await runFiles(QUEUED_EFFECT_FILES, "queued");
  process.exit(code);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
