import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import type { CreateBookedLeadFromSourceInput } from "../../validation/v1.validation";
import { resolveFromSourceAttach } from "./bookedLeadFromSource.service";

const formInput: CreateBookedLeadFromSourceInput = {
  lead_type: "FormLead",
  form_lead_id: "64c0f47e4d8b0e1111111111",
  job_no: "P5556278",
  book_date: new Date("2026-05-21T00:00:00.000Z"),
  agent: "JOSH",
  binder_amount: 900,
  deposit_amount: 900,
  merchant: "Card",
  source_company: "Best Relocation Forms",
};

const callInput: CreateBookedLeadFromSourceInput = {
  lead_type: "CallLead",
  call_job_no: "P5556278",
  book_date: new Date("2026-05-21T00:00:00.000Z"),
  agent: "JOSH",
  binder_amount: 900,
  deposit_amount: 900,
  merchant: "Card",
  source_company: "Best Relocation Inbounds",
};

const lead = {
  _id: new Types.ObjectId("64c0f47e4d8b0e3333333333"),
  source_company: "best_relocation_leads",
};

test("Form Lead + id attaches with booking_origin owner_booking and no case", async () => {
  const plan = await resolveFromSourceAttach(formInput, undefined, {
    resolveBookingSourceLead: async () => ({
      lead: lead as any,
      leadModel: "FormLead",
      jobNo: "P5556278",
    }),
  });

  assert.equal(plan.kind, "attach");
  if (plan.kind === "attach") {
    assert.equal(plan.leadModel, "FormLead");
    assert.equal(plan.bookingOrigin, "owner_booking");
  }
});

test("Owner Call Lead unique job attaches with booking_origin owner_booking", async () => {
  const plan = await resolveFromSourceAttach(callInput, undefined, {
    evaluateOwnerCallLeadMatch: async () => ({
      kind: "linked",
      leadId: String(lead._id),
      leadModel: "CallLead",
      rule: "call_job_no_exact",
      candidates: [],
      reason: "high_confidence",
    }),
    linkedLeadStillEligible: async (match) => match,
    getLinkedLead: async () => lead as any,
  });

  assert.equal(plan.kind, "attach");
  if (plan.kind === "attach") {
    assert.equal(plan.leadModel, "CallLead");
    assert.equal(plan.bookingOrigin, "owner_booking");
    assert.equal(plan.jobNo, "P5556278");
  }
});

test("Owner Call Lead with no Call Lead row is pending owner_booking no_match", async () => {
  let resolverCalled = false;
  const plan = await resolveFromSourceAttach(callInput, undefined, {
    resolveBookingSourceLead: async () => {
      resolverCalled = true;
      throw new Error("Owner Call Lead must not use the import resolver");
    },
    evaluateOwnerCallLeadMatch: async () => ({
      kind: "pending",
      reason: "no_match",
      candidates: [],
    }),
  });

  assert.equal(resolverCalled, false);
  assert.equal(plan.kind, "owner_pending");
  if (plan.kind === "owner_pending") {
    assert.equal(plan.extras.reason, "no_match");
    assert.equal(plan.extras.channel, "call");
    assert.equal(plan.jobNo, "P5556278");
  }
});

test("Owner Call Lead with two job matches is pending multiple_matches, not a 409", async () => {
  const plan = await resolveFromSourceAttach(callInput, undefined, {
    evaluateOwnerCallLeadMatch: async () => ({
      kind: "pending",
      reason: "multiple_matches",
      candidates: [],
    }),
  });

  assert.equal(plan.kind, "owner_pending");
  if (plan.kind === "owner_pending") {
    assert.equal(plan.extras.reason, "multiple_matches");
  }
});

test("Best Relocation import Call Lead still uses the from-source resolver", async () => {
  const importInput: CreateBookedLeadFromSourceInput = {
    ...callInput,
    ingestion_source: "best_relocation_sheet",
  };
  let ownerMatchCalled = false;
  const plan = await resolveFromSourceAttach(importInput, undefined, {
    evaluateOwnerCallLeadMatch: async () => {
      ownerMatchCalled = true;
      return { kind: "pending", reason: "no_match", candidates: [] };
    },
    resolveBookingSourceLead: async () => ({
      lead: lead as any,
      leadModel: "CallLead",
      jobNo: "P5556278",
    }),
  });

  assert.equal(ownerMatchCalled, false);
  assert.equal(plan.kind, "attach");
  if (plan.kind === "attach") {
    assert.equal(plan.bookingOrigin, undefined);
  }
});
