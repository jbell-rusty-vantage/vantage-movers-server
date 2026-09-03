import assert from "node:assert/strict";
import { test } from "node:test";
import { granotLifecycleReceiptSearchQuerySchema } from "../../validation/v1/granotLifecycle.validation";
import {
  encodeReceiptSearchCursor,
  searchReceipts,
  type ObservationFindInput,
  type ReceiptFindInput,
  type ReceiptSearchBookingCaseRow,
  type ReceiptSearchCrmSourceRow,
  type ReceiptSearchDecisionRow,
  type ReceiptSearchObservationRow,
  type ReceiptSearchReceiptRow,
  type ReceiptSearchSourceCompanyRow,
  type ReceiptSearchStores,
} from "./receiptSearch";

const COMPANY_ID = "61aaaaaaaaaaaaaaaaaaaaaa";
const CRM_SOURCE_ID = "62aaaaaaaaaaaaaaaaaaaaaa";
const DECISION_ID = "63aaaaaaaaaaaaaaaaaaaaaa";
const CASE_ID = "66aaaaaaaaaaaaaaaaaaaaaa";
const FULL_PHONE = "2125550100";
const FULL_EMAIL = "ada@example.invalid";
const JOB = "P5562401";
const REF = "synthetic-tracking-ref-02";

function oid(hex: string): string {
  return hex;
}

function parse(query: Record<string, unknown> = {}) {
  return granotLifecycleReceiptSearchQuerySchema.parse(query);
}

function receipt(input: {
  id: string;
  captured_at: string;
  route_event_class?: ReceiptSearchReceiptRow["route_event_class"];
  observation_channel?: string;
  processing_state?: string;
  latest_decision_id?: string;
  payload?: unknown;
}): ReceiptSearchReceiptRow {
  return {
    _id: input.id,
    observation_channel: input.observation_channel ?? "granot_webhook",
    route_event_class: input.route_event_class ?? "lead_created",
    captured_at: new Date(input.captured_at),
    processing: {
      state: input.processing_state ?? "completed",
      latest_decision_id: input.latest_decision_id,
    },
    payload: input.payload ?? {
      first_name: "Ada",
      last_name: "Lovelace",
      email: FULL_EMAIL,
      phone: "212-555-0100",
      job_no: JOB,
      leadno: REF,
      event_type: "Lead",
    },
  };
}

function observation(input: {
  id: string;
  receipt_id: string;
  job_no?: string;
  ref_no?: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  booking_action?: string;
  granot_crm_source_id?: string;
}): ReceiptSearchObservationRow {
  return {
    _id: input.id,
    receipt_id: input.receipt_id,
    identity: {
      normalized_job_no: input.job_no,
      normalized_form_ref: input.ref_no,
    },
    contact: {
      display_name: input.display_name,
      first_name: input.first_name,
      last_name: input.last_name,
      normalized_phone: input.phone,
      normalized_email: input.email,
    },
    booking_action: input.booking_action ? { normalized: input.booking_action } : undefined,
    granot_crm_source_id: input.granot_crm_source_id,
  };
}

function memoryStores(data: {
  receipts?: ReceiptSearchReceiptRow[];
  observations?: ReceiptSearchObservationRow[];
  decisions?: ReceiptSearchDecisionRow[];
  crmSources?: ReceiptSearchCrmSourceRow[];
  companies?: ReceiptSearchSourceCompanyRow[];
  cases?: ReceiptSearchBookingCaseRow[];
}): ReceiptSearchStores {
  const receipts = data.receipts ?? [];
  const observations = data.observations ?? [];
  return {
    findReceipts: async (input) => filterReceipts(receipts, input),
    findObservations: async (input) => filterObservations(observations, input),
    findDecisionsByIds: async (ids) => (data.decisions ?? []).filter((row) => ids.includes(row._id)),
    findCrmSourcesByCompanyId: async (companyId) =>
      (data.crmSources ?? []).filter((row) => row.lead_source_company === companyId),
    findCrmSourcesByIds: async (ids) => (data.crmSources ?? []).filter((row) => ids.includes(row._id)),
    findSourceCompaniesByIds: async (ids) =>
      (data.companies ?? []).filter((row) => ids.includes(row._id)),
    findBookingCasesByJobNos: async (jobNos) =>
      (data.cases ?? []).filter((row) => jobNos.includes(row.normalized_job_no)),
  };
}

