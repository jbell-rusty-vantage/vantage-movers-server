import assert from "node:assert/strict";
import { test } from "node:test";
import { SOURCE_COMPANIES } from "../../config/domain/sources";
import {
  encodeDailyOperationsEventCursor,
  type DailyOperationsEventCursor,
} from "./eventsPage";
import {
  createDailyOperationsLiveRedisReader,
  parseDailyOperationsXread,
  runDailyOperationsLiveSse,
  type DailyOperationsLiveEventRow,
  type DailyOperationsLiveRedisReader,
  type DailyOperationsRedisWake,
} from "./liveStream";
import type { DailyOperationsSnapshot } from "./snapshot";

const SNAPSHOT: DailyOperationsSnapshot = {
  timezone: "America/New_York",
  today: "2026-09-08",
  yesterday: "2026-09-07",
  generated_at: "2026-09-08T15:43:00.000Z",
  redis: { configured: true, mode: "stream" },
  metrics: {
    leads: {
      today: 42,
      yesterday: 38,
      yesterday_by_now: 31,
      form: 28,
      call: 14,
      duplicate_form: 3,
      duplicate_call: 1,
    },
    bookings: { today: 6, yesterday: 5, yesterday_by_now: 4 },
    cancellations: { today: 1, yesterday: 0, yesterday_by_now: 0 },
    texts: {
      today: 19,
      yesterday: 22,
      yesterday_by_now: 18,
      deferred: 4,
      held_now: 3,
      skipped: 4,
      failed: 1,
    },
    webhooks: {
      lead_created: { today: 55, yesterday: 49 },
      priority_updated: { today: 120, yesterday: 101 },
      booking_status_changed: { today: 8, yesterday: 7 },
      booked: { today: 5, yesterday: 4 },
      release: { today: 3, yesterday: 3 },
    },
    intakes: { opened_today: 3, still_open: 2 },
    exceptions: {
      zip_missing: 2,
      crm_failed: 0,
      dead_letter: 0,
      adoption_conflict: 0,
    },
  },
  origins: {
    granot_lead_created: 20,
    ringcentral: 14,
    wordpress_form: 0,
    best_relocation_sheet: 6,
    vantage_admin: 2,
  },
  companies: SOURCE_COMPANIES.map((source_company) => ({
    source_company,
    form: 0,
    call: 0,
    total: 0,
    yesterday_total: 0,
  })),
  hourly: { today: [], yesterday: [] },
};

const LEAD_ID = "68bcf1a0c4d5e6f708901234";
const GRANOT_ID = "68bcf1a0c4d5e6f708901235";
const LATER_ID = "68bcf1a0c4d5e6f708901236";

function eventRow(
  overrides: Partial<DailyOperationsLiveEventRow> &
    Pick<DailyOperationsLiveEventRow, "_id">,
): DailyOperationsLiveEventRow {
  return {
    day: "2026-09-08",
    occurred_at: new Date("2026-09-08T15:44:00.000Z"),
    lane: "lead",
    kind: "form_lead.created",
    title: "Form Lead created",
    source_company: "top10_leads",
    ingestion_origin: "granot_lead_created",
    lead_kind: "form",
    job_no: null,
    entity_type: "FormLead",
    entity_id: "lead_1",
    parent_receipt_id: null,
    links: { lead_id: "lead_1", lead_model: "FormLead" },
    card: { customer_name: "Ada" },
    metric_touches: ["leads.form", "leads.total"],
    redis_stream_id: "1717200000000-0",
    ...overrides,
  };
}

function redisFake(
  read: (lastId: string) => Promise<DailyOperationsRedisWake[]>,
): DailyOperationsLiveRedisReader {
  return {
    async xread({ lastId }) {
      return read(lastId);
    },
  };
}

