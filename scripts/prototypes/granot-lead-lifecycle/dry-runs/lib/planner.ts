import mongoose from "mongoose";
import { BookedLead } from "../../../../../src/models/BookedLead.js";
import { BookingLeadReconciliationCase } from "../../../../../src/models/BookingLeadReconciliationCase.js";
import { CancelledLead } from "../../../../../src/models/CancelledLead.js";
import { getCallLeadModel } from "../../../../../src/models/CallLead.js";
import { getFormLeadModel } from "../../../../../src/models/FormLead.js";
import { getGranotRecordLinkModel } from "../../../../../src/models/GranotRecordLink.js";
import { getLeadSourceCompanyModel } from "../../../../../src/models/LeadSourceCompany.js";
import type { GranotObservationDocument } from "../../../../../src/models/GranotObservation.js";
import {
  classifyExecutionMode,
  getGranotLifecycleFlags,
  type GranotLifecycleFlags,
} from "../../../../../src/config/domain/granotLifecycle.js";
import type { SourceCompany } from "../../../../../src/config/domain/sources.js";
import {
  classifyBookingReconciliation,
  projectBookingLeadCandidates,
  toBookingLeadSuggestion,
  type BookingReconciliationClassification,
  type BookingReconciliationCurrentContext,
} from "../../../../../src/services/granotLifecycle/bookingReconciliation.js";
import {
  createMongoLeadIdentityStore,
  resolveLeadIdentity,
  type LeadIdentityResult,
} from "../../../../../src/services/granotLifecycle/identity.js";
import {
  evaluateMinimumCreationData,
  planLeadDesiredState,
  type LeadDesiredStatePlan,
  type LeadDesiredStateProjection,
} from "../../../../../src/services/granotLifecycle/leadDesiredState.js";
import {
  normalizeGranotReceipt,
  type NormalizedObservationCandidate,
} from "../../../../../src/services/granotLifecycle/normalization.js";
import {
  isGranotRouteEventClass,
} from "../../../../../src/services/granotLifecycle/receiptCompatibility.js";
import {
  createMongoSourcePolicyStore,
  evaluateEffectGates,
  resolveSourcePolicy,
  type EffectGateEvaluation,
  type RequestedLifecycleEffect,
  type SourcePolicyResolution,
  type SourcePolicySnapshot,
  type SourcePolicyStore,
} from "../../../../../src/services/granotLifecycle/sourcePolicy.js";
import { compareGranotTemporal } from "../../../../../src/services/granotLifecycle/granotTemporal.js";
import type {
  ExecutionMode,
  GranotRouteEventClass,
} from "../../../../../src/services/granotLifecycle/types.js";
import { findPreCreationRingCentralConvergenceCandidates } from "../../../../../src/services/ringcentral/callLeadConvergence.service.js";
import { classifyRingCentralCallLeadDuplicate } from "../../../../../src/services/ringcentral/ringcentral-duplicate-guard.js";
import { classifyRefNo, maskId, redactContact } from "./redact.js";

export type LegacyWebhookReceipt = {
  _id: mongoose.Types.ObjectId;
  event_type?: string;
  route_event_class?: string;
  received_at?: Date;
  captured_at?: Date;
  createdAt?: Date;
  payload?: Record<string, unknown>;
  processing_status?: string;
};

export type DryRunPolicyMode = "as_configured" | "hypothetical_observation_only" | "hypothetical_create_if_missing";

export type RingCentralDryRun = {
  selected_lead_model?: string;
  pre_creation_candidates: number;
  pre_creation_ids: string[];
  duplicate?: {
    isDuplicate: boolean;
    reason: string;
    matchCount: number;
    existingLeadId?: string;
  };
  matched_call_lead?: {
    id: string;
    ingestion_origin?: string;
    has_ringcentral_ids: boolean;
    convergence_state?: string;
    duplicate: boolean;
  };
  existing_call_leads_by_job: number;
};

