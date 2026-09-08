import { createHash } from "node:crypto";
import type { ClientSession, Types } from "mongoose";
import {
  getBookingReconciliationConfig,
  snapshotEmployeeBookingAutoMatchPolicy,
  type BookingLeadReconciliationReason,
} from "../../config/domain";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import { toObjectId } from "../../utils/objectId";
import type { CreateBookedLeadFromSourceInput } from "../../validation/v1.validation";
import { getLinkedLead } from "../leads";
import { resolveLeadSourceAssignment } from "../leads/leadSourceCompany";
import { evaluateEmployeeBookingMatch } from "../employeeBookings/leadMatchEvaluator";
import { queryEmployeeBookingCandidates } from "../employeeBookings/leadCandidateQueries";
import type {
  EmployeeBookingMatchOutcome,
  EvaluatedLeadCandidate,
  PreparedEmployeeBookingSubmission,
  SourceAssignmentSnapshot,
} from "../employeeBookings/types";
import { normalizeComparisonName, normalizeJobNo } from "./bookingIdentity";
import type { FullSheetSyncJob } from "../sheetSync";

const NOT_PROVIDED_PHONE = "not provided";
const NOT_PROVIDED_NORMALIZED_PHONE = "not_provided";
const UNKNOWN_LEAD_NAME = "Unknown";

export type OwnerBookingOrigin = "owner_booking";

export type OwnerSourceAssignment = SourceAssignmentSnapshot;

export type OwnerPendingMatchExtras = {
  reason: BookingLeadReconciliationReason;
  candidates?: EvaluatedLeadCandidate[];
  channel?: "call" | "form";
  phoneNumber?: string;
  leadName?: string;
};

export function isBestRelocationFromSource(
  input: { ingestion_source?: string | undefined },
): boolean {
  return input.ingestion_source === "best_relocation_sheet";
}

export function ownerPendingSheetJob(bookingId: string): FullSheetSyncJob {
  return {
    resource: "booked_lead",
    operation: "owner_booking.create_pending",
    bookingId,
  };
}

export function ownerBookingSubmissionId(normalizedJobNo: string): string {
  return `owner-booking:${normalizedJobNo}`;
}

export function ownerSnapshotPhone(callPhone?: string, customerPhone?: string): string {
  const submitted = callPhone?.trim() || customerPhone?.trim();
  return submitted || NOT_PROVIDED_PHONE;
}

export function ownerSnapshotLeadName(customerName?: string): string {
  return customerName?.trim() || UNKNOWN_LEAD_NAME;
}

export function ownerSourceChannel(
  mode: "call" | "form",
  sourceLabel?: string,
): "call" | "form" {
  if (mode === "call") return "call";
  return /inbound|call/i.test(sourceLabel ?? "") ? "call" : "form";
}

export async function resolveOwnerSourceAssignment(input: {
  sourceCompany?: string;
  sourceLabel?: string;
  channel: "call" | "form";
}): Promise<OwnerSourceAssignment> {
  const { assignment } = await resolveLeadSourceAssignment({
    value: input.sourceLabel ?? input.sourceCompany,
    channel: input.channel,
  });
  return {
    ...assignment,
    channel: input.channel,
  };
}

export async function evaluateOwnerCallLeadMatch(
  input: CreateBookedLeadFromSourceInput & { lead_type: "CallLead" },
  session?: ClientSession,
  deps: {
    queryCandidates?: typeof queryEmployeeBookingCandidates;
    resolveSource?: typeof resolveOwnerSourceAssignment;
  } = {},
): Promise<EmployeeBookingMatchOutcome> {
  const queryCandidates = deps.queryCandidates ?? queryEmployeeBookingCandidates;
  const resolveSource = deps.resolveSource ?? resolveOwnerSourceAssignment;
  const submission = await buildOwnerCallLeadSubmission(input, resolveSource);
  try {
    const candidateQuery = await queryCandidates(submission, session);
    return evaluateEmployeeBookingMatch(
      submission,
      candidateQuery.candidates,
      candidateQuery.hasOverflow,
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      (error as { statusCode?: unknown }).statusCode === 409
    ) {
      throw error;
    }
    return {
      kind: "pending",
      reason: "matching_unavailable",
      candidates: [],
    };
  }
}

export async function buildOwnerCallLeadSubmission(
  input: CreateBookedLeadFromSourceInput & { lead_type: "CallLead" },
  resolveSource: typeof resolveOwnerSourceAssignment = resolveOwnerSourceAssignment,
): Promise<PreparedEmployeeBookingSubmission> {
  const jobNo = (input.call_job_no ?? "").trim();
  const normalizedJob = normalizeJobNo(jobNo) ?? jobNo;
  const phoneNumber = ownerSnapshotPhone(input.call_phone_number, input.customer_phone);
  const normalizedPhone =
    phoneNumber === NOT_PROVIDED_PHONE
      ? NOT_PROVIDED_NORMALIZED_PHONE
      : normalizePhoneNumberForMatch(phoneNumber) ?? NOT_PROVIDED_NORMALIZED_PHONE;
  const leadName = ownerSnapshotLeadName(input.customer_name);
  const channel = ownerSourceChannel("call", input.source_company);
  const sourceAssignment = await resolveSource({
    sourceCompany: input.source_company,
    channel,
  });

  return {
    submissionId: ownerBookingSubmissionId(normalizedJob),
    leadName,
    normalizedLeadName: normalizeComparisonName(leadName),
    phoneNumber,
    normalizedPhoneNumber: normalizedPhone,
    jobNo,
    normalizedJobNo: normalizedJob,
    binderAmount: input.binder_amount,
    depositAmount: input.deposit_amount,
    merchant: input.merchant,
    agent: input.agent,
    splitAgent: input.split_agent?.trim() || undefined,
    bookDate: input.book_date,
    sourceAssignment,
    sourceDisplayLabel:
      sourceAssignment.crm_source_label_snapshot ||
      sourceAssignment.source_granularity_label_snapshot ||
      sourceAssignment.source_company_label_snapshot ||
      sourceAssignment.source_company,
    agentAllocations: [],
  };
}