test("first open emits snapshot then tails Redis envelopes as event plus metrics", async () => {
  const chunks: string[] = [];
  let now = Date.parse("2026-09-08T15:43:00.000Z");
  const newer = eventRow({
    _id: { toString: () => LATER_ID },
    occurred_at: new Date("2026-09-08T15:44:05.000Z"),
    redis_stream_id: "1717200000001-0",
  });
  let polls = 0;
  const lastIds: string[] = [];

  await runDailyOperationsLiveSse(
    { write: (chunk) => chunks.push(chunk) },
    {
      getSnapshot: async () => SNAPSHOT,
      findEventById: async (eventId) => (eventId === LATER_ID ? newer : null),
      listAfter: async () => {
        throw new Error("Mongo tail must not run when Redis wakes");
      },
      listNewest: async () =>
        eventRow({
          _id: { toString: () => LEAD_ID },
          occurred_at: new Date("2026-09-08T15:43:00.000Z"),
          redis_stream_id: "1717200000000-0",
        }),
      getRedis: () =>
        redisFake(async (lastId) => {
          lastIds.push(lastId);
          polls += 1;
          return polls === 1
            ? [{ redis_stream_id: "1717200000001-0", event_id: LATER_ID }]
            : [];
        }),
      sleep: async () => {
        now += 8_000;
      },
      now: () => now,
      pollMs: 1,
      heartbeatMs: 60_000,
      maxMs: 20_000,
    },
  );

  const joined = chunks.join("");
  assert.match(joined, /event: snapshot/);
  assert.match(joined, /"today":"2026-09-08"/);
  assert.match(joined, /"yesterday_by_now":31/);
  assert.equal(joined.includes("\nid: \n") || /id: .*\nevent: snapshot/.test(joined), false);
  assert.match(joined, /event: event/);
  assert.match(joined, new RegExp(`id: 2026-09-08T15:44:05.000Z:${LATER_ID}`));
  assert.match(joined, /form_lead.created/);
  assert.match(joined, /event: metrics/);
  assert.match(joined, /"metric_touches":\["leads.form","leads.total"\]/);
  const metricsBlock = chunks.find((chunk) => chunk.includes("event: metrics"));
  assert.ok(metricsBlock);
  assert.equal(metricsBlock.includes("\nid: "), false);
  assert.equal(lastIds[0], "1717200000000-0");
  assert.equal(joined.includes("UPSTASH"), false);
  assert.equal(joined.includes("KV_REST"), false);
});

test("valid Last-Event-ID skips snapshot and continues from the cursor", async () => {
  const chunks: string[] = [];
  let now = Date.parse("2026-09-08T15:43:00.000Z");
  let seenCursor: DailyOperationsEventCursor | undefined;
  const lastEventId = encodeDailyOperationsEventCursor({
    occurred_at: "2026-09-08T15:40:00.000Z",
    event_id: LEAD_ID,
  });

  await runDailyOperationsLiveSse(
    { write: (chunk) => chunks.push(chunk) },
    {
      getSnapshot: async () => {
        throw new Error("snapshot must not run on reconnect");
      },
      findEventById: async (eventId) =>
        eventId === LEAD_ID
          ? eventRow({
              _id: { toString: () => LEAD_ID },
              redis_stream_id: "1717200000000-0",
            })
          : null,
      listAfter: async (cursor) => {
        seenCursor = cursor;
        return [];
      },
      getRedis: () => null,
      sleep: async () => {
        now += 30_000;
      },
      now: () => now,
      pollMs: 1,
      heartbeatMs: 60_000,
      maxMs: 1,
    },
    lastEventId,
  );

  assert.deepEqual(seenCursor, {
    occurred_at: "2026-09-08T15:40:00.000Z",
    event_id: LEAD_ID,
  });
  assert.equal(chunks.join("").includes("event: snapshot"), false);
});