export type PolicyDryRun = {
  mode: DryRunPolicyMode;
  policy_ok: boolean;
  policy_outcome?: string;
  policy_reason?: string;
  snapshot?: {
    granot_crm_source_id: string;
    lead_source_company_id?: string;
    source_granularity_id?: string;
    selected_lead_model?: string;
    selected_move_type?: string;
    selected_route_key?: string;
    lifecycle_disposition: string;
    lead_created_policy: string;
    operational_enabled?: boolean;
    lifecycle_enabled?: boolean;
    source_company_active?: boolean;
    source_granularity_active?: boolean;
  };
  identity?: {
    outcome: string;
    reason_code: string;
    match_method?: string;
    target?: { model: string; id: string };
    target_eligibility?: string;
    candidate_count: number;
    booking_present: boolean;
    referral_leadless?: boolean;
  };
  matched_lead?: {
    model: string;
    id: string;
    ingestion_origin?: string;
    job_no?: string;
    normalized_job_no?: string;
    quoted?: boolean;
    granot_priority?: string;
  };
  plan?: {
    outcome: string;
    reason_code: string;
    creation_eligibility?: string;
    creation_model?: string;
    changed_paths: string[];
  };
  minimum_creation?: { eligibility: string; reason_code?: string };
  requested_effect?: RequestedLifecycleEffect;
  gates?: {
    allowed: boolean;
    outcome: string;
    reason: string;
    blocked: string[];
  };
  gated_outcome?: { outcome: string; reason_code: string };
  booking?: {
    would_enter_booking_path: boolean;
    classification: BookingReconciliationClassification;
    suggestion?: { model: string; id: string; confidence: string; match_method: string };
    candidate_count: number;
  };
  ringcentral?: RingCentralDryRun;
};

export type ReceiptDryRun = {
  receipt_id: string;
  event_type?: string;
  payload_event_type?: string;
  source?: string;
  job_no?: string;
  service_type?: string;
  ref_no_kind: ReturnType<typeof classifyRefNo>;
  captured_at?: string;
  normalization: {
    result: string;
    kind?: string;
    booking_action?: string;
    priority?: string;
    priority_valid: boolean;
    issue_codes: string[];
    normalized_source_label?: string;
    has_job: boolean;
    has_phone: boolean;
    has_name: boolean;
    origin_state?: string;
    destination_state?: string;
  };
  execution_mode: ExecutionMode;
  flags: GranotLifecycleFlags;
  policies: PolicyDryRun[];
};

function emptyPolicySnapshot(): SourcePolicySnapshot {
  return {
    granot_crm_source_id: "",
    lifecycle_disposition: "deferred",
    lead_created_policy: "observation_only",
    operational_enabled: false,
    lifecycle_enabled: false,
    source_company_active: false,
    source_granularity_active: false,
  };
}

export function receiptToObservation(
  receipt: LegacyWebhookReceipt,
): {
  route_event_class?: GranotRouteEventClass;
  captured_at: Date;
  candidate: NormalizedObservationCandidate;
  observation: GranotObservationDocument;
} {
  const captured_at = coerceDate(receipt.captured_at)
    ?? coerceDate(receipt.received_at)
    ?? coerceDate(receipt.createdAt)
    ?? new Date();
  const route_event_class = isGranotRouteEventClass(receipt.route_event_class)
    ? receipt.route_event_class
    : isGranotRouteEventClass(receipt.event_type)
      ? receipt.event_type
      : undefined;
  if (!route_event_class) {
    throw new Error(`Receipt ${String(receipt._id)} has no route_event_class`);
  }
  const candidate = normalizeGranotReceipt({
    _id: receipt._id,
    observation_channel: "granot_webhook",
    captured_at,
    route_event_class,
    payload: receipt.payload ?? {},
  });
  const observation = {
    _id: new mongoose.Types.ObjectId(),
    receipt_id: receipt._id,
    ...candidate,
    createdAt: captured_at,
    updatedAt: captured_at,
  } as GranotObservationDocument;
  return { route_event_class, captured_at, candidate, observation };
}

