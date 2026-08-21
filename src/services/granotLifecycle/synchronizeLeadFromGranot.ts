import mongoose, { type ClientSession } from "mongoose";
import { Agent } from "../../models/Agent";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { isObjectIdString, toObjectId } from "../../utils/objectId";
import {
  getGranotRecordLinkModel,
  type GranotRecordLinkDocument,
} from "../../models/GranotRecordLink";
import {
  getSynchronizationDecisionModel,
  type SynchronizationDecisionDocument,
  type SynchronizationDecisionEffect,
} from "../../models/SynchronizationDecision";
import {
  CALL_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
  FORM_LEAD_CHANGE_PATHS,
  persistEntityChangeMutations,
  RECORD_LINK_CHANGE_PATHS,
  type PlannedAggregateMutation,
} from "../domainCommands/entityChange";
import { executeCanonicalCommandWithPostCommit } from "../domainCommands/idempotency";
import {
  DomainRevisionConflictError,
  type CanonicalCommandContext,
  type CanonicalCommandResult,
} from "../domainCommands/types";
import { enqueueSheetSyncJob, finalizeSheetSync } from "../sheetSync";
import {
  assertAuthorizedLeadDesiredState,
  hashGranotContactLeaves,
  type GranotAuthorizedLeadDesiredState,
  type GranotLeadWritePath,
} from "./authorizedDesiredState";
import { compareGranotTemporal, olderTemporalWinnerFilter } from "./granotTemporal";
import type { LeadDesiredStateProjection, LeadContactSnapshot } from "./leadDesiredState";
import type { SynchronizeLeadExecution, SynchronizeLeadJobProposal } from "./synchronizeLeadTypes";
import type { EntityRef, LeadModel, SynchronizationOutcome, SynchronizationReasonCode } from "./types";

export class SynchronizeLeadRaceError extends Error {
  readonly code = "SYNCHRONIZE_LEAD_RACE";

  constructor(readonly kind: "revision" | "temporal" | "link_duplicate" | "eligibility") {
    super(`Matched Lead synchronization lost a ${kind} race.`);
    this.name = "SynchronizeLeadRaceError";
  }
}

export type SynchronizeLeadFromGranotInput = {
  lead_ref: { model: "FormLead" | "CallLead"; id: string };
  expected_domain_revision: number;
  desired_state: GranotAuthorizedLeadDesiredState;
  context: CanonicalCommandContext;
  execution: SynchronizeLeadExecution;
};

type LinkAction =
  | { kind: "none" }
  | { kind: "establish" }
  | { kind: "attach"; link: GranotRecordLinkDocument }
  | { kind: "confirm"; link: GranotRecordLinkDocument }
  | {
      kind: "conflict";
      reason: "record_link_conflict" | "job_number_conflict" | "source_scope_conflict";
      link: GranotRecordLinkDocument;
    };

export async function synchronizeLeadFromGranot(
  input: SynchronizeLeadFromGranotInput,
): Promise<CanonicalCommandResult> {
  assertAuthorizedLeadDesiredState(input.desired_state, input.lead_ref.model);
  if (input.execution.execution_mode !== "live" || !input.execution.flags.lead_writes_enabled) {
    throw new Error("synchronizeLeadFromGranot requires live mode and Lead writes enabled.");
  }
  if (!input.execution.evaluated_gates.every((gate) => gate.allowed)) {
    throw new Error("synchronizeLeadFromGranot requires all eight effect gates.");
  }

  let sheetJob:
    | { resource: "source_lead"; operation: "form_lead.update" | "call_lead.update"; leadModel: LeadModel; leadId: string }
    | undefined;

  const command = await executeCanonicalCommandWithPostCommit({
    command_name: "synchronizeLeadFromGranot",
    context: input.context,
    operation: async (tx) => {
      const result = await applySynchronizeLeadOperation(input, tx.session, tx.now, tx.command_execution_id);
      sheetJob = result.sheetJob;
      return {
        entity_refs: result.entity_refs,
        pending: result.sheetJob,
      };
    },
    finalize: async (pending) => {
      if (pending) {
        await finalizeSheetSync(pending);
      }
    },
  });

  void sheetJob;
  return {
    status: "applied",
    entity_refs: command.entity_refs,
    warnings: command.warnings,
  };
}

