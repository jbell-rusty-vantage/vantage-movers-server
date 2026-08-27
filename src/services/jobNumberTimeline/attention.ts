import { officialFactsContradict } from "./outcome.js";
import type { JobTimelineRows } from "./rows.js";
import type {
  EnhancedJobTimelineEvent,
  EnhancedJobTimelinePage,
  JobTimelinePage,
  TimelineAttention,
  TimelineAttentionCode,
  TimelineLimitation,
  TimelineLimitationCode,
} from "./types.js";

export const SHEET_SYNC_PENDING_TOO_LONG_MS = 60 * 60 * 1000;

const LIVE_SHEET_STATUSES = new Set(["pending", "retrying", "processing"]);
const APPLIED_DECISION_OUTCOMES = new Set(["applied", "created"]);
const CREATE_COMMANDS = new Set(["createFormLead", "createCallLead", "createLeadFromGranot"]);
const LEAD_WRITE_REASONS = new Set([
  "lead_synchronized",
  "priority_updated",
  "lead_created",
  "lead_state_changed",
]);
const LEAD_WRITE_EFFECTS = new Set(["lead_updated", "lead_state_changed"]);

function item(
  code: TimelineAttentionCode,
  label: string,
  event_ids: string[],
): TimelineAttention {
  return { code, reason_code: code, label, event_ids };
}

function limitation(
  code: TimelineLimitationCode,
  label: string,
  event_ids: string[],
): TimelineLimitation {
  return { code, reason_code: code, label, event_ids };
}

function idsForKind(events: EnhancedJobTimelineEvent[], kind: EnhancedJobTimelineEvent["kind"]): string[] {
  return events.filter((event) => event.kind === kind).map((event) => event.id);
}

function sheetAgeMs(event: EnhancedJobTimelineEvent, now: Date): number {
  const requested = typeof event.data.requested_at === "string" ? event.data.requested_at : event.event_at;
  const started = Date.parse(requested);
  if (Number.isNaN(started)) return 0;
  return now.getTime() - started;
}

function evaluateLeadUnresolved(coverage: JobTimelinePage["coverage"], events: EnhancedJobTimelineEvent[]): TimelineAttention | null {
  if (coverage.lead !== "unresolved") return null;
  return item(
    "LEAD_UNRESOLVED",
    "Job-scoped facts exist but no Lead can be safely resolved.",
    events.filter((event) => event.stage === "origin" || event.stage === "processing").map((event) => event.id),
  );
}

function evaluateBookingCaseResolvedWithoutFact(
  coverage: JobTimelinePage["coverage"],
  events: EnhancedJobTimelineEvent[],
): TimelineAttention | null {
  if (coverage.official_booking || coverage.booking_intake !== "resolved") return null;
  return item(
    "BOOKING_CASE_RESOLVED_WITHOUT_FACT",
    "A resolved Booking case lacks an official Booking.",
    idsForKind(events, "booking_intake"),
  );
}

function evaluateCancellationCaseResolvedWithoutFact(
  coverage: JobTimelinePage["coverage"],
  events: EnhancedJobTimelineEvent[],
): TimelineAttention | null {
  if (coverage.official_cancellation || coverage.cancellation_intake !== "resolved") return null;
  return item(
    "CANCELLATION_CASE_RESOLVED_WITHOUT_FACT",
    "A resolved Cancellation case lacks an official Cancellation.",
    idsForKind(events, "cancellation_intake"),
  );
}

function hasDurableSnapshot(row: { job_no_snapshot?: string | null; normalized_job_no_snapshot?: string | null }): boolean {
  return Boolean(row.normalized_job_no_snapshot || row.job_no_snapshot);
}

function evaluateOrphanCancellationReference(
  rows: JobTimelineRows,
  events: EnhancedJobTimelineEvent[],
): TimelineAttention | null {
  const bookingIds = new Set((rows.bookings ?? []).map((row) => row.id));
  const orphans = (rows.cancellations ?? []).filter((row) =>
    !bookingIds.has(row.booked_lead ?? "") && !hasDurableSnapshot(row),
  );
  if (orphans.length === 0) return null;
  return item(
    "ORPHAN_CANCELLATION_REFERENCE",
    "A Cancellation references a missing Booking and lacks a durable Job snapshot.",
    [
      ...idsForKind(events, "cancellation_intake"),
      ...idsForKind(events, "official_cancellation"),
    ],
  );
}

