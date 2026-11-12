import { z } from "zod";
import { Types } from "mongoose";
import { hasQualifiedRingCentralCall, qualifiedCallLeadFilter } from "../ringcentral/callLeadQualification";
import { BEST_RELOCATION_TRACKER_ID } from "./externalSheetReview";
import { LEGACY_BEST_RELOCATION_CALL_IDS } from "./legacyBestRelocationCalls";
export { LEGACY_BEST_RELOCATION_CALL_MANIFEST } from "./legacyBestRelocationCalls";

export const EXTERNAL_CALL_ADMISSION_POLICY_VERSION = "best-relocation-final-import-v1";
export const BEST_RELOCATION_ADMISSION_COMPANY_ID = "6a4d240f3117eacd97823868";
export const BEST_RELOCATION_ADMISSION_CALL_FEED_ID = "6a4d240f04c6e063cb6621f3";
const objectId = z.string().regex(/^[a-f0-9]{24}$/);
const legacyIds = new Set<string>(LEGACY_BEST_RELOCATION_CALL_IDS);
const legacyMongoIds = [...LEGACY_BEST_RELOCATION_CALL_IDS.map(id => new Types.ObjectId(id)), ...LEGACY_BEST_RELOCATION_CALL_IDS];

/** Owner-approved final tracker admission; it is never RingCentral qualification. */
export const externalCallAdmissionSchema = z.object({
  policy_version: z.literal(EXTERNAL_CALL_ADMISSION_POLICY_VERSION),
  source_workbook_id: z.literal(BEST_RELOCATION_TRACKER_ID),
  source_sheet_id: z.literal(1191420872),
  source_tab: z.literal("Calls"),
  stable_source_row_id: z.string().min(1).max(256).regex(/\S/),
  source_content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  source_company_id: z.literal(BEST_RELOCATION_ADMISSION_COMPANY_ID),
  source_granularity_id: z.literal(BEST_RELOCATION_ADMISSION_CALL_FEED_ID),
  source_arrival_at: z.date(),
  ingestion_run_id: objectId,
  source_row_receipt_id: objectId,
  applied_at: z.date(),
});
export type ExternalCallAdmission = z.infer<typeof externalCallAdmissionSchema>;

export function hasTrustedExternalCallAdmission(value: unknown): value is ExternalCallAdmission {
  return externalCallAdmissionSchema.safeParse(value).success;
}

function canonicalId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toHexString" in value && typeof value.toHexString === "function") return value.toHexString();
  return null;
}

/** Preserves only the approved native historical inventory, without any Lead write. */
export function hasLegacyBestRelocationCall(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const lead = value as Record<string, unknown>;
  return legacyIds.has(canonicalId(lead._id) ?? "") && lead.source_company === "best_relocation_leads"
    && canonicalId(lead.lead_source_company) === BEST_RELOCATION_ADMISSION_COMPANY_ID
    && canonicalId(lead.source_granularity_id) === BEST_RELOCATION_ADMISSION_CALL_FEED_ID;
}

/** Independent saved RC, closed historical inventory, or approved final-source evidence. */
export function hasReportingEligibleCall(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const lead = value as Record<string, unknown>;
  if (hasQualifiedRingCentralCall(lead.ringcentral)) return true;
  if (hasLegacyBestRelocationCall(lead)) return true;
  const fact = lead.external_call_admission;
  return hasTrustedExternalCallAdmission(fact) && lead.source_company === "best_relocation_leads"
    && canonicalId(lead.lead_source_company) === fact.source_company_id
    && canonicalId(lead.source_granularity_id) === fact.source_granularity_id;
}

/** BSON Date checks intentionally reject imported ISO strings as admission evidence. */
export function reportingEligibleCallLeadFilter(): Record<string, unknown> {
  return { $or: [qualifiedCallLeadFilter(), {
    _id: { $in: [...legacyMongoIds] },
    source_company: "best_relocation_leads",
    lead_source_company: { $in: [new Types.ObjectId(BEST_RELOCATION_ADMISSION_COMPANY_ID), BEST_RELOCATION_ADMISSION_COMPANY_ID] },
    source_granularity_id: { $in: [new Types.ObjectId(BEST_RELOCATION_ADMISSION_CALL_FEED_ID), BEST_RELOCATION_ADMISSION_CALL_FEED_ID] },
    $expr: { $and: [
      { $eq: [{ $type: "$source_company" }, "string"] },
      ...["_id", "lead_source_company", "source_granularity_id"].map(field => ({ $in: [{ $type: `$${field}` }, ["objectId", "string"]] })),
    ] },
  }, {
    source_company: "best_relocation_leads",
    "external_call_admission.policy_version": EXTERNAL_CALL_ADMISSION_POLICY_VERSION,
    "external_call_admission.source_workbook_id": BEST_RELOCATION_TRACKER_ID,
    "external_call_admission.source_sheet_id": 1191420872,
    "external_call_admission.source_tab": "Calls",
    "external_call_admission.source_company_id": BEST_RELOCATION_ADMISSION_COMPANY_ID,
    "external_call_admission.source_granularity_id": BEST_RELOCATION_ADMISSION_CALL_FEED_ID,
    "external_call_admission.stable_source_row_id": { $type: "string", $regex: /\S/ },
    "external_call_admission.source_content_hash": { $type: "string", $regex: /^[a-f0-9]{64}$/ },
    "external_call_admission.ingestion_run_id": { $type: "string", $regex: /^[a-f0-9]{24}$/ },
    "external_call_admission.source_row_receipt_id": { $type: "string", $regex: /^[a-f0-9]{24}$/ },
    "external_call_admission.source_arrival_at": { $type: "date" },
    "external_call_admission.applied_at": { $type: "date" },
    $expr: { $and: [
      { $eq: [{ $type: "$source_company" }, "string"] },
      ...["policy_version", "source_workbook_id", "source_tab", "source_company_id", "source_granularity_id", "stable_source_row_id", "source_content_hash", "ingestion_run_id", "source_row_receipt_id"].map(field => ({ $eq: [{ $type: `$external_call_admission.${field}` }, "string"] })),
      { $isNumber: "$external_call_admission.source_sheet_id" },
      { $eq: [{ $type: "$external_call_admission.source_arrival_at" }, "date"] },
      { $eq: [{ $type: "$external_call_admission.applied_at" }, "date"] },
      { $eq: [{ $convert: { input: "$lead_source_company", to: "string", onError: "", onNull: "" } }, BEST_RELOCATION_ADMISSION_COMPANY_ID] },
      { $eq: [{ $convert: { input: "$source_granularity_id", to: "string", onError: "", onNull: "" } }, BEST_RELOCATION_ADMISSION_CALL_FEED_ID] },
      // Zod bounds UTF-16 code units; Mongo counts Unicode code points.
      { $lte: [{ $add: [
        { $strLenCP: { $convert: { input: "$external_call_admission.stable_source_row_id", to: "string", onError: "", onNull: "" } } },
        { $size: { $regexFindAll: { input: { $convert: { input: "$external_call_admission.stable_source_row_id", to: "string", onError: "", onNull: "" } }, regex: "[\\x{10000}-\\x{10FFFF}]" } } },
      ] }, 256] },
    ] },
  }] };
}