async function applySynchronizeLeadOperation(
  input: SynchronizeLeadFromGranotInput,
  session: ClientSession,
  now: Date,
  commandExecutionId: mongoose.Types.ObjectId,
): Promise<{
  entity_refs: Array<{ model: string; id: string }>;
  sheetJob?: {
    resource: "source_lead";
    operation: "form_lead.update" | "call_lead.update";
    leadModel: LeadModel;
    leadId: string;
  };
}> {
  const lead = await loadLeadSnapshot(input.lead_ref, session);
  if (!lead) {
    throw new SynchronizeLeadRaceError("eligibility");
  }
  if (Number(lead.domain_revision ?? 0) !== input.expected_domain_revision) {
    throw new DomainRevisionConflictError();
  }
  if (lead.model === "FormLead" && lead.duplicate === true) {
    throw new SynchronizeLeadRaceError("eligibility");
  }

  const temporal = compareGranotTemporal(
    input.desired_state.temporal_winner,
    lead.last_accepted_granot_observation,
  );
  if (temporal === "older" || temporal === "same") {
    throw new SynchronizeLeadRaceError("temporal");
  }

  revalidateDesiredAgainstLead(input, lead);

  const linkAction = await classifyLinkAction(input, session);
  if (linkAction.kind === "conflict") {
    return persistConflict(input, linkAction, session, now, commandExecutionId);
  }

  const leadSet = buildLeadUpdate(input, lead, now);
  const leadChanged = Object.keys(leadSet.reportable).length > 0;
  const association =
    linkAction.kind === "establish" || linkAction.kind === "attach";

  if (!leadChanged && !association) {
    throw new SynchronizeLeadRaceError("eligibility");
  }

  const decisionId = objectId(input.context.provenance.decision_id);
  const mutations: PlannedAggregateMutation[] = [];
  const entity_refs: Array<{ model: string; id: string }> = [
    { model: input.lead_ref.model, id: input.lead_ref.id },
  ];
  const effects: SynchronizationDecisionEffect[] = [];

  let linkRef: EntityRef | undefined;
  if (association) {
    const linkResult = await applyAssociation(input, linkAction, decisionId, session, now);
    linkRef = { model: "GranotRecordLink", id: String(linkResult.link_id) };
    entity_refs.push(linkRef);
    effects.push({ kind: "record_link_established", ref: linkRef });
    if (linkResult.mutation) {
      mutations.push(linkResult.mutation);
    }
  }

  if (linkAction.kind === "confirm") {
    await confirmLinkEvidence(input, linkAction.link, session);
    const confirmRef: EntityRef = { model: "GranotRecordLink", id: String(linkAction.link._id) };
    entity_refs.push(confirmRef);
    effects.push({ kind: "record_link_confirmed", ref: confirmRef });
  }

  if (leadChanged) {
    const before = lead.raw;
    const updated = await applyLeadMutation(input, leadSet.all, lead, session, now);
    const paths = input.lead_ref.model === "FormLead" ? FORM_LEAD_CHANGE_PATHS : CALL_LEAD_CHANGE_PATHS;
    const fields = collectDocumentFieldChanges(before, updated, paths);
    if (fields.length > 0) {
      mutations.push({
        entity: { model: input.lead_ref.model, id: input.lead_ref.id },
        revision_before: input.expected_domain_revision,
        fields,
      });
    }
    const changed = [...new Set(fields.map((field) => field.path))].sort((a, b) =>
      a.localeCompare(b),
    );
    effects.unshift({
      kind: "lead_updated",
      ref: { model: input.lead_ref.model, id: input.lead_ref.id },
      changed_paths: changed,
    });
    effects.push({ kind: "sheet_sync_requested" });
  } else {
    const won = await advanceTemporalWinnerOnly(input, lead, session);
    if (!won) {
      throw new SynchronizeLeadRaceError("temporal");
    }
  }

  const outcome: SynchronizationOutcome = leadChanged ? "applied" : "linked";
  const reason_code: SynchronizationReasonCode = leadChanged
    ? "lead_state_changed"
    : "record_link_established";

  await persistDecision(input, {
    _id: decisionId,
    observation_id: input.execution.observation._id,
    attempt: input.execution.attempt,
    execution_mode: "live",
    outcome,
    reason_code,
    match_method: input.execution.match_method,
    target: input.execution.target,
    source_scope: input.execution.source_scope,
    candidates: input.execution.candidates,
    evaluated_gates: input.execution.evaluated_gates,
    effects,
    decided_at: input.execution.decided_at,
  }, session);

  if (mutations.length > 0) {
    await persistEntityChangeMutations({
      session,
      now,
      command_name: "synchronizeLeadFromGranot",
      command_execution_id: commandExecutionId,
      context: input.context,
      mutations: mutations.map((mutation) => ({
        ...mutation,
        change_id: new mongoose.Types.ObjectId(),
      })),
    });
  }

  let sheetJob:
    | {
        resource: "source_lead";
        operation: "form_lead.update" | "call_lead.update";
        leadModel: LeadModel;
        leadId: string;
      }
    | undefined;
  if (leadChanged) {
    sheetJob = {
      resource: "source_lead",
      operation: input.lead_ref.model === "FormLead" ? "form_lead.update" : "call_lead.update",
      leadModel: input.lead_ref.model,
      leadId: input.lead_ref.id,
    };
    await enqueueSheetSyncJob(sheetJob, { session, createdBy: "api" });
  }

  return { entity_refs, sheetJob };
}

