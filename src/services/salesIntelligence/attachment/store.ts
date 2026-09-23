import mongoose, { type ClientSession, type InferSchemaType } from "mongoose";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getNumberLeadAttachmentModel, NumberLeadAttachmentSchema, NUMBER_LEAD_ATTACHMENT_INDEXES } from "../../../models/NumberLeadAttachment";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { boundSearchTerms } from "../../numberActivity/searchTerms";
import { CsiError, csiWorkerActor } from "../auth";
import { appendCsiAudit, assertIndexes, payloadHash, type CsiTransactionContext } from "../transactions";
import { ambiguityFanIn, exactSource, suggest, AUTO_ATTACH_REASON, isAutoAttachReason, type Attachment, type Evidence, type LeadRef } from "./suggest";
import { AUTO_ATTACH_CONTESTED_REASON, AUTO_ATTACH_WITHDRAWN_REASON, SOLE_MATCH_POLICY_VERSION, completeNormalizedMatchSet,
  planSoleMatch, type PlanEdge } from "./matchSet";
import { openReview } from "../review/items";
import { exactEvidence, phoneEvidence, leadSnapshot, type LeadSource } from "./sources";
import { onAttachmentChanged } from "./hooks";

export type StoredAttachment = InferSchemaType<typeof NumberLeadAttachmentSchema> & { _id: mongoose.Types.ObjectId };
export function attachmentPolicyInput(row: StoredAttachment): Attachment {
  return { lead_ref: { model: row.lead_ref.model, id: String(row.lead_ref.id) }, state: row.state, duplicate: Boolean(row.lead_snapshot?.duplicate),
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
    // A contested automatic decision stays Ambiguous until sole-match re-evaluation or the Owner resolves it.
    if (row.state === "ambiguous" && row.history.at(-1)?.reason === AUTO_ATTACH_CONTESTED_REASON) continue;
    const result = await Model.updateOne({ _id: row._id, revision: row.revision, decided_at: null }, {
      $set: { state: proposed.state, certainty: proposed.certainty }, $inc: { revision: 1 },
      $push: { history: { from: row.state, to: proposed.state, at: now, by: "system", reason: "attachment_ambiguity_fan_in" } },
    }, { session, runValidators: true });
    if (result.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
    changed = true;
  }
  return changed;
}
const PHONE_SOURCES = ["lead_phone_live", "ingested_contact_snapshot", "granot_contact_snapshot", "ringcentral_original_caller"];
/** An automatic (never Owner-decided) edge, including edges written under the pre-H5 reason. */
function isAutomaticRow(row: StoredAttachment) {
  return !row.decided_at && Boolean(row.auto_decision || isAutoAttachReason(row.decision_reason));
}
export function planEdge(row: StoredAttachment): PlanEdge {
  return { id: String(row._id), lead_ref: { model: row.lead_ref.model, id: String(row.lead_ref.id) }, state: row.state,
    certainty: row.certainty, decided_at: row.decided_at ?? null, automatic: isAutomaticRow(row),
    has_phone_evidence: row.evidence.some(e => PHONE_SOURCES.includes(e.source)) };
}
/**
 * H5 sole-match automatic attach (CSI `AUTO_ATTACH`, policy `sole-match-v1`).
 *
 * Reads the complete normalized match set for the number inside the caller's transaction
 * (both Lead models, every Source Company, duplicates excluded) and the number's current
 * edges, then applies `planSoleMatch`:
 * - a known non-duplicate competitor demotes ONLY automatic Attached/Likely edges to
 *   Ambiguous/Unsure (`auto_attach_contested`) and opens an identity review;
 * - an automatic edge whose Lead left a complete set is withdrawn to Candidate;
 * - exactly one eligible candidate with an unreviewed, non-rejected phone-evidence edge and no
 *   other Attached edge becomes Attached/Likely with reason `sole_non_duplicate_match`.
 * Owner `decided_at`, rejected, Exact and Owner-confirmed edges are never written. The caller
 * holds `lockNumber`, so concurrent evaluations of the same number serialize (write conflict +
 * transaction retry), and a Lead inserted after this snapshot is caught by its own
 * `attachment-lead:` evaluation, which contests the edge.
 */
export async function autoAttachNumber(numberId: string, context: CsiTransactionContext) {
  if (!csiFlag("AUTO_ATTACH")) return 0;
  const { session, now } = context;
  const Model = getNumberLeadAttachmentModel();
  const number = await getContactNumberModel().findById(numberId, { national_ten: 1, e164: 1 }).session(session).lean();
  if (!number) return 0;
  const set = await completeNormalizedMatchSet(number, session);
  const rows = await Model.find({ contact_number_id: numberId }).session(session).lean();
  const plan = planSoleMatch(set, rows.map(planEdge));
  const byId = new Map(rows.map(row => [String(row._id), row]));
  const inspected = { policy_version: SOLE_MATCH_POLICY_VERSION, match_status: set.status, match_reason: set.reason ?? null,
    candidate_count: set.candidates.length, candidates: set.candidates.slice(0, 10).map(c => ({ lead_model: c.lead_ref.model,
      lead_id: c.lead_ref.id, sources: c.sources, source_company: c.source_company, bad_lead: c.bad_lead, no_sync: c.no_sync })) };
  let changed = 0;
  const demote = async (row: StoredAttachment, to: "ambiguous" | "candidate", reason: string) => {
    const certainty = to === "ambiguous" ? "unsure" : "likely";
    const result = await Model.updateOne({ _id: row._id, revision: row.revision, decided_at: null, state: "attached", certainty: "likely" }, {
      $set: { state: to, certainty, decision_reason: reason, auto_decision: null }, $inc: { revision: 1 },
      $push: { history: { from: "attached", to, at: now, by: "system", reason } },
    }, { session, runValidators: true });
    if (result.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
    await appendCsiAudit(context, { kind: "number", target_id: String(row._id), subject_key: `number:${numberId}`, revision: row.revision + 1,
      event_kind: reason === AUTO_ATTACH_CONTESTED_REASON ? "attachment_auto_contested" : "attachment_auto_withdrawn",
      prior: { state: row.state, certainty: row.certainty, decision_reason: row.decision_reason ?? null,
        auto_decision: row.auto_decision ? { confidence: row.auto_decision.confidence, reason: row.auto_decision.reason,
          decided_at: row.auto_decision.decided_at.toISOString() } : null },
      current: { attachment_id: String(row._id), lead_model: row.lead_ref.model, lead_id: String(row.lead_ref.id),
        state: to, certainty, reason, ...inspected } });
    changed++;
  };
  for (const id of plan.contest) await demote(byId.get(id)!, "ambiguous", AUTO_ATTACH_CONTESTED_REASON);
  if (plan.contest.length) await openReview(context, `number:${numberId}`, "identity", `${AUTO_ATTACH_CONTESTED_REASON}:${numberId}`, []);
  for (const id of plan.withdraw) await demote(byId.get(id)!, "candidate", AUTO_ATTACH_WITHDRAWN_REASON);
  if (plan.attach) {
    const row = byId.get(plan.attach)!;
    // `confidence` is not a measured probability: 1 records the deterministic sole-match rule.
    const result = await Model.updateOne({ _id: row._id, revision: row.revision, decided_at: null, state: { $nin: ["attached", "rejected"] } }, {
      $set: { state: "attached", certainty: "likely", decision_reason: AUTO_ATTACH_REASON,
        auto_decision: { confidence: 1, reason: AUTO_ATTACH_REASON, decided_at: now } }, $inc: { revision: 1 },
      $push: { history: { from: row.state, to: "attached", at: now, by: "system", reason: AUTO_ATTACH_REASON } },
    }, { session, runValidators: true });
    if (result.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
    await appendCsiAudit(context, { kind: "number", target_id: String(row._id), subject_key: `number:${numberId}`, revision: row.revision + 1,
      event_kind: "attachment_auto_attached", prior: { state: row.state, certainty: row.certainty },
      current: { attachment_id: String(row._id), lead_model: row.lead_ref.model, lead_id: String(row.lead_ref.id),
        state: "attached", certainty: "likely", confidence: 1, reason: AUTO_ATTACH_REASON,
        source_fields: row.evidence.filter(e => PHONE_SOURCES.includes(e.source)).map(e => e.field_path), ...inspected } });
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
