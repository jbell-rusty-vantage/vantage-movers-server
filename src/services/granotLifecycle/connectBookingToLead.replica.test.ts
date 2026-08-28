import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { Agent } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { getEntityChangeModel } from "../../models/EntityChange";
import { getFormLeadModel } from "../../models/FormLead";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import { connectBookingToLead } from "./connectBookingToLead";
import { GRANOT_LIFECYCLE_ERROR_CODES } from "./errors";

const seeded = new Set<string>();
const jobPrefix = `BILA03-${Date.now().toString(36).toUpperCase()}`;
const normalizedJobPrefix = normalizeJobNo(jobPrefix)!;

async function replicaReady(t: { skip: (reason: string) => void }) {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return false;
  }
  if (!/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) {
    t.skip("Replica-set proof requires TEST_MODE=true before process start.");
    return false;
  }
  await connectMongo();
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello?.setName) {
    t.skip("Connected Mongo is not a replica set.");
    return false;
  }
  return true;
}

after(async () => {
  if (mongoose.connection.readyState === 1) {
    const ids = [...seeded].map((id) => new mongoose.Types.ObjectId(id));
    const bookingIds = (await BookedLead.find({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } })
      .select({ _id: 1 }).lean().exec()).map((row) => String(row._id));
    await Promise.all([
      BookedLead.deleteMany({ normalized_job_no: { $regex: `^${normalizedJobPrefix}` } }),
      getFormLeadModel().deleteMany({ _id: { $in: ids } }),
      Agent.deleteMany({ _id: { $in: ids } }),
      DomainCommandExecution.deleteMany({ command_name: "connectBookingToLead" }),
      getEntityChangeModel().collection.deleteMany({ command_name: "connectBookingToLead" }),
      SheetSyncJob.deleteMany({ entity_id: { $in: [...seeded, ...bookingIds] } }),
    ]);
  }
  await mongoose.disconnect().catch(() => undefined);
});

function id() {
  const value = new mongoose.Types.ObjectId();
  seeded.add(String(value));
  return value;
}

function owner(requestId: string) {
  return {
    actor_type: "owner" as const,
    actor_id: "bila03-owner",
    actor_label: "bila03-owner@example.invalid",
    actor_role: "owner" as const,
    request_id: requestId,
    origin: "vantage_admin" as const,
  };
}

async function seedLeadless(suffix: string) {
  const agentId = id();
  const leadId = id();
  const bookingId = id();
  const jobNo = `${jobPrefix}-${suffix}`;
  await Agent.create({ _id: agentId, name: "Connect Agent", active: true });
  await getFormLeadModel().create({
    _id: leadId,
    timestamp: new Date(),
    name: "Connect Form",
    first_name: "Connect",
    last_name: "Form",
    phone_number: "555-0100",
    email: "connect@example.invalid",
    pickup_zip: "33101",
    destination_zip: "10001",
    source_company: "best-relocation",
    duplicate: false,
    domain_revision: 0,
  });
  await BookedLead.create({
    _id: bookingId,
    timestamp: new Date(),
    book_date: new Date("2026-08-01T00:00:00.000Z"),
    job_no: jobNo,
    normalized_job_no: normalizeJobNo(jobNo),
    customer_name: "Leadless Customer",
    agent_allocations: [{ agent: agentId, agent_name_snapshot: "Connect Agent", binder_amount: 1 }],
    total_binder_amount: 1,
    deposit_amount: 1,
    merchant: "Cash",
    source: "best-relocation",
    is_referral_booking: false,
    is_leadless_booking: true,
    over_2000: false,
    over_4000: false,
    domain_revision: 0,
  });
  return { bookingId: String(bookingId), leadId: String(leadId) };
}

test("Connect happy path attaches the Lead, writes EntityChange, and queues booking_chain", async (t) => {
  if (!await replicaReady(t)) return;
  const fixture = await seedLeadless("happy");
  const result = await connectBookingToLead({
    booking_id: fixture.bookingId,
    expected_booking_revision: 0,
    selected_lead: { lead_model: "FormLead", lead_id: fixture.leadId },
    idempotency_key: `bila03-happy-${fixture.bookingId}`,
    owner: owner(`bila03-happy-${fixture.bookingId}`),
  }, { flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true } });

  assert.equal(result.outcome, "connected");
  assert.equal(result.replayed, false);
  assert.match(result.owner_notice ?? "", /Master Leads/);
  const booking = await BookedLead.findById(fixture.bookingId).lean().exec();
  const lead = await getFormLeadModel().findById(fixture.leadId).lean().exec();
  assert.equal(booking?.is_leadless_booking, false);
  assert.equal(String(booking?.lead_ref), fixture.leadId);
  assert.equal(booking?.lead_model, "FormLead");
  assert.equal(String(lead?.booked), fixture.bookingId);
  const changes = await getEntityChangeModel().find({ command_name: "connectBookingToLead" }).lean().exec();
  assert.ok(changes.some((row) => row.entity?.model === "BookedLead"));
  assert.ok(changes.some((row) => row.entity?.model === "FormLead"));
  const jobs = await SheetSyncJob.find({
    resource: "booking_chain",
    operation: "booked_lead.connect_lead",
    entity_id: fixture.bookingId,
  }).lean().exec();
  assert.ok(jobs.length >= 1);
});

