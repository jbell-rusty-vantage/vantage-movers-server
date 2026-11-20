import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose, { Types } from "mongoose";
import { SHEET_TAB_NAMES } from "../../../config/domain";
import { BookedLead } from "../../../models/BookedLead";
import { CallLead } from "../../../models/CallLead";
import { FormLead } from "../../../models/FormLead";
import type { SheetSyncJobDocument } from "../../../models/SheetSyncJob";
import { planJobWrites } from "./jobPlanner";
import { writeBatchedTargets } from "./batchWriter";
import type { QuotaLimiter } from "./quotaLimiter";
import { statefulWorkbook } from "./statefulWorkbook.fixture";
import { BEST_RELOCATION_TRACKER_ID, EXTERNAL_REVIEW_POLICY_VERSION } from "../../leads/externalSheetReview";
import { LEGACY_BEST_RELOCATION_CALL_IDS } from "../../leads/legacyBestRelocationCalls";
import { BEST_RELOCATION_ADMISSION_COMPANY_ID, BEST_RELOCATION_ADMISSION_CALL_FEED_ID } from "../../leads/callLeadAdmission";

type TombstoneInput = {
  mongo_id: string;
  previous_targets: {
    target: string;
    spreadsheet_id: string;
    tab_name: string;
    row_number?: number;
  }[];
};

type StubbedFormLeadModel = {
  findById: (id: string) => unknown;
};

type StubbedCallLeadModel = {
  findById: (id: string) => unknown;
};

const originalCallLeadFindById = CallLead.findById as unknown;
const originalFindById = FormLead.findById as unknown;
const originalBookedFindById = BookedLead.findById as unknown;
const originalUseDb = mongoose.connection.useDb;
const originalMasterLeadsSheetId = process.env.MASTER_LEADS_SHEET_ID;
const originalTestMasterLeadsSheetId = process.env.TEST_MASTER_LEADS_SHEET_ID;
const originalMasterBookedSheetId = process.env.MASTER_BOOKED_SHEET_ID;
const originalTestMasterBookedSheetId = process.env.TEST_MASTER_BOOKED_SHEET_ID;

afterEach(() => {
  (CallLead as unknown as StubbedCallLeadModel).findById =
    originalCallLeadFindById as StubbedCallLeadModel["findById"];
  (FormLead as unknown as StubbedFormLeadModel).findById =
    originalFindById as StubbedFormLeadModel["findById"];
  BookedLead.findById = originalBookedFindById as typeof BookedLead.findById;
  mongoose.connection.useDb = originalUseDb;
  process.env.MASTER_LEADS_SHEET_ID = originalMasterLeadsSheetId;
  process.env.TEST_MASTER_LEADS_SHEET_ID = originalTestMasterLeadsSheetId;
  process.env.MASTER_BOOKED_SHEET_ID = originalMasterBookedSheetId;
  process.env.TEST_MASTER_BOOKED_SHEET_ID = originalTestMasterBookedSheetId;
});

function tombstoneJob(
  resource: "delete_source_lead" | "delete_booked_lead" | "delete_cancelled_lead",
  tombstone: TombstoneInput,
): SheetSyncJobDocument {
  return {
    _id: new Types.ObjectId(),
    resource,
    operation: "delete",
    entity_id: tombstone.mongo_id,
    tombstone,
  } as unknown as SheetSyncJobDocument;
}

function sourceLeadJob(leadId: string, leadModel: "FormLead" | "CallLead" = "FormLead"): SheetSyncJobDocument {
  return {
    _id: new Types.ObjectId(),
    resource: "source_lead",
    operation: `${leadModel === "FormLead" ? "form" : "call"}_lead.update`,
    entity_model: leadModel,
    entity_id: leadId,
  } as unknown as SheetSyncJobDocument;
}

function stubFormLead(document: Record<string, unknown> | null): void {
  mongoose.connection.useDb = (() => ({
    models: { FormLead },
    model: () => FormLead,
  })) as unknown as typeof mongoose.connection.useDb;
  (FormLead as unknown as StubbedFormLeadModel).findById = () => ({
    then: (resolve: (value: unknown) => void) => resolve(document),
  });
}

function stubCallLead(document: Record<string, unknown>): void {
  mongoose.connection.useDb = (() => ({
    models: { CallLead },
    model: () => CallLead,
  })) as unknown as typeof mongoose.connection.useDb;
  (CallLead as unknown as StubbedCallLeadModel).findById = () => ({
    then: (resolve: (value: unknown) => void) => resolve(document),
  });
}

