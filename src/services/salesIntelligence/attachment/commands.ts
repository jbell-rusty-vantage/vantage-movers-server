import { csiFlag } from "../../../config/domain/salesIntelligence";
import { getNumberLeadAttachmentModel, NUMBER_LEAD_ATTACHMENT_INDEXES } from "../../../models/NumberLeadAttachment";
import { csiCommandSchema, csiIdSchema, type CsiCommand } from "../../../validation/v1/salesIntelligence";
import { CsiError, type CsiActor } from "../auth";
import { appendCsiAudit, assertIndexes, executeCsiCommand } from "../transactions";
import { loadLead } from "./sources";
import { fanInNumber, lockNumber, rebuildAttachmentSearchTerms } from "./store";
import { leadWindow } from "./suggest";
import { onAttachmentChanged } from "./hooks";

type AttachmentCommand = Extract<CsiCommand, { command: "attach_lead" | "reject_attachment" | "detach_attachment" }>;
/** attach_lead/reject_lead/detach service; wire discriminators preserve CSI-01's frozen names. */
export async function commandAttachment(input: { actor: CsiActor; idempotency_key: string; attachment_id?: string; command: AttachmentCommand }) {
  if (!csiFlag("ENABLED") || !csiFlag("ATTACHMENT_REFRESH")) throw new CsiError("FEATURE_DISABLED");
  const parsed = csiCommandSchema.parse(input.command);
  if (parsed.command !== "attach_lead" && parsed.command !== "reject_attachment" && parsed.command !== "detach_attachment") throw new CsiError("INVALID_INPUT");
  const command = parsed;
  if (input.attachment_id) csiIdSchema.parse(input.attachment_id);
  const Model = getNumberLeadAttachmentModel();
  await assertIndexes(Model.collection, NUMBER_LEAD_ATTACHMENT_INDEXES);
  return executeCsiCommand({ actor: input.actor, idempotency_key: input.idempotency_key, command: command.command,
    payload: { command, attachment_id: input.attachment_id ?? null }, operation: async context => {
      const { session, now, actor } = context;
      let row = command.command === "attach_lead" ? await Model.findOne({ contact_number_id: command.contact_number_id,
        "lead_ref.model": command.lead_ref.model, "lead_ref.id": command.lead_ref.id }).session(session) :
        await Model.findById(input.attachment_id).session(session);
      if (!row && command.command !== "attach_lead") throw new CsiError("INVALID_INPUT");
      const numberId = row ? String(row.contact_number_id) : command.command === "attach_lead" ? command.contact_number_id : "";
      const number = await lockNumber(numberId, session);
      // Existing pair: edge revision. Absent pair: displayed Contact Number revision.
      if (command.expected_revision !== (row?.revision ?? number.revision - 1)) throw new CsiError("REVISION_CONFLICT");
      for (const fence of command.expected_revisions ?? []) {
        if (fence.target === "number" && fence.id === numberId) {
          if (fence.revision !== number.prior_revision) throw new CsiError("REVISION_CONFLICT");
        } else if (fence.target === "attachment" && row && fence.id === String(row._id)) {
          if (fence.revision !== row.revision) throw new CsiError("REVISION_CONFLICT");
        } else throw new CsiError("INVALID_INPUT");
      }
      const prior = row ? { state: row.state, certainty: row.certainty, revision: row.revision } : null;
      if (command.command === "attach_lead") {
        const lead = await loadLead(command.lead_ref, session);
        if (!lead) throw new CsiError("INVALID_INPUT");
        const evidence = { source: "owner_attach" as const, field_path: `owner_command:${context.command_id}`, observed_at: now,
          ...leadWindow(command.lead_ref.model, lead.timestamp) };
        if (!row) row = new Model({ contact_number_id: numberId, lead_ref: command.lead_ref, state: "attached", certainty: "owner_confirmed", evidence: [] });
        row.evidence.push(evidence);
        row.state = "attached"; row.certainty = "owner_confirmed";
      } else if (command.command === "reject_attachment") {
        row!.state = "rejected"; row!.certainty = "rejected";
      } else {
        if (row!.state !== "attached") throw new CsiError("ILLEGAL_TRANSITION");
        row!.state = "candidate"; row!.certainty = "likely";
      }
      if (!row) throw new CsiError("INVALID_INPUT");
      row.decided_at = now; row.decided_by = actor.id; row.decision_reason = command.reason;
      row.history.push({ from: prior?.state ?? "unlinked", to: row.state, at: now, by: actor.id, reason: command.reason });
      if (prior) row.revision = prior.revision + 1;
      await row.save({ session });
      await fanInNumber(numberId, session, now);
      await rebuildAttachmentSearchTerms(numberId, session);
      await onAttachmentChanged({ number_id: numberId, revision: number.revision }, session);
      await appendCsiAudit(context, { kind: "number", target_id: numberId, subject_key: `number:${numberId}`, revision: number.revision,
        event_kind: command.command, prior, current: { attachment_id: String(row._id), state: row.state, certainty: row.certainty,
          attachment_revision: row.revision, reason: command.reason } });
      return { attachment_id: String(row._id), revision: row.revision, state: row.state, certainty: row.certainty };
    } });
}
