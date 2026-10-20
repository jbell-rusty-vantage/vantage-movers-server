import type { RingCentralRouteResolution } from "../operationsRegistry";

export const CALL_LEAD_MINIMUM_ELAPSED_SECONDS = 120;
/** Compatibility for existing analytics/probe imports; qualification counts total elapsed time. */
export const CALL_LEAD_MINIMUM_ANSWERED_SECONDS = CALL_LEAD_MINIMUM_ELAPSED_SECONDS;

export type RingCentralQualificationFacts = {
  direction: string | null;
  routeResolution: RingCentralRouteResolution | null;
  durationSeconds: number | null;
  callerPhoneNumber: string | null;
};

export type RingCentralQualificationResult = {
  qualifies: boolean;
  rejectionReasons: string[];
};

export function qualifyRingCentralCall(
  facts: RingCentralQualificationFacts,
): RingCentralQualificationResult {
  const rejectionReasons: string[] = [];
  if (facts.direction !== "Inbound") rejectionReasons.push("not_inbound");
  if (!facts.routeResolution) rejectionReasons.push("target_number_not_matched");
  if (
    facts.durationSeconds === null ||
    !Number.isFinite(facts.durationSeconds) ||
    facts.durationSeconds < CALL_LEAD_MINIMUM_ELAPSED_SECONDS
  ) {
    rejectionReasons.push("under_120_seconds");
  }
  if (!facts.callerPhoneNumber) {
    rejectionReasons.push("missing_caller_phone_number");
  }
  return { qualifies: rejectionReasons.length === 0, rejectionReasons };
}
