import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEventFilter,
  buildIncidentFilter,
  compareIncidentSeverity,
} from "./adminObservability.service";
import {
  observabilityEventsQuerySchema,
  observabilityFacetsQuerySchema,
  observabilityIncidentsQuerySchema,
} from "../../validation/v1.validation";

test("incident severity comparison ranks critical above error and warn", () => {
  assert.ok(compareIncidentSeverity("critical", "error") > 0);
  assert.ok(compareIncidentSeverity("error", "warn") > 0);
  assert.ok(compareIncidentSeverity("warn", "critical") < 0);
});

test("event filter keeps exact-match fields exact", () => {
  const query = observabilityEventsQuerySchema.parse({
    level: "error",
    category: "sheet_sync",
    event_key: "sheet_sync.drain.failed",
    source_company: "Acme Movers",
    run_id: "run-1",
  });
  const filter = buildEventFilter(query);
  assert.equal(filter.level, "error");
  assert.equal(filter.category, "sheet_sync");
  assert.equal(filter.event_key, "sheet_sync.drain.failed");
  assert.equal(filter.source_company, "Acme Movers");
  assert.equal(filter.run_id, "run-1");
});

test("event filter matches lead name partially and case-insensitively", () => {
  const query = observabilityEventsQuerySchema.parse({ lead_name: "smith" });
  const filter = buildEventFilter(query);
  const regex = filter.lead_name as RegExp;
  assert.ok(regex instanceof RegExp);
  assert.ok(regex.test("John Smith"));
  assert.ok(regex.test("SMITHSON, JANE"));
  assert.ok(!regex.test("John Doe"));
});

test("event filter escapes regex metacharacters in lead inputs", () => {
  const query = observabilityEventsQuerySchema.parse({ lead_email: "a.b+c@x.com" });
  const filter = buildEventFilter(query);
  const regex = filter.lead_email as RegExp;
  assert.ok(regex.test("a.b+c@x.com"));
  assert.ok(!regex.test("aXb+c@x.com"));
});

test("event filter matches phone digits across formatting", () => {
  const query = observabilityEventsQuerySchema.parse({ lead_phone: "(555) 123-4567" });
  const filter = buildEventFilter(query);
  const regex = filter.lead_phone as RegExp;
  assert.ok(regex.test("5551234567"));
  assert.ok(regex.test("(555) 123-4567"));
  assert.ok(regex.test("+1 555.123.4567"));
  assert.ok(!regex.test("5551234568"));
});

test("event filter supports partial phone digit search", () => {
  const query = observabilityEventsQuerySchema.parse({ lead_phone: "4567" });
  const filter = buildEventFilter(query);
  const regex = filter.lead_phone as RegExp;
  assert.ok(regex.test("(555) 123-4567"));
  assert.ok(!regex.test("(555) 123-9999"));
});

test("event filter builds date window and text search", () => {
  const query = observabilityEventsQuerySchema.parse({
    from: "2026-06-01T00:00:00.000Z",
    to: "2026-06-10T00:00:00.000Z",
    q: "drain failed",
  });
  const filter = buildEventFilter(query);
  assert.deepEqual(filter.occurred_at, {
    $gte: new Date("2026-06-01T00:00:00.000Z"),
    $lt: new Date("2026-06-10T00:00:00.000Z"),
  });
  assert.deepEqual(filter.$text, { $search: "drain failed" });
});

test("facets query schema coerces dates and strips unknown params", () => {
  const parsed = observabilityFacetsQuerySchema.parse({
    from: "2026-06-01",
    to: "",
    unknown: "dropped",
  });
  assert.ok(parsed.from instanceof Date);
  assert.equal(parsed.to, undefined);
  assert.ok(!("unknown" in parsed));
});

test("incident filter applies partial lead matching and q regex OR", () => {
  const query = observabilityIncidentsQuerySchema.parse({
    status: "open",
    severity: "critical",
    lead_name: "garcia",
    q: "sheet",
  });
  const filter = buildIncidentFilter(query);
  assert.equal(filter.status, "open");
  assert.equal(filter.severity, "critical");
  assert.ok((filter.lead_name as RegExp).test("Maria Garcia"));
  const or = filter.$or as Array<Record<string, RegExp>>;
  assert.ok(Array.isArray(or) && or.length > 0);
  assert.ok(or.some((clause) => clause.title?.test("Sheet sync drain failed")));
});
