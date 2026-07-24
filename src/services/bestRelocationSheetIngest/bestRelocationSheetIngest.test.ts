import assert from "node:assert/strict";
import test from "node:test";
import {
  applyIngestPlan,
  buildIngestPlan,
  collapseBookingsByJob,
  makeTab,
  normalizeMoveSize,
  normalizeZip,
  parseBookedDealRows,
  parseCallRows,
  parseFormRows,
  parseRefundRows,
  type IngestPlan,
} from ".";

test("normalizes observed sheet move sizes into the model enum", () => {
  assert.equal(normalizeMoveSize("1 bedroom"), "1 Bedroom");
  assert.equal(normalizeMoveSize("5+ bedrooms"), "5+ Bedrooms");
  assert.equal(normalizeMoveSize("STUDIO"), "Studio");
  assert.equal(normalizeMoveSize("commercial office"), "Office");
  assert.throws(() => normalizeMoveSize("castle"));
});

test("restores leading zeroes dropped from formatted ZIP cells", () => {
  assert.equal(normalizeZip("7104"), "07104");
  assert.equal(normalizeZip("725"), "00725");
  assert.equal(normalizeZip("33101"), "33101");
  assert.throws(() => normalizeZip("unknown"));
});

test("parsers preserve source-row provenance and skip formula sentinels", () => {
  const headers = [
    "Time Stamp",
    "Name",
    "Pickup Zip",
    "Destination Zip",
    "Move Size",
    "Move Date",
    "Phone",
    "Lead ID",
    "Ref No",
  ];
  const parsed = parseFormRows(
    makeTab("Forms", headers, [
      headers,
      ["FORMULAS"],
      [
        "2026-01-02 10:00:00",
        "Jane Doe",
        "33101",
        "10001",
        "2 bedrooms",
        "2026-02-01",
        "305-555-1212",
        "11111111-1111-4111-8111-111111111111",
        "11111111-1111-4111-8111-111111111111",
      ],
    ]),
    "Forms",
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].sheet_row, 3);
  assert.equal(parsed[0].provenance.source_row_key, "test-workbook:Forms:3");
});

test("duplicate booking jobs collapse into split allocations without doubling deposit", () => {
  const headers = [
    "Timestamp",
    "Agent",
    "Book Date",
    "Job Number:",
    "Customer Name",
    "Binder Amount",
    "Deposit Amount",
    "Merchant",
    "Lead Source",
    "LID",
    "Payment Notes",
  ];
  const rows = parseBookedDealRows(
    makeTab("Booked Deals", headers, [
      headers,
      [
        "1/2/2026 10:00:00",
        "Jacob",
        "1/2/2026",
        "P123",
        "Jane Doe",
        "$350",
        "$500",
        "Elavon CC",
        "Best Relocation Forms",
        "11111111-1111-4111-8111-111111111111",
      ],
      [
        "1/2/2026 10:00:00",
        "Patrick",
        "1/2/2026",
        "P123",
        "Jane Doe",
        "$350",
        "$500",
        "Elavon CC",
        "Best Relocation Forms",
        "11111111-1111-4111-8111-111111111111",
      ],
    ]),
  );
  const [collapsed] = collapseBookingsByJob(rows);
  assert.deepEqual(collapsed.agents, ["Jacob", "Patrick"]);
  assert.equal(collapsed.total_binder_amount, 700);
  assert.equal(collapsed.deposit_amount, 500);
});

test("plan orders leads, attached booking, and cancellation with response bindings", () => {
  const formHeaders = [
    "Time Stamp",
    "Name",
    "Pickup Zip",
    "Destination Zip",
    "Move Size",
    "Move Date",
    "Phone",
    "Lead ID",
    "Ref No",
    "Booked",
    ">2K",
    ">4K",
    "Bad Lead Checker",
  ];
  const bookingHeaders = [
    "Timestamp",
    "Agent",
    "Book Date",
    "Job Number:",
    "Customer Name",
    "Binder Amount",
    "Deposit Amount",
    "Merchant",
    "Lead Source",
    "LID",
    "Payment Notes",
  ];
  const refundHeaders = [
    "Refund Request Date",
    "Status",
    "Timestamp",
    "Agent",
    "Book Date",
    "Job Number:",
    "Customer Name",
    "Binder Amount",
    "Deposit Amount",
    "Merchant",
    "Lead Source",
  ];
  const lid = "11111111-1111-4111-8111-111111111111";
  const forms = parseFormRows(
    makeTab("Forms", formHeaders, [
      formHeaders,
      [
        "1/1/2026 10:00:00",
        "Jane Doe",
        "33101",
        "10001",
        "2 bedrooms",
        "2/1/2026",
        "3055551212",
        lid,
        lid,
      ],
    ]),
    "Forms",
  );
  const booked = parseBookedDealRows(
    makeTab("Booked Deals", bookingHeaders, [
      bookingHeaders,
      [
        "1/2/2026 10:00:00",
        "Jacob",
        "1/2/2026",
        "P123",
        "Jane Doe",
        "$700",
        "$900",
        "Elavon CC",
        "Best Relocation Forms",
        lid,
      ],
    ]),
  );
  const refunds = parseRefundRows(
    makeTab("Refunds", refundHeaders, [
      refundHeaders,
      [
        "1/5/2026",
        "refunded",
        "1/2/2026 10:00:00",
        "Jacob",
        "1/2/2026",
        "P123",
        "Jane Doe",
        "$700",
        "$900",
        "Elavon CC",
        "Best Relocation Forms",
      ],
    ]),
  );
  const calls = parseCallRows(
    makeTab("Calls", ["PHONE NUMBER", "Date", "Time"], [
      ["PHONE NUMBER", "Date", "Time"],
    ]),
  );
  const plan = buildIngestPlan({
    leadsWorkbook: { id: "lead", title: "Leads" },
    bookedWorkbook: { id: "booked", title: "Booked" },
    forms,
    localForms: [],
    calls,
    booked,
    refunds,
    lidBestRelo: [],
  });
  assert.deepEqual(
    plan.mutations.map((mutation) => mutation.action),
    ["create_form_lead", "create_booked_from_source", "create_cancelled_lead"],
  );
  assert.equal(plan.mutations[1].match_method, "lid_exact");
  assert.ok(plan.mutations[1].api.bindings?.form_lead_id);
  assert.equal(plan.mutations[1].api.body.merchant, "Elavon");
  assert.equal(plan.mutations[1].api.body.ingestion_source, "best_relocation_sheet");
  assert.ok(plan.mutations[2].api.bindings?.booked_lead);
});

