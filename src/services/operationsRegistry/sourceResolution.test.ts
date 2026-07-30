import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SOURCE_COMPANY_CONFIGS,
  SOURCE_LABEL_TO_COMPANY,
} from "../../config/domain";
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

test("owner-created dynamic source resolves by exact identifier", () => {
  const result = previewSourceAttribution(companies, granularities, {
    channel: "form",
    granularity_key: " DYNAMIC_FORM ",
  });

  assert.equal(result.status, "resolved");
  if (result.status === "resolved") {
    assert.equal(result.attribution.company_slug, "dynamic_source");
    assert.equal(result.attribution.match_kind, "exact");
    assert.equal(result.attribution.registry_revision, 3);
  }
});

test("active company default resolves only to an active same-channel record", () => {
  const result = previewSourceAttribution(companies, granularities, {
    channel: "call",
    company_slug: "dynamic_source",
  });

  assert.equal(result.status, "resolved");
  if (result.status === "resolved") {
    assert.equal(result.attribution.granularity_id, "call-a");
    assert.equal(result.attribution.match_kind, "default");
  }
});

test("a company identifier falls through to its default when it is not a granularity alias", () => {
  const result = previewSourceAttribution(companies, granularities, {
    channel: "call",
    company_slug: "dynamic_source",
    fallback_alias: "dynamic_source",
  });

  assert.equal(result.status, "resolved");
  if (result.status === "resolved") {
    assert.equal(result.attribution.granularity_id, "call-a");
    assert.equal(result.attribution.match_kind, "default");
  }
});

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

test("fallback aliases choose the unique highest priority candidate", () => {
  const result = previewSourceAttribution(
    companies,
    [
      ...granularities,
      {
        ...granularities[0],
        id: "form-low",
        granularity_key: "dynamic_form_low",
        priority: 1,
      },
    ],
    { channel: "form", fallback_alias: "legacy dynamic" },
  );

  assert.equal(result.status, "resolved");
  if (result.status === "resolved") {
    assert.equal(result.attribution.granularity_id, "form-a");
    assert.equal(result.attribution.match_kind, "fallback");
  }
});

test("an inferred unknown company identifier can resolve as a global alias in one pass", () => {
  const result = previewSourceAttribution(companies, granularities, {
    channel: "form",
    company_slug: "legacy dynamic",
    crm_label: "legacy dynamic",
    fallback_alias: "legacy dynamic",
    allow_company_identifier_fallback: true,
  });

  assert.equal(result.status, "resolved");
  if (result.status === "resolved") {
    assert.equal(result.attribution.granularity_id, "form-a");
    assert.equal(result.attribution.match_kind, "fallback");
  }
});

test("equal-priority fallback ambiguity fails deterministically", () => {
  const result = previewSourceAttribution(
    companies,
    [
      ...granularities,
      {
        ...granularities[0],
        id: "form-b",
        granularity_key: "dynamic_form_b",
      },
    ],
    { channel: "form", fallback_alias: "legacy dynamic" },
  );

  assert.deepEqual(result, {
    status: "ambiguous",
    identifier_kind: "fallback",
    identifier: "legacy dynamic",
    candidate_ids: ["form-a", "form-b"],
    priority: 10,
  });
});

test("inactive exact records and inactive defaults do not resolve", () => {
  const inactive = granularities.map((granularity) =>
    granularity.id === "form-a"
      ? { ...granularity, active: false }
      : granularity,
  );

  assert.equal(
    previewSourceAttribution(companies, inactive, {
      channel: "form",
      granularity_key: "dynamic_form",
    }).status,
    "not_found",
  );
  assert.equal(
    previewSourceAttribution(companies, inactive, {
      channel: "form",
      company_slug: "dynamic_source",
    }).status,
    "not_found",
  );
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
