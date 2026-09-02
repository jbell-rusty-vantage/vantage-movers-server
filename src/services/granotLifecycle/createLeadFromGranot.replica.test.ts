// Tests for: createLeadFromGranot — replica-set atomic creation, reservation, replay, rollback, and same-job race
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { getCallLeadModel } from "../../models/CallLead";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { getEntityChangeModel } from "../../models/EntityChange";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getGranotLifecycleActivationModel } from "../../models/GranotLifecycleActivation";
import { getGranotObservationModel } from "../../models/GranotObservation";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { getRingCentralInboundRouteModel } from "../../models/RingCentralInboundRoute";
import { getRingCentralInboundRouteAssignmentModel } from "../../models/RingCentralInboundRouteAssignment";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import {
  createGranotLifecycleProcessorActor,
  createGranotWebhookInitiator,
} from "../durableWork/actors";
import { DomainCommandIdempotencyConflictError } from "../domainCommands/types";
import {
  createLeadFromGranot,
  createLeadFromGranotIdempotencyKey,
  createLeadFromGranotPayloadChecksum,
} from "./createLeadFromGranot";
import { processGranotObservation } from "./processor";
import { getRingCentralCollectionName } from "../ringcentral/ringcentral-config";
import { getRingCentralDb } from "../ringcentral/ringcentral-mongo";

const capturedAt = new Date("2026-08-18T16:00:00.000Z");
const SYNTHETIC_PHONE = "5550001919";
const SYNTHETIC_EMAIL = "ada@example.test";
const FORBIDDEN_EFFECT_COLLECTIONS = [
  "booked_leads",
  "cancelled_leads",
  "booking_lead_reconciliation_cases",
  "granot_booking_reconciliation_cases",
  "granot_release_reconciliation_cases",
] as const;

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return false;
  }
  if (!/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) {
    t.skip("Replica-set proof requires TEST_MODE=true before process start.");
    return false;
  }
  await connectMongo();
  if (!/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(mongoose.connection.db?.databaseName ?? "")) {
    t.skip("Refusing replica-set proof against a non-test database.");
    return false;
  }
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello || hello.setName == null) {
    t.skip("Connected Mongo is not a replica set.");
    return false;
  }
  return true;
}

after(async () => {
  await mongoose.disconnect().catch(() => undefined);
});

function objectId(): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId();
}

function jobPair(suffix: string): { raw: string; normalized: string } {
  const raw = `u19-job-${suffix}`;
  return { raw, normalized: normalizeJobNo(raw)! };
}

function liveCreationFlags() {
  return {
    ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
    shadow_mode: false,
    lead_writes_enabled: true,
    lead_creation_enabled: true,
  };
}

async function postActivationCaptureAt(): Promise<Date> {
  const Activation = getGranotLifecycleActivationModel();
  const existing = await Activation.findOne({ key: "granot_lifecycle" }).lean();
  if (existing?.activated_at) {
    return new Date(new Date(existing.activated_at).getTime() + 60 * 60 * 1000);
  }
  const activatedAt = new Date("2026-08-17T14:00:00.000Z");
  try {
    await Activation.create({
      key: "granot_lifecycle",
      activated_at: activatedAt,
      activated_by: {
        actor_type: "owner",
        actor_id: "u19-replica",
        actor_label: "U19 Replica Owner",
        actor_role: "owner",
        request_id: "u19-replica-activation",
        origin: "vantage_admin",
      },
      reason: "Synthetic Unit 19 replica activation fixture.",
      processor_version: "unit-19-replica",
    });
  } catch {
    const raced = await Activation.findOne({ key: "granot_lifecycle" }).lean();
    if (raced?.activated_at) {
      return new Date(new Date(raced.activated_at).getTime() + 60 * 60 * 1000);
    }
    throw new Error("Unable to seed Granot lifecycle activation for replica tests.");
  }
  return capturedAt;
}

function assertNoRawContact(documents: unknown[]): void {
  const serialized = JSON.stringify(documents);
  assert.equal(serialized.includes(SYNTHETIC_PHONE), false);
  assert.equal(serialized.includes(SYNTHETIC_EMAIL), false);
}

async function seedReceipt(observation: GranotObservationDocument): Promise<void> {
  const existing = await getGranotObservationReceiptModel()
    .findById(observation.receipt_id)
    .lean();
  if (existing) return;
  await getGranotObservationReceiptModel().create({
    _id: observation.receipt_id,
    source_system: "granot",
    observation_channel: "granot_webhook",
    captured_at: observation.captured_at,
    route_event_class: observation.route_event_class,
    authentication_method: "header_secret",
    evidence_version: 2,
    payload_kind: "object",
    headers: { "content-type": "application/json" },
    payload: { event_type: "lead_created", priority: "1" },
    payload_sha256: String(observation._id).padEnd(64, "a"),
    processing: {
      state: "pending",
      technical_attempts: 0,
      match_attempt: 0,
      next_attempt_at: observation.captured_at,
      manual_requeue_count: 0,
    },
    provider: "granot",
    initiator: createGranotWebhookInitiator(String(observation.receipt_id)),
  });
}

async function seedObservation(input: {
  job: { raw: string; normalized: string };
  label: string;
  contact?: GranotObservationDocument["contact"];
  move?: GranotObservationDocument["move"];
  route_event_class?: GranotObservationDocument["route_event_class"];
}): Promise<GranotObservationDocument> {
  const observedAt = await postActivationCaptureAt();
  const row = await getGranotObservationModel().create({
    receipt_id: objectId(),
    schema_version: 1,
    kind: "lead_snapshot",
    normalization_result: "valid",
    route_event_class: input.route_event_class ?? "lead_created",
    captured_at: observedAt,
    source_label_raw: input.label,
    normalized_source_label: input.label.toLowerCase(),
    identity: {
      job_no_raw: input.job.raw,
      normalized_job_no: input.job.normalized,
    },
    contact: input.contact ?? {
      first_name: "Ada",
      last_name: "Lovelace",
      display_name: "Ada Lovelace",
      phone_raw: SYNTHETIC_PHONE,
      normalized_phone: SYNTHETIC_PHONE,
      email_raw: SYNTHETIC_EMAIL,
      normalized_email: SYNTHETIC_EMAIL,
    },
    move: input.move ?? {
      origin: { city: "New York", state: "NY", zip: "10001" },
      destination: { city: "Brooklyn", state: "NY", zip: "10002" },
      move_date: new Date("2026-09-01T00:00:00.000Z"),
    },
    priority: { valid: true, canonical: "1", raw: "1" },
    booking_action: {},
    display_money: {},
    agent_identity: {},
    provider_context: {},
    issues: [],
  });
  await seedReceipt(row as GranotObservationDocument);
  return row as GranotObservationDocument;
}

