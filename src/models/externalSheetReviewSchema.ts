import { Schema } from "mongoose";
import { externalSheetReviewSchema } from "../services/leads/externalSheetReview";

export function externalSheetReviewField(model: "FormLead" | "CallLead") {
  return {
    type: new Schema({
      kind: { type: String, required: true, enum: model === "FormLead" ? ["bad_form"] : ["bad_call", "duplicate_call"] },
      reason_code: { type: String, required: true }, raw_value: { type: String, required: true, maxlength: 4000 },
      normalized_value: { type: String, required: true, maxlength: 4000 },
      source_workbook_id: { type: String, required: true }, source_sheet_id: { type: Number, required: true },
      source_tab: { type: String, required: true }, stable_source_row_id: { type: String, required: true },
      source_content_hash: { type: String, required: true }, policy_version: { type: String, required: true },
      ingestion_run_id: { type: String, required: true }, source_row_receipt_id: { type: String, required: true },
      applied_at: { type: Date, required: true },
    }, { _id: false }),
    default: undefined,
    validate: { validator: (value: unknown) => value == null || externalSheetReviewSchema.safeParse(value).success, message: "Invalid external sheet review provenance" },
  };
}
