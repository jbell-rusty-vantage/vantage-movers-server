import { jobNumbersEquivalent, normalizeJobNo } from "../bookings/bookingIdentity";
import { splitNameForCrm } from "../crm/formLeadPayload";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import type { LeadIdentityResult } from "./identity";
import {
  compareGranotTemporal,
  type GranotTemporalOrder,
  type GranotTemporalTuple,
} from "./granotTemporal";
import { nextPendingMatchDueAt, shouldCompletePendingMatch } from "./schedules";
import type { SourcePolicySnapshot } from "./sourcePolicy";
import { normalizeUsStateCode, selectFormMoveType } from "./sourceLabel";
import type {
  EntityRef,
  GranotLeadCreatedPolicy,
  LeadModel,
  SynchronizationOutcome,
  SynchronizationReasonCode,
} from "./types";

export type LeadCreationEligibility = "not_applicable" | "eligible" | "insufficient";

export type LeadDesiredStatePlan = {
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  target?: EntityRef;
  desired_values: Record<string, unknown>;
  changed_paths: string[];
  agent_changed_paths: string[];
  temporal_winner_should_advance: boolean;
  creation_eligibility?: LeadCreationEligibility;
  creation_model?: "FormLead" | "CallLead";
  next_match_attempt_at?: Date;
};

export type LeadContactSnapshot = {
  first_name?: string;
  last_name?: string;
  name?: string;
  phone_number?: string;
  normalized_phone_number?: string;
  email?: string;
};

export type LeadDesiredStateProjection = {
  model: LeadModel;
  id: string;
  ingestion_origin?: string;
  job_no?: string;
  normalized_job_no?: string;
  granot_priority?: string;
  quoted?: boolean;
  receiver_agent?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  normalized_phone_number?: string;
  email?: string;
  pickup_city?: string;
  pickup_zip?: string;
  pickup_state?: string;
  delivery_city?: string;
  destination_zip?: string;
  delivery_zip?: string;
  delivery_state?: string;
  move_date?: Date;
  cubic_feet?: number;
  local?: "local" | "long_distance";
  move_size?: string;
  granot_move_size?: string;
  granot_service_type?: string;
  granot_contact_snapshot?: LeadContactSnapshot;
  ingested_contact_snapshot?: LeadContactSnapshot;
  last_accepted_granot_observation?: GranotTemporalTuple;
  last_granot_contact_change?: { changed_paths: string[] };
  domain_revision?: number;
};

export type MinimumCreationDataResult =
  | { eligibility: "eligible" }
  | {
      eligibility: "insufficient";
      reason_code:
        | "missing_creation_job_number"
        | "missing_creation_contact"
        | "missing_creation_route_data";
    };

const ZIP_FIVE = /^\d{5}$/;
const BROAD_ENRICHMENT_PRIORITIES = new Set(["1", "5"]);
const FORBIDDEN_DESIRED_PATHS = new Set([
  "lead_source_company",
  "source_granularity_id",
  "ingestion_origin",
  "cpl",
  "booked",
  "cancelled",
  "move_size",
  "ingested_contact_snapshot",
  "ingested_move_snapshot",
  "estimate",
  "payment",
  "balance",
]);

export type LeadDesiredStateInput = {
  observation: GranotObservationDocument;
  identity: LeadIdentityResult;
  lead?: LeadDesiredStateProjection | null;
  policy: SourcePolicySnapshot;
  temporal_order?: GranotTemporalOrder;
  now: Date;
  attempt: number;
};

export function planLeadDesiredState(input: LeadDesiredStateInput): LeadDesiredStatePlan {
  const temporal_order =
    input.temporal_order ??
    compareGranotTemporal(incomingTuple(input.observation), input.lead?.last_accepted_granot_observation);

  if (temporal_order === "older") {
    return emptyPlan({
      outcome: "stale",
      reason_code: "older_than_temporal_winner",
      target: input.identity.target,
    });
  }

  if (temporal_order === "same") {
    return emptyPlan({
      outcome: "already_current",
      reason_code: "desired_state_already_current",
      target: input.identity.target ?? (input.lead ? leadRef(input.lead) : undefined),
      temporal_winner_should_advance: false,
    });
  }

  const invalidPriorityUpdate = isInvalidPriorityUpdate(input.observation);
  if (invalidPriorityUpdate) {
    return emptyPlan({
      outcome: "invalid",
      reason_code: "invalid_priority_update",
    });
  }

  const identityTerminal = terminalIdentityPlan(input.identity);
  if (identityTerminal) {
    return identityTerminal;
  }

  if (!input.identity.target) {
    return planNoMatch(input);
  }

  return planMatchedLead(input);
}