function evaluateSheetSyncPendingTooLong(
  events: EnhancedJobTimelineEvent[],
  now: Date,
  thresholdMs: number,
): TimelineAttention | null {
  const stale = events.filter((event) =>
    event.kind === "sheet_sync"
    && LIVE_SHEET_STATUSES.has(String(event.data.status ?? ""))
    && sheetAgeMs(event, now) > thresholdMs,
  );
  if (stale.length === 0) return null;
  return item(
    "SHEET_SYNC_PENDING_TOO_LONG",
    "A live Sheet Sync job exceeds the configured age threshold.",
    stale.map((event) => event.id),
  );
}

function evaluateSheetSyncTerminalFailure(events: EnhancedJobTimelineEvent[]): TimelineAttention | null {
  const failed = events.filter((event) =>
    event.kind === "sheet_sync" && String(event.data.status ?? "") === "failed",
  );
  if (failed.length === 0) return null;
  return item(
    "SHEET_SYNC_TERMINAL_FAILURE",
    "A relevant Sheet Sync job is terminally failed.",
    failed.map((event) => event.id),
  );
}

function evaluateContradictoryOfficialState(events: EnhancedJobTimelineEvent[]): TimelineAttention | null {
  if (!officialFactsContradict(events)) return null;
  return item(
    "CONTRADICTORY_OFFICIAL_STATE",
    "Official facts or their clocks cannot produce one coherent outcome.",
    [
      ...idsForKind(events, "official_booking"),
      ...idsForKind(events, "official_cancellation"),
    ],
  );
}

function evaluateSourceScopeConflict(
  page: JobTimelinePage,
  rows: JobTimelineRows,
  events: EnhancedJobTimelineEvent[],
): TimelineAttention | null {
  const ids = new Set<string>();
  if (page.source.source_granularity_id) {
    ids.add(page.source.source_granularity_id);
  }
  const keptDecisionIds = new Set(
    events
      .filter((event) => event.kind === "synchronization_decision")
      .map((event) => String(event.data.decision_id ?? "")),
  );
  for (const decision of rows.decisions ?? []) {
    if (!keptDecisionIds.has(decision.id)) continue;
    const granularity = decision.source_granularity_id ?? decision.source_scope?.source_granularity_id;
    if (granularity) ids.add(granularity);
  }
  for (const link of rows.record_links ?? []) {
    if (link.state === "active" && link.source_granularity_id) {
      ids.add(link.source_granularity_id);
    }
  }
  if (ids.size <= 1) return null;
  return item(
    "SOURCE_SCOPE_CONFLICT",
    "Resolved source scopes disagree.",
    events
      .filter((event) => event.kind === "lead_created" || event.kind === "synchronization_decision")
      .map((event) => event.id),
  );
}

function decisionRequiresLeadChange(decision: {
  outcome?: string;
  reason_code?: string;
  effect_kinds?: string[];
  target?: { model: string; id: string };
}): boolean {
  if (!APPLIED_DECISION_OUTCOMES.has(decision.outcome ?? "")) return false;
  const model = decision.target?.model;
  if (model !== "FormLead" && model !== "CallLead") return false;
  if (decision.outcome === "created") return true;
  if (LEAD_WRITE_REASONS.has(decision.reason_code ?? "")) return true;
  return (decision.effect_kinds ?? []).some((kind) => LEAD_WRITE_EFFECTS.has(kind));
}

function evaluateProcessingEvidenceGap(
  rows: JobTimelineRows,
  events: EnhancedJobTimelineEvent[],
): TimelineAttention | null {
  const changes = rows.entity_changes ?? [];
  const keptDecisionIds = new Set(
    events
      .filter((event) => event.kind === "synchronization_decision")
      .map((event) => String(event.data.decision_id ?? "")),
  );
  const gapIds: string[] = [];
  for (const decision of rows.decisions ?? []) {
    if (!keptDecisionIds.has(decision.id)) continue;
    if (!decisionRequiresLeadChange(decision) || !decision.target) continue;
    const targetChanges = changes.filter((row) =>
      (row.entity_id || row.entity?.id) === decision.target?.id
      && (row.entity_model || row.entity?.model) === decision.target?.model,
    );
    const satisfied = decision.outcome === "created"
      ? targetChanges.some((row) => CREATE_COMMANDS.has(row.command_name))
      : targetChanges.some((row) => row.applied_at === decision.decided_at);
    if (!satisfied) {
      const event = events.find((row) => row.data.decision_id === decision.id);
      if (event) gapIds.push(event.id);
    }
  }
  if (gapIds.length === 0) return null;
  return item(
    "PROCESSING_EVIDENCE_GAP",
    "A claimed applied Decision lacks its required EntityChange.",
    gapIds,
  );
}

