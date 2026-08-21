import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { CplRate } from "../../models/CplRate";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import {
  invalidateCplRateCache,
  listCplRates,
} from "./cplRate.service";

type MutableModel = Record<string, unknown>;

const originalCplRateFind = CplRate.find as unknown;
const originalCplRateUpdateOne = CplRate.updateOne as unknown;
const leadSourceCompanyModel = getLeadSourceCompanyModel();
const originalLeadSourceCompanyFind = leadSourceCompanyModel.find as unknown;
const originalLeadSourceCompanyUpdateOne = leadSourceCompanyModel.updateOne as unknown;

afterEach(() => {
  (CplRate as unknown as MutableModel).find = originalCplRateFind;
  (CplRate as unknown as MutableModel).updateOne = originalCplRateUpdateOne;
  (leadSourceCompanyModel as unknown as MutableModel).find = originalLeadSourceCompanyFind;
  (leadSourceCompanyModel as unknown as MutableModel).updateOne = originalLeadSourceCompanyUpdateOne;
  invalidateCplRateCache();
});

function chain(result: unknown) {
  return {
    sort() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => result,
  };
}

function stubEmptyLeadSourceCompanyCatalog() {
  const seededCompanySlugs = [
    "tbm_leads",
    "tbm_prime_leads",
    "top10_leads",
    "best_relocation_leads",
    "get_movers_leads",
    "main_site",
    "paid_overflow",
  ].map((company_slug) => ({ company_slug }));
  (leadSourceCompanyModel as unknown as MutableModel).find = (_filter?: unknown, projection?: unknown) =>
    chain(projection ? seededCompanySlugs : []);
  (leadSourceCompanyModel as unknown as MutableModel).updateOne = () => {
    throw new Error("lead source company catalog should not be seeded in CPL rate tests");
  };
}

test("listCplRates seeds any missing slots and returns all 14 rates", async () => {
  stubEmptyLeadSourceCompanyCatalog();
  const existingLabels = [
    { label: "TBM Forms" },
    { label: "10best Inbounds" },
    { label: "TBM Prime Forms" },
    { label: "TBM Prime Inbounds" },
    { label: "Top10 Forms" },
    { label: "Top10 Inbounds" },
    { label: "Best Relocation Forms" },
    { label: "Best Relocation Locals" },
    { label: "Best Relocation Inbounds" },
    { label: "GetMovers Forms" },
    { label: "GetMovers Inbounds" },
    { label: "Main Site Forms" },
    { label: "Paid Overflow" },
    // "Main Site Inbounds" intentionally missing.
  ];

  (CplRate as unknown as MutableModel).find = (filter?: unknown, projection?: unknown) =>
    projection ? chain(existingLabels) : chain(existingLabels.map((entry) => ({ ...entry, cpl: 190 })));

  const seededInserts: Record<string, unknown>[] = [];
  (CplRate as unknown as MutableModel).updateOne = (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    seededInserts.push(update);
    return { exec: async () => ({}) };
  };

  const rates = await listCplRates();

  assert.equal(rates.length, 14);
  assert.equal(seededInserts.length, 1);
  assert.deepEqual(
    (seededInserts[0].$setOnInsert as Record<string, unknown>).label,
    "Main Site Inbounds",
  );
});
