/**
 * Read-only prototype: typed Job Number owner-facing chain.
 *
 *   pnpm prototype:job-number-timeline -- render --job-no <raw>
 *   pnpm prototype:job-number-timeline -- discover
 *   pnpm prototype:job-number-timeline -- proof
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
  aliasJobNumber,
  analyzeProofPage,
  collectionCountDeltas,
  countProofCollections,
  percentile,
  proofCollectionNames,
  selectProofAliases,
} from "./live-proof.js";
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
  "proof",
  "--",
  "--job-no",
  "--source-granularity-id",
  "--source-company-id",
  "--limit",
  "--min-score",
  "--max-jobs",
  "--warm-runs",
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

async function collectDistinctJobNos(
  db: Awaited<ReturnType<typeof timelineDatabase>>,
): Promise<string[]> {
  const prioritized: string[] = [];
  const rest: string[] = [];
  const add = (value: unknown, first = false) => {
    if (typeof value !== "string" || !value.trim()) return;
    if (first) {
      if (!prioritized.includes(value)) prioritized.push(value);
      const index = rest.indexOf(value);
      if (index >= 0) rest.splice(index, 1);
      return;
    }
    if (!prioritized.includes(value) && !rest.includes(value)) rest.push(value);
  };
  for (const value of await db.collection("granot_release_reconciliation_cases").distinct("normalized_job_no")) {
    add(value, true);
  }
  for (const value of await db.collection("call_leads").distinct("normalized_job_no")) {
    add(value, true);
  }
  for (const collection of [
    "granot_record_links",
    "booked_leads",
    "granot_booking_reconciliation_cases",
    "form_leads",
  ]) {
    for (const value of await db.collection(collection).distinct("normalized_job_no")) {
      add(value);
    }
  }
  for (const value of await db.collection("granot_observations").distinct("identity.normalized_job_no")) {
    add(value);
  }
  return [...prioritized, ...rest];
}

async function inspectAttentionSourceRows(
  page: JobTimelinePage,
): Promise<Array<{
  code: string;
  event_id: string;
  kind: string;
  status: string | null;
  evidence_refs: number;
}>> {
  if (!("attention" in page) || !Array.isArray(page.attention)) return [];
  const rows: Array<{
    code: string;
    event_id: string;
    kind: string;
    status: string | null;
    evidence_refs: number;
  }> = [];
  for (const item of page.attention) {
    if (item.event_ids.length === 0) {
      rows.push({
        code: item.code,
        event_id: "",
        kind: "none",
        status: null,
        evidence_refs: 0,
      });
      continue;
    }
    for (const eventId of item.event_ids) {
      const event = page.events.find((row) => row.id === eventId);
      const status = event && typeof event.data?.status === "string" ? event.data.status : null;
      rows.push({
        code: item.code,
        event_id: event ? "present" : "missing",
        kind: event?.kind ?? "missing",
        status,
        evidence_refs: event && "evidence" in event && Array.isArray(event.evidence)
          ? event.evidence.length
          : 0,
      });
    }
  }
  return rows;
}

async function runProof(args: readonly string[]): Promise<void> {
  const databaseName = resolveTimelineDatabase(args);
  assertTimelineDatabaseAllowed(databaseName, args);
  const maxJobs = Number(readFlag(args, "--max-jobs") ?? "200");
  const warmRuns = Number(readFlag(args, "--warm-runs") ?? "20");
  const extraJob = readFlag(args, "--job-no");
  await connectMongo();
  const db = await timelineDatabase(mongoose, databaseName);
  const { getRingCentralCollectionName } = await import("../../../../src/services/ringcentral/ringcentral-config.js");
  const collectionNames = proofCollectionNames({
    callLogSyncState: getRingCentralCollectionName("callLogSyncState"),
    processedCalls: getRingCentralCollectionName("processedCalls"),
  });
  const countsBefore = await countProofCollections(db, collectionNames);
  const module = createProductionModule(db);
  const jobNos = await collectDistinctJobNos(db);
  if (extraJob) {
    const normalized = normalizeTypedJobNo(extraJob);
    if (normalized) jobNos.unshift(normalized);
  }

  const aliases = new Map<string, string>();
  const pages: JobTimelinePage[] = [];
  let scanned = 0;
  for (const jobNo of jobNos) {
    if (scanned >= maxJobs) break;
    scanned += 1;
    const result = await module.read(readInput(args, jobNo));
    if (result.status === "ok") pages.push(result.page);
  }

  const notes = pages.map((page) => {
    const alias = aliasJobNumber(page.normalized_job_no, aliases);
    return analyzeProofPage(page, alias);
  });
  const selection = selectProofAliases(notes);
  const selectedAliases = new Set(
    [
      ...Object.values(selection.origin_shapes),
      selection.pre_job_walkback,
      selection.booking_intake_and_official,
      selection.cancellation_intake,
      selection.official_cancellation,
      selection.attention_sample,
    ].filter((value): value is string => Boolean(value)),
  );

  const selectedPages = pages.filter((page) => selectedAliases.has(aliases.get(page.normalized_job_no) ?? ""));
  const timings: number[] = [];
  for (const page of selectedPages) {
    for (let run = 0; run < Math.max(1, warmRuns); run += 1) {
      const started = performance.now();
      await module.read(readInput(args, page.normalized_job_no));
      timings.push(performance.now() - started);
    }
  }
  const warm = timings.slice(selectedPages.length);
  const attentionPage = pages.find((page) => aliases.get(page.normalized_job_no) === selection.attention_sample);
  const attentionInspection = attentionPage ? await inspectAttentionSourceRows(attentionPage) : [];

  const countsAfter = await countProofCollections(db, collectionNames);
  const deltas = collectionCountDeltas(countsBefore, countsAfter);
  const payload = {
    database: databaseName,
    generated_at: new Date().toISOString(),
    read_only: true,
    jobs_seen: jobNos.length,
    jobs_scanned: scanned,
    ok_pages: pages.length,
    selection,
    notes,
    attention_source_rows: attentionInspection,
    collection_counts_before: countsBefore,
    collection_counts_after: countsAfter,
    collection_count_deltas: deltas,
    count_stable: Object.keys(deltas).length === 0,
    forbidden_scan: notes.every((note) => note.forbidden_scan === "pass") ? "pass" : "fail",
    activity_grouping_preserves_counts: notes.every((note) => note.activity_grouping_preserves_counts),
    latency_ms: {
      samples: timings.length,
      warm_samples: warm.length,
      warm_p95: Math.round(percentile(warm.length > 0 ? warm : timings, 95)),
      warm_median: Math.round(percentile(warm.length > 0 ? warm : timings, 50)),
    },
  };
  process.stdout.write(`database: ${databaseName}\n`);
  process.stdout.write(`ok_pages: ${pages.length}\n`);
  process.stdout.write(`count_stable: ${payload.count_stable}\n`);
  process.stdout.write(`forbidden_scan: ${payload.forbidden_scan}\n`);
  process.stdout.write(`warm_p95_ms: ${payload.latency_ms.warm_p95}\n`);
  const filePath = await writeReport("proof", payload);
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
  if (argv.includes("proof")) {
    await runProof(argv);
    return;
  }
  throw new JobTimelineCliError("Expected render, discover, or proof.");
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
