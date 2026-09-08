import mongoose, { Schema, type Model } from "mongoose";
import {
  DAILY_OPERATIONS_KINDS,
  DAILY_OPERATIONS_LANES,
  type DailyOperationsKind,
  type DailyOperationsLane,
} from "../services/dailyOperations/kinds";
import { getDailyOperationsModel } from "./dailyOperationsModelFactory";

export type DailyOperationsCard = {
  customer_name?: string | null;
  phone_last4?: string | null;
  job_no?: string | null;
  move?: {
    pickup_zip?: string | null;
    pickup_state?: string | null;
    delivery_zip?: string | null;
    delivery_state?: string | null;
    move_type?: "local" | "long_distance" | null;
  };
  zip_miss?: {
    pickup: boolean;
    delivery: boolean;
  };
  text?: {
    purpose?: "quote_request_confirmation" | "granot_create_confirmation" | string;
    status: string;
    deferred: boolean;
    send_at?: string | null;
    skip_reason?: string | null;
  };
  granot?: {
    route_event_class?: string;
    booking_action?: "booked" | "release" | null;
    decision?: string | null;
  };
  booking_kind?: string | null;
  exception?: {
    code: string;
    detail: string;
  };
};

export type DailyOperationsLinks = {
  lead_id?: string;
  lead_model?: "FormLead" | "CallLead";
  booking_id?: string;
  cancellation_id?: string;
  intake_case_id?: string;
  receipt_id?: string;
  message_id?: string;
};

export type DailyOperationsEventDocument = {
  _id: mongoose.Types.ObjectId;
  day: string;
  occurred_at: Date;
  lane: DailyOperationsLane;
  kind: DailyOperationsKind;
  title: string;
  source_company: string | null;
  ingestion_origin: string | null;
  lead_kind: "form" | "call" | null;
  job_no: string | null;
  entity_type: string | null;
  entity_id: string | null;
  parent_receipt_id: string | null;
  links: DailyOperationsLinks;
  card: DailyOperationsCard;
  metric_touches: string[];
  dedupe_key: string;
  redis_stream_id: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const DailyOperationsEventSchema = new Schema<DailyOperationsEventDocument>(
  {
    day: { type: String, required: true, trim: true },
    occurred_at: { type: Date, required: true },
    lane: { type: String, required: true, enum: DAILY_OPERATIONS_LANES },
    kind: { type: String, required: true, enum: DAILY_OPERATIONS_KINDS },
    title: { type: String, required: true, trim: true },
    source_company: { type: String, default: null },
    ingestion_origin: { type: String, default: null },
    lead_kind: {
      type: String,
      enum: ["form", "call", null],
      default: null,
    },
    job_no: { type: String, default: null },
    entity_type: { type: String, default: null },
    entity_id: { type: String, default: null },
    parent_receipt_id: { type: String, default: null },
    links: {
      type: new Schema(
        {
          lead_id: { type: String },
          lead_model: { type: String, enum: ["FormLead", "CallLead"] },
          booking_id: { type: String },
          cancellation_id: { type: String },
          intake_case_id: { type: String },
          receipt_id: { type: String },
          message_id: { type: String },
        },
        { _id: false },
      ),
      default: {},
    },
    card: { type: Schema.Types.Mixed, default: {} },
    metric_touches: { type: [String], default: [] },
    dedupe_key: { type: String, required: true, trim: true },
    redis_stream_id: { type: String, default: null },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

DailyOperationsEventSchema.index({ dedupe_key: 1 }, { unique: true });
DailyOperationsEventSchema.index({ day: 1, occurred_at: -1, _id: -1 });
DailyOperationsEventSchema.index({ day: 1, lane: 1, occurred_at: -1 });
DailyOperationsEventSchema.index({ parent_receipt_id: 1, occurred_at: 1 });
DailyOperationsEventSchema.index({ entity_type: 1, entity_id: 1 });

export function getDailyOperationsEventModel(): Model<DailyOperationsEventDocument> {
  return getDailyOperationsModel<DailyOperationsEventDocument>(
    "DailyOperationsEvent",
    "events",
    DailyOperationsEventSchema,
  );
}
