import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import {
  SOURCE_LABEL_TO_COMPANY,
  getMongoDatabaseName,
  withRuntimeDomainOverrides,
} from "../../config/domain";
import {
  listLeadSourceCompanies,
  resolveLeadSource,
} from "./leadSourceCompany.service";

const originalUseDb = mongoose.connection.useDb;
const docsByDatabase = new Map<string, Record<string, unknown>[]>();
const EXPECTED_GRANULARITY_BY_LEGACY_LABEL: Record<string, string> = {
  "Main Site Forms": "Main Site Forms",
  "Main Site Inbounds": "Main Site Inbounds",
  "Get Movers": "GetMovers Forms",
  "GetMovers Forms": "GetMovers Forms",
  "Get Movers Forms": "GetMovers Forms",
  "GetMovers Inbounds": "GetMovers Inbounds",
  "Get Movers Inbounds": "GetMovers Inbounds",
  "TBM Forms": "TBM Forms",
  "TBM Prime Forms": "TBM Prime Forms",
  "TBM Forms Prime": "TBM Prime Forms",
  "TBM Prime Inbounds": "TBM Prime Inbounds",
  "Top10 Forms": "Top10 Forms",
  "Top10 Inbounds": "Top10 Inbounds",
  "10 Best Inbounds": "10best Inbounds",
  "10Best Inbounds": "10best Inbounds",
  "10best Inbounds": "10best Inbounds",
  "Best Relocation Forms": "Best Relocation Forms",
  "Best Relocation Locals": "Best Relocation Locals",
  "Best Relocation Inbounds": "Best Relocation Inbounds",
  "BestRelocation Forms": "Best Relocation Forms",
  "BestRelocation Locals": "Best Relocation Locals",
  "BestRelocation Inbounds": "Best Relocation Inbounds",
  "Paid Overflow": "Paid Overflow",
};

(mongoose.connection as unknown as { useDb: typeof originalUseDb }).useDb = ((dbName: string) => ({
  models: { LeadSourceCompany: fakeModel(dbName) },
  model: () => fakeModel(dbName),
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

  const legacyPrimeFormResolution = await resolveLeadSource({
    value: "TBM Forms Prime",
    channel: "form",
  });
  assert.equal(legacyPrimeFormResolution.company.company_slug, "tbm_prime_leads");
  assert.equal(legacyPrimeFormResolution.granularity.crm_label, "TBM Prime Forms");
});

test("all legacy source labels resolve through the lead source catalog", async () => {
  await listLeadSourceCompanies({ includeInactive: true });

  for (const [label, expectedCompany] of Object.entries(SOURCE_LABEL_TO_COMPANY)) {
    const resolution = await resolveLeadSource({
      value: label,
      channel: label.includes("Inbound") ? "call" : "form",
    });
    assert.equal(
      resolution.company.company_slug,
      expectedCompany,
      `${label} should resolve to ${expectedCompany}`,
    );
    assert.equal(
      resolution.granularity.crm_label,
      EXPECTED_GRANULARITY_BY_LEGACY_LABEL[label],
      `${label} should resolve to the expected granularity`,
    );
  }
});

test("lead source catalog seeds production and test databases independently", async () => {
  const productionDb = getMongoDatabaseName();
  await listLeadSourceCompanies({ includeInactive: true });
  const productionDocs = docsForDatabase(productionDb);
  assert.ok(
    productionDocs.some((doc) => doc.company_slug === "top10_leads"),
    "production catalog should already be seeded",
  );

  await withRuntimeDomainOverrides({ testMode: true }, async () => {
    const companies = await listLeadSourceCompanies({ includeInactive: true });
    assert.ok(
      companies.some((company) => company.company_slug === "top10_leads"),
      "test catalog should seed even after production seeded in this process",
    );

    const resolution = await resolveLeadSource({
      value: "Top10 Forms",
      channel: "form",
    });
    assert.equal(resolution.company.company_slug, "top10_leads");
    assert.equal(resolution.granularity.crm_label, "Top10 Forms");
  });
});

function fakeModel(dbName: string) {
  const docs = docsForDatabase(dbName);
  return {
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
}

function docsForDatabase(dbName: string): Record<string, unknown>[] {
  let docs = docsByDatabase.get(dbName);
  if (!docs) {
    docs = [];
    docsByDatabase.set(dbName, docs);
  }
  return docs;
}

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
