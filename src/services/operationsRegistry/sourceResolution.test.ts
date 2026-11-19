import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import {
  SOURCE_COMPANY_CONFIGS,
  SOURCE_LABEL_TO_COMPANY,
} from "../../config/domain";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { getLeadSourceLabelMappingModel } from "../../models/LeadSourceLabelMapping";
import {
  getStaticSourceLabelMapConsultCount,
  resetStaticSourceLabelMapConsultsForTests,
  resolveSheetOrLegacyLabel,
} from "./labelMappings";
import {
  previewSourceAttribution,
  type RegistrySourceCompanyRecord,
  type RegistrySourceGranularityRecord,
} from "./sourceResolution";

const companies: RegistrySourceCompanyRecord[] = [
  {
    id: "company-a",
    company_slug: "dynamic_source",
    owner_label: "Dynamic Source",
    aliases: ["Dynamic"],
    active: true,
    default_form_granularity: "form-a",
    default_call_granularity: "call-a",
  },
];

const granularities: RegistrySourceGranularityRecord[] = [
  {
    id: "form-a",
    source_company: "company-a",
    granularity_key: "dynamic_form",
    channel: "form",
    owner_label: "Dynamic Forms",
    crm_label: "Dynamic Web Leads",
    aliases: ["legacy dynamic"],
    source_sites: ["landing.dynamic.test"],
    priority: 10,
    local: "local",
    active: true,
    schedule_revision: 3,
  },
  {
    id: "form-long-distance",
    source_company: "company-a",
    granularity_key: "dynamic_form_long_distance",
    channel: "form",
    owner_label: "Dynamic Long Distance Forms",
    crm_label: "Dynamic Long Distance Web Leads",
    aliases: [],
    source_sites: [],
    priority: 5,
    local: "long_distance",
    active: true,
    schedule_revision: 4,
  },
  {
    id: "call-a",
    source_company: "company-a",
    granularity_key: "dynamic_call",
    channel: "call",
    owner_label: "Dynamic Calls",
    crm_label: "Dynamic Inbounds",
    aliases: [],
    source_sites: [],
    priority: 0,
    active: true,
    schedule_revision: 2,
  },
];

test("local classification resolves the matching active granularity before the default", () => {
  const result = previewSourceAttribution(companies, granularities, {
    channel: "form",
    company_slug: "dynamic_source",
    local: "long_distance",
  });

  assert.equal(result.status, "resolved");
  if (result.status === "resolved") {
    assert.equal(result.attribution.granularity_id, "form-long-distance");
    assert.equal(result.attribution.match_kind, "exact");
  }
});

test("all legacy source-label fixtures preserve company attribution", () => {
  const legacyCompanies: RegistrySourceCompanyRecord[] = Object.entries(
    SOURCE_COMPANY_CONFIGS,
  ).map(([slug, config]) => ({
    id: slug,
    company_slug: slug,
    owner_label: config.label,
    aliases: [...config.aliases],
    active: true,
    default_form_granularity: `${slug}:form`,
    default_call_granularity: `${slug}:call`,
  }));
  const legacyGranularities: RegistrySourceGranularityRecord[] = legacyCompanies.flatMap(
    (company) =>
      (["form", "call"] as const).map((channel) => ({
        id: `${company.company_slug}:${channel}`,
        source_company: company.id,
        granularity_key: `${company.company_slug}_${channel}`,
        channel,
        owner_label: `${company.owner_label} ${channel}`,
        crm_label: `${company.owner_label} ${channel}`,
        aliases: Object.entries(SOURCE_LABEL_TO_COMPANY)
          .filter(
            ([label, slug]) =>
              slug === company.company_slug &&
              (channel === "call"
                ? /inbound|local/i.test(label)
                : !/inbound|local/i.test(label)),
          )
          .map(([label]) => label),
        source_sites: [],
        priority: 0,
        active: true,
        schedule_revision: 0,
      })),
  );

  for (const [label, expectedCompany] of Object.entries(
    SOURCE_LABEL_TO_COMPANY,
  )) {
    const channel = /inbound|local/i.test(label) ? "call" : "form";
    const result = previewSourceAttribution(
      legacyCompanies,
      legacyGranularities,
      { channel, fallback_alias: label },
    );
    assert.equal(result.status, "resolved", label);
    if (result.status === "resolved") {
      assert.equal(result.attribution.company_slug, expectedCompany, label);
    }
  }
});

