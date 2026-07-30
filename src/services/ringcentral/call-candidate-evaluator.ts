import type {
  CandidateDecision,
  RingCentralCallCandidateDocument,
} from "./call-candidate-types";
import {
  CALL_LEAD_MINIMUM_ANSWERED_SECONDS,
  qualifyRingCentralCall,
} from "./call-qualification";

// Webhook-only, best-effort candidate decisions for local validation.
// This intentionally does not create real call leads or call RingCentral Call Log.
export { CALL_LEAD_MINIMUM_ANSWERED_SECONDS } from "./call-qualification";

export function isLikelyTerminalRingCentralStatus(
  statusCode: string | null | undefined,
): boolean {
  return [
    "Disconnected",
    "Gone",
    "Finished",
    "Voicemail",
    "Missed",
    "NoCall",
  ].includes(statusCode ?? "");
}

export function evaluateRingCentralCallCandidate(
  candidate: RingCentralCallCandidateDocument,
  now = new Date(),
): CandidateDecision {
  const estimatedDurationSeconds = estimateAnsweredDurationSeconds(
    candidate.answeredAt,
    candidate.terminalAt,
    now,
  );

  if (candidate.direction !== "Inbound") {
    return reject("not_inbound");
  }

  if (
    !candidate.targetMatched ||
    !candidate.sourceCompany ||
    !candidate.sourceLabel ||
    !candidate.routeResolution
  ) {
    return reject("target_number_not_matched");
  }

  if (!candidate.normalizedFromPhoneNumber) {
    return {
      wouldCreateCallLead: false,
      decisionStatus: "needs_review",
      decisionReason: "missing_caller_phone_number",
      leadPreview: null,
    };
  }

  if (!candidate.answered) {
    if (candidate.terminal || candidate.missedCall === true) {
      return reject("not_answered");
    }
    return {
      wouldCreateCallLead: false,
      decisionStatus: "candidate",
      decisionReason: "inbound_target_waiting_for_answer",
      leadPreview: null,
    };
  }

  if (candidate.missedCall === true && !candidate.answeredAt) {
    return reject("not_answered");
  }

  if (!candidate.answeredAt) {
    return {
      wouldCreateCallLead: false,
      decisionStatus: "needs_review",
      decisionReason: "answered_missing_answered_at",
      leadPreview: null,
    };
  }

  if (estimatedDurationSeconds < CALL_LEAD_MINIMUM_ANSWERED_SECONDS) {
    if (candidate.terminal) {
      return reject("under_120_seconds");
    }
    return {
      wouldCreateCallLead: false,
      decisionStatus: "pending_buffer",
      decisionReason: "answered_but_under_120_seconds",
      leadPreview: null,
    };
  }

  const sharedQualification = qualifyRingCentralCall({
    direction: candidate.direction,
    routeResolution: candidate.routeResolution,
    answered: candidate.answered,
    durationSeconds: estimatedDurationSeconds,
    callerPhoneNumber: candidate.normalizedFromPhoneNumber,
  });
  if (!sharedQualification.qualifies) {
    return reject(sharedQualification.rejectionReasons[0] ?? "not_qualified");
  }

  return {
    wouldCreateCallLead: true,
    decisionStatus: "qualified",
    decisionReason: candidate.terminalAt
      ? "inbound_target_answered_over_120s"
      : "inbound_target_answered_over_120s_webhook_elapsed_best_effort",
    leadPreview: {
      provider: "ringcentral",
      sourceCompany: candidate.sourceCompany,
      sourceLabel: candidate.sourceLabel,
      routeResolution: candidate.routeResolution,
      callerPhoneNumber: candidate.normalizedFromPhoneNumber,
      callerName: candidate.fromName,
      targetPhoneNumber:
        candidate.normalizedToPhoneNumber ?? candidate.toPhoneNumber ?? "",
      targetName: candidate.toName,
      telephonySessionId: candidate.telephonySessionId,
      sessionId: candidate.sessionId,
      partyId: candidate.partyId,
      answeredAt: candidate.answeredAt,
      terminalAt: candidate.terminalAt,
      estimatedDurationSeconds,
      qualificationReason: "inbound_target_answered_over_120s",
    },
  };
}

export function estimateAnsweredDurationSeconds(
  answeredAt: Date | null,
  terminalAt: Date | null,
  now: Date,
): number {
  if (!answeredAt) {
    return 0;
  }

  const end = terminalAt ?? now;
  return Math.max(0, Math.floor((end.getTime() - answeredAt.getTime()) / 1000));
}

function reject(decisionReason: string): CandidateDecision {
  return {
    wouldCreateCallLead: false,
    decisionStatus: "rejected",
    decisionReason,
    leadPreview: null,
  };
}
