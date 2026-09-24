import { z } from "zod";
export type { AttachmentDto } from "./attachment/reads";
export { attachmentDtoSchema } from "./attachment/reads";
export type { AttachmentAttribution } from "./attachment/suggest";
import {
  CSI_ACTION_KINDS,
  CSI_EFFECT_STATUSES,
  CSI_OUTREACH_STATES,
} from "../../config/domain/salesIntelligence";
import { intelligenceFindingSchema } from "../../validation/intelligence/intelligenceEnvelope.validation";
import { ASSESSMENT_AVAILABILITY, outreachMoveAssessmentDtoSchema } from "./assessment/dto";
import {
  csiIdSchema as id,
  csiDateSchema as date,
  csiRevisionSchema as revision,
  csiSubjectSchema,
  csiActionAvailabilitySchema,
  csiDateResolutionSchema,
  csiPolicySchema,
} from "../../validation/v1/salesIntelligence";
export const coverageDtoSchema = z
  .object({
    known_through: date.nullable(),
    gaps: z.array(
      z.object({ from: date, to: date, reason: z.string() }).strict(),
    ),
    capabilities: z.record(
      z.string(),
      z.enum(["ok", "denied", "unknown", "unavailable"]),
    ),
    ai_paused: z.boolean(),
    recordings: z.object({
      pending_discovery: z.number().int().nonnegative(),
      media_pending: z.number().int().nonnegative(),
      media_stored: z.number().int().nonnegative(),
      no_recording: z.number().int().nonnegative(),
      unavailable: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      eligibility_undetermined: z.number().int().nonnegative(),
    }).strict().optional(),
  })
  .strict();
const nonnegative = z.number().int().nonnegative();
const unknownCount = nonnegative.nullable();
export const ownerCoverageStageSchema = z
  .object({
    pending: nonnegative,
    leased: nonnegative,
    retry: nonnegative,
    paused: nonnegative,
    dead_letter: nonnegative,
    oldest_queued_at: date.nullable(),
  })
  .strict();
export const ownerCoverageDtoSchema = coverageDtoSchema.extend({
  stages: z
    .object({
      recording: ownerCoverageStageSchema,
      transcription: ownerCoverageStageSchema,
      analysis: ownerCoverageStageSchema,
      application: ownerCoverageStageSchema,
    })
    .strict(),
  budget: z
    .object({
      status: z.enum(["known", "unknown"]),
      month: z.string().nullable(),
      ceiling_cents: nonnegative,
      actual_cents: unknownCount,
      reserved_cents: unknownCount,
      remaining_cents: unknownCount,
    })
    .strict(),
  // Why analysis is or is not being admitted right now, with the numbers the
  // worker evaluates, so a paused pipeline is explainable from this read alone (17 §5).
  analysis_admission: z
    .object({
      status: z.enum(["admitted", "per_recording_ceiling", "monthly_budget", "no_active_period", "configuration_missing"]),
      estimated_cents_per_conversation: unknownCount,
      per_recording_ceiling_cents: nonnegative,
      model: z.string().min(1),
      pricing_version: z.string().nullable(),
      limits: z
        .object({
          steps: nonnegative,
          context_tokens: nonnegative,
          output_tokens: nonnegative,
          total_input_tokens: nonnegative,
          total_output_tokens: nonnegative,
          elapsed_ms: nonnegative,
        })
        .strict(),
      paused: z
        .object({ per_recording_ceiling: nonnegative, budget: nonnegative, configuration: nonnegative })
        .strict(),
      // Reservations whose invocation started but never reported complete usage.
      // Their estimate stays reserved on purpose: unknown spend is never released.
      unresolved_reservations: z.object({ count: nonnegative, estimated_cents: nonnegative }).strict(),
    })
    .strict(),
  // CC-01/CC-06: Call Log capture completeness, readable without logs.
  // Quarantined records are retried hourly and never hold the window; the
  // last sweep says how many provider calls needed correction.
  call_log_capture: z
    .object({
      quarantined_count: nonnegative,
      oldest_quarantined_at: date.nullable(),
      sync_mode: z.enum(["off", "shadow", "on"]),
      last_sweep: z
        .object({
          ran_at: date,
          from: date,
          to: date,
          complete: z.boolean(),
          provider_records: nonnegative,
          stored_in_latest_version: nonnegative,
          applied_changes: nonnegative,
          missing_before: nonnegative,
          stale_before: nonnegative,
          provisional_after_horizon: nonnegative,
          quarantined: nonnegative,
          consecutive_drift_runs: nonnegative,
        })
        .strict()
        .nullable(),
    })
    .strict(),
  mapping_hygiene: z
    .object({
      unmapped_inbound_numbers: nonnegative,
      unmapped_directory_users: unknownCount,
      last_directory_sync_at: date.nullable(),
      directory_status: z.enum(["stored", "missing"]),
    })
    .strict(),
  flags: z.record(z.string(), z.boolean()),
  models: z
    .object({
      extraction: z.object({ name: z.string(), enabled: z.boolean() }).strict(),
      transcription: z.object({ name: z.string(), enabled: z.boolean() }).strict(),
    })
    .strict(),
  settings: z
    .object({
      persisted: z.boolean(),
      revision: revision,
      version: z.string().min(1),
      source: z.enum(["persisted", "accepted_defaults"]),
      timezone: z.string().min(1),
      first_action_due_staffed_minutes: nonnegative,
      missed_callback_due_staffed_minutes: nonnegative,
      going_cold_staffed_minutes: nonnegative,
      monthly_ceiling_cents: nonnegative,
      per_recording_ceiling_cents: nonnegative,
    })
    .strict(),
  backfill: z
    .object({
      available: z.boolean(),
      owner_triggered: z.literal(true),
      days: z.number().int().nonnegative(),
      planned: unknownCount,
      partial: unknownCount,
      complete: unknownCount,
      failed: unknownCount,
      known_complete_through: date.nullable(),
      gaps: z.array(z.object({ from: date, to: date, reason: z.string().min(1) }).strict()),
      note: z.string().min(1),
    })
    .strict(),
});
export const csiSettingsReadDtoSchema = z
  .object({
    persisted: z.boolean(),
    revision: revision,
    source: z.enum(["persisted", "accepted_defaults"]),
    policy: csiPolicySchema,
    flags: z.record(z.string(), z.boolean()),
    models: z
      .object({
        extraction: z.object({ name: z.string(), enabled: z.boolean() }).strict(),
        transcription: z.object({ name: z.string(), enabled: z.boolean() }).strict(),
      })
      .strict(),
    updated_at: date.nullable(),
    updated_by: z.string().nullable(),
  })
  .strict();