export async function planReceipt(input: {
  receipt: LegacyWebhookReceipt;
  flags: GranotLifecycleFlags;
  now: Date;
  stores: Array<{ mode: DryRunPolicyMode; store: SourcePolicyStore }>;
}): Promise<ReceiptDryRun> {
  const { observation, captured_at, candidate } = receiptToObservation(input.receipt);
  const payload = asRecord(input.receipt.payload);
  const execution_mode = classifyExecutionMode({
    captured_at,
    activated_at: null,
    shadow_mode: input.flags.shadow_mode,
  });
  const policies: PolicyDryRun[] = [];
  for (const entry of input.stores) {
    policies.push(
      await planPolicy({
        observation,
        flags: input.flags,
        execution_mode,
        now: input.now,
        mode: entry.mode,
        store: entry.store,
      }),
    );
  }
  return {
    receipt_id: String(input.receipt._id),
    event_type: input.receipt.event_type,
    payload_event_type: stringValue(payload.event_type),
    source: stringValue(payload.source),
    job_no: stringValue(payload.job_no) || observation.identity?.normalized_job_no,
    service_type: stringValue(payload.service_type),
    ref_no_kind: classifyRefNo(stringValue(payload.ref_no)),
    captured_at: captured_at.toISOString(),
    normalization: {
      result: candidate.normalization_result,
      kind: candidate.kind,
      booking_action: candidate.booking_action?.normalized,
      priority: candidate.priority?.canonical,
      priority_valid: candidate.priority?.valid === true,
      issue_codes: candidate.issues.map((issue) => issue.code),
      normalized_source_label: candidate.normalized_source_label,
      has_job: Boolean(candidate.identity.normalized_job_no),
      has_phone: Boolean(candidate.contact.normalized_phone),
      has_name: Boolean(
        candidate.contact.first_name || candidate.contact.last_name || candidate.contact.display_name,
      ),
      origin_state: candidate.move.origin?.state,
      destination_state: candidate.move.destination?.state,
    },
    execution_mode,
    flags: input.flags,
    policies,
  };
}

async function planPolicy(input: {
  observation: GranotObservationDocument;
  flags: GranotLifecycleFlags;
  execution_mode: ExecutionMode;
  now: Date;
  mode: DryRunPolicyMode;
  store: SourcePolicyStore;
}): Promise<PolicyDryRun> {
  const policy = await resolveSourcePolicy(
    {
      source_label:
        input.observation.normalized_source_label
        ?? input.observation.source_label_raw
        ?? "",
      origin_state: input.observation.move?.origin?.state,
      destination_state: input.observation.move?.destination?.state,
      provider_type: input.observation.provider_context?.type_raw,
    },
    input.store,
  );
  const snapshot = policy.snapshot ?? emptyPolicySnapshot();
  const identity = await resolveLeadIdentity(
    {
      observation: {
        identity: {
          normalized_job_no: input.observation.identity?.normalized_job_no,
          normalized_form_ref: input.observation.identity?.normalized_form_ref,
        },
        contact: {
          normalized_phone: input.observation.contact?.normalized_phone,
          normalized_email: input.observation.contact?.normalized_email,
        },
        agent_identity: {
          user_raw: input.observation.agent_identity?.user_raw,
          rep_raw: input.observation.agent_identity?.rep_raw,
        },
        provider_context: input.observation.provider_context,
      },
      policy: snapshot,
      policy_failure: policy.ok
        ? undefined
        : { outcome: policy.outcome, reason: policy.reason },
    },
    createMongoLeadIdentityStore(),
  );

  const row: PolicyDryRun = {
    mode: input.mode,
    policy_ok: policy.ok,
    policy_outcome: policy.ok ? undefined : policy.outcome,
    policy_reason: policy.ok ? undefined : policy.reason,
    snapshot: summarizeSnapshot(snapshot),
    identity: summarizeIdentity(identity),
  };

  if (!policy.ok) {
    return row;
  }

  const lead = identity.target && isLeadRef(identity.target)
    ? await loadLeadProjection(identity.target)
    : null;
  const temporal_order = compareGranotTemporal(
    {
      captured_at: input.observation.captured_at,
      observation_id: String(input.observation._id),
    },
    lead?.last_accepted_granot_observation,
  );
  const plan = planLeadDesiredState({
    observation: input.observation,
    identity,
    lead,
    policy: snapshot,
    temporal_order,
    now: input.now,
    attempt: 1,
  });
  const requested = requestedEffect(plan);
  const gates = evaluateEffectGates({
    global_effect_flag: globalFlagFor(requested, input.flags),
    receipt_post_activation: input.execution_mode !== "historical_shadow",
    processor_mode: input.execution_mode,
    operational_enabled: snapshot.operational_enabled === true,
    lifecycle_enabled: snapshot.lifecycle_enabled === true,
    disposition: snapshot.lifecycle_disposition,
    source_company_active: snapshot.source_company_active === true,
    source_granularity_active: snapshot.source_granularity_active === true,
    lead_created_policy: snapshot.lead_created_policy,
    requested_effect: requested,
  });
  const minimum = evaluateMinimumCreationData({
    observation: input.observation,
    policy: snapshot,
  });

  row.matched_lead = lead
    ? {
        model: lead.model,
        id: maskId(lead.id) ?? lead.id,
        ingestion_origin: lead.ingestion_origin,
        job_no: lead.job_no,
        normalized_job_no: lead.normalized_job_no,
        quoted: lead.quoted,
        granot_priority: lead.granot_priority,
      }
    : undefined;
  row.plan = {
    outcome: plan.outcome,
    reason_code: plan.reason_code,
    creation_eligibility: plan.creation_eligibility,
    creation_model: plan.creation_model,
    changed_paths: plan.changed_paths,
  };
  row.minimum_creation = {
    eligibility: minimum.eligibility,
    reason_code: minimum.eligibility === "insufficient" ? minimum.reason_code : undefined,
  };
  row.requested_effect = requested;
  row.gates = {
    allowed: gates.allowed,
    outcome: gates.outcome,
    reason: gates.reason,
    blocked: gates.evaluated_gates.filter((gate) => !gate.allowed).map((gate) => gate.gate),
  };
  row.gated_outcome = gatedOutcome(plan, gates, input.execution_mode);
  row.booking = await planBooking({
    observation: input.observation,
    identity,
    snapshot,
  });
  row.ringcentral = await planRingCentral({
    observation: input.observation,
    snapshot,
    identity,
    lead,
  });
  return row;
}

