import { z } from "zod";
import { SALES_OUTREACH_CONTRACT_VERSION } from "../../config/domain/salesOutreach";
import { salesOutreachAgentIdSchema, salesOutreachBusinessDateSchema } from "./salesOutreach";

/**
 * Sales Outreach Desk command DTOs (SRV-7; CONTRACTS "HTTP interface" as amended by
 * IMPLEMENTATION-PLAN §5). Requests are strict (unknown keys → 400); every command also needs the
 * `Idempotency-Key` header, and a replay returns the original committed result with `replayed: true`.
 * Responses carry the `sod-v1` contract marker. Admin mirrors these schemas.
 */

const objectId = z.string().regex(/^[a-f\d]{24}$/);
const revision = z.number().int().min(0);
/** A UTC instant with an explicit offset (`Z` or `±hh:mm`); never a bare local time. */
const instant = z.iso.datetime({ offset: true });
const scope = z.literal("production").optional();
const reasonText = z.string().trim().min(1).max(200);

/* ------------------------------------------------------------------------------------------------
 * Requests
 * ----------------------------------------------------------------------------------------------*/

/** `PATCH /outreach/:id/quoted-followup` (P04b–P04d): select or reschedule the Quoted follow-up date. */
export const salesOutreachQuotedFollowupRequestSchema = z
  .object({
    scope,
    /** The subject's human-plan revision the actor saw (shared by Quoted dates and callbacks, P06f). */
    expected_revision: revision,
    /** The active Quoted policy period the date belongs to. */
    period_id: objectId,
    selected_date: salesOutreachBusinessDateSchema,
    /** Explicit, audited replacement of an active timed callback (P06f). */
    replace_active_plan: z.boolean().default(false),
  })
  .strict();

/** `PATCH /outreach/:id/callback` (P06e/P06f): set, reschedule or cancel the explicit timed callback. */
export const salesOutreachCallbackRequestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      scope,
      operation: z.literal("set"),
      expected_revision: revision,
      appointment_at: instant,
      /** Required to replace another active human plan (a Quoted date or callback). */
      replace_active_plan: z.boolean().default(false),
    })
    .strict(),
  z.object({ scope, operation: z.literal("reschedule"), expected_revision: revision, appointment_at: instant }).strict(),
  z.object({ scope, operation: z.literal("cancel"), expected_revision: revision }).strict(),
]);

/** `PATCH /outreach/:id/assignment` (IMPL-01, P09b): Owner/Manager writes `Lead.receiver_agent` (source `manual`). */
export const salesOutreachAssignmentRequestSchema = z
  .object({
    scope,
    /** The subject's `assignment_revision` the actor saw. */
    expected_revision: revision,
    /** Target Agent (a reviewed `sales_rep`), or null to unassign. */
    agent_id: salesOutreachAgentIdSchema.nullable(),
  })
  .strict();

/** `PATCH /goals/:agent_id/day-override` (P08a, P09b): one effective-dated goal for one rep and date. */
export const salesOutreachDayOverrideRequestSchema = z
  .object({
    scope,
    /** The configuration pointer revision the actor saw (overrides live in the persisted configuration). */
    expected_revision: z.number().int().min(1),
    business_date: salesOutreachBusinessDateSchema,
    goal: z.number().int().min(0).max(10_000),
    reason: z.enum(["absence", "partial_day"]),
  })
  .strict()
  .refine((o) => o.reason !== "absence" || o.goal === 0, { message: "an absence override has goal 0", path: ["goal"] });

