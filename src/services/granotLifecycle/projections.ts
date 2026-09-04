import {
  getGranotLifecycleFlags,
  GRANOT_LIFECYCLE_ALERT_THRESHOLDS,
  GRANOT_LIFECYCLE_FLAG_NAMES,
  type GranotLifecycleFlags,
} from "../../config/domain/granotLifecycle";
import { getGranotLifecycleActivationModel } from "../../models/GranotLifecycleActivation";
import { getGranotBookingReconciliationCaseModel } from "../../models/GranotBookingReconciliationCase";
import { getGranotReleaseReconciliationCaseModel } from "../../models/GranotReleaseReconciliationCase";
import { getGranotBookingDiscrepancyModel } from "../../models/GranotBookingDiscrepancy";
import { getGranotReleaseDiscrepancyModel } from "../../models/GranotReleaseDiscrepancy";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { getOperationalEventModel } from "../../models/OperationalEvent";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { getEntityChangeModel } from "../../models/EntityChange";
import { BookedLead } from "../../models/BookedLead";
import { Merchant } from "../../models/Merchant";
import { CancelledLead } from "../../models/CancelledLead";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { getFormLeadModel } from "../../models/FormLead";
import { getCallLeadModel } from "../../models/CallLead";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { RECEIPT_WORK_STATES } from "../../models/granotLifecycleSchemas";
import { applyDueGauges } from "./drainer";
import { getCallLogSyncState } from "../ringcentral/call-log-sync-state.store";
import {
  evaluateGranotLifecycleAlerts,
  persistGranotLifecycleAlertTransitions,
  type GranotLifecycleAlertProjection,
} from "./alerts";
import {
  GRANOT_LIFECYCLE_CASE_MODES,
  GRANOT_LIFECYCLE_DISCREPANCY_REASON_CODES,
  setGranotLifecycleOpenCases,
  setGranotLifecycleOpenDiscrepancies,
  type GranotLifecycleCaseMode,
} from "./metrics";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import mongoose from "mongoose";
import { toObjectId } from "../../utils/objectId";
import {
  projectBookingCandidateBrowserPolicy,
  searchBookingLeadCandidates,
  type BookingLeadCandidateProjection,
} from "./bookingReconciliation";
import {
  projectBookingPriorityPairing,
  toBookingPriorityPairingProjection,
  toListPriorityPairing,
  type BookingPriorityPairingListItem,
  type BookingPriorityPairingProjection,
} from "./bookingPriorityPairing";
import { selectCreatingObservationEvidence } from "./creatingObservation";
import {
  selectBookingIntakeLatestAction,
  type BookingIntakeLatestAction,
  type BookingIntakeLatestActionEvidence,
} from "./bookingIntakeLatestAction";
import { compareGranotTemporal } from "./granotTemporal";
import type { GranotBookingReconciliationCaseDocument } from "../../models/GranotBookingReconciliationCase";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import {
  GRANOT_LIFECYCLE_ERROR_CODES,
  GranotLifecycleError,
} from "./errors";
import type {
  EntityRef,
  ExecutionMode,
  GranotBookingAction,
  GranotObservationKind,
  NormalizationIssueCode,
  NormalizationResult,
  ReceiptWorkState,
  GranotDiscrepancyReasonCode,
  SynchronizationOutcome,
  SynchronizationReasonCode,
} from "./types";
import type {
  GranotLifecycleCandidateQuery,
  GranotLifecycleCaseListQuery,
  GranotLifecycleConnectLeadCandidateQuery,
  GranotLifecycleTimelineQuery,
} from "../../validation/v1/granotLifecycle.validation";
import {
  bookingSourceAssignment,
  isConnectableLeadlessBooking,
  leadMatchesBookingSource,
} from "./connectLead";
import {
  CALL_LEAD_CONTACT_EMAIL_PATHS,
  CALL_LEAD_CONTACT_NAME_PATHS,
  CALL_LEAD_CONTACT_PHONE_PATHS,
  FORM_LEAD_CONTACT_EMAIL_PATHS,
  FORM_LEAD_CONTACT_NAME_PATHS,
  FORM_LEAD_CONTACT_PHONE_PATHS,
} from "../search/leadBrowseShared";

export const DEFAULT_TIMELINE_LIMIT = 100;
export const JOB_PROJECTION_LIMIT = DEFAULT_TIMELINE_LIMIT;

export type SafeRecordLinkProjection = {
  id: string;
  state: "active" | "superseded";
  disputed: boolean;
  source_scope?: { lead_source_company: string; source_granularity_id: string };
  lead_ref?: EntityRef;
  booking_ref?: string;
  domain_revision: number;
};

export type SafeBookingProjection = {
  id: string;
  normalized_job_no: string;
  job_no: string | null;
  book_date: string;
  /** Masked for lifecycle/Admin transport; never the raw Booking customer name. */
  customer_name: string | null;
  source: string;
  merchant: string;
  merchant_id?: string;
  deposit_amount: number;
  total_binder_amount: number;
  agent_allocations: Array<{ agent_id: string; agent_name: string; binder_amount: number }>;
  domain_revision: number;
  lead_ref?: EntityRef;
};

export type SafeCancellationProjection = {
  id: string;
  booking_id: string;
  cancel_date: string;
  refund_amount: number;
  domain_revision: number;
};

type TimelineEntry<T extends string, P extends number, D> = {
  id: string;
  type: T;
  event_at: string;
  type_priority: P;
  data: D;
};

export type GranotTimelineEntry =
  | TimelineEntry<"observation", 10, {
      observation_id: string;
      receipt_id: string;
      normalization_result: NormalizationResult;
      issue_codes: NormalizationIssueCode[];
    }>
  | TimelineEntry<"priority_effect", 20, {
      observation_id: string;
      decision_id?: string;
      canonical_priority: string;
      changed_paths: string[];
    }>
  | TimelineEntry<"booking_action", 30, {
      observation_id: string;
      decision_id?: string;
      action: GranotBookingAction;
    }>
  | TimelineEntry<"decision", 40, {
      decision_id: string;
      observation_id: string;
      execution_mode: ExecutionMode;
      outcome: SynchronizationOutcome;
      reason_code: SynchronizationReasonCode;
      target?: EntityRef;
      effects: Array<{ kind: string; ref?: EntityRef; changed_paths?: string[] }>;
    }>
  | TimelineEntry<"case", 50, {
      case_id: string;
      kind: "booking" | "release";
      event: "opened" | "refreshed" | "resolved";
      state: "open" | "resolved";
      mode: string;
      sequence_number: number;
      case_revision: number;
      evidence_revision: number;
      observation_id?: string;
    }>
  | TimelineEntry<"discrepancy", 60, {
      discrepancy_id: string;
      kind: "booking" | "release";
      state: "open" | "resolved";
      reason_code: string;
    }>
  | TimelineEntry<"record_link_change", 70, {
      record_link_id: string;
      event: "established" | "refreshed" | "corrected" | "superseded";
      domain_revision: number;
      lead_ref?: EntityRef;
      booking_ref?: string;
    }>
  | TimelineEntry<"entity_change", 80, {
      change_id: string;
      entity: EntityRef;
      command_execution_id: string;
      revision_before: number;
      revision_after: number;
      changed_paths: string[];
    }>
  | TimelineEntry<"official_booking", 90, {
      booking_id: string;
      normalized_job_no: string;
      domain_revision: number;
      cancellation_id?: string;
    }>
  | TimelineEntry<"official_cancellation", 100, {
      cancellation_id: string;
      booking_id: string;
      domain_revision: number;
    }>;

export type GranotTimelinePage = {
  items: GranotTimelineEntry[];
  next_cursor: string | null;
  current: {
    record_link?: SafeRecordLinkProjection;
    booking?: SafeBookingProjection;
    cancellation?: SafeCancellationProjection;
  };
  capabilities: {
    booking_cases: boolean;
    release_cases: boolean;
    discrepancies: boolean;
    official_facts: true;
  };
};

export type GranotLifecycleCaseListItem = {
  case_id: string;
  kind: "booking" | "release";
  state: "open" | "resolved";
  mode: string;
  sequence_number: number;
  normalized_job_no: string;
  job_no: string;
  source?: { id?: string; label?: string };
  customer_label: string;
  latest_action: "priority_5" | "booked" | "release";
  evidence_count: number;
  case_revision: number;
  evidence_revision: number;
  deterministic_booking: { present: boolean; masked_ref?: string };
  opened_at: string;
  last_evidence_at: string;
  resolved_at?: string;
  priority_pairing?: BookingPriorityPairingListItem;
};

export type { BookingPriorityPairingListItem, BookingPriorityPairingProjection };

export type GranotLifecycleCaseListPage = {
  items: GranotLifecycleCaseListItem[];
  next_cursor: string | null;
};

export type GranotLifecycleCaseDetail = {
  case_id: string;
  kind: "booking" | "release";
  state: "open" | "resolved";
  mode: string;
  sequence_number: number;
  case_revision: number;
  evidence_revision: number;
  normalized_job_no: string;
  job_no: string;
  opened_at: string;
  last_evidence_at: string;
  resolved_at?: string;
  source_scope?: {
    granot_crm_source_id: string;
    lead_source_company: string;
    source_granularity_id: string;
  };
  source?: { id?: string; label?: string };
  evidence: Array<{
    observation_id: string;
    decision_id: string;
    captured_at: string;
    action: "priority_5" | "booked" | "release";
    normalization_result?: NormalizationResult;
    decision_outcome?: SynchronizationOutcome;
    decision_reason_code?: SynchronizationReasonCode;
  }>;
  observed_context: {
    section_label: "Granot evidence — not official Vantage values";
    contact?: { name?: string; phone_number?: string; email?: string };
    move_date?: string;
    estimated_cubic_feet?: number;
    estimate?: string;
    payment?: string;
    balance?: string;
    granot_priority?: string;
    granot_username?: string;
  };
  contacts: {
    submitted_or_ingested?: { name?: string; phone_number?: string; email?: string };
    accepted_granot?: { name?: string; phone_number?: string; email?: string };
  };
  suggestion?: {
    lead_ref: EntityRef;
    confidence: "high" | "medium";
    match_method: string;
    reason_codes: string[];
  };
  candidate_search: { available: boolean; default_scope: "source"; all_scope_warning: boolean };
  record_link?: SafeRecordLinkProjection;
  official_current: {
    booking?: SafeBookingProjection;
    cancellation?: SafeCancellationProjection;
  };
  official_draft: Record<string, never>;
  employee_booking_lead_reconciliation?: {
    case_id: string;
    status: string;
    href: string;
  };
  timeline: GranotTimelinePage;
  latest_action: "priority_5" | "booked" | "release";
  capabilities: {
    commands: boolean;
    referral: boolean;
    confirm_cancellation: boolean;
    release_cases: boolean;
    discrepancies: boolean;
  };
  priority_pairing: BookingPriorityPairingProjection | null;
};

export type CandidateKnownContact = {
  name?: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  email?: string;
};

export type CandidateKnownGranotContact = CandidateKnownContact & {
  differs_from_ingested: boolean;
  captured_at?: string;
};

export type CandidateKnownContacts = {
  form_submitted: CandidateKnownContact;
  granot?: CandidateKnownGranotContact;
};

