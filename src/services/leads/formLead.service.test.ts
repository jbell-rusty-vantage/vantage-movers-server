import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, before, mock, test } from "node:test";
import mongoose from "mongoose";
import { logger } from "../../logger";
import { BookedLead } from "../../models/BookedLead";
import { FormLead } from "../../models/FormLead";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import {
  clearCapturedDailyOperationsFacts,
  getCapturedDailyOperationsFacts,
} from "../dailyOperations/testDailyOperationsSink";
import { ConflictError } from "../errors";
import {
  beginFormLeadRemoval,
  completeFormLeadIngestion,
  correctFormLead,
  type FormLeadIngestionInProgress,
} from "./formLead.service";

type StubbedFormLeadModel = {
  findById: (id: string) => unknown;
  findOne: (query: unknown) => unknown;
  find: () => unknown;
};

const LEAD_ID = "6a19ddd4bf20b878123aac14";
const originalFindById = FormLead.findById as unknown;
const originalFindOne = FormLead.findOne as unknown;
const originalFind = FormLead.find as unknown;
const originalUseDb = mongoose.connection.useDb;
const originalBookedFindById = BookedLead.findById;
const originalSheetSyncUpdateMany = SheetSyncJob.updateMany;
const originalSheetSyncFindOneAndUpdate = SheetSyncJob.findOneAndUpdate;
const originalSheetSyncMode = process.env.SHEET_SYNC_MODE;
const loggedKeys: string[] = [];

before(() => {
  for (const level of ["info", "warn", "error"] as const) {
    mock.method(logger, level, (entry: unknown) => {
      const key = (entry as { msg?: unknown } | null)?.msg;
      if (typeof key === "string") loggedKeys.push(key);
    });
  }
});

