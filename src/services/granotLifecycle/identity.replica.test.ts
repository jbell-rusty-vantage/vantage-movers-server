import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getGranotLifecycleFlags } from "../../config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { Agent } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import {
  createMongoLeadIdentityStore,
  resolveLeadIdentity,
} from "./identity";
import type { SourcePolicySnapshot } from "./sourcePolicy";

const ZERO_WRITE_COLLECTIONS = [
  "form_leads",
  "call_leads",
  "booked_leads",
  "agents",
  "granot_record_links",
  "granot_observations",
  "granot_webhook_receipts",
  "synchronization_decisions",
  "entity_changes",
  "domain_command_executions",
  "sheet_sync_jobs",
  "booking_lead_reconciliation_cases",
] as const;

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return false;
  }
  if (getMongoDatabaseName() !== "testvantagemovers") {
    t.skip("Replica-set proof requires TEST_MODE=true before process start.");
    return false;
  }
  await connectMongo();
  if (mongoose.connection.db?.databaseName !== "testvantagemovers") {
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

async function collectionCounts(): Promise<Record<string, number>> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo is not connected");
  const counts: Record<string, number> = {};
  for (const name of ZERO_WRITE_COLLECTIONS) {
    counts[name] = await db.collection(name).countDocuments();
  }
  return counts;
}

function formPolicy(companyId: string, granularityId: string): SourcePolicySnapshot {
  return {
    granot_crm_source_id: new mongoose.Types.ObjectId().toHexString(),
    lead_source_company_id: companyId,
    source_granularity_id: granularityId,
    selected_route_key: "form_local",
    selected_lead_model: "FormLead",
    selected_move_type: "local",
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
  };
}

test("[AC-07] replica identity is read-only across lifecycle and aggregate collections", async (t) => {
  if (!(await replicaReady(t))) return;
  const flags = getGranotLifecycleFlags();
  assert.equal(flags.lead_writes_enabled, false);
  assert.equal(flags.lead_creation_enabled, false);
  assert.equal(flags.booking_cases_enabled, false);
  assert.equal(flags.booking_commands_enabled, false);

  const FormLead = getFormLeadModel();
  const prefix = `u14_${Date.now().toString(36)}`;
  const companyId = new mongoose.Types.ObjectId();
  const granularityId = new mongoose.Types.ObjectId();
  const formId = new mongoose.Types.ObjectId();
  const refNo = `${prefix}-ref`;
  await FormLead.collection.insertOne({
    _id: formId,
    name: "Synthetic U14",
    phone_number: "5550001414",
    normalized_phone_number: "5550001414",
    pickup_zip: "00000",
    destination_zip: "00000",
    ref_no: refNo,
    duplicate: false,
    lead_source_company: companyId,
    source_granularity_id: granularityId,
    cpl: 0,
    move_date: new Date("2026-08-17T00:00:00.000Z"),
    timestamp: new Date("2026-08-17T00:00:00.000Z"),
    source_company: "main_site",
  });
  const before = await collectionCounts();
  try {
    const result = await resolveLeadIdentity(
      {
        observation: {
          identity: { normalized_form_ref: refNo },
          contact: {},
          agent_identity: {},
        },
        policy: formPolicy(String(companyId), String(granularityId)),
      },
      createMongoLeadIdentityStore(),
    );
    assert.equal(result.outcome, "linked");
    assert.equal(result.match_method, "form_ref_no_exact");
    assert.equal(result.target?.id, String(formId));
    assert.equal(JSON.stringify(result).includes("5550001414"), false);
    assert.deepEqual(await collectionCounts(), before);
  } finally {
    await FormLead.collection.deleteOne({ _id: formId });
  }
});

test("[AC-13] replica cross-field Agent username contradiction returns no suggestion", async (t) => {
  if (!(await replicaReady(t))) return;
  const username = `U14AGENT${Date.now().toString(36).toUpperCase()}`;
  const first = await Agent.create({
    name: `Synthetic ${username} A`,
    normalized_name: `synthetic ${username} a`,
    active: true,
    role: "agent",
    created_from: "test",
    granot_identity: { username, verified: false },
  });
  const second = await Agent.create({
    name: `Synthetic ${username} B`,
    normalized_name: `synthetic ${username} b`,
    active: true,
    role: "agent",
    created_from: "test",
    granot_crm_username: username,
  });
  const before = await collectionCounts();
  try {
    const result = await resolveLeadIdentity(
      {
        observation: {
          identity: {},
          contact: {},
          agent_identity: { user_raw: username },
        },
        policy: formPolicy(
          new mongoose.Types.ObjectId().toHexString(),
          new mongoose.Types.ObjectId().toHexString(),
        ),
      },
      createMongoLeadIdentityStore(),
    );
    assert.equal(result.agent, undefined);
    assert.equal(result.agent_assertion, "single");
    assert.deepEqual(await collectionCounts(), before);
  } finally {
    await Agent.deleteMany({ _id: { $in: [first._id, second._id] } });
  }
});

