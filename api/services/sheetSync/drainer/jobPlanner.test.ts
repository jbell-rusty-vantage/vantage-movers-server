import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose, { Types } from "mongoose";
import { SHEET_TAB_NAMES } from "../../../config/domain";
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
const originalUseDb = mongoose.connection.useDb;
const originalMasterLeadsSheetId = process.env.MASTER_LEADS_SHEET_ID;
const originalTestMasterLeadsSheetId = process.env.TEST_MASTER_LEADS_SHEET_ID;

afterEach(() => {
  (CallLead as unknown as StubbedCallLeadModel).findById =
    originalCallLeadFindById as StubbedCallLeadModel["findById"];
  (FormLead as unknown as StubbedFormLeadModel).findById =
    originalFindById as StubbedFormLeadModel["findById"];
  mongoose.connection.useDb = originalUseDb;
  process.env.MASTER_LEADS_SHEET_ID = originalMasterLeadsSheetId;
  process.env.TEST_MASTER_LEADS_SHEET_ID = originalTestMasterLeadsSheetId;
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