export type GranotLifecycleCandidateItem = {
  lead_ref: EntityRef;
  customer_label: string;
  contact: { name?: string; phone_number?: string; email?: string };
  known_contacts?: CandidateKnownContacts;
  job_no?: string;
  normalized_job_no?: string;
  reference?: string;
  source: {
    lead_source_company?: string;
    source_company_label?: string;
    source_granularity_id?: string;
    source_granularity_label?: string;
  };
  confidence: "high" | "medium";
  reason_codes: string[];
  match_method: string;
  in_source_scope: boolean;
  eligibility: "eligible";
  suggested: boolean;
  requires_override_reason: boolean;
};

type TimelineCursor = { event_at: string; type_priority: number; id: string };
type ListCursor = { sort_value: string; id: string };
type LifecycleCaseListRow = {
  _id: unknown;
  kind: "booking" | "release";
  state: "open" | "resolved";
  mode: string;
  sequence_number: number;
  normalized_job_no: string;
  job_no_snapshot: string;
  source_scope?: { granot_crm_source_id: unknown };
  observed_context: {
    contact?: { name?: string; phone_number?: string; email?: string };
  };
  evidence: Array<{
    observation_id: mongoose.Types.ObjectId;
    decision_id: mongoose.Types.ObjectId;
    action: "priority_5" | "booked" | "release";
    captured_at: Date;
  }>;
  case_revision: number;
  evidence_revision: number;
  deterministic_booking_id?: unknown;
  opened_at: Date;
  last_evidence_at: Date;
  resolved_at?: Date;
  priority_pairing?: GranotBookingReconciliationCaseDocument["priority_pairing"];
};

function isBookingCaseMode(
  value: string | undefined,
): value is "create_missing_booking" | "review_existing_booking" | "create_referral_booking" {
  return value === "create_missing_booking" ||
    value === "review_existing_booking" ||
    value === "create_referral_booking";
}

/** Owner Intakes (omitted kind or kind=booking) never merge historical Release cases. */
export function includeReleaseCasesInList(query: { kind?: string; mode?: string }): boolean {
  return query.kind === "release" && (!query.mode || query.mode === "release");
}

export function includeBookingCasesInList(query: { kind?: string; mode?: string }): boolean {
  const bookingMode = isBookingCaseMode(query.mode) ? query.mode : undefined;
  return query.kind !== "release" && (!query.mode || Boolean(bookingMode));
}

export function toBookingIntakeLatestActionEvidence(
  evidence: Array<{
    action: "priority_5" | "booked" | "release";
    captured_at: Date | string;
    observation_id: { toString(): string } | string;
  }>,
): BookingIntakeLatestActionEvidence[] {
  return evidence.map((item) => ({
    action: item.action,
    captured_at: item.captured_at instanceof Date ? item.captured_at : new Date(item.captured_at),
    observation_id: String(item.observation_id),
  }));
}

export function projectCaseLatestAction(
  evidence: Array<{
    action: "priority_5" | "booked" | "release";
    captured_at: Date | string;
    observation_id: { toString(): string } | string;
  }>,
): BookingIntakeLatestAction {
  return selectBookingIntakeLatestAction(toBookingIntakeLatestActionEvidence(evidence)) ?? "booked";
}

export function projectBookingIntakeCapabilities(input: {
  kind: "booking" | "release";
  state: "open" | "resolved";
  mode: string;
  latest_action: BookingIntakeLatestAction;
  booking_commands_enabled: boolean;
  referral_booking_enabled: boolean;
  release_commands_enabled: boolean;
  is_referral_booking?: boolean;
}): GranotLifecycleCaseDetail["capabilities"] {
  const referral = input.kind === "booking" && (
    input.mode === "create_referral_booking" || input.is_referral_booking === true
  );
  const commands = input.state === "open" && (
    (input.kind === "booking" &&
      input.booking_commands_enabled &&
      (referral
        ? input.referral_booking_enabled
        : input.mode === "create_missing_booking" || input.mode === "review_existing_booking")) ||
    (input.kind === "release" && input.release_commands_enabled)
  );
  const confirm_cancellation = Boolean(
    commands &&
    input.kind === "booking" &&
    input.state === "open" &&
    input.mode === "review_existing_booking" &&
    input.latest_action === "release" &&
    input.booking_commands_enabled,
  );
  return {
    commands,
    referral,
    confirm_cancellation,
    release_cases: true,
    discrepancies: true,
  };
}

export type GranotLifecycleHealthProjection = {
  generated_at: string;
  flags: Record<(typeof GRANOT_LIFECYCLE_FLAG_NAMES)[number], boolean>;
  activation: {
    present: boolean;
    id?: string;
    activated_at?: string;
    processor_version?: string;
  };
  receipts: {
    by_work_state: Record<ReceiptWorkState, number>;
    due_count: number;
    oldest_due_at: string | null;
    oldest_due_age_ms: number | null;
    claimed_count: number;
    expired_claim_count: number;
    dead_letter_count: number;
  };
  decisions_last_24h: Array<{
    execution_mode: ExecutionMode;
    outcome: SynchronizationOutcome;
    reason_code: SynchronizationReasonCode;
    count: number;
  }>;
  open_cases: Array<{ kind: "booking" | "release"; mode: string; count: number }>;
  open_discrepancies: Array<{
    kind: "booking" | "release";
    reason_code: GranotDiscrepancyReasonCode;
    count: number;
  }>;
  command_conflicts_last_24h: Array<{ code: string; count: number }>;
  record_links: { active: number; disputed: number };
  last_queue_run: GranotLifecycleLastRunProjection;
  last_cron_run: GranotLifecycleLastRunProjection;
  ringcentral: GranotLifecycleRingCentralHealth;
  alerts: GranotLifecycleAlertProjection[];
};

export type GranotLifecycleRingCentralHealth = {
  state_present: boolean;
  last_run_at: string | null;
  last_run_status: "success" | "error" | null;
  cursor_to: string | null;
  lease: {
    held: boolean;
    acquired_at: string | null;
    expires_at: string | null;
    age_ms: number | null;
    expired: boolean;
  };
  last_runtime_ms: number | null;
  last_adopted_count: number | null;
  last_adoption_conflict_count: number | null;
  last_throttled_count: number | null;
};

export function dueWorkFilter(now: Date): Record<string, unknown> {
  return {
    "processing.state": { $in: ["pending", "retry_scheduled", "claimed"] },
    "processing.next_attempt_at": { $lte: now },
    $or: [
      { "processing.state": { $ne: "claimed" } },
      { "processing.leased_until": { $lte: now } },
    ],
  };
}

export type GranotLifecycleLastRunProjection = {
  at: string;
  status: "completed" | "failed";
} | null;

export function normalizeJobProjectionPath(raw: string): string {
  const normalized = normalizeJobNo(raw);
  if (!normalized) {
    throw new GranotLifecycleError(
      "normalized_job_no is invalid",
      GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      400,
      undefined,
      [{ path: "normalized_job_no", message: "path must normalize to a Job Number" }],
    );
  }
  return normalized;
}

export async function projectGranotJob(
  rawJobNo: string,
  query: GranotLifecycleTimelineQuery = { limit: DEFAULT_TIMELINE_LIMIT },
): Promise<GranotTimelinePage> {
  const normalized_job_no = normalizeJobProjectionPath(rawJobNo);
  const built = await buildTimelineForJob(normalized_job_no);
  return paginateTimeline(built, query);
}

export async function projectGranotLeadTimeline(
  leadModel: "FormLead" | "CallLead",
  leadId: string,
  query: GranotLifecycleTimelineQuery = { limit: DEFAULT_TIMELINE_LIMIT },
): Promise<GranotTimelinePage | null> {
  const lead = leadModel === "FormLead"
    ? await getFormLeadModel().findById(leadId).select({ _id: 1 }).lean()
    : await getCallLeadModel().findById(leadId).select({ _id: 1 }).lean();
  if (!lead) return null;

  const links = await getGranotRecordLinkModel()
    .find({ "lead_ref.model": leadModel, "lead_ref.id": leadId })
    .select({ normalized_job_no: 1 })
    .lean();
  const jobNumbers = [...new Set(links.map((link) => link.normalized_job_no))];
  const pages = await Promise.all(jobNumbers.map((job) => buildTimelineForJob(job)));
  const items = pages.flatMap((page) => page.items);
  const deduped = [...new Map(items.map((item) => [`${item.type}:${item.id}`, item])).values()];
  const current = pages.reduce<GranotTimelinePage["current"]>(
    (result, page) => ({
      record_link: result.record_link ?? page.current.record_link,
      booking: result.booking ?? page.current.booking,
      cancellation: result.cancellation ?? page.current.cancellation,
    }),
    {},
  );
  return paginateTimeline(
    {
      items: deduped,
      current,
      capabilities: timelineCapabilities(),
    },
    query,
  );
}

