import { createHash } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import {
  classifyExecutionMode,
  getGranotLifecycleFlags,
  type GranotLifecycleFlags,
} from "../../config/domain/granotLifecycle";
import { MOVE_SIZES } from "../../config/domain";
import { Agent } from "../../models/Agent";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotLifecycleActivationModel } from "../../models/GranotLifecycleActivation";
import { getGranotObservationModel, type GranotObservationDocument } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import {
  getGranotRecordLinkModel,
  type GranotRecordLinkDocument,
} from "../../models/GranotRecordLink";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { getRingCentralInboundRouteModel } from "../../models/RingCentralInboundRoute";
import { getRingCentralInboundRouteAssignmentModel } from "../../models/RingCentralInboundRouteAssignment";
import {
  getSynchronizationDecisionModel,
  type SynchronizationDecisionEffect,
  type SynchronizationDecisionSourceScope,
} from "../../models/SynchronizationDecision";
import {
  CALL_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
  FORM_LEAD_CHANGE_PATHS,
  persistEntityChangeMutations,
  type AggregateMutationPlan,
} from "../domainCommands/entityChange";
import { executeCanonicalCommandWithPostCommit } from "../domainCommands/idempotency";
import type {
  CanonicalCommandContext,
  CanonicalCommandResult,
} from "../domainCommands/types";
import {
  recordMissingLeadCplRate,
  resolveLeadCplSnapshot,
} from "../leads/leadCplResolution";
import { enqueueSheetSyncJob, finalizeSheetSync } from "../sheetSync";
import {
  createMongoLeadIdentityStore,
  resolveLeadIdentity,
} from "./identity";
import { evaluateMinimumCreationData } from "./leadDesiredState";
import {
  createMongoSourcePolicyStore,
  evaluateEffectGates,
  resolveSourcePolicy,
  type SourcePolicySnapshot,
} from "./sourcePolicy";
import { normalizeUsStateCode, selectFormMoveType } from "./sourceLabel";
import {
  trustedGranotCallLeadCreateSchema,
  trustedGranotFormLeadCreateSchema,
} from "./trustedLeadCreateValidation";
import type { LeadModel } from "./types";

export const CREATE_LEAD_FROM_GRANOT_COMMAND_NAME = "createLeadFromGranot";

export type CreateLeadFromGranotInput = {
  lead_model: "FormLead" | "CallLead";
  source_scope: {
    lead_source_company: string;
    source_granularity_id: string;
  };
  observation_id: string;
  context: CanonicalCommandContext;
};

type CreateLeadFromGranotDependencies = {
  flags?: GranotLifecycleFlags;
  fail_after?: "lead" | "link" | "changes" | "decision" | "outbox";
};

export class CreateLeadFromGranotRaceError extends Error {
  readonly code = "CREATE_LEAD_FROM_GRANOT_RACE";

  constructor(
    readonly kind:
      | "policy"
      | "identity"
      | "link_duplicate"
      | "route"
      | "route_assignment",
  ) {
    super(`Granot Lead creation lost a ${kind} race.`);
    this.name = "CreateLeadFromGranotRaceError";
  }
}

export function createLeadFromGranotIdempotencyKey(observationId: string): string {
  return `granot:create-lead:${observationId}`;
}

export function createLeadFromGranotPayloadChecksum(input: {
  observation: GranotObservationDocument;
  source_scope: SynchronizationDecisionSourceScope;
  lead_model: "FormLead" | "CallLead";
}): string {
  const contact = input.observation.contact ?? {};
  const move = input.observation.move ?? {};
  const semantics = {
    observation_id: String(input.observation._id),
    route_event_class: input.observation.route_event_class,
    normalized_source_label: input.observation.normalized_source_label,
    normalized_job_no: input.observation.identity?.normalized_job_no ?? null,
    lead_model: input.lead_model,
    source_scope: {
      granot_crm_source_id: String(input.source_scope.granot_crm_source_id),
      lead_source_company: String(input.source_scope.lead_source_company),
      source_granularity_id: String(input.source_scope.source_granularity_id),
      disposition: input.source_scope.disposition,
      policy_version: input.source_scope.policy_version,
    },
    contact: {
      first_name: contact.first_name ?? null,
      last_name: contact.last_name ?? null,
      display_name: contact.display_name ?? null,
      phone: contact.phone_raw ?? null,
      normalized_phone: contact.normalized_phone ?? null,
      email: contact.email_raw ?? null,
      normalized_email: contact.normalized_email ?? null,
    },
    move: {
      origin: move.origin ?? null,
      destination: move.destination ?? null,
      move_date: move.move_date ? new Date(move.move_date).toISOString() : null,
      move_size: move.granot_move_size_raw ?? null,
      service_type: move.service_type_raw ?? null,
      cubic_feet: move.estimated_cubic_feet ?? null,
    },
  };
  return createHash("sha256").update(JSON.stringify(semantics)).digest("hex");
}

