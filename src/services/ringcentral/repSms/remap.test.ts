import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose, { type ClientSession } from "mongoose";
import type { ContactChangeSource } from "../../salesOutreach/capture/contactChangeWake";
import type { RepMailbox } from "./mailboxes";
import { identityForMessage, mapProviderMessage, type MailboxContext, type ProviderMessage } from "./mapper";
import {
  enqueueRepSmsRemap,
  remapRepSmsMailbox,
  REP_SMS_REMAP_LOOKBACK_MS,
  REP_SMS_REMAP_STAGE,
  repSmsRemapDedupeKey,
  repSmsRemapSubjectKey,
  runRepSmsRemapJob,
  type RemapEvidenceRow,
  type RepSmsRemapStore,
} from "./remap";

const ACCOUNT = "800000000001";
const AGENT = new mongoose.Types.ObjectId().toHexString();
const LINK = new mongoose.Types.ObjectId().toHexString();
const REP_NUMBER = "+15550000101";
const SHARED_NUMBER = "+15550000999";
const CUSTOMER = "+15550100200";
const NOW = new Date("2026-10-06T15:00:00.000Z");
const owner = () => ({ agent_id: AGENT, link_id: LINK });

const context = (overrides: Partial<MailboxContext> = {}): MailboxContext => ({
  provider_account_id: ACCOUNT,
  extension_id: "101",
  sender_numbers: [REP_NUMBER],
  identityAt: owner,
  ...overrides,
});

const outbound = (from: string): ProviderMessage => ({
  id: 7001,
  type: "SMS",
  direction: "Outbound",
  messageStatus: "Delivered",
  creationTime: "2026-10-06T13:00:00.000Z",
  lastModifiedTime: "2026-10-06T13:00:05.000Z",
  from: { phoneNumber: from },
  to: [{ phoneNumber: CUSTOMER }],
});

test("olr C7 identityForMessage: the mapper and the re-map share one rule (reviewed, owner_not_reviewed_sales_rep, shared_sender)", () => {
  const cases: Array<[string, ProviderMessage, MailboxContext, string, string | null]> = [
    ["reviewed", outbound(REP_NUMBER), context(), "reviewed", null],
    ["no reviewed owner at creation", outbound(REP_NUMBER), context({ identityAt: () => null }), "pending_identity", "owner_not_reviewed_sales_rep"],
    ["sender is not the link's number", outbound(SHARED_NUMBER), context(), "pending_identity", "shared_sender"],
    ["no recorded numbers = not checked", outbound(SHARED_NUMBER), context({ sender_numbers: [] }), "reviewed", null],
    ["inbound is never shared_sender", { ...outbound(CUSTOMER), direction: "Inbound", to: [{ phoneNumber: SHARED_NUMBER }] }, context(), "reviewed", null],
  ];
  for (const [label, raw, mailbox, state, reason] of cases) {
    const mapped = mapProviderMessage(raw, mailbox);
    assert.ok(mapped.ok, label);
    const shared = identityForMessage(
      { direction: mapped.evidence.direction, from_number: mapped.evidence.from_number, created: mapped.evidence.provider_created_at },
      mailbox,
    );
    assert.deepEqual(
      shared,
      { identity_state: mapped.evidence.identity_state, identity_reason: mapped.evidence.identity_reason, reviewed_rep_ref: mapped.evidence.reviewed_rep_ref },
      `${label}: identityForMessage matches mapProviderMessage`,
    );
    assert.equal(shared.identity_state, state, label);
    assert.equal(shared.identity_reason, reason, label);
  }
  // The identity is the owner at the message's creation instant (prospective identity).
  const linkedFrom = new Date("2026-10-06T14:00:00.000Z");
  const atCreation = identityForMessage(
    { direction: "outbound", from_number: REP_NUMBER, created: new Date("2026-10-06T13:00:00.000Z") },
    { sender_numbers: [REP_NUMBER], identityAt: (at) => (at >= linkedFrom ? owner() : null) },
  );
  assert.equal(atCreation.identity_reason, "owner_not_reviewed_sales_rep");
});