test("[AC-39] replica Booking without Lead delegates and writes no case", async (t) => {
  if (!(await replicaReady(t))) return;
  const job = `U14 JOB ${Date.now().toString(36).toUpperCase()}`;
  const bookingId = new mongoose.Types.ObjectId();
  await BookedLead.collection.insertOne({
    _id: bookingId,
    timestamp: new Date("2026-08-17T00:00:00.000Z"),
    book_date: new Date("2026-08-17T00:00:00.000Z"),
    job_no: job,
    normalized_job_no: job,
    is_referral_booking: false,
    is_leadless_booking: true,
    source: "synthetic",
    merchant: "synthetic",
    deposit_amount: 0,
    total_binder_amount: 0,
    agent_allocations: [
      {
        agent: new mongoose.Types.ObjectId(),
        agent_name_snapshot: "Synthetic Agent",
        binder_amount: 0,
      },
    ],
  });
  const before = await collectionCounts();
  try {
    const result = await resolveLeadIdentity(
      {
        observation: {
          identity: { normalized_job_no: job },
          contact: {},
          agent_identity: {},
        },
        policy: formPolicy(
          new mongoose.Types.ObjectId().toHexString(),
          new mongoose.Types.ObjectId().toHexString(),
        ),
      },
      createMongoLeadIdentityStore(),
    );
    assert.equal(result.booking_context?.booking?.id, String(bookingId));
    assert.equal(result.booking_context?.booking_lead_reconciliation_required, true);
    assert.deepEqual(await collectionCounts(), before);
  } finally {
    await BookedLead.collection.deleteOne({ _id: bookingId });
  }
});

test("replica active Record Link lookup is findOne and writes nothing", async (t) => {
  if (!(await replicaReady(t))) return;
  const Link = getGranotRecordLinkModel();
  const job = `U14 LINK ${Date.now().toString(36).toUpperCase()}`;
  const firstId = new mongoose.Types.ObjectId();
  const decidedAt = new Date("2026-08-17T00:00:00.000Z");
  await Link.collection.insertOne({
    _id: firstId,
    provider: "granot",
    normalized_job_no: job,
    job_no_snapshot: job,
    state: "active",
    disputed: false,
    established_by_decision_id: new mongoose.Types.ObjectId(),
    established_at: decidedAt,
    last_observation_id: new mongoose.Types.ObjectId(),
    last_observed_at: decidedAt,
    domain_revision: 0,
  });
  const before = await collectionCounts();
  try {
    const found = await createMongoLeadIdentityStore().findActiveRecordLink(job);
    assert.equal(found?.id, String(firstId));
    assert.equal(found?.normalized_job_no, job);
    assert.deepEqual(await collectionCounts(), before);
  } finally {
    await Link.collection.deleteMany({ normalized_job_no: job });
  }
});

test("[AC-04] replica Call Job query is granularity-scoped and read-only", async (t) => {
  if (!(await replicaReady(t))) return;
  const CallLead = getCallLeadModel();
  const granularityId = new mongoose.Types.ObjectId();
  const otherGranularity = new mongoose.Types.ObjectId();
  const job = `U14 CALL ${Date.now().toString(36).toUpperCase()}`;
  const inScope = new mongoose.Types.ObjectId();
  const outOfScope = new mongoose.Types.ObjectId();
  await CallLead.collection.insertMany([
    {
      _id: inScope,
      name: "Synthetic In Scope",
      phone_number: "5550001415",
      normalized_phone_number: "5550001415",
      job_no: job,
      normalized_job_no: job,
      source_granularity_id: granularityId,
      quoted: false,
    },
    {
      _id: outOfScope,
      name: "Synthetic Out Of Scope",
      phone_number: "5550001416",
      normalized_phone_number: "5550001416",
      job_no: job,
      normalized_job_no: job,
      source_granularity_id: otherGranularity,
      quoted: false,
    },
  ]);
  const before = await collectionCounts();
  try {
    const result = await resolveLeadIdentity(
      {
        observation: {
          identity: { normalized_job_no: job },
          contact: {},
          agent_identity: {},
        },
        policy: {
          ...formPolicy(new mongoose.Types.ObjectId().toHexString(), String(granularityId)),
          selected_lead_model: "CallLead",
          selected_route_key: "call_any",
          selected_move_type: "any",
        },
      },
      createMongoLeadIdentityStore(),
    );
    assert.equal(result.target?.id, String(inScope));
    assert.equal(result.match_method, "call_job_no_exact");
    assert.deepEqual(await collectionCounts(), before);
  } finally {
    await CallLead.collection.deleteMany({ _id: { $in: [inScope, outOfScope] } });
  }
});