export async function createLeadFromGranot(
  input: CreateLeadFromGranotInput,
  deps: CreateLeadFromGranotDependencies = {},
): Promise<CanonicalCommandResult> {
  assertCommandEnvelope(input);
  const command = await executeCanonicalCommandWithPostCommit({
    command_name: CREATE_LEAD_FROM_GRANOT_COMMAND_NAME,
    context: input.context,
    operation: async (tx) => {
      const result = await executeCreation(
        input,
        deps,
        tx.session,
        tx.now,
        tx.command_execution_id,
      );
      return { entity_refs: result.entity_refs, pending: result };
    },
    finalize: async (pending) => {
      await finalizeSheetSync(pending.sheetJob);
      if (pending.cpl_missing) {
        await recordMissingLeadCplRate(pending.cpl_missing);
      }
    },
  });
  return {
    status: "applied",
    entity_refs: command.entity_refs,
    warnings: command.warnings,
  };
}

async function executeCreation(
  input: CreateLeadFromGranotInput,
  deps: CreateLeadFromGranotDependencies,
  session: ClientSession,
  now: Date,
  commandExecutionId: mongoose.Types.ObjectId,
): Promise<{
  entity_refs: Array<{ model: string; id: string }>;
  sheetJob: {
    resource: "source_lead";
    operation: "form_lead.create" | "call_lead.create";
    leadModel: LeadModel;
    leadId: string;
  };
  cpl_missing?: {
    leadModel: "FormLead" | "CallLead";
    leadId: string;
    sourceCompany: string;
    sourceGranularityId?: string | null;
    sourceGranularityKey?: string | null;
  };
}> {
  const observation = await getGranotObservationModel()
    .findById(input.observation_id)
    .session(session)
    .exec();
  if (!observation || observation.route_event_class !== "lead_created") {
    throw new CreateLeadFromGranotRaceError("policy");
  }
  const receiptId = objectId(input.context.provenance.source_receipt_id);
  const receipt = await getGranotObservationReceiptModel()
    .findById(receiptId)
    .session(session)
    .lean()
    .exec();
  if (!receipt || String(observation.receipt_id) !== String(receipt._id)) {
    throw new CreateLeadFromGranotRaceError("policy");
  }

  const activation = await getGranotLifecycleActivationModel()
    .findOne({ key: "granot_lifecycle" })
    .sort({ activated_at: -1 })
    .session(session)
    .lean()
    .exec();
  const flags = deps.flags ?? getGranotLifecycleFlags();
  if (!flags.processing_enabled) {
    throw new CreateLeadFromGranotRaceError("policy");
  }
  const executionMode = classifyExecutionMode({
    captured_at: new Date(receipt.captured_at),
    activated_at: activation?.activated_at ?? null,
    shadow_mode: flags.shadow_mode,
  });
  const policy = await resolveSourcePolicy(
    sourceFacts(observation),
    createMongoSourcePolicyStore(session),
  );
  if (!policy.ok) {
    throw new CreateLeadFromGranotRaceError("policy");
  }
  const snapshot = policy.snapshot;
  const gates = evaluateEffectGates({
    global_effect_flag: flags.lead_creation_enabled,
    receipt_post_activation: executionMode !== "historical_shadow",
    processor_mode: executionMode,
    operational_enabled: snapshot.operational_enabled === true,
    lifecycle_enabled: snapshot.lifecycle_enabled === true,
    disposition: snapshot.lifecycle_disposition,
    source_company_active: snapshot.source_company_active === true,
    source_granularity_active: snapshot.source_granularity_active === true,
    lead_created_policy: snapshot.lead_created_policy,
    requested_effect: "lead_created",
  });
  if (!gates.allowed) {
    throw new CreateLeadFromGranotRaceError("policy");
  }

  const minimum = evaluateMinimumCreationData({ observation, policy: snapshot });
  if (minimum.eligibility !== "eligible") {
    throw new CreateLeadFromGranotRaceError("route");
  }
  const selectedModel = snapshot.selected_lead_model;
  if (
    selectedModel !== input.lead_model ||
    !snapshot.lead_source_company_id ||
    !snapshot.source_granularity_id ||
    !snapshot.lifecycle_policy_version
  ) {
    throw new CreateLeadFromGranotRaceError("policy");
  }
  if (
    snapshot.lead_source_company_id !== input.source_scope.lead_source_company ||
    snapshot.source_granularity_id !== input.source_scope.source_granularity_id
  ) {
    throw new CreateLeadFromGranotRaceError("policy");
  }
  const normalizedJob = observation.identity?.normalized_job_no;
  if (!normalizedJob) {
    throw new CreateLeadFromGranotRaceError("identity");
  }

  const identity = await resolveLeadIdentity(
    { observation, policy: snapshot },
    createMongoLeadIdentityStore(session),
  );
  if (
    identity.target ||
    identity.candidates.length > 0 ||
    (identity.outcome !== "unmatched" && identity.outcome !== "pending_match")
  ) {
    throw new CreateLeadFromGranotRaceError("identity");
  }

  const company = await getLeadSourceCompanyModel()
    .findById(snapshot.lead_source_company_id)
    .session(session)
    .lean()
    .exec();
  const granularity = await getLeadSourceGranularityModel()
    .findById(snapshot.source_granularity_id)
    .session(session)
    .lean()
    .exec();
  if (
    !company ||
    company.active !== true ||
    !granularity ||
    granularity.active !== true ||
    String(granularity.source_company) !== String(company._id) ||
    granularity.channel !== (selectedModel === "FormLead" ? "form" : "call")
  ) {
    throw new CreateLeadFromGranotRaceError("policy");
  }
  if (selectedModel === "CallLead") {
    await assertSingleActiveRingCentralAssignment(
      company._id,
      granularity._id,
      now,
      session,
    );
  }

  const sourceScope: SynchronizationDecisionSourceScope = {
    granot_crm_source_id: objectId(snapshot.granot_crm_source_id),
    lead_source_company: company._id,
    source_granularity_id: granularity._id,
    disposition: snapshot.lifecycle_disposition,
    policy_version: snapshot.lifecycle_policy_version,
  };
  const checksum = createLeadFromGranotPayloadChecksum({
    observation,
    source_scope: sourceScope,
    lead_model: selectedModel,
  });
  if (checksum !== input.context.payload_checksum.toLowerCase()) {
    throw new CreateLeadFromGranotRaceError("policy");
  }

  const cpl = await resolveLeadCplSnapshot({
    sourceGranularityId: String(granularity._id),
    storedBusinessTimestamp: observation.captured_at,
  }, { now: () => now });
  const agent = identity.agent
    ? await Agent.findOne({
        _id: identity.agent.target.id,
        active: true,
      })
        .session(session)
        .lean()
        .exec()
    : null;
  if (identity.agent && !agent) {
    throw new CreateLeadFromGranotRaceError("identity");
  }
  const lead = await createLead({
    model: selectedModel,
    observation,
    source: {
      company_id: company._id,
      company_slug: company.company_slug,
      company_label: company.owner_label,
      granularity_id: granularity._id,
      granularity_key: granularity.granularity_key,
      granularity_label: granularity.owner_label,
      crm_label: granularity.crm_label,
      local:
        selectedModel === "FormLead"
          ? snapshot.selected_move_type === "any"
            ? selectFormMoveType({
                origin_state: observation.move?.origin?.state,
                destination_state: observation.move?.destination?.state,
              })
            : snapshot.selected_move_type
          : undefined,
    },
    cpl,
    agent: identity.agent
      ? {
          ...identity.agent,
          name_snapshot: agent!.name,
        }
      : undefined,
    now,
    session,
  });
  failAfter(deps, "lead");
  const leadRef = { model: selectedModel, id: String(lead._id) } as const;
  const decisionId = objectId(input.context.provenance.decision_id);
  const linkResult = await reserveRecordLink({
    observation,
    lead_ref: leadRef,
    source_scope: sourceScope,
    decision_id: decisionId,
    now,
    session,
  });
  failAfter(deps, "link");

  const leadRaw = lead.toObject() as Record<string, unknown>;
  const leadPaths =
    selectedModel === "FormLead" ? FORM_LEAD_CHANGE_PATHS : CALL_LEAD_CHANGE_PATHS;
  const leadFields = collectDocumentFieldChanges(null, leadRaw, leadPaths);
  const mutations: AggregateMutationPlan[] = [
    {
      change_id: new mongoose.Types.ObjectId(),
      entity: leadRef,
      revision_before: 0,
      fields: leadFields,
    },
    {
      change_id: new mongoose.Types.ObjectId(),
      entity: { model: "GranotRecordLink", id: String(linkResult.link._id) },
      revision_before: linkResult.revision_before,
      fields: linkResult.fields,
    },
  ];
  await persistEntityChangeMutations({
    session,
    now,
    command_name: CREATE_LEAD_FROM_GRANOT_COMMAND_NAME,
    command_execution_id: commandExecutionId,
    context: input.context,
    mutations,
  });
  failAfter(deps, "changes");

  const changedPaths = [...new Set(leadFields.map((field) => field.path))].sort();
  const effects: SynchronizationDecisionEffect[] = [
    { kind: "lead_created", ref: leadRef, changed_paths: changedPaths },
    {
      kind: "record_link_established",
      ref: { model: "GranotRecordLink", id: String(linkResult.link._id) },
    },
    { kind: "sheet_sync_requested" },
  ];
  const attempt = Number(receipt.processing?.match_attempt ?? 0) + 1;
  await getSynchronizationDecisionModel().create(
    [
      {
        _id: decisionId,
        observation_id: observation._id,
        attempt,
        execution_mode: executionMode,
        outcome: "created",
        reason_code: "lead_created_authorized",
        target: leadRef,
        source_scope: sourceScope,
        candidates: [],
        evaluated_gates: gates.evaluated_gates,
        effects,
        decided_at: now,
      },
    ],
    { session },
  );
  await getGranotObservationReceiptModel().collection.updateOne(
    { _id: receipt._id },
    { $set: { "processing.latest_decision_id": decisionId } },
    { session },
  );
  failAfter(deps, "decision");

  const sheetJob = {
    resource: "source_lead" as const,
    operation:
      selectedModel === "FormLead"
        ? ("form_lead.create" as const)
        : ("call_lead.create" as const),
    leadModel: selectedModel,
    leadId: String(lead._id),
  };
  await enqueueSheetSyncJob(sheetJob, { session, createdBy: "api" });
  failAfter(deps, "outbox");

  return {
    entity_refs: [
      leadRef,
      { model: "GranotRecordLink", id: String(linkResult.link._id) },
    ],
    sheetJob,
    ...(cpl.cpl_resolution_status === "missing_rate"
      ? {
          cpl_missing: {
            leadModel: selectedModel,
            leadId: String(lead._id),
            sourceCompany: company.company_slug,
            sourceGranularityId: String(granularity._id),
            sourceGranularityKey: granularity.granularity_key,
          },
        }
      : {}),
  };
}