/** In-memory evidence with the store's revision CAS. */
class MemoryRemapStore implements RepSmsRemapStore {
  rows = new Map<string, RemapEvidenceRow & { extension_id: string }>();
  queries: Array<{ extension_id: string; since: Date; limit: number }> = [];
  failNextUpdate = false;
  add(row: Partial<RemapEvidenceRow> & { _id: string; extension_id?: string }) {
    this.rows.set(row._id, {
      source_revision: 1,
      direction: "outbound",
      from_number: SHARED_NUMBER,
      provider_created_at: new Date("2026-10-06T13:00:00.000Z"),
      identity_state: "pending_identity",
      identity_reason: "shared_sender",
      reviewed_rep_ref: owner(),
      extension_id: "101",
      ...row,
    });
  }
  async listMailboxEvidence(_account: string, extensionId: string, since: Date, limit: number) {
    this.queries.push({ extension_id: extensionId, since, limit });
    return [...this.rows.values()]
      .filter((row) => row.extension_id === extensionId && row.provider_created_at >= since)
      .slice(0, limit)
      .map(({ extension_id: _extension, ...row }) => ({ ...row }));
  }
  async update(id: string, expectedRevision: number, set: Record<string, unknown>) {
    const row = this.rows.get(id);
    if (!row || row.source_revision !== expectedRevision) return false;
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      return false;
    }
    this.rows.set(id, { ...row, ...(set as Partial<RemapEvidenceRow>) });
    return true;
  }
}

const mailbox = (sender_numbers: string[]): RepMailbox => ({ rc_account_id: ACCOUNT, extension_id: "101", agent_id: AGENT, link_id: LINK, sender_numbers });

function remapDeps(store: MemoryRemapStore, mailboxes: RepMailbox[], woken: ContactChangeSource[][]) {
  return {
    now: () => NOW,
    mailboxes: async () => mailboxes,
    identity: async () => owner,
    store,
    wake: async (sources: ContactChangeSource[]) => {
      woken.push(sources);
    },
  };
}

test("olr C7 remap: once the link records the sender number, a shared_sender row becomes reviewed (CAS revision + 1) and is woken", async () => {
  const store = new MemoryRemapStore();
  const id = new mongoose.Types.ObjectId().toHexString();
  store.add({ _id: id, source_revision: 4 });
  // Already right: an inbound row and a reviewed row are left alone.
  const inbound = new mongoose.Types.ObjectId().toHexString();
  store.add({ _id: inbound, direction: "inbound", from_number: CUSTOMER, identity_state: "reviewed", identity_reason: null });
  // Older than the 7-day window: never read.
  const old = new mongoose.Types.ObjectId().toHexString();
  store.add({ _id: old, provider_created_at: new Date(NOW.getTime() - REP_SMS_REMAP_LOOKBACK_MS - 1) });
  const woken: ContactChangeSource[][] = [];
  const summary = await remapRepSmsMailbox({ account: ACCOUNT, extension_id: "101" }, remapDeps(store, [mailbox([REP_NUMBER, SHARED_NUMBER])], woken));
  assert.deepEqual(summary, { state: "remapped", extension_id: "101", scanned: 2, changed: 1, conflicts: 0, woken: 1, truncated: false });
  assert.equal(store.queries[0]!.since.toISOString(), new Date(NOW.getTime() - REP_SMS_REMAP_LOOKBACK_MS).toISOString());
  const row = store.rows.get(id)!;
  assert.equal(row.identity_state, "reviewed");
  assert.equal(row.identity_reason, null);
  assert.deepEqual(row.reviewed_rep_ref, owner());
  assert.equal(row.source_revision, 5);
  assert.deepEqual(woken, [[{ source_kind: "sms", source_id: id, source_revision: "r5" }]]);
  assert.equal(store.rows.get(old)!.identity_reason, "shared_sender", "outside the window: untouched");

  // A replay changes nothing and wakes nothing.
  const replay = await remapRepSmsMailbox({ account: ACCOUNT, extension_id: "101" }, remapDeps(store, [mailbox([REP_NUMBER, SHARED_NUMBER])], woken));
  assert.equal(replay.changed, 0);
  assert.equal(woken.length, 1);
  assert.equal(store.rows.get(id)!.source_revision, 5);
});

