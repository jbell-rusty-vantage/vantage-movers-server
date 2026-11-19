import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import { analyticsQuerySchema } from "../../validation/v1.validation";
import { bookedLeadPrefix, leadMatch } from "./analyticsFilters";
import type { FilterCatalog } from "../admin/filterCatalog";
import { rowsForCsv } from "./analyticsExport.service";

test("booked lead source attribution falls back to the employee source snapshot", () => {
  const pipeline = bookedLeadPrefix(
    analyticsQuerySchema.parse({
      source_granularity_key: "tbm_prime_leads_form",
    }),
  ) as unknown as Array<Record<string, Record<string, unknown>>>;
  const sourceStage = pipeline.find(
    (stage) => stage.$set?.derived_source_company !== undefined,
  );
  assert.ok(sourceStage);

  const companyReferences = fieldReferences(
    sourceStage.$set.derived_source_company,
  );
  const granularityReferences = fieldReferences(
    sourceStage.$set.derived_source_granularity_key,
  );
  assert.deepEqual(companyReferences, [
    "employee_source_snapshot.source_company",
    "form_lead.source_company",
    "call_lead.source_company",
    "form_lead.source_company_label_snapshot",
    "call_lead.source_company_label_snapshot",
    "source",
  ]);
  assert.deepEqual(granularityReferences, [
    "employee_source_snapshot.source_granularity_key",
    "form_lead.source_granularity_key",
    "call_lead.source_granularity_key",
    "source",
  ]);

  const leadlessBooking = {
    employee_source_snapshot: {
      source_company: "tbm_prime_leads",
      source_granularity_key: "tbm_prime_leads_form",
    },
    source: "legacy source",
  };
  assert.equal(firstPresent(companyReferences, leadlessBooking), "tbm_prime_leads");
  assert.equal(
    firstPresent(granularityReferences, leadlessBooking),
    "tbm_prime_leads_form",
  );

  const joinedBooking = {
    form_lead: {
      source_company: "main_site",
      source_granularity_key: "main_site_form",
    },
  };
  assert.equal(firstPresent(companyReferences, joinedBooking), "main_site");
  assert.equal(
    firstPresent(granularityReferences, joinedBooking),
    "main_site_form",
  );

  const conflictingBooking = {
    ...joinedBooking,
    employee_source_snapshot: leadlessBooking.employee_source_snapshot,
  };
  assert.equal(
    firstPresent(companyReferences, conflictingBooking),
    "tbm_prime_leads",
  );
  assert.equal(
    firstPresent(granularityReferences, conflictingBooking),
    "tbm_prime_leads_form",
  );

  const granularityMatch = pipeline.find(
    (stage) =>
      stage.$match?.derived_source_granularity_key !== undefined,
  );
  const matcher = granularityMatch?.$match
    ?.derived_source_granularity_key as RegExp;
  assert.ok(matcher instanceof RegExp);
  assert.equal(matcher.test("TBM_PRIME_LEADS_FORM"), true);

  const bookedOnly = { source: "Old Booked Source" };
  assert.equal(firstPresent(granularityReferences, bookedOnly), "Old Booked Source");
});

test("leadMatch matches a registry granularity by key, label snapshot and id only", () => {
  const catalog: FilterCatalog = {
    source_companies: [],
    source_granularities: [
      {
        id: "aaaaaaaaaaaaaaaaaaaaaaaa",
        source_company_id: "company-top10",
        company_slug: "top10_leads",
        company_owner_label: "Top 10 Forms",
        granularity_key: "top10_leads_form",
        channel: "form",
        owner_label: "Top10 Forms",
        active: true,
      },
    ],
    agents: [],
    merchants: [],
  };

  const formMatch = inspect(
    leadMatch(
      "FormLead",
      analyticsQuerySchema.parse({ source_granularity_key: "top10_leads_form" }),
      catalog,
    ),
    { depth: null },
  );

  assert.match(formMatch, /source_granularity_key/);
  assert.match(formMatch, /source_granularity_label_snapshot/);
  assert.match(formMatch, /source_granularity_id/);
  assert.doesNotMatch(formMatch, /\^top10_leads\$/);
});

test("source hierarchy CSV rows emit leaves or a childless company, never both", () => {
  const productionChildren = [
    { source_granularity_key: "main_site_form", bookings: 2 },
    { source_granularity_key: "main_site_call", bookings: 3 },
  ];
  const rows = rowsForCsv("source-company-performance", {
    items: [
      {
        source_company: "main_site",
        source_company_label: "Vantage Movers",
        bookings: 5,
        granularities: productionChildren,
      },
      {
        source_company: "tbm_prime_leads",
        source_company_label: "TBM Prime Leads",
        bookings: 4,
        granularities: [],
      },
    ],
  });

  assert.equal(rows.length, 3);
  assert.equal(rows.filter((row) => row.source_company === "main_site").length, 2);
  assert.equal(
    rows
      .filter((row) => row.source_company === "main_site")
      .reduce((sum, row) => sum + Number(row.bookings), 0),
    5,
  );
  assert.equal(
    rows.filter((row) => row.source_company === "tbm_prime_leads").length,
    1,
  );
  assert.equal(rows.some((row) => "granularities" in row), false);
});

function fieldReferences(value: unknown): string[] {
  if (typeof value === "string") {
    return value.startsWith("$") && !value.startsWith("$$")
      ? [value.slice(1)]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(fieldReferences);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.values(value).flatMap(fieldReferences);
}

function firstPresent(
  paths: readonly string[],
  value: Record<string, unknown>,
): unknown {
  for (const path of paths) {
    let current: unknown = value;
    for (const segment of path.split(".")) {
      if (Array.isArray(current)) current = current[0];
      current =
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[segment]
          : undefined;
    }
    if (Array.isArray(current)) current = current[0];
    if (current !== undefined && current !== null) return current;
  }
  return undefined;
}