export async function listGranotLifecycleCases(
  query: GranotLifecycleCaseListQuery,
): Promise<GranotLifecycleCaseListPage> {
  const sortField = query.sort ?? "last_evidence_at";
  const order = query.order ?? "desc";
  const direction = order === "asc" ? 1 : -1;
  const commonFilter: Record<string, unknown> = {};
  if (query.state) commonFilter.state = query.state;
  if (query.source_id) {
    const referralDecisions = await getSynchronizationDecisionModel()
      .find({ "source_policy.granot_crm_source_id": query.source_id })
      .select({ _id: 1 })
      .lean();
    commonFilter.$and = [{
      $or: [
        { "source_scope.granot_crm_source_id": query.source_id },
        { "evidence.decision_id": { $in: referralDecisions.map((row) => row._id) } },
      ],
    }];
  }
  if (query.normalized_job_no) {
    const normalized = normalizeJobNo(query.normalized_job_no);
    if (!normalized) throw validationError("normalized_job_no", "must normalize to a Job Number");
    commonFilter.normalized_job_no = normalized;
  }
  if (query.opened_from || query.opened_to) {
    commonFilter.opened_at = {
      ...(query.opened_from ? { $gte: new Date(query.opened_from) } : {}),
      ...(query.opened_to ? { $lte: new Date(query.opened_to) } : {}),
    };
  }
  if (query.cursor) {
    const cursor = decodeCursor<ListCursor>(query.cursor, isListCursor);
    const operator = direction === 1 ? "$gt" : "$lt";
    commonFilter.$or = [
      { [sortField]: { [operator]: new Date(cursor.sort_value) } },
      { [sortField]: new Date(cursor.sort_value), _id: { [operator]: cursor.id } },
    ];
  }

  const bookingMode = isBookingCaseMode(query.mode) ? query.mode : undefined;
  const includeBooking = includeBookingCasesInList(query);
  const includeRelease = includeReleaseCasesInList(query);
  const [bookingRows, releaseRows] = await Promise.all([
    includeBooking
      ? getGranotBookingReconciliationCaseModel()
          .find({ ...commonFilter, ...(bookingMode ? { mode: bookingMode } : {}) })
          .sort({ [sortField]: direction, _id: direction })
          .limit(query.limit + 1)
          .lean()
      : [],
    includeRelease
      ? getGranotReleaseReconciliationCaseModel()
          .find(commonFilter)
          .sort({ [sortField]: direction, _id: direction })
          .limit(query.limit + 1)
          .lean()
      : [],
  ]);
  const rows: LifecycleCaseListRow[] = [
    ...bookingRows.map((row) => ({ ...row, kind: "booking" as const, mode: row.mode })),
    ...releaseRows.map((row) => ({ ...row, kind: "release" as const, mode: "release" })),
  ].sort((left, right) => {
    const leftTime = new Date(left[sortField]).getTime();
    const rightTime = new Date(right[sortField]).getTime();
    return direction * (leftTime - rightTime || String(left._id).localeCompare(String(right._id)));
  });
  const pageRows = rows.slice(0, query.limit + 1);
  const visible = pageRows.slice(0, query.limit);
  const referralDecisionIds = visible.flatMap((row) =>
    row.source_scope ? [] : row.evidence[0] ? [row.evidence[0].decision_id] : []);
  const referralDecisions = referralDecisionIds.length
    ? await getSynchronizationDecisionModel().find({ _id: { $in: referralDecisionIds } })
        .select({ source_policy: 1 }).lean()
    : [];
  const referralSourceByDecision = new Map(referralDecisions.map((row) => [
    String(row._id),
    row.source_policy?.granot_crm_source_id ? String(row.source_policy.granot_crm_source_id) : undefined,
  ]));
  const sourceIds = [...new Set(visible.flatMap((row) => {
    const sourceId = row.source_scope
      ? String(row.source_scope.granot_crm_source_id)
      : row.evidence[0]
        ? referralSourceByDecision.get(String(row.evidence[0].decision_id))
        : undefined;
    return sourceId ? [sourceId] : [];
  }))];
  const sources = sourceIds.length
    ? await getGranotCrmSourceModel().find({ _id: { $in: sourceIds } }).select({ granot_label: 1 }).lean()
    : [];
  const sourceLabels = new Map(sources.map((source) => [String(source._id), source.granot_label]));
  const listPairing = await listPriorityPairingByCase(visible);
  const items = visible.map((row) => {
    const sourceId = row.source_scope
      ? String(row.source_scope.granot_crm_source_id)
      : row.evidence[0]
        ? referralSourceByDecision.get(String(row.evidence[0].decision_id))
        : undefined;
    return {
      case_id: String(row._id),
      kind: row.kind,
      state: row.state,
      mode: row.mode,
      sequence_number: row.sequence_number,
      normalized_job_no: row.normalized_job_no,
      job_no: row.job_no_snapshot,
      source: { id: sourceId, label: sourceId ? sourceLabels.get(sourceId) : undefined },
      customer_label: customerLabel(row.observed_context.contact),
      latest_action: projectCaseLatestAction(row.evidence),
      evidence_count: row.evidence.length,
      case_revision: row.case_revision,
      evidence_revision: row.evidence_revision,
      deterministic_booking: {
        present: Boolean(row.deterministic_booking_id),
        masked_ref: row.deterministic_booking_id
          ? maskLifecycleId(String(row.deterministic_booking_id))
          : undefined,
      },
      opened_at: iso(row.opened_at, "case.opened_at"),
      last_evidence_at: iso(row.last_evidence_at, "case.last_evidence_at"),
      resolved_at: row.resolved_at ? iso(row.resolved_at, "case.resolved_at") : undefined,
      priority_pairing: listPairing.get(String(row._id)),
    } satisfies GranotLifecycleCaseListItem;
  });
  const last = visible.at(-1);
  const result: GranotLifecycleCaseListPage = {
    items,
    next_cursor: pageRows.length > query.limit && last
      ? encodeCursor({ sort_value: iso(last[sortField], `case.${sortField}`), id: String(last._id) })
      : null,
  };
  assertProjectionSafe(result);
  return result;
}

export async function getGranotLifecycleCaseDetail(
  caseId: string,
): Promise<GranotLifecycleCaseDetail | null> {
  const bookingRow = await getGranotBookingReconciliationCaseModel().findById(caseId).lean();
  const releaseRow = bookingRow
    ? null
    : await getGranotReleaseReconciliationCaseModel().findById(caseId).lean();
  const row = bookingRow ?? releaseRow;
  if (!row) return null;
  const kind = bookingRow ? "booking" as const : "release" as const;
  const mode = bookingRow?.mode ?? "release";
  const observationIds = row.evidence.map((item) => item.observation_id);
  const decisionIds = row.evidence.map((item) => item.decision_id);
  const [observations, decisions, link, booking, employeeCase] = await Promise.all([
    getGranotObservationModel().find({ _id: { $in: observationIds } }).lean(),
    getSynchronizationDecisionModel().find({ _id: { $in: decisionIds } }).lean(),
    row.record_link_id ? getGranotRecordLinkModel().findById(row.record_link_id).lean() : null,
    row.deterministic_booking_id ? BookedLead.findById(row.deterministic_booking_id).lean() : null,
    kind === "booking" && row.deterministic_booking_id
      ? BookingLeadReconciliationCase.findOne({ booking: row.deterministic_booking_id }).lean()
      : null,
  ]);
  const [cancellation, activeMerchant] = booking
    ? await Promise.all([
        CancelledLead.findOne({ booked_lead: booking._id }).lean(),
        Merchant.findOne({ name: booking.merchant, active: true }).select({ _id: 1 }).lean(),
      ])
    : [null, null];
  const observationById = new Map(observations.map((item) => [String(item._id), item]));
  const decisionById = new Map(decisions.map((item) => [String(item._id), item]));
  const leadRef = kind === "booking"
    ? row.suggested_lead?.lead_ref ?? link?.lead_ref
    : link?.lead_ref;
  const lead = leadRef ? await loadLeadContactProjection(leadRef.model, String(leadRef.id)) : null;
  const jobObservations = kind === "booking"
    ? await getGranotObservationModel()
        .find({ "identity.normalized_job_no": row.normalized_job_no })
        .select({
          _id: 1,
          receipt_id: 1,
          captured_at: 1,
          route_event_class: 1,
          payload_event_type_raw: 1,
          priority: 1,
          identity: 1,
          booking_action: 1,
        })
        .lean()
    : [];
  const timeline = await projectGranotJob(row.normalized_job_no, { limit: DEFAULT_TIMELINE_LIMIT });
  const selectedCreating = selectCreatingObservationEvidence(row.evidence);
  const creatingBooked = selectedCreating?.item.action === "booked"
    ? jobObservations.find((item) => String(item._id) === String(selectedCreating.item.observation_id))
      ?? observationById.get(String(selectedCreating.item.observation_id))
    : undefined;
  const safeBooking = booking ? projectBooking(booking, activeMerchant?._id) : undefined;
  const safeCancellation = cancellation ? projectCancellation(cancellation) : undefined;
  const firstObservation = row.evidence[0]
    ? observationById.get(String(row.evidence[0].observation_id))
    : undefined;
  const firstDecision = row.evidence[0]
    ? decisionById.get(String(row.evidence[0].decision_id))
    : undefined;
  const sourceId = row.source_scope
    ? String(row.source_scope.granot_crm_source_id)
    : firstDecision?.source_policy?.granot_crm_source_id
      ? String(firstDecision.source_policy.granot_crm_source_id)
      : undefined;
  const source = sourceId
    ? await getGranotCrmSourceModel().findById(sourceId).select({ granot_label: 1 }).lean()
    : null;
  const latest_action = projectCaseLatestAction(row.evidence);
  const flags = getGranotLifecycleFlags();
  const result: GranotLifecycleCaseDetail = {
    case_id: String(row._id),
    kind,
    state: row.state,
    mode,
    sequence_number: row.sequence_number,
    case_revision: row.case_revision,
    evidence_revision: row.evidence_revision,
    normalized_job_no: row.normalized_job_no,
    job_no: row.job_no_snapshot,
    opened_at: iso(row.opened_at, "case.opened_at"),
    last_evidence_at: iso(row.last_evidence_at, "case.last_evidence_at"),
    resolved_at: row.resolved_at ? iso(row.resolved_at, "case.resolved_at") : undefined,
    source_scope: row.source_scope ? {
      granot_crm_source_id: String(row.source_scope.granot_crm_source_id),
      lead_source_company: String(row.source_scope.lead_source_company),
      source_granularity_id: String(row.source_scope.source_granularity_id),
    } : undefined,
    source: { id: sourceId, label: source?.granot_label },
    evidence: row.evidence.map((item) => {
      const observation = observationById.get(String(item.observation_id));
      const decision = decisionById.get(String(item.decision_id));
      return {
        observation_id: String(item.observation_id),
        decision_id: String(item.decision_id),
        captured_at: iso(item.captured_at, "case.evidence.captured_at"),
        action: item.action,
        normalization_result: observation?.normalization_result,
        decision_outcome: decision?.outcome,
        decision_reason_code: decision?.reason_code,
      };
    }),
    observed_context: {
      section_label: "Granot evidence — not official Vantage values",
      contact: row.observed_context.contact,
      move_date: row.observed_context.move_date
        ? iso(row.observed_context.move_date, "case.observed_context.move_date")
        : undefined,
      estimated_cubic_feet: row.observed_context.estimated_cubic_feet,
      estimate: row.observed_context.estimate,
      payment: row.observed_context.payment,
      balance: row.observed_context.balance,
      granot_priority: row.observed_context.granot_priority,
      granot_username: row.observed_context.granot_username,
    },
    contacts: {
      ...projectLeadContacts(lead),
      ...(projectLeadContacts(lead).accepted_granot
        ? {}
        : { accepted_granot: toContact(firstObservation?.contact) }),
    },
    suggestion: kind === "booking" && row.suggested_lead ? {
      lead_ref: { model: row.suggested_lead.lead_ref.model, id: String(row.suggested_lead.lead_ref.id) },
      confidence: row.suggested_lead.confidence,
      match_method: row.suggested_lead.match_method,
      reason_codes: row.suggested_lead.reason_codes,
    } : undefined,
    candidate_search: {
      available: kind === "booking" && mode !== "create_referral_booking" &&
        booking?.is_referral_booking !== true,
      default_scope: "source",
      all_scope_warning: true,
    },
    record_link: link ? projectRecordLink(link) : undefined,
    official_current: { booking: safeBooking, cancellation: safeCancellation },
    official_draft: {},
    employee_booking_lead_reconciliation: employeeCase ? {
      case_id: String(employeeCase._id),
      status: employeeCase.status,
      href: `/bookings/reconciliation?case=${encodeURIComponent(String(employeeCase._id))}`,
    } : undefined,
    timeline,
    latest_action,
    capabilities: projectBookingIntakeCapabilities({
      kind,
      state: row.state,
      mode,
      latest_action,
      booking_commands_enabled: flags.booking_commands_enabled,
      referral_booking_enabled: flags.referral_booking_enabled,
      release_commands_enabled: flags.release_commands_enabled,
      is_referral_booking: booking?.is_referral_booking === true,
    }),
    priority_pairing: projectCaseDetailPriorityPairing({
      kind,
      evidence: row.evidence,
      creating: creatingBooked,
      jobObservations,
    }),
  };
  assertProjectionSafe(result);
  return result;
}

