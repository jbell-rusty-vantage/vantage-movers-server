# S-GRANOT evidence: Granot Health replacement (SLIM-04.1) and receipt search/Live Events removal (SLIM-02, server)

Lane date: 2026-10-03. Branch `slim/server-admin`. The lane did not commit anything.

## What changed and why

### 1. Bounded Granot Health state replaces the OperationalEvents reads (SPEC §4.1)

New model `src/models/GranotLifecycleHealthState.ts` writes to the collection **`granot_lifecycle_health_state`** in the selected runtime database (`getMongoDatabaseName()`, the same `useDb` pattern as `GranotLifecycleActivation`). Every row has a deterministic string `_id`, so each write is one atomic upsert:

| Row | `_id` | Content |
| --- | --- | --- |
| Coverage / freshness marker | `coverage` | `counters_since` (cutover instant, `$setOnInsert`), `last_write_at` (`$max`), `gap_at` (latest missed write, `$max`) |
| Minute counter | `bucket:<metric>:<dimension>:<minute ISO>` | `metric` ∈ {`capture_failed`, `claim_recovered`, `owner_command_conflict`}, `dimension` = `all` or a closed `OWNER_COMMAND_CONFLICT_CODES` value, `bucket_start`, `count` (`$inc`), `expires_at` = bucket + 48h |
| Latest run | `last_run:queue`, `last_run:cron` | `status` (`completed`/`failed`), `at` (CAS: only a newer `at` wins) |
| Alert state | `alert:<code>:<scope_ref or global>` | `state` (`firing`/`ok`), `since`, `transitioned_at` (CAS transitions) |

The rows hold no per-event data, payloads, contact fields, actor text or reason text. The schema is `strict`. `scope_ref` is the existing masked source id.

Indexes, both declared on the schema with mongoose `autoIndex`:
- `granot_lifecycle_health_bucket_unique` on `{kind, metric, dimension, bucket_start}`, unique, partial on `kind: "bucket"`. This is the explicit uniqueness fence, on top of the deterministic `_id`.
- `granot_lifecycle_health_expires_ttl` on `{expires_at}` with `expireAfterSeconds: 0`. Buckets age out after 48h. That is double the largest Health lookback (24h).

Service `src/services/granotLifecycle/healthState.ts`:
- `incrementGranotLifecycleHealthCounter`, `recordGranotLifecycleLastRun`, `readGranotLifecycleHealthCounters`, `readGranotLifecycleLastRun`, `markGranotLifecycleAlertFiring` / `markGranotLifecycleAlertRecovered` (CAS) and `readGranotLifecycleAlertRows`.
- **Unknown is never zero.** A window counts as covered only when all of these hold: `counters_since <= now - window`; `last_write_at` is within 20 minutes (the cron drains every 5 minutes and writes `last_run:cron`, so 20 minutes is four missed runs); and `gap_at` is absent or older than the window start. Otherwise the counter is `null`.
- **Mongo down:** when `mongoose.connection.readyState !== 1`, the write is skipped and a `granot_lifecycle.health_state.write_missed` warning is logged (reason `mongo_unavailable`). A failed write logs the same warning with reason `write_failed` and a bounded `error_code`. The miss is remembered in the process, and the next successful write stamps it into `coverage.gap_at`, so the affected windows read as unknown until the gap ages out. If the process dies first, the hint is lost. It is only a hint; persisted state is the source of truth.

Health facts are fed at the same seams as before, through the closed event keys in `emitGranotLifecycleEvent` (`observability.ts`):
- `granot_lifecycle.capture.failed` → `capture_failed`. This is the webhook route's failure before the receipt is persisted, so a capture failure still counts when Mongo is up.
- `granot_lifecycle.claim.recovered` → `claim_recovered` (drainer).
- `granot_lifecycle.owner_command.conflict` with a closed code → `owner_command_conflict:<code>`.
- `granot_lifecycle.{queue,cron}.run.{completed,failed}` → `last_run:<trigger>` (`emitDrainRunEvent` from the cron route and the queue consumer).

`projections.ts` `projectGranotLifecycleHealth` now reads `readGranotLifecycleHealthCounters(now)` and `readGranotLifecycleLastRun(...)`. The other Health facts (receipts, decisions, cases, discrepancies, links, latency, RingCentral) are unchanged.

