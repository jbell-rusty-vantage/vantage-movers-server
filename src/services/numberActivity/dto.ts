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
    /**
     * Data spec §2.1 / §4.2 row line 4–5. Always emitted by `toRollupsDto`;
     * optional here so older fixtures and readers still parse. Rows written
     * before the rollup sweep read the model default (0 / null).
     */
    recordings_total: nonNegativeInt.optional(),
    conversations_analyzed_total: nonNegativeInt.optional(),
    last_analyzed_at: date.nullable().optional(),
    outreach_records_total: nonNegativeInt.optional(),
  })
  .strict();

export const NUMBER_SEARCH_MATCH_KINDS = ["e164", "suffix", "term", "none"] as const;

/**
 * Numbers list sorts. LP-06 (§14.2) time sorts, plus data spec §4.2:
 * `last_call` is an alias of `last_activity` (same index, same cursor),
 * `first_call` an alias of `first_observed`, and `interactions` orders by
 * `rollups.interactions_total`. `last_activity` desc is the historical default.
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
  for (const key of ["lead_ref", "lead_progress", "booking", "outreach_state", "lead_display", "lead_status", "move_assessment"] as const) {
    if (value[key] !== undefined) ctx.addIssue({ code: "custom", message: `${value.status} carries no Lead fields`, path: [key] });
  }
});
export type AttachedLeadProgressItemDto = AttachedLeadProgressDto;

/** G7 (reconciliation §3.5): `ContactNumber.created_via`, null resolved to `call`. */
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
    /** LP-06: optional and additive; absent on detail-derived items and older servers. */
    attached_lead_progress: numberAttachedLeadProgressDtoSchema.optional(),
    /** G7: how the Number came to exist; a stored null/absent resolves to `call` on the server. Optional for older servers. */
    created_via: numberCreatedViaDtoSchema.optional(),
    /** G7: `rollups.interactions_total > 0`. Optional for older servers. */
    has_calls: z.boolean().optional(),
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
      /**
       * G7: the `has_calls` narrowing the server applied (explicit param, or the
       * `NUMBERS_HAS_CALLS_DEFAULT` flag default lifted by `include_form_only`). Absent when the flag
       * is off and neither param was sent (the page is the historical list).
       */
      filters: z.object({ has_calls: z.boolean() }).strict().optional(),
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
  "attached_lead_progress",
  "created_via",
  "has_calls",
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
    /** Final spec §9.3: the header's Lead line and scores, identical to the Numbers row's item. Optional and additive. */
    attached_lead_progress: numberAttachedLeadProgressDtoSchema.optional(),
    /** G7: as on the Numbers item. Optional and additive. */
    created_via: numberCreatedViaDtoSchema.optional(),
    has_calls: z.boolean().optional(),
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

/**
 * Timeline v2 (data spec §2.6, §5; final spec §10), served behind `SALES_INTELLIGENCE_TIMELINE_V2`.
 * A superset of the v1 item (`id`, `kind`, `happened_at`, `observed_at`, `subject_key`,
 * `description`, `evidence_refs`, `detail`), so the admin's current `timelineSchema` still parses
 * a v2 Number page. `kind` is an open string (the story catalog names; admin maps unknown kinds to a
 * generic row). Every state is computed by the server: `recorded_late`, `routine`, `chips`, `group`.
 */
export const TIMELINE_V2_GROUPS = ["calls", "lead_updates", "work", "messages", "analysis"] as const;
export const TIMELINE_V2_CHIPS = ["Recording", "Analyzed", "Voicemail", "Human conversation"] as const;
export const TIMELINE_V2_ACTION_KINDS = ["open_conversation", "open_booking"] as const;
export const TIMELINE_V2_RECORDING_STATES = ["none", "recorded", "analyzed"] as const;

const timelineV2RepDtoSchema = z
  .object({
    agent_id: z.string().nullable(),
    /** Present only when the RingCentral identity link is reviewed. */
    name: z.string().nullable(),
    status: z.enum(["reviewed", "proposed", "unknown"]),
    extension: z.string().nullable(),
  })
  .strict();

