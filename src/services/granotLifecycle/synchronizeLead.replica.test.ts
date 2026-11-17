import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo, withTransaction } from "../../db";
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
import { resolveLeadIdentity, type LeadIdentityResult } from "./identity";
import { refreshLeadForOutreach } from "../salesOutreach/subjects/leadChangeJob";
import { mongoDeskSubjectStore } from "../salesOutreach/subjects/store";
import { deskConfiguration } from "../salesOutreach/subjects/testing";
import { getSalesOutreachSubjectModel, getSalesOutreachPolicyPeriodModel } from "../../models/salesOutreach";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
import { assembleEstimatesPlan } from "../granotHttpCollector/runWorkflow";
import { normalizeGranotReceipt } from "./normalization";
import { createGranotObservationProcessor, loadGranotLeadProjection, processGranotObservation, type GranotLifecycleProcessorDeps } from "./processor";
import type { LeadDesiredStateProjection } from "./leadDesiredState";
import { synchronizeLeadFromGranot } from "./synchronizeLeadFromGranot";
import { getCapturedDailyOperationsFacts, clearCapturedDailyOperationsFacts } from "../dailyOperations/testDailyOperationsSink";
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
    ...(channel === "granot_webhook"
      ? { route_event_class: "lead_created", authentication_method: "header_secret" }
      : { channel_operation_kind: "lead_snapshot_apply", channel_operation_id: `estimates:${String(observation._id)}`, authentication_method: "automation_owner_approval" }),
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
      ...(input.channel === "granot_http_automation" ? {
        initiator: { actor_type: "owner" as const, actor_id: "estimates-replica-owner", actor_label: "replica@example.invalid", actor_role: "owner" as const, request_id: "estimates-replica", origin: "vantage_admin" as const },
      } : {}),
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

async function seedDatedCall(linked = true) {
  const id = objectId();
  const job = jobPair(String(id));
  const date = new Date("2026-12-01T05:00:00.000Z");
  await seedCallLead({ id, job });
  await getCallLeadModel().updateOne({ _id: id }, { $set: { move_date: date } });
  if (linked) await getGranotRecordLinkModel().create({
    provider: "granot", normalized_job_no: job.normalized, job_no_snapshot: job.raw,
    state: "active", lead_ref: { model: "CallLead", id }, disputed: false,
    established_by_decision_id: objectId(), established_at: olderCapturedAt,
    last_observation_id: objectId(), last_observed_at: olderCapturedAt, domain_revision: 0,
  });
  const identity = identityFor(String(id), "CallLead");
  const capture = (offset: number, moveDate = date) => observation({
    job, priority: "8", captured_at: new Date(+capturedAt + offset), move: { move_date: moveDate },
  });
  return { id, job, date, identity, capture };
}

async function assertAcceptedWithoutEffects(fixture: Awaited<ReturnType<typeof seedDatedCall>>,
  incoming: GranotObservationDocument, decisionId: string, revision = 2) {
  const lead = await getCallLeadModel().findById(fixture.id).lean();
  assert.equal(lead?.move_date?.getTime(), fixture.date.getTime());
  assert.equal(lead?.domain_revision, revision);
  assert.equal(lead?.current_move_provenance, undefined);
  assert.equal(String(lead?.last_accepted_granot_observation?.observation_id), String(incoming._id));
  assert.equal(lead?.last_accepted_granot_observation?.captured_at.getTime(), +incoming.captured_at);
  const decision = await getSynchronizationDecisionModel().findById(decisionId).lean();
  assert.equal(decision?.outcome, "already_current");
  assert.deepEqual(decision?.effects, []);
  assert.equal(await getSynchronizationDecisionModel().countDocuments({ observation_id: incoming._id }), 1);
  const evidence = await evidenceFor(String(fixture.id));
  assert.equal(evidence.changes.length, 0);
  assert.equal(evidence.outbox.length, 0);
  assert.equal(getCapturedDailyOperationsFacts().filter(f => f.input.links?.lead_id === String(fixture.id)).length, 0);
}

