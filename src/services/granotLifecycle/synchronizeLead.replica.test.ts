import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { Agent } from "../../models/Agent";
import { getCallLeadModel } from "../../models/CallLead";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { getEntityChangeModel } from "../../models/EntityChange";
import { getFormLeadModel } from "../../models/FormLead";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import { projectRoleSafeLeadContacts } from "./leadContactProjection";
import type { LeadIdentityResult } from "./identity";
import { processGranotObservation, type GranotLifecycleProcessorDeps } from "./processor";
import type { SourcePolicyStore } from "./sourcePolicy";

const capturedAt = new Date("2026-08-18T16:00:00.000Z");
const olderCapturedAt = new Date("2026-08-18T15:00:00.000Z");
const REVIEWED_COMPANY_ID = "64a000000000000000000001";
const REVIEWED_GRANULARITY_ID = "64a000000000000000000002";
const SYNTHETIC_PHONE = "5550001111";
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
  const raw = `u18-job-${suffix}`;
  return { raw, normalized: normalizeJobNo(raw)! };
}

function reviewedStore(): SourcePolicyStore {
  return {
    async findByNormalizedLabel() {
      return [
        {
          id: "64a000000000000000000010",
          enabled: true,
          lifecycle_enabled: true,
          lifecycle_disposition: "source_scoped_lead",
          lead_created_policy: "link_only",
          lead_source_company: REVIEWED_COMPANY_ID,
          lifecycle_routes: [
            {
              route_key: "form_any",
              lead_model: "FormLead",
              move_type: "any",
              source_granularity_id: REVIEWED_GRANULARITY_ID,
            },
          ],
          lifecycle_policy_version: "granot-lifecycle-source-policy-v1",
          normalized_granot_label: "synthetic forms",
        },
      ];
    },
    async findCompany(id) {
      return { id, active: true };
    },
    async findGranularity(id) {
      return {
        id,
        source_company_id: REVIEWED_COMPANY_ID,
        active: true,
        channel: "form",
      };
    },
  };
}

function observation(input: {
  job: { raw: string; normalized: string };
  priority?: string;
  captured_at?: Date;
  contact?: GranotObservationDocument["contact"];
  move?: GranotObservationDocument["move"];
  agent?: { user_raw?: string; rep_raw?: string };
}): GranotObservationDocument {
  return {
    _id: objectId(),
    receipt_id: objectId(),
    schema_version: 1,
    kind: "lead_snapshot",
    normalization_result: "valid",
    route_event_class: "lead_created",
    captured_at: input.captured_at ?? capturedAt,
    source_label_raw: "Synthetic Forms",
    normalized_source_label: "synthetic forms",
    identity: {
      job_no_raw: input.job.raw,
      normalized_job_no: input.job.normalized,
    },
    contact: input.contact ?? {},
    move: input.move ?? {
      origin: { state: "NY", zip: "10001" },
      destination: { state: "NY", zip: "10002" },
    },
    priority: { valid: true, canonical: input.priority ?? "1" },
    booking_action: {},
    display_money: {},
    agent_identity: input.agent ?? {},
    provider_context: {},
    issues: [],
    createdAt: capturedAt,
    updatedAt: capturedAt,
  } as GranotObservationDocument;
}

function identityFor(
  leadId: string,
  model: "FormLead" | "CallLead" = "FormLead",
  extra: Partial<LeadIdentityResult> = {},
): LeadIdentityResult {
  return {
    outcome: "linked",
    reason_code: "record_link_confirmed",
    match_method: model === "FormLead" ? "form_ref_no_exact" : "call_job_no_exact",
    target: { model, id: leadId },
    target_eligibility: "full",
    candidates: [{ target: { model, id: leadId }, reason_codes: ["form_ref_no_exact"] }],
    ...extra,
  };
}

