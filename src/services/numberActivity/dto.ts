import { z } from "zod";
import {
  CONTACT_ELIGIBILITY_STATES,
  CONTACT_NUMBER_CLASSIFICATIONS,
  CONTACT_NUMBER_KINDS,
} from "../../config/domain/salesIntelligence";
import {
  csiActionAvailabilitySchema,
  csiDateSchema as date,
  csiIdSchema as id,
  csiRevisionSchema as revision,
} from "../../validation/v1/salesIntelligence";
import { ownerReadSchema } from "../salesIntelligence/coverageDto";

/**
 * Numbers read DTOs (Owner/Admin-only routes). Deterministic metadata only:
 * canonical Contact Number, Call Interaction and attachment rows plus the
 * official Lead/Booking/Cancellation state of an attached Lead. No transcript,
 * summary, analysis, assessment, Outreach or suggestion field exists here.
 * Full customer numbers appear because these reads are Owner/Admin-only.
 * Dates are ISO UTC strings.
 */

const nonNegativeInt = z.number().int().nonnegative();
const leadRefSchema = z.object({ model: z.enum(["FormLead", "CallLead"]), id }).strict();

export const numberRollupsDtoSchema = z
  .object({
    interactions_total: nonNegativeInt,
    inbound_total: nonNegativeInt,
    outbound_total: nonNegativeInt,
    human_conversations_total: nonNegativeInt,
    last_inbound_at: date.nullable(),
    last_outbound_at: date.nullable(),
    last_human_conversation_at: date.nullable(),
    attached_lead_count: nonNegativeInt,
    candidate_lead_count: nonNegativeInt,
    /** Provider recording count over canonical interactions; the recordings themselves stay with RingCentral. */
    recordings_total: nonNegativeInt,
  })
  .strict();

export const NUMBER_SEARCH_MATCH_KINDS = ["e164", "suffix", "term", "none"] as const;

/**
 * Numbers list sorts. `last_call` is an alias of `last_activity` (same index,
 * same cursor), `first_call` an alias of `first_observed`, and `interactions`
 * orders by `rollups.interactions_total`. `last_activity` desc is the default.
 */
export const NUMBER_SEARCH_SORTS = [
  "last_activity",
  "last_human_conversation",
  "first_observed",
  "last_call",
  "first_call",
  "interactions",
] as const;
export const NUMBER_SEARCH_DIRECTIONS = ["asc", "desc"] as const;
export type NumberSearchSort = (typeof NUMBER_SEARCH_SORTS)[number];
export type NumberSearchDirection = (typeof NUMBER_SEARCH_DIRECTIONS)[number];

/** Official Lead state from the Lead flags, then the exact Booking and Cancellation rows. */
export const NUMBER_OFFICIAL_STATUSES = ["open_lead", "booked", "cancelled", "bad_lead", "duplicate", "no_sync"] as const;
export const numberLeadOfficialDtoSchema = z
  .object({
    status: z.enum(NUMBER_OFFICIAL_STATUSES),
    /** The Lead's newest `booked_leads` row (`lead_model` + `lead_ref`), if any. */
    booking_id: id.nullable(),
    /** The `cancelled_leads` row of that Booking, if any. */
    cancellation_id: id.nullable(),
  })
  .strict();

/**
 * The one Lead a Number resolves to: exactly one `attached` edge. Several
 * attached edges are `multiple`; candidate, ambiguous and rejected edges never
 * lend a Lead to the Number (`none`). `multiple` and `none` carry no Lead field,
 * so no Lead fact from one Lead is ever shown on a Number that has several.
 */
export const numberAttachedLeadDtoSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("resolved"),
      lead_ref: leadRefSchema,
      /** Null when the Lead row is gone. */
      lead_display: z
        .object({ name: z.string().nullable(), job_no: z.string().nullable(), source_company: z.string().nullable() })
        .strict()
        .nullable(),
      /** Null when the Lead row is gone. */
      official: numberLeadOfficialDtoSchema.nullable(),
    })
    .strict(),
  z.object({ status: z.literal("multiple") }).strict(),
  z.object({ status: z.literal("none") }).strict(),
]);
export type NumberAttachedLeadDto = z.infer<typeof numberAttachedLeadDtoSchema>;

/** G7: `ContactNumber.created_via`, null resolved to `call`. */
export const numberCreatedViaDtoSchema = z.enum(["call", "form_lead"]);

export const numberSearchItemDtoSchema = z
  .object({
    id,
    revision,
    e164: z.string().regex(/^\+[1-9]\d{6,14}$/),
    national_ten: z.string().regex(/^\d{10}$/).nullable(),
    kind: z.enum(CONTACT_NUMBER_KINDS),
    classification: z.enum(CONTACT_NUMBER_CLASSIFICATIONS),
    eligibility: z.enum(CONTACT_ELIGIBILITY_STATES),
    provider_names: z.array(z.string()),
    first_observed_at: date,
    last_activity_at: date,
    rollups: numberRollupsDtoSchema,
    /** `attached_lead_count > 0 || candidate_lead_count > 0`. */
    linked: z.boolean(),
    match: z.object({ kind: z.enum(NUMBER_SEARCH_MATCH_KINDS) }).strict(),
    attached_lead: numberAttachedLeadDtoSchema,
    created_via: numberCreatedViaDtoSchema,
    /** `rollups.interactions_total > 0`. */
    has_calls: z.boolean(),
  })
  .strict();

