import { createHash, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { getCallLeadModel, type CallLeadDocument } from "../../models/CallLead";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getSalesOutreachSubjectModel } from "../../models/salesOutreach";
import { executeCanonicalCommandWithPostCommit } from "../domainCommands/idempotency";
import { persistEntityChangeMutations } from "../domainCommands/entityChange";
import type { CanonicalCommandContext } from "../domainCommands/types";
import { jobNumbersEquivalent } from "../bookings/bookingIdentity";
import { salesOutreachConfigurationLoader } from "../salesOutreach/config/load";
import { refreshLeadForOutreach } from "../salesOutreach/subjects/leadChangeJob";
import { mongoDeskSubjectStore } from "../salesOutreach/subjects/store";
import { evaluateAndProject, evaluationAdmissionOf } from "../salesOutreach/evaluation/evaluateJob";
import { mongoEvaluationStore } from "../salesOutreach/evaluation/store";
import { publishOutreachLive, type OutreachLivePublication } from "../salesOutreach/live/publish";

type RecoveryLead = Pick<CallLeadDocument, "_id" | "move_date" | "normalized_job_no" | "current_move_provenance" | "last_accepted_granot_observation">;
type RecoveryObservation = { _id: unknown; captured_at: Date; normalization_result: string; identity?: { normalized_job_no?: string }; move?: { move_date?: Date } };
export type CallMoveDateRecovery = { lead_id: string; observation_id: string; move_date: Date };

/** Only stamped, accepted Granot evidence for the same Job may fill an absent date. Never guess. */
export function callMoveDateRecovery(lead: RecoveryLead, observations: readonly RecoveryObservation[]): CallMoveDateRecovery | null {
  if (lead.move_date || !lead.normalized_job_no) return null;
  const ids = recoveryObservationIds(lead);
  const candidate = observations.filter((observation) => ids.includes(String(observation._id))
    && ["valid", "valid_with_issues"].includes(observation.normalization_result)
    && jobNumbersEquivalent(observation.identity?.normalized_job_no, lead.normalized_job_no)
    && observation.move?.move_date instanceof Date && Number.isFinite(+observation.move.move_date))
    .sort((a, b) => +b.captured_at - +a.captured_at || String(b._id).localeCompare(String(a._id)))[0];
  return candidate ? { lead_id: String(lead._id), observation_id: String(candidate._id), move_date: candidate.move!.move_date! } : null;
}

function recoveryObservationIds(lead: RecoveryLead): string[] {
  return [...new Set([
    lead.last_accepted_granot_observation?.observation_id,
    lead.current_move_provenance?.source_system === "granot" ? lead.current_move_provenance.observation_id : undefined,
  ].flatMap((id) => id ? [String(id)] : []))];
}

const observationFields = { captured_at: 1, normalization_result: 1, "identity.normalized_job_no": 1, "move.move_date": 1 } as const;

/** Open desk Call Leads only; batches by indexed Lead/Observation IDs and emits no customer content. */
export async function inspectCallMoveDateRecovery() {
  const subjects = await getSalesOutreachSubjectModel().find({ lead_model: "CallLead", status: { $in: ["active", "review"] } }, { lead_id: 1 }).lean();
  const leads = await getCallLeadModel().find({ _id: { $in: subjects.map((subject) => subject.lead_id) }, booked: null, cancelled: null, duplicate: { $ne: true }, created_on_unmatched: { $ne: true } },
    { move_date: 1, normalized_job_no: 1, current_move_provenance: 1, last_accepted_granot_observation: 1 }).lean();
  const ids = [...new Set(leads.flatMap(recoveryObservationIds))];
  const observations = await getGranotObservationModel().find({ _id: { $in: ids } }, observationFields).lean();
  const candidates = leads.flatMap((lead) => { const recovery = callMoveDateRecovery(lead, observations); return recovery ? [recovery] : []; });
  const dated = leads.filter((lead) => lead.move_date).length;
  return { leads: leads.length, dated, unknown: leads.length - dated - candidates.length, candidates };
}

/** Audited, idempotent missing-date repair. Fresh evidence and open scope are rechecked inside its transaction. */
export async function recoverCallMoveDate(expected: CallMoveDateRecovery): Promise<boolean> {
  const key = `call-move-date:${expected.lead_id}:${expected.observation_id}`;
  const actor = { actor_type: "owner" as const, actor_id: "owner-approved-call-move-date-repair", actor_role: "owner" as const,
    actor_label: "Owner-approved Call Lead move date repair", origin: "vantage_admin" as const, request_id: randomUUID() };
  const context: CanonicalCommandContext = { command_id: randomUUID(), idempotency_key: key,
    payload_checksum: createHash("sha256").update(`${key}:${expected.move_date.toISOString()}`).digest("hex"), actor, initiator: actor,
    provenance: { origin: "vantage_admin", run_id: "call-move-dates-2026-10-15", source_receipt_id: null, source_connection_key: null, observation_id: expected.observation_id } };
  let changed = false;
  await executeCanonicalCommandWithPostCommit<OutreachLivePublication[]>({ command_name: "recoverCallLeadMoveDate", context,
    operation: async ({ session, now, command_execution_id }) => {
      changed = false;
      const lead = await getCallLeadModel().findById(expected.lead_id).session(session);
      const subject = await getSalesOutreachSubjectModel().findOne({ lead_model: "CallLead", lead_id: expected.lead_id, status: { $in: ["active", "review"] } }).session(session).lean();
      if (!lead || !subject || lead.booked || lead.cancelled || lead.duplicate || lead.created_on_unmatched) return { entity_refs: [] };
      const observations = await getGranotObservationModel().find({ _id: { $in: recoveryObservationIds(lead) } }, observationFields).session(session).lean();
      const current = callMoveDateRecovery(lead, observations);
      if (!current || current.observation_id !== expected.observation_id || +current.move_date !== +expected.move_date) return { entity_refs: [] };
      const revision = lead.domain_revision;
      // Update only the recovered field; saving a hydrated legacy Lead could rerun unrelated
      // contact/Job normalization hooks. The audit/revision stamp below shares this transaction.
      const updated = await getCallLeadModel().updateOne({ _id: lead._id, domain_revision: revision, move_date: null },
        { $set: { move_date: current.move_date } }, { session, runValidators: true });
      if (updated.matchedCount !== 1) throw new Error("Call Lead changed during move-date recovery");
      await persistEntityChangeMutations({ session, now, command_name: "recoverCallLeadMoveDate", command_execution_id, context,
        mutations: [{ entity: { model: "CallLead", id: expected.lead_id }, change_id: new mongoose.Types.ObjectId(), revision_before: revision,
          fields: [{ path: "move_date", after: current.move_date }] }] });
      const configuration = await salesOutreachConfigurationLoader.requireActive(session);
      const refreshed = await refreshLeadForOutreach({ model: "CallLead", id: expected.lead_id }, configuration, now, mongoDeskSubjectStore, session);
      const admission = evaluationAdmissionOf(configuration);
      const pending: OutreachLivePublication[] = [];
      if (admission.ok && refreshed.subject_id) {
        const projected = await evaluateAndProject(refreshed.subject_id, admission.context, now, mongoEvaluationStore, session);
        pending.push({ topic: "outreach_desk", subject_ids: [refreshed.subject_id], agent_ids: projected.agent_ids, revision: projected.publication_revision, cause: "evaluation" });
      }
      changed = true;
      return { entity_refs: [{ model: "CallLead", id: expected.lead_id }], pending };
    }, finalize: publishOutreachLive,
  });
  return changed;
}
