import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import mongoose from "mongoose";
import { RingCentralApiError } from "../client";
import type { LeaseToken } from "../../durableWork/types";
import { classifySmsEvidence, type SmsEvidenceFacts } from "../../salesOutreach/engine/credit";
import type { ContactChangeSource } from "../../salesOutreach/capture/contactChangeWake";
import { mailboxCoverage, worstMailboxCoverage } from "./coverage";
import { upsertRepSmsEvidence, type RepSmsEvidenceStore, type StoredRepSms } from "./evidenceStore";
import type { RepMailbox } from "./mailboxes";
import { REP_SMS_FSYNC_LOOKBACK_MS, runRepSmsMailboxSync, type MailboxSyncState, type MailboxSyncStore, type MailboxSyncWrite } from "./mailboxSync";
import { engineSmsStatus, mapProviderMessage, mapSmsStatus, type MailboxContext, type ProviderMessage } from "./mapper";
import { isMessageSyncTokenExpired, messageSyncEndpoint, parseMessageSyncPayload, type MessageSyncInput, type MessageSyncPage } from "./syncClient";

const ACCOUNT = "800000000001";
const AGENT = new mongoose.Types.ObjectId().toHexString();
const LINK = new mongoose.Types.ObjectId().toHexString();
const REP_NUMBER = "+15550000101";
const CUSTOMER = "+15550100200";
const NOW = new Date("2026-10-05T15:00:00.000Z");

const mailboxContext = (overrides: Partial<MailboxContext> = {}): MailboxContext => ({
  provider_account_id: ACCOUNT,
  extension_id: "101",
  sender_numbers: [REP_NUMBER],
  identityAt: () => ({ agent_id: AGENT, link_id: LINK }),
  ...overrides,
});

function message(overrides: Partial<ProviderMessage> & { subject?: string } = {}): ProviderMessage & { subject?: string } {
  return {
    id: 5551,
    type: "SMS",
    direction: "Outbound",
    messageStatus: "Sent",
    availability: "Alive",
    creationTime: "2026-10-05T14:10:00.000Z",
    lastModifiedTime: "2026-10-05T14:10:02.000Z",
    conversationId: "c-1",
    from: { phoneNumber: REP_NUMBER },
    to: [{ phoneNumber: CUSTOMER }],
    subject: "Hi, this is the private message body",
    ...overrides,
  };
}

test("§5 status mapping: Sent/Delivered credit, Queued none, SendingFailed/DeliveryFailed revoke, inbound Received history only", () => {
  assert.deepEqual(mapSmsStatus("outbound", "Sent"), { status: "sent", credit_effect: "credit" });
  assert.deepEqual(mapSmsStatus("outbound", "Delivered"), { status: "delivered", credit_effect: "credit" });
  assert.deepEqual(mapSmsStatus("outbound", "Queued"), { status: "queued", credit_effect: "none" });
  assert.deepEqual(mapSmsStatus("outbound", "SendingFailed"), { status: "send_failed", credit_effect: "revoke" });
  assert.deepEqual(mapSmsStatus("outbound", "DeliveryFailed"), { status: "delivery_failed", credit_effect: "revoke" });
  assert.deepEqual(mapSmsStatus("outbound", "Weird"), { status: "unknown", credit_effect: "none" });
  assert.deepEqual(mapSmsStatus("outbound", null), { status: "unknown", credit_effect: "none" });
  assert.deepEqual(mapSmsStatus("inbound", "Received"), { status: "received", credit_effect: "history" });
  assert.deepEqual(mapSmsStatus("inbound", "Sent"), { status: "received", credit_effect: "history" });
});