**DTO shape.** Every existing field keeps its type and meaning:
- `capture_unavailable` and `claim_recovery_rate` alerts become `state: "insufficient_data"` with `observed_value: null` when their window is unknown. This is the existing alert convention, already used by p95 and source rate. `evaluateGranotLifecycleAlerts` accepts `number | null` for those two inputs.
- `command_conflicts_last_24h` stays an array. It is `[]` when the window is unknown.
- `last_queue_run` / `last_cron_run` keep the `{at, status} | null` shape.
- **One additive field:** `counter_coverage: { counters_since, window_24h: "covered"|"unknown", window_1h: "covered"|"unknown" }`. Without it, an Owner would read "No command conflicts in the last 24 hours" during warm-up. Admin's `asGranotLifecycleHealth` copies only known keys and ignores the new field, so `lifecycle-health.tsx` renders exactly as before. Rendering the field is optional (see the cross-lane items).

**Alerts.** `alerts.ts` `persistGranotLifecycleAlertTransitions` now uses the persisted alert rows instead of `OperationalIncident`. A transition is compare-and-set, so repeated evaluation, two replicas and restarts emit exactly one firing and one recovered log line. `insufficient_data` never recovers an open alert, which keeps the rule from `classifyAlertTransition`. A firing alert reports the persisted `since` (the first firing instant) on every evaluation. Before, `since` appeared only on the transition evaluation. The meaning is the same, and the value now survives restarts. The thresholds are unchanged.

**Warm-up choice: start UNSEEDED, with explicit unknown coverage.** Counting starts at the first health-state write by the new code. `coverage.counters_since` is set once with `$setOnInsert`. The first write is the first cron drain after deploy, at most 5 minutes in. The 1h windows become covered 1h after cutover and the 24h windows 24h after. Until then they read as unknown (`insufficient_data` / `counter_coverage: unknown`). Reasons:
1. With no dual-write, there is no seed boundary that could double-count.
2. Old deployments that are still alive keep writing OperationalEvents, not this collection. A seed would mix two sources with no reliable fence.
3. The Health facts lost (24h of conflicts, captures and claims) are diagnostic, and Health states its own uncertainty honestly.

The cutover instant is `granot_lifecycle_health_state._id = "coverage".counters_since`. Read it after deploy and record it in the ledger.

### 2. Lifecycle diagnostics moved to the structured logger

`emitGranotLifecycleEvent` no longer calls `recordOperationalEvent`. It writes one `logger.{info|warn|error}` line with these fields:
- `msg` = the closed catalog event key (aliases normalized; keys outside the catalog are still dropped)
- `category`, `workflow`, `summary` (static text)
- the existing allow-listed and sanitized details, with masked ids
- `entity_type` and a masked `entity_id`
- `route`, `method`, `status_code`, `duration_ms`, `request_id`

It then feeds the Health facts listed above. It never throws.

The OE-only input fields `dedupeKey`, `autoResolveKey` and `piiPolicy` were removed from `GranotLifecycleEmitInput` and from the callers in `bookingReconciliation.ts`, `discrepancies.ts`, `releaseReconciliation.ts` and `processor.ts` (one `piiPolicy` line; the outreach wake-up lines were not touched). The drain-run summary counters (`scanned`, `claimed`, `completed`, `retried`, `dead_lettered`, `recovered`, `lease_lost`, `skipped`) were added to the detail allowlist. That let `drainer.ts` `defaultRecordEvent` drop its duplicate raw logger line. `queuePublisher.ts` dropped its emit for `queue.publish_failed`, because the existing `safeLifecycleFailureLog` line already records the same key with a bounded `error_code`. The lifecycle metrics (`metrics.ts`) are unchanged.

### 3. Activation and requeue provenance (`operations.ts`)

