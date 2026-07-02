import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { CallLead } from "../../models/CallLead";
import { CplRate } from "../../models/CplRate";
import { FormLead } from "../../models/FormLead";
import {
  invalidateCplRateCache,
  listCplRates,
  updateCplRate,
} from "./cplRate.service";

type MutableModel = Record<string, unknown>;

const originalCplRateFind = CplRate.find as unknown;
const originalCplRateUpdateOne = CplRate.updateOne as unknown;
const originalCplRateFindOneAndUpdate = CplRate.findOneAndUpdate as unknown;
const originalFormLeadUpdateMany = FormLead.updateMany as unknown;
const originalCallLeadUpdateMany = CallLead.updateMany as unknown;

afterEach(() => {
  (CplRate as unknown as MutableModel).find = originalCplRateFind;
  (CplRate as unknown as MutableModel).updateOne = originalCplRateUpdateOne;
  (CplRate as unknown as MutableModel).findOneAndUpdate = originalCplRateFindOneAndUpdate;
  (FormLead as unknown as MutableModel).updateMany = originalFormLeadUpdateMany;
  (CallLead as unknown as MutableModel).updateMany = originalCallLeadUpdateMany;
  invalidateCplRateCache();
});

function chain(result: unknown) {
  return {
    lean() {
      return this;
    },
    exec: async () => result,
  };
}

test("updateCplRate rejects an unknown label without touching the database", async () => {
  (CplRate as unknown as MutableModel).findOneAndUpdate = () => {
    throw new Error("findOneAndUpdate should not be called for an unknown label");
  };

  await assert.rejects(
    () => updateCplRate("Not A Real Label", 100),
    /Unknown CPL rate label: Not A Real Label/,
  );
});

test("updateCplRate backfills only matching-local form leads for Best Relocation Forms", async () => {
  (CplRate as unknown as MutableModel).findOneAndUpdate = () =>
    chain({ cpl: 210, createdAt: undefined, updatedAt: undefined });

  const capturedFilters: Record<string, unknown>[] = [];
  (FormLead as unknown as MutableModel).updateMany = (filter: Record<string, unknown>) => {
    capturedFilters.push(filter);
    return { exec: async () => ({ modifiedCount: 7 }) };
  };

  const result = await updateCplRate("Best Relocation Forms", 210);

  assert.equal(result.leads_updated, 7);
  assert.deepEqual(capturedFilters[0], {
    source_company: "best_relocation_leads",
    duplicate: { $ne: true },
    local: "long_distance",
  });
});

test("updateCplRate backfills call leads without a local filter", async () => {
  (CplRate as unknown as MutableModel).findOneAndUpdate = () =>
    chain({ cpl: 175, createdAt: undefined, updatedAt: undefined });

  const capturedFilters: Record<string, unknown>[] = [];
  (CallLead as unknown as MutableModel).updateMany = (filter: Record<string, unknown>) => {
    capturedFilters.push(filter);
    return { exec: async () => ({ modifiedCount: 3 }) };
  };

  const result = await updateCplRate("Best Relocation Inbounds", 175);

  assert.equal(result.leads_updated, 3);
  assert.deepEqual(capturedFilters[0], {
    source_company: "best_relocation_leads",
    duplicate: { $ne: true },
  });
});

test("updateCplRate excludes duplicate leads from the backfill filter", async () => {
  (CplRate as unknown as MutableModel).findOneAndUpdate = () =>
    chain({ cpl: 200, createdAt: undefined, updatedAt: undefined });

  let capturedFilter: Record<string, unknown> | undefined;
  (FormLead as unknown as MutableModel).updateMany = (filter: Record<string, unknown>) => {
    capturedFilter = filter;
    return { exec: async () => ({ modifiedCount: 0 }) };
  };

  await updateCplRate("TBM Forms", 200);

  assert.equal(capturedFilter?.duplicate && typeof capturedFilter.duplicate === "object", true);
  assert.deepEqual(capturedFilter?.duplicate, { $ne: true });
  // Non-best-relocation form slots never filter by `local`.
  assert.equal("local" in (capturedFilter ?? {}), false);
});

test("listCplRates seeds any missing slots and returns all 13 rates", async () => {
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

  assert.equal(rates.length, 13);
  assert.equal(seededInserts.length, 1);
  assert.deepEqual(
    (seededInserts[0].$setOnInsert as Record<string, unknown>).label,
    "Main Site Inbounds",
  );
});
