import type { RingCentralRouteResolution } from "../operationsRegistry";

export const CALL_LEAD_MINIMUM_ANSWERED_SECONDS = 120;

export type RingCentralQualificationFacts = {
  direction: string | null;
  routeResolution: RingCentralRouteResolution | null;
  answered: boolean;
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
  if (!facts.answered) rejectionReasons.push("not_answered");
  if (
    facts.durationSeconds === null ||
    facts.durationSeconds < CALL_LEAD_MINIMUM_ANSWERED_SECONDS
  ) {
    rejectionReasons.push("under_120_seconds");
  }
  if (!facts.callerPhoneNumber) {
    rejectionReasons.push("missing_caller_phone_number");
  }
  return { qualifies: rejectionReasons.length === 0, rejectionReasons };
}