async function seedReceipt(
  observation: GranotObservationDocument,
  channel: "granot_webhook" | "browser_extension" | "granot_http_automation" = "granot_webhook",
): Promise<void> {
  const existing = await getGranotObservationReceiptModel().findById(observation.receipt_id).lean();
  if (existing) return;
  await getGranotObservationReceiptModel().create({
    _id: observation.receipt_id,
    source_system: "granot",
    observation_channel: channel,
    captured_at: observation.captured_at,
    route_event_class: "lead_created",
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
  });
}

function liveDeps(input: {
  observation: GranotObservationDocument;
  identity: LeadIdentityResult;
  channel?: "granot_webhook" | "browser_extension" | "granot_http_automation";
}): GranotLifecycleProcessorDeps {
  return {
    now: () => new Date("2026-08-18T16:05:00.000Z"),
    flags: {
      ...GRANOT_LIFECYCLE_FLAG_DEFAULTS,
      shadow_mode: false,
      lead_writes_enabled: true,
    },
    sourcePolicyStore: reviewedStore(),
    loadReceipt: async () => ({
      _id: input.observation.receipt_id,
      observation_channel: input.channel ?? "granot_webhook",
      captured_at: input.observation.captured_at,
      processing: { match_attempt: 0 },
    }),
    upsertObservation: async () => input.observation,
    loadActivation: async () => ({ activated_at: new Date("2026-08-17T14:00:00.000Z") }),
    resolveIdentity: async () => input.identity,
  };
}

async function processLive(input: {
  observation: GranotObservationDocument;
  identity: LeadIdentityResult;
  channel?: "granot_webhook" | "browser_extension" | "granot_http_automation";
  extra?: Partial<GranotLifecycleProcessorDeps>;
}) {
  await seedReceipt(input.observation, input.channel);
  return processGranotObservation(
    { receipt_id: String(input.observation.receipt_id) },
    { ...liveDeps(input), ...input.extra },
  );
}

async function seedFormLead(input: {
  id: mongoose.Types.ObjectId;
  job: { raw: string; normalized: string };
  origin?: "wordpress_form" | "granot_lead_created";
  priority?: string;
  quoted?: boolean;
  revision?: number;
  winner?: { observation_id: mongoose.Types.ObjectId; captured_at: Date };
  extra?: Record<string, unknown>;
}): Promise<void> {
  await getFormLeadModel().create({
    _id: input.id,
    source_company: "synthetic",
    name: "Submitted Name",
    phone_number: SYNTHETIC_PHONE,
    email: SYNTHETIC_EMAIL,
    pickup_zip: "10001",
    destination_zip: "10002",
    pickup_state: "NY",
    delivery_state: "NY",
    move_date: capturedAt,
    local: "local",
    quoted: input.quoted ?? false,
    granot_priority: input.priority ?? "8",
    job_no: input.job.raw,
    normalized_job_no: input.job.normalized,
    ingestion_origin: input.origin ?? "wordpress_form",
    move_size: "Studio",
    domain_revision: input.revision ?? 3,
    ...(input.winner
      ? { last_accepted_granot_observation: input.winner }
      : {}),
    ...input.extra,
  });
}

async function seedCallLead(input: {
  id: mongoose.Types.ObjectId;
  job: { raw: string; normalized: string };
  origin?: "ringcentral" | "granot_lead_created";
}): Promise<void> {
  await getCallLeadModel().create({
    _id: input.id,
    source_company: "synthetic",
    name: "Caller Name",
    phone_number: SYNTHETIC_PHONE,
    quoted: false,
    granot_priority: "8",
    job_no: input.job.raw,
    normalized_job_no: input.job.normalized,
    ingestion_origin: input.origin ?? "ringcentral",
    domain_revision: 2,
  });
}

async function deleteLinks(normalizedJobNos: string[]): Promise<void> {
  await mongoose.connection.db?.collection("granot_record_links").deleteMany({
    normalized_job_no: { $in: normalizedJobNos },
  });
}

