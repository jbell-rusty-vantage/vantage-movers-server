import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type { MailboxSyncSummary } from "./mailboxSync";
import type { RepMailbox } from "./mailboxes";
import {
  repSmsIntentKey,
  runRepSmsSyncJob,
  type RepSmsSyncJobDeps,
} from "./intent";

const NOW = new Date("2026-10-05T15:00:03.000Z"); // 11:00 EDT
const mailbox = (extension_id: string): RepMailbox => ({ rc_account_id: "800000000001", extension_id, agent_id: "a", link_id: "l", sender_numbers: [] });

test("coalesced intent: one job per mailbox per 10-second bucket, due 2 s after the bucket (2–12 s debounce)", () => {
  const a = repSmsIntentKey("101", new Date("2026-10-05T15:00:00.100Z"));
  const b = repSmsIntentKey("101", new Date("2026-10-05T15:00:09.900Z"));
  const c = repSmsIntentKey("101", new Date("2026-10-05T15:00:10.000Z"));
  assert.equal(a.dedupe_key, b.dedupe_key);
  assert.notEqual(a.dedupe_key, c.dedupe_key);
  assert.notEqual(a.dedupe_key, repSmsIntentKey("102", new Date("2026-10-05T15:00:00.100Z")).dedupe_key);
  assert.equal(a.due_at.toISOString(), "2026-10-05T15:00:12.000Z");
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
