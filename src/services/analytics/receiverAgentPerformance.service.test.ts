import assert from "node:assert/strict";
import { test } from "node:test";
import { analyticsQuerySchema } from "../../validation/v1.validation";
import { getReceiverAgentPerformance } from "./receiverAgentPerformance.service";

test("receiver-agent analytics use persisted CPL without rate-period status", async () => {
  const pipelines: Record<string, unknown>[][] = [];
  const aggregate = (pipeline: Record<string, unknown>[]) => {
    pipelines.push(pipeline);
    return Promise.resolve([]);
  };
  const query = analyticsQuerySchema.parse({ database_scope: "production" });

  await getReceiverAgentPerformance(
    {
      "form-leads": { aggregate } as never,
      "call-leads": { aggregate } as never,
      "booked-leads": {} as never,
      "cancelled-leads": {} as never,
      customers: {} as never,
      agents: {} as never,
    },
    query,
  );

  assert.equal(pipelines.length, 2);
  for (const pipeline of pipelines) {
    const serialized = JSON.stringify(pipeline);
    assert.doesNotMatch(serialized, /cpl_resolution_status/);
    assert.match(serialized, /"\$cpl"/);
  }
});