async function planBooking(input: {
  observation: GranotObservationDocument;
  identity: LeadIdentityResult;
  snapshot: SourcePolicySnapshot;
}): Promise<PolicyDryRun["booking"]> {
  const actualBooked = input.observation.booking_action?.normalized === "booked";
  const priorityFive =
    input.observation.priority?.valid === true
    && input.observation.priority.canonical === "5";
  const would_enter_booking_path =
    (actualBooked || priorityFive)
    && input.observation.booking_action?.normalized !== "release"
    && Boolean(input.observation.identity?.normalized_job_no)
    && input.observation.normalization_result !== "invalid"
    && input.observation.normalization_result !== "unsupported";

  const context = await loadBookingContext(input.observation, input.identity, input.snapshot);
  const classification = classifyBookingReconciliation(context);
  const suggestion = toBookingLeadSuggestion(input.identity);
  return {
    would_enter_booking_path,
    classification,
    suggestion: suggestion
      ? {
          model: suggestion.lead_ref.model,
          id: maskId(suggestion.lead_ref.id) ?? suggestion.lead_ref.id,
          confidence: suggestion.confidence,
          match_method: suggestion.match_method,
        }
      : undefined,
    candidate_count: projectBookingLeadCandidates(input.identity).length,
  };
}

async function loadBookingContext(
  observation: GranotObservationDocument,
  identity: LeadIdentityResult,
  snapshot: SourcePolicySnapshot,
): Promise<BookingReconciliationCurrentContext> {
  const normalizedJobNo = observation.identity?.normalized_job_no;
  const recordLink = normalizedJobNo
    ? await getGranotRecordLinkModel()
        .findOne({ provider: "granot", normalized_job_no: normalizedJobNo, state: "active" })
        .select({ _id: 1 })
        .lean()
        .exec()
    : null;
  const bookingRef = identity.booking_context?.booking;
  const bookingRow = bookingRef
    ? await BookedLead.findById(bookingRef.id).lean().exec()
    : null;
  let booking: BookingReconciliationCurrentContext["booking"];
  if (bookingRow) {
    const officialCancellation =
      Boolean(bookingRow.cancelled)
      || Boolean(await CancelledLead.exists({ booked_lead: bookingRow._id }));
    const hasLead = Boolean(bookingRow.lead_ref && bookingRow.lead_model);
    const employeeCase = !hasLead && bookingRow.is_referral_booking !== true
      ? await BookingLeadReconciliationCase.findOne({ booking: bookingRow._id })
          .sort({ updatedAt: -1 })
          .select({ _id: 1 })
          .lean()
          .exec()
      : null;
    booking = {
      id: String(bookingRow._id),
      has_lead: hasLead,
      officially_cancelled: officialCancellation,
      referral: bookingRow.is_referral_booking === true,
      employee_reconciliation_case_id: employeeCase ? String(employeeCase._id) : undefined,
    };
  }
  return {
    observation_id: String(observation._id),
    receipt_id: String(observation.receipt_id),
    captured_at: new Date(observation.captured_at),
    normalized_job_no: normalizedJobNo,
    job_no_snapshot: observation.identity?.job_no_raw ?? normalizedJobNo,
    priority: observation.priority,
    booking_action: observation.booking_action?.normalized,
    lifecycle_disposition: snapshot.lifecycle_disposition,
    identity,
    record_link_id: recordLink ? String(recordLink._id) : undefined,
    booking,
  };
}