async function createLead(input: {
  model: "FormLead" | "CallLead";
  observation: GranotObservationDocument;
  source: {
    company_id: mongoose.Types.ObjectId;
    company_slug: string;
    company_label: string;
    granularity_id: mongoose.Types.ObjectId;
    granularity_key: string;
    granularity_label: string;
    crm_label: string;
    local?: string;
  };
  cpl: Awaited<ReturnType<typeof resolveLeadCplSnapshot>>;
  agent?: {
    target: { model: "Agent"; id: string };
    normalized_username: string;
    name_snapshot: string;
  };
  now: Date;
  session: ClientSession;
}) {
  const { observation, source, now } = input;
  const contact = observation.contact ?? {};
  const move = observation.move ?? {};
  const phoneValue = contact.phone_raw ?? contact.normalized_phone;
  const moveSize = MOVE_SIZES.includes(
    move.granot_move_size_raw as (typeof MOVE_SIZES)[number],
  )
    ? (move.granot_move_size_raw as (typeof MOVE_SIZES)[number])
    : undefined;
  const pickupState = move.origin?.state
    ? normalizeUsStateCode(move.origin.state)
    : undefined;
  const deliveryState = move.destination?.state
    ? normalizeUsStateCode(move.destination.state)
    : undefined;
  const pickupZip = normalizeZip(move.origin?.zip);
  const deliveryZip = normalizeZip(move.destination?.zip);
  const hasMoveFacts = Boolean(
    move.move_date ||
      move.granot_move_size_raw ||
      move.service_type_raw ||
      move.estimated_cubic_feet !== undefined ||
      move.origin ||
      move.destination,
  );
  const jobNo = observation.identity?.job_no_raw ?? observation.identity?.normalized_job_no;
  if (!jobNo) throw new CreateLeadFromGranotRaceError("identity");
  const displayName =
    contact.display_name ??
    ([contact.first_name, contact.last_name].filter(Boolean).join(" ") || undefined);
  const contactSnapshot = compact({
    first_name: contact.first_name,
    last_name: contact.last_name,
    name: displayName,
    phone_number: phoneValue,
    normalized_phone_number: contact.normalized_phone,
    email: contact.normalized_email,
    captured_at: observation.captured_at,
    evidence_status: "captured_at_ingestion",
  });
  const provenance = {
    ingestion_origin: "granot_lead_created",
    job_no: jobNo,
    normalized_job_no: observation.identity?.normalized_job_no,
    granot_priority: observation.priority?.valid
      ? observation.priority.canonical
      : undefined,
    granot_move_size: move.granot_move_size_raw,
    granot_service_type: move.service_type_raw,
    ingested_contact_snapshot: contactSnapshot,
    granot_contact_snapshot: {
      ...contactSnapshot,
      differs_from_ingested: false,
      observation_id: observation._id,
      captured_at: observation.captured_at,
      evidence_status: undefined,
    },
    current_contact_provenance: {
      source_system: "granot",
      observation_id: observation._id,
      changed_at: now,
    },
    current_move_provenance: hasMoveFacts
      ? {
          source_system: "granot",
          observation_id: observation._id,
          changed_at: now,
        }
      : undefined,
    last_accepted_granot_observation: {
      observation_id: observation._id,
      captured_at: observation.captured_at,
    },
    receiver_agent: input.agent
      ? new mongoose.Types.ObjectId(input.agent.target.id)
      : undefined,
    receiver_agent_source: input.agent ? "granot_username_match" : undefined,
    receiver_agent_name_snapshot: input.agent?.name_snapshot,
    receiver_agent_source_value: input.agent?.normalized_username,
    receiver_agent_set_at: input.agent ? now : undefined,
  };
  const sourceFields = {
    source_company: source.company_slug,
    lead_source_company: source.company_id,
    source_granularity_id: source.granularity_id,
    source_granularity_key: source.granularity_key,
    source_company_label_snapshot: source.company_label,
    source_granularity_label_snapshot: source.granularity_label,
    crm_source_label_snapshot: source.crm_label,
  };

  if (input.model === "FormLead") {
    const trusted = trustedGranotFormLeadCreateSchema.parse({
      job_no: jobNo,
      name: displayName,
      first_name: contact.first_name,
      last_name: contact.last_name,
      phone_number: phoneValue,
      email: contact.normalized_email,
      pickup_city: move.origin?.city,
      pickup_zip: pickupZip,
      pickup_state: pickupState,
      delivery_city: move.destination?.city,
      destination_zip: deliveryZip,
      delivery_state: deliveryState,
      move_size: moveSize,
      move_date: move.move_date,
      source_company: source.company_slug,
      post_to_granot: false,
    });
    const created = new (getFormLeadModel())({
      ...trusted,
      ...sourceFields,
      ...input.cpl,
      ...provenance,
      ref_no: observation.identity?.normalized_form_ref,
      timestamp: observation.captured_at,
      local: source.local,
      cubic_feet: move.estimated_cubic_feet,
      quoted: observation.priority?.valid
        ? observation.priority.canonical === "1" ||
          observation.priority.canonical === "5"
        : false,
      ingested_move_snapshot: compact({
        pickup_city: move.origin?.city,
        pickup_zip: pickupZip,
        pickup_state: pickupState,
        delivery_city: move.destination?.city,
        destination_zip: deliveryZip,
        delivery_state: deliveryState,
        move_date: move.move_date,
        move_size: moveSize,
        captured_at: observation.captured_at,
        evidence_status: "captured_at_ingestion",
      }),
    });
    await created.save({ session: input.session });
    return created;
  }

  const trusted = trustedGranotCallLeadCreateSchema.parse({
    job_no: jobNo,
    phone_number: phoneValue,
    name: displayName,
    first_name: contact.first_name,
    last_name: contact.last_name,
    email: contact.normalized_email,
    source_company: source.company_slug,
    post_to_granot: false,
  });
  const created = new (getCallLeadModel())({
    ...trusted,
    ...sourceFields,
    ...input.cpl,
    ...provenance,
    timestamp: observation.captured_at,
    local: source.local,
    form_fill: false,
    pickup_city: move.origin?.city,
    pickup_zip: pickupZip,
    pickup_state: pickupState,
    delivery_city: move.destination?.city,
    delivery_zip: deliveryZip,
    delivery_state: deliveryState,
    cubic_feet: move.estimated_cubic_feet,
    quoted: observation.priority?.valid
      ? observation.priority.canonical === "1" ||
        observation.priority.canonical === "5"
      : false,
    ringcentral_convergence: {
      state: contact.normalized_phone ? "pending" : "not_applicable",
      observation_id: observation._id,
      ...(contact.normalized_phone
        ? { candidate_window_started_at: now }
        : {}),
    },
  });
  await created.save({ session: input.session });
  return created;
}