async function seedFormRegistry(suffix: string): Promise<{
  label: string;
  companyId: mongoose.Types.ObjectId;
  localGranularityId: mongoose.Types.ObjectId;
  longGranularityId: mongoose.Types.ObjectId;
  sourceId: mongoose.Types.ObjectId;
}> {
  const companyId = objectId();
  const localGranularityId = objectId();
  const longGranularityId = objectId();
  const label = `U19 Synthetic Forms ${suffix}`;
  await getLeadSourceCompanyModel().create({
    _id: companyId,
    company_slug: `u19-form-${suffix}`,
    name: `U19 Form ${suffix}`,
    owner_label: `U19 Form ${suffix}`,
    active: true,
    created_from: "test",
  });
  await getLeadSourceGranularityModel().create([
    {
      _id: localGranularityId,
      source_company: companyId,
      granularity_key: `u19-form-local-${suffix}`,
      channel: "form",
      owner_label: "U19 Form Local",
      crm_label: "U19 Form Local",
      active: true,
      local: "local",
      created_from: "test",
    },
    {
      _id: longGranularityId,
      source_company: companyId,
      granularity_key: `u19-form-long-${suffix}`,
      channel: "form",
      owner_label: "U19 Form Long",
      crm_label: "U19 Form Long",
      active: true,
      local: "long_distance",
      created_from: "test",
    },
  ]);
  const source = await getGranotCrmSourceModel().create({
    crm_origin: `u19-form-${suffix}`,
    workspace_slug: `u19-form-${suffix}`,
    granot_label: label,
    normalized_granot_label: label.toLowerCase(),
    default_channel: "form",
    enabled: true,
    lifecycle_enabled: true,
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "create_if_missing",
    lead_source_company: companyId,
    lifecycle_policy_version: "granot-lifecycle-source-policy-v1",
    lifecycle_routes: [
      {
        route_key: "form_local",
        lead_model: "FormLead",
        move_type: "local",
        source_granularity_id: localGranularityId,
      },
      {
        route_key: "form_long",
        lead_model: "FormLead",
        move_type: "long_distance",
        source_granularity_id: longGranularityId,
      },
    ],
  });
  return {
    label,
    companyId,
    localGranularityId,
    longGranularityId,
    sourceId: source._id,
  };
}

async function seedCallRegistry(suffix: string): Promise<{
  label: string;
  companyId: mongoose.Types.ObjectId;
  granularityId: mongoose.Types.ObjectId;
  sourceId: mongoose.Types.ObjectId;
  routeId: mongoose.Types.ObjectId;
  assignmentId: mongoose.Types.ObjectId;
}> {
  const companyId = objectId();
  const granularityId = objectId();
  const routeId = objectId();
  const label = `U19 Synthetic Calls ${suffix}`;
  await getLeadSourceCompanyModel().create({
    _id: companyId,
    company_slug: `u19-call-${suffix}`,
    name: `U19 Call ${suffix}`,
    owner_label: `U19 Call ${suffix}`,
    active: true,
    created_from: "test",
  });
  await getLeadSourceGranularityModel().create({
    _id: granularityId,
    source_company: companyId,
    granularity_key: `u19-call-${suffix}`,
    channel: "call",
    owner_label: "U19 Call",
    crm_label: "U19 Call",
    active: true,
    created_from: "test",
  });
  const source = await getGranotCrmSourceModel().create({
    crm_origin: `u19-call-${suffix}`,
    workspace_slug: `u19-call-${suffix}`,
    granot_label: label,
    normalized_granot_label: label.toLowerCase(),
    default_channel: "call",
    enabled: true,
    lifecycle_enabled: true,
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "create_if_missing",
    lead_source_company: companyId,
    lifecycle_policy_version: "granot-lifecycle-source-policy-v1",
    lifecycle_routes: [
      {
        route_key: "call_any",
        lead_model: "CallLead",
        move_type: "any",
        source_granularity_id: granularityId,
      },
    ],
  });
  const actor = {
    actor_type: "admin",
    actor_id: "u19-test",
    actor_label: "U19 Test",
    actor_role: "admin",
  };
  await getRingCentralInboundRouteModel().create({
    _id: routeId,
    provider: "ringcentral",
    phone_number: `+155519${suffix.replace(/[^0-9a-f]/gi, "").slice(0, 6).padEnd(6, "0")}`,
    display_label: `U19 RC ${suffix}`,
    active: true,
    ever_activated: true,
    validation_status: "valid",
    created_from: "test",
    created_by: actor,
  });
  const assignment = await getRingCentralInboundRouteAssignmentModel().create({
    route: routeId,
    source_company: companyId,
    source_granularity: granularityId,
    effective_from: new Date("2026-01-01T00:00:00.000Z"),
    active: true,
    created_by: actor,
  });
  return {
    label,
    companyId,
    granularityId,
    sourceId: source._id,
    routeId,
    assignmentId: assignment._id,
  };
}

function commandInput(input: {
  observation: GranotObservationDocument;
  lead_model: "FormLead" | "CallLead";
  source_scope: {
    granot_crm_source_id: mongoose.Types.ObjectId;
    lead_source_company: mongoose.Types.ObjectId;
    source_granularity_id: mongoose.Types.ObjectId;
  };
  checksum?: string;
}) {
  const observationId = String(input.observation._id);
  const receiptId = String(input.observation.receipt_id);
  const source_scope = {
    ...input.source_scope,
    disposition: "source_scoped_lead" as const,
    policy_version: "granot-lifecycle-source-policy-v1",
  };
  return {
    observation_id: observationId,
    lead_model: input.lead_model,
    source_scope: {
      lead_source_company: String(input.source_scope.lead_source_company),
      source_granularity_id: String(input.source_scope.source_granularity_id),
    },
    context: {
      command_id: objectId().toHexString(),
      idempotency_key: createLeadFromGranotIdempotencyKey(observationId),
      payload_checksum:
        input.checksum ??
        createLeadFromGranotPayloadChecksum({
          observation: input.observation,
          source_scope,
          lead_model: input.lead_model,
        }),
      actor: createGranotLifecycleProcessorActor(receiptId),
      initiator: createGranotWebhookInitiator(receiptId),
      provenance: {
        origin: "granot_lifecycle" as const,
        run_id: null,
        source_receipt_id: receiptId,
        source_connection_key: null,
        observation_id: observationId,
        decision_id: objectId().toHexString(),
        observation_channel: "granot_webhook" as const,
      },
    },
  };
}