export const numberSearchPageDtoSchema = ownerReadSchema(
  z
    .object({
      items: z.array(numberSearchItemDtoSchema),
      cursor: z.string().nullable(),
      /** The order applied to this page (the resolved request; defaults `last_activity`/`desc`). */
      sort: z
        .object({ sort: z.enum(NUMBER_SEARCH_SORTS), direction: z.enum(NUMBER_SEARCH_DIRECTIONS) })
        .strict(),
      /**
       * G7: the `has_calls` narrowing the server applied (explicit param, or the
       * `NUMBERS_HAS_CALLS_DEFAULT` flag default lifted by `include_form_only`). Absent when the flag
       * is off and neither param was sent.
       */
      filters: z.object({ has_calls: z.boolean() }).strict().optional(),
    })
    .strict(),
);

export const numberAttachmentDtoSchema = z
  .object({
    id,
    revision,
    lead_ref: leadRefSchema,
    state: z.enum(["candidate", "ambiguous", "attached", "rejected"]),
    certainty: z.enum(["exact", "likely", "unsure", "owner_confirmed", "rejected"]),
    /** Display snapshot the attachment refresh stored; never a live Lead read. */
    lead_display: z.object({ name: z.string().nullable(), job_no: z.string().nullable() }).strict().nullable(),
    /** Owner decision provenance; null on automatic edges. */
    decided_at: date.nullable(),
    decided_by: z.string().nullable(),
    decision_reason: z.string().nullable(),
  })
  .strict();

/** A stored call/text restriction on the Number, read-only. `origin` keeps who recorded it. */
export const numberRestrictionDtoSchema = z
  .object({
    id,
    revision,
    channels: z.array(z.enum(["call", "text"])),
    until: date.nullable(),
    origin: z.enum(["owner", "intelligence"]),
    state: z.enum(["active", "expired", "resolved"]),
  })
  .strict();

export const numberConnectionsDtoSchema = z
  .object({
    attachments_total: nonNegativeInt,
    attached: nonNegativeInt,
    candidate: nonNegativeInt,
    ambiguous: nonNegativeInt,
    rejected: nonNegativeInt,
    /** Fresh `call_interactions` count with `merged_into_id: null`; Owner visibility against `rollups.interactions_total`. */
    interactions_total_recount: nonNegativeInt,
  })
  .strict();

export const numberDetailReadDtoSchema = ownerReadSchema(
  z
    .object({
      id,
      revision,
      e164: z.string().regex(/^\+[1-9]\d{6,14}$/),
      national_ten: z.string().regex(/^\d{10}$/).nullable(),
      kind: z.enum(CONTACT_NUMBER_KINDS),
      classification: z.enum(CONTACT_NUMBER_CLASSIFICATIONS),
      eligibility: z.enum(CONTACT_ELIGIBILITY_STATES),
      provider_names: z.array(z.string()),
      /** Owner-only; never copied into the search item. */
      search_terms: z.array(z.string()),
      first_observed_at: date,
      last_activity_at: date,
      created_via: numberCreatedViaDtoSchema,
      has_calls: z.boolean(),
      rollups: numberRollupsDtoSchema,
      attached_lead: numberAttachedLeadDtoSchema,
      attachments: z.array(numberAttachmentDtoSchema),
      restrictions: z.array(numberRestrictionDtoSchema),
      connections: numberConnectionsDtoSchema,
      allowed_actions: z.array(csiActionAvailabilitySchema),
    })
    .strict(),
);

/** Interaction (provider call metadata) and Lead Message events on one Number. */
export const NUMBER_TIMELINE_KINDS = ["interaction", "lead_message"] as const;
export const numberTimelineEventDtoSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(NUMBER_TIMELINE_KINDS),
    happened_at: date,
    observed_at: date,
    subject_key: z.string(),
    description: z.string(),
    evidence_refs: z.array(z.string()),
    detail: z.record(z.string(), z.json()),
  })
  .strict();

export const numberTimelinePageDtoSchema = ownerReadSchema(
  z
    .object({
      number_id: id,
      items: z.array(numberTimelineEventDtoSchema),
      cursor: z.string().nullable(),
    })
    .strict(),
);

export type NumberRollupsDto = z.infer<typeof numberRollupsDtoSchema>;
export type NumberLeadOfficialDto = z.infer<typeof numberLeadOfficialDtoSchema>;
export type NumberSearchItemDto = z.infer<typeof numberSearchItemDtoSchema>;
export type NumberSearchPageDto = z.infer<typeof numberSearchPageDtoSchema>;
export type NumberAttachmentDto = z.infer<typeof numberAttachmentDtoSchema>;
export type NumberRestrictionDto = z.infer<typeof numberRestrictionDtoSchema>;
export type NumberDetailReadDto = z.infer<typeof numberDetailReadDtoSchema>;
export type NumberTimelineEventDto = z.infer<typeof numberTimelineEventDtoSchema>;
export type NumberTimelinePageDto = z.infer<typeof numberTimelinePageDtoSchema>;
