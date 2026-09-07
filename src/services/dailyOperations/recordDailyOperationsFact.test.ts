import assert from "node:assert/strict";
import { test } from "node:test";
import { SOURCE_COMPANIES } from "../../config/domain/sources";
import { shouldPublishDailyOperationsRedis } from "../../config/domain/dailyOperations";
import { applyDottedIncrements, buildDaySeed } from "./dayDocument";
import {
  DAILY_OPERATIONS_KIND_CATALOG,
  buildMetricTouches,
  defaultMetricTouches,
} from "./kinds";
import {
  recordDailyOperationsFact,
  type DailyOperationsEventInsert,
  type DailyOperationsFactStores,
  type DailyOperationsRedisPublisher,
  type RecordDailyOperationsFactInput,
} from "./recordDailyOperationsFact";
import {
  clearCapturedDailyOperationsFacts,
  getCapturedDailyOperationsFacts,
} from "./testDailyOperationsSink";

type MemoryDay = ReturnType<typeof buildDaySeed> & { revision: number };

type MemoryStores = DailyOperationsFactStores & {
  events: Array<DailyOperationsEventInsert & { id: string }>;
  days: Map<string, MemoryDay>;
  incrementCalls: number;
};

function createMemoryStores(
  initialDays: MemoryDay[] = [],
): MemoryStores {
  const events: Array<DailyOperationsEventInsert & { id: string }> = [];
  const days = new Map<string, MemoryDay>(
    initialDays.map((day) => [day.day, structuredClone(day)]),
  );
  let nextId = 1;
  let incrementCalls = 0;

  return {
    events,
    days,
    get incrementCalls() {
      return incrementCalls;
    },
    async insertEvent(doc) {
      if (events.some((event) => event.dedupe_key === doc.dedupe_key)) {
        return { duplicate: true };
      }
      const id = `evt_${nextId}`;
      nextId += 1;
      events.push({
        ...doc,
        id,
        card: { ...doc.card },
        links: { ...doc.links },
        metric_touches: [...doc.metric_touches],
      });
      return { id };
    },
    async setEventMetricTouches(id, touches) {
      const event = events.find((row) => row.id === id);
      if (event) event.metric_touches = touches;
    },
    async setEventRedisStreamId(id, streamId) {
      const event = events.find((row) => row.id === id);
      if (event) event.redis_stream_id = streamId;
    },
    async findDayStatus(day) {
      return days.get(day)?.status ?? null;
    },
    async incrementOpenDay({ day, increments, seed }) {
      incrementCalls += 1;
      let current = days.get(day);
      if (!current) {
        current = { ...structuredClone(seed), revision: 0 };
        days.set(day, current);
      }
      if (current.status === "closed") return;
      applyDottedIncrements(
        current as unknown as Record<string, unknown>,
        increments,
      );
    },
  };
}

function formLeadInput(
  overrides: Partial<RecordDailyOperationsFactInput> = {},
): RecordDailyOperationsFactInput {
  return {
    kind: "form_lead.created",
    dedupe_key: "form_lead:lead1:created",
    occurred_at: new Date("2026-06-01T03:00:00.000Z"),
    title: "Form Lead created",
    source_company: "tbm_leads",
    ingestion_origin: "wordpress_form",
    lead_kind: "form",
    entity_type: "FormLead",
    entity_id: "lead1",
    links: { lead_id: "lead1", lead_model: "FormLead" },
    card: { customer_name: "Ada", phone_last4: "4242" },
    metric_touches: buildMetricTouches("form_lead.created", {
      origin: "wordpress_form",
      sourceCompany: "tbm_leads",
    }),
    ...overrides,
  };
}

