import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { BookedLead } from "../../models/BookedLead";
import { CallLead } from "../../models/CallLead";
import { EntityChange } from "../../models/EntityChange";
import { deleteBookedLead } from "../bookings/bookedLead.service";
import { resolveBookingSourceLead } from "../bookings/bookingSourceResolver";
import {
  EMPLOYEE_BOOKING_SUBMISSION_ACTOR_ID,
  LeadChangeRecorder,
  systemLeadChangeContext,
} from "../domainCommands/leadChangeEmission";
import {
  attachLeadToEmployeeBooking,
  reassignEmployeeBookingLead,
} from "./bookingLeadAttachment.service";

/**
 * LP-03 (H4 / §11) replica proofs for the employee-booking mirror/link/clear
 * paths and the Booking source resolver: each affected Lead gets exactly one
 * EntityChange inside the owning transaction; the canonical path (no
 * recorder) writes none. Opt-in: LP03_REPLICA_TESTS=true, TEST_MODE=true,
 * TEST_MONGO_DATABASE_NAME=testvantagemovers_<suffix>, MONGO_URI=<replica set>;
 * run with --test-concurrency=1 (each LP-03 replica file drops the isolated DB).
 */
const ISOLATED_DB = /^testvantagemovers_[a-z0-9]+$/i;

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
  if (process.env.LP03_REPLICA_TESTS !== "true") {
    t.skip("LP-03 replica proof is opt-in via LP03_REPLICA_TESTS=true.");
    return false;
  }
  if (!ISOLATED_DB.test(getMongoDatabaseName())) {
    t.skip("LP-03 replica proof requires an isolated TEST_MONGO_DATABASE_NAME.");
    return false;
  }
  await connectMongo();
  if (!ISOLATED_DB.test(mongoose.connection.db?.databaseName ?? "")) {
    t.skip("Refusing replica-set proof against a non-isolated database.");
    return false;
  }
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello || hello.setName == null) {
    t.skip("Connected Mongo is not a replica set.");
    return false;
  }
  return true;
}

after(async () => {
  if (
    mongoose.connection.readyState === 1 &&
    ISOLATED_DB.test(mongoose.connection.db?.databaseName ?? "")
  ) {
    await mongoose.connection.db?.dropDatabase().catch(() => undefined);
  }
  await mongoose.disconnect().catch(() => undefined);
});

let phoneSeq = 0;
async function callLead(extra: Record<string, unknown> = {}) {
  phoneSeq += 1;
  return CallLead.create({
    phone_number: `55501040${String(phoneSeq).padStart(2, "0")}`,
    source_company: "main_site",
    local: "long_distance",
    timestamp: new Date(),
    ...extra,
  });
}

function bookingDoc(extra: Record<string, unknown> = {}) {
  return new BookedLead({
    book_date: new Date(),
    job_no: `LP03-${new mongoose.Types.ObjectId().toHexString().slice(-8)}`,
    agent_allocations: [
      {
        agent: new mongoose.Types.ObjectId(),
        agent_name_snapshot: "LP03 Agent",
        binder_amount: 100,
      },
    ],
    total_binder_amount: 100,
    deposit_amount: 2500,
    over_2000: true,
    over_4000: false,
    merchant: "LP03 Merchant",
    source: "LP03 Source",
    local: "long_distance",
    is_leadless_booking: true,
    ...extra,
  });
}

const prepared = {
  local: "long_distance",
  sourceDisplayLabel: "LP03 Source",
  sourceAssignment: { source_company: "main_site" },
} as any;

function recorder(session: mongoose.ClientSession) {
  return new LeadChangeRecorder({
    command_name: "lp03Test",
    context: systemLeadChangeContext({
      actor_id: EMPLOYEE_BOOKING_SUBMISSION_ACTOR_ID,
      command_name: "lp03Test",
    }),
    session,
  });
}

async function changesFor(id: unknown) {
  return EntityChange.find({ "entity.id": String(id) }).lean();
}

test("LP-03 E10 attach (claim + mirror) writes exactly one Lead change; no recorder writes none", async (t) => {
  if (!(await replicaReady(t))) return;
  const lead = await callLead();
  const booking = await bookingDoc().save();
  await mongoose.connection.transaction(async (session) => {
    const leadChanges = recorder(session);
    const live = await BookedLead.findById(booking._id).session(session);
    await attachLeadToEmployeeBooking({
      booking: live,
      prepared,
      leadModel: "CallLead",
      leadId: lead._id.toString(),
      operation: "booking_reconciliation.attach_existing",
      session,
      leadChanges,
    });
    await leadChanges.flush();
  });
  const changes = await changesFor(lead._id);
  assert.equal(changes.length, 1);
  assert.ok(changes[0]!.changed_paths.includes("booked"));
  assert.ok(changes[0]!.changed_paths.includes("over_2000"));
  assert.equal(
    changes[0]!.fields.find((field) => field.path === "booked")?.after?.toString(),
    booking._id.toString(),
  );
  assert.equal(changes[0]!.revision_before, 0);
  assert.equal((await CallLead.findById(lead._id).lean())?.domain_revision, 1);

  // The canonical attachBookingToLead path passes no recorder: no change here.
  const other = await callLead();
  const booking2 = await bookingDoc().save();
  await mongoose.connection.transaction(async (session) => {
    const live = await BookedLead.findById(booking2._id).session(session);
    await attachLeadToEmployeeBooking({
      booking: live,
      prepared,
      leadModel: "CallLead",
      leadId: other._id.toString(),
      operation: "booking_reconciliation.attach_existing",
      session,
    });
  });
  assert.equal((await changesFor(other._id)).length, 0);
  assert.equal(String((await CallLead.findById(other._id).lean())?.booked), String(booking2._id));
});