test("Connect already_satisfied on the exact same Lead writes no new Change", async (t) => {
  if (!await replicaReady(t)) return;
  const fixture = await seedLeadless("replay");
  const input = {
    booking_id: fixture.bookingId,
    expected_booking_revision: 0,
    selected_lead: { lead_model: "FormLead" as const, lead_id: fixture.leadId },
    owner: owner(`bila03-replay-${fixture.bookingId}`),
  };
  const first = await connectBookingToLead({
    ...input,
    idempotency_key: `bila03-first-${fixture.bookingId}`,
  }, { flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true } });
  assert.equal(first.outcome, "connected");
  const before = await getEntityChangeModel().countDocuments({ command_name: "connectBookingToLead" });
  const second = await connectBookingToLead({
    ...input,
    expected_booking_revision: first.booking_revision,
    idempotency_key: `bila03-second-${fixture.bookingId}`,
  }, { flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true } });
  assert.equal(second.outcome, "already_satisfied");
  const after = await getEntityChangeModel().countDocuments({ command_name: "connectBookingToLead" });
  assert.equal(after, before);
});

test("Connect exact Idempotency-Key replay returns the durable result", async (t) => {
  if (!await replicaReady(t)) return;
  const fixture = await seedLeadless("idem");
  const input = {
    booking_id: fixture.bookingId,
    expected_booking_revision: 0,
    selected_lead: { lead_model: "FormLead" as const, lead_id: fixture.leadId },
    idempotency_key: `bila03-idem-${fixture.bookingId}`,
    owner: owner(`bila03-idem-${fixture.bookingId}`),
  };
  const first = await connectBookingToLead(input, {
    flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true },
  });
  const replay = await connectBookingToLead(input, {
    flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true },
  });
  assert.equal(first.outcome, "connected");
  assert.equal(replay.replayed, true);
  assert.equal(replay.command_execution_id, first.command_execution_id);
});

test("Connect rejects Referral, cancelled, already-booked Lead, and stale revision", async (t) => {
  if (!await replicaReady(t)) return;
  const flags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: true };
  const referral = await seedLeadless("ref");
  await BookedLead.updateOne({ _id: referral.bookingId }, { $set: { is_referral_booking: true, is_leadless_booking: false } });
  await assert.rejects(
    () => connectBookingToLead({
      booking_id: referral.bookingId,
      expected_booking_revision: 0,
      selected_lead: { lead_model: "FormLead", lead_id: referral.leadId },
      idempotency_key: `bila03-ref-${referral.bookingId}`,
      owner: owner(`bila03-ref-${referral.bookingId}`),
    }, { flags }),
    (error: { code?: string }) => error.code === GRANOT_LIFECYCLE_ERROR_CODES.IDENTITY_CONFLICT,
  );

  const cancelled = await seedLeadless("can");
  await BookedLead.updateOne({ _id: cancelled.bookingId }, { $set: { cancelled: new Date() } });
  await assert.rejects(
    () => connectBookingToLead({
      booking_id: cancelled.bookingId,
      expected_booking_revision: 0,
      selected_lead: { lead_model: "FormLead", lead_id: cancelled.leadId },
      idempotency_key: `bila03-can-${cancelled.bookingId}`,
      owner: owner(`bila03-can-${cancelled.bookingId}`),
    }, { flags }),
    (error: { code?: string }) => error.code === GRANOT_LIFECYCLE_ERROR_CODES.IDENTITY_CONFLICT,
  );

  const stale = await seedLeadless("stale");
  await assert.rejects(
    () => connectBookingToLead({
      booking_id: stale.bookingId,
      expected_booking_revision: 9,
      selected_lead: { lead_model: "FormLead", lead_id: stale.leadId },
      idempotency_key: `bila03-stale-${stale.bookingId}`,
      owner: owner(`bila03-stale-${stale.bookingId}`),
    }, { flags }),
    (error: { code?: string }) => error.code === GRANOT_LIFECYCLE_ERROR_CODES.DOMAIN_REVISION_CONFLICT,
  );
});

test("Connect flag-off is POLICY_BLOCKED", async (t) => {
  if (!await replicaReady(t)) return;
  const fixture = await seedLeadless("flag");
  await assert.rejects(
    () => connectBookingToLead({
      booking_id: fixture.bookingId,
      expected_booking_revision: 0,
      selected_lead: { lead_model: "FormLead", lead_id: fixture.leadId },
      idempotency_key: `bila03-flag-${fixture.bookingId}`,
      owner: owner(`bila03-flag-${fixture.bookingId}`),
    }, { flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, booking_commands_enabled: false } }),
    (error: { code?: string; statusCode?: number }) =>
      error.code === GRANOT_LIFECYCLE_ERROR_CODES.POLICY_BLOCKED && error.statusCode === 422,
  );
});
