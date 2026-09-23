/**
 * Strict Zod validator for the Call & Sales Intelligence envelope (document 10 §3).
 *
 * This module is schema validation only. It is not imported by routes, workers,
 * models, or production services in this slice.
 *
 * Layer boundary (do not collapse these):
 * - Schema validation (this module): shape, closed enums, uniqueness, bounds,
 *   and rejection of unknown operational fields on the submitted envelope.
 * - Runtime evidence authorization (not implemented here): the cited
 *   snapshot/record/follow-up ids must exist in this run's evidence manifest
 *   and be in subject scope. A schema-valid `snapshot_id` is not an authorized
 *   snapshot.
 * - Business-effect validation (not implemented here): live Outreach/follow-up
 *   revisions, allowed effects, chronology, Owner precedence, and identity
 *   checks. A schema-valid finding does not authorize an effect.
 */
import { z } from "zod";

export const CSI_ENVELOPE_SCHEMA_VERSION = "csi-envelope-v1" as const;

export const CSI_ENVELOPE_BOUNDS = {
  max_findings: 80,
  max_claim_or_description_chars: 500,
  max_date_wording_chars: 120,
  max_summary_total_chars: 4_000,
  max_evidence_refs_per_finding: 12,
  max_finding_key_chars: 120,
} as const;

const nonEmptyString = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);
const findingKey = nonEmptyString.max(
  CSI_ENVELOPE_BOUNDS.max_finding_key_chars,
);
const claimOrDescription = nonEmptyString.max(
  CSI_ENVELOPE_BOUNDS.max_claim_or_description_chars,
);
const dateWording = nonEmptyString.max(
  CSI_ENVELOPE_BOUNDS.max_date_wording_chars,
);
const nullableDateWording = dateWording.nullable();

const transcriptEvidenceSchema = z
  .object({
    source: z.literal("transcript"),
    snapshot_id: nonEmptyString,
    conversation_id: nonEmptyString,
    transcript_version: nonEmptyString,
    segment_ids: z.array(z.number().int().nonnegative()),
    quote: nonEmptyString.nullable(),
  })
  .strict();

const vantageRecordEvidenceSchema = z
  .object({
    source: z.literal("vantage_record"),
    snapshot_id: nonEmptyString,
    record_type: z.enum([
      "lead",
      "booking",
      "cancellation",
      "interaction",
      "outreach",
      "followup",
      "rep_identity",
      "owner_instruction",
      "owner_note",
      "contact_number",
      "agent",
      "granot_source",
      "ringcentral_queue",
      "ringcentral_user",
      "job_timeline",
      // Context provenance pages (spec §5.1): additive record types the findings step may cite.
      "story_event",
      "granot_state",
      "prior_summary",
      "prior_finding",
      "prior_assessment",
    ]),
    record_id: nonEmptyString,
    field_paths: z
      .array(nonEmptyString.regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/))
      .min(1)
      .max(100),
  })
  .strict();

export const intelligenceEvidenceRefSchema = z.discriminatedUnion("source", [
  transcriptEvidenceSchema,
  vantageRecordEvidenceSchema,
]);

export const intelligenceActionValueSchema = z
  .object({
    action_kind: z.enum([
      "call",
      "text_customer_via_lead_message",
      "send_estimate",
      "check_availability",
      "review",
      "wait",
      "reconcile_identity",
      "other",
    ]),
    description: claimOrDescription,
    date_text: nullableDateWording,
    timezone_text: nullableDateWording,
    target_followup_id: nonEmptyString.nullable(),
  })
  .strict();

const findingBaseShape = {
  key: findingKey,
  claim: claimOrDescription,
  basis: z.enum(["said_on_call", "vantage_record", "model_inference"]),
  actor: z.enum(["rep", "customer", "unknown"]),
  speaker_ref: nonEmptyString.nullable(),
  action_status: z
    .enum(["requested", "promised", "completed", "conditional"])
    .nullable(),
  clarity: z.enum(["clear", "uncertain"]),
  evidence: z
    .array(intelligenceEvidenceRefSchema)
    .min(1)
    .max(CSI_ENVELOPE_BOUNDS.max_evidence_refs_per_finding),
  confidence: z.number().finite().nullable(),
};

function findingObject<Kind extends z.ZodTypeAny, Value extends z.ZodTypeAny>(
  kind: Kind,
  value: Value,
) {
  return z
    .object({
      ...findingBaseShape,
      kind,
      value,
    })
    .strict();
}

const contactTypeFindingSchema = findingObject(
  z.literal("contact_type"),
  z
    .object({
      type: z.enum(["human_conversation", "voicemail", "unknown"]),
      voicemail_left_by: z.enum(["rep", "customer", "unknown"]).nullable(),
    })
    .strict(),
);

