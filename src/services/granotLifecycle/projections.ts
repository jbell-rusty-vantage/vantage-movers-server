import {
  getGranotLifecycleFlags,
  GRANOT_LIFECYCLE_FLAG_NAMES,
  type GranotLifecycleFlags,
} from "../../config/domain/granotLifecycle";
import { getGranotLifecycleActivationModel } from "../../models/GranotLifecycleActivation";
import { getGranotBookingReconciliationCaseModel } from "../../models/GranotBookingReconciliationCase";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { getOperationalEventModel } from "../../models/OperationalEvent";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { getEntityChangeModel } from "../../models/EntityChange";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { getFormLeadModel } from "../../models/FormLead";
import { getCallLeadModel } from "../../models/CallLead";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { RECEIPT_WORK_STATES } from "../../models/granotLifecycleSchemas";
import { applyDueGauges } from "./drainer";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import {
  projectBookingCandidateBrowserPolicy,
  searchBookingLeadCandidates,
} from "./bookingReconciliation";
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
  SynchronizationOutcome,
  SynchronizationReasonCode,
} from "./types";
import type {
  GranotLifecycleCandidateQuery,
  GranotLifecycleCaseListQuery,
  GranotLifecycleTimelineQuery,
} from "../../validation/v1/granotLifecycle.validation";

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
  customer_name: string | null;
  source: string;
  merchant: string;
  deposit_amount: number;
  total_binder_amount: number;
  agent_allocations: Array<{ agent_name: string; binder_amount: number }>;
  domain_revision: number;
  lead_ref?: EntityRef;
};

export type SafeCancellationProjection = {
  id: string;
  booking_id: string;
  cancel_date: string;
  reason?: string;
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
  source: { id?: string; label?: string };
  masked_contact_label: string;
  latest_action: "priority_5" | "booked" | "release";
  evidence_count: number;
  case_revision: number;
  evidence_revision: number;
  deterministic_booking: { present: boolean; masked_ref?: string };
  opened_at: string;
  last_evidence_at: string;
  resolved_at?: string;
};

export type GranotLifecycleCaseListPage = {
  items: GranotLifecycleCaseListItem[];
  next_cursor: string | null;
};

export type GranotLifecycleCaseDetail = {
  case_id: string;
  kind: "booking";
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
  capabilities: {
    commands: false;
    referral: boolean;
    release_cases: boolean;
    discrepancies: boolean;
  };
};

export type GranotLifecycleCandidateItem = {
  lead_ref: EntityRef;
  masked_contact_label: string;
  job_no?: string;
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

export type GranotLifecycleHealthProjection = {
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
  record_links: { active: number; disputed: number };
  last_queue_run: GranotLifecycleLastRunProjection;
  last_cron_run: GranotLifecycleLastRunProjection;
};

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
  if (query.kind === "release") return { items: [], next_cursor: null };
  const sortField = query.sort ?? "last_evidence_at";
  const order = query.order ?? "desc";
  const direction = order === "asc" ? 1 : -1;
  const filter: Record<string, unknown> = {};
  if (query.state) filter.state = query.state;
  if (query.mode) filter.mode = query.mode;
  if (query.source_id) filter["source_scope.granot_crm_source_id"] = query.source_id;
  if (query.normalized_job_no) {
    const normalized = normalizeJobNo(query.normalized_job_no);
    if (!normalized) throw validationError("normalized_job_no", "must normalize to a Job Number");
    filter.normalized_job_no = normalized;
  }
  if (query.opened_from || query.opened_to) {
    filter.opened_at = {
      ...(query.opened_from ? { $gte: new Date(query.opened_from) } : {}),
      ...(query.opened_to ? { $lte: new Date(query.opened_to) } : {}),
    };
  }
  if (query.cursor) {
    const cursor = decodeCursor<ListCursor>(query.cursor, isListCursor);
    const operator = direction === 1 ? "$gt" : "$lt";
    filter.$or = [
      { [sortField]: { [operator]: new Date(cursor.sort_value) } },
      { [sortField]: new Date(cursor.sort_value), _id: { [operator]: cursor.id } },
    ];
  }
  const rows = await getGranotBookingReconciliationCaseModel()
    .find(filter)
    .sort({ [sortField]: direction, _id: direction })
    .limit(query.limit + 1)
    .lean();
  const visible = rows.slice(0, query.limit);
  const sourceIds = [...new Set(visible.flatMap((row) =>
    row.source_scope ? [String(row.source_scope.granot_crm_source_id)] : []))];
  const sources = sourceIds.length
    ? await getGranotCrmSourceModel().find({ _id: { $in: sourceIds } }).select({ granot_label: 1 }).lean()
    : [];
  const sourceLabels = new Map(sources.map((source) => [String(source._id), source.granot_label]));
  const items = visible.map((row) => {
    const sourceId = row.source_scope ? String(row.source_scope.granot_crm_source_id) : undefined;
    const latest = [...row.evidence].sort((a, b) =>
      new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime())[0];
    return {
      case_id: String(row._id),
      kind: "booking" as const,
      state: row.state,
      mode: row.mode,
      sequence_number: row.sequence_number,
      normalized_job_no: row.normalized_job_no,
      job_no: row.job_no_snapshot,
      source: { id: sourceId, label: sourceId ? sourceLabels.get(sourceId) : undefined },
      masked_contact_label: maskContactLabel(row.observed_context.contact),
      latest_action: latest?.action ?? "booked",
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
    } satisfies GranotLifecycleCaseListItem;
  });
  const last = visible.at(-1);
  const result: GranotLifecycleCaseListPage = {
    items,
    next_cursor: rows.length > query.limit && last
      ? encodeCursor({ sort_value: iso(last[sortField], `case.${sortField}`), id: String(last._id) })
      : null,
  };
  assertProjectionSafe(result);
  return result;
}