export function evaluateMinimumCreationData(input: {
  observation: GranotObservationDocument;
  policy: SourcePolicySnapshot;
}): MinimumCreationDataResult {
  if (!input.observation.identity?.normalized_job_no) {
    return { eligibility: "insufficient", reason_code: "missing_creation_job_number" };
  }
  if (!hasDeterministicRoute(input.policy)) {
    return { eligibility: "insufficient", reason_code: "missing_creation_route_data" };
  }
  const model = input.policy.selected_lead_model;
  if (model === "CallLead") {
    return { eligibility: "eligible" };
  }
  if (model !== "FormLead") {
    return { eligibility: "insufficient", reason_code: "missing_creation_route_data" };
  }
  const contact = input.observation.contact ?? {};
  const hasName = Boolean(contact.first_name || contact.last_name || contact.display_name);
  const hasPhone = Boolean(contact.normalized_phone);
  if (!hasName || !hasPhone) {
    return { eligibility: "insufficient", reason_code: "missing_creation_contact" };
  }
  const originState = input.observation.move?.origin?.state
    ? normalizeUsStateCode(input.observation.move.origin.state)
    : undefined;
  const destinationState = input.observation.move?.destination?.state
    ? normalizeUsStateCode(input.observation.move.destination.state)
    : undefined;
  const originZip = normalizeZip(input.observation.move?.origin?.zip);
  const destinationZip = normalizeZip(input.observation.move?.destination?.zip);
  const moveType = selectFormMoveType({
    origin_state: originState,
    destination_state: destinationState,
  });
  if (!originState || !destinationState || !originZip || !destinationZip || !moveType) {
    return { eligibility: "insufficient", reason_code: "missing_creation_route_data" };
  }
  return { eligibility: "eligible" };
}

function planNoMatch(input: LeadDesiredStateInput): LeadDesiredStatePlan {
  const policyOutcome = evidenceOnlyPolicy(input.policy.lead_created_policy);
  if (policyOutcome) {
    return emptyPlan({
      ...policyOutcome,
      creation_eligibility: "not_applicable",
    });
  }

  // Any selected_lead_model may mint on lead_created + create_if_missing.
  if (input.observation.route_event_class === "lead_created") {
    const minimum = evaluateMinimumCreationData({
      observation: input.observation,
      policy: input.policy,
    });
    if (minimum.eligibility === "insufficient") {
      return emptyPlan({
        outcome: "insufficient_creation_data",
        reason_code: minimum.reason_code,
        creation_eligibility: "insufficient",
      });
    }
    if (input.policy.lead_created_policy === "create_if_missing") {
      return emptyPlan({
        outcome: "created",
        reason_code: "lead_created_authorized",
        creation_eligibility: "eligible",
        creation_model: input.policy.selected_lead_model,
      });
    }
  }

  if (input.identity.outcome === "unmatched" && input.identity.reason_code !== "pending_source_scoped_match") {
    return emptyPlan({
      outcome: input.identity.outcome,
      reason_code: input.identity.reason_code,
    });
  }

  if (
    shouldCompletePendingMatch({
      capturedAt: input.observation.captured_at,
      now: input.now,
      matchAttemptAfterIncrement: input.attempt,
    })
  ) {
    return emptyPlan({
      outcome: "unmatched",
      reason_code: "match_window_expired",
    });
  }

  return {
    ...emptyPlan({
      outcome: "pending_match",
      reason_code: "pending_source_scoped_match",
    }),
    next_match_attempt_at:
      nextPendingMatchDueAt(input.observation.captured_at, input.attempt) ?? undefined,
  };
}

