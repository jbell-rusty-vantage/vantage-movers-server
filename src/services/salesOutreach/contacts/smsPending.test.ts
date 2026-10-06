import assert from "node:assert/strict";
import { test } from "node:test";
import type { RepMailbox } from "../../ringcentral/repSms/mailboxes";
import {
  pendingByMailbox,
  refreshSmsPendingCounts,
  SMS_PENDING_REFRESH_MS,
  SMS_PENDING_WINDOW_MS,
  type MailboxPending,
  type SmsPendingGroup,
  type SmsPendingMailboxRow,
  type SmsPendingStore,
} from "./smsPending";

const NOW = new Date("2026-10-06T15:00:00.000Z");
const ALICE = "6650a1b2c3d4e5f60718293a";

test("olr C7 pendingByMailbox: counts per mailbox and verification, oldest pending as since, zeros for clean mailboxes", () => {
  const groups: SmsPendingGroup[] = [
    { extension_id: "101", verification: "pending_identity", count: 2, oldest: new Date("2026-10-04T12:00:00Z") },
    { extension_id: "101", verification: "pending_association", count: 1, oldest: new Date("2026-10-03T12:00:00Z") },
    { extension_id: "102", verification: "pending_association", count: 4, oldest: new Date("2026-10-05T12:00:00Z") },
    // Evidence row gone, or a mailbox without a sync-state row: never written anywhere.
    { extension_id: null, verification: "pending_identity", count: 9, oldest: null },
    { extension_id: "999", verification: "pending_identity", count: 3, oldest: null },
  ];
  const out = pendingByMailbox(groups, ["101", "102", "103"], new Map([["101", ALICE]]), NOW);
  assert.deepEqual([...out.keys()], ["101", "102", "103"]);
  assert.deepEqual(out.get("101"), { identity: 2, association: 1, since: new Date("2026-10-03T12:00:00Z"), agent_id: ALICE, computed_at: NOW });
  assert.deepEqual(out.get("102"), { identity: 0, association: 4, since: new Date("2026-10-05T12:00:00Z"), agent_id: null, computed_at: NOW });
  assert.deepEqual(out.get("103"), { identity: 0, association: 0, since: null, agent_id: null, computed_at: NOW }, "a clean mailbox is written zeros");
});

class MemoryPendingStore implements SmsPendingStore {
  rows: SmsPendingMailboxRow[] = [];
  groups: SmsPendingGroup[] = [];
  sinces: Date[] = [];
  written: Array<Map<string, MailboxPending>> = [];
  async listMailboxRows() {
    return this.rows;
  }
  async aggregatePending(since: Date) {
    this.sinces.push(since);
    return this.groups;
  }
  async write(counters: ReadonlyMap<string, MailboxPending>) {
    this.written.push(new Map(counters));
    return counters.size;
  }
}

const reviewed = (extension_id: string, agent_id: string): RepMailbox => ({ rc_account_id: "800000000001", extension_id, agent_id, link_id: agent_id, sender_numbers: [] });

test("olr C7 refreshSmsPendingCounts: off while capture is off; the 7-day window; at most every 5 minutes", async () => {
  const store = new MemoryPendingStore();
  assert.deepEqual(await refreshSmsPendingCounts(NOW, { enabled: async () => false, store }), { skipped: true, reason: "capture_disabled" });
  const deps = { enabled: async () => true, store, mailboxes: async () => [reviewed("101", ALICE)] };
  assert.deepEqual(await refreshSmsPendingCounts(NOW, deps), { skipped: true, reason: "no_mailbox" });

  store.rows = [
    { extension_id: "101", computed_at: null },
    { extension_id: "102", computed_at: null },
  ];
  store.groups = [{ extension_id: "101", verification: "pending_association", count: 1, oldest: new Date("2026-10-05T10:00:00Z") }];
  const first = await refreshSmsPendingCounts(NOW, deps);
  assert.deepEqual(first, { skipped: false, mailboxes: 2, written: 2, identity: 0, association: 1, unattributed: 0 });
  assert.equal(store.sinces[0]!.toISOString(), new Date(NOW.getTime() - SMS_PENDING_WINDOW_MS).toISOString(), "event_at >= now − 7 days");
  assert.equal(store.sinces[0]!.toISOString(), "2026-09-29T15:00:00.000Z");
  assert.equal(store.written[0]!.get("101")!.agent_id, ALICE);
  assert.equal(store.written[0]!.get("102")!.association, 0);

  // Every row computed under 5 minutes ago: skipped. One stale (or new) row: recomputed.
  const recent = new Date(NOW.getTime() - SMS_PENDING_REFRESH_MS + 1_000);
  store.rows = [
    { extension_id: "101", computed_at: recent },
    { extension_id: "102", computed_at: recent },
  ];
  assert.deepEqual(await refreshSmsPendingCounts(NOW, deps), { skipped: true, reason: "fresh" });
  store.rows = [
    { extension_id: "101", computed_at: recent },
    { extension_id: "102", computed_at: new Date(NOW.getTime() - SMS_PENDING_REFRESH_MS) },
  ];
  assert.equal((await refreshSmsPendingCounts(NOW, deps)).skipped, false);

  // Pending evidence of a mailbox without a sync-state row is reported, not attributed.
  store.rows = [{ extension_id: "101", computed_at: null }];
  store.groups = [{ extension_id: "555", verification: "pending_identity", count: 2, oldest: null }];
  const unattributed = await refreshSmsPendingCounts(NOW, deps);
  assert.equal(unattributed.skipped === false && unattributed.unattributed, 2);
});
