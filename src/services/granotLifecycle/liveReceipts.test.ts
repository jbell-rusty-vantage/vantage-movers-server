import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  decodeLiveReceiptEventId,
  encodeLiveReceiptEventId,
  extractLiveWebhookLead,
  projectLiveWebhookReceipt,
} from "./liveReceipts";

test("extractLiveWebhookLead reads name, contact, job, and move fields from a Granot body", () => {
  const lead = extractLiveWebhookLead({
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@example.invalid",
    phone: "212-555-0100",
    job_no: "P5562401",
    event_type: "Priority",
    priority: "5",
    from_city: "Brooklyn",
    from_state: "NY",
    to_city: "Austin",
    to_state: "TX",
    move_date: "2026-09-01",
  });
  assert.equal(lead.display_name, "Ada Lovelace");
  assert.equal(lead.phone, "212-555-0100");
  assert.equal(lead.job_no, "P5562401");
  assert.equal(lead.priority, "5");
  assert.equal(lead.origin, "Brooklyn, NY");
  assert.equal(lead.destination, "Austin, TX");
});

test("projectLiveWebhookReceipt keeps webhook lead facts and strips credential keys", () => {
  const id = new mongoose.Types.ObjectId();
  const receipt = projectLiveWebhookReceipt({
    _id: id,
    observation_channel: "granot_webhook",
    route_event_class: "lead_created",
    captured_at: new Date("2026-08-28T15:00:00.000Z"),
    processing: { state: "pending" },
    payload: {
      customer_name: "Ada Lovelace",
      job_no: "P5562401",
      "x-api-secret": "must-not-leak",
    },
  });
  assert.ok(receipt);
  assert.equal(receipt.receipt_id, String(id));
  assert.equal(receipt.route_event_class, "lead_created");
  assert.equal(receipt.lead.display_name, "Ada Lovelace");
  assert.equal(receipt.lead.job_no, "P5562401");
  assert.equal(
    JSON.stringify(receipt.granot_statement).includes("must-not-leak"),
    false,
  );
});

test("projectLiveWebhookReceipt ignores extension receipts and unknown event classes", () => {
  const id = new mongoose.Types.ObjectId();
  assert.equal(
    projectLiveWebhookReceipt({
      _id: id,
      observation_channel: "browser_extension",
      route_event_class: "lead_created",
      captured_at: new Date("2026-08-28T15:00:00.000Z"),
      payload: { job_no: "P1" },
    }),
    null,
  );
  assert.equal(
    projectLiveWebhookReceipt({
      _id: id,
      observation_channel: "granot_webhook",
      captured_at: new Date("2026-08-28T15:00:00.000Z"),
      payload: { job_no: "P1" },
    }),
    null,
  );
});

test("live receipt event ids round-trip captured_at and receipt_id", () => {
  const cursor = {
    captured_at: "2026-08-28T15:00:00.000Z",
    receipt_id: "64aaaaaaaaaaaaaaaaaaaaaa",
  };
  assert.deepEqual(decodeLiveReceiptEventId(encodeLiveReceiptEventId(cursor)), cursor);
  assert.equal(decodeLiveReceiptEventId("not-an-id"), null);
});
