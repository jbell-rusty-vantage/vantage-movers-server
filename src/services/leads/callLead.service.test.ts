import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { SHEET_TAB_NAMES } from "../../config/domain";
import { CallLead } from "../../models/CallLead";
import { ConflictError } from "../errors";
import {
  clearCapturedOperationalEvents,
  getCapturedOperationalEvents,
} from "../observability";
import {
  completeCallLeadIngestion,
  correctCallLead,
  listRecentCallLeads,
  rememberBothCallSheetTabsForTombstone,
  removeCallLead,
  type CallLeadIngestionInProgress,
} from "./callLead.service";
import {
  callLeadCreationProvenanceFields,
  deriveCallLeadIngestionOrigin,
  noSyncOnCreate,
} from "./leadIngestionProvenance";

type StubbedCallLeadModel = {
  findById: (id: string) => unknown;
  find: () => unknown;
};

const originalFindById = CallLead.findById as unknown;
const originalFind = CallLead.find as unknown;
const originalUseDb = mongoose.connection.useDb;
const originalMasterLeadsSheetId = process.env.MASTER_LEADS_SHEET_ID;
const originalTestMasterLeadsSheetId = process.env.TEST_MASTER_LEADS_SHEET_ID;
const originalSheetSyncMode = process.env.SHEET_SYNC_MODE;

afterEach(() => {
  (CallLead as unknown as StubbedCallLeadModel).findById =
    originalFindById as StubbedCallLeadModel["findById"];
  (CallLead as unknown as StubbedCallLeadModel).find =
    originalFind as StubbedCallLeadModel["find"];
  mongoose.connection.useDb = originalUseDb;
  process.env.MASTER_LEADS_SHEET_ID = originalMasterLeadsSheetId;
  process.env.TEST_MASTER_LEADS_SHEET_ID = originalTestMasterLeadsSheetId;
  if (originalSheetSyncMode === undefined) delete process.env.SHEET_SYNC_MODE;
  else process.env.SHEET_SYNC_MODE = originalSheetSyncMode;
  clearCapturedOperationalEvents();
});

test("rememberBothCallSheetTabsForTombstone includes Calls and Duplicate Calls fallbacks", () => {
  process.env.MASTER_LEADS_SHEET_ID = "master-leads-test";
  process.env.TEST_MASTER_LEADS_SHEET_ID = "master-leads-test";

  const targets = rememberBothCallSheetTabsForTombstone({
    source_company: "tbm_leads",
    sheet_sync: [],
  });

  assert.deepEqual(
    targets.map((target) => `${target.target}:${target.tab_name}`),
    [
      `master_calls:${SHEET_TAB_NAMES.calls}`,
      `master_duplicate_calls:${SHEET_TAB_NAMES.duplicateCalls}`,
    ],
  );
});

test("rememberBothCallSheetTabsForTombstone preserves known rows from sheet_sync", () => {
  process.env.MASTER_LEADS_SHEET_ID = "master-leads-test";
  process.env.TEST_MASTER_LEADS_SHEET_ID = "master-leads-test";

  const targets = rememberBothCallSheetTabsForTombstone({
    source_company: "tbm_leads",
    sheet_sync: [
      {
        target: "master_calls",
        spreadsheet_id: "master-leads-test",
        tab_name: SHEET_TAB_NAMES.calls,
        row_number: 42,
        status: "synced",
      },
    ],
  });

  const callsTarget = targets.find((target) => target.target === "master_calls");
  const duplicateCallsTarget = targets.find(
    (target) => target.target === "master_duplicate_calls",
  );

  assert.equal(callsTarget?.row_number, 42);
  assert.equal(duplicateCallsTarget?.row_number, undefined);
});