/** `GET /restrictions` (Owner, P06c). */
export const salesOutreachRestrictionsQuerySchema = z
  .object({
    scope,
    state: z.enum(["active", "resolved", "expired", "all"]).default("active"),
    cursor: objectId.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

/** `POST /restrictions` (Owner, P06c): a genuine customer/channel restriction on one Contact Number. */
export const salesOutreachRestrictionAddRequestSchema = z
  .object({
    scope,
    contact_number_id: objectId,
    channels: z
      .array(z.enum(["call", "sms"]))
      .min(1)
      .max(2)
      .refine((c) => new Set(c).size === c.length, "duplicate channel"),
    /** Release instant; null/absent = active until an Owner lifts it. */
    until: instant.nullable().default(null),
    reason: reasonText,
  })
  .strict();

/** `POST /restrictions/:id/confirm` (Owner): confirms the row is genuine; it stays active and blocking. */
export const salesOutreachRestrictionConfirmRequestSchema = z.object({ scope, expected_revision: z.number().int().min(1) }).strict();

/** `POST /restrictions/:id/lift` (Owner only, P09b): releases the restriction with a reason; history is kept. */
export const salesOutreachRestrictionLiftRequestSchema = z.object({ scope, expected_revision: z.number().int().min(1), reason: reasonText }).strict();

/* ------------------------------------------------------------------------------------------------
 * Responses (`{ ok: true, data }`)
 * ----------------------------------------------------------------------------------------------*/

const contract = z.literal(SALES_OUTREACH_CONTRACT_VERSION);
const isoOut = z.string();

export const salesOutreachPlanSchema = z
  .object({
    plan_id: objectId,
    kind: z.enum(["quoted_date", "callback"]),
    period_id: objectId.nullable(),
    selected_date: z.string().nullable(),
    appointment_at: isoOut.nullable(),
    /** New York display of the appointment (P06e). */
    appointment_local: z.object({ business_date: z.string(), minute: z.number().int() }).strict().nullable(),
    due_at: isoOut,
    window_minutes: z.number().int().nullable(),
    effective_at: isoOut,
    status: z.literal("active"),
    revision: z.number().int(),
  })
  .strict();

export const salesOutreachPlanCommandResponseSchema = z
  .object({
    contract_version: contract,
    subject_id: objectId,
    /** The subject's human-plan revision after the command (send it as the next `expected_revision`). */
    plan_revision: z.number().int(),
    /** The active plan after the command; null after a cancel. */
    plan: salesOutreachPlanSchema.nullable(),
    /** The plan this command ended (replaced/cancelled), if any. */
    ended_plan: z.object({ plan_id: objectId, kind: z.enum(["quoted_date", "callback"]), status: z.enum(["replaced", "cancelled"]) }).strict().nullable(),
    changed: z.boolean(),
    replayed: z.boolean(),
  })
  .strict();

export const salesOutreachAssignmentResponseSchema = z
  .object({
    contract_version: contract,
    subject_id: objectId,
    assigned_agent_id: objectId.nullable(),
    previous_agent_id: objectId.nullable(),
    /** Send as the next `expected_revision`. */
    assignment_revision: z.number().int(),
    /** The Lead's `domain_revision` after the write (unchanged when `changed` is false). */
    lead_revision: z.number().int(),
    receiver_agent_source: z.literal("manual").nullable(),
    changed: z.boolean(),
    replayed: z.boolean(),
  })
  .strict();

const dayOverride = z.object({ goal: z.number().int(), reason: z.enum(["absence", "partial_day"]) }).strict();
export const salesOutreachDayOverrideResponseSchema = z
  .object({
    contract_version: contract,
    agent_id: objectId,
    business_date: z.string(),
    override: dayOverride,
    previous: dayOverride.nullable(),
    /** Configuration pointer revision/version after the command. */
    revision: z.number().int(),
    version: z.string(),
    changed: z.boolean(),
    replayed: z.boolean(),
  })
  .strict();

export const salesOutreachRestrictionSchema = z
  .object({
    restriction_id: objectId,
    contact_number_id: objectId,
    channels: z.array(z.enum(["call", "sms"])),
    origin: z.enum(["owner", "intelligence"]),
    state: z.enum(["active", "expired", "resolved"]),
    effective_at: isoOut,
    until: isoOut.nullable(),
    reason: z.string().nullable(),
    /** An active AI-origin row no Owner has confirmed: it still blocks until confirmed or lifted. */
    needs_review: z.boolean(),
    confirmed_at: isoOut.nullable(),
    confirmed_by: z.string().nullable(),
    resolved_at: isoOut.nullable(),
    resolved_by: z.string().nullable(),
    resolution_reason: z.string().nullable(),
    /** Send as the next `expected_revision`. */
    revision: z.number().int(),
  })
  .strict();

export const salesOutreachRestrictionCommandResponseSchema = z
  .object({ contract_version: contract, restriction: salesOutreachRestrictionSchema, changed: z.boolean(), replayed: z.boolean() })
  .strict();

export const salesOutreachRestrictionsResponseSchema = z
  .object({
    contract_version: contract,
    as_of: isoOut,
    state: z.enum(["active", "resolved", "expired", "all"]),
    restrictions: z.array(salesOutreachRestrictionSchema),
    next_cursor: objectId.nullable(),
  })
  .strict();

export type SalesOutreachPlanCommandResponse = z.infer<typeof salesOutreachPlanCommandResponseSchema>;
export type SalesOutreachAssignmentResponse = z.infer<typeof salesOutreachAssignmentResponseSchema>;
export type SalesOutreachDayOverrideResponse = z.infer<typeof salesOutreachDayOverrideResponseSchema>;
export type SalesOutreachRestrictionDto = z.infer<typeof salesOutreachRestrictionSchema>;
export type SalesOutreachRestrictionCommandResponse = z.infer<typeof salesOutreachRestrictionCommandResponseSchema>;
export type SalesOutreachRestrictionsResponse = z.infer<typeof salesOutreachRestrictionsResponseSchema>;