function revalidateDesiredAgainstLead(
  input: SynchronizeLeadFromGranotInput,
  lead: LoadedLead,
): void {
  if (input.execution.identity.target_eligibility === "priority_only") {
    const allowed = new Set(["granot_priority"]);
    const extra = input.desired_state.changed_paths.filter((path) => !allowed.has(path));
    if (extra.length > 0) {
      throw new AuthorizedPathError("Bad Form identity may only apply Priority.");
    }
  }
  if (input.desired_state.set.quoted === false) {
    throw new AuthorizedPathError("quoted:false is forbidden.");
  }
  if (input.desired_state.set.receiver_agent) {
    if (lead.receiver_agent) {
      throw new SynchronizeLeadRaceError("eligibility");
    }
  }
}

export class AuthorizedPathError extends Error {
  readonly code = "GRANOT_AUTHORIZED_DESIRED_STATE_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "AuthorizedPathError";
  }
}

async function classifyLinkAction(
  input: SynchronizeLeadFromGranotInput,
  session: ClientSession,
): Promise<LinkAction> {
  const job = input.execution.job;
  if (!job) {
    return { kind: "none" };
  }
  const existing = await (input.execution.findActiveLink
    ? input.execution.findActiveLink(job.normalized_job_no, session)
    : defaultFindActiveLink(job.normalized_job_no, session));
  if (!existing) {
    return { kind: "establish" };
  }
  const leadId = input.lead_ref.id;
  const existingLead = existing.lead_ref ? String(existing.lead_ref.id) : undefined;
  if (existingLead && existingLead !== leadId) {
    return { kind: "conflict", reason: "record_link_conflict", link: existing };
  }
  if (existing.normalized_job_no !== job.normalized_job_no) {
    return { kind: "conflict", reason: "job_number_conflict", link: existing };
  }
  if (!sourceScopeAgrees(existing, job)) {
    return { kind: "conflict", reason: "source_scope_conflict", link: existing };
  }
  if (!existingLead) {
    return { kind: "attach", link: existing };
  }
  return { kind: "confirm", link: existing };
}

function sourceScopeAgrees(
  existing: GranotRecordLinkDocument,
  job: SynchronizeLeadJobProposal,
): boolean {
  if (!existing.source_scope && !job.source_scope) {
    return true;
  }
  if (!existing.source_scope || !job.source_scope) {
    return !existing.source_scope;
  }
  return (
    String(existing.source_scope.lead_source_company) ===
      String(job.source_scope.lead_source_company) &&
    String(existing.source_scope.source_granularity_id) ===
      String(job.source_scope.source_granularity_id)
  );
}

