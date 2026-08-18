import { spawn } from "node:child_process";
import mongoose from "mongoose";
import { getMongoDatabaseName, isTestMode } from "../src/config/domain/runtime";
import { connectMongo } from "../src/db";

const FORBIDDEN_DB = /^(vantagemovers|historical|prod|production)/i;
const ALLOWED_DB = /^(testvantagemovers)(_[a-z0-9]+)?$/i;

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
};

function parseUnit(): string {
  const raw = process.argv.find((arg) => arg.startsWith("--unit="));
  if (!raw) {
    throw new Error("Usage: pnpm test:granot-lifecycle:replica -- --unit=08|09|10|11|12|13|14|15");
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
    throw new Error(`No replica files registered for unit ${unit}`);
  }
  await assertSafeReplica();
  process.env.GRANOT_LIFECYCLE_REPLICA_TESTS = "true";
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--import", "./scripts/test-setup.ts", "--test", "--test-concurrency=1", ...files],
    {
      stdio: "inherit",
      env: { ...process.env, GRANOT_LIFECYCLE_REPLICA_TESTS: "true" },
    },
  );
  const code = await new Promise<number>((resolve) => {
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  await mongoose.disconnect().catch(() => undefined);
  process.exit(code);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
