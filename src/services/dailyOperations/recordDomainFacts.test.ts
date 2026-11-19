import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, test } from "node:test";
import { ingestRingCentralQualifiedCall } from "../ringcentral/ringcentral-call-lead-ingest.service";
import {
  recordBookingDailyOperationsFact,
  recordFormLeadDailyOperationsFact,
  recordLeadMessageAfterTwilioAccept,
} from "./recordDomainFacts";
import {
  clearCapturedDailyOperationsFacts,
  getCapturedDailyOperationsFacts,
} from "./testDailyOperationsSink";

afterEach(() => {
  clearCapturedDailyOperationsFacts();
});

function capturedKinds() {
  return getCapturedDailyOperationsFacts().map((fact) => fact.input.kind);
}

function capturedOf(kind: string) {
  return getCapturedDailyOperationsFacts().filter(
    (fact) => fact.input.kind === kind,
  );
}

function formPending(overrides: {
  reusedExistingLead?: boolean;
  duplicate?: boolean;
  pickup_zip?: string;
  pickup_state?: string | null;
  destination_zip?: string;
  delivery_state?: string | null;
  ingestion_origin?: string;
  source_company?: string;
} = {}) {
  return {
    reusedExistingLead: overrides.reusedExistingLead,
    duplicate: overrides.duplicate ?? false,
    source_company: overrides.source_company ?? "tbm_leads",
    lead: {
      _id: { toString: () => "507f1f77bcf86cd799439011" },
      name: "Ada Lovelace",
      phone_number: "5550104242",
      ingestion_origin: overrides.ingestion_origin ?? "wordpress_form",
      pickup_zip: overrides.pickup_zip ?? "33101",
      pickup_state: overrides.pickup_state === undefined ? "FL" : overrides.pickup_state,
      destination_zip: overrides.destination_zip ?? "10001",
      delivery_state: overrides.delivery_state === undefined ? "NY" : overrides.delivery_state,
      local: false,
      timestamp: new Date("2026-09-06T16:00:00.000Z"),
    },
  };
}

test("Duplicate Form increments leads.duplicate_form only", async () => {
  await recordFormLeadDailyOperationsFact(formPending({ duplicate: true }));
  const facts = capturedOf("form_lead.duplicate");
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0]?.input.metric_touches, ["leads.duplicate_form"]);
  assert.equal(
    facts[0]?.input.dedupe_key,
    "form_lead:507f1f77bcf86cd799439011:duplicate",
  );
  assert.equal(capturedOf("form_lead.created").length, 0);
});

test("quiet hours at 02:14 ET record text.deferred with 8:00 AM send_at and no messages.successful", async () => {
  const sendAt = new Date("2026-01-15T13:00:00.000Z");
  await recordLeadMessageAfterTwilioAccept({
    message: {
      _id: { toString: () => "msg-deferred" },
      to: "+15555550123",
      form_lead: { toString: () => "lead-1" },
      purpose: "quote_request_confirmation",
    },
    sendAt,
    status: "accepted",
  });
  const facts = capturedOf("text.deferred");
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.input.dedupe_key, "message:msg-deferred:deferred");
  assert.equal(facts[0]?.input.title, "Text held until 8:00 AM");
  assert.equal(facts[0]?.input.card?.text?.send_at, "2026-01-15T13:00:00.000Z");
  assert.equal(facts[0]?.input.card?.text?.deferred, true);
  assert.deepEqual(facts[0]?.input.metric_touches, ["messages.deferred"]);
  assert.equal(capturedOf("text.sent").length, 0);
  assert.equal(
    facts[0]?.input.metric_touches.includes("messages.successful"),
    false,
  );
});