async function cleanup(ids: {
  observationIds?: mongoose.Types.ObjectId[];
  receiptIds?: mongoose.Types.ObjectId[];
  companyIds?: mongoose.Types.ObjectId[];
  granularityIds?: mongoose.Types.ObjectId[];
  sourceIds?: mongoose.Types.ObjectId[];
  leadIds?: mongoose.Types.ObjectId[];
  jobs?: string[];
  routeIds?: mongoose.Types.ObjectId[];
  assignmentIds?: mongoose.Types.ObjectId[];
}): Promise<void> {
  const db = mongoose.connection.db;
  if (ids.leadIds?.length) {
    await getFormLeadModel().deleteMany({ _id: { $in: ids.leadIds } });
    await getCallLeadModel().deleteMany({ _id: { $in: ids.leadIds } });
    await db?.collection("entity_changes").deleteMany({
      "entity.id": { $in: ids.leadIds.map(String) },
    });
    await DomainCommandExecution.deleteMany({
      "entity_refs.id": { $in: ids.leadIds.map(String) },
    });
    await SheetSyncJob.deleteMany({ entity_id: { $in: ids.leadIds.map(String) } });
  }
  if (ids.jobs?.length) {
    await db?.collection("granot_record_links").deleteMany({
      normalized_job_no: { $in: ids.jobs },
    });
  }
  if (ids.observationIds?.length) {
    await db?.collection("synchronization_decisions").deleteMany({
      observation_id: { $in: ids.observationIds },
    });
    await db?.collection("granot_observations").deleteMany({
      _id: { $in: ids.observationIds },
    });
    await DomainCommandExecution.deleteMany({
      "provenance.observation_id": { $in: ids.observationIds.map(String) },
    });
  }
  if (ids.receiptIds?.length) {
    await db?.collection("granot_webhook_receipts").deleteMany({
      _id: { $in: ids.receiptIds },
    });
  }
  if (ids.sourceIds?.length) {
    await getGranotCrmSourceModel().deleteMany({ _id: { $in: ids.sourceIds } });
  }
  if (ids.granularityIds?.length) {
    await getLeadSourceGranularityModel().deleteMany({ _id: { $in: ids.granularityIds } });
  }
  if (ids.companyIds?.length) {
    await getLeadSourceCompanyModel().deleteMany({ _id: { $in: ids.companyIds } });
  }
  if (ids.assignmentIds?.length) {
    await getRingCentralInboundRouteAssignmentModel().deleteMany({
      _id: { $in: ids.assignmentIds },
    });
  }
  if (ids.routeIds?.length) {
    await getRingCentralInboundRouteModel().deleteMany({ _id: { $in: ids.routeIds } });
  }
}

async function countConvergenceLocks(
  sourceGranularityId: string,
  phone: string,
): Promise<number> {
  const identity = createHash("sha256")
    .update(`v1:${sourceGranularityId}:${phone}`)
    .digest("hex");
  const db = await getRingCentralDb();
  return db
    .collection(getRingCentralCollectionName("convergenceLocks"))
    .countDocuments({ _id: identity as never });
}

test("[AC-08] replica concurrent same-Observation replay commits one atomic Form creation chain", async (t) => {
  if (!(await replicaReady(t))) return;
  const suffix = `${Date.now().toString(36)}a`;
  const registry = await seedFormRegistry(suffix);
  const job = jobPair(suffix);
  const incoming = await seedObservation({ job, label: registry.label });
  const db = mongoose.connection.db!;
  const beforeForbidden: Record<string, number> = {};
  for (const name of FORBIDDEN_EFFECT_COLLECTIONS) {
    beforeForbidden[name] = await db.collection(name).countDocuments();
  }
  const formCountBefore = await getFormLeadModel().countDocuments({
    normalized_job_no: job.normalized,
  });
  try {
    const concurrentInputs = [0, 1].map(() =>
      commandInput({
        observation: incoming,
        lead_model: "FormLead",
        source_scope: {
          granot_crm_source_id: registry.sourceId,
          lead_source_company: registry.companyId,
          source_granularity_id: registry.localGranularityId,
        },
      }),
    );
    const [result, concurrentReplay] = await Promise.all(
      concurrentInputs.map((command) =>
        createLeadFromGranot(command, { flags: liveCreationFlags() }),
      ),
    );
    assert.deepEqual(concurrentReplay.entity_refs, result.entity_refs);
    const leadRef = result.entity_refs.find((ref) => ref.model === "FormLead");
    const linkRef = result.entity_refs.find((ref) => ref.model === "GranotRecordLink");
    assert.ok(leadRef);
    assert.ok(linkRef);
    const lead = await getFormLeadModel().findById(leadRef.id).lean();
    assert.equal(lead?.ingestion_origin, "granot_lead_created");
    assert.equal(lead?.post_to_granot, false);
    assert.equal(lead?.normalized_job_no, job.normalized);
    assert.equal(lead?.local, "local");
    assert.equal(lead?.domain_revision, 1);
    assert.equal(String(lead?.lead_source_company), String(registry.companyId));
    assert.equal(String(lead?.source_granularity_id), String(registry.localGranularityId));
    assert.equal(lead?.source_granularity_key, `u19-form-local-${suffix}`);
    assert.equal(lead?.source_company_label_snapshot, `U19 Form ${suffix}`);
    assert.equal(lead?.source_granularity_label_snapshot, "U19 Form Local");
    assert.equal(lead?.crm_source_label_snapshot, "U19 Form Local");
    assert.equal(lead?.cpl, 0);
    assert.equal(lead?.cpl_resolution_status, "missing_rate");
    assert.equal(lead?.cpl_resolution_version, "operations-registry-cpl-v1");
    assert.equal(
      lead?.ingested_contact_snapshot?.evidence_status,
      "captured_at_ingestion",
    );
    assert.equal(lead?.current_contact_provenance?.source_system, "granot");
    assert.equal(lead?.current_move_provenance?.source_system, "granot");
    assert.equal(
      String(lead?.last_accepted_granot_observation?.observation_id),
      String(incoming._id),
    );
    const link = await getGranotRecordLinkModel().findById(linkRef.id).lean();
    assert.equal(link?.state, "active");
    assert.equal(link?.provider, "granot");
    assert.equal(link?.normalized_job_no, job.normalized);
    assert.equal(String(link?.lead_ref?.id), leadRef.id);
    assert.equal(link?.disputed, false);
    const decision = await getSynchronizationDecisionModel()
      .findOne({ observation_id: incoming._id, attempt: 1 })
      .lean();
    assert.equal(decision?.outcome, "created");
    assert.equal(decision?.reason_code, "lead_created_authorized");
    assert.ok(decision?.effects.some((effect) => effect.kind === "lead_created"));
    assert.ok(decision?.effects.some((effect) => effect.kind === "record_link_established"));
    assert.ok(decision?.effects.some((effect) => effect.kind === "sheet_sync_requested"));
    const commands = await DomainCommandExecution.find({
      command_name: "createLeadFromGranot",
      idempotency_key: createLeadFromGranotIdempotencyKey(String(incoming._id)),
    }).lean();
    assert.equal(commands.length, 1);
    assert.equal(commands[0]?.entity_refs.length, 2);
    const changes = await getEntityChangeModel()
      .find({ "entity.id": { $in: [leadRef.id, linkRef.id] } })
      .lean();
    assert.ok(changes.some((change) => change.entity.model === "FormLead"));
    assert.ok(changes.some((change) => change.entity.model === "GranotRecordLink"));
    assert.ok(changes.some((change) => change.revision_before === 0 && change.revision_after === 1));
    const contactField = changes
      .flatMap((change) => change.fields)
      .find((field) => field.path === "name" || field.path === "phone_number");
    if (contactField) {
      assert.equal(contactField.value_mode, "reference_only");
      assert.equal(contactField.before, undefined);
      assert.equal(contactField.after, undefined);
    }
    const outbox = await SheetSyncJob.find({ entity_id: leadRef.id }).lean();
    assert.ok(outbox.some((row) => row.operation === "form_lead.create"));
    assert.equal(
      await getFormLeadModel().countDocuments({ normalized_job_no: job.normalized }),
      formCountBefore + 1,
    );
    assert.equal(
      await getGranotRecordLinkModel().countDocuments({
        normalized_job_no: job.normalized,
        state: "active",
      }),
      1,
    );
    const replay = await createLeadFromGranot(
      commandInput({
        observation: incoming,
        lead_model: "FormLead",
        source_scope: {
          granot_crm_source_id: registry.sourceId,
          lead_source_company: registry.companyId,
          source_granularity_id: registry.localGranularityId,
        },
      }),
      { flags: liveCreationFlags() },
    );
    assert.deepEqual(replay.entity_refs, result.entity_refs);
    assert.equal(
      await DomainCommandExecution.countDocuments({
        command_name: "createLeadFromGranot",
        idempotency_key: createLeadFromGranotIdempotencyKey(String(incoming._id)),
      }),
      1,
    );
    assert.equal(
      await getFormLeadModel().countDocuments({ normalized_job_no: job.normalized }),
      formCountBefore + 1,
    );
    assertNoRawContact([
      decision,
      ...commands,
      ...changes,
      ...outbox,
    ]);
    for (const name of FORBIDDEN_EFFECT_COLLECTIONS) {
      assert.equal(await db.collection(name).countDocuments(), beforeForbidden[name]);
    }
  } finally {
    await cleanup({
      observationIds: [incoming._id],
      receiptIds: [incoming.receipt_id],
      companyIds: [registry.companyId],
      granularityIds: [registry.localGranularityId, registry.longGranularityId],
      sourceIds: [registry.sourceId],
      jobs: [job.normalized],
      leadIds: (
        await getFormLeadModel().find({ normalized_job_no: job.normalized }).select("_id").lean()
      ).map((row) => row._id),
    });
  }
});

