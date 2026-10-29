# routes-cpl-correction-cron

- Status: recommended; refreshed 2026-10-29.
- Target: `src/routes/cpl-correction-cron.routes.ts`
- Domain evidence: `docs/index.md`
- Current exported operations and constants: the router/default export.

## Current boundary

Preserve the current target’s authentication, inputs, outputs, ordering, errors, idempotency and side effects; retain existing public names as aliases until callers migrate. Structured logs are current: do not recreate Operational Events storage or notifications.

## Specific implementation checks from the original brief

1. **This desk has no mode or flag gate; Sheet Sync and rematch do.** Already-recommended Sheet Sync **200** `{ skipped: true }` and never **asks** drain unless `queued`. Already-recommended rematch **200** `{ skipped: true }` when the flag is `false`. This file always **asks** `connectMongo` then `runDue`. There is no `CPL_CORRECTION_DRAIN_ENABLED`. A host with no open jobs still opens Mongo and returns `{ claimed: 0, results: [] }`. Do not copy the Sheet Sync queued-only fence here so “every five-minute desk matches.” Do not add a kill-switch env in this rename so “disabled never opens Mongo” without a paired HTTP proof that a filed `pending` job still wakes.

2. **HTTP `claimed` is the array length, not leases won.** Wave A `CplCorrectionBatchResult.claimed` is “this worker took the 60s lease.” `findClaimable` already filtered to missing / expired leases, then `processCplCorrectionBatch` may still return `{ claimed: false }` on a race, a just-completed job, or a just-cancelled job — and that bag stays in `results`. This file still **200** `{ claimed: results.length }`. Do not sum `result.claimed` so “HTTP claimed means leases.” Do not drop `claimed: false` bags so “the cron only reports wins.” Do not map a false bag onto HTTP `{ skipped: true, reason: "lease_held" }` so “this desk matches Call Log.”

3. **Wave A default `limit` is 1; this tick asks 5.** `runDueCplCorrectionJobs` defaults to one claimable job. Leftover cron overrides `{ limit: 5 }`. Each claimed job rewrites one Form-then-Call batch of 50 (`DEFAULT_CPL_CORRECTION_BATCH_SIZE`) behind a 60s lease. Do not raise the cron limit to “all due jobs” so “one tick finishes the book.” Do not drop the override so “cron matches the default 1” without a paired proof that five oldest due jobs still wake. Do not move `limit: 5` into Wave A so “every caller drains five.”

5. **Route 500 is a generic code, not `error.message`.** `connectMongo` / Wave A `findClaimable` / `claimForProcessing` / leftover `NOT_FOUND` after a vanished job can throw into this catch. Already-recommended Lead Messaging / Sheet Sync **500** may echo `error.message`. Already-recommended Call Log **500**s generic `"Call log sync failed"`. Already-recommended rematch has no try/catch. This file matches Call Log silence plus a stable `CPL_CORRECTION_DRAIN_FAILED`. Do not echo `error.message` so “this desk matches Lead Messaging” without a paired HTTP proof that operators still do not see a Lead id / preview hash / RegistryError text on the cron body. Do not drop the catch so “this desk matches rematch unhandled Express.”

8. **`connectMongo` lives on this desk and on leftover Owner HTTP, not inside Wave A `runDue`.** Already-recommended Sheet Sync drain connects itself; that cron does not. Lead Messaging cron also connects before drain. Do not move `connectMongo` into `runDueCplCorrectionJobs` in this rename so “every caller matches Sheet Sync” without a paired Owner-preview + cron proof. Do not drop the connect so “runDue already opened it.”

10. **`requireCronAuth` is a copy of sibling crons.** Rematch / RingCentral / Sheet Sync / Lead Messaging / Granot lifecycle use the same Bearer-or-header 500/401. Do not extract shared `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** desk **and** the siblings. Park the copy. IDEAS already parked that extract.

13. **Owner HTTP uses `x-api-secret` + leftover Owner HMAC; this tick uses `CRON_SECRET`.** `app.ts` mounts **before** `v1Routes`. Do not remount `requireApiSecret` so “it matches Owner preview.” Do not hide this ALL behind leftover `requireRegistryOwnerActor` so “cron matches leftover admin.” Do not accept Owner HMAC so “someone must be an Owner.”

## Current endpoint contract restored

ALL `/api/cron/cpl-corrections-drain` uses Bearer or x-cron-secret before Mongo. Missing secret is 500 “CRON_SECRET is not configured”; wrong credentials are 401. Connect Mongo, build default correction dependencies, run at most five due jobs and return 200 with claimed = results.length and results. Any processing failure logs cpl_correction.cron.failed and returns fixed 500 CPL_CORRECTION_DRAIN_FAILED / “CPL correction drain failed”. The route does not preview/apply a schedule or run live Insights pricing.

This is source inspection, not evidence that HTTP/provider tests ran. Preserve the existing error punctuation and status when migrating callers.
