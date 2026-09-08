import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { completeCallLeadIngestion } from "../leads/callLead.service";
import type { CallLeadIngestionInProgress } from "../leads/callLead.service";
import { dispatchOrQueuePersistedLeadMessage } from "../leadMessaging/leadMessaging.service";
import type { LeadMessageDocument } from "../../models/LeadMessage";
import { submitFormLeadToCrm } from "../crm/crm.service";
import { FormLead } from "../../models/FormLead";
import { ingestRingCentralQualifiedCall } from "../ringcentral/ringcentral-call-lead-ingest.service";
import {
  recordBookingDailyOperationsFact,
  recordCallLeadDailyOperationsFact,
  recordCancellationDailyOperationsFact,
  recordFormLeadDailyOperationsFact,
  recordLeadMessageAfterStatusCallback,
  recordLeadMessageAfterTwilioAccept,
  recordSheetSyncDailyOperationsFact,
  zipMissSides,
} from "./recordDomainFacts";
import {
  clearCapturedDailyOperationsFacts,
  getCapturedDailyOperationsFacts,
} from "./testDailyOperationsSink";
import { recordDailyOperationsFact } from "./recordDailyOperationsFact";

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

test("Form create increments leads.form + origin + company once", async () => {
  await recordFormLeadDailyOperationsFact(formPending());
  const facts = capturedOf("form_lead.created");
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0]?.input.metric_touches, [
    "leads.form",
    "leads.total",
    "hourly.leads",
    "origins.wordpress_form",
    "companies.tbm_leads.form",
    "companies.tbm_leads.total",
  ]);
  assert.equal(facts[0]?.input.dedupe_key, "form_lead:507f1f77bcf86cd799439011:created");
  assert.equal(facts[0]?.input.card?.customer_name, "Ada Lovelace");
  assert.equal(facts[0]?.input.card?.phone_last4, "4242");
  assert.equal(facts[0]?.input.card?.move?.pickup_zip, "33101");
});

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

test("reused WordPress lead does not call the writer", async () => {
  await recordFormLeadDailyOperationsFact(
    formPending({ reusedExistingLead: true }),
  );
  assert.deepEqual(getCapturedDailyOperationsFacts(), []);
});

test("zip 33101 + state not_found counts the Lead and records exception.zip_missing", async () => {
  await recordFormLeadDailyOperationsFact(
    formPending({ pickup_zip: "33101", pickup_state: "not_found" }),
  );
  assert.deepEqual(capturedKinds(), [
    "form_lead.created",
    "exception.zip_missing",
  ]);
  const lead = capturedOf("form_lead.created")[0];
  assert.ok(lead?.input.metric_touches.includes("leads.total"));
  assert.ok(lead?.input.metric_touches.includes("leads.form"));
  assert.deepEqual(lead?.input.card?.zip_miss, { pickup: true, delivery: false });
  const exception = capturedOf("exception.zip_missing")[0];
  assert.equal(
    exception?.input.dedupe_key,
    "exception:zip_missing:FormLead:507f1f77bcf86cd799439011",
  );
  assert.deepEqual(exception?.input.metric_touches, ["exceptions.zip_missing"]);
  assert.deepEqual(exception?.input.card?.zip_miss, { pickup: true, delivery: false });
  assert.equal(exception?.input.card?.exception?.code, "zip_missing");
});

test("Call unmatched increments leads.unmatched_call only", async () => {
  await recordCallLeadDailyOperationsFact({
    source_company: "main_site",
    lead: {
      _id: { toString: () => "507f1f77bcf86cd799439099" },
      name: "Ada",
      phone_number: "5550100101",
      ingestion_origin: "ringcentral",
      created_on_unmatched: true,
      duplicate: false,
    },
  });
  const facts = capturedOf("call_lead.unmatched");
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0]?.input.metric_touches, ["leads.unmatched_call"]);
  assert.equal(
    facts[0]?.input.dedupe_key,
    "call_lead:507f1f77bcf86cd799439099:unmatched",
  );
  assert.equal(capturedOf("call_lead.created").length, 0);
});

