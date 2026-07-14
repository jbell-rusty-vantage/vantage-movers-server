import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { CplRate } from "../../models/CplRate";
import { invalidateCplRateCache } from "../../services/cpl/cplRate.service";
import { getCplForSource } from "./cpl";

/**
 * `getCplForSource` is now DB-backed via the `cpl_rates` collection (see
 * `../../services/cpl/cplRate.service.ts`), so these tests mock `CplRate`
 * the way `catalog.service.test.ts` mocks `Agent`/`Merchant` rather than
 * asserting against env-var-derived defaults.
 */

type MutableModel = Record<string, unknown>;

const originalFind = CplRate.find as unknown;

afterEach(() => {
  (CplRate as unknown as MutableModel).find = originalFind;
  invalidateCplRateCache();
});

const SEEDED_RATES = [
  { label: "TBM Forms", cpl: 190 },
  { label: "10best Inbounds", cpl: 190 },
  { label: "TBM Prime Forms", cpl: 190 },
  { label: "TBM Prime Inbounds", cpl: 190 },
  { label: "Top10 Forms", cpl: 190 },
  { label: "Top10 Inbounds", cpl: 190 },
  { label: "Best Relocation Forms", cpl: 195 },
  { label: "Best Relocation Locals", cpl: 40 },
  { label: "Best Relocation Inbounds", cpl: 195 },
  { label: "GetMovers Forms", cpl: 0 },
  { label: "GetMovers Inbounds", cpl: 0 },
  { label: "Main Site Forms", cpl: 0 },
  { label: "Main Site Inbounds", cpl: 0 },
];

function mockFullySeeded(rates: Array<{ label: string; cpl: number }> = SEEDED_RATES) {
  (CplRate as unknown as MutableModel).find = () => chain(rates);
}

function chain(result: unknown) {
  return {
    lean() {
      return this;
    },
    exec: async () => result,
  };
}

test("simple-rate sources return their configured CPL for both form and call leads", async () => {
  mockFullySeeded();

  assert.equal(await getCplForSource("tbm_leads", "form", undefined), 190);
  assert.equal(await getCplForSource("tbm_leads", "call", undefined), 190);
  assert.equal(await getCplForSource("get_movers_leads", "form", "long_distance"), 0);
  assert.equal(await getCplForSource("main_site", "call", undefined), 0);
});

test("best_relocation_leads splits form CPL by local vs long_distance but not call CPL", async () => {
  mockFullySeeded();

  assert.equal(await getCplForSource("best_relocation_leads", "form", "local"), 40);
  assert.equal(await getCplForSource("best_relocation_leads", "form", "long_distance"), 195);
  // undefined local falls back to long_distance for forms.
  assert.equal(await getCplForSource("best_relocation_leads", "form", undefined), 195);
  // Call leads never split by local.
  assert.equal(await getCplForSource("best_relocation_leads", "call", "local"), 195);
  assert.equal(await getCplForSource("best_relocation_leads", "call", undefined), 195);
});

test("not_provided always reports CPL 0 without querying CplRate", async () => {
  (CplRate as unknown as MutableModel).find = () => {
    throw new Error("CplRate.find should not be called for not_provided");
  };

  assert.equal(await getCplForSource("not_provided", "form", undefined), 0);
  assert.equal(await getCplForSource("not_provided", "call", "local"), 0);
  assert.equal(await getCplForSource(undefined, "form", "long_distance"), 0);
});

test("legacy source labels are normalized before CPL lookup", async () => {
  mockFullySeeded();

  assert.equal(await getCplForSource("10best Inbounds", "call", "long_distance"), 190);
  assert.equal(await getCplForSource("Best Relocation Inbounds", "form", "local"), 40);
  assert.equal(await getCplForSource("Get Movers", "form", "long_distance"), 0);
});

test("falls back to canonical defaults when Mongo is unreachable", async () => {
  (CplRate as unknown as MutableModel).find = () => {
    throw new Error("Mongo unreachable");
  };

  assert.equal(await getCplForSource("tbm_leads", "form", undefined), 190);
  assert.equal(await getCplForSource("best_relocation_leads", "form", "local"), 40);
});
