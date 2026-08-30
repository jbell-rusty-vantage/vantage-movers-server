/**
 * PROTOTYPE — read-only lifecycle assurance report.
 *
 * Answers how much of the Lead → message → update → Booking intake → Booking
 * → Cancellation intake → Cancellation → Sheet chain current Mongo evidence can
 * prove, and names the confidence limits.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../../../src/db.js";
import { granotLifecycleOutputDirectory } from "../../../migrations/granot-lifecycle-migration.lib.js";
import {
  assertTimelineDatabaseAllowed,
  PRODUCTION_CONFIRMATION,
  resolveTimelineDatabase,
  timelineDatabase,
} from "../../job-number-timeline/src/load.js";
import { buildAssuranceReport } from "./assure.js";
import { countAssuranceCollections, loadLifecycleEvidence } from "./load.js";
import { renderCanvas, renderMarkdown, validateCanvas } from "./render.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("lifecycle-assurance");
const KNOWN_PREFIXES = ["--hours=", "--from=", "--to=", "--timeline-candidates="];

function flag(args: readonly string[], prefix: string): string | undefined {
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function parseDate(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${name} must be an ISO date`);
  return date;
}

function resolveWindow(args: readonly string[], now: Date): { from: Date; to: Date } {
  const explicitFrom = parseDate(flag(args, "--from="), "--from");
  const explicitTo = parseDate(flag(args, "--to="), "--to");
  if ((explicitFrom && !explicitTo) || (!explicitFrom && explicitTo)) {
    throw new Error("--from and --to must be supplied together");
  }
  if (explicitFrom && explicitTo) {
    if (explicitFrom >= explicitTo) throw new Error("--from must be before --to");
    return { from: explicitFrom, to: explicitTo };
  }
  const hours = Number(flag(args, "--hours=") ?? "24");
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 31) {
    throw new Error("--hours must be greater than 0 and at most 744");
  }
  return { from: new Date(now.valueOf() - hours * 60 * 60 * 1000), to: now };
}

function assertArgs(args: readonly string[]): void {
  const unknown = args.filter((arg) =>
    arg.startsWith("--")
    && arg !== "--"
    && arg !== PRODUCTION_CONFIRMATION
    && !KNOWN_PREFIXES.some((prefix) => arg.startsWith(prefix)),
  );
  if (unknown.length > 0) throw new Error(`Unknown flag(s): ${unknown.join(", ")}`);
}

async function assertReadOnlySource(): Promise<void> {
  const source = await readFile(path.join(__dirname, "load.ts"), "utf8");
  const forbidden = ["insertOne", "insertMany", "updateOne", "updateMany", "deleteOne", "deleteMany", "bulkWrite", "createIndex", ".save("];
  const found = forbidden.filter((token) => source.includes(token));
  if (found.length > 0) throw new Error(`Prototype loader contains forbidden Mongo writes: ${found.join(", ")}`);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  assertArgs(args);
  await assertReadOnlySource();
  const databaseName = resolveTimelineDatabase(args);
  assertTimelineDatabaseAllowed(databaseName, args);
  const generatedAt = new Date();
  const window = resolveWindow(args, generatedAt);
  const timelineCandidateLimit = Number(flag(args, "--timeline-candidates=") ?? "120");
  if (!Number.isInteger(timelineCandidateLimit) || timelineCandidateLimit < 0 || timelineCandidateLimit > 500) {
    throw new Error("--timeline-candidates must be an integer from 0 to 500");
  }

  await connectMongo();
  const db = await timelineDatabase(mongoose, databaseName);
  const countsBefore = await countAssuranceCollections(db);
  const partial = await loadLifecycleEvidence({
    db,
    database: databaseName,
    window,
    generatedAt,
    collectionCountsBefore: countsBefore,
    timelineCandidateLimit,
  });
  const countsAfter = await countAssuranceCollections(db);
  const report = buildAssuranceReport({ ...partial, collection_counts_after: countsAfter });
  const markdown = renderMarkdown(report);
  const canvas = renderCanvas(report);
  validateCanvas(canvas);

  await mkdir(OUTPUT_DIR, { recursive: true });
  const stamp = generatedAt.toISOString().replaceAll(":", "-");
  const artifacts = [
    { name: `assurance-${stamp}.md`, latest: "assurance-latest.md", body: markdown },
    { name: `assurance-${stamp}.json`, latest: "assurance-latest.json", body: `${JSON.stringify(report, null, 2)}\n` },
    { name: `assurance-${stamp}.canvas`, latest: "assurance-latest.canvas", body: `${JSON.stringify(canvas, null, 2)}\n` },
  ];
  for (const artifact of artifacts) {
    await writeFile(path.join(OUTPUT_DIR, artifact.name), artifact.body, { encoding: "utf8", mode: 0o600 });
    await writeFile(path.join(OUTPUT_DIR, artifact.latest), artifact.body, { encoding: "utf8", mode: 0o600 });
  }

  process.stdout.write(`${report.verdict}\n`);
  process.stdout.write(`Granot: ${report.granot.receipts} receipts → ${report.granot.observations} observations → ${report.granot.latest_decisions} latest Decisions\n`);
  process.stdout.write(`Official: ${report.lifecycle.official_bookings} Bookings, ${report.lifecycle.official_cancellations} Cancellations\n`);
  process.stdout.write(`Proof: ${path.join(OUTPUT_DIR, "assurance-latest.md")}\n`);
  process.stdout.write(`Canvas: ${path.join(OUTPUT_DIR, "assurance-latest.canvas")}\n`);
}

if ((process.argv[1] ?? "").replaceAll("\\", "/").endsWith("lifecycle-assurance/src/cli.ts")) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => undefined);
    });
}