test("[AC-08][AC-09] replica Call phone is pending, Job-only is not_applicable, and fabricates no telephony", async (t) => {
  if (!(await replicaReady(t))) return;
  const suffix = `${Date.now().toString(36)}b`;
  const registry = await seedCallRegistry(suffix);
  const phoneJob = jobPair(`${suffix}-phone`);
  const jobOnly = jobPair(`${suffix}-job`);
  const phoneObs = await seedObservation({
    job: phoneJob,
    label: registry.label,
    move: {},
  });
  const jobObs = await seedObservation({
    job: jobOnly,
    label: registry.label,
    contact: {},
    move: {},
  });
  try {
    const phoneResult = await createLeadFromGranot(
      commandInput({
        observation: phoneObs,
        lead_model: "CallLead",
        source_scope: {
          granot_crm_source_id: registry.sourceId,
          lead_source_company: registry.companyId,
          source_granularity_id: registry.granularityId,
        },
      }),
      { flags: liveCreationFlags() },
    );
    const phoneLead = await getCallLeadModel()
      .findById(phoneResult.entity_refs.find((ref) => ref.model === "CallLead")?.id)
      .lean();
    assert.equal(phoneLead?.ingestion_origin, "granot_lead_created");
    assert.equal(phoneLead?.post_to_granot, false);
    assert.equal(phoneLead?.ringcentral_convergence?.state, "pending");
    assert.equal(phoneLead?.duration, undefined);
    assert.equal(phoneLead?.start_time, undefined);
    assert.equal(phoneLead?.end_time, undefined);
    assert.equal(phoneLead?.ringcentral, undefined);
    const outbox = await SheetSyncJob.find({
      entity_id: String(phoneLead?._id),
    }).lean();
    assert.ok(outbox.some((row) => row.operation === "call_lead.create"));

    await getRingCentralInboundRouteAssignmentModel().deleteOne({
      _id: registry.assignmentId,
    });
    await getRingCentralInboundRouteModel().deleteOne({ _id: registry.routeId });
    const jobResult = await createLeadFromGranot(
      commandInput({
        observation: jobObs,
        lead_model: "CallLead",
        source_scope: {
          granot_crm_source_id: registry.sourceId,
          lead_source_company: registry.companyId,
          source_granularity_id: registry.granularityId,
        },
      }),
      { flags: liveCreationFlags() },
    );
    const sparse = await getCallLeadModel()
      .findById(jobResult.entity_refs.find((ref) => ref.model === "CallLead")?.id)
      .lean();
    assert.equal(sparse?.ringcentral_convergence?.state, "not_applicable");
    assert.equal(sparse?.phone_number ?? undefined, undefined);
    assert.equal(sparse?.local ?? undefined, undefined);
    assert.equal(sparse?.duration, undefined);
  } finally {
    const leads = await getCallLeadModel()
      .find({ normalized_job_no: { $in: [phoneJob.normalized, jobOnly.normalized] } })
      .select("_id")
      .lean();
    await cleanup({
      observationIds: [phoneObs._id, jobObs._id],
      receiptIds: [phoneObs.receipt_id, jobObs.receipt_id],
      companyIds: [registry.companyId],
      granularityIds: [registry.granularityId],
      sourceIds: [registry.sourceId],
      jobs: [phoneJob.normalized, jobOnly.normalized],
      leadIds: leads.map((row) => row._id),
      routeIds: [registry.routeId],
      assignmentIds: [registry.assignmentId],
    });
  }
});