async function reserveRecordLink(input: {
  observation: GranotObservationDocument;
  lead_ref: { model: "FormLead" | "CallLead"; id: string };
  source_scope: SynchronizationDecisionSourceScope;
  decision_id: mongoose.Types.ObjectId;
  now: Date;
  session: ClientSession;
}): Promise<{
  link: GranotRecordLinkDocument;
  revision_before: number;
  fields: Array<{ path: string; before?: unknown; after?: unknown }>;
}> {
  const normalizedJob = input.observation.identity?.normalized_job_no;
  const rawJob =
    input.observation.identity?.job_no_raw ??
    input.observation.identity?.normalized_job_no;
  if (!normalizedJob || !rawJob) {
    throw new CreateLeadFromGranotRaceError("identity");
  }
  const Link = getGranotRecordLinkModel();
  const existing = await Link.findOne({
    provider: "granot",
    normalized_job_no: normalizedJob,
    state: "active",
  })
    .session(input.session)
    .exec();
  const lead_ref = {
    model: input.lead_ref.model,
    id: new mongoose.Types.ObjectId(input.lead_ref.id),
  };
  const source_scope = {
    lead_source_company: input.source_scope.lead_source_company,
    source_granularity_id: input.source_scope.source_granularity_id,
  };
  if (!existing) {
    try {
      const [created] = await Link.create(
        [
          {
            provider: "granot",
            normalized_job_no: normalizedJob,
            job_no_snapshot: rawJob,
            state: "active",
            lead_ref,
            source_scope,
            disputed: false,
            established_by_decision_id: input.decision_id,
            established_at: input.now,
            last_observation_id: input.observation._id,
            last_observed_at: input.now,
            domain_revision: 0,
          },
        ],
        { session: input.session },
      );
      return {
        link: created,
        revision_before: 0,
        fields: [
          { path: "lead_ref", after: { model: lead_ref.model, id: String(lead_ref.id) } },
          {
            path: "source_scope",
            after: {
              lead_source_company: String(source_scope.lead_source_company),
              source_granularity_id: String(source_scope.source_granularity_id),
            },
          },
        ],
      };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new CreateLeadFromGranotRaceError("link_duplicate");
      }
      throw error;
    }
  }
  throw new CreateLeadFromGranotRaceError("link_duplicate");
}

