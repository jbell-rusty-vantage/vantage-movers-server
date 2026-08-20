import { spawn } from "node:child_process";
import path from "node:path";
import mongoose from "mongoose";
import { getMongoDatabaseName, isTestMode } from "../src/config/domain/runtime";
import { connectMongo } from "../src/db";

const FORBIDDEN_DB = /^(vantagemovers|historical|prod|production)/i;
const ALLOWED_DB = /^(testvantagemovers)(_[a-z0-9]+)?$/i;

const UNIT_33_QUEUED_EFFECT_FILES = [
  "src/services/granotLifecycle/bookingConfirmation.replica.test.ts",
  "src/services/granotLifecycle/releaseOwnerCommands.replica.test.ts",
  "src/services/granotLifecycle/referralBooking.replica.test.ts",
] as const;

const UNIT_34_CURRENT_SHAPE_FILES = [
  "scripts/granot-lifecycle-unit34/current-shapes.test.ts",
] as const;

const UNIT_FILES: Record<string, string[]> = {
  "08": [
    "src/services/granotLifecycle/drainer.replica.test.ts",
    "src/services/granotLifecycle/operations.test.ts",
  ],
  "09": [
    "scripts/migrations/granot-lifecycle-revisions.replica.test.ts",
  ],
  "10": [
    "src/services/domainCommands/idempotency.integration.test.ts",
  ],
  "11": [
    "src/services/domainCommands/idempotency.integration.test.ts",
    "src/services/domainCommands/entityChange.integration.test.ts",
  ],
  "12": [
    "src/services/leads/leadProvenance.replica.test.ts",
  ],
  "13": [
    "scripts/migrations/granot-lifecycle-lead-provenance.replica.test.ts",
  ],
  "14": [
    "src/services/granotLifecycle/identity.replica.test.ts",
  ],
  "15": [
    "src/services/granotLifecycle/processor.replica.test.ts",
  ],
  "16": [
    "src/services/granotLifecycle/extensionApply.replica.test.ts",
  ],
  "17": [
    "src/services/granotLifecycle/automationApply.replica.test.ts",
  ],
  "18": [
    "src/services/granotLifecycle/synchronizeLead.replica.test.ts",
  ],
  "19": [
    "src/services/granotLifecycle/createLeadFromGranot.replica.test.ts",
  ],
  "20": [
    "src/services/ringcentral/callLeadConvergence.replica.test.ts",
  ],
  // Unit 21 re-runs the Unit 20 adoption/duplicate proof as regression, then
  // proves the Call Log lease, cursor, overlap, and rescan contract.
  "21": [
    "src/services/ringcentral/call-log-sync-state.store.test.ts",
    "src/services/ringcentral/call-log-sync-lease.replica.test.ts",
    "src/services/ringcentral/callLeadConvergence.replica.test.ts",
  ],
  "22": [
    "src/services/granotLifecycle/bookingReconciliation.replica.test.ts",
  ],
  "23": [
    "src/services/granotLifecycle/projections.replica.test.ts",
  ],
  "24": [
    "src/services/granotLifecycle/bookingConfirmation.replica.test.ts",
  ],
  "25": [
    "src/services/granotLifecycle/bookingConfirmation.replica.test.ts",
  ],
  "26": [
    "src/services/granotLifecycle/releaseReconciliation.replica.test.ts",
  ],
  "27": [
    "src/services/granotLifecycle/releaseOwnerCommands.replica.test.ts",
  ],
  "28": [
    "src/services/granotLifecycle/bookingReconciliation.replica.test.ts",
    "src/services/granotLifecycle/referralBooking.replica.test.ts",
  ],
  "29": [
    "src/services/granotLifecycle/discrepancies.replica.test.ts",
  ],
  "30": [
    "src/services/granotLifecycle/operations.replica.test.ts",
  ],
  "31": [
    "scripts/migrations/granot-lifecycle-shadow.replica.test.ts",
    "scripts/migrations/granot-lifecycle-lead-provenance.replica.test.ts",
    "scripts/migrations/granot-lifecycle-revisions.replica.test.ts",
  ],
  "33": [
    "src/services/granotLifecycle/drainer.replica.test.ts",
    "src/services/granotLifecycle/identity.replica.test.ts",
    "src/services/granotLifecycle/processor.replica.test.ts",
    "src/services/granotLifecycle/extensionApply.replica.test.ts",
    "src/services/granotLifecycle/automationApply.replica.test.ts",
    "src/services/granotLifecycle/synchronizeLead.replica.test.ts",
    "src/services/granotLifecycle/createLeadFromGranot.replica.test.ts",
    "src/services/granotLifecycle/bookingReconciliation.replica.test.ts",
    "src/services/granotLifecycle/releaseReconciliation.replica.test.ts",
    "src/services/granotLifecycle/discrepancies.replica.test.ts",
    "src/services/granotLifecycle/projections.replica.test.ts",
    "src/services/granotLifecycle/operations.replica.test.ts",
    "src/services/ringcentral/call-log-sync-lease.replica.test.ts",
    "src/services/ringcentral/callLeadConvergence.replica.test.ts",
    "scripts/migrations/granot-lifecycle-shadow.replica.test.ts",
  ],
  "34": [
    ...UNIT_34_CURRENT_SHAPE_FILES,
    "src/services/granotLifecycle/drainer.replica.test.ts",
    "src/services/granotLifecycle/identity.replica.test.ts",
    "src/services/granotLifecycle/processor.replica.test.ts",
    "src/services/granotLifecycle/extensionApply.replica.test.ts",
    "src/services/granotLifecycle/automationApply.replica.test.ts",
    "src/services/granotLifecycle/synchronizeLead.replica.test.ts",
    "src/services/granotLifecycle/createLeadFromGranot.replica.test.ts",
    "src/services/granotLifecycle/bookingReconciliation.replica.test.ts",
    "src/services/granotLifecycle/releaseReconciliation.replica.test.ts",
    "src/services/granotLifecycle/discrepancies.replica.test.ts",
    "src/services/granotLifecycle/projections.replica.test.ts",
    "src/services/granotLifecycle/operations.replica.test.ts",
    "src/services/ringcentral/call-log-sync-lease.replica.test.ts",
    "src/services/ringcentral/callLeadConvergence.replica.test.ts",
    "scripts/migrations/granot-lifecycle-shadow.replica.test.ts",
  ],
};

