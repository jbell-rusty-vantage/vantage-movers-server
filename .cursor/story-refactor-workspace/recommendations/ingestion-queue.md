# Wake The Best Relocation Worker For This Run — Never Throw, Collapse Later Pokes For The Same Run Hint, Mongo Still Owns The Lease — operational story

- Status: recommended
- Service: `ingestion` (Wave A, visited)
- Pass: 5 of this service — `queue.ts`
- Remaining in this service: none
- Target: `src/services/ingestion/queue.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (primary code **is** `applyPlan.ts`. Role: Inspect Best Relocation sheets, plan create/update/adopt/conflict after the 2026-04-30 Eastern cutoff, and apply a checksum-bound plan under a single lease. Mongo domain documents are System of Record and are written only through canonical commands. Best Relocation workbooks are the external evidence source. `IngestionRun` / `SourceRowReceipt` / `IngestionConflict` / `ExternalDataConnection` key `best_relocation` are operational evidence, not a second Lead authority. HTTP / queue / cron: consumer → `runBestRelocationIngestionWorker`; heartbeat wakes stranded work and may queue a due `schedule` run. Knowledge never names `publishIngestionWakeup`, `BEST_RELOCATION_INGESTION_TOPIC`, the two-env publish gate, or the provider `idempotencyKey` — do not add an Ingestion Service file in this rename so the Service sentence wins). Distinct from already-recommended claim / inspect / lock / finalize: [`ingestion-worker.md`](ingestion-worker.md) (worker **asks** this file only on a retryable Google fail, then **rethrows**; the consumer **asks** the worker and never this file). Distinct from already-recommended walk: [`ingestion-apply-plan.md`](ingestion-apply-plan.md) (apply never publishes). Distinct from already-recommended persist: [`ingestion-repository.md`](ingestion-repository.md) (`createQueuedIngestionRun` / `oldestRecoverableIngestionRun` persist or find the run; they never publish). Distinct from already-recommended letters: [`ingestion-health.md`](ingestion-health.md) (this file never writes a letter). Distinct from already-recommended Reporting poke: [`reporting-queue.md`](reporting-queue.md) (same reason union and almost the same `send`; reporting **forbids** a provider key; the reporting consumer **forwards** `run_hint`). Distinct from already-recommended Sheet Sync poke: [`sheet-sync-queue.md`](sheet-sync-queue.md) (`{ kind, reason, run_hint }`, config gate, skip log, operational event on fail; consumer **ignores** the payload; no runtime caller passes a key). Distinct from already-recommended Granot `{ receipt_id }` poke: [`granot-lifecycle-queue-publisher.md`](granot-lifecycle-queue-publisher.md) (consumer parses the id). Distinct from already-recommended Lead Messaging poke: [`lead-messaging-lead-messaging-queue.md`](lead-messaging-lead-messaging-queue.md) (`{ kind, reason }`, no `run_hint`, silent skip). Distinct from unvisited `durableWork/types.ts` (`DurableWorkWakeup` is the shared bag; do not open that folder). Distinct from Wave B Owner HTTP `src/routes/ingestion.routes.ts` (preview / approve / Owner retry **ask** this file **after** the run row exists and **discard** the boolean). Distinct from Wave B heartbeat `src/routes/best-relocation-ingestion-cron.routes.ts` (recovery then schedule; unpublished → `503`; recovery unpublished **exits** before the due claim). Distinct from Wave B `api/queues/best-relocation-ingestion-consumer.ts` (ignores the payload, **asks** the worker; `lease_busy` throws so Vercel retries). Distinct from CLI dry-run (never publishes). This checkout's `CONTEXT.md` does not define Ingestion Origin / Best Relocation / Ingestion Run — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: **six runtime import sites, six adapters of one poke.** After fail + retry persist: `worker.ts` **asks** `{ reason: "retry", run_hint }` then **rethrows**. After Owner preview persist: Wave B `POST .../preview` **asks** `{ reason: "manual", run_hint: queued.run_id }` then `202` and **discards** the boolean. After Owner approve CAS: Wave B `POST .../run` **asks** `{ reason: "manual", run_hint }` then `202` and **discards** the boolean. After Owner retry persist: Wave B `POST .../runs/:runId/retry` **asks** `{ reason: "retry", run_hint }` then `202` and **discards** the boolean. After heartbeat finds `oldestRecoverableIngestionRun`: Wave B cron **asks** `{ reason: "recovery", run_hint }`; unpublished → `503` and **does not** claim the due cadence. After `claimDueBestRelocationConnection` + `createQueuedIngestionRun` `schedule`: Wave B cron **asks** `{ reason: "schedule", run_hint }`; unpublished → `503`; published → `202` with `queue_published`. Barrel: `src/services/ingestion/index.ts`. Consumer: `api/queues/best-relocation-ingestion-consumer.ts` **asks** `runBestRelocationIngestionWorker()` with **no** `runHint` — it does **not** import this file. Tests: **none** **ask** `publishIngestionWakeup`. `ingestion.test.ts` source-reads the consumer `lease_busy` throw. Apply / persist / health / inspect / conflict resolve / CLI never import this file. **No runtime caller** for `reason: "cron"`.
- Seams callers need: after-persist best-effort wake-up vs skip this environment vs fail without throwing; payload is a wake-up (`{ kind, reason, run_hint }`), not a claim; `run_hint` is a provider-dedup key the consumer **ignores**; Owner HTTP always answers `202`; heartbeat unpublished is `503`; recovery unpublished **exits** before schedule; worker retry publishes then **rethrows**; `reason: "cron"` is unused. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no Analytics **seam**. There is no Sheet Sync drain **seam**.
- Split later (only if the file outgrows one sitting): this ~38-line file is one sitting if you read it as wake the Best Relocation worker for this run — never throw, collapse later pokes for the same run hint, Mongo still owns the lease. Do **not** split into `publish.ts` / `skip.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull worker claim / Owner HTTP / heartbeat / consumer / Reporting poke here so one queue file owns the company. If it later splits: `wakeTheBestRelocationWorkerForThisRun.ts` only as a later story file, never CRUD.