function planMatchedLead(input: LeadDesiredStateInput): LeadDesiredStatePlan {
  const target = input.identity.target!;
  const lead = input.lead;
  if (!lead) {
    return emptyPlan({
      outcome: "pending_match",
      reason_code: "pending_source_scoped_match",
      target,
    });
  }

  const jobConflict = conflictingJob(lead, input.observation);
  if (jobConflict) {
    return emptyPlan({
      outcome: "conflict",
      reason_code: "job_number_conflict",
      target,
    });
  }

  const skipPriority = hasInvalidPriorityIssue(input.observation);
  const desired = new Map<string, unknown>();
  const agentPaths: string[] = [];

  if (!skipPriority && input.observation.priority?.valid && input.observation.priority.canonical != null) {
    desired.set("granot_priority", input.observation.priority.canonical);
  }

  if (!lead.normalized_job_no && input.observation.identity?.normalized_job_no) {
    desired.set("normalized_job_no", input.observation.identity.normalized_job_no);
    if (input.observation.identity.job_no_raw) {
      desired.set("job_no", input.observation.identity.job_no_raw);
    }
  }

  const canFillAgent =
    Boolean(input.identity.agent) &&
    !lead.receiver_agent &&
    input.observation.priority?.valid === true &&
    !skipPriority;
  if (canFillAgent && input.identity.agent) {
    desired.set("receiver_agent", input.identity.agent.target.id);
    desired.set("receiver_agent_source", "granot_username_match");
    desired.set("receiver_agent_source_value", input.identity.agent.normalized_username);
    agentPaths.push("receiver_agent", "receiver_agent_source", "receiver_agent_source_value");
  }

  const broad =
    input.identity.target_eligibility !== "priority_only" &&
    !skipPriority &&
    input.observation.priority?.valid === true &&
    BROAD_ENRICHMENT_PRIORITIES.has(input.observation.priority.canonical ?? "");

  if (broad) {
    if (lead.quoted !== true) {
      desired.set("quoted", true);
    }
    planQualifiedContact(desired, input.observation, lead);
    planQualifiedMove(desired, input.observation, lead);
  }

  const changed = diffDesired(lead, desired);
  const agent_changed_paths = sortUnique(agentPaths.filter((path) => changed.changed_paths.includes(path)));

  if (changed.changed_paths.length === 0) {
    return {
      outcome: "already_current",
      reason_code: "desired_state_already_current",
      target,
      desired_values: {},
      changed_paths: [],
      agent_changed_paths: [],
      temporal_winner_should_advance: true,
    };
  }

  return {
    outcome: "applied",
    reason_code: "lead_state_changed",
    target,
    desired_values: changed.desired_values,
    changed_paths: changed.changed_paths,
    agent_changed_paths,
    temporal_winner_should_advance: true,
  };
}

function planQualifiedContact(
  desired: Map<string, unknown>,
  observation: GranotObservationDocument,
  lead: LeadDesiredStateProjection,
): void {
  const incoming = observationContact(observation);
  if (lead.ingestion_origin === "wordpress_form") {
    if (!contactSemanticallyEqual(lead.granot_contact_snapshot, incoming)) {
      desired.set("granot_contact_snapshot", incoming);
    }
    return;
  }
  const contactLeaves: Array<[string, unknown]> = [
    ["first_name", incoming.first_name],
    ["last_name", incoming.last_name],
    ["name", incoming.name],
    ["phone_number", incoming.phone_number],
    ["normalized_phone_number", incoming.normalized_phone_number],
    ["email", incoming.email],
  ];
  const summaryPaths: string[] = [];
  for (const [path, value] of contactLeaves) {
    if (value === undefined) continue;
    if (!valuesSemanticallyEqual(path, readLeadValue(lead, path), value)) {
      desired.set(path, value);
      summaryPaths.push(path);
    }
  }
  if (summaryPaths.length > 0) {
    desired.set("last_granot_contact_change.changed_paths", sortUnique(summaryPaths));
  }
}

function planQualifiedMove(
  desired: Map<string, unknown>,
  observation: GranotObservationDocument,
  lead: LeadDesiredStateProjection,
): void {
  const origin = observation.move?.origin;
  const destination = observation.move?.destination;
  const originState = origin?.state ? normalizeUsStateCode(origin.state) : undefined;
  const destinationState = destination?.state
    ? normalizeUsStateCode(destination.state)
    : undefined;
  maybeSet(desired, "pickup_city", origin?.city);
  maybeSet(desired, "pickup_zip", normalizeZip(origin?.zip) ?? origin?.zip);
  maybeSet(desired, "pickup_state", originState);
  maybeSet(desired, "delivery_city", destination?.city);
  maybeSet(desired, destinationZipPath(lead.model), normalizeZip(destination?.zip) ?? destination?.zip);
  maybeSet(desired, "delivery_state", destinationState);
  if (lead.model === "FormLead" && observation.move?.move_date) {
    maybeSet(desired, "move_date", observation.move.move_date);
  }
  if (observation.move?.estimated_cubic_feet != null) {
    maybeSet(desired, "cubic_feet", observation.move.estimated_cubic_feet);
  }
  if (originState && destinationState) {
    maybeSet(desired, "local", originState === destinationState ? "local" : "long_distance");
  }
  maybeSet(desired, "granot_move_size", observation.move?.granot_move_size_raw);
  maybeSet(desired, "granot_service_type", observation.move?.service_type_raw);
}

