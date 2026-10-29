import {
  type BookingLeadReconciliationReason,
  getEmployeeBookingMatchingConfig,
  type EmployeeBookingAutoMatchRule,
} from "../../config/domain";
import type {
  EmployeeBookingMatchOutcome,
  EvaluatedLeadCandidate,
  PreparedEmployeeBookingSubmission,
} from "./types";

export async function evaluateEmployeeBookingMatch(
  submission: PreparedEmployeeBookingSubmission,
  allCandidates: EvaluatedLeadCandidate[],
  hasCandidateOverflow = false,
): Promise<EmployeeBookingMatchOutcome> {
  const config = getEmployeeBookingMatchingConfig();
  const shared = preferFormLeadForSharedJob(allCandidates);
  const candidates = shared ?? allCandidates;
  const preferredModel =
    shared || submission.sourceAssignment.channel === "form" ? "FormLead" : "CallLead";

  const identityConflict = detectIdentityConflict(submission, candidates);
  if (identityConflict) {
    return pending("identity_conflict", candidates);
  }
  if (hasCandidateOverflow) {
    return pending("multiple_matches", candidates);
  }

  const strongestBlockedReason = detectStrongestBlockedReason(
    submission,
    candidates,
    preferredModel,
  );
  if (strongestBlockedReason) {
    return pending(strongestBlockedReason, candidates);
  }

  for (const rule of config.enabledRules) {
    const winner = evaluatePositiveRule(rule, submission, candidates, preferredModel);
    if (!winner) {
      continue;
    }
    if (winner.kind === "linked") {
      return winner;
    }
    if (winner.kind === "pending") {
      return winner;
    }
  }

  return pending(
    detectFallbackReason(submission, candidates, preferredModel),
    candidates,
  );
}

function evaluatePositiveRule(
  rule: EmployeeBookingAutoMatchRule,
  _submission: PreparedEmployeeBookingSubmission,
  candidates: EvaluatedLeadCandidate[],
  preferredModel: "FormLead" | "CallLead",
): EmployeeBookingMatchOutcome | null {
  switch (rule) {
    case "call_job_no_exact":
      if (preferredModel !== "CallLead") {
        return null;
      }
      return linkSingleEligible(
        rule,
        candidates.filter(
          (candidate) =>
            candidate.leadModel === "CallLead" &&
            candidate.matchMethods.includes("job_no") &&
            isSourceCompatibleForAutoAttach(candidate),
        ),
        candidates,
      );
    case "form_job_no_exact":
      if (preferredModel !== "FormLead") {
        return null;
      }
      return linkSingleEligible(
        rule,
        candidates.filter(
          (candidate) =>
            candidate.leadModel === "FormLead" &&
            candidate.matchMethods.includes("job_no") &&
            isSourceCompatibleForAutoAttach(candidate),
        ),
        candidates,
      );
  }
}

function linkSingleEligible(
  rule: EmployeeBookingAutoMatchRule,
  candidates: EvaluatedLeadCandidate[],
  allCandidates: EvaluatedLeadCandidate[],
): EmployeeBookingMatchOutcome | null {
  const eligible = candidates.filter(isCandidateEligibleForAutoAttach);
  if (eligible.length === 1) {
    return {
      kind: "linked",
      leadId: eligible[0].leadId,
      leadModel: eligible[0].leadModel,
      rule,
      candidates: allCandidates,
      reason: "high_confidence",
    };
  }
  if (eligible.length > 1) {
    return pending("multiple_matches", allCandidates);
  }
  return null;
}

function detectIdentityConflict(
  submission: PreparedEmployeeBookingSubmission,
  candidates: EvaluatedLeadCandidate[],
): boolean {
  const idsFor = (...methods: EvaluatedLeadCandidate["matchMethods"][number][]) =>
    new Set(
      candidates
        .filter((candidate) =>
          methods.some((method) => candidate.matchMethods.includes(method)),
        )
        .map((candidate) => candidate.leadId),
    );
  const primaryIds = idsFor("lid", "job_no");
  const phoneIds = idsFor("phone");
  const submittedContactIds = idsFor("phone", "email", "normalized_name");

  // LID and Job Number are primary identities. Once either identifies a Lead,
  // every submitted contact signal must remain on that same Lead.
  if (
    primaryIds.size > 0 &&
    [...submittedContactIds].some((leadId) => !primaryIds.has(leadId))
  ) {
    return true;
  }
  const lidIds = idsFor("lid");
  const jobIds = idsFor("job_no");
  // LID vs Job Number on different Leads is an identity conflict. Two Job
  // Number hits (or two LID hits) of the same kind are multiple_matches.
  if (
    lidIds.size > 0 &&
    jobIds.size > 0 &&
    ([...lidIds].some((leadId) => !jobIds.has(leadId)) ||
      [...jobIds].some((leadId) => !lidIds.has(leadId)))
  ) {
    return true;
  }

  // Without a primary identity, Email/Name may disambiguate a household Phone
  // shared by several Leads. It is a conflict only when the stronger contact
  // evidence and Phone evidence are disjoint.
  for (const method of ["email", "normalized_name"] as const) {
    const evidenceIds = idsFor(method);
    if (
      evidenceIds.size > 0 &&
      phoneIds.size > 0 &&
      [...evidenceIds].every((leadId) => !phoneIds.has(leadId))
    ) {
      return true;
    }
  }

  if (submission.normalizedLeadName) {
    return candidates.some((candidate) =>
      candidate.warnings.includes("name_contradiction"),
    );
  }
  return false;
}

