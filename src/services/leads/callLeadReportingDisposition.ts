import { hasReportingEligibleCall, reportingEligibleCallLeadFilter } from "./callLeadAdmission";
import { hasTrustedExternalSheetReview } from "./externalSheetReview";

export type CallDisposition = "excluded" | "calls" | "duplicate_calls" | "bad_call_leads";
export type CallReportingDecision = { disposition: CallDisposition; billable: boolean; reason_codes: string[] };
const nyClock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" });

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
export function isOvernightCallArrival(value: unknown): boolean {
  const rc = record(record(value).ringcentral);
  // Never fall back to document creation or a timezone-free wall-clock string.
  const start = rc.start_time instanceof Date ? rc.start_time : null;
  if (!start || !Number.isFinite(+start)) return false;
  const hour = Number(nyClock.format(start));
  return hour >= 1 && hour < 7;
}

export function getCallLeadReportingDecision(value: unknown): CallReportingDecision {
  const call = record(value), rc = record(call.ringcentral);
  const reasons: string[] = [];
  if (!hasReportingEligibleCall(call)) reasons.push("missing_call_reporting_admission");
  if (call.created_on_unmatched === true) reasons.push("created_on_unmatched");
  if (reasons.length) return { disposition: "excluded", billable: false, reason_codes: reasons };
  if (call.duplicate === true) reasons.push("repeat_call_duplicate");
  if (call.form_fill === true) reasons.push("form_fill");
  const review = hasTrustedExternalSheetReview(call.external_sheet_review) ? call.external_sheet_review : null;
  if (review?.kind === "duplicate_call") reasons.push(review.reason_code);
  if (review?.kind === "bad_call") reasons.push("external_bad_call");
  const missed = typeof rc.final_result === "string" && rc.final_result.trim().toLowerCase() === "missed";
  const finalObserved = rc.final_result_observed_at instanceof Date && Number.isFinite(+rc.final_result_observed_at);
  const sameIdentity = typeof rc.final_result_call_log_id === "string" && !!rc.final_result_call_log_id.trim() && rc.final_result_call_log_id === rc.call_log_id;
  if (missed && finalObserved && sameIdentity && isOvernightCallArrival(call)) {
    if (rc.final_result_answered === false) reasons.push("overnight_missed_call");
    else if (rc.final_result_answered === true) reasons.push("conflicting_final_result");
  }
  const duplicate = call.duplicate === true || call.form_fill === true || review?.kind === "duplicate_call";
  const bad = reasons.some(reason => ["external_bad_call", "overnight_missed_call"].includes(reason));
  return { disposition: duplicate ? "duplicate_calls" : bad ? "bad_call_leads" : "calls", billable: !duplicate && !bad, reason_codes: reasons };
}

/** Same call policy as the object decision, usable before aggregation/limits. */
export function billableCallLeadFilter(): Record<string, unknown> {
  const validReview = (kind: string) => ({
    "external_sheet_review.kind": kind,
    "external_sheet_review.reason_code": kind === "bad_call" ? "external_bad_call" : { $in: ["external_form_fill", "external_duplicate"] },
    "external_sheet_review.policy_version": "best-relocation-retirement-v1",
    "external_sheet_review.source_workbook_id": "1KZrKD9Oa8vMkuEkHUGOVXcsPV0tkKutDGb3Qq1wFuk0",
    "external_sheet_review.source_sheet_id": 1191420872,
    "external_sheet_review.source_tab": "Calls",
    ...Object.fromEntries(["raw_value", "normalized_value", "stable_source_row_id", "ingestion_run_id", "source_row_receipt_id"].map(key => [`external_sheet_review.${key}`, { $type: "string", $regex: /\S/ }])),
    "external_sheet_review.source_content_hash": /^[a-f0-9]{64}$/,
    "external_sheet_review.applied_at": { $type: "date" },
    $expr: { $and: [
      ...["kind", "reason_code", "policy_version", "source_workbook_id", "source_tab", "source_content_hash", "raw_value", "normalized_value", "stable_source_row_id", "ingestion_run_id", "source_row_receipt_id"].map(key => ({ $eq: [{ $type: `$external_sheet_review.${key}` }, "string"] })),
      { $isNumber: "$external_sheet_review.source_sheet_id" },
      { $eq: [{ $type: "$external_sheet_review.applied_at" }, "date"] },
      ...["raw_value", "normalized_value", "stable_source_row_id", "ingestion_run_id", "source_row_receipt_id"].map(key => {
        const text = { $convert: { input: `$external_sheet_review.${key}`, to: "string", onError: "", onNull: "" } };
        // Zod/Mongoose bounds count UTF-16 units; supplementary characters
        // contribute two units rather than Mongo's single code point.
        const length = { $add: [{ $strLenCP: text }, { $size: { $regexFindAll: { input: text, regex: "[\\x{10000}-\\x{10FFFF}]" } } }] };
        return { $lte: [length, key === "raw_value" || key === "normalized_value" ? 4000 : 256] };
      }),
    ] },
  });
  const start = { $convert: { input: "$ringcentral.start_time", to: "date", onError: new Date(0), onNull: new Date(0) } };
  const hour = { $hour: { date: start, timezone: "America/New_York" } };
  return { $and: [reportingEligibleCallLeadFilter(), { created_on_unmatched: { $ne: true }, duplicate: { $ne: true }, form_fill: { $ne: true } },
    { $nor: [validReview("duplicate_call"), validReview("bad_call")] },
    { $nor: [{ "ringcentral.final_result": /^\s*missed\s*$/i, "ringcentral.final_result_answered": false,
      "ringcentral.final_result_observed_at": { $type: "date" }, "ringcentral.start_time": { $type: "date" }, "ringcentral.final_result_call_log_id": /\S/,
      $expr: { $and: [{ $eq: ["$ringcentral.final_result_call_log_id", "$ringcentral.call_log_id"] }, { $gte: [hour, 1] }, { $lt: [hour, 7] }] } }] },
  ] };
}

export { hasTrustedExternalSheetReview } from "./externalSheetReview";

/** Aggregation flag built from the exact match predicate, so receiver/export
 * totals can retain qualified raw volume without charging exception rows. */
export function billableCallLeadExpression(): Record<string, unknown> {
  const predicate = (match: Record<string, unknown>): Record<string, unknown> => ({ $and: Object.entries(match).map(([field, value]) => {
    if (field === "$expr") return value;
    if (field === "$and" || field === "$or") return { [field]: (value as Record<string, unknown>[]).map(predicate) };
    if (field === "$nor") return { $not: [{ $or: (value as Record<string, unknown>[]).map(predicate) }] };
    const ref = `$${field}`;
    const regex = (pattern: RegExp) => ({ $and: [ { $eq: [{ $type: ref }, "string"] },
      { $regexMatch: { input: { $convert: { input: ref, to: "string", onError: "", onNull: "" } }, regex: pattern } },
    ] });
    if (value instanceof RegExp) return regex(value);
    if (!value || typeof value !== "object") return { $eq: [ref, value] };
    return { $and: Object.entries(value).map(([operator, expected]) => {
      if (operator === "$type") return { $eq: [{ $type: ref }, expected] };
      if (operator === "$regex") return regex(expected as RegExp);
      if (operator === "$in") return { $in: [ref, expected] };
      if (["$eq", "$ne", "$gte", "$lte", "$gt", "$lt"].includes(operator)) return { [operator]: [{ $ifNull: [ref, null] }, expected] };
      throw new Error("unsupported_call_billing_predicate_operator");
    }) };
  }) });
  return predicate(billableCallLeadFilter());
}
