import type { ClientSession } from "mongoose";
import { CallLead } from "../../models/CallLead";
import { FormLead } from "../../models/FormLead";
import { classifyLeadSourceCompatibility } from "../leads/leadSourceCompatibility";
import { normalizeComparisonName } from "../bookings/bookingIdentity";
import type {
  EmployeeBookingCandidateQueryResult,
  EvaluatedLeadCandidate,
  PreparedEmployeeBookingSubmission,
} from "./types";

const CANDIDATE_QUERY_CAP = 25;
const CANDIDATE_QUERY_LIMIT = CANDIDATE_QUERY_CAP + 1;

export async function queryEmployeeBookingCandidates(
  submission: PreparedEmployeeBookingSubmission,
  session?: ClientSession,
): Promise<EmployeeBookingCandidateQueryResult> {
  const [formByLid, callByJobNo, formByPhone, callByPhone, formByEmail, formByName] =
    await Promise.all([
      submission.normalizedLid
        ? runQuery(
            FormLead.find({ normalized_lid: submission.normalizedLid }).limit(CANDIDATE_QUERY_LIMIT),
            session,
          )
        : Promise.resolve([]),
      runQuery(
        CallLead.find({ normalized_job_no: submission.normalizedJobNo }).limit(CANDIDATE_QUERY_LIMIT),
        session,
      ),
      runQuery(
        FormLead.find({
          $or: [
            { normalized_phone_number: submission.normalizedPhoneNumber },
            { phone_number: buildPhoneRegex(submission.normalizedPhoneNumber) },
          ],
        }).limit(CANDIDATE_QUERY_LIMIT),
        session,
      ),
      runQuery(
        CallLead.find({
          $or: [
            { normalized_phone_number: submission.normalizedPhoneNumber },
            { phone_number: buildPhoneRegex(submission.normalizedPhoneNumber) },
          ],
        }).limit(CANDIDATE_QUERY_LIMIT),
        session,
      ),
      submission.normalizedEmail
        ? runQuery(
            FormLead.find({ email: submission.normalizedEmail }).limit(CANDIDATE_QUERY_LIMIT),
            session,
          )
        : Promise.resolve([]),
      submission.normalizedEmail && submission.normalizedLeadName
        ? runQuery(
            FormLead.find({
              normalized_contact_name: submission.normalizedLeadName,
            }).limit(CANDIDATE_QUERY_LIMIT),
            session,
          )
        : Promise.resolve([]),
    ]);

  const merged = new Map<string, EvaluatedLeadCandidate>();
  const queryResults = [
    formByLid,
    callByJobNo,
    formByPhone,
    callByPhone,
    formByEmail,
    formByName,
  ];
  const hasOverflow = queryResults.some((docs) => docs.length > CANDIDATE_QUERY_CAP);
  addCandidates(merged, "FormLead", formByLid.slice(0, CANDIDATE_QUERY_CAP), "lid", submission);
  addCandidates(merged, "CallLead", callByJobNo.slice(0, CANDIDATE_QUERY_CAP), "job_no", submission);
  addCandidates(merged, "FormLead", formByPhone.slice(0, CANDIDATE_QUERY_CAP), "phone", submission);
  addCandidates(merged, "CallLead", callByPhone.slice(0, CANDIDATE_QUERY_CAP), "phone", submission);
  addCandidates(merged, "FormLead", formByEmail.slice(0, CANDIDATE_QUERY_CAP), "email", submission);
  addCandidates(
    merged,
    "FormLead",
    formByName.slice(0, CANDIDATE_QUERY_CAP),
    "normalized_name",
    submission,
  );
  return { candidates: [...merged.values()], hasOverflow };
}

async function runQuery<T extends { session?: (session: ClientSession | null) => unknown; exec: () => Promise<unknown[]> }>(
  query: T,
  session?: ClientSession,
): Promise<Record<string, unknown>[]> {
  const execution = session ? ((query as any).session(session) as T) : query;
  return (await (execution as any).exec()) as Record<string, unknown>[];
}