const mappingCompanyId = new mongoose.Types.ObjectId();
const mappingFeedId = new mongoose.Types.ObjectId();
const mappingId = new mongoose.Types.ObjectId();
const Mapping = getLeadSourceLabelMappingModel();
const Company = getLeadSourceCompanyModel();
const Granularity = getLeadSourceGranularityModel();
const originalFind = Mapping.find;
const originalCompanyFindById = Company.findById;
const originalGranularityFindById = Granularity.findById;

afterEach(() => {
  (Mapping as unknown as Record<string, unknown>).find = originalFind;
  (Company as unknown as Record<string, unknown>).findById = originalCompanyFindById;
  (Granularity as unknown as Record<string, unknown>).findById =
    originalGranularityFindById;
  resetStaticSourceLabelMapConsultsForTests();
});

function lean(result: unknown) {
  return {
    session() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => result,
  };
}

test("empty collection falls back to the static map and emits exactly one compatibility-read event", async () => {
  (Mapping as unknown as Record<string, unknown>).find = () => lean([]);
  let compatibilityReads = 0;
  const result = await resolveSheetOrLegacyLabel(
    "sheet_lead_source",
    "Best Relocation Forms",
    {
      recordCompatibilityRead: async () => {
        compatibilityReads += 1;
      },
      recordResolutionFailure: async () => {
        throw new Error("fallback must not raise a resolution failure");
      },
    },
  );
  assert.equal(result.status, "resolved");
  if (result.status === "resolved") {
    assert.equal(result.source, "compatibility");
    if (result.source === "compatibility") {
      assert.equal(result.source_company_slug, "best_relocation_leads");
    }
  }
  assert.equal(getStaticSourceLabelMapConsultCount(), 1);
  assert.equal(compatibilityReads, 1);
});

test("ambiguous mapping fails closed and does not consult the static map", async () => {
  (Mapping as unknown as Record<string, unknown>).find = () =>
    lean([
      {
        _id: mappingId,
        namespace: "sheet_lead_source",
        normalized_label: "best relocation forms",
        source_company: mappingCompanyId,
        source_granularity: mappingFeedId,
        active: true,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        namespace: "sheet_lead_source",
        normalized_label: "best relocation forms",
        source_company: mappingCompanyId,
        source_granularity: mappingFeedId,
        active: true,
      },
    ]);
  const failures: string[] = [];
  const result = await resolveSheetOrLegacyLabel(
    "sheet_lead_source",
    "Best Relocation Forms",
    {
      consultStaticMap: () => {
        throw new Error("static map must not be consulted on ambiguous");
      },
      recordResolutionFailure: async (kind) => {
        failures.push(kind);
      },
    },
  );
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(failures, ["ambiguous"]);
  assert.equal(getStaticSourceLabelMapConsultCount(), 0);
});

test("inactive-Feed mapping fails closed and does not fall back to the static map", async () => {
  (Mapping as unknown as Record<string, unknown>).find = () =>
    lean([
      {
        _id: mappingId,
        namespace: "sheet_lead_source",
        normalized_label: "best relocation forms",
        source_company: mappingCompanyId,
        source_granularity: mappingFeedId,
        active: true,
      },
    ]);
  (Granularity as unknown as Record<string, unknown>).findById = () =>
    lean({
      _id: mappingFeedId,
      source_company: mappingCompanyId,
      active: false,
      granularity_key: "best_relocation_leads_form",
      owner_label: "Best Relocation Forms",
      crm_label: "Best Relocation Forms",
    });
  (Company as unknown as Record<string, unknown>).findById = () =>
    lean({
      _id: mappingCompanyId,
      active: true,
      company_slug: "best_relocation_leads",
    });
  const failures: string[] = [];
  const result = await resolveSheetOrLegacyLabel(
    "sheet_lead_source",
    "Best Relocation Forms",
    {
      consultStaticMap: () => {
        throw new Error("static map must not be consulted on inactive Feed");
      },
      recordResolutionFailure: async (kind) => {
        failures.push(kind);
      },
    },
  );
  assert.equal(result.status, "inactive_destination");
  assert.deepEqual(failures, ["inactive_destination"]);
  assert.equal(getStaticSourceLabelMapConsultCount(), 0);
});
