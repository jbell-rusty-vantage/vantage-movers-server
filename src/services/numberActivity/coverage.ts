import mongoose from "mongoose";
import { csiDataset } from "../../config/domain/salesIntelligence";
import { getMongoDatabaseName, isTestMode } from "../../config/domain/runtime";
import { getSalesIntelligenceSyncStateModel } from "../../models/SalesIntelligenceSyncState";
import { coverageDtoSchema, type CoverageDto } from "../salesIntelligence/coverageDto";
import { CALL_LOG_ALL_DIRECTIONS_SCOPE } from "./reconcileCallLog";
import { WEBHOOK_RECEIPTS_SCOPE } from "./webhookFanout";

/**
 * Capture Coverage projection for Owner reads (03 §13 subset, 04 §0).
 *
 * Honest by construction: without a `call_log_all_directions` sync state the
 * watermark is `null` and `call_log` is `unknown`; open gaps are reported as
 * ranges that are "not yet observed", never "no call". Reads only; no upsert, no `$set`.
 * Collection read failures propagate (the route maps them to 500); provider
 * content is never part of the result.
 */
type SyncStateRow = {
  scope: string;
  known_complete_through?: Date | null;
  gaps?: Array<{ from: Date; to: Date; reason: string }>;
  consecutive_failures?: number;
  last_run?: { error_code?: string | null } | null;
  cursor?: { last_sync_to?: Date | null } | null;
};

function streamCapability(
  row: SyncStateRow | null,
  okWhen: (row: SyncStateRow) => boolean,
): "ok" | "unknown" | "unavailable" {
  if (!row) return "unknown";
  const failed = (row.consecutive_failures ?? 0) > 0 || Boolean(row.last_run?.error_code);
  if (failed) return "unavailable";
  return okWhen(row) ? "ok" : "unknown";
}

/**
 * Coverage is a dashboard health strip, not per-row truth, and `ownerRead`
 * wraps it around every Owner payload (number search, Number detail, timeline
 * page, Accounts reads), so it is derived once and stored rather than recounted
 * per read (14 §1).
 *
 * The counters are derived from evidence the Owner is already reading behind a
 * watermark that lags, so a value that lags one short window is honest. The
 * minute job-recovery cron writes that derivation once. Owner reads load the
 * stored projection. Test mode still derives, so a replica proof sees the
 * write it just made, and a read never inserts. The memo collapses concurrent
 * calls inside one process into a single in-flight promise.
 */
const COVERAGE_PROJECTION = "sales_intelligence_coverage_projections";
function coverageCacheTtlMs(): number {
  const raw = process.env.SALES_INTELLIGENCE_COVERAGE_CACHE_MS?.trim();
  if (!raw) return 5_000;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 5_000;
}

type CoverageMemo = { key: string; at: number; value: Promise<CoverageDto> };
let coverageMemo: CoverageMemo | null = null;

/** Test seam and the hook a capture write uses when it must be read back immediately. */
export function resetCaptureCoverageCache(): void {
  coverageMemo = null;
}

function coverageCollection() {
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db;
  if (!db) throw new Error("Database is not connected");
  return db.collection(COVERAGE_PROJECTION);
}

let projectionIndex: Promise<string> | null = null;

function ensureProjectionIndex(): Promise<string> {
  projectionIndex ??= coverageCollection().createIndex(
    { deployment: 1, database: 1 },
    { unique: true, name: "csi_coverage_projection_dataset" },
  );
  return projectionIndex.catch((error: unknown) => {
    projectionIndex = null;
    throw error;
  });
}

async function loadStoredCoverage(): Promise<CoverageDto | null> {
  const dataset = csiDataset();
  const doc = await coverageCollection().findOne(
    { deployment: dataset.deployment, database: dataset.database },
    { projection: { coverage: 1 } },
  );
  const parsed = coverageDtoSchema.safeParse(doc?.coverage);
  return parsed.success ? parsed.data : null;
}

/** Recount and replace the stored projection. Owner reads do not call this. */
export async function refreshCaptureCoverage(): Promise<CoverageDto> {
  const coverage = await deriveCaptureCoverage();
  const dataset = csiDataset();
  await ensureProjectionIndex();
  await coverageCollection().updateOne(
    { deployment: dataset.deployment, database: dataset.database },
    { $set: { coverage, computed_at: new Date() } },
    { upsert: true },
  );
  resetCaptureCoverageCache();
  return coverage;
}

async function resolveCoverage(): Promise<CoverageDto> {
  if (!isTestMode()) {
    const stored = await loadStoredCoverage();
    if (stored) return stored;
  }
  return deriveCaptureCoverage();
}

export async function readCaptureCoverage(): Promise<CoverageDto> {
  const ttl = coverageCacheTtlMs();
  const dataset = csiDataset();
  const key = `${dataset.deployment}:${dataset.database}`;
  if (ttl > 0 && coverageMemo && coverageMemo.key === key && Date.now() - coverageMemo.at < ttl) {
    return coverageMemo.value;
  }
  const value = resolveCoverage();
  if (ttl > 0) {
    const memo: CoverageMemo = { key, at: Date.now(), value };
    coverageMemo = memo;
    // A failed derivation must not be served for the rest of the window.
    value.catch(() => {
      if (coverageMemo === memo) coverageMemo = null;
    });
  }
  return value;
}

async function deriveCaptureCoverage(): Promise<CoverageDto> {
  const SyncState = getSalesIntelligenceSyncStateModel();
  const rows = (await SyncState.find(
    { scope: { $in: [CALL_LOG_ALL_DIRECTIONS_SCOPE, WEBHOOK_RECEIPTS_SCOPE] } },
    { scope: 1, known_complete_through: 1, gaps: 1, consecutive_failures: 1, last_run: 1, cursor: 1 },
  ).lean()) as unknown as SyncStateRow[];
  const callLog = rows.find((row) => row.scope === CALL_LOG_ALL_DIRECTIONS_SCOPE) ?? null;
  const webhook = rows.find((row) => row.scope === WEBHOOK_RECEIPTS_SCOPE) ?? null;
  const knownThrough = callLog?.known_complete_through ?? null;
  return coverageDtoSchema.parse({
    known_through: knownThrough ? knownThrough.toISOString() : null,
    gaps: (callLog?.gaps ?? []).map((gap) => ({
      from: gap.from.toISOString(),
      to: gap.to.toISOString(),
      reason: gap.reason,
    })),
    capabilities: {
      call_log: streamCapability(callLog, (row) => Boolean(row.known_complete_through)),
      webhook: streamCapability(webhook, (row) => Boolean(row.cursor?.last_sync_to)),
    },
  });
}

/** Wraps read data with `as_of` and the current Coverage (`ownerReadSchema` shape). */
export async function ownerRead<T>(
  data: T,
  now?: () => Date,
  capturedCoverage?: CoverageDto,
): Promise<{ as_of: string; coverage: CoverageDto; data: T }> {
  const clock = now ?? (() => new Date());
  const asOf = clock();
  const coverage = capturedCoverage ?? await readCaptureCoverage();
  return { as_of: asOf.toISOString(), coverage, data };
}
