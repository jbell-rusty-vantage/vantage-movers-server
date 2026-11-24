/**
 * Daily Operations event retirement, end to end on the local replica (csi01, loopback only) with a fake bucket.
 *   node --import tsx ops/daily-operations/event-retirement.replica.ts
 * Proves: an old open day blocks every review; a storage failure changes nothing; a run archives every reviewed event and
 * compacts only closed, old-enough days (with or without webhook count versioning) to their dedupe fence; a late fact with a fenced key is still a
 * duplicate; today's readers never see a fence; a retired event restores byte for byte by original ID; a re-run does
 * nothing. Synthetic rows in a unique `testvantagemovers_dailyops…` database dropped at the end.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { BSON, ObjectId } from "mongodb";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";

const database = `testvantagemovers_dailyops${randomUUID().replaceAll("-", "").slice(0, 8)}`;
for (const key of Object.keys(process.env)) if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;

async function main() {
  const { connectMongo } = await import("../../src/db.js");
  const { CLOUD_STORAGE_NAMESPACES, createFakeObjectStore } = await import("../../src/services/cloudStorage/index.js");
  const { getDailyOperationsEventModel } = await import("../../src/models/DailyOperationsEvent.js");
  const { getDailyOperationsDayModel } = await import("../../src/models/DailyOperationsDay.js");
  const { easternDayKey, easternInstantBounds, previousEasternDayKey } = await import("../../src/services/dailyOperations/dayDocument.js");
  const { recordDailyOperationsFact } = await import("../../src/services/dailyOperations/recordDailyOperationsFact.js");
  const { listDailyOperationsEvents } = await import("../../src/services/dailyOperations/eventsPage.js");
  const { EVENT_ARCHIVE_PACKS_COLLECTION, EVENT_ARCHIVE_PACK_INDEXES, EVENT_RETIREMENT_CONTROL_COLLECTION, EVENT_RETIREMENT_CONTROL_ID,
    daysOf, eventsOf, lookupArchivedEvent, retireClosedDayEvents } = await import("../../src/services/dailyOperations/eventRetirement.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);
  assert.match(process.env.MONGO_URI!, /^mongodb:\/\/127\.0\.0\.1:/, "loopback replica only");
  const db = mongoose.connection.db!;
  try {
    await getDailyOperationsEventModel().createIndexes();
    await getDailyOperationsDayModel().createIndexes();
    for (const i of EVENT_ARCHIVE_PACK_INDEXES) await db.collection(EVENT_ARCHIVE_PACKS_COLLECTION).createIndex(i.key, { name: i.name,
      ...("unique" in i ? { unique: true } : {}), ...("expireAfterSeconds" in i ? { expireAfterSeconds: i.expireAfterSeconds } : {}) });
    await db.collection(EVENT_RETIREMENT_CONTROL_COLLECTION).insertOne({ _id: EVENT_RETIREMENT_CONTROL_ID as never, enabled_at: new Date(), cursor: null });

    const now = new Date();
    const back = (n: number) => { let d = easternDayKey(now); for (let i = 0; i < n; i++) d = previousEasternDayKey(d); return d; };
    const noon = (day: string) => new Date(+easternInstantBounds(day).start + 12 * 3_600_000);
    const [retired, unversioned, missing, yesterday, stuck] = [back(5), back(4), back(6), back(1), back(7)];
    const closedDay = (day: string, version?: number) => ({ day, status: "closed", closed_at: new Date(+noon(day) + 13 * 3_600_000), revision: 2,
      ...(version ? { webhook_counts_version: version } : {}) });
    await daysOf(db).insertMany([closedDay(retired, 1), closedDay(unversioned), closedDay(yesterday, 1), { day: stuck, status: "open", closed_at: null }] as never[]);
    const event = (day: string, key: string, createdAt = noon(day)) => ({ _id: ObjectId.createFromTime(Math.floor(+createdAt / 1000)), day, occurred_at: createdAt,
      lane: "sheet_sync", kind: "sheet_sync.completed", title: "Sheet sync completed", source_company: null, ingestion_origin: null, lead_kind: null,
      job_no: "J-1", entity_type: "FormLead", entity_id: "x", parent_receipt_id: null, links: {}, card: { job_no: "J-1" }, metric_touches: ["sheet_sync.completed"],
      dedupe_key: key, createdAt, updatedAt: createdAt });
    const a = event(retired, "sheet_sync:a:completed"), b = event(retired, "sheet_sync:b:completed", new Date(+noon(retired) + 1000));
    const legacy = event(unversioned, "sheet_sync:c:completed"), orphan = event(missing, "sheet_sync:d:completed");
    const recent = event(yesterday, "sheet_sync:e:completed");
    await eventsOf(db).insertMany([a, b, legacy, orphan, recent] as never[]);
    const before = new Map((await eventsOf(db).find({}, { raw: true }).toArray() as unknown as Buffer[]).map((raw) => [String(BSON.deserialize(raw)._id), Buffer.from(raw)]));
    const unchanged = async (ids: ObjectId[]) => {
      for (const id of ids) assert.ok(Buffer.from(await eventsOf(db).findOne({ _id: id }, { raw: true }) as unknown as Buffer).equals(before.get(String(id))!), `${id} unchanged`);
    };
    const options = { prefix: CLOUD_STORAGE_NAMESPACES["daily-operations-events"].prefix, reuse: { mode: "refuse_released" as const },
      sealedNames: CLOUD_STORAGE_NAMESPACES["daily-operations-events"].sealedNames };

    // 0. An old day the close cron has not closed blocks every review.
    const blocked = await retireClosedDayEvents(db, { now, store: createFakeObjectStore(options).store });
    assert.deepEqual([blocked.status, blocked.reason, blocked.rows], ["not_reviewable", `day_open:${stuck}`, 0]);
    await daysOf(db).updateOne({ day: stuck }, { $set: { status: "closed", closed_at: now, webhook_counts_version: 1 } });

    // 1. Storage failure: nothing changes, cursor unchanged, lease released.
    const broken = createFakeObjectStore(options).store;
    await assert.rejects(retireClosedDayEvents(db, { now, store: { ...broken, put: async () => { throw new Error("gcs down"); } } }));
    await unchanged([a._id, b._id, legacy._id, orphan._id, recent._id]);
    const afterFailure = await db.collection(EVENT_RETIREMENT_CONTROL_COLLECTION).findOne({ _id: EVENT_RETIREMENT_CONTROL_ID as never });
    assert.equal(afterFailure?.cursor, null); assert.equal(afterFailure?.lease_owner, null);

    // 2. A run reviews the four events created before yesterday, archives all four and fences the three on closed days (one unversioned).
    const { store, bucket } = createFakeObjectStore(options);
    const run = await retireClosedDayEvents(db, { now, store });
    assert.deepEqual([run.rows, run.retire, run.hold, run.fenced, run.packs], [4, 3, 1, 3, 1]);
    assert.deepEqual(run.held_reasons, { day_missing: 1 });
    for (const e of [a, b, legacy]) {
      assert.deepEqual(await eventsOf(db).findOne({ _id: e._id }), { _id: e._id, dedupe_key: e.dedupe_key, day: e.day, createdAt: e.createdAt });
    }
    await unchanged([orphan._id, recent._id]);
    const [pack] = await db.collection(EVENT_ARCHIVE_PACKS_COLLECTION).find().toArray();
    assert.ok(pack && pack.rows === 4 && pack.retire === 3 && pack.expires_at > now);
    assert.deepEqual(pack.days, [missing, retired, unversioned].sort());
    assert.ok((await bucket.stat(pack.name))?.customTime, "the pack's 90-day clock started at creation");

    // 3. The fence keeps dedupe: a late fact re-emitting a retired key is a duplicate; a new key on the closed day is stored frozen.
    const late = (key: string) => recordDailyOperationsFact({ kind: "sheet_sync.completed", dedupe_key: key, occurred_at: noon(retired), metric_touches: ["sheet_sync.completed"] });
    assert.equal((await late(a.dedupe_key))?.outcome, "duplicate");
    assert.equal((await recordDailyOperationsFact({ kind: "sheet_sync.completed", dedupe_key: b.dedupe_key, metric_touches: ["sheet_sync.completed"] }))?.outcome,
      "duplicate", "a retry on today's open day still meets the fence");
    assert.equal((await late("sheet_sync:f:completed"))?.outcome, "closed_day");
    const page = await listDailyOperationsEvents({});
    assert.ok(page.items.every((item) => item.event_id !== String(a._id) && item.event_id !== String(b._id)), "today's page never renders a fence");

    // 4. The retired event restores byte for byte by original ID; a re-run reviews nothing new.
    const found = await lookupArchivedEvent(db, String(a._id), store);
    assert.ok(found && found.raw.equals(before.get(String(a._id))!), "restored byte for byte");
    const again = await retireClosedDayEvents(db, { now, store });
    assert.equal(again.rows, 0, "the cursor moved past every reviewed event; the late fact waits for its own createdAt");
    console.log(JSON.stringify({ ok: true, database, blocked: blocked.status, run, pack: { rows: pack.rows, size: pack.size, days: pack.days } }));
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
