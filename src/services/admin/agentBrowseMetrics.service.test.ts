import assert from "node:assert/strict";
import { inspect } from "node:util";
import { test } from "node:test";
import { adminBrowseQuerySchema } from "../../validation/v1.validation";
import {
  buildAgentBrowseMetricsPipeline,
  emptyAgentBrowseMetrics,
  lookupAgentBrowseMetrics,
  uniqueLowercasedAgentNames,
} from "./agentBrowseMetrics.service";

test("agent browse metrics match keys are lowercased strings, not regexes", () => {
  const query = adminBrowseQuerySchema.parse({ limit: 10 });
  const pipeline = buildAgentBrowseMetricsPipeline(query, uniqueLowercasedAgentNames(["Alice Agent", "MIKE"]));
  const matchKeys = matchKeysFromPipeline(pipeline);

  assert.deepEqual(matchKeys, ["alice agent", "mike"]);
  assert.ok(matchKeys.every((value) => typeof value === "string"));
  assert.equal(
    inspect(pipeline, { depth: null }).includes("RegExp"),
    false,
  );
});

test("agent browse metrics count distinct bookings and take this agent's binder share", () => {
  const query = adminBrowseQuerySchema.parse({ limit: 10 });
  const pipeline = buildAgentBrowseMetricsPipeline(query, ["alice agent"]);
  const preview = inspect(pipeline, { depth: null });

  assert.match(preview, /booking_id/);
  assert.match(preview, /agent_allocations\.binder_amount/);
  assert.match(preview, /\$first/);
  assert.match(preview, /booking_count/);
  assert.match(preview, /is_cancelled/);
});

test("agent browse metrics date range filters book_date and skips Agent createdAt", () => {
  const query = adminBrowseQuerySchema.parse({
    from: "2026-01-01T00:00:00.000Z",
    to: "2026-01-31T23:59:59.999Z",
    limit: 10,
  });
  const preview = inspect(buildAgentBrowseMetricsPipeline(query, ["alice agent"]), { depth: null });

  assert.match(preview, /book_date/);
  assert.doesNotMatch(preview, /createdAt: \{/);
});

test("agent browse metrics omit a date match when from/to are absent", () => {
  const query = adminBrowseQuerySchema.parse({ limit: 10 });
  const preview = inspect(buildAgentBrowseMetricsPipeline(query, ["alice agent"]), { depth: null });

  assert.doesNotMatch(preview, /book_date/);
});

test("lookupAgentBrowseMetrics uses name or normalized_name and returns zeros when unmatched", () => {
  const metrics = {
    booking_count: 1,
    total_binder_amount: 50,
    total_deposit_amount: 100,
    cancellation_count: 0,
    cancellation_rate: 0,
  };
  const byName = new Map([["alice agent", metrics]]);

  assert.deepEqual(
    lookupAgentBrowseMetrics(byName, { name: "ALICE AGENT", normalized_name: "alice agent" }),
    metrics,
  );
  assert.deepEqual(
    lookupAgentBrowseMetrics(byName, { name: "Mike Smith", normalized_name: "alice agent" }),
    metrics,
  );
  assert.deepEqual(
    lookupAgentBrowseMetrics(byName, { name: "No Booking Agent" }),
    emptyAgentBrowseMetrics(),
  );
});

function matchKeysFromPipeline(pipeline: unknown[]): string[] {
  for (const stage of pipeline) {
    if (!stage || typeof stage !== "object") continue;
    const match = (stage as { $match?: { agent_key?: { $in?: unknown } } }).$match;
    const values = match?.agent_key?.$in;
    if (Array.isArray(values)) {
      return values.filter((value): value is string => typeof value === "string");
    }
  }
  return [];
}