test("unique dedupe_key insert increments the named metric_touches", async () => {
  const stores = createMemoryStores();
  const result = await recordDailyOperationsFact(formLeadInput(), { stores });

  assert.deepEqual(result, {
    event_id: "evt_1",
    day: "2026-05-31",
    outcome: "recorded",
  });
  assert.equal(stores.incrementCalls, 1);
  assert.equal(stores.events.length, 1);
  assert.deepEqual(stores.events[0]?.metric_touches, [
    "leads.form",
    "leads.total",
    "hourly.leads",
    "origins.wordpress_form",
    "companies.tbm_leads.form",
    "companies.tbm_leads.total",
  ]);

  const day = stores.days.get("2026-05-31");
  assert.ok(day);
  assert.equal(day.leads.form, 1);
  assert.equal(day.leads.total, 1);
  assert.equal(day.origins.wordpress_form, 1);
  assert.equal(day.companies.tbm_leads.form, 1);
  assert.equal(day.hourly[23]?.leads, 1);
  assert.equal(day.revision, 1);
  assert.equal(day.hourly.length, 24);
  for (const slug of SOURCE_COMPANIES) {
    assert.ok(day.companies[slug]);
  }
});

test("duplicate dedupe_key is a no-op: no second increment and no XADD", async () => {
  const stores = createMemoryStores();
  const xaddCalls: unknown[] = [];
  const redis: DailyOperationsRedisPublisher = {
    async xadd(key, id, fields, options) {
      xaddCalls.push({ key, id, fields, options });
      return "1000-0";
    },
  };

  const deps = {
    stores,
    shouldPublish: () => true,
    getRedis: () => redis,
  };
  const first = await recordDailyOperationsFact(formLeadInput(), deps);
  const second = await recordDailyOperationsFact(formLeadInput(), deps);

  assert.equal(first?.outcome, "recorded");
  assert.deepEqual(second, {
    event_id: "",
    day: "2026-05-31",
    outcome: "duplicate",
  });
  assert.equal(stores.events.length, 1);
  assert.equal(stores.incrementCalls, 1);
  assert.equal(stores.days.get("2026-05-31")?.leads.form, 1);
  assert.equal(xaddCalls.length, 1);
});

test("closed day skips increment and records empty metric_touches", async () => {
  const closed = {
    ...buildDaySeed("2026-05-31"),
    revision: 4,
    status: "closed" as const,
    closed_at: new Date("2026-06-01T04:05:00.000Z"),
  };
  closed.leads.form = 9;
  const stores = createMemoryStores([closed]);
  const xaddCalls: unknown[] = [];

  const result = await recordDailyOperationsFact(formLeadInput(), {
    stores,
    shouldPublish: () => true,
    getRedis: () => ({
      async xadd(...args) {
        xaddCalls.push(args);
        return "2000-0";
      },
    }),
  });

  assert.equal(result?.outcome, "closed_day");
  assert.equal(stores.incrementCalls, 0);
  assert.deepEqual(stores.events[0]?.metric_touches, []);
  assert.equal(stores.days.get("2026-05-31")?.leads.form, 9);
  assert.equal(stores.days.get("2026-05-31")?.revision, 4);
  assert.equal(stores.events.length, 1);
});

test("missing Redis client still persists the event and day increment", async () => {
  const stores = createMemoryStores();
  let redisConstructs = 0;

  const result = await recordDailyOperationsFact(formLeadInput(), {
    stores,
    shouldPublish: () => true,
    getRedis: () => {
      redisConstructs += 1;
      return null;
    },
  });

  assert.equal(result?.outcome, "recorded");
  assert.equal(redisConstructs, 1);
  assert.equal(stores.events.length, 1);
  assert.equal(stores.incrementCalls, 1);
  assert.equal(stores.days.get("2026-05-31")?.leads.form, 1);
  assert.equal(stores.events[0]?.redis_stream_id, null);
});

test("test runner never constructs a publish that would call Upstash", async () => {
  const stores = createMemoryStores();
  let redisConstructs = 0;

  assert.equal(shouldPublishDailyOperationsRedis(), false);

  const result = await recordDailyOperationsFact(formLeadInput(), {
    stores,
    getRedis: () => {
      redisConstructs += 1;
      throw new Error("must not construct Redis in the test runner");
    },
  });

  assert.equal(result?.outcome, "recorded");
  assert.equal(redisConstructs, 0);
  assert.equal(stores.incrementCalls, 1);
});