const intentFindingSchema = findingObject(
  z.literal("intent"),
  z
    .object({
      intent: z.enum([
        "moving_inquiry",
        "service_request",
        "not_sales",
        "unknown",
      ]),
    })
    .strict(),
);

const moveFactFindingSchema = findingObject(
  z.literal("move_fact"),
  z
    .object({
      field: z.enum([
        "origin",
        "destination",
        "move_date",
        "move_size",
        "other",
      ]),
      stated_value: claimOrDescription,
    })
    .strict(),
);

const quotedAmountFindingSchema = findingObject(
  z.literal("quoted_amount"),
  z
    .object({
      amount_text: nonEmptyString.max(
        CSI_ENVELOPE_BOUNDS.max_claim_or_description_chars,
      ),
      currency: nonEmptyString.nullable(),
      meaning: z.enum(["quote_total", "deposit", "competitor_quote", "other"]),
    })
    .strict(),
);

const ACTION_FINDING_KINDS = [
  "promised_callback",
  "customer_requested_callback",
  "customer_will_call",
  "next_step",
  "completion_claim",
  "reschedule",
] as const;

const actionFindingSchemas = ACTION_FINDING_KINDS.map((kind) =>
  findingObject(z.literal(kind), intelligenceActionValueSchema),
);

const contactRestrictionFindingSchema = findingObject(
  z.literal("contact_restriction"),
  z
    .object({
      channels: z
        .array(z.enum(["call", "text"]))
        .min(1)
        .max(2)
        .refine((v) => v.length === new Set(v).size),
      restriction: z.enum(["until", "ongoing", "unclear"]),
      until_text: nullableDateWording,
    })
    .strict(),
);

const DESCRIPTION_FINDING_KINDS = [
  "booking_claim",
  "payment_claim",
  "objection",
  "competitor_mention",
  "coaching_note",
] as const;

const descriptionFindingSchemas = DESCRIPTION_FINDING_KINDS.map((kind) =>
  findingObject(
    z.literal(kind),
    z.object({ description: claimOrDescription }).strict(),
  ),
);

export const intelligenceFindingSchema = z.discriminatedUnion("kind", [
  contactTypeFindingSchema,
  intentFindingSchema,
  moveFactFindingSchema,
  quotedAmountFindingSchema,
  ...actionFindingSchemas,
  contactRestrictionFindingSchema,
  ...descriptionFindingSchemas,
]);

const summarySchema = z
  .object({
    overview: z.string(),
    customer_wanted: z.string(),
    money_and_dates: z.string(),
    outcome: z.string(),
    commitments: z.string(),
    discrepancies: z.string(),
    finding_keys: z.array(findingKey),
  })
  .strict();

const nextStepSuggestionSchema = intelligenceActionValueSchema
  .extend({
    rationale: claimOrDescription,
    finding_keys: z.array(findingKey),
  })
  .strict();

const ownerInstructionAssessmentSchema = z
  .object({
    instruction_id: nonEmptyString,
    instruction_revision: z.number().int().nonnegative(),
    assessment: z.enum(["agrees", "disagrees", "cannot_determine"]),
    reason: claimOrDescription,
    finding_keys: z.array(findingKey),
  })
  .strict();

export const PRIOR_FINDING_RELATIONS = [
  "still_true",
  "superseded",
  "fulfilled",
  "contradicted",
  "cannot_determine",
] as const;
export type PriorFindingRelation = (typeof PRIOR_FINDING_RELATIONS)[number];

/**
 * Context provenance (spec §6.2, additive): how this run relates to each earlier finding it was
 * shown, and where a call contradicts the server-assembled story. Both are optional so every
 * envelope accepted before r3 stays valid; the server applies them (supersede, review items).
 */
const priorFindingRelationSchema = z
  .object({
    prior_finding_id: nonEmptyString,
    relation: z.enum(PRIOR_FINDING_RELATIONS),
    by_finding_key: findingKey.nullable(),
    evidence: z
      .array(intelligenceEvidenceRefSchema)
      .max(CSI_ENVELOPE_BOUNDS.max_evidence_refs_per_finding),
    note: claimOrDescription.nullable(),
  })
  .strict();

const storyDiscrepancySchema = z
  .object({
    story_event_id: nonEmptyString,
    claim: claimOrDescription,
    evidence: z
      .array(intelligenceEvidenceRefSchema)
      .min(1)
      .max(CSI_ENVELOPE_BOUNDS.max_evidence_refs_per_finding),
  })
  .strict();

