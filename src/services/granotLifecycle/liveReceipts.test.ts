import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  decodeLiveReceiptEventId,
  encodeLiveReceiptEventId,
  enrichLiveWebhookReceipts,
  extractLiveWebhookLead,
  projectLiveWebhookReceipt,
  resolveLiveReceiptIntakeLink,
  type LiveReceiptBookingCaseRow,
  type LiveReceiptIntakeLinkStores,
  type LiveReceiptObservationRow,
  type LiveWebhookReceipt,
} from "./liveReceipts";

test("extractLiveWebhookLead reads name, contact, job, and move fields from a Granot body", () => {
  const lead = extractLiveWebhookLead({
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@example.invalid",
    phone: "212-555-0100",
    job_no: "P5562401",
    event_type: "Priority",
    priority: "5",
    from_city: "Brooklyn",
    from_state: "NY",
    to_city: "Austin",
    to_state: "TX",
    move_date: "2026-09-01",
  });
  assert.equal(lead.display_name, "Ada Lovelace");
  assert.equal(lead.phone, "212-555-0100");
  assert.equal(lead.job_no, "P5562401");
  assert.equal(lead.priority, "5");
  assert.equal(lead.origin, "Brooklyn, NY");
  assert.equal(lead.destination, "Austin, TX");
});

test("projectLiveWebhookReceipt keeps webhook lead facts and strips credential keys", () => {
  const id = new mongoose.Types.ObjectId();
  const receipt = projectLiveWebhookReceipt({
    _id: id,
    observation_channel: "granot_webhook",
    route_event_class: "lead_created",
    captured_at: new Date("2026-08-28T15:00:00.000Z"),
    processing: { state: "pending" },
    payload: {
      customer_name: "Ada Lovelace",
      job_no: "P5562401",
      "x-api-secret": "must-not-leak",
    },
  });
  assert.ok(receipt);
  assert.equal(receipt.receipt_id, String(id));
  assert.equal(receipt.route_event_class, "lead_created");
  assert.equal(receipt.lead.display_name, "Ada Lovelace");
  assert.equal(receipt.lead.job_no, "P5562401");
  assert.equal(
    JSON.stringify(receipt.granot_statement).includes("must-not-leak"),
    false,
  );
});

test("projectLiveWebhookReceipt ignores extension receipts and unknown event classes", () => {
  const id = new mongoose.Types.ObjectId();
  assert.equal(
    projectLiveWebhookReceipt({
      _id: id,
      observation_channel: "browser_extension",
      route_event_class: "lead_created",
      captured_at: new Date("2026-08-28T15:00:00.000Z"),
      payload: { job_no: "P1" },
    }),
    null,
  );
  assert.equal(
    projectLiveWebhookReceipt({
      _id: id,
      observation_channel: "granot_webhook",
      captured_at: new Date("2026-08-28T15:00:00.000Z"),
      payload: { job_no: "P1" },
    }),
    null,
  );
});

test("live receipt event ids round-trip captured_at and receipt_id", () => {
  const cursor = {
    captured_at: "2026-08-28T15:00:00.000Z",
    receipt_id: "64aaaaaaaaaaaaaaaaaaaaaa",
  };
  assert.deepEqual(decodeLiveReceiptEventId(encodeLiveReceiptEventId(cursor)), cursor);
  assert.equal(decodeLiveReceiptEventId("not-an-id"), null);
});

function receiptFixture(
  overrides: Partial<LiveWebhookReceipt> & Pick<LiveWebhookReceipt, "receipt_id">,
): LiveWebhookReceipt {
  return {
    captured_at: "2026-08-28T15:00:00.000Z",
    route_event_class: "booking_status_changed",
    observation_channel: "granot_webhook",
    processing_state: "completed",
    lead: {
      display_name: "Ada Lovelace",
      first_name: "Ada",
      last_name: "Lovelace",
      email: null,
      phone: null,
      job_no: "P5562401",
      event_type: "Booked",
      priority: null,
      origin: null,
      destination: null,
      move_date: null,
    },
    granot_statement: { job_no: "P5562401", event_type: "Booked" },
    ...overrides,
  };
}