test("capacity W1: fresh equal Call dates accept, replay and fence delayed changed dates", async t => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedDatedCall();
  clearCapturedDailyOperationsFacts();
  const projection = await loadGranotLeadProjection({ model: "CallLead", id: String(fixture.id) });
  assert.equal(projection?.move_date?.getTime(), +fixture.date);
  for (const offset of [1000, 2000]) {
    const incoming = fixture.capture(offset);
    const result = await processLive({ observation: incoming, identity: fixture.identity });
    await assertAcceptedWithoutEffects(fixture, incoming, result.decision_id);
    const replay = await processLive({ observation: incoming, identity: fixture.identity });
    assert.equal(replay.decision_id, result.decision_id);
    await assertAcceptedWithoutEffects(fixture, incoming, result.decision_id);
  }
  const delayed = fixture.capture(1500, new Date("2026-12-02T05:00:00Z"));
  const stale = await processLive({ observation: delayed, identity: fixture.identity });
  assert.equal(stale.outcome, "stale");
  assert.deepEqual(stale.effects, []);
  const changed = fixture.capture(3000, new Date("2026-12-03T05:00:00Z"));
  const applied = await processLive({ observation: changed, identity: fixture.identity });
  assert.equal(applied.outcome, "applied");
  const lead = await getCallLeadModel().findById(fixture.id).lean();
  assert.equal(lead?.move_date?.getTime(), +changed.move!.move_date!);
  assert.equal(String(lead?.last_accepted_granot_observation?.observation_id), String(changed._id));
  const evidence = await evidenceFor(String(fixture.id));
  assert.equal(evidence.changes.length, 1);
  assert.ok(evidence.changes[0].fields.some(f => f.path === "move_date"));
  assert.equal(evidence.outbox.length, 1);
  assert.equal(getCapturedDailyOperationsFacts().filter(f => f.input.kind === "granot.linked" && f.input.links?.lead_id === String(fixture.id)).length, 1);
});

for (const bumpRevision of [false, true]) test(`capacity W1: writer makes date equal before command (revision changed: ${bumpRevision})`, async t => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedDatedCall();
  await getCallLeadModel().updateOne({ _id: fixture.id }, { $set: { move_date: new Date("2026-11-30T05:00:00Z") } });
  const incoming = fixture.capture(2000);
  let raced = false;
  const result = await processLive({ observation: incoming, identity: fixture.identity, extra: {
    synchronizeLead: async input => {
      if (!raced) {
        raced = true;
        await getCallLeadModel().updateOne({ _id: fixture.id }, {
          $set: { move_date: fixture.date }, ...(bumpRevision ? { $inc: { domain_revision: 1 } } : {}),
        });
      }
      return synchronizeLeadFromGranot(input);
    },
  } });
  assert.equal(raced, true);
  await assertAcceptedWithoutEffects(fixture, incoming, result.decision_id, bumpRevision ? 3 : 2);
  const delayed = await processLive({ observation: fixture.capture(1000, new Date("2026-12-02T05:00:00Z")), identity: fixture.identity });
  assert.equal(delayed.outcome, "stale");
});

test("capacity W1: equal Call date still establishes its first Record Link", async t => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedDatedCall(false);
  const incoming = fixture.capture(1000);
  const result = await processLive({ observation: incoming, identity: fixture.identity });
  assert.equal(result.outcome, "linked");
  assert.ok(result.effects.some(e => e.kind === "record_link_established"));
  const link = await getGranotRecordLinkModel().findOne({ normalized_job_no: fixture.job.normalized }).lean();
  assert.equal(String(link?.lead_ref?.id), String(fixture.id));
  const lead = await getCallLeadModel().findById(fixture.id).lean();
  assert.equal(String(lead?.last_accepted_granot_observation?.observation_id), String(incoming._id));
  const evidence = await evidenceFor(String(fixture.id));
  assert.equal(evidence.changes.length, 0);
  assert.equal(evidence.outbox.length, 0);
  assert.equal(getCapturedDailyOperationsFacts().filter(f => f.input.kind === "granot.linked" && f.input.links?.lead_id === String(fixture.id)).length, 1);
});

