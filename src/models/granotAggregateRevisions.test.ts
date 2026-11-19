import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { BookedLead } from "./BookedLead";
import { CallLead } from "./CallLead";
import { CancelledLead } from "./CancelledLead";
import { FormLead } from "./FormLead";

const MODELS = [
  { name: "FormLead", Model: FormLead, hasOptimisticConcurrency: true },
  { name: "CallLead", Model: CallLead, hasOptimisticConcurrency: true },
  { name: "BookedLead", Model: BookedLead, hasOptimisticConcurrency: true },
  { name: "CancelledLead", Model: CancelledLead, hasOptimisticConcurrency: false },
] as const;

function formLeadAttrs() {
  return {
    name: "Synthetic User",
    pickup_zip: "10001",
    destination_zip: "94105",
    move_size: "Studio" as const,
    phone_number: "5550100100",
    local: "local" as const,
  };
}

function callLeadAttrs() {
  return {
    phone_number: "5550100101",
  };
}

function bookedLeadAttrs() {
  return {
    book_date: new Date("2026-08-17T00:00:00.000Z"),
    agent_allocations: [
      {
        agent: new mongoose.Types.ObjectId(),
        agent_name_snapshot: "Synthetic Agent",
        binder_amount: 100,
      },
    ],
    total_binder_amount: 100,
    deposit_amount: 0,
    merchant: "synthetic_merchant",
    source: "synthetic",
    is_referral_booking: true,
  };
}

function cancelledLeadAttrs() {
  return {
    booked_lead: new mongoose.Types.ObjectId(),
    cancel_date: new Date("2026-08-17T00:00:00.000Z"),
    refund_amount: 0,
  };
}

function attrsFor(name: string) {
  if (name === "FormLead") return formLeadAttrs();
  if (name === "CallLead") return callLeadAttrs();
  if (name === "BookedLead") return bookedLeadAttrs();
  return cancelledLeadAttrs();
}

test("[AC-21] invalid revisions and one-sided last-change metadata fail validation", async () => {
  for (const { name, Model } of MODELS) {
    for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const document = new Model({ ...attrsFor(name), domain_revision: invalid });
      await assert.rejects(() => document.validate());
    }
    const oneSided = new Model({
      ...attrsFor(name),
      last_change_id: new mongoose.Types.ObjectId(),
    });
    await assert.rejects(() => oneSided.validate());
  }
});

test("[AC-32] genuinely new aggregates receive a server history boundary and ignore client supply", async () => {
  const clientDate = new Date("2020-01-01T00:00:00.000Z");
  const before = Date.now();
  const lead = new FormLead({
    ...formLeadAttrs(),
    change_history_started_at: clientDate,
  });
  await lead.validate();
  assert.ok(lead.change_history_started_at instanceof Date);
  assert.notEqual(lead.change_history_started_at.getTime(), clientDate.getTime());
  assert.ok(lead.change_history_started_at.getTime() >= before);
});

test("[AC-32] change_history_started_at is write-once outside the migration seam", async () => {
  const lead = new FormLead(formLeadAttrs());
  await lead.validate();
  lead.isNew = false;
  lead.change_history_started_at = new Date("2020-01-01T00:00:00.000Z");
  await assert.rejects(() => lead.validate());
});
