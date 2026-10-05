import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type { MailboxSyncSummary } from "./mailboxSync";
import type { RepMailbox } from "./mailboxes";
import {
  extensionFromMessageStoreEvent,
  fanOutRepSmsReceipt,
  REP_SMS_SYNC_STAGE,
  repSmsIntentKey,
  runRepSmsSyncJob,
  type RepSmsSyncJobDeps,
} from "./intent";
import { inRepSmsPollWindow } from "./gate";
import { mailboxesDueForPoll, repSmsPollSlot, runRepSmsSafetyPoll } from "./poll";

const NOW = new Date("2026-10-05T15:00:03.000Z"); // 11:00 EDT
const mailbox = (extension_id: string): RepMailbox => ({ rc_account_id: "800000000001", extension_id, agent_id: "a", link_id: "l", sender_numbers: [] });

test("message-store events name the mailbox; telephony and other events are not SMS intents", () => {
  assert.equal(extensionFromMessageStoreEvent("/restapi/v1.0/account/800000000001/extension/101/message-store"), "101");
  assert.equal(extensionFromMessageStoreEvent("/restapi/v1.0/account/~/extension/101/message-store?type=SMS"), "101");
  assert.equal(extensionFromMessageStoreEvent("/restapi/v1.0/account/~/telephony/sessions"), null);
  assert.equal(extensionFromMessageStoreEvent("/restapi/v1.0/account/~/extension/101/presence"), null);
  assert.equal(extensionFromMessageStoreEvent(null), null);
});

test("coalesced intent: one job per mailbox per 10-second bucket, due 2 s after the bucket (2–12 s debounce)", () => {
  const a = repSmsIntentKey("101", new Date("2026-10-05T15:00:00.100Z"));
  const b = repSmsIntentKey("101", new Date("2026-10-05T15:00:09.900Z"));
  const c = repSmsIntentKey("101", new Date("2026-10-05T15:00:10.000Z"));
  assert.equal(a.dedupe_key, b.dedupe_key);
  assert.notEqual(a.dedupe_key, c.dedupe_key);
  assert.notEqual(a.dedupe_key, repSmsIntentKey("102", new Date("2026-10-05T15:00:00.100Z")).dedupe_key);
  assert.equal(a.due_at.toISOString(), "2026-10-05T15:00:12.000Z");
});

test("webhook fan-out: gated by controls.rep_sms_capture_enabled (fail closed); a burst enqueues once and publishes once", async () => {
  const event = "/restapi/v1.0/account/~/extension/101/message-store";
  assert.deepEqual(await fanOutRepSmsReceipt({ event: "/restapi/v1.0/account/~/telephony/sessions", receivedAt: NOW }), { status: "skipped", reason: "not_message_store" });
  assert.deepEqual(await fanOutRepSmsReceipt({ event, receivedAt: NOW }, { enabled: async () => false }), { status: "skipped", reason: "capture_disabled" });
  const rows = new Map<string, { _id: mongoose.Types.ObjectId; createdAt: Date; stage: string; subject_key: string }>();
  const published: string[] = [];
  const deps = {
    enabled: async () => true,
    now: () => NOW,
    transaction: async <T,>(work: (session: never) => Promise<T>) => work({} as never),
    exists: async (key: string) => rows.has(key),
    enqueue: (async (input: { dedupe_key: string; stage: string; subject_key: string }, _s: unknown, now: Date) => {
      const existing = rows.get(input.dedupe_key);
      if (existing) return existing;
      const row = { _id: new mongoose.Types.ObjectId(), createdAt: now, stage: input.stage, subject_key: input.subject_key };
      rows.set(input.dedupe_key, row);
      return row;
    }) as never,
    publish: { shouldPublish: () => true, send: async (_topic: string, payload: { job_id: string }) => void published.push(payload.job_id) },
  };
  const first = await fanOutRepSmsReceipt({ event, receivedAt: new Date("2026-10-05T15:00:01Z") }, deps);
  const second = await fanOutRepSmsReceipt({ event, receivedAt: new Date("2026-10-05T15:00:05Z") }, deps);
  assert.equal(first.status, "enqueued");
  assert.equal(second.status, "existing");
  assert.equal(rows.size, 1);
  assert.equal([...rows.values()][0]!.stage, REP_SMS_SYNC_STAGE);
  assert.equal([...rows.values()][0]!.subject_key, "rep_sms:101");
  assert.equal(published.length, 1);
  const failing = await fanOutRepSmsReceipt({ event, receivedAt: NOW }, { ...deps, transaction: async () => { throw new Error("mongo down"); } });
  assert.deepEqual(failing, { status: "enqueue_failed" });
});