async function persistConflict(
  input: SynchronizeLeadFromGranotInput,
  action: Extract<LinkAction, { kind: "conflict" }>,
  session: ClientSession,
  now: Date,
  commandExecutionId: mongoose.Types.ObjectId,
): Promise<{
  entity_refs: Array<{ model: string; id: string }>;
  sheetJob?: undefined;
}> {
  const decisionId = objectId(input.context.provenance.decision_id);
  const linkId = action.link._id;
  const newlyDisputed = action.link.disputed !== true;
  if (newlyDisputed) {
    const result = await getGranotRecordLinkModel().updateOne(
      { _id: linkId, state: "active", domain_revision: action.link.domain_revision },
      {
        $set: {
          disputed: true,
          dispute_reason: action.reason,
          last_observation_id: input.execution.observation._id,
          last_observed_at: input.execution.decided_at,
        },
      },
      { session },
    );
    if (result.matchedCount === 0) {
      throw new SynchronizeLeadRaceError("link_duplicate");
    }
    await persistEntityChangeMutations({
      session,
      now,
      command_name: "synchronizeLeadFromGranot",
      command_execution_id: commandExecutionId,
      context: input.context,
      mutations: [
        {
          change_id: new mongoose.Types.ObjectId(),
          entity: { model: "GranotRecordLink", id: String(linkId) },
          revision_before: action.link.domain_revision,
          fields: [
            { path: "disputed", before: false, after: true },
            { path: "dispute_reason", after: action.reason },
          ],
        },
      ],
    });
  }
  await persistDecision(input, {
    _id: decisionId,
    observation_id: input.execution.observation._id,
    attempt: input.execution.attempt,
    execution_mode: "live",
    outcome: "conflict",
    reason_code: action.reason,
    match_method: input.execution.match_method,
    target: input.execution.target,
    source_scope: input.execution.source_scope,
    candidates: input.execution.candidates,
    evaluated_gates: input.execution.evaluated_gates,
    effects: [],
    decided_at: input.execution.decided_at,
  }, session);
  return {
    entity_refs: [
      { model: input.lead_ref.model, id: input.lead_ref.id },
      { model: "GranotRecordLink", id: String(linkId) },
    ],
  };
}

async function applyAssociation(
  input: SynchronizeLeadFromGranotInput,
  action: Extract<LinkAction, { kind: "establish" | "attach" }>,
  decisionId: mongoose.Types.ObjectId,
  session: ClientSession,
  now: Date,
): Promise<{ link_id: mongoose.Types.ObjectId; mutation: PlannedAggregateMutation }> {
  const job = input.execution.job!;
  const lead_ref = {
    model: input.lead_ref.model,
    id: toObjectId(input.lead_ref.id),
  };
  if (action.kind === "establish") {
    const linkId = new mongoose.Types.ObjectId();
    try {
      await getGranotRecordLinkModel().create(
        [
          {
            _id: linkId,
            provider: "granot",
            normalized_job_no: job.normalized_job_no,
            job_no_snapshot: job.job_no_snapshot,
            state: "active",
            lead_ref,
            source_scope: job.source_scope,
            disputed: false,
            established_by_decision_id: decisionId,
            established_at: now,
            last_observation_id: input.execution.observation._id,
            last_observed_at: now,
            domain_revision: 0,
          },
        ],
        { session },
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new SynchronizeLeadRaceError("link_duplicate");
      }
      throw error;
    }
    return {
      link_id: linkId,
      mutation: {
        entity: { model: "GranotRecordLink", id: String(linkId) },
        revision_before: 0,
        fields: [
          { path: "lead_ref", after: { model: lead_ref.model, id: String(lead_ref.id) } },
          ...(job.source_scope
            ? [
                {
                  path: "source_scope",
                  after: {
                    lead_source_company: String(job.source_scope.lead_source_company),
                    source_granularity_id: String(job.source_scope.source_granularity_id),
                  },
                },
              ]
            : []),
        ],
      },
    };
  }

  const result = await getGranotRecordLinkModel().updateOne(
    { _id: action.link._id, state: "active", domain_revision: action.link.domain_revision },
    {
      $set: {
        lead_ref,
        source_scope: job.source_scope ?? action.link.source_scope,
        last_observation_id: input.execution.observation._id,
        last_observed_at: now,
      },
    },
    { session },
  );
  if (result.matchedCount === 0) {
    throw new SynchronizeLeadRaceError("link_duplicate");
  }
  return {
    link_id: action.link._id,
    mutation: {
      entity: { model: "GranotRecordLink", id: String(action.link._id) },
      revision_before: action.link.domain_revision,
      fields: [
        { path: "lead_ref", after: { model: lead_ref.model, id: String(lead_ref.id) } },
      ],
    },
  };
}