test("planJobWrites retries every Call tombstone destination despite stale target_hints", async () => {
  const job = {
    ...tombstoneJob("delete_source_lead", {
      mongo_id: "lead-1",
      previous_targets: [
        { target: "master_calls", spreadsheet_id: "sheet-a", tab_name: "Calls", row_number: 12 },
        { target: "source_calls", spreadsheet_id: "sheet-b", tab_name: "Calls", row_number: 4 },
      ],
    }),
    target_hints: ["source_calls"],
  } as SheetSyncJobDocument;

  const planned = await planJobWrites(job);
  assert.equal(planned.length, 1);
  assert.deepEqual(
    planned[0].writes.map((write) => write.target),
    ["master_calls", "source_calls", "master_duplicate_calls", "master_bad_calls", "source_duplicate_calls", "source_bad_calls"],
  );
});

test("planJobWrites upserts Bad Form Leads before deleting both primary titles", async () => {
  process.env.MASTER_LEADS_SHEET_ID = "master-leads-test";
  process.env.TEST_MASTER_LEADS_SHEET_ID = "master-leads-test";
  const leadObjectId = new Types.ObjectId();
  const leadId = leadObjectId.toString();
  const lead = {
    _id: leadObjectId,
    timestamp: new Date("2026-05-27T15:04:05.000Z"),
    name: "Jane Tester",
    pickup_zip: "10001",
    destination_zip: "90210",
    pickup_state: "NY",
    delivery_state: "CA",
    move_size: "Studio",
    move_date: new Date("2026-06-01T00:00:00.000Z"),
    phone_number: "5551112222",
    email: "jane@example.com",
    ref_no: "ref-1",
    local: "long_distance",
    source_company: "main_site",
    bad_lead: "auto_only",
    sheet_sync: [{ target: "master_forms", spreadsheet_id: "master-leads-test", tab_name: SHEET_TAB_NAMES.forms, row_number: 7 }],
    get(key: string) {
      return this[key as keyof typeof lead];
    },
    populate: async () => lead,
  };
  stubFormLead(lead);

  const planned = await planJobWrites(sourceLeadJob(leadId));

  assert.equal(planned.length, 1);
  assert.deepEqual(
    planned[0].writes.map((write) => write.target),
    ["master_bad_leads", "master_forms", "master_duplicates", "master_duplicates"],
  );
  assert.equal(planned[0].writes[0].tabName, SHEET_TAB_NAMES.badLeads);
  assert.equal(planned[0].writes[0].op, "upsert");
  assert.equal(planned[0].writes[0].row.at(-1), "");
  assert.equal(planned[0].writes[0].row.at(-2), "Auto Only");
  assert.ok(planned[0].writes.slice(1).every(write => write.op === "delete"));
});