test("LP-03 §11 corrected linkage (reassign) writes one change for the old and one for the new Lead", async (t) => {
  if (!(await replicaReady(t))) return;
  const oldLead = await callLead();
  const newLead = await callLead();
  const booking = await bookingDoc({
    is_leadless_booking: false,
    lead_model: "CallLead",
    lead_ref: oldLead._id,
  }).save();
  await CallLead.updateOne({ _id: oldLead._id }, { $set: { booked: booking._id } });
  let executionId = "";
  await mongoose.connection.transaction(async (session) => {
    const leadChanges = recorder(session);
    executionId = leadChanges.command_execution_id.toString();
    const live = await BookedLead.findById(booking._id).session(session);
    await reassignEmployeeBookingLead({
      booking: live,
      prepared,
      nextLeadModel: "CallLead",
      nextLeadId: newLead._id.toString(),
      session,
      leadChanges,
    });
    await leadChanges.flush();
  });
  const oldChanges = await changesFor(oldLead._id);
  const newChanges = await changesFor(newLead._id);
  assert.equal(oldChanges.length, 1);
  assert.equal(newChanges.length, 1);
  assert.ok(oldChanges[0]!.changed_paths.includes("booked"));
  assert.equal(
    oldChanges[0]!.fields.find((field) => field.path === "booked")?.after,
    undefined,
  );
  assert.ok(newChanges[0]!.changed_paths.includes("booked"));
  assert.equal(String(oldChanges[0]!.command_execution_id), executionId);
  assert.equal(String(newChanges[0]!.command_execution_id), executionId);
});

test("LP-03 E10 a Lead created then attached in one transaction gets one create change", async (t) => {
  if (!(await replicaReady(t))) return;
  const booking = await bookingDoc().save();
  let leadId = "";
  await mongoose.connection.transaction(async (session) => {
    const leadChanges = recorder(session);
    const created = new CallLead({
      phone_number: "5550104999",
      source_company: "main_site",
      local: "long_distance",
      timestamp: new Date(),
    });
    await created.save({ session });
    leadId = created._id.toString();
    leadChanges.trackCreated("CallLead", leadId);
    const live = await BookedLead.findById(booking._id).session(session);
    await attachLeadToEmployeeBooking({
      booking: live,
      prepared,
      leadModel: "CallLead",
      leadId,
      operation: "booking_reconciliation.create_and_attach",
      session,
      leadChanges,
    });
    await leadChanges.flush();
  });
  const changes = await changesFor(leadId);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.revision_before, 0);
  assert.ok(changes[0]!.changed_paths.includes("phone_number"));
  assert.ok(changes[0]!.changed_paths.includes("booked"));
});

test("LP-03 §11 compatibility Booking delete (customer cascade) writes one Lead change clearing booked", async (t) => {
  if (!(await replicaReady(t))) return;
  const previousMode = process.env.SHEET_SYNC_MODE;
  process.env.SHEET_SYNC_MODE = "queued";
  t.after(() => {
    if (previousMode === undefined) delete process.env.SHEET_SYNC_MODE;
    else process.env.SHEET_SYNC_MODE = previousMode;
  });
  const lead = await callLead();
  const booking = await bookingDoc({
    is_leadless_booking: false,
    lead_model: "CallLead",
    lead_ref: lead._id,
  }).save();
  await CallLead.updateOne(
    { _id: lead._id },
    { $set: { booked: booking._id, over_2000: true } },
  );
  await deleteBookedLead(booking._id.toString(), false);
  const changes = await changesFor(lead._id);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.command_name, "deleteBookedLead");
  assert.ok(changes[0]!.changed_paths.includes("booked"));
  assert.ok(changes[0]!.changed_paths.includes("over_2000"));
  assert.equal(await BookedLead.countDocuments({ _id: booking._id }), 0);
});

test("LP-03 E10 Booking source resolver writes in the caller's session and stamps the returned Lead", async (t) => {
  if (!(await replicaReady(t))) return;
  const jobNo = `LP03J${Date.now()}`;
  const lead = await callLead({ job_no: jobNo });
  let returnedRevision: unknown;
  await mongoose.connection.transaction(async (session) => {
    const resolved = await resolveBookingSourceLead(
      {
        lead_type: "CallLead",
        call_job_no: jobNo,
        call_phone_number: "5550104888",
      } as any,
      { session },
    );
    returnedRevision = resolved.lead.domain_revision;
  });
  const changes = await changesFor(lead._id);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.command_name, "correctBookingSourceCallLead");
  assert.ok(changes[0]!.changed_paths.includes("phone_number"));
  assert.equal(returnedRevision, 1);
  assert.equal((await CallLead.findById(lead._id).lean())?.domain_revision, 1);

  // Same phone again: semantic no-op, no change.
  await mongoose.connection.transaction(async (session) => {
    await resolveBookingSourceLead(
      {
        lead_type: "CallLead",
        call_job_no: jobNo,
        call_phone_number: "5550104888",
      } as any,
      { session },
    );
  });
  assert.equal((await changesFor(lead._id)).length, 1);
});
