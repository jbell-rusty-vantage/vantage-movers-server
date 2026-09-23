// Verbatim copy of the production Admin's Attention consumer schema: vantage-admin@539a628 lib/api/salesIntelligence.ts
// (lines 1-4, 34-59, 67-70, 93-106, 124-131). Test fixture only: proves an S2 flag-off GET /attention still parses
// in the Admin that is live today. Do not edit to make a test pass; re-copy when the Admin changes.
import { z } from 'zod';
// Consumer schemas mirror current server dto.ts/numberActivity DTOs. No domain derivation.
const agent = z.object({ id: z.string(), name: z.string() });
export const availabilitySchema=z.object({action:z.string(),enabled:z.boolean(),blocker_codes:z.array(z.string()),target_id:z.string(),expected_revision:z.number()});
const assignment = z.object({ agent: agent.nullable(), origin: z.string().nullable() });
// call_state and provenance_state are server words, not Admin derivations, and stay z.string() so a
// server that grows a value still renders. Unmodelled keys are stripped, so every read field is here.
const derived = z.object({ overdue: z.boolean(), attention_band: z.number().nullable(), reasons: z.array(z.string()),
  review_badges: z.array(z.string()).optional(), call_blockers: z.array(z.string()), age_wall_ms: z.number(), age_staffed_ms: z.number(),
  call_state: z.string().optional(), provenance_state: z.string().optional() });
const subject = z.discriminatedUnion('kind', [z.object({ kind: z.literal('number_review'), contact_number_id: z.string() }),
  z.object({ kind: z.literal('lead'), model: z.enum(['FormLead','CallLead']), id: z.string() })]);
const followup = z.object({ id: z.string(), revision:z.number(), allowed_actions:z.array(availabilitySchema),kind: z.string(), description: z.string(), status: z.string(), due_at: z.string().nullable(),
  disposition:z.string().nullable().optional(),completion_basis:z.string().nullable().optional(),
  snoozed_until: z.string().nullable(), overdue: z.boolean(), origin: z.string(), assignment, promised_by: agent.nullable(), paused_channels: z.array(z.string()) });
// LP-01 §7: server-owned Lead progress. Every label is a server word; Admin never derives Quoted from
// Priority or policy from a code. Optional so a server without it still renders.
export const leadProgressSchema = z.object({ lead_ref: z.object({ model: z.enum(['FormLead','CallLead']), id: z.string() }),
  granot_priority: z.string().nullable(), priority_label: z.string(), quoted: z.boolean().nullable(),
  disposition: z.string(), disposition_label: z.string(), work_observed: z.boolean(), basis: z.string().nullable(), basis_label: z.string().nullable(),
  provenance: z.string(), source_origin: z.string().nullable(), source_applied_at: z.string().nullable(), last_progress_at: z.string().nullable(),
  first_work_observed_at: z.string().nullable(), closure: z.object({ basis: z.string(), closed_at: z.string().nullable() }).nullable(),
  override: z.object({ reason: z.string(), decided_at: z.string(), decided_by: z.string(), disposition_revision: z.string() }).nullable(),
  reopen_review_id: z.string().nullable(), disposition_revision: z.string(), explanation: z.string().nullable(), no_call_observed: z.boolean(), projected_at: z.string() });
export type LeadProgress = z.infer<typeof leadProgressSchema>;
// §14.1 ordering keys frozen into each Attention row; Admin renders server order and never sorts a page locally.
// Move assessment §8: score keys are optional so snapshots published before the contract still parse (missing reads as unknown).
export const sortKeysSchema = z.object({ next_action_due: z.string().nullable(), lead_received: z.string().nullable(), last_human_contact: z.string().nullable(), last_lead_progress: z.string().nullable(),
  transaction_intent: z.number().nullable().optional(), move_likelihood: z.number().nullable().optional(),
  assessment_status: z.string().nullable().optional(), assessment_stale: z.boolean().nullable().optional() });
export const moveAssessmentSchema = z.object({ artifact_id: z.string().nullable(), status: z.string(), applicability: z.string(),
  transaction_intent: z.number().nullable(), move_likelihood: z.number().nullable(),
  transaction_intent_confidence: z.string().nullable(), move_likelihood_confidence: z.string().nullable(),
  context_as_of: z.string().nullable(), latest_conversation_at: z.string().nullable(), stale: z.boolean(), stale_reason: z.string().nullable(), published_at: z.string().nullable() });
export const outreachSchema = z.object({ id: z.string(), revision: z.number(), subject, state: z.string(), reason: z.string().nullable(),
  allowed_actions:z.array(availabilitySchema),
  lead_progress: leadProgressSchema.nullable().optional(),
  lead_display:z.object({name:z.string().nullable(),job_no:z.string().nullable(),source_company:z.string().nullable()}).nullable().optional(),
  latest_number_call:z.object({id:z.string(),happened_at:z.string(),direction:z.string(),provider_result:z.string().nullable(),contact_type:z.string()}).nullable().optional(),
  related_record_links:z.array(z.object({model:z.enum(['FormLead','CallLead','BookedLead','CancelledLead']),id:z.string(),href:z.string(),certainty:z.string()})).optional(),
  lead_attachment:z.object({attachment_id:z.string(),lead_ref:z.object({model:z.enum(['FormLead','CallLead']),id:z.string()}),state:z.string(),certainty:z.string(),
   certainty_label:z.string().nullable(),decided_by:z.string(),decided_at:z.string().nullable(),confidence:z.number().nullable(),observed_at:z.string(),
   lead_display:z.object({name:z.string().nullable(),job_no:z.string().nullable()}).nullable()}).nullable().optional(),
  call_progress:z.object({state:z.string(),started_at:z.string(),started_by:z.string().nullable(),ended_at:z.string().nullable(),ended_by:z.string().nullable(),note:z.string().nullable()}).nullable().optional(),
  move_assessment: moveAssessmentSchema.nullable().optional(),
  primary_number: z.object({ id: z.string(), e164: z.string() }).nullable().optional(), assignment, followups: z.array(followup), derived,
  last_meaningful_contact_at: z.string().nullable() });
const coverage = z.object({ known_through: z.string().nullable(), gaps: z.array(z.object({ from:z.string(), to:z.string(), reason:z.string() })), ai_paused:z.boolean() });
export const attentionSchema = z.object({ as_of: z.string(), coverage, data: z.object({ items: z.array(z.object({ subject_key:z.string(), subject,
  outreach: outreachSchema.nullable(), derived, sort_keys: sortKeysSchema.optional(),
  // Move assessment §8: `false` rows are reachable only in `view=all_outreach`; absent reads as in Attention.
  in_attention: z.boolean().optional() })), snapshot_id: z.string().nullable(), total_items:z.number().nullable(), cursor:z.string().nullable(), reason_counts:z.record(z.string(), z.number()).optional(),
  // Optional on the server DTO, so requiring it here would fail the whole Attention read on a page the server still publishes.
  status:z.enum(['ready','pending_projection']).optional(), stale:z.boolean().optional(),
  // §14.1: the sort the server produced this page under. Absent means the server has no sort contract; the UI shows "unavailable" rather than sorting locally.
  sort:z.string().optional(), direction:z.enum(['asc','desc']).optional(), view:z.string().optional(), freshness:z.string().optional() }) });