function buildLeadUpdate(
  input: SynchronizeLeadFromGranotInput,
  lead: LoadedLead,
  now: Date,
): { all: Record<string, unknown>; reportable: Record<string, unknown> } {
  const all: Record<string, unknown> = {};
  const reportable: Record<string, unknown> = {};
  const observationId = toObjectId(
    input.desired_state.temporal_winner.observation_id,
  );

  for (const path of input.desired_state.changed_paths) {
    let value = input.desired_state.set[path];
    if (path === "granot_contact_snapshot" && value && typeof value === "object") {
      const semantic = value as LeadContactSnapshot;
      value = {
        ...semantic,
        differs_from_ingested: !contactEqual(lead.ingested_contact_snapshot, semantic),
        observation_id: observationId,
        captured_at: input.execution.observation.captured_at,
      };
    }
    if (path === "receiver_agent" && typeof value === "string") {
      value = toObjectId(value);
    }
    all[path] = value;
    reportable[path] = value;
  }

  if (input.desired_state.contact_changed_paths.length > 0) {
    all.current_contact_provenance = {
      source_system: "granot",
      observation_id: observationId,
      changed_at: now,
    };
    all.granot_contact_revision = Number(lead.granot_contact_revision ?? 0) + 1;
    const afterContact = {
      name: pick(all, lead, "name"),
      first_name: pick(all, lead, "first_name"),
      last_name: pick(all, lead, "last_name"),
      phone_number: pick(all, lead, "phone_number"),
      normalized_phone_number: pick(all, lead, "normalized_phone_number"),
      email: pick(all, lead, "email"),
    };
    all.last_granot_contact_change = {
      observation_id: observationId,
      changed_at: now,
      changed_paths: input.desired_state.contact_changed_paths,
      before_hash: hashGranotContactLeaves(lead.contact),
      after_hash: hashGranotContactLeaves(afterContact),
    };
  }

  if (input.desired_state.move_changed_paths.length > 0) {
    all.current_move_provenance = {
      source_system: "granot",
      observation_id: observationId,
      changed_at: now,
    };
  }

  all.last_accepted_granot_observation = {
    observation_id: observationId,
    captured_at: input.desired_state.temporal_winner.captured_at,
  };

  return { all, reportable };
}

async function confirmLinkEvidence(
  input: SynchronizeLeadFromGranotInput,
  link: GranotRecordLinkDocument,
  session: ClientSession,
): Promise<void> {
  await getGranotRecordLinkModel().updateOne(
    { _id: link._id, state: "active" },
    {
      $set: {
        last_observation_id: input.execution.observation._id,
        last_observed_at: input.execution.decided_at,
      },
    },
    { session },
  );
}