export const assignmentDtoSchema = z
  .object({
    agent: z.object({ id, name: z.string() }).strict().nullable(),
    origin: z
      .enum([
        "owner",
        "first_conversation",
        "rep_promise",
        "inherited_outreach",
        // Team 4 AC5-ACTIVITY (spec §7.2), additive.
        "first_attempts",
      ])
      .nullable(),
    assigned_at: date.nullable(),
    evidence_ref: z.string().nullable(),
    owner_instruction_id: id.nullable(),
  })
  .strict();
export const derivedDtoSchema = z
  .object({
    overdue: z.boolean(),
    no_owner: z.boolean(),
    no_next_action: z.boolean(),
    cooldown: z.boolean(),
    attention_band: z.number().int().min(1).max(7).nullable(),
    reasons: z.array(z.string()),
    review_item_ids: z.array(id),
    call_blockers: z.array(z.string()),
    age_wall_ms: z.number().nonnegative(),
    age_staffed_ms: z.number().nonnegative(),
    policy_version: z.string(),
    missing_record_responsibility: z.boolean().optional(),
    missing_action_responsibility: z.array(id).optional(),
    review_badges: z.array(z.string()).optional(),
    absence_qualified: z.boolean().optional(),
    action_facts: z.array(z.object({ id, contractual_overdue: z.boolean(), overdue: z.boolean(), attention_due_at: date.nullable(), call_allowed: z.boolean() }).strict()).optional(),
    call_state: z.enum(["not_started", "in_progress", "ended"]).optional(),
    // Derived from the attachment mirror, never stored: who or what decided this lead.
    provenance_state: z.enum(["attached_by_you", "attached_automatically", "attached_from_evidence", "needs_a_lead", "ambiguous"]).optional(),
  })
  .strict();
export const followupDtoSchema = z
  .object({
    id,
    revision,
    kind: z.enum(CSI_ACTION_KINDS),
    description: z.string(),
    status: z.enum(["open", "completed", "cancelled", "superseded"]),
    due_at: date.nullable(),
    base_attention_due_at: date.nullable(),
    attention_due_at: date.nullable(),
    snoozed_until: date.nullable(),
    wait_expired_at: date.nullable(),
    date_text: z.string().nullable(),
    date_resolution: csiDateResolutionSchema.nullable(),
    assignment: assignmentDtoSchema,
    promised_by: z.object({ id, name: z.string() }).strict().nullable(),
    origin: z.enum([
      "owner",
      "rep_promise",
      "customer_request",
      "customer_wait",
      "system_default",
    ]),
    provenance_refs: z.array(z.string()),
    disposition: z
      .enum([
        "no_answer",
        "left_voicemail",
        "spoke_with_customer",
        "connected_contact_unknown",
        "completed",
        "customer_called",
      ])
      .nullable(),
    completion_basis: z
      .enum([
        "owner",
        "call_attempt",
        "customer_confirmation",
        "rep_confirmation",
        "vantage_evidence",
      ])
      .nullable(),
    paused_channels: z.array(z.enum(["call", "text"])),
    overdue: z.boolean(),
    allowed_actions: z.array(csiActionAvailabilitySchema),
    // Team 4 AC4/AC5 (spec §9), additive and present only on rows the flag wrote: a promise retry
    // successor's chain, a server default next step, the action a retry replaces, and why a
    // placeholder was superseded (`superseded_by_specific_plan`).
    promise_chain: z.object({ root_id: id, root_origin: z.enum(["rep_promise", "customer_request", "owner"]), attempt: z.number().int().positive() }).strict().optional(),
    default_kind: z.enum(["quote_followup"]).optional(),
    supersedes_id: id.optional(),
    cancel_reason: z.string().optional(),
  })
  .strict();