function destinationZipPath(model: LeadModel): string {
  return model === "CallLead" ? "delivery_zip" : "destination_zip";
}

function diffDesired(
  lead: LeadDesiredStateProjection,
  desired: Map<string, unknown>,
): { desired_values: Record<string, unknown>; changed_paths: string[] } {
  const desired_values: Record<string, unknown> = {};
  const changed_paths: string[] = [];
  for (const [path, value] of desired) {
    if (FORBIDDEN_DESIRED_PATHS.has(path)) {
      continue;
    }
    if (valuesSemanticallyEqual(path, readLeadValue(lead, path), value)) {
      continue;
    }
    desired_values[path] = value;
    changed_paths.push(path);
  }
  return { desired_values, changed_paths: sortUnique(changed_paths) };
}

function readLeadValue(lead: LeadDesiredStateProjection, path: string): unknown {
  if (path === "last_granot_contact_change.changed_paths") {
    return lead.last_granot_contact_change?.changed_paths;
  }
  return (lead as Record<string, unknown>)[path];
}

function valuesSemanticallyEqual(path: string, current: unknown, incoming: unknown): boolean {
  if (path === "normalized_job_no" || path === "job_no") {
    const left = typeof current === "string" ? normalizeJobNo(current) : undefined;
    const right = typeof incoming === "string" ? normalizeJobNo(incoming) : undefined;
    return left === right && left != null;
  }
  if (path === "normalized_phone_number" || path === "phone_number") {
    const left = typeof current === "string" ? normalizePhoneNumberForMatch(current) : undefined;
    const right = typeof incoming === "string" ? normalizePhoneNumberForMatch(incoming) : undefined;
    return left === right && left != null;
  }
  if (path === "email") {
    return normalizeEmail(current) === normalizeEmail(incoming) && normalizeEmail(incoming) != null;
  }
  if (path === "pickup_state" || path === "delivery_state") {
    const left = typeof current === "string" ? normalizeUsStateCode(current) : undefined;
    const right = typeof incoming === "string" ? normalizeUsStateCode(incoming) : undefined;
    return left === right && left != null;
  }
  if (path === "move_date") {
    const left = current instanceof Date ? current.getTime() : undefined;
    const right = incoming instanceof Date ? incoming.getTime() : undefined;
    return left === right && left != null;
  }
  if (path === "granot_contact_snapshot") {
    return contactSemanticallyEqual(current as LeadContactSnapshot | undefined, incoming as LeadContactSnapshot);
  }
  if (path === "last_granot_contact_change.changed_paths") {
    return JSON.stringify(sortUnique(asStringArray(current))) === JSON.stringify(sortUnique(asStringArray(incoming)));
  }
  if (typeof current === "string" && typeof incoming === "string") {
    return current.trim() === incoming.trim();
  }
  return Object.is(current, incoming);
}

export function contactSemanticallyEqual(
  current: LeadContactSnapshot | undefined,
  incoming: LeadContactSnapshot | undefined,
): boolean {
  if (!current && !incoming) return true;
  if (!current || !incoming) return false;
  return (
    contactNamesEquivalent(current, incoming) &&
    (normalizePhone(current.normalized_phone_number ?? current.phone_number) ?? null) ===
      (normalizePhone(incoming.normalized_phone_number ?? incoming.phone_number) ?? null) &&
    normalizeEmail(current.email) === normalizeEmail(incoming.email)
  );
}

function contactNamesEquivalent(
  current: LeadContactSnapshot,
  incoming: LeadContactSnapshot,
): boolean {
  const left = nameParts(current);
  const right = nameParts(incoming);
  return left.first === right.first && left.last === right.last;
}