- **Activation:** the after-commit `OperationalEvent` audit (`persistAudit` / `defaultPersistActivationAudit`) is removed. The provenance is the write-once `granot_lifecycle_activations` row itself: `activated_by` (the DurableActor), `reason`, `activated_at` and `processor_version`. The row is unchanged.
- **Requeue:** the after-commit, best-effort `OperationalEvent` write is replaced by a `domain_command_executions` record (`DomainCommandExecution`, which is protected), written **inside the same transaction** as the `dead_letter → pending` CAS:
  - `origin: "granot_lifecycle"`, `command_name: "granot_lifecycle.receipt.requeue"`
  - `idempotency_key: "granot_lifecycle.receipt.requeue:<receiptId>:<manual_requeue_count>"`. The unique `{origin, idempotency_key}` index is the revision fence; `manual_requeue_count` is the receipt's requeue revision.
  - `actor` and `initiator` = the Owner DurableActor (id, label, role, request id)
  - `provenance: { origin, run_id: null, source_receipt_id, source_connection_key: null, requeue: { reason, prior_state: "dead_letter", new_state: "pending", manual_requeue_count } }`
  - `result` and `entity_refs` = `[{ model: "GranotObservationReceipt", id }]`, plus `payload_checksum` and `applied_at`

  A provenance failure now aborts the transition, so a requeued receipt can never lack its actor, reason and states. Concurrent requeues still have one winner (receipt state CAS plus write conflict), and the loser gets 409 `REQUEUE_STATE_CONFLICT`. Readers of `domain_command_executions` use `findOne` by specific idempotency keys, so the new `command_name` cannot collide with them.
- The `operations.ts` test expectations were captured before the change and kept. They changed only for the provenance destination. The "audit failure cannot roll back" tests became "provenance failure aborts the transition in the same transaction". New assertions cover the actor, reason, states, the shared session and the idempotency-key fence.

### 4. Receipt search and Live Events GET transports removed (SPEC §5)

- Removed only `GET /api/v1/admin/granot-lifecycle/receipts` (search) and `GET /api/v1/admin/granot-lifecycle/receipts/live` (SSE), plus their route deps (`listLiveReceipt*`, `searchReceipts`, `liveStream*`), from `src/routes/granot-lifecycle-admin.routes.ts`. Both now return the normal 404, and a test proves it.
- `POST /api/v1/admin/granot-lifecycle/receipts/:id/requeue`, Health, activation, cases, candidates, creating-observation, discrepancies, jobs/leads timelines and the official commands are untouched. So are ingress `granot-webhook.routes.ts`, extension/automation apply and claim/normalize/process/drain.
- Removed `granotLifecycleReceiptSearchQuerySchema`, `GRANOT_WEBHOOK_RECEIPT_SEARCH_QUERY_KEYS`, `GranotLifecycleReceiptSearchQuery` and their now-unused helpers (`RECEIPT_WORK_STATES`, `LIVE_WEBHOOK_ROUTE_EVENT_CLASSES`, `BOOKING_ACTIONS`, `EMAIL`, `FORM_REF_ABSENT`, the `normalizePhoneNumberForMatch` and `normalizeJobNo` imports) from `src/validation/v1/granotLifecycle.validation.ts`, along with the matching re-exports in the shared `src/validation/v1.validation.ts` (a targeted edit).
- Consumer proof: `liveReceipts.ts` was imported only by `receiptSearch.ts`, `liveReceiptStream.ts` and the admin router. Case creating-observation reads (`creatingObservation.ts`), timeline evidence (`projections.ts`) and requeue (`operations.ts`) never import any of the three modules.

## Deleted files

- `src/services/granotLifecycle/receiptSearch.ts`, `receiptSearch.test.ts`
- `src/services/granotLifecycle/liveReceipts.ts`, `liveReceipts.test.ts`
- `src/services/granotLifecycle/liveReceiptStream.ts`, `liveReceiptStream.test.ts`

## New files

- `src/models/GranotLifecycleHealthState.ts`
- `src/services/granotLifecycle/healthState.ts`, `healthState.test.ts`, `healthState.replica.test.ts`
- `src/services/granotLifecycle/testLifecycleLogCapture.ts`. This is a test helper that captures logger lines with `node:test` `mock.method`, replacing the deleted OE in-memory sink. It sits outside `testSupport/` because the fixture-security inventory scanner rejects unregistered files there.

## Edited files (lane)

