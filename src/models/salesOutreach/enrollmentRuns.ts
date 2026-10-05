import { Schema } from "mongoose";
import { z } from "zod";
import {
  SALES_OUTREACH_ENROLLMENT_KINDS,
  SALES_OUTREACH_ENROLLMENT_MODES,
  SALES_OUTREACH_ENROLLMENT_RUN_STATUSES,
} from "../../config/domain/salesOutreach";
import { actor, at, count, date, defineCsiModel, enumeration, index, leadRef, revision, str, text, unique, validatedJson } from "../salesIntelligence/common";

/**
 * `sales_outreach_enrollment_runs` — one document per enrollment run (IMPLEMENTATION-PLAN §4.8;
 * replaces the packet's migration runs/checkpoints). `report` makes zero writes, so persisted runs
 * are `apply` (resumable through `cursor` + `last_committed_batch` under a lease epoch) and
 * `verify`. `run_key` is chosen by the caller so a re-run of the same apply resumes the same row.
 */
export const SALES_OUTREACH_ENROLLMENT_RUN_INDEXES = [
  unique("sod_enrollment_run_key_unique", { run_key: 1 }),
  index("sod_enrollment_manifest_mode", { manifest_hash: 1, mode: 1, partition: 1 }),
  index("sod_enrollment_cohort_started", { cohort_id: 1, started_at: 1 }),
];

const json = { ...validatedJson(z.json()), default: () => ({}) };

export const SalesOutreachEnrollmentRunSchema = new Schema(
  {
    run_key: str,
    mode: enumeration(SALES_OUTREACH_ENROLLMENT_MODES),
    kind: enumeration(SALES_OUTREACH_ENROLLMENT_KINDS),
    cohort_id: str,
    partition: { type: String, required: true, trim: true, default: "all" },
    manifest_hash: str,
    /** Fixed cohort activation boundary (P10a); retries never reprice it. */
    activation_at: at,
    configuration_version: str,
    algorithm_version: str,
    selected_leads: { type: [leadRef], default: [] },
    status: enumeration(SALES_OUTREACH_ENROLLMENT_RUN_STATUSES, "running"),
    lease_owner: text,
    lease_epoch: count,
    leased_until: date,
    cursor: { ...json, default: null, required: false },
    last_committed_batch: count,
    counts: json,
    results: json,
    started_at: at,
    finished_at: date,
    actor: { type: actor, required: true },
    revision,
  },
  { collection: "sales_outreach_enrollment_runs" },
);

export const getSalesOutreachEnrollmentRunModel = defineCsiModel(
  "SalesOutreachEnrollmentRun",
  SalesOutreachEnrollmentRunSchema,
  SALES_OUTREACH_ENROLLMENT_RUN_INDEXES,
);