async function planRingCentral(input: {
  observation: GranotObservationDocument;
  snapshot: SourcePolicySnapshot;
  identity: LeadIdentityResult;
  lead: LeadDesiredStateProjection | null;
}): Promise<RingCentralDryRun | undefined> {
  const model = input.snapshot.selected_lead_model;
  const inbound = /inbound/i.test(input.observation.normalized_source_label ?? "");
  if (model !== "CallLead" && !inbound) return undefined;

  const phone = input.observation.contact?.normalized_phone;
  const granularityId = input.snapshot.source_granularity_id;
  const preCreation = granularityId && phone
    ? await findPreCreationRingCentralConvergenceCandidates({
        source_granularity_id: granularityId,
        normalized_phone_number: phone,
      })
    : [];

  let duplicate: RingCentralDryRun["duplicate"];
  if (granularityId && phone && input.snapshot.lead_source_company_id) {
    const company = await getLeadSourceCompanyModel()
      .findById(input.snapshot.lead_source_company_id)
      .lean()
      .exec();
    if (company?.company_slug) {
      const result = await classifyRingCentralCallLeadDuplicate({
        sourceCompany: company.company_slug as SourceCompany,
        sourceGranularityId: granularityId,
        callerPhoneNumber: phone,
        callTimestamp: input.observation.captured_at,
        callLeadIdToExclude: input.identity.target?.model === "CallLead"
          ? input.identity.target.id
          : undefined,
      });
      duplicate = {
        isDuplicate: result.isDuplicate,
        reason: result.reason,
        matchCount: result.matchCount,
        existingLeadId: maskId(result.existingLeadId ?? undefined),
      };
    }
  }

  const job = input.observation.identity?.normalized_job_no;
  const byJob = job
    ? await getCallLeadModel()
        .find({ normalized_job_no: job })
        .select({
          ingestion_origin: 1,
          duplicate: 1,
          ringcentral: 1,
          ringcentral_convergence: 1,
        })
        .lean()
        .exec()
    : [];

  const matchedId = input.identity.target?.model === "CallLead" ? input.identity.target.id : undefined;
    const matched = matchedId
    ? await getCallLeadModel()
        .findById(matchedId)
        .select({
          ingestion_origin: 1,
          duplicate: 1,
          ringcentral: 1,
          ringcentral_convergence: 1,
        })
        .lean()
        .exec() as {
          _id: unknown;
          ingestion_origin?: string;
          duplicate?: boolean;
          ringcentral?: {
            telephony_session_id?: string;
            session_id?: string;
            call_log_id?: string;
          };
          ringcentral_convergence?: { state?: string };
        } | null
    : null;

  return {
    selected_lead_model: model,
    pre_creation_candidates: preCreation.length,
    pre_creation_ids: preCreation.map((row) => maskId(row.call_lead_id) ?? row.call_lead_id),
    duplicate,
    matched_call_lead: matched
      ? {
          id: maskId(String(matched._id)) ?? String(matched._id),
          ingestion_origin: matched.ingestion_origin,
          has_ringcentral_ids: Boolean(
            matched.ringcentral?.telephony_session_id
            || matched.ringcentral?.session_id
            || matched.ringcentral?.call_log_id,
          ),
          convergence_state: matched.ringcentral_convergence?.state,
          duplicate: matched.duplicate === true,
        }
      : undefined,
    existing_call_leads_by_job: byJob.length,
  };
}

async function loadLeadProjection(
  target: { model: string; id: string },
): Promise<LeadDesiredStateProjection | null> {
  if (target.model === "FormLead") {
    const row = await getFormLeadModel().findById(target.id).lean().exec();
    if (!row) return null;
    return {
      model: "FormLead",
      id: String(row._id),
      ingestion_origin: absent(row.ingestion_origin),
      job_no: absent(row.job_no),
      normalized_job_no: absent(row.normalized_job_no),
      granot_priority: absent(row.granot_priority),
      quoted: absent(row.quoted),
      receiver_agent: row.receiver_agent ? String(row.receiver_agent) : undefined,
      last_accepted_granot_observation: row.last_accepted_granot_observation
        ? {
            observation_id: String(row.last_accepted_granot_observation.observation_id),
            captured_at: new Date(row.last_accepted_granot_observation.captured_at),
          }
        : undefined,
      domain_revision: row.domain_revision,
    };
  }
  if (target.model === "CallLead") {
    const row = await getCallLeadModel().findById(target.id).lean().exec();
    if (!row) return null;
    return {
      model: "CallLead",
      id: String(row._id),
      ingestion_origin: absent(row.ingestion_origin),
      job_no: absent(row.job_no),
      normalized_job_no: absent(row.normalized_job_no),
      granot_priority: absent(row.granot_priority),
      quoted: absent(row.quoted),
      last_accepted_granot_observation: row.last_accepted_granot_observation
        ? {
            observation_id: String(row.last_accepted_granot_observation.observation_id),
            captured_at: new Date(row.last_accepted_granot_observation.captured_at),
          }
        : undefined,
      domain_revision: row.domain_revision,
    };
  }
  return null;
}