test("[AC-08] replica Call creation rejects missing or multiple active route assignments", async (t) => {
  if (!(await replicaReady(t))) return;
  const suffix = `${Date.now().toString(36)}r`;
  const registry = await seedCallRegistry(suffix);
  const routeIds = [registry.routeId];
  const assignmentIds = [registry.assignmentId];
  const observations: GranotObservationDocument[] = [];
  const jobs: string[] = [];
  try {
    await getRingCentralInboundRouteAssignmentModel().updateOne(
      { _id: registry.assignmentId },
      { $set: { active: false } },
    );
    const missingJob = jobPair(`${suffix}-missing`);
    const missing = await seedObservation({
      job: missingJob,
      label: registry.label,
      move: {},
    });
    observations.push(missing);
    jobs.push(missingJob.normalized);
    await assert.rejects(
      () =>
        createLeadFromGranot(
          commandInput({
            observation: missing,
            lead_model: "CallLead",
            source_scope: {
              granot_crm_source_id: registry.sourceId,
              lead_source_company: registry.companyId,
              source_granularity_id: registry.granularityId,
            },
          }),
          { flags: liveCreationFlags() },
        ),
      /route_assignment race/,
    );

    await getRingCentralInboundRouteAssignmentModel().updateOne(
      { _id: registry.assignmentId },
      { $set: { active: true } },
    );
    const secondRoute = objectId();
    const secondAssignment = objectId();
    routeIds.push(secondRoute);
    assignmentIds.push(secondAssignment);
    const actor = {
      actor_type: "admin",
      actor_id: "u19-test",
      actor_label: "U19 Test",
      actor_role: "admin",
    };
    await getRingCentralInboundRouteModel().create({
      _id: secondRoute,
      provider: "ringcentral",
      phone_number: `+155518${suffix.replace(/[^0-9a-f]/gi, "").slice(0, 6).padEnd(6, "0")}`,
      display_label: `U19 RC conflict ${suffix}`,
      active: true,
      ever_activated: true,
      validation_status: "valid",
      created_from: "test",
      created_by: actor,
    });
    await getRingCentralInboundRouteAssignmentModel().create({
      _id: secondAssignment,
      route: secondRoute,
      source_company: registry.companyId,
      source_granularity: registry.granularityId,
      effective_from: new Date("2026-01-01T00:00:00.000Z"),
      active: true,
      created_by: actor,
    });
    const multipleJob = jobPair(`${suffix}-multiple`);
    const multiple = await seedObservation({
      job: multipleJob,
      label: registry.label,
      move: {},
    });
    observations.push(multiple);
    jobs.push(multipleJob.normalized);
    await assert.rejects(
      () =>
        createLeadFromGranot(
          commandInput({
            observation: multiple,
            lead_model: "CallLead",
            source_scope: {
              granot_crm_source_id: registry.sourceId,
              lead_source_company: registry.companyId,
              source_granularity_id: registry.granularityId,
            },
          }),
          { flags: liveCreationFlags() },
        ),
      /route_assignment race/,
    );
    for (const job of jobs) {
      assert.equal(
        await getCallLeadModel().countDocuments({ normalized_job_no: job }),
        0,
      );
      assert.equal(
        await getGranotRecordLinkModel().countDocuments({
          normalized_job_no: job,
        }),
        0,
      );
    }
    assert.equal(
      await getSynchronizationDecisionModel().countDocuments({
        observation_id: { $in: observations.map((row) => row._id) },
      }),
      0,
    );
    assert.equal(
      await DomainCommandExecution.countDocuments({
        "provenance.observation_id": {
          $in: observations.map((row) => String(row._id)),
        },
      }),
      0,
    );
  } finally {
    await cleanup({
      observationIds: observations.map((row) => row._id),
      receiptIds: observations.map((row) => row.receipt_id),
      companyIds: [registry.companyId],
      granularityIds: [registry.granularityId],
      sourceIds: [registry.sourceId],
      jobs,
      routeIds,
      assignmentIds,
    });
  }
});

test("[AC-07][AC-08] replica competing scoped Call phone identity creates nothing", async (t) => {
  if (!(await replicaReady(t))) return;
  const suffix = `${Date.now().toString(36)}p`;
  const registry = await seedCallRegistry(suffix);
  const job = jobPair(`${suffix}-phone`);
  const incoming = await seedObservation({
    job,
    label: registry.label,
    move: {},
  });
  const existing = await getCallLeadModel().create({
    phone_number: SYNTHETIC_PHONE,
    source_company: `u19-call-${suffix}`,
    lead_source_company: registry.companyId,
    source_granularity_id: registry.granularityId,
    ingestion_origin: "vantage_admin",
    post_to_granot: false,
    timestamp: capturedAt,
  });
  try {
    await assert.rejects(
      () =>
        createLeadFromGranot(
          commandInput({
            observation: incoming,
            lead_model: "CallLead",
            source_scope: {
              granot_crm_source_id: registry.sourceId,
              lead_source_company: registry.companyId,
              source_granularity_id: registry.granularityId,
            },
          }),
          { flags: liveCreationFlags() },
        ),
      /identity race/,
    );
    assert.equal(
      await getCallLeadModel().countDocuments({
        source_granularity_id: registry.granularityId,
        normalized_phone_number: SYNTHETIC_PHONE,
      }),
      1,
    );
    assert.equal(
      await getGranotRecordLinkModel().countDocuments({
        normalized_job_no: job.normalized,
      }),
      0,
    );
    assert.equal(
      await getSynchronizationDecisionModel().countDocuments({
        observation_id: incoming._id,
      }),
      0,
    );
  } finally {
    await cleanup({
      observationIds: [incoming._id],
      receiptIds: [incoming.receipt_id],
      companyIds: [registry.companyId],
      granularityIds: [registry.granularityId],
      sourceIds: [registry.sourceId],
      leadIds: [existing._id],
      jobs: [job.normalized],
      routeIds: [registry.routeId],
      assignmentIds: [registry.assignmentId],
    });
  }
});

