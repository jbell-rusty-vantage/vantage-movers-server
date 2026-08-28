import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { FormLead } from "../../models/FormLead";
import { ConflictError, NotFoundError } from "../errors";
import {
  correctFormLead,
  findFormLeadForEnrichment,
  removeFormLead,
} from "./formLead.service";
import {
  deriveFormLeadIngestionOrigin,
  omitForbiddenLeadLifecycleFields,
} from "./leadIngestionProvenance";

type StubbedFormLeadModel = {
  findById: (id: string) => unknown;
};

const originalFindById = FormLead.findById as unknown;
const originalUseDb = mongoose.connection.useDb;

afterEach(() => {
  (FormLead as unknown as StubbedFormLeadModel).findById =
    originalFindById as StubbedFormLeadModel["findById"];
  mongoose.connection.useDb = originalUseDb;
});

test("findFormLeadForEnrichment does not return a Duplicate Lead", async () => {
  stubFindById({
    _id: "6a19ddd4bf20b878123aac14",
    duplicate: true,
    quoted: false,
    cubic_feet: 100,
  });

  await assert.rejects(
    () => findFormLeadForEnrichment("6a19ddd4bf20b878123aac14"),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundError);
      assert.match(error.message, /not found/i);
      return true;
    },
  );
});

test("findFormLeadForEnrichment is not found when the Form Lead is missing", async () => {
  stubFindById(null);

  await assert.rejects(
    () => findFormLeadForEnrichment("6a19ddd4bf20b878123aac14"),
    (error: unknown) => error instanceof NotFoundError,
  );
});

test("correctFormLead refuses quoted and cubic feet on a Duplicate Lead", async () => {
  const lead = {
    _id: "6a19ddd4bf20b878123aac14",
    duplicate: true,
    source_company: "top10_leads",
    local: "local",
    save: async () => lead,
  };

  stubFindById(lead);

  await assert.rejects(
    () => correctFormLead("6a19ddd4bf20b878123aac14", { quoted: true }),
    (error: unknown) => error instanceof ConflictError,
  );
});

test("correctFormLead refuses Bad Lead on duplicate, Booked, or Cancelled", async () => {
  for (const lead of [
    { duplicate: true, booked: undefined, cancelled: undefined },
    { duplicate: false, booked: "booking-id", cancelled: undefined },
    { duplicate: false, booked: undefined, cancelled: "cancel-id" },
  ]) {
    const document = {
      _id: "6a19ddd4bf20b878123aac14",
      source_company: "top10_leads",
      local: "local",
      save: async () => document,
      ...lead,
    };

    stubFindById(document);

    await assert.rejects(
      () =>
        correctFormLead("6a19ddd4bf20b878123aac14", {
          bad_lead: "auto_only",
        }),
      (error: unknown) => error instanceof ConflictError,
    );
  }
});

test("removeFormLead refuses a Booked Form Lead without cascade", async () => {
  stubFindById({
    _id: "6a19ddd4bf20b878123aac14",
    booked: { toString: () => "booking-id" },
    duplicate: false,
  });

  await assert.rejects(
    () => removeFormLead("6a19ddd4bf20b878123aac14", false),
    (error: unknown) => {
      assert.ok(error instanceof ConflictError);
      assert.match(String(error), /cascade=true/);
      return true;
    },
  );
});

test("[AC-10] WordPress and Admin Form create paths derive exact origins", () => {
  assert.equal(deriveFormLeadIngestionOrigin({}), "wordpress_form");
  assert.equal(
    deriveFormLeadIngestionOrigin({
      commandOrigin: "vantage_admin",
      actorType: "system",
    }),
    "wordpress_form",
  );
  assert.equal(
    deriveFormLeadIngestionOrigin({
      commandOrigin: "vantage_admin",
      actorType: "owner",
    }),
    "vantage_admin",
  );
  assert.equal(
    deriveFormLeadIngestionOrigin({ commandOrigin: "external_sheet_ingestion" }),
    "best_relocation_sheet",
  );
});

test("[AC-10] Form updates cannot carry internal snapshot or origin fields", () => {
  const stripped = omitForbiddenLeadLifecycleFields({
    quoted: true,
    ingestion_origin: "granot_lead_created",
    ingested_move_snapshot: { pickup_zip: "10001" },
  });
  assert.equal(stripped.quoted, true);
  assert.equal("ingestion_origin" in stripped, false);
  assert.equal("ingested_move_snapshot" in stripped, false);
});

function stubFindById(document: Record<string, unknown> | null): void {
  mongoose.connection.useDb = (() => ({
    models: { FormLead },
    model: () => FormLead,
  })) as unknown as typeof mongoose.connection.useDb;
  (FormLead as unknown as StubbedFormLeadModel).findById = () => {
    const query = {
      session: () => query,
      select: () => query,
      exec: async () => document,
      then: (
        resolve: (value: unknown) => void,
        reject?: (reason: unknown) => void,
      ) => Promise.resolve(document).then(resolve, reject),
    };
    return query;
  };
}