function filterReceipts(
  rows: ReceiptSearchReceiptRow[],
  input: ReceiptFindInput,
): ReceiptSearchReceiptRow[] {
  const pendingStates = new Set(["pending", "claimed", "retry_scheduled"]);
  const filtered = rows.filter((row) => {
    if (row.observation_channel !== "granot_webhook") return false;
    if (!input.route_event_classes.includes(row.route_event_class as never)) return false;
    if (input.receipt_ids && !input.receipt_ids.includes(row._id)) return false;
    if (input.processing_state && row.processing?.state !== input.processing_state) return false;
    if (input.pending_work_states_only && !pendingStates.has(row.processing?.state ?? "")) return false;
    if (input.captured_from && row.captured_at < input.captured_from) return false;
    if (input.captured_to && row.captured_at > input.captured_to) return false;
    if (input.cursor) {
      const captured = row.captured_at.getTime();
      const cursorCaptured = input.cursor.captured_at.getTime();
      if (captured > cursorCaptured) return false;
      if (captured === cursorCaptured && row._id >= input.cursor.id) return false;
    }
    return true;
  });
  filtered.sort((left, right) => {
    const time = right.captured_at.getTime() - left.captured_at.getTime();
    return time !== 0 ? time : right._id.localeCompare(left._id);
  });
  return input.limit !== undefined ? filtered.slice(0, input.limit) : filtered;
}

function filterObservations(
  rows: ReceiptSearchObservationRow[],
  input: ObservationFindInput,
): ReceiptSearchObservationRow[] {
  return rows.filter((row) => {
    if (input.receipt_ids && !input.receipt_ids.includes(row.receipt_id)) return false;
    if (input.normalized_form_ref && row.identity?.normalized_form_ref !== input.normalized_form_ref) {
      return false;
    }
    if (input.normalized_job_no && row.identity?.normalized_job_no !== input.normalized_job_no) {
      return false;
    }
    if (input.normalized_phone && row.contact?.normalized_phone !== input.normalized_phone) {
      return false;
    }
    if (input.normalized_email && row.contact?.normalized_email !== input.normalized_email) {
      return false;
    }
    if (input.booking_action && row.booking_action?.normalized !== input.booking_action) {
      return false;
    }
    if (input.granot_crm_source_ids && !input.granot_crm_source_ids.includes(row.granot_crm_source_id ?? "")) {
      return false;
    }
    if (input.name_contains) {
      const needle = input.name_contains.toLowerCase();
      const haystacks = [
        row.contact?.display_name,
        row.contact?.first_name,
        row.contact?.last_name,
      ];
      if (!haystacks.some((value) => value?.toLowerCase().includes(needle))) {
        return false;
      }
    }
    return true;
  });
}

function observedWebhook(input?: {
  receiptId?: string;
  observationId?: string;
  captured_at?: string;
  route_event_class?: ReceiptSearchReceiptRow["route_event_class"];
  booking_action?: string;
  processing_state?: string;
  payload?: unknown;
}) {
  const receiptId = input?.receiptId ?? oid("64aaaaaaaaaaaaaaaaaaaaaa");
  const observationId = input?.observationId ?? oid("65aaaaaaaaaaaaaaaaaaaaaa");
  return {
    receipt: receipt({
      id: receiptId,
      captured_at: input?.captured_at ?? "2026-08-28T15:00:00.000Z",
      route_event_class: input?.route_event_class ?? "lead_created",
      processing_state: input?.processing_state ?? "completed",
      latest_decision_id: DECISION_ID,
      payload: input?.payload,
    }),
    observation: observation({
      id: observationId,
      receipt_id: receiptId,
      job_no: JOB,
      ref_no: REF,
      display_name: "Ada Lovelace",
      first_name: "Ada",
      last_name: "Lovelace",
      phone: FULL_PHONE,
      email: FULL_EMAIL,
      booking_action: input?.booking_action,
      granot_crm_source_id: CRM_SOURCE_ID,
    }),
  };
}