export const findingDtoSchema = z
  .object({
    id,
    run_id: id,
    revision,
    assertion: intelligenceFindingSchema,
    review_state: z.enum(["unreviewed", "confirmed", "corrected", "retracted"]),
    effects: z.array(
      z
        .object({
          kind: z.string(),
          status: z.enum(CSI_EFFECT_STATUSES),
          target_id: id.nullable(),
          reason: z.string().nullable(),
        })
        .strict(),
    ),
    validation: z
      .object({
        schema_ok: z.boolean(),
        source_snapshots_valid: z.boolean(),
        locator_status: z.enum(["not_run", "located", "unlocated"]),
        entailment_check: z.enum(["not_run", "pass", "fail", "unsure"]),
      })
      .strict(),
    allowed_actions: z.array(csiActionAvailabilitySchema),
  })
  .strict();
/**
 * LP-01 §7: server-owned Lead progress projection as the Owner reads it. Every
 * label is computed here; Admin never derives Quoted from Priority or policy
 * from a code. Optional on every read so an older Admin still parses.
 */
export const leadProgressDtoSchema = z
  .object({
    lead_ref: z.object({ model: z.enum(["FormLead", "CallLead"]), id }).strict(),
    granot_priority: z.string().nullable(),
    priority_label: z.string(),
    quoted: z.boolean().nullable(),
    disposition: z.enum(["fresh", "quoted", "rep_discretion", "crm_bad_unusable", "crm_dead", "unmapped", "unknown"]),
    disposition_label: z.string(),
    work_observed: z.boolean(),
    basis: z.enum(["quoted", "priority_assigned", "priority_changed", "historical_snapshot"]).nullable(),
    basis_label: z.string().nullable(),
    provenance: z.enum(["accepted", "uncertain", "none"]),
    source_origin: z.enum(["granot", "vantage", "ringcentral"]).nullable(),
    source_applied_at: date.nullable(),
    last_progress_at: date.nullable(),
    first_work_observed_at: date.nullable(),
    closure: z.object({ basis: z.enum(["granot_bad_unusable", "granot_dead_opportunity"]), closed_at: date.nullable() }).strict().nullable(),
    override: z.object({ reason: z.string(), decided_at: date, decided_by: z.string(), disposition_revision: z.string() }).strict().nullable(),
    reopen_review_id: id.nullable(),
    disposition_revision: z.string(),
    explanation: z.string().nullable(),
    no_call_observed: z.boolean(),
    projected_at: date,
  })
  .strict();
export type LeadProgressDto = z.infer<typeof leadProgressDtoSchema>;
/**
 * §14.1 / Move assessment §8: server-computed ordering keys frozen into each Attention snapshot row.
 * Score keys are optional so rows from older snapshots still parse; missing reads as null (sorts last).
 */
export const attentionSortKeysDtoSchema = z
  .object({
    next_action_due: date.nullable(),
    lead_received: date.nullable(),
    last_human_contact: date.nullable(),
    last_lead_progress: date.nullable(),
    transaction_intent: z.number().min(0).max(100).nullable().optional(),
    move_likelihood: z.number().min(0).max(100).nullable().optional(),
    assessment_status: z.enum(ASSESSMENT_AVAILABILITY).nullable().optional(),
    assessment_stale: z.boolean().nullable().optional(),
    // Data spec §3.3 (S1): frozen from the row's `facts`; optional so older snapshots still parse.
    last_call: date.nullable().optional(),
    interactions: z.number().int().nonnegative().nullable().optional(),
    // Data spec §3.5 (S2): closed partition only; absent on active rows and on older snapshots.
    closed: date.nullable().optional(),
    time_to_close: z.number().int().nonnegative().nullable().optional(),
    // Team 4 AC3 (spec §5.2, F10): band 2 order, 0 `no_call_yet`, 1 `new_not_yet_due`, null otherwise.
    // Written only with SALES_INTELLIGENCE_ATTENTION_EVOLUTION; older snapshots omit it.
    band2_due_rank: z.number().int().min(0).max(1).nullable().optional(),
  })
  .strict();