export async function getGranotLifecycleCaseDetail(
  caseId: string,
): Promise<GranotLifecycleCaseDetail | null> {
  const row = await getGranotBookingReconciliationCaseModel().findById(caseId).lean();
  if (!row) return null;
  const observationIds = row.evidence.map((item) => item.observation_id);
  const decisionIds = row.evidence.map((item) => item.decision_id);
  const [observations, decisions, link, booking, employeeCase] = await Promise.all([
    getGranotObservationModel().find({ _id: { $in: observationIds } }).lean(),
    getSynchronizationDecisionModel().find({ _id: { $in: decisionIds } }).lean(),
    row.record_link_id ? getGranotRecordLinkModel().findById(row.record_link_id).lean() : null,
    row.deterministic_booking_id ? BookedLead.findById(row.deterministic_booking_id).lean() : null,
    row.deterministic_booking_id
      ? BookingLeadReconciliationCase.findOne({ booking: row.deterministic_booking_id }).lean()
      : null,
  ]);
  const cancellation = booking
    ? await CancelledLead.findOne({ booked_lead: booking._id }).lean()
    : null;
  const observationById = new Map(observations.map((item) => [String(item._id), item]));
  const decisionById = new Map(decisions.map((item) => [String(item._id), item]));
  const leadRef = row.suggested_lead?.lead_ref ?? link?.lead_ref;
  const lead = leadRef ? await loadLeadContactProjection(leadRef.model, String(leadRef.id)) : null;
  const timeline = await projectGranotJob(row.normalized_job_no, { limit: DEFAULT_TIMELINE_LIMIT });
  const safeBooking = booking ? projectBooking(booking) : undefined;
  const safeCancellation = cancellation ? projectCancellation(cancellation) : undefined;
  const result: GranotLifecycleCaseDetail = {
    case_id: String(row._id),
    kind: "booking",
    state: row.state,
    mode: row.mode,
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
    contacts: projectLeadContacts(lead),
    suggestion: row.suggested_lead ? {
      lead_ref: { model: row.suggested_lead.lead_ref.model, id: String(row.suggested_lead.lead_ref.id) },
      confidence: row.suggested_lead.confidence,
      match_method: row.suggested_lead.match_method,
      reason_codes: row.suggested_lead.reason_codes,
    } : undefined,
    candidate_search: {
      available: row.mode !== "create_referral_booking",
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
    capabilities: {
      commands: false,
      referral: row.mode === "create_referral_booking",
      release_cases: false,
      discrepancies: false,
    },
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
  const items = visible.map(({ ref, lead }) => {
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
      masked_contact_label: maskContactLabel({
        name: leadName(lead),
        phone_number: lead.phone_number,
        email: lead.email,
      }),
      job_no: lead.job_no ?? undefined,
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

async function buildTimelineForJob(
  normalizedJobNo: string,
): Promise<Omit<GranotTimelinePage, "next_cursor">> {
  const [links, observations, cases, booking] = await Promise.all([
    getGranotRecordLinkModel()
      .find({ provider: "granot", normalized_job_no: normalizedJobNo })
      .lean(),
    getGranotObservationModel()
      .find({ "identity.normalized_job_no": normalizedJobNo })
      .lean(),
    getGranotBookingReconciliationCaseModel()
      .find({ normalized_job_no: normalizedJobNo })
      .lean(),
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
  for (const caseRow of cases) {
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
          kind: "booking",
          event: index === 0 ? "opened" : "refreshed",
          state: caseRow.state,
          mode: caseRow.mode,
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
          kind: "booking",
          event: "resolved",
          state: "resolved",
          mode: caseRow.mode,
          sequence_number: caseRow.sequence_number,
          case_revision: caseRow.case_revision,
          evidence_revision: caseRow.evidence_revision,
        },
      });
    }
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
    release_cases: false,
    discrepancies: false,
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
  agent_allocations: Array<{ agent_name_snapshot: string; binder_amount: number }>;
  domain_revision: number;
  lead_ref?: unknown;
  lead_model?: "FormLead" | "CallLead" | null;
}): SafeBookingProjection {
  return {
    id: String(booking._id),
    normalized_job_no: booking.normalized_job_no ?? "",
    job_no: booking.job_no ?? null,
    book_date: iso(booking.book_date, "booking.book_date"),
    customer_name: booking.customer_name ?? null,
    source: booking.source,
    merchant: booking.merchant,
    deposit_amount: booking.deposit_amount,
    total_binder_amount: booking.total_binder_amount,
    agent_allocations: booking.agent_allocations.map((allocation) => ({
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
    reason: cancellation.reason ?? undefined,
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
  if (query.q) {
    const search = new RegExp(escapeRegExp(query.q), "i");
    common.$or = [
      { name: search },
      { first_name: search },
      { last_name: search },
      { phone_number: search },
      { email: search },
      { job_no: search },
      { ref_no: search },
    ];
  }
  const projection = {
    name: 1,
    first_name: 1,
    last_name: 1,
    phone_number: 1,
    email: 1,
    job_no: 1,
    normalized_job_no: 1,
    ref_no: 1,
    lead_source_company: 1,
    source_company_label_snapshot: 1,
    source_granularity_id: 1,
    source_granularity_label_snapshot: 1,
  };
  const [cursorModel, cursorId] = cursorKey?.split(":") ?? [];
  const formFilter: Record<string, unknown> = { ...common, duplicate: { $ne: true }, bad_lead: null };
  const callFilter: Record<string, unknown> = { ...common };
  if (cursorModel === "FormLead" && cursorId) formFilter._id = { $gt: cursorId };
  if (cursorModel === "CallLead" && cursorId) callFilter._id = { $gt: cursorId };
  const [forms, calls] = await Promise.all([
    query.lead_model === "CallLead"
      ? Promise.resolve([] as CandidateLeadView[])
      : getFormLeadModel()
          .find(formFilter)
          .select(projection)
          .sort({ _id: 1 })
          .limit(query.limit + 1)
          .lean<CandidateLeadView[]>(),
    query.lead_model === "FormLead" || cursorModel === "FormLead"
      ? Promise.resolve([] as CandidateLeadView[])
      : getCallLeadModel()
          .find(callFilter)
          .select(projection)
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

function toContact(value: unknown): { name?: string; phone_number?: string; email?: string } | undefined {
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
  const [
    activation,
    receiptStates,
    due,
    expiredClaims,
    decisionCounts,
    activeLinks,
    disputedLinks,
    lastQueue,
    lastCron,
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
        {
          $match: {
            "processing.state": { $in: ["pending", "retry_scheduled", "claimed"] },
            "processing.next_attempt_at": { $lte: now },
          },
        },
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
    getGranotRecordLinkModel().countDocuments({ state: "active" }),
    getGranotRecordLinkModel().countDocuments({ state: "active", disputed: true }),
    loadLastRun("queue"),
    loadLastRun("cron"),
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
  const health: GranotLifecycleHealthProjection = {
    flags: flagsToNamedBooleans(flags),
    activation: activation
      ? {
          present: true,
          id: String(activation._id),
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
    decisions_last_24h: decisionCounts.map((row) => ({
      execution_mode: row._id.execution_mode,
      outcome: row._id.outcome,
      reason_code: row._id.reason_code,
      count: row.count,
    })),
    record_links: { active: activeLinks, disputed: disputedLinks },
    last_queue_run: lastQueue,
    last_cron_run: lastCron,
  };
  applyDueGauges({
    due_count: health.receipts.due_count,
    oldest_due_age_ms: health.receipts.oldest_due_age_ms,
  });
  return health;
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