function nameParts(card: LeadContactSnapshot): {
  first: string | undefined;
  last: string | undefined;
} {
  let first = normalizeContactName(card.first_name);
  let last = normalizeContactName(card.last_name);
  if (!first || !last) {
    const name = normalizeContactName(card.name);
    if (name) {
      const peeled = splitNameForCrm(name);
      first = first ?? normalizeContactName(peeled.firstname);
      last = last ?? normalizeContactName(peeled.lastname);
    }
  }
  return { first, last };
}

function observationContact(observation: GranotObservationDocument): LeadContactSnapshot {
  const contact = observation.contact ?? {};
  const name =
    contact.display_name ??
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") ??
    undefined;
  return {
    first_name: contact.first_name,
    last_name: contact.last_name,
    name: name || undefined,
    phone_number: contact.phone_raw,
    normalized_phone_number: contact.normalized_phone,
    email: contact.normalized_email,
  };
}

function terminalIdentityPlan(identity: LeadIdentityResult): LeadDesiredStatePlan | null {
  if (identity.reason_code === "duplicate_form_lead_ineligible") {
    return emptyPlan({
      outcome: "unmatched",
      reason_code: "duplicate_form_lead_ineligible",
    });
  }
  if (
    identity.outcome === "ambiguous" ||
    identity.outcome === "conflict" ||
    identity.outcome === "deferred" ||
    identity.outcome === "policy_blocked" ||
    identity.outcome === "invalid" ||
    identity.outcome === "unsupported"
  ) {
    return emptyPlan({
      outcome: identity.outcome,
      reason_code: identity.reason_code,
      target: identity.target,
    });
  }
  return null;
}

function evidenceOnlyPolicy(
  policy: GranotLeadCreatedPolicy,
): { outcome: SynchronizationOutcome; reason_code: SynchronizationReasonCode } | null {
  if (policy === "observation_only") {
    return { outcome: "policy_blocked", reason_code: "creation_policy_observation_only" };
  }
  return null;
}

function isInvalidPriorityUpdate(observation: GranotObservationDocument): boolean {
  return (
    observation.route_event_class === "priority_updated" &&
    (observation.normalization_result === "invalid" || hasInvalidPriorityIssue(observation))
  );
}

function hasInvalidPriorityIssue(observation: GranotObservationDocument): boolean {
  return observation.issues.some((issue) => issue.code === "invalid_priority");
}

function conflictingJob(
  lead: LeadDesiredStateProjection,
  observation: GranotObservationDocument,
): boolean {
  const incoming = observation.identity?.normalized_job_no;
  const current = lead.normalized_job_no;
  return Boolean(current && incoming && !jobNumbersEquivalent(current, incoming));
}

function hasDeterministicRoute(policy: SourcePolicySnapshot): boolean {
  return Boolean(policy.selected_route_key && policy.selected_lead_model && policy.source_granularity_id);
}

function incomingTuple(observation: GranotObservationDocument): GranotTemporalTuple {
  return {
    captured_at: observation.captured_at,
    observation_id: String(observation._id),
  };
}

function leadRef(lead: LeadDesiredStateProjection): EntityRef {
  return { model: lead.model, id: lead.id };
}

function emptyPlan(input: {
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  target?: EntityRef;
  temporal_winner_should_advance?: boolean;
  creation_eligibility?: LeadCreationEligibility;
  creation_model?: "FormLead" | "CallLead";
}): LeadDesiredStatePlan {
  return {
    outcome: input.outcome,
    reason_code: input.reason_code,
    target: input.target,
    desired_values: {},
    changed_paths: [],
    agent_changed_paths: [],
    temporal_winner_should_advance: input.temporal_winner_should_advance ?? false,
    creation_eligibility: input.creation_eligibility,
    creation_model: input.creation_model,
  };
}

function maybeSet(desired: Map<string, unknown>, path: string, value: unknown): void {
  if (value === undefined || value === "") {
    return;
  }
  desired.set(path, value);
}

function normalizeZip(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return ZIP_FIVE.test(trimmed) ? trimmed : undefined;
}

function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  return trimmed || undefined;
}

function normalizeContactName(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized || undefined;
}

function normalizePhone(value?: string): string | undefined {
  return value ? normalizePhoneNumberForMatch(value) : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
