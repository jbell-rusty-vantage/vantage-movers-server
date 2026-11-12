import { CALL_LEAD_MINIMUM_ELAPSED_SECONDS as minimumSeconds } from "./call-qualification";

/** Facts persisted by the inbound queue vetter, including its pre-route-ID format. */
const reasons = [
  "call_log_inbound_target_elapsed_at_least_120s",
  "call_log_inbound_target_answered_over_120s",
];
const identities = ["telephony_session_id", "call_log_id"];
const transports = ["call_log_sync", "webhook"];

export function hasQualifiedRingCentralCall(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const rc = metadata as Record<string, unknown>;
  return typeof rc.ingestion_source === "string" && transports.includes(rc.ingestion_source)
    && typeof rc.qualification_reason === "string" && reasons.includes(rc.qualification_reason)
    && typeof rc.duration_seconds === "number" && Number.isFinite(rc.duration_seconds) && rc.duration_seconds >= minimumSeconds
    && identities.some((id) => typeof rc[id] === "string" && /\S/.test(rc[id] as string));
}

/** Mongo equivalent for billing and candidate reads, applied before limits and grouping. */
export function qualifiedCallLeadFilter(): Record<string, unknown> {
  return {
    "ringcentral.ingestion_source": { $in: transports },
    "ringcentral.qualification_reason": { $in: reasons },
    "ringcentral.duration_seconds": { $gte: minimumSeconds, $lte: Number.MAX_VALUE },
    $expr: { $and: [
      { $eq: [{ $type: "$ringcentral.ingestion_source" }, "string"] },
      { $eq: [{ $type: "$ringcentral.qualification_reason" }, "string"] },
      { $isNumber: "$ringcentral.duration_seconds" },
    ] },
    $or: identities.map((field) => ({
      [`ringcentral.${field}`]: /\S/,
      $expr: { $eq: [{ $type: `$ringcentral.${field}` }, "string"] },
    })),
  };
}
