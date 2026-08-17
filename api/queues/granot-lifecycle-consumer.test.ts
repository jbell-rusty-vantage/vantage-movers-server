import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import mongoose from "mongoose";
import { parseReceiptWakeup } from "../../src/services/granotLifecycle/drainer";

test("consumer accepts only { receipt_id }", async () => {
  const receiptId = new mongoose.Types.ObjectId().toHexString();
  assert.equal(await parseReceiptWakeup({ receipt_id: receiptId }), receiptId);
  await assert.rejects(() => parseReceiptWakeup({ receipt_id: receiptId, extra: 1 }));
});

test("vercel.json registers queue/v2beta topic granot-lifecycle-events*", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
  ) as {
    functions: Record<string, { experimentalTriggers?: Array<{ type: string; topic: string }> }>;
  };
  const triggers = manifest.functions["api/queues/granot-lifecycle-consumer.ts"]?.experimentalTriggers;
  assert.ok(triggers);
  assert.equal(triggers[0]?.type, "queue/v2beta");
  assert.equal(triggers[0]?.topic, "granot-lifecycle-events*");
});