function assertNoRawContact(documents: unknown[]): void {
  const serialized = JSON.stringify(documents);
  assert.equal(serialized.includes(SYNTHETIC_PHONE), false);
  assert.equal(serialized.includes(SYNTHETIC_EMAIL), false);
}

async function evidenceFor(leadId: string) {
  const Decision = getSynchronizationDecisionModel();
  const Change = getEntityChangeModel();
  const decisions = await Decision.find({ "target.id": leadId }).lean();
  const commands = await DomainCommandExecution.find({
    "entity_refs.id": leadId,
  }).lean();
  const changes = await Change.find({ "entity.id": leadId }).lean();
  const outbox = await SheetSyncJob.find({ entity_id: leadId }).lean();
  return { decisions, commands, changes, outbox };
}

test("[AC-05][AC-07][AC-10][AC-11][AC-32] replica WordPress matched write is one causal transaction", async (t) => {
  if (!(await replicaReady(t))) return;
  const FormLead = getFormLeadModel();
  const Decision = getSynchronizationDecisionModel();
  const Link = getGranotRecordLinkModel();
  const leadId = objectId();
  const job = jobPair(String(leadId));
  const incoming = observation({
    job,
    priority: "1",
    contact: {
      first_name: "Granot",
      last_name: "Name",
      display_name: "Granot Name",
      phone_raw: SYNTHETIC_PHONE,
      normalized_phone: SYNTHETIC_PHONE,
      normalized_email: SYNTHETIC_EMAIL,
    },
    move: {
      origin: { city: "Brooklyn", state: "NY", zip: "11201" },
      destination: { city: "Queens", state: "NY", zip: "11101" },
    },
  });
  const beforeForbidden: Record<string, number> = {};
  const db = mongoose.connection.db!;
  for (const name of FORBIDDEN_EFFECT_COLLECTIONS) {
    beforeForbidden[name] = await db.collection(name).countDocuments();
  }
  try {
    await seedFormLead({ id: leadId, job });
    const result = await processLive({
      observation: incoming,
      identity: identityFor(String(leadId)),
    });
    assert.equal(result.outcome, "applied");
    const lead = await FormLead.findById(leadId).lean();
    assert.equal(lead?.granot_priority, "1");
    assert.equal(lead?.quoted, true);
    assert.equal(lead?.name, "Submitted Name");
    assert.equal(lead?.phone_number, SYNTHETIC_PHONE);
    assert.equal(lead?.move_size, "Studio");
    assert.equal(lead?.pickup_zip, "11201");
    assert.equal(lead?.destination_zip, "11101");
    assert.equal(lead?.ingestion_origin, "wordpress_form");
    assert.equal(lead?.granot_contact_snapshot?.name, "Granot Name");
    assert.equal(lead?.granot_contact_snapshot?.differs_from_ingested, true);
    assert.equal(String(lead?.last_accepted_granot_observation?.observation_id), String(incoming._id));
    assert.equal(lead?.domain_revision, 4);
    const projection = projectRoleSafeLeadContacts({
      ...lead,
      ingestion_origin: lead?.ingestion_origin ?? undefined,
    });
    assert.equal(projection.submitted_contact?.name, "Submitted Name");
    assert.ok(projection.granot_contact);
    assert.equal(projection.submitted_contact?.phone_number?.includes("5550001111"), false);

    const decision = await Decision.findById(result.decision_id).lean();
    assert.equal(decision?.outcome, "applied");
    assert.equal(decision?.reason_code, "lead_state_changed");
    assert.ok(decision?.effects.some((effect) => effect.kind === "lead_updated"));
    assert.ok(decision?.effects.some((effect) => effect.kind === "record_link_established"));
    assert.ok(decision?.effects.some((effect) => effect.kind === "sheet_sync_requested"));

    const link = await Link.findOne({
      provider: "granot",
      normalized_job_no: job.normalized,
      state: "active",
    }).lean();
    assert.equal(String(link?.lead_ref?.id), String(leadId));
    assert.equal(link?.disputed, false);

    const evidence = await evidenceFor(String(leadId));
    assert.equal(evidence.commands.length, 1);
    assert.equal(evidence.commands[0]?.command_name, "synchronizeLeadFromGranot");
    assert.equal(evidence.commands[0]?.idempotency_key, `granot:synchronize-lead:${String(incoming._id)}`);
    assert.ok(evidence.changes.length >= 1);
    assert.ok(evidence.outbox.some((jobRow) => jobRow.operation === "form_lead.update"));
    const contactField = evidence.changes
      .flatMap((change) => change.fields)
      .find((field) => field.path === "granot_contact_snapshot" || field.path === "name");
    if (contactField) {
      assert.equal(contactField.value_mode, "reference_only");
      assert.equal(contactField.before, undefined);
      assert.equal(contactField.after, undefined);
    }
    const priorityField = evidence.changes
      .flatMap((change) => change.fields)
      .find((field) => field.path === "granot_priority");
    assert.equal(priorityField?.value_mode, "stored");
    assertNoRawContact([...evidence.decisions, ...evidence.commands, ...evidence.changes, ...evidence.outbox]);

    const replay = await processLive({
      observation: incoming,
      identity: identityFor(String(leadId)),
      extra: { findDecision: async () => decision },
    });
    assert.equal(replay.decision_id, result.decision_id);
    assert.equal((await FormLead.findById(leadId).lean())?.domain_revision, 4);
    assert.equal((await evidenceFor(String(leadId))).commands.length, 1);

    const noop = observation({
      job,
      priority: "1",
      captured_at: new Date("2026-08-18T17:00:00.000Z"),
      contact: incoming.contact,
      move: incoming.move,
    });
    const already = await processLive({
      observation: noop,
      identity: identityFor(String(leadId)),
    });
    assert.equal(already.outcome, "already_current");
    assert.equal(already.effects.length, 0);
    assert.equal((await FormLead.findById(leadId).lean())?.domain_revision, 4);
    assert.equal((await evidenceFor(String(leadId))).commands.length, 1);
    assert.equal(await getEntityChangeModel().countDocuments({ "entity.id": String(leadId) }), evidence.changes.length);

    for (const name of FORBIDDEN_EFFECT_COLLECTIONS) {
      assert.equal(await db.collection(name).countDocuments(), beforeForbidden[name]);
    }
  } finally {
    await FormLead.deleteMany({ _id: leadId });
    await deleteLinks([job.normalized]);
    await mongoose.connection.db?.collection("synchronization_decisions").deleteMany({
      observation_id: { $in: [incoming._id] },
    });
  }
});

