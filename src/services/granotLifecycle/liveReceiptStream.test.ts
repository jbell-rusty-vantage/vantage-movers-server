import assert from "node:assert/strict";
import { test } from "node:test";
import { runLiveReceiptSse } from "./liveReceiptStream";
import type { LiveWebhookReceipt } from "./liveReceipts";

function receipt(
  overrides: Partial<LiveWebhookReceipt> & Pick<LiveWebhookReceipt, "receipt_id" | "captured_at">,
): LiveWebhookReceipt {
  return {
    route_event_class: "priority_updated",
    observation_channel: "granot_webhook",
    processing_state: "pending",
    lead: {
      display_name: "Ada Lovelace",
      first_name: "Ada",
      last_name: "Lovelace",
      email: null,
      phone: "212-555-0100",
      job_no: "P5562401",
      event_type: "Priority",
      priority: "5",
      origin: null,
      destination: null,
      move_date: null,
    },
    granot_statement: { job_no: "P5562401", priority: "5" },
    ...overrides,
  };
}

test("SSE snapshot then streams newer receipts and heartbeats before closing", async () => {
  const chunks: string[] = [];
  let now = Date.parse("2026-08-28T15:00:00.000Z");
  const newer = receipt({
    receipt_id: "64bbbbbbbbbbbbbbbbbbbbbb",
    captured_at: "2026-08-28T15:00:05.000Z",
  });
  let polls = 0;

  await runLiveReceiptSse(
    { write: (chunk) => chunks.push(chunk) },
    {
      listSnapshot: async () => [
        receipt({
          receipt_id: "64aaaaaaaaaaaaaaaaaaaaaa",
          captured_at: "2026-08-28T14:59:00.000Z",
          route_event_class: "lead_created",
        }),
      ],
      listAfter: async () => {
        polls += 1;
        return polls === 1 ? [newer] : [];
      },
      sleep: async () => {
        now += 8_000;
      },
      now: () => now,
      pollMs: 1,
      heartbeatMs: 10_000,
      maxMs: 20_000,
    },
  );

  const joined = chunks.join("");
  assert.match(joined, /event: snapshot/);
  assert.match(joined, /lead_created/);
  assert.match(joined, /event: receipt/);
  assert.match(joined, /64bbbbbbbbbbbbbbbbbbbbbb/);
  assert.match(joined, /event: heartbeat/);
});

test("SSE reconnect with Last-Event-ID skips the snapshot and continues from the cursor", async () => {
  const chunks: string[] = [];
  let now = Date.parse("2026-08-28T15:00:00.000Z");
  let seenCursor: string | undefined;

  await runLiveReceiptSse(
    { write: (chunk) => chunks.push(chunk) },
    {
      listSnapshot: async () => {
        throw new Error("snapshot must not run on reconnect");
      },
      listAfter: async (cursor) => {
        seenCursor = `${cursor.captured_at}:${cursor.receipt_id}`;
        return [];
      },
      sleep: async () => {
        now += 30_000;
      },
      now: () => now,
      pollMs: 1,
      heartbeatMs: 60_000,
      maxMs: 1,
    },
    "2026-08-28T14:59:00.000Z:64aaaaaaaaaaaaaaaaaaaaaa",
  );

  assert.equal(seenCursor, "2026-08-28T14:59:00.000Z:64aaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(chunks.join("").includes("event: snapshot"), false);
});

test("[AC-L4] late intake_link emits receipt_updated without advancing the capture cursor", async () => {
  const chunks: string[] = [];
  let now = Date.parse("2026-08-28T15:00:00.000Z");
  const pending = receipt({
    receipt_id: "64aaaaaaaaaaaaaaaaaaaaaa",
    captured_at: "2026-08-28T14:59:00.000Z",
    route_event_class: "booking_status_changed",
    processing_state: "pending",
    intake_link: null,
  });
  const bound = {
    ...pending,
    processing_state: "completed",
    observation_id: "65aaaaaaaaaaaaaaaaaaaaaa",
    intake_link: {
      case_id: "66aaaaaaaaaaaaaaaaaaaaaa",
      kind: "booking" as const,
      state: "open" as const,
      matched_via: "evidence_observation_id" as const,
    },
  };
  const seenCursors: string[] = [];
  let polls = 0;

  await runLiveReceiptSse(
    { write: (chunk) => chunks.push(chunk) },
    {
      listSnapshot: async () => [pending],
      listAfter: async (cursor) => {
        seenCursors.push(`${cursor.captured_at}:${cursor.receipt_id}`);
        return [];
      },
      listUpdated: async () => {
        polls += 1;
        return polls === 1 ? [pending] : [bound];
      },
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
  assert.match(joined, /"intake_link":null/);
  assert.match(joined, /event: receipt_updated/);
  assert.match(joined, /66aaaaaaaaaaaaaaaaaaaaaa/);
  assert.equal(joined.includes("event: receipt\n"), false);
  const updatedBlock = chunks.find((chunk) => chunk.includes("event: receipt_updated"));
  assert.ok(updatedBlock);
  assert.equal(updatedBlock.includes("\nid: "), false);
  assert.ok(seenCursors.length >= 2);
  assert.ok(seenCursors.every((value) => value === "2026-08-28T14:59:00.000Z:64aaaaaaaaaaaaaaaaaaaaaa"));
});

test("SSE does not emit receipt_updated for a brand-new receipt just sent as receipt", async () => {
  const chunks: string[] = [];
  let now = Date.parse("2026-08-28T15:00:00.000Z");
  const newer = receipt({
    receipt_id: "64bbbbbbbbbbbbbbbbbbbbbb",
    captured_at: "2026-08-28T15:00:05.000Z",
    processing_state: "pending",
    intake_link: null,
  });
  let polls = 0;

  await runLiveReceiptSse(
    { write: (chunk) => chunks.push(chunk) },
    {
      listSnapshot: async () => [],
      listAfter: async () => {
        polls += 1;
        return polls === 1 ? [newer] : [];
      },
      listUpdated: async () => (polls === 1 ? [newer] : []),
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
  assert.match(joined, /event: receipt/);
  assert.equal(joined.includes("event: receipt_updated"), false);
});