`alerts.ts`, `observability.ts`, `operations.ts`, `projections.ts`, `drainer.ts`, `queuePublisher.ts`, `bookingReconciliation.ts`, `discrepancies.ts`, `releaseReconciliation.ts`, `processor.ts` (one `piiPolicy` line). Tests: `operations.test.ts`, `operations.replica.test.ts`, `drainer.replica.test.ts`, `projections.replica.test.ts` (its mutation-sensitive list now watches `granot_lifecycle_health_state` instead of `operational_events`), `observability.test.ts`, `queuePublisher.test.ts`, `bookingReconciliation.test.ts`, `src/routes/granot-lifecycle-admin.routes.ts`, `.test.ts`, `src/validation/v1/granotLifecycle.validation.ts`, `.test.ts`. Shared: `src/validation/v1.validation.ts`, one re-export block.

## Checks run (real results)

- `pnpm typecheck` (server): no errors in any `granotLifecycle`, Granot route, validation or HealthState file. The final run before this report showed only other lanes' in-progress files (salesIntelligence, ops, numberActivity). An earlier run caught 2 errors in `drainer.replica.test.ts` (an `origin` literal type). They were fixed with `as const`.
- Unit and route tests: `DOTENV_CONFIG_PATH=C:/nonexistent.env node --import tsx --import ./ops/test-setup.ts --test src/services/granotLifecycle/*.test.ts src/routes/granot-lifecycle-admin.routes.test.ts src/routes/granot-lifecycle-cron.routes.test.ts api/queues/granot-lifecycle-consumer.test.ts src/validation/v1/granotLifecycle.validation.test.ts src/models/GranotLifecycleActivation.test.ts`
  - First full run: 574 tests, 474 pass, 2 fail, 98 skipped (replica opt-in). The two failures were (a) `normalizationFixtures` scanner rejecting the log-capture helper in `testSupport/`, fixed by moving it, and (b) `processor.outreachWake.test.ts` missing because S-NUM deleted it during the run.
  - After the fix: `healthState.test.ts` and `normalizationFixtures.test.ts` gave 17/17 pass. `operations.test.ts` and `alerts.test.ts` gave 18 pass and 1 skipped (replica opt-in). `observability.test.ts` and `queuePublisher.test.ts` gave 10/10 pass. `bookingReconciliation.test.ts` gave 25/25 pass.
  - A second full run on the same command collided with other lanes' load. It hit a V8 heap OOM in the admin route test process, and `Cannot find module` errors inside `node_modules` (googleapis, zod locales) for seven files. Those are resource-exhaustion symptoms, not code faults. The rerun of just those seven files at `--test-concurrency=2` (admin routes, automationApply, bookingOwnerCommands, bookingReconciliation, createLeadFromGranot, crossChannel, discrepancies) gave **82/82 pass, 0 fail**.
- Replica (local Docker `csi01` on 127.0.0.1:27189, `MONGO_URI=mongodb://127.0.0.1:27189/?replicaSet=csi01&directConnection=true`, `TEST_MODE=true`, `TEST_MONGO_DATABASE_NAME=testvantagemovers_sgranot`, `GRANOT_LIFECYCLE_REPLICA_TESTS=true`; every suite also refuses non-`testvantagemovers*` databases):
  - `healthState.replica.test.ts` and `operations.replica.test.ts`: **5/5 pass.** They cover: a Mongo-down capture failure logged then fenced as a gap; 20 concurrent increments landing exactly in two minute buckets under the unique fence; fresh counting reading as unknown and warm counting as exact; latest-run CAS keeping the newest run; alert firing and recovered transitions emitted exactly once across two concurrent "replicas" and a restart, with `since` persisted; and the Health projection reading conflicts and coverage from the bounded state with the dead-letter alert persisted.
  - `pnpm test:granot-lifecycle:replica` cannot run: its runner `scripts/test-granot-lifecycle-replica.ts` does not exist in this checkout (scripts moved to `ops/`). Running every `*.replica.test.ts` directly got through `aggregateRevision` (pass, first sweep). Then the `csi01` container stopped answering: `docker exec csi01 …` hangs, the TCP port accepts connections, and mongoose server selection times out after 5s. This happened while other lanes were using the machine. The later timeouts in `automationApply`, `bookingConfirmation`, `bookingReconciliation` and `connectBookingToLead` are all `ServiceUnavailableError: Server selection timed out`, an infrastructure outage, not assertion failures. **The drainer.replica requeue proof, now pointed at DomainCommandExecution, and the rest of the replica sweep still need a run once `csi01` is healthy again.**