function summary(partial: Partial<MailboxSyncSummary>): MailboxSyncSummary {
  return {
    extension_id: "101", skipped: false, skip_reason: null, sync_type: "ISync", requests: 1, records: 0, inserted: 0, updated: 0, unchanged: 0, stale: 0,
    ignored: 0, failures: 0, expired: false, token_stored: true, known_complete_through: null, woken: 0, error_code: null,
    throttle_retry_after_ms: null, throttle_retry_after_observed: false, ...partial,
  };
}

function jobHarness(input: { subject?: string; enabled?: boolean; mailboxes?: RepMailbox[]; result?: MailboxSyncSummary }) {
  const calls = { complete: [] as unknown[], fail: [] as Array<{ reason: string; retryAfterMs: number; resumeAt?: Date }>, sync: 0 };
  const deps: RepSmsSyncJobDeps = {
    now: () => NOW,
    claim: (async () => ({ _id: new mongoose.Types.ObjectId(), lease_epoch: 1, subject_key: input.subject ?? "rep_sms:101" })) as never,
    complete: (async (_lease: unknown, _m: unknown, options: { result: unknown }) => void calls.complete.push(options.result)) as never,
    fail: (async (_lease: unknown, reason: string, retryAfterMs: number, options: { resumeAt?: Date }) => {
      calls.fail.push({ reason, retryAfterMs, resumeAt: options.resumeAt });
      return { status: "retry", next_attempt_at: new Date(NOW.getTime() + 30_000) };
    }) as never,
    enabled: async () => input.enabled ?? true,
    mailboxes: async () => input.mailboxes ?? [mailbox("101")],
    sync: async () => {
      calls.sync += 1;
      return input.result ?? summary({});
    },
    publish: { shouldPublish: () => false },
  };
  return { deps, calls };
}

test("rep_sms_sync job: syncs a reviewed mailbox; disabled capture and unreviewed mailboxes complete without a provider call", async () => {
  const ok = jobHarness({});
  assert.equal(((await runRepSmsSyncJob(undefined, ok.deps)) as { state: string }).state, "synced");
  assert.equal(ok.calls.sync, 1);
  const off = jobHarness({ enabled: false });
  assert.equal(((await runRepSmsSyncJob(undefined, off.deps)) as { state: string }).state, "capture_disabled");
  assert.equal(off.calls.sync, 0);
  const foreign = jobHarness({ mailboxes: [mailbox("999")] });
  assert.equal(((await runRepSmsSyncJob(undefined, foreign.deps)) as { state: string }).state, "not_reviewed_mailbox");
  assert.equal(foreign.calls.sync, 0);
  const bad = jobHarness({ subject: "rep_sms:abc" });
  assert.equal(((await runRepSmsSyncJob(undefined, bad.deps)) as { state: string }).state, "subject_invalid");
});