test("mapper: metadata only — never the body; sent time = creationTime; counterpart = customer side; identity of the owning mailbox", () => {
  const mapped = mapProviderMessage(message(), mailboxContext());
  assert.ok(mapped.ok);
  const e = mapped.evidence;
  assert.equal(JSON.stringify(e).includes("private message body"), false, "no body");
  assert.equal(e.message_id, "5551");
  assert.equal(e.canonical_logical_id, `${ACCOUNT}:5551`);
  assert.equal(e.send_at?.toISOString(), "2026-10-05T14:10:00.000Z");
  assert.deepEqual(e.counterpart_numbers, [CUSTOMER]);
  assert.equal(e.is_group, false);
  assert.deepEqual(e.reviewed_rep_ref, { agent_id: AGENT, link_id: LINK });
  assert.equal(e.identity_state, "reviewed");
  const inbound = mapProviderMessage(message({ direction: "Inbound", messageStatus: "Received", from: { phoneNumber: CUSTOMER }, to: [{ phoneNumber: REP_NUMBER }] }), mailboxContext());
  assert.ok(inbound.ok);
  assert.equal(inbound.evidence.send_at, null);
  assert.deepEqual(inbound.evidence.counterpart_numbers, [CUSTOMER]);
  assert.equal(inbound.evidence.credit_effect, "history");
  const group = mapProviderMessage(message({ to: [{ phoneNumber: CUSTOMER }, { phoneNumber: "+15550100201" }] }), mailboxContext());
  assert.ok(group.ok && group.evidence.is_group);
  assert.deepEqual(mapProviderMessage(message({ type: "Fax" }), mailboxContext()), { ok: false, reason: "not_sms" });
  assert.deepEqual(mapProviderMessage(message({ id: null }), mailboxContext()), { ok: false, reason: "id_missing" });
  assert.deepEqual(mapProviderMessage(message({ creationTime: "junk" }), mailboxContext()), { ok: false, reason: "created_missing" });
});

test("P07e sender/origin: a shared/company sender or an owner who was not a reviewed sales_rep at send time is pending_identity", () => {
  const shared = mapProviderMessage(message({ from: { phoneNumber: "+15550100100" } }), mailboxContext());
  assert.ok(shared.ok);
  assert.equal(shared.evidence.identity_state, "pending_identity");
  assert.equal(shared.evidence.identity_reason, "shared_sender");
  const notReviewed = mapProviderMessage(message(), mailboxContext({ identityAt: () => null }));
  assert.ok(notReviewed.ok);
  assert.equal(notReviewed.evidence.identity_state, "pending_identity");
  assert.equal(notReviewed.evidence.identity_reason, "owner_not_reviewed_sales_rep");
  assert.equal(notReviewed.evidence.reviewed_rep_ref, null);
  // A link that recorded no numbers cannot prove a shared sender; the owning reviewed mailbox stands.
  const unknownNumbers = mapProviderMessage(message({ from: { phoneNumber: "+15550100100" } }), mailboxContext({ sender_numbers: [] }));
  assert.ok(unknownNumbers.ok && unknownNumbers.evidence.identity_state === "reviewed");
});

/** Captured evidence → the S2 engine's classification, as SRV-6 will feed it (association assumed unique). */
function classify(raw: ProviderMessage, context = mailboxContext()) {
  const mapped = mapProviderMessage(raw, context);
  assert.ok(mapped.ok);
  const e = mapped.evidence;
  const status = engineSmsStatus(e.status);
  const facts: SmsEvidenceFacts = {
    direction: e.direction,
    status: status ?? "sent",
    origin: e.identity_state === "reviewed" ? "rep_deliberate" : "unknown",
    sender: { agent_id: e.reviewed_rep_ref?.agent_id ?? null, identity: e.identity_state === "reviewed" ? "reviewed" : "unreviewed" },
    association: "unique",
  };
  return classifySmsEvidence(facts);
}
const credit = (c: ReturnType<typeof classify>) => (c.kind === "sms_sent" && c.verification === "confirmed" ? 1 : 0);

function fixture(name: string) {
  return JSON.parse(readFileSync(path.join(process.cwd(), "docs/sales-outreach-desk/contracts/fixtures", name), "utf8")) as {
    cases: Array<{ id: string; expected_credit?: number; expected_sms_credit?: number; previous_credit?: number }>;
  };
}

