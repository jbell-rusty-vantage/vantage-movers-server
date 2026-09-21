import mongoose, { type ClientSession, type InferSchemaType } from "mongoose";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getNumberLeadAttachmentModel, NumberLeadAttachmentSchema, NUMBER_LEAD_ATTACHMENT_INDEXES } from "../../../models/NumberLeadAttachment";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { boundSearchTerms } from "../../numberActivity/searchTerms";
import { CsiError, csiWorkerActor } from "../auth";
import { appendCsiAudit, assertIndexes, payloadHash, type CsiTransactionContext } from "../transactions";
import { ambiguityFanIn, autoAttachConfidence, exactSource, suggest, AUTO_ATTACH_REASON, type Attachment, type Evidence, type LeadRef } from "./suggest";
import { exactEvidence, phoneEvidence, leadSnapshot, type LeadSource } from "./sources";
import { onAttachmentChanged } from "./hooks";

export type StoredAttachment = InferSchemaType<typeof NumberLeadAttachmentSchema> & { _id: mongoose.Types.ObjectId };
export function attachmentPolicyInput(row: StoredAttachment): Attachment {
  return { lead_ref: { model: row.lead_ref.model, id: String(row.lead_ref.id) }, state: row.state,
    certainty: row.certainty, decided_at: row.decided_at, evidence: row.evidence.map(e => ({ source: e.source,
      field_path: e.field_path, observed_at: e.observed_at, window_from: e.window_from ?? null, window_to: e.window_to ?? null,
      identity_kind: e.identity_kind, identity_value: e.identity_value, provider_account_id: e.provider_account_id,
      interaction_id: e.interaction_id ? String(e.interaction_id) : null })) };
}
/** Serialize fan-in across DIFFERENT pairs too, preventing Mongo snapshot write skew. */
export async function lockNumber(numberId: string, session: ClientSession) {
  const number = await getContactNumberModel().findOneAndUpdate({ _id: numberId }, { $inc: { revision: 1 } },
    { session, returnDocument: "before" });
  if (!number) throw new CsiError("INVALID_INPUT");
  return { revision: number.revision + 1, prior_revision: number.revision, prior_updated_at: number.updatedAt };
}
async function unchangedNumber(numberId: string, lock: Awaited<ReturnType<typeof lockNumber>>, session: ClientSession) {
  await getContactNumberModel().updateOne({ _id: numberId }, { $set: { revision: lock.prior_revision, updatedAt: lock.prior_updated_at } }, { session, timestamps: false });
}
export async function rebuildAttachmentSearchTerms(numberId: string, session: ClientSession) {
  const number = await getContactNumberModel().findById(numberId).session(session).orFail();
  const edges = await getNumberLeadAttachmentModel().find({ contact_number_id: numberId }).session(session).lean();
  const terms = new Set(number.provider_names.map(n => n.toLowerCase()));
  for (const edge of edges.filter(e => e.state !== "rejected")) {
    for (const value of [edge.lead_snapshot?.name, edge.lead_snapshot?.job_no, edge.lead_snapshot?.receiver_agent_name]) {
      if (value?.trim()) terms.add(value.trim().toLowerCase());
    }
  }
  await getContactNumberModel().updateOne({ _id: numberId }, { $set: { search_terms: boundSearchTerms(terms),
    "rollups.attached_lead_count": edges.filter(e => e.state === "attached").length,
    "rollups.candidate_lead_count": edges.filter(e => ["candidate", "ambiguous"].includes(e.state)).length } }, { session });
}
export async function fanInNumber(numberId: string, session: ClientSession, now: Date) {
  const Model = getNumberLeadAttachmentModel();
  const rows = await Model.find({ contact_number_id: numberId }).session(session).lean();
  const next = ambiguityFanIn(rows.map(attachmentPolicyInput));
  let changed = false;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!, proposed = next[i]!;
    if (row.state === proposed.state) continue;
    const result = await Model.updateOne({ _id: row._id, revision: row.revision, decided_at: null }, {
      $set: { state: proposed.state, certainty: proposed.certainty }, $inc: { revision: 1 },
      $push: { history: { from: row.state, to: proposed.state, at: now, by: "system", reason: "attachment_ambiguity_fan_in" } },
    }, { session, runValidators: true });
    if (result.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
    changed = true;
  }
  return changed;
}
/**
 * Flag-gated automatic promotion of an unambiguous phone-evidence edge (CSI `AUTO_ATTACH`).
 *
 * Evaluated over one loaded snapshot of the number's edges, so the outcome does not depend on
 * row order. The Owner stays authoritative: a rejected or `decided_at` pair is never promoted,
 * exact-source edges keep their own Exact result, and `reject_attachment`/`detach_attachment`
 * remain the reversal. The caller folds `changed` into the same committed change contract, so
 * the Outreach mirror, the search-term rebuild and the live stream all see this decision.
 */
