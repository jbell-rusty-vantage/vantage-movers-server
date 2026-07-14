import mongoose, { Schema, type Model } from "mongoose";
import {
  REPORT_RUN_STATUSES,
  type ReportRunStatus,
} from "../config/domain/observability";
import { getObservabilityModel } from "./observabilityModelFactory";

/**
 * Persisted deterministic report executions so an admin can rerun, compare,
 * export, and cite reports. Every report stores normalized filters, a period
 * with explicit timezone, and a canonical `result_hash` so the same inputs
 * produce the same hash.
 */
export type OperationalReportPeriod = {
  from: Date;
  to: Date;
  timezone: string;
  granularity: "hour" | "day" | "week" | "month";
};

export type OperationalReportInputWatermark = {
  events_max_occurred_at: Date | null;
  events_count: number;
  incidents_count: number;
};

export type OperationalReportRunDocument = {
  _id: mongoose.Types.ObjectId;
  report_key: string;
  report_version: number;
  status: ReportRunStatus;
  requested_by: string;
  database_scope: "production";
  period: OperationalReportPeriod;
  filters: Record<string, unknown>;
  input_watermark: OperationalReportInputWatermark;
  result: Record<string, unknown>;
  result_hash: string;
  csv_export_path: string | null;
  error_message: string | null;
  started_at: Date;
  finished_at: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const OperationalReportRunSchema = new Schema<OperationalReportRunDocument>(
  {
    report_key: { type: String, required: true, trim: true },
    report_version: { type: Number, required: true, default: 1 },
    status: {
      type: String,
      required: true,
      enum: REPORT_RUN_STATUSES,
      default: "running",
    },
    requested_by: { type: String, required: true, default: "admin" },
    database_scope: { type: String, required: true, default: "production" },
    period: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
      timezone: { type: String, required: true, default: "America/New_York" },
      granularity: {
        type: String,
        enum: ["hour", "day", "week", "month"],
        default: "day",
      },
    },
    filters: { type: Schema.Types.Mixed, default: {} },
    input_watermark: {
      events_max_occurred_at: { type: Date, default: null },
      events_count: { type: Number, default: 0 },
      incidents_count: { type: Number, default: 0 },
    },
    result: { type: Schema.Types.Mixed, default: {} },
    result_hash: { type: String, default: "" },
    csv_export_path: { type: String, default: null },
    error_message: { type: String, default: null },
    started_at: { type: Date, required: true, default: Date.now },
    finished_at: { type: Date, default: null },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

OperationalReportRunSchema.index({
  report_key: 1,
  "period.from": -1,
  "period.to": -1,
});
OperationalReportRunSchema.index({ status: 1, started_at: -1 });
OperationalReportRunSchema.index({ result_hash: 1 });
OperationalReportRunSchema.index({ requested_by: 1, started_at: -1 });

export function getOperationalReportRunModel(): Model<OperationalReportRunDocument> {
  return getObservabilityModel<OperationalReportRunDocument>(
    "OperationalReportRun",
    "reportRuns",
    OperationalReportRunSchema,
  );
}
