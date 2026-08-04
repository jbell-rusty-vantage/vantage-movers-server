import { Schema } from "mongoose";

export function durableRunControlFields() {
  return {
    lease_owner: { type: String, default: null, index: true },
    leased_until: { type: Date, default: null, index: true },
    lease_epoch: { type: Number, required: true, default: 0, min: 0 },
    checkpoint: {
      type: new Schema(
        {
          version: { type: Number, required: true, min: 1 },
          phase: { type: String, required: true, trim: true },
          cursor: { type: Schema.Types.Mixed, required: true },
          completed_units: { type: Number, required: true, min: 0 },
          updated_at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    attempt_count: { type: Number, required: true, default: 0, min: 0 },
    last_attempt_at: { type: Date, default: null },
    started_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    failure: {
      type: new Schema(
        {
          code: { type: String, required: true, trim: true },
          class: {
            type: String,
            required: true,
            enum: [
              "structural",
              "row",
              "provider",
              "lease",
              "cancelled",
            ],
          },
          retryable: { type: Boolean, required: true },
          summary: { type: String, required: true, trim: true },
          phase: { type: String, required: true, trim: true },
          provider_status: { type: Number },
        },
        { _id: false },
      ),
      default: null,
    },
  } as const;
}

export function fencedLeaseFields() {
  return {
    scope: { type: String, required: true, trim: true, unique: true },
    lease_owner: { type: String, default: null, trim: true },
    leased_until: { type: Date, default: null, index: true },
    lease_epoch: { type: Number, required: true, default: 0, min: 0 },
  } as const;
}