export async function listGranotLifecycleCaseCandidates(
  caseId: string,
  query: GranotLifecycleCandidateQuery,
): Promise<{ items: GranotLifecycleCandidateItem[]; next_cursor: string | null } | null> {
  const row = await getGranotBookingReconciliationCaseModel().findById(caseId).lean();
  if (!row) return null;
  const referralBooking = row.deterministic_booking_id
    ? await BookedLead.exists({ _id: row.deterministic_booking_id, is_referral_booking: true })
    : null;
  if (row.mode === "create_referral_booking" || referralBooking) {
    return { items: [], next_cursor: null };
  }
  const latest = [...row.evidence].sort((a, b) =>
    new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime())[0];
  if (!latest) return { items: [], next_cursor: null };
  const policyRows = await searchBookingLeadCandidates({
    observation_id: String(latest.observation_id),
    opened_at: row.opened_at,
  });
  const cursor = query.cursor ? decodeCursor<{ key: string }>(query.cursor, isCandidateCursor) : undefined;
  const browsed = await browseCandidateLeadViews(query, row.source_scope, cursor?.key);
  const ordered = browsed.sort((left, right) => candidateKey(left).localeCompare(candidateKey(right)));
  const after = cursor ? ordered.filter((entry) => candidateKey(entry) > cursor.key) : ordered;
  const pageRows = after.slice(0, query.limit + 1);
  const visible = pageRows.slice(0, query.limit);
  // Ranked identity matches are pinned ahead of the unranked browse page so the
  // strongest match is reachable without paging. An explicit search owns its own page.
  const ranked = cursor || query.q
    ? []
    : await loadRankedCandidateLeadViews(policyRows, query.lead_model);
  const rows = assembleCandidateEntries(query, ranked, visible);
  const items = rows.map(({ ref, lead }) => {
    const policy = projectBookingCandidateBrowserPolicy({
      lead_ref: ref,
      lead_normalized_job_no: lead.normalized_job_no ?? undefined,
      lead_source_company: lead.lead_source_company ? String(lead.lead_source_company) : undefined,
      lead_source_granularity_id: lead.source_granularity_id ? String(lead.source_granularity_id) : undefined,
      case_normalized_job_no: row.normalized_job_no,
      case_source_scope: row.source_scope ? {
        lead_source_company: String(row.source_scope.lead_source_company),
        source_granularity_id: String(row.source_scope.source_granularity_id),
      } : undefined,
      canonical_candidates: policyRows,
    });
    return {
      lead_ref: ref,
      customer_label: customerLabel({
        name: leadName(lead),
        phone_number: lead.phone_number,
        email: lead.email,
      }),
      contact: {
        name: leadName(lead),
        phone_number: lead.phone_number ?? undefined,
        email: lead.email ?? undefined,
      },
      known_contacts: projectCandidateKnownContacts(lead),
      job_no: lead.job_no ?? undefined,
      normalized_job_no: lead.normalized_job_no ?? undefined,
      reference: lead.ref_no ?? undefined,
      source: {
        lead_source_company: lead.lead_source_company ? String(lead.lead_source_company) : undefined,
        source_company_label: lead.source_company_label_snapshot ?? undefined,
        source_granularity_id: lead.source_granularity_id ? String(lead.source_granularity_id) : undefined,
        source_granularity_label: lead.source_granularity_label_snapshot ?? undefined,
      },
      confidence: policy.confidence,
      reason_codes: policy.reason_codes,
      match_method: policy.match_method,
      in_source_scope: policy.in_source_scope,
      eligibility: "eligible",
      suggested: policy.suggested,
      requires_override_reason: policy.requires_override_reason,
    } satisfies GranotLifecycleCandidateItem;
  });
  const last = visible.at(-1);
  const result = {
    items,
    next_cursor: pageRows.length > query.limit && last
      ? encodeCursor({ key: candidateKey(last) })
      : null,
  };
  assertProjectionSafe(result);
  return result;
}

export async function listConnectLeadCandidates(
  bookingId: string,
  query: GranotLifecycleConnectLeadCandidateQuery,
): Promise<{ items: GranotLifecycleCandidateItem[]; next_cursor: string | null }> {
  const booking = await BookedLead.findById(bookingId).lean().exec();
  if (!booking) {
    throw new GranotLifecycleError(
      "Booking was not found",
      GRANOT_LIFECYCLE_ERROR_CODES.CASE_NOT_FOUND,
      404,
    );
  }
  if (!isConnectableLeadlessBooking(booking)) {
    throw new GranotLifecycleError(
      "Booking is not a connectable Leadless Booking",
      GRANOT_LIFECYCLE_ERROR_CODES.IDENTITY_CONFLICT,
      409,
    );
  }
  if (!query.q) {
    return { items: [], next_cursor: null };
  }
  const link = await getGranotRecordLinkModel().findOne({
    provider: "granot",
    booking_ref: booking._id,
    state: "active",
  }).lean().exec();
  const assignment = bookingSourceAssignment(booking, link?.source_scope);
  const cursor = query.cursor ? decodeCursor<{ key: string }>(query.cursor, isCandidateCursor) : undefined;
  const browsed = await browseConnectLeadViews(query, cursor?.key);
  const ordered = browsed.sort((left, right) => candidateKey(left).localeCompare(candidateKey(right)));
  const after = cursor ? ordered.filter((entry) => candidateKey(entry) > cursor.key) : ordered;
  const pageRows = after.slice(0, query.limit + 1);
  const visible = pageRows.slice(0, query.limit);
  const items = visible.map(({ ref, lead }) => {
    const inScope = leadMatchesBookingSource(lead, assignment);
    return {
      lead_ref: ref,
      customer_label: customerLabel({
        name: leadName(lead),
        phone_number: lead.phone_number,
        email: lead.email,
      }),
      contact: {
        name: leadName(lead),
        phone_number: lead.phone_number ?? undefined,
        email: lead.email ?? undefined,
      },
      known_contacts: projectCandidateKnownContacts(lead),
      job_no: lead.job_no ?? undefined,
      normalized_job_no: lead.normalized_job_no ?? undefined,
      reference: lead.ref_no ?? undefined,
      source: {
        lead_source_company: lead.lead_source_company ? String(lead.lead_source_company) : undefined,
        source_company_label: lead.source_company_label_snapshot ?? undefined,
        source_granularity_id: lead.source_granularity_id ? String(lead.source_granularity_id) : undefined,
        source_granularity_label: lead.source_granularity_label_snapshot ?? undefined,
      },
      confidence: "medium" as const,
      reason_codes: [],
      match_method: "connect_search",
      in_source_scope: inScope,
      eligibility: "eligible" as const,
      suggested: false,
      requires_override_reason: !inScope,
    } satisfies GranotLifecycleCandidateItem;
  });
  const last = visible.at(-1);
  const result = {
    items,
    next_cursor: pageRows.length > query.limit && last
      ? encodeCursor({ key: candidateKey(last) })
      : null,
  };
  assertProjectionSafe(result);
  return result;
}

async function browseConnectLeadViews(
  query: GranotLifecycleConnectLeadCandidateQuery,
  cursorKey?: string,
): Promise<CandidateLeadEntry[]> {
  const search = query.q ? new RegExp(escapeRegExp(query.q), "i") : undefined;
  if (!search) return [];
  const [cursorModel, cursorId] = cursorKey?.split(":") ?? [];
  const available: Record<string, unknown> = {
    duplicate: { $ne: true },
    $and: [
      { $or: [{ booked: null }, { booked: { $exists: false } }] },
      { $or: [{ cancelled: null }, { cancelled: { $exists: false } }] },
    ],
  };
  const formFilter: Record<string, unknown> = {
    ...available,
    bad_lead: null,
    $or: formLeadCandidateSearchOr(search),
  };
  const callFilter: Record<string, unknown> = {
    ...available,
    created_on_unmatched: { $ne: true },
    $or: callLeadCandidateSearchOr(search),
  };
  if (cursorModel === "FormLead" && cursorId) formFilter._id = { $gt: cursorId };
  if (cursorModel === "CallLead" && cursorId) callFilter._id = { $gt: cursorId };
  const [forms, calls] = await Promise.all([
    query.lead_model === "CallLead"
      ? Promise.resolve([] as CandidateLeadView[])
      : getFormLeadModel()
          .find(formFilter)
          .select(FORM_CANDIDATE_LEAD_PROJECTION)
          .sort({ _id: 1 })
          .limit(query.limit + 1)
          .lean<CandidateLeadView[]>(),
    query.lead_model === "FormLead" || cursorModel === "FormLead"
      ? Promise.resolve([] as CandidateLeadView[])
      : getCallLeadModel()
          .find(callFilter)
          .select(CANDIDATE_LEAD_PROJECTION)
          .sort({ _id: 1 })
          .limit(query.limit + 1)
          .lean<CandidateLeadView[]>(),
  ]);
  return [
    ...forms.map((lead) => ({ ref: { model: "FormLead" as const, id: String(lead._id) }, lead })),
    ...calls.map((lead) => ({ ref: { model: "CallLead" as const, id: String(lead._id) }, lead })),
  ];
}

