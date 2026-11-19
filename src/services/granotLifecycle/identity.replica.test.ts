import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getGranotLifecycleFlags } from "../../config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { BookedLead } from "../../models/BookedLead";
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
