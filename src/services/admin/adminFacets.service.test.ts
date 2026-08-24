import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Agent } from "../../models/Agent";
import { Merchant } from "../../models/Merchant";
import { registerHistoricalModels } from "../../models/historical";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { invalidateRegistryCaches } from "../operationsRegistry";
import { getAdminFacets, resetAdminFacetsCacheForTests } from "./adminFacets.service";

type MutableModel = Record<string, unknown>;

const SourceCompany = getLeadSourceCompanyModel();
const SourceGranularity = getLeadSourceGranularityModel();
const historical = registerHistoricalModels();

const originals = {
  companyFind: SourceCompany.find as unknown,
  granularityFind: SourceGranularity.find as unknown,
  agentFind: Agent.find as unknown,
  merchantFind: Merchant.find as unknown,
  formDistinct: historical.FormLead.distinct as unknown,
  callDistinct: historical.CallLead.distinct as unknown,
  bookedDistinct: historical.BookedLead.distinct as unknown,
  bookedAggregate: historical.BookedLead.aggregate as unknown,
};

afterEach(() => {
  (SourceCompany as unknown as MutableModel).find = originals.companyFind;
  (SourceGranularity as unknown as MutableModel).find = originals.granularityFind;
  (Agent as unknown as MutableModel).find = originals.agentFind;
  (Merchant as unknown as MutableModel).find = originals.merchantFind;
  (historical.FormLead as unknown as MutableModel).distinct = originals.formDistinct;
  (historical.CallLead as unknown as MutableModel).distinct = originals.callDistinct;
  (historical.BookedLead as unknown as MutableModel).distinct = originals.bookedDistinct;
  (historical.BookedLead as unknown as MutableModel).aggregate = originals.bookedAggregate;
  resetAdminFacetsCacheForTests();
});

test("getAdminFacets production builds a structured catalog from first-class collections", async () => {
  stubProductionRegistry();

  const facets = await getAdminFacets("production");

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
});

test("getAdminFacets historical builds distinct rows and overlays production identity", async () => {
  stubProductionRegistry();
  stubHistoricalDistincts({
    formKeys: ["top10_leads_form"],
    formSnapshots: ["Top10 Forms"],
    formCompanies: ["top10_leads", "legacy_sheet"],
    callKeys: [],
    callSnapshots: [],
    callCompanies: [],
    bookedSources: ["Old Booked Source"],
    bookedKeys: [],
    bookedSnapshots: [],
    agents: ["Pat"],
    merchants: ["Elavon"],
  });

  const facets = await getAdminFacets("historical");
  const top10 = facets.catalog.source_granularities.find(
    (row) => row.granularity_key === "top10_leads_form",
  );
  const legacy = facets.catalog.source_granularities.find(
    (row) => row.granularity_key === "legacy_sheet",
  );
  const bookedOnly = facets.catalog.source_granularities.find(
    (row) => row.granularity_key === "Old Booked Source",
  );

  assert.equal(top10?.id, "granularity-top10");
  assert.equal(top10?.owner_label, "Top10 Forms");
  assert.equal(top10?.origin, "historical_distinct");
  assert.equal(
    facets.catalog.source_granularities.filter(
      (row) => row.granularity_key === "top10_leads_form" || row.owner_label === "Top10 Forms",
    ).length,
    1,
  );
  assert.equal(
    facets.catalog.source_granularities.some((row) => row.granularity_key === "top10_leads"),
    false,
  );
  assert.equal(legacy?.id, "");
  assert.equal(legacy?.channel, "form");
  assert.equal(bookedOnly?.channel, undefined);
  assert.equal(facets.catalog.agents[0].name, "Pat");
});

test("getAdminFacets historical empty granularity distincts do not fail", async () => {
  stubProductionRegistry();
  stubHistoricalDistincts({
    formKeys: [],
    formSnapshots: [],
    formCompanies: ["tbm_leads"],
    callKeys: [],
    callSnapshots: [],
    callCompanies: [],
    bookedSources: [],
    bookedKeys: [],
    bookedSnapshots: [],
    agents: [],
    merchants: [],
  });

  const facets = await getAdminFacets("historical");
  assert.equal(facets.catalog.source_granularities[0].granularity_key, "tbm_leads");
  assert.equal(facets.catalog.source_granularities[0].channel, "form");
});

