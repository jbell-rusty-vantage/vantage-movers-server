import { z } from "zod";
import { SALES_OUTREACH_LEAD_MODELS } from "../../config/domain/salesOutreach";

/**
 * Owner enrollment endpoints (IMPLEMENTATION-PLAN §5: `GET /enrollment/candidates`,
 * `POST /enrollment/report|apply|verify`). Strict bodies; the apply run key is the Idempotency-Key.
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

export const salesOutreachEnrollmentVerifySchema = z
  .object({ scope, run_key: z.string().trim().regex(/^[A-Za-z0-9:._-]{1,120}$/) })
  .strict();

export const salesOutreachEnrollmentCandidatesQuerySchema = z
  .object({
    scope,
    partition: z.enum(["in_scope", "older", "already_enrolled", "closed", "excluded", "review", "not_new_or_quoted"]),
    cursor: z.string().max(300).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
