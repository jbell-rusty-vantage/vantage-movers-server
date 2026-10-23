import assert from "node:assert/strict";
import { test } from "node:test";
import { SOURCE_COMPANIES } from "../../config/domain/sources";
import { applyDottedIncrements, buildDaySeed } from "./dayDocument";
import { buildMetricTouches, defaultMetricTouches } from "./kinds";
import { recordDailyOperationsFact, type DailyOperationsEventInsert, type DailyOperationsFactStores, type RecordDailyOperationsFactInput } from "./recordDailyOperationsFact";
import { clearCapturedDailyOperationsFacts, getCapturedDailyOperationsFacts } from "./testDailyOperationsSink";

type MemoryDay = ReturnType<typeof buildDaySeed> & { revision: number };
function createMemoryStores(initialDays: MemoryDay[] = []) {
  const events: Array<DailyOperationsEventInsert & { id: string }> = [];
  const days = new Map(initialDays.map((day) => [day.day, structuredClone(day)]));
  let incrementCalls = 0;
  const stores: DailyOperationsFactStores = {
    async recordEvent({ event, increments, seed }) {
      if (events.some((row) => row.dedupe_key === event.dedupe_key)) return { duplicate: true };
      const current = increments ? days.get(event.day) ?? { ...structuredClone(seed), revision: 0 } : null;
      const closed = current?.status === "closed";
      if (increments && current && !closed) {
        applyDottedIncrements(current as unknown as Record<string, unknown>, increments);
        days.set(event.day, current);
        incrementCalls += 1;
      }
      const id = `evt_${events.length + 1}`;
      events.push({ ...structuredClone(event), id, metric_touches: closed ? [] : event.metric_touches });
      return { id, outcome: closed ? "closed_day" : "recorded" };
    },
  };
  return { stores, events, days, get incrementCalls() { return incrementCalls; } };
}

function formLeadInput(overrides: Partial<RecordDailyOperationsFactInput> = {}): RecordDailyOperationsFactInput {
  return {
    kind: "form_lead.created", dedupe_key: "form_lead:synthetic:created",
    occurred_at: new Date("2026-06-01T03:00:00.000Z"), source_company: "tbm_leads",
    ingestion_origin: "wordpress_form", lead_kind: "form", entity_type: "FormLead", entity_id: "synthetic",
    links: { lead_id: "synthetic", lead_model: "FormLead" }, card: {},
    metric_touches: buildMetricTouches("form_lead.created", { origin: "wordpress_form", sourceCompany: "tbm_leads" }),
    ...overrides,
  };
}

test("one retained fact requests one atomic event/counter write with its NY hour", async () => {
  const memory = createMemoryStores();
  assert.deepEqual(await recordDailyOperationsFact(formLeadInput(), { stores: memory.stores }), {
    event_id: "evt_1", day: "2026-05-31", outcome: "recorded",
  });
  const day = memory.days.get("2026-05-31")!;
  assert.equal(memory.events.length, 1);
  assert.equal(memory.events[0]?.redis_stream_id, null);
  assert.equal(memory.incrementCalls, 1);
  assert.equal(day.leads.form, 1); assert.equal(day.leads.total, 1);
  assert.equal(day.origins.wordpress_form, 1); assert.equal(day.companies.tbm_leads.form, 1);
  assert.equal(day.hourly[23]?.leads, 1); assert.equal(day.revision, 1);
  assert.equal(day.hourly.length, 24);
  for (const slug of SOURCE_COMPANIES) assert.ok(day.companies[slug]);
});

test("duplicate event never increments counters a second time", async () => {
  const memory = createMemoryStores();
  const deps = { stores: memory.stores };
  await recordDailyOperationsFact(formLeadInput(), deps);
  assert.deepEqual(await recordDailyOperationsFact(formLeadInput(), deps), {
    event_id: "", day: "2026-05-31", outcome: "duplicate",
  });
  assert.equal(memory.events.length, 1); assert.equal(memory.incrementCalls, 1);
  assert.equal(memory.days.get("2026-05-31")?.leads.form, 1);
});

test("closed day retains the fact with empty touches and unchanged counters", async () => {
  const closed = { ...buildDaySeed("2026-05-31"), revision: 4, status: "closed" as const };
  closed.leads.form = 9;
  const memory = createMemoryStores([closed]);
  assert.equal((await recordDailyOperationsFact(formLeadInput(), { stores: memory.stores }))?.outcome, "closed_day");
  assert.equal(memory.incrementCalls, 0); assert.deepEqual(memory.events[0]?.metric_touches, []);
  assert.equal(memory.days.get("2026-05-31")?.leads.form, 9);
  assert.equal(memory.days.get("2026-05-31")?.revision, 4);
});

test("no-touch retained facts do not request day counter work", async () => {
  const memory = createMemoryStores();
  for (const kind of ["granot.minted", "granot.linked", "granot.observed", "granot.pending_match", "granot.unmatched", "outreach.rep_goal_met"] as const) {
    await recordDailyOperationsFact(formLeadInput({ kind, dedupe_key: `synthetic:${kind}`, metric_touches: [...defaultMetricTouches(kind)] }), { stores: memory.stores });
  }
  assert.equal(memory.events.length, 6); assert.equal(memory.incrementCalls, 0); assert.equal(memory.days.size, 0);
});

test("legacy decision touches cannot reintroduce retired counters", async () => {
  const memory = createMemoryStores();
  await recordDailyOperationsFact(formLeadInput({ metric_touches: ["decisions.observed"] }), { stores: memory.stores });
  assert.deepEqual(memory.events[0]?.metric_touches, []); assert.equal(memory.days.size, 0);
});

test("writer never throws when persistence fails", async () => {
  assert.equal(await recordDailyOperationsFact(formLeadInput(), { stores: { async recordEvent() { throw new Error("synthetic failure"); } } }), null);
});

test("missing dedupe key avoids all persistence", async () => {
  let called = false;
  assert.equal(await recordDailyOperationsFact(formLeadInput({ dedupe_key: " " }), { stores: { async recordEvent() { called = true; return { duplicate: true }; } } }), null);
  assert.equal(called, false);
});

test("test sink captures without constructing a database store", async () => {
  clearCapturedDailyOperationsFacts();
  assert.equal((await recordDailyOperationsFact(formLeadInput()))?.event_id, "test");
  assert.equal(getCapturedDailyOperationsFacts().length, 1);
  clearCapturedDailyOperationsFacts();
});

test("Sheet Sync completion/failure retain only their reconstructable counters", () => {
  assert.deepEqual([...defaultMetricTouches("sheet_sync.completed")], ["sheet_sync.completed"]);
  assert.deepEqual([...defaultMetricTouches("sheet_sync.failed")], ["sheet_sync.failed"]);
  assert.deepEqual([...defaultMetricTouches("text.deferred")], ["messages.deferred"]);
});
