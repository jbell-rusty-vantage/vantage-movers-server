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
export const outreachDtoSchema = z
  .object({
    id,
    revision,
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
