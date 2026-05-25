import assert from "node:assert/strict";
import test from "node:test";
import {
  bookedCallLeadReconciliationBatchSchema,
  createBookedLeadFromSourceSchema,
  createCallLeadSchema,
} from "./v1.validation";
import { CallLead } from "../models/CallLead";

test("createCallLeadSchema accepts a job_no-only call lead", () => {
  const parsed = createCallLeadSchema.parse({
    job_no: "P5556278",
    source_company: "BestRelocation Inbounds",
  });

  assert.equal(parsed.job_no, "P5556278");
  assert.equal(parsed.source_company, "BestRelocation Inbounds");
});

test("createCallLeadSchema rejects call leads without phone_number or job_no", () => {
  const parsed = createCallLeadSchema.safeParse({
    source_company: "BestRelocation Inbounds",
  });

  assert.equal(parsed.success, false);
});

test("createBookedLeadFromSourceSchema accepts CallLead booking with only call_job_no", () => {
  const parsed = createBookedLeadFromSourceSchema.parse({
    lead_type: "CallLead",
    call_job_no: "P5556278",
    book_date: "2026-05-21",
    agent: "JOSH",
    binder_amount: 900,
    deposit_amount: 900,
    merchant: "Card",
    source_company: "BestRelocation Inbounds",
  });

  assert.equal(parsed.lead_type, "CallLead");
  assert.equal(parsed.call_job_no, "P5556278");
  assert.equal(parsed.call_phone_number, undefined);
});

test("bookedCallLeadReconciliationBatchSchema accepts Booked Jobs CRM rows", () => {
  const parsed = bookedCallLeadReconciliationBatchSchema.parse({
    rows: [
      {
        row_id: "1:P5556278",
        row_index: 1,
        section: "bookedJobs",
        job_no: "P5556278",
        source: "BestRelocation Inbounds",
        prior: "5",
        book_date: "05/21/2026",
        customer: "Andres Gonzalez",
        phone: "2405504455",
        email: "ag@acentopartners.com",
        from_zip: "22903",
        to_zip: "22903",
        est_cf: "300",
      },
    ],
  });

  assert.equal(parsed.rows[0].section, "bookedJobs");
  assert.equal(parsed.rows[0].prior, "5");
});

test("CallLead model validates job_no-only identity", async () => {
  const lead = new CallLead({
    job_no: "P5556278",
    source_company: "best_relocation_leads",
  });

  await assert.doesNotReject(() => lead.validate());
});

test("CallLead model rejects identity-less documents", async () => {
  const lead = new CallLead({
    source_company: "best_relocation_leads",
  });

  await assert.rejects(() => lead.validate(), /phone_number/);
});
