import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkflowCounters, CAPACITY_COUNTERS, CAPACITY_WORKFLOWS } from "./workflowCounters";

test("bounded counters expose an exact process interval without fleet/unique claims", () => {
  const counters = createWorkflowCounters(new Date("2026-11-17T10:00:00Z"));
  counters.record("outreach", { nominations: 2, completions: 1 });
  counters.record("outreach", { nominations: 2 });
  const snapshot = counters.snapshot(new Date("2026-11-17T11:00:00Z"));
  assert.equal(snapshot.scope, "process");
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.interval_started_at, "2026-11-17T10:00:00.000Z");
  assert.equal(snapshot.interval_ended_at, "2026-11-17T11:00:00.000Z");
  assert.deepEqual(snapshot.workflows, [{ workflow: "outreach", counts: { nominations: 4, completions: 1 }, saturated: false }]);
  snapshot.workflows[0].counts.nominations = 999;
  assert.equal(counters.snapshot().workflows[0].counts.nominations, 4);
});

test("invalid values do not poison counters and cardinality cannot grow", () => {
  const counters = createWorkflowCounters();
  counters.record("archive", { archive_read_bytes: NaN, archive_write_bytes: -1, claims: 1.1 });
  counters.record("archive", { archive_read_bytes: Number.MAX_SAFE_INTEGER });
  counters.record("archive", { archive_read_bytes: 1 });
  const row = counters.snapshot().workflows[0];
  assert.deepEqual(row.counts, { archive_read_bytes: Number.MAX_SAFE_INTEGER });
  assert.equal(row.saturated, true);
  for (const workflow of CAPACITY_WORKFLOWS) counters.record(workflow, Object.fromEntries(CAPACITY_COUNTERS.map((key) => [key, 1])));
  assert.equal(counters.snapshot().workflows.length, CAPACITY_WORKFLOWS.length);
});