function memoryStores(input: {
  observations?: LiveReceiptObservationRow[];
  cases?: LiveReceiptBookingCaseRow[];
  ambiguous?: Array<{ receipt_id: string; observation_id: string; case_ids: string[] }>;
}): LiveReceiptIntakeLinkStores {
  return {
    findObservationsByReceiptIds: async (ids) =>
      (input.observations ?? []).filter((row) => ids.includes(row.receipt_id)),
    findBookingCasesByObservationIds: async (ids) =>
      (input.cases ?? []).filter((row) =>
        row.evidence.some((evidence) => ids.includes(evidence.observation_id)),
      ),
    recordAmbiguousIntakeLink: async (event) => {
      input.ambiguous?.push(event);
    },
  };
}

test("[AC-L1] lead_created and priority_updated keep observation_id but never a non-null intake_link", async () => {
  const leadReceipt = receiptFixture({
    receipt_id: "64aaaaaaaaaaaaaaaaaaaaaa",
    route_event_class: "lead_created",
    lead: {
      display_name: "Ada",
      first_name: "Ada",
      last_name: null,
      email: null,
      phone: null,
      job_no: "P5562401",
      event_type: "Lead",
      priority: null,
      origin: null,
      destination: null,
      move_date: null,
    },
  });
  const priorityReceipt = receiptFixture({
    receipt_id: "64bbbbbbbbbbbbbbbbbbbbbb",
    route_event_class: "priority_updated",
    lead: {
      display_name: "Ada",
      first_name: "Ada",
      last_name: null,
      email: null,
      phone: null,
      job_no: "P5562401",
      event_type: "Priority",
      priority: "5",
      origin: null,
      destination: null,
      move_date: null,
    },
  });
  const stores = memoryStores({
    observations: [
      {
        _id: "65aaaaaaaaaaaaaaaaaaaaaa",
        receipt_id: leadReceipt.receipt_id,
        route_event_class: "lead_created",
        payload_event_type_raw: "Lead",
      },
      {
        _id: "65bbbbbbbbbbbbbbbbbbbbbb",
        receipt_id: priorityReceipt.receipt_id,
        route_event_class: "priority_updated",
        payload_event_type_raw: "Priority",
      },
    ],
    cases: [
      {
        _id: "66aaaaaaaaaaaaaaaaaaaaaa",
        state: "open",
        evidence: [
          { observation_id: "65aaaaaaaaaaaaaaaaaaaaaa" },
          { observation_id: "65bbbbbbbbbbbbbbbbbbbbbb" },
        ],
      },
    ],
  });
  const [lead, priority] = await enrichLiveWebhookReceipts(
    [leadReceipt, priorityReceipt],
    stores,
  );
  assert.equal(lead?.observation_id, "65aaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(lead?.intake_link, null);
  assert.equal(priority?.observation_id, "65bbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(priority?.intake_link, null);
  assert.equal(
    (await resolveLiveReceiptIntakeLink({ receipt_id: leadReceipt.receipt_id }, stores)).intake_link,
    null,
  );
});

test("[AC-L2] booking_status_changed links the unique booking case that holds the Observation", async () => {
  const openReceipt = receiptFixture({ receipt_id: "64cccccccccccccccccccccc" });
  const resolvedReceipt = receiptFixture({
    receipt_id: "64dddddddddddddddddddddd",
    lead: {
      display_name: "Ada",
      first_name: "Ada",
      last_name: null,
      email: null,
      phone: null,
      job_no: "P5562401",
      event_type: "Releas",
      priority: null,
      origin: null,
      destination: null,
      move_date: null,
    },
  });
  const stores = memoryStores({
    observations: [
      {
        _id: "65cccccccccccccccccccccc",
        receipt_id: openReceipt.receipt_id,
        route_event_class: "booking_status_changed",
        payload_event_type_raw: "Booked",
      },
      {
        _id: "65dddddddddddddddddddddd",
        receipt_id: resolvedReceipt.receipt_id,
        route_event_class: "booking_status_changed",
        payload_event_type_raw: "Releas",
      },
    ],
    cases: [
      {
        _id: "66bbbbbbbbbbbbbbbbbbbbbb",
        state: "open",
        evidence: [{ observation_id: "65cccccccccccccccccccccc" }],
      },
      {
        _id: "66cccccccccccccccccccccc",
        state: "resolved",
        evidence: [{ observation_id: "65dddddddddddddddddddddd" }],
      },
    ],
  });
  const [openRow, resolvedRow] = await enrichLiveWebhookReceipts(
    [openReceipt, resolvedReceipt],
    stores,
  );
  assert.deepEqual(openRow?.intake_link, {
    case_id: "66bbbbbbbbbbbbbbbbbbbbbb",
    kind: "booking",
    state: "open",
    matched_via: "evidence_observation_id",
  });
  assert.deepEqual(resolvedRow?.intake_link, {
    case_id: "66cccccccccccccccccccccc",
    kind: "booking",
    state: "resolved",
    matched_via: "evidence_observation_id",
  });
  assert.deepEqual(
    await resolveLiveReceiptIntakeLink({ receipt_id: openReceipt.receipt_id }, stores),
    {
      observation_id: "65cccccccccccccccccccccc",
      intake_link: {
        case_id: "66bbbbbbbbbbbbbbbbbbbbbb",
        kind: "booking",
        state: "open",
        matched_via: "evidence_observation_id",
      },
    },
  );
});

test("[AC-L3] empty, unsupported, or discrepancy-only booking_status_changed never gets an intake_link", async () => {
  const emptyType = receiptFixture({
    receipt_id: "64eeeeeeeeeeeeeeeeeeeeee",
    lead: {
      display_name: "Ada",
      first_name: "Ada",
      last_name: null,
      email: null,
      phone: null,
      job_no: "P5562401",
      event_type: null,
      priority: null,
      origin: null,
      destination: null,
      move_date: null,
    },
  });
  const unsupported = receiptFixture({
    receipt_id: "64ffffffffffffffffffffff",
    lead: {
      display_name: "Ada",
      first_name: "Ada",
      last_name: null,
      email: null,
      phone: null,
      job_no: "P5562401",
      event_type: "Released",
      priority: null,
      origin: null,
      destination: null,
      move_date: null,
    },
  });
  const discrepancyOnly = receiptFixture({ receipt_id: "64aaaaaaaaaaaaaaaaaaaaab" });
  const stores = memoryStores({
    observations: [
      {
        _id: "65eeeeeeeeeeeeeeeeeeeeee",
        receipt_id: emptyType.receipt_id,
        route_event_class: "booking_status_changed",
        payload_event_type_raw: "",
      },
      {
        _id: "65ffffffffffffffffffffff",
        receipt_id: unsupported.receipt_id,
        route_event_class: "booking_status_changed",
        payload_event_type_raw: "Released",
      },
      {
        _id: "65aaaaaaaaaaaaaaaaaaaaab",
        receipt_id: discrepancyOnly.receipt_id,
        route_event_class: "booking_status_changed",
        payload_event_type_raw: "Booked",
      },
    ],
    cases: [
      {
        _id: "66dddddddddddddddddddddd",
        state: "open",
        evidence: [
          { observation_id: "65eeeeeeeeeeeeeeeeeeeeee" },
          { observation_id: "65ffffffffffffffffffffff" },
        ],
      },
    ],
  });
  const [emptyRow, unsupportedRow, discrepancyRow] = await enrichLiveWebhookReceipts(
    [emptyType, unsupported, discrepancyOnly],
    stores,
  );
  assert.equal(emptyRow?.observation_id, "65eeeeeeeeeeeeeeeeeeeeee");
  assert.equal(emptyRow?.intake_link, null);
  assert.equal(unsupportedRow?.observation_id, "65ffffffffffffffffffffff");
  assert.equal(unsupportedRow?.intake_link, null);
  assert.equal(discrepancyRow?.observation_id, "65aaaaaaaaaaaaaaaaaaaaab");
  assert.equal(discrepancyRow?.intake_link, null);
});

test("[AC-L5] two receipts on the same job only link the Observation that is on the case", async () => {
  const onCase = receiptFixture({ receipt_id: "64aaaaaaaaaaaaaaaaaaaaac" });
  const sameJob = receiptFixture({
    receipt_id: "64aaaaaaaaaaaaaaaaaaaaad",
    lead: {
      display_name: "Ada",
      first_name: "Ada",
      last_name: null,
      email: null,
      phone: null,
      job_no: "P5562401",
      event_type: "Releas",
      priority: null,
      origin: null,
      destination: null,
      move_date: null,
    },
  });
  const stores = memoryStores({
    observations: [
      {
        _id: "65aaaaaaaaaaaaaaaaaaaaac",
        receipt_id: onCase.receipt_id,
        route_event_class: "booking_status_changed",
        payload_event_type_raw: "Booked",
      },
      {
        _id: "65aaaaaaaaaaaaaaaaaaaaad",
        receipt_id: sameJob.receipt_id,
        route_event_class: "booking_status_changed",
        payload_event_type_raw: "Releas",
      },
    ],
    cases: [
      {
        _id: "66eeeeeeeeeeeeeeeeeeeeee",
        state: "open",
        evidence: [{ observation_id: "65aaaaaaaaaaaaaaaaaaaaac" }],
      },
    ],
  });
  const [linked, unlinked] = await enrichLiveWebhookReceipts([onCase, sameJob], stores);
  assert.equal(linked?.intake_link?.case_id, "66eeeeeeeeeeeeeeeeeeeeee");
  assert.equal(unlinked?.observation_id, "65aaaaaaaaaaaaaaaaaaaaad");
  assert.equal(unlinked?.intake_link, null);
});

test("duplicate booking cases for one Observation fail closed and record an operational event", async () => {
  const receipt = receiptFixture({ receipt_id: "64aaaaaaaaaaaaaaaaaaaaae" });
  const ambiguous: Array<{ receipt_id: string; observation_id: string; case_ids: string[] }> = [];
  const stores = memoryStores({
    observations: [
      {
        _id: "65aaaaaaaaaaaaaaaaaaaaae",
        receipt_id: receipt.receipt_id,
        route_event_class: "booking_status_changed",
        payload_event_type_raw: "Booked",
      },
    ],
    cases: [
      {
        _id: "66aaaaaaaaaaaaaaaaaaaaaf",
        state: "open",
        evidence: [{ observation_id: "65aaaaaaaaaaaaaaaaaaaaae" }],
      },
      {
        _id: "66aaaaaaaaaaaaaaaaaaaab0",
        state: "resolved",
        evidence: [{ observation_id: "65aaaaaaaaaaaaaaaaaaaaae" }],
      },
    ],
    ambiguous,
  });
  const [row] = await enrichLiveWebhookReceipts([receipt], stores);
  assert.equal(row?.observation_id, "65aaaaaaaaaaaaaaaaaaaaae");
  assert.equal(row?.intake_link, null);
  assert.equal(ambiguous.length, 1);
  assert.equal(ambiguous[0]?.observation_id, "65aaaaaaaaaaaaaaaaaaaaae");
  assert.equal(ambiguous[0]?.case_ids.length, 2);
});

test("missing Observation yields null observation_id and intake_link", async () => {
  const resolved = await resolveLiveReceiptIntakeLink(
    { receipt_id: "64aaaaaaaaaaaaaaaaaaaab1" },
    memoryStores({}),
  );
  assert.deepEqual(resolved, { observation_id: null, intake_link: null });
});
