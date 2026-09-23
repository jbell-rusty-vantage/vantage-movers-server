import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { assertCommandContext } from "./commandContext";
import {
  BOOKING_LEAD_MIRROR_ACTOR_ID,
  emitLeadChange,
  EMPLOYEE_BOOKING_SUBMISSION_ACTOR_ID,
  ownerLeadChangeContext,
  ringCentralCallLeadCreateContext,
  systemLeadChangeContext,
} from "./leadChangeEmission";

const SERVICES = path.join(__dirname, "..");

test("LP-03 E3 RingCentral create context is a valid ringcentral-origin canonical context", async () => {
  const context = ringCentralCallLeadCreateContext({
    lead_id: "65f000000000000000000001",
    telephony_session_id: "s-123",
    call_log_id: "log-9",
    ingestion_source: "webhook",
  });
  assert.equal(context.provenance.origin, "ringcentral");
  assert.equal(context.actor.actor_id, "ringcentral-call-ingest");
  assert.equal(context.initiator.actor_id, "ringcentral-call-ingest");
  assert.equal(context.provenance.source_receipt_id, "s-123");
  assert.equal(context.provenance.source_connection_key, "ringcentral:webhook:s-123");
  let verified: unknown;
  await assertCommandContext(context, {
    verifyRingCentralTelephony: async (input) => {
      verified = input;
      return true;
    },
  });
  assert.deepEqual(verified, {
    source_receipt_id: "s-123",
    source_connection_key: "ringcentral:webhook:s-123",
  });
});

test("LP-03 E3 RingCentral create context falls back to the Call Log id, then the Lead id", () => {
  assert.equal(
    ringCentralCallLeadCreateContext({
      lead_id: "65f000000000000000000001",
      call_log_id: "log-9",
      ingestion_source: "call_log_sync",
    }).provenance.source_connection_key,
    "ringcentral:call_log_sync:log-9",
  );
  assert.equal(
    ringCentralCallLeadCreateContext({ lead_id: "65f000000000000000000001" })
      .provenance.source_receipt_id,
    "call-lead:65f000000000000000000001",
  );
});

test("LP-03 E10 Owner reconciliation context is a trusted vantage_admin Owner", async () => {
  const context = ownerLeadChangeContext({
    owner: { actor: "owner:o@example.com", ownerId: "owner-1", ownerEmail: "o@example.com" },
    command_name: "resolveBookingLeadReconciliation",
    payload: { case_id: "c1" },
  });
  assert.equal(context.actor.actor_type, "owner");
  assert.equal(context.actor.actor_id, "owner-1");
  await assertCommandContext(context);
});

test("LP-03 E10 fixed system contexts carry the named actor and a SHA-256 checksum", () => {
  const context = systemLeadChangeContext({
    actor_id: EMPLOYEE_BOOKING_SUBMISSION_ACTOR_ID,
    command_name: "submitEmployeeBooking",
    request_id: "sub-1",
    payload: { submission_id: "sub-1" },
  });
  assert.equal(context.actor.actor_type, "system");
  assert.equal(context.actor.actor_id, EMPLOYEE_BOOKING_SUBMISSION_ACTOR_ID);
  assert.equal(context.actor.request_id, "sub-1");
  assert.equal(context.provenance.origin, "vantage_admin");
  assert.match(context.payload_checksum, /^[a-f0-9]{64}$/);
  const fallback = ownerLeadChangeContext({
    owner: { actor: "cron" },
    command_name: "x",
  });
  assert.equal(fallback.actor.actor_id, BOOKING_LEAD_MIRROR_ACTOR_ID);
});

test("LP-03 a semantic no-op emits nothing", async () => {
  const lead = { booked: "b1", over_2000: false, domain_revision: 3 };
  const stamp = await emitLeadChange({
    model: "FormLead",
    id: "65f000000000000000000001",
    before: { ...lead },
    after: { ...lead },
    now: new Date(),
    command_name: "noop",
    context: systemLeadChangeContext({ actor_id: "x", command_name: "noop" }),
  });
  assert.equal(stamp, null);
});

test("LP-03 emitters import nothing from Sales Intelligence or Number activity", async () => {
  const owned = [
    "domainCommands/leadChangeEmission.ts",
    "ringcentral/ringcentral-call-lead-ingest.service.ts",
    "leads/callLead.service.ts",
    "leads/duplicateLead.service.ts",
    "bookings/bookingMirror.service.ts",
    "bookings/bookingSourceResolver.ts",
    "bookings/bookedLead.service.ts",
    "employeeBookings/bookingLeadAttachment.service.ts",
    "employeeBookings/bookingLeadReconciliation.service.ts",
    "employeeBookings/reconciliationRematch.service.ts",
    "employeeBookings/submitEmployeeBooking.service.ts",
  ];
  for (const file of owned) {
    const source = await readFile(path.join(SERVICES, file), "utf8");
    assert.doesNotMatch(source, /from "[^"]*(salesIntelligence|numberActivity)\//, file);
  }
});

test("LP-03 non-canonical writers emit; the canonical attach path does not double-emit", async () => {
  const read = (file: string) => readFile(path.join(SERVICES, file), "utf8");
  assert.match(
    await read("leads/callLead.service.ts"),
    /recordTheRingCentralLeadChange\(created, input, tx\)/,
  );
  const submit = await read("employeeBookings/submitEmployeeBooking.service.ts");
  assert.match(submit, /leadChanges\.track\(matchOutcome\.leadModel/);
  assert.match(submit, /await booking\.save\(\{ session \}\);\s+await leadChanges\.flush\(\);/);
  const reconciliation = await read("employeeBookings/bookingLeadReconciliation.service.ts");
  assert.match(reconciliation, /\{ session, now, leadChanges \}/);
  const rematch = await read("employeeBookings/reconciliationRematch.service.ts");
  assert.match(rematch, /leadChanges,\s+\}\);\s+await leadChanges\.flush\(\);/);
  // `attachBookingToLead` emits its own Lead change and calls the InTransaction
  // variant without a recorder.
  const canonical = await read("domainCommands/bookings.ts");
  assert.match(
    canonical,
    /resolveBookingLeadReconciliationInTransaction\([\s\S]*?\{ session, now \},\s*\);/,
  );
});