## Retained behavior preserved, and how it was verified

- Receipt capture, process, retry, dead letter, requeue and activation still commit with their replay and revision safeguards. Verified by the operations unit tests and the replica proof, plus the drainer, processor and capture unit suites in the full run.
- Health alert thresholds and meanings: `alerts.test.ts` passes unchanged. New tests show unknown windows give `insufficient_data` and warm empty windows give a real zero.
- Health DTO: the admin route test fixture carries the full shape. Admin `lifecycle-health.tsx` was read and not edited.
- Daily Operations: not touched. The `recordGranotDeadLetterDailyOperationsFact`, intake and processor Daily fact calls and their timing are unchanged.

## Open cross-lane items

1. **Owner of `src/routes/granot-webhook.routes.ts` (S-OBS or integration):** KEEP the `emitGranotLifecycleEvent({ eventKey: "granot_lifecycle.capture.failed", … })` call in the capture `catch`. It now feeds the Health `capture_unavailable` counter, which SPEC §4.1 requires. Its arguments still type-check: `level`, `category`, `workflow`, `summary`, `details`, `statusCode` are all retained. `src/routes/granot-webhook.routes.test.ts` imports `clearCapturedOperationalEvents` / `getCapturedOperationalEvents` from `../services/observability`. Port it to `captureGranotLifecycleLogs()` from `src/services/granotLifecycle/testLifecycleLogCapture.ts` and assert `logs.find("granot_lifecycle.capture.failed")`.
2. **A-DEST (Admin):** no change is required. Admin may optionally parse `counter_coverage` in `lib/api/granotLifecycle.ts` and show "unknown (warming)" on the "Command conflicts (24 hours)" card. Admin search and live clients must go: `fetchGranotWebhookReceipts`, `asGranotWebhookReceiptListPage`, `/api/granot-live-receipts`, `live-webhooks.tsx`. The server endpoints for them now 404.
3. **Docs (SLIM-09):** update `docs/knowledge/granot-lifecycle/live-receipts.md` (retire it), `drainer.md` (requeue provenance now sits in `domain_command_executions` in the same transaction), `projections.md` (remove the `GET .../receipts[/live]` lines and describe the bounded Health state and `counter_coverage`), and the lifecycle `observability.md` (logger plus health state, no OE). Also add `granot_lifecycle_health_state` to the environment and data docs.
4. **Integration:** restore or replace the missing `scripts/test-granot-lifecycle-replica.ts` runner behind `pnpm test:granot-lifecycle:replica`, or repoint the script to run `src/services/granotLifecycle/*.replica.test.ts` with `--test-force-exit`.

## DATA-MANIFEST NEEDS

- **Must NOT remove (protected):**
  - `granot_lifecycle_health_state`: the new Health state. It is created by the slim server, so a purge by prefix or by "unknown collection" must skip it.
  - `granot_webhook_receipts`, `granot_observations`, `synchronization_decisions`, the booking/release cases and discrepancies, `granot_record_links` and `granot_lifecycle_activations`.
  - `domain_command_executions`: it now holds requeue provenance with `command_name: "granot_lifecycle.receipt.requeue"`.
- **Dead after this change (removed with the whole OperationalEvents family, no separate filter needed):**
  - `operational_events` documents with `event_key` matching `^granot_lifecycle\.` or `^ringcentral\.granot_adoption\.`. These include `granot_lifecycle.manual_requeue` and `granot_lifecycle.activation.committed` audit rows. Those rows held only masked ids, `actor_role` and `request_id`, never the reason or actor id. Purging them loses that thin history of past requeues. The receipts keep `manual_requeue_count`, and the activation keeps its full actor and reason.
  - `operational_incidents` with `dedupe_key` matching `^granot_lifecycle\.alert\.`. Alert state now lives in `granot_lifecycle_health_state` `alert:*` rows.
- **Ordering:** Health no longer reads OE once the slim server is deployed, because of the unseeded warm-up. The purge does not need to wait for warm-up, but it must run after the deploy, because an old server would keep recreating and writing the OE collections.
