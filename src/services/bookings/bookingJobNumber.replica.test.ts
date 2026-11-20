import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo, withTransaction } from "../../db";
import { Agent } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { getFormLeadModel } from "../../models/FormLead";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { Merchant } from "../../models/Merchant";
import { createVantageApiSecretActor } from "../domainCommands/existingWriteContext";
import {
  runExistingCreateBookingFromLead,
  runExistingCreateLeadlessBooking,
  runExistingCreateReferralBooking,
  runExistingUpdateBookedLead,
} from "../domainCommands/existingWrites";
import type { CanonicalCommandContext } from "../domainCommands/types";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { submitEmployeeBooking } from "../employeeBookings/submitEmployeeBooking.service";
import { updatePendingEmployeeBooking } from "../employeeBookings/bookingLeadReconciliation.service";
import { randomUUID } from "node:crypto";
import {
  BOOKING_JOB_NUMBER_CHECKS_COLLECTION,
  BOOKING_JOB_NUMBER_CONTROL_COLLECTION,
  BOOKING_JOB_NUMBER_CONTROL_ID,
  BookingJobNumberError,
  type BookingJobNumberMode,
} from "./bookingJobNumberGuard";

/**
 * Booking Job Number validation on a real replica: the model hook, its transaction behaviour and the
 * canonical write commands in both modes. Opt-in: GRANOT_LIFECYCLE_REPLICA_TESTS=true, TEST_MODE=true,
 * TEST_MONGO_DATABASE_NAME=testvantagemovers_<suffix>, MONGO_URI=<loopback replica>. The isolated
 * database is dropped afterwards.
 */
const ISOLATED_DB = /^testvantagemovers_[a-z0-9]+$/i;
let ready = false;
const AGENT = "Jobno Replica Agent";
const MERCHANT = "Jobno Replica Merchant";
let seq = 0;
let companyId = "";

before(async () => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true" || !ISOLATED_DB.test(getMongoDatabaseName())) return;
  await connectMongo();
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello?.setName || !ISOLATED_DB.test(mongoose.connection.db?.databaseName ?? "")) return;
  await BookedLead.createCollection().catch(() => undefined);
  await BookedLead.collection.createIndex(
    { normalized_job_no: 1 },
    { unique: true, name: "booked_lead_normalized_job_no_unique", partialFilterExpression: { normalized_job_no: { $type: "string" } } },
  );
  await Agent.create({ name: AGENT, normalized_name: AGENT.toLowerCase(), active: true });
  await Merchant.create({ name: MERCHANT, normalized_name: MERCHANT.toLowerCase(), active: true });
  const company = await getLeadSourceCompanyModel().create({
    company_slug: "main_site", name: "Main Site", owner_label: "Main Site", active: true, created_from: "test",
  });
  const granularity = await getLeadSourceGranularityModel().create({
    source_company: company._id, granularity_key: "main_site_form", channel: "form",
    owner_label: "Main Site Form", crm_label: "Main Site", active: true, created_from: "test",
  });
  await getLeadSourceCompanyModel().updateOne({ _id: company._id }, { $set: { default_form_granularity: granularity._id } });
  companyId = company._id.toString();
  ready = true;
});

after(async () => {
  if (mongoose.connection.readyState === 1 && ISOLATED_DB.test(mongoose.connection.db?.databaseName ?? "")) {
    await mongoose.connection.db?.dropDatabase().catch(() => undefined);
  }
  await mongoose.disconnect().catch(() => undefined);
});

function skipUnlessReady(t: { skip: (reason: string) => void }): boolean {
  if (!ready) t.skip("requires the loopback replica and an isolated TEST_MONGO_DATABASE_NAME");
  return ready;
}