test("Race A: existing RingCentral Call Lead synchronizes even with adoption off", async (t) => {
  if (!(await replicaReady(t))) return;
  const previousAdoption = process.env.RINGCENTRAL_GRANOT_ADOPTION_ENABLED;
  process.env.RINGCENTRAL_GRANOT_ADOPTION_ENABLED = "false";
  const suffix = `${Date.now().toString(36)}gicc02a`;
  const registry = await seedCallRegistry(suffix);
  const createdJob = jobPair(`${suffix}-sync`);
  const fenceJob = jobPair(`${suffix}-fence`);
  const createdObs = await seedObservation({
    job: createdJob,
    label: registry.label,
    move: {},
    route_event_class: "lead_created",
  });
  const priorityObs = await seedObservation({
    job: createdJob,
    label: registry.label,
    move: {},
    route_event_class: "priority_updated",
  });
  const fenceObs = await seedObservation({
    job: fenceJob,
    label: registry.label,
    move: {},
    route_event_class: "priority_updated",
  });
  const existing = await getCallLeadModel().create({
    phone_number: SYNTHETIC_PHONE,
    source_company: `u19-call-${suffix}`,
    lead_source_company: registry.companyId,
    source_granularity_id: registry.granularityId,
    ingestion_origin: "ringcentral",
    post_to_granot: false,
    timestamp: capturedAt,
    ingested_contact_snapshot: {
      phone_number: SYNTHETIC_PHONE,
      normalized_phone_number: SYNTHETIC_PHONE,
      captured_at: capturedAt,
      evidence_status: "captured_at_ingestion",
    },
  });
  try {
    assert.equal(process.env.RINGCENTRAL_GRANOT_ADOPTION_ENABLED, "false");
    for (const observation of [createdObs, priorityObs]) {
      const result = await processGranotObservation(
        { receipt_id: String(observation.receipt_id) },
        {
          flags: liveCreationFlags(),
          upsertObservation: async () => observation,
        },
      );
      assert.notEqual(result.outcome, "created");
      assert.ok(
        result.outcome === "applied" || result.outcome === "already_current",
      );
    }
    const leads = await getCallLeadModel()
      .find({
        source_granularity_id: registry.granularityId,
        normalized_phone_number: SYNTHETIC_PHONE,
      })
      .lean();
    assert.equal(leads.length, 1);
    assert.equal(String(leads[0]?._id), String(existing._id));
    assert.equal(leads[0]?.ingestion_origin, "ringcentral");

    await assert.rejects(
      () =>
        createLeadFromGranot(
          commandInput({
            observation: fenceObs,
            lead_model: "CallLead",
            source_scope: {
              granot_crm_source_id: registry.sourceId,
              lead_source_company: registry.companyId,
              source_granularity_id: registry.granularityId,
            },
          }),
          { flags: liveCreationFlags() },
        ),
      /identity race/,
    );
    assert.equal(
      await countConvergenceLocks(String(registry.granularityId), SYNTHETIC_PHONE),
      1,
    );
    assert.equal(
      await getCallLeadModel().countDocuments({
        source_granularity_id: registry.granularityId,
        normalized_phone_number: SYNTHETIC_PHONE,
      }),
      1,
    );
    const afterFence = await getCallLeadModel().findById(existing._id).lean();
    assert.equal(afterFence?.ingestion_origin, "ringcentral");
  } finally {
    if (previousAdoption === undefined) {
      delete process.env.RINGCENTRAL_GRANOT_ADOPTION_ENABLED;
    } else {
      process.env.RINGCENTRAL_GRANOT_ADOPTION_ENABLED = previousAdoption;
    }
    await cleanup({
      observationIds: [createdObs._id, priorityObs._id, fenceObs._id],
      receiptIds: [createdObs.receipt_id, priorityObs.receipt_id, fenceObs.receipt_id],
      companyIds: [registry.companyId],
      granularityIds: [registry.granularityId],
      sourceIds: [registry.sourceId],
      leadIds: [existing._id],
      jobs: [createdJob.normalized, fenceJob.normalized],
      routeIds: [registry.routeId],
      assignmentIds: [registry.assignmentId],
    });
  }
});

test("[AC-08] replica exact replay returns stored refs; checksum conflict creates no partial state", async (t) => {
  if (!(await replicaReady(t))) return;
  const suffix = `${Date.now().toString(36)}c`;
  const registry = await seedFormRegistry(suffix);
  const job = jobPair(suffix);
  const incoming = await seedObservation({ job, label: registry.label });
  const leadId = objectId();
  const linkId = objectId();
  const storedChecksum = createLeadFromGranotPayloadChecksum({
    observation: incoming,
    source_scope: {
      granot_crm_source_id: registry.sourceId,
      lead_source_company: registry.companyId,
      source_granularity_id: registry.localGranularityId,
      disposition: "source_scoped_lead",
      policy_version: "granot-lifecycle-source-policy-v1",
    },
    lead_model: "FormLead",
  });
  const receiptId = String(incoming.receipt_id);
  await DomainCommandExecution.create({
    origin: "granot_lifecycle",
    idempotency_key: createLeadFromGranotIdempotencyKey(String(incoming._id)),
    command_id: objectId().toHexString(),
    command_name: "createLeadFromGranot",
    payload_checksum: storedChecksum,
    actor: createGranotLifecycleProcessorActor(receiptId),
    initiator: createGranotWebhookInitiator(receiptId),
    provenance: {
      origin: "granot_lifecycle",
      observation_id: String(incoming._id),
      source_receipt_id: receiptId,
    },
    result: {
      status: "applied",
      entity_refs: [
        { model: "FormLead", id: String(leadId) },
        { model: "GranotRecordLink", id: String(linkId) },
      ],
      warnings: [],
    },
    entity_refs: [
      { model: "FormLead", id: String(leadId) },
      { model: "GranotRecordLink", id: String(linkId) },
    ],
    warnings: [],
    applied_at: capturedAt,
  });
  const formBefore = await getFormLeadModel().countDocuments({
    normalized_job_no: job.normalized,
  });
  try {
    const replayed = await createLeadFromGranot(
      commandInput({
        observation: incoming,
        lead_model: "FormLead",
        source_scope: {
          granot_crm_source_id: registry.sourceId,
          lead_source_company: registry.companyId,
          source_granularity_id: registry.localGranularityId,
        },
      }),
      { flags: liveCreationFlags() },
    );
    assert.deepEqual(replayed.entity_refs, [
      { model: "FormLead", id: String(leadId) },
      { model: "GranotRecordLink", id: String(linkId) },
    ]);
    assert.equal(
      await getFormLeadModel().countDocuments({ normalized_job_no: job.normalized }),
      formBefore,
    );

    await assert.rejects(
      () =>
        createLeadFromGranot(
          commandInput({
            observation: incoming,
            lead_model: "FormLead",
            source_scope: {
              granot_crm_source_id: registry.sourceId,
              lead_source_company: registry.companyId,
              source_granularity_id: registry.localGranularityId,
            },
            checksum: "b".repeat(64),
          }),
          { flags: liveCreationFlags() },
        ),
      DomainCommandIdempotencyConflictError,
    );
    assert.equal(
      await getFormLeadModel().countDocuments({ normalized_job_no: job.normalized }),
      formBefore,
    );
    assert.equal(
      await getGranotRecordLinkModel().countDocuments({
        normalized_job_no: job.normalized,
        state: "active",
      }),
      0,
    );
    assert.equal(
      await getSynchronizationDecisionModel().countDocuments({
        observation_id: incoming._id,
      }),
      0,
    );
    assert.equal(await SheetSyncJob.countDocuments({ entity_id: String(leadId) }), 0);
  } finally {
    await cleanup({
      observationIds: [incoming._id],
      receiptIds: [incoming.receipt_id],
      companyIds: [registry.companyId],
      granularityIds: [registry.localGranularityId, registry.longGranularityId],
      sourceIds: [registry.sourceId],
      jobs: [job.normalized],
    });
  }
});

