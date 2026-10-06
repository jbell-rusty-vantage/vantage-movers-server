import { z } from "zod";
import { SALES_OUTREACH_CONTRACT_VERSION, SALES_OUTREACH_LEAD_MODELS, SALES_OUTREACH_TIMEZONE } from "../../config/domain/salesOutreach";
import { salesOutreachBusinessDateSchema } from "./salesOutreach";

/**
 * Owner enrollment endpoints (IMPLEMENTATION-PLAN §5: `GET /enrollment/candidates`,
 * `POST /enrollment/report|apply|verify`; olr B8 `GET /enrollment/admissions`). Strict bodies; the apply
 * run key is the Idempotency-Key.
 */
const MAX_SELECTION = 20_000;
const scope = z.literal("production").optional();
const cohortId = z.string().trim().regex(/^[A-Za-z0-9:._-]{1,120}$/);

export const salesOutreachLeadRefSchema = z
  .object({ model: z.enum(SALES_OUTREACH_LEAD_MODELS), id: z.string().regex(/^[a-fA-F\d]{24}$/) })
  .strict();

const selectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("backfill_scope") }).strict(),
  z.object({ mode: z.literal("selected"), lead_refs: z.array(salesOutreachLeadRefSchema).min(1).max(MAX_SELECTION) }).strict(),
]);

const kind = z.enum(["pilot", "expansion"]);

export const salesOutreachEnrollmentReportSchema = z
  .object({ scope, selection: selectionSchema, kind: kind.optional(), cohort_id: cohortId.optional() })
  .strict();

export const salesOutreachEnrollmentApplySchema = z
  .object({
    scope,
    kind,
    cohort_id: cohortId,
    lead_refs: z.array(salesOutreachLeadRefSchema).min(1).max(MAX_SELECTION),
    manifest_hash: z.string().regex(/^[a-f\d]{64}$/),
    /** How long this call may keep enrolling before it returns `running` (re-POST the same key to continue). */
    deadline_seconds: z.number().int().min(0).max(700).optional(),
  })
  .strict();

/**
 * `POST /enrollment/verify`: an apply run (`{ run_key }`, writes its `verify:` document) or, olr B6, a
 * cohort no run created (`{ cohort_id }`: `admission:<date>` / `intake:<gate>`, read-only).
 */
export const salesOutreachEnrollmentVerifySchema = z.union([
  z.object({ scope, run_key: z.string().trim().regex(/^[A-Za-z0-9:._-]{1,120}$/) }).strict(),
  z.object({ scope, cohort_id: z.string().trim().regex(/^(admission|intake):[0-9TZ:.\-]{10,40}$/) }).strict(),
]);

export const salesOutreachEnrollmentCandidatesQuerySchema = z
  .object({
    scope,
    partition: z.enum(["in_scope", "older", "already_enrolled", "closed", "excluded", "review", "not_new_or_quoted"]),
    cursor: z.string().max(300).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

/** olr B8: `GET /enrollment/admissions?business_day=YYYY-MM-DD` (default: today in New York). */
export const salesOutreachEnrollmentAdmissionsQuerySchema = z
  .object({ scope, business_day: salesOutreachBusinessDateSchema.optional() })
  .strict();

const count = z.number().int().min(0);

/**
 * olr B8 response DTO of `GET /enrollment/admissions`: what the `outreach_lead_change` jobs completed on
 * the New York `business_day` decided for Leads that were not subjects (`enrollment/admissions.ts`).
 * - `counts.admitted_intake`: fresh Leads enrolled by intake as `active`;
 * - `counts.admitted_review`: enrolled by intake as visible `review` subjects (held for
 *   `ambiguous_identity` / `received_time_*`, or a priority that needs review);
 * - `counts.admitted_expansion`, `counts.deferred`: the expansion admission path (olr B6; 0 until it ships);
 * - `counts.not_admitted`: refusals by reason (`closed_priority`, `unsupported_intake_source`,
 *   `excluded:<reason>`, `received_before_intake`, `historical_import`, … — free text, render unknown
 *   reasons as-is);
 * - `recent_refusals`: the newest ≤ 50 refusals, newest first.
 * Completed jobs are kept `retention_days` (14); an older day is 400 `retention_exceeded`.
 */
export const salesOutreachAdmissionsSchema = z
  .object({
    contract_version: z.literal(SALES_OUTREACH_CONTRACT_VERSION),
    business_day: salesOutreachBusinessDateSchema,
    as_of: z.iso.datetime(),
    timezone: z.literal(SALES_OUTREACH_TIMEZONE),
    retention_days: z.number().int().positive(),
    counts: z
      .object({
        admitted_intake: count,
        admitted_review: count,
        admitted_expansion: count,
        deferred: count,
        not_admitted: z.record(z.string(), count),
      })
      .strict(),
    recent_refusals: z
      .array(z.object({ lead: salesOutreachLeadRefSchema, reason: z.string(), at: z.iso.datetime() }).strict())
      .max(50),
  })
  .strict();

export type SalesOutreachAdmissions = z.infer<typeof salesOutreachAdmissionsSchema>;