async function buildTimelineForJob(
  normalizedJobNo: string,
): Promise<Omit<GranotTimelinePage, "next_cursor">> {
  const [links, observations, bookingCases, releaseCases, bookingDiscrepancies, releaseDiscrepancies, booking] = await Promise.all([
    getGranotRecordLinkModel()
      .find({ provider: "granot", normalized_job_no: normalizedJobNo })
      .lean(),
    getGranotObservationModel()
      .find({ "identity.normalized_job_no": normalizedJobNo })
      .lean(),
    getGranotBookingReconciliationCaseModel()
      .find({ normalized_job_no: normalizedJobNo })
      .lean(),
    getGranotReleaseReconciliationCaseModel()
      .find({ normalized_job_no: normalizedJobNo })
      .lean(),
    getGranotBookingDiscrepancyModel().find({ normalized_job_no: normalizedJobNo }).lean(),
    getGranotReleaseDiscrepancyModel().find({ normalized_job_no: normalizedJobNo }).lean(),
    BookedLead.findOne({ normalized_job_no: normalizedJobNo }).lean(),
  ]);
  const observationIds = observations.map((row) => row._id);
  const decisions = observationIds.length
    ? await getSynchronizationDecisionModel().find({ observation_id: { $in: observationIds } }).lean()
    : [];
  const cancellation = booking
    ? await CancelledLead.findOne({ booked_lead: booking._id }).lean()
    : null;
  const entityRefs: EntityRef[] = links.map((link) => ({
    model: "GranotRecordLink",
    id: String(link._id),
  }));
  if (booking) entityRefs.push({ model: "BookedLead", id: String(booking._id) });
  if (booking?.lead_ref && booking.lead_model) {
    entityRefs.push({ model: booking.lead_model, id: String(booking.lead_ref) });
  }
  if (cancellation) {
    entityRefs.push({ model: "CancelledLead", id: String(cancellation._id) });
  }
  const entityChanges = entityRefs.length
    ? await getEntityChangeModel().find({ $or: entityRefs.map((ref) => ({ entity: ref })) }).lean()
    : [];
  const decisionsByObservation = new Map<string, typeof decisions>();
  for (const decision of decisions) {
    const id = String(decision.observation_id);
    decisionsByObservation.set(id, [...(decisionsByObservation.get(id) ?? []), decision]);
  }

  const items: GranotTimelineEntry[] = [];
  for (const observation of observations) {
    const observationId = String(observation._id);
    const eventAt = iso(observation.captured_at, "observation.captured_at");
    const relatedDecision = decisionsByObservation.get(observationId)?.sort((a, b) => a.attempt - b.attempt)[0];
    items.push({
      id: observationId,
      type: "observation",
      event_at: eventAt,
      type_priority: 10,
      data: {
        observation_id: observationId,
        receipt_id: String(observation.receipt_id),
        normalization_result: observation.normalization_result,
        issue_codes: (observation.issues ?? []).map((issue) => issue.code),
      },
    });
    if (observation.priority?.valid && observation.priority.canonical) {
      const changedPaths = relatedDecision?.effects.flatMap((effect) => effect.changed_paths ?? []) ?? [];
      items.push({
        id: `${observationId}:priority`,
        type: "priority_effect",
        event_at: eventAt,
        type_priority: 20,
        data: {
          observation_id: observationId,
          decision_id: relatedDecision ? String(relatedDecision._id) : undefined,
          canonical_priority: observation.priority.canonical,
          changed_paths: [...new Set(changedPaths)].sort(),
        },
      });
    }
    if (observation.booking_action?.normalized) {
      items.push({
        id: `${observationId}:action`,
        type: "booking_action",
        event_at: eventAt,
        type_priority: 30,
        data: {
          observation_id: observationId,
          decision_id: relatedDecision ? String(relatedDecision._id) : undefined,
          action: observation.booking_action.normalized,
        },
      });
    }
  }
  for (const decision of decisions) {
    items.push({
      id: String(decision._id),
      type: "decision",
      event_at: iso(decision.decided_at, "decision.decided_at"),
      type_priority: 40,
      data: {
        decision_id: String(decision._id),
        observation_id: String(decision.observation_id),
        execution_mode: decision.execution_mode,
        outcome: decision.outcome,
        reason_code: decision.reason_code,
        target: decision.target,
        effects: decision.effects ?? [],
      },
    });
  }
  const cases = [
    ...bookingCases.map((row) => ({ row, kind: "booking" as const, mode: row.mode })),
    ...releaseCases.map((row) => ({ row, kind: "release" as const, mode: "release" })),
  ];
  for (const { row: caseRow, kind, mode } of cases) {
    const evidence = [...caseRow.evidence].sort((a, b) =>
      new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());
    evidence.forEach((entry, index) => {
      items.push({
        id: `${caseRow._id}:${entry.observation_id}`,
        type: "case",
        event_at: iso(entry.captured_at, "case.evidence.captured_at"),
        type_priority: 50,
        data: {
          case_id: String(caseRow._id),
          kind,
          event: index === 0 ? "opened" : "refreshed",
          state: caseRow.state,
          mode,
          sequence_number: caseRow.sequence_number,
          case_revision: caseRow.case_revision,
          evidence_revision: caseRow.evidence_revision,
          observation_id: String(entry.observation_id),
        },
      });
    });
    if (caseRow.resolved_at) {
      items.push({
        id: `${caseRow._id}:resolved`,
        type: "case",
        event_at: iso(caseRow.resolved_at, "case.resolved_at"),
        type_priority: 50,
        data: {
          case_id: String(caseRow._id),
          kind,
          event: "resolved",
          state: "resolved",
          mode,
          sequence_number: caseRow.sequence_number,
          case_revision: caseRow.case_revision,
          evidence_revision: caseRow.evidence_revision,
        },
      });
    }
  }
  for (const { row, kind } of [
    ...bookingDiscrepancies.map((row) => ({ row, kind: "booking" as const })),
    ...releaseDiscrepancies.map((row) => ({ row, kind: "release" as const })),
  ]) {
    row.evidence.forEach((evidence) => items.push({
      id: `${row._id}:${evidence.observation_id}`,
      type: "discrepancy",
      event_at: iso(evidence.captured_at, "discrepancy.evidence.captured_at"),
      type_priority: 60,
      data: { discrepancy_id: String(row._id), kind, state: row.state, reason_code: row.reason_code },
    }));
    if (row.resolution) items.push({
      id: `${row._id}:resolved`,
      type: "discrepancy",
      event_at: iso(row.resolution.resolved_at, "discrepancy.resolution.resolved_at"),
      type_priority: 60,
      data: { discrepancy_id: String(row._id), kind, state: "resolved", reason_code: row.reason_code },
    });
  }
  for (const link of links) {
    const eventAt = link.last_changed_at ?? link.established_at ?? link.last_observed_at;
    const event = link.state === "superseded"
      ? "superseded" as const
      : link.last_changed_at
        ? "corrected" as const
        : new Date(link.last_observed_at).getTime() > new Date(link.established_at).getTime()
          ? "refreshed" as const
          : "established" as const;
    items.push({
      id: String(link._id),
      type: "record_link_change",
      event_at: iso(eventAt, "record_link.event_at"),
      type_priority: 70,
      data: {
        record_link_id: String(link._id),
        event,
        domain_revision: link.domain_revision,
        lead_ref: link.lead_ref
          ? { model: link.lead_ref.model, id: String(link.lead_ref.id) }
          : undefined,
        booking_ref: link.booking_ref ? String(link.booking_ref) : undefined,
      },
    });
  }
  for (const change of entityChanges) {
    items.push({
      id: String(change._id),
      type: "entity_change",
      event_at: iso(change.applied_at, "entity_change.applied_at"),
      type_priority: 80,
      data: {
        change_id: String(change._id),
        entity: change.entity,
        command_execution_id: String(change.command_execution_id),
        revision_before: change.revision_before,
        revision_after: change.revision_after,
        changed_paths: change.changed_paths,
      },
    });
  }
  if (booking) {
    items.push({
      id: String(booking._id),
      type: "official_booking",
      event_at: iso(booking.last_changed_at ?? booking.createdAt ?? booking.timestamp, "booking.event_at"),
      type_priority: 90,
      data: {
        booking_id: String(booking._id),
        normalized_job_no: booking.normalized_job_no ?? normalizedJobNo,
        domain_revision: booking.domain_revision,
        cancellation_id: cancellation ? String(cancellation._id) : undefined,
      },
    });
  }
  if (cancellation && booking) {
    items.push({
      id: String(cancellation._id),
      type: "official_cancellation",
      event_at: iso(cancellation.last_changed_at ?? cancellation.createdAt ?? cancellation.timestamp, "cancellation.event_at"),
      type_priority: 100,
      data: {
        cancellation_id: String(cancellation._id),
        booking_id: String(booking._id),
        domain_revision: cancellation.domain_revision,
      },
    });
  }
  const activeLink = links.find((link) => link.state === "active");
  return {
    items,
    current: {
      record_link: activeLink ? projectRecordLink(activeLink) : undefined,
      booking: booking ? projectBooking(booking) : undefined,
      cancellation: cancellation ? projectCancellation(cancellation) : undefined,
    },
    capabilities: timelineCapabilities(),
  };
}

export function paginateTimeline(
  timeline: Omit<GranotTimelinePage, "next_cursor">,
  query: GranotLifecycleTimelineQuery,
): GranotTimelinePage {
  const cursor = query.cursor
    ? decodeCursor<TimelineCursor>(query.cursor, isTimelineCursor)
    : undefined;
  const ordered = [...timeline.items].sort(compareTimelineEntries);
  const after = cursor
    ? ordered.filter((item) => compareTimelineEntryToCursor(item, cursor) > 0)
    : ordered;
  const visible = after.slice(0, query.limit);
  const last = visible.at(-1);
  const result: GranotTimelinePage = {
    items: visible,
    next_cursor: after.length > query.limit && last
      ? encodeCursor({ event_at: last.event_at, type_priority: last.type_priority, id: last.id })
      : null,
    current: timeline.current,
    capabilities: timeline.capabilities,
  };
  assertProjectionSafe(result);
  return result;
}

export function compareTimelineEntries(left: GranotTimelineEntry, right: GranotTimelineEntry): number {
  return left.event_at.localeCompare(right.event_at) ||
    left.type_priority - right.type_priority ||
    left.id.localeCompare(right.id);
}

function compareTimelineEntryToCursor(entry: GranotTimelineEntry, cursor: TimelineCursor): number {
  return entry.event_at.localeCompare(cursor.event_at) ||
    entry.type_priority - cursor.type_priority ||
    entry.id.localeCompare(cursor.id);
}

function timelineCapabilities(): GranotTimelinePage["capabilities"] {
  return {
    booking_cases: true,
    release_cases: true,
    discrepancies: true,
    official_facts: true,
  };
}

function projectRecordLink(link: {
  _id: unknown;
  state: "active" | "superseded";
  disputed: boolean;
  source_scope?: { lead_source_company: unknown; source_granularity_id: unknown };
  lead_ref?: { model: "FormLead" | "CallLead"; id: unknown };
  booking_ref?: unknown;
  domain_revision: number;
}): SafeRecordLinkProjection {
  return {
    id: String(link._id),
    state: link.state,
    disputed: link.disputed,
    source_scope: link.source_scope ? {
      lead_source_company: String(link.source_scope.lead_source_company),
      source_granularity_id: String(link.source_scope.source_granularity_id),
    } : undefined,
    lead_ref: link.lead_ref ? { model: link.lead_ref.model, id: String(link.lead_ref.id) } : undefined,
    booking_ref: link.booking_ref ? String(link.booking_ref) : undefined,
    domain_revision: link.domain_revision,
  };
}

function projectBooking(booking: {
  _id: unknown;
  normalized_job_no?: string | null;
  job_no?: string | null;
  book_date: Date;
  customer_name?: string | null;
  source: string;
  merchant: string;
  deposit_amount: number;
  total_binder_amount: number;
  agent_allocations: Array<{ agent: unknown; agent_name_snapshot: string; binder_amount: number }>;
  domain_revision: number;
  lead_ref?: unknown;
  lead_model?: "FormLead" | "CallLead" | null;
}, merchantId?: unknown): SafeBookingProjection {
  return {
    id: String(booking._id),
    normalized_job_no: booking.normalized_job_no ?? "",
    job_no: booking.job_no ?? null,
    book_date: iso(booking.book_date, "booking.book_date"),
    customer_name: booking.customer_name ?? null,
    source: booking.source,
    merchant: booking.merchant,
    ...(merchantId ? { merchant_id: String(merchantId) } : {}),
    deposit_amount: booking.deposit_amount,
    total_binder_amount: booking.total_binder_amount,
    agent_allocations: booking.agent_allocations.map((allocation) => ({
      agent_id: String(allocation.agent),
      agent_name: allocation.agent_name_snapshot,
      binder_amount: allocation.binder_amount,
    })),
    domain_revision: booking.domain_revision,
    lead_ref: booking.lead_ref && booking.lead_model
      ? { model: booking.lead_model, id: String(booking.lead_ref) }
      : undefined,
  };
}

function projectCancellation(cancellation: {
  _id: unknown;
  booked_lead: unknown;
  cancel_date: Date;
  reason?: string | null;
  refund_amount: number;
  domain_revision: number;
}): SafeCancellationProjection {
  return {
    id: String(cancellation._id),
    booking_id: String(cancellation.booked_lead),
    cancel_date: iso(cancellation.cancel_date, "cancellation.cancel_date"),
    refund_amount: cancellation.refund_amount,
    domain_revision: cancellation.domain_revision,
  };
}

