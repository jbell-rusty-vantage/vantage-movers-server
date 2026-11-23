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
import { captureChannelOperationReceipt, persistGranotChannelReceipt } from "../granotLifecycle/capture";
import { hashCredentialRedactedPayload } from "../granotLifecycle/receiptEvidence";
import { useGranotArchiveStoreForTests } from "./archiveObjects";
import { archiveObjectReferenced } from "./archiveReferences";
import { fakeGranotArchive, historyReplica } from "./archiveTestSupport";
import { closedRuns, packClosedRun } from "./closedAutomationRun";
import { END_OF_LIFE_CONTROL, END_OF_LIFE_STATE, endOfLifePass, finishReview, referencesOf, startReview } from "./endOfLife";
import { retireLeadEvidence } from "./retireLeadEvidence";
import { installRetiredOperationIndex, retireReceipt, retireUsedReceipts, RETIRE_ON_USE_CONTROL, RETIRED_OPERATION_INDEX_CONTROL } from "./retireOnUse";
import { archivedReceipts, readGranotDecision, readGranotObservation, readGranotReceipt, readRetiredOperation, resetRetiredOperationIndexCacheForTests } from "./retiredRecords";

const clock = { at: Date.now() };
const archive = fakeGranotArchive(() => new Date(clock.at));
const { storage } = archive;
let db: Db;
let defaultDb: Db;
let ready = false;
const flags = { ...getGranotLifecycleFlags(), processing_enabled: true };
const initiator: DurableActor = {
  actor_type: "owner", actor_id: "owner-replica", actor_label: "owner@example.invalid", actor_role: "owner",
  request_id: "req-replica", origin: "browser_extension",
};

