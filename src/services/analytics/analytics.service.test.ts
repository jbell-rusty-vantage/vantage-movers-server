import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { inspect } from "node:util";
import { Agent } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { Merchant } from "../../models/Merchant";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { analyticsQuerySchema, analyticsReportSchema } from "../../validation/v1.validation";
import { bookedLeadPrefix, leadMatch, sourceGranularityMatch } from "./analyticsFilters";
import type { FilterCatalog } from "../admin/filterCatalog";
import { resetAdminFacetsCacheForTests } from "../admin/adminFacets.service";
import {
  exportAnalyticsReportCsv,
  rowsForCsv,
} from "./analyticsExport.service";
import { mergeAnalyticsPayload } from "./analyticsMerge";

type MutableModel = Record<string, unknown>;

const originalBookedAggregate = BookedLead.aggregate as unknown;
const SourceCompany = getLeadSourceCompanyModel();
const SourceGranularity = getLeadSourceGranularityModel();
const originalCompanyFind = SourceCompany.find as unknown;
const originalGranularityFind = SourceGranularity.find as unknown;
const originalAgentFind = Agent.find as unknown;
const originalMerchantFind = Merchant.find as unknown;

afterEach(() => {
  (BookedLead as unknown as MutableModel).aggregate = originalBookedAggregate;
  (SourceCompany as unknown as MutableModel).find = originalCompanyFind;
  (SourceGranularity as unknown as MutableModel).find = originalGranularityFind;
  (Agent as unknown as MutableModel).find = originalAgentFind;
  (Merchant as unknown as MutableModel).find = originalMerchantFind;
  resetAdminFacetsCacheForTests();
});

test("analytics validation accepts report filters and rejects invalid report names", () => {
  const query = analyticsQuerySchema.parse({
    database_scope: "combined",
    from: "2026-01-01",
    to: "2026-01-31",
    source_company: "Main Site Forms",
    agent: "Austin",
    receiver_agent: "507f1f77bcf86cd799439011",
    lead_type: "form",
    granularity: "day",
  });

  assert.equal(query.database_scope, "combined");
  assert.equal(query.receiver_agent, "507f1f77bcf86cd799439011");
  assert.equal(query.lead_type, "FormLead");
  assert.equal(query.granularity, "day");
  assert.equal(analyticsReportSchema.parse("revenue-trend"), "revenue-trend");
  assert.equal(analyticsReportSchema.parse("receiver-agent-performance"), "receiver-agent-performance");
  assert.equal(
    analyticsReportSchema.parse("sms-successfully-sent-then-booked"),
    "sms-successfully-sent-then-booked",
  );
  assert.throws(() => analyticsReportSchema.parse("unknown-report"));
  assert.throws(() => analyticsQuerySchema.parse({ receiver_agent: "not-an-object-id" }));
});

test("sourceGranularityMatch filters derived key only and wins over source_company", () => {
  const granularityOnly = bookedLeadPrefix(
    analyticsQuerySchema.parse({
      source_granularity_key: "top10_leads_form",
      source_company: "tbm_leads",
    }),
  );
  const last = granularityOnly[granularityOnly.length - 1] as {
    $match?: { derived_source_granularity_key?: RegExp };
  };
  const matcher = last.$match?.derived_source_granularity_key;
  assert.ok(matcher instanceof RegExp);
  assert.equal(matcher.source, "^top10_leads_form$");
  assert.doesNotMatch(JSON.stringify(granularityOnly), /tbm_leads/);
  assert.deepEqual(
    sourceGranularityMatch("derived_source_granularity_key", "top10_leads_form")[0],
    last,
  );
});

test("analytics booked lead filters start with a leading date match", () => {
  const query = analyticsQuerySchema.parse({
    from: "2026-02-01",
    to: "2026-02-28",
    merchant: "Elavon",
  });
  const pipeline = bookedLeadPrefix(query);

  assert.deepEqual(Object.keys(pipeline[0]), ["$match"]);
  assert.match(JSON.stringify(pipeline[0]), /book_date/);
  assert.match(JSON.stringify(pipeline[0]), /merchant/);
});

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

