import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Agent } from "../../models/Agent";
import { Merchant } from "../../models/Merchant";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { analyticsQuerySchema } from "../../validation/v1.validation";
import type { AdminModels } from "../admin/adminScope.service";
import { resetAdminFacetsCacheForTests } from "../admin/adminFacets.service";
import {
  getSourceCompanyFunnel,
  getSourceCompanyPerformance,
} from "./sourcePerformance.service";

type MutableModel = Record<string, unknown>;
const SourceCompany = getLeadSourceCompanyModel();
const SourceGranularity = getLeadSourceGranularityModel();
const originals = {
  companyFind: SourceCompany.find as unknown,
  granularityFind: SourceGranularity.find as unknown,
  agentFind: Agent.find as unknown,
  merchantFind: Merchant.find as unknown,
};

afterEach(() => {
  (SourceCompany as unknown as MutableModel).find = originals.companyFind;
  (SourceGranularity as unknown as MutableModel).find = originals.granularityFind;
  (Agent as unknown as MutableModel).find = originals.agentFind;
  (Merchant as unknown as MutableModel).find = originals.merchantFind;
  resetAdminFacetsCacheForTests();
});

function stubCatalog(
  companies: Record<string, unknown>[] = [],
  granularities: Record<string, unknown>[] = [],
): void {
  const queryResult = (rows: Record<string, unknown>[]) => {
    const query = {
      sort: () => query,
      lean: () => query,
      exec: () => Promise.resolve(rows),
    };
    return query;
  };
  (SourceCompany as unknown as MutableModel).find = () => queryResult(companies);
  (SourceGranularity as unknown as MutableModel).find = () => queryResult(granularities);
  (Agent as unknown as MutableModel).find = () => queryResult([]);
  (Merchant as unknown as MutableModel).find = () => queryResult([]);
}

const SOURCE_GRANULARITY_GROUP = {
  source_company: "$derived_source_company",
  source_granularity_key: { $ifNull: ["$derived_source_granularity_key", "unknown"] },
};

test("source performance groups bookings by source company and granularity", async () => {
  stubCatalog(
    [{ _id: "company-tbm-prime", company_slug: "tbm_prime_leads", owner_label: "TBM Prime Leads", active: true }],
    [
      {
        _id: "granularity-tbm-prime-form",
        source_company: "company-tbm-prime",
        granularity_key: "tbm_prime_leads_form",
        owner_label: "TBM Prime Forms",
        channel: "form",
        active: true,
      },
    ],
  );
  const aggregate = (pipeline: Record<string, unknown>[]) => {
    const group = pipeline.find((stage) => "$group" in stage) as {
      $group: { _id: unknown };
    };
    assert.deepEqual(group.$group._id, SOURCE_GRANULARITY_GROUP);
    return Promise.resolve([
      {
        _id: { source_company: "tbm_prime_leads", source_granularity_key: "tbm_prime_leads_form" },
        bookings: 2,
        cancelled_bookings: 1,
        total_deposit_amount: 5000,
        total_binder_amount: 800,
      },
    ]);
  };
  const result = await getSourceCompanyPerformance(
    fakeModels({ bookedAggregate: aggregate }),
    analyticsQuerySchema.parse({}),
  );

  assert.equal(result.items[0].source_company_label, "TBM Prime Leads");
  assert.equal(result.items[0].cancellation_rate, 0.5);
  assert.deepEqual(
    result.items[0].granularities.map((row) => row.source_granularity_label),
    ["TBM Prime Forms"],
  );
});

test("source funnel recomputes company rates from granularity leaves", async () => {
  stubCatalog();
  const result = await getSourceCompanyFunnel(
    fakeModels({
      formAggregate: () =>
        Promise.resolve([
          {
            _id: { source_company: "main_site", source_granularity_key: "main_site_form" },
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
            _id: { source_company: "main_site", source_granularity_key: "main_site_form" },
            bookings: 4,
            cancelled_bookings: 1,
            total_deposit_amount: 9000,
            total_binder_amount: 1200,
          },
        ]),
    }),
    analyticsQuerySchema.parse({}),
  );

  assert.equal(result.items[0].booking_rate, 0.5);
  assert.equal(result.items[0].cancellation_rate, 0.25);
  assert.equal(result.items[0].granularities.length, 1);
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
  };
}