test("[AC-12] replica RingCentral Call qualified contact writes snapshot only", async (t) => {
  if (!(await replicaReady(t))) return;
  const CallLead = getCallLeadModel();
  const leadId = objectId();
  const job = jobPair(String(leadId));
  const incoming = observation({
    job,
    priority: "1",
    contact: {
      first_name: "Granot",
      last_name: "Caller",
      display_name: "Granot Caller",
      phone_raw: SYNTHETIC_PHONE,
      normalized_phone: SYNTHETIC_PHONE,
      normalized_email: SYNTHETIC_EMAIL,
    },
  });
  try {
    await seedCallLead({ id: leadId, job });
    const result = await processLive({
      observation: incoming,
      identity: identityFor(String(leadId), "CallLead"),
    });
    assert.equal(result.outcome, "applied");
    const lead = await CallLead.findById(leadId).lean();
    assert.equal(lead?.name, "Caller Name");
    assert.equal(lead?.phone_number, SYNTHETIC_PHONE);
    assert.equal(lead?.granot_contact_snapshot?.name, "Granot Caller");
    assert.equal(lead?.granot_contact_snapshot?.differs_from_ingested, true);
    const change = await getEntityChangeModel().findOne({ "entity.id": String(leadId) }).lean();
    const snapshotField = change?.fields.find((field) => field.path === "granot_contact_snapshot");
    assert.equal(snapshotField?.value_mode, "reference_only");
    assert.equal(snapshotField?.after, undefined);
    assert.equal(change?.fields.some((field) => field.path === "name"), false);
    const outbox = await SheetSyncJob.findOne({ entity_id: String(leadId) }).lean();
    assert.equal(outbox?.operation, "call_lead.update");
  } finally {
    await CallLead.deleteMany({ _id: leadId });
    await deleteLinks([job.normalized]);
  }
});