test("fixture p07d-sms-status-corrections (capture part): provider statuses map to the expected SMS credit", () => {
  const cases = new Map(fixture("p07d-sms-status-corrections.json").cases.map((c) => [c.id, c]));
  const expect = (id: string, raw: ProviderMessage) => assert.equal(credit(classify(raw)), cases.get(id)!.expected_credit, id);
  expect("sent_delivery_unknown", message({ messageStatus: "Sent" }));
  expect("delivered", message({ messageStatus: "Delivered" }));
  expect("sent_then_delivered", message({ messageStatus: "Delivered" }));
  expect("queued", message({ messageStatus: "Queued" }));
  expect("pending", message({ messageStatus: "SomethingNew" }));
  expect("send_failure", message({ messageStatus: "SendingFailed" }));
  // `api_accepted_only`: a Queued row is all an API acceptance can produce in the store.
  expect("api_accepted_only", message({ messageStatus: "Queued" }));
  const later = cases.get("sent_later_failed")!;
  assert.equal(credit(classify(message({ messageStatus: "Sent" }))), later.previous_credit);
  assert.equal(credit(classify(message({ messageStatus: "DeliveryFailed" }))), later.expected_credit);
  assert.equal(mapSmsStatus("outbound", "DeliveryFailed").credit_effect, "revoke", "the later failure revokes and recomputes");
});

test("fixture p07e-sms-sender-origin (capture part): rep mailbox sends credit; inbound and shared senders do not", () => {
  const cases = new Map(fixture("p07e-sms-sender-origin.json").cases.map((c) => [c.id, c]));
  assert.equal(credit(classify(message())), cases.get("typed_assigned_rep")!.expected_sms_credit);
  // A helping rep's own mailbox is a reviewed mailbox too: the credit (and catch-up) is the sender's.
  const helper = new mongoose.Types.ObjectId().toHexString();
  const helping = classify(message(), mailboxContext({ extension_id: "102", identityAt: () => ({ agent_id: helper, link_id: LINK }) }));
  assert.equal(credit(helping), cases.get("typed_helping_rep")!.expected_sms_credit);
  assert.equal(helping.actor_agent_id, helper);
  assert.equal(credit(classify(message({ messageStatus: "Delivered" }))), cases.get("manually_sent_template")!.expected_sms_credit);
  assert.equal(credit(classify(message({ direction: "Inbound", messageStatus: "Received", from: { phoneNumber: CUSTOMER } }))), cases.get("inbound_reply")!.expected_sms_credit);
  const shared = classify(message({ from: { phoneNumber: "+15550100100" } }));
  assert.equal(credit(shared), cases.get("ambiguous_shared_sender")!.expected_sms_credit);
  assert.equal(shared.verification, "pending_identity");
  // Automatic confirmations / unattended automation are `lead_messages`, never rep mailbox evidence (§5):
  // the capture never maps them, and the engine refuses them by origin.
  assert.equal(classifySmsEvidence({ direction: "outbound", status: "sent", origin: "automatic_confirmation", sender: { agent_id: AGENT, identity: "reviewed" }, association: "unique" }).verification, "excluded");
});

function memoryEvidenceStore() {
  const rows = new Map<string, StoredRepSms>();
  let inserts = 0;
  let updates = 0;
  const store: RepSmsEvidenceStore = {
    find: async (key) => [...rows.values()].find((r) => r.provider_account_id === key.provider_account_id && r.owning_extension_id === key.owning_extension_id && r.message_id === key.message_id) ?? null,
    insert: async (doc) => {
      inserts += 1;
      const id = new mongoose.Types.ObjectId().toHexString();
      rows.set(id, { ...(doc as unknown as StoredRepSms), _id: id });
      return id;
    },
    update: async (id, expected, set) => {
      const row = rows.get(id);
      if (!row || row.source_revision !== expected) return false;
      updates += 1;
      rows.set(id, { ...row, ...(set as unknown as StoredRepSms) });
      return true;
    },
  };
  return { store, rows, counts: () => ({ inserts, updates }) };
}