export function evaluateAttention(input: {
  page: JobTimelinePage;
  events: EnhancedJobTimelineEvent[];
  rows: JobTimelineRows;
  now: Date;
  pendingTooLongMs?: number;
}): TimelineAttention[] {
  const threshold = input.pendingTooLongMs ?? SHEET_SYNC_PENDING_TOO_LONG_MS;
  return [
    evaluateLeadUnresolved(input.page.coverage, input.events),
    evaluateBookingCaseResolvedWithoutFact(input.page.coverage, input.events),
    evaluateCancellationCaseResolvedWithoutFact(input.page.coverage, input.events),
    evaluateOrphanCancellationReference(input.rows, input.events),
    evaluateSheetSyncPendingTooLong(input.events, input.now, threshold),
    evaluateSheetSyncTerminalFailure(input.events),
    evaluateContradictoryOfficialState(input.events),
    evaluateSourceScopeConflict(input.page, input.rows, input.events),
    evaluateProcessingEvidenceGap(input.rows, input.events),
  ].filter((row): row is TimelineAttention => row !== null);
}

function evaluateWordpressReceiptUnavailable(
  page: JobTimelinePage,
  events: EnhancedJobTimelineEvent[],
): TimelineLimitation | null {
  if (page.proof_shape !== "wordpress_born") return null;
  if (events.some((event) => event.kind === "source_received")) return null;
  return limitation(
    "WORDPRESS_RECEIPT_UNAVAILABLE",
    "Lead creation is recorded; independent WordPress submission receipt is unavailable.",
    idsForKind(events, "lead_created"),
  );
}

function evaluateRingcentralCursorBounded(
  page: JobTimelinePage,
  events: EnhancedJobTimelineEvent[],
  coveredThrough: string | null,
): TimelineLimitation | null {
  if (page.proof_shape !== "ringcentral_born") return null;
  const event_ids = events
    .filter((event) => event.kind === "source_received" && event.data.ingress === "ringcentral")
    .map((event) => event.id);
  return limitation(
    "RINGCENTRAL_CURSOR_BOUNDED",
    coveredThrough
      ? "Call completeness is valid only through the last successful provider cursor."
      : "Call completeness is bounded by the RingCentral provider cursor, which is not present on this page.",
    event_ids,
  );
}

function evaluateGoogleDestinationUnverified(events: EnhancedJobTimelineEvent[]): TimelineLimitation {
  return limitation(
    "GOOGLE_DESTINATION_UNVERIFIED",
    "Sheet Sync completion is not current Google destination equality.",
    idsForKind(events, "sheet_sync"),
  );
}

function evaluateMoveCompletionUnavailable(): TimelineLimitation {
  return limitation(
    "MOVE_COMPLETION_UNAVAILABLE",
    "No move-completion system-of-record fact exists.",
    [],
  );
}

function evaluateMultiQueryRead(): TimelineLimitation {
  return limitation(
    "MULTI_QUERY_READ",
    "This page is assembled across multiple reads, not one database snapshot.",
    [],
  );
}

export function evaluateLimitations(input: {
  page: JobTimelinePage;
  events: EnhancedJobTimelineEvent[];
  existing: TimelineLimitation[];
  ringcentral_covered_through: string | null;
}): TimelineLimitation[] {
  return [
    ...input.existing.filter((row) => row.code === "TIMELINE_TRUNCATED"),
    evaluateMultiQueryRead(),
    evaluateMoveCompletionUnavailable(),
    evaluateGoogleDestinationUnverified(input.events),
    evaluateWordpressReceiptUnavailable(input.page, input.events),
    evaluateRingcentralCursorBounded(input.page, input.events, input.ringcentral_covered_through),
  ].filter((row): row is TimelineLimitation => row !== null);
}

export function evaluateFreshness(input: {
  assembled_at: string;
  rows: JobTimelineRows;
}): EnhancedJobTimelinePage["freshness"] {
  const covered = input.rows.call_log_cursor?.lastSyncTo ?? null;
  let lag: number | null = null;
  if (covered) {
    const coveredMs = Date.parse(covered);
    const assembledMs = Date.parse(input.assembled_at);
    if (!Number.isNaN(coveredMs) && !Number.isNaN(assembledMs)) {
      lag = Math.max(0, Math.floor((assembledMs - coveredMs) / 1000));
    }
  }
  return {
    mongo_read_at: input.assembled_at,
    consistency: "multi_query_best_effort",
    ringcentral_covered_through: covered,
    ringcentral_cursor_lag_seconds: lag,
    google_destination_readback: "not_performed",
  };
}

export function hasProcessingEvidenceGap(input: {
  rows: JobTimelineRows;
  events: EnhancedJobTimelineEvent[];
}): boolean {
  return evaluateProcessingEvidenceGap(input.rows, input.events) !== null;
}