test("live apply refuses to send the secret to an unpinned host", async () => {
  const plan = minimalPlan("https://attacker.example");
  let called = false;
  await assert.rejects(
    () =>
      applyIngestPlan(plan, {
        apiSecret: "secret",
        confirmProductionApply: true,
        fetchImpl: async () => {
          called = true;
          return new Response();
        },
      }),
    /pinned/,
  );
  assert.equal(called, false);
});

test("booking preflight uses filtered admin lookup and skips an existing job", async () => {
  const plan = minimalPlan("https://vantage-movers-main-server.vercel.app");
  plan.mutations = [
    {
      action: "create_leadless_booking",
      idempotency_key: "booking:best_relocation_leads:P123",
      api: {
        method: "POST",
        path: "/api/v1/leadless-bookings",
        body: { job_no: "P123" },
      },
      sheet: { rows: [] },
    },
  ];
  const urls: string[] = [];
  const results = await applyIngestPlan(plan, {
    apiSecret: "secret",
    confirmProductionApply: true,
    fetchImpl: async (input, init) => {
      urls.push(String(input));
      assert.notEqual(init?.method, "POST");
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                _id: "507f1f77bcf86cd799439011",
                job_no: "P123",
                normalized_job_no: "P123",
              },
            ],
          },
        }),
        { status: 200 },
      );
    },
  });
  assert.match(urls[0], /admin\/booked-leads/);
  assert.match(urls[0], /job_no=P123/);
  assert.equal(results[0].status, "existing");
});

test("call preflight recognizes the route's bare-array response", async () => {
  const plan = minimalPlan("https://vantage-movers-main-server.vercel.app");
  plan.mutations = [
    {
      action: "create_call_lead",
      idempotency_key: "call:best_relocation_leads:3055551212:2026-01-01:10:00",
      api: {
        method: "POST",
        path: "/api/v1/call-leads",
        body: {
          phone_number: "3055551212",
          timestamp: "2026-01-01T15:00:00.000Z",
        },
      },
      sheet: {
        workbook_id: "lead",
        workbook_title: "Lead",
        tab: "Calls",
        sheet_row: 2,
        source_row_key: "lead:Calls:2",
        raw: {},
      },
    },
  ];
  let calls = 0;
  const results = await applyIngestPlan(plan, {
    apiSecret: "secret",
    confirmProductionApply: true,
    fetchImpl: async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          ok: true,
          data: [
            {
              _id: "507f1f77bcf86cd799439011",
              phone_number: "305-555-1212",
              timestamp: "2026-01-01T15:00:00.000Z",
            },
          ],
        }),
        { status: 200 },
      );
    },
  });
  assert.equal(calls, 1);
  assert.equal(results[0].status, "existing");
});

function minimalPlan(baseUrl: string): IngestPlan {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    mode: "dry-run",
    base_url: baseUrl,
    threshold: 0.5,
    source_company: "best_relocation_leads",
    workbooks: {
      leads: { id: "lead", title: "Lead" },
      booked: { id: "booked", title: "Booked" },
    },
    summary: {
      forms: 0,
      local_forms: 0,
      calls: 0,
      booking_rows: 0,
      booking_jobs: 0,
      collapsed_booking_rows: 0,
      accepted_booking_matches: 0,
      leadless_bookings: 0,
      refunds: 0,
      matched_refunds: 0,
      unmatched_refunds: 0,
      mutations: {
        create_form_lead: 0,
        create_call_lead: 0,
        create_booked_from_source: 0,
        create_leadless_booking: 0,
        create_cancelled_lead: 0,
      },
    },
    unmatched_booking_jobs: [],
    warnings: [],
    mutations: [],
  };
}
