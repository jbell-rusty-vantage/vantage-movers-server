import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { createCallLeadSchema, createFormLeadSchema, updateCallLeadSchema, updateFormLeadSchema } from "../validation/v1/leads.validation";
import {
  createBookedLeadSchema,
  updateBookedLeadSchema,
} from "../validation/v1/bookings.validation";
import {
  createCancelledLeadSchema,
  updateCancelledLeadSchema,
} from "../validation/v1/cancellations.validation";
import { AGGREGATE_REVISION_FIELD_NAMES } from "./granotLifecycleSchemas";
import { BookedLead, BOOKED_LEAD_NORMALIZED_JOB_INDEX } from "./BookedLead";
import { CallLead } from "./CallLead";
import { CancelledLead } from "./CancelledLead";
import { FormLead } from "./FormLead";
import { HistoricalFormLeadSchema } from "./historical/FormLead";
import { HistoricalCallLeadSchema } from "./historical/CallLead";
import { HistoricalBookedLeadSchema } from "./historical/BookedLead";
import { HistoricalCancelledLeadSchema } from "./historical/CancelledLead";

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

test("[AC-21] all four aggregates default to nonnegative integer domain_revision 0", async () => {
  for (const { name, Model } of MODELS) {
    const document = new Model(attrsFor(name));
    await document.validate();
    assert.equal(document.domain_revision, 0);
    assert.equal(document.last_change_id, undefined);
    assert.equal(document.last_changed_at, undefined);
    assert.ok(document.change_history_started_at instanceof Date);
  }
});

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

test("[AC-21] __v is not the lifecycle revision contract", async () => {
  for (const { name, Model, hasOptimisticConcurrency } of MODELS) {
    const document = new Model(attrsFor(name));
    await document.validate();
    assert.ok(Model.schema.path("domain_revision"));
    assert.notEqual(Model.schema.path("domain_revision"), Model.schema.path("__v"));
    assert.equal(document.domain_revision, 0);
    if (hasOptimisticConcurrency) {
      assert.equal(Model.schema.get("optimisticConcurrency"), true);
    }
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

test("[AC-32] existing public/admin DTOs cannot set lifecycle revision metadata", () => {
  const form = {
    source_company: "main_site",
    name: "Synthetic User",
    pickup_zip: "10001",
    destination_zip: "94105",
    move_size: "Studio",
    phone_number: "5550100100",
  };
  const call = { phone_number: "5550100101" };
  const booking = {
    book_date: "2026-08-17",
    job_no: "SYNTH-U09-1",
    lead_ref: "aaaaaaaaaaaaaaaaaaaaaaaa",
    lead_model: "FormLead",
    deposit_amount: 0,
    merchant: "synthetic_merchant",
    source: "synthetic",
    agent_allocations: [{ agent_name: "Synthetic Agent", binder_amount: 100 }],
  };
  const cancellation = {
    booked_lead: "aaaaaaaaaaaaaaaaaaaaaaaa",
    refund_amount: 0,
  };

  for (const field of AGGREGATE_REVISION_FIELD_NAMES) {
    assert.equal(createFormLeadSchema.safeParse({ ...form, [field]: 0 }).success, false);
    assert.equal(updateFormLeadSchema.safeParse({ [field]: 0 }).success, false);
    assert.equal(createCallLeadSchema.safeParse({ ...call, [field]: 0 }).success, false);
    assert.equal(updateCallLeadSchema.safeParse({ [field]: 0 }).success, false);
    assert.equal(createBookedLeadSchema.safeParse({ ...booking, [field]: 0 }).success, false);
    assert.equal(updateBookedLeadSchema.safeParse({ [field]: 0 }).success, false);
    assert.equal(
      createCancelledLeadSchema.safeParse({ ...cancellation, [field]: 0 }).success,
      false,
    );
    assert.equal(updateCancelledLeadSchema.safeParse({ [field]: 0 }).success, false);
  }
});

test("[AC-21] Booking unique normalized-Job index is named and is not a unique Lead Job index", () => {
  assert.equal(BOOKED_LEAD_NORMALIZED_JOB_INDEX.name, "booked_lead_normalized_job_no_unique");
  assert.equal(BOOKED_LEAD_NORMALIZED_JOB_INDEX.unique, true);
  assert.deepEqual(BOOKED_LEAD_NORMALIZED_JOB_INDEX.key, { normalized_job_no: 1 });
  assert.deepEqual(BOOKED_LEAD_NORMALIZED_JOB_INDEX.partialFilterExpression, {
    normalized_job_no: { $type: "string" },
  });
  const formIndexes = FormLead.schema.indexes() as Array<
    [Record<string, number>, { unique?: boolean }]
  >;
  assert.equal(
    formIndexes.some((index) => index[1]?.unique === true && "normalized_job_no" in (index[0] ?? {})),
    false,
  );
  const callIndexes = CallLead.schema.indexes() as Array<
    [Record<string, number>, { unique?: boolean }]
  >;
  assert.equal(
    callIndexes.some((index) => index[1]?.unique === true && "normalized_job_no" in (index[0] ?? {})),
    false,
  );
});

test("[AC-32] historical schemas remain readable and do not gain revision fields", () => {
  for (const schema of [
    HistoricalFormLeadSchema,
    HistoricalCallLeadSchema,
    HistoricalBookedLeadSchema,
    HistoricalCancelledLeadSchema,
  ]) {
    for (const field of AGGREGATE_REVISION_FIELD_NAMES) {
      assert.equal(schema.path(field), undefined);
    }
  }
});