function detectStrongestBlockedReason(
  submission: PreparedEmployeeBookingSubmission,
  candidates: EvaluatedLeadCandidate[],
  preferredModel: "FormLead" | "CallLead",
): BookingLeadReconciliationReason | undefined {
  const preferredCandidates = candidates.filter(
    (candidate) => candidate.leadModel === preferredModel,
  );
  const oppositeCandidates = candidates.filter(
    (candidate) => candidate.leadModel !== preferredModel,
  );

  if (preferredCandidates.length === 0 && oppositeCandidates.length > 0) {
    return "channel_conflict";
  }

  const exactIdentity = candidates.filter(
    (candidate) =>
      candidate.matchMethods.includes("lid") ||
      candidate.matchMethods.includes("job_no"),
  );
  const sourceConflictCandidate = exactIdentity.find(
    (candidate) => candidate.sourceCompatibility === "conflict",
  );
  if (sourceConflictCandidate) {
    return "source_conflict";
  }

  const ineligible = exactIdentity.find(
    (candidate) =>
      candidate.eligibility !== "eligible" ||
      candidate.warnings.includes("created_on_unmatched"),
  );
  if (ineligible?.eligibility === "duplicate") {
    return "duplicate_lead";
  }
  if (ineligible?.eligibility === "booked") {
    return "lead_already_booked";
  }
  if (ineligible?.eligibility === "cancelled") {
    return "lead_cancelled";
  }
  if (ineligible?.warnings.includes("created_on_unmatched")) {
    return "no_match";
  }

  const exactEligible = exactIdentity.filter(isCandidateEligibleForAutoAttach);
  if (exactEligible.length > 1) {
    return "multiple_matches";
  }

  const exactUnassigned = exactIdentity.find(
    (candidate) => candidate.sourceCompatibility === "unassigned",
  );
  if (exactUnassigned) {
    return "source_conflict";
  }

  const exactSameCompany = exactIdentity.find(
    (candidate) => candidate.sourceCompatibility === "same_company",
  );
  if (exactSameCompany?.snapshot.source_granularity_key) {
    return "source_conflict";
  }

  return undefined;
}

function detectFallbackReason(
  _submission: PreparedEmployeeBookingSubmission,
  candidates: EvaluatedLeadCandidate[],
  preferredModel: "FormLead" | "CallLead",
): BookingLeadReconciliationReason {
  const preferredCandidates = candidates.filter(
    (candidate) => candidate.leadModel === preferredModel,
  );
  if (preferredCandidates.length === 0 && candidates.length > 0) {
    return "channel_conflict";
  }
  if (preferredCandidates.some((candidate) => candidate.sourceCompatibility === "conflict")) {
    return "source_conflict";
  }
  if (preferredCandidates.filter(isCandidateEligibleForAutoAttach).length > 1) {
    return "multiple_matches";
  }
  return "no_match";
}

function isSourceCompatibleForAutoAttach(candidate: EvaluatedLeadCandidate): boolean {
  return (
    candidate.sourceCompatibility === "exact_granularity" ||
    (candidate.sourceCompatibility === "same_company" &&
      !candidate.snapshot.source_granularity_key)
  );
}

function isCandidateEligibleForAutoAttach(candidate: EvaluatedLeadCandidate): boolean {
  return (
    candidate.eligibility === "eligible" &&
    !candidate.warnings.includes("created_on_unmatched")
  );
}

function pending(
  reason: BookingLeadReconciliationReason,
  candidates: EvaluatedLeadCandidate[],
): EmployeeBookingMatchOutcome {
  return {
    kind: "pending",
    reason,
    candidates,
  };
}

/**
 * Owner rule 2026-10-28: a Form Lead and a qualified Call Lead may hold the same Job (one customer, two
 * origins; the Granot Form sibling update copies the job onto the Call Lead). When exactly one Form Lead
 * matched the submission's job, every Call Lead that also matched by job is set aside and the Form Lead
 * is the preferred anchor; the Form candidate carries `call_lead_shares_job` so the case shows why.
 * Returns null when the job is not shared that way (two Form Leads on one job stay `multiple_matches`).
 */
export function preferFormLeadForSharedJob(
  candidates: readonly EvaluatedLeadCandidate[],
): EvaluatedLeadCandidate[] | null {
  const byJob = (model: EvaluatedLeadCandidate["leadModel"]) =>
    candidates.filter((candidate) => candidate.leadModel === model && candidate.matchMethods.includes("job_no"));
  const forms = byJob("FormLead");
  const calls = byJob("CallLead");
  if (forms.length !== 1 || calls.length === 0) return null;
  const set = new Set(calls);
  return candidates
    .filter((candidate) => !set.has(candidate))
    .map((candidate) =>
      candidate === forms[0] ? { ...candidate, warnings: [...candidate.warnings, "call_lead_shares_job"] } : candidate,
    );
}