test("invalid Last-Event-ID is treated as first open and emits snapshot", async () => {
  const chunks: string[] = [];
  let now = Date.parse("2026-09-08T15:43:00.000Z");

  await runDailyOperationsLiveSse(
    { write: (chunk) => chunks.push(chunk) },
    {
      getSnapshot: async () => SNAPSHOT,
      findEventById: async () => null,
      listAfter: async () => [],
      getRedis: () => null,
      sleep: async () => {
        now += 30_000;
      },
      now: () => now,
      pollMs: 1,
      heartbeatMs: 60_000,
      maxMs: 1,
    },
    "not-a-cursor",
  );

  assert.match(chunks.join(""), /event: snapshot/);
});

test("missing Redis uses Mongo tail oldest-after-cursor and still emits facts", async () => {
  const chunks: string[] = [];
  let now = Date.parse("2026-09-08T15:43:00.000Z");
  const later = eventRow({
    _id: { toString: () => LATER_ID },
    occurred_at: new Date("2026-09-08T15:44:05.000Z"),
    lane: "granot",
    kind: "granot.lead_created",
    title: "Granot lead created",
    metric_touches: ["webhooks.lead_created"],
  });
  let polls = 0;
  let seenDay: string | undefined;

  await runDailyOperationsLiveSse(
    { write: (chunk) => chunks.push(chunk) },
    {
      getSnapshot: async () => SNAPSHOT,
      findEventById: async () => null,
      listAfter: async (cursor, day) => {
        seenDay = day;
        polls += 1;
        assert.ok(cursor.occurred_at);
        return polls === 1 ? [later] : [];
      },
      getRedis: () => null,
      sleep: async () => {
        now += 8_000;
      },
      now: () => now,
      pollMs: 1,
      heartbeatMs: 60_000,
      maxMs: 20_000,
    },
  );

  const joined = chunks.join("");
  assert.match(joined, /event: snapshot/);
  assert.match(joined, /event: event/);
  assert.match(joined, /granot.lead_created/);
  assert.match(joined, /event: metrics/);
  assert.equal(seenDay, "2026-09-08");
});

test("Redis throw degrades to Mongo tail for that loop", async () => {
  const chunks: string[] = [];
  let now = Date.parse("2026-09-08T15:43:00.000Z");
  const later = eventRow({
    _id: { toString: () => LATER_ID },
    occurred_at: new Date("2026-09-08T15:44:05.000Z"),
  });
  let polls = 0;

  await runDailyOperationsLiveSse(
    { write: (chunk) => chunks.push(chunk) },
    {
      getSnapshot: async () => SNAPSHOT,
      findEventById: async () => null,
      listAfter: async () => {
        polls += 1;
        return polls === 1 ? [later] : [];
      },
      getRedis: () => ({
        async xread() {
          throw new Error("Upstash REST unavailable");
        },
      }),
      sleep: async () => {
        now += 8_000;
      },
      now: () => now,
      pollMs: 1,
      heartbeatMs: 60_000,
      maxMs: 20_000,
    },
  );

  assert.match(chunks.join(""), /form_lead.created/);
});

test("replica-lag skip retries the same Redis id and does not drop the event", async () => {
  const chunks: string[] = [];
  let now = Date.parse("2026-09-08T15:43:00.000Z");
  const later = eventRow({
    _id: { toString: () => LATER_ID },
    occurred_at: new Date("2026-09-08T15:44:05.000Z"),
  });
  const lastIds: string[] = [];
  let finds = 0;

  await runDailyOperationsLiveSse(
    { write: (chunk) => chunks.push(chunk) },
    {
      getSnapshot: async () => SNAPSHOT,
      findEventById: async (eventId) => {
        if (eventId !== LATER_ID) return null;
        finds += 1;
        return finds === 1 ? null : later;
      },
      listAfter: async () => {
        throw new Error("Mongo tail must not run while Redis is retrying lag");
      },
      listNewest: async () =>
        eventRow({
          _id: { toString: () => LEAD_ID },
          occurred_at: new Date("2026-09-08T15:43:00.000Z"),
          redis_stream_id: "1717200000000-0",
        }),
      getRedis: () =>
        redisFake(async (lastId) => {
          lastIds.push(lastId);
          return [{ redis_stream_id: "1717200000001-0", event_id: LATER_ID }];
        }),
      sleep: async () => {
        now += 8_000;
      },
      now: () => now,
      pollMs: 1,
      heartbeatMs: 60_000,
      maxMs: 20_000,
    },
  );

  assert.equal(lastIds[0], "1717200000000-0");
  assert.equal(lastIds[1], "1717200000000-0");
  assert.match(chunks.join(""), new RegExp(LATER_ID));
  assert.ok(finds >= 2);
});