test("getAdminFacets combined keeps registry owner_label and historical-only extras", async () => {
  stubProductionRegistry();
  stubHistoricalDistincts({
    formKeys: ["top10_leads_form", "legacy_sheet"],
    formSnapshots: ["Top10 Forms"],
    formCompanies: ["top10_leads"],
    callKeys: [],
    callSnapshots: [],
    callCompanies: [],
    bookedSources: [],
    bookedKeys: [],
    bookedSnapshots: [],
    agents: ["Alex"],
    merchants: [],
  });

  const facets = await getAdminFacets("combined");
  const top10 = facets.catalog.source_granularities.find(
    (row) => row.granularity_key === "top10_leads_form",
  );
  const legacy = facets.catalog.source_granularities.find(
    (row) => row.granularity_key === "legacy_sheet",
  );

  assert.equal(top10?.origin, "registry");
  assert.equal(top10?.owner_label, "Top10 Forms");
  assert.equal(legacy?.origin, "historical_distinct");
  assert.equal(legacy?.owner_label, "legacy_sheet");
  assert.ok(facets.catalog.source_granularities.some((row) => row.granularity_key === "tbm_leads_form"));
});

test("registry facets invalidation evicts the production and historical catalog caches", async () => {
  let companyReads = 0;
  let historicalReads = 0;
  stubProductionRegistry(() => {
    companyReads += 1;
  });
  stubHistoricalDistincts({
    formKeys: [],
    formSnapshots: [],
    formCompanies: ["legacy_sheet"],
    callKeys: [],
    callSnapshots: [],
    callCompanies: [],
    bookedSources: [],
    bookedKeys: [],
    bookedSnapshots: [],
    agents: [],
    merchants: [],
    onFormRead: () => {
      historicalReads += 1;
    },
  });

  await getAdminFacets("production");
  await getAdminFacets("historical");
  await getAdminFacets("production");
  await getAdminFacets("historical");
  assert.equal(companyReads, 1);
  assert.equal(historicalReads, 1);

  invalidateRegistryCaches(["facets"]);
  await getAdminFacets("production");
  await getAdminFacets("historical");
  assert.equal(companyReads, 2);
  assert.equal(historicalReads, 2);
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

function stubHistoricalDistincts(values: {
  formKeys: string[];
  formSnapshots: string[];
  formCompanies: string[];
  callKeys: string[];
  callSnapshots: string[];
  callCompanies: string[];
  bookedSources: string[];
  bookedKeys: string[];
  bookedSnapshots: string[];
  agents: string[];
  merchants: string[];
  onFormRead?: () => void;
}): void {
  (historical.FormLead as unknown as MutableModel).distinct = (field: string) => {
    if (field === "source_granularity_key") {
      values.onFormRead?.();
      return Promise.resolve(values.formKeys);
    }
    if (field === "source_granularity_label_snapshot") return Promise.resolve(values.formSnapshots);
    if (field === "source_company") return Promise.resolve(values.formCompanies);
    return Promise.resolve([]);
  };
  (historical.CallLead as unknown as MutableModel).distinct = (field: string) => {
    if (field === "source_granularity_key") return Promise.resolve(values.callKeys);
    if (field === "source_granularity_label_snapshot") return Promise.resolve(values.callSnapshots);
    if (field === "source_company") return Promise.resolve(values.callCompanies);
    return Promise.resolve([]);
  };
  (historical.BookedLead as unknown as MutableModel).distinct = (field: string) => {
    if (field === "source") return Promise.resolve(values.bookedSources);
    if (field === "employee_source_snapshot.source_granularity_key") {
      return Promise.resolve(values.bookedKeys);
    }
    if (field === "employee_source_snapshot.source_granularity_label_snapshot") {
      return Promise.resolve(values.bookedSnapshots);
    }
    if (field === "merchant") return Promise.resolve(values.merchants);
    return Promise.resolve([]);
  };
  (historical.BookedLead as unknown as MutableModel).aggregate = () =>
    Promise.resolve(values.agents.map((name) => ({ _id: name })));
}

function queryResult(rows: Record<string, unknown>[]) {
  const query = {
    sort: () => query,
    lean: () => query,
    exec: () => Promise.resolve(rows),
  };
  return query;
}