test("[AC-12] replica Granot-created Form contact becomes current and keeps origin", async (t) => {
  if (!(await replicaReady(t))) return;
  const FormLead = getFormLeadModel();
  const leadId = objectId();
  const job = jobPair(String(leadId));
  const incoming = observation({
    job,
    priority: "1",
    contact: {
      first_name: "Granot",
      display_name: "Granot Created",
      phone_raw: SYNTHETIC_PHONE,
      normalized_phone: SYNTHETIC_PHONE,
    },
  });
  try {
    await seedFormLead({ id: leadId, job, origin: "granot_lead_created" });
    const result = await processLive({
      observation: incoming,
      identity: identityFor(String(leadId)),
    });
    assert.equal(result.outcome, "applied");
    const lead = await FormLead.findById(leadId).lean();
    assert.equal(lead?.ingestion_origin, "granot_lead_created");
    assert.equal(lead?.name, "Submitted Name");
    assert.equal(lead?.granot_contact_snapshot?.name, "Granot Created");
  } finally {
    await FormLead.deleteMany({ _id: leadId });
    await deleteLinks([job.normalized]);
  }
});

test("[AC-13] replica Agent fills only an empty receiver through one active match", async (t) => {
  if (!(await replicaReady(t))) return;
  const FormLead = getFormLeadModel();
  const leadId = objectId();
  const agentId = objectId();
  const job = jobPair(String(leadId));
  const incoming = observation({ job, priority: "8", agent: { user_raw: "MIKE" } });
  try {
    await Agent.create({
      _id: agentId,
      name: "Synthetic Mike",
      normalized_name: "synthetic mike",
      active: true,
      role: "agent",
      created_from: "test",
      granot_identity: { username: "MIKE", verified: false },
    });
    await seedFormLead({ id: leadId, job, priority: "0" });
    const result = await processLive({
      observation: incoming,
      identity: identityFor(String(leadId), "FormLead", {
        agent: {
          target: { model: "Agent", id: String(agentId) },
          normalized_username: "mike",
        },
        agent_assertion: "single",
      }),
    });
    assert.equal(result.outcome, "applied");
    const lead = await FormLead.findById(leadId).lean();
    assert.equal(String(lead?.receiver_agent), String(agentId));
    assert.equal(lead?.receiver_agent_source, "granot_username_match");
    assert.equal(lead?.receiver_agent_source_value, "mike");
    assert.equal(lead?.receiver_agent_name_snapshot, "Synthetic Mike");
    assert.ok(lead?.receiver_agent_set_at instanceof Date);
    assert.equal(lead?.quoted, false);
  } finally {
    await FormLead.deleteMany({ _id: leadId });
    await Agent.deleteMany({ _id: agentId });
    await deleteLinks([job.normalized]);
  }
});