export async function autoAttachNumber(numberId: string, context: CsiTransactionContext) {
  if (!csiFlag("AUTO_ATTACH")) return 0;
  const Model = getNumberLeadAttachmentModel();
  const rows = await Model.find({ contact_number_id: numberId }).session(context.session).lean();
  const edges = rows.map(attachmentPolicyInput);
  let changed = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!, edge = edges[i]!;
    if (row.state === "attached" || row.state === "rejected" || row.decided_at) continue;
    if (edge.evidence.some(e => exactSource(e.source))) continue;
    const confidence = autoAttachConfidence(edge, edges);
    if (confidence === null) continue;
    const result = await Model.updateOne({ _id: row._id, revision: row.revision, decided_at: null, state: { $nin: ["attached", "rejected"] } }, {
      $set: { state: "attached", certainty: "likely", decision_reason: AUTO_ATTACH_REASON,
        auto_decision: { confidence, reason: AUTO_ATTACH_REASON, decided_at: context.now } }, $inc: { revision: 1 },
      $push: { history: { from: row.state, to: "attached", at: context.now, by: "system", reason: AUTO_ATTACH_REASON } },
    }, { session: context.session, runValidators: true });
    if (result.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
    await appendCsiAudit(context, { kind: "number", target_id: String(row._id), subject_key: `number:${numberId}`, revision: row.revision + 1,
      event_kind: "attachment_auto_attached", prior: { state: row.state, certainty: row.certainty },
      current: { attachment_id: String(row._id), lead_model: row.lead_ref.model, lead_id: String(row.lead_ref.id),
        state: "attached", certainty: "likely", confidence, reason: AUTO_ATTACH_REASON } });
    changed++;
  }
  return changed;
}
export async function persistLeadAttachments(lead: LeadSource, model: LeadRef["model"], session: ClientSession,
  requestId: string, now = new Date(), onlyNumber?: string) {
  const Model = getNumberLeadAttachmentModel();
  await assertIndexes(Model.collection, NUMBER_LEAD_ATTACHMENT_INDEXES);
  const ref: LeadRef = { model, id: String(lead._id) };
  const pairs = new Map<string, Evidence[]>();
  for (const item of phoneEvidence(lead, model)) {
    const number = await getContactNumberModel().findOne({ e164: item.e164, ...(onlyNumber ? { _id: onlyNumber } : {}) }).session(session).lean();
    if (number) pairs.set(String(number._id), [...(pairs.get(String(number._id)) ?? []), item.evidence]);
  }
  for (const item of await exactEvidence(lead, model, session)) {
    if (!onlyNumber || onlyNumber === item.number_id) pairs.set(item.number_id, [...(pairs.get(item.number_id) ?? []), item.evidence]);
  }
  // Refresh display caches even when the current phone has moved; identity evidence is append-only.
  const priorPairs = await Model.find({ "lead_ref.model": model, "lead_ref.id": ref.id,
    ...(onlyNumber ? { contact_number_id: onlyNumber } : {}) }).session(session).lean();
  for (const row of priorPairs) if (!pairs.has(String(row.contact_number_id))) pairs.set(String(row.contact_number_id), []);
  let changed = 0;
  for (const [numberId, newEvidence] of [...pairs].sort(([a], [b]) => a.localeCompare(b))) {
    const number = await lockNumber(numberId, session);
    const key = { contact_number_id: numberId, "lead_ref.model": model, "lead_ref.id": ref.id };
    const prior = await Model.findOne(key).session(session).lean();
    // Reviewed edges, including detach, and rejected pairs are completely immutable to refresh.
    if (prior?.decided_at || prior?.state === "rejected") { await unchangedNumber(numberId, number, session); continue; }
    const old = prior ? attachmentPolicyInput(prior).evidence : [];
    const evidence = [...old];
    for (const e of newEvidence) {
      if (!evidence.some(p => p.source === e.source && p.field_path === e.field_path &&
        +p.observed_at === +e.observed_at && (p.identity_value ?? null) === (e.identity_value ?? null) &&
        (p.provider_account_id ?? null) === (e.provider_account_id ?? null))) evidence.push(e);
    }
    if (!evidence.length) { await unchangedNumber(numberId, number, session); continue; }
    const proposed = suggest(evidence, ref);
    const state = prior?.state === "attached" ? "attached" : proposed.state;
    const certainty = prior?.state === "attached" ? prior.certainty : proposed.certainty;
    const snapshot = leadSnapshot(lead, now);
    const comparableSnapshot = (s: typeof snapshot | StoredAttachment["lead_snapshot"]) => s ? { ...s, refreshed_at: null } : null;
    const evidenceChanged = evidence.length !== old.length;
    const snapshotChanged = payloadHash(comparableSnapshot(prior?.lead_snapshot ?? null)) !== payloadHash(comparableSnapshot(snapshot));
    // Don't bounce ambiguous→candidate→ambiguous on every refresh.
    const nextState = prior && !evidenceChanged ? prior.state : state;
    const nextCertainty = prior && !evidenceChanged ? prior.certainty : certainty;
    let wrote = !prior || evidenceChanged || snapshotChanged;
    if (wrote) {
      if (!prior) await Model.create([{ contact_number_id: numberId, lead_ref: ref, state: nextState, certainty: nextCertainty,
        evidence, lead_snapshot: snapshot, history: [{ from: null, to: nextState, at: now, by: "system", reason: "attachment_suggest" }] }], { session });
      else {
        const result = await Model.updateOne({ _id: prior._id, revision: prior.revision, decided_at: null, state: { $ne: "rejected" } }, {
          $set: { state: nextState, certainty: nextCertainty, evidence, lead_snapshot: snapshot }, $inc: { revision: 1 },
          $push: { history: { from: prior.state, to: nextState, at: now, by: "system", reason: "attachment_refresh" } },
        }, { session, runValidators: true });
        if (result.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
      }
    }
    const audit: CsiTransactionContext = { session, now, command_id: new mongoose.Types.ObjectId(), actor: csiWorkerActor(requestId) };
    wrote = await fanInNumber(numberId, session, now) || wrote;
    wrote = await autoAttachNumber(numberId, audit) > 0 || wrote;
    if (wrote) {
      await rebuildAttachmentSearchTerms(numberId, session);
      await onAttachmentChanged({ number_id: numberId, revision: number.revision }, session);
      await appendCsiAudit(audit, {
        kind: "number", target_id: numberId, subject_key: `number:${numberId}`, revision: number.revision,
        event_kind: "attachment_refreshed", prior: { attachment_revision: prior?.revision ?? null },
        current: { lead_model: model, lead_id: ref.id, number_revision: number.revision },
      });
      changed++;
    } else await unchangedNumber(numberId, number, session);
  }
  return changed;
}
