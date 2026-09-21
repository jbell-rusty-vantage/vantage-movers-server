import mongoose from "mongoose";
import { csiDataset } from "../../config/domain/salesIntelligence";
import { getMongoDatabaseName, isTestMode } from "../../config/domain/runtime";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
import { getSalesIntelligenceSyncStateModel } from "../../models/SalesIntelligenceSyncState";
import { getLeadConversationModel } from "../../models/LeadConversation";
import { getCallInteractionModel } from "../../models/CallInteraction";
import { coverageDtoSchema, type CoverageDto } from "../salesIntelligence/dto";
import { CALL_LOG_ALL_DIRECTIONS_SCOPE } from "./reconcileCallLog";
import { WEBHOOK_RECEIPTS_SCOPE } from "./webhookFanout";

/**
 * Capture Coverage projection for Owner reads (03 §13 subset, 04 §0).
 *
 * Honest by construction: without a `call_log_all_directions` sync state the
 * watermark is `null` and `call_log` is `unknown`; open gaps are reported as
 * ranges that are "not yet observed", never "no call". CSI-11 recording
 * capability derives from stored outcomes, never from seed audio alone. Reads only; no upsert, no `$set`.
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
 * wraps it around every Owner payload: one number search, one timeline page,
 * one Attention GET and one Outreach detail each used to pay the same
 * thirteen-query tax, and a single paginated analysis preflight multiplied it
 * by the page count (14 §1).
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

  // Either admission pause means analysis is not running; the Owner coverage
  // read explains which one and with which numbers (`analysis_admission`).
  const paused = await getSalesIntelligenceJobModel().countDocuments({
    ...csiDataset(),
    status: "paused",
    reason: { $in: ["budget_exhausted", "per_recording_ceiling"] },
  });
  const Conversations = getLeadConversationModel();
  const [denied, unavailable, stored, mediaPending, missing, failed, undetermined, pendingDiscovery, exhaustedDiscovery, verifiedStored] = await Promise.all([
    Conversations.countDocuments({ availability_reason: "permission_denied", state: "unavailable" }),
    Conversations.countDocuments({ state: "unavailable" }),
    Conversations.countDocuments({ "media.blob_pathname": { $type: "string" }, "media.purged_at": null }),
    Conversations.countDocuments({ state: "discovered" }),
    Conversations.countDocuments({ state: "no_recording" }),
    Conversations.countDocuments({ state: { $in: ["failed", "dead_letter"] } }),
    Conversations.countDocuments({ "analysis_eligibility.status": "undetermined" }),
    // `recordings: { $size: 0 }` can never use an index; `recordings.0` can,
    // and `call_interaction_discovery_state` serves the rest of the predicate.
    getCallInteractionModel().countDocuments({ merged_into_id: null, terminal: true, "recordings.0": { $exists: false }, direction: { $ne: "Internal" }, "recording_discovery.state": { $ne: "no_recording" } }),
    getCallInteractionModel().countDocuments({ merged_into_id: null, "recording_discovery.state": "no_recording" }),
    Conversations.countDocuments({ call_interaction_id: { $ne: null }, provider_account_id: { $type: "string" }, media_digest_sha256: { $type: "string" }, "media.blob_pathname": { $type: "string" }, "media.purged_at": null }),
  ]);

  return coverageDtoSchema.parse({
    known_through: knownThrough ? knownThrough.toISOString() : null,
    gaps: (callLog?.gaps ?? []).map((gap) => ({
      from: gap.from.toISOString(),
      to: gap.to.toISOString(),
      reason: gap.reason,
    })),
    capabilities: {
      call_log: streamCapability(callLog, (row) => Boolean(row.known_complete_through)),
      recording_content: denied ? "denied" : unavailable || failed ? "unavailable" : verifiedStored ? "ok" : "unknown",
      webhook: streamCapability(webhook, (row) => Boolean(row.cursor?.last_sync_to)),
    },
    ai_paused: paused > 0,
    recordings: { pending_discovery: pendingDiscovery, media_pending: mediaPending, media_stored: stored,
      no_recording: missing + exhaustedDiscovery, unavailable, failed, eligibility_undetermined: undetermined },
  });
}

/** Wraps read data with `as_of` and the current Coverage (`ownerReadSchema` shape). */
export async function ownerRead<T>(
  data: T,
  now?: () => Date,
): Promise<{ as_of: string; coverage: CoverageDto; data: T }> {
  const clock = now ?? (() => new Date());
  const asOf = clock();
  const coverage = await readCaptureCoverage();
  return { as_of: asOf.toISOString(), coverage, data };
}
