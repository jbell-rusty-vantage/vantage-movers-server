import { Schema } from "mongoose";
import { SALES_OUTREACH_FOLLOWUP_KINDS, SALES_OUTREACH_FOLLOWUP_STATUSES } from "../../config/domain/salesOutreach";
import { actor, at, date, defineCsiModel, enumeration, index, oid, ref, revision, text, unique } from "../salesIntelligence/common";

/**
 * `sales_outreach_followup_schedules` — the one active human plan per subject (P06f): a Quoted
 * follow-up date (P04) or an explicit timed callback (P06e). Replacement is an explicit command;
 * command/audit history lives in the CSI command ledger and audit events.
 */
export const SALES_OUTREACH_FOLLOWUP_SCHEDULE_INDEXES = [
  unique("sod_followup_active_unique", { subject_id: 1 }, { status: "active" }),
  index("sod_followup_subject_effective", { subject_id: 1, effective_at: 1 }),
];

export const SalesOutreachFollowupScheduleSchema = new Schema(
  {
    subject_id: oid,
    period_id: ref,
    kind: enumeration(SALES_OUTREACH_FOLLOWUP_KINDS),
    /** Quoted: selected New York business date (`YYYY-MM-DD`). */
    selected_date: text,
    /** Callback: the agreed appointment instant (UTC). */
    appointment_at: date,
    due_at: at,
    window_minutes: { type: Number, default: null },
    actor: { type: actor, required: true },
    effective_at: at,
    status: enumeration(SALES_OUTREACH_FOLLOWUP_STATUSES, "active"),
    ended_at: date,
    end_reason: text,
    revision,
  },
  { collection: "sales_outreach_followup_schedules" },
);

export const getSalesOutreachFollowupScheduleModel = defineCsiModel(
  "SalesOutreachFollowupSchedule",
  SalesOutreachFollowupScheduleSchema,
  SALES_OUTREACH_FOLLOWUP_SCHEDULE_INDEXES,
);
