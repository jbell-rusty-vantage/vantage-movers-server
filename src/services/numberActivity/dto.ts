import { z } from "zod";
import {
  CONTACT_ELIGIBILITY_STATES,
  CONTACT_NUMBER_CLASSIFICATIONS,
  CONTACT_NUMBER_KINDS,
} from "../../config/domain/salesIntelligence";
import {
  csiDateSchema as date,
  csiIdSchema as id,
  csiRevisionSchema as revision,
} from "../../validation/v1/salesIntelligence";
import {
  attachedLeadProgressDtoSchema,
  type AttachedLeadProgressDto,
  coverageDtoSchema,
  numberDetailDtoSchema,
  ownerReadSchema,
  timelineEventDtoSchema,
} from "../salesIntelligence/dto";

/**
 * CSI-04 Number Activity read DTOs (Owner-only routes). Built on the frozen
 * CSI-01 schemas in `../salesIntelligence/dto`; nothing there is redefined.
 * Full customer numbers appear here because these reads are Owner-only.
 * Dates are ISO UTC strings. No provider bodies, transcript or summary text.
 */

const nonNegativeInt = z.number().int().nonnegative();

export const numberRollupsDtoSchema = z
  .object({
    interactions_total: nonNegativeInt,
    inbound_total: nonNegativeInt,
    outbound_total: nonNegativeInt,
    human_conversations_total: nonNegativeInt,
    last_inbound_at: date.nullable(),
    last_outbound_at: date.nullable(),
    /** LP-06: the Numbers `last_human_conversation` sort field. Optional so older fixtures/readers parse. */
    last_human_conversation_at: date.nullable().optional(),
    attached_lead_count: nonNegativeInt,
    candidate_lead_count: nonNegativeInt,
    open_outreach_count: nonNegativeInt,
  })
  .strict();

export const NUMBER_SEARCH_MATCH_KINDS = ["e164", "suffix", "term", "none"] as const;

/** LP-06 (§14.2): Numbers list time sorts. `last_activity` desc is the historical default. */
export const NUMBER_SEARCH_SORTS = ["last_activity", "last_human_conversation", "first_observed"] as const;
export const NUMBER_SEARCH_DIRECTIONS = ["asc", "desc"] as const;
export type NumberSearchSort = (typeof NUMBER_SEARCH_SORTS)[number];
export type NumberSearchDirection = (typeof NUMBER_SEARCH_DIRECTIONS)[number];

/**
 * LP-06 (§7 Number card, §11.3): the Lead progress of the Number's one
 * resolved display Lead, from `loadAttachedLeadProgressForNumbers` in
 * `salesIntelligence/outreach/reads`. `multiple`/`none` carry no Lead fields,
 * so Admin can never show a merged Priority or an any-Lead Quoted boolean.
 * `lead_progress` is null while the Lead progress flag is off. The shape is
 * the Outreach DTO's `attachedLeadProgressDtoSchema`; this adds the
 * resolved/non-resolved field rule.
 */
export const numberAttachedLeadProgressDtoSchema = attachedLeadProgressDtoSchema.superRefine((value, ctx) => {
  if (value.status === "resolved") {
    if (!value.lead_ref) ctx.addIssue({ code: "custom", message: "resolved requires lead_ref", path: ["lead_ref"] });
    return;
  }
  for (const key of ["lead_ref", "lead_progress", "booking", "outreach_state", "lead_display"] as const) {
    if (value[key] !== undefined) ctx.addIssue({ code: "custom", message: `${value.status} carries no Lead fields`, path: [key] });
  }
});
export type AttachedLeadProgressItemDto = AttachedLeadProgressDto;

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
    /** LP-06: optional and additive; absent on detail-derived items and older servers. */
    attached_lead_progress: numberAttachedLeadProgressDtoSchema.optional(),
  })
  .strict();

export const numberSearchPageDtoSchema = ownerReadSchema(
  z
    .object({
      items: z.array(numberSearchItemDtoSchema),
      cursor: z.string().nullable(),
      /** LP-06: the order applied to this page (the resolved request; defaults `last_activity`/`desc`). */
      sort: z
        .object({ sort: z.enum(NUMBER_SEARCH_SORTS), direction: z.enum(NUMBER_SEARCH_DIRECTIONS) })
        .strict()
        .optional(),
    })
    .strict(),
);

export const numberConnectionsDtoSchema = z
  .object({
    attachments_total: nonNegativeInt,
    attached: nonNegativeInt,
    candidate: nonNegativeInt,
    ambiguous: nonNegativeInt,
    rejected: nonNegativeInt,
    outreach_records_total: nonNegativeInt,
    open_outreach: nonNegativeInt,
    /** Fresh `call_interactions` count with `merged_into_id: null`; Owner visibility against `rollups.interactions_total`. */
    interactions_total_recount: nonNegativeInt,
  })
  .strict();

/** Fields present in the CSI-04 detail data shape but absent from the CSI-01 `numberDetailDtoSchema` data shape. */
export const NUMBER_DETAIL_READ_ONLY_FIELDS = [
  "kind",
  "national_ten",
  "provider_names",
  "search_terms",
  "first_observed_at",
  "last_activity_at",
  "rollups",
  "connections",
] as const;

const numberDetailReadDataSchema = numberDetailDtoSchema.shape.data
  .extend({
    kind: z.enum(CONTACT_NUMBER_KINDS),
    national_ten: z.string().regex(/^\d{10}$/).nullable(),
    provider_names: z.array(z.string()),
    /** Owner-only; never copied into the search item. */
    search_terms: z.array(z.string()),
    first_observed_at: date,
    last_activity_at: date,
    rollups: numberRollupsDtoSchema,
    connections: numberConnectionsDtoSchema,
  })
  .strict();