export const CALL_LOG_STATES = ["provisional", "settled"] as const;
export const CALL_OBSERVED_REASONS = ["recovered", "late_capture"] as const;
/**
 * Call capture state on every Owner call DTO (reconciliation addendum §3.1, G2). Optional so an
 * older server's response still parses; S5c servers always send all three.
 *
 * Null rule: `call_log_state: null` means **final** unless `terminal === false` (historical rows keep
 * `null` forever). `in_progress` = `!terminal`; while it is true the result and duration are null
 * (not yet final), and the UI shows an `In progress` chip. `direction: "Unknown"` is passed through.
 */
export const callCaptureStateShape = {
  terminal: z.boolean().optional(),
  call_log_state: z.enum(CALL_LOG_STATES).nullable().optional(),
  in_progress: z.boolean().optional(),
};

/** Facts of a `call` event (Number route Calls tab, final spec §9.3). */
export const timelineV2CallDtoSchema = z
  .object({
    interaction_id: id,
    direction: z.string(),
    result: z.string().nullable(),
    connected: z.boolean(),
    contact_type: z.string(),
    duration_seconds: z.number().nullable(),
    recording_count: z.number().int().nonnegative(),
    recording_state: z.enum(TIMELINE_V2_RECORDING_STATES),
    /** The analyzed conversation, else the first linked one; null without a recording link. */
    conversation_id: id.nullable(),
    rep: timelineV2RepDtoSchema.nullable(),
    ...callCaptureStateShape,
    /**
     * Why `observed_at` is later than the call (G4): `recovered` when a capture repair added or
     * completed the call (`capture_recovery`), `late_capture` when first stored more than 1 h after it
     * started, else null. Optional: servers before S5c did not send it.
     */
    observed_reason: z.enum(CALL_OBSERVED_REASONS).nullable().optional(),
  })
  .strict();

export const timelineV2EventDtoSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    /** Data spec §5.2 row number; the second key of the total order. */
    kind_order: z.number().int().positive(),
    group: z.enum(TIMELINE_V2_GROUPS),
    happened_at: date,
    observed_at: date,
    /** `observed_at − happened_at > 1 h`: print `Recorded {observed_at}` (final spec §3.1). */
    recorded_late: z.boolean(),
    subject_key: z.string(),
    title: z.string(),
    /** The Subject Story sentence the model reads for the same event. */
    description: z.string(),
    evidence_refs: z.array(z.string()),
    detail: z.record(z.string(), z.json()),
    chips: z.array(z.enum(TIMELINE_V2_CHIPS)),
    action: z.object({ kind: z.enum(TIMELINE_V2_ACTION_KINDS), href: z.string().min(1) }).strict().nullable(),
    /** Collapsed under `Processing details ({n})` (final spec §10.1). */
    routine: z.boolean(),
    /** Scope `number` with more than one Lead: the admin prefixes `Job {n} ·`. */
    job_no: z.string().nullable(),
    actor: z
      .object({
        kind: z.enum(["customer", "rep", "vantage", "granot", "owner", "intelligence", "worker"]),
        agent_id: z.string().nullable(),
        name: z.string().nullable(),
      })
      .strict(),
    call: timelineV2CallDtoSchema.nullable(),
  })
  .strict();

export const timelineV2PageDtoSchema = ownerReadSchema(
  z
    .object({
      scope: z.enum(["number", "outreach"]),
      /** Always set on scope `number` (the v1 admin requires it). */
      number_id: id.nullable(),
      outreach_id: id.nullable(),
      items: z.array(timelineV2EventDtoSchema),
      cursor: z.string().nullable(),
      /** Echo of the `kinds[]` filter applied; null = every kind. */
      kinds: z.array(z.string()).nullable(),
      coverage: z
        .object({
          /** Sources that did not read every row (more than 20 Leads, or a bounded set at its cap). */
          truncated_sources: z.array(z.string()),
        })
        .strict(),
    })
    .strict(),
);

export type TimelineV2EventDto = z.infer<typeof timelineV2EventDtoSchema>;
export type TimelineV2PageDto = z.infer<typeof timelineV2PageDtoSchema>;

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
      call_log_state: "settled",
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