`publishIngestionWakeup` is executor mechanics. The owner question is: *The Best Relocation run is already in Mongo. If this host is allowed to poke the worker, send a tiny wake-up on the Best Relocation ingestion topic so someone looks soon. Ask Vercel to collapse a later poke that carries the same run id. If we cannot publish, return false and do not throw. The run still stands. Mongo still owns the five-minute apply lease. The heartbeat will find stranded work. This file does not claim. This file does not inspect sheets. This file does not decide which run to drain.*

Worker claim / apply walk / repository persist / health letters / Owner HTTP / heartbeat already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not "a queue CRUD service," and not claim / Owner approve / heartbeat:

1. **Wake the Best Relocation worker for this run** — accept a reason (`manual` | `schedule` | `retry` | `cron` | `recovery`) and an optional `run_hint`. Ask the two-env gate whether this host may publish (`VERCEL === "1"` and `NODE_ENV` is the live hosted token). If not, return `false` — no send, no skip log, no operational event. If yes, `send` `{ kind: "ingestion_wakeup", reason, run_hint }` on hardcoded `best-relocation-ingestion-events`. When `run_hint` is present, pass `idempotencyKey: best-relocation:${run_hint}`. When `run_hint` is missing, pass `undefined` (no key). Success returns `true`. Send throw logs `best_relocation_ingestion.queue.publish_failed` with `err` and `runId: run_hint` and still returns `false`. This function never throws. It never claims. It never writes a run, receipt, conflict, Lead, or Booking.

There is no second mutate operation. Owner preview, Owner approve, Owner retry, worker retry, heartbeat recovery, and heartbeat schedule are six **adapters** of this one poke. The consumer ignores `kind` / `reason` / `run_hint` and **asks** the worker. The worker claims an already-approved applying run first, then a queued one. `reason: "cron"` is on the union and has no ingestion publisher.

## Organization

Keep one file. This is the screenplay for "wake the Best Relocation worker for this run — never throw, collapse later pokes for the same run hint, Mongo still owns the lease." Vercel `send`, worker claim, Owner persist, heartbeat recover / claim-due already live in deeper **modules**. Do not pull those in. Do not invent an `IngestionQueueService` class. Do not invent a begin / complete Domain Command **seam** — this is a best-effort poke after the run is already saved, not a Domain Command. Do not invent a Granot `{ receipt_id }` **seam** that has only one **adapter** here — the consumer does not `parseReceiptWakeup`. Do not invent a Reporting `runHint` claim **seam**. Do not invent a Sheet Sync skip-log / operational-event **seam** beside `logger.error`.

Do not split this ~38-line file into skip / send / fail folders. Those are beats of one poke. Do not move the function into `worker.ts` so "claim owns publish." Do not move it into heartbeat so "cron owns the queue." Do not move it into the consumer so "the drain already runs." Do not publish from apply so "the walk owns the poke." Do not publish from `createQueuedIngestionRun` so "persist owns the queue."