function projectLeadContacts(lead: unknown): GranotLifecycleCaseDetail["contacts"] {
  if (!lead || typeof lead !== "object") return {};
  const row = lead as Record<string, unknown>;
  return {
    submitted_or_ingested: toContact(row.ingested_contact_snapshot),
    accepted_granot: toContact(row.granot_contact_snapshot),
  };
}

type CandidateLeadView = {
  _id: unknown;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  email?: string | null;
  job_no?: string | null;
  normalized_job_no?: string | null;
  ref_no?: string | null;
  lead_source_company?: unknown;
  source_company?: string | null;
  source_company_label_snapshot?: string | null;
  source_granularity_id?: unknown;
  source_granularity_label_snapshot?: string | null;
  ingested_contact_snapshot?: unknown;
  granot_contact_snapshot?: unknown;
};

type CandidateLeadEntry = {
  ref: { model: "FormLead" | "CallLead"; id: string };
  lead: CandidateLeadView;
};

const CANDIDATE_LEAD_PROJECTION = {
  name: 1,
  first_name: 1,
  last_name: 1,
  phone_number: 1,
  email: 1,
  job_no: 1,
  normalized_job_no: 1,
  ref_no: 1,
  lead_source_company: 1,
  source_company: 1,
  source_company_label_snapshot: 1,
  source_granularity_id: 1,
  source_granularity_label_snapshot: 1,
  ingested_contact_snapshot: 1,
  granot_contact_snapshot: 1,
} as const;

const FORM_CANDIDATE_LEAD_PROJECTION = {
  ...CANDIDATE_LEAD_PROJECTION,
  ingested_contact_snapshot: 1,
  granot_contact_snapshot: 1,
} as const;

async function browseCandidateLeadViews(
  query: GranotLifecycleCandidateQuery,
  sourceScope?: {
    lead_source_company: unknown;
    source_granularity_id: unknown;
  },
  cursorKey?: string,
): Promise<CandidateLeadEntry[]> {
  const common: Record<string, unknown> = {};
  if (query.scope === "source" && sourceScope) {
    common.lead_source_company = sourceScope.lead_source_company;
    common.source_granularity_id = sourceScope.source_granularity_id;
  }
  const search = query.q ? new RegExp(escapeRegExp(query.q), "i") : undefined;
  const [cursorModel, cursorId] = cursorKey?.split(":") ?? [];
  const formFilter: Record<string, unknown> = { ...common, duplicate: { $ne: true }, bad_lead: null };
  const callFilter: Record<string, unknown> = { ...common };
  if (search) {
    formFilter.$or = formLeadCandidateSearchOr(search);
    callFilter.$or = callLeadCandidateSearchOr(search);
  }
  if (cursorModel === "FormLead" && cursorId) formFilter._id = { $gt: cursorId };
  if (cursorModel === "CallLead" && cursorId) callFilter._id = { $gt: cursorId };
  const [forms, calls] = await Promise.all([
    query.lead_model === "CallLead"
      ? Promise.resolve([] as CandidateLeadView[])
      : getFormLeadModel()
          .find(formFilter)
          .select(FORM_CANDIDATE_LEAD_PROJECTION)
          .sort({ _id: 1 })
          .limit(query.limit + 1)
          .lean<CandidateLeadView[]>(),
    query.lead_model === "FormLead" || cursorModel === "FormLead"
      ? Promise.resolve([] as CandidateLeadView[])
      : getCallLeadModel()
          .find(callFilter)
          .select(CANDIDATE_LEAD_PROJECTION)
          .sort({ _id: 1 })
          .limit(query.limit + 1)
          .lean<CandidateLeadView[]>(),
  ]);
  return [
    ...forms.map((lead) => ({ ref: { model: "FormLead" as const, id: String(lead._id) }, lead })),
    ...calls.map((lead) => ({ ref: { model: "CallLead" as const, id: String(lead._id) }, lead })),
  ];
}

function candidateKey(entry: CandidateLeadEntry): string {
  return `${entry.ref.model}:${entry.ref.id}`;
}

export function formLeadCandidateSearchOr(search: RegExp): Record<string, RegExp>[] {
  return [
    ...FORM_LEAD_CONTACT_NAME_PATHS.map((path) => ({ [path]: search })),
    ...FORM_LEAD_CONTACT_EMAIL_PATHS.map((path) => ({ [path]: search })),
    ...FORM_LEAD_CONTACT_PHONE_PATHS.map((path) => ({ [path]: search })),
    { job_no: search },
    { ref_no: search },
  ];
}

export function callLeadCandidateSearchOr(search: RegExp): Record<string, RegExp>[] {
  return [
    ...CALL_LEAD_CONTACT_NAME_PATHS.map((path) => ({ [path]: search })),
    ...CALL_LEAD_CONTACT_EMAIL_PATHS.map((path) => ({ [path]: search })),
    ...CALL_LEAD_CONTACT_PHONE_PATHS.map((path) => ({ [path]: search })),
    { job_no: search },
    { ref_no: search },
  ];
}

/** Ranked identity pins first when `q` is empty and this is the first page. */
export function assembleCandidateEntries<T extends { ref: { model: string; id: string } }>(
  query: { q?: string; cursor?: string },
  ranked: readonly T[],
  browsed: readonly T[],
): T[] {
  const pins = query.cursor || query.q ? [] : [...ranked];
  const pinKeys = new Set(pins.map((entry) => `${entry.ref.model}:${entry.ref.id}`));
  return [...pins, ...browsed.filter((entry) => !pinKeys.has(`${entry.ref.model}:${entry.ref.id}`))];
}

export function projectCandidateKnownContacts(lead: CandidateLeadView): CandidateKnownContacts {
  const form_submitted: CandidateKnownContact = {
    name: leadName(lead),
    first_name: stringOrUndefined(lead.first_name),
    last_name: stringOrUndefined(lead.last_name),
    phone_number: stringOrUndefined(lead.phone_number),
    email: stringOrUndefined(lead.email),
  };
  const snapshot = readGranotContactSnapshot(lead.granot_contact_snapshot);
  if (!snapshot) {
    return { form_submitted };
  }
  const granot: CandidateKnownGranotContact = {
    name: snapshotName(snapshot),
    first_name: stringOrUndefined(snapshot.first_name),
    last_name: stringOrUndefined(snapshot.last_name),
    phone_number: stringOrUndefined(snapshot.phone_number),
    email: stringOrUndefined(snapshot.email),
    differs_from_ingested: snapshot.differs_from_ingested === true,
    ...(optionalIso(snapshot.captured_at) ? { captured_at: optionalIso(snapshot.captured_at) } : {}),
  };
  return { form_submitted, granot };
}

function readGranotContactSnapshot(value: unknown): {
  name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  phone_number?: unknown;
  email?: unknown;
  differs_from_ingested?: unknown;
  captured_at?: unknown;
} | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as {
    name?: unknown;
    first_name?: unknown;
    last_name?: unknown;
    phone_number?: unknown;
    email?: unknown;
    differs_from_ingested?: unknown;
    captured_at?: unknown;
  };
}

function snapshotName(snapshot: {
  name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
}): string | undefined {
  return stringOrUndefined(snapshot.name)
    ?? ([stringOrUndefined(snapshot.first_name), stringOrUndefined(snapshot.last_name)]
      .filter(Boolean)
      .join(" ") || undefined);
}