function requestedEffect(plan: LeadDesiredStatePlan): RequestedLifecycleEffect {
  if (plan.creation_eligibility === "eligible") return "lead_created";
  if (plan.outcome === "applied" || plan.changed_paths.length > 0) return "lead_enrichment";
  return "lead_link";
}

function globalFlagFor(
  effect: RequestedLifecycleEffect,
  flags: GranotLifecycleFlags,
): boolean {
  if (effect === "lead_created") return flags.lead_creation_enabled;
  if (effect === "lead_enrichment" || effect === "lead_link") return flags.lead_writes_enabled;
  if (effect === "booking_reconciliation") return flags.booking_cases_enabled;
  if (effect === "release_reconciliation") return flags.release_cases_enabled;
  return false;
}

function gatedOutcome(
  plan: LeadDesiredStatePlan,
  gates: EffectGateEvaluation,
  mode: ExecutionMode,
): { outcome: string; reason_code: string } {
  const classification = new Set([
    "stale",
    "already_current",
    "pending_match",
    "unmatched",
    "insufficient_creation_data",
    "invalid",
    "unsupported",
    "ambiguous",
    "conflict",
    "deferred",
    "policy_blocked",
  ]);
  if (classification.has(plan.outcome)) {
    return { outcome: plan.outcome, reason_code: plan.reason_code };
  }
  if (mode === "live") {
    if (!gates.allowed) return { outcome: gates.outcome, reason_code: gates.reason };
    return { outcome: plan.outcome, reason_code: plan.reason_code };
  }
  if (mode === "historical_shadow") {
    return { outcome: "policy_blocked", reason_code: "historical_shadow" };
  }
  return { outcome: "policy_blocked", reason_code: "shadow_effect_suppressed" };
}

function summarizeSnapshot(snapshot: SourcePolicySnapshot) {
  return {
    granot_crm_source_id: snapshot.granot_crm_source_id,
    lead_source_company_id: snapshot.lead_source_company_id,
    source_granularity_id: snapshot.source_granularity_id,
    selected_lead_model: snapshot.selected_lead_model,
    selected_move_type: snapshot.selected_move_type,
    selected_route_key: snapshot.selected_route_key,
    lifecycle_disposition: snapshot.lifecycle_disposition,
    lead_created_policy: snapshot.lead_created_policy,
    operational_enabled: snapshot.operational_enabled,
    lifecycle_enabled: snapshot.lifecycle_enabled,
    source_company_active: snapshot.source_company_active,
    source_granularity_active: snapshot.source_granularity_active,
  };
}

function summarizeIdentity(identity: LeadIdentityResult) {
  return {
    outcome: identity.outcome,
    reason_code: identity.reason_code,
    match_method: identity.match_method,
    target: identity.target
      ? { model: identity.target.model, id: maskId(identity.target.id) ?? identity.target.id }
      : undefined,
    target_eligibility: identity.target_eligibility,
    candidate_count: identity.candidates.length,
    booking_present: Boolean(identity.booking_context?.booking),
    referral_leadless: identity.booking_context?.referral_leadless,
  };
}

function isLeadRef(target: { model: string }): target is { model: "FormLead" | "CallLead"; id: string } {
  return target.model === "FormLead" || target.model === "CallLead";
}

function coerceDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function absent<T>(value: T | null | undefined): T | undefined {
  return value == null ? undefined : value;
}

export function createConfiguredPolicyStore(): SourcePolicyStore {
  return createMongoSourcePolicyStore();
}

export function currentFlags(): GranotLifecycleFlags {
  return getGranotLifecycleFlags();
}

export function redactCase(row: ReceiptDryRun): ReceiptDryRun {
  return {
    ...row,
    policies: row.policies.map((policy) => ({
      ...policy,
      matched_lead: policy.matched_lead
        ? { ...policy.matched_lead, ...redactContact(policy.matched_lead) }
        : undefined,
    })),
  };
}