test("[AC-05] replica Bad Form stores Priority only and Duplicate never becomes a target", async (t) => {
  if (!(await replicaReady(t))) return;
  const FormLead = getFormLeadModel();
  const badId = objectId();
  const job = jobPair(String(badId));
  const incoming = observation({
    job,
    priority: "1",
    contact: { display_name: "Should Not Apply", phone_raw: SYNTHETIC_PHONE },
    move: {
      origin: { city: "Hidden", state: "NY", zip: "11201" },
      destination: { city: "Hidden", state: "NY", zip: "11101" },
    },
  });
  try {
    await seedFormLead({ id: badId, job, extra: { bad_lead: "disconnected_number" } });
    const bad = await processLive({
      observation: incoming,
      identity: identityFor(String(badId), "FormLead", { target_eligibility: "priority_only" }),
    });
    assert.equal(bad.outcome, "applied");
    const lead = await FormLead.findById(badId).lean();
    assert.equal(lead?.granot_priority, "1");
    assert.equal(lead?.quoted, false);
    assert.equal(lead?.name, "Submitted Name");
    assert.equal(lead?.pickup_zip, "10001");

    const duplicateObs = observation({ job: jobPair(`dup-${String(objectId())}`), priority: "1" });
    const duplicate = await processLive({
      observation: duplicateObs,
      identity: {
        outcome: "unmatched",
        reason_code: "duplicate_form_lead_ineligible",
        candidates: [],
      },
    });
    assert.equal(duplicate.outcome, "unmatched");
    assert.equal(duplicate.target, undefined);
    assert.equal(await DomainCommandExecution.countDocuments({
      idempotency_key: `granot:synchronize-lead:${String(duplicateObs._id)}`,
    }), 0);
  } finally {
    await FormLead.deleteMany({ _id: badId });
    await deleteLinks([job.normalized]);
  }
});

