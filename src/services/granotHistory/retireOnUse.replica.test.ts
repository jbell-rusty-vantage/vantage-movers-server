/**
 * Retire on use: receipts leave MongoDB once used, read back by original ID, and keep duplicate
 * delivery and changed-input detection. Opt-in: GRANOT_LIFECYCLE_REPLICA_TESTS=true, TEST_MODE=true and a
 * unique TEST_MONGO_DATABASE_NAME on the loopback csi01 replica.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { BSON, ObjectId, type Db, type Document } from "mongodb";
import mongoose from "mongoose";
import { getDailyOperationsCollectionName } from "../../config/domain/dailyOperations";
import { getGranotLifecycleFlags } from "../../config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { easternDayKey } from "../dailyOperations/dayDocument";
import type { DurableActor } from "../durableWork/types";
import { isCloudStorageError } from "../cloudStorage";
import { applyAutomationPlanAction } from "../granotLifecycle/automationApply";
import { claimAndProcessOrPoll } from "../granotLifecycle/drainer";
import { OperationIdempotencyConflictError } from "../granotLifecycle/errors";
import { applyExtensionGranotItem } from "../granotLifecycle/extensionApply";
import { hashCredentialRedactedPayload } from "../granotLifecycle/receiptEvidence";
import { useGranotArchiveStoreForTests } from "./archiveObjects";
import { archiveObjectReferenced } from "./archiveReferences";
import { fakeGranotArchive } from "./archiveTestSupport";
import { closedRuns, packClosedRun } from "./closedAutomationRun";
import { retireLeadEvidence } from "./retireLeadEvidence";
import { installRetiredOperationIndex, retireReceipt, retireUsedReceipts, RETIRE_ON_USE_CONTROL } from "./retireOnUse";
import { archivedReceipts, readGranotDecision, readGranotObservation, readGranotReceipt } from "./retiredRecords";

const clock = { at: Date.now() };
const archive = fakeGranotArchive(() => new Date(clock.at));
const { storage } = archive;
let db: Db;
let ready = false;
const flags = { ...getGranotLifecycleFlags(), processing_enabled: true };
const initiator: DurableActor = {
  actor_type: "owner", actor_id: "owner-replica", actor_label: "owner@example.invalid", actor_role: "owner",
  request_id: "req-replica", origin: "browser_extension",
};

before(async () => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true" || !/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) return;
  await connectMongo();
  db = mongoose.connection.db!;
  assert.match(db.databaseName, /^testvantagemovers(?:_[a-z0-9]+)?$/i);
  assert.ok((await db.admin().command({ hello: 1 })).setName, "replica set required");
  await getGranotObservationReceiptModel().syncIndexes();
  await db.collection("granot_webhook_receipts").createIndex({ "processing.retention_review_at": 1 }, { sparse: true, name: "granot_retention_review_v1" });
  await installRetiredOperationIndex(db);
  useGranotArchiveStoreForTests(archive.store);
  ready = true;
});
after(async () => {
  useGranotArchiveStoreForTests(undefined);
  await mongoose.disconnect().catch(() => undefined);
});
const skip = (t: { skip: (reason: string) => void }) => {
  if (!ready) t.skip("Replica proof is opt-in (GRANOT_LIFECYCLE_REPLICA_TESTS=true, TEST_MODE=true).");
  return !ready;
};

type Channel = "granot_webhook" | "browser_extension" | "granot_http_automation";
type Seed = { channel: Channel; outcome?: string; reason?: string; route?: string; at?: Date; state?: string; lead?: boolean };
const DAY_AT = new Date(Date.now() - 2 * 86_400_000);

/** One receipt with its Observation, live Decision and Lead, shaped as the drainer leaves a completed one. */
async function seed({ channel, outcome = "applied", reason = "lead_state_changed", route = "priority_updated", at = DAY_AT, state = "completed", lead = true }: Seed) {
  const receipt = new ObjectId(), observation = new ObjectId(), decision = new ObjectId(), leadId = new ObjectId();
  const run = String(new ObjectId());
  const operation = channel === "granot_http_automation" ? `${run}:a` : randomUUID();
  const item = { operation_id: operation, operation_kind: "lead_snapshot_apply" as const, granot_statement: { priority: "2" } };
  const target = { model: "FormLead" as const, id: String(leadId) };
  const effects = outcome === "applied" ? [{ kind: "lead_updated", ref: target, changed_paths: ["granot_priority"] }] : [];
  const result = { decision_id: String(decision), observation_id: String(observation), outcome, effects, target };
  const webhook = channel === "granot_webhook";
  await db.collection("granot_webhook_receipts").insertOne({
    _id: receipt, source_system: "granot", observation_channel: channel, captured_at: at, createdAt: at, payload: item,
    payload_sha256: hashCredentialRedactedPayload(item).payload_sha256, headers: { "content-type": "application/json" },
    ...(webhook ? { route_event_class: route, webhook_day_counted: true } : { channel_operation_id: operation, channel_operation_kind: item.operation_kind }),
    processing: { state, completed_at: at, latest_decision_id: decision, retention_review_at: at, ...(webhook ? {} : { replay_result: result }) },
  });
  await db.collection("granot_observations").insertOne({
    _id: observation, receipt_id: receipt, kind: "lead_snapshot", captured_at: at, priority: { valid: true, canonical: "2" },
    identity: { normalized_job_no: "T-" + receipt.toHexString().slice(-6) }, ...(webhook ? { route_event_class: route } : {}),
  });
  await db.collection("synchronization_decisions").insertOne({
    _id: decision, observation_id: observation, attempt: 1, execution_mode: "live", outcome, reason_code: reason, target, effects, decided_at: at,
  });
  // A newer accepted winner, so the evidence pass may also retire this Observation and Decision.
  if (lead) await db.collection("form_leads").insertOne({ _id: leadId, last_accepted_granot_observation: { observation_id: new ObjectId(), captured_at: new Date() } });
  return { receipt, observation, decision, item, result, run, operation };
}
async function closeRun(row: Awaited<ReturnType<typeof seed>>) {
  const op = { operation: row.operation, kind: row.item.operation_kind, hash: hashCredentialRedactedPayload(row.item).payload_sha256,
    receipt: String(row.receipt), result: row.result as never };
  const object = await storage.store(db.databaseName, packClosedRun(row.run, [op]));
  await closedRuns(db).insertOne({ _id: row.run, count: 1, hash: object.hash, generation: object.generation, closed_at: new Date() });
}
const versionedDay = () => db.collection(getDailyOperationsCollectionName("days")).updateOne(
  { day: easternDayKey(DAY_AT) }, { $set: { webhook_counts_version: 1 }, $setOnInsert: { webhooks: { priority_updated: 4 } } }, { upsert: true });
