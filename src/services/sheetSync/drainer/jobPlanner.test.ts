import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose, { Types } from "mongoose";
import { SHEET_TAB_NAMES } from "../../../config/domain";
import { BookedLead } from "../../../models/BookedLead";
import { CallLead } from "../../../models/CallLead";
import { FormLead } from "../../../models/FormLead";
import type { SheetSyncJobDocument } from "../../../models/SheetSyncJob";
import { planJobWrites } from "./jobPlanner";

test("jobPlanner registers mongoose models required for booked-lead populate", () => {
  assert.ok(mongoose.models.Customer, "Customer must be registered for booking_chain populate");
  assert.ok(mongoose.models.Agent, "Agent must be registered for booking_chain populate");
});

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

function stubFormLead(document: Record<string, unknown>): void {
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

test("planJobWrites turns a tombstone's previous_targets into delete writes", async () => {
  const job = tombstoneJob("delete_source_lead", {
    mongo_id: "lead-1",
    previous_targets: [
      { target: "master_calls", spreadsheet_id: "sheet-a", tab_name: "Calls", row_number: 12 },
      { target: "source_calls", spreadsheet_id: "sheet-b", tab_name: "Calls", row_number: 4 },
    ],
  });

  const planned = await planJobWrites(job);
  assert.equal(planned.length, 1);
  const [doc] = planned;
  assert.equal(doc.doc, undefined, "tombstone plans carry no surviving document");
  assert.equal(doc.writes.length, 2);
  assert.ok(doc.writes.every((write) => write.op === "delete"));
  assert.deepEqual(
    doc.writes.map((write) => write.spreadsheetId),
    ["sheet-a", "sheet-b"],
  );
  assert.deepEqual(
    doc.writes.map((write) => write.knownRowNumber),
    [12, 4],
  );
  assert.ok(doc.writes.every((write) => write.mongoId === "lead-1"));
});

test("planJobWrites skips tombstone targets with unknown headers", async () => {
  const job = tombstoneJob("delete_booked_lead", {
    mongo_id: "booking-1",
    previous_targets: [
      { target: "master_booked", spreadsheet_id: "sheet-a", tab_name: "Booked" },
      { target: "not_a_real_target", spreadsheet_id: "sheet-a", tab_name: "Ghost" },
    ],
  });

  const planned = await planJobWrites(job);
  assert.equal(planned[0].writes.length, 1, "only the known target is planned");
  assert.equal(planned[0].writes[0].target, "master_booked");
});

test("planJobWrites limits retrying tombstones to target_hints", async () => {
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
    ["source_calls"],
  );
});

test("planJobWrites returns a single empty plan when a tombstone has no targets", async () => {
  const job = tombstoneJob("delete_cancelled_lead", {
    mongo_id: "cancel-1",
    previous_targets: [],
  });

  const planned = await planJobWrites(job);
  assert.equal(planned.length, 1);
  assert.equal(planned[0].writes.length, 0);
});

test("planJobWrites dual-writes bad form leads to Forms and Master Bad Leads", async () => {
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
    sheet_sync: [{ target: "master_forms", row_number: 7 }],
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
    ["master_forms", "master_bad_leads"],
  );
  assert.equal(planned[0].writes[1].tabName, SHEET_TAB_NAMES.badLeads);
  assert.equal(planned[0].writes[1].op, "upsert");
  assert.equal(planned[0].writes[1].row.at(-1), "");
  assert.equal(planned[0].writes[1].row.at(-2), "Auto Only");
});