/**
 * Data spec §2.3 / final spec §5.3: card facts computed by `outreachFacts()` at
 * the response's `as_of` (Attention publish time, or request time on the live
 * detail). Every state here is decided on the server; the Admin only formats a
 * duration between a server time and `as_of`. Counts are null when the record
 * has no primary Contact Number ("No Number on file"), never zero.
 */
export const NEXT_ACTION_STATES = ["due", "overdue", "no_due_date", "none"] as const;
export const outreachFactsDtoSchema = z
  .object({
    route: z
      .object({
        pickup_city: z.string().nullable(),
        pickup_state: z.string().nullable(),
        delivery_city: z.string().nullable(),
        delivery_state: z.string().nullable(),
        /** YYYY-MM-DD, Form Leads only. */
        move_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        source: z.literal("lead"),
      })
      .strict()
      .nullable(),
    move_date_passed: z.boolean(),
    last_call_at: date.nullable(),
    calls_total: z.number().int().nonnegative().nullable(),
    conversations_total: z.number().int().nonnegative().nullable(),
    recordings_available: z.number().int().nonnegative().nullable(),
    recordings_analyzed: z.number().int().nonnegative().nullable(),
    newer_call_since_assessment: z.boolean(),
    details_disagree: z.boolean(),
    next_action_state: z.enum(NEXT_ACTION_STATES),
    /** Phase 5 (rep threads); always null until S5. */
    rep_thread: z.null(),
  })
  .strict();
export type OutreachFactsDto = z.infer<typeof outreachFactsDtoSchema>;
export const ATTENTION_SORTS = ["attention", "next_action_due", "lead_received", "last_human_contact", "last_lead_progress", "transaction_intent", "move_likelihood",
  // Data spec §3.4 (S2): Last call and Interactions (final spec §7.2); Closed and Time to close exist only in `view=closed` (final spec §8).
  "last_call", "interactions", "closed", "time_to_close"] as const;
export const ATTENTION_CLOSED_SORTS = ["closed", "time_to_close"] as const;
export const ATTENTION_SCORE_SORTS = ["transaction_intent", "move_likelihood"] as const;
export const ATTENTION_VIEWS = ["attention", "all_outreach", "closed"] as const;
export const ATTENTION_FRESHNESS = ["fresh", "all"] as const;
export const ATTENTION_SORT_DEFAULT_DIRECTION: Record<(typeof ATTENTION_SORTS)[number], "asc" | "desc"> = {
  attention: "asc", next_action_due: "asc", lead_received: "desc", last_human_contact: "asc", last_lead_progress: "desc",
  transaction_intent: "desc", move_likelihood: "desc", last_call: "desc", interactions: "desc", closed: "desc", time_to_close: "asc",
};
/**
 * Data spec §2.3 / §3.4 / §3.5 (S2): the snapshot partition. `closed` rows are kept for 90 days after
 * `closed_at` and are reachable only through `view=closed`; rows without the field are `active`.
 */
export const ATTENTION_PARTITIONS = ["active", "closed"] as const;
/** Closed-view outcomes (final spec §8), mapped from `closed_reason` / `closure_origin` (data spec §3.5). */
export const ATTENTION_OUTCOMES = ["booked", "cancelled", "bad_lead", "duplicate", "no_sync", "crm_dead", "crm_bad_unusable", "owner"] as const;
export type AttentionOutcome = (typeof ATTENTION_OUTCOMES)[number];
const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/**
 * Data spec §3.5: the inputs of the Closed view's outcome line. `time_to_close_ms` is
 * booked `book_date − trigger_at`, cancelled `cancel_date − trigger_at`, otherwise
 * `closed_at − trigger_at`; null when the named instant is missing (never zero).
 */
export const attentionOutcomeDtoSchema = z
  .object({
    reason: z.enum(ATTENTION_OUTCOMES),
    origin: z.enum(["official", "crm_disposition", "owner"]),
    closed_at: date,
    time_to_close_ms: z.number().int().nonnegative().nullable(),
    calls_total: z.number().int().nonnegative().nullable(),
    booking: z.object({ id, book_date: date.nullable(), total_binder_amount: z.number().nullable(), job_no: z.string().nullable(), agent_name: z.string().nullable() }).strict().nullable(),
    cancellation: z.object({ id, cancel_date: date.nullable(), reason: z.string().nullable() }).strict().nullable(),
    priority: z.object({ code: z.string(), label: z.string() }).strict().nullable(),
    note: z.string().nullable(),
  })
  .strict();
