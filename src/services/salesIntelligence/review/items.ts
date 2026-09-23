import { getSalesIntelligenceReviewItemModel } from "../../../models/SalesIntelligenceReviewItem";
import { Types } from "mongoose";
import { appendCsiAudit, type CsiTransactionContext } from "../transactions";
export type ReviewCause = "missing_date" | "identity" | "completion_target" | "restriction" | "official_mismatch" | "owner_conflict" | "closed_work_request" | "missing_responsibility" | "unclear_commitment" | "disposition_reopen" | "disposition_review" | "prior_fulfilled_unclaimed" | "prior_contradiction" | "record_disputed_on_call";
export async function openReview(context: CsiTransactionContext, subject_key: string, cause_kind: ReviewCause, cause_key: string, evidence_ids: string[] = []) {
  const Model = getSalesIntelligenceReviewItemModel();
  let row = await Model.findOne({ subject_key, cause_kind, cause_key }).session(context.session);
  const fresh = evidence_ids.filter(id => !row?.evidence_ids.some(e => String(e) === id));
  if (row && !fresh.length) return row;
  const prior: import("../outreach/store").JsonValue = row ? { state: row.state, revision: row.revision } : {};
  if (!row) row = new Model({ subject_key, cause_kind, cause_key, opened_at: context.now, evidence_ids });
  else { row.evidence_ids.push(...fresh.map(id => new Types.ObjectId(id))); row.state = "open"; row.resolved_at = null; row.revision++; }
  await row.save({ session: context.session });
  await appendCsiAudit(context, { kind: "review", target_id: String(row._id), subject_key, revision: row.revision, event_kind: "review_opened", prior, current: { cause_kind, cause_key, state: row.state } });
  return row;
}
