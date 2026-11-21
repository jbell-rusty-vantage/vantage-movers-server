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
  BOOKING_JOB_NORMALIZATION_STATE_ID,
  runBookingJobNormalizationInvariant,
} from "./bookingJobNormalizationInvariant";
import {
  BOOKING_JOB_NUMBER_CHECKS_COLLECTION,
  BOOKING_JOB_NUMBER_CONTROL_COLLECTION,
  BOOKING_JOB_NUMBER_CONTROL_ID,
  BookingJobNumberError,
  markGranotLifecycleBookingWrite,
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
/** Owner, 2026-11-21: in enforce only `missing` blocks, and only from a non-Granot write. */
const isMissingJobNumber = isJobNumberError("missing");
/** Passes the routes' non-empty Zod rule but normalizes to empty: a missing Job Number. */
const MISSING = "--";
/** One recorded-only enforce row for this Booking and reason, with its exemption. */
async function assertRecordedOnly(bookingId: unknown, reason: string, exemption = "reason_not_enforced") {
  const rows = (await checks(bookingId)).filter((row) => row.reason === reason);
  assert.equal(rows.length, 1, `${reason} recorded for ${String(bookingId)}`);
  assert.deepEqual([rows[0]?.verdict, rows[0]?.mode, rows[0]?.enforced, rows[0]?.exemption], ["would_reject", "enforce", false, exemption]);
}

test("model hook: shadow (missing control) records a would-reject and saves; valid values record nothing", async (t) => {
  if (!skipUnlessReady(t)) return;
  await setMode(null);
  const bad = await bookingDoc("Jane Customer").save();
  const [row, ...rest] = await checks(bad._id);
  assert.equal(rest.length, 0);
  assert.equal(row?.verdict, "would_reject");
  assert.equal(row?.reason, "no_digits");
  assert.equal(row?.write_path, "create_leadless_booking");
  assert.equal("enforced" in row! || "exemption" in row!, false, "shadow records are unchanged");
  assert.equal(JSON.stringify(row).includes("Jane"), false, "raw value is never stored");
  for (const valid of ["5556001", "p5556002", "P-5556003", "P5556004 new", " RF5556005 "]) {
    const ok = await bookingDoc(valid).save();
    assert.equal((await checks(ok._id)).length, 0, valid);
  }
  assert.equal((await BookedLead.findById(bad._id).lean())?.normalized_job_no, "JANE CUSTOMER");
});

test("model hook: an unknown control value stays shadow; enforce blocks only a missing Job Number and records the rest", async (t) => {
  if (!skipUnlessReady(t)) return;
  const legacy = await bookingDoc("EJBA03-LL-20260908-A").save();
  await setMode("enforce_typo" as BookingJobNumberMode);
  await bookingDoc(undefined).save();
  await setMode("enforce");
  for (const [value, reason] of [["Enforce Customer", "no_digits"], ["EJBA03-LL-20260908-B", "multiple_numbers"], ["5556759A", "mixed_token"], ["123", "digit_core_length"]]) {
    await assertRecordedOnly((await bookingDoc(value).save())._id, reason!);
  }
  const blocked = bookingDoc(undefined);
  await assert.rejects(withTransaction((session) => blocked.save({ session })), isMissingJobNumber);
  assert.equal(await BookedLead.countDocuments({ _id: blocked._id }), 0);
  // The blocked record survives the aborted transaction: it is written outside it.
  const [rejected] = await checks(blocked._id);
  assert.deepEqual([rejected?.verdict, rejected?.enforced, rejected?.exemption, String(rejected?._id).endsWith(":rejected")], ["rejected", true, null, true]);
  await assert.rejects(bookingDoc("   ").save(), isMissingJobNumber);
  // A Granot lifecycle document is never blocked, even without a Job Number; the marker, not a field, decides.
  const granot = bookingDoc(undefined);
  markGranotLifecycleBookingWrite(granot);
  await assertRecordedOnly((await granot.save())._id, "missing", "granot_lifecycle");
  // An untouched legacy value never blocks an unrelated edit (cancellation, deposit, deletion).
  legacy.deposit_amount = 650;
  await legacy.save();
  legacy.job_no = "Still A Name";
  await legacy.save();
  await assertRecordedOnly(legacy._id, "no_digits");
  legacy.job_no = MISSING;
  await assert.rejects(legacy.save(), isMissingJobNumber);
  legacy.job_no = uniqueJob();
  await legacy.save();
  assert.equal((await BookedLead.findById(legacy._id).lean())?.normalized_job_no, legacy.job_no);
  await setMode(null);
});

test("model hook: query updates that set job_no are checked and keep normalized_job_no in step", async (t) => {
  if (!skipUnlessReady(t)) return;
  const row = await bookingDoc(uniqueJob()).save();
  await setMode("enforce");
  await BookedLead.updateOne({ _id: row._id }, { $set: { job_no: "Update Customer" } }).exec();
  await assertRecordedOnly(row._id, "no_digits");
  await assert.rejects(BookedLead.updateOne({ _id: row._id }, { $set: { job_no: MISSING } }).exec(), isMissingJobNumber);
  await BookedLead.updateOne({ _id: row._id }, { $set: { job_no: " p-5557001 " } }).exec();
  assert.equal((await BookedLead.findById(row._id).lean())?.normalized_job_no, "P 5557001");
  await setMode(null);
  // Same length as the enforce value, so the shadow write lands on (and cleans) the same record.
  await BookedLead.findOneAndUpdate({ _id: row._id }, { $set: { job_no: "Query Customers" } }).exec();
  const after = await BookedLead.findById(row._id).lean();
  assert.equal(after?.normalized_job_no, "QUERY CUSTOMERS");
  const shadowRow = (await checks(row._id)).find((r) => r.reason === "no_digits");
  assert.deepEqual([shadowRow?.write_path, shadowRow?.mode, "enforced" in shadowRow!], ["update_query", "shadow", false]);
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

test("createLeadlessBooking: enforce answers 422 only for a missing Job Number; other values write and record", async (t) => {
  if (!skipUnlessReady(t)) return;
  const data = (job_no: string) => ({
    book_date: "2026-11-20", job_no, source_company: "main_site", agent: AGENT,
    total_binder_amount: 100, deposit_amount: 500, merchant: MERCHANT, local: "long_distance",
  });
  await setMode("enforce");
  const before = await BookedLead.countDocuments();
  await assert.rejects(runExistingCreateLeadlessBooking({ data: data(MISSING), context: context("lls-miss") }), isMissingJobNumber);
  assert.equal(await BookedLead.countDocuments(), before);
  const named = await runExistingCreateLeadlessBooking({ data: data("Leadless Customer"), context: context("lls-enf") });
  await assertRecordedOnly(named.command.entity_refs.find((ref) => ref.model === "BookedLead")!.id, "no_digits");
  const valid = await runExistingCreateLeadlessBooking({ data: data(`${uniqueJob()} vip`), context: context("lls-ok") });
  assert.equal(valid.command.status, "applied");
  await setMode(null);
  await runExistingCreateLeadlessBooking({ data: data("Shadow Customer"), context: context("lls-sh") });
  assert.equal(await BookedLead.countDocuments(), before + 3);
  const recorded = await db().collection(BOOKING_JOB_NUMBER_CHECKS_COLLECTION).find({ write_path: "create_leadless_booking", reason: "no_digits" }).toArray();
  assert.ok(recorded.length >= 1);
});

test("createExistingReferralBooking: enforce answers 422 only for a missing Job Number", async (t) => {
  if (!skipUnlessReady(t)) return;
  const data = (job_no: string) => ({
    book_date: "2026-11-20", job_no, customer_name: "Referral Synthetic", agent: AGENT,
    total_binder_amount: 100, deposit_amount: 500, merchant: MERCHANT, local: "long_distance",
  });
  await setMode("enforce");
  await assert.rejects(runExistingCreateReferralBooking({ data: data(MISSING), context: context("ref-miss") }), isMissingJobNumber);
  const short = await runExistingCreateReferralBooking({ data: data("12"), context: context("ref-enf") });
  await assertRecordedOnly(short.command.entity_refs.find((ref) => ref.model === "BookedLead")!.id, "digit_core_length");
  const ok = await runExistingCreateReferralBooking({ data: data(uniqueJob()), context: context("ref-ok") });
  assert.equal(ok.command.status, "applied");
  await setMode(null);
});

test("createBookingFromLead and updateBookedLead: enforce answers 422 only for a missing Job Number; a valid correction applies", async (t) => {
  if (!skipUnlessReady(t)) return;
  const lead = await formLead();
  const data = (job_no?: string) => ({
    book_date: "2026-11-20", ...(job_no === undefined ? {} : { job_no }), lead_ref: lead._id.toString(), lead_model: "FormLead",
    agent_allocations: [{ agent_name: AGENT, binder_amount: 100 }], total_binder_amount: 100,
    deposit_amount: 500, merchant: MERCHANT, source: "main_site", local: "long_distance",
  });
  await setMode("enforce");
  await assert.rejects(runExistingCreateBookingFromLead({ data: data(undefined), context: context("bfl-miss") }), isMissingJobNumber);
  assert.equal(await BookedLead.countDocuments({ lead_ref: lead._id }), 0);
  const created = await runExistingCreateBookingFromLead({ data: data("Lead Customer"), context: context("bfl-enf") });
  const bookingId = created.command.entity_refs.find((ref) => ref.model === "BookedLead")!.id;
  await assertRecordedOnly(bookingId, "no_digits");
  await assert.rejects(
    runExistingUpdateBookedLead({ booking_id: bookingId, patch: { job_no: MISSING }, context: context("ubl-miss") }),
    isMissingJobNumber,
  );
  const corrected = uniqueJob();
  await runExistingUpdateBookedLead({ booking_id: bookingId, patch: { job_no: corrected.toLowerCase() }, context: context("ubl-ok") });
  assert.equal((await BookedLead.findById(bookingId).lean())?.normalized_job_no, corrected);
  await setMode(null);
});

// Employee preparation already refuses a missing Job Number (ValidationError) before the guard runs.
test("submitEmployeeBooking and updatePendingEmployeeBooking: enforce records a non-missing invalid value and still books", async (t) => {
  if (!skipUnlessReady(t)) return;
  const submission = (job_no: string) => ({
    submission_id: randomUUID(), lead_source_company_id: companyId, source_granularity_key: "main_site_form",
    agent: AGENT, lead_name: "Employee Synthetic", binder_amount: 100, deposit_amount: 500, merchant: MERCHANT,
    phone_number: `55511${String(++seq).padStart(5, "0")}`, job_no,
  });
  await setMode("enforce");
  await assertRecordedOnly((await submitEmployeeBooking(submission("Employee Customer"))).booking_id, "no_digits");
  const booked = await submitEmployeeBooking(submission(`#${uniqueJob().toLowerCase()}`));
  assert.equal(booked.outcome, "booked_pending_lead");
  const caseDoc = await BookingLeadReconciliationCase.findOne({ booking: booked.booking_id }).lean();
  assert.ok(caseDoc);
  const actor = { actor: "owner:jobno-replica" };
  await updatePendingEmployeeBooking(String(caseDoc._id), { revision: caseDoc.revision ?? 0, job_no: "Pending Customer" } as never, actor);
  await assertRecordedOnly(booked.booking_id, "no_digits");
  const next = uniqueJob();
  const revised = await BookingLeadReconciliationCase.findById(caseDoc._id).lean();
  await updatePendingEmployeeBooking(String(caseDoc._id), { revision: revised?.revision ?? 0, job_no: `${next} new` } as never, actor);
  assert.equal((await BookedLead.findById(booked.booking_id).lean())?.normalized_job_no, `${next} NEW`);
  await setMode(null);
});

test("query hook: $setOnInsert, $unset and replacements are checked; pipeline and $rename are refused; ids are safe", async (t) => {
  if (!skipUnlessReady(t)) return;
  const row = await bookingDoc(uniqueJob()).save();
  await setMode("enforce");
  const upsertId = new mongoose.Types.ObjectId();
  await assert.rejects(
    BookedLead.updateOne({ _id: upsertId }, { $setOnInsert: { job_no: MISSING } }, { upsert: true }).exec(),
    isMissingJobNumber,
  );
  await assert.rejects(BookedLead.updateOne({ _id: row._id }, { $unset: { job_no: 1 } }).exec(), isMissingJobNumber);
  await assert.rejects(BookedLead.replaceOne({ _id: row._id }, { ...row.toObject(), job_no: "   " }).exec(), isMissingJobNumber);
  await BookedLead.replaceOne({ _id: row._id }, { ...row.toObject(), job_no: "Replace Customer" }).exec();
  await assertRecordedOnly(row._id, "no_digits");
  await assert.rejects(BookedLead.updateOne({ _id: row._id }, [{ $set: { job_no: "x" } }], { updatePipeline: true } as never).exec(), /pipeline updates are not supported/);
  await assert.rejects(BookedLead.updateOne({ _id: row._id }, { $rename: { job_no: "old_job_no" } }).exec(), /\$rename of job_no/);
  const replacementJob = uniqueJob();
  await BookedLead.replaceOne({ _id: row._id }, { ...row.toObject(), job_no: ` ${replacementJob.toLowerCase()} ` }).exec();
  assert.equal((await BookedLead.findById(row._id).lean())?.normalized_job_no, replacementJob);
  await setMode(null);
  await BookedLead.updateMany({ _id: { $in: [row._id] } }, { $set: { job_no: "Many Customer" } }).exec();
  const recorded = await db().collection(BOOKING_JOB_NUMBER_CHECKS_COLLECTION).find({ write_path: "update_query", reason: "no_digits", booking_id: null }).toArray();
  assert.ok(recorded.some((r) => String(r._id).startsWith("unknown:no_digits:")), "a non-scalar _id filter is recorded as unknown, never [object Object]");
  assert.equal(await db().collection(BOOKING_JOB_NUMBER_CHECKS_COLLECTION).countDocuments({ _id: { $regex: "object" } } as never), 0);
});

test("normalization invariant: counts missing or disagreeing keys, stores the result, logs, and throttles itself", async (t) => {
  if (!skipUnlessReady(t)) return;
  const raw = db().collection("booked_leads");
  const consistent = await bookingDoc(` ${uniqueJob().toLowerCase()} new`).save();
  const missing = new mongoose.Types.ObjectId(), stale = new mongoose.Types.ObjectId();
  await raw.insertMany([
    { _id: missing, job_no: "P7999001" },
    { _id: stale, job_no: "P7999002", normalized_job_no: "P7999003" },
  ]);
  await db().collection(BOOKING_JOB_NUMBER_CONTROL_COLLECTION).deleteOne({ _id: BOOKING_JOB_NORMALIZATION_STATE_ID } as never);
  const now = new Date();
  const first = await runBookingJobNormalizationInvariant(db(), now);
  assert.deepEqual(first, { skipped: false, drift_count: 2 });
  const state = await db().collection(BOOKING_JOB_NUMBER_CONTROL_COLLECTION).findOne({ _id: BOOKING_JOB_NORMALIZATION_STATE_ID } as never);
  assert.deepEqual(new Set((state as unknown as { booking_ids: string[] }).booking_ids), new Set([String(missing), String(stale)]));
  assert.equal(((state as unknown as { booking_ids: string[] }).booking_ids).includes(String(consistent._id)), false);
  assert.deepEqual(await runBookingJobNormalizationInvariant(db(), new Date(now.getTime() + 10 * 60_000)), { skipped: true });
  await raw.deleteMany({ _id: { $in: [missing, stale] } });
  assert.deepEqual(await runBookingJobNormalizationInvariant(db(), new Date(now.getTime() + 60 * 60_000)), { skipped: false, drift_count: 0 });
});