const db = () => mongoose.connection.db!;
async function setMode(mode: BookingJobNumberMode | null) {
  const control = db().collection<{ _id: string }>(BOOKING_JOB_NUMBER_CONTROL_COLLECTION);
  if (mode === null) await control.deleteOne({ _id: BOOKING_JOB_NUMBER_CONTROL_ID });
  else await control.updateOne({ _id: BOOKING_JOB_NUMBER_CONTROL_ID }, { $set: { mode } }, { upsert: true });
}
const checks = (bookingId?: unknown) =>
  db().collection(BOOKING_JOB_NUMBER_CHECKS_COLLECTION).find(bookingId ? { booking_id: String(bookingId) } : {}).toArray();
const uniqueJob = () => `P${String(7_000_000 + ++seq * 13 + (Date.now() % 7))}`;

function context(prefix: string): CanonicalCommandContext {
  const actor = createVantageApiSecretActor(`${prefix}-req`);
  return {
    command_id: new mongoose.Types.ObjectId().toHexString(),
    idempotency_key: `${prefix}-${new mongoose.Types.ObjectId().toHexString()}`,
    payload_checksum: new mongoose.Types.ObjectId().toHexString().padEnd(64, "0"),
    actor,
    initiator: actor,
    provenance: { origin: "vantage_admin", run_id: null, source_receipt_id: null, source_connection_key: null },
  };
}

function bookingDoc(jobNo: unknown, extra: Record<string, unknown> = {}) {
  return new BookedLead({
    book_date: new Date("2026-11-20T12:00:00.000Z"),
    job_no: jobNo,
    agent_allocations: [{ agent: new mongoose.Types.ObjectId(), agent_name_snapshot: AGENT, binder_amount: 100 }],
    total_binder_amount: 100,
    deposit_amount: 500,
    merchant: MERCHANT,
    source: "main_site",
    local: "long_distance",
    is_leadless_booking: true,
    ...extra,
  });
}

async function formLead(jobNo?: string) {
  seq += 1;
  return getFormLeadModel().create({
    name: "Jobno Synthetic",
    phone_number: `55500${String(seq).padStart(5, "0")}`,
    pickup_zip: "10001",
    destination_zip: "94105",
    move_size: "Studio",
    local: "long_distance",
    source_company: "main_site",
    lead_source_company: new mongoose.Types.ObjectId(),
    ref_no: `jobno-${seq}-${Date.now()}`,
    ...(jobNo ? { job_no: jobNo } : {}),
  });
}

const isJobNumberError = (reason: string) => (error: unknown) => {
  assert.ok(error instanceof BookingJobNumberError, String(error));
  assert.equal(error.statusCode, 422);
  assert.equal(error.code, "booking.job_number_invalid");
  assert.equal(error.reason, reason);
  return true;
};

test("model hook: shadow (missing control) records a would-reject and saves; valid values record nothing", async (t) => {
  if (!skipUnlessReady(t)) return;
  await setMode(null);
  const bad = await bookingDoc("Jane Customer").save();
  const [row, ...rest] = await checks(bad._id);
  assert.equal(rest.length, 0);
  assert.equal(row?.verdict, "would_reject");
  assert.equal(row?.reason, "no_digits");
  assert.equal(row?.write_path, "create_leadless_booking");
  assert.equal(JSON.stringify(row).includes("Jane"), false, "raw value is never stored");
  for (const valid of ["5556001", "p5556002", "P-5556003", "P5556004 new", " RF5556005 "]) {
    const ok = await bookingDoc(valid).save();
    assert.equal((await checks(ok._id)).length, 0, valid);
  }
  assert.equal((await BookedLead.findById(bad._id).lean())?.normalized_job_no, "JANE CUSTOMER");
});