export const intelligenceEnvelopeSchema = z
  .object({
    schema_version: z.literal(CSI_ENVELOPE_SCHEMA_VERSION),
    summary: summarySchema,
    findings: z
      .array(intelligenceFindingSchema)
      .max(CSI_ENVELOPE_BOUNDS.max_findings),
    next_step_suggestion: nextStepSuggestionSchema.nullable(),
    owner_instruction_assessments: z.array(ownerInstructionAssessmentSchema),
    prior_finding_relations: z.array(priorFindingRelationSchema).max(60).optional(),
    story_discrepancies: z.array(storyDiscrepancySchema).max(20).optional(),
  })
  .strict()
  .superRefine((envelope, context) => {
    const relationKeys = new Set(envelope.findings.map((finding) => finding.key));
    (envelope.prior_finding_relations ?? []).forEach((relation, index) => {
      if (relation.by_finding_key !== null && !relationKeys.has(relation.by_finding_key))
        context.addIssue({
          code: "custom",
          path: ["prior_finding_relations", index, "by_finding_key"],
          message: "by_finding_key does not match a finding in this envelope",
        });
      if (relation.relation !== "cannot_determine" && relation.evidence.length === 0)
        context.addIssue({
          code: "custom",
          path: ["prior_finding_relations", index, "evidence"],
          message: "a determined relation cites at least one piece of evidence",
        });
    });
    const relationIds = (envelope.prior_finding_relations ?? []).map((relation) => relation.prior_finding_id);
    if (relationIds.length !== new Set(relationIds).size)
      context.addIssue({
        code: "custom",
        path: ["prior_finding_relations"],
        message: "one relation per prior finding",
      });
    const summaryChars =
      envelope.summary.overview.length +
      envelope.summary.customer_wanted.length +
      envelope.summary.money_and_dates.length +
      envelope.summary.outcome.length +
      envelope.summary.commitments.length +
      envelope.summary.discrepancies.length;
    if (summaryChars > CSI_ENVELOPE_BOUNDS.max_summary_total_chars) {
      context.addIssue({
        code: "custom",
        path: ["summary"],
        message: `summary text totals ${summaryChars} characters; max is ${CSI_ENVELOPE_BOUNDS.max_summary_total_chars}`,
      });
    }

    const assessments = envelope.owner_instruction_assessments.map(
      (v) => `${v.instruction_id}:${v.instruction_revision}`,
    );
    if (assessments.length !== new Set(assessments).size)
      context.addIssue({
        code: "custom",
        path: ["owner_instruction_assessments"],
        message: "Duplicate instruction assessment",
      });
    const seenKeys = new Set<string>();
    const duplicateKeys = new Set<string>();
    for (const finding of envelope.findings) {
      if (seenKeys.has(finding.key)) {
        duplicateKeys.add(finding.key);
      }
      seenKeys.add(finding.key);
    }
    if (duplicateKeys.size > 0) {
      context.addIssue({
        code: "custom",
        path: ["findings"],
        message: `finding keys must be unique within the run: ${[...duplicateKeys].join(", ")}`,
      });
    }

    const referencedKeyGroups: Array<{
      path: Array<string | number>;
      keys: string[];
    }> = [
      {
        path: ["summary", "finding_keys"],
        keys: envelope.summary.finding_keys,
      },
      {
        path: ["next_step_suggestion", "finding_keys"],
        keys: envelope.next_step_suggestion?.finding_keys ?? [],
      },
      ...envelope.owner_instruction_assessments.map((assessment, index) => ({
        path: ["owner_instruction_assessments", index, "finding_keys"] as Array<
          string | number
        >,
        keys: assessment.finding_keys,
      })),
    ];

    for (const group of referencedKeyGroups) {
      for (const [index, key] of group.keys.entries()) {
        if (!seenKeys.has(key)) {
          context.addIssue({
            code: "custom",
            path: [...group.path, index],
            message: `finding_keys entry "${key}" does not match a finding in this envelope`,
          });
        }
      }
    }
  });

export type IntelligenceEvidenceRef = z.infer<
  typeof intelligenceEvidenceRefSchema
>;
export type IntelligenceActionValue = z.infer<
  typeof intelligenceActionValueSchema
>;
export type IntelligenceFinding = z.infer<typeof intelligenceFindingSchema>;
export type IntelligenceEnvelope = z.infer<typeof intelligenceEnvelopeSchema>;

export function parseIntelligenceEnvelope(
  input: unknown,
): IntelligenceEnvelope {
  return intelligenceEnvelopeSchema.parse(input);
}

export function safeParseIntelligenceEnvelope(input: unknown) {
  return intelligenceEnvelopeSchema.safeParse(input);
}