const hot = (id: ObjectId) => db.collection("granot_webhook_receipts").countDocuments({ _id: id });
const extension = (row: Awaited<ReturnType<typeof seed>>, statement = row.item.granot_statement) => applyExtensionGranotItem(
  { item: { ...row.item, granot_statement: statement }, initiator, headers: {} },
  { claimAndProcess: (id) => claimAndProcessOrPoll(id, { flags, syncPollDeadlineMs: 0 }) },
);

test("retire on use refuses an unused record in every channel, and the online pass only runs once enabled", async (t) => {
  if (skip(t)) return;
  await versionedDay();
  const cases: Array<[string, Seed, string]> = [
    ["webhook whose Daily Operations day has no transactional counts", { channel: "granot_webhook", at: new Date("2001-01-02T15:00:00Z") }, "daily_operations_day_unversioned"],
    ["booking webhook (stays hot by policy)", { channel: "granot_webhook", route: "booking_status_changed" }, "route_not_retired"],
    ["HTTP action whose run has no closed-run replay yet", { channel: "granot_http_automation" }, "closed_run:unfinished_or_recent"],
    ["extension conflict", { channel: "browser_extension", outcome: "conflict", reason: "identity_conflict" }, "unresolved_outcome:conflict"],
    ["extension still processing", { channel: "browser_extension", state: "claimed" }, "not_completed"],
    ["extension whose Lead is gone", { channel: "browser_extension", lead: false }, "lead_missing"],
  ];
  const rows = [];
  for (const [label, input, reason] of cases) {
    const row = await seed(input);
    rows.push(row);
    assert.deepEqual(await retireReceipt(db, row.receipt, storage), { status: "held", channel: input.channel, reason }, label);
    assert.equal(await hot(row.receipt), 1, label);
    assert.equal(await archivedReceipts(db).countDocuments({ _id: row.receipt }), 0, label);
  }
  const control = db.collection<{ _id: string; enabled_from?: Date }>("granot_retention_control");
  await control.deleteOne({ _id: RETIRE_ON_USE_CONTROL });
  assert.deepEqual(await retireUsedReceipts(db, new Date(), storage), { status: "not_configured" });
  await control.insertOne({ _id: RETIRE_ON_USE_CONTROL, enabled_from: new Date("2000-01-01T00:00:00Z") });
  try {
    const pass = await retireUsedReceipts(db, new Date(), storage, 500);
    assert.equal(pass.status, "processed");
    const receipts = await db.collection("granot_webhook_receipts").find({ _id: { $in: rows.map((r) => r.receipt) } }).toArray();
    const booking = receipts.find((r) => r.route_event_class === "booking_status_changed")!;
    assert.equal(booking.processing.retention_review_at, undefined, "a permanent hold leaves the queue");
    for (const r of receipts.filter((x) => x !== booking)) assert.ok(+r.processing.retention_review_at > Date.now(), "others are reviewed again");
    assert.equal(receipts.length, cases.length, "nothing unused left MongoDB");
  } finally {
    await control.deleteOne({ _id: RETIRE_ON_USE_CONTROL });
  }
});

