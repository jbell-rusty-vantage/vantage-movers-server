import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Agent } from "../../models/Agent";
import { Merchant } from "../../models/Merchant";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { invalidateRegistryCaches } from "../operationsRegistry";
import { getAdminFacets, resetAdminFacetsCacheForTests } from "./adminFacets.service";

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

test("getAdminFacets builds a structured catalog from first-class collections", async () => {
  stubProductionRegistry();

  const facets = await getAdminFacets();

  assert.equal(facets.catalog.source_granularities.length, 3);
  assert.deepEqual(
    facets.catalog.source_granularities.map((row) => row.owner_label),
    ["TBM Forms", "TBM Prime Forms", "Top10 Forms"],
  );
  assert.equal(facets.catalog.source_granularities[0].granularity_key, "tbm_leads_form");
  assert.equal(facets.catalog.source_granularities[0].channel, "form");
  assert.equal(facets.catalog.source_granularities[1].active, false);
  assert.equal(facets.catalog.source_granularities[1].owner_label, "TBM Prime Forms");
  assert.deepEqual(facets.source_companies, ["tbm_leads", "top10_leads"]);
  assert.deepEqual(facets.source_granularities, [
    "tbm_leads_form",
    "tbm_prime_leads_form",
    "top10_leads_form",
  ]);
  assert.deepEqual(facets.sources, ["TBM Forms", "TBM Prime Forms", "Top10 Forms"]);
  assert.equal(
    facets.catalog.source_granularities.some((row) => "granularities" in row),
    false,
  );
  assert.deepEqual(
    facets.catalog.source_companies.map((row) => row.owner_label),
    ["TBM Leads", "Top 10 Forms"],
  );
  assert.equal(
    facets.catalog.source_granularities.some((row) => "origin" in row),
    false,
  );
});

test("registry facets invalidation evicts the catalog cache", async () => {
  let companyReads = 0;
  stubProductionRegistry(() => {
    companyReads += 1;
  });

  await getAdminFacets();
  await getAdminFacets();
  assert.equal(companyReads, 1);

  invalidateRegistryCaches(["facets"]);
  await getAdminFacets();
  assert.equal(companyReads, 2);
});

function stubProductionRegistry(onCompanyRead?: () => void): void {
  (SourceCompany as unknown as MutableModel).find = () => {
    onCompanyRead?.();
    return queryResult([
      {
        _id: "company-tbm",
        id: "company-tbm",
        company_slug: "tbm_leads",
        name: "TBM Leads",
        owner_label: "TBM Leads",
        active: true,
        granularities: [{ granularity_key: "should_not_be_used" }],
      },
      {
        _id: "company-top10",
        id: "company-top10",
        company_slug: "top10_leads",
        name: "Top 10 Forms",
        owner_label: "Top 10 Forms",
        active: true,
      },
    ]);
  };
  (SourceGranularity as unknown as MutableModel).find = () =>
    queryResult([
      {
        _id: "granularity-tbm",
        id: "granularity-tbm",
        source_company: "company-tbm",
        granularity_key: "tbm_leads_form",
        owner_label: "TBM Forms",
        crm_label: "TBM Forms",
        channel: "form",
        active: true,
      },
      {
        _id: "granularity-retired",
        id: "granularity-retired",
        source_company: "company-tbm",
        granularity_key: "tbm_prime_leads_form",
        owner_label: "TBM Prime Forms",
        crm_label: "TBM Prime Forms",
        channel: "form",
        active: false,
      },
      {
        _id: "granularity-top10",
        id: "granularity-top10",
        source_company: "company-top10",
        granularity_key: "top10_leads_form",
        owner_label: "Top10 Forms",
        crm_label: "Top10 Forms",
        channel: "form",
        active: true,
      },
    ]);
  (Agent as unknown as MutableModel).find = () =>
    queryResult([
      { _id: "agent-1", id: "agent-1", name: "Alex", active: true },
      { _id: "agent-2", id: "agent-2", name: "Pat", active: false },
    ]);
  (Merchant as unknown as MutableModel).find = () =>
    queryResult([{ _id: "merchant-1", id: "merchant-1", name: "Elavon", active: true }]);
}

function queryResult(rows: Record<string, unknown>[]) {
  const query = {
    sort: () => query,
    lean: () => query,
    exec: () => Promise.resolve(rows),
  };
  return query;
}
