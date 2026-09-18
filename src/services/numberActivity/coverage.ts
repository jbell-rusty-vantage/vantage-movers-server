import { csiDataset } from "../../config/domain/salesIntelligence";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
import { getSalesIntelligenceSyncStateModel } from "../../models/SalesIntelligenceSyncState";
import { coverageDtoSchema, type CoverageDto } from "../salesIntelligence/dto";
import { CALL_LOG_ALL_DIRECTIONS_SCOPE } from "./reconcileCallLog";
import { WEBHOOK_RECEIPTS_SCOPE } from "./webhookFanout";

/**
 * Capture Coverage projection for Owner reads (03 §13 subset, 04 §0).
 *
 * Honest by construction: without a `call_log_all_directions` sync state the
 * watermark is `null` and `call_log` is `unknown`; open gaps are reported as
 * ranges that are "not yet observed", never "no call". `recording_content`
 * stays `unknown` until CSI-11 proves it. Reads only; no upsert, no `$set`.
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

export async function readCaptureCoverage(): Promise<CoverageDto> {
  const SyncState = getSalesIntelligenceSyncStateModel();
  const rows = (await SyncState.find(
    { scope: { $in: [CALL_LOG_ALL_DIRECTIONS_SCOPE, WEBHOOK_RECEIPTS_SCOPE] } },
    { scope: 1, known_complete_through: 1, gaps: 1, consecutive_failures: 1, last_run: 1, cursor: 1 },
  ).lean()) as unknown as SyncStateRow[];
  const callLog = rows.find((row) => row.scope === CALL_LOG_ALL_DIRECTIONS_SCOPE) ?? null;
  const webhook = rows.find((row) => row.scope === WEBHOOK_RECEIPTS_SCOPE) ?? null;
  const knownThrough = callLog?.known_complete_through ?? null;

  const paused = await getSalesIntelligenceJobModel().countDocuments({
    ...csiDataset(),
    status: "paused",
    reason: "budget_exhausted",
  });

  return coverageDtoSchema.parse({
    known_through: knownThrough ? knownThrough.toISOString() : null,
    gaps: (callLog?.gaps ?? []).map((gap) => ({
      from: gap.from.toISOString(),
      to: gap.to.toISOString(),
      reason: gap.reason,
    })),
    capabilities: {
      call_log: streamCapability(callLog, (row) => Boolean(row.known_complete_through)),
      recording_content: "unknown",
      webhook: streamCapability(webhook, (row) => Boolean(row.cursor?.last_sync_to)),
    },
    ai_paused: paused > 0,
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
