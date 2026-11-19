import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDottedIncrements, buildDaySeed } from "./dayDocument";
import { buildMetricTouches, defaultMetricTouches } from "./kinds";
import { recordDailyOperationsFact, type DailyOperationsEventInsert, type DailyOperationsFactStores, type RecordDailyOperationsFactInput } from "./recordDailyOperationsFact";

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

test("legacy decision touches cannot reintroduce retired counters", async () => {
  const memory = createMemoryStores();
  await recordDailyOperationsFact(formLeadInput({ metric_touches: ["decisions.observed"] }), { stores: memory.stores });
  assert.deepEqual(memory.events[0]?.metric_touches, []); assert.equal(memory.days.size, 0);
});

test("Sheet Sync completion/failure retain only their reconstructable counters", () => {
  assert.deepEqual([...defaultMetricTouches("sheet_sync.completed")], ["sheet_sync.completed"]);
  assert.deepEqual([...defaultMetricTouches("sheet_sync.failed")], ["sheet_sync.failed"]);
  assert.deepEqual([...defaultMetricTouches("text.deferred")], ["messages.deferred"]);
});