test("evidence upsert: insert once, unchanged replays write nothing, Sent → Delivered → SendingFailed bump the revision and keep the history; older versions are stale", async () => {
  const mem = memoryEvidenceStore();
  const map = (raw: ProviderMessage) => {
    const m = mapProviderMessage(raw, mailboxContext());
    assert.ok(m.ok);
    return m.evidence;
  };
  const sent = await upsertRepSmsEvidence(map(message()), { now: NOW, syncKind: "FSync" }, mem.store);
  assert.equal(sent.outcome, "inserted");
  assert.equal((await upsertRepSmsEvidence(map(message()), { now: NOW, syncKind: "ISync" }, mem.store)).outcome, "unchanged");
  const delivered = await upsertRepSmsEvidence(map(message({ messageStatus: "Delivered", lastModifiedTime: "2026-10-05T14:11:00.000Z" })), { now: NOW, syncKind: "ISync" }, mem.store);
  assert.deepEqual([delivered.outcome, delivered.source_revision], ["updated", 2]);
  const stale = await upsertRepSmsEvidence(map(message({ messageStatus: "Sent", lastModifiedTime: "2026-10-05T14:10:30.000Z" })), { now: NOW, syncKind: "ISync" }, mem.store);
  assert.equal(stale.outcome, "stale", "a replayed older page never rolls Delivered back");
  const failed = await upsertRepSmsEvidence(map(message({ messageStatus: "SendingFailed", lastModifiedTime: "2026-10-05T14:20:00.000Z" })), { now: NOW, syncKind: "ISync" }, mem.store);
  assert.equal(failed.source_revision, 3);
  const row = mem.rows.get(sent.id)!;
  assert.equal(row.credit_effect, "revoke");
  assert.deepEqual(row.status_history.map((h) => h.status), ["sent", "delivered", "send_failed"], "P07d keeps the status history");
  assert.deepEqual(mem.counts(), { inserts: 1, updates: 2 });
});

test("evidence upsert: a concurrent insert (duplicate key) is retried as an update path", async () => {
  const mem = memoryEvidenceStore();
  const m = mapProviderMessage(message(), mailboxContext());
  assert.ok(m.ok);
  let first = true;
  const racing: RepSmsEvidenceStore = {
    ...mem.store,
    insert: async (doc) => {
      if (first) {
        first = false;
        await mem.store.insert(doc);
        throw Object.assign(new Error("E11000"), { code: 11000 });
      }
      return mem.store.insert(doc);
    },
  };
  assert.equal((await upsertRepSmsEvidence(m.evidence, { now: NOW, syncKind: "ISync" }, racing)).outcome, "unchanged");
});

test("message-sync client: SMS-only FSync from a date / ISync by token on the Light message-sync path; payload and expiry parsing", () => {
  assert.equal(
    messageSyncEndpoint({ extensionId: "101", syncType: "FSync", dateFrom: new Date("2026-09-28T15:00:00Z"), recordCount: 250 }),
    "/restapi/v1.0/account/~/extension/101/message-sync?syncType=FSync&messageType=SMS&dateFrom=2026-09-28T15%3A00%3A00.000Z&recordCount=250",
  );
  assert.equal(messageSyncEndpoint({ extensionId: "101", syncType: "ISync", syncToken: "t k" }), "/restapi/v1.0/account/~/extension/101/message-sync?syncType=ISync&syncToken=t+k");
  assert.throws(() => messageSyncEndpoint({ extensionId: "../x", syncType: "ISync", syncToken: "t" }));
  assert.deepEqual(parseMessageSyncPayload({ records: [{ id: 1 }], syncInfo: { syncType: "ISync", syncToken: "n", syncTime: "2026-10-05T15:00:00Z", olderRecordsExist: true } }), {
    records: [{ id: 1 }],
    syncType: "ISync",
    syncToken: "n",
    syncTime: new Date("2026-10-05T15:00:00Z"),
    olderRecordsExist: true,
  });
  assert.equal(parseMessageSyncPayload("junk").syncToken, null);
  assert.equal(isMessageSyncTokenExpired(new RingCentralApiError("x", 400, "Bad", "/m", "GET", null)), true);
  assert.equal(isMessageSyncTokenExpired(new RingCentralApiError("x", 403, "Forbidden", "/m", "GET", { errorCode: "MSG-1" })), false);
  assert.equal(isMessageSyncTokenExpired(new Error("x")), false);
});

const MAILBOX: RepMailbox = { rc_account_id: ACCOUNT, extension_id: "101", agent_id: AGENT, link_id: LINK, sender_numbers: [REP_NUMBER] };