test("a used receipt leaves MongoDB per channel, reads back by ID, and keeps duplicate and changed-input detection", async (t) => {
  if (skip(t)) return;
  await versionedDay();
  const day = () => db.collection(getDailyOperationsCollectionName("days")).findOne({ day: easternDayKey(DAY_AT) }, { projection: { webhooks: 1 } });
  const countsBefore = await day();
  const web = await seed({ channel: "granot_webhook" });
  const ext = await seed({ channel: "browser_extension" });
  const http = await seed({ channel: "granot_http_automation", outcome: "already_current", reason: "desired_state_already_current" });
  await closeRun(http);
  const originals = new Map<string, Document>();
  for (const row of [web, ext, http]) {
    originals.set(String(row.receipt), (await db.collection("granot_webhook_receipts").findOne({ _id: row.receipt }))!);
    const result = await retireReceipt(db, row.receipt, storage);
    assert.equal(result.status, "retired");
    assert.ok(result.status === "retired" && result.locator_bytes < result.bytes, "the locator is smaller than the receipt");
    assert.equal(await hot(row.receipt), 0);
    assert.deepEqual(BSON.serialize((await readGranotReceipt(db, row.receipt))!), BSON.serialize(originals.get(String(row.receipt))!), "read back by original ID");
  }
  assert.deepEqual(await day(), countsBefore, "Daily Operations counts are untouched");

  const replayed = await extension(ext);
  assert.deepEqual([replayed.receipt_id, replayed.outcome, replayed.decision_id], [String(ext.receipt), "applied", String(ext.decision)]);
  await assert.rejects(extension(ext, { priority: "3" }), OperationIdempotencyConflictError);
  assert.equal(await db.collection("granot_webhook_receipts").countDocuments({ channel_operation_id: ext.operation }), 0, "no second receipt");
  const action = (statement = http.item.granot_statement) => applyAutomationPlanAction({ action_id: "a", initiator,
    lifecycle_apply: { ...http.item, granot_statement: statement } as never });
  assert.deepEqual([(await action()).lifecycle_receipt_id, (await action()).outcome], [String(http.receipt), "already_current"]);
  await assert.rejects(action({ priority: "3" }), OperationIdempotencyConflictError);

  // Their Observations and Decisions follow through the evidence pass and still read back by ID.
  for (let page = 0; page < 20; page++) { const pass = await retireLeadEvidence(db, storage.store, storage.read); if ("wrapped" in pass && pass.wrapped) break; }
  for (const row of [web, ext, http]) {
    assert.equal(await db.collection("granot_observations").countDocuments({ _id: row.observation }), 0);
    assert.equal(String((await readGranotObservation(db, row.observation))?.receipt_id), String(row.receipt));
    assert.equal((await readGranotDecision(db, row.decision))?.outcome, row.result.outcome);
  }
  assert.equal((await extension(ext)).decision_id, String(ext.decision), "replay still answers after the evidence left");
});

