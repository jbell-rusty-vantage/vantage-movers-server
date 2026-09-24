import { z } from "zod";
import {
  CSI_ACTION_KINDS,
  CSI_ERROR_CODES,
  CSI_OUTREACH_STATES,
  CONTACT_NUMBER_CLASSIFICATIONS,
  CONTACT_ELIGIBILITY_STATES,
} from "../../config/domain/salesIntelligence";
import { intelligenceFindingSchema } from "../intelligence/intelligenceEnvelope.validation";

export const csiIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
export const csiTextSchema = z.string().trim().min(1).max(500);
export const csiDateSchema = z.iso.datetime();
export const csiRevisionSchema = z.number().int().positive();
export const csiSubjectSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("lead"),
      model: z.enum(["FormLead", "CallLead"]),
      id: csiIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("number_review"),
      contact_number_id: csiIdSchema,
    })
    .strict(),
]);
export type CsiSubject = z.infer<typeof csiSubjectSchema>;
export const csiErrorSchema = z
  .object({
    ok: z.literal(false),
    code: z.enum(CSI_ERROR_CODES),
    error: csiTextSchema,
    request_id: z.string().min(1).max(200),
  })
  .strict();
export const csiDateResolutionSchema = z
  .object({
    precision: z.enum(["exact", "day", "unresolved"]),
    timezone: z.string().min(1),
    assumption: csiTextSchema.nullable(),
    anchor: csiDateSchema.nullable(),
    policy_version: z.string().min(1),
  })
  .strict();
export const csiFollowupInputSchema = z
  .object({
    kind: z.enum(CSI_ACTION_KINDS),
    description: csiTextSchema,
    due_at: csiDateSchema.nullable(),
    responsible_agent_id: csiIdSchema.nullable().optional(),
    date_note: csiTextSchema.optional(),
  })
  .strict();
const base = {
  expected_revision: csiRevisionSchema,
  expected_revisions: z
    .array(
      z
        .object({
          target: z.enum([
            "outreach",
            "followup",
            "instruction",
            "review",
            "restriction",
            "finding",
            "attachment",
            "number",
            "rep",
          ]),
          id: csiIdSchema,
          revision: csiRevisionSchema,
        })
        .strict(),
    )
    .max(200)
    .optional(),
  scope: z.literal("production").optional(),
};
const reason = { reason: csiTextSchema };
const reanalysis = {
  reanalysis_mode: z.enum(["original_evidence", "current_context"]).optional(),
};
const command = <K extends string, S extends z.ZodRawShape>(
  kind: K,
  shape: S,
) => z.object({ command: z.literal(kind), ...base, ...shape }).strict();
export const csiCommandSchema = z.discriminatedUnion("command", [
  command("mark_worked", { note: csiTextSchema.optional() }),
  command("assign", {
    responsible_agent_id: csiIdSchema.nullable(),
    reason: csiTextSchema.optional(),
  }),
  command("set_waiting", { until: csiDateSchema, ...reason }),
  // Owner call progress. Separate from CSI_OUTREACH_STATES, which carries closure meaning.
  command("start_call", { note: csiTextSchema.optional() }),
  command("end_call", { note: csiTextSchema.optional() }),
  command("close", {
    reason: z.enum(["lost", "not_sales", "owner_dismissed", "suppressed"]),
    note: csiTextSchema.optional(),
  }),
  command("reopen", reason),
  // LP-01 §3.3: explicit, revision-scoped Owner override of a CRM disposition.
  command("override_disposition", { disposition_revision: z.string().min(1).max(200), ...reason }),
  command("add_note", { text: csiTextSchema }),
  command("create_followup", {
    outreach_record_id: csiIdSchema,
    action: csiFollowupInputSchema,
  }),
  command("patch_followup", {
    changes: csiFollowupInputSchema
      .partial()
      .refine((v) => Object.keys(v).length > 0),
    ...reason,
  }),
  command("complete_followup", {
    disposition: z.enum([
      "no_answer",
      "left_voicemail",
      "spoke_with_customer",
      "connected_contact_unknown",
      "completed",
      "customer_called",
    ]),
    note: csiTextSchema.optional(),
    evidence_ref: csiIdSchema.optional(),
    next: csiFollowupInputSchema.optional(),
  }),
  command("snooze_followup", { until: csiDateSchema, ...reason }),
  command("cancel_followup", reason),
  command("confirm_finding", { expected_output_digest: csiTextSchema }),
  command("confirm_run", { expected_output_digest: csiTextSchema }),
  command("correct_finding", {
    expected_output_digest: csiTextSchema,
    replacement: intelligenceFindingSchema,
    action_changes: csiFollowupInputSchema.partial().refine(v => Object.keys(v).length > 0).optional(),
    target_effect_id: csiIdSchema.nullable(),
    target_followup_id: csiIdSchema.nullable(),
    ...reason,
    ...reanalysis,
  }),
  command("retract_finding", { expected_output_digest: csiTextSchema, ...reason, ...reanalysis }),
  command("apply_suggestion", {
    run_id: csiIdSchema,
    suggestion_output_digest: csiTextSchema,
    due_at: csiDateSchema.nullable().optional(),
    responsible_agent_id: csiIdSchema.nullable().optional(),
  }),
  command("reanalyze", {
    mode: z.enum(["original_evidence", "current_context"]),
    source_run_id: csiIdSchema.optional(),
    owner_correction_ids: z.array(csiIdSchema).max(100),
    // Provenance for why the rerun was asked for; it never changes run scoping or evidence rules.
    focus_finding_id: csiIdSchema.optional(),
    ...reason,
  }).refine(
    (v) => v.mode !== "original_evidence" || v.source_run_id !== undefined,
    {
      message: "Original evidence requires source_run_id",
      path: ["source_run_id"],
    },
  ),
  command("classify_number", {
    classification: z.enum(CONTACT_NUMBER_CLASSIFICATIONS),
    eligibility: z.enum(CONTACT_ELIGIBILITY_STATES),
    until: csiDateSchema.nullable(),
    ...reason,
  }),
  command("open_number_review", reason),
  command("rebuild_number", reason),
  command("attach_lead", {
    contact_number_id: csiIdSchema,
    lead_ref: z
      .object({ model: z.enum(["FormLead", "CallLead"]), id: csiIdSchema })
      .strict(),
    ...reason,
  }),
  command("reject_attachment", reason),
  command("detach_attachment", reason),
  command("resolve_review", {
    resolution: z.enum(["no_action", "command_completed"]),
    completed_command_id: csiIdSchema.nullable(),
    ...reason,
  }),
  command("resolve_restriction", {
    resolution: z.enum(["confirm", "edit", "lift"]),
    channels: z
      .array(z.enum(["call", "text"]))
      .min(1)
      .max(2),
    until: csiDateSchema.nullable(),
    ...reason,
  }),
  command("set_contact_type", {
    contact_type: z.enum(["unknown", "voicemail", "human_conversation"]),
    ...reason,
  }),
  command("process_conversation", {}),
  command("retry_job", reason),
]);
export type CsiCommand = z.infer<typeof csiCommandSchema>;
export const CSI_OWNER_ACTIONS = [
  ...csiCommandSchema.options.map((v) => v.shape.command.value),
  "review_rep",
  "create_rep",
  "propose_reps",
  "preview_nudge",
  "send_nudge",
  "update_settings",
  "plan_backfill",
] as const;
export const csiActionAvailabilitySchema = z
  .object({
    action: z.enum(CSI_OWNER_ACTIONS),
    enabled: z.boolean(),
    blocker_codes: z.array(z.enum(CSI_ERROR_CODES)),
    target_id: csiIdSchema,
    expected_revision: csiRevisionSchema,
  })
  .strict();
