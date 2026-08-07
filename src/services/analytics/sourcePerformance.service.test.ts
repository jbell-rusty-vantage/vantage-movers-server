import assert from "node:assert/strict";
import { test } from "node:test";
import { analyticsQuerySchema } from "../../validation/v1.validation";
import type { AdminModels } from "../admin/adminScope.service";
import {
  getSourceCompanyFunnel,
  getSourceCompanyPerformance,
} from "./sourcePerformance.service";

test("historical source performance stays company-only without registry data", async () => {
  const aggregate = (pipeline: Record<string, unknown>[]) => {
    const group = pipeline.find((stage) => "$group" in stage) as {
      $group: { _id: unknown };
    };
    assert.equal(group.$group._id, "$derived_source_company");
    return Promise.resolve([
      {
        _id: "tbm_prime_leads",
        bookings: 2,
        cancelled_bookings: 1,
        total_deposit_amount: 5000,
        total_binder_amount: 800,
      },
    ]);
  };
  const result = await getSourceCompanyPerformance(
    fakeModels({ bookedAggregate: aggregate }),
    analyticsQuerySchema.parse({ database_scope: "historical" }),
  );

  assert.equal(result.items[0].source_company_label, "TBM Prime Leads");
  assert.equal(result.items[0].cancellation_rate, 0.5);
  assert.deepEqual(result.items[0].granularities, []);
});

test("historical funnel recomputes company rates and has no children", async () => {
  const result = await getSourceCompanyFunnel(
    fakeModels({
      formAggregate: () =>
        Promise.resolve([
          {
            _id: "main_site",
            lead_type: "FormLead",
            total_leads: 8,
            booked_leads: 3,
            cancelled_leads: 1,
          },
        ]),
      callAggregate: () => Promise.resolve([]),
      bookedAggregate: () =>
        Promise.resolve([
          {
            _id: "main_site",
            bookings: 4,
            cancelled_bookings: 1,
            total_deposit_amount: 9000,
            total_binder_amount: 1200,
          },
        ]),
    }),
    analyticsQuerySchema.parse({ database_scope: "historical" }),
  );

  assert.equal(result.items[0].booking_rate, 0.5);
  assert.equal(result.items[0].cancellation_rate, 0.25);
  assert.deepEqual(result.items[0].granularities, []);
});

function fakeModels(
  overrides: {
    formAggregate?: (pipeline: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>;
    callAggregate?: (pipeline: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>;
    bookedAggregate?: (pipeline: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>;
  },
): AdminModels {
  return {
    "form-leads": { aggregate: overrides.formAggregate ?? (() => Promise.resolve([])) } as never,
    "call-leads": { aggregate: overrides.callAggregate ?? (() => Promise.resolve([])) } as never,
    "booked-leads": { aggregate: overrides.bookedAggregate ?? (() => Promise.resolve([])) } as never,
    "cancelled-leads": {} as never,
    customers: {} as never,
    agents: {} as never,
  };
}
