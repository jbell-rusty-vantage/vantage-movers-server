# routes-granot-lifecycle-cron

- Status: recommended; refreshed 2026-10-29.
- Target: `src/routes/granot-lifecycle-cron.routes.ts`
- Domain evidence: `docs/index.md`
- Current exported operations and constants: `createGranotLifecycleCronRouter`.

## Current boundary

Preserve the current target’s authentication, inputs, outputs, ordering, errors, idempotency and side effects; retain existing public names as aliases until callers migrate. Structured logs are current: do not recreate Operational Events storage or notifications.

## Specific implementation checks from the original brief

4. **`connectMongo` lives on this desk and on the consumer, not inside Wave A drain.** Already-recommended Lead Messaging does the same. Already-recommended Sheet Sync drain connects itself; that cron does not. Already-recommended automation recover opens Mongo inside Wave A. Do not move `connectMongo` into `drainDueReceipts` in this rename so “every caller matches Sheet Sync” without a paired consumer + cron proof. Do not drop the connect so “drain already opened it.”

5. **Processing off is HTTP `skipped: true` and still writes a completed letter.** Wave A returns `{ skipped: true, reason: "processing_disabled", zeros }`. This file **200**s `skipped: true` and **asks** `emitDrainRunEvent(summary, false)` (`granot_lifecycle.cron.run.completed`). Lead Messaging disabled is `{ claimed: 0 }` with **no** HTTP `skipped`. Sheet Sync skips at the route before drain. Do not add a route-level flag read so “disabled never opens Mongo” without a paired proof that Wave A still owns the skip. Do not **401** processing-off so “off looks unauthorized.” Do not write the failed letter on a skip so “quiet ticks look broken.”

6. **HTTP omits Wave A `reason` and `trigger`.** `pickBoundedCounters` drops `reason: "processing_disabled"` and `trigger: "cron"`. Operators see `skipped: true` with no why. Do not add those fields in this rename so “HTTP matches the summary type” without a paired proof that today’s body still has exactly eight counters. Do not start echoing `granot_statement` so “the skip explains itself.”

7. **The factory injects `connect` / `drain` and never `emit`.** A successful stubbed drain still **asks** live `emitDrainRunEvent`. If that letter throws after a real scan, the catch writes a **failed** letter with zeros and **500**s a tick that already claimed work. The consumer has the same emit-after-success shape. Do not add `emit` onto the factory in this rename so “tests stay quiet” without a paired proof that `app.ts` still **asks** the live letter. Do not swallow an emit throw so “HTTP stays 200 after a finished scan” without a product decision.

11. **There is no mode gate and no global drain seat on this route.** Processing default is **true**. Sheet Sync refuses unless `queued`. Call Log maps `lease_held` to HTTP skipped. This scan shares the receipt lease fence with the consumer; Mongo elects the winner. HTTP `skipped` means processing off, not a held seat. Do not copy Sheet Sync’s queued-only fence here. Do not copy Call Log `lease_held` onto a finished scan with `lease_lost > 0`.

12. **`requireCronAuth` is a copy of sibling crons that accept `x-cron-secret` and 500 a missing secret.** Reporting is the Bearer-only 503 cousin. Do not extract shared `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** generic-500 **and** Reporting Bearer-only 503 **and** the siblings that still accept the header. Park the copy. IDEAS already parked that extract.

15. **Owner HTTP uses `x-api-secret` + HMAC; this tick uses `CRON_SECRET` Bearer or `x-cron-secret`.** `app.ts` mounts **before** `granotAutomationRoutes` and **before** `v1Routes`. Do not remount `requireApiSecret` so “it matches Owner requeue.” Do not hide this ALL behind Owner HMAC so “someone must be an Owner.”

## Current endpoint contract restored

ALL `/api/cron/granot-lifecycle-drain` is the injected connect/drain adapter mounted before v1. CRON_SECRET Bearer or x-cron-secret uses timing-safe comparison; missing is 500, wrong 401. It connects before the service's processing-disabled decision, returns bounded counters and calls emitDrainRunEvent. Catch logs safeLifecycleFailureLog, emits a failed zero-counter summary and returns fixed 500 “Granot lifecycle drain failed”. These events are current structured lifecycle logging, not retired Operational Events persistence. Preserve the factory and receipt-owned lease coordination.

This is source inspection, not evidence that HTTP/provider tests ran. Preserve the existing error punctuation and status when migrating callers.