export async function linkedLeadStillEligible(
  match: Extract<EmployeeBookingMatchOutcome, { kind: "linked" }>,
  session?: ClientSession,
): Promise<EmployeeBookingMatchOutcome> {
  const lead = await getLinkedLead(match.leadModel, match.leadId, session);
  if (lead.cancelled) {
    return { kind: "pending", reason: "lead_cancelled", candidates: match.candidates };
  }
  if (lead.booked) {
    return { kind: "pending", reason: "lead_already_booked", candidates: match.candidates };
  }
  if (lead.get("duplicate") === true) {
    return { kind: "pending", reason: "duplicate_lead", candidates: match.candidates };
  }
  if (match.leadModel === "CallLead" && lead.get("created_on_unmatched") === true) {
    return { kind: "pending", reason: "no_match", candidates: match.candidates };
  }
  return match;
}

export function buildOwnerPendingCasePayload(input: {
  bookingId: Types.ObjectId;
  jobNo: string;
  phoneNumber: string;
  leadName: string;
  binderAmount: number;
  depositAmount: number;
  merchant: string;
  agent: string;
  splitAgent?: string;
  bookDate: Date;
  sourceAssignment: OwnerSourceAssignment;
  reason: BookingLeadReconciliationReason;
  candidates?: EvaluatedLeadCandidate[];
}) {
  const normalizedJob = normalizeJobNo(input.jobNo) ?? input.jobNo;
  const normalizedPhone =
    input.phoneNumber === NOT_PROVIDED_PHONE
      ? NOT_PROVIDED_NORMALIZED_PHONE
      : normalizePhoneNumberForMatch(input.phoneNumber) ?? NOT_PROVIDED_NORMALIZED_PHONE;
  const candidates = input.candidates ?? [];
  const policy = snapshotEmployeeBookingAutoMatchPolicy();
  return {
    booking: input.bookingId,
    origin: "owner_booking" as const,
    status: "pending" as const,
    reason: input.reason,
    submission: {
      submission_id: ownerBookingSubmissionId(normalizedJob),
      lead_name: input.leadName,
      normalized_name: normalizeComparisonName(input.leadName),
      phone_number: input.phoneNumber,
      normalized_phone_number: normalizedPhone,
      job_no: input.jobNo,
      normalized_job_no: normalizedJob,
      binder_amount: input.binderAmount,
      deposit_amount: input.depositAmount,
      merchant: input.merchant,
      agent: input.agent,
      ...(input.splitAgent ? { split_agent: input.splitAgent } : {}),
      book_date: input.bookDate,
      source_assignment: input.sourceAssignment,
    },
    latest_candidates: candidates.map(toCaseCandidate),
    match_attempts: [
      {
        attempted_at: new Date(),
        trigger: "initial" as const,
        outcome:
          input.reason === "matching_unavailable"
            ? ("error" as const)
            : candidates.length > 0
              ? ("conflict" as const)
              : ("no_match" as const),
        reason: input.reason,
        candidate_count: candidates.length,
        candidate_snapshot_hash: hashCandidates(candidates),
        auto_match_policy_version: policy.auto_match_policy_version,
        enabled_auto_match_rules: policy.enabled_auto_match_rules,
      },
    ],
    retry: buildRetryState(input.reason),
    resolution_history: [],
    revision: 0,
  };
}

function buildRetryState(reason: BookingLeadReconciliationReason) {
  const config = getBookingReconciliationConfig();
  if (!config.autoRematchEnabled || !config.autoRematchReasons.includes(reason)) {
    return { attempt_count: 0 };
  }
  const [firstDelayMinutes] = config.autoRematchDelaysMinutes;
  return {
    attempt_count: 0,
    next_attempt_at: new Date(Date.now() + firstDelayMinutes * 60_000),
  };
}

function toCaseCandidate(candidate: EvaluatedLeadCandidate) {
  return {
    lead_model: candidate.leadModel,
    lead_id: toObjectId(candidate.leadId),
    confidence: candidate.confidence,
    match_methods: candidate.matchMethods,
    eligibility: candidate.eligibility,
    source_compatibility: candidate.sourceCompatibility,
    warnings: candidate.warnings,
    snapshot: candidate.snapshot,
  };
}

function hashCandidates(candidates: EvaluatedLeadCandidate[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        candidates.map((candidate) => ({
          leadId: candidate.leadId,
          leadModel: candidate.leadModel,
          methods: [...candidate.matchMethods].sort(),
          eligibility: candidate.eligibility,
          sourceCompatibility: candidate.sourceCompatibility,
        })),
      ),
    )
    .digest("hex");
}

