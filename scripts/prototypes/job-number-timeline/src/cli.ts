/**
 * Read-only prototype: typed Job Number owner-facing chain.
 *
 *   pnpm prototype:job-number-timeline -- render --job-no <raw>
 *   pnpm prototype:job-number-timeline -- discover
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../../../src/db.js";
import { createJobNumberTimelineModule } from "../../../../src/services/jobNumberTimeline/index.js";
import { redactTimelineValue } from "../../../../src/services/jobNumberTimeline/masking.js";
import { createMongoEvidenceLoader } from "../../../../src/services/jobNumberTimeline/mongo-evidence-loader.js";
import { normalizeTypedJobNo } from "../../../../src/services/jobNumberTimeline/normalize.js";
import type { JobTimelinePage } from "../../../../src/services/jobNumberTimeline/types.js";
import { granotLifecycleOutputDirectory } from "../../../migrations/granot-lifecycle-migration.lib.js";
import { discoverJobNumberTimelines } from "./discover.js";
import {
  assertTimelineDatabaseAllowed,
  PRODUCTION_CONFIRMATION,
  resolveTimelineDatabase,
  timelineDatabase,
} from "./load.js";

export {
  assertTimelineDatabaseAllowed,
  PRODUCTION_CONFIRMATION,
  resolveTimelineDatabase,
};

const OUTPUT_DIR = granotLifecycleOutputDirectory("job-number-timeline");

const KNOWN_FLAGS = new Set([
  "render",
  "discover",
  "--",
  "--job-no",
  "--source-granularity-id",
  "--source-company-id",
  "--limit",
  "--min-score",
  PRODUCTION_CONFIRMATION,
]);

export class JobTimelineCliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function readFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

export function assertKnownArgs(args: readonly string[]): void {
  const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--" && !KNOWN_FLAGS.has(arg));
  if (unknown.length > 0) {
    throw new JobTimelineCliError(`Unknown flag(s): ${unknown.join(", ")}`);
  }
}

function printTable(page: JobTimelinePage): void {
  process.stdout.write("| event_at | kind | headline |\n| --- | --- | --- |\n");
  for (const row of page.events) {
    process.stdout.write(`| ${row.event_at} | ${row.kind} | ${row.headline} |\n`);
  }
}

async function writeReport(kind: string, payload: unknown): Promise<string> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const filePath = path.join(OUTPUT_DIR, `${kind}-${stamp}.json`);
  const latestPath = path.join(OUTPUT_DIR, `${kind}-latest.json`);
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(filePath, body, { encoding: "utf8", mode: 0o600 });
  await writeFile(latestPath, body, { encoding: "utf8", mode: 0o600 });
  return filePath;
}

function createProductionModule(db: Awaited<ReturnType<typeof timelineDatabase>>) {
  return createJobNumberTimelineModule({
    loader: createMongoEvidenceLoader({ db }),
  });
}

function readInput(args: readonly string[], jobNo: string) {
  return {
    job_no: jobNo,
    source_granularity_id: readFlag(args, "--source-granularity-id"),
    source_company_id: readFlag(args, "--source-company-id"),
  };
}

async function runRender(args: readonly string[]): Promise<void> {
  const rawJobNo = readFlag(args, "--job-no");
  if (rawJobNo == null) {
    throw new JobTimelineCliError("render requires --job-no <raw Job Number>.");
  }
  const normalized = normalizeTypedJobNo(rawJobNo);
  if (!normalized) {
    process.stdout.write("invalid_job_number\n");
    throw new JobTimelineCliError("invalid_job_number");
  }
  const databaseName = resolveTimelineDatabase(args);
  assertTimelineDatabaseAllowed(databaseName, args);
  await connectMongo();
  const db = await timelineDatabase(mongoose, databaseName);
  const result = await createProductionModule(db).read(readInput(args, rawJobNo));
  if (result.status === "not_found") {
    process.stdout.write(`not_found ${result.normalized_job_no}\n`);
    return;
  }
  if (result.status === "filtered_out") {
    process.stdout.write(`filtered_out ${result.normalized_job_no}\n`);
    for (const scope of result.scopes) {
      process.stdout.write(`  ${scope.kind} ${scope.source_granularity_id ?? ""} ${scope.owner_label ?? scope.source_granularity_label ?? ""}\n`);
    }
    return;
  }
  if (result.status !== "ok") {
    process.stdout.write("invalid_job_number\n");
    throw new JobTimelineCliError("invalid_job_number");
  }
  printTable(result.page);
  const filePath = await writeReport(`render-${result.page.normalized_job_no}`, {
    database: databaseName,
    generated_at: new Date().toISOString(),
    page: redactTimelineValue(result.page),
  });
  process.stdout.write(`\nWrote ${filePath}\n`);
}

async function runDiscover(args: readonly string[]): Promise<void> {
  const databaseName = resolveTimelineDatabase(args);
  assertTimelineDatabaseAllowed(databaseName, args);
  const limit = Number(readFlag(args, "--limit") ?? "20");
  const minScore = Number(readFlag(args, "--min-score") ?? "4");
  await connectMongo();
  const db = await timelineDatabase(mongoose, databaseName);
  const module = createProductionModule(db);
  const jobNos = new Set<string>();
  for (const collection of [
    "granot_record_links",
    "booked_leads",
    "granot_booking_reconciliation_cases",
    "granot_release_reconciliation_cases",
  ]) {
    const values = await db.collection(collection).distinct("normalized_job_no");
    for (const value of values) {
      if (typeof value === "string" && value.trim()) jobNos.add(value);
    }
  }
  const observationJobs = await db.collection("granot_observations").distinct("identity.normalized_job_no");
  for (const value of observationJobs) {
    if (typeof value === "string" && value.trim()) jobNos.add(value);
  }

  const pages: JobTimelinePage[] = [];
  for (const jobNo of jobNos) {
    const result = await module.read(readInput(args, jobNo));
    if (result.status === "ok") pages.push(result.page);
  }
  const ranked = discoverJobNumberTimelines(pages, { limit, minScore });
  process.stdout.write(`database: ${databaseName}\n`);
  process.stdout.write(`jobs_scored: ${ranked.length}\n\n`);
  for (const row of ranked) {
    process.stdout.write(
      `${row.normalized_job_no}  score=${row.score}  ${row.proof_shape}  ${row.present_kinds.join(",")}\n`,
    );
  }
  const filePath = await writeReport("discover", {
    database: databaseName,
    generated_at: new Date().toISOString(),
    rows: ranked,
  });
  process.stdout.write(`\nWrote ${filePath}\n`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  assertKnownArgs(argv);
  if (argv.includes("list")) {
    throw new JobTimelineCliError("There is no list mode.");
  }
  if (argv.includes("render")) {
    await runRender(argv);
    return;
  }
  if (argv.includes("discover")) {
    await runDiscover(argv);
    return;
  }
  throw new JobTimelineCliError("Expected render or discover.");
}

function isDirectExecution(): boolean {
  const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
  return entry.endsWith("job-number-timeline/src/cli.ts");
}

if (isDirectExecution()) {
  main()
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = error instanceof JobTimelineCliError ? error.exitCode : 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect().catch(() => undefined);
      }
    });
}