function parseUnit(): string {
  const raw = process.argv.find((arg) => arg.startsWith("--unit="));
  if (!raw) {
    throw new Error("Usage: pnpm test:granot-lifecycle:replica -- --unit=08|...|31|33|34");
  }
  return raw.slice("--unit=".length);
}

async function assertSafeReplica(): Promise<void> {
  if (!isTestMode()) {
    throw new Error("Refusing replica runner: TEST_MODE must be true.");
  }
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
  if (!hello || hello.setName == null) {
    throw new Error("Refusing: connected Mongo is not a replica set.");
  }
}

async function main(): Promise<void> {
  const unit = parseUnit();
  const files = UNIT_FILES[unit];
  if (!files) {
    throw new Error(`No replica files registered for unit ${unit}; supported units are 08-31, 33, and 34.`);
  }
  if (unit === "34") {
    const approvedDerivative = process.env.GRANOT_UNIT34_SANITIZED_INPUT_FILE?.trim();
    if (!approvedDerivative || !path.isAbsolute(approvedDerivative)) {
      throw new Error("Unit 34 requires an absolute approved sanitized derivative path.");
    }
  }
  await assertSafeReplica();
  process.env.GRANOT_LIFECYCLE_REPLICA_TESTS = "true";
  const runFiles = async (
    selectedFiles: readonly string[],
    sheetSyncMode: "disabled" | "queued",
  ): Promise<number> => {
    const child = spawn(
    process.execPath,
    [
      "--import", "tsx", "--import", "./scripts/test-setup.ts", "--test",
      ...(unit === "33" || unit === "34" ? ["--test-force-exit"] : []),
      "--test-concurrency=1",
      ...selectedFiles,
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        GRANOT_LIFECYCLE_REPLICA_TESTS: "true",
        GRANOT_LIFECYCLE_UNIT34_TESTS: unit === "34" ? "true" : "false",
        // Replica proofs own their gate posture. Never inherit a developer's
        // live-rollout values from .env, because several tests assert the safe
        // baseline before selectively widening one gate for their scenario.
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
  };
  let code = await runFiles(files, "disabled");
  if (code === 0 && (unit === "33" || unit === "34")) {
    // Queued mode persists the transactional outbox intent while test-setup
    // blocks queue publication and all Google delivery.
    code = await runFiles(UNIT_33_QUEUED_EFFECT_FILES, "queued");
  }
  await mongoose.disconnect().catch(() => undefined);
  process.exit(code);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