test("lane query is ignored — one socket emits every Daily Operations Event", async () => {
  const chunks: string[] = [];
  let now = Date.parse("2026-09-08T15:43:00.000Z");
  const granot = eventRow({
    _id: { toString: () => GRANOT_ID },
    occurred_at: new Date("2026-09-08T15:44:05.000Z"),
    lane: "granot",
    kind: "granot.priority_updated",
    title: "Granot priority updated",
    metric_touches: ["webhooks.priority_updated"],
  });
  let polls = 0;

  await runDailyOperationsLiveSse(
    { write: (chunk) => chunks.push(chunk) },
    {
      getSnapshot: async () => SNAPSHOT,
      findEventById: async (eventId) => (eventId === GRANOT_ID ? granot : null),
      listAfter: async () => [],
      getRedis: () =>
        redisFake(async () => {
          polls += 1;
          return polls === 1
            ? [{ redis_stream_id: "1717200000002-0", event_id: GRANOT_ID }]
            : [];
        }),
      sleep: async () => {
        now += 8_000;
      },
      now: () => now,
      pollMs: 1,
      heartbeatMs: 60_000,
      maxMs: 20_000,
    },
  );

  const joined = chunks.join("");
  assert.match(joined, /granot.priority_updated/);
  assert.match(joined, /"lane":"granot"/);
});

test("heartbeat fires after 15s idle and has no id", async () => {
  const chunks: string[] = [];
  let now = Date.parse("2026-09-08T15:43:00.000Z");

  await runDailyOperationsLiveSse(
    { write: (chunk) => chunks.push(chunk) },
    {
      getSnapshot: async () => SNAPSHOT,
      findEventById: async () => null,
      listAfter: async () => [],
      getRedis: () => null,
      sleep: async () => {
        now += 16_000;
      },
      now: () => now,
      pollMs: 1,
      heartbeatMs: 15_000,
      maxMs: 20_000,
    },
  );

  const heartbeat = chunks.find((chunk) => chunk.includes("event: heartbeat"));
  assert.ok(heartbeat);
  assert.match(heartbeat, /"ts":"2026-09-08T15:43:16.000Z"/);
  assert.equal(heartbeat.includes("\nid: "), false);
});

test("parseDailyOperationsXread reads object and flat-array field shapes", () => {
  const fromObjects = parseDailyOperationsXread([
    [
      "dailyops:local:stream:2026-09-08",
      [
        [
          "1717200000000-0",
          {
            event_id: LEAD_ID,
            day: "2026-09-08",
            kind: "form_lead.created",
            lane: "lead",
            occurred_at: "2026-09-08T15:44:00.000Z",
            dedupe_key: "form:1",
          },
        ],
      ],
    ],
  ]);
  assert.deepEqual(fromObjects, [
    { redis_stream_id: "1717200000000-0", event_id: LEAD_ID },
  ]);

  const fromPairs = parseDailyOperationsXread([
    [
      "dailyops:local:stream:2026-09-08",
      [["1717200000001-0", ["event_id", GRANOT_ID, "day", "2026-09-08"]]],
    ],
  ]);
  assert.deepEqual(fromPairs, [
    { redis_stream_id: "1717200000001-0", event_id: GRANOT_ID },
  ]);

  assert.deepEqual(parseDailyOperationsXread(null), []);
  assert.deepEqual(parseDailyOperationsXread([]), []);
});

test("test runner never constructs an Upstash client for the live isolate", () => {
  assert.equal(createDailyOperationsLiveRedisReader(), null);
});
