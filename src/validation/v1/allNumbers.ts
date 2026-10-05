import { z } from "zod";
import { csiIdSchema } from "./salesIntelligence";

/**
 * All Numbers + Accounts HTTP contract (all-numbers CONTRACT §4), under
 * `/api/v1/admin/sales-intelligence`. Query strings and bodies are strict: an unknown key is 400.
 * Response DTOs are parsed before they leave the server.
 */
const scope = { scope: z.literal("production").optional() };
const leadModel = z.enum(["FormLead", "CallLead"]);
const date = z.iso.datetime();

export const allNumbersQuerySchema = z
  .object({
    ...scope,
    view: z.enum(["all", "waiting"]).default("all"),
    q: z.string().trim().max(200).optional(),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type AllNumbersQuery = z.infer<typeof allNumbersQuerySchema>;

export const numberDetailQuerySchema = z.object({ ...scope }).strict();

export const leadSearchQuerySchema = z
  .object({ ...scope, q: z.string().trim().min(1).max(200) })
  .strict();

const leadRefInputSchema = z.object({ model: leadModel, id: csiIdSchema }).strict();
/** §4.3: exactly one of a non-null `lead` (pin) or `unlink`. */
export const numberLeadCommandSchema = z
  .object({
    ...scope,
    revision: z.number().int().min(1),
    lead: leadRefInputSchema.nullable().default(null),
    unlink: leadRefInputSchema.optional(),
  })
  .strict()
  .refine((body) => (body.lead !== null) !== (body.unlink !== undefined), "Exactly one of a non-null lead or unlink is required");
export type NumberLeadCommand = z.infer<typeof numberLeadCommandSchema>;

export const ACCOUNT_ROLES = ["sales_rep", "service", "manager", "dialer", "shared", "excluded"] as const;
export const accountsQuerySchema = z.object({ ...scope }).strict();
export const accountAgentCommandSchema = z
  .object({
    ...scope,
    agent_id: csiIdSchema.nullable(),
    role: z.enum(ACCOUNT_ROLES).optional(),
    link_revision: z.number().int().min(1).optional(),
  })
  .strict();
export type AccountAgentCommand = z.infer<typeof accountAgentCommandSchema>;
export const accountsSuggestSchema = z.object({ ...scope }).strict();

// ── Responses ──────────────────────────────────────────────────────────────

export const leadRefDtoSchema = z
  .object({
    model: leadModel,
    id: csiIdSchema,
    name: z.string().nullable(),
    job_no: z.string().nullable(),
    rep_name: z.string().nullable(),
    received_at: date,
    state: z.enum(["open", "booked", "cancelled"]),
    desk_subject_id: csiIdSchema.nullable(),
  })
  .strict();
export type LeadRefDto = z.infer<typeof leadRefDtoSchema>;

const callResult = z.enum(["answered", "missed", "voicemail"]);
const direction = z.enum(["inbound", "outbound"]);

export const numberRowDtoSchema = z
  .object({
    id: csiIdSchema,
    revision: z.number().int().min(1),
    e164: z.string(),
    display: z.string(),
    caller_name: z.string().nullable(),
    source: z.enum(["call", "form_lead"]),
    lead: leadRefDtoSchema.nullable(),
    lead_link: z.enum(["automatic", "owner"]),
    last_call: z
      .object({ at: date, direction, result: callResult, duration_seconds: z.number().nullable(), agent_name: z.string().nullable() })
      .strict()
      .nullable(),
    calls: z.object({ inbound: z.number().int().min(0), outbound: z.number().int().min(0), missed: z.number().int().min(0) }).strict(),
    waiting_since: date.nullable(),
    first_seen_at: date,
    last_activity_at: date,
  })
  .strict();
export type NumberRowDto = z.infer<typeof numberRowDtoSchema>;

export const allNumbersPageDtoSchema = z
  .object({
    items: z.array(numberRowDtoSchema),
    cursor: z.string().nullable(),
    counts: z.object({ all: z.number().int().min(0), waiting: z.number().int().min(0) }).strict(),
  })
  .strict();

export const numberCallDtoSchema = z
  .object({
    id: csiIdSchema,
    at: date,
    direction,
    result: callResult,
    duration_seconds: z.number().nullable(),
    agent_name: z.string().nullable(),
    our_number: z.string().nullable(),
    recordings: z.number().int().min(0),
  })
  .strict();

export const numberDetailDtoSchema = z
  .object({
    number: numberRowDtoSchema,
    other_leads: z.array(leadRefDtoSchema),
    excluded_leads: z.array(leadRefDtoSchema),
    calls: z.array(numberCallDtoSchema),
    more_calls: z.boolean(),
  })
  .strict();
export type NumberDetailDto = z.infer<typeof numberDetailDtoSchema>;

export const leadSearchDtoSchema = z
  .object({ items: z.array(leadRefDtoSchema.extend({ phone: z.string().nullable() }).strict()) })
  .strict();

const agentRef = z.object({ id: csiIdSchema, name: z.string() }).strict();
export const accountDtoSchema = z
  .object({
    /** The RingCentral account of the User (the existing `/nudges` command needs it); null only when unknown. */
    rc_account_id: z.string().nullable(),
    extension_id: z.string(),
    extension_number: z.string().nullable(),
    name: z.string().nullable(),
    direct_numbers: z.array(z.string()),
    status: z.string().nullable(),
    in_directory: z.boolean(),
    agent: agentRef.nullable(),
    role: z.enum(ACCOUNT_ROLES).nullable(),
    link_id: csiIdSchema.nullable(),
    link_revision: z.number().int().min(1).nullable(),
    suggestion: z.object({ agent_id: csiIdSchema, agent_name: z.string() }).strict().nullable(),
    can_message: z.boolean(),
    /**
     * Additive to CONTRACT §4.5: the channels the Owner's Message can use for this User now (empty when
     * `can_message` is false), in preference order. The client offers these instead of guessing.
     */
    message_channels: z.array(z.enum(["team_messaging", "pager"])),
  })
  .strict();
export type AccountDto = z.infer<typeof accountDtoSchema>;

export const accountsDtoSchema = z
  .object({ directory_at: date.nullable(), accounts: z.array(accountDtoSchema), agents: z.array(agentRef) })
  .strict();
export type AccountsDto = z.infer<typeof accountsDtoSchema>;
