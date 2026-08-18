**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Primary code:** `src/services/granotLifecycle/drainer.ts`, `src/services/granotLifecycle/operations.ts` (requeue), `api/queues/granot-lifecycle-consumer.ts`, `src/routes/granot-lifecycle-cron.routes.ts`  
**Domain terms used:** Granot Observation Receipt, Synchronization Decision, System of Record

# Granot lifecycle claim and drain (`granotLifecycle/drainer`)

**Role:** Turn Mongo receipt work state into one fenced execution path shared by the queue consumer, five-minute cron, future synchronous apply, and Owner requeue. Queue messages are wake-ups only. This module does not match Leads, invent `pending_match`, or mutate official Lead/Booking/Cancellation facts.

## Shared entry

Callers pass receipt identity only. The claim predicate is the Section 26 filter: due `pending` / `retry_scheduled` / expired `claimed`, then `$set` claimed + lease owner + five-minute lease and `$inc` `technical_attempts`. Requested-ID claims add `_id`. Due scan batch is 20 with concurrency 4.

Renew and every success/retry/dead-letter finalization are fenced by `{_id, state:claimed, lease_owner}`. A zero match means lease lost: stop, write no final state, launch no replacement processor.

Processing disabled: no claim, safe skipped run. Capture and due work remain intact.

## Technical vs business clocks

- Technical failure (no Decision): attempts 1–9 → `retry_scheduled` at `min(6h, 30s * 2^(attempt-1))` plus 0–25% jitter; attempt 10 → `dead_letter`.
- Successful processor result resets `technical_attempts` to 0 so the stored value is the consecutive technical-failure budget.
- `pending_match` increments `match_attempt` once and schedules the next absolute offset from immutable `captured_at`: immediate → 1m → 5m → 15m → 1h → 2h → 6h → 12h → 24h. At or after 24 hours the Unit 15 processor emits `unmatched` / `match_window_expired` and the receipt completes. The drainer does not fabricate that Decision.
- Every other known `SynchronizationOutcome` completes. Unknown outcomes fail closed as a technical contract error.

## Requeue

`POST /api/v1/admin/granot-lifecycle/receipts/:id/requeue` is Owner-only. Body is `{ reason }` (trim 10–500, unknown keys rejected). Only `dead_letter` is eligible. One replica-set transaction sets `pending`, due now, clears lease/error/completion, resets the technical budget, increments `manual_requeue_count`, preserves evidence/`match_attempt`/latest Decision, and writes one PII-safe audit. Requeue itself runs no processor.

## Observability

Metrics: `granot_lifecycle_queue_due`, `granot_lifecycle_oldest_due_seconds`, `granot_lifecycle_claim_recoveries_total`, `granot_lifecycle_technical_retries_total{code}`, `granot_lifecycle_dead_letters_total{code}`. Labels are bounded error codes only. Last queue/cron run is derived from durable Operational Events.

## Related

- Capture remains receipt-first ([`granotLifecycle.capture.md`](granotLifecycle.capture.md)).
- Processor remains callable and policy-owning ([`granotLifecycle.processor.md`](granotLifecycle.processor.md)).
- Software map: [`granot-lifecycle-capture.mdc`](../rules/granot-lifecycle-capture.mdc).
