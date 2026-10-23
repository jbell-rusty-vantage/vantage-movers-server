import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { isLoopbackMongoUri } from "../../../ops/lib/loopback-mongo";
import { getMongoDatabaseName, isTestMode } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { getDailyOperationsDayModel } from "../../models/DailyOperationsDay";
import { getDailyOperationsEventModel } from "../../models/DailyOperationsEvent";
import { buildDaySeed } from "./dayDocument";
import { closeDailyOperationsDay } from "./closeDay";
import { buildMetricTouches } from "./kinds";
import { createMongoDailyOperationsStores, recordDailyOperationsFact, type RecordDailyOperationsFactInput } from "./recordDailyOperationsFact";
import { defaultReplaceCounters, DailyOperationsRebuildError, type DailyOperationsRebuildCounters } from "./rebuild";

const enabled = process.env.DAILY_OPERATIONS_REPLICA_TESTS === "true";
const database = process.env.TEST_MONGO_DATABASE_NAME ?? "";
const day = "2026-10-23";
const now = new Date("2026-10-23T16:00:00Z");

before(async () => {
  if (!enabled) return;
  assert.ok(isTestMode(), "TEST_MODE=true must precede module import");
  assert.match(database, /^testvantagemovers_dailyopswriter[a-z0-9]+$/i);
  assert.equal(getMongoDatabaseName(), database);
  assert.ok(isLoopbackMongoUri(process.env.MONGO_URI ?? ""), "Only an explicit loopback URI is allowed");
  assert.ok(process.env.DOTENV_CONFIG_PATH?.includes("no-dotenv"), "Pin dotenv to a missing test path");
  await connectMongo();
  assert.equal(mongoose.connection.db?.databaseName, database);
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  assert.ok(hello.setName, "Transactions require a replica set");
  assert.ok((hello.hosts as string[]).every((host) => isLoopbackMongoUri(`mongodb://${host}/`)));
  await getDailyOperationsDayModel().createIndexes();
  await getDailyOperationsEventModel().createIndexes();
});

beforeEach(async () => {
  if (!enabled) return;
  await getDailyOperationsEventModel().deleteMany({});
  await getDailyOperationsDayModel().deleteMany({});
});

after(async () => {
  if (!enabled) return;
  assert.equal(mongoose.connection.db?.databaseName, database);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

function input(key: string, overrides: Partial<RecordDailyOperationsFactInput> = {}): RecordDailyOperationsFactInput {
  return {
    kind: "form_lead.created", dedupe_key: `synthetic-replica:${key}`, occurred_at: now,
    source_company: "tbm_leads", ingestion_origin: "wordpress_form", lead_kind: "form",
    metric_touches: buildMetricTouches("form_lead.created", { origin: "wordpress_form", sourceCompany: "tbm_leads" }),
    ...overrides,
  };
}

const write = (fact: RecordDailyOperationsFactInput) => recordDailyOperationsFact(fact, { stores: createMongoDailyOperationsStores(), now: () => now });
const options = { skip: !enabled };

test("replica: concurrent duplicate first-day writes count exactly once", options, async () => {
  const results = await Promise.all(Array.from({ length: 12 }, () => write(input("duplicate"))));
  assert.equal(results.filter((row) => row?.outcome === "recorded").length, 1);
  assert.equal(results.filter((row) => row?.outcome === "duplicate").length, 11);
  assert.equal(await getDailyOperationsEventModel().countDocuments({}), 1);
  const row = await getDailyOperationsDayModel().findOne({ day }).lean();
  assert.equal(row?.leads.total, 1); assert.equal(row?.revision, 1);
  assert.equal(row?.companies.tbm_leads?.form, 1);
  assert.equal(row?.hourly[12]?.leads, 1);
});

test("replica: concurrent unique first-day writes preserve every nested increment", options, async () => {
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => write(input(`unique-${i}`))));
  assert.ok(results.every((row) => row?.outcome === "recorded"));
  const row = await getDailyOperationsDayModel().findOne({ day }).lean();
  assert.equal(row?.leads.total, 12); assert.equal(row?.revision, 12);
  assert.equal(row?.origins.wordpress_form, 12); assert.equal(row?.hourly[12]?.leads, 12);
  assert.equal(row?.companies.tbm_leads?.total, 12);
});

