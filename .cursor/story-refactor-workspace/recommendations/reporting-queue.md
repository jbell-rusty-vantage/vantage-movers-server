# Wake The Reporting Worker For This Run — Never Throw, Never Provider-Deduplicate, Mongo Still Owns The Lease — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 14 of this service — `queue.ts`
- Remaining in this service: `reportingRunRepository.ts`, `reportingDeliveryRepository.ts`, `reportingManifestRepository.ts`, `manifestPageAdapter.ts`, `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, leftover `google/*` adapters, leftover `live/*` harness
- Target: `src/services/reporting/queue.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → worker write. Queue: reporting consumer → leftover `reportingWorker`. Cron: `/api/cron/reporting-delivery-heartbeat` wakes stranded leased runs. Knowledge never names `publishReportingWakeup`, `REPORTING_DELIVERY_TOPIC`, provider non-dedup, or the two-env publish gate — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover preview / freeze / estimate / confirm: [`reporting-reporting.md`](reporting-reporting.md) (leftover confirm **asks** this file **after** the run row exists; leftover replay does **not**). Distinct from already-recommended leftover claim / lease / write-then-promote: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (leftover consumer **asks** leftover worker with leftover `runHint`; leftover heartbeat **asks** this file and never leftover worker). Distinct from leftover run persist: sibling `reportingRunRepository.ts` (`claimNextQueuedReportingRun` applies leftover `{ _id: runHint }` when the consumer forwards the hint). Distinct from leftover Wave B `src/routes/reporting.routes.ts` (Owner cancel **asks** this file after leftover `requestReportingRunCancellation` is already `cancel_requested` / `already_requested`). Distinct from leftover Wave B `src/routes/reporting-cron.routes.ts` (heartbeat finds one stranded row, then **asks** this file; health-scan / cleanup / janitor do **not**). Distinct from leftover Wave B `api/queues/reporting-consumer.ts` (reads leftover `run_hint`, then **asks** leftover worker; it never imports this file). Distinct from leftover live harness: `live/liveGoogleOrchestration.ts` **asks** leftover worker in-process and never publishes. Distinct from already-recommended Sheet Sync wake-up: [`sheet-sync-queue.md`](sheet-sync-queue.md) (`{ kind, reason, run_hint }`, config gate, skip log, operational event on fail; consumer **ignores** the payload). Distinct from already-recommended Granot `{ receipt_id }` wake-up: [`granot-lifecycle-queue-publisher.md`](granot-lifecycle-queue-publisher.md) (consumer parses the id). Distinct from already-recommended Lead Messaging wake-up: [`lead-messaging-lead-messaging-queue.md`](lead-messaging-lead-messaging-queue.md) (`{ kind, reason }`, no `run_hint`, no skip log). Distinct from later Wave A `ingestion/queue.ts` (same reason union and almost the same `send`; leftover ingestion **does** pass a provider idempotency key). Distinct from leftover `durableWork/types.ts` (`DurableWorkWakeup` is the shared bag; do not open that unvisited folder). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: **three runtime import sites.** After leftover confirm persist: leftover `reporting.service.ts` dynamic-imports this file and **asks** `publishReportingWakeup({ reason: "manual", run_hint })`, then returns leftover `wakeupPublished` on the first queued run only. After Owner cancel: Wave B `src/routes/reporting.routes.ts` **asks** `{ reason: "manual", run_hint }` when leftover cancel is `cancel_requested` or `already_requested` and **discards** the boolean. After leftover heartbeat: Wave B `src/routes/reporting-cron.routes.ts` **asks** `{ reason: "cron", run_hint }` for one stranded queued/querying/writing/verifying/promoting row whose lease is missing or expired; on hosted Vercel, unpublished → `503`. Consumer: `api/queues/reporting-consumer.ts` reads leftover `run_hint` and **asks** leftover `runReportingDeliveryWorker({ runHint })` — it does **not** import this file. Leftover worker **asks** leftover `claimNextQueuedReportingRun({ runHint })`. Leftover live harness never publishes. Tests: **none**. `reporting.test.ts` / leftover delivery tests / leftover cron tests do not import this file. **No runtime caller** for leftover `reason: "schedule" | "retry" | "recovery"`.
- Seams callers need: after-persist best-effort wake-up vs skip this environment vs fail without throwing; payload is a wake-up (`{ kind, reason, run_hint }`), not a claim; leftover `run_hint` is a hint the consumer **may** forward, not a job id Granot would parse; first leftover confirm publishes, leftover confirm replay does not; leftover cancel `already_requested` still publishes; leftover heartbeat publishes and never drains; hosted Vercel heartbeat treats unpublished as `503`; there is no provider idempotency key. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): keep one file — this ~35-line module is one screenplay. Never `publish.ts` / `skip.ts` / `create.ts` / `update.ts` / `delete.ts`, and never merge leftover confirm, leftover cancel, leftover heartbeat, leftover consumer, leftover worker, leftover ingestion queue, or leftover Sheet Sync wake-up into this file

`publishReportingWakeup` is executor mechanics. The owner question is: *The confirmed run (or the cancel request, or the stranded lease) is already in Mongo. If this host is allowed to poke the reporting worker, send a tiny wake-up on the reporting-delivery topic so someone looks soon. Do not ask Vercel to collapse two pokes for the same run — a later cancel or heartbeat must still arrive. If we cannot publish, return false and do not throw. The run still stands. Mongo still owns the five-minute lease. The five-minute heartbeat will find stranded work. This file does not claim. This file does not write Google. This file does not decide which run to drain.*

Leftover confirm, leftover cancel persist, leftover claim / lease, leftover consumer, leftover Sheet Sync wake-up, leftover Granot `{ receipt_id }`, leftover ingestion queue already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “a queue CRUD service,” and not leftover confirm / leftover cancel / leftover claim / leftover Google write:

1. **Wake the reporting worker for this run** — accept a reason (`manual` | `schedule` | `retry` | `cron` | `recovery`) and an optional `run_hint`. Ask the two-env gate whether this host may publish (`VERCEL === "1"` and `NODE_ENV` is the live hosted token). If not, return `false` — no send, no skip log, no operational event. If yes, `send` `{ kind: "reporting_wakeup", reason, run_hint }` on hardcoded `reporting-delivery-events` with **no** provider `idempotencyKey`. Success returns `true`. Send throw logs `reporting.queue.publish_failed` with `err` and leftover `runId: run_hint` and still returns `false`. This function never throws. It never claims. It never writes a run, destination, or Google cell.

There is no second mutate operation. Leftover confirm, leftover cancel, and leftover heartbeat are three **adapters** of this one poke. Leftover consumer reads leftover `run_hint` and leftover worker claims Mongo. Leftover health-scan / leftover cleanup / leftover janitor never call this file. Leftover `reason: "schedule" | "retry" | "recovery"` are on the union and have no reporting publisher.

## Organization

Keep one file. This is the screenplay for “wake the reporting worker for this run — never throw, never provider-deduplicate, Mongo still owns the lease.” Vercel `send`, leftover confirm persist, leftover cancel persist, leftover claim, leftover consumer already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingQueueService` class. Do not invent a begin / complete Domain Command **seam** — this is a best-effort poke after the run is already saved, not a Domain Command. Do not invent a Granot `{ receipt_id }` **seam** that has only one **adapter** here — leftover consumer does not `parseReceiptWakeup`. Do not invent a leftover ingestion provider-idempotency **seam**. Do not invent a leftover Sheet Sync skip-log / operational-event **seam** beside `logger.error`.

Do not split this ~35-line file into skip / send / fail folders. Those are beats of one poke. Do not move the function into leftover `reporting.service.ts` so “confirm owns publish.” Do not move it into leftover heartbeat so “cron owns the queue.” Do not move it into leftover consumer so “the drain already runs.” Do not publish from leftover worker so “the worker owns the heartbeat.”

**External interface** stays small (this is the test surface). Gate, send, and swallow are one story’s poke, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `publishReportingWakeup` | `wakeTheReportingWorkerForThisRun` | leftover first confirm, leftover Owner cancel, leftover heartbeat |
| `REPORTING_DELIVERY_TOPIC` | `REPORTING_DELIVERY_TOPIC` | hardcoded `reporting-delivery-events`; leftover `vercel.json` wildcard `reporting-delivery-events*` |

Keep the old name as a one-line alias until leftover `reporting.service.ts`, leftover `reporting.routes.ts`, and leftover `reporting-cron.routes.ts` migrate. Do not make callers learn `@vercel/queue` / `VERCEL` / `NODE_ENV` as the domain language.

**Principle: old exports stay as aliases.** `publishReportingWakeup` remains the imported name until leftover confirm / leftover cancel / leftover heartbeat point at the story name.

**No class for the workflow.** The type that *does* earn a name is the wake-up bag leftover consumer already peeks at:

```ts
type ReportingWakeup = {
  kind: "reporting_wakeup"
  reason: "manual" | "schedule" | "retry" | "cron" | "recovery"
  run_hint: string | null
}
```

That is the handoff from “a reporting run needs a poke” to “a later invocation may claim whoever Mongo says is due, preferring this hint when it is still claimable.” Do **not** add a provider `idempotencyKey` so “we match leftover ingestion,” do **not** drop leftover `run_hint` so “we match Lead Messaging,” and do **not** send `{ receipt_id }` so “every Vantage wake-up looks like Granot.” Do **not** move leftover `DurableWorkWakeup` into this file so “the shared type lives next to send.”

There is no deps bag today. Do not invent `WakeTheReportingWorkerDeps` unless a later test **adapter** needs to inject the gate and Vercel `send`. Default remains the two-env gate and Vercel `send`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// queue.ts
// The confirmed run (or the cancel request, or the stranded lease)
// is already in Mongo.
// Try to wake the reporting worker so someone looks soon.
// Do not ask Vercel to collapse two pokes for the same run.
// A later cancel or heartbeat must still arrive.
// If this environment must not publish, skip.
// If Vercel Queue is down, swallow the failure.
// The run still stands.
// Mongo still owns the five-minute lease.
// The five-minute heartbeat will find stranded work.
// This file does not claim.
// This file does not write Google.
// This file does not decide which run to drain.
// The worker does not call this file.
// The live harness does not call this file.

// ── 1. Wake the reporting worker for this run ─────────────

export async function wakeTheReportingWorkerForThisRun(input)
export const publishReportingWakeup = wakeTheReportingWorkerForThisRun

function thisHostMustNotPublish()                 // VERCEL=1 and live hosted NODE_ENV
async function sendTheWakeupWithoutCollapsingLaterPokes(wakeup)
function rememberTheWakeupFailedWithoutThrowing(run_hint, error)

export const REPORTING_DELIVERY_TOPIC = "reporting-delivery-events"
```

Read the primary path out loud: *The owner confirmed the write. The run row is already `queued`. Leftover confirm asks this host to poke the worker with `reason: "manual"` and that run id. On hosted Vercel live, send `{ kind: "reporting_wakeup", reason, run_hint }` — not a claim, and not a provider idempotency key — on `reporting-delivery-events`. The consumer reads the hint and asks leftover worker to claim that id if it is still due. If the send throws, log it and return unpublished. The 202 still includes the run. A later Owner cancel for the same id still pokes. A later five-minute heartbeat that finds this lease expired still pokes. Local and the test runner skip the send. Idempotent confirm replay does not poke again. The heartbeat never drains. The worker never publishes.*

That is the operation. `publishReportingWakeup` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Provider dedup is forbidden on purpose.** The file comment says durable run leases make duplicate deliveries harmless, while deduplicating by run/reason can suppress later cancel and heartbeat pokes. Leftover ingestion `publishIngestionWakeup` passes `idempotencyKey: best-relocation:${run_hint}`. This file passes nothing. Do not add that key so “the twins match,” and do not delete the comment so “send looks cleaner.”

2. **Leftover consumer uses leftover `run_hint`. Sheet Sync’s consumer does not.** `reporting-consumer.ts` forwards leftover `run_hint` into leftover `runReportingDeliveryWorker`. Leftover `claimNextQueuedReportingRun` then filters `{ _id: runHint }` when the hint is present. Sheet Sync ignores `{ kind, reason, run_hint }` and scans due Mongo. Granot parses exactly `{ receipt_id }`. Do not drop leftover `run_hint` so “we match Lead Messaging,” and do not start switching leftover consumer on leftover `reason` so “the worker knows why.” A missing or already-leased hint still returns leftover `lease_busy_or_empty`; Mongo still owns the lease.

3. **First leftover confirm publishes. Leftover confirm replay does not.** Leftover `prepareManualRun` dynamic-imports this file only after leftover `persistedRunReplay(..., false)` for the newly inserted run. Concurrent consume, consumed-key replay, and existing-run replay return without leftover `wakeupPublished`. Do not start publishing on replay so “every confirm pokes,” and do not fail leftover confirm when leftover `wakeupPublished` is `false` so “the 202 is honest.” Knowledge already says publish `false` does not delete the run.

4. **Leftover cancel `already_requested` still publishes.** Wave B cancel **asks** this file for both `cancel_requested` and `already_requested`, then discards the boolean and still answers 200. That second poke is why leftover provider dedup must stay off. Do not skip `already_requested` so “one cancel is enough,” and do not change leftover cancel to `reason: "retry"` so “the union looks used.”

5. **Leftover heartbeat publishes and never drains.** `/api/cron/reporting-delivery-heartbeat` finds one stranded row (queued / querying / writing / verifying / promoting, lease missing or expired; when leftover Google delivery is off, only rows with leftover `cancellation_requested_at`). Then it **asks** this file with `reason: "cron"`. It never leftovers leftover `runReportingDeliveryWorker`. Sheet Sync cron drains. Granot cron drains. Lead Messaging cron drains. Do not start leftover worker from leftover heartbeat so “every cron matches Sheet Sync,” and do not delete leftover heartbeat so “confirm is enough.”

6. **Hosted Vercel heartbeat treats unpublished as `503`.** When leftover `published` is `false` and `VERCEL === "1"`, leftover heartbeat returns `503` “Reporting recovery wakeup could not be published.” Local unpublished is `{ ok: true, woke: true, published: false }`. Leftover confirm and leftover cancel never 503 on unpublished. Do not make leftover confirm wait on leftover `true` so “the owner sees a real queue,” and do not drop leftover heartbeat `503` so “every publisher is best-effort.”

7. **The error letter says recovery. The reason is `cron`.** Leftover heartbeat `503` names “recovery wakeup.” Leftover reason union includes leftover `recovery` and leftover reporting never sends it. Do not rename leftover heartbeat to leftover `recovery` so “the letter wins,” and do not add a leftover `recovery` publisher from leftover health-scan so “the unused reason looks live.”

8. **Leftover `schedule` / `retry` / `recovery` are unused here.** They live on leftover `DurableWorkWakeup` because leftover ingestion uses them. Do not delete them so “the reporting union is honest,” and do not start leftover scheduled-report publish from this file so “the reason exists.” Leave them visible.

9. **The publish gate is two env reads, not leftover `reporting.ts`.** Sheet Sync / Granot / Lead Messaging ask a sibling config helper (`VERCEL_REGION`, approved `VERCEL_ENV`, often leftover `TEST_MODE` / leftover test-runner). This file only asks `VERCEL === "1"` and leftover live hosted `NODE_ENV`. There is no leftover `-dev` topic and no leftover `REPORTING_QUEUE_TOPIC` override. Leftover `vercel.json` already wildcards `reporting-delivery-events*`. Do not add leftover `shouldPublishReportingQueue` so “every queue matches Sheet Sync,” do not honor leftover `SHEET_SYNC_QUEUE_LOCAL_PUBLISH`, and do not refuse leftover preview `VERCEL_ENV` in this rename.

10. **Skip is silent. Fail logs. Neither writes an operational event.** Closed gate returns `false` with no skip log (Lead Messaging). Send throw logs `reporting.queue.publish_failed` with `err` and does not leftover `recordOperationalEvent` (Sheet Sync does; Granot does). Do not add a skip log so “we match Sheet Sync,” and do not add leftover `notificationCandidate: false` so “a queue outage pages.”

11. **Leftover confirm dynamic-imports. Leftover cancel and leftover heartbeat import statically.** The after-persist **seam** stays outside leftover confirm’s Mongo session (`session.endSession()` already ran). Do not move leftover `send` inside leftover confirm’s transaction so “the poke rides the write,” and do not publish from leftover persist `catch` so “the heartbeat will find a run we never wrote.”

12. **Leftover `wakeupPublished` is only on the first queued return.** Leftover `serializePersistedRunReplay` does not carry it. Wave B `POST .../run` returns leftover `202` with leftover `{ runId, status, executionPackage, idempotentReplay, wakeupPublished }` for that first queue. Replay JSON has no leftover `wakeupPublished`. Do not add leftover `wakeupPublished: false` on replay so “the envelope is stable,” and do not strip it from leftover first confirm so “the owner never sees the poke.”

13. **Leftover live harness never publishes.** Leftover `liveGoogleOrchestration.ts` **asks** leftover `runReportingDeliveryWorker({ runHint: runId })` in-process. Do not teach leftover live bind to leftover `wakeTheReportingWorkerForThisRun` so “every run uses the queue.”

14. **Leave sibling modules alone.** Leftover `prepareManualRun` stays leftover confirm. Leftover `requestReportingRunCancellation` stays leftover run persist. Leftover `claimNextQueuedReportingRun` stays leftover run persist. Leftover `runReportingDeliveryWorker` stays leftover worker. Leftover `publishIngestionWakeup` stays later Wave A `ingestion`. This file orchestrates gate → send without collapsing later pokes, or swallow.

15. **Do not treat leftover ingestion, leftover Sheet Sync, leftover Granot drain, leftover Analytics, or leftover Master Sheet as this story.** Do not write a whole-folder recommendation for `reporting`.

## Testing

The **interface** is the test surface: `wakeTheReportingWorkerForThisRun` (today `publishReportingWakeup`). `{ true | false }` and the sent `{ kind, reason, run_hint }` are part of that **interface**.

There is no `queue.test.ts`. Leftover `reporting.test.ts` never leftovers leftover `prepareManualRun`. Leftover cron has no folder test. That is not enough for a poke this small and this load-bearing. Add tests that name the operation. Do not add a test per helper.

**Wake the reporting worker for this run**
- Closed gate (missing `VERCEL=1`, or `NODE_ENV` is not the live hosted token) → `false`, `send` not called, no `publish_failed` log.
- Forced-on send uses leftover `REPORTING_DELIVERY_TOPIC` (`reporting-delivery-events`) and a payload whose keys are exactly `["kind", "reason", "run_hint"]` with `kind === "reporting_wakeup"`.
- Missing leftover `run_hint` → leftover `run_hint === null` on the wire.
- Success → `true`. The `send` options do **not** include leftover `idempotencyKey`.
- Send throw → `false`, this file does not throw, `reporting.queue.publish_failed` is logged with leftover `runId`.
- Leftover `reason: "schedule" | "retry" | "recovery"` are accepted if someone passes them; no reporting runtime caller does.

**Not this interface**
- Leftover first confirm / leftover replay stay on [`reporting-reporting.md`](reporting-reporting.md).
- Leftover claim / leftover lease stay on leftover `reportingRunRepository.ts` and [`reporting-reporting-worker.md`](reporting-reporting-worker.md).
- Leftover heartbeat `503` / leftover `{ woke: false }` stay on Wave B leftover cron tests — do **not** assert leftover `503` here.
- Leftover consumer leftover `runHint` forward stays on leftover consumer.
- Leftover Sheet Sync wake-up stays on [`sheet-sync-queue.md`](sheet-sync-queue.md).
- Leftover Granot `{ receipt_id }` stays on [`granot-lifecycle-queue-publisher.md`](granot-lifecycle-queue-publisher.md).
- Leftover Lead Messaging `{ kind, reason }` stays on [`lead-messaging-lead-messaging-queue.md`](lead-messaging-lead-messaging-queue.md).
- Leftover ingestion provider idempotency stays on later Wave A `ingestion/queue.ts`.

Do **not** add a test per helper (`thisHostMustNotPublish`, `sendTheWakeupWithoutCollapsingLaterPokes`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that leftover confirm replay publishes — it must not. Do not add a test that leftover worker publishes — it must not. Do not add a test that leftover heartbeat leftovers leftover worker — it must not. Do not add a test that leftover `send` receives leftover `idempotencyKey` — it must not.

## What I would not do

- A `ReportingQueueService` class with `publish` / `skip` / `fail`.
- Thirty two-line functions that only wrap `send()`.
- Moving this into a CRUD folder, or into leftover `reporting.service.ts` / leftover heartbeat / leftover consumer / leftover worker “for cleanliness.”
- Publishing from leftover confirm’s Mongo session, leftover confirm replay, leftover worker, leftover live harness, leftover health-scan, leftover cleanup, or leftover janitor.
- Adding a leftover ingestion-style provider `idempotencyKey` so “two pokes for the same run collapse.”
- Sending a Granot `{ receipt_id }`, a Lead Messaging boolean, or a Sheet Sync skip log / operational event.
- Throwing on send failure, or making leftover confirm `202` / leftover cancel `200` wait on leftover `true`.
- Starting leftover `runReportingDeliveryWorker` from leftover heartbeat so “every cron drains.”
- Inventing leftover `shouldPublishReportingQueue` or a leftover `-dev` topic in this rename.
- Writing a whole-folder recommendation for `reporting`.
- Jumping to leftover `ingestion` while this checklist has unchecked modules.
- Deleting the run because Vercel Queue threw.
