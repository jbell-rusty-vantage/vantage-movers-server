import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, before, mock, test } from "node:test";
import mongoose from "mongoose";
import { SHEET_TAB_NAMES } from "../../config/domain";
import { CallLead } from "../../models/CallLead";
import { logger } from "../../logger";
import { ConflictError } from "../errors";
import {
  correctCallLead,
  rememberBothCallSheetTabsForTombstone,
} from "./callLead.service";

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
  (CallLead as unknown as StubbedCallLeadModel).findById =
    originalFindById as StubbedCallLeadModel["findById"];
  (CallLead as unknown as StubbedCallLeadModel).find =
    originalFind as StubbedCallLeadModel["find"];
  mongoose.connection.useDb = originalUseDb;
  process.env.MASTER_LEADS_SHEET_ID = originalMasterLeadsSheetId;
  process.env.TEST_MASTER_LEADS_SHEET_ID = originalTestMasterLeadsSheetId;
  if (originalSheetSyncMode === undefined) delete process.env.SHEET_SYNC_MODE;
  else process.env.SHEET_SYNC_MODE = originalSheetSyncMode;
  loggedKeys.length = 0;
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

test("manual Call Lead creation is rejected before persistence", async () => {
  const { ingestCallLead } = await import("./callLead.service.js");
  await assert.rejects(ingestCallLead({} as never), /qualified RingCentral/);
});

test("begin remembers Sheet Sync before commit; complete dispatches and records owner events", async () => {
  const source = await readFile(
    path.join(__dirname, "callLead.service.ts"),
    "utf8",
  );
  const begin = extractExportedFunction(source, "beginRingCentralCallLeadIngestion");
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
  assert.doesNotMatch(begin, /logger\.info\s*\(/);
  assert.match(complete, /projectTheLeadOntoSheets|finalizeSheetSync/);
  assert.match(complete, /lead\.call\.created/);
  assert.doesNotMatch(rcIngest, /lead\.call\.created/);
  assert.match(defaultIngestPair, /beginRingCentralCallLeadIngestion/);
  assert.match(defaultIngestPair, /completeCallLeadIngestion/);
});



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
