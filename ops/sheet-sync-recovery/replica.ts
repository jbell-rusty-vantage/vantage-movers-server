import assert from "node:assert/strict";
import { mock } from "node:test";
import mongoose from "mongoose";
import { BSON, MongoClient } from "mongodb";
import { SHEET_REPLICA, assertLocalHello, localChildEnvironment } from "../vantage/local-safety";
import { statefulWorkbook } from "../../src/services/sheetSync/drainer/statefulWorkbook.fixture";
import type { QuotaLimiter } from "../../src/services/sheetSync/drainer/quotaLimiter";

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** No dotenv, customer credentials or real provider calls. Owns only this PID's
 * isolated database on the explicitly named loopback replica set. */
async function main() {
  const database = `testvantagemovers_sheetrecovery${process.pid}`;
  const identity = { ...SHEET_REPLICA, database };
  const safeEnvironment = localChildEnvironment(process.env, identity);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, safeEnvironment);
  Object.assign(process.env, {
    SHEET_SYNC_MODE: "queued", WRITE_SOURCE_LEAD_SHEETS: "false",
    TEST_MASTER_LEADS_SHEET_ID: "synthetic-leads", TEST_MASTER_BOOKED_SHEET_ID: "synthetic-booked",
    SHEET_SYNC_MAX_ROWS_PER_BATCH: "1",
  });
  // Check the explicitly addressed server without following its advertised
  // topology. No model/index/fixture writes may happen before this gate.
  const probe = new MongoClient(identity.uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await probe.connect();
    assertLocalHello(await probe.db("admin").command({ hello: 1 }), identity);
    const existing = await probe.db("admin").admin().listDatabases({ nameOnly: true, filter: { name: database } });
    assert.equal(existing.databases.length, 0, "fixture namespace already exists; refusing ownership");
  } finally {
    await probe.close();
  }
  mongoose.set("autoCreate", false);
  mongoose.set("autoIndex", false);
  await import("../test-setup.js");
  const { logger } = await import("../../src/logger.js");
  for (const level of ["info", "warn", "error"] as const) mock.method(logger, level, () => {});
  mock.method(globalThis, "fetch", async () => { throw new Error("external fetch forbidden in replica proof"); });
  const { connectMongo, withTransaction } = await import("../../src/db.js");
  const { getFormLeadModel } = await import("../../src/models/FormLead.js");
  const { SheetSyncJob } = await import("../../src/models/SheetSyncJob.js");
  const { SheetSyncRun } = await import("../../src/models/SheetSyncRun.js");
  const { SheetSyncAttempt } = await import("../../src/models/SheetSyncAttempt.js");
  const { SheetSyncLease } = await import("../../src/models/SheetSyncLease.js");
  const { SheetSyncQuotaBucket } = await import("../../src/models/SheetSyncQuotaBucket.js");
  const { getCallLeadModel } = await import("../../src/models/CallLead.js");
  const { CancelledLead } = await import("../../src/models/CancelledLead.js");
  const { enqueueSheetSyncJob } = await import("../../src/services/sheetSync/sheetSyncOutbox.service.js");
  const { measureDrain, proveCandidateCosts } = await import("./drainCosts.js");
  const { planJobWrites } = await import("../../src/services/sheetSync/drainer/jobPlanner.js");
  const { BookedLead } = await import("../../src/models/BookedLead.js");
  const { FORM_SHEET_HEADERS, CALL_SHEET_HEADERS, BOOKED_SHEET_HEADERS, CANCELLED_SHEET_HEADERS } = await import("../../src/config/domain.js");
  const { resetEnsuredTabsCache } = await import("../../src/services/googleSheets/tabs.js");
  const { runSheetSyncDrain } = await import("../../src/services/sheetSync/drainer/runSheetSyncDrain.js");
  const { clearCapturedDailyOperationsFacts, getCapturedDailyOperationsFacts } = await import("../../src/services/dailyOperations/testDailyOperationsSink.js");
  const { createMongoDailyOperationsStores, recordDailyOperationsFact } = await import("../../src/services/dailyOperations/recordDailyOperationsFact.js");
  const { getDailyOperationsDayModel } = await import("../../src/models/DailyOperationsDay.js");
  const { getDailyOperationsEventModel } = await import("../../src/models/DailyOperationsEvent.js");
  // Enable driver command events on the first socket, using the guarded service connection.
  const connect = mongoose.connect.bind(mongoose);
  const monitored = mock.method(mongoose, "connect", (uri: string, options?: mongoose.ConnectOptions) =>
    connect(uri, { ...options, monitorCommands: true }));
  try {
    await connectMongo();
  } finally {
    monitored.mock.restore();
  }
  assert.equal(mongoose.connection.host, "127.0.0.1");
  assert.equal(mongoose.connection.name, database);
  const verifyFixture = async () => {
    assert.equal(mongoose.connection.host, "127.0.0.1");
    assert.equal(mongoose.connection.name, database);
    assert.match(database, /^testvantagemovers_sheetrecovery[0-9]+$/);
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    assertLocalHello(hello, identity);
  };
  await verifyFixture();
  const Forms = getFormLeadModel();
  const headers = [...FORM_SHEET_HEADERS];
  const grant = { reserve: async () => ({ granted: true }) } as unknown as QuotaLimiter;
  const workbook = () => statefulWorkbook({ Forms: [headers], "Duplicate Forms": [headers], "Bad Form Leads": [headers] });
  const row = (id: string, name: string) => headers.map((header) => header === "Mongo ID" ? id : header === "Name" ? name : "");
  const completed = () => getCapturedDailyOperationsFacts().filter((fact) => fact.input.kind === "sheet_sync.completed");
  const makeDue = () => SheetSyncJob.updateMany({ status: "retrying" }, { $set: { due_at: new Date(0) } });
  const sourceJob = (id: string, key = `source_lead:FormLead:${id}`) => ({
    resource: "source_lead" as const, operation: "form_lead.update", entity_model: "FormLead" as const, entity_id: id,
    coalescing_key: key, due_at: new Date(0),
  });
  const seed = async (copies = 1, bad = false) => {
    const id = new mongoose.Types.ObjectId();
    await withTransaction(async (session) => {
      await Forms.collection.insertOne({ _id: id, name: "initial", source_company: "main_site", phone_number: "5550123000",
        pickup_zip: "10001", destination_zip: "94105", timestamp: new Date(), move_date: new Date(), duplicate: false, no_sync: false,
        ...(bad ? { bad_lead: "disconnected_number" } : {}), sheet_sync: [] } as never, { session });
      await SheetSyncJob.create(Array.from({ length: copies }, () => sourceJob(id.toString())), { session, ordered: true });
    });
    return id;
  };
  const run = async (name: string, proof: () => Promise<void>) => {
    for (const collection of await mongoose.connection.db!.collections()) await collection.deleteMany({});
    resetEnsuredTabsCache();
    clearCapturedDailyOperationsFacts();
    await proof();
    console.log(`PASS ${name}`);
  };
  try {
    for (const Model of [Forms, SheetSyncJob, SheetSyncRun, SheetSyncAttempt, SheetSyncLease, SheetSyncQuotaBucket, getDailyOperationsDayModel(), getDailyOperationsEventModel()]) {
      await Model.createCollection(); await Model.createIndexes();
    }
    await run("run-record creation failure releases its fenced drain lease", async () => {
      const creationFailure = mock.method(SheetSyncRun, "create", async () => {
        throw new Error("synthetic run creation failure");
      });
      try {
        await assert.rejects(runSheetSyncDrain("cron", { owner: "run-create-failure" }), /synthetic run creation failure/);
      } finally {
        creationFailure.mock.restore();
      }
      const lease = await SheetSyncLease.findOne({ scope: "sheet-sync:drain" }).lean();
      assert.equal(lease?.lease_owner, null);
      assert.ok(lease?.leased_until && lease.leased_until <= new Date());
    });
    await run("transaction rollback retains atomic domain/outbox intent", async () => {
      await assert.rejects(withTransaction(async (session) => {
        const id = new mongoose.Types.ObjectId();
        await Forms.collection.insertOne({ _id: id } as never, { session });
        await SheetSyncJob.create([sourceJob(id.toString())], { session });
        throw new Error("rollback proof");
      }), /rollback proof/);
      assert.equal(await Forms.countDocuments(), 0);
      assert.equal(await SheetSyncJob.countDocuments(), 0);
    });
    await run("lost append, duplicate claimed keys and overlapping jobs replan fresh Mongo; completion dedupes", async () => {
      const id = await seed(2);
      await SheetSyncJob.create(sourceJob(id.toString(), "overlapping-chain-identity"));
      const f = workbook();
      f.fault("append", "after");
      const metadataWrites = mock.method(Forms.collection, "updateOne");
      const first = await runSheetSyncDrain("cron", { sheets: f.sheets, quota: grant });
      const firstMetadataCalls = metadataWrites.mock.callCount();
      const firstMetadataBytes = metadataWrites.mock.calls.reduce((sum, call) => sum + BSON.calculateObjectSize(call.arguments[1]), 0);
      assert.equal(first.deferred, 3, JSON.stringify({ first, jobs: await SheetSyncJob.find().lean(), requests: f.requests })); assert.equal(first.synced, 0);
      assert.equal(f.count("append"), 1); assert.equal(completed().length, 0);
      const pending = await SheetSyncJob.find().lean();
      assert.ok(pending.every((job) => job.status === "retrying" && job.attempts === 0 && job.target_hints.includes("master_forms")));
      const attempts = await SheetSyncAttempt.find().lean();
      assert.ok(pending.every((job) => attempts.some((attempt) => String(attempt.job_id) === String(job._id) && attempt.status === "deferred")));
      await Forms.collection.updateOne({ _id: id }, { $set: { name: "fresh Mongo value" } });
      await makeDue();
      const second = await runSheetSyncDrain("queue", { sheets: f.sheets, quota: grant });
      // Exclude the explicit canonical name update above from the drain cost.
      const secondMetadataCalls = metadataWrites.mock.calls.slice(firstMetadataCalls + 1);
      console.log(JSON.stringify({ measurement: "overlapping_metadata", subscribers: 3,
        uncertain_updates: firstMetadataCalls, recovered_updates: secondMetadataCalls.length,
        uncertain_update_bson_bytes: firstMetadataBytes,
        recovered_update_bson_bytes: secondMetadataCalls.reduce((sum, call) => sum + BSON.calculateObjectSize(call.arguments[1]), 0) }));
      assert.equal(firstMetadataCalls, 1, "one combined pending metadata update for all subscribers");
      assert.equal(secondMetadataCalls.length, 1, "one combined confirmed metadata update for all subscribers");
      metadataWrites.mock.restore();
      assert.equal(second.synced, 3); assert.equal(f.count("append"), 1);
      assert.equal(f.rows.get("Forms")![1][headers.indexOf("Name")], "fresh Mongo value");
      assert.equal(f.rows.get("Forms")!.length, 2);
      assert.equal(completed().length, 2, "one fact per distinct logical key, with duplicate-key representative semantics");
      const stores = createMongoDailyOperationsStores();
      for (const fact of completed()) {
        assert.equal((await recordDailyOperationsFact(fact.input, { stores }))?.outcome, "recorded");
        assert.equal((await recordDailyOperationsFact(fact.input, { stores }))?.outcome, "duplicate");
      }
      assert.equal(await getDailyOperationsEventModel().countDocuments({ kind: "sheet_sync.completed" }), 2);
      await runSheetSyncDrain("cron", { sheets: f.sheets, quota: grant });
      assert.equal(completed().length, 2);
    });
    await run("lost tombstone delete response reconciles identity without deleting the neighbor", async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await SheetSyncJob.create({ ...sourceJob(id), resource: "delete_source_lead", coalescing_key: `delete:${id}`,
        tombstone: { mongo_id: id, source_company: "main_site", previous_targets: [{ target: "master_forms", spreadsheet_id: "synthetic-leads", tab_name: "Forms", row_number: 2 }] } });
      const f = workbook();
      f.rows.get("Forms")!.push(row(id, "old"), row("neighbor", "preserve"));
      f.fault("delete", "after");
      const first = await runSheetSyncDrain("cron", { sheets: f.sheets, quota: grant });
      assert.equal(first.synced, 0); assert.equal(first.deferred, 1);
      await makeDue();
      const second = await runSheetSyncDrain("cron", { sheets: f.sheets, quota: grant });
      assert.equal(second.synced, 1); assert.equal(f.count("delete"), 1);
      assert.deepEqual(f.rows.get("Forms"), [headers, row("neighbor", "preserve")]);
    });
    await run("same-key subscribers retain independent financial retry hints", async () => {
      const id = new mongoose.Types.ObjectId();
      await BookedLead.collection.insertOne({ _id: id, timestamp: new Date(), book_date: new Date(), source: "main_site", merchant: "synthetic", total_binder_amount: 100, agent_allocations: [] } as never);
      const job = { resource: "booked_lead" as const, operation: "booked_lead.update", entity_model: "BookedLead" as const,
        entity_id: id.toString(), coalescing_key: `booked_lead:${id}`, due_at: new Date(0) };
      const [empty, delivery] = await SheetSyncJob.create([{ ...job, target_hints: ["obsolete-target"] }, { ...job, target_hints: [] }]);
      const f = statefulWorkbook({ "Booked Deals": [[...BOOKED_SHEET_HEADERS]] });
      f.fault("append", "after");
      const first = await runSheetSyncDrain("cron", { sheets: f.sheets, quota: grant });
      assert.equal(first.synced, 1); assert.equal(first.deferred, 1);
      assert.equal((await SheetSyncJob.findById(empty!._id))?.status, "synced");
      assert.equal((await SheetSyncJob.findById(delivery!._id))?.status, "retrying");
      await makeDue();
      assert.equal((await runSheetSyncDrain("queue", { sheets: f.sheets, quota: grant })).synced, 1);
      assert.equal(f.count("append"), 1); assert.equal(f.rows.get("Booked Deals")!.length, 2);
    });
    await run("Mongo metadata failure after confirmed destination and stale delete recovers both subscribers", async () => {
      const id = await seed(2, true);
      const f = workbook();
      f.rows.get("Forms")!.push(row(id.toString(), "old"), row("neighbor", "preserve"));
      const metadataFailure = mock.method(Forms, "updateOne", () => { throw new Error("synthetic metadata failure"); });
      const first = await runSheetSyncDrain("cron", { sheets: f.sheets, quota: grant });
      assert.equal(metadataFailure.mock.callCount(), 1, "failure is attempted once and reaches both subscribers");
      metadataFailure.mock.restore();
      assert.equal(first.failed, 2); assert.equal(first.synced, 0); assert.equal(completed().length, 0);
      assert.equal(f.count("append"), 1); assert.equal(f.count("delete"), 1);
      assert.ok((await SheetSyncJob.find().lean()).every((job) => job.attempts === 1 && job.status === "retrying"));
      await makeDue();
      const second = await runSheetSyncDrain("cron", { sheets: f.sheets, quota: grant });
      assert.equal(second.synced, 2); assert.equal(f.count("append"), 1); assert.equal(f.count("delete"), 1);
      assert.deepEqual(f.rows.get("Forms"), [headers, row("neighbor", "preserve")]);
      assert.equal(f.rows.get("Bad Form Leads")!.length, 2); assert.equal(completed().length, 1);
      const stored = await Forms.findById(id).lean();
      assert.equal(stored!.sheet_sync?.find((entry) => entry.target === "master_bad_leads")?.status, "synced");
    });
    await run("competing drain skips; lease takeover during provider delivery prevents old-owner finalization", async () => {
      await seed();
      const f = workbook();
      const entered = barrier(), release = barrier();
      f.afterRequest(async (operation) => { if (operation === "append") { entered.resolve(); await release.promise; } });
      const first = runSheetSyncDrain("cron", { sheets: f.sheets, quota: grant, owner: "old-owner" });
      await entered.promise;
      assert.equal((await runSheetSyncDrain("queue", { sheets: f.sheets, quota: grant, owner: "competitor" })).skipped, true);
      await SheetSyncLease.updateOne({ scope: "sheet-sync:drain" }, { $set: { lease_owner: "new-owner", leased_until: new Date(Date.now() + 60_000) }, $inc: { lease_epoch: 1 } });
      release.resolve();
      assert.equal((await first).ok, false); assert.equal(completed().length, 0);
      assert.equal(await SheetSyncJob.countDocuments({ status: "synced" }), 0);
      assert.equal(f.count("append"), 1);
      await SheetSyncLease.updateOne({ scope: "sheet-sync:drain" }, { $set: { leased_until: new Date(0) } });
      await makeDue();
      assert.equal((await runSheetSyncDrain("queue", { sheets: f.sheets, quota: grant, owner: "current-owner" })).synced, 1);
      assert.equal(f.count("append"), 1); assert.equal(f.rows.get("Forms")!.length, 2);
    });
    await run("topology fence acquired during delivery preserves stale membership until a later owner reconciles", async () => {
      const id = await seed(1, true);
      const f = workbook();
      f.rows.get("Forms")!.push(row(id.toString(), "old"), row("neighbor", "preserve"));
      f.afterRequest(async (operation) => {
        if (operation === "append") await SheetSyncLease.create({ scope: "lead-reporting:tab-migration", lease_owner: "operator", leased_until: new Date(Date.now() + 60_000) });
      });
      const first = await runSheetSyncDrain("cron", { sheets: f.sheets, quota: grant });
      assert.equal(first.deferred, 1); assert.equal(first.synced, 0); assert.equal(f.count("delete"), 0);
      assert.equal(f.rows.get("Forms")!.length, 3);
      assert.equal((await runSheetSyncDrain("queue", { sheets: f.sheets, quota: grant })).skipped, true);
      await SheetSyncLease.deleteOne({ scope: "lead-reporting:tab-migration" });
      f.afterRequest(() => {});
      await makeDue();
      assert.equal((await runSheetSyncDrain("queue", { sheets: f.sheets, quota: grant })).synced, 1);
      assert.equal(f.count("append"), 1); assert.equal(f.count("delete"), 1);
      assert.deepEqual(f.rows.get("Forms"), [headers, row("neighbor", "preserve")]);
    });
    await run("qualified mixed chains preserve independent membership, commands and newer intent during delivery", async () => {
      const db = mongoose.connection.db!;
      const form = await seed();
      await SheetSyncJob.deleteOne({ entity_id: String(form) });
      const Calls = getCallLeadModel();
      const call = new mongoose.Types.ObjectId(), booking = new mongoose.Types.ObjectId(), cancel = new mongoose.Types.ObjectId();
      const granularity = new mongoose.Types.ObjectId();
      await db.collection("lead_source_granularities").insertOne({ _id: granularity, owner_label: "Synthetic" });
      await Forms.collection.updateOne({ _id: form }, { $set: { source_granularity_id: granularity, normalized_job_no: "9001001", ref_no: "9001001" } });
      await Calls.collection.insertOne({ _id: call, name: "qualified sibling", timestamp: new Date(), source_company: "main_site",
        source_granularity_id: granularity, normalized_job_no: "9001001", job_no: "9001001", phone_number: "5550123001", duration: 180,
        duplicate: false, no_sync: false, form_fill: false, sheet_sync: [],
        ringcentral: { call_log_id: "synthetic-call", ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_answered_over_120s", duration_seconds: 180 } } as never);
      await db.collection("granot_record_links").insertMany([
        { normalized_job_no: "9001001", state: "active", lead_ref: { model: "FormLead", id: form }, source_scope: { source_granularity_id: granularity } },
        { normalized_job_no: "9001001", state: "active", lead_ref: { model: "CallLead", id: call }, source_scope: { source_granularity_id: granularity } },
      ]);
      await BookedLead.collection.insertOne({ _id: booking, normalized_job_no: "9001001", job_no: "9001001", lead_ref: form, lead_model: "FormLead",
        timestamp: new Date(), book_date: new Date(), source: "main_site", merchant: "synthetic", total_binder_amount: 100, agent_allocations: [] } as never);
      await CancelledLead.collection.insertOne({ _id: cancel, booked_lead: booking, timestamp: new Date(), cancel_date: new Date(),
        normalized_job_no_snapshot: "9001001", job_no: "9001001", source: "main_site", refund_amount: 10 } as never);
      const formJob = { resource: "source_lead" as const, operation: "form_lead.update", leadModel: "FormLead" as const, leadId: String(form) };
      const callJob = { ...formJob, operation: "call_lead.update", leadModel: "CallLead" as const, leadId: String(call) };
      const chainJob = { resource: "cancellation_chain" as const, operation: "cancellation.update", cancellationId: String(cancel) };
      const nominate = async () => { for (const job of [formJob, callJob, chainJob]) await enqueueSheetSyncJob(job, { dueAt: new Date(0) }); };
      const nominateAll = async () => {
        await nominate();
        await enqueueSheetSyncJob({ resource: "booking_chain", bookingId: String(booking), operation: "booking.update" }, { dueAt: new Date(0) });
        await enqueueSheetSyncJob({ resource: "booked_lead", bookingId: String(booking), operation: "booking.update" }, { dueAt: new Date(0) });
      };
      await nominateAll();
      const f = statefulWorkbook({ Forms: [headers], "Duplicate Forms": [headers], "Bad Form Leads": [headers],
        Calls: [[...CALL_SHEET_HEADERS]], "Duplicate Calls": [[...CALL_SHEET_HEADERS]], "Bad Call Leads": [[...CALL_SHEET_HEADERS]],
        "Booked Deals": [[...BOOKED_SHEET_HEADERS]], "Cancelled Deals": [[...CANCELLED_SHEET_HEADERS]] });
      const allJobs = await SheetSyncJob.find();
      const plans = (await Promise.all(allJobs.map(planJobWrites))).flat();
      const plannedDocs = plans.filter(plan => plan.doc && plan.writes.length);
      assert.equal(plannedDocs.length, 8);
      const writers = [Forms, Calls, BookedLead, CancelledLead].map(model => mock.method(model.collection, "updateOne"));
      const initial = await measureDrain("mixed", f, () => runSheetSyncDrain("cron", { sheets: f.sheets, quota: grant }));
      assert.equal(initial.synced, 5);
      assert.deepEqual(writers.map(writer => writer.mock.callCount()), [1, 1, 1, 1]);
      for (const writer of writers) writer.mock.restore();
      assert.equal(f.count("append"), 4);
      const assertMembership = (formTab?: string, callTab?: string) => {
        const expected = new Map<string, string>([["Booked Deals", String(booking)], ["Cancelled Deals", String(cancel)]]);
        if (formTab) expected.set(formTab, String(form));
        if (callTab) expected.set(callTab, String(call));
        for (const [tab, rows] of f.rows) {
          const ids = rows.slice(1).map(values => values[rows[0].indexOf("Mongo ID")]);
          assert.deepEqual(ids, expected.has(tab) ? [expected.get(tab)] : [], tab);
        }
      };
      assertMembership("Forms", "Calls");
      // A Form metadata failure fans out only to jobs whose plan included that Form.
      await nominateAll();
      const previous = allJobs.map(job => job._id);
      const failedWrite = mock.method(Forms, "updateOne", () => { throw new Error("mixed Form metadata failure"); });
      const partial = await runSheetSyncDrain("cron", { sheets: f.sheets, quota: grant });
      failedWrite.mock.restore();
      assert.equal(partial.failed, 3);
      assert.equal(partial.synced, 2);
      const recent = await SheetSyncJob.find({ _id: { $nin: previous } }).lean();
      assert.equal(recent.length, 5);
      for (const job of recent) {
        const subscribed = job.entity_id === String(form) || ["booking_chain", "cancellation_chain"].includes(job.resource);
        assert.equal(job.status, subscribed ? "retrying" : "synced", job.coalescing_key);
      }
      await makeDue();
      assert.equal((await runSheetSyncDrain("queue", { sheets: f.sheets, quota: grant })).synced, 3);
      assert.equal(f.count("append"), 4);
      assertMembership("Forms", "Calls");
      // The old plan has already materialized its rows when this canonical transaction commits.
      await nominate();
      let successorId = "";
      f.afterRequest(async operation => {
        if (operation !== "update" || successorId) return;
        await withTransaction(async session => {
          await Forms.collection.updateOne({ _id: form }, { $set: { no_sync: true } }, { session });
          const successor = await enqueueSheetSyncJob(formJob, { dueAt: new Date(0), session });
          successorId = String(successor._id);
        });
      });
      assert.equal((await runSheetSyncDrain("cron", { sheets: f.sheets, quota: grant })).synced, 3);
      assert.ok(successorId, "canonical change arrived during provider delivery");
      assert.equal((await SheetSyncJob.findById(successorId))?.status, "pending");
      f.afterRequest(() => {});
      assert.equal((await runSheetSyncDrain("queue", { sheets: f.sheets, quota: grant })).synced, 1);
      assertMembership(undefined, "Calls");
      await Calls.collection.updateOne({ _id: call }, { $set: { no_sync: true } });
      await nominate();
      assert.equal((await runSheetSyncDrain("queue", { sheets: f.sheets, quota: grant })).synced, 3);
      assertMembership();
      await Forms.collection.updateOne({ _id: form }, { $set: { bad_lead: "disconnected_number" } });
      await Calls.collection.updateOne({ _id: call }, { $set: { duplicate: true } });
      await nominate();
      assert.equal((await runSheetSyncDrain("cron", { sheets: f.sheets, quota: grant })).synced, 3);
      assertMembership("Bad Form Leads", "Duplicate Calls");
      await Forms.collection.updateOne({ _id: form }, { $set: { no_sync: false }, $unset: { bad_lead: "" } });
      await Calls.collection.updateOne({ _id: call }, { $set: { no_sync: false, duplicate: false } });
      await nominate();
      assert.equal((await runSheetSyncDrain("cron", { sheets: f.sheets, quota: grant })).synced, 3);
      assertMembership("Forms", "Calls");
    });
    await run("candidate discovery costs, ordering and competing claim", () => proveCandidateCosts(seed, workbook, grant));
    console.log("10 replica proofs passed; synthetic workbook requests only; no production/provider calls");
  } finally {
    await verifyFixture();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    mock.restoreAll();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
