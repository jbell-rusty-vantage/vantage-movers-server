# routes-ringcentral-cron

- Status: recommended; refreshed 2026-10-29.
- Target: `src/routes/ringcentral-cron.routes.ts`
- Domain evidence: `docs/index.md`
- Current exported operations and constants: `createRingCentralCronRouter`.

## Current boundary

Preserve the current target’s authentication, inputs, outputs, ordering, errors, idempotency and side effects; retain existing public names as aliases until callers migrate. Structured logs are current: do not recreate Operational Events storage or notifications.

## Specific implementation checks from the original brief

1. **Overlap is a skip, never HTTP 500.** Leftover AC-17 and leftover knowledge lock leftover `lease_held` to leftover **200** `{ ok: true, skipped: true }`. Leftover Wave A already returned leftover `skipped` / leftover `skipReason`. This file only maps. Do not silently **500** leftover overlap so “Vercel retries a held lease.” Do not silently omit leftover `summary` on leftover `lease_held` so “one skip body owns disabled and held.”

2. **A disabled Call Log tick never claims.** Leftover flag is leftover **before** leftover `runCallLogSync`. Leftover Wave A elect lives inside leftover sweep. Do not silently **ask** leftover sweep when leftover flag is false so “the service can no-op.” Do not silently **ask** leftover `acquireCallLogSyncLease` from this file so “the route owns elect.”

5. **Leftover snapshot has no leftover `lease_held` map.** Leftover Wave A leftover snapshot leftover `insertOne`s with no leftover unique window and no leftover lease. A second leftover 6am tick leftover writes a second row. Do not silently copy leftover Call Log leftover account lease onto leftover snapshot so “every cron elects.” Do not silently **200** leftover `{ skipped: true, reason: "lease_held" }` from leftover snapshot so “one skip owns both ticks.”

6. **`requireCronAuth` is a copy of leftover sibling crons.** Leftover sheet-sync / leftover booking-recon / leftover lead-messaging / leftover Granot lifecycle use leftover same leftover Bearer-or-header leftover 500/401. Leftover reporting leftover 503s leftover `"CRON_SECRET is not configured."` Leftover CPL leftover `"CRON_SECRET is not configured"`. Do not silently extract leftover shared leftover `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** leftover desk **and** leftover siblings. Park the copy.

7. **Factory inject is load-bearing here; leftover inbound has none.** Leftover AC-17 leftover **asks** leftover `createRingCentralCronRouter`. Leftover webhook desks leftover export only leftover live `Router()`. Do not drop leftover inject so “this desk matches leftover inbound.” Do not add leftover inject onto leftover inbound in this rename.

8. **Today’s harness never wakes leftover snapshot.** Leftover `analyticsReconcileEnabled: () => false` leftover plus leftover no leftover `runAnalyticsReconcile` inject. Leftover `vercel.json` leftover `0 6 * * *` is the only leftover snapshot proof. Do not treat leftover schedule-parse as leftover HTTP leftover snapshot. Add leftover flag-off / leftover 200 / leftover throw-letter proofs at leftover `wakeThisDailyCountSnapshotOverHttp`.

12. **This desk never uses leftover `x-api-secret`, leftover HMAC, leftover Granot webhook secret, leftover Twilio signature, or leftover live-host leftover `x-debug-token`.** Leftover `app.ts` leftover mounts leftover **before** leftover `v1Routes`. Leftover `CRON_SECRET` leftover is leftover handshake. Do not remount leftover `requireApiSecret` so “it matches leftover reporting.” Do not hide these leftover ALLs behind leftover Owner HMAC so “cron matches leftover admin.”

## Current endpoint contract restored

The injected router owns ALL `/api/cron/ringcentral-call-log-sync` and `/api/cron/ringcentral-analytics-reconcile`, mounted before v1. Both require CRON_SECRET Bearer or x-cron-secret (missing 500, wrong 401) and flag-off returns 200 skipped before service work. Call Log lease_held is a normal 200 skip; thrown sync failure returns fixed 500 “Call log sync failed” and logs errorName only. Analytics error currently echoes Error.message. Preserve these distinct envelopes and keep the account lease and cursor inside the sync service.

This is source inspection, not evidence that HTTP/provider tests ran. Preserve the existing error punctuation and status when migrating callers.
