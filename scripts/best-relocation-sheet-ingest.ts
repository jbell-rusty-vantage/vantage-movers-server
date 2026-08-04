import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  applyIngestPlan,
  AUTO_LINK_THRESHOLD,
  BEST_RELOCATION_CUTOFF,
  buildBestRelocationApplicationPlan,
  type ApplyResult,
  buildIngestPlan,
  DEFAULT_MATCH_THRESHOLD,
  DEFAULT_PRODUCTION_BASE_URL,
  readBestRelocationWorkbooks,
  type IngestPlan,
  writeDryRunArtifacts,
} from "../src/services/bestRelocationSheetIngest";

const DEFAULT_OUTPUT_DIRECTORY = path.join(
  process.cwd(),
  "scripts/dev_ops/google_sheets/exports/best-relocation-booked-exploration",
);

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.threshold !== AUTO_LINK_THRESHOLD) {
    throw new Error(
      `The application-owned planner pins the reviewed threshold to ${AUTO_LINK_THRESHOLD}.`,
    );
  }
  if (options.limitBookings !== undefined) {
    throw new Error(
      "--limit-bookings is not supported by the application-owned planner.",
    );
  }
  if (options.apply) {
    throw new Error(
      "CLI live apply is retired. Approve the immutable application-owned run through /api/v1/admin/ingestion.",
    );
  }
  console.log("Reading Best Relocation and Booked Deal workbooks...");
  const sourceReadThrough = new Date();
  const data = await readBestRelocationWorkbooks({
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough,
  });
  const { plan, checksum } = buildBestRelocationApplicationPlan({
    data,
    trigger: "preview",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough,
  });
  await fs.mkdir(options.outputDirectory, { recursive: true, mode: 0o700 });
  const jsonPath = path.join(options.outputDirectory, "ingest-plan.json");
  const summaryPath = path.join(options.outputDirectory, "ingest-plan-summary.json");
  await fs.writeFile(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.writeFile(
    summaryPath,
    `${JSON.stringify(
      {
        plan_checksum: checksum,
        source_read_through: plan.source_read_through,
        counters: plan.counters,
        warnings: plan.warnings,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await fs.writeFile(
    path.join(options.outputDirectory, "ingest-plan.sha256"),
    `${checksum}  ingest-plan.json\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  console.log(JSON.stringify(plan.counters, null, 2));
  console.log(`Plan JSON: ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`Summary:   ${path.relative(process.cwd(), summaryPath)}`);

  console.log(`Canonical plan SHA-256: ${checksum}`);
  console.log("Dry run complete. No HTTP mutations were sent.");
  console.log("Warning: ingest-plan.json contains customer PII; keep it restricted.");
}

function parseArgs(args: string[]): {
  threshold: number;
  apply: boolean;
  confirmProduction?: string;
  planPath?: string;
  planSha256?: string;
  checkpointPath?: string;
  limitBookings?: number;
  outputDirectory: string;
} {
  const configuredThreshold = Number(
    process.env.BR_MATCH_CONFIDENCE_THRESHOLD ?? DEFAULT_MATCH_THRESHOLD,
  );
  let threshold = Number.isFinite(configuredThreshold)
    ? configuredThreshold
    : DEFAULT_MATCH_THRESHOLD;
  let apply = false;
  let confirmProduction: string | undefined;
  let planPath: string | undefined;
  let planSha256: string | undefined;
  let checkpointPath: string | undefined;
  let limitBookings: number | undefined;
  let outputDirectory = DEFAULT_OUTPUT_DIRECTORY;
  for (const arg of args) {
    if (arg === "--" || arg === "--dry-run") continue;
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg.startsWith("--confirm-production=")) {
      confirmProduction = arg.slice("--confirm-production=".length).trim();
      continue;
    }
    if (arg.startsWith("--plan=")) {
      planPath = path.resolve(process.cwd(), arg.slice("--plan=".length));
      continue;
    }
    if (arg.startsWith("--plan-sha256=")) {
      planSha256 = arg.slice("--plan-sha256=".length).trim().toLowerCase();
      continue;
    }
    if (arg.startsWith("--checkpoint=")) {
      checkpointPath = path.resolve(process.cwd(), arg.slice("--checkpoint=".length));
      continue;
    }
    if (arg.startsWith("--threshold=")) {
      threshold = Number(arg.slice("--threshold=".length));
      continue;
    }
    if (arg.startsWith("--limit-bookings=")) {
      limitBookings = Number(arg.slice("--limit-bookings=".length));
      if (!Number.isInteger(limitBookings) || limitBookings < 1) {
        throw new Error("--limit-bookings must be a positive integer");
      }
      continue;
    }
    if (arg.startsWith("--output=")) {
      outputDirectory = path.resolve(process.cwd(), arg.slice("--output=".length));
      const relative = path.relative(DEFAULT_OUTPUT_DIRECTORY, outputDirectory);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(
          `--output must stay under ${path.relative(process.cwd(), DEFAULT_OUTPUT_DIRECTORY)}`,
        );
      }
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return {
    threshold,
    apply,
    confirmProduction,
    planPath,
    planSha256,
    checkpointPath,
    limitBookings,
    outputDirectory,
  };
}

async function applyReviewedPlan(options: ReturnType<typeof parseArgs>): Promise<void> {
  const expectedHost = "vantage-movers-main-server.vercel.app";
  if (options.confirmProduction !== expectedHost) {
    throw new Error(`Live apply requires --confirm-production=${expectedHost}`);
  }
  if (!options.planPath || !options.planSha256) {
    throw new Error("Live apply requires --plan=<ingest-plan.json> and --plan-sha256=<hash>");
  }
  if (!/^[a-f0-9]{64}$/.test(options.planSha256)) {
    throw new Error("--plan-sha256 must be a 64-character SHA-256 hex digest");
  }
  const planBytes = await fs.readFile(options.planPath);
  const actualHash = sha256(planBytes);
  if (actualHash !== options.planSha256) {
    throw new Error(
      `Reviewed plan hash mismatch: expected ${options.planSha256}, got ${actualHash}`,
    );
  }
  const plan = JSON.parse(planBytes.toString("utf8")) as IngestPlan;
  if (!Array.isArray(plan.mutations) || plan.version !== 1) {
    throw new Error("Reviewed plan has an unsupported shape or version");
  }
  const checkpointPath =
    options.checkpointPath ?? `${options.planPath}.apply-progress.json`;
  const initialResults = await readCheckpoint(checkpointPath, actualHash);
  console.log(
    `Applying reviewed plan ${actualHash} to ${plan.base_url}; resuming after ${initialResults.length} completed mutation(s)...`,
  );
  const results = await applyIngestPlan(plan, {
    confirmProductionApply: true,
    initialResults,
    onProgress: async (progress) => {
      await writeCheckpoint(checkpointPath, actualHash, progress);
    },
  });
  const created = results.filter((result) => result.status === "created").length;
  const existing = results.length - created;
  console.log(`Apply complete: created=${created}, existing/skipped=${existing}`);
  console.log(`Checkpoint: ${path.relative(process.cwd(), checkpointPath)}`);
}

async function readCheckpoint(
  checkpointPath: string,
  planHash: string,
): Promise<ApplyResult[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(checkpointPath, "utf8")) as {
      plan_sha256?: unknown;
      results?: unknown;
    };
    if (parsed.plan_sha256 !== planHash || !Array.isArray(parsed.results)) {
      throw new Error("Checkpoint does not belong to the reviewed plan");
    }
    return parsed.results as ApplyResult[];
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw error;
  }
}

async function writeCheckpoint(
  checkpointPath: string,
  planHash: string,
  results: ApplyResult[],
): Promise<void> {
  const temporaryPath = `${checkpointPath}.tmp`;
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify(
      { plan_sha256: planHash, updated_at: new Date().toISOString(), results },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await fs.rename(temporaryPath, checkpointPath);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function printSummary(plan: ReturnType<typeof buildIngestPlan>): void {
  console.log(
    JSON.stringify(
      {
        threshold: plan.threshold,
        source_rows: {
          forms: plan.summary.forms,
          local_forms: plan.summary.local_forms,
          calls: plan.summary.calls,
          booking_rows: plan.summary.booking_rows,
          refunds: plan.summary.refunds,
        },
        booking_jobs: plan.summary.booking_jobs,
        accepted_matches: plan.summary.accepted_booking_matches,
        leadless_bookings: plan.summary.leadless_bookings,
        unmatched_refunds: plan.summary.unmatched_refunds,
        mutations: plan.summary.mutations,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