const minutes = z.number().int().nonnegative();
const shift = z
  .object({
    day: z.number().int().min(1).max(7),
    start_minute: minutes.max(1439),
    end_minute: minutes.max(1440),
  })
  .strict()
  .refine((v) => v.start_minute < v.end_minute);
export const csiPolicySchema = z
  .object({
    version: z.string().min(1).max(100),
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
    staffed_hours: z
      .array(shift)
      .min(1)
      .max(28)
      .refine((shifts) =>
        shifts.every((s, i) =>
          shifts.every(
            (other, j) =>
              i === j ||
              s.day !== other.day ||
              s.end_minute <= other.start_minute ||
              other.end_minute <= s.start_minute,
          ),
        ),
      ),
    first_action_due_staffed_minutes: minutes.positive(),
    missed_callback_due_staffed_minutes: minutes.positive(),
    going_cold_staffed_minutes: minutes.positive(),
    monthly_ceiling_cents: minutes,
    per_recording_ceiling_cents: minutes,
    cooldown_attempts_24h: minutes.positive(),
    enabled_capabilities: z.array(
      z.enum([
        "capture",
        "media",
        "transcription",
        "analysis",
        "nudges",
        "live",
      ]),
    ),
    retention: z
      .object({
        audio_days: minutes.positive(),
        redacted_days: minutes.positive(),
        audit_days: minutes.positive(),
      })
      .strict(),
    // Team 4 AC3–AC5 (Attention evolution spec §5.3). Optional with no schema default, so a stored
    // policy without them stays valid and the settings read stays byte-identical with the flag off;
    // `csiPolicyEvolution()` resolves each one to its default.
    inbound_followup_staffed_minutes: minutes.positive().optional(),
    callback_early_window_staffed_minutes: minutes.optional(),
    callback_retry_staffed_minutes: minutes.positive().optional(),
    callback_max_retries: minutes.max(10).optional(),
    quote_followup_staffed_minutes: minutes.positive().optional(),
    unreached_multiplier: minutes.positive().max(20).optional(),
    first_attempts_threshold: minutes.positive().max(20).optional(),
  })
  .strict();
