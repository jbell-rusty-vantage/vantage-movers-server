import mongoose, { Schema, type Model } from "mongoose";
import { FLORIDA_TIME_ZONE } from "../utils/easternTime";
import { getDailyOperationsModel } from "./dailyOperationsModelFactory";

export type DailyOperationsCompanyCount = {
  form: number;
  call: number;
  total: number;
};

export type DailyOperationsHourlyBucket = {
  hour: number;
  leads: number;
  bookings: number;
  cancellations: number;
  webhooks: number;
  messages: number;
};

export type DailyOperationsDayDocument = {
  _id: mongoose.Types.ObjectId;
  day: string;
  timezone: "America/New_York";
  status: "open" | "closed";
  closed_at: Date | null;
  revision: number;
  leads: {
    total: number;
    form: number;
    call: number;
    duplicate_form: number;
    duplicate_call: number;
    unmatched_call: number;
  };
  origins: {
    wordpress_form: number;
    ringcentral: number;
    granot_lead_created: number;
    best_relocation_sheet: number;
    vantage_admin: number;
  };
  companies: Record<string, DailyOperationsCompanyCount>;
  webhooks: {
    lead_created: number;
    priority_updated: number;
    booking_status_changed: number;
    booked: number;
    release: number;
  };
  decisions: {
    minted: number;
    linked: number;
    observed: number;
    pending_match: number;
    unmatched: number;
  };
  messages: {
    successful: number;
    deferred: number;
    skipped: number;
    failed: number;
  };
  bookings: {
    total: number;
    granot_confirm: number;
    employee_linked: number;
    employee_pending: number;
    admin: number;
    leadless: number;
    referral: number;
  };
  cancellations: { total: number };
  intakes: { opened: number; refreshed: number };
  exceptions: {
    zip_missing: number;
    crm_failed: number;
    dead_letter: number;
    adoption_conflict: number;
  };
  /** Sheet Sync drain outcomes per job (DOP-11 hook). Absent on days written before it. */
  sheet_sync?: { completed: number; failed: number };
  hourly: DailyOperationsHourlyBucket[];
  createdAt: Date;
  updatedAt: Date;
};

const hourlyBucketSchema = new Schema<DailyOperationsHourlyBucket>(
  {
    hour: { type: Number, required: true },
    leads: { type: Number, default: 0 },
    bookings: { type: Number, default: 0 },
    cancellations: { type: Number, default: 0 },
    webhooks: { type: Number, default: 0 },
    messages: { type: Number, default: 0 },
  },
  { _id: false },
);

const DailyOperationsDaySchema = new Schema<DailyOperationsDayDocument>(
  {
    day: { type: String, required: true, trim: true },
    timezone: {
      type: String,
      required: true,
      enum: [FLORIDA_TIME_ZONE],
      default: FLORIDA_TIME_ZONE,
    },
    status: { type: String, required: true, enum: ["open", "closed"], default: "open" },
    closed_at: { type: Date, default: null },
    revision: { type: Number, required: true, default: 0 },
    leads: {
      total: { type: Number, default: 0 },
      form: { type: Number, default: 0 },
      call: { type: Number, default: 0 },
      duplicate_form: { type: Number, default: 0 },
      duplicate_call: { type: Number, default: 0 },
      unmatched_call: { type: Number, default: 0 },
    },
    origins: {
      wordpress_form: { type: Number, default: 0 },
      ringcentral: { type: Number, default: 0 },
      granot_lead_created: { type: Number, default: 0 },
      best_relocation_sheet: { type: Number, default: 0 },
      vantage_admin: { type: Number, default: 0 },
    },
    companies: { type: Schema.Types.Mixed, default: {} },
    webhooks: {
      lead_created: { type: Number, default: 0 },
      priority_updated: { type: Number, default: 0 },
      booking_status_changed: { type: Number, default: 0 },
      booked: { type: Number, default: 0 },
      release: { type: Number, default: 0 },
    },
    decisions: {
      minted: { type: Number, default: 0 },
      linked: { type: Number, default: 0 },
      observed: { type: Number, default: 0 },
      pending_match: { type: Number, default: 0 },
      unmatched: { type: Number, default: 0 },
    },
    messages: {
      successful: { type: Number, default: 0 },
      deferred: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    bookings: {
      total: { type: Number, default: 0 },
      granot_confirm: { type: Number, default: 0 },
      employee_linked: { type: Number, default: 0 },
      employee_pending: { type: Number, default: 0 },
      admin: { type: Number, default: 0 },
      leadless: { type: Number, default: 0 },
      referral: { type: Number, default: 0 },
    },
    cancellations: {
      total: { type: Number, default: 0 },
    },
    intakes: {
      opened: { type: Number, default: 0 },
      refreshed: { type: Number, default: 0 },
    },
    exceptions: {
      zip_missing: { type: Number, default: 0 },
      crm_failed: { type: Number, default: 0 },
      dead_letter: { type: Number, default: 0 },
      adoption_conflict: { type: Number, default: 0 },
    },
    sheet_sync: {
      completed: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    hourly: { type: [hourlyBucketSchema], default: [] },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

DailyOperationsDaySchema.index({ day: 1 }, { unique: true });
DailyOperationsDaySchema.index({ status: 1, day: -1 });

export function getDailyOperationsDayModel(): Model<DailyOperationsDayDocument> {
  return getDailyOperationsModel<DailyOperationsDayDocument>(
    "DailyOperationsDay",
    "days",
    DailyOperationsDaySchema,
  );
}