function syncHarness(input: { state?: MailboxSyncState; pages: Array<MessageSyncPage | Error>; acquire?: boolean; evidence?: RepSmsEvidenceStore }) {
  const requests: Array<{ input: MessageSyncInput; priority?: string; maxWaitMs?: number }> = [];
  const writes: MailboxSyncWrite[] = [];
  const woken: ContactChangeSource[][] = [];
  const mem = memoryEvidenceStore();
  const store: MailboxSyncStore = {
    acquire: async () => (input.acquire === false ? null : ({ scope: "rep_sms:101", owner: "o", epoch: 1 } as unknown as LeaseToken)),
    load: async () => input.state ?? {},
    write: async (_scope, _token, update) => {
      writes.push(update);
      return true;
    },
    release: async () => undefined,
  };
  const deps = {
    now: () => NOW,
    fetchSync: async (request: MessageSyncInput, options?: { priority?: string; maxWaitMs?: number }) => {
      requests.push({ input: request, priority: options?.priority, maxWaitMs: options?.maxWaitMs });
      const next = input.pages.shift();
      if (!next) throw new Error("unexpected request");
      if (next instanceof Error) throw next;
      return next;
    },
    store,
    evidence: input.evidence ?? mem.store,
    identity: async () => () => ({ agent_id: AGENT, link_id: LINK }),
    wake: async (sources: ContactChangeSource[]) => {
      woken.push(sources);
    },
    owner: "test",
  };
  return { deps, requests, writes, woken, mem };
}

test("mailbox sync: first run is a 7-day SMS FSync; every record stored ⇒ token, known_complete_through and coverage advance; the desk is woken", async () => {
  const h = syncHarness({
    pages: [{ records: [message(), message({ id: 5552, direction: "Inbound", messageStatus: "Received", from: { phoneNumber: CUSTOMER } }), { id: 9, type: "Fax" }], syncType: "FSync", syncToken: "tok-1", syncTime: new Date("2026-10-05T14:59:58Z"), olderRecordsExist: false }],
  });
  const summary = await runRepSmsMailboxSync(MAILBOX, h.deps);
  assert.equal(summary.sync_type, "FSync");
  assert.deepEqual(h.requests[0]!.input, { extensionId: "101", syncType: "FSync", dateFrom: new Date(NOW.getTime() - REP_SMS_FSYNC_LOOKBACK_MS), recordCount: 250 });
  assert.equal(h.requests[0]!.priority, "high");
  assert.deepEqual([summary.inserted, summary.ignored], [2, 1]);
  assert.equal(h.woken[0]!.length, 2);
  assert.equal(h.woken[0]![0]!.source_kind, "sms");
  const write = h.writes[0]!;
  assert.equal(write.message_sync.token, "tok-1");
  assert.equal(write.known_complete_through?.toISOString(), "2026-10-05T14:59:58.000Z");
  assert.equal(write.message_sync.coverage_from?.getTime(), NOW.getTime() - REP_SMS_FSYNC_LOOKBACK_MS);
  assert.equal(write.message_sync.last_success_at?.getTime(), NOW.getTime());
  assert.equal(write.consecutive_failures, 0);
});

test("mailbox sync: ISync continues the chain and follows pages only while full; an FSync that hit its limit starts coverage at the oldest record", async () => {
  const fullPage = Array.from({ length: 250 }, (_, i) => message({ id: 7000 + i }));
  const h = syncHarness({
    state: { message_sync: { token: "tok-1", sync_time: new Date("2026-10-05T14:50:00Z") }, known_complete_through: new Date("2026-10-05T14:50:00Z") },
    pages: [
      { records: fullPage, syncType: "ISync", syncToken: "tok-2", syncTime: NOW, olderRecordsExist: false },
      { records: [message({ id: 8000 })], syncType: "ISync", syncToken: "tok-3", syncTime: NOW, olderRecordsExist: false },
    ],
  });
  const summary = await runRepSmsMailboxSync(MAILBOX, h.deps);
  assert.deepEqual(h.requests.map((r) => (r.input.syncType === "ISync" ? r.input.syncToken : "F")), ["tok-1", "tok-2"]);
  assert.equal(summary.inserted, 251);
  assert.equal(h.writes[0]!.message_sync.token, "tok-3");

  const limited = syncHarness({
    pages: [{ records: [message({ creationTime: "2026-10-03T09:00:00.000Z" }), message({ id: 2, creationTime: "2026-10-04T09:00:00.000Z" })], syncType: "FSync", syncToken: "t", syncTime: NOW, olderRecordsExist: true }],
  });
  await runRepSmsMailboxSync(MAILBOX, limited.deps);
  assert.equal(limited.writes[0]!.message_sync.coverage_from?.toISOString(), "2026-10-03T09:00:00.000Z");
});

