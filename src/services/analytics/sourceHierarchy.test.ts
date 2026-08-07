import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSourceLabelIndex,
  companyOnlySourceRows,
  nestSourceCompanyRows,
} from "./sourceHierarchy";

const labels = buildSourceLabelIndex(
  [
    {
      id: "company-1",
      company_slug: "tbm_prime_leads",
      owner_label: "TBM Prime Leads",
      name: "Legacy TBM Prime",
    },
  ],
  [
    {
      source_company: "company-1",
      granularity_key: "tbm_prime_leads_form",
      owner_label: "TBM Prime Forms",
      crm_label: "CRM Forms",
      channel: "form",
    },
    {
      source_company: "company-1",
      granularity_key: "tbm_prime_leads_call",
      owner_label: "TBM Prime Inbounds",
      crm_label: "CRM Calls",
      channel: "call",
    },
  ],
);

test("source hierarchy uses registry labels and rolls additive child metrics", () => {
  const rows = nestSourceCompanyRows(
    [
      {
        _id: {
          source_company: "tbm_prime_leads",
          source_granularity_key: "tbm_prime_leads_form",
        },
        bookings: 8,
        total_deposit_amount: 31000,
      },
      {
        _id: {
          source_company: "tbm_prime_leads",
          source_granularity_key: "tbm_prime_leads_call",
        },
        bookings: 4,
        total_deposit_amount: 17000,
      },
    ],
    labels,
    { additiveFields: ["bookings", "total_deposit_amount"] },
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_company_label, "TBM Prime Leads");
  assert.equal(rows[0].bookings, 12);
  assert.equal(rows[0].total_deposit_amount, 48000);
  assert.deepEqual(
    rows[0].granularities.map((row) => [
      row.source_granularity_label,
      row.channel,
    ]),
    [
      ["TBM Prime Forms", "form"],
      ["TBM Prime Inbounds", "call"],
    ],
  );
});

test("source hierarchy retains unknown granularity in parent totals", () => {
  const rows = nestSourceCompanyRows(
    [
      {
        source_company: "tbm_prime_leads",
        source_granularity_key: "unknown",
        lead_count: 3,
        total_lead_cost: 90,
      },
    ],
    labels,
    { additiveFields: ["lead_count", "total_lead_cost"] },
  );

  assert.equal(rows[0].lead_count, 3);
  assert.equal(rows[0].granularities[0].source_granularity_key, "unknown");
  assert.equal(rows[0].granularities[0].source_granularity_label, "Unknown");
});

test("source hierarchy folds normalized company and granularity collisions", () => {
  const derive = (row: Record<string, unknown>) => {
    const bookings = Number(row.bookings ?? 0);
    const cancelledBookings = Number(row.cancelled_bookings ?? 0);
    return {
      ...row,
      cancellation_rate: bookings ? cancelledBookings / bookings : 0,
    };
  };
  const rows = nestSourceCompanyRows(
    [
      {
        source_company: "TBM Prime Leads",
        source_granularity_key: "TBM_PRIME_LEADS_FORM",
        bookings: 3,
        cancelled_bookings: 1,
        cancellation_rate: 1 / 3,
      },
      {
        source_company: "tbm_prime_leads",
        source_granularity_key: "tbm_prime_leads_form",
        bookings: 2,
        cancelled_bookings: 1,
        cancellation_rate: 0.5,
      },
    ],
    labels,
    {
      additiveFields: ["bookings", "cancelled_bookings"],
      derive,
    },
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].granularities.length, 1);
  assert.equal(rows[0].bookings, 5);
  assert.equal(rows[0].cancelled_bookings, 2);
  assert.equal(rows[0].cancellation_rate, 0.4);
  assert.equal(rows[0].granularities[0].bookings, 5);
  assert.equal(rows[0].granularities[0].cancelled_bookings, 2);
  assert.equal(rows[0].granularities[0].cancellation_rate, 0.4);
  assert.equal(rows[0].granularities[0].source_granularity_label, "TBM Prime Forms");
});

test("company-only source rows use domain labels and never create children", () => {
  const rows = companyOnlySourceRows([
    { _id: "tbm_prime_leads", bookings: 2, total_deposit_amount: 5000 },
  ]);

  assert.equal(rows[0].source_company_label, "TBM Prime Leads");
  assert.deepEqual(rows[0].granularities, []);
});