test("[AC-08] replica rollback after reserved-link identity race leaves zero orphan effects", async (t) => {
  if (!(await replicaReady(t))) return;
  const suffix = `${Date.now().toString(36)}d`;
  const registry = await seedFormRegistry(suffix);
  const job = jobPair(suffix);
  const incoming = await seedObservation({ job, label: registry.label });
  const winnerLead = objectId();
  await getGranotRecordLinkModel().create({
    provider: "granot",
    normalized_job_no: job.normalized,
    job_no_snapshot: job.raw,
    state: "active",
    lead_ref: { model: "FormLead", id: winnerLead },
    source_scope: {
      lead_source_company: registry.companyId,
      source_granularity_id: registry.localGranularityId,
    },
    disputed: false,
    established_by_decision_id: objectId(),
    established_at: capturedAt,
    last_observation_id: objectId(),
    last_observed_at: capturedAt,
    domain_revision: 1,
  });
  const formBefore = await getFormLeadModel().countDocuments({
    normalized_job_no: job.normalized,
  });
  const commandBefore = await DomainCommandExecution.countDocuments({
    "provenance.observation_id": String(incoming._id),
  });
  try {
    await assert.rejects(
      () =>
        createLeadFromGranot(
          commandInput({
            observation: incoming,
            lead_model: "FormLead",
            source_scope: {
              granot_crm_source_id: registry.sourceId,
              lead_source_company: registry.companyId,
              source_granularity_id: registry.localGranularityId,
            },
          }),
          { flags: liveCreationFlags() },
        ),
    );
    assert.equal(
      await getFormLeadModel().countDocuments({ normalized_job_no: job.normalized }),
      formBefore,
    );
    assert.equal(
      await getGranotRecordLinkModel().countDocuments({
        normalized_job_no: job.normalized,
        state: "active",
      }),
      1,
    );
    assert.equal(
      await getSynchronizationDecisionModel().countDocuments({
        observation_id: incoming._id,
      }),
      0,
    );
    assert.equal(
      await DomainCommandExecution.countDocuments({
        "provenance.observation_id": String(incoming._id),
      }),
      commandBefore,
    );
    assert.equal(
      await getEntityChangeModel().countDocuments({
        command_name: "createLeadFromGranot",
        "provenance.observation_id": String(incoming._id),
      }),
      0,
    );
  } finally {
    await cleanup({
      observationIds: [incoming._id],
      receiptIds: [incoming.receipt_id],
      companyIds: [registry.companyId],
      granularityIds: [registry.localGranularityId, registry.longGranularityId],
      sourceIds: [registry.sourceId],
      jobs: [job.normalized],
    });
  }
});

test("[AC-07][AC-08] replica concurrent same-job writers keep one Lead and one active link", async (t) => {
  if (!(await replicaReady(t))) return;
  await getGranotRecordLinkModel().syncIndexes();
  const suffix = `${Date.now().toString(36)}e`;
  const registry = await seedFormRegistry(suffix);
  const job = jobPair(suffix);
  const first = await seedObservation({ job, label: registry.label });
  const second = await seedObservation({ job, label: registry.label });
  try {
    const settled = await Promise.allSettled([
      createLeadFromGranot(
        commandInput({
          observation: first,
          lead_model: "FormLead",
          source_scope: {
            granot_crm_source_id: registry.sourceId,
            lead_source_company: registry.companyId,
            source_granularity_id: registry.localGranularityId,
          },
        }),
        { flags: liveCreationFlags() },
      ),
      createLeadFromGranot(
        commandInput({
          observation: second,
          lead_model: "FormLead",
          source_scope: {
            granot_crm_source_id: registry.sourceId,
            lead_source_company: registry.companyId,
            source_granularity_id: registry.localGranularityId,
          },
        }),
        { flags: liveCreationFlags() },
      ),
    ]);
    const fulfilled = settled.filter((row) => row.status === "fulfilled");
    assert.ok(fulfilled.length >= 1);
    assert.equal(
      await getFormLeadModel().countDocuments({ normalized_job_no: job.normalized }),
      1,
    );
    assert.equal(
      await getGranotRecordLinkModel().countDocuments({
        normalized_job_no: job.normalized,
        state: "active",
      }),
      1,
    );
    const createdCommands = await DomainCommandExecution.countDocuments({
      command_name: "createLeadFromGranot",
      "provenance.observation_id": { $in: [String(first._id), String(second._id)] },
    });
    assert.equal(createdCommands, fulfilled.length);
  } finally {
    const leads = await getFormLeadModel()
      .find({ normalized_job_no: job.normalized })
      .select("_id")
      .lean();
    await cleanup({
      observationIds: [first._id, second._id],
      receiptIds: [first.receipt_id, second.receipt_id],
      companyIds: [registry.companyId],
      granularityIds: [registry.localGranularityId, registry.longGranularityId],
      sourceIds: [registry.sourceId],
      jobs: [job.normalized],
      leadIds: leads.map((row) => row._id),
    });
  }
});