async function assertSingleActiveRingCentralAssignment(
  companyId: mongoose.Types.ObjectId,
  granularityId: mongoose.Types.ObjectId,
  now: Date,
  session: ClientSession,
): Promise<void> {
  const assignments = await getRingCentralInboundRouteAssignmentModel()
    .find({
      source_company: companyId,
      source_granularity: granularityId,
    })
    .session(session)
    .lean()
    .exec();
  if (assignments.length === 0) {
    return;
  }
  const active = assignments.filter(
    (assignment) =>
      assignment.active === true &&
      new Date(assignment.effective_from).getTime() <= now.getTime() &&
      (!assignment.effective_until ||
        new Date(assignment.effective_until).getTime() > now.getTime()),
  );
  if (active.length !== 1) {
    throw new CreateLeadFromGranotRaceError("route_assignment");
  }
  const route = await getRingCentralInboundRouteModel()
    .findOne({
      _id: active[0].route,
      active: true,
      validation_status: "valid",
    })
    .session(session)
    .lean()
    .exec();
  if (!route) {
    throw new CreateLeadFromGranotRaceError("route_assignment");
  }
}

function sourceFacts(observation: GranotObservationDocument) {
  return {
    source_label: observation.source_label_raw ?? "",
    origin_state: observation.move?.origin?.state,
    destination_state: observation.move?.destination?.state,
    provider_type: observation.provider_context?.type_raw,
  };
}

