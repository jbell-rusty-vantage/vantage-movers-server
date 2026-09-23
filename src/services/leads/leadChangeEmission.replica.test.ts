import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { CallLead } from "../../models/CallLead";
import { EntityChange } from "../../models/EntityChange";
import { beginRingCentralCallLeadIngestion } from "./callLead.service";
import { markMatchingCallLeadsWithFormFill } from "./duplicateLead.service";

/**
 * LP-03 (H4) replica proofs: E3 RingCentral Call Lead creation and the E13
 * `form_fill` flip write exactly one Lead EntityChange inside the owning
 * transaction. Opt-in: LP03_REPLICA_TESTS=true, TEST_MODE=true,
 * TEST_MONGO_DATABASE_NAME=testvantagemovers_<suffix>, MONGO_URI=<replica set>;
 * run with --test-concurrency=1 (each LP-03 replica file drops the isolated DB).
 * The isolated database is dropped afterwards.
 */
const ISOLATED_DB = /^testvantagemovers_[a-z0-9]+$/i;

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
  if (process.env.LP03_REPLICA_TESTS !== "true") {
    t.skip("LP-03 replica proof is opt-in via LP03_REPLICA_TESTS=true.");
    return false;
  }
  if (!ISOLATED_DB.test(getMongoDatabaseName())) {
    t.skip("LP-03 replica proof requires an isolated TEST_MONGO_DATABASE_NAME.");
    return false;
  }
  await connectMongo();
  if (!ISOLATED_DB.test(mongoose.connection.db?.databaseName ?? "")) {
    t.skip("Refusing replica-set proof against a non-isolated database.");
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
  if (
    mongoose.connection.readyState === 1 &&
    ISOLATED_DB.test(mongoose.connection.db?.databaseName ?? "")
  ) {
    await mongoose.connection.db?.dropDatabase().catch(() => undefined);
  }
  await mongoose.disconnect().catch(() => undefined);
});

function ringCentralInput(prefix: string, phone: string, duplicate: boolean) {
  return {
    source_company: "main_site" as const,
    source_resolution: {
      route_id: new mongoose.Types.ObjectId().toHexString(),
      assignment_id: new mongoose.Types.ObjectId().toHexString(),
      normalized_target_number: "5550100999",
      company_id: new mongoose.Types.ObjectId().toHexString(),
      company_slug: "main_site",
      granularity_id: new mongoose.Types.ObjectId().toHexString(),
      granularity_key: `${prefix}_call`,
      company_label_snapshot: "LP03 Synthetic",
      granularity_label_snapshot: "LP03 Synthetic Calls",
      crm_label_snapshot: "LP03 Synthetic Calls",
    },
    phone_number: phone,
    name: "LP03 RC Synthetic",
    duplicate,
    ringcentral: {
      telephony_session_id: `${prefix}-session`,
      ingestion_source: "webhook" as const,
      route_id: new mongoose.Types.ObjectId().toHexString(),
      route_assignment_id: new mongoose.Types.ObjectId().toHexString(),
      target_phone_number: "5550100999",
    },
  };
}

test("LP-03 E3 RingCentral Call Lead create writes one createCallLead change in its transaction (non-duplicate and duplicate)", async (t) => {
  if (!(await replicaReady(t))) return;
  const previousMode = process.env.SHEET_SYNC_MODE;
  process.env.SHEET_SYNC_MODE = "disabled";
  t.after(() => {
    if (previousMode === undefined) delete process.env.SHEET_SYNC_MODE;
    else process.env.SHEET_SYNC_MODE = previousMode;
  });
  const now = new Date("2026-09-22T15:00:00.000Z");
  for (const duplicate of [false, true]) {
    const prefix = `lp03e3${duplicate ? "d" : "n"}${Date.now()}`;
    const session = await mongoose.connection.startSession();
    let leadId = "";
    try {
      await session.withTransaction(async () => {
        const pending = await beginRingCentralCallLeadIngestion(
          ringCentralInput(prefix, duplicate ? "5550103002" : "5550103001", duplicate),
          { session, now },
        );
        leadId = pending.lead._id.toString();
        assert.equal(pending.lead.domain_revision, 1);
      });
    } finally {
      await session.endSession();
    }
    const changes = await EntityChange.find({ "entity.id": leadId }).lean();
    assert.equal(changes.length, 1);
    const change = changes[0]!;
    assert.equal(change.entity.model, "CallLead");
    assert.equal(change.command_name, "createCallLead");
    assert.equal(change.revision_before, 0);
    assert.equal(change.revision_after, 1);
    assert.equal(change.provenance.source_system, "ringcentral");
    assert.equal(change.provenance.actor.actor_id, "ringcentral-call-ingest");
    assert.equal(change.provenance.request_id, `${prefix}-session`);
    assert.ok(change.changed_paths.includes("phone_number"));
    assert.equal(
      change.fields.find((field) => field.path === "duplicate")?.after,
      duplicate,
    );
    const stored = await CallLead.findById(leadId).lean();
    assert.equal(stored?.domain_revision, 1);
    assert.equal(String(stored?.last_change_id), String(change._id));
    assert.equal(JSON.stringify(change).includes("5550103001"), false);
  }
});

test("LP-03 E3 a rolled-back RingCentral create leaves no change", async (t) => {
  if (!(await replicaReady(t))) return;
  const prefix = `lp03rb${Date.now()}`;
  await assert.rejects(async () => {
    await mongoose.connection.transaction(async (session) => {
      await beginRingCentralCallLeadIngestion(
        ringCentralInput(prefix, "5550103003", false),
        { session, now: new Date() },
      );
      throw new Error("forced LP-03 rollback");
    });
  }, /forced LP-03 rollback/);
  assert.equal(
    await EntityChange.countDocuments({ "provenance.request_id": `${prefix}-session` }),
    0,
  );
  assert.equal(await CallLead.countDocuments({ phone_number: "5550103003" }), 0);
});

test("LP-03 E13 form_fill flip writes one CallLead change with changed_paths [form_fill]", async (t) => {
  if (!(await replicaReady(t))) return;
  const phone = "5550103004";
  const lead = await CallLead.create({
    phone_number: phone,
    source_company: "main_site",
    form_fill: false,
    timestamp: new Date(),
  });
  const formLeadId = new mongoose.Types.ObjectId().toHexString();
  await mongoose.connection.transaction(async (session) => {
    const jobs = await markMatchingCallLeadsWithFormFill(
      "main_site",
      phone,
      formLeadId,
      session,
    );
    assert.equal(jobs.length, 1);
  });
  const changes = await EntityChange.find({ "entity.id": lead._id.toString() }).lean();
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0]?.changed_paths, ["form_fill"]);
  assert.equal(changes[0]?.fields[0]?.after, true);
  assert.equal(changes[0]?.command_name, "markCallLeadFormFill");
  assert.equal((await CallLead.findById(lead._id).lean())?.domain_revision, 1);

  // Nothing left to flip: no write, no change.
  await mongoose.connection.transaction(async (session) => {
    await markMatchingCallLeadsWithFormFill("main_site", phone, formLeadId, session);
  });
  assert.equal(
    await EntityChange.countDocuments({ "entity.id": lead._id.toString() }),
    1,
  );
});