test("replica: event validation failure rolls back its day update", options, async () => {
  assert.equal(await write(input("invalid", { kind: "invalid-kind" as never, lane: "lead", title: "Synthetic invalid event" })), null);
  assert.equal(await getDailyOperationsDayModel().countDocuments({}), 0);
  assert.equal(await getDailyOperationsEventModel().countDocuments({}), 0);
});

test("replica: retained no-touch cards insert without creating a day", options, async () => {
  assert.equal((await write(input("no-touch", { kind: "granot.linked", metric_touches: [] })))?.outcome, "recorded");
  assert.equal(await getDailyOperationsEventModel().countDocuments({}), 1);
  assert.equal(await getDailyOperationsDayModel().countDocuments({}), 0);
});

test("replica: closed-day counters and revision remain frozen while facts persist", options, async () => {
  await getDailyOperationsDayModel().create({ ...buildDaySeed(day), status: "closed", revision: 7 });
  assert.equal((await write(input("closed")))?.outcome, "closed_day");
  const row = await getDailyOperationsDayModel().findOne({ day }).lean();
  const event = await getDailyOperationsEventModel().findOne({}).lean();
  assert.equal(row?.leads.total, 0); assert.equal(row?.revision, 7);
  assert.deepEqual(event?.metric_touches, []);
});

function counters(): DailyOperationsRebuildCounters {
  const seed = buildDaySeed(day);
  return { leads: { ...seed.leads, total: 9, form: 9 }, origins: seed.origins, companies: seed.companies,
    webhooks: seed.webhooks, messages: seed.messages, bookings: seed.bookings, cancellations: seed.cancellations,
    intakes: seed.intakes, exceptions: seed.exceptions, sheet_sync: seed.sheet_sync, hourly: seed.hourly };
}

test("replica: a rebuild CAS cannot erase a concurrently committed counter", options, async () => {
  await getDailyOperationsDayModel().create({ ...buildDaySeed(day), revision: 5 });
  const [written, rebuilt] = await Promise.allSettled([
    write(input("rebuild-race")),
    defaultReplaceCounters({ day, counters: counters(), previousRevision: 5, expectedExists: true }),
  ]);
  assert.equal(written.status, "fulfilled");
  if (written.status === "fulfilled") assert.equal(written.value?.outcome, "recorded");
  const row = await getDailyOperationsDayModel().findOne({ day }).lean();
  if (rebuilt.status === "fulfilled") {
    assert.equal(row?.leads.total, 10); assert.equal(row?.revision, 7);
  } else {
    assert.ok(rebuilt.reason instanceof DailyOperationsRebuildError);
    assert.equal(rebuilt.reason.code, "DAY_CHANGED");
    assert.equal(row?.leads.total, 1); assert.equal(row?.revision, 6);
  }
});

test("replica: close and writer serialize without incrementing an already closed day", options, async () => {
  await getDailyOperationsDayModel().create({ ...buildDaySeed(day), revision: 0 });
  const [written] = await Promise.all([
    write(input("close-race")), closeDailyOperationsDay({ now: () => new Date("2026-10-24T16:00:00Z") }),
  ]);
  const row = await getDailyOperationsDayModel().findOne({ day }).lean();
  const event = await getDailyOperationsEventModel().findOne({}).lean();
  assert.equal(row?.status, "closed");
  if (written?.outcome === "recorded") {
    assert.equal(row?.leads.total, 1); assert.equal(row?.revision, 2);
    assert.ok(event?.metric_touches.length);
  } else {
    assert.equal(written?.outcome, "closed_day");
    assert.equal(row?.leads.total, 0); assert.equal(row?.revision, 1);
    assert.deepEqual(event?.metric_touches, []);
  }
});

test("replica: concurrent closes each advance the day revision only once", options, async () => {
  await getDailyOperationsDayModel().create({ ...buildDaySeed(day), revision: 3 });
  const results = await Promise.all(Array.from({ length: 4 }, () => closeDailyOperationsDay({ now: () => new Date("2026-10-24T16:00:00Z") })));
  assert.equal(results.reduce((n, row) => n + row.closed_days.length, 0), 1);
  assert.equal((await getDailyOperationsDayModel().findOne({ day }).lean())?.revision, 4);
});