test("planJobWrites deletes stale Master Bad Leads row when bad_lead is cleared", async () => {
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
    bad_lead: null,
    sheet_sync: [
      { target: "master_forms", row_number: 7 },
      { target: "master_bad_leads", row_number: 11 },
    ],
    get(key: string) {
      return this[key as keyof typeof lead];
    },
    populate: async () => lead,
  };
  stubFormLead(lead);

  const planned = await planJobWrites(sourceLeadJob(leadId));

  assert.equal(planned.length, 1);
  const deleteWrite = planned[0].writes.find((write) => write.target === "master_bad_leads");
  assert.equal(deleteWrite?.op, "delete");
  assert.equal(deleteWrite?.knownRowNumber, 11);
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
    sheet_sync: [{ target: "master_forms", row_number: 7 }],
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

test("ordinary No-Sync Form deletes Forms only and does not upsert", async () => {
  useMasterSheetIds();
  const lead = formLeadStub({ no_sync: true });
  stubFormLead(lead);

  const planned = await planJobWrites(sourceLeadJob(lead._id.toString()));

  assert.equal(planned.length, 1);
  assert.deepEqual(writeKeys(planned[0].writes), [
    `delete:master_forms:${SHEET_TAB_NAMES.forms}`,
  ]);
  assert.equal(
    planned[0].writes.some((write) => write.op === "upsert"),
    false,
  );
  assert.equal(
    planned[0].writes.some((write) =>
      ["master_duplicates", "master_bad_leads"].includes(write.target),
    ),
    false,
  );
});

test("ordinary No-Sync Call deletes Calls only and does not upsert", async () => {
  useMasterSheetIds();
  const lead = callLeadStub({ no_sync: true });
  stubCallLead(lead);

  const planned = await planJobWrites(sourceLeadJob(lead._id.toString(), "CallLead"));

  assert.equal(planned.length, 1);
  assert.deepEqual(writeKeys(planned[0].writes), [
    `delete:master_calls:${SHEET_TAB_NAMES.calls}`,
  ]);
  assert.equal(
    planned[0].writes.some((write) => write.op === "upsert"),
    false,
  );
  assert.equal(
    planned[0].writes.some((write) => write.target === "master_duplicate_calls"),
    false,
  );
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

test("no_sync + bad_lead matches today's Bad Form dual-write", async () => {
  useMasterSheetIds();
  const baseline = formLeadStub({ bad_lead: "auto_only" });
  stubFormLead(baseline);
  const baselineWrites = writeKeys(
    (await planJobWrites(sourceLeadJob(baseline._id.toString())))[0].writes,
  );

  const twin = formLeadStub({ bad_lead: "auto_only", no_sync: true });
  stubFormLead(twin);
  const twinWrites = writeKeys(
    (await planJobWrites(sourceLeadJob(twin._id.toString())))[0].writes,
  );

  assert.deepEqual(baselineWrites, [
    `upsert:master_forms:${SHEET_TAB_NAMES.forms}`,
    `upsert:master_bad_leads:${SHEET_TAB_NAMES.badLeads}`,
  ]);
  assert.deepEqual(twinWrites, baselineWrites);
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
  ]);
  assert.deepEqual(twinWrites, baselineWrites);
});

test("Form Duplicate upserts Duplicates and does not delete leftover Forms", async () => {
  useMasterSheetIds();
  const lead = formLeadStub({ duplicate: true });
  stubFormLead(lead);

  const planned = await planJobWrites(sourceLeadJob(lead._id.toString()));

  assert.deepEqual(writeKeys(planned[0].writes), [
    `upsert:master_duplicates:${SHEET_TAB_NAMES.duplicates}`,
  ]);
});

test("no_sync + Form duplicate matches today's Form Duplicate plan", async () => {
  useMasterSheetIds();
  const baseline = formLeadStub({ duplicate: true });
  stubFormLead(baseline);
  const baselineWrites = writeKeys(
    (await planJobWrites(sourceLeadJob(baseline._id.toString())))[0].writes,
  );

  const twin = formLeadStub({ duplicate: true, no_sync: true });
  stubFormLead(twin);
  const twinWrites = writeKeys(
    (await planJobWrites(sourceLeadJob(twin._id.toString())))[0].writes,
  );

  assert.deepEqual(twinWrites, baselineWrites);
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

  assert.deepEqual(clearedWrites, [`upsert:master_forms:${SHEET_TAB_NAMES.forms}`]);
  assert.deepEqual(missingWrites, clearedWrites);
});