test("completeCallLeadIngestion records lead.call.created after commit and skips form-fill when false", async () => {
  process.env.SHEET_SYNC_MODE = "disabled";
  const pending = pendingIngestion({ form_fill: false, cplStatus: "resolved" });

  const lead = await completeCallLeadIngestion(pending);

  assert.equal(lead, pending.lead);
  const keys = capturedEventKeys();
  assert.deepEqual(keys, ["lead.call.created"]);
  assert.equal(
    getCapturedOperationalEvents().some((event) =>
      event.input.eventKey.startsWith("crm."),
    ),
    false,
  );
});

test("completeCallLeadIngestion records form-fill only when Form Fill is true", async () => {
  process.env.SHEET_SYNC_MODE = "disabled";
  const pending = pendingIngestion({ form_fill: true, cplStatus: "resolved" });

  await completeCallLeadIngestion(pending);

  assert.deepEqual(capturedEventKeys(), [
    "lead.call.created",
    "lead.call.form_fill_detected",
  ]);
});

test("completeCallLeadIngestion reports missing CPL after the write, not as a CRM post", async () => {
  process.env.SHEET_SYNC_MODE = "disabled";
  const pending = pendingIngestion({
    form_fill: false,
    cplStatus: "missing_rate",
  });

  await completeCallLeadIngestion(pending);

  assert.deepEqual(capturedEventKeys(), [
    "lead.cpl.missing_rate",
    "lead.call.created",
  ]);
});

test("Admin and Best Relocation origins never set Duplicate Lead; public ingest is vantage_admin", () => {
  assert.equal(deriveCallLeadIngestionOrigin({}), "vantage_admin");
  assert.equal(
    deriveCallLeadIngestionOrigin({
      commandOrigin: "external_sheet_ingestion",
    }),
    "best_relocation_sheet",
  );
  const now = new Date("2026-08-17T16:10:00.000Z");
  const admin = callLeadCreationProvenanceFields({
    origin: "vantage_admin",
    now,
    contact: { phone_number: "5550100101" },
  });
  const sheet = callLeadCreationProvenanceFields({
    origin: "best_relocation_sheet",
    now,
    contact: { phone_number: "5550100101" },
  });
  assert.equal(admin.quoted, false);
  assert.equal(admin.ingestion_origin, "vantage_admin");
  assert.equal(sheet.ingestion_origin, "best_relocation_sheet");
  assert.equal("duplicate" in admin, false);
  assert.equal("duplicate" in sheet, false);
});

test("[AC-12] RingCentral Call provenance is ringcentral, quoted false, transport stays nested", () => {
  const now = new Date("2026-08-17T16:10:00.000Z");
  const ringcentral = callLeadCreationProvenanceFields({
    origin: "ringcentral",
    now,
    contact: { phone_number: "5550100101" },
  });
  assert.equal(ringcentral.quoted, false);
  assert.equal(ringcentral.ingestion_origin, "ringcentral");
  assert.equal(
    ringcentral.ingested_contact_snapshot.evidence_status,
    "captured_at_ingestion",
  );
});

test("correctCallLead refuses Duplicate Lead on a Booked Call Lead", async () => {
  stubFindById({
    _id: "6a19ddd4bf20b878123aac14",
    booked: { toString: () => "booking-id" },
    duplicate: false,
    lead_source_company: "source-id",
    toObject: () => ({ booked: "booking-id", duplicate: false }),
  });

  await assert.rejects(
    () =>
      correctCallLead("6a19ddd4bf20b878123aac14", { duplicate: true }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictError);
      assert.match(String(error), /booked call lead as duplicate/i);
      return true;
    },
  );
});

