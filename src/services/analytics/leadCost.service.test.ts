import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { CallLead } from "../../models/CallLead";
import { FormLead } from "../../models/FormLead";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { analyticsQuerySchema } from "../../validation/v1.validation";
import { getLeadCost } from "./leadCost.service";

type MutableModel = Record<string, unknown>;

const originalFormAggregate = FormLead.aggregate as unknown;
const originalCallAggregate = CallLead.aggregate as unknown;
const SourceCompany = getLeadSourceCompanyModel();
const SourceGranularity = getLeadSourceGranularityModel();
const originalCompanyFind = SourceCompany.find as unknown;
const originalGranularityFind = SourceGranularity.find as unknown;

afterEach(() => {
  (FormLead as unknown as MutableModel).aggregate = originalFormAggregate;
  (CallLead as unknown as MutableModel).aggregate = originalCallAggregate;
  (SourceCompany as unknown as MutableModel).find = originalCompanyFind;
  (SourceGranularity as unknown as MutableModel).find = originalGranularityFind;
});

test("lead cost excludes duplicate form leads and unmatched call leads", async () => {
  const formPipelines: Record<string, unknown>[][] = [];
  const callPipelines: Record<string, unknown>[][] = [];

  (FormLead as unknown as MutableModel).aggregate = (pipeline: Record<string, unknown>[]) => {
    formPipelines.push(pipeline);
    return Promise.resolve([
      {
        _id: "tbm_leads",
        lead_count: 2,
        unresolved_cpl_count: 1,
        total_lead_cost: 190,
      },
    ]);
  };
  (CallLead as unknown as MutableModel).aggregate = (pipeline: Record<string, unknown>[]) => {
    callPipelines.push(pipeline);
    return Promise.resolve([]);
  };
  (SourceCompany as unknown as MutableModel).find = () =>
    queryResult([
      {
        _id: "company-1",
        company_slug: "tbm_leads",
        name: "TBM Leads",
        owner_label: "TBM Leads",
        active: true,
      },
    ]);
  (SourceGranularity as unknown as MutableModel).find = () =>
    queryResult([
      {
        _id: "granularity-1",
        source_company: "company-1",
        granularity_key: "unknown",
        owner_label: "Unknown",
        crm_label: "Unknown",
        channel: "form",
        active: true,
      },
    ]);

  const query = analyticsQuerySchema.parse({ database_scope: "production" });
  const result = await getLeadCost(
    {
      "form-leads": FormLead as never,
      "call-leads": CallLead as never,
      "booked-leads": {} as never,
      "cancelled-leads": {} as never,
      customers: {} as never,
      agents: {} as never,
    },
    query,
  );

  assert.equal(result.total, 190);
  assert.equal(result.unresolved_count, 1);
  assert.equal(result.by_source_company[0].unresolved_cpl_count, 1);
  assert.equal(result.by_source_company.length, 1);
  assert.match(JSON.stringify(formPipelines[0][0]), /duplicate/);
  assert.match(JSON.stringify(callPipelines[0][0]), /created_on_unmatched/);
  assert.doesNotMatch(JSON.stringify(formPipelines[0][1]), /cpl_resolution_status/);
  assert.match(JSON.stringify(formPipelines[0][1]), /"\$cpl"/);
  assert.match(
    JSON.stringify(formPipelines[0][1]),
    /source_granularity_key/,
  );
  assert.equal(
    result.by_source_company[0].granularities instanceof Array,
    true,
  );
});

function queryResult(rows: Record<string, unknown>[]) {
  const query = {
    sort: () => query,
    lean: () => query,
    exec: () => Promise.resolve(rows),
  };
  return query;
}