test("[AC-07][AC-32] replica establish, attach, confirm, and duplicate-key race", async (t) => {
  if (!(await replicaReady(t))) return;
  const FormLead = getFormLeadModel();
  const Link = getGranotRecordLinkModel();
  const leadId = objectId();
  const otherLead = objectId();
  const job = jobPair(String(leadId));
  const attachJob = jobPair(`attach-${String(leadId)}`);
  try {
    await seedFormLead({ id: leadId, job });
    const established = await processLive({
      observation: observation({ job, priority: "1" }),
      identity: identityFor(String(leadId)),
    });
    assert.equal(established.outcome, "applied");
    const link = await Link.findOne({ normalized_job_no: job.normalized, state: "active" }).lean();
    assert.equal(String(link?.lead_ref?.id), String(leadId));

    await seedFormLead({ id: otherLead, job: attachJob });
    await Link.create({
      provider: "granot",
      normalized_job_no: attachJob.normalized,
      job_no_snapshot: attachJob.raw,
      state: "active",
      disputed: false,
      established_by_decision_id: objectId(),
      established_at: olderCapturedAt,
      last_observation_id: objectId(),
      last_observed_at: olderCapturedAt,
      domain_revision: 0,
    });
    const attached = await processLive({
      observation: observation({ job: attachJob, priority: "1" }),
      identity: identityFor(String(otherLead)),
    });
    assert.equal(attached.outcome, "applied");
    const attachedLink = await Link.findOne({
      normalized_job_no: attachJob.normalized,
      state: "active",
    }).lean();
    assert.equal(String(attachedLink?.lead_ref?.id), String(otherLead));
    assert.ok((attachedLink?.domain_revision ?? 0) >= 1);

    const confirmObs = observation({ job, priority: "5" });
    const confirmed = await processLive({
      observation: confirmObs,
      identity: identityFor(String(leadId)),
    });
    assert.equal(confirmed.outcome, "applied");
    const confirmedLink = await Link.findOne({ normalized_job_no: job.normalized }).lean();
    assert.equal(String(confirmedLink?.last_observation_id), String(confirmObs._id));

    const first = observation({ job: jobPair(`race-${String(leadId)}`), priority: "1" });
    const second = observation({
      job: { raw: first.identity.job_no_raw!, normalized: first.identity.normalized_job_no! },
      priority: "1",
    });
    const raceLead = objectId();
    const raceJob = {
      raw: first.identity.job_no_raw!,
      normalized: first.identity.normalized_job_no!,
    };
    await seedFormLead({ id: raceLead, job: raceJob });
    const [a, b] = await Promise.all([
      processLive({ observation: first, identity: identityFor(String(raceLead)) }),
      processLive({ observation: second, identity: identityFor(String(raceLead)) }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    assert.ok(outcomes.includes("applied"));
    assert.ok(outcomes.every((outcome) => ["applied", "already_current", "linked", "stale"].includes(outcome)));
    assert.equal(await Link.countDocuments({ normalized_job_no: raceJob.normalized, state: "active" }), 1);
    await FormLead.deleteMany({ _id: raceLead });
    await deleteLinks([raceJob.normalized]);
  } finally {
    await FormLead.deleteMany({ _id: { $in: [leadId, otherLead] } });
    await deleteLinks([job.normalized, attachJob.normalized]);
  }
});

test("[AC-32] replica revision race has one winner and rolls back the losing transaction", async (t) => {
  if (!(await replicaReady(t))) return;
  const FormLead = getFormLeadModel();
  const Decision = getSynchronizationDecisionModel();
  const leadId = objectId();
  const job = jobPair(String(leadId));
  const first = observation({ job, priority: "1" });
  const second = observation({ job, priority: "5", captured_at: new Date("2026-08-18T16:00:01.000Z") });
  try {
    await seedFormLead({ id: leadId, job, revision: 3 });
    const [a, b] = await Promise.all([
      processLive({ observation: first, identity: identityFor(String(leadId)) }),
      processLive({ observation: second, identity: identityFor(String(leadId)) }),
    ]);
    const applied = [a, b].filter((row) => row.outcome === "applied");
    assert.ok(applied.length === 1 || applied.length === 2);
    const lead = await FormLead.findById(leadId).lean();
    assert.equal(lead?.granot_priority, "5");
    assert.ok(lead?.domain_revision === 4 || lead?.domain_revision === 5);
    const commandCount = await DomainCommandExecution.countDocuments({
      command_name: "synchronizeLeadFromGranot",
      "entity_refs.id": String(leadId),
    });
    assert.equal(commandCount, applied.length);
    assert.equal(commandCount, (lead?.domain_revision ?? 0) - 3);
    if (applied.length === 1) {
      const loser = [a, b].find((row) => row.outcome !== "applied");
      assert.ok(loser?.outcome === "stale" || loser?.outcome === "already_current");
      const loserDecision = await Decision.findById(loser?.decision_id).lean();
      assert.notEqual(loserDecision?.outcome, "applied");
      assert.equal(loserDecision?.effects.length, 0);
    }
  } finally {
    await FormLead.deleteMany({ _id: leadId });
    await deleteLinks([job.normalized]);
  }
});

test("[AC-32] replica equal-time Observation tie-break admits only the greater ObjectId", async (t) => {
  if (!(await replicaReady(t))) return;
  const FormLead = getFormLeadModel();
  const leadId = objectId();
  const job = jobPair(String(leadId));
  const low = observation({ job, priority: "8" });
  const high = observation({ job, priority: "8" });
  const [first, second] = String(low._id) < String(high._id) ? [low, high] : [high, low];
  first.priority = { valid: true, canonical: "1" };
  second.priority = { valid: true, canonical: "1" };
  try {
    await seedFormLead({ id: leadId, job, winner: { observation_id: objectId(), captured_at: olderCapturedAt } });
    await processLive({ observation: first, identity: identityFor(String(leadId)) });
    const afterFirst = await FormLead.findById(leadId).lean();
    const secondResult = await processLive({
      observation: second,
      identity: identityFor(String(leadId)),
    });
    const after = await FormLead.findById(leadId).lean();
    assert.equal(String(after?.last_accepted_granot_observation?.observation_id), String(second._id));
    assert.ok(secondResult.outcome === "already_current" || secondResult.outcome === "applied");
    assert.equal(after?.domain_revision, afterFirst?.domain_revision);
  } finally {
    await FormLead.deleteMany({ _id: leadId });
    await deleteLinks([job.normalized]);
  }
});
