import { Types } from "mongoose";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { subjectKey } from "./types";
import { numberTimelineEventDtoSchema } from "../../numberActivity/dto";
import type { TimelineSource } from "../../numberActivity/timeline";

/** Edge and record lookups are bounded (D5): the same caps the story subject resolution uses. */
const SUBJECT_LOOKUP_CAP = 100;

/**
 * Append-only CSI history joins the existing Number Activity keyset merge. No note/call sends.
 * This is the v1 (flag-off) source; the v2 timeline reads the audit stream through the story
 * reader with the subject resolved once (`outreach/timelineRead.ts`).
 */
export const outreachTimelineSource: TimelineSource = async ({ number_id, cursor, limit }) => {
  const [edges, records] = await Promise.all([
    getNumberLeadAttachmentModel().find({ contact_number_id: number_id }).select("lead_ref").sort({ _id: -1 }).limit(SUBJECT_LOOKUP_CAP).lean(),
    getOutreachRecordModel().find({ primary_contact_number_id: number_id }).select("subject").sort({ _id: -1 }).limit(SUBJECT_LOOKUP_CAP).lean(),
  ]);
  const keys = [`number:${number_id}`, ...edges.map(e => `lead:${e.lead_ref.model}:${e.lead_ref.id}`), ...records.map(r => subjectKey(r.subject))];
  const rows = await getSalesIntelligenceAuditEventModel().aggregate([
    { $match: { subject_key: { $in: keys }, "invalidation.kind": { $in: ["outreach", "followup", "review", "restriction", "nudge"] }, event_kind: { $nin: ["clock_boundary", "outreach_interaction", "outreach_number_linked"] } } },
    { $addFields: { timeline_kind: { $switch: { branches: [
      { case: { $eq: ["$event_kind", "add_note"] }, then: "owner_note" },
      { case: { $eq: ["$event_kind", "assign"] }, then: "assignment" },
      { case: { $eq: ["$invalidation.kind", "restriction"] }, then: "restriction" },
      { case: { $eq: ["$invalidation.kind", "review"] }, then: "review" },
      { case: { $eq: ["$invalidation.kind", "nudge"] }, then: "nudge" },
    ], default: "followup" } } } },
    ...(cursor ? [{ $match: { $or: [{ happened_at: { $lt: new Date(cursor.happened_at) } },
      { happened_at: new Date(cursor.happened_at), timeline_kind: { $gt: cursor.kind } },
      { happened_at: new Date(cursor.happened_at), timeline_kind: cursor.kind, _id: { $lt: new Types.ObjectId(cursor.id) } }] } }] : []),
    { $sort: { happened_at: -1, timeline_kind: 1, _id: -1 } }, { $limit: limit },
  ]);
  return rows.map(row => numberTimelineEventDtoSchema.parse({ id: String(row._id), kind: row.timeline_kind, happened_at: row.happened_at.toISOString(), observed_at: row.recorded_at.toISOString(),
    subject_key: row.subject_key, description: row.event_kind === "add_note" ? "Owner added context" : String(row.event_kind).replace(/_/g, " "),
    evidence_refs: [String(row.invalidation.target_id)], detail: { event_kind: row.event_kind, prior: row.prior, current: row.current, actor: row.actor.id } }));
};