test("capacity W1: both adapters project every planner field", async t => {
  if (!(await replicaReady(t))) return;
  const receiver = objectId(), winner = objectId();
  // Required<> makes adding a planner input without a projection expectation a type error.
  const common = {
    ingestion_origin: "ringcentral", job_no: "P123", normalized_job_no: "P123", granot_priority: "1",
    quoted: true, receiver_agent: String(receiver), receiver_agent_source: "granot_username_match",
    receiver_agent_set_at: capturedAt, name: "Ada Example", first_name: "Ada", last_name: "Example",
    phone_number: SYNTHETIC_PHONE, normalized_phone_number: SYNTHETIC_PHONE, email: SYNTHETIC_EMAIL,
    pickup_city: "Brooklyn", pickup_zip: "11201", pickup_state: "NY", delivery_city: "Queens", delivery_state: "NY",
    move_date: capturedAt, cubic_feet: 300, local: "local", granot_move_size: "Studio", granot_service_type: "Full",
    granot_contact_snapshot: { name: "Ada Example" }, ingested_contact_snapshot: { name: "Ada Example" },
    last_accepted_granot_observation: { observation_id: String(winner), captured_at: capturedAt },
    last_granot_contact_change: { changed_paths: ["name"] }, domain_revision: 3,
  } satisfies Required<Omit<LeadDesiredStateProjection, "model" | "id" | "destination_zip" | "delivery_zip" | "move_size">>;
  for (const kind of ["FormLead", "CallLead"] as const) {
    const id = objectId();
    const model = kind === "FormLead" ? getFormLeadModel() : getCallLeadModel();
    const fields = kind === "FormLead" ? { destination_zip: "11101", move_size: "Studio" } : { delivery_zip: "11101" };
    await mongoose.connection.db!.collection(model.collection.name).insertOne({ _id: id, ...common, ...fields,
      receiver_agent: receiver, last_accepted_granot_observation: { observation_id: winner, captured_at: capturedAt },
    });
    const projection = await loadGranotLeadProjection({ model: kind, id: String(id) });
    assert.ok(projection);
    for (const [key, value] of Object.entries({ ...common, ...fields })) {
      // Snapshot projection explicitly includes absent optional leaves.
      assert.deepEqual(JSON.parse(JSON.stringify(Reflect.get(projection, key))), JSON.parse(JSON.stringify(value)), `${kind}.${key}`);
    }
  }
});

test("capacity W1: normalization and invalid calendar dates preserve canonical dates", async t => {
  if (!(await replicaReady(t))) return;
  for (const [raw, expected] of [[" 12/01/2026 ", "2026-12-01T05:00:00Z"], ["03/08/2026", "2026-03-08T05:00:00Z"], ["07/01/2026", "2026-07-01T04:00:00Z"], ["02/30/2026", null]] as const) {
    const fixture = await seedDatedCall();
    if (expected) {
      fixture.date = new Date(expected);
      await getCallLeadModel().updateOne({ _id: fixture.id }, { $set: { move_date: fixture.date } });
    }
    const incoming = fixture.capture(1000);
    const normalized = normalizeGranotReceipt({ observation_channel: "granot_webhook", route_event_class: "lead_created",
      captured_at: incoming.captured_at, payload: { source: "Synthetic Forms", job_no: fixture.job.raw, priority: "8", move_date: raw } });
    incoming.move = normalized.move;
    incoming.issues = normalized.issues;
    incoming.normalization_result = normalized.normalization_result;
    if (expected) assert.equal(incoming.move.move_date?.getTime(), +fixture.date);
    else {
      assert.equal(incoming.move.move_date, undefined);
      assert.ok(incoming.issues.some(issue => issue.code === "invalid_move_date"));
    }
    const result = await processLive({ observation: incoming, identity: fixture.identity });
    await assertAcceptedWithoutEffects(fixture, incoming, result.decision_id);
  }
});

