import { Types, type ClientSession } from "mongoose";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getIntelligenceEffectModel } from "../../../models/IntelligenceEffect";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import type { IntelligenceEnvelope } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { openReview } from "../review/items";
import type { CsiTransactionContext } from "../transactions";

type RunRow = { _id: Types.ObjectId; subject_key: string; contact_number_id?: Types.ObjectId | null };
type FindingRow = { _id: Types.ObjectId; key: string };
type EffectStatus = "applied" | "no_change" | "blocked_owner" | "needs_review";

/**
 * Context provenance §6.3: the server-side connections between this run's output and the
 * earlier findings it was shown. Nothing here overrides the Owner or closes work by itself:
 * a superseded finding is linked, not retracted; a fulfilled promise whose follow-up is still
 * open, a contradiction, or a disputed record become review items the Owner decides.
 */
export async function applyPriorRelations(run: RunRow, envelope: IntelligenceEnvelope, findings: readonly FindingRow[],
  context: CsiTransactionContext, session: ClientSession) {
  const Findings = getIntelligenceFindingModel(), Effects = getIntelligenceEffectModel();
  const byKey = new Map(findings.map(f => [f.key, f]));
  for (const relation of envelope.prior_finding_relations ?? []) {
    const prior = await Findings.findOne({ _id: relation.prior_finding_id, contact_number_id: run.contact_number_id ?? null, purged_at: null }).session(session);
    if (!prior) continue; // Citation membership already held at submission; a purge since then is not an error.
    const newer = relation.by_finding_key ? byKey.get(relation.by_finding_key) ?? null : null;
    const effect = async (effect_kind: "supersede" | "open_review", target_key: string, target_id: Types.ObjectId, status: EffectStatus, reason: string,
      previous: Record<string, unknown> = {}, current: Record<string, unknown> = {}) => {
      if (!newer) return; // An effect row names the finding it came from; a relation without one is stored on the run output only.
      await Effects.create([{ run_id: run._id, finding_id: newer._id, finding_key: newer.key, effect_kind, target_key, target_id,
        status, reason, previous, current, applied_at: context.now }], { session });
    };
    if (relation.relation === "superseded" && newer) {
      if (prior.review_state !== "unreviewed") { await effect("supersede", `finding:${prior._id}`, prior._id, "blocked_owner", `review_state_${prior.review_state}`); continue; }
      if (prior.superseded_by) { await effect("supersede", `finding:${prior._id}`, prior._id, "no_change", "already_superseded"); continue; }
      await Findings.updateOne({ _id: prior._id, superseded_by: null }, { $set: { superseded_by: newer._id }, $inc: { revision: 1 } }, { session });
      await effect("supersede", `finding:${prior._id}`, prior._id, "applied", "superseded_by_later_finding", { superseded_by: null }, { superseded_by: String(newer._id) });
    } else if (relation.relation === "fulfilled") {
      const created = await Effects.find({ finding_id: prior._id, effect_kind: "create_followup", status: "applied", target_id: { $ne: null } }).session(session).lean();
      const targets = created.flatMap(e => e.target_id ? [e.target_id] : []);
      const open = targets.length ? await getOutreachFollowupModel().find({ _id: { $in: targets }, status: "open" }).select("_id").session(session).lean() : [];
      const claimed = envelope.findings.some(f => f.kind === "completion_claim" && open.some(o => f.value.target_followup_id === String(o._id)));
      if (open.length && !claimed) {
        const review = await openReview(context, run.subject_key, "prior_fulfilled_unclaimed", String(prior._id), [String(prior._id), ...(newer ? [String(newer._id)] : [])]);
        await effect("open_review", `review:${review._id}`, review._id, "needs_review", "prior_fulfilled_followup_open");
      }
    } else if (relation.relation === "contradicted") {
      const review = await openReview(context, run.subject_key, "prior_contradiction", String(prior._id), [String(prior._id), ...(newer ? [String(newer._id)] : [])]);
      await effect("open_review", `review:${review._id}`, review._id, "needs_review", "prior_finding_contradicted");
    }
  }
  for (const discrepancy of envelope.story_discrepancies ?? []) {
    // A customer disputing a text Vantage sent or a callback Vantage recorded is a record question for the Owner.
    if (!/^(lead_message_sent|followup_completed):/.test(discrepancy.story_event_id)) continue;
    await openReview(context, run.subject_key, "record_disputed_on_call", discrepancy.story_event_id, findings.map(f => String(f._id)).slice(0, 5));
  }
}
