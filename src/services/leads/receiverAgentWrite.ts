import mongoose, { type ClientSession } from "mongoose";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { emitLeadChange, loadLeadSnapshot, type LeadChangeStamp } from "../domainCommands/leadChangeEmission";
import type { CanonicalCommandContext } from "../domainCommands/types";
import { createRingCentralCallIngestActor } from "../durableWork/actors";
import { enqueueSheetSyncJob } from "../sheetSync";

/**
 * S6-AGENT (assignment addendum §3.1/§3.3): one automatic `receiver_agent` write in the caller's
 * transaction, for writers outside the Granot lifecycle command (the `ringcentral_answered` fill on the
 * Outreach ensure path, and the `backfill-receiver-agent` script's Granot and RingCentral buckets).
 *
 * It is the normal Lead write for non-canonical workflows (`leadChangeEmission`): a compare-and-set on
 * the receiver the caller decided against, one `EntityChange` with every receiver path before/after
 * (so the Outreach scan sees it as an `outreach-lead` job), the `domain_revision` stamp, and the Lead's
 * sheet-sync outbox row (the sheet's SalesRep column reads `receiver_agent_name_snapshot`).
 *
 * Returns null, writing nothing, when the Lead is gone, its receiver is no longer `expected_receiver`
 * (a manual edit or another writer won), or it already holds `agent_id`.
 */
export type ReceiverAgentWriteSource = "granot_username_match" | "ringcentral_answered";
export type ReceiverAgentWrite = {
  model: "FormLead" | "CallLead";
  id: string;
  agent: { id: string; name: string };
  source: ReceiverAgentWriteSource;
  source_value: string | null;
  /** The receiver (Agent id) the caller's decision was made against; null = the field was empty. */
  expected_receiver: string | null;
  context: CanonicalCommandContext;
  command_name: string;
  session: ClientSession;
  now: Date;
};

export async function writeReceiverAgent(input: ReceiverAgentWrite): Promise<LeadChangeStamp | null> {
  const before = await loadLeadSnapshot(input.model, input.id, input.session);
  if (!before) return null;
  const current = before.receiver_agent ? String(before.receiver_agent) : null;
  if (current !== input.expected_receiver || current === input.agent.id) return null;
  const Model = input.model === "FormLead" ? getFormLeadModel() : getCallLeadModel();
  const leadId = new mongoose.Types.ObjectId(input.id);
  const result = await Model.collection.updateOne(
    { _id: leadId, receiver_agent: current ? new mongoose.Types.ObjectId(current) : null },
    {
      $set: {
        receiver_agent: new mongoose.Types.ObjectId(input.agent.id),
        receiver_agent_name_snapshot: input.agent.name,
        receiver_agent_source: input.source,
        receiver_agent_set_at: input.now,
        ...(input.source_value ? { receiver_agent_source_value: input.source_value } : {}),
      },
      ...(input.source_value ? {} : { $unset: { receiver_agent_source_value: "" } }),
    },
    { session: input.session },
  );
  if (result.matchedCount !== 1) return null;
  const stamp = await emitLeadChange({ model: input.model, id: input.id, before, session: input.session, now: input.now,
    command_name: input.command_name, context: input.context });
  if (stamp) {
    await enqueueSheetSyncJob({ resource: "source_lead", operation: input.model === "FormLead" ? "form_lead.update" : "call_lead.update",
      leadModel: input.model, leadId: input.id }, { session: input.session, createdBy: "api" });
  }
  return stamp;
}

/** The RingCentral-origin context of a `ringcentral_answered` fill (EntityChange `source_system: ringcentral`). */
export function ringCentralAnsweredContext(input: { lead_id: string; telephony_session_id: string; interaction_id: string }): CanonicalCommandContext {
  const identity = input.telephony_session_id;
  const actor = createRingCentralCallIngestActor(identity);
  return {
    command_id: new mongoose.Types.ObjectId().toHexString(),
    idempotency_key: `ringcentral:receiver-answered:${input.lead_id}:${input.interaction_id}`,
    payload_checksum: "0".repeat(64),
    actor,
    initiator: actor,
    provenance: { origin: "ringcentral", run_id: null, source_receipt_id: identity, source_connection_key: `ringcentral:receiver-answered:${identity}`,
      observation_id: null, decision_id: null, case_id: null, discrepancy_id: null, observation_channel: null },
  };
}