export type AttentionOutcomeDto = z.infer<typeof attentionOutcomeDtoSchema>;
/**
 * Data spec §2.3 / §3.3 / §3.4 (S2): every desk filter reads one of these keys, frozen at publish.
 * `agents` is assigned ∪ follow-up responsible ∪ promised (V10). `priority` is the raw Granot code;
 * null is "Not set". `ti` / `ml` are the frozen score sort keys; `received_at` is `sort_keys.lead_received`.
 */
export const attentionFilterKeysDtoSchema = z
  .object({
    band: z.number().int().min(1).max(7).nullable(),
    needs_review: z.boolean(),
    state: z.enum(CSI_OUTREACH_STATES).nullable(),
    agents: z.array(id),
    attachment: z.enum(["lead", "none"]),
    // S7-PRIO (E13): `no_lead` for a record with no Lead (from S7 on; earlier snapshots wrote null).
    priority: z.string().nullable(),
    has_recording: z.boolean(),
    has_assessment: z.boolean(),
    newer_call: z.boolean(),
    ti: z.number().min(0).max(100).nullable(),
    ml: z.number().min(0).max(100).nullable(),
    received_at: date.nullable(),
    move_date: dayString.nullable(),
    outcome: z.enum(ATTENTION_OUTCOMES).nullable(),
    closed_at: date.nullable(),
    // S5c-LIVE (G3): `outreach.live_call` is set at publish; absent on snapshots published before it.
    live_call: z.boolean().optional(),
  })
  .strict();
export type AttentionFilterKeysDto = z.infer<typeof attentionFilterKeysDtoSchema>;
/**
 * Data spec §3.6 / final spec §6: the five tiles, accumulated during the publish walk and
 * stored on the snapshot header; `GET /attention` returns them as `data.metrics`.
 * `booked_7d_median_days` is whole days rounded down of the median `book_date − trigger_at`.
 */