test("rep_sms_sync job: throttle defers by Retry-After without spending an attempt; held mailbox retries in 15 s; other failures back off", async () => {
  const throttled = jobHarness({ result: summary({ error_code: "provider_throttled", throttle_retry_after_ms: 45_000 }) });
  const outcome = await runRepSmsSyncJob(undefined, throttled.deps);
  assert.ok(outcome.status === "retry" && outcome.reason === "throttled");
  assert.deepEqual(throttled.calls.fail[0], { reason: "throttled", retryAfterMs: 45_000, resumeAt: undefined });
  const held = jobHarness({ result: summary({ skipped: true, skip_reason: "lease_held" }) });
  await runRepSmsSyncJob(undefined, held.deps);
  assert.equal(held.calls.fail[0]!.resumeAt?.getTime(), NOW.getTime() + 15_000);
  const failed = jobHarness({ result: summary({ error_code: "evidence_write_failed" }) });
  await runRepSmsSyncJob(undefined, failed.deps);
  assert.equal(failed.calls.fail[0]!.reason, "transient");
  const denied = jobHarness({ result: summary({ error_code: "provider_permission_denied" }) });
  assert.equal(((await runRepSmsSyncJob(undefined, denied.deps)) as { state: string }).state, "permission_denied", "E01 not proven: no retry storm");
});

test("safety poll window: New York [07:45, 20:30), DST-safe", () => {
  assert.equal(inRepSmsPollWindow(new Date("2026-10-05T11:44:00Z")), false);
  assert.equal(inRepSmsPollWindow(new Date("2026-10-05T11:45:00Z")), true);
  assert.equal(inRepSmsPollWindow(new Date("2026-11-02T01:29:00Z")), true, "20:29 EST");
  assert.equal(inRepSmsPollWindow(new Date("2026-11-02T01:30:00Z")), false);
  assert.equal(inRepSmsPollWindow(new Date("2026-03-08T11:45:00Z")), true, "07:45 EDT on spring-forward Sunday");
});

test("safety poll stagger: each mailbox owns one of five minute slots; a mailbox synced in the last 4 minutes is skipped", () => {
  const boxes = Array.from({ length: 10 }, (_, i) => mailbox(String(101 + i)));
  const perSlot = new Map<number, number>();
  for (const b of boxes) perSlot.set(repSmsPollSlot(b.extension_id), (perSlot.get(repSmsPollSlot(b.extension_id)) ?? 0) + 1);
  // Over five consecutive minutes every mailbox is due exactly once.
  const seen: string[] = [];
  for (let minute = 0; minute < 5; minute += 1) {
    seen.push(...mailboxesDueForPoll(boxes, new Map(), new Date(Date.UTC(2026, 9, 5, 15, minute))).map((m) => m.extension_id));
  }
  assert.deepEqual(seen.sort(), boxes.map((b) => b.extension_id).sort());
  const target = boxes[0]!;
  const slotMinute = new Date(Date.UTC(2026, 9, 5, 15, repSmsPollSlot(target.extension_id)));
  const fresh = new Map([[target.extension_id, new Date(slotMinute.getTime() - 3 * 60_000)]]);
  assert.equal(mailboxesDueForPoll([target], fresh, slotMinute).length, 0);
  const old = new Map([[target.extension_id, new Date(slotMinute.getTime() - 5 * 60_000)]]);
  assert.equal(mailboxesDueForPoll([target], old, slotMinute).length, 1);
});

test("safety poll: disabled capture or off-hours never read the mailboxes; a throttle ends the minute", async () => {
  const touched: string[] = [];
  const base = {
    now: () => NOW,
    enabled: async () => true,
    mailboxes: async () => {
      touched.push("mailboxes");
      return Array.from({ length: 10 }, (_, i) => mailbox(String(101 + i)));
    },
    lastSuccess: async () => new Map<string, Date | null>(),
    sync: async (m: RepMailbox) => summary({ extension_id: m.extension_id, error_code: "provider_throttled" }),
  };
  assert.equal((await runRepSmsSafetyPoll({ ...base, enabled: async () => false })).skip_reason, "capture_disabled");
  assert.equal((await runRepSmsSafetyPoll({ ...base, now: () => new Date("2026-10-05T02:00:00Z") })).skip_reason, "outside_staffed_hours");
  assert.deepEqual(touched, []);
  const ran = await runRepSmsSafetyPoll(base);
  assert.equal(ran.mailboxes, 10);
  assert.ok(ran.polled <= 1, "stops at the first throttle");
});
