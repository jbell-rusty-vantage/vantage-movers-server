import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type { ContactChangeSource } from "../../salesOutreach/capture/contactChangeWake";
import type { RepMailbox } from "./mailboxes";
import {
  remapRepSmsMailbox,
  REP_SMS_REMAP_LOOKBACK_MS,
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