test("model hook: an unknown control value stays shadow; enforce rejects creates and job changes with 422", async (t) => {
  if (!skipUnlessReady(t)) return;
  const legacy = await bookingDoc("EJBA03-LL-20260908-A").save();
  await setMode("enforce_typo" as BookingJobNumberMode);
  await bookingDoc("Another Name").save();
  await setMode("enforce");
  await assert.rejects(bookingDoc("Jane Customer").save(), isJobNumberError("no_digits"));
  await assert.rejects(bookingDoc(undefined).save(), isJobNumberError("missing"));
  await assert.rejects(bookingDoc("EJBA03-LL-20260908-B").save(), isJobNumberError("multiple_numbers"));
  // An untouched legacy value never blocks an unrelated edit (cancellation, deposit, deletion).
  legacy.deposit_amount = 650;
  await legacy.save();
  legacy.job_no = "Still A Name";
  await assert.rejects(legacy.save(), isJobNumberError("no_digits"));
  legacy.job_no = uniqueJob();
  await legacy.save();
  assert.equal((await BookedLead.findById(legacy._id).lean())?.normalized_job_no, legacy.job_no);
  await setMode(null);
});

test("model hook: query updates that set job_no are checked and keep normalized_job_no in step", async (t) => {
  if (!skipUnlessReady(t)) return;
  const row = await bookingDoc(uniqueJob()).save();
  await setMode("enforce");
  await assert.rejects(
    BookedLead.updateOne({ _id: row._id }, { $set: { job_no: "Jane Customer" } }).exec(),
    isJobNumberError("no_digits"),
  );
  await BookedLead.updateOne({ _id: row._id }, { $set: { job_no: " p-5557001 " } }).exec();
  assert.equal((await BookedLead.findById(row._id).lean())?.normalized_job_no, "P 5557001");
  await setMode(null);
  await BookedLead.findOneAndUpdate({ _id: row._id }, { $set: { job_no: "Query Customer" } }).exec();
  const after = await BookedLead.findById(row._id).lean();
  assert.equal(after?.normalized_job_no, "QUERY CUSTOMER");
  assert.equal((await checks(row._id))[0]?.write_path, "update_query");
});

test("shadow record is written in the caller's transaction: an aborted write leaves none", async (t) => {
  if (!skipUnlessReady(t)) return;
  await setMode(null);
  const doc = bookingDoc("Aborted Name");
  await assert.rejects(
    withTransaction(async (session) => {
      await doc.save({ session });
      assert.equal((await db().collection(BOOKING_JOB_NUMBER_CHECKS_COLLECTION).countDocuments({ booking_id: String(doc._id) }, { session })), 1);
      throw new Error("injected abort");
    }),
    /injected abort/,
  );
  assert.equal((await checks(doc._id)).length, 0);
  assert.equal(await BookedLead.countDocuments({ _id: doc._id }), 0);
});

test("createLeadlessBooking: enforce answers 422 and writes nothing; shadow writes and records", async (t) => {
  if (!skipUnlessReady(t)) return;
  const data = (job_no: string) => ({
    book_date: "2026-11-20", job_no, source_company: "main_site", agent: AGENT,
    total_binder_amount: 100, deposit_amount: 500, merchant: MERCHANT, local: "long_distance",
  });
  await setMode("enforce");
  const before = await BookedLead.countDocuments();
  await assert.rejects(runExistingCreateLeadlessBooking({ data: data("Leadless Customer"), context: context("lls-enf") }), isJobNumberError("no_digits"));
  assert.equal(await BookedLead.countDocuments(), before);
  const valid = await runExistingCreateLeadlessBooking({ data: data(`${uniqueJob()} vip`), context: context("lls-ok") });
  assert.equal(valid.command.status, "applied");
  await setMode(null);
  await runExistingCreateLeadlessBooking({ data: data("Shadow Customer"), context: context("lls-sh") });
  assert.equal(await BookedLead.countDocuments(), before + 2);
  const recorded = await db().collection(BOOKING_JOB_NUMBER_CHECKS_COLLECTION).find({ write_path: "create_leadless_booking", reason: "no_digits" }).toArray();
  assert.ok(recorded.length >= 1);
});

