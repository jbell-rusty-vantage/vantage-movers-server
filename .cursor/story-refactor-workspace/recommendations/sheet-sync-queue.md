# sheet-sync-queue

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/sheetSync/sheetSyncQueue.service.ts`
- Domain evidence: `docs/knowledge/services/sheet-sync.md`
- Current exported operations and constants: `publishSheetSyncWakeup`.

## Current boundary

Preserve the current target’s authentication, inputs, outputs, ordering, errors, idempotency and side effects; retain existing public names as aliases until callers migrate. Structured logs are current: do not recreate Operational Events storage or notifications.

## Specific implementation checks from the original brief

1. **The consumer ignores the payload.** `sheet-sync-consumer.ts` connects Mongo and calls `runSheetSyncDrain("queue")`. It does not parse `kind`, `reason`, or `run_hint`. Mongo owns due / coalesce / priority / lease / quota. Do not start switching on `reason` so “the consumer knows why,” and do not send `job_id` so “the consumer can claim this row.” Granot’s consumer parses exactly `{ receipt_id }`. This drain is a scan, not an id claim.

2. **`cron`, `admin_retry`, and `manual` are on the reason union and never published.** The cron route drains directly. Admin retry starts `runSheetSyncDrain("admin")`. No caller passes those three reasons into this file. Do not publish from `/api/cron/sheet-sync-drain` so “every drain uses the queue,” do not publish from retry so “the comment becomes true,” and do not delete the unused reasons so “the type is honest” in this rename. Leave them visible.

6. **`idempotencyKey` and `runHint` have no runtime caller.** The option comment says bursts of writes can pass the same key so the queue collapses repeated wake-ups. Coordinator never passes either. `run_hint` is always `null` on the wire. Do not start wiring a debounce key from finalize so “the comment becomes true,” and do not drop `run_hint` from the payload so “we match Lead Messaging.” Leave the unused options visible.

7. **Default reason is `domain_write`.** Delete finalize passes `domain_delete` explicitly. A missing reason is a write wake-up, not a delete. Do not make the default `manual` so “unknown looks safer,” and do not refuse a missing reason so “callers must be honest.”

8. **Publish stays after the outbox row is saved, outside persist.** Persist never publishes. Knowledge Role names this file on the Sheet Sync stack. The coordinator already recorded after-commit tell as the finalize **seam**. Do not move `wakeTheDrainForDueSheetSyncJobs` into `rememberTheSheetSyncIntent` so the Role line “wins,” and do not publish from a persist `catch` so “the cron will find a row we never wrote.”

15. **Leave sibling modules alone.** `shouldPublishSheetSyncQueue` / `getSheetSyncQueueTopic` stay in config. `finalizeSheetSync` / `finalizeSheetSyncDelete` / `enqueueAndPublish` stay in the coordinator. `enqueueSheetSyncJob` stays in the outbox. `runSheetSyncDrain` stays the drain. This file orchestrates gate → send or swallow.