function defaultRegistry() {
  return {
    decisions: [{ _id: DECISION_ID, outcome: "applied" }],
    crmSources: [{ _id: CRM_SOURCE_ID, lead_source_company: COMPANY_ID }],
    companies: [{ _id: COMPANY_ID, owner_label: "Synthetic Forms" }],
    cases: [{ _id: CASE_ID, normalized_job_no: JOB, state: "open" as const }],
  };
}

test("channel filter excludes browser_extension and granot_http_automation receipts", async () => {
  const webhook = observedWebhook();
  const stores = memoryStores({
    receipts: [
      webhook.receipt,
      receipt({
        id: oid("64bbbbbbbbbbbbbbbbbbbbbb"),
        captured_at: "2026-08-28T16:00:00.000Z",
        observation_channel: "browser_extension",
        payload: { job_no: JOB, first_name: "Ada" },
      }),
      receipt({
        id: oid("64cccccccccccccccccccccc"),
        captured_at: "2026-08-28T17:00:00.000Z",
        observation_channel: "granot_http_automation",
        payload: { job_no: JOB, first_name: "Ada" },
      }),
    ],
    observations: [webhook.observation],
    ...defaultRegistry(),
  });
  const page = await searchReceipts(parse({ job_no: JOB }), stores);
  assert.deepEqual(page.items.map((item) => item.receipt_id), [webhook.receipt._id]);
});

for (const [param, value] of [
  ["ref_no", REF],
  ["job_no", "p5562401"],
  ["name", "lovelace"],
  ["phone", "212-555-0100"],
  ["email", "Ada@example.invalid"],
] as const) {
  test(`${param} hits an Observation, a pending receipt fallback, and misses others`, async () => {
    const hit = observedWebhook({ receiptId: oid("64aaaaaaaaaaaaaaaaaaaaaa") });
    const pendingId = oid("64bbbbbbbbbbbbbbbbbbbbbb");
    const missObserved = observedWebhook({
      receiptId: oid("64cccccccccccccccccccccc"),
      observationId: oid("65cccccccccccccccccccccc"),
      captured_at: "2026-08-28T14:00:00.000Z",
    });
    missObserved.observation.identity = {
      normalized_job_no: "OTHERJOB1",
      normalized_form_ref: "other-ref",
    };
    missObserved.observation.contact = {
      display_name: "Other Person",
      first_name: "Other",
      last_name: "Person",
      normalized_phone: "6465550199",
      normalized_email: "other@example.invalid",
    };
    const stores = memoryStores({
      receipts: [
        hit.receipt,
        receipt({
          id: pendingId,
          captured_at: "2026-08-28T16:00:00.000Z",
          processing_state: "pending",
        }),
        missObserved.receipt,
      ],
      observations: [hit.observation, missObserved.observation],
      ...defaultRegistry(),
    });
    const page = await searchReceipts(parse({ [param]: value }), stores);
    const ids = page.items.map((item) => item.receipt_id);
    assert.ok(ids.includes(hit.receipt._id), `${param} should hit Observation`);
    assert.ok(ids.includes(pendingId), `${param} should hit pending extract`);
    assert.equal(ids.includes(missObserved.receipt._id), false);
  });
}

test("source_company_id and booking_action ignore pending receipts", async () => {
  const booked = observedWebhook({
    receiptId: oid("64aaaaaaaaaaaaaaaaaaaaaa"),
    route_event_class: "booking_status_changed",
    booking_action: "booked",
  });
  const pendingId = oid("64bbbbbbbbbbbbbbbbbbbbbb");
  const stores = memoryStores({
    receipts: [
      booked.receipt,
      receipt({
        id: pendingId,
        captured_at: "2026-08-28T16:00:00.000Z",
        route_event_class: "booking_status_changed",
        processing_state: "pending",
        payload: { event_type: "Booked", job_no: JOB, source: "Synthetic Forms" },
      }),
    ],
    observations: [booked.observation],
    ...defaultRegistry(),
  });

  const byCompany = await searchReceipts(parse({ source_company_id: COMPANY_ID }), stores);
  assert.deepEqual(byCompany.items.map((item) => item.receipt_id), [booked.receipt._id]);

  const byAction = await searchReceipts(parse({ booking_action: "booked" }), stores);
  assert.deepEqual(byAction.items.map((item) => item.receipt_id), [booked.receipt._id]);
  assert.equal(byAction.items[0]?.booking_action, "booked");
});