test("leadMatch matches historical slug options and channel-scoped company slugs", () => {
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
        origin: "registry",
      },
      {
        id: "",
        source_company_id: "",
        company_slug: "legacy_sheet",
        company_owner_label: "legacy_sheet",
        granularity_key: "legacy_sheet",
        channel: "form",
        owner_label: "legacy_sheet",
        active: true,
        origin: "historical_distinct",
      },
    ],
    agents: [],
    merchants: [],
  };
  const legacy = leadMatch(
    "FormLead",
    analyticsQuerySchema.parse({
      database_scope: "historical",
      source_granularity_key: "legacy_sheet",
    }),
    catalog,
  );
  const legacyPreview = inspect(legacy, { depth: null });
  assert.match(legacyPreview, /source_company/);
  assert.match(legacyPreview, /\^legacy_sheet\$/);

  const formMatch = leadMatch(
    "FormLead",
    analyticsQuerySchema.parse({
      database_scope: "combined",
      source_granularity_key: "top10_leads_form",
    }),
    catalog,
  );
  const callMatch = leadMatch(
    "CallLead",
    analyticsQuerySchema.parse({
      database_scope: "combined",
      source_granularity_key: "top10_leads_form",
    }),
    catalog,
  );
  assert.match(inspect(formMatch, { depth: null }), /\^top10_leads\$/);
  assert.doesNotMatch(inspect(callMatch, { depth: null }), /\^top10_leads\$/);
});

test("combined source analytics merge by stable text dimension instead of ids", () => {
  const merged = mergeAnalyticsPayload("source-company-performance", [
    {
      items: [
        {
          source_company: "Main Site Forms",
          bookings: 2,
          cancelled_bookings: 1,
          total_deposit_amount: 3000,
          total_binder_amount: 500,
        },
      ],
    },
    {
      items: [
        {
          source_company: "main_site",
          bookings: 3,
          cancelled_bookings: 1,
          total_deposit_amount: 4500,
          total_binder_amount: 750,
        },
      ],
    },
  ]);

  const items = merged.items as Record<string, unknown>[];
  assert.equal(items.length, 1);
  assert.equal(items[0].bookings, 5);
  assert.equal(items[0].cancelled_bookings, 2);
  assert.equal(items[0].total_deposit_amount, 7500);
});

test("combined revenue trend merges rows by date period", () => {
  const merged = mergeAnalyticsPayload("revenue-trend", [
    { items: [{ period: "2026-01", bookings: 1, total_deposit_amount: 1000 }] },
    { items: [{ period: "2026-01", bookings: 2, total_deposit_amount: 2000 }] },
  ]);

  const items = merged.items as Record<string, unknown>[];
  assert.equal(items.length, 1);
  assert.equal(items[0].period, "2026-01");
  assert.equal(items[0].bookings, 3);
  assert.equal(items[0].total_deposit_amount, 3000);
});

test("combined source analytics merge parent metrics and keep company-only extras as leaves", () => {
  const merged = mergeAnalyticsPayload("source-company-funnel", [
    {
      items: [
        {
          source_company: "main_site",
          source_company_label: "Vantage Movers",
          total_leads: 4,
          reconciled_bookings: 2,
          granularities: [
            {
              source_granularity_key: "main_site_form",
              source_granularity_label: "Main Site Forms",
              total_leads: 4,
              reconciled_bookings: 2,
            },
          ],
        },
      ],
    },
    {
      items: [
        {
          source_company: "main_site",
          source_company_label: "main site",
          total_leads: 6,
          reconciled_bookings: 3,
          granularities: [],
        },
      ],
    },
  ]);

  const items = merged.items as Record<string, unknown>[];
  const children = items[0].granularities as Array<{ source_granularity_key?: string }>;
  assert.equal(items[0].total_leads, 10);
  assert.equal(items[0].reconciled_bookings, 5);
  assert.equal(items[0].booking_rate, 0.5);
  assert.equal(children.length, 2);
  assert.ok(children.some((child) => child.source_granularity_key === "main_site_form"));
  assert.ok(children.some((child) => child.source_granularity_key === "main_site"));
});

test("combined receiver-agent analytics merge production rows and keep historical warning metadata", () => {
  const merged = mergeAnalyticsPayload("receiver-agent-performance", [
    {
      items: [
        {
          receiver_agent_id: "507f1f77bcf86cd799439011",
          receiver_agent_name: "Nick Smith",
          receiver_agent_group: "assigned",
          received_leads: 2,
          billable_received_leads: 1,
          booked_leads: 1,
          cancelled_leads: 0,
          total_lead_cost: 100,
        },
      ],
    },
    {
      items: [],
      metadata: {
        receiver_agent_scope: "unsupported",
        historical_receiver_agent_supported: false,
      },
    },
  ]);

  const items = merged.items as Record<string, unknown>[];
  const metadata = merged.metadata as Record<string, unknown>;
  assert.equal(items.length, 1);
  assert.equal(items[0].receiver_agent_name, "Nick Smith");
  assert.equal(items[0].booking_rate, 0.5);
  assert.equal(items[0].average_cpl, 100);
  assert.equal(metadata.historical_receiver_agent_supported, false);
});