function optionalIso(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

export function rankBookingCandidateProjections<
  T extends { confidence: "high" | "medium"; suggested: boolean },
>(rows: readonly T[]): T[] {
  const weight = (row: T) => (row.suggested ? 0 : row.confidence === "high" ? 1 : 2);
  return [...rows]
    .map((row, index) => ({ row, index }))
    .sort((left, right) => weight(left.row) - weight(right.row) || left.index - right.index)
    .map((entry) => entry.row);
}

async function loadRankedCandidateLeadViews(
  policyRows: readonly BookingLeadCandidateProjection[],
  leadModel?: "FormLead" | "CallLead",
): Promise<CandidateLeadEntry[]> {
  const wanted = rankBookingCandidateProjections(policyRows)
    .filter((candidate) => !leadModel || candidate.lead_ref.model === leadModel);
  const loaded = await Promise.all(
    wanted.map((candidate) =>
      loadCandidateLeadView(candidate.lead_ref.model, String(candidate.lead_ref.id))),
  );
  return wanted.flatMap((candidate, index) => {
    const lead = loaded[index];
    return lead
      ? [{ ref: { model: candidate.lead_ref.model, id: String(candidate.lead_ref.id) }, lead }]
      : [];
  });
}

function loadCandidateLeadView(
  model: "FormLead" | "CallLead",
  id: string,
): Promise<CandidateLeadView | null> {
  return model === "FormLead"
    ? getFormLeadModel().findById(id).select(FORM_CANDIDATE_LEAD_PROJECTION).lean<CandidateLeadView | null>()
    : getCallLeadModel().findById(id).select(CANDIDATE_LEAD_PROJECTION).lean<CandidateLeadView | null>();
}

async function loadLeadContactProjection(
  model: "FormLead" | "CallLead",
  id: string,
): Promise<CandidateLeadView | null> {
  const projection = {
    name: 1,
    first_name: 1,
    last_name: 1,
    phone_number: 1,
    email: 1,
    ingested_contact_snapshot: 1,
    granot_contact_snapshot: 1,
  };
  return model === "FormLead"
    ? getFormLeadModel().findById(id).select(projection).lean<CandidateLeadView | null>()
    : getCallLeadModel().findById(id).select(projection).lean<CandidateLeadView | null>();
}

/**
 * The Owner works these cases by calling the customer, so intake reads carry the
 * contact as it was captured. Masking belongs on surfaces nobody has to act on —
 * see `maskContactLabel` below, which still serves the discrepancy queue.
 */
export function projectOwnerVisibleContact(
  value: unknown,
): { name?: string; phone_number?: string; email?: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const joinedName = [stringOrUndefined(row.first_name), stringOrUndefined(row.last_name)]
    .filter(Boolean)
    .join(" ");
  const name = stringOrUndefined(row.display_name) ?? (joinedName || undefined);
  const phone = stringOrUndefined(row.phone_number) ?? stringOrUndefined(row.phone_raw);
  const email = stringOrUndefined(row.email) ?? stringOrUndefined(row.email_raw);
  return name || phone || email ? { name, phone_number: phone, email } : undefined;
}

const toContact = projectOwnerVisibleContact;

/** How one customer is named in an intake list: the name if we have it, else the way to reach them. */
export function customerLabel(contact?: {
  name?: string | null;
  phone_number?: string | null;
  email?: string | null;
}): string {
  return (
    stringOrUndefined(contact?.name)?.trim() ??
    stringOrUndefined(contact?.phone_number)?.trim() ??
    stringOrUndefined(contact?.email)?.trim() ??
    "No customer name on this job"
  );
}

function leadName(lead: { name?: string | null; first_name?: string | null; last_name?: string | null }): string | undefined {
  return lead.name ?? ([lead.first_name, lead.last_name].filter(Boolean).join(" ") || undefined);
}

export function maskContactLabel(contact?: {
  name?: string | null;
  phone_number?: string | null;
  email?: string | null;
}): string {
  if (!contact) return "Not provided";
  const name = contact.name?.trim();
  if (name) return `${name.slice(0, 1).toUpperCase()}•••`;
  const phone = contact.phone_number?.replace(/\D/g, "");
  if (phone) return `•••${phone.slice(-4)}`;
  const email = contact.email?.trim();
  if (email) {
    const [local, domain] = email.split("@");
    return `${local?.slice(0, 1) ?? "•"}•••@${domain ?? "masked"}`;
  }
  return "Not provided";
}

function maskLifecycleId(value: string): string {
  return value.length <= 10 ? "***" : `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function iso(value: unknown, field: string): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) {
    throw new GranotLifecycleError(
      `Unable to project ${field}`,
      GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      400,
    );
  }
  return date.toISOString();
}

function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor<T>(value: string, guard: (parsed: unknown) => parsed is T): T {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!guard(parsed)) throw new Error("invalid cursor shape");
    return parsed;
  } catch {
    throw validationError("cursor", "cursor is invalid");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTimelineCursor(value: unknown): value is TimelineCursor {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "event_at,id,type_priority") return false;
  return typeof value.event_at === "string" && Number.isFinite(Date.parse(value.event_at)) &&
    typeof value.type_priority === "number" && Number.isInteger(value.type_priority) &&
    typeof value.id === "string" && value.id.length > 0;
}

function isListCursor(value: unknown): value is ListCursor {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "id,sort_value") return false;
  return typeof value.sort_value === "string" && Number.isFinite(Date.parse(value.sort_value)) &&
    typeof value.id === "string" && /^[a-f0-9]{24}$/i.test(value.id);
}

function isCandidateCursor(value: unknown): value is { key: string } {
  return isRecord(value) && Object.keys(value).length === 1 &&
    typeof value.key === "string" && /^(FormLead|CallLead):[a-f0-9]{24}$/i.test(value.key);
}

function validationError(path: string, message: string): GranotLifecycleError {
  return new GranotLifecycleError(
    "Invalid request",
    GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
    400,
    undefined,
    [{ path, message }],
  );
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function flagsToNamedBooleans(
  flags: GranotLifecycleFlags,
): Record<(typeof GRANOT_LIFECYCLE_FLAG_NAMES)[number], boolean> {
  return {
    GRANOT_LIFECYCLE_PROCESSING_ENABLED: flags.processing_enabled,
    GRANOT_LIFECYCLE_SHADOW_MODE: flags.shadow_mode,
    GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED: flags.lead_writes_enabled,
    GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED: flags.lead_creation_enabled,
    GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED: flags.booking_cases_enabled,
    GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED: flags.booking_commands_enabled,
    GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED: flags.release_cases_enabled,
    GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED: flags.release_commands_enabled,
    GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED: flags.referral_booking_enabled,
    GRANOT_LIFECYCLE_EMAIL_ENABLED: flags.email_enabled,
  };
}

export async function projectGranotLifecycleHealth(
  now: Date = new Date(),
): Promise<GranotLifecycleHealthProjection> {
  const flags = getGranotLifecycleFlags();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const claimSince = new Date(now.getTime() - 60 * 60 * 1000);
  const [
    activation,
    receiptStates,
    due,
    expiredClaims,
    decisionCounts,
    openBookingCases,
    openReleaseCases,
    openBookingDiscrepancies,
    openReleaseDiscrepancies,
    commandConflicts,
    captureFailures,
    claimRecoveries,
    latencySamples,
    sourceRates,
    activeLinks,
    disputedLinks,
    lastQueue,
    lastCron,
    ringcentral,
  ] = await Promise.all([
    getGranotLifecycleActivationModel().findOne({ key: "granot_lifecycle" }).lean(),
    getGranotObservationReceiptModel()
      .aggregate<{ _id: ReceiptWorkState; count: number }>([
        { $group: { _id: "$processing.state", count: { $sum: 1 } } },
      ])
      .exec(),
    getGranotObservationReceiptModel()
      .aggregate<{
        due_count: number;
        oldest_due_at: Date | null;
      }>([
        { $match: dueWorkFilter(now) },
        {
          $group: {
            _id: null,
            due_count: { $sum: 1 },
            oldest_due_at: { $min: "$processing.next_attempt_at" },
          },
        },
      ])
      .exec(),
    getGranotObservationReceiptModel().countDocuments({
      "processing.state": "claimed",
      "processing.leased_until": { $lte: now },
    }),
    getSynchronizationDecisionModel()
      .aggregate<{
        _id: {
          execution_mode: ExecutionMode;
          outcome: SynchronizationOutcome;
          reason_code: SynchronizationReasonCode;
        };
        count: number;
      }>([
        { $match: { decided_at: { $gte: since } } },
        {
          $group: {
            _id: {
              execution_mode: "$execution_mode",
              outcome: "$outcome",
              reason_code: "$reason_code",
            },
            count: { $sum: 1 },
          },
        },
      ])
      .exec(),
    getGranotBookingReconciliationCaseModel()
      .aggregate<{ _id: string; count: number }>([
        { $match: { state: "open" } },
        { $group: { _id: "$mode", count: { $sum: 1 } } },
      ])
      .exec(),
    getGranotReleaseReconciliationCaseModel()
      .aggregate<{ _id: string; count: number }>([
        { $match: { state: "open" } },
        { $group: { _id: "release", count: { $sum: 1 } } },
      ])
      .exec(),
    getGranotBookingDiscrepancyModel()
      .aggregate<{ _id: GranotDiscrepancyReasonCode; count: number }>([
        { $match: { state: "open" } },
        { $group: { _id: "$reason_code", count: { $sum: 1 } } },
      ])
      .exec(),
    getGranotReleaseDiscrepancyModel()
      .aggregate<{ _id: GranotDiscrepancyReasonCode; count: number }>([
        { $match: { state: "open" } },
        { $group: { _id: "$reason_code", count: { $sum: 1 } } },
      ])
      .exec(),
    getOperationalEventModel()
      .aggregate<{ _id: string; count: number }>([
        {
          $match: {
            event_key: "granot_lifecycle.owner_command.conflict",
            occurred_at: { $gte: since },
          },
        },
        { $group: { _id: "$details.code", count: { $sum: 1 } } },
      ])
      .exec(),
    getOperationalEventModel().countDocuments({
      event_key: "granot_lifecycle.capture.failed",
      occurred_at: { $gte: since },
    }),
    getOperationalEventModel().countDocuments({
      event_key: "granot_lifecycle.claim.recovered",
      occurred_at: { $gte: claimSince },
    }),
    getSynchronizationDecisionModel()
      .aggregate<{ duration_ms: number }>([
        { $match: { decided_at: { $gte: since } } },
        {
          $lookup: {
            from: "granot_observations",
            localField: "observation_id",
            foreignField: "_id",
            as: "observation",
          },
        },
        { $unwind: "$observation" },
        {
          $project: {
            duration_ms: {
              $subtract: ["$decided_at", "$observation.captured_at"],
            },
          },
        },
      ])
      .exec(),
    getSynchronizationDecisionModel()
      .aggregate<{
        _id: { source_id?: unknown; outcome: SynchronizationOutcome };
        count: number;
      }>([
        { $match: { decided_at: { $gte: since } } },
        {
          $group: {
            _id: {
              source_id: "$source_policy.granot_crm_source_id",
              outcome: "$outcome",
            },
            count: { $sum: 1 },
          },
        },
      ])
      .exec(),
    getGranotRecordLinkModel().countDocuments({ state: "active" }),
    getGranotRecordLinkModel().countDocuments({ state: "active", disputed: true }),
    loadLastRun("queue"),
    loadLastRun("cron"),
    projectRingCentralHealth(now),
  ]);

  const by_work_state = Object.fromEntries(
    RECEIPT_WORK_STATES.map((state) => [state, 0]),
  ) as Record<ReceiptWorkState, number>;
  for (const row of receiptStates) {
    if (row._id in by_work_state) {
      by_work_state[row._id] = row.count;
    }
  }

  const dueRow = due[0];
  const oldestDue = dueRow?.oldest_due_at ? new Date(dueRow.oldest_due_at) : null;
  const open_cases = [
    ...openBookingCases
      .filter((row) => (GRANOT_LIFECYCLE_CASE_MODES as readonly string[]).includes(row._id))
      .map((row) => ({ kind: "booking" as const, mode: row._id, count: row.count })),
    ...openReleaseCases.map((row) => ({
      kind: "release" as const,
      mode: "release",
      count: row.count,
    })),
  ].sort((a, b) => a.kind.localeCompare(b.kind) || a.mode.localeCompare(b.mode));

  const open_discrepancies = [
    ...openBookingDiscrepancies.map((row) => ({
      kind: "booking" as const,
      reason_code: row._id,
      count: row.count,
    })),
    ...openReleaseDiscrepancies.map((row) => ({
      kind: "release" as const,
      reason_code: row._id,
      count: row.count,
    })),
  ]
    .filter((row) =>
      (GRANOT_LIFECYCLE_DISCREPANCY_REASON_CODES as readonly string[]).includes(row.reason_code),
    )
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.reason_code.localeCompare(b.reason_code));

  const command_conflicts_last_24h = commandConflicts
    .filter((row) => typeof row._id === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(row._id))
    .map((row) => ({ code: row._id, count: row.count }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const decisions_last_24h = decisionCounts
    .map((row) => ({
      execution_mode: row._id.execution_mode,
      outcome: row._id.outcome,
      reason_code: row._id.reason_code,
      count: row.count,
    }))
    .sort((a, b) =>
      a.execution_mode.localeCompare(b.execution_mode)
      || a.outcome.localeCompare(b.outcome)
      || a.reason_code.localeCompare(b.reason_code),
    );

  const enabledRates = await sourceRatesForEnabledSources(sourceRates);
  const latency = latencySamples
    .map((row) => row.duration_ms)
    .filter((value) => Number.isFinite(value) && value >= 0);

  const alerts = evaluateGranotLifecycleAlerts({
    oldest_due_age_ms: oldestDue ? Math.max(0, now.getTime() - oldestDue.getTime()) : null,
    oldest_due_threshold_since: oldestDue
      ? new Date(oldestDue.getTime() + GRANOT_LIFECYCLE_ALERT_THRESHOLDS.oldest_due_ms)
      : null,
    dead_letter_count: by_work_state.dead_letter,
    capture_503_count_24h: captureFailures,
    claim_recoveries_1h: claimRecoveries,
    capture_to_decision_samples_24h: latency,
    ringcentral_lease_held: ringcentral.lease.held,
    ringcentral_lease_age_ms: ringcentral.lease.age_ms,
    source_rates: enabledRates,
  }, now);
  await persistGranotLifecycleAlertTransitions(alerts, now);

  const health: GranotLifecycleHealthProjection = {
    generated_at: now.toISOString(),
    flags: flagsToNamedBooleans(flags),
    activation: activation
      ? {
          present: true,
          id: maskLifecycleId(String(activation._id)),
          activated_at: new Date(activation.activated_at).toISOString(),
          processor_version: activation.processor_version,
        }
      : { present: false },
    receipts: {
      by_work_state,
      due_count: dueRow?.due_count ?? 0,
      oldest_due_at: oldestDue ? oldestDue.toISOString() : null,
      oldest_due_age_ms: oldestDue ? Math.max(0, now.getTime() - oldestDue.getTime()) : null,
      claimed_count: by_work_state.claimed,
      expired_claim_count: expiredClaims,
      dead_letter_count: by_work_state.dead_letter,
    },
    decisions_last_24h,
    open_cases,
    open_discrepancies,
    command_conflicts_last_24h,
    record_links: { active: activeLinks, disputed: disputedLinks },
    last_queue_run: lastQueue,
    last_cron_run: lastCron,
    ringcentral,
    alerts,
  };
  applyDueGauges({
    due_count: health.receipts.due_count,
    oldest_due_age_ms: health.receipts.oldest_due_age_ms,
  });
  for (const row of open_cases) {
    if ((GRANOT_LIFECYCLE_CASE_MODES as readonly string[]).includes(row.mode)) {
      setGranotLifecycleOpenCases(row.kind, row.mode as GranotLifecycleCaseMode, row.count);
    }
  }
  for (const row of open_discrepancies) {
    setGranotLifecycleOpenDiscrepancies(row.kind, row.reason_code, row.count);
  }
  assertProjectionSafe(health);
  return health;
}

async function projectRingCentralHealth(now: Date): Promise<GranotLifecycleRingCentralHealth> {
  const empty: GranotLifecycleRingCentralHealth = {
    state_present: false,
    last_run_at: null,
    last_run_status: null,
    cursor_to: null,
    lease: { held: false, acquired_at: null, expires_at: null, age_ms: null, expired: false },
    last_runtime_ms: null,
    last_adopted_count: null,
    last_adoption_conflict_count: null,
    last_throttled_count: null,
  };
  try {
    const state = await getCallLogSyncState();
    if (!state) return empty;
    const acquired = state.lease_acquired_at ? new Date(state.lease_acquired_at) : null;
    const expires = state.leased_until ? new Date(state.leased_until) : null;
    const held = Boolean(expires && expires.getTime() > now.getTime());
    const expired = Boolean(expires && expires.getTime() <= now.getTime());
    return {
      state_present: true,
      last_run_at: state.lastRunAt ? new Date(state.lastRunAt).toISOString() : null,
      last_run_status: state.lastRunStatus,
      cursor_to: state.lastSyncTo ? new Date(state.lastSyncTo).toISOString() : null,
      lease: {
        held,
        acquired_at: acquired ? acquired.toISOString() : null,
        expires_at: expires ? expires.toISOString() : null,
        age_ms: acquired ? Math.max(0, now.getTime() - acquired.getTime()) : null,
        expired,
      },
      last_runtime_ms: state.last_runtime_ms ?? null,
      last_adopted_count: state.last_adopted_count ?? null,
      last_adoption_conflict_count: state.last_adoption_conflict_count ?? null,
      last_throttled_count: state.last_throttled_count ?? null,
    };
  } catch {
    return empty;
  }
}

async function sourceRatesForEnabledSources(
  rows: Array<{ _id: { source_id?: unknown; outcome: SynchronizationOutcome }; count: number }>,
): Promise<Array<{ scope_ref: string; numerator: number; denominator: number }>> {
  const bySource = new Map<string, { numerator: number; denominator: number }>();
  for (const row of rows) {
    const sourceId = row._id.source_id != null ? String(row._id.source_id) : "";
    if (!sourceId) continue;
    const current = bySource.get(sourceId) ?? { numerator: 0, denominator: 0 };
    current.denominator += row.count;
    if (row._id.outcome === "ambiguous" || row._id.outcome === "policy_blocked") {
      current.numerator += row.count;
    }
    bySource.set(sourceId, current);
  }
  if (bySource.size === 0) return [];
  const enabled = await getGranotCrmSourceModel()
    .find({
      _id: {
        $in: [...bySource.keys()].flatMap((id) => {
          try {
            return [toObjectId(id)];
          } catch {
            return [];
          }
        }),
      },
      lifecycle_disposition: { $ne: "deferred" },
      enabled: true,
      lifecycle_enabled: true,
    })
    .select({ _id: 1 })
    .lean();
  const enabledIds = new Set(enabled.map((row) => String(row._id)));
  return [...bySource.entries()]
    .filter(([id]) => enabledIds.has(id))
    .map(([id, counts]) => ({
      scope_ref: maskLifecycleId(id) ?? "***",
      numerator: counts.numerator,
      denominator: counts.denominator,
    }))
    .sort((a, b) => a.scope_ref.localeCompare(b.scope_ref));
}

async function loadLastRun(
  trigger: "queue" | "cron",
): Promise<GranotLifecycleLastRunProjection> {
  const row = await getOperationalEventModel()
    .findOne({
      event_key: {
        $in: [
          `granot_lifecycle.${trigger}.run.completed`,
          `granot_lifecycle.${trigger}.run.failed`,
        ],
      },
    })
    .sort({ occurred_at: -1, _id: -1 })
    .lean();
  if (!row) {
    return null;
  }
  return {
    at: new Date(row.occurred_at).toISOString(),
    status: row.event_key.endsWith(".failed") ? "failed" : "completed",
  };
}

export function projectCaseDetailPriorityPairing(input: {
  kind: "booking" | "release";
  evidence: Array<{
    observation_id: { toString(): string } | string;
    captured_at: Date | string;
    action: "priority_5" | "booked" | "release";
  }>;
  creating?: Pick<
    GranotObservationDocument,
    | "_id"
    | "receipt_id"
    | "captured_at"
    | "route_event_class"
    | "payload_event_type_raw"
    | "priority"
    | "identity"
    | "booking_action"
  >;
  jobObservations: Array<
    Pick<
      GranotObservationDocument,
      | "_id"
      | "receipt_id"
      | "captured_at"
      | "route_event_class"
      | "payload_event_type_raw"
      | "priority"
      | "identity"
    >
  >;
}): BookingPriorityPairingProjection | null {
  if (input.kind !== "booking") return null;
  const selected = selectCreatingObservationEvidence(input.evidence);
  if (!selected || selected.item.action !== "booked" || !input.creating) return null;
  if (input.creating.booking_action?.normalized !== "booked") return null;
  return toBookingPriorityPairingProjection(projectBookingPriorityPairing({
    creating_booked: input.creating,
    job_observations: input.jobObservations,
  }));
}

export function compactCaseListPriorityPairing(input: {
  kind: "booking" | "release";
  evidence: Array<{
    observation_id: { toString(): string } | string;
    captured_at: Date | string;
    action: "priority_5" | "booked" | "release";
  }>;
  snapshot?: GranotBookingReconciliationCaseDocument["priority_pairing"];
  pairing?: ReturnType<typeof projectBookingPriorityPairing> | null;
  has_later_priority_5: boolean;
}): BookingPriorityPairingListItem | undefined {
  if (input.kind === "release") return undefined;
  const selected = selectCreatingObservationEvidence(input.evidence);
  if (!selected || selected.item.action !== "booked") return undefined;
  if (input.pairing) {
    return {
      ...toListPriorityPairing(input.pairing),
      has_later_priority_5: input.has_later_priority_5,
    };
  }
  if (input.snapshot) {
    return {
      pairing: input.snapshot.pairing,
      creating_booked_priority_is_5: input.snapshot.creating_booked_priority_is_5,
      has_preceding_priority_5: Boolean(input.snapshot.preceding_priority_5_observation_id),
      has_later_priority_5: input.has_later_priority_5,
    };
  }
  return undefined;
}

async function listPriorityPairingByCase(
  rows: LifecycleCaseListRow[],
): Promise<Map<string, BookingPriorityPairingListItem>> {
  const result = new Map<string, BookingPriorityPairingListItem>();
  const bookingRows = rows.flatMap((row) => {
    if (row.kind !== "booking") return [];
    const selected = selectCreatingObservationEvidence(row.evidence);
    return selected?.item.action === "booked" ? [{ row, selected }] : [];
  });
  if (bookingRows.length === 0) return result;

  const jobNos = [...new Set(bookingRows.map((item) => item.row.normalized_job_no))];
  const priorityFives = await getGranotObservationModel()
    .find({
      "identity.normalized_job_no": { $in: jobNos },
      route_event_class: "priority_updated",
      "priority.valid": true,
      "priority.canonical": "5",
    })
    .select({
      _id: 1,
      receipt_id: 1,
      captured_at: 1,
      route_event_class: 1,
      payload_event_type_raw: 1,
      priority: 1,
      identity: 1,
    })
    .lean();

  const missingSnapshotIds = bookingRows
    .filter((item) => !item.row.priority_pairing)
    .map((item) => toObjectId(String(item.selected.item.observation_id)));
  const creatingDocs = missingSnapshotIds.length
    ? await getGranotObservationModel().find({ _id: { $in: missingSnapshotIds } }).lean()
    : [];
  const creatingById = new Map(creatingDocs.map((doc) => [String(doc._id), doc]));

  for (const { row, selected } of bookingRows) {
    const creatingId = String(selected.item.observation_id);
    const creatingTuple = {
      captured_at: new Date(selected.item.captured_at),
      observation_id: creatingId,
    };
    const hasLater = priorityFives.some((observation) =>
      observation.identity?.normalized_job_no === row.normalized_job_no &&
      compareGranotTemporal(creatingTuple, {
        captured_at: observation.captured_at,
        observation_id: String(observation._id),
      }) === "older",
    );
    const compact = compactCaseListPriorityPairing({
      kind: "booking",
      evidence: row.evidence,
      snapshot: row.priority_pairing,
      pairing: (() => {
        const creating = creatingById.get(creatingId);
        if (!creating || creating.booking_action?.normalized !== "booked") return null;
        return projectBookingPriorityPairing({
          creating_booked: creating,
          job_observations: priorityFives,
        });
      })(),
      has_later_priority_5: hasLater,
    });
    if (compact) result.set(String(row._id), compact);
  }
  return result;
}

export const JOB_PROJECTION_FORBIDDEN_KEYS = [
  "payload",
  "raw_payload",
  "headers",
  "address",
  "authorization",
  "cookie",
  "x-api-secret",
  "secret",
  "credential",
  "credentials",
  "password",
  "token",
] as const;

export function collectForbiddenProjectionKeys(
  value: unknown,
  found: Set<string> = new Set(),
): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectForbiddenProjectionKeys(entry, found);
    }
    return [...found];
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLowerCase();
      if (
        JOB_PROJECTION_FORBIDDEN_KEYS.some(
          (forbidden) => normalized === forbidden.toLowerCase(),
        )
      ) {
        found.add(key);
      }
      collectForbiddenProjectionKeys(child, found);
    }
  }
  return [...found];
}

export function assertProjectionSafe(projection: unknown): void {
  const forbidden = collectForbiddenProjectionKeys(projection);
  if (forbidden.length > 0) {
    throw new Error(`Lifecycle projection leaked forbidden keys: ${forbidden.join(",")}`);
  }
}

export const assertJobProjectionMasked = assertProjectionSafe;