test("correctCallLead maps a missing receiver agent to 404", async () => {
  const source = await readFile(
    path.join(__dirname, "callLead.service.ts"),
    "utf8",
  );
  assert.match(source, /throw new NotFoundError\("Agent not found"/);
  assert.match(source, /isRegistryError/);
});

test("correctCallLead skips Sheet Sync when nothing material changed", async () => {
  const lead = {
    _id: "6a19ddd4bf20b878123aac14",
    name: "Ada",
    booked: undefined,
    duplicate: false,
    lead_source_company: "source-id",
    source_company: "tbm_leads",
    save: async () => {
      throw new Error("should not save when nothing material changed");
    },
    toObject: () => ({ name: "Ada", duplicate: false }),
  };
  stubFindById(lead);

  const returned = await correctCallLead("6a19ddd4bf20b878123aac14", {});
  assert.equal(returned, lead);
});

test("listRecentCallLeads keeps a Duplicate Lead in the last 200", async () => {
  const rows = [
    { _id: "1", duplicate: true, name: "Dup" },
    { _id: "2", duplicate: false, name: "Live" },
  ];
  stubFind(rows);

  const found = await listRecentCallLeads();
  assert.equal(found.length, 2);
  assert.equal(found.some((lead) => lead.duplicate === true), true);
});

test("removeCallLead refuses a Booked Call Lead without cascade", async () => {
  stubFindById({
    _id: "6a19ddd4bf20b878123aac14",
    booked: { toString: () => "booking-id" },
    duplicate: false,
  });

  await assert.rejects(
    () => removeCallLead("6a19ddd4bf20b878123aac14", false),
    (error: unknown) => {
      assert.ok(error instanceof ConflictError);
      assert.match(String(error), /cascade=true/);
      return true;
    },
  );
});

test("refuseToMarkABookedCallAsDuplicate does not mention no_sync", async () => {
  const source = await readFile(path.join(__dirname, "callLead.service.ts"), "utf8");
  const start = source.indexOf("function refuseToMarkABookedCallAsDuplicate");
  assert.ok(start >= 0, "missing refuseToMarkABookedCallAsDuplicate");
  const refuse = source.slice(start, source.indexOf("function applyTheAllowedPatch", start));
  assert.doesNotMatch(refuse, /no_sync/);
  assert.match(refuse, /duplicate/);
  assert.match(refuse, /ConflictError/);
});

test("correctCallLead does not throw ConflictError when marking no_sync on booked or duplicate", async () => {
  for (const lead of [
    { duplicate: false, booked: { toString: () => "booking-id" } },
    { duplicate: true, booked: undefined },
  ]) {
    const document = {
      _id: "6a19ddd4bf20b878123aac14",
      source_company: "top10_leads",
      no_sync: false,
      save: async () => document,
      ...lead,
    };
    stubFindById(document);
    try {
      await correctCallLead("6a19ddd4bf20b878123aac14", { no_sync: true });
    } catch (error: unknown) {
      assert.ok(
        !(error instanceof ConflictError),
        `no_sync on ${JSON.stringify(lead)} must not 409: ${String(error)}`,
      );
    }
  }
});

test("Admin Call create stamps no_sync from origin and skips call_lead.create outbox when true", async () => {
  const source = await readFile(path.join(__dirname, "callLead.service.ts"), "utf8");
  const begin = extractExportedFunction(source, "beginCallLeadIngestion");
  assert.match(begin, /noSyncOnCreate\(tx\.ingestion_origin, input\.no_sync\)/);
  assert.match(begin, /if \(created\.no_sync !== true\)/);
  assert.match(begin, /rememberSheetSync/);
  const rcBegin = extractExportedFunction(source, "beginRingCentralCallLeadIngestion");
  assert.match(rcBegin, /noSyncOnCreate\("ringcentral"\)/);
});

test("Admin Call omit stamps no_sync true; RingCentral client true stamps false", () => {
  const admin = new CallLead({
    phone_number: "5550100101",
    no_sync: noSyncOnCreate("vantage_admin"),
  });
  assert.equal(admin.no_sync, true);

  const ringcentral = new CallLead({
    phone_number: "5550100101",
    no_sync: noSyncOnCreate("ringcentral", true),
  });
  assert.equal(ringcentral.no_sync, false);
});

test("CallLead schema defaults no_sync to false so missing-field documents stay syncable", () => {
  const field = CallLead.schema.path("no_sync") as { defaultValue?: unknown } | undefined;
  assert.ok(field);
  assert.equal(field.defaultValue, false);
});

test("begin remembers Sheet Sync before commit; complete dispatches and records owner events", async () => {
  const source = await readFile(
    path.join(__dirname, "callLead.service.ts"),
    "utf8",
  );
  const begin = extractExportedFunction(source, "beginCallLeadIngestion");
  const complete = extractExportedFunction(source, "completeCallLeadIngestion");
  const rcIngest = extractExportedFunction(source, "ingestRingCentralCallLead");
  const defaultIngestPair = await readFile(
    path.join(
      __dirname,
      "../ringcentral/ringcentral-call-lead-ingest.service.ts",
    ),
    "utf8",
  );

  assert.match(begin, /rememberSheetSync|persistSheetSyncIntent/);
  assert.doesNotMatch(begin, /finalizeSheetSync\s*\(/);
  assert.doesNotMatch(begin, /lead\.call\.created/);
  assert.match(complete, /projectTheLeadOntoSheets|finalizeSheetSync/);
  assert.match(complete, /lead\.call\.created/);
  assert.doesNotMatch(rcIngest, /lead\.call\.created/);
  assert.match(defaultIngestPair, /beginRingCentralCallLeadIngestion/);
  assert.match(defaultIngestPair, /completeCallLeadIngestion/);
});

function pendingIngestion(input: {
  form_fill: boolean;
  cplStatus: "resolved" | "missing_rate";
}): CallLeadIngestionInProgress {
  const lead = {
    _id: { toString: () => "507f1f77bcf86cd799439011" },
    name: "Ada",
    phone_number: "5550100101",
    cpl: input.cplStatus === "missing_rate" ? 0 : 40,
    cpl_resolution_status: input.cplStatus,
    pickup_zip: null,
    delivery_zip: null,
    local: null,
    form_fill: input.form_fill,
    duplicate: false,
  };
  return {
    lead: lead as CallLeadIngestionInProgress["lead"],
    job: {
      resource: "source_lead",
      operation: "call_lead.create",
      leadModel: "CallLead",
      leadId: "507f1f77bcf86cd799439011",
    },
    source_company: "tbm_leads",
    sourceAssignment: {
      source_company: "tbm_leads",
      source_granularity_id: "507f1f77bcf86cd799439012",
      source_granularity_key: "tbm_calls",
    } as unknown as CallLeadIngestionInProgress["sourceAssignment"],
    form_fill: input.form_fill,
  };
}

function capturedEventKeys() {
  return getCapturedOperationalEvents().map((event) => event.input.eventKey);
}

function extractExportedFunction(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `missing ${name}`);
  const rest = source.slice(start);
  if (name === "ingestRingCentralCallLead") {
    const afterFirstLine = rest.indexOf("\n");
    const following = rest.slice(afterFirstLine + 1);
    const nextFn = following.search(/\n(?:export )?(?:async )?function /);
    return nextFn === -1 ? rest : rest.slice(0, afterFirstLine + 1 + nextFn);
  }
  const next = source.indexOf("\nexport async function ", start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

function stubFindById(document: Record<string, unknown> | null): void {
  mongoose.connection.useDb = (() => ({
    models: { CallLead },
    model: () => CallLead,
  })) as unknown as typeof mongoose.connection.useDb;
  (CallLead as unknown as StubbedCallLeadModel).findById = () => {
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

function stubFind(documents: Array<Record<string, unknown>>): void {
  mongoose.connection.useDb = (() => ({
    models: { CallLead },
    model: () => CallLead,
  })) as unknown as typeof mongoose.connection.useDb;
  (CallLead as unknown as StubbedCallLeadModel).find = () => {
    const query = {
      sort: () => query,
      limit: () => query,
      exec: async () => documents,
      then: (
        resolve: (value: unknown) => void,
        reject?: (reason: unknown) => void,
      ) => Promise.resolve(documents).then(resolve, reject),
    };
    return query;
  };
}
