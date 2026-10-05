import { createHash } from "node:crypto";
import { SALES_OUTREACH_COMMAND_KINDS, SALES_OUTREACH_CONTRACT_VERSION } from "../../../config/domain/salesOutreach";
import type { SalesOutreachAssignmentResponse } from "../../../validation/v1/salesOutreachCommands";
import type { DurableActor } from "../../durableWork/types";
import type { CanonicalCommandContext } from "../../domainCommands/types";
import { CsiError, type CsiActor } from "../../salesIntelligence/auth";
import { appendCsiAudit, executeCsiCommand } from "../../salesIntelligence/transactions";
import type { OutreachActor } from "../auth";
import { OutreachError } from "../errors";
import { evaluationJob } from "../evaluation/evaluateJob";
import { leadChangeJobInput } from "../subjects/feed";
import {
  authorizedSubject,
  commandLoader,
  commandStore,
  publishCommandLive,
  requireCommandConfiguration,
  subjectAuditKey,
  wakeCommandJobs,
  type DeskCommandDeps,
} from "./common";

/**
 * `PATCH /outreach/:id/assignment` — Owner or Manager (IMPL-01, P09b).
 *
 * The assigned rep is the Lead's `receiver_agent`. The command writes it with
 * `receiver_agent_source: "manual"` (Granot latest-wins never replaces a manual receiver,
 * `receiverReplaceableByGranot`) through `LeadChangeRecorder`, so the Lead write, its EntityChange
 * and `domain_revision` CAS, the desk subject's assignment, the CSI ledger row and the audit event
 * all commit in one transaction. After commit the Lead-change job (`leadChangeJobInput`) and an
 * evaluation job are woken. Assignment never restarts the Lead timeline (P06d): the engine reads the
 * history from `entity_changes`.
 *
 * Fences: `expected_revision` is the subject's `assignment_revision`; a desk copy that no longer
 * matches the Lead's current receiver is a 409 (re-read first). The target must be an Agent with a
 * reviewed `sales_rep` link now; `null` unassigns.
 */

type AssignmentResult = Omit<SalesOutreachAssignmentResponse, "replayed">;

/** `EntityChange` provenance for a desk assignment (DurableActor has no Manager kind: a Manager is recorded as `admin`). */
export function deskAssignmentContext(actor: CsiActor, role: OutreachActor["role"], idempotencyKey: string, payload: unknown): CanonicalCommandContext {
  const durable: DurableActor =
    role === "owner"
      ? { actor_type: "owner", actor_id: actor.id, actor_label: "Sales Outreach Desk (Owner)", actor_role: "owner", request_id: actor.request_id, origin: "vantage_admin" }
      : { actor_type: "admin", actor_id: actor.id, actor_label: "Sales Outreach Desk (Manager)", actor_role: "admin", request_id: actor.request_id, origin: "vantage_admin" };
  const command_id = createHash("sha256").update(`${role}:${actor.id}\n${idempotencyKey}`).digest("hex").slice(0, 24);
  return {
    command_id,
    idempotency_key: `sales-outreach:${role}:${actor.id}:${idempotencyKey}`,
    payload_checksum: createHash("sha256").update(JSON.stringify({ command: SALES_OUTREACH_COMMAND_KINDS.assignment, payload })).digest("hex"),
    actor: durable,
    initiator: durable,
    provenance: { origin: "vantage_admin", run_id: null, source_receipt_id: null, source_connection_key: null },
  };
}

export type AssignmentInput = Readonly<{
  actor: OutreachActor;
  subject_id: string;
  idempotency_key: string;
  expected_revision: number;
  agent_id: string | null;
}>;

