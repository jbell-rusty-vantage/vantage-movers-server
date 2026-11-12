import { Schema } from "mongoose";
import { externalCallAdmissionSchema } from "../services/leads/callLeadAdmission";

/** Only the fenced final-import command may attach this immutable admission. */
export const externalCallAdmissionField = {
  type: new Schema({
    policy_version: { type: String, required: true }, source_workbook_id: { type: String, required: true },
    source_sheet_id: { type: Number, required: true }, source_tab: { type: String, required: true },
    stable_source_row_id: { type: String, required: true }, source_content_hash: { type: String, required: true },
    source_company_id: { type: String, required: true }, source_granularity_id: { type: String, required: true },
    source_arrival_at: { type: Date, required: true }, ingestion_run_id: { type: String, required: true },
    source_row_receipt_id: { type: String, required: true }, applied_at: { type: Date, required: true },
  }, { _id: false }),
  default: undefined,
  immutable: true,
  validate: { validator: (value: unknown) => value == null || externalCallAdmissionSchema.safeParse(value).success, message: "Invalid external Call admission provenance" },
};

export function applyExternalCallAdmissionGuards(schema: Schema): void {
  schema.pre("validate", function rejectAdmissionMutation() {
    if (!this.isNew && this.isModified("external_call_admission")) {
      this.invalidate("external_call_admission", "External Call admission is immutable after insert");
    }
  });
  schema.pre(["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace"], function rejectAdmissionUpdate() {
    const update = this.getUpdate();
    const operation = (this as unknown as { op: string }).op;
    // Replacement/pipeline writes could silently remove protected admission.
    if (Array.isArray(update) || operation === "replaceOne" || operation === "findOneAndReplace") {
      throw new Error("External Call admission requires the trusted final-import command");
    }
    const touches = (key: string) => key === "external_call_admission" || key.startsWith("external_call_admission.");
    for (const [operator, value] of Object.entries(update ?? {})) {
      if (touches(operator) || (value && typeof value === "object" && Object.keys(value).some(touches)) ||
          (operator === "$rename" && value && typeof value === "object" && Object.values(value).some(target => typeof target === "string" && touches(target)))) {
        throw new Error("External Call admission requires the trusted final-import command");
      }
    }
  });
}
