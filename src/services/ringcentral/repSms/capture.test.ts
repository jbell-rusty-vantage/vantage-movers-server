import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { RingCentralApiError } from "../client";
import type { LeaseToken } from "../../durableWork/types";
import type { ContactChangeSource } from "../../salesOutreach/capture/contactChangeWake";
import { mailboxCoverage, worstMailboxCoverage } from "./coverage";
import { upsertRepSmsEvidence, type RepSmsEvidenceStore, type StoredRepSms } from "./evidenceStore";
import type { RepMailbox } from "./mailboxes";
import { runRepSmsMailboxSync, type MailboxSyncState, type MailboxSyncStore, type MailboxSyncWrite } from "./mailboxSync";
import { mapProviderMessage, type MailboxContext, type ProviderMessage } from "./mapper";
import { type MessageSyncInput, type MessageSyncPage } from "./syncClient";

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