function assertCommandEnvelope(input: CreateLeadFromGranotInput): void {
  const keys = Object.keys(input).sort();
  if (
    JSON.stringify(keys) !==
    JSON.stringify(["context", "lead_model", "observation_id", "source_scope"])
  ) {
    throw new Error("createLeadFromGranot accepts no caller patch or extra input.");
  }
  if (!mongoose.Types.ObjectId.isValid(input.observation_id)) {
    throw new Error("createLeadFromGranot requires a valid observation_id.");
  }
  if (
    !input.source_scope ||
    !mongoose.Types.ObjectId.isValid(input.source_scope.lead_source_company) ||
    !mongoose.Types.ObjectId.isValid(input.source_scope.source_granularity_id)
  ) {
    throw new Error("createLeadFromGranot requires an exact ObjectId source_scope.");
  }
  if (input.lead_model !== "FormLead" && input.lead_model !== "CallLead") {
    throw new Error("createLeadFromGranot requires an exact Lead model.");
  }
  if (
    input.context.provenance.origin !== "granot_lifecycle" ||
    input.context.provenance.observation_id !== input.observation_id ||
    !input.context.provenance.source_receipt_id ||
    !input.context.provenance.decision_id ||
    !input.context.initiator
  ) {
    throw new Error("createLeadFromGranot requires Granot receipt/observation/decision provenance.");
  }
  if (
    input.context.idempotency_key !==
    createLeadFromGranotIdempotencyKey(input.observation_id)
  ) {
    throw new Error("createLeadFromGranot requires the observation idempotency key.");
  }
}

function objectId(value: string | null | undefined): mongoose.Types.ObjectId {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) {
    throw new Error("createLeadFromGranot requires a valid ObjectId provenance reference.");
  }
  return new mongoose.Types.ObjectId(value);
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function normalizeZip(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed && /^\d{5}(?:-\d{4})?$/.test(trimmed) ? trimmed : undefined;
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === 11000,
  );
}

function failAfter(
  deps: CreateLeadFromGranotDependencies,
  stage: NonNullable<CreateLeadFromGranotDependencies["fail_after"]>,
): void {
  if (deps.fail_after === stage) {
    throw new Error(`Injected createLeadFromGranot rollback after ${stage}.`);
  }
}
