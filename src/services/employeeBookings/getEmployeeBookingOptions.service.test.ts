import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleEmployeeBookingOptions } from "./getEmployeeBookingOptions.service";
import type { CatalogItem } from "../catalog";
import type {
  SourceCompanyItem,
  SourceGranularityItem,
} from "../operationsRegistry";

function company(
  overrides: Partial<SourceCompanyItem> & Pick<SourceCompanyItem, "id" | "owner_label">,
): SourceCompanyItem {
  return {
    _id: overrides.id,
    name: overrides.owner_label,
    company_slug: overrides.owner_label.toLowerCase().replace(/\s+/g, "-"),
    aliases: [],
    active: true,
    sheet_config: { has_bad_tabs: false, projection_mode: "derived_import" },
    granularities: [],
    created_from: "test",
    ...overrides,
  };
}

function granularity(
  overrides: Partial<SourceGranularityItem> &
    Pick<
      SourceGranularityItem,
      "id" | "source_company" | "granularity_key" | "owner_label" | "channel"
    >,
): SourceGranularityItem {
  return {
    _id: overrides.id,
    crm_label: overrides.owner_label,
    aliases: [],
    active: true,
    source_sites: [],
    priority: 0,
    schedule_revision: 0,
    created_from: "test",
    ...overrides,
  };
}

function catalogItem(
  overrides: Partial<CatalogItem> & Pick<CatalogItem, "id" | "name">,
): CatalogItem {
  return {
    _id: overrides.id,
    normalized_name: overrides.name.toLowerCase(),
    active: true,
    created_from: "test",
    ...overrides,
  };
}

test("assembleEmployeeBookingOptions joins active granularities to active companies", () => {
  const options = assembleEmployeeBookingOptions({
    companies: [
      company({ id: "co-a", owner_label: "Alpha Co" }),
      company({ id: "co-b", owner_label: "Beta Co", active: false }),
    ],
    granularities: [
      granularity({
        id: "g-2",
        source_company: "co-a",
        granularity_key: "alpha-calls",
        owner_label: "Alpha Calls",
        channel: "call",
        crm_label: "Alpha Calls CRM",
      }),
      granularity({
        id: "g-1",
        source_company: "co-a",
        granularity_key: "alpha-forms",
        owner_label: "Alpha Forms",
        channel: "form",
      }),
      granularity({
        id: "g-inactive",
        source_company: "co-a",
        granularity_key: "old",
        owner_label: "Old",
        channel: "form",
        active: false,
      }),
      granularity({
        id: "g-orphan",
        source_company: "co-b",
        granularity_key: "beta-forms",
        owner_label: "Beta Forms",
        channel: "form",
      }),
    ],
    agents: [
      catalogItem({ id: "a-2", name: "Zed" }),
      catalogItem({ id: "a-1", name: "Ann" }),
      catalogItem({ id: "a-3", name: "Old Agent", active: false }),
    ],
    merchants: [
      catalogItem({ id: "m-1", name: "Stripe" }),
      catalogItem({ id: "m-2", name: "Closed", active: false }),
    ],
  });

  assert.deepEqual(
    options.lead_sources.map((item) => item.granularity_key),
    ["alpha-calls", "alpha-forms"],
  );
  assert.deepEqual(options.lead_sources[0], {
    company_id: "co-a",
    company_label: "Alpha Co",
    granularity_id: "g-2",
    granularity_key: "alpha-calls",
    granularity_label: "Alpha Calls",
    crm_label: "Alpha Calls CRM",
    channel: "call",
  });
  assert.deepEqual(
    options.agents.map((item) => item.value),
    ["Ann", "Zed"],
  );
  assert.deepEqual(options.merchants, [{ value: "Stripe", label: "Stripe" }]);
});

test("assembleEmployeeBookingOptions ignores unknown company ids", () => {
  const options = assembleEmployeeBookingOptions({
    companies: [company({ id: "co-a", owner_label: "Alpha Co" })],
    granularities: [
      granularity({
        id: "g-missing",
        source_company: "missing",
        granularity_key: "ghost",
        owner_label: "Ghost",
        channel: "form",
      }),
    ],
    agents: [],
    merchants: [],
  });

  assert.deepEqual(options.lead_sources, []);
});
