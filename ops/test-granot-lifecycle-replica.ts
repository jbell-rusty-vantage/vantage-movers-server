/**
 * Granot lifecycle replica sweep: `pnpm test:granot-lifecycle:replica`.
 *
 * Restored from the pre-slimming `scripts/test-granot-lifecycle-replica.ts` (lost when `scripts/*` became
 * gitignored) and kept in tracked `ops/`. It refuses anything but a disposable test database on a replica set,
 * forces the safe lifecycle gate posture, runs every lifecycle replica proof except the queued-effect ones in one
 * serial pass (sheet sync disabled), then runs the queued-effect proofs with sheet sync queued (test-setup blocks
 * publication and Google delivery). The per-unit selection of the original is gone: the sweep is the whole set.
 *
 * Target: TEST_MODE=true is required; MONGO_URI defaults to the loopback `csi01` replica and any other value must
 * be loopback too. `.env` is never read (dotenv is pinned to a missing file) and provider secrets are dropped.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { isLoopbackMongoUri } from "./lib/loopback-mongo";

const ROOT = path.resolve(__dirname, "..");
/** The documented local replica (`csi01` on loopback). The sweep never reads `.env` and never targets another host. */
export const GRANOT_LIFECYCLE_LOCAL_REPLICA_URI = "mongodb://127.0.0.1:27189/?replicaSet=csi01";
const MISSING_DOTENV = path.join(ROOT, ".granot-lifecycle-replica-no-dotenv.env");
/** Provider credentials and live-rollout values are never inherited by the sweep. */
const SCRUBBED_ENV = /RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|SHEET|GRANOT|TWILIO|SENDGRID|RESEND|SMTP|MONGO|DOTENV/i;

/**
 * Pins the sweep's environment before any `src/` module loads: TEST_MODE must already be true (the caller's
 * explicit opt-in), a caller-supplied MONGO_URI must be loopback, provider secrets are dropped and dotenv is
 * pointed at a file that does not exist, so `import "dotenv/config"` anywhere in `src/` cannot load the
 * production `.env`.
 */
function pinEnvironment(): void {
  if (process.env.TEST_MODE?.trim().toLowerCase() !== "true") throw new Error("Refusing replica runner: TEST_MODE must be true.");
  const requested = process.env.MONGO_URI?.trim();
  if (requested && !isLoopbackMongoUri(requested)) throw new Error("Refusing replica runner: MONGO_URI is not a loopback replica.");
  const database = process.env.TEST_MONGO_DATABASE_NAME?.trim();
  for (const key of Object.keys(process.env)) if (SCRUBBED_ENV.test(key)) delete process.env[key];
  if (existsSync(MISSING_DOTENV)) throw new Error(`Refusing replica runner: ${MISSING_DOTENV} must not exist.`);
  process.env.DOTENV_CONFIG_PATH = MISSING_DOTENV;
  process.env.MONGO_URI = requested || GRANOT_LIFECYCLE_LOCAL_REPLICA_URI;
  if (database) process.env.TEST_MONGO_DATABASE_NAME = database;
}
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
/** Proofs that assert Sheet Sync outbox rows: they need `SHEET_SYNC_MODE=queued`, so they run in the second pass only. */
const QUEUED_EFFECT_FILES = [
  "src/services/granotLifecycle/bookingConfirmation.replica.test.ts",
  "src/services/granotLifecycle/bookingOwnerCommands.replica.test.ts",
  "src/services/granotLifecycle/connectBookingToLead.replica.test.ts",
  "src/services/granotLifecycle/releaseOwnerCommands.replica.test.ts",
  "src/services/granotLifecycle/referralBooking.replica.test.ts",
] as const;
/**
 * Non-secret configuration the proofs used to inherit from `.env`. Sheet container ids are synthetic: the planner
 * needs a target id, and test-setup blocks queue publication and Google delivery. Call Lead creation is on, as
 * in the deployed posture; ingest makes no provider call.
 */
const SYNTHETIC_ENV: Record<string, string> = {
  RINGCENTRAL_CREATE_CALL_LEADS: "true",
  RINGCENTRAL_SHADOW_CALL_LEADS: "false",
  ...Object.fromEntries(
    ["MASTER_LEADS", "MASTER_BOOKED", "TBM_LEADS", "TBM_PRIME_LEADS", "TOP10_LEADS", "BEST_RELOCATION_LEADS", "GETMOVERS_LEADS", "MAINSITE_LEADS"].map(
      (name) => [`TEST_${name}_SHEET_ID`, `synthetic-replica-${name.toLowerCase()}`],
    ),
  ),
};

function sweepFiles(): string[] {
  const lifecycle = readdirSync(path.join(ROOT, LIFECYCLE_DIR))
    .filter((name) => name.endsWith(".replica.test.ts"))
    .sort()
    .map((name) => `${LIFECYCLE_DIR}/${name}`);
  const queued = new Set<string>(QUEUED_EFFECT_FILES);
  return [...lifecycle, ...OTHER_FILES.filter((file) => existsSync(path.join(ROOT, file)))].filter((file) => !queued.has(file));
}

async function assertSafeReplica(): Promise<string> {
  const { getMongoDatabaseName, isTestMode } = await import("../src/config/domain/runtime.js");
  const { connectMongo } = await import("../src/db.js");
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
  const hosts = (hello.hosts as string[] | undefined) ?? [];
  if (!hosts.length || !hosts.every((host) => isLoopbackMongoUri(`mongodb://${host}/`))) throw new Error("Refusing: a replica member is not loopback.");
  return configured;
}

function runFiles(files: readonly string[], sheetSyncMode: "disabled" | "queued", database: string): Promise<number> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--import", "./ops/test-setup.ts", "--test", "--test-force-exit", "--test-concurrency=1", ...files],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        ...SYNTHETIC_ENV,
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
        MONGO_DB_NAME: database,
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
  pinEnvironment();
  const database = await assertSafeReplica();
  await mongoose.disconnect().catch(() => undefined);
  console.log(`Granot lifecycle replica sweep: ${database} on the loopback replica`);
  let code = await runFiles(sweepFiles(), "disabled", database);
  if (code === 0) code = await runFiles(QUEUED_EFFECT_FILES, "queued", database);
  process.exit(code);
}

if (require.main === module) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