afterEach(() => {
  (FormLead as unknown as StubbedFormLeadModel).findById =
    originalFindById as StubbedFormLeadModel["findById"];
  (FormLead as unknown as StubbedFormLeadModel).findOne =
    originalFindOne as StubbedFormLeadModel["findOne"];
  (FormLead as unknown as StubbedFormLeadModel).find =
    originalFind as StubbedFormLeadModel["find"];
  mongoose.connection.useDb = originalUseDb;
  BookedLead.findById = originalBookedFindById;
  SheetSyncJob.updateMany = originalSheetSyncUpdateMany;
  SheetSyncJob.findOneAndUpdate = originalSheetSyncFindOneAndUpdate;
  if (originalSheetSyncMode === undefined) delete process.env.SHEET_SYNC_MODE;
  else process.env.SHEET_SYNC_MODE = originalSheetSyncMode;
  loggedKeys.length = 0;
  clearCapturedDailyOperationsFacts();
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

test("correctFormLead marks no_sync on booked, duplicate, or bad without a conflict", async () => {
  process.env.SHEET_SYNC_MODE = "disabled";
  for (const lead of [
    { duplicate: false, booked: { toString: () => "booking-id" }, bad_lead: undefined },
    { duplicate: true, booked: undefined, bad_lead: undefined },
    { duplicate: false, booked: undefined, bad_lead: "auto_only" },
  ]) {
    const { document, saveCount } = liveFormLead({ no_sync: false, ...lead });
    stubFindById(document);
    stubMissingBooking();

    const returned = await correctFormLead(LEAD_ID, { no_sync: true }, commandTransaction());

    assert.equal(returned, document);
    assert.equal(document.no_sync, true);
    assert.equal(saveCount(), 1);
  }
});

test("correctFormLead turns a missed preview and a version clash into a reload conflict", async () => {
  stubFindOne(null);

  await assert.rejects(
    () => correctFormLead(LEAD_ID, { quoted: true }, { expected: { quoted: false } }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictError);
      assert.equal(error.metadata?.reason, "preview_drift");
      return true;
    },
  );

  const { document } = liveFormLead({ quoted: false });
  document.save = async () => {
    throw versionClash();
  };
  stubFindById(document);

  await assert.rejects(
    () => correctFormLead(LEAD_ID, { quoted: true }, commandTransaction()),
    (error: unknown) => {
      assert.ok(error instanceof ConflictError);
      assert.equal(error.metadata?.reason, "preview_drift");
      return true;
    },
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

test("beginFormLeadRemoval refuses a Booked Form Lead without cascade", async () => {
  stubFindById({
    _id: LEAD_ID,
    booked: { toString: () => "booking-id" },
    duplicate: false,
  });

  await assert.rejects(
    () => beginFormLeadRemoval(LEAD_ID, false, { now: new Date() }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictError);
      assert.match(String(error), /cascade=true/);
      return true;
    },
  );
});

test("beginFormLeadRemoval tombstones queued Sheet Sync with the Duplicate Lead flag", async () => {
  process.env.SHEET_SYNC_MODE = "queued";
  let tombstone: { duplicate?: boolean; mongo_id?: string } | undefined;
  let erased = false;
  SheetSyncJob.updateMany = (async () => ({ modifiedCount: 0 })) as unknown as typeof SheetSyncJob.updateMany;
  SheetSyncJob.findOneAndUpdate = (async (
    _filter: unknown,
    update: { $set?: { tombstone?: { duplicate?: boolean; mongo_id?: string } } },
  ) => {
    tombstone = update.$set?.tombstone;
    return { _id: { toString: () => "job-1" } };
  }) as typeof SheetSyncJob.findOneAndUpdate;
  stubFindById({
    _id: { toString: () => LEAD_ID },
    duplicate: true,
    source_company: "tbm_leads",
    sheet_sync: [],
    domain_revision: 2,
    toObject: () => ({ duplicate: true }),
    deleteOne: async () => {
      erased = true;
    },
  });

  const removed = await beginFormLeadRemoval(LEAD_ID, false, { now: new Date() });

  assert.equal(erased, true);
  assert.equal(tombstone?.duplicate, true);
  assert.equal(tombstone?.mongo_id, LEAD_ID);
  assert.equal(removed.mutations.some((mutation) => mutation.deleted === true), true);
  assert.equal(typeof removed.finalize, "function");
});

test("completeFormLeadIngestion skips CRM and Form Fill owner events for a Duplicate Lead", async () => {
  process.env.SHEET_SYNC_MODE = "disabled";
  const pending = pendingIngestion({
    duplicate: true,
    cplStatus: "resolved",
    jobs: [formLeadCreateJob()],
  });

  const result = await completeFormLeadIngestion(pending);

  assert.equal(result.crm_sync_status, "skipped");
  assert.equal(loggedKeys.includes("lead.form.duplicate_detected"), true);
  assert.equal(loggedKeys.includes("lead.form.call_leads_marked_form_fill"), false);
  assert.equal(loggedKeys.includes("crm.form_lead.submit.skipped"), true);
  assert.deepEqual(capturedFactKinds(), ["form_lead.duplicate"]);
});

test("completeFormLeadIngestion returns a reused WordPress lead without telling the company again", async () => {
  const pending = pendingIngestion({
    duplicate: false,
    cplStatus: "resolved",
    jobs: [formLeadCreateJob()],
  });
  pending.reusedExistingLead = true;

  const result = await completeFormLeadIngestion(pending);

  assert.equal(result.sheet_sync_status, "skipped");
  assert.equal(result.crm_sync_status, "skipped");
  assert.equal(result.messaging_status, "skipped");
  assert.deepEqual(loggedKeys, []);
  assert.deepEqual(capturedFactKinds(), []);
});

function stubFindById(document: Record<string, unknown> | null): void {
  installFormLeadModel();
  (FormLead as unknown as StubbedFormLeadModel).findById = () => thenable(document);
}

function stubFindOne(document: Record<string, unknown> | null): void {
  installFormLeadModel();
  (FormLead as unknown as StubbedFormLeadModel).findOne = () => thenable(document);
}


function stubMissingBooking(): void {
  BookedLead.findById = (() => thenable(null)) as unknown as typeof BookedLead.findById;
}

function installFormLeadModel(): void {
  mongoose.connection.useDb = (() => ({
    models: { FormLead },
    model: () => FormLead,
  })) as unknown as typeof mongoose.connection.useDb;
}

function thenable<T>(value: T) {
  const query = {
    session: () => query,
    select: () => query,
    sort: () => query,
    limit: () => query,
    exec: async () => value,
    then: (
      resolve: (resolved: T) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(value).then(resolve, reject),
  };
  return query;
}

function commandTransaction() {
  return { transaction: { now: new Date() } };
}

function versionClash(): Error {
  const error = new Error("No matching document found for version");
  Object.setPrototypeOf(error, mongoose.Error.VersionError.prototype);
  return error;
}

function liveFormLead(overrides: Record<string, unknown>) {
  let saves = 0;
  const document = {
    _id: LEAD_ID,
    name: "Ada Lovelace",
    source_company: "tbm_leads",
    local: "local",
    lead_source_company: "company-id",
    no_sync: false,
    duplicate: false,
    quoted: false,
    cubic_feet: undefined as unknown,
    bad_lead: undefined as unknown,
    booked: undefined as unknown,
    cancelled: undefined as unknown,
    ...overrides,
    async save() {
      saves += 1;
      return document;
    },
    toObject(): Record<string, unknown> {
      return {
        name: document.name,
        source_company: document.source_company,
        no_sync: document.no_sync,
        duplicate: document.duplicate,
        quoted: document.quoted,
        cubic_feet: document.cubic_feet,
        bad_lead: document.bad_lead,
        booked: document.booked,
        cancelled: document.cancelled,
      };
    },
  };
  return { document, saveCount: () => saves };
}

function formLeadCreateJob(): FormLeadIngestionInProgress["jobs"][number] {
  return {
    resource: "source_lead",
    operation: "form_lead.create",
    leadModel: "FormLead",
    leadId: LEAD_ID,
  };
}

function pendingIngestion(input: {
  duplicate: boolean;
  cplStatus: "resolved" | "missing_rate";
  jobs: FormLeadIngestionInProgress["jobs"];
}): FormLeadIngestionInProgress {
  const lead = {
    _id: { toString: () => LEAD_ID },
    name: "Ada Lovelace",
    phone_number: "5550100110",
    email: "ada@example.com",
    pickup_zip: "10001",
    destination_zip: "94105",
    pickup_state: "NY",
    delivery_state: "CA",
    local: "long_distance",
    move_size: "Studio",
    move_date: new Date("2026-09-01T00:00:00.000Z"),
    lid: "LID1",
    ref_no: "DT_ref",
    timestamp: new Date("2026-08-17T16:20:00.000Z"),
    ingestion_origin: "wordpress_form",
    source_company: "tbm_leads",
    cpl: input.cplStatus === "missing_rate" ? 0 : 40,
    cpl_resolution_status: input.cplStatus,
    duplicate: input.duplicate,
  };
  return {
    lead: lead as FormLeadIngestionInProgress["lead"],
    jobs: input.jobs,
    leadMessage: null,
    shouldPostToGranot: false,
    crmLabel: "TBM Forms",
    source_company: "tbm_leads",
    sourceAssignment: {
      source_company: "tbm_leads",
      source_granularity_id: "507f1f77bcf86cd799439012",
      source_granularity_key: "tbm_forms",
    } as unknown as FormLeadIngestionInProgress["sourceAssignment"],
    duplicate: input.duplicate,
    duplicateMatch: {
      duplicate: input.duplicate,
      matchedBy: input.duplicate ? "email" : null,
      matchedLeadIds: input.duplicate ? ["507f1f77bcf86cd799439013"] : [],
    },
    crm_company_label: undefined,
    sms_consent: undefined,
  };
}

function capturedFactKinds(): string[] {
  return getCapturedDailyOperationsFacts().map((fact) => fact.input.kind);
}
