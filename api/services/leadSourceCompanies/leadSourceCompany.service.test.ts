import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import {
  listLeadSourceCompanies,
  resolveLeadSource,
} from "./leadSourceCompany.service";

const originalUseDb = mongoose.connection.useDb;
const docs: Record<string, unknown>[] = [];

(mongoose.connection as unknown as { useDb: typeof originalUseDb }).useDb = (() => ({
  models: { LeadSourceCompany: fakeModel },
  model: () => fakeModel,
})) as unknown as typeof originalUseDb;

after(() => {
  mongoose.connection.useDb = originalUseDb;
});

test("lead source catalog seeds legacy companies and resolves granularities", async () => {
  const companies = await listLeadSourceCompanies({ includeInactive: true });
  const slugs = companies.map((company) => company.company_slug);

  assert.ok(slugs.includes("tbm_leads"));
  assert.ok(slugs.includes("best_relocation_leads"));

  const formResolution = await resolveLeadSource({
    value: "Best Relocation",
    channel: "form",
    local: "local",
  });
  assert.equal(formResolution.company.company_slug, "best_relocation_leads");
  assert.equal(formResolution.granularity.crm_label, "Best Relocation Locals");
  assert.equal(formResolution.granularity.cpl, 40);

  const callResolution = await resolveLeadSource({
    inbound_phone_number: "+18883164387",
    channel: "call",
  });
  assert.equal(callResolution.company.company_slug, "tbm_leads");
  assert.equal(callResolution.granularity.crm_label, "10best Inbounds");

  const defaultResolution = await resolveLeadSource({
    value: "not_provided",
    channel: "form",
  });
  assert.equal(defaultResolution.company.company_slug, "main_site");
  assert.equal(defaultResolution.granularity.crm_label, "Main Site Forms");
});

const fakeModel = {
  find(filter: Record<string, unknown> = {}, projection?: Record<string, unknown>) {
    const result = docs
      .filter((doc) => {
        if (filter.active === true && doc.active === false) return false;
        return true;
      })
      .map((doc) => (projection ? project(doc, projection) : doc));
    return findChain(result);
  },
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
    const slug = String(filter.company_slug ?? "");
    const existing = docs.find((doc) => doc.company_slug === slug);
    if (!existing && update.$setOnInsert && typeof update.$setOnInsert === "object") {
      docs.push({
        _id: new mongoose.Types.ObjectId(),
        ...(update.$setOnInsert as Record<string, unknown>),
      });
    }
    return { exec: async () => ({ acknowledged: true }) };
  },
};

function findChain(result: unknown[]) {
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

function project(
  doc: Record<string, unknown>,
  projection: Record<string, unknown>,
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(projection)) {
    if (key in doc) {
      projected[key] = doc[key];
    }
  }
  return projected;
}
