import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeConversionReport,
  conversionRate,
  isSuccessfulLeadMessageStatus,
  uniqueSuccessfulSmsLeads,
} from "./rates.js";

test("successful text is accepted, sent, or delivered", () => {
  assert.equal(isSuccessfulLeadMessageStatus("accepted"), true);
  assert.equal(isSuccessfulLeadMessageStatus("sent"), true);
  assert.equal(isSuccessfulLeadMessageStatus("delivered"), true);
  assert.equal(isSuccessfulLeadMessageStatus("failed"), false);
  assert.equal(isSuccessfulLeadMessageStatus("undelivered"), false);
  assert.equal(isSuccessfulLeadMessageStatus("skipped"), false);
  assert.equal(isSuccessfulLeadMessageStatus("pending"), false);
});

test("conversion rate is zero when the cohort is empty", () => {
  assert.deepEqual(conversionRate(0, 0), {
    numerator: 0,
    denominator: 0,
    rate: 0,
    percent: 0,
  });
});

test("two successful messages for one Lead count once", () => {
  const unique = uniqueSuccessfulSmsLeads([
    {
      lead_id: "lead-1",
      origin: "public_form",
      booked: false,
      cancelled: false,
    },
    {
      lead_id: "lead-1",
      origin: "public_form",
      booked: true,
      cancelled: false,
    },
  ]);
  assert.equal(unique.length, 1);
  assert.equal(unique[0]?.booked, true);
});

test("SMS booked rate is booked among successfully texted Leads, not all Leads", () => {
  const report = computeConversionReport({
    sms_leads: [
      {
        lead_id: "a",
        origin: "public_form",
        booked: true,
        cancelled: false,
      },
      {
        lead_id: "b",
        origin: "public_form",
        booked: false,
        cancelled: false,
      },
      {
        lead_id: "c",
        origin: "granot_lead_created",
        booked: false,
        cancelled: false,
      },
    ],
    received_leads: [],
  });
  assert.equal(report.sms_successfully_sent_then_booked.leads, 3);
  assert.equal(report.sms_successfully_sent_then_booked.booked, 1);
  assert.equal(report.sms_successfully_sent_then_booked.booked_of_leads.percent, 33.33);
  assert.equal(
    report.sms_by_origin.find((row) => row.key === "public_form")?.booked_of_leads
      .percent,
    50,
  );
  assert.equal(
    report.sms_by_origin.find((row) => row.key === "granot_lead_created")
      ?.booked_of_leads.percent,
    0,
  );
});

test("receiver-agent booked and cancelled both use received Leads as the denominator", () => {
  const report = computeConversionReport({
    sms_leads: [],
    received_leads: [
      {
        lead_id: "1",
        lead_model: "FormLead",
        booked: true,
        cancelled: true,
      },
      {
        lead_id: "2",
        lead_model: "FormLead",
        booked: true,
        cancelled: false,
      },
      {
        lead_id: "3",
        lead_model: "CallLead",
        booked: false,
        cancelled: false,
      },
    ],
    unassigned_official_cancellations: 46,
  });
  assert.equal(report.received_by_agent.leads, 3);
  assert.equal(report.received_by_agent.booked_of_leads.percent, 66.67);
  assert.equal(report.received_by_agent.cancelled_of_leads.percent, 33.33);
  assert.equal(
    report.received_by_agent.cancelled_of_leads.denominator,
    report.received_by_agent.leads,
  );
  assert.notEqual(
    report.received_by_agent.cancelled_of_leads.denominator,
    report.received_by_agent.booked,
  );
  assert.equal(
    report.received_by_agent_by_lead_model.find((row) => row.key === "CallLead")
      ?.booked_of_leads.percent,
    0,
  );
  assert.match(
    report.notes.join(" "),
    /46 official Cancellation/,
  );
});