test("capacity W1: concurrent fresh equal captures preserve the greater winner and one Decision each", async t => {
  if (!(await replicaReady(t))) return;
  const fixture = await seedDatedCall();
  const first = fixture.capture(1000), second = fixture.capture(2000);
  const results = await Promise.all([first, second].map(incoming => processLive({ observation: incoming, identity: fixture.identity })));
  assert.ok(results.every(r => ["already_current", "stale"].includes(r.outcome)));
  await assertAcceptedWithoutEffects(fixture, second, results[1].decision_id);
  assert.equal(await getSynchronizationDecisionModel().countDocuments({ observation_id: first._id }), 1);
  const delayed = await processLive({ observation: fixture.capture(1500, new Date("2026-12-02T05:00:00Z")), identity: fixture.identity });
  assert.equal(delayed.outcome, "stale");
});

test("capacity W1: accepted Form no-op still repairs only its qualified Call sibling", async t => {
  if (!(await replicaReady(t))) return;
  for (const qualified of [true, false]) {
    const formId = objectId(), callId = objectId(), company = objectId(), receiver = objectId();
    const job = jobPair(String(formId));
    await seedFormLead({ id: formId, job, priority: "8", extra: { lead_source_company: company,
      normalized_phone_number: SYNTHETIC_PHONE, receiver_agent: receiver, receiver_agent_name_snapshot: "Synthetic Rep",
      receiver_agent_source: "granot_username_match" } });
    await seedCallLead({ id: callId, job: jobPair(String(callId)) });
    const qualification = { call_log_id: `synthetic-${callId}`, duration_seconds: 150, ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_answered_over_120s" };
    await getCallLeadModel().collection.updateOne({ _id: callId }, { $unset: { job_no: "", normalized_job_no: "" }, $set: {
      lead_source_company: company, normalized_phone_number: SYNTHETIC_PHONE, granot_priority: "0",
      ...(qualified ? { ringcentral: qualification } : {}), sheet_sync: [{ target: "master_calls", status: "synced", row_number: 2 }],
    } });
    await getGranotRecordLinkModel().create({ provider: "granot", normalized_job_no: job.normalized, job_no_snapshot: job.raw,
      state: "active", lead_ref: { model: "FormLead", id: formId }, disputed: false,
      established_by_decision_id: objectId(), established_at: olderCapturedAt, last_observation_id: objectId(),
      last_observed_at: olderCapturedAt, domain_revision: 0 });
    const incoming = observation({ job, priority: "8", move: { move_date: capturedAt } });
    await seedReceipt(incoming);
    const processor = createGranotObservationProcessor({ ...liveDeps({ observation: incoming, identity: identityFor(String(formId)) }),
      wakeLeadLinks: async () => undefined, wakeLeadLinksTimeoutMs: 30_000 });
    const result = await processor.process({ receipt_id: String(incoming.receipt_id) });
    assert.equal(result.outcome, "already_current");
    assert.deepEqual(result.effects, []);
    const call = await getCallLeadModel().findById(callId).lean();
    assert.equal(call?.normalized_job_no ?? undefined, qualified ? job.normalized : undefined);
    assert.equal(call?.granot_priority, qualified ? "8" : "0");
    assert.equal(call?.receiver_agent ? String(call.receiver_agent) : undefined, qualified ? String(receiver) : undefined);
    assert.equal(call?.last_accepted_granot_observation, undefined);
    if (qualified) assert.deepEqual(JSON.parse(JSON.stringify(call?.ringcentral)), qualification);
    const evidence = await evidenceFor(String(callId));
    assert.equal(evidence.changes.length, qualified ? 1 : 0);
    assert.equal(evidence.outbox.length, qualified ? 1 : 0);
    await processor.process({ receipt_id: String(incoming.receipt_id) });
    assert.equal((await evidenceFor(String(callId))).changes.length, qualified ? 1 : 0);
    assert.equal((await evidenceFor(String(formId))).changes.length, 0);
  }
});

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
    // Legacy Bad Form targets may predate Job linking; priority-only must not plan a Job fill.
    await FormLead.collection.updateOne({ _id: badId }, { $unset: { job_no: "", normalized_job_no: "" } });
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
    assert.equal(lead?.job_no, undefined);
    assert.equal(lead?.normalized_job_no, undefined);
    assert.equal(lead?.receiver_agent, undefined);

    assert.equal(await SheetSyncJob.countDocuments({ entity_id: String(badId) }), 0,
      "Priority-only changes update Desk facts without writing an unchanged sheet projection");
    const priorityDecision = await getSynchronizationDecisionModel().findById(bad.decision_id).lean();
    assert.equal(priorityDecision?.effects.some(effect => effect.kind === "sheet_sync_requested"), false);

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

test("Estimates sparse Call enrichment converges Granot assignment and desk priority periods", async (t) => {
  if (!(await replicaReady(t))) return;
  const CallLead = getCallLeadModel();
  const leadId = objectId(), siblingId = objectId(), repA = objectId(), repB = objectId();
  const job = jobPair(String(leadId));
  const phone = `555${String(leadId).slice(-7).replace(/[a-f]/g, "7")}`;
  const usernameA = `estimatesa${String(repA)}`, usernameB = `estimatesb${String(repB)}`;
  const ref = { model: "CallLead" as const, id: String(leadId) };
  const previousLatestWins = process.env.SALES_INTELLIGENCE_RECEIVER_LATEST_WINS;
  process.env.SALES_INTELLIGENCE_RECEIVER_LATEST_WINS = "true";
  const configuration = deskConfiguration({
    transition: { intake_admission_enabled: true, intake_admission_at: "2026-08-18T00:00:00.000Z", backfill_lookback_days: 90, backfill_include_upcoming_moves: true },
    migration: { paused: false },
  });
  const policyStore = reviewedStore();
  const callPolicyStore: SourcePolicyStore = {
    ...policyStore,
    async findByNormalizedLabel(label) {
      return (await policyStore.findByNormalizedLabel(label)).map((row) => ({ ...row, lifecycle_routes: [
        { route_key: "call_any", lead_model: "CallLead" as const, move_type: "any" as const, source_granularity_id: REVIEWED_GRANULARITY_ID },
      ] }));
    },
    async findGranularity(id) { return { id, source_company_id: REVIEWED_COMPANY_ID, active: true, channel: "call" }; },
  };
  const refresh = (at: Date) => withTransaction((session) => refreshLeadForOutreach(ref, configuration, at, mongoDeskSubjectStore, session));
  try {
    await getSalesOutreachSubjectModel().createCollection();
    await getSalesOutreachSubjectModel().syncIndexes();
    await getSalesOutreachPolicyPeriodModel().createCollection();
    await getSalesOutreachPolicyPeriodModel().syncIndexes();
    await getSalesIntelligenceJobModel().createCollection();
    await getSalesIntelligenceJobModel().createIndexes();
    await Agent.create([
      { _id: repA, name: "Estimates Rep A", normalized_name: "estimates rep a", active: true, granot_crm_username: usernameA },
      { _id: repB, name: "Estimates Rep B", normalized_name: "estimates rep b", active: true, granot_crm_username: usernameB },
    ]);
    await CallLead.collection.insertMany([
      { _id: leadId, source_company: "synthetic", source_granularity_id: new mongoose.Types.ObjectId(REVIEWED_GRANULARITY_ID),
        phone_number: phone, normalized_phone_number: phone, ingestion_origin: "ringcentral", duplicate: false,
        ringcentral: { duration_seconds: 180, qualification_reason: "inbound_target_answered_over_120s" },
        timestamp: new Date("2026-08-18T11:00:00.000Z"), createdAt: new Date("2026-08-18T15:00:00.000Z"),
        domain_revision: 1, quoted: false },
      { _id: siblingId, source_company: "synthetic", source_granularity_id: new mongoose.Types.ObjectId(REVIEWED_GRANULARITY_ID),
        normalized_phone_number: phone, duplicate: true, normalized_job_no: "OTHER JOB", domain_revision: 1 },
    ]);
    let lastIncoming: GranotObservationDocument;
    const apply = async (priority: string, username: string, at: Date) => {
      const incoming = observation({ job, priority, captured_at: at, agent: { user_raw: username },
        contact: { phone_raw: phone, normalized_phone: phone, display_name: "Granot Contact" },
        move: { estimated_cubic_feet: 500 } });
      const plan = await assembleEstimatesPlan([{
        sourceLabel: "Synthetic Forms", contentHash: "synthetic", sectionSchemas: { bookedJobs: "missing", followUpEstimates: "table" },
        sections: { bookedJobs: [], followUpEstimates: [{ id: `estimates:${priority}`, rowIndex: 1, collectedAt: at.toISOString(),
          values: { source: "Synthetic Forms", job_no: job.raw, prior: priority, user: username, phone, customer: "Granot Contact", est_cf: "500" } }] },
      }], { runId: String(incoming.receipt_id), canonical: { sourcePolicyStore: callPolicyStore } });
      const action = plan.actions[0]!;
      assert.equal("classification" in action && action.classification, "update");
      assert.deepEqual(action.lifecycle_apply?.expected_target, ref);
      Object.assign(incoming, normalizeGranotReceipt({ observation_channel: "granot_http_automation", captured_at: at,
        channel_operation_kind: "lead_snapshot_apply", channel_operation_id: action.lifecycle_apply!.operation_id,
        payload: { operation_id: action.lifecycle_apply!.operation_id, operation_kind: "lead_snapshot_apply", granot_statement: action.lifecycle_apply!.granot_statement } }));
      lastIncoming = incoming;
      return processLive({ observation: incoming, identity: identityFor(String(leadId), "CallLead"), channel: "granot_http_automation",
        extra: { now: () => new Date(+at + 5000), sourcePolicyStore: callPolicyStore, resolveIdentity: resolveLeadIdentity } });
    };
    assert.equal((await apply("0", usernameA, capturedAt)).outcome, "applied");
    let lead = await CallLead.findById(leadId).lean();
    assert.equal(lead?.normalized_job_no, job.normalized);
    assert.equal(String(lead?.receiver_agent), String(repA));
    assert.equal(lead?.quoted, false);
    assert.equal(lead?.cubic_feet, undefined, "priority 0 does not broaden move authority");
    const firstDesk = await refresh(new Date(+capturedAt + 10_000));
    assert.equal(firstDesk.status, "active");
    const later = new Date(+capturedAt + 60_000);
    const second = await apply("1", usernameB, later);
    assert.equal(second.outcome, "applied");
    await refresh(new Date(+later + 10_000));
    lead = await CallLead.findById(leadId).lean();
    assert.equal(String(lead?.receiver_agent), String(repB));
    assert.equal(lead?.receiver_agent_source, "granot_username_match");
    assert.equal(lead?.quoted, true);
    assert.equal(lead?.cubic_feet, 500);
    assert.equal(lead?.phone_number, phone, "live contact remains protected");
    const subject = await getSalesOutreachSubjectModel().findById(firstDesk.subject_id).lean();
    assert.equal(String(subject?.assigned_agent_id), String(repB));
    const periods = await getSalesOutreachPolicyPeriodModel().find({ subject_id: firstDesk.subject_id }).sort({ started_at: 1 }).lean();
    assert.deepEqual(periods.map((period) => [period.workflow, period.ended_at == null]), [["new", false], ["quoted", true]]);
    const replay = await processLive({ observation: lastIncoming!, identity: identityFor(String(leadId), "CallLead"), channel: "granot_http_automation",
      extra: { sourcePolicyStore: callPolicyStore, resolveIdentity: resolveLeadIdentity } });
    assert.equal(replay.decision_id, second.decision_id, "receipt replay retains its accepted decision");
    assert.equal((await CallLead.findById(leadId).lean())?.domain_revision, lead?.domain_revision, "receipt replay does not rewrite the Lead");
    await refresh(new Date(+later + 20_000));
    assert.equal(await getSalesOutreachPolicyPeriodModel().countDocuments({ subject_id: firstDesk.subject_id }), 2, "replay adds no period");
    assert.equal((await CallLead.findById(siblingId).lean())?.normalized_job_no, "OTHER JOB");
    const changes = await getEntityChangeModel().find({ "entity.id": String(leadId) }).lean();
    assert.equal(changes.length, 2);
    assert.ok(changes.every((change) => change.fields.some((field) => field.path === "receiver_agent")));
  } finally {
    if (previousLatestWins === undefined) delete process.env.SALES_INTELLIGENCE_RECEIVER_LATEST_WINS;
    else process.env.SALES_INTELLIGENCE_RECEIVER_LATEST_WINS = previousLatestWins;
    const subjects = await getSalesOutreachSubjectModel().find({ lead_id: leadId }).select("_id").lean();
    await getSalesOutreachPolicyPeriodModel().deleteMany({ subject_id: { $in: subjects.map((row) => row._id) } });
    await getSalesOutreachSubjectModel().deleteMany({ lead_id: leadId });
    await CallLead.deleteMany({ _id: { $in: [leadId, siblingId] } });
    await Agent.deleteMany({ _id: { $in: [repA, repB] } });
    await deleteLinks([job.normalized]);
  }
});


test('cadence channel orders converge; next-slot no-op retains evidence without business writes', async t => {
  if (!(await replicaReady(t))) return;
  const Form = getFormLeadModel();
  for (const channels of [ ['granot_webhook','granot_http_automation'], ['granot_http_automation','granot_webhook'] ] as const) {
    const id = objectId(), job = jobPair(`cadence-${id}`), identity = identityFor(String(id));
    await seedFormLead({ id, job });
    try {
      const first = observation({ job, priority:'0', captured_at:new Date('2026-08-18T16:00:00Z') });
      first.route_event_class = 'priority_updated';
      assert.equal((await processLive({ observation:first, identity, channel:channels[0] })).outcome, 'applied');
      const before = await Form.findById(id).lean();
      const mutations = await getEntityChangeModel().countDocuments({ 'entity.id':String(id) });
      const sheets = await SheetSyncJob.countDocuments({ entity_id:String(id) });
      const next = observation({ job, priority:'0', captured_at:new Date('2026-08-18T17:00:00Z') });
      next.route_event_class = 'priority_updated';
      const result = await processLive({ observation:next, identity, channel:channels[1] });
      assert.equal(result.outcome, 'already_current');
      const after = await Form.findById(id).lean();
      assert.equal(after?.domain_revision, before?.domain_revision);
      assert.equal(String(after?.last_accepted_granot_observation?.observation_id), String(next._id));
      assert.equal(await getEntityChangeModel().countDocuments({ 'entity.id':String(id) }), mutations);
      assert.equal(await SheetSyncJob.countDocuments({ entity_id:String(id) }), sheets);
      const replay = await processLive({ observation:next, identity, channel:channels[1] });
      assert.equal(replay.decision_id, result.decision_id);
      assert.equal(await getSynchronizationDecisionModel().countDocuments({ observation_id:next._id }), 1);
      const stale = observation({ job, priority:'5', captured_at:new Date('2026-08-18T16:30:00Z') });
      assert.equal((await processLive({ observation:stale, identity, channel:channels[0] })).outcome, 'stale');
      assert.equal((await Form.findById(id).lean())?.granot_priority, '0');
      assert.equal(await getEntityChangeModel().countDocuments({ 'entity.id':String(id) }), mutations);
    } finally { await Form.deleteOne({ _id:id }); await deleteLinks([job.normalized]); }
  }
});
