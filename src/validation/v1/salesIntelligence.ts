import { z } from "zod";
import { CSI_ERROR_CODES } from "../../config/domain/salesIntelligence";

export const csiIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
export const csiTextSchema = z.string().trim().min(1).max(500);
export const csiDateSchema = z.iso.datetime();
export const csiRevisionSchema = z.number().int().positive();
export const csiErrorSchema = z
  .object({
    ok: z.literal(false),
    code: z.enum(CSI_ERROR_CODES),
    error: csiTextSchema,
    request_id: z.string().min(1).max(200),
  })
  .strict();
const base = {
  expected_revision: csiRevisionSchema,
  expected_revisions: z
    .array(
      z
        .object({
          target: z.enum(["attachment", "number", "rep"]),
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
const command = <K extends string, S extends z.ZodRawShape>(
  kind: K,
  shape: S,
) => z.object({ command: z.literal(kind), ...base, ...shape }).strict();
/** Owner commands of the retained Numbers surface: rebuild and reviewed Number↔Lead attachment. */
export const csiCommandSchema = z.discriminatedUnion("command", [
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
const policyTimezone = z.string().refine((v) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
});
const staffedHours = z
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
  );
/** Capabilities a policy can enable. Messages to RingCentral directory Users require `nudges`. */
export const CSI_POLICY_CAPABILITIES = ["capture", "nudges", "live"] as const;
export type CsiPolicyCapability = (typeof CSI_POLICY_CAPABILITIES)[number];
/**
 * Owner policy of the retained Numbers and RingCentral Accounts surface: the staffed clock (capture
 * health), the enabled capabilities and how long Call activity is kept (`retention.audit_days`).
 * Every new version is written with exactly these fields.
 */
export const csiPolicySchema = z
  .object({
    version: z.string().min(1).max(100),
    timezone: policyTimezone,
    staffed_hours: staffedHours,
    enabled_capabilities: z.array(z.enum(CSI_POLICY_CAPABILITIES)),
    retention: z.object({ audit_days: minutes.positive() }).strict(),
  })
  .strict();
export type CsiPolicy = z.infer<typeof csiPolicySchema>;
/**
 * Policy fields only a pre-slimming build reads (AI ceilings, Outreach due times, media/transcript
 * retention, Attention evolution). The slim server never reads or accepts them from the Owner. A new
 * stored version carries the previous version's values forward unchanged (`withRetiredPolicyFields`),
 * so a build rolled back during the observation window can still parse the active version.
 */
export const CSI_RETIRED_POLICY_FIELDS = [
  "first_action_due_staffed_minutes",
  "missed_callback_due_staffed_minutes",
  "going_cold_staffed_minutes",
  "monthly_ceiling_cents",
  "per_recording_ceiling_cents",
  "cooldown_attempts_24h",
  "inbound_followup_staffed_minutes",
  "callback_early_window_staffed_minutes",
  "callback_retry_staffed_minutes",
  "callback_max_retries",
  "quote_followup_staffed_minutes",
  "unreached_multiplier",
  "first_attempts_threshold",
] as const;
export const CSI_RETIRED_POLICY_RETENTION_FIELDS = ["audio_days", "redacted_days"] as const;
type RetiredPolicyFields = Partial<Record<(typeof CSI_RETIRED_POLICY_FIELDS)[number], number>>;
type RetiredRetentionFields = Partial<Record<(typeof CSI_RETIRED_POLICY_RETENTION_FIELDS)[number], number>>;
export type CsiPersistedPolicy = CsiPolicy & RetiredPolicyFields & { retention: CsiPolicy["retention"] & RetiredRetentionFields };
const retiredPolicyValue = minutes.optional();
/**
 * What a stored policy version may hold: the retained policy, validated exactly, plus the carried
 * retired values. Nothing else, so a typo or a new field cannot slip into a stored version.
 */
export const csiPersistedPolicySchema = csiPolicySchema
  .extend({
    ...(Object.fromEntries(CSI_RETIRED_POLICY_FIELDS.map((field) => [field, retiredPolicyValue])) as Record<
      (typeof CSI_RETIRED_POLICY_FIELDS)[number],
      typeof retiredPolicyValue
    >),
    retention: z
      .object({ audit_days: minutes.positive(), audio_days: retiredPolicyValue, redacted_days: retiredPolicyValue })
      .strict(),
  })
  .strict();
/** The retained `policy` with the retired values of `previous` (a stored version, any shape) carried forward. */
export function withRetiredPolicyFields(policy: CsiPolicy, previous: unknown): CsiPersistedPolicy {
  const source = previous && typeof previous === "object" ? (previous as Record<string, unknown>) : {};
  const sourceRetention =
    source.retention && typeof source.retention === "object" ? (source.retention as Record<string, unknown>) : {};
  const carried: RetiredPolicyFields = {};
  for (const field of CSI_RETIRED_POLICY_FIELDS) {
    if (typeof source[field] === "number") carried[field] = source[field];
  }
  const carriedRetention: RetiredRetentionFields = {};
  for (const field of CSI_RETIRED_POLICY_RETENTION_FIELDS) {
    if (typeof sourceRetention[field] === "number") carriedRetention[field] = sourceRetention[field];
  }
  return csiPersistedPolicySchema.parse({
    ...carried,
    ...policy,
    retention: { ...carriedRetention, ...policy.retention },
  }) as CsiPersistedPolicy;
}
/**
 * Reads a stored policy version. Versions written before the slimming also carry settings of
 * retired capabilities (AI budget, Outreach due times, media and transcript retention, Attention
 * evolution); those fields and capability names are ignored, never validated or written again.
 */
export const csiStoredPolicySchema = z.object({
  version: z.string().min(1).max(100),
  timezone: policyTimezone,
  staffed_hours: staffedHours,
  enabled_capabilities: z
    .array(z.string())
    .transform((values) =>
      values.filter((value): value is CsiPolicyCapability =>
        (CSI_POLICY_CAPABILITIES as readonly string[]).includes(value),
      ),
    ),
  retention: z.object({ audit_days: minutes.positive() }),
});
export const csiSettingsCommandSchema = z
  .object({ command: z.literal("update_settings"), ...base, policy: csiPolicySchema, ...reason })
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
/**
 * RingCentral Accounts message: the Owner's own `review_context` text to one directory User, by
 * team messaging or pager. It names no customer, record or follow-up and never goes to a phone number.
 */
export const csiNudgeInputSchema = z
  .object({
    rc_account_id: csiTextSchema,
    rc_extension_id: csiTextSchema,
    rep_identity_link_id: csiIdSchema.optional(),
    channel: z.enum(["team_messaging", "pager"]),
    template_key: csiTextSchema,
    template_version: csiRevisionSchema,
    purpose: z.literal("review_context"),
    allow_pager_fallback: z.boolean().default(false),
    body: z.string().trim().min(1).max(1000),
  })
  .strict();
export const csiNudgeCommandSchema = z
  .object({
    scope: base.scope,
    nudge: csiNudgeInputSchema,
    expected_rep_revision: csiRevisionSchema.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.nudge.rep_identity_link_id) === (value.expected_rep_revision !== undefined));