test("planJobWrites deletes stale Calls row when duplicate call lead lacks sheet_sync metadata", async () => {
  process.env.MASTER_LEADS_SHEET_ID = "master-leads-test";
  process.env.TEST_MASTER_LEADS_SHEET_ID = "master-leads-test";
  const leadObjectId = new Types.ObjectId();
  const leadId = leadObjectId.toString();
  const lead = {
    _id: leadObjectId,
    timestamp: new Date("2026-06-09T10:10:47.392Z"),
    job_no: "",
    phone_number: "(260) 446-6873",
    duration: 1738,
    ringcentral: { call_log_id: "call-log-id", ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_answered_over_120s", duration_seconds: 1738 },
    booked: null,
    over_2000: false,
    over_4000: false,
    cancelled: null,
    local: "long_distance",
    cubic_feet: null,
    source_company: "tbm_leads",
    duplicate: true,
    form_fill: false,
    sheet_sync: [],
    get(key: string) {
      return this[key as keyof typeof lead];
    },
    populate: async () => lead,
  };
  stubCallLead(lead);

  const planned = await planJobWrites(sourceLeadJob(leadId, "CallLead"));

  assert.equal(planned.length, 1);
  assert.deepEqual(
    planned[0].writes.map((write) => `${write.op}:${write.target}:${write.tabName}`),
    [
      `upsert:master_duplicate_calls:${SHEET_TAB_NAMES.duplicateCalls}`,
      `delete:master_calls:${SHEET_TAB_NAMES.calls}`,
      `delete:master_bad_calls:${SHEET_TAB_NAMES.badCalls}`,
    ],
  );
  const staleDelete = planned[0].writes.find((write) => write.target === "master_calls");
  assert.equal(staleDelete?.knownRowNumber, undefined);
  assert.equal(staleDelete?.mongoId, leadId);
});

function useMasterSheetIds(): void {
  process.env.MASTER_LEADS_SHEET_ID = "master-leads-test";
  process.env.TEST_MASTER_LEADS_SHEET_ID = "master-leads-test";
  process.env.MASTER_BOOKED_SHEET_ID = "master-booked-test";
  process.env.TEST_MASTER_BOOKED_SHEET_ID = "master-booked-test";
}

function writeKeys(writes: { op: string; target: string; tabName: string }[]) {
  return writes.map((write) => `${write.op}:${write.target}:${write.tabName}`);
}

function formLeadStub(overrides: Record<string, unknown> = {}) {
  const leadObjectId = new Types.ObjectId();
  const lead = {
    _id: leadObjectId,
    duplicate: false,
    timestamp: new Date("2026-05-27T15:04:05.000Z"),
    name: "Jane Tester",
    pickup_zip: "10001",
    destination_zip: "90210",
    pickup_state: "NY",
    delivery_state: "CA",
    move_size: "Studio",
    move_date: new Date("2026-06-01T00:00:00.000Z"),
    phone_number: "5551112222",
    email: "jane@example.com",
    ref_no: "ref-1",
    local: "long_distance",
    source_company: "main_site",
    sheet_sync: [{ target: "master_forms", spreadsheet_id: "master-leads-test", tab_name: SHEET_TAB_NAMES.forms, row_number: 7 }],
    get(key: string) {
      return this[key as keyof typeof lead];
    },
    populate: async () => lead,
    ...overrides,
  };
  return lead;
}

function callLeadStub(overrides: Record<string, unknown> = {}) {
  const leadObjectId = new Types.ObjectId();
  const lead = {
    _id: leadObjectId,
    timestamp: new Date("2026-06-09T10:10:47.392Z"),
    job_no: "",
    phone_number: "(260) 446-6873",
    duration: 1738,
    ringcentral: { call_log_id: "call-log-id", ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_answered_over_120s", duration_seconds: 1738 },
    booked: null,
    over_2000: false,
    over_4000: false,
    cancelled: null,
    local: "long_distance",
    cubic_feet: null,
    source_company: "tbm_leads",
    form_fill: false,
    sheet_sync: [],
    get(key: string) {
      return this[key as keyof typeof lead];
    },
    populate: async () => lead,
    ...overrides,
  };
  return lead;
}

function stubBookedLead(document: Record<string, unknown>): void {
  const query = {
    populate() {
      return query;
    },
    then(resolve: (value: unknown) => void) {
      resolve(document);
    },
  };
  BookedLead.findById = (() => query) as unknown as typeof BookedLead.findById;
}

test("ordinary No-Sync Form deletes every Form destination and transitional title without upsert", async () => {
  useMasterSheetIds();
  const lead = formLeadStub({ no_sync: true });
  stubFormLead(lead);

  const planned = await planJobWrites(sourceLeadJob(lead._id.toString()));

  assert.equal(planned.length, 1);
  assert.deepEqual(writeKeys(planned[0].writes), [
    `delete:master_forms:${SHEET_TAB_NAMES.forms}`,
    `delete:master_duplicates:${SHEET_TAB_NAMES.duplicates}`,
    `delete:master_duplicates:Duplicates`,
    `delete:master_bad_leads:${SHEET_TAB_NAMES.badLeads}`,
    `delete:master_bad_leads:Bad Leads`,
  ]);
  assert.equal(
    planned[0].writes.some((write) => write.op === "upsert"),
    false,
  );
  assert.equal(
    planned[0].writes.some((write) =>
      ["master_duplicates", "master_bad_leads"].includes(write.target),
    ),
    true,
  );
});

test("trusted bad Form review overrides duplicate and stale retry hints without changing flags", async () => {
  useMasterSheetIds();
  const lead = formLeadStub({ duplicate: true, no_sync: true, sheet_sync: [], external_sheet_review: {
    kind: "bad_form", reason_code: "external_bad_form", raw_value: "bad form", normalized_value: "bad form",
    source_workbook_id: BEST_RELOCATION_TRACKER_ID, source_sheet_id: 0, source_tab: "Forms", stable_source_row_id: "source-form",
    source_content_hash: "a".repeat(64), policy_version: EXTERNAL_REVIEW_POLICY_VERSION,
    ingestion_run_id: "run", source_row_receipt_id: "receipt", applied_at: new Date(),
  } });
  stubFormLead(lead);
  const job = { ...sourceLeadJob(lead._id.toString()), target_hints: ["master_forms"] } as SheetSyncJobDocument;
  const [plan] = await planJobWrites(job);
  assert.deepEqual(writeKeys(plan.writes), [
    `upsert:master_bad_leads:${SHEET_TAB_NAMES.badLeads}`,
    `delete:master_forms:${SHEET_TAB_NAMES.forms}`,
    `delete:master_duplicates:${SHEET_TAB_NAMES.duplicates}`,
    `delete:master_duplicates:Duplicates`,
  ]);
  assert.ok(plan.writes.every(write => write.mongoId === lead._id.toString()));
  assert.equal(lead.duplicate, true);
});

test("Booking Chain delivers the official Booking and recovers the committed Bad Form append before removing stale membership", async () => {
  useMasterSheetIds();
  const lead = formLeadStub({ bad_lead: "auto_only", duplicate: true, no_sync: true, sheet_sync: [] });
  stubFormLead(lead);
  const booking = {
    _id: new Types.ObjectId(), timestamp: new Date(), book_date: new Date(), job_no: "JN-FORM",
    customer_name: "Synthetic", source: "main_site", merchant: "authorize_net",
    lead_ref: lead._id, lead_model: "FormLead", agent_allocations: [], sheet_sync: [],
    get(key: string) { return this[key as keyof typeof booking]; },
  };
  stubBookedLead(booking);
  const plans = await planJobWrites({ _id: new Types.ObjectId(), resource: "booking_chain", operation: "booked_lead.update", entity_id: booking._id.toString() } as SheetSyncJobDocument);
  const writes = plans.flatMap(plan => plan.writes);
  const booked = writes.find(write => write.target === "master_booked")!;
  const badForm = writes.find(write => write.target === "master_bad_leads")!;
  const forms = writes.find(write => write.target === "master_forms")!;
  const staleForm = forms.headers.map(header => header === "Mongo ID" ? lead._id.toString() : "stale");
  const neighbor = forms.headers.map(header => header === "Mongo ID" ? "unrelated-id" : "preserve");
  const workbook = statefulWorkbook({
    [SHEET_TAB_NAMES.bookedDeals]: [[...booked.headers]],
    [SHEET_TAB_NAMES.badLeads]: [[...badForm.headers]],
    [SHEET_TAB_NAMES.forms]: [[...forms.headers], staleForm, neighbor],
  });
  workbook.fault("append", "none", "after");
  const quota = { reserve: async () => ({ granted: true }) } as unknown as QuotaLimiter;
  const deliver = () => writeBatchedTargets({ sheets: workbook.sheets, writes, quota, ensureHeaders: false });

  const first = await deliver();
  assert.equal(first.find(outcome => outcome.write.target === "master_booked")?.status, "synced");
  assert.equal(first.find(outcome => outcome.write.target === "master_bad_leads")?.status, "deferred");
  assert.equal(workbook.count("delete"), 0);
  assert.deepEqual(workbook.rows.get(SHEET_TAB_NAMES.forms), [[...forms.headers], staleForm, neighbor]);

  const replay = await deliver();
  assert.equal(replay.length, writes.length);
  assert.ok(replay.every(outcome => outcome.status === "synced"));
  const appends = workbook.requests.filter(request => request.operation === "append")
    .map(request => request.params as { spreadsheetId: string; range: string });
  assert.deepEqual(appends.map(({ spreadsheetId, range }) => [spreadsheetId, range.split("!")[0]]), [
    ["master-booked-test", `'${SHEET_TAB_NAMES.bookedDeals}'`],
    ["master-leads-test", `'${SHEET_TAB_NAMES.badLeads}'`],
  ]);
  assert.equal(workbook.count("delete"), 1);
  assert.deepEqual(workbook.rows.get(SHEET_TAB_NAMES.bookedDeals), [[...booked.headers], booked.row]);
  assert.deepEqual(workbook.rows.get(SHEET_TAB_NAMES.badLeads), [[...badForm.headers], badForm.row]);
  assert.deepEqual(workbook.rows.get(SHEET_TAB_NAMES.forms), [[...forms.headers], neighbor]);
  assert.equal(lead.duplicate, true);
});

test("Booking Chain + ordinary No-Sync Call upserts Booked Deals and deletes Calls", async () => {
  useMasterSheetIds();
  const call = callLeadStub({ no_sync: true });
  stubCallLead(call);
  const bookingId = new Types.ObjectId();
  const booking = {
    _id: bookingId,
    timestamp: new Date("2026-06-09T10:10:47.392Z"),
    book_date: new Date("2026-06-09T00:00:00.000Z"),
    job_no: "JN-1",
    customer_name: "Synthetic Booked",
    source: "tbm_leads",
    merchant: "authorize_net",
    lead_ref: call._id,
    lead_model: "CallLead",
    agent_allocations: [],
    sheet_sync: [],
    get(key: string) {
      return this[key as keyof typeof booking];
    },
  };
  stubBookedLead(booking);

  const planned = await planJobWrites({
    _id: new Types.ObjectId(),
    resource: "booking_chain",
    operation: "booked_lead.update",
    entity_id: bookingId.toString(),
  } as unknown as SheetSyncJobDocument);

  assert.ok(
    planned.some((doc) =>
      doc.writes.some(
        (write) => write.op === "upsert" && write.target === "master_booked",
      ),
    ),
  );
  const leadPlan = planned.find((doc) => doc.docKey.startsWith("CallLead:"));
  assert.ok(leadPlan);
  assert.deepEqual(writeKeys(leadPlan.writes), [
    `delete:master_calls:${SHEET_TAB_NAMES.calls}`,
    `delete:master_duplicate_calls:${SHEET_TAB_NAMES.duplicateCalls}`,
    `delete:master_bad_calls:${SHEET_TAB_NAMES.badCalls}`,
  ]);
  assert.equal(
    leadPlan.writes.some((write) => write.op === "upsert"),
    false,
  );
});

test("Unmatched Call without no_sync stays an empty plan with no deletes", async () => {
  useMasterSheetIds();
  const lead = callLeadStub({ created_on_unmatched: true });
  stubCallLead(lead);

  const planned = await planJobWrites(sourceLeadJob(lead._id.toString(), "CallLead"));

  assert.deepEqual(planned, []);
});

test("no_sync + Call duplicate matches today's Duplicate Calls plan", async () => {
  useMasterSheetIds();
  const baseline = callLeadStub({ duplicate: true });
  stubCallLead(baseline);
  const baselineWrites = writeKeys(
    (await planJobWrites(sourceLeadJob(baseline._id.toString(), "CallLead")))[0].writes,
  );

  const twin = callLeadStub({ duplicate: true, no_sync: true });
  stubCallLead(twin);
  const twinWrites = writeKeys(
    (await planJobWrites(sourceLeadJob(twin._id.toString(), "CallLead")))[0].writes,
  );

  assert.deepEqual(baselineWrites, [
    `upsert:master_duplicate_calls:${SHEET_TAB_NAMES.duplicateCalls}`,
    `delete:master_calls:${SHEET_TAB_NAMES.calls}`,
    `delete:master_bad_calls:${SHEET_TAB_NAMES.badCalls}`,
  ]);
  assert.deepEqual(twinWrites, baselineWrites);
});

test("historical BR queued policy retains identity for No-Sync Form Fill and duplicate routing", async () => {
  useMasterSheetIds();
  for (const flags of [{ form_fill: true }, { duplicate: true }, {}]) {
    const lead = callLeadStub({ _id: new Types.ObjectId(LEGACY_BEST_RELOCATION_CALL_IDS[0]), ringcentral: undefined,
      source_company: "best_relocation_leads", lead_source_company: new Types.ObjectId(BEST_RELOCATION_ADMISSION_COMPANY_ID),
      source_granularity_id: new Types.ObjectId(BEST_RELOCATION_ADMISSION_CALL_FEED_ID), no_sync: true, ...flags });
    stubCallLead(lead);
    const planned = await planJobWrites(sourceLeadJob(lead._id.toString(), "CallLead"));
    const upserts = planned.flatMap(plan => plan.writes).filter(write => write.op === "upsert");
    assert.deepEqual(upserts.map(write => write.tabName), "form_fill" in flags || "duplicate" in flags ? [SHEET_TAB_NAMES.duplicateCalls] : []);
  }
});

test("Form that became a Duplicate upserts Duplicate Forms and removes its Forms row without metadata", async () => {
  useMasterSheetIds();
  const lead = formLeadStub({ duplicate: true, sheet_sync: [] });
  stubFormLead(lead);

  const planned = await planJobWrites(sourceLeadJob(lead._id.toString()));

  assert.deepEqual(writeKeys(planned[0].writes), [
    `upsert:master_duplicates:${SHEET_TAB_NAMES.duplicates}`,
    `delete:master_forms:${SHEET_TAB_NAMES.forms}`,
    `delete:master_bad_leads:${SHEET_TAB_NAMES.badLeads}`,
    `delete:master_bad_leads:Bad Leads`,
  ]);
});

test("Form that stopped being a Duplicate upserts Forms and removes old and new Duplicate Forms titles", async () => {
  useMasterSheetIds();
  // Only the Forms entry survived in metadata; the Duplicate Forms row must still be found by Mongo ID.
  const lead = formLeadStub({ duplicate: false, sheet_sync: [{ target: "master_forms", spreadsheet_id: "master-leads-test", tab_name: SHEET_TAB_NAMES.forms, row_number: 9 }] });
  stubFormLead(lead);
  const job = { ...sourceLeadJob(lead._id.toString()), target_hints: ["master_forms"] } as SheetSyncJobDocument;

  const planned = await planJobWrites(job);

  assert.deepEqual(writeKeys(planned[0].writes), [
    `upsert:master_forms:${SHEET_TAB_NAMES.forms}`,
    `delete:master_duplicates:${SHEET_TAB_NAMES.duplicates}`,
    `delete:master_duplicates:Duplicates`,
    `delete:master_bad_leads:${SHEET_TAB_NAMES.badLeads}`,
    `delete:master_bad_leads:Bad Leads`,
  ]);
  assert.ok(planned[0].writes.every((write) => write.mongoId === lead._id.toString()));
});

test("re-delivered non-duplicate Form leaves exactly its Forms row across old and new Duplicate titles", async () => {
  useMasterSheetIds();
  const lead = formLeadStub({ duplicate: false, sheet_sync: [] });
  stubFormLead(lead);
  const [plan] = await planJobWrites(sourceLeadJob(lead._id.toString()));
  const forms = plan.writes.find(write => write.target === "master_forms")!;
  const id = lead._id.toString();
  const stale = forms.headers.map(header => header === "Mongo ID" ? id : "stale");
  const neighbor = forms.headers.map(header => header === "Mongo ID" ? "unrelated-id" : "preserve");
  const workbook = statefulWorkbook({
    [SHEET_TAB_NAMES.forms]: [[...forms.headers], neighbor, stale],
    [SHEET_TAB_NAMES.duplicates]: [[...forms.headers], stale, neighbor],
    Duplicates: [[...forms.headers], neighbor, stale],
  });
  const quota = { reserve: async () => ({ granted: true }) } as unknown as QuotaLimiter;

  const outcomes = await writeBatchedTargets({ sheets: workbook.sheets, writes: plan.writes, quota, ensureHeaders: false });

  assert.ok(outcomes.every(outcome => outcome.status === "synced"));
  assert.deepEqual(workbook.rows.get(SHEET_TAB_NAMES.forms), [[...forms.headers], neighbor, forms.row]);
  assert.deepEqual(workbook.rows.get(SHEET_TAB_NAMES.duplicates), [[...forms.headers], neighbor]);
  assert.deepEqual(workbook.rows.get("Duplicates"), [[...forms.headers], neighbor]);
});

test("clear no_sync on an ordinary Form upserts Forms", async () => {
  useMasterSheetIds();
  const cleared = formLeadStub({ no_sync: false });
  stubFormLead(cleared);
  const clearedWrites = writeKeys(
    (await planJobWrites(sourceLeadJob(cleared._id.toString())))[0].writes,
  );

  const missing = formLeadStub();
  stubFormLead(missing);
  const missingWrites = writeKeys(
    (await planJobWrites(sourceLeadJob(missing._id.toString())))[0].writes,
  );

  assert.deepEqual(clearedWrites, [`upsert:master_forms:${SHEET_TAB_NAMES.forms}`, `delete:master_duplicates:${SHEET_TAB_NAMES.duplicates}`, `delete:master_duplicates:Duplicates`, `delete:master_bad_leads:${SHEET_TAB_NAMES.badLeads}`, `delete:master_bad_leads:Bad Leads`]);
  assert.deepEqual(missingWrites, clearedWrites);
});


test("an older upsert retry after Lead removal completes without recreating its row", async () => {
  stubFormLead(null);
  const plan = await planJobWrites(sourceLeadJob(new Types.ObjectId().toString()));
  assert.deepEqual(plan, []);
});