async function applyLeadMutation(
  input: SynchronizeLeadFromGranotInput,
  set: Record<string, unknown>,
  lead: LoadedLead,
  session: ClientSession,
  now: Date,
): Promise<Record<string, unknown>> {
  if (input.desired_state.set.receiver_agent) {
    const agent = await assertReceiverAgentAssignable(input, session);
    Object.assign(set, receiverAgentCatalogStamps(agent.name, now));
  }
  const model = leadModel(input.lead_ref.model);
  const filter: Record<string, unknown> = {
    _id: input.lead_ref.id,
    domain_revision: input.expected_domain_revision,
  };
  if (lead.last_accepted_granot_observation) {
    Object.assign(filter, olderTemporalWinnerFilter(input.desired_state.temporal_winner));
  }
  const result = await model.updateOne(
    filter,
    { $set: set },
    { session },
  );
  if (result.matchedCount === 0) {
    throw new DomainRevisionConflictError();
  }
  const after = await model.findById(input.lead_ref.id).session(session).lean().exec();
  return (after ?? {}) as Record<string, unknown>;
}

async function advanceTemporalWinnerOnly(
  input: SynchronizeLeadFromGranotInput,
  lead: LoadedLead,
  session: ClientSession,
): Promise<boolean> {
  const model = leadModel(input.lead_ref.model);
  const filter: Record<string, unknown> = { _id: input.lead_ref.id };
  if (lead.last_accepted_granot_observation) {
    Object.assign(filter, olderTemporalWinnerFilter(input.desired_state.temporal_winner));
  }
  const result = await model.updateOne(
    filter,
    {
      $set: {
        last_accepted_granot_observation: {
          observation_id: toObjectId(
            input.desired_state.temporal_winner.observation_id,
          ),
          captured_at: input.desired_state.temporal_winner.captured_at,
        },
      },
    },
    { session },
  );
  return result.matchedCount === 1;
}

export function receiverAgentCatalogStamps(agentName: string, now: Date) {
  return {
    receiver_agent_name_snapshot: agentName,
    receiver_agent_set_at: now,
  };
}

async function assertReceiverAgentAssignable(
  input: SynchronizeLeadFromGranotInput,
  session: ClientSession,
): Promise<{ name: string }> {
  const agentId = String(input.desired_state.set.receiver_agent);
  const suggested = input.execution.identity.agent;
  if (!suggested || suggested.target.id !== agentId) {
    throw new SynchronizeLeadRaceError("eligibility");
  }
  const agent = await Agent.findById(agentId).session(session).lean().exec();
  if (!agent || agent.active !== true || typeof agent.name !== "string" || !agent.name.trim()) {
    throw new SynchronizeLeadRaceError("eligibility");
  }
  return { name: agent.name };
}

async function persistDecision(
  input: SynchronizeLeadFromGranotInput,
  decision: SynchronizationDecisionDocument,
  session: ClientSession,
): Promise<void> {
  await getSynchronizationDecisionModel().create([decision], { session });
  await getGranotObservationReceiptModel().collection.updateOne(
    { _id: input.execution.receipt_id },
    { $set: { "processing.latest_decision_id": decision._id } },
    session ? { session } : {},
  );
}

type LoadedLead = LeadDesiredStateProjection & {
  raw: Record<string, unknown>;
  duplicate?: boolean;
  granot_contact_revision?: number;
  contact: LeadContactSnapshot;
};