test("olr C7 remap: a mailbox that is not reviewed now is a no-op (prospective identity keeps old rows); a CAS loss is a conflict, not a wake", async () => {
  const store = new MemoryRemapStore();
  const id = new mongoose.Types.ObjectId().toHexString();
  store.add({ _id: id });
  const woken: ContactChangeSource[][] = [];
  const none = await remapRepSmsMailbox({ account: ACCOUNT, extension_id: "101" }, remapDeps(store, [], woken));
  assert.equal(none.state, "not_reviewed");
  assert.equal(store.queries.length, 0, "no evidence is read");
  assert.equal(store.rows.get(id)!.source_revision, 1);
  store.failNextUpdate = true;
  const lost = await remapRepSmsMailbox({ account: ACCOUNT, extension_id: "101" }, remapDeps(store, [mailbox([SHARED_NUMBER])], woken));
  assert.deepEqual([lost.changed, lost.conflicts, lost.woken], [0, 1, 0]);
  assert.deepEqual(woken, []);
});

test("olr C7 enqueue: one job per (extension, command), subject rep-sms-remap:<account>:<extension>; nothing while capture is off", async () => {
  assert.equal(repSmsRemapSubjectKey(ACCOUNT, "101"), `rep-sms-remap:${ACCOUNT}:101`);
  assert.equal(repSmsRemapDedupeKey("101", "cmd-1"), "rep-sms-remap:101:cmd-1");
  const session = {} as ClientSession;
  const inputs: unknown[] = [];
  const enqueue = (async (input: unknown) => {
    inputs.push(input);
    return { _id: "job-1" };
  }) as never;
  assert.equal(await enqueueRepSmsRemap({ account: ACCOUNT, extension_id: "101", command_id: "cmd-1" }, session, NOW, { enabled: async () => false, enqueue }), null);
  assert.deepEqual(inputs, []);
  assert.deepEqual(await enqueueRepSmsRemap({ account: ACCOUNT, extension_id: "101", command_id: "cmd-1" }, session, NOW, { enabled: async () => true, enqueue }), { job_id: "job-1" });
  assert.deepEqual(inputs, [
    { dedupe_key: "rep-sms-remap:101:cmd-1", stage: REP_SMS_REMAP_STAGE, subject_key: `rep-sms-remap:${ACCOUNT}:101`, input_revision: 1, input_refs: [], priority: 15 },
  ]);
});

test("olr C7 job: claims only rep_sms_remap, completes capture_disabled while capture is off, otherwise re-maps the subject's mailbox", async () => {
  const claimed: unknown[] = [];
  const results: unknown[] = [];
  const row = { _id: new mongoose.Types.ObjectId(), lease_epoch: 1, subject_key: `rep-sms-remap:${ACCOUNT}:101` };
  const deps = (enabled: boolean, remapped: Array<{ account: string; extension_id: string }>) => ({
    claim: (async (...args: unknown[]) => {
      claimed.push(args[3]);
      return row;
    }) as never,
    complete: (async (_lease: unknown, _mutation: unknown, options: { result?: unknown }) => {
      results.push(options.result);
    }) as never,
    enabled: async () => enabled,
    remap: async (input: { account: string; extension_id: string }) => {
      remapped.push(input);
      return { state: "remapped" as const, extension_id: input.extension_id, scanned: 3, changed: 1, conflicts: 0, woken: 1, truncated: false };
    },
  });
  const off: Array<{ account: string; extension_id: string }> = [];
  assert.equal(((await runRepSmsRemapJob(undefined, deps(false, off))) as { state: string }).state, "capture_disabled");
  assert.deepEqual(off, []);
  const on: Array<{ account: string; extension_id: string }> = [];
  const outcome = await runRepSmsRemapJob(undefined, deps(true, on));
  assert.equal(outcome.status, "completed");
  assert.deepEqual(on, [{ account: ACCOUNT, extension_id: "101" }]);
  assert.deepEqual(claimed, [REP_SMS_REMAP_STAGE, REP_SMS_REMAP_STAGE]);
  assert.deepEqual((results[1] as { state: string }).state, "remapped");
  row.subject_key = "nonsense";
  assert.equal(((await runRepSmsRemapJob(undefined, deps(true, on))) as { state: string }).state, "subject_invalid");
});