test("an interrupted or racing retirement resumes safely and never duplicates an operation", async (t) => {
  if (skip(t)) return;
  const crashed = await seed({ channel: "browser_extension" });
  await assert.rejects(retireReceipt(db, crashed.receipt, {
    ...storage, store: async (name, bytes) => { await storage.store(name, bytes); throw new Error("connection lost after upload"); },
  }));
  assert.equal(await hot(crashed.receipt), 1);
  assert.equal(await archivedReceipts(db).countDocuments({ _id: crashed.receipt }), 0);
  const changed = await seed({ channel: "browser_extension" });
  assert.equal((await retireReceipt(db, changed.receipt, {
    ...storage, store: async (name, bytes) => {
      await db.collection("granot_webhook_receipts").updateOne({ _id: changed.receipt }, { $set: { "processing.latest_decision_id": new ObjectId() } });
      return storage.store(name, bytes);
    },
  })).status, "changed");
  assert.equal(await hot(changed.receipt), 1);
  // Resume while duplicates of the same operation arrive: one receipt ID, one locator, no second capture.
  const results = await Promise.allSettled([retireReceipt(db, crashed.receipt, storage), retireReceipt(db, crashed.receipt, storage), extension(crashed), extension(crashed)]);
  const [first, second, ...captures] = results;
  assert.deepEqual([first, second].filter((r) => r.status === "fulfilled" && r.value.status === "retired").length, 1);
  for (const capture of captures) assert.equal(capture.status === "fulfilled" && capture.value.receipt_id, String(crashed.receipt));
  const total = await hot(crashed.receipt) + await archivedReceipts(db).countDocuments({ _id: crashed.receipt });
  assert.equal(total, 1);
  assert.equal(await db.collection("granot_webhook_receipts").countDocuments({ channel_operation_id: crashed.operation, _id: { $ne: crashed.receipt } }), 0);
});

test("a retired receipt's object is never deleted or expired while held or referenced", async (t) => {
  if (skip(t)) return;
  const row = await seed({ channel: "browser_extension" });
  assert.equal((await retireReceipt(db, row.receipt, storage)).status, "retired");
  const locator = (await archivedReceipts(db).findOne({ _id: row.receipt }))!;
  const ref = { name: `history/granot/v1/${db.databaseName}/${locator.hash.slice(0, 2)}/${locator.hash}.bson.gz`, generation: locator.generation, sha256: locator.hash };
  const references = () => archiveObjectReferenced(db, locator.hash);
  await archive.store.hold(ref, { holder: "review", token: "r" });
  clock.at += 800_000;
  for (const attempt of [() => archive.store.startRecoveryClock(ref, { references, reviewToken: "r" }), () => archive.store.deleteIfGeneration(ref, { references, reviewToken: "r" })]) {
    await assert.rejects(attempt(), (e) => isCloudStorageError(e, "referenced"));
  }
  await archive.store.hold(ref, { holder: "publisher" });
  await assert.rejects(archive.store.deleteIfGeneration(ref, { references: async () => false, reviewToken: "r" }), (e) => isCloudStorageError(e, "held"));
  assert.equal(String((await readGranotReceipt(db, row.receipt))?._id), String(row.receipt), "the object still reads");
});