export async function assignSubject(input: AssignmentInput, deps: DeskCommandDeps = {}): Promise<SalesOutreachAssignmentResponse> {
  if (input.actor.role === "rep") throw new OutreachError("FORBIDDEN");
  const wake: string[] = [];
  const payload = { subject_id: input.subject_id, expected_revision: input.expected_revision, agent_id: input.agent_id };
  const { response, replayed } = await (deps.run ?? executeCsiCommand)<AssignmentResult>({
    actor: input.actor.actor,
    command: SALES_OUTREACH_COMMAND_KINDS.assignment,
    idempotency_key: input.idempotency_key,
    payload,
    operation: async (context) => {
      wake.length = 0;
      const { session, now } = context;
      const store = commandStore(deps);
      await requireCommandConfiguration(commandLoader(deps), session, { desk: true });
      const { subject, lead } = await authorizedSubject(input.actor, input.subject_id, store, session);
      if (!lead) throw new OutreachError("NOT_FOUND");
      if (subject.status === "closed") throw new OutreachError("INVALID_INPUT", [{ path: "subject", code: "subject_not_open" }]);
      if (subject.assignment_revision !== input.expected_revision) throw new CsiError("REVISION_CONFLICT");
      const currentEffective = lead.receiver_agent_id && (await store.reviewedRepName(lead.receiver_agent_id, now, session)) !== null ? lead.receiver_agent_id : null;
      if (currentEffective !== subject.assigned_agent_id)
        throw new OutreachError("REVISION_CONFLICT", [{ path: "assignment", code: "assignment_changed" }]);
      const name = input.agent_id ? await store.reviewedRepName(input.agent_id, now, session) : null;
      if (input.agent_id && name === null) throw new OutreachError("INVALID_INPUT", [{ path: "agent_id", code: "agent_not_reviewed_sales_rep" }]);
      const result = (changed: boolean, revision: number, leadRevision: number): AssignmentResult => ({
        contract_version: SALES_OUTREACH_CONTRACT_VERSION,
        subject_id: subject.id,
        assigned_agent_id: input.agent_id,
        previous_agent_id: subject.assigned_agent_id,
        assignment_revision: revision,
        lead_revision: leadRevision,
        receiver_agent_source: "manual",
        changed,
      });
      if (lead.receiver_agent_id === input.agent_id && lead.receiver_agent_source === "manual") return result(false, subject.assignment_revision, lead.domain_revision);

      const leadRevision = await store.writeLeadAssignment(
        {
          lead: subject.lead,
          agent_id: input.agent_id,
          agent_name: name,
          source_value: `sales_outreach_desk:${input.actor.role}`,
          at: now,
          context: deskAssignmentContext(context.actor, input.actor.role, input.idempotency_key, payload),
        },
        session,
      );
      const assignmentChanged = subject.assigned_agent_id !== input.agent_id;
      const assignmentRevision = subject.assignment_revision + (assignmentChanged ? 1 : 0);
      // Mark the Lead revision seen only when the desk was current before this write; otherwise the
      // Lead-change job still owes a full refresh of the other facts.
      const seen = subject.lead_revision_seen === lead.domain_revision ? leadRevision : subject.lead_revision_seen;
      if (!(await store.updateSubjectAssignment(subject.id, subject.revision, { assigned_agent_id: input.agent_id, assignment_revision: assignmentRevision, lead_revision_seen: seen }, session)))
        throw new CsiError("REVISION_CONFLICT");
      await (deps.audit ?? appendCsiAudit)(context, {
        subject_key: subjectAuditKey(subject.id),
        event_kind: "sales_outreach_assignment_changed",
        prior: { agent_id: lead.receiver_agent_id, receiver_agent_source: lead.receiver_agent_source, assignment_revision: subject.assignment_revision },
        current: { agent_id: input.agent_id, receiver_agent_source: "manual", assignment_revision: assignmentRevision, lead_revision: leadRevision, actor_role: input.actor.role },
        target_id: subject.id,
        revision: assignmentRevision,
        kind: "outreach",
      });
      for (const job of [leadChangeJobInput(subject.lead, leadRevision), evaluationJob(subject.id, `assignment:l${leadRevision}`, leadRevision)]) {
        const row = await store.enqueue(job, session, now);
        if (row.created) wake.push(row.job_id);
      }
      return result(true, assignmentRevision, leadRevision);
    },
  });
  if (!replayed) await wakeCommandJobs(wake, deps.publish);
  // After commit: the previous assignee loses the row now, the new one gains it (IMPL-01, P06d).
  if (!replayed && response.changed)
    await publishCommandLive(
      [
        {
          topic: "outreach_desk",
          subject_ids: [response.subject_id],
          agent_ids: [response.previous_agent_id, response.assigned_agent_id],
          revision: response.assignment_revision,
          cause: "command",
        },
      ],
      deps,
    );
  return { ...response, replayed };
}
