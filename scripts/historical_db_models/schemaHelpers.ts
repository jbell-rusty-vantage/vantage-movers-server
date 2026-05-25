import { Schema } from "mongoose";

/** Plain string — historical backfill may contain legacy or unknown source labels. */
export const sourceCompanyField = {
  type: String,
  trim: true,
  index: true,
} as const;

export const localField = {
  type: String,
  trim: true,
  index: true,
} as const;

export const optionalLocalField = {
  type: String,
  trim: true,
  index: true,
} as const;

export const leadModelField = {
  type: String,
  trim: true,
  index: true,
} as const;

export const AgentAllocationSchema = new Schema(
  {
    agent: { type: Schema.Types.ObjectId, ref: "Agent", index: true },
    agent_name_snapshot: { type: String, trim: true },
    binder_amount: { type: Number, min: 0 },
  },
  { _id: false },
);

export const ImportMetadataFields = {
  source_row_key: { type: String, trim: true, unique: true, sparse: true, index: true },
  import_batch_id: { type: String, trim: true, index: true },
  source_workbook: { type: String, trim: true, index: true },
  source_tab: { type: String, trim: true, index: true },
  source_row: { type: Number },
  raw_row: { type: Schema.Types.Mixed },
} as const;