function addCandidates(
  merged: Map<string, EvaluatedLeadCandidate>,
  leadModel: "FormLead" | "CallLead",
  docs: Record<string, unknown>[],
  matchMethod: EvaluatedLeadCandidate["matchMethods"][number],
  submission: PreparedEmployeeBookingSubmission,
): void {
  for (const doc of docs) {
    const leadId = String(doc._id);
    const key = `${leadModel}:${leadId}`;
    const existing = merged.get(key);
    if (existing) {
      if (!existing.matchMethods.includes(matchMethod)) {
        existing.matchMethods.push(matchMethod);
      }
      existing.confidence = confidenceFor(existing.matchMethods);
      continue;
    }

    const sourceCompatibility = classifyLeadSourceCompatibility(doc, {
      source_company: submission.sourceAssignment.source_company,
      lead_source_company: submission.sourceAssignment.lead_source_company.toString(),
      source_granularity_key: submission.sourceAssignment.source_granularity_key,
    });
    const warnings = buildCandidateWarnings(
      doc,
      leadModel,
      sourceCompatibility,
      submission,
    );
    const candidate: EvaluatedLeadCandidate = {
      leadId,
      leadModel,
      confidence: confidenceFor([matchMethod]),
      matchMethods: [matchMethod],
      eligibility: classifyEligibility(doc),
      sourceCompatibility,
      warnings,
      snapshot: {
        name: stringValue(doc.name),
        phone_number: stringValue(doc.phone_number),
        email: stringValue(doc.email),
        lid: stringValue(doc.lid),
        job_no: stringValue(doc.job_no),
        source_company: stringValue(doc.source_company),
        source_granularity_key: stringValue(doc.source_granularity_key),
        booked: doc.booked ? String(doc.booked) : undefined,
        cancelled: doc.cancelled ? String(doc.cancelled) : undefined,
        duplicate: doc.duplicate === true,
      },
    };

    if (
      leadModel === "FormLead" &&
      matchMethod === "normalized_name" &&
      submission.normalizedLeadName &&
      normalizeComparisonName(stringValue(doc.name)) !== submission.normalizedLeadName
    ) {
      continue;
    }

    merged.set(key, candidate);
  }
}

function confidenceFor(
  methods: EvaluatedLeadCandidate["matchMethods"],
): EvaluatedLeadCandidate["confidence"] {
  if (methods.includes("lid") || methods.includes("job_no")) {
    return "high";
  }
  if (
    methods.includes("phone") &&
    (methods.includes("email") || methods.includes("normalized_name"))
  ) {
    return "high";
  }
  if (methods.includes("phone") || methods.includes("email")) {
    return "medium";
  }
  return "low";
}

function classifyEligibility(doc: Record<string, unknown>): EvaluatedLeadCandidate["eligibility"] {
  if (doc.cancelled) {
    return "cancelled";
  }
  if (doc.booked) {
    return "booked";
  }
  if (doc.duplicate === true) {
    return "duplicate";
  }
  return "eligible";
}

function buildCandidateWarnings(
  doc: Record<string, unknown>,
  leadModel: "FormLead" | "CallLead",
  sourceCompatibility: EvaluatedLeadCandidate["sourceCompatibility"],
  submission: PreparedEmployeeBookingSubmission,
): string[] {
  const warnings: string[] = [];
  if (doc.duplicate === true) {
    warnings.push("duplicate_lead");
  }
  if (doc.booked) {
    warnings.push("lead_already_booked");
  }
  if (doc.cancelled) {
    warnings.push("lead_cancelled");
  }
  if (leadModel === "CallLead" && doc.created_on_unmatched === true) {
    warnings.push("created_on_unmatched");
  }
  if (
    submission.sourceAssignment.channel === "form" &&
    leadModel === "CallLead"
  ) {
    warnings.push("channel_conflict");
  }
  if (
    submission.sourceAssignment.channel === "call" &&
    leadModel === "FormLead"
  ) {
    warnings.push("channel_conflict");
  }
  if (sourceCompatibility === "conflict") {
    warnings.push("source_conflict");
  } else if (sourceCompatibility === "unassigned") {
    warnings.push("source_unassigned");
  } else if (sourceCompatibility === "same_company") {
    warnings.push("same_company_legacy");
  }
  if (
    leadModel === "FormLead" &&
    submission.normalizedLeadName &&
    normalizeComparisonName(stringValue(doc.name)) &&
    normalizeComparisonName(stringValue(doc.name)) !== submission.normalizedLeadName
  ) {
    warnings.push("name_contradiction");
  }
  return warnings;
}

function buildPhoneRegex(normalizedPhone: string): RegExp {
  const digits = normalizedPhone.replace(/\D/g, "");
  return new RegExp(`(?:^|\\D)${digits.split("").join("\\D*")}(?:\\D|$)`);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
