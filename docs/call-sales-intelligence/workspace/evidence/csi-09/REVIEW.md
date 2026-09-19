# CSI-09 review

Local implementation and isolated proof only. No `pnpm finish-work` checkpoint was run in this session. This is not independent final-source approval.

## What was checked

- Owner GET `/coverage` is `readOwnerCoverage()` / `ownerCoverageDtoSchema`, reusing CSI-11 recording counters. Denied, unavailable, unknown, and zero stay distinct. Empty stages keep `oldest_queued_at` null. Unknown budget uses null cents, not `$0`.
- GET `/settings` never writes and does not attach capture coverage. PATCH uses `commandCsiSettings` over `initializeCsiPolicy` / `updateCsiPolicy` with CAS and audit. Kill switches are displayed from env and rejected on PATCH.
- Policy versions stamped for Owner HTTP are stable per Idempotency-Key (`policyVersionForCommand`) so a lost-response retry does not become `IDEMPOTENCY_CONFLICT`. Distinct keys still get distinct versions.
- Env bootstrap numbers appear on the first persist only. Later Owner edits win.
- Admin fourth view is Coverage. Settings editor uses ISO weekdays (Sunday = 7). Lead detail enters SI through the existing official-record helper. Owner BFF stays `scope=production` with `Idempotency-Key` on PATCH. Live invalidation still refetches `salesIntelligenceKeys.all`.
- Isolated replica + 3107 HTTP + 3108 browser proof recorded in [CHECKS.md](CHECKS.md).

## Not claimed

- Full Admin lint (unrelated 11/7 baseline remains).
- CSI-10 empty-recording repair (`repIdentity/worker.ts` still gates on `call.recordings.length`).
- CSI-07 `lease_held` transcription reason.
- CSI-10 CORS `Idempotency-Key`.
- CSI-14 dialogs, CSI-15 backfill/retention workers, flag enablement, official `migration:csi:indexes`.
- Production/Vercel readiness.

## Residual product limits (in scope, honest)

- Coverage may show stored recording counts of 0 while capabilities stay `unknown`. That is stored evidence, not a live grant.
- Backfill is display-only: Owner-triggered and not yet available.
- Isolated Form Leads still surface a pre-existing Next hydration overlay; the Actions link and SI URL entry were verified around it.
