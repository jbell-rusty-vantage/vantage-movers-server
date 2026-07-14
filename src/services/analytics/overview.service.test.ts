import assert from "node:assert/strict";
import { test } from "node:test";
import { overviewQuerySchema } from "../../validation/v1/analytics.validation";
import { mergeOverviewAllTime, rollingLast7DaysWindow } from "./overview.service";

test("overviewQuerySchema accepts database_scope", () => {
  assert.equal(overviewQuerySchema.parse({ database_scope: "historical" }).database_scope, "historical");
  assert.equal(overviewQuerySchema.parse({}).database_scope, "production");
});

test("rollingLast7DaysWindow spans seven days ending now", () => {
  const before = Date.now();
  const { from, to } = rollingLast7DaysWindow();
  const after = Date.now();

  assert.ok(to.getTime() >= before && to.getTime() <= after);
  assert.equal(from.getHours(), 0);
  assert.equal(from.getMinutes(), 0);
  assert.equal(from.getSeconds(), 0);
  assert.ok(to.getTime() - from.getTime() >= 6 * 24 * 60 * 60 * 1000);
  assert.ok(to.getTime() - from.getTime() <= 8 * 24 * 60 * 60 * 1000);
});

test("mergeOverviewAllTime merges combined totals and clears production-only lead cost", () => {
  const merged = mergeOverviewAllTime(
    [
      {
        totals: {
          bookings: 2,
          total_leads: 10,
          total_deposit_amount: 3000,
          total_binder_amount: 600,
          cancelled_bookings: 1,
        },
        lead_cost: { total: 190, by_source_company: [{ source_company: "tbm_leads", lead_count: 1, total_lead_cost: 190 }] },
        top_agents: [
          { agent_name: "Alex", bookings: 2, total_deposit_amount: 3000, total_binder_amount: 600 },
        ],
      },
      {
        totals: {
          bookings: 3,
          total_leads: 20,
          total_deposit_amount: 4500,
          total_binder_amount: 900,
          cancelled_bookings: 0,
        },
        lead_cost: null,
        top_agents: [
          { agent_name: "Alex", bookings: 1, total_deposit_amount: 1500, total_binder_amount: 300 },
          { agent_name: "Jordan", bookings: 2, total_deposit_amount: 3000, total_binder_amount: 600 },
        ],
      },
    ],
    "combined",
  );

  assert.equal(merged.totals.bookings, 5);
  assert.equal(merged.totals.total_leads, 30);
  assert.equal(merged.totals.total_deposit_amount, 7500);
  assert.equal(merged.lead_cost, null);
  assert.equal(merged.top_agents.length, 2);
  assert.equal(merged.top_agents[0].agent_name, "Alex");
  assert.equal(merged.top_agents[0].total_deposit_amount, 4500);
});

test("mergeOverviewAllTime keeps lead cost for production scope", () => {
  const lead_cost = {
    total: 380,
    by_source_company: [{ source_company: "tbm_leads", lead_count: 2, total_lead_cost: 380 }],
  };
  const merged = mergeOverviewAllTime(
    [
      {
        totals: { bookings: 1, total_leads: 4, total_deposit_amount: 1200, total_binder_amount: 240, cancelled_bookings: 0 },
        lead_cost,
        top_agents: [],
      },
    ],
    "production",
  );

  assert.deepEqual(merged.lead_cost, lead_cost);
});

test("mergeOverviewAllTime clears lead cost for historical scope", () => {
  const merged = mergeOverviewAllTime(
    [
      {
        totals: { bookings: 1, total_leads: 4, total_deposit_amount: 1200, total_binder_amount: 240, cancelled_bookings: 0 },
        lead_cost: null,
        top_agents: [],
      },
    ],
    "historical",
  );

  assert.equal(merged.lead_cost, null);
});
