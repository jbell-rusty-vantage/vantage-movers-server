import { z } from "zod";
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
    subject: csiSubjectSchema,
    state: z.enum(CSI_OUTREACH_STATES),
    reason: z.string().nullable(),
    assignment: assignmentDtoSchema,
    followups: z.array(followupDtoSchema),
    followups_cursor: z.string().nullable(),
    next_action: followupDtoSchema.nullable(),
    first_human_conversation_at: date.nullable(),
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
      snapshot_id: z.string(),
      cursor: z.string().nullable(),
      total_items: z.number().int().nonnegative(),
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
