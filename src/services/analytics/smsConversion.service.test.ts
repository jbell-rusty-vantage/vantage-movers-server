import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getLeadMessageModel } from "../../models/LeadMessage";
import { analyticsQuerySchema } from "../../validation/v1.validation";
import {
  getSmsSuccessfullySentThenBooked,
  smsConversionFromOriginRows,
  unsupportedSmsConversionReport,
} from "./smsConversion.service";

type MutableModel = Record<string, unknown>;

const LeadMessage = getLeadMessageModel();
const originalAggregate = LeadMessage.aggregate as unknown;

afterEach(() => {
  (LeadMessage as unknown as MutableModel).aggregate = originalAggregate;
});

const emptyModels = {
  "form-leads": { collection: { collectionName: "form_leads" } } as never,
  "call-leads": { collection: { collectionName: "call_leads" } } as never,
  "booked-leads": {} as never,
  "cancelled-leads": {} as never,
  customers: {} as never,
  agents: {} as never,
};

test("SMS booked rate uses successfully texted Leads as the denominator", () => {
  const payload = smsConversionFromOriginRows([
    { origin: "public_form", texted_leads: 2, booked_leads: 1 },
    { origin: "granot_lead_created", texted_leads: 1, booked_leads: 0 },
  ]);
  const overall = payload.items.find((row) => row.origin === "all");
  const publicForm = payload.items.find((row) => row.origin === "public_form");

  assert.equal(overall?.texted_leads, 3);
  assert.equal(overall?.booked_leads, 1);
  assert.equal(overall?.not_booked_leads, 2);
  assert.equal(overall?.booking_rate, 1 / 3);
  assert.equal(publicForm?.booking_rate, 0.5);
  assert.equal(publicForm?.label, "Public form");
});

test("an empty texted-lead cohort is a zero rate, not missing data", () => {
  const payload = smsConversionFromOriginRows([]);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0]?.origin, "all");
  assert.equal(payload.items[0]?.booking_rate, 0);
  assert.equal(payload.items[0]?.texted_leads, 0);
});

test("historical scope does not read Lead Messages", () => {
  const payload = unsupportedSmsConversionReport();
  assert.deepEqual(payload.items, []);
  assert.equal(payload.metadata.sms_conversion_scope, "unsupported");
  assert.equal(payload.metadata.historical_sms_conversion_supported, false);
});

test("production SMS conversion matches successful statuses and official booked refs", async () => {
  const pipelines: Record<string, unknown>[][] = [];
  (LeadMessage as unknown as MutableModel).aggregate = (pipeline: Record<string, unknown>[]) => {
    pipelines.push(pipeline);
    return Promise.resolve([
      { origin: "public_form", texted_leads: 4, booked_leads: 1 },
    ]);
  };

  const result = await getSmsSuccessfullySentThenBooked(
    emptyModels,
    analyticsQuerySchema.parse({ database_scope: "production" }),
  );

  assert.equal(pipelines.length, 1);
  const serialized = JSON.stringify(pipelines[0]);
  assert.match(serialized, /"accepted"/);
  assert.match(serialized, /"sent"/);
  assert.match(serialized, /"delivered"/);
  assert.doesNotMatch(serialized, /"failed"/);
  assert.doesNotMatch(serialized, /"undelivered"/);
  assert.doesNotMatch(serialized, /"skipped"/);
  assert.match(serialized, /\$lead\._id/);
  assert.match(serialized, /\$lead\.booked/);
  assert.doesNotMatch(serialized, /"from":"booked_leads"/);
  assert.equal(result.items[0]?.origin, "all");
  assert.equal(result.items[0]?.texted_leads, 4);
  assert.equal(result.items[0]?.booked_leads, 1);
  assert.equal(result.items[0]?.booking_rate, 0.25);
  assert.equal(result.metadata.sms_conversion_scope, "production_only");
});