test("booking_action booked and release are distinct", async () => {
  const booked = observedWebhook({
    receiptId: oid("64aaaaaaaaaaaaaaaaaaaaaa"),
    observationId: oid("65aaaaaaaaaaaaaaaaaaaaaa"),
    route_event_class: "booking_status_changed",
    booking_action: "booked",
    captured_at: "2026-08-28T16:00:00.000Z",
  });
  const released = observedWebhook({
    receiptId: oid("64bbbbbbbbbbbbbbbbbbbbbb"),
    observationId: oid("65bbbbbbbbbbbbbbbbbbbbbb"),
    route_event_class: "booking_status_changed",
    booking_action: "release",
    captured_at: "2026-08-28T15:00:00.000Z",
  });
  const stores = memoryStores({
    receipts: [booked.receipt, released.receipt],
    observations: [booked.observation, released.observation],
    ...defaultRegistry(),
  });
  const bookedPage = await searchReceipts(parse({ booking_action: "booked" }), stores);
  const releasePage = await searchReceipts(parse({ booking_action: "release" }), stores);
  assert.deepEqual(bookedPage.items.map((item) => item.receipt_id), [booked.receipt._id]);
  assert.deepEqual(releasePage.items.map((item) => item.receipt_id), [released.receipt._id]);
});

test("payload event_type cannot reroute route_event_class", async () => {
  const leadCreated = observedWebhook({
    route_event_class: "lead_created",
    payload: { event_type: "Booked", job_no: JOB, first_name: "Ada" },
  });
  const stores = memoryStores({
    receipts: [leadCreated.receipt],
    observations: [leadCreated.observation],
    ...defaultRegistry(),
  });
  const byRoute = await searchReceipts(parse({ route_event_class: "booking_status_changed" }), stores);
  assert.deepEqual(byRoute.items, []);
  const listed = await searchReceipts(parse({}), stores);
  assert.equal(listed.items[0]?.route_event_class, "lead_created");
  assert.equal(listed.items[0]?.booking_action, null);
});

test("lead_created and priority_updated never return a booking action on the DTO", async () => {
  const lead = observedWebhook({
    receiptId: oid("64aaaaaaaaaaaaaaaaaaaaaa"),
    route_event_class: "lead_created",
    booking_action: "booked",
  });
  const priority = observedWebhook({
    receiptId: oid("64bbbbbbbbbbbbbbbbbbbbbb"),
    observationId: oid("65bbbbbbbbbbbbbbbbbbbbbb"),
    route_event_class: "priority_updated",
    booking_action: "release",
    captured_at: "2026-08-28T14:00:00.000Z",
  });
  const stores = memoryStores({
    receipts: [lead.receipt, priority.receipt],
    observations: [lead.observation, priority.observation],
    ...defaultRegistry(),
  });
  const page = await searchReceipts(parse({}), stores);
  assert.ok(page.items.every((item) => item.booking_action === null));
});

test("masking omits full phone, email, payload, and granot_statement", async () => {
  const hit = observedWebhook();
  const stores = memoryStores({
    receipts: [
      {
        ...hit.receipt,
        payload: {
          ...((hit.receipt.payload as Record<string, unknown>) ?? {}),
          "x-api-secret": "must-not-leak",
          granot_statement: { event_type: "Lead" },
        },
      },
    ],
    observations: [hit.observation],
    ...defaultRegistry(),
  });
  const page = await searchReceipts(parse({}), stores);
  const serialized = JSON.stringify(page);
  assert.equal(serialized.includes(FULL_PHONE), false);
  assert.equal(serialized.includes("212-555-0100"), false);
  assert.equal(serialized.includes(FULL_EMAIL), false);
  assert.equal(serialized.includes("must-not-leak"), false);
  assert.equal(serialized.includes("granot_statement"), false);
  assert.equal(serialized.includes("x-api-secret"), false);
  assert.equal(page.items[0]?.contact.phone, "•••0100");
  assert.equal(page.items[0]?.contact.email, "a•••@example.invalid");
});

