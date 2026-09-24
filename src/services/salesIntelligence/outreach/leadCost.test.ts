import assert from "node:assert/strict";
import { test } from "node:test";
import { outreachDetailAdditions, type OutreachSideData } from "./reads.js";
import { outreachDetailDtoSchema } from "./detailDto.js";

// Addendum §4.3 (E10, E20): the detail's `lead_cost` uses the Overview spend basis.
test("lead_cost on the Outreach detail: rate, legacy, unpriced, zero, and null without a Lead", () => {
  const leadId = "6ab500000000000000000001";
  const side = (lead: Record<string, unknown> | null) => ({ bookings: new Map(), cancellations: new Map(),
    leads: new Map(lead ? [[`FormLead:${leadId}`, { _id: leadId, ...lead }]] : []) }) as unknown as OutreachSideData;
  const record = { subject: { kind: "lead", model: "FormLead", id: leadId } } as never;
  const cost = (lead: Record<string, unknown> | null) => outreachDetailAdditions(record, side(lead), null, null).lead_cost;
  assert.deepEqual(cost({ cpl: 40, cpl_rate_period: "p1", cpl_resolution_status: "resolved" }), { amount: 40, basis: "rate" });
  assert.deepEqual(cost({ cpl: 35, cpl_rate_period: null, cpl_resolution_status: null }), { amount: 35, basis: "legacy" });
  assert.deepEqual(cost({ cpl: 0, cpl_resolution_status: "missing_rate" }), { amount: 0, basis: "unpriced" });
  assert.deepEqual(cost({ cpl: 0, cpl_resolution_status: "duplicate_zero" }), { amount: 0, basis: "zero" });
  assert.equal(cost(null), null, "a Number-only record or a missing Lead: null, never $0");
  assert.equal(outreachDetailDtoSchema.shape.lead_cost.safeParse({ amount: 40, basis: "rate" }).success, true);
});