**External interface** stays small (this is the test surface). Gate, send, collapse, and swallow are one story's poke, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `publishIngestionWakeup` | `wakeTheBestRelocationWorkerForThisRun` | worker retry, Owner preview / approve / retry, heartbeat recovery / schedule |
| `BEST_RELOCATION_INGESTION_TOPIC` | `BEST_RELOCATION_INGESTION_TOPIC` | hardcoded `best-relocation-ingestion-events`; `vercel.json` wildcard `best-relocation-ingestion-events*` |

Keep the old name as a one-line alias until `worker.ts`, `ingestion/index.ts`, `ingestion.routes.ts`, and `best-relocation-ingestion-cron.routes.ts` migrate. Do not make callers learn `@vercel/queue` / `VERCEL` / `NODE_ENV` as the domain language.

**Principle: old exports stay as aliases.** `publishIngestionWakeup` remains the imported name until worker / Owner HTTP / heartbeat point at the story name.

**No class for the workflow.** The type that *does* earn a name is the wake-up bag the consumer already ignores:

```ts
type BestRelocationIngestionWakeup = {
  kind: "ingestion_wakeup"
  reason: "manual" | "schedule" | "retry" | "cron" | "recovery"
  run_hint: string | null
}
```

That is the handoff from "a Best Relocation run needs a poke" to "a later invocation may claim whoever Mongo says is due." Do **not** drop `run_hint` so "we match Lead Messaging," do **not** drop `idempotencyKey` so "we match reporting," and do **not** send `{ receipt_id }` so "every Vantage wake-up looks like Granot." Do **not** move `DurableWorkWakeup` into this file so "the shared type lives next to send."

There is no deps bag today. Do not invent `WakeTheBestRelocationWorkerDeps` unless a later test **adapter** needs to inject the gate and Vercel `send`. Default remains the two-env gate and Vercel `send`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// queue.ts
// The Best Relocation run is already in Mongo.
// Try to wake the worker so someone looks soon.
// Ask Vercel to collapse a later poke that carries the same run id.
// If this environment must not publish, skip.
// If Vercel Queue is down, swallow the failure.
// The run still stands.
// Mongo still owns the five-minute apply lease.
// The heartbeat will find stranded work.
// This file does not claim.
// This file does not inspect sheets.
// This file does not decide which run to drain.
// The consumer does not read this payload.
// The worker does not call this file except on one retry.

// --- 1. Wake the Best Relocation worker for this run ---

export async function wakeTheBestRelocationWorkerForThisRun(input)
export const publishIngestionWakeup = wakeTheBestRelocationWorkerForThisRun

function thisHostMustNotPublish()                 // VERCEL=1 and live hosted NODE_ENV
function collapseKeyForThisRun(run_hint)          // best-relocation:${run_hint} or none
async function sendTheWakeupAndCollapseLaterPokesForTheSameRun(wakeup)
function rememberTheWakeupFailedWithoutThrowing(run_hint, error)

export const BEST_RELOCATION_INGESTION_TOPIC =
  "best-relocation-ingestion-events"
