import { z } from "zod";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { csiIdSchema, csiActionAvailabilitySchema } from "../../../validation/v1/salesIntelligence";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { certaintyLabel } from "./suggest";
import type { StoredAttachment } from "./store";

const date = z.iso.datetime().nullable();
const text = z.string().nullable();
export const attachmentDtoSchema = z.object({
  id: csiIdSchema, revision: z.number().int().positive(), contact_number_id: csiIdSchema,
  lead_ref: z.object({ model: z.enum(["FormLead", "CallLead"]), id: csiIdSchema }).strict(),
  state: z.enum(["candidate", "ambiguous", "attached", "rejected"]),
  certainty: z.enum(["exact", "likely", "unsure", "owner_confirmed", "rejected"]),
  certainty_label: z.enum(["Exact", "Likely", "Unsure", "Confirmed by you"]).nullable(),
  evidence: z.array(z.object({ source: z.string(), field_path: z.string(), observed_at: z.iso.datetime(),
    window_from: date, window_to: date, interaction_id: csiIdSchema.nullable() }).strict()),
  lead_snapshot: z.object({ name: text, job_no: text, source_label: text, lead_timestamp: date, booked: z.boolean(),
    cancelled: z.boolean(), duplicate: z.boolean(), bad_lead: z.boolean(), receiver_agent_name: text, refreshed_at: date }).strict().nullable(),
  decided_at: date, decided_by: text, decision_reason: text,
  history: z.array(z.object({ from: text, to: text, at: date, by: text, reason: text }).strict()),
  allowed_actions: z.array(csiActionAvailabilitySchema).optional(),
}).strict();

export const attachmentListQuerySchema = z.object({
  scope: z.literal("production").optional(), contact_number_id: csiIdSchema.optional(),
  lead_model: z.enum(["FormLead", "CallLead"]).optional(), lead_id: csiIdSchema.optional(),
  cursor: csiIdSchema.optional(), limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict().refine(q => Boolean(q.contact_number_id || (q.lead_model && q.lead_id)), "Number or Lead required")
  .refine(q => Boolean(q.lead_model) === Boolean(q.lead_id), "Lead model and id required together");
export function toAttachmentDto(row: StoredAttachment) {
  return attachmentDtoSchema.parse({ id: String(row._id), revision: row.revision, contact_number_id: String(row.contact_number_id),
    allowed_actions: (["attach_lead", "reject_attachment", "detach_attachment"] as const).map(action => ({ action, target_id: String(row._id), expected_revision: row.revision,
      enabled: csiFlag("ENABLED") && csiFlag("ATTACHMENT_REFRESH") && (action !== "detach_attachment" || row.state === "attached"),
      blocker_codes: !csiFlag("ENABLED") || !csiFlag("ATTACHMENT_REFRESH") ? ["FEATURE_DISABLED"] : [] })),
    lead_ref: { model: row.lead_ref.model, id: String(row.lead_ref.id) }, state: row.state, certainty: row.certainty,
    certainty_label: row.state === "rejected" ? null : certaintyLabel(row.certainty),
    evidence: row.evidence.map(e => ({ source: e.source, field_path: e.field_path, observed_at: e.observed_at.toISOString(),
      window_from: e.window_from?.toISOString() ?? null, window_to: e.window_to?.toISOString() ?? null,
      interaction_id: e.interaction_id ? String(e.interaction_id) : null })),
    lead_snapshot: row.lead_snapshot ? { ...row.lead_snapshot, lead_timestamp: row.lead_snapshot.lead_timestamp?.toISOString() ?? null,
      refreshed_at: row.lead_snapshot.refreshed_at?.toISOString() ?? null } : null,
    decided_at: row.decided_at?.toISOString() ?? null, decided_by: row.decided_by ?? null, decision_reason: row.decision_reason ?? null,
    history: row.history.map(h => ({ from: h.from ?? null, to: h.to ?? null, at: h.at?.toISOString() ?? null, by: h.by ?? null, reason: h.reason ?? null })),
  });
}
export type AttachmentDto = ReturnType<typeof toAttachmentDto>;
/** Read-only; pagination is a stable pair-row _id cursor, never a refresh trigger. */
export async function listAttachments(input: z.input<typeof attachmentListQuerySchema>) {
  const q = attachmentListQuerySchema.parse(input);
  const rows = await getNumberLeadAttachmentModel().find({
    ...(q.contact_number_id ? { contact_number_id: q.contact_number_id } : {}),
    ...(q.lead_id ? { "lead_ref.model": q.lead_model, "lead_ref.id": q.lead_id } : {}),
    ...(q.cursor ? { _id: { $gt: q.cursor } } : {}),
  }).sort({ _id: 1 }).limit(q.limit + 1).lean();
  return { items: rows.slice(0, q.limit).map(toAttachmentDto), next_cursor: rows.length > q.limit ? String(rows[q.limit - 1]!._id) : null };
}