test("[AC-07][AC-08] replica processor race replans the loser through Unit 18", async (t) => {
  if (!(await replicaReady(t))) return;
  const suffix = `${Date.now().toString(36)}u`;
  const registry = await seedFormRegistry(suffix);
  const job = jobPair(suffix);
  const first = await seedObservation({ job, label: registry.label });
  const second = await seedObservation({ job, label: registry.label });
  try {
    const results = await Promise.all([
      processGranotObservation(
        { receipt_id: String(first.receipt_id) },
        {
          flags: liveCreationFlags(),
          upsertObservation: async () => first,
        },
      ),
      processGranotObservation(
        { receipt_id: String(second.receipt_id) },
        {
          flags: liveCreationFlags(),
          upsertObservation: async () => second,
        },
      ),
    ]);
    assert.equal(results.filter((row) => row.outcome === "created").length, 1);
    assert.equal(
      await getFormLeadModel().countDocuments({ normalized_job_no: job.normalized }),
      1,
    );
    const link = await getGranotRecordLinkModel()
      .findOne({ normalized_job_no: job.normalized, state: "active" })
      .lean();
    assert.ok(link?.lead_ref);
    const decisions = await getSynchronizationDecisionModel()
      .find({ observation_id: { $in: [first._id, second._id] } })
      .lean();
    assert.equal(decisions.length, 2);
    assert.equal(
      decisions.filter((row) => row.outcome === "created").length,
      1,
    );
    const loser = decisions.find((row) => row.outcome !== "created");
    assert.ok(loser);
    assert.equal(loser.effects.some((effect) => effect.kind === "lead_created"), false);
    assert.equal(loser.target?.id, String(link.lead_ref.id));
  } finally {
    const leads = await getFormLeadModel()
      .find({ normalized_job_no: job.normalized })
      .select("_id")
      .lean();
    await cleanup({
      observationIds: [first._id, second._id],
      receiptIds: [first.receipt_id, second.receipt_id],
      companyIds: [registry.companyId],
      granularityIds: [registry.localGranularityId, registry.longGranularityId],
      sourceIds: [registry.sourceId],
      jobs: [job.normalized],
      leadIds: leads.map((row) => row._id),
    });
  }
});

test("[AC-08] replica rolls back Lead/link/Change/Decision/Command/outbox stage failures", async (t) => {
  if (!(await replicaReady(t))) return;
  const suffix = `${Date.now().toString(36)}f`;
  const registry = await seedFormRegistry(suffix);
  const stages = ["lead", "link", "changes", "decision", "outbox"] as const;
  const observations: GranotObservationDocument[] = [];
  const jobs: string[] = [];
  const seededCommandIds: mongoose.Types.ObjectId[] = [];
  try {
    for (const stage of stages) {
      const job = jobPair(`${suffix}-${stage}`);
      const incoming = await seedObservation({ job, label: registry.label });
      observations.push(incoming);
      jobs.push(job.normalized);
      const outboxBefore = await SheetSyncJob.countDocuments();
      await assert.rejects(
        () =>
          createLeadFromGranot(
            commandInput({
              observation: incoming,
              lead_model: "FormLead",
              source_scope: {
                granot_crm_source_id: registry.sourceId,
                lead_source_company: registry.companyId,
                source_granularity_id: registry.localGranularityId,
              },
            }),
            { flags: liveCreationFlags(), fail_after: stage },
          ),
        new RegExp(`rollback after ${stage}`),
      );
      assert.equal(
        await getFormLeadModel().countDocuments({ normalized_job_no: job.normalized }),
        0,
      );
      assert.equal(
        await getGranotRecordLinkModel().countDocuments({
          normalized_job_no: job.normalized,
          state: "active",
        }),
        0,
      );
      assert.equal(
        await getSynchronizationDecisionModel().countDocuments({
          observation_id: incoming._id,
        }),
        0,
      );
      assert.equal(
        await DomainCommandExecution.countDocuments({
          "provenance.observation_id": String(incoming._id),
        }),
        0,
      );
      assert.equal(
        await getEntityChangeModel().countDocuments({
          "provenance.observation_id": incoming._id,
        }),
        0,
      );
      assert.equal(await SheetSyncJob.countDocuments(), outboxBefore);
    }

    const commandJob = jobPair(`${suffix}-command`);
    const commandObservation = await seedObservation({
      job: commandJob,
      label: registry.label,
    });
    observations.push(commandObservation);
    jobs.push(commandJob.normalized);
    const command = commandInput({
      observation: commandObservation,
      lead_model: "FormLead",
      source_scope: {
        granot_crm_source_id: registry.sourceId,
        lead_source_company: registry.companyId,
        source_granularity_id: registry.localGranularityId,
      },
    });
    const seededId = objectId();
    seededCommandIds.push(seededId);
    await DomainCommandExecution.create({
      _id: seededId,
      origin: "vantage_admin",
      idempotency_key: `u19-command-collision:${seededId}`,
      command_id: command.context.command_id,
      command_name: "createFormLead",
      payload_checksum: "a".repeat(64),
      actor: {
        actor_type: "system",
        actor_id: "vantage-api-secret",
        actor_label: "U19 test collision",
        actor_role: "system",
        request_id: `u19-command-collision:${seededId}`,
      },
      initiator: {
        actor_type: "system",
        actor_id: "vantage-api-secret",
        actor_label: "U19 test collision",
        actor_role: "system",
        request_id: `u19-command-collision:${seededId}`,
      },
      provenance: {
        origin: "vantage_admin",
        run_id: null,
        source_receipt_id: null,
        source_connection_key: null,
      },
      result: { status: "applied", entity_refs: [], warnings: [] },
      entity_refs: [],
      warnings: [],
      applied_at: capturedAt,
    });
    const outboxBefore = await SheetSyncJob.countDocuments();
    await assert.rejects(() =>
      createLeadFromGranot(command, { flags: liveCreationFlags() }),
    );
    assert.equal(
      await getFormLeadModel().countDocuments({
        normalized_job_no: commandJob.normalized,
      }),
      0,
    );
    assert.equal(
      await getGranotRecordLinkModel().countDocuments({
        normalized_job_no: commandJob.normalized,
      }),
      0,
    );
    assert.equal(
      await getSynchronizationDecisionModel().countDocuments({
        observation_id: commandObservation._id,
      }),
      0,
    );
    assert.equal(
      await getEntityChangeModel().countDocuments({
        "provenance.observation_id": commandObservation._id,
      }),
      0,
    );
    assert.equal(await SheetSyncJob.countDocuments(), outboxBefore);
  } finally {
    await cleanup({
      observationIds: observations.map((row) => row._id),
      receiptIds: observations.map((row) => row.receipt_id),
      companyIds: [registry.companyId],
      granularityIds: [registry.localGranularityId, registry.longGranularityId],
      sourceIds: [registry.sourceId],
      jobs,
    });
    if (seededCommandIds.length > 0) {
      await DomainCommandExecution.collection.deleteMany({
        _id: { $in: seededCommandIds },
      });
    }
  }
});