async function loadLeadSnapshot(
  target: { model: LeadModel; id: string },
  session?: ClientSession,
): Promise<LoadedLead | null> {
  const row = await leadModel(target.model)
    .findById(target.id)
    .session(session ?? null)
    .lean()
    .exec();
  if (!row) return null;
  const raw = row as Record<string, unknown>;
  return {
    model: target.model,
    id: String(row._id),
    raw,
    ingestion_origin: absent(row.ingestion_origin as string | undefined),
    job_no: absent(row.job_no as string | undefined),
    normalized_job_no: absent(row.normalized_job_no as string | undefined),
    granot_priority: absent(row.granot_priority as string | undefined),
    quoted: row.quoted as boolean | undefined,
    receiver_agent: row.receiver_agent ? String(row.receiver_agent) : undefined,
    name: absent(row.name as string | undefined),
    first_name: absent(row.first_name as string | undefined),
    last_name: absent(row.last_name as string | undefined),
    phone_number: absent(row.phone_number as string | undefined),
    normalized_phone_number: absent(row.normalized_phone_number as string | undefined),
    email: absent(row.email as string | undefined),
    pickup_city: absent(row.pickup_city as string | undefined),
    pickup_zip: absent(row.pickup_zip as string | undefined),
    pickup_state: absent(row.pickup_state as string | undefined),
    delivery_city: absent(row.delivery_city as string | undefined),
    destination_zip: absent(row.destination_zip as string | undefined),
    delivery_zip: absent((row as { delivery_zip?: string }).delivery_zip),
    delivery_state: absent(row.delivery_state as string | undefined),
    move_date: row.move_date ? new Date(row.move_date as Date) : undefined,
    cubic_feet: row.cubic_feet as number | undefined,
    local: row.local as LeadDesiredStateProjection["local"],
    move_size: absent(row.move_size as string | undefined),
    granot_move_size: absent(row.granot_move_size as string | undefined),
    granot_service_type: absent(row.granot_service_type as string | undefined),
    granot_contact_snapshot: snapshotContact(row.granot_contact_snapshot),
    ingested_contact_snapshot: snapshotContact(row.ingested_contact_snapshot),
    last_accepted_granot_observation: row.last_accepted_granot_observation
      ? {
          observation_id: String(
            (row.last_accepted_granot_observation as { observation_id: unknown }).observation_id,
          ),
          captured_at: new Date(
            (row.last_accepted_granot_observation as { captured_at: Date }).captured_at,
          ),
        }
      : undefined,
    domain_revision: row.domain_revision as number | undefined,
    duplicate: Boolean((row as { duplicate?: boolean }).duplicate),
    granot_contact_revision: (row as { granot_contact_revision?: number }).granot_contact_revision,
    contact: {
      name: absent(row.name as string | undefined),
      first_name: absent(row.first_name as string | undefined),
      last_name: absent(row.last_name as string | undefined),
      phone_number: absent(row.phone_number as string | undefined),
      normalized_phone_number: absent(row.normalized_phone_number as string | undefined),
      email: absent(row.email as string | undefined),
    },
  };
}

async function defaultFindActiveLink(
  normalizedJobNo: string,
  session?: ClientSession,
): Promise<GranotRecordLinkDocument | null> {
  return getGranotRecordLinkModel()
    .findOne({ provider: "granot", normalized_job_no: normalizedJobNo, state: "active" })
    .session(session ?? null)
    .exec();
}

function leadModel(model: LeadModel): mongoose.Model<Record<string, unknown>> {
  return (
    model === "FormLead" ? getFormLeadModel() : getCallLeadModel()
  ) as unknown as mongoose.Model<Record<string, unknown>>;
}

function objectId(value: string | null | undefined): mongoose.Types.ObjectId {
  if (!value || !isObjectIdString(value)) {
    throw new Error("Decision ID is required.");
  }
  return toObjectId(value);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function contactEqual(
  current: LeadContactSnapshot | undefined,
  incoming: LeadContactSnapshot,
): boolean {
  return (
    normalize(current?.name) === normalize(incoming.name) &&
    normalize(current?.first_name) === normalize(incoming.first_name) &&
    normalize(current?.last_name) === normalize(incoming.last_name) &&
    normalize(current?.phone_number) === normalize(incoming.phone_number) &&
    normalize(current?.normalized_phone_number) === normalize(incoming.normalized_phone_number) &&
    normalize(current?.email) === normalize(incoming.email)
  );
}

function snapshotContact(value: unknown): LeadContactSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as LeadContactSnapshot;
  return {
    first_name: absent(row.first_name),
    last_name: absent(row.last_name),
    name: absent(row.name),
    phone_number: absent(row.phone_number),
    normalized_phone_number: absent(row.normalized_phone_number),
    email: absent(row.email),
  };
}

function pick(
  set: Record<string, unknown>,
  lead: LoadedLead,
  path: GranotLeadWritePath,
): unknown {
  return path in set ? set[path] : (lead as Record<string, unknown>)[path];
}

function normalize(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function absent<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

void RECORD_LINK_CHANGE_PATHS;
