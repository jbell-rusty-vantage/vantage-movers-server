import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { CplRate } from "../../models/CplRate";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { invalidateCplRateCache } from "../../services/cpl/cplRate.service";
import { getCplForSource } from "./cpl";
import { CPL_RATE_DEFINITIONS } from "./cplRateDefinitions";

beforeEach(() => {
  mock.method(getLeadSourceCompanyModel(), "find", () => { throw new Error("catalog unavailable"); });
});

afterEach(() => {
  mock.restoreAll();
  invalidateCplRateCache();
});

test("when the catalog is unavailable, Best Relocation uses the saved Form or Call price", async () => {
  const prices = new Map([
    ["Best Relocation Locals", 27],
    ["Best Relocation Forms", 101],
    ["Best Relocation Inbounds", 149],
  ]);
  const rates = CPL_RATE_DEFINITIONS.map(({ label, defaultCpl }) => ({
    label, cpl: prices.get(label) ?? defaultCpl,
  }));
  mock.method(CplRate, "find", () => ({ lean: () => ({ exec: async () => rates }) }));

  assert.equal(await getCplForSource("best_relocation_leads", "form", "local"), 27);
  assert.equal(await getCplForSource("best_relocation_leads", "form", undefined), 101);
  assert.equal(await getCplForSource("best_relocation_leads", "call", "local"), 149);
});

test("an unknown source is free and avoids the legacy price lookup", async () => {
  const lookup = mock.method(CplRate, "find", () => { throw new Error("unexpected lookup"); });
  assert.equal(await getCplForSource("not_provided", "form", undefined), 0);
  assert.equal(await getCplForSource(undefined, "call", undefined), 0);
  assert.equal(lookup.mock.callCount(), 0);
});

test("when neither price store is available, intake uses the published default price", async () => {
  mock.method(CplRate, "find", () => { throw new Error("legacy prices unavailable"); });
  assert.equal(await getCplForSource("tbm_leads", "form", undefined), 190);
  assert.equal(await getCplForSource("best_relocation_leads", "form", "local"), 40);
});
