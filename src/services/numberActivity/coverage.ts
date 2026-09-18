import { csiDataset } from "../../config/domain/salesIntelligence";
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
  const Conversations = getLeadConversationModel();
  const [denied, unavailable, stored, mediaPending, missing, failed, undetermined, pendingDiscovery, exhaustedDiscovery, verifiedStored] = await Promise.all([
    Conversations.countDocuments({ availability_reason: "permission_denied", state: "unavailable" }),
    Conversations.countDocuments({ state: "unavailable" }),
    Conversations.countDocuments({ "media.blob_pathname": { $type: "string" }, "media.purged_at": null }),
    Conversations.countDocuments({ state: "discovered" }),
    Conversations.countDocuments({ state: "no_recording" }),
    Conversations.countDocuments({ state: { $in: ["failed", "dead_letter"] } }),
    Conversations.countDocuments({ "analysis_eligibility.status": "undetermined" }),
    getCallInteractionModel().countDocuments({ merged_into_id: null, terminal: true, direction: { $ne: "Internal" }, recordings: { $size: 0 }, "recording_discovery.state": { $ne: "no_recording" } }),
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
