import assert from "node:assert/strict";
import { mock } from "node:test";
import mongoose from "mongoose";
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
  Object.assign(process.env, {
    TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database,
    MONGO_URI: "mongodb://127.0.0.1:27129/?replicaSet=sheetRecoveryProof",
    SHEET_SYNC_MODE: "queued", WRITE_SOURCE_LEAD_SHEETS: "false",
    TEST_MASTER_LEADS_SHEET_ID: "synthetic-leads", TEST_MASTER_BOOKED_SHEET_ID: "synthetic-booked",
    SHEET_SYNC_MAX_ROWS_PER_BATCH: "1",
  });
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
  const { BookedLead } = await import("../../src/models/BookedLead.js");
  const { FORM_SHEET_HEADERS, BOOKED_SHEET_HEADERS } = await import("../../src/config/domain.js");
  const { resetEnsuredTabsCache } = await import("../../src/services/googleSheets/tabs.js");
  const { runSheetSyncDrain } = await import("../../src/services/sheetSync/drainer/runSheetSyncDrain.js");
  const { clearCapturedDailyOperationsFacts, getCapturedDailyOperationsFacts } = await import("../../src/services/dailyOperations/testDailyOperationsSink.js");
  const { createMongoDailyOperationsStores, recordDailyOperationsFact } = await import("../../src/services/dailyOperations/recordDailyOperationsFact.js");
  const { getDailyOperationsDayModel } = await import("../../src/models/DailyOperationsDay.js");
  const { getDailyOperationsEventModel } = await import("../../src/models/DailyOperationsEvent.js");
  await connectMongo();
  assert.equal(mongoose.connection.host, "127.0.0.1");
  assert.equal(mongoose.connection.name, database);
  assert.equal((await mongoose.connection.db!.admin().command({ hello: 1 })).setName, "sheetRecoveryProof");
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
      const first = await runSheetSyncDrain("cron", { sheets: f.sheets, quota: grant });
      assert.equal(first.deferred, 3, JSON.stringify({ first, jobs: await SheetSyncJob.find().lean(), requests: f.requests })); assert.equal(first.synced, 0);
      assert.equal(f.count("append"), 1); assert.equal(completed().length, 0);
      const pending = await SheetSyncJob.find().lean();
      assert.ok(pending.every((job) => job.status === "retrying" && job.attempts === 0 && job.target_hints.includes("master_forms")));
      const attempts = await SheetSyncAttempt.find().lean();
      assert.ok(pending.every((job) => attempts.some((attempt) => String(attempt.job_id) === String(job._id) && attempt.status === "deferred")));
      await Forms.collection.updateOne({ _id: id }, { $set: { name: "fresh Mongo value" } });
      await makeDue();
      const second = await runSheetSyncDrain("queue", { sheets: f.sheets, quota: grant });
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
    console.log("7 replica proofs passed; synthetic workbook requests only; no production/provider calls");
  } finally {
    assert.equal(mongoose.connection.name, database);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    mock.restoreAll();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