test("createExistingReferralBooking: enforce answers 422", async (t) => {
  if (!skipUnlessReady(t)) return;
  const data = (job_no: string) => ({
    book_date: "2026-11-20", job_no, customer_name: "Referral Synthetic", agent: AGENT,
    total_binder_amount: 100, deposit_amount: 500, merchant: MERCHANT, local: "long_distance",
  });
  await setMode("enforce");
  await assert.rejects(runExistingCreateReferralBooking({ data: data("12"), context: context("ref-enf") }), isJobNumberError("digit_core_length"));
  const ok = await runExistingCreateReferralBooking({ data: data(uniqueJob()), context: context("ref-ok") });
  assert.equal(ok.command.status, "applied");
  await setMode(null);
});

test("createBookingFromLead and updateBookedLead: enforce answers 422; a valid correction applies", async (t) => {
  if (!skipUnlessReady(t)) return;
  const lead = await formLead();
  const data = (job_no?: string) => ({
    book_date: "2026-11-20", ...(job_no === undefined ? {} : { job_no }), lead_ref: lead._id.toString(), lead_model: "FormLead",
    agent_allocations: [{ agent_name: AGENT, binder_amount: 100 }], total_binder_amount: 100,
    deposit_amount: 500, merchant: MERCHANT, source: "main_site", local: "long_distance",
  });
  await setMode("enforce");
  await assert.rejects(runExistingCreateBookingFromLead({ data: data("Jane Customer"), context: context("bfl-enf") }), isJobNumberError("no_digits"));
  await assert.rejects(runExistingCreateBookingFromLead({ data: data(undefined), context: context("bfl-miss") }), isJobNumberError("missing"));
  assert.equal(await BookedLead.countDocuments({ lead_ref: lead._id }), 0);
  const created = await runExistingCreateBookingFromLead({ data: data(uniqueJob()), context: context("bfl-ok") });
  const bookingId = created.command.entity_refs.find((ref) => ref.model === "BookedLead")!.id;
  await assert.rejects(
    runExistingUpdateBookedLead({ booking_id: bookingId, patch: { job_no: "Jane Customer" }, context: context("ubl-enf") }),
    isJobNumberError("no_digits"),
  );
  const corrected = uniqueJob();
  await runExistingUpdateBookedLead({ booking_id: bookingId, patch: { job_no: corrected.toLowerCase() }, context: context("ubl-ok") });
  assert.equal((await BookedLead.findById(bookingId).lean())?.normalized_job_no, corrected);
  await setMode(null);
});

test("submitEmployeeBooking and updatePendingEmployeeBooking: enforce answers 422; valid input still books", async (t) => {
  if (!skipUnlessReady(t)) return;
  const submission = (job_no: string) => ({
    submission_id: randomUUID(), lead_source_company_id: companyId, source_granularity_key: "main_site_form",
    agent: AGENT, lead_name: "Employee Synthetic", binder_amount: 100, deposit_amount: 500, merchant: MERCHANT,
    phone_number: `55511${String(++seq).padStart(5, "0")}`, job_no,
  });
  await setMode("enforce");
  await assert.rejects(submitEmployeeBooking(submission("Employee Customer")), isJobNumberError("no_digits"));
  const booked = await submitEmployeeBooking(submission(`#${uniqueJob().toLowerCase()}`));
  assert.equal(booked.outcome, "booked_pending_lead");
  const caseDoc = await BookingLeadReconciliationCase.findOne({ booking: booked.booking_id }).lean();
  assert.ok(caseDoc);
  const actor = { actor: "owner:jobno-replica" };
  await assert.rejects(
    updatePendingEmployeeBooking(String(caseDoc._id), { revision: caseDoc.revision ?? 0, job_no: "Pending Customer" } as never, actor),
    isJobNumberError("no_digits"),
  );
  const next = uniqueJob();
  await updatePendingEmployeeBooking(String(caseDoc._id), { revision: caseDoc.revision ?? 0, job_no: `${next} new` } as never, actor);
  assert.equal((await BookedLead.findById(booked.booking_id).lean())?.normalized_job_no, `${next} NEW`);
  await setMode(null);
});