/** Superset of the CSI-01 `numberDetailDtoSchema` data shape. */
export const numberDetailReadDtoSchema = ownerReadSchema(numberDetailReadDataSchema);

export const numberTimelineEventDtoSchema = timelineEventDtoSchema
  .extend({ detail: z.record(z.string(), z.json()) })
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
export type NumberSearchItemDto = z.infer<typeof numberSearchItemDtoSchema>;
export type NumberSearchPageDto = z.infer<typeof numberSearchPageDtoSchema>;
export type NumberDetailReadDto = z.infer<typeof numberDetailReadDtoSchema>;
export type NumberTimelineEventDto = z.infer<typeof numberTimelineEventDtoSchema>;
export type NumberTimelinePageDto = z.infer<typeof numberTimelinePageDtoSchema>;

const FIXTURE_NUMBER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const FIXTURE_INTERACTION_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const FIXTURE_MESSAGE_ID = "cccccccccccccccccccccccc";
const FIXTURE_ATTACHMENT_ID = "dddddddddddddddddddddddd";
const FIXTURE_LEAD_ID = "eeeeeeeeeeeeeeeeeeeeeeee";

const fixtureRollups: NumberRollupsDto = {
  interactions_total: 3,
  inbound_total: 2,
  outbound_total: 1,
  human_conversations_total: 0,
  last_inbound_at: "2026-09-17T14:00:00.000Z",
  last_outbound_at: "2026-09-16T18:30:00.000Z",
  attached_lead_count: 1,
  candidate_lead_count: 0,
  open_outreach_count: 0,
};

const fixtureCoverage: z.infer<typeof coverageDtoSchema> = {
  known_through: null,
  gaps: [],
  capabilities: { call_log: "unknown", recording_content: "unknown", webhook: "unknown" },
  ai_paused: false,
};

/** Synthetic, schema-parsed examples for Team E. Fictional 555-01xx numbers and made-up ids. */
export const NUMBER_DTO_FIXTURES = {
  searchItem: {
    id: FIXTURE_NUMBER_ID,
    revision: 4,
    e164: "+15550100200",
    national_ten: "5550100200",
    kind: "external",
    classification: "unknown",
    eligibility: "allowed",
    provider_names: ["Synthetic Customer"],
    first_observed_at: "2026-09-16T18:30:00.000Z",
    last_activity_at: "2026-09-17T14:00:00.000Z",
    rollups: fixtureRollups,
    linked: true,
    match: { kind: "e164" },
  } satisfies NumberSearchItemDto,
  detail: {
    as_of: "2026-09-17T15:00:00.000Z",
    coverage: fixtureCoverage,
    data: {
      id: FIXTURE_NUMBER_ID,
      revision: 4,
      e164: "+15550100200",
      classification: "unknown",
      eligibility: "allowed",
      attachments: [
        {
          id: FIXTURE_ATTACHMENT_ID,
          revision: 1,
          lead_ref: { model: "FormLead", id: FIXTURE_LEAD_ID },
          state: "attached",
          certainty: "exact",
        },
      ],
      outreach_records: [],
      running_analysis: null,
      restrictions: [],
      review_items: [],
      allowed_actions: [
        {
          action: "rebuild_number",
          enabled: true,
          blocker_codes: [],
          target_id: FIXTURE_NUMBER_ID,
          expected_revision: 4,
        },
      ],
      kind: "external",
      national_ten: "5550100200",
      provider_names: ["Synthetic Customer"],
      search_terms: ["synthetic customer"],
      first_observed_at: "2026-09-16T18:30:00.000Z",
      last_activity_at: "2026-09-17T14:00:00.000Z",
      rollups: fixtureRollups,
      connections: {
        attachments_total: 1,
        attached: 1,
        candidate: 0,
        ambiguous: 0,
        rejected: 0,
        outreach_records_total: 0,
        open_outreach: 0,
        interactions_total_recount: 3,
      },
    },
  } satisfies NumberDetailReadDto,
  timelineInteraction: {
    id: FIXTURE_INTERACTION_ID,
    kind: "interaction",
    happened_at: "2026-09-17T14:00:00.000Z",
    observed_at: "2026-09-17T14:01:36.000Z",
    subject_key: `number:${FIXTURE_NUMBER_ID}`,
    description: "Inbound call, Call connected, 95 s, 1 recording",
    evidence_refs: [`interaction:${FIXTURE_INTERACTION_ID}`, "recording:rec-synthetic-1"],
    detail: {
      direction: "Inbound",
      provider_result: "Call connected",
      provider_connected: true,
      contact_type: "unknown",
      duration_seconds: 95,
      terminal: true,
      recording_count: 1,
      recording_ids: ["rec-synthetic-1"],
      projection_revision: 4,
      sources: ["webhook", "call_log_reconcile"],
    },
  } satisfies NumberTimelineEventDto,
  timelineLeadMessage: {
    id: FIXTURE_MESSAGE_ID,
    kind: "lead_message",
    happened_at: "2026-09-16T18:31:00.000Z",
    observed_at: "2026-09-16T18:30:58.000Z",
    subject_key: `number:${FIXTURE_NUMBER_ID}`,
    description: "Lead Message delivered (quote_request_confirmation)",
    evidence_refs: [`lead_message:${FIXTURE_MESSAGE_ID}`],
    detail: {
      status: "delivered",
      purpose: "quote_request_confirmation",
      sent_at: "2026-09-16T18:31:00.000Z",
      delivered_at: "2026-09-16T18:31:04.000Z",
      lead_ref: { model: "FormLead", id: FIXTURE_LEAD_ID },
    },
  } satisfies NumberTimelineEventDto,
} as const;