test("cursor page is stable newest-first", async () => {
  const first = observedWebhook({
    receiptId: oid("64cccccccccccccccccccccc"),
    observationId: oid("65cccccccccccccccccccccc"),
    captured_at: "2026-08-28T17:00:00.000Z",
  });
  const second = observedWebhook({
    receiptId: oid("64bbbbbbbbbbbbbbbbbbbbbb"),
    observationId: oid("65bbbbbbbbbbbbbbbbbbbbbb"),
    captured_at: "2026-08-28T16:00:00.000Z",
  });
  const third = observedWebhook({
    receiptId: oid("64aaaaaaaaaaaaaaaaaaaaaa"),
    observationId: oid("65aaaaaaaaaaaaaaaaaaaaaa"),
    captured_at: "2026-08-28T15:00:00.000Z",
  });
  const stores = memoryStores({
    receipts: [first.receipt, second.receipt, third.receipt],
    observations: [first.observation, second.observation, third.observation],
    ...defaultRegistry(),
  });
  const page1 = await searchReceipts(parse({ limit: 2 }), stores);
  assert.deepEqual(
    page1.items.map((item) => item.receipt_id),
    [first.receipt._id, second.receipt._id],
  );
  assert.ok(page1.next_cursor);
  const page2 = await searchReceipts(parse({ limit: 2, cursor: page1.next_cursor }), stores);
  assert.deepEqual(page2.items.map((item) => item.receipt_id), [third.receipt._id]);
  assert.equal(page2.next_cursor, null);
  const replay = await searchReceipts(parse({ limit: 2, cursor: page1.next_cursor }), stores);
  assert.deepEqual(
    replay.items.map((item) => item.receipt_id),
    page2.items.map((item) => item.receipt_id),
  );
});

test("intake_case_id joins the booking case by Job Number, including lead_created", async () => {
  const lead = observedWebhook({ route_event_class: "lead_created" });
  const stores = memoryStores({
    receipts: [lead.receipt],
    observations: [lead.observation],
    ...defaultRegistry(),
  });
  const page = await searchReceipts(parse({}), stores);
  assert.equal(page.items[0]?.route_event_class, "lead_created");
  assert.equal(page.items[0]?.intake_case_id, CASE_ID);
  assert.equal(page.items[0]?.source_company?.owner_label, "Synthetic Forms");
  assert.equal(page.items[0]?.decision_outcome, "applied");
});

test("empty find lists newest webhook receipts first", async () => {
  const newer = observedWebhook({
    receiptId: oid("64bbbbbbbbbbbbbbbbbbbbbb"),
    captured_at: "2026-08-28T16:00:00.000Z",
  });
  const older = observedWebhook({
    receiptId: oid("64aaaaaaaaaaaaaaaaaaaaaa"),
    observationId: oid("65bbbbbbbbbbbbbbbbbbbbbb"),
    captured_at: "2026-08-28T15:00:00.000Z",
  });
  const stores = memoryStores({
    receipts: [older.receipt, newer.receipt],
    observations: [older.observation, newer.observation],
    ...defaultRegistry(),
  });
  const page = await searchReceipts(parse({}), stores);
  assert.deepEqual(
    page.items.map((item) => item.receipt_id),
    [newer.receipt._id, older.receipt._id],
  );
});

test("opaque cursor encoder matches the case-list keyset shape", () => {
  const cursor = encodeReceiptSearchCursor({
    sort_value: "2026-08-28T15:00:00.000Z",
    id: "64aaaaaaaaaaaaaaaaaaaaaa",
  });
  assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
    sort_value: string;
    id: string;
  };
  assert.equal(decoded.sort_value, "2026-08-28T15:00:00.000Z");
  assert.equal(decoded.id, "64aaaaaaaaaaaaaaaaaaaaaa");
});