test("Call zip present + blank state is a zip miss and still counts the Lead", async () => {
  await recordCallLeadDailyOperationsFact({
    source_company: "tbm_leads",
    lead: {
      _id: { toString: () => "507f1f77bcf86cd799439088" },
      name: "Ada",
      phone_number: "5550100101",
      ingestion_origin: "vantage_admin",
      pickup_zip: "33101",
      pickup_state: "",
      delivery_zip: "10001",
      delivery_state: "NY",
    },
  });
  assert.deepEqual(capturedKinds(), [
    "call_lead.created",
    "exception.zip_missing",
  ]);
  assert.ok(
    capturedOf("call_lead.created")[0]?.input.metric_touches.includes("leads.total"),
  );
  assert.equal(
    capturedOf("exception.zip_missing")[0]?.input.dedupe_key,
    "exception:zip_missing:CallLead:507f1f77bcf86cd799439088",
  );
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

test("07:00 ET send records text.sent only", async () => {
  await recordLeadMessageAfterTwilioAccept({
    message: {
      _id: { toString: () => "msg-morning" },
      to: "+15555550123",
      form_lead: { toString: () => "lead-1" },
    },
    sendAt: undefined,
    status: "accepted",
  });
  assert.deepEqual(capturedKinds(), ["text.sent"]);
  assert.equal(
    capturedOf("text.sent")[0]?.input.dedupe_key,
    "message:msg-morning:successful",
  );
  assert.deepEqual(capturedOf("text.sent")[0]?.input.metric_touches, [
    "messages.successful",
    "hourly.messages",
  ]);
});

test("first sent/delivered after deferred records text.sent once", async () => {
  const message = {
    _id: { toString: () => "msg-held-then-sent" },
    to: "+15555550123",
    form_lead: { toString: () => "lead-1" },
  };
  await recordLeadMessageAfterTwilioAccept({
    message,
    sendAt: new Date("2026-01-15T13:00:00.000Z"),
    status: "accepted",
  });
  await recordLeadMessageAfterStatusCallback({
    message,
    providerStatus: "sent",
    applied: true,
  });
  await recordLeadMessageAfterStatusCallback({
    message,
    providerStatus: "delivered",
    applied: true,
  });
  assert.deepEqual(capturedKinds(), ["text.deferred", "text.sent", "text.sent"]);
  const sent = capturedOf("text.sent");
  assert.equal(sent.length, 2);
  assert.equal(sent[0]?.input.dedupe_key, "message:msg-held-then-sent:successful");
  assert.equal(sent[1]?.input.dedupe_key, "message:msg-held-then-sent:successful");
});

test("status callback terminal fail records text.failed", async () => {
  await recordLeadMessageAfterStatusCallback({
    message: { _id: { toString: () => "msg-fail" }, to: "+15555550123" },
    providerStatus: "undelivered",
    applied: true,
  });
  assert.deepEqual(capturedKinds(), ["text.failed"]);
  assert.equal(
    capturedOf("text.failed")[0]?.input.dedupe_key,
    "message:msg-fail:failed",
  );
});

test("unapplied status callback does not call the writer", async () => {
  await recordLeadMessageAfterStatusCallback({
    message: { _id: { toString: () => "msg-ignored" } },
    providerStatus: "sent",
    applied: false,
  });
  assert.deepEqual(getCapturedDailyOperationsFacts(), []);
});

test("dispatchOrQueue skipped path records text.skipped", async () => {
  const messageId = new mongoose.Types.ObjectId();
  await dispatchOrQueuePersistedLeadMessage({
    _id: messageId,
    form_lead: new mongoose.Types.ObjectId(),
    status: "skipped",
    skip_reason: "duplicate_lead",
    dispatch_mode: "inline",
    to: "+15555550123",
  } as LeadMessageDocument);
  const facts = capturedOf("text.skipped");
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.input.dedupe_key, `message:${messageId.toString()}:skipped`);
  assert.equal(facts[0]?.input.card?.text?.skip_reason, "duplicate_lead");
});

test("completeCallLeadIngestion records call_lead.created once via the sink", async () => {
  process.env.SHEET_SYNC_MODE = "disabled";
  const pending = {
    lead: {
      _id: { toString: () => "507f1f77bcf86cd799439011" },
      name: "Ada",
      phone_number: "5550100101",
      cpl: 40,
      cpl_resolution_status: "resolved",
      pickup_zip: null,
      delivery_zip: null,
      local: null,
      form_fill: false,
      duplicate: false,
      ingestion_origin: "vantage_admin",
    },
    job: {
      resource: "source_lead",
      operation: "call_lead.create",
      leadModel: "CallLead",
      leadId: "507f1f77bcf86cd799439011",
    },
    source_company: "tbm_leads",
    sourceAssignment: {
      source_company: "tbm_leads",
      source_granularity_id: "507f1f77bcf86cd799439012",
      source_granularity_key: "tbm_calls",
    },
    form_fill: false,
  } as unknown as CallLeadIngestionInProgress;

  await completeCallLeadIngestion(pending);

  const facts = capturedOf("call_lead.created");
  assert.equal(facts.length, 1);
  assert.ok(facts[0]?.input.metric_touches.includes("leads.call"));
  assert.ok(facts[0]?.input.metric_touches.includes("leads.total"));
  assert.ok(facts[0]?.input.metric_touches.includes("origins.vantage_admin"));
});

test("CRM HTTP fail records exception.crm_failed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("bad request", { status: 400 })) as typeof fetch;
  try {
    const lead = FormLead.hydrate({
      _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"),
      name: "Jane Customer",
      pickup_zip: "07030",
      destination_zip: "33139",
      email: "jane@example.com",
      phone_number: "555-111-2222",
      move_size: "14",
      source_company: "tbm_leads",
    });
    await submitFormLeadToCrm(lead);
    const facts = capturedOf("exception.crm_failed");
    assert.equal(facts.length, 1);
    assert.equal(
      facts[0]?.input.dedupe_key,
      "exception:crm_failed:FormLead:507f1f77bcf86cd799439011",
    );
    assert.deepEqual(facts[0]?.input.metric_touches, ["exceptions.crm_failed"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("duplicate booking submission helper is not used — skip is kind duplicate at finalize", async () => {
  await recordBookingDailyOperationsFact({
    bookingId: "booking-1",
    bookingKind: "admin",
    customer_name: "Ada",
    phone: "5550104242",
    job_no: "JOB-1",
    source_company: "tbm_leads",
  });
  const facts = capturedOf("booking.created");
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.input.dedupe_key, "booking:booking-1:created");
  assert.ok(facts[0]?.input.metric_touches.includes("bookings.total"));
  assert.ok(facts[0]?.input.metric_touches.includes("bookings.admin"));
  assert.equal(facts[0]?.input.card?.booking_kind, "admin");
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

test("cancellation.created uses cancellation:<id>:created", async () => {
  await recordCancellationDailyOperationsFact({
    cancellationId: "cancel-1",
    bookingId: "booking-1",
    job_no: "JOB-1",
  });
  const facts = capturedOf("cancellation.created");
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.input.dedupe_key, "cancellation:cancel-1:created");
  assert.deepEqual(facts[0]?.input.metric_touches, [
    "cancellations.total",
    "hourly.cancellations",
  ]);
});

test("writer sink captures without stores and does not require Mongo", async () => {
  const result = await recordDailyOperationsFact({
    kind: "form_lead.created",
    dedupe_key: "form_lead:sink:created",
    metric_touches: ["leads.form"],
  });
  assert.deepEqual(result, {
    outcome: "recorded",
    event_id: "test",
    day: result?.day,
  });
  assert.equal(capturedOf("form_lead.created").length, 1);
});

test("zipMissSides treats not_found and blank as a miss only when a zip is present", () => {
  assert.deepEqual(
    zipMissSides({
      pickup_zip: "33101",
      pickup_state: "not_found",
      delivery_zip: "",
      delivery_state: "",
    }),
    { pickup: true, delivery: false },
  );
  assert.deepEqual(
    zipMissSides({
      pickup_zip: "33101",
      pickup_state: "FL",
      delivery_zip: "10001",
      delivery_state: "NY",
    }),
    { pickup: false, delivery: false },
  );
});

test("applyBestRelocationPlan is not a Daily Operations hook site", async () => {
  const source = await readFile(
    path.join(__dirname, "../ingestion/applyPlan.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /recordDailyOperationsFact|recordDomainFacts|recordFormLeadDailyOperationsFact/);
});

test("persistLeadMessageIntent is not a Daily Operations hook site", async () => {
  const source = await readFile(
    path.join(__dirname, "../leadMessaging/leadMessaging.service.ts"),
    "utf8",
  );
  const start = source.indexOf("export async function persistLeadMessageIntent");
  assert.ok(start >= 0);
  const next = source.indexOf("\nexport async function ", start + 1);
  const body = source.slice(start, next === -1 ? undefined : next);
  assert.doesNotMatch(body, /recordLeadMessage|recordDailyOperationsFact/);
});

test("completeFormLeadIngestion hooks after the reused-lead return", async () => {
  const source = await readFile(
    path.join(__dirname, "../leads/formLead.service.ts"),
    "utf8",
  );
  const start = source.indexOf("export async function completeFormLeadIngestion");
  const next = source.indexOf("\nexport async function ", start + 1);
  const body = source.slice(start, next === -1 ? undefined : next);
  const reusedReturn = body.indexOf("reusedExistingLead");
  const hook = body.indexOf("recordFormLeadDailyOperationsFact");
  assert.ok(reusedReturn >= 0 && hook > reusedReturn);
});

test("duplicate booking finalize returns before the Daily Operations writer", async () => {
  const source = await readFile(
    path.join(__dirname, "../bookings/bookedLead.service.ts"),
    "utf8",
  );
  const start = source.indexOf(
    "export async function finalizeBookedLeadCreateAfterCommit",
  );
  const next = source.indexOf("\nexport async function ", start + 1);
  const body = source.slice(start, next === -1 ? undefined : next);
  assert.ok(body.indexOf('outcome.kind === "duplicate"') < body.indexOf("recordBookingDailyOperationsFact"));
});

test("Sheet Sync job outcomes record one deduped fact per job and outcome with a metric touch", async () => {
  const jobId = new mongoose.Types.ObjectId();
  const job = {
    _id: jobId,
    resource: "source_lead",
    operation: "form_lead.create",
    entity_model: "FormLead",
    entity_id: "lead-1",
    attempts: 0,
  };
  await recordSheetSyncDailyOperationsFact({
    job,
    outcome: "failed",
    attempts: 1,
    error: "quota",
  });
  await recordSheetSyncDailyOperationsFact({ job, outcome: "completed" });

  const failed = capturedOf("sheet_sync.failed");
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.input.dedupe_key, `sheet_sync:${jobId.toString()}:failed`);
  assert.deepEqual(failed[0]!.input.metric_touches, ["sheet_sync.failed"]);
  assert.equal(failed[0]!.input.entity_type, "SheetSyncJob");
  assert.deepEqual(failed[0]!.input.links, { lead_id: "lead-1", lead_model: "FormLead" });
  assert.deepEqual(failed[0]!.input.card, {
    sheet_sync: {
      resource: "source_lead",
      operation: "form_lead.create",
      entity_model: "FormLead",
      attempts: 1,
      error: "quota",
    },
  });

  const completed = capturedOf("sheet_sync.completed");
  assert.equal(completed.length, 1);
  assert.equal(completed[0]!.input.dedupe_key, `sheet_sync:${jobId.toString()}:completed`);
  assert.deepEqual(completed[0]!.input.metric_touches, ["sheet_sync.completed"]);

  await recordSheetSyncDailyOperationsFact({
    job: { ...job, resource: "booking_chain", entity_id: "booking-9" },
    outcome: "completed",
  });
  assert.deepEqual(capturedOf("sheet_sync.completed")[1]!.input.links, { booking_id: "booking-9" });
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
  const duplicatesLoop = source.slice(source.indexOf("for (const job of duplicates)"));
  const duplicatesBody = duplicatesLoop.slice(0, duplicatesLoop.indexOf("\n    }\n"));
  assert.match(duplicatesBody, /coalesced_into_representative/);
  assert.doesNotMatch(duplicatesBody, /recordJobCompletedFact/);
  const deferStart = source.indexOf("else if (anyDeferred)");
  const deferBranch = source.slice(deferStart, source.indexOf("} else {", deferStart));
  assert.match(deferBranch, /deferJob\(job/);
  assert.doesNotMatch(deferBranch, /recordSheetSyncDailyOperationsFact|recordJobCompletedFact/);
  // Spec §15.9: finalizeSheetSync is a queue wake-up, not a job outcome.
  assert.doesNotMatch(coordinator, /recordSheetSyncDailyOperationsFact/);
});

test("completeCallLeadIngestion is the only Call Lead volume hook", async () => {
  const callSource = await readFile(
    path.join(__dirname, "../leads/callLead.service.ts"),
    "utf8",
  );
  const ingestSource = await readFile(
    path.join(
      __dirname,
      "../ringcentral/ringcentral-call-lead-ingest.service.ts",
    ),
    "utf8",
  );
  assert.match(callSource, /recordCallLeadDailyOperationsFact\(pending\)/);
  assert.doesNotMatch(ingestSource, /recordCallLeadDailyOperationsFact/);
  assert.match(ingestSource, /recordAdoptionConflictDailyOperationsFact/);
});