test("RingCentral adoption conflict records exception.adoption_conflict and not a Call Lead create", async () => {
  await ingestRingCentralQualifiedCall(
    {
      ingestionSource: "webhook",
      telephonySessionId: "u20-session",
      sessionId: "u20-session",
      partyId: "u20-party",
      callLogId: null,
      sourceCompany: "main_site",
      sourceLabel: "Synthetic Calls",
      routeResolution: {
        route_id: "507f1f77bcf86cd799439001",
        assignment_id: "507f1f77bcf86cd799439002",
        normalized_target_number: "+15550000001",
        company_id: "507f1f77bcf86cd799439003",
        company_slug: "main_site",
        company_label_snapshot: "Synthetic Company",
        granularity_id: "507f1f77bcf86cd799439004",
        granularity_key: "synthetic_calls",
        granularity_label_snapshot: "Synthetic Calls",
        crm_label_snapshot: "Synthetic Calls",
      },
      callerPhoneNumber: "5550002001",
      callerName: "Synthetic Caller",
      targetPhoneNumber: "+15550000001",
      targetName: "Synthetic Queue",
      answeredAt: new Date("2026-08-18T16:00:01.000Z"),
      terminalAt: new Date("2026-08-18T16:03:01.000Z"),
      startTime: new Date("2026-08-18T16:00:00.000Z"),
      durationSeconds: 180,
      qualificationReason: "synthetic_qualified",
    },
    new Date(),
    {
      findProcessedCall: async () => null,
      adoptionEnabled: () => true,
      assertAdoptionIndexes: async () => undefined,
      resolveWriteMode: () => "dry_run",
      attemptConvergence: async () => ({ outcome: "conflict" }),
      classifyDuplicate: async () => ({
        isDuplicate: false,
        reason: "unique",
        existingLeadId: null,
        windowDays: 90,
        matchCount: 0,
      }),
      upsertProcessedCall: async () => undefined,
      recordEvent: async () => null,
    },
  );
  assert.deepEqual(capturedKinds(), ["exception.adoption_conflict"]);
  assert.equal(
    capturedOf("exception.adoption_conflict")[0]?.input.dedupe_key,
    "exception:adoption_conflict:ringcentral:u20-session",
  );
  assert.equal(capturedOf("call_lead.created").length, 0);
});

test("employee pending booking increments employee_pending and not a kind bucket", async () => {
  await recordBookingDailyOperationsFact({
    bookingId: "booking-pending",
    bookingKind: "employee_pending",
    employeePending: true,
    customer_name: "Ada",
    phone: "2125550101",
    job_no: "EBR-1",
  });
  const facts = capturedOf("booking.employee_pending");
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0]?.input.metric_touches, [
    "bookings.total",
    "bookings.employee_pending",
    "hourly.bookings",
  ]);
});

test("the drainer records Sheet Sync facts on synced and failed jobs, never on coalesced duplicates or deferrals", async () => {
  const source = (
    await readFile(path.join(__dirname, "../sheetSync/drainer/runSheetSyncDrain.ts"), "utf8")
  ).replace(/\r\n/g, "\n");
  const coordinator = await readFile(
    path.join(__dirname, "../sheetSync/sheetSyncCoordinator.ts"),
    "utf8",
  );
  assert.equal(source.match(/recordJobCompletedFact\(job\)/g)?.length, 2);
  assert.match(source, /recordSheetSyncDailyOperationsFact\(\{\s*job,\s*outcome: "failed"/);
  // Duplicate-key subscriber statuses and representative-only emission are
  // behaviorally qualified by ops/sheet-sync-recovery/replica.ts. The old
  // unconditional duplicate-finalization loop must not be required here.
  const deferStart = source.indexOf("else if (anyDeferred)");
  const deferBranch = source.slice(deferStart, source.indexOf("} else {", deferStart));
  assert.match(deferBranch, /deferJob\(job/);
  assert.doesNotMatch(deferBranch, /recordSheetSyncDailyOperationsFact|recordJobCompletedFact/);
  // Spec §15.9: finalizeSheetSync is a queue wake-up, not a job outcome.
  assert.doesNotMatch(coordinator, /recordSheetSyncDailyOperationsFact/);
});