export const attentionMetricsDtoSchema = z
  .object({
    as_of: date,
    leads_received_7d: z.number().int().nonnegative(),
    not_called_yet: z.number().int().nonnegative(),
    callbacks_overdue: z.number().int().nonnegative(),
    awaiting_assessment: z.number().int().nonnegative(),
    booked_7d: z.number().int().nonnegative(),
    booked_7d_median_days: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type AttentionMetricsDto = z.infer<typeof attentionMetricsDtoSchema>;
/**
 * S7-PRIO (addendum §5, E12–E14): chip counts per Priority key (a Granot code, `not_set` for a Lead
 * without a code, `no_lead` for a record with no Lead) and view, over the whole snapshot at its `as_of`:
 * `attention` = Needs Attention, `active` = All Outreach, `closed` = the Closed view. A chip's count
 * equals the rows that view returns for `priority=<key>` with no other filter.
 */
export const attentionPriorityCountsDtoSchema = z.record(z.string(), z.object({ attention: nonnegative, active: nonnegative, closed: nonnegative }).strict());
export type AttentionPriorityCountsDto = z.infer<typeof attentionPriorityCountsDtoSchema>;
/**
 * S1-SUGGEST (final spec §5.5 case 2): the newest analysis's suggestion for card line 6, served only when the
 * server decided case 2 holds at `as_of` (open record, no open next action, newest completed run of the Number has
 * an unapplied `next_step_suggestion`). `apply` carries what `apply_suggestion` needs: `target_id`/`run_id`,
 * `expected_revision` (run), `suggestion_output_digest`, and the Outreach fence (`outreach_id`, `outreach_expected_revision`).
 */
export const outreachSuggestedNextStepDtoSchema = z
  .object({
    run_id: id,
    action_kind: z.string(),
    action_label: z.string(),
    description: z.string(),
    date_text: z.string().nullable(),
    timezone_text: z.string().nullable(),
    apply: csiActionAvailabilitySchema
      .extend({
        action: z.literal("apply_suggestion"),
        suggestion_output_digest: z.string(),
        outreach_id: id,
        outreach_expected_revision: revision,
      })
      .strict(),
  })
  .strict();
export type OutreachSuggestedNextStepDto = z.infer<typeof outreachSuggestedNextStepDtoSchema>;
/**
 * Reconciliation addendum §3.2 (S5c-LIVE, G3): a call on the record's primary Number that telephony still
 * reports as ringing or connected (`terminal: false`, not monitoring, not Internal, not merged, started in
 * the last 4 h), computed at the response's `as_of`. Null otherwise. Independent of the Owner's manual
 * `call_progress` ("Owner calling"); the row is live when either is set. `rep` is the Vantage-side clause
 * of the Case File §4.5 (reviewed name, else the extension, else `no_extension`).
 */
export const LIVE_CALL_WINDOW_MS = 4 * 3_600_000;
export const liveCallDtoSchema = z
  .object({
    interaction_id: id,
    direction: z.string(),
    started_at: date,
    rep: z
      .object({
        kind: z.enum(["reviewed", "unreviewed", "excluded_role", "no_extension"]),
        agent_id: id.nullable(),
        name: z.string().nullable(),
        extension: z.string().nullable(),
        text: z.string(),
      })
      .strict(),
  })
  .strict();
export type LiveCallDto = z.infer<typeof liveCallDtoSchema>;
export const outreachDtoSchema = z
  .object({
    id,
    revision,
    lead_progress: leadProgressDtoSchema.nullable().optional(),
    primary_number: z.object({ id, e164: z.string() }).strict().nullable().optional(),
    lead_display: z.object({ name: z.string().nullable(), job_no: z.string().nullable(), source_company: z.string().nullable() }).strict().nullable().optional(),
    latest_number_call: z.object({ id, happened_at: date, direction: z.string(), provider_result: z.string().nullable(), contact_type: z.string() }).strict().nullable().optional(),
    lead_attachment: z.object({ attachment_id: id, lead_ref: z.object({ model: z.enum(["FormLead", "CallLead"]), id }).strict(),
      state: z.enum(["candidate", "ambiguous", "attached", "rejected"]),
      certainty: z.enum(["exact", "likely", "unsure", "owner_confirmed", "rejected"]), certainty_label: z.string(),
      decided_by: z.enum(["owner", "automatic", "evidence"]), decided_at: date.nullable(),
      confidence: z.number().min(0).max(1).nullable(), observed_at: date,
      lead_display: z.object({ name: z.string().nullable(), job_no: z.string().nullable() }).strict().nullable() }).strict().nullable().optional(),
    call_progress: z.object({ state: z.enum(["in_progress", "ended"]), started_at: date, started_by: z.string(),
      ended_at: date.nullable(), ended_by: z.string().nullable(), note: z.string().nullable() }).strict().nullable().optional(),
    // S5c-LIVE (G3): server-derived "On the call"; optional so snapshots published before it still parse.
    live_call: liveCallDtoSchema.nullable().optional(),
    // Move assessment §8.1: compact projection with read-time applicability; absent/null reads as Not assessed.
    move_assessment: outreachMoveAssessmentDtoSchema.nullable().optional(),
    // Data spec §3.3 (S1): card facts at the response's `as_of`. Optional so snapshots published
    // before S1 still parse; every row published from S1 on carries it.
    facts: outreachFactsDtoSchema.optional(),
    // S1-SUGGEST (final spec §5.5 case 2): null unless case 2 holds at `as_of`; absent on snapshots published before it.
    suggested_next_step: outreachSuggestedNextStepDtoSchema.nullable().optional(),
    subject: csiSubjectSchema,
    state: z.enum(CSI_OUTREACH_STATES),
    reason: z.string().nullable(),
    assignment: assignmentDtoSchema,
    followups: z.array(followupDtoSchema),
    followups_cursor: z.string().nullable(),
    next_action: followupDtoSchema.nullable(),
    first_human_conversation_at: date.nullable(),
    trigger_at: date.optional(),
    first_action_due_at: date.nullable().optional(),
    first_attributable_outbound_at: date.nullable().optional(),
    last_meaningful_contact_at: date.nullable(),
    // Team 4 AC3/AC5 (spec §5.4, §7.3, §9), additive; present once the flag has computed them for the record.
    last_inbound_human_at: date.nullable().optional(),
    last_attributable_outbound_at: date.nullable().optional(),
    prior_contact_at: date.nullable().optional(),
    last_activity_at: date.nullable().optional(),
    derived: derivedDtoSchema,
    related_record_links: z.array(
      z
        .object({
          model: z.enum([
            "FormLead",
            "CallLead",
            "BookedLead",
            "CancelledLead",
          ]),
          id,
          href: z.string(),
          certainty: z.enum(["exact", "likely", "unsure", "owner_confirmed"]),
        })
        .strict(),
    ),
    allowed_actions: z.array(csiActionAvailabilitySchema),
  })
  .strict();
export const attentionRowDtoSchema = z
  .object({
    subject_key: z.string().min(1),
    subject: csiSubjectSchema,
    outreach: outreachDtoSchema.nullable(),
    derived: derivedDtoSchema,
    allowed_actions: z.array(csiActionAvailabilitySchema),
    sort_keys: attentionSortKeysDtoSchema.optional(),
    // Move assessment §8: band/badge membership. `false` rows are reachable only in `view=all_outreach`;
    // rows from snapshots published before the marker existed are treated as in Attention.
    in_attention: z.boolean().optional(),
    // Data spec §2.3 (S2). All optional so snapshots published before S2 still parse.
    partition: z.enum(ATTENTION_PARTITIONS).optional(),
    filter_keys: attentionFilterKeysDtoSchema.optional(),
    outcome: attentionOutcomeDtoSchema.nullable().optional(),
  })
  .strict();
export const ownerReadSchema = <T extends z.ZodType>(data: T) =>
  z.object({ as_of: date, coverage: coverageDtoSchema, data }).strict();
export const attentionPageDtoSchema = ownerReadSchema(
  z
    .object({
      items: z.array(attentionRowDtoSchema),
      snapshot_id: z.string().nullable(),
      cursor: z.string().nullable(),
      total_items: z.number().int().nonnegative().nullable(),
      status: z.enum(["ready", "pending_projection"]).optional(),
      stale: z.boolean().optional(),
      reason_counts: z.record(z.string(), z.number().int().nonnegative()),
      // §14.1: the sort the page was produced under; absent on pre-sort servers.
      sort: z.enum(ATTENTION_SORTS).optional(),
      direction: z.enum(["asc", "desc"]).optional(),
      view: z.enum(ATTENTION_VIEWS).optional(),
      freshness: z.enum(ATTENTION_FRESHNESS).optional(),
      // Data spec §3.6 (S2, ATTENTION_V2): the header's tiles; absent when the snapshot has none.
      metrics: attentionMetricsDtoSchema.nullable().optional(),
      // S7-PRIO (addendum §5): absent on snapshots published before it and on flag-off (ATTENTION_V2) publishes.
      priority_counts: attentionPriorityCountsDtoSchema.optional(),
    })
    .strict(),
);
export const assessmentDtoSchema = z
  .object({
    run_id: id,
    instruction_id: id,
    instruction_revision: revision,
    assessment: z.enum(["agrees", "disagrees", "cannot_determine"]),
    reason: z.string(),
    finding_ids: z.array(id),
  })
  .strict();
export type CoverageDto = z.infer<typeof coverageDtoSchema>;
export type OwnerCoverageDto = z.infer<typeof ownerCoverageDtoSchema>;
export type CsiSettingsReadDto = z.infer<typeof csiSettingsReadDtoSchema>;
export type AssignmentDto = z.infer<typeof assignmentDtoSchema>;
export type DerivedDto = z.infer<typeof derivedDtoSchema>;
export type FollowupDto = z.infer<typeof followupDtoSchema>;
export type FindingDto = z.infer<typeof findingDtoSchema>;
export type OutreachDto = z.infer<typeof outreachDtoSchema>;
export type ActionAvailabilityDto = z.infer<typeof csiActionAvailabilitySchema>;
export type AttentionRowDto = z.infer<typeof attentionRowDtoSchema>;

export const reviewItemDtoSchema = z
  .object({
    id,
    revision,
    subject_key: z.string(),
    cause_kind: z.enum([
      "missing_date",
      "identity",
      "completion_target",
      "restriction",
      "official_mismatch",
      "owner_conflict",
      "closed_work_request",
      "missing_responsibility",
      "unclear_commitment",
      "disposition_reopen",
      "disposition_review",
      "prior_fulfilled_unclaimed",
      "prior_contradiction",
      "record_disputed_on_call",
    ]),
    cause_key: z.string(),
    state: z.enum(["open", "resolved", "dismissed"]),
    evidence_refs: z.array(z.string()),
    opened_at: date,
    updated_at: date,
    resolved_at: date.nullable(),
    resolution_reason: z.string().nullable(),
    allowed_actions: z.array(csiActionAvailabilitySchema),
  })
  .strict();
export const restrictionDtoSchema = z
  .object({
    id,
    revision,
    contact_number_id: id,
    channels: z.array(z.enum(["call", "text"])),
    until: date.nullable(),
    origin: z.enum(["owner", "intelligence"]),
    state: z.enum(["active", "expired", "resolved"]),
    run_id: id.nullable(),
    finding_id: id.nullable(),
    allowed_actions: z.array(csiActionAvailabilitySchema),
  })
  .strict();
export const numberDetailDtoSchema = ownerReadSchema(
  z
    .object({
      id,
      revision,
      e164: z.string().regex(/^\+[1-9]\d{6,14}$/),
      classification: z.enum([
        "unknown",
        "customer",
        "company",
        "non_customer",
      ]),
      eligibility: z.enum([
        "allowed",
        "temporarily_blocked",
        "suppressed",
        "unknown",
      ]),
      attachments: z.array(
        z
          .object({
            id,
            revision,
            lead_ref: z
              .object({ model: z.enum(["FormLead", "CallLead"]), id })
              .strict(),
            state: z.enum(["candidate", "ambiguous", "attached", "rejected"]),
            certainty: z.enum([
              "exact",
              "likely",
              "unsure",
              "owner_confirmed",
              "rejected",
            ]),
          })
          .strict(),
      ),
      outreach_records: z.array(outreachDtoSchema),
      running_analysis: z
        .object({
          text: z.string(),
          run_id: id,
          evidence_digest: z.string(),
          computed_at: date,
        })
        .strict()
        .nullable(),
      restrictions: z.array(restrictionDtoSchema),
      review_items: z.array(reviewItemDtoSchema),
      allowed_actions: z.array(csiActionAvailabilitySchema),
    })
    .strict(),
);
export const timelineEventDtoSchema = z
  .object({
    id,
    kind: z.enum([
      "interaction",
      "conversation",
      "lead_message",
      "followup",
      "owner_note",
      "assignment",
      "restriction",
      "review",
      "official_context",
      "nudge",
    ]),
    happened_at: date,
    observed_at: date,
    subject_key: z.string(),
    description: z.string(),
    evidence_refs: z.array(z.string()),
  })
  .strict();
export const evidenceSnapshotDtoSchema = z
  .object({
    id,
    run_id: id.nullable(),
    content_digest: z.string(),
    source_type: z.enum(["transcript", "vantage_record", "tool_response"]),
    source_id: z.string(),
    source_revision: z.string().nullable(),
    retrieved_at: date,
    happened_at: date.nullable(),
    complete: z.boolean(),
    next_cursor: z.string().nullable(),
    purged_at: date.nullable(),
    purge_reason: z.string().nullable(),
  })
  .strict();
export const ownerInstructionDtoSchema = z
  .object({
    id,
    revision,
    subject_key: z.string(),
    field: z.enum([
      "assignment",
      "due_at",
      "description",
      "kind",
      "status",
      "contact_type",
      "restriction",
      "assertion",
      "closure",
    ]),
    previous: z.json(),
    current: z.json(),
    state: z.enum(["active", "retracted", "satisfied"]),
    assessments: z.array(assessmentDtoSchema),
  })
  .strict();
/** Number list/detail: Lead progress of the one resolved display Lead, or an explicit multiple/none (§7). */
export const attachedLeadProgressDtoSchema = z
  .object({
    status: z.enum(["resolved", "multiple", "none"]),
    lead_ref: z.object({ model: z.enum(["FormLead", "CallLead"]), id }).strict().optional(),
    lead_progress: leadProgressDtoSchema.nullable().optional(),
    booking: z.object({ id, cancelled: z.boolean() }).strict().nullable().optional(),
    outreach_state: z.string().nullable().optional(),
    lead_display: z.object({ name: z.string().nullable(), job_no: z.string().nullable() }).strict().nullable().optional(),
    /**
     * V15 / D5: the resolved Lead's Outreach assessment (the Outreach DTO's projection, same pending
     * and `move_date_passed` handling). Only on `resolved`: a Number with two Leads never shows a score.
     */
    move_assessment: outreachMoveAssessmentDtoSchema.nullable().optional(),
    /** Final spec §9.1 line 2: the resolved Lead's official status word, from booking, cancellation and official/CRM closure. */
    lead_status: z.enum(["open", "booked", "booked_then_cancelled", "not_booked"]).nullable().optional(),
    /** Final spec §9.1 line 5: the Number's `rollups.outreach_records_total`; present on every status. */
    outreach_records_total: nonnegative.optional(),
  })
  .strict();
export type AttachedLeadProgressDto = z.infer<typeof attachedLeadProgressDtoSchema>;
export type ReviewItemDto = z.infer<typeof reviewItemDtoSchema>;
export type RestrictionDto = z.infer<typeof restrictionDtoSchema>;
export type NumberDetailDto = z.infer<typeof numberDetailDtoSchema>;
export type TimelineEventDto = z.infer<typeof timelineEventDtoSchema>;
export type EvidenceSnapshotDto = z.infer<typeof evidenceSnapshotDtoSchema>;
export type OwnerInstructionDto = z.infer<typeof ownerInstructionDtoSchema>;

/** Stored source content is redacted upstream; this mapper preserves the seed-era public section names. */
export function envelopeSummarySections(
  summary: import("../../validation/intelligence/intelligenceEnvelope.validation").IntelligenceEnvelope["summary"],
) {
  return {
    overview: summary.overview,
    customer_wanted: summary.customer_wanted,
    money_dates: summary.money_and_dates,
    outcome: summary.outcome,
    promised: summary.commitments,
    mismatch: summary.discrepancies,
  };
}
export function renderEnvelopeSummary(
  summary: import("../../validation/intelligence/intelligenceEnvelope.validation").IntelligenceEnvelope["summary"],
) {
  const sections = envelopeSummarySections(summary);
  return Object.entries(sections)
    .map(([key, text]) => `${key}:\n${text}`)
    .join("\n\n");
}