test("Redis XADD failure is swallowed and does not fail the fact", async () => {
  const stores = createMemoryStores();

  const result = await recordDailyOperationsFact(formLeadInput(), {
    stores,
    shouldPublish: () => true,
    getRedis: () => ({
      async xadd() {
        throw new Error("upstash unavailable");
      },
    }),
  });

  assert.equal(result?.outcome, "recorded");
  assert.equal(stores.events.length, 1);
  assert.equal(stores.incrementCalls, 1);
  assert.equal(stores.events[0]?.redis_stream_id, null);
});

test("successful XADD stores redis_stream_id and only envelope fields", async () => {
  const previousVercelEnv = process.env.VERCEL_ENV;
  delete process.env.VERCEL_ENV;
  try {
    const stores = createMemoryStores();
    const xaddCalls: Array<{
      key: string;
      id: "*";
      fields: Record<string, string>;
      options: {
        trim: { type: "MAXLEN"; threshold: number; comparison: "~" };
      };
    }> = [];

    const result = await recordDailyOperationsFact(formLeadInput(), {
      stores,
      shouldPublish: () => true,
      getRedis: () => ({
        async xadd(key, id, fields, options) {
          xaddCalls.push({ key, id, fields, options });
          return "1717200000000-0";
        },
      }),
    });

    assert.equal(result?.outcome, "recorded");
    assert.equal(stores.events[0]?.redis_stream_id, "1717200000000-0");
    assert.equal(xaddCalls.length, 1);
    assert.equal(xaddCalls[0]?.key, "dailyops:local:stream:2026-05-31");
    assert.equal(xaddCalls[0]?.id, "*");
    assert.deepEqual(xaddCalls[0]?.options.trim, {
      type: "MAXLEN",
      threshold: 2000,
      comparison: "~",
    });
    assert.deepEqual(Object.keys(xaddCalls[0]?.fields ?? {}).sort(), [
      "day",
      "dedupe_key",
      "event_id",
      "kind",
      "lane",
      "occurred_at",
    ]);
    assert.equal(xaddCalls[0]?.fields.kind, "form_lead.created");
    assert.equal(xaddCalls[0]?.fields.lane, "lead");
    assert.equal(xaddCalls[0]?.fields.day, "2026-05-31");
    assert.equal(
      xaddCalls[0]?.fields.occurred_at,
      "2026-06-01T03:00:00.000Z",
    );
    assert.equal(xaddCalls[0]?.fields.customer_name, undefined);
  } finally {
    if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercelEnv;
  }
});

test("writer never throws when stores fail", async () => {
  const result = await recordDailyOperationsFact(formLeadInput(), {
    stores: {
      async insertEvent() {
        throw new Error("mongo down");
      },
      async setEventMetricTouches() {},
      async setEventRedisStreamId() {},
      async findDayStatus() {
        return null;
      },
      async incrementOpenDay() {},
    },
  });
  assert.equal(result, null);
});

test("test sink captures when stores are not injected", async () => {
  clearCapturedDailyOperationsFacts();
  const result = await recordDailyOperationsFact(formLeadInput());
  assert.equal(result?.outcome, "recorded");
  assert.equal(result?.event_id, "test");
  assert.equal(getCapturedDailyOperationsFacts().length, 1);
  assert.equal(
    getCapturedDailyOperationsFacts()[0]?.input.dedupe_key,
    "form_lead:lead1:created",
  );
  clearCapturedDailyOperationsFacts();
});

test("granot.minted increments decisions only and sheet sync increments none", () => {
  assert.deepEqual([...defaultMetricTouches("granot.minted")], ["decisions.minted"]);
  assert.equal(
    defaultMetricTouches("granot.minted").some((touch) => touch.startsWith("leads.")),
    false,
  );
  assert.deepEqual([...defaultMetricTouches("sheet_sync.completed")], []);
  assert.deepEqual([...defaultMetricTouches("sheet_sync.failed")], []);
  assert.equal(DAILY_OPERATIONS_KIND_CATALOG["text.deferred"].lane, "text");
  assert.deepEqual(
    [...defaultMetricTouches("text.deferred")],
    ["messages.deferred"],
  );
});
