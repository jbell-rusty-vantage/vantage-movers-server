import { z } from "zod";

export const EXTERNAL_REVIEW_POLICY_VERSION = "best-relocation-retirement-v1";
export const EXTERNAL_REVIEW_NOTE_LIMIT = 4000;
export const BEST_RELOCATION_TRACKER_ID = "1KZrKD9Oa8vMkuEkHUGOVXcsPV0tkKutDGb3Qq1wFuk0";
export const REVIEW_SOURCE_TABS = { Forms: 0, "Local Forms": 584355266, Calls: 1191420872 } as const;
export const externalSheetReviewSchema = z.object({
  kind: z.enum(["bad_form", "bad_call", "duplicate_call"]),
  reason_code: z.enum(["external_bad_form", "external_bad_call", "external_form_fill", "external_duplicate"]),
  raw_value: z.string().min(1).max(EXTERNAL_REVIEW_NOTE_LIMIT).regex(/\S/),
  normalized_value: z.string().min(1).max(EXTERNAL_REVIEW_NOTE_LIMIT).regex(/\S/),
  source_workbook_id: z.literal(BEST_RELOCATION_TRACKER_ID),
  source_sheet_id: z.number().int(), source_tab: z.enum(["Forms", "Local Forms", "Calls"]),
  stable_source_row_id: z.string().min(1).max(256).regex(/\S/),
  source_content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  policy_version: z.literal(EXTERNAL_REVIEW_POLICY_VERSION),
  ingestion_run_id: z.string().min(1).max(256).regex(/\S/), source_row_receipt_id: z.string().min(1).max(256).regex(/\S/),
  applied_at: z.date(),
}).superRefine((fact, ctx) => {
  if (!(fact.kind === "duplicate_call" ? ["external_form_fill", "external_duplicate"].includes(fact.reason_code) : fact.reason_code === (fact.kind === "bad_form" ? "external_bad_form" : "external_bad_call"))) ctx.addIssue({code: "custom", message: "Review reason disagrees with kind"});
  if (REVIEW_SOURCE_TABS[fact.source_tab] !== fact.source_sheet_id ||
      ((fact.source_tab === "Calls") === (fact.kind === "bad_form")))
    ctx.addIssue({ code: "custom", message: "Review source and classification disagree" });
});
export type ExternalSheetReview = z.infer<typeof externalSheetReviewSchema>;

/** Only the versioned canonical import command writes these protected facts. */
export function hasTrustedExternalSheetReview(value: unknown, kinds?: readonly ExternalSheetReview["kind"][]): value is ExternalSheetReview {
  const parsed = externalSheetReviewSchema.safeParse(value);
  return parsed.success && (!kinds || kinds.includes(parsed.data.kind));
}

/** A formula/error cell is evidence to review, never a billing annotation. */
export function classifyExternalReview(value: unknown, model: "FormLead" | "CallLead"):
  { kind: ExternalSheetReview["kind"]; reason_code: ExternalSheetReview["reason_code"]; normalized_value: string; raw_value: string } | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || (model === "FormLead" && raw.length <= 2)) return null;
  if (value.length > EXTERNAL_REVIEW_NOTE_LIMIT) throw new Error("external_review_note_over_limit");
  if (/^#(?:REF!|N\/A|VALUE!|ERROR!|DIV\/0!|NAME\?|NUM!|SPILL!|NULL!)/i.test(raw) ||
      /^(?:form fill checker|bad lead checker|phone number|timestamp|total|grand total)$/i.test(raw))
    throw new Error("external_review_structural_or_error_cell");
  const normalized_value = raw.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
  if (normalized_value.length > EXTERNAL_REVIEW_NOTE_LIMIT) throw new Error("external_review_note_over_limit");
  const kind = model === "FormLead" ? "bad_form" : ["form fill", "duplicate", "duplicate call"].includes(normalized_value) ? "duplicate_call" : "bad_call";
  return { kind, reason_code: kind === "bad_form" ? "external_bad_form" : kind === "bad_call" ? "external_bad_call" : normalized_value === "form fill" ? "external_form_fill" : "external_duplicate", normalized_value, raw_value: value };
}
