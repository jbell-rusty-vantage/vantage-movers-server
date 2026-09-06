import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
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
  noSyncOnCreate,
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

test("refuseIllegalCorrections does not mention no_sync", async () => {
  const source = await readFile(path.join(__dirname, "formLead.service.ts"), "utf8");
  const start = source.indexOf("function refuseIllegalCorrections");
  assert.ok(start >= 0, "missing refuseIllegalCorrections");
  const refuse = source.slice(start, source.indexOf("function applyTheAllowedPatch", start));
  assert.doesNotMatch(refuse, /no_sync/);
  assert.match(refuse, /bad_lead/);
  assert.match(refuse, /ConflictError/);
});

test("correctFormLead does not throw ConflictError when marking no_sync on booked, duplicate, or bad", async () => {
  for (const lead of [
    { duplicate: false, booked: "booking-id", cancelled: undefined, bad_lead: undefined },
    { duplicate: true, booked: undefined, cancelled: undefined, bad_lead: undefined },
    { duplicate: false, booked: undefined, cancelled: undefined, bad_lead: "auto_only" },
  ]) {
    const document = {
      _id: "6a19ddd4bf20b878123aac14",
      source_company: "top10_leads",
      local: "local",
      no_sync: false,
      save: async () => document,
      ...lead,
    };
    stubFindById(document);
    try {
      await correctFormLead("6a19ddd4bf20b878123aac14", { no_sync: true });
    } catch (error: unknown) {
      assert.ok(
        !(error instanceof ConflictError),
        `no_sync on ${JSON.stringify(lead)} must not 409: ${String(error)}`,
      );
    }
  }
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

test("Admin Form create omit stores no_sync true and skips form_lead.create outbox", async () => {
  const source = await readFile(path.join(__dirname, "formLead.service.ts"), "utf8");
  const writeStart = source.indexOf("async function writeTheFormLead");
  assert.ok(writeStart >= 0);
  const write = source.slice(writeStart, source.indexOf("async function reportAMissingCplRate", writeStart));
  assert.match(write, /noSyncOnCreate\(tx\.ingestion_origin, prepared\.input\.no_sync\)/);
  assert.match(write, /if \(created\.no_sync !== true\)/);
  assert.match(write, /operation:\s*"form_lead\.create"/);
  assert.match(write, /sheetSyncJobs\.push\(formLeadJob\)/);
});

test("Admin Form omit stamps no_sync true; opt-in false and WordPress client true stamp correctly", () => {
  assert.equal(noSyncOnCreate("vantage_admin"), true);
  const omitted = new FormLead({
    name: "Synthetic Admin Form",
    phone_number: "5550100110",
    pickup_zip: "10001",
    destination_zip: "94105",
    no_sync: noSyncOnCreate("vantage_admin"),
  });
  assert.equal(omitted.no_sync, true);

  const optedIn = new FormLead({
    name: "Synthetic Admin Form",
    phone_number: "5550100110",
    pickup_zip: "10001",
    destination_zip: "94105",
    no_sync: noSyncOnCreate("vantage_admin", false),
  });
  assert.equal(optedIn.no_sync, false);

  const wordpress = new FormLead({
    name: "Synthetic WP Form",
    phone_number: "5550100110",
    pickup_zip: "10001",
    destination_zip: "94105",
    no_sync: noSyncOnCreate("wordpress_form", true),
  });
  assert.equal(wordpress.no_sync, false);
});

test("FormLead schema defaults no_sync to false so missing-field documents stay syncable", () => {
  const field = FormLead.schema.path("no_sync") as { defaultValue?: unknown } | undefined;
  assert.ok(field);
  assert.equal(field.defaultValue, false);
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