before(async () => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true" || !/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) return;
  await connectMongo();
  db = defaultDb = mongoose.connection.db!;
  assert.match(db.databaseName, /^testvantagemovers(?:_[a-z0-9]+)?$/i);
  assert.ok((await db.admin().command({ hello: 1 })).setName, "replica set required");
  await getGranotObservationReceiptModel().syncIndexes();
  await db.collection("granot_webhook_receipts").createIndex({ "processing.retention_review_at": 1 }, { sparse: true, name: "granot_retention_review_v1" });
  await installRetiredOperationIndex(db);
  // Installed long ago: past the post-install settle window.
  await db.collection("granot_retention_control").updateOne({ _id: RETIRED_OPERATION_INDEX_CONTROL as never }, { $set: { installed_at: new Date(0) } });
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
type Seed = { channel: Channel; outcome?: string; reason?: string; route?: string; at?: Date; state?: string; lead?: boolean; kind?: string; into?: Db };
const DAY_AT = new Date(Date.now() - 2 * 86_400_000);

/** One receipt with its Observation, live Decision and Lead, shaped as the drainer leaves a completed one. */
async function seed({ channel, outcome = "applied", reason = "lead_state_changed", route = "priority_updated", at = DAY_AT, state = "completed", lead = true, kind = "lead_snapshot_apply", into }: Seed) {
  const db = into ?? defaultDb;
  const receipt = new ObjectId(), observation = new ObjectId(), decision = new ObjectId(), leadId = new ObjectId();
  const run = String(new ObjectId());
  const operation = channel === "granot_http_automation" ? `${run}:a` : randomUUID();
  const item = { operation_id: operation, operation_kind: kind as "lead_snapshot_apply", granot_statement: { priority: "2" } };
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
    ["extension booking action, policy-final (stays hot by policy)", { channel: "browser_extension", kind: "booking_action_apply", outcome: "policy_blocked", reason: "booking_policy" }, "kind_not_retired"],
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
    const permanent = (r: Document) => r.route_event_class === "booking_status_changed" || r.channel_operation_kind === "booking_action_apply";
    for (const r of receipts) {
      if (permanent(r)) assert.equal(r.processing.retention_review_at, undefined, "a permanent hold leaves the queue");
      else assert.ok(+r.processing.retention_review_at > Date.now(), "others are reviewed again");
    }
    assert.equal(receipts.length, cases.length, "nothing unused left MongoDB");
  } finally {
    await control.deleteOne({ _id: RETIRE_ON_USE_CONTROL });
  }

  // Merged but not installed: without the operation index nothing in a channel retires, and the
  // capture-path lookup returns without reading locators (a planted locator is not even seen).
  const replica = await historyReplica(t, "noindex");
  assert.ok(replica);
  try {
    const bare = replica.db;
    await bare.collection("granot_webhook_receipts").createIndex({ "processing.retention_review_at": 1 }, { sparse: true, name: "granot_retention_review_v1" });
    await bare.collection("granot_retention_control").insertOne({ _id: RETIRE_ON_USE_CONTROL as never, enabled_from: new Date("2000-01-01T00:00:00Z") });
    const used = await seed({ channel: "browser_extension", into: bare });
    const pass = await retireUsedReceipts(bare, new Date(), storage);
    assert.deepEqual(pass.status === "processed" && [pass.retired, pass.holds], [0, { locator_operation_index_missing: 1 }]);
    assert.equal(await bare.collection("granot_webhook_receipts").countDocuments({ _id: used.receipt }), 1);
    await archivedReceipts(bare).insertOne({ _id: new ObjectId(), observation_channel: "browser_extension", channel_operation_id: used.operation });
    assert.equal(await readRetiredOperation(bare, "browser_extension", used.operation), null);
    // Just installed: a process may still cache "no index", so nothing retires inside the settle window.
    await installRetiredOperationIndex(bare);
    await bare.collection("granot_webhook_receipts").updateOne({ _id: used.receipt }, { $set: { "processing.retention_review_at": new Date("2001-01-01T00:00:00Z") } });
    const settling = await retireUsedReceipts(bare, new Date(), storage);
    assert.deepEqual(settling.status === "processed" && [settling.retired, settling.holds], [0, { locator_operation_index_settling: 1 }]);
  } finally {
    await replica.db.dropDatabase();
    await replica.client.close();
  }

  // Fails closed: a cold process whose index check errors (other than a missing collection) refuses
  // the capture instead of inserting without the retired-key check.
  const locators = db.collection("granot_archived_receipts");
  const prototype = Object.getPrototypeOf(locators) as { listIndexes: (...args: unknown[]) => unknown };
  const listIndexes = prototype.listIndexes;
  resetRetiredOperationIndexCacheForTests();
  prototype.listIndexes = () => ({ toArray: async () => { throw Object.assign(new Error("not authorized"), { code: 13 }); } });
  const operation = randomUUID();
  try {
    await assert.rejects(captureChannelOperationReceipt({
      observation_channel: "browser_extension", authentication_method: "extension_session", channel_operation_kind: "lead_snapshot_apply",
      channel_operation_id: operation, captured_at: new Date(), headers: {}, initiator,
      payload: { operation_id: operation, operation_kind: "lead_snapshot_apply", granot_statement: { priority: "2" } },
    }));
  } finally {
    prototype.listIndexes = listIndexes;
    resetRetiredOperationIndexCacheForTests();
  }
  assert.equal(await db.collection("granot_webhook_receipts").countDocuments({ channel_operation_id: operation }), 0, "no plain insert");
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
    const expected = originals.get(String(row.receipt))!;
    delete expected.processing.retention_review_at; // review bookkeeping is not archived
    assert.deepEqual(BSON.serialize((await readGranotReceipt(db, row.receipt))!), BSON.serialize(expected), "read back by original ID");
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
  let uploaded = "";
  await assert.rejects(retireReceipt(db, crashed.receipt, {
    ...storage, store: async (name, bytes) => { uploaded = (await storage.store(name, bytes)).generation; throw new Error("connection lost after upload"); },
  }));
  assert.equal(await hot(crashed.receipt), 1);
  assert.equal(await archivedReceipts(db).countDocuments({ _id: crashed.receipt }), 0);
  // A review claim between attempts must not change the archived bytes (no orphaned second object).
  await db.collection("granot_webhook_receipts").updateOne({ _id: crashed.receipt },
    { $set: { "processing.retention_review_at": new Date(), "processing.retention_reason": "retry" } });
  const changed = await seed({ channel: "browser_extension" });
  assert.equal((await retireReceipt(db, changed.receipt, {
    ...storage, store: async (name, bytes) => {
      await db.collection("granot_webhook_receipts").updateOne({ _id: changed.receipt }, { $set: { "processing.latest_decision_id": new ObjectId() } });
      return storage.store(name, bytes);
    },
  })).status, "changed");
  assert.equal(await hot(changed.receipt), 1);

  // Deterministic race: the retirement commits after a duplicate capture has checked the locator
  // and before it inserts. The capture still replays the original receipt ID.
  let raced: ReturnType<typeof retireReceipt> | undefined;
  const capture = await captureChannelOperationReceipt({
    observation_channel: "browser_extension", authentication_method: "extension_session", channel_operation_kind: "lead_snapshot_apply",
    channel_operation_id: crashed.operation, captured_at: new Date(), headers: {}, payload: crashed.item, initiator,
  }, (document) => persistGranotChannelReceipt(document, { afterRetiredCheck: async () => { await (raced ??= retireReceipt(db, crashed.receipt, storage)); } }));
  assert.equal((await raced!).status, "retired");
  assert.deepEqual([capture.status, capture.receipt_id], ["replayed", String(crashed.receipt)]);
  assert.equal((await archivedReceipts(db).findOne({ _id: crashed.receipt }))?.generation, uploaded, "the retry reused the first upload");
  const [again, replayed] = await Promise.all([retireReceipt(db, crashed.receipt, storage), extension(crashed)]);
  assert.deepEqual([again.status, replayed.receipt_id], ["absent", String(crashed.receipt)]);
  assert.equal(await db.collection("granot_webhook_receipts").countDocuments({ channel_operation_id: crashed.operation }), 0, "no second receipt");
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

test("end of life: a fully retired object starts its 90-day clock after the review drain, its rows expire a day earlier, and kept objects stay", async (t) => {
  if (skip(t)) return;
  const DAY = 86_400_000;
  const nameOf = (hash: string) => `history/granot/v1/${db.databaseName}/${hash.slice(0, 2)}/${hash}.bson.gz`;
  const state = db.collection<{ _id: string; kind: "receipt" | "evidence" | "history"; generation?: string; queued_at?: Date }>(END_OF_LIFE_STATE);
  // `done`: receipt and evidence both retired. `live`: receipt retired, its Observation still hot (Pool admission reads its locator).
  const done = await seed({ channel: "browser_extension" });
  assert.equal((await retireReceipt(db, done.receipt, storage)).status, "retired");
  for (let page = 0; page < 20; page++) { const pass = await retireLeadEvidence(db, storage.store, storage.read); if ("wrapped" in pass && pass.wrapped) break; }
  const live = await seed({ channel: "browser_extension" });
  assert.equal((await retireReceipt(db, live.receipt, storage)).status, "retired");
  const http = await seed({ channel: "granot_http_automation" });
  await closeRun(http);
  const doneLocator = (await archivedReceipts(db).findOne({ _id: done.receipt }))!;
  const page = doneLocator.evidence_archive.hash as string;
  const hotPointer = new ObjectId();
  await db.collection("granot_webhook_receipts").insertOne({ _id: hotPointer, evidence_archive: { hash: page } });
  const table: Array<[string, string, string | null]> = [
    ["fully retired receipt", doneLocator.hash, null],
    ["receipt whose Observation is still hot", (await archivedReceipts(db).findOne({ _id: live.receipt }))!.hash, "observation_hot"],
    ["closed scheduled run (fences run creation)", (await closedRuns(db).findOne({ _id: http.run as never }))!.hash, "closed_run"],
    ["evidence page a hot receipt still points at", page, "hot_receipt"],
  ];
  const refs = await referencesOf(db, table.map(([, hash]) => hash));
  for (const [label, hash, reason] of table) assert.equal(refs.get(hash)!.blocked, reason, label);
  await db.collection("granot_webhook_receipts").deleteOne({ _id: hotPointer });

  // Off until the Owner enables it.
  assert.equal((await endOfLifePass(db, { store: archive.store, days: 90 })).status, "not_configured");

  // Review, drain, then the clock: rows are marked only once the 800 s drain has passed.
  const at = () => new Date(clock.at);
  assert.equal((await startReview(db, archive.store, doneLocator.hash, "receipt", at(), 90)).outcome, "review_started");
  const reviewing = (await state.findOne({ _id: doneLocator.hash }))!;
  assert.equal((await finishReview(db, archive.store, reviewing, at(), 90)).outcome, "draining");
  assert.equal((await archivedReceipts(db).findOne({ _id: done.receipt }))!.expires_at, undefined, "nothing marked before the drain");
  clock.at += 800_000;
  const released = await finishReview(db, archive.store, (await state.findOne({ _id: doneLocator.hash }))!, at(), 90);
  assert.deepEqual(released, { outcome: "released", rows: 1 });
  const object = (await archive.store.stat(nameOf(doneLocator.hash)))!;
  const expiresAt = (await archivedReceipts(db).findOne({ _id: done.receipt }))!.expires_at as Date;
  assert.ok(object.recoveryClockStartedAt && !Object.keys(object.holds).length, "on its clock, unheld");
  assert.ok(+expiresAt <= Date.parse(object.recoveryClockStartedAt!) + 89 * DAY, "the locator expires at least a day before the bucket deletes");
  assert.equal((await state.findOne({ _id: page }))?.queued_at instanceof Date, true, "the evidence page the locator also points at is queued");

  // A re-put of identical bytes during review cancels it; the page's rows stay unmarked.
  assert.equal((await startReview(db, archive.store, page, "evidence", at(), 90)).outcome, "review_started");
  await storage.store(db.databaseName, archive.bucket.peek(nameOf(page))!.bytes);
  clock.at += 800_000;
  assert.equal((await finishReview(db, archive.store, (await state.findOne({ _id: page }))!, at(), 90)).outcome, "review_cancelled");
  assert.equal(await db.collection("granot_history_archive_chunks").countDocuments({ hash: page, expires_at: { $exists: true } }), 0);

  // Regression (review of #270): an abandoned review of an object an earlier release had clocked must leave it held,
  // or the bucket deletes it on that old clock while a live reader points at it.
  const t0 = object.recoveryClockStartedAt;
  await storage.store(db.databaseName, archive.bucket.peek(nameOf(doneLocator.hash))!.bytes); // a new reader re-holds it
  assert.equal((await startReview(db, archive.store, doneLocator.hash, "receipt", at(), 90)).outcome, "review_started");
  const reader = new ObjectId();
  await db.collection("granot_webhook_receipts").insertOne({ _id: reader, history_archive: { hash: doneLocator.hash } });
  clock.at += 800_000;
  assert.equal((await finishReview(db, archive.store, (await state.findOne({ _id: doneLocator.hash }))!, at(), 90)).outcome, "hot_receipt");
  const abandoned = (await archive.store.stat(nameOf(doneLocator.hash)))!;
  assert.deepEqual([abandoned.recoveryClockStartedAt, abandoned.holds], [t0, { publisher: "1" }], "held again, not released");
  await db.collection("granot_webhook_receipts").deleteOne({ _id: reader });

  // Marked rows assume the window recorded at enable: a pass without it (or with fewer days) refuses to run.
  await db.collection("granot_retention_control").insertOne({ _id: END_OF_LIFE_CONTROL as never, enabled_at: at(), kinds: ["receipt"], recovery_days: 120 });
  assert.equal((await endOfLifePass(db, { store: archive.store, days: 90, now: at() })).status, "failed");

  // Past its end of life a locator reads as absent; the fence still answers until the TTL removes it.
  await archivedReceipts(db).updateOne({ _id: done.receipt }, { $set: { expires_at: new Date(Date.now() - 1000) } });
  assert.equal(await readGranotReceipt(db, done.receipt), null);
  await db.collection("granot_retention_control").deleteOne({ _id: END_OF_LIFE_CONTROL as never });
});