```

Read the primary path out loud: *The owner queued a Best Relocation preview. The run row is already `queued`. Owner HTTP asks this host to poke the worker with `reason: "manual"` and that run id. On hosted Vercel live, send `{ kind: "ingestion_wakeup", reason, run_hint }` — not a claim — on `best-relocation-ingestion-events`, and ask Vercel to collapse any later poke that carries the same run id. The consumer ignores the payload and asks the worker to claim whoever Mongo says is due: an already-approved applying run first, then a queued one. If the send throws, log it and return unpublished. The 202 still includes the run. A later Owner approve for the same id still pokes with the same collapse key. A later heartbeat recovery for that stranded id still pokes with the same collapse key. Local and the test runner skip the send. The heartbeat treats unpublished as 503. Owner HTTP never waits on true. The worker never publishes except one retryable Google fail, and then it rethrows.*

That is the operation. `publishIngestionWakeup` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **Provider dedup is on purpose here, and forbidden on reporting.** This file passes `idempotencyKey: best-relocation:${run_hint}` whenever `run_hint` is present. Reporting `publishReportingWakeup` passes nothing so a later cancel or heartbeat still arrives. Name the collapse. Do **not** silently drop the key so "the twins match," and do **not** silently add a key to reporting so "every Vantage poke collapses."

2. **The consumer ignores `run_hint`. Reporting's consumer does not.** `best-relocation-ingestion-consumer.ts` **asks** `runBestRelocationIngestionWorker()` with no `runHint`. The worker claims an already-approved applying run first, then a queued one. Reporting forwards `run_hint` into `claimNextQueuedReportingRun`. Sheet Sync ignores `{ kind, reason, run_hint }` and scans due Mongo. Granot parses `{ receipt_id }`. Do **not** start forwarding `run_hint` so "we match reporting," and do **not** start switching the consumer on `reason` so "the worker knows why." A missing poke still leaves Mongo owning the lease.

3. **Owner preview and Owner approve share one collapse key.** Preview publishes `manual` with the new run id. Approve CAS-es that same id to `applying` and publishes `manual` again. Vercel may collapse the apply poke against the inspect poke. Name the shared key. Do **not** silently omit `run_hint` on approve so "apply still wakes" without proving heartbeat recovery still finds `awaiting_approval` that flipped to `applying`. Do **not** silently change approve to `reason: "retry"` so "the union looks used."

4. **Heartbeat recovery uses the same collapse key as the original poke.** `oldestRecoverableIngestionRun` is a queued or unleased inspecting / planning / applying row. Recovery **asks** `{ reason: "recovery", run_hint: strandedRunId }`. If preview or approve already poked that id, Vercel may swallow recovery. Name the silent recover. Do **not** silently drop `run_hint` on recovery so "stranded work always pokes," and do **not** silently start the worker from heartbeat so "every cron matches Sheet Sync."

5. **Recovery unpublished exits before schedule.** When `recovered` is `false`, heartbeat returns `503` and never **asks** `claimDueBestRelocationConnection`. A closed gate on a stranded row also blocks the due cadence run. Name the early exit. Do **not** silently continue after unpublished recovery so "schedule still fires," and do **not** silently drop recovery so "schedule is enough."

6. **Heartbeat unpublished is `503`. Owner HTTP never waits on `true`.** Hosted Vercel recovery / schedule treat `false` as `503`. Preview / approve / Owner retry always `202` and discard the boolean. Reporting confirm also keeps the 202. Name the two postures. Do **not** make Owner preview wait on `true` so "the owner sees a real queue," and do **not** drop heartbeat `503` so "every publisher is best-effort."

7. **Worker retry publishes then rethrows.** `failRun` plus a new `retry` run **asks** this file with a **new** run id (new collapse key). Then the worker **rethrows**, so the consumer lets Vercel retry the **original** delivery too. Two pokes for one Google miss. Name the pair. Do **not** silently drop the rethrow so "one poke owns retry" — the consumer `lease_busy` throw is why an active lease must not ack. Do **not** silently drop the publish so "rethrow is enough."

8. **`reason: "cron"` is unused here.** It lives on `DurableWorkWakeup` because reporting heartbeat sends `cron`. Ingestion heartbeat sends `recovery` then `schedule`. Name the unused reason. Do **not** rename recovery to `cron` so "the twins match," and do **not** add a `cron` publisher from health so "the unused reason looks live."

9. **The publish gate is two env reads, not a sibling config helper.** Sheet Sync / Granot / Lead Messaging **ask** a sibling config (`VERCEL_REGION`, approved `VERCEL_ENV`, often `TEST_MODE`). This file only **asks** `VERCEL === "1"` and the live hosted `NODE_ENV`. There is no `-dev` topic and no `BEST_RELOCATION_INGESTION_QUEUE_TOPIC` override. `vercel.json` already wildcards `best-relocation-ingestion-events*`. Do **not** add `shouldPublishIngestionQueue` so "every queue matches Sheet Sync," do **not** honor `SHEET_SYNC_QUEUE_LOCAL_PUBLISH`, and do **not** refuse preview `VERCEL_ENV` in this rename.

10. **Skip is silent. Fail logs. Neither writes an operational event.** Closed gate returns `false` with no skip log (reporting / Lead Messaging). Send throw logs `best_relocation_ingestion.queue.publish_failed` with `err` and does not **ask** `recordOperationalEvent` (Sheet Sync does; Granot does). Do **not** add a skip log so "we match Sheet Sync," and do **not** add `notificationCandidate: false` so "a queue outage pages."

11. **Owner HTTP asks this file after the run row exists.** Preview **asks** `createQueuedIngestionRun` then publish. Approve CAS-es `awaiting_approval` → `applying` then publish. Owner retry **asks** `IngestionRun.create` then publish. The after-persist **seam** stays outside the Mongo write of this file. Do **not** move `send` inside `createQueuedIngestionRun` so "the poke rides the write," and do **not** publish from persist `catch` so "the heartbeat will find a run we never wrote."

12. **CLI never publishes.** `pnpm ingest:best-relocation -- --dry-run` inspects and writes a sanitized report. Live apply is retired. Do **not** teach the CLI to **ask** this file so "every inspect uses the queue."

13. **Leave sibling modules alone.** `runBestRelocationIngestionWorker`, `applyBestRelocationPlan`, `createQueuedIngestionRun`, `oldestRecoverableIngestionRun`, `emitIngestionHealthSignal`, `publishReportingWakeup` are already the right **depth**. This file gates, sends, collapses later pokes for the same run, or swallows. Do not open `bestRelocationSheetIngest/` this pass. Do not open `durableWork/` this pass.

14. **Do not treat Sheet Sync drain, Granot `{ receipt_id }`, Reporting write, Analytics, or the Master Sheet as this story.** Do not write a whole-folder recommendation for `ingestion`.

## Testing

The **interface** is the test surface: `wakeTheBestRelocationWorkerForThisRun` (today `publishIngestionWakeup`). `{ true | false }` and the sent `{ kind, reason, run_hint }` plus the optional provider key are part of that **interface**.

There is no `queue.test.ts`. `ingestion.test.ts` never **asks** `publishIngestionWakeup`. That is not enough for a poke this small and this load-bearing. Add tests that name the operation. Do not add a test per helper.

**Wake the Best Relocation worker for this run**
- Closed gate (missing `VERCEL=1`, or `NODE_ENV` is not the live hosted token) → `false`, `send` not called, no `publish_failed` log.
- Forced-on send uses `BEST_RELOCATION_INGESTION_TOPIC` (`best-relocation-ingestion-events`) and a payload whose keys are exactly `["kind", "reason", "run_hint"]` with `kind === "ingestion_wakeup"`.
- Missing `run_hint` → `run_hint === null` on the wire and **no** `idempotencyKey` on the `send` options.
- Present `run_hint` → `idempotencyKey === "best-relocation:${run_hint}"`.
- Success → `true`.
- Send throw → `false`, this file does not throw, `best_relocation_ingestion.queue.publish_failed` is logged with `runId`.
- `reason: "cron"` is accepted if someone passes it; no ingestion runtime caller does.

**Not this interface**
- Worker claim / inspect / lock / finalize stay on [`ingestion-worker.md`](ingestion-worker.md).
- Apply walk stays on [`ingestion-apply-plan.md`](ingestion-apply-plan.md).
- Heartbeat `503` / recovery-exits-before-schedule stay on Wave B cron tests — do **not** assert `503` here.
- Consumer ignore-payload / `lease_busy` throw stay on the consumer (today a source-read in `ingestion.test.ts`).
- Reporting poke stays on [`reporting-queue.md`](reporting-queue.md).
- Sheet Sync poke stays on [`sheet-sync-queue.md`](sheet-sync-queue.md).
- Granot `{ receipt_id }` stays on [`granot-lifecycle-queue-publisher.md`](granot-lifecycle-queue-publisher.md).
- Lead Messaging `{ kind, reason }` stays on [`lead-messaging-lead-messaging-queue.md`](lead-messaging-lead-messaging-queue.md).

Do **not** add a test per helper (`thisHostMustNotPublish`, `collapseKeyForThisRun`, `sendTheWakeupAndCollapseLaterPokesForTheSameRun`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that Owner preview waits on `true` — it must not. Do not add a test that the worker publishes except on retryable Google fail — it must not. Do not add a test that heartbeat **asks** the worker — it must not. Do not add a test that `send` omits `idempotencyKey` when `run_hint` is present — it must not.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Ingestion Origin / Best Relocation / Ingestion Run.
- I would not open Wave B (`src/routes/ingestion.routes.ts`, `src/routes/best-relocation-ingestion-cron.routes.ts`, `api/queues/best-relocation-ingestion-consumer.ts`).
- I would not write a whole-folder Ingestion recommendation.
- I would not introduce an `IngestionQueueService` class or a `publish.ts` / `skip.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second Vercel `send` **adapter** beside `@vercel/queue`.
- I would not invent a second observability **adapter** beside the error log.
- I would not silently drop the provider `idempotencyKey` so "the twins match reporting."
- I would not silently forward `run_hint` into the consumer so "we match reporting."
- I would not silently omit `run_hint` on Owner approve so "apply still wakes."
- I would not silently start `runBestRelocationIngestionWorker` from heartbeat so "every cron drains."
- I would not silently continue after unpublished recovery so "schedule still fires."
- I would not make Owner preview / approve / retry wait on `true`.
- I would not silently drop the worker rethrow so "one poke owns retry."
- I would not add `shouldPublishIngestionQueue` or a `-dev` topic in this rename.
- I would not silently start `recordOperationalEvent` from this file.
- I would not open `bestRelocationSheetIngest/` or `durableWork/` as a second recommendation this pass.
- I would not silently reorder ADR-known side effects.