export type CsiPolicy = z.infer<typeof csiPolicySchema>;
/** Spec §5.3 defaults for the optional Attention-evolution policy fields. */
export const CSI_POLICY_EVOLUTION_DEFAULTS = Object.freeze({
  inbound_followup_staffed_minutes: 240,
  callback_early_window_staffed_minutes: 60,
  callback_retry_staffed_minutes: 120,
  callback_max_retries: 2,
  quote_followup_staffed_minutes: 1440,
  unreached_multiplier: 2,
  first_attempts_threshold: 2,
});
export type CsiPolicyEvolution = { -readonly [K in keyof typeof CSI_POLICY_EVOLUTION_DEFAULTS]: number };
/** The Attention-evolution values of a (possibly older) stored policy, each resolved to its default when absent. Pure. */
export function csiPolicyEvolution(policy: Partial<Pick<CsiPolicy, keyof CsiPolicyEvolution>>): CsiPolicyEvolution {
  const out: CsiPolicyEvolution = { ...CSI_POLICY_EVOLUTION_DEFAULTS };
  for (const key of Object.keys(out) as (keyof CsiPolicyEvolution)[]) {
    const value = policy[key];
    if (typeof value === "number") out[key] = value;
  }
  return out;
}
export const csiSettingsCommandSchema = z
  .object({ command: z.literal("update_settings"), ...base, policy: csiPolicySchema, ...reason })
  .strict();
export const csiListQuerySchema = z
  .object({
    scope: z.literal("production").optional(),
    cursor: z.string().max(2000).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    state: z.enum(CSI_OUTREACH_STATES).optional(),
    q: z.string().max(200).optional(),
  })
  .strict();

export const csiRepInputSchema = z
  .object({
    agent_id: csiIdSchema,
    rc_account_id: csiTextSchema,
    rc_extension_id: csiTextSchema,
    rc_team_messaging_person_id: z.string().regex(/^\d{1,30}$/).nullable().optional(),
    role_kind: z.enum([
      "sales_rep",
      "service",
      "manager",
      "dialer",
      "shared",
      "excluded",
    ]),
    effective_from: csiDateSchema,
    effective_to: csiDateSchema.nullable(),
    nudge_channels_allowed: z.array(
      z.enum(["team_messaging", "sms_to_rep", "pager"]),
    ),
  })
  .strict()
  .refine((v) => v.effective_to === null || new Date(v.effective_to) > new Date(v.effective_from));
export const csiRepCommandSchema = z
  .object({
    ...base,
    link: csiRepInputSchema,
    status: z.enum(["reviewed", "retired"]),
    ...reason,
  })
  .strict();
export const csiRepCreateSchema = z.object({ ...base, link: csiRepInputSchema, ...reason }).strict();
export const csiRepProposeSchema = z.object({
  ...base, rc_account_id: csiTextSchema, directory_snapshot_id: csiIdSchema,
  after_extension_id: csiTextSchema.optional(), limit: z.number().int().min(1).max(100).default(50), ...reason,
}).strict();
export const csiNudgeInputSchema = z
  .object({
    outreach_record_id: csiIdSchema.optional(),
    rc_account_id: csiTextSchema,
    rc_extension_id: csiTextSchema,
    rep_identity_link_id: csiIdSchema.optional(),
    channel: z.enum(["team_messaging", "sms_to_rep", "pager"]),
    template_key: csiTextSchema,
    template_version: csiRevisionSchema,
    purpose: z.enum(["call_suggestion", "review_context"]),
    followup_id: csiIdSchema.optional(),
    allow_pager_fallback: z.boolean().default(false),
    body: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export const csiNudgeCommandSchema = z
  .object({
    expected_revision: csiRevisionSchema.optional(),
    expected_revisions: base.expected_revisions,
    scope: base.scope,
    nudge: csiNudgeInputSchema,
    expected_rep_revision: csiRevisionSchema.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.nudge.rep_identity_link_id) === (value.expected_rep_revision !== undefined))
  .refine((value) => Boolean(value.nudge.outreach_record_id) === (value.expected_revision !== undefined))
  .refine((value) => value.nudge.outreach_record_id
    || (value.nudge.purpose === "review_context" && Boolean(value.nudge.body) && value.nudge.channel !== "sms_to_rep" && !value.nudge.followup_id));
export const csiBackfillCommandSchema = z
  .object({ ...base, from: csiDateSchema, to: csiDateSchema, ...reason })
  .strict()
  .refine((v) => v.from < v.to);
export const csiSubmissionReceiptSchema = z
  .object({
    run_id: csiIdSchema,
    submission_id: csiIdSchema,
    application_job_id: csiIdSchema,
    status: z.literal("submitted"),
  })
  .strict();