test("mailbox sync: an expired token falls back to FSync in the same run; a throttle or a failed record keeps the old token and coverage", async () => {
  const expired = syncHarness({
    state: { message_sync: { token: "old", sync_time: NOW } },
    pages: [new RingCentralApiError("expired", 400, "Bad", "/m", "GET", { errorCode: "MSG-333" }), { records: [], syncType: "FSync", syncToken: "fresh", syncTime: NOW, olderRecordsExist: false }],
  });
  const s1 = await runRepSmsMailboxSync(MAILBOX, expired.deps);
  assert.equal(s1.expired, true);
  assert.equal(s1.sync_type, "FSync");
  assert.equal(expired.writes[0]!.message_sync.token, "fresh");

  const prior = { message_sync: { token: "keep", sync_time: new Date("2026-10-05T14:50:00Z"), last_success_at: new Date("2026-10-05T14:50:01Z") }, known_complete_through: new Date("2026-10-05T14:50:00Z") };
  const throttled = syncHarness({ state: prior, pages: [new RingCentralApiError("429", 429, "Too Many", "/m", "GET", null, { retryAfterMs: 30_000 })] });
  const s2 = await runRepSmsMailboxSync(MAILBOX, throttled.deps);
  assert.equal(s2.error_code, "provider_throttled");
  assert.equal(s2.throttle_retry_after_ms, 30_000);
  assert.equal(throttled.writes[0]!.message_sync.token, "keep");
  assert.equal(throttled.writes[0]!.known_complete_through?.toISOString(), "2026-10-05T14:50:00.000Z");
  assert.equal(throttled.writes[0]!.consecutive_failures, 1);

  const failingStore: RepSmsEvidenceStore = { find: async () => null, insert: async () => { throw new Error("mongo"); }, update: async () => false };
  const failing = syncHarness({ state: prior, evidence: failingStore, pages: [{ records: [message()], syncType: "ISync", syncToken: "next", syncTime: NOW, olderRecordsExist: false }] });
  const s3 = await runRepSmsMailboxSync(MAILBOX, failing.deps);
  assert.equal(s3.error_code, "evidence_write_failed");
  assert.equal(failing.writes[0]!.message_sync.token, "keep", "the same changes replay next run");

  const denied = syncHarness({ pages: [new RingCentralApiError("forbidden", 403, "Forbidden", "/m", "GET", null)] });
  assert.equal((await runRepSmsMailboxSync(MAILBOX, denied.deps)).error_code, "provider_permission_denied");
  const held = syncHarness({ acquire: false, pages: [] });
  assert.deepEqual([(await runRepSmsMailboxSync(MAILBOX, held.deps)).skip_reason, held.requests.length], ["lease_held", 0]);
});

test("mailbox sync: the low-priority poll never waits for a Light slot; the webhook path waits at most 10 s", async () => {
  const page = { records: [], syncType: "ISync" as const, syncToken: "n", syncTime: NOW, olderRecordsExist: false };
  const low = syncHarness({ state: { message_sync: { token: "t", sync_time: NOW } }, pages: [page] });
  await runRepSmsMailboxSync(MAILBOX, { ...low.deps, priority: "low" });
  assert.deepEqual([low.requests[0]!.priority, low.requests[0]!.maxWaitMs], ["low", 0]);
  const high = syncHarness({ state: { message_sync: { token: "t", sync_time: NOW } }, pages: [{ ...page }] });
  await runRepSmsMailboxSync(MAILBOX, high.deps);
  assert.deepEqual([high.requests[0]!.priority, high.requests[0]!.maxWaitMs], ["high", 10_000]);
});

