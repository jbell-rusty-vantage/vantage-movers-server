# Wake The Drain For Due Sheet-Sync Jobs — Never Throw, Mongo Still Owns Who Drains — operational story

- Status: recommended
- Service: `sheetSync` (Wave A, in-progress)
- Pass: 3 of this service — `sheetSyncQueue.service.ts`
- Remaining in this service: `sheetSyncPersistence.ts`, `sheetSyncSourceLookup.ts`, `drainer/runSheetSyncDrain.ts`, `drainer/jobPlanner.ts`, `drainer/batchWriter.ts`, `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`
- Target: `src/services/sheetSync/sheetSyncQueue.service.ts`
- Knowledge: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (Queue publish is gated; Mongo still owns drain order). Distinct from mode-aware persist / finalize / unmigrated schedule: [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md). Distinct from already-recommended outbox coalesce + tombstone: [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md). Distinct from later `sheet_sync[]` merge-and-save: `sheetSyncPersistence.ts`. Distinct from later lookup-then-write: `sheetSyncSourceLookup.ts`. Distinct from later drain / plan / batch / quota: `drainer/`. Distinct from Lead Messaging `{ kind, reason }` wake-up (no skip log, no operational event, no `run_hint`): [recommendations/lead-messaging-lead-messaging-queue.md](lead-messaging-lead-messaging-queue.md). Distinct from Granot `{ receipt_id }` wake-up (consumer parses the id): [recommendations/granot-lifecycle-queue-publisher.md](granot-lifecycle-queue-publisher.md). Distinct from admin retry (sets `pending` / `due_at=now` on the job row and starts drain; does **not** call this file). Distinct from five-minute cron `/api/cron/sheet-sync-drain` (drains; does not publish). Distinct from Google Sheets tabs / projections: [`google-sheets.md`](../../../docs/knowledge/services/google-sheets.md). Distinct from executor-owned txn + non-replay finalize: [`domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge already flags Granot / RingCentral `enqueueSheetSyncJob` (mode-blind) as a labeled gap; those callers still reach this file only through coordinator `finalizeSheetSync`. Do not “fix” that in this rename.
- Callers: **three runtime import sites, all in the sibling coordinator. Barrel re-exports. No folder test.** After commit, queued finalize: `sheetSyncCoordinator.ts` `finalizeSheetSync` publishes `reason: "domain_write"` (no idempotency key, no `runHint`). After a committed tombstone: same file’s `finalizeSheetSyncDelete` publishes `reason: "domain_delete"`. Unmigrated queued schedule: same file’s `enqueueAndPublish` publishes `reason: "domain_write"` after `enqueueSheetSyncJob` (no session). Public writes reach here through finalize: Form / Call / Booked / Referral / Leadless / Cancelled, enrichment, employee-booking submit / rematch / recon, canonical `existingWrites` / `bookings` adapters, Granot Owner Booking / Release / Referral (checked-in effect flags stay false). Labeled-gap Granot create / sync and RingCentral convergence call `enqueueSheetSyncJob` then `finalizeSheetSync` — they do **not** import this file. Barrel: `sheetSync/index.ts`. Consumer: `api/queues/sheet-sync-consumer.ts` ignores the payload and calls `runSheetSyncDrain("queue")`. Cron: `routes/sheet-sync-cron.routes.ts` calls `runSheetSyncDrain("cron")` and **does not** import this file. Admin retry: `adminSheetSync.service.ts` starts `runSheetSyncDrain("admin")` and **does not** import this file. Config: `config/domain/sheetSync.ts` `shouldPublishSheetSyncQueue` / `getSheetSyncQueueTopic` (tested in `sheetSync.test.ts`). Not this **interface**: later persist-on-document, later source lookup, later drain / plan / batch, `googleSheets/` writes, coordinator persist (never publishes). There is no `sheetSyncQueue.service.test.ts`.
- Seams callers need: after-commit best-effort wake-up vs skip this environment vs fail without throwing; payload is a wake-up (`{ kind, reason, run_hint }`), not a job id; cron / consumer / admin retry drain Mongo and do not publish; Form Lead 201 / command finalize must not wait on `{ published: true }`; persist never publishes
- Split later (only if the file outgrows one sitting): keep one file — this ~100-line module is one screenplay. Never `publish.ts` / `skip.ts` / `create.ts` / `update.ts` / `delete.ts`, and never merge coordinator persist / finalize, outbox coalesce, source lookup, drain, Lead Messaging wake-up, or Granot `{ receipt_id }` into this file

`publishSheetSyncWakeup` is executor mechanics. The owner question is: *The Lead (or Booking, or Cancellation) is already saved, and the durable sheet-sync job is already in Mongo. If this host is allowed to wake the drain, send a tiny wake-up on the Sheet Sync topic so someone looks at due rows soon. If we cannot publish, log the skip or the failure, write an operational event on fail, return unpublished, and do not throw. Mongo still owns who is due. The five-minute cron will find the work. This file does not claim. This file does not talk to Google Sheets. This file does not decide which job to drain.*

Coordinator persist / finalize, outbox coalesce, source lookup, drain, and Google Sheets projections already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “a queue CRUD service,” and not persist / enqueue / drain / Google write:

1. **Wake the drain for due sheet-sync jobs** — accept an optional reason (`domain_write` | `domain_delete` | `cron` | `admin_retry` | `manual`; default `domain_write`), an optional idempotency key, and an optional `runHint`. Ask the sibling config gate whether this environment may publish (not the Vantage test runner, hosted Vercel function `VERCEL=1` plus nonempty `VERCEL_REGION`, approved `VERCEL_ENV`). If not, log `sheet_sync.queue.publish_skipped` with the reason and topic and return `{ published: false, messageId: null }` — no send, no operational event. If yes, `send` `{ kind: "sheet_sync_wakeup", reason, run_hint }` on the env-scoped topic (`sheet-sync-events` when the topic helper’s approved `VERCEL_ENV` matches, otherwise `sheet-sync-events-dev`, unless `SHEET_SYNC_QUEUE_TOPIC` overrides), passing the idempotency key through when present. Success logs `sheet_sync.queue.published` and returns `{ published: true, messageId }`. Send throw logs `sheet_sync.queue.publish_failed` with `err`, writes operational event `sheet_sync.queue.publish_failed` (`notificationCandidate: false`), and still returns `{ published: false, messageId: null }`. This function never throws. It never claims. It never writes a job, Lead, or Booking. It never talks to Google Sheets.

There is no second mutate operation. The consumer ignores `kind` / `reason` / `run_hint` and drains due Mongo. Cron never calls this file. Admin retry never calls this file. `reason: "cron" | "admin_retry" | "manual"` are on the union and have no publisher. No runtime caller passes `idempotencyKey` or `runHint` — `run_hint` is always `null` on the wire today.

## Organization

Keep one file as the screenplay for “wake the drain for due sheet-sync jobs — never throw, Mongo still owns who drains.” Config gates, Vercel `send`, coordinator finalize, outbox remember, claim/drain, and Google writes already live in deeper **modules**. Do not pull those in. Do not invent a `SheetSyncQueueService` class. Do not invent a canonical-command `begin` / `complete` **seam** — this is a best-effort wake-up after the outbox row is already committed, not a Domain Command. Do not invent a Granot `{ receipt_id }` **seam** that has only one **adapter** here — the consumer does not parse an id. Do not invent a Lead Messaging boolean **seam** beside `{ published, messageId }`.

Do not split this ~100-line file into skip / send / fail folders. Those are beats of one wake-up. Do not move the function into `sheetSyncCoordinator.ts` so “finalize owns publish.” Do not move it into the consumer so “the drain already runs.” Do not publish from cron or admin retry so “every drain uses the queue.” Do not publish from persist so “the wake-up rides the Mongo write.”

**External interface** stays small (this is the test surface). Gate, send, and swallow are one story’s wake-up, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `publishSheetSyncWakeup` | `wakeTheDrainForDueSheetSyncJobs` | sibling queued finalize, delete finalize, unmigrated `enqueueAndPublish` |
| `SheetSyncWakeupReason` | `SheetSyncWakeupReason` | five-reason union the payload carries; consumer does not branch on it |
| `SheetSyncWakeupMessage` | `SheetSyncWakeup` | `{ kind, reason, run_hint }` the consumer will keep ignoring |
| `PublishSheetSyncWakeupOptions` | `WakeTheDrainOptions` | reason / unused idempotency key / unused `runHint` |

Keep the old name as a one-line alias until the sibling coordinator and the barrel migrate. Do not make callers learn `VERCEL_REGION` / `@vercel/queue` / `SHEET_SYNC_QUEUE_TOPIC` as the domain language.

**Principle: old exports stay as aliases.** `publishSheetSyncWakeup` remains the imported name until `finalizeSheetSync` / `finalizeSheetSyncDelete` / `enqueueAndPublish` point at the story name.

**No class for the workflow.** The type that *does* earn a name is the wake-up bag the consumer will keep ignoring:

```ts
type SheetSyncWakeup = {
  kind: "sheet_sync_wakeup"
  reason: SheetSyncWakeupReason
  run_hint: string | null
}
```

That is the handoff from “a sheet-sync job is due” to “a later invocation may drain whoever Mongo says is due.” Do **not** add `job_id` so “the consumer can claim this row,” do **not** drop `run_hint` so “the payload matches Lead Messaging `{ kind, reason }`,” and do **not** send `{ receipt_id }` so “every Vantage wake-up looks like Granot.”

There is no deps bag today. Do not invent `WakeTheDrainDeps` unless a later test **adapter** needs to inject the config gate and Vercel `send`. Default remains `shouldPublishSheetSyncQueue` and Vercel `send`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// sheetSyncQueue.service.ts
// The Lead (or Booking, or Cancellation) is already saved.
// The durable sheet-sync job is already in Mongo.
// Try to wake the drain so someone looks at due rows soon.
// If this environment must not publish, log the skip.
// If Vercel Queue is down, swallow the failure and write an operational event.
// Mongo still owns who is due.
// The five-minute cron will find the work.
// This file does not claim.
// This file does not talk to Google Sheets.
// This file does not decide which job to drain.
// Cron does not call this file.
// Admin retry does not call this file.

// ── 1. Wake the drain for due sheet-sync jobs ─────────────

export async function wakeTheDrainForDueSheetSyncJobs(options?)
export const publishSheetSyncWakeup = wakeTheDrainForDueSheetSyncJobs

function thisEnvironmentMustNotPublish()          // sibling config gate
function rememberWeSkippedTheWakeup(reason, topic)
async function sendTheWakeupOnTheSheetSyncTopic(wakeup, idempotencyKey)
function rememberTheWakeupWentOut(reason, topic, messageId)
async function rememberTheWakeupFailedWithoutThrowing(reason, topic, error)
  // log + sheet_sync.queue.publish_failed (notificationCandidate: false)

export type SheetSyncWakeupReason =
  | "domain_write"
  | "domain_delete"
  | "cron"
  | "admin_retry"
  | "manual"
```

Read the primary path out loud: *The Lead is already written and the outbox row is already committed. Queued finalize (or the unmigrated enqueue-and-publish, or a delete finalize) asks this host to wake the drain. On the approved hosted Vercel function, send `{ kind: "sheet_sync_wakeup", reason, run_hint: null }` — not a job id — on the Sheet Sync topic. If the send throws, log it, write an operational event that does not page, and return unpublished. Either way the Form Lead 201 and the minted Lead stay. Local, preview, tests, and the test runner skip the send and log the skip. The consumer ignores the payload and drains due Mongo. The five-minute cron still scans due rows and never publishes. Admin retry starts the drain itself and never publishes.*

That is the operation. `publishSheetSyncWakeup` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The consumer ignores the payload.** `sheet-sync-consumer.ts` connects Mongo and calls `runSheetSyncDrain("queue")`. It does not parse `kind`, `reason`, or `run_hint`. Mongo owns due / coalesce / priority / lease / quota. Do not start switching on `reason` so “the consumer knows why,” and do not send `job_id` so “the consumer can claim this row.” Granot’s consumer parses exactly `{ receipt_id }`. This drain is a scan, not an id claim.

2. **`cron`, `admin_retry`, and `manual` are on the reason union and never published.** The cron route drains directly. Admin retry starts `runSheetSyncDrain("admin")`. No caller passes those three reasons into this file. Do not publish from `/api/cron/sheet-sync-drain` so “every drain uses the queue,” do not publish from retry so “the comment becomes true,” and do not delete the unused reasons so “the type is honest” in this rename. Leave them visible.

3. **Skip logs. Lead Messaging does not.** Closed gate logs `sheet_sync.queue.publish_skipped` with reason and topic. Lead Messaging `return false` with no skip log. Granot logs a masked skip. Do not drop the skip log so “we match Lead Messaging,” and do not increment a failure metric on skip so “every unpublished looks like an outage.”

4. **Fail writes an operational event. Lead Messaging does not.** Send throw writes `sheet_sync.queue.publish_failed` with `notificationCandidate: false`. Granot emits the same-shaped event and increments a metric. Lead Messaging only `logger.error`. Do not drop the event so “every queue matches Lead Messaging,” and do not flip `notificationCandidate` so “a queue outage pages the owner.”

5. **All three callers ignore `{ published, messageId }`.** Finalize, delete finalize, and unmigrated `enqueueAndPublish` await and discard. Form Lead Ingestion / command finalize must not wait on a wake-up. Do not throw so “queued mode can fail the 201,” and do not change the sibling to return `unpublished` so “the 201 becomes honest.”

6. **`idempotencyKey` and `runHint` have no runtime caller.** The option comment says bursts of writes can pass the same key so the queue collapses repeated wake-ups. Coordinator never passes either. `run_hint` is always `null` on the wire. Do not start wiring a debounce key from finalize so “the comment becomes true,” and do not drop `run_hint` from the payload so “we match Lead Messaging.” Leave the unused options visible.

7. **Default reason is `domain_write`.** Delete finalize passes `domain_delete` explicitly. A missing reason is a write wake-up, not a delete. Do not make the default `manual` so “unknown looks safer,” and do not refuse a missing reason so “callers must be honest.”

8. **Publish stays after the outbox row is saved, outside persist.** Persist never publishes. Knowledge Role names this file on the Sheet Sync stack. The coordinator already recorded after-commit tell as the finalize **seam**. Do not move `wakeTheDrainForDueSheetSyncJobs` into `rememberTheSheetSyncIntent` so the Role line “wins,” and do not publish from a persist `catch` so “the cron will find a row we never wrote.”

9. **The publish gate is independent of `SHEET_SYNC_MODE`.** Queued mode on a laptop still returns unpublished. Disabled drain no-ops even if a leftover wake-up arrives. Coordinator only calls this file in queued mode. Do not require `mode === "queued"` inside this file so “disabled never wakes,” and do not honor `SHEET_SYNC_QUEUE_LOCAL_PUBLISH` so “local queue testing works.” Knowledge and config tests already lock that flag as a no-op.

10. **Config gates stay in `sheetSync.ts`.** Test runner, `VERCEL === "1"`, nonempty `VERCEL_REGION`, and approved `VERCEL_ENV` are the sibling’s **interface**. Preview never publishes. This file only asks `thisEnvironmentMustNotPublish()`. Lead Messaging and Granot also refuse `isTestMode()`. This file does not. Do not add a `TEST_MODE` refuse so “we match Lead Messaging,” and do not inline the env reads so “the publisher is self-contained.”

11. **Topic is resolved before the gate.** Skip logs include the topic even when `send` is not called. That is the current contract. Do not hide the topic on skip so “unpublished never names a queue.”

12. **The operational-event await sits inside the send `catch`.** `recordOperationalEvent` is designed not to throw (it logs and returns `null`). Keep that. Do not let a Mongo observability miss fail the Form Lead 201. Do not skip the await so “the 201 never waits on observability” unless a later measured hang proves it.

13. **The barrel re-exports this file.** Lead Messaging’s barrel does not. Coordinator imports the path. Domain services import finalize from the barrel and never import this file. Do not remove the barrel export so “we match Lead Messaging,” and do not teach Form Lead to call `wakeTheDrainForDueSheetSyncJobs` so “ingestion owns the wake-up.”

14. **Unmigrated `enqueueAndPublish` is a second adapter, not a second operation.** Persist threads the caller session and finalize publishes after commit. Unmigrated `schedule*` enqueues with no session, then publishes. Knowledge already names that the unmigrated fallback. Keep both **adapters**. Do not silently make schedule call persist. Do not silently refuse a missing session here — this file has no session.

15. **Leave sibling modules alone.** `shouldPublishSheetSyncQueue` / `getSheetSyncQueueTopic` stay in config. `finalizeSheetSync` / `finalizeSheetSyncDelete` / `enqueueAndPublish` stay in the coordinator. `enqueueSheetSyncJob` stays in the outbox. `runSheetSyncDrain` stays the drain. This file orchestrates gate → send or swallow.

## Testing

The **interface** is the test surface: `wakeTheDrainForDueSheetSyncJobs` (today `publishSheetSyncWakeup`). `{ published, messageId }` and the sent `{ kind, reason, run_hint }` are part of that **interface**.

There is no `sheetSyncQueue.service.test.ts`. Config tests lock topic + preview-off + `SHEET_SYNC_QUEUE_LOCAL_PUBLISH` no-op + test-runner refuse. Coordinator tests never stub this file. That is not enough for a wake-up this small and this load-bearing. Add tests that name the operation. Do not add a test per helper.

**Wake the drain for due sheet-sync jobs**
- Closed gate (default test runner / preview / missing `VERCEL_REGION`) → `{ published: false, messageId: null }`, `send` not called, `sheet_sync.queue.publish_skipped` is logged, no `publish_failed` event.
- Forced-on send uses `getSheetSyncQueueTopic()` and a payload whose keys are exactly `["kind", "reason", "run_hint"]` with `kind === "sheet_sync_wakeup"`.
- Missing options → `reason === "domain_write"` and `run_hint === null`.
- Success → `{ published: true, messageId }` and `sheet_sync.queue.published`.
- Send throw → `{ published: false, messageId: null }`, this file does not throw, `sheet_sync.queue.publish_failed` is logged, operational event `sheet_sync.queue.publish_failed` is written with `notificationCandidate: false`.
- Idempotency key is forwarded to `send` when present and omitted when absent.
- `reason: "cron" | "admin_retry" | "manual"` are accepted if someone passes them; no runtime caller does.

**Not this interface**
- Persist / finalize / unmigrated schedule stay on [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md).
- Remember-or-fold / tombstone stay on [recommendations/sheet-sync-outbox.md](sheet-sync-outbox.md).
- `VERCEL_ENV` topic matrix and `SHEET_SYNC_QUEUE_LOCAL_PUBLISH` no-op stay on `sheetSync.test.ts`.
- Consumer drain / cron `skipped` JSON stay on those **adapters**.
- Lead Messaging `{ kind, reason }` stays on [recommendations/lead-messaging-lead-messaging-queue.md](lead-messaging-lead-messaging-queue.md).
- Granot `{ receipt_id }` stays on [recommendations/granot-lifecycle-queue-publisher.md](granot-lifecycle-queue-publisher.md).
- Admin retry / health stay on later Wave A `admin`.
- Later drain / plan / batch stay on later `drainer/` passes.

Do **not** add a test per helper (`thisEnvironmentMustNotPublish`, `rememberWeSkippedTheWakeup`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that cron publishes — it must not. Do not add a test that admin retry publishes — it must not. Do not add a test that the consumer branches on `reason` — it must not. Do not add a test that persist publishes — it must not.

## What I would not do

- A `SheetSyncQueueService` class with `publish` / `skip` / `fail`.
- Thirty two-line functions that only wrap `send()`.
- Moving this into a CRUD folder, or into `sheetSyncCoordinator.ts` / the consumer / persist “for cleanliness.”
- Publishing from persist, cron, admin retry, or the consumer.
- Sending a job id, a Granot `{ receipt_id }`, or a Lead Messaging boolean.
- Throwing on send failure, or making the Form Lead 201 / minted Lead wait on `{ published: true }`.
- Honoring `SHEET_SYNC_QUEUE_LOCAL_PUBLISH`, or adding a `TEST_MODE` refuse this file does not have.
- Dropping `run_hint` or the skip log or the operational event so “every queue matches Lead Messaging.”
- Writing a whole-folder recommendation for `sheetSync`.
- Jumping to `googleSheets` while this checklist has unchecked modules.
- Failing Form Lead create because Vercel Queue threw.