test("combined SMS conversion merge keeps production rows and historical warning metadata", () => {
  const merged = mergeAnalyticsPayload("sms-successfully-sent-then-booked", [
    {
      items: [
        {
          origin: "all",
          label: "All",
          texted_leads: 3,
          booked_leads: 1,
          not_booked_leads: 2,
          booking_rate: 1 / 3,
        },
        {
          origin: "public_form",
          label: "Public form",
          texted_leads: 3,
          booked_leads: 1,
          not_booked_leads: 2,
          booking_rate: 1 / 3,
        },
      ],
    },
    {
      items: [],
      metadata: {
        sms_conversion_scope: "unsupported",
        historical_sms_conversion_supported: false,
      },
    },
  ]);

  const items = merged.items as Record<string, unknown>[];
  const metadata = merged.metadata as Record<string, unknown>;
  assert.equal(items.length, 2);
  assert.equal(items[0].origin, "all");
  assert.equal(items[0].texted_leads, 3);
  assert.equal(items[0].booking_rate, 1 / 3);
  assert.equal(items[0].not_booked_leads, 2);
  assert.equal(metadata.historical_sms_conversion_supported, false);
});

test("analytics CSV export uses the selected report rows", async () => {
  (BookedLead as unknown as MutableModel).aggregate = () =>
    Promise.resolve([
      {
        _id: {
          source_company: "main_site",
          source_granularity_key: "main_site_form",
        },
        bookings: 2,
        cancelled_bookings: 0,
        active_bookings: 2,
        total_deposit_amount: 1200,
        total_binder_amount: 300,
        booking_rate: null,
        cancellation_rate: 0,
      },
      {
        _id: {
          source_company: "main_site",
          source_granularity_key: "main_site_call",
        },
        bookings: 3,
        cancelled_bookings: 1,
        active_bookings: 2,
        total_deposit_amount: 1800,
        total_binder_amount: 450,
        booking_rate: null,
        cancellation_rate: 1 / 3,
      },
    ]);
  (SourceCompany as unknown as MutableModel).find = () =>
    queryResult([
      {
        _id: "company-1",
        company_slug: "main_site",
        name: "Main Site",
        owner_label: "Vantage Movers",
        active: true,
      },
    ]);
  (SourceGranularity as unknown as MutableModel).find = () =>
    queryResult([
      {
        _id: "granularity-1",
        source_company: "company-1",
        granularity_key: "main_site_form",
        owner_label: "Main Site Forms",
        crm_label: "Main Site Forms",
        channel: "form",
        active: true,
      },
      {
        _id: "granularity-2",
        source_company: "company-1",
        granularity_key: "main_site_call",
        owner_label: "Main Site Calls",
        crm_label: "Main Site Calls",
        channel: "call",
        active: true,
      },
    ]);
  (Agent as unknown as MutableModel).find = () => queryResult([]);
  (Merchant as unknown as MutableModel).find = () => queryResult([]);

  const query = analyticsQuerySchema.parse({ database_scope: "production" });
  const result = await exportAnalyticsReportCsv("source-company-performance", query);

  assert.equal(result.filename, "analytics-source-company-performance-production.csv");
  assert.match(
    result.csv,
    /^source_company,source_company_label,source_granularity_key,source_granularity_label,channel/,
  );
  const lines = result.csv.trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(result.csv, /main_site,Vantage Movers,main_site_form,Main Site Forms,form,2,0,2,1200,300/);
  assert.match(result.csv, /main_site,Vantage Movers,main_site_call,Main Site Calls,call,3,1,2,1800,450/);
  const bookingsColumn = lines[0].split(",").indexOf("bookings");
  assert.equal(
    lines.slice(1).reduce(
      (sum, line) => sum + Number(line.split(",")[bookingsColumn]),
      0,
    ),
    5,
  );
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

test("combined hierarchy CSV does not duplicate its production contribution", () => {
  const rows = rowsForCsv("source-company-funnel", {
    items: [
      {
        source_company: "main_site",
        source_company_label: "Vantage Movers",
        total_leads: 15,
        granularities: [
          { source_granularity_key: "main_site_form", total_leads: 4 },
          { source_granularity_key: "main_site_call", total_leads: 6 },
        ],
      },
    ],
  });

  assert.equal(rows.length, 2);
  assert.equal(
    rows.reduce((sum, row) => sum + Number(row.total_leads), 0),
    10,
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