test("SMS coverage (§8): never synced, current, delayed after 10 minutes; the worst mailbox drives the header", () => {
  const never = mailboxCoverage("101", null, NOW);
  assert.equal(never.state, "never_synced");
  assert.equal(never.known_complete_through, null);
  const current = mailboxCoverage("102", { known_complete_through: new Date("2026-10-05T14:58:00Z"), message_sync: { last_success_at: new Date("2026-10-05T14:58:01Z") } }, NOW);
  assert.equal(current.state, "current");
  const delayed = mailboxCoverage("103", { known_complete_through: new Date("2026-10-05T14:40:00Z"), message_sync: { last_success_at: new Date("2026-10-05T14:49:59Z") } }, NOW);
  assert.equal(delayed.state, "delayed");
  assert.equal(worstMailboxCoverage([current, delayed])?.extension_id, "103");
  assert.equal(worstMailboxCoverage([current, delayed, never])?.extension_id, "101");
  assert.equal(worstMailboxCoverage([]), null);
});

test("END-TO-END-RUN §3: SMS sent/delivered then confirmed failure (capture)", async () => {
  const mem = memoryEvidenceStore();
  const map = (raw: ProviderMessage) => {
    const m = mapProviderMessage(raw, mailboxContext());
    assert.ok(m.ok);
    return m.evidence;
  };
  const sent = await upsertRepSmsEvidence(map(message({ messageStatus: "Sent" })), { now: NOW, syncKind: "ISync" }, mem.store);
  assert.equal(credit(classify(message({ messageStatus: "Sent" }))), 1, "one logical message, one credit");
  await upsertRepSmsEvidence(map(message({ messageStatus: "Delivered", lastModifiedTime: "2026-10-05T14:11:00.000Z" })), { now: NOW, syncKind: "ISync" }, mem.store);
  assert.equal(credit(classify(message({ messageStatus: "Delivered" }))), 1, "delivery does not add a second credit");
  const failed = await upsertRepSmsEvidence(map(message({ messageStatus: "DeliveryFailed", lastModifiedTime: "2026-10-05T14:30:00.000Z" })), { now: NOW, syncKind: "ISync" }, mem.store);
  const row = mem.rows.get(sent.id)!;
  assert.equal(row.credit_effect, "revoke");
  assert.equal(credit(classify(message({ messageStatus: "DeliveryFailed" }))), 0);
  assert.equal(failed.source_revision, 3, "a new revision wakes the desk to recompute");
  assert.deepEqual(row.status_history.map((h) => h.status), ["sent", "delivered", "delivery_failed"], "history preserved");
  assert.equal(classify(message({ messageStatus: "DeliveryFailed" })).goal_agent_id, null, "no Call/goal change");
});

test("END-TO-END-RUN §3: unverified identity/origin or capture gap (capture)", async () => {
  // Unverified origin: pending identity, never a guessed credit.
  const shared = classify(message({ from: { phoneNumber: "+15550100100" } }));
  assert.equal(shared.verification, "pending_identity");
  assert.equal(credit(shared), 0);
  // Capture gap: a failed sync keeps the old token and coverage, so deadlines past it read pending.
  const prior = { message_sync: { token: "keep", sync_time: new Date("2026-10-05T14:40:00Z"), last_success_at: new Date("2026-10-05T14:40:01Z") }, known_complete_through: new Date("2026-10-05T14:40:00Z") };
  const h = syncHarness({ state: prior, pages: [new RingCentralApiError("down", 503, "Unavailable", "/m", "GET", null)] });
  const summary = await runRepSmsMailboxSync(MAILBOX, h.deps);
  assert.equal(summary.error_code, "provider_request_failed");
  assert.equal(h.writes[0]!.known_complete_through?.toISOString(), "2026-10-05T14:40:00.000Z", "coverage never advances over a gap");
  const coverage = mailboxCoverage("101", { known_complete_through: h.writes[0]!.known_complete_through, message_sync: h.writes[0]!.message_sync }, NOW);
  assert.equal(coverage.state, "delayed", "SMS delayed, not a false zero");
  assert.equal(mailboxCoverage("102", null, NOW).known_complete_through, null, "never synced: no coverage at all");
});
