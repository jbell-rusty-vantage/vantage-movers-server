## Operations Registry work-package handoff

- Repository: `vantage-main-server`
- Branch: `feature/operations-registry`
- Base SHA: `0214aa3609619509ce70eab8c1df3e1b0a1ccdaa`
- Head SHA: uncommitted working tree; no commit requested
- Work package: S4 Temporal CPL Schedules and S5 Production CPL Corrections
- Integration branch expected: `feature/operations-registry`

### Delivered

- Effective-dated CPL periods in `America/New_York`, with inclusive owner dates, exclusive stored ends, cents-safe amounts, active-schedule integrity, and optimistic schedule revisions.
- Owner Simple Mode atomic multi-granularity changes and Advanced Mode add/split/correct/replace commands.
- Lead-ingestion CPL snapshots with period/status/version evidence, explicit missing-rate events, and Call-only duplicate-zero handling.
- Previewed correction jobs with owner authorization, full reviewed-state hashes, exact reviewed-target freezing, bounded windows/target counts, cancellation, leases, resumable cursors, and transactional Lead-plus-checkpoint writes.
- Immutable per-correction before/after evidence in `cpl_lead_corrections`; production and historical Lead collections remain separated.
- Legacy CPL PATCH removal; legacy `cpl_rates` remains read-only compatibility data.
- Analytics missing-rate disclosure, live-query invalidation evidence, health findings, cron drain route, and M4 schedule-seed migration.

### Files

- Added: `src/models/{CplRatePeriod,CplCorrectionJob,CplLeadCorrection}.ts`
- Added: `src/services/operationsRegistry/{cplSchedule,cplCorrections}.ts` and tests
- Added: `src/services/leads/leadCplResolution.ts` and tests
- Added: `src/routes/cpl-correction-cron.routes.ts` and test
- Added: `scripts/migrations/operations-registry-cpl-schedules*`
- Modified: Lead models/ingestion, booking-created Lead paths, Operations Registry routes/validation/health, analytics, app cron wiring, and `vercel.json`
- Intentionally untouched: historical Lead models/collections, legacy CPL data values, and `package.json`

### Verification

- `pnpm test`: 571 passed, 0 failed.
- Focused S4/S5 and M4 suite: 35 passed, 0 failed.
- `pnpm typecheck`: no Unit 2 diagnostics; command remains blocked by pre-existing unrelated `scripts/dev_ops/*` errors.
- Linter diagnostics on changed core files: none.
- Two consecutive M4 test-database dry runs: successful, no writes, no conflicts, identical checksum `22def9ea494730ce0e4a93c86b19a07cd9c723785f07d36649d72af240cff74d`.

### Operational notes

- M4 is dry-run by default. Invoke directly because `package.json` was intentionally not edited:
  - `node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/migrations/operations-registry-cpl-schedules.ts --cutover-date=YYYY-MM-DD`
- Production apply additionally requires `--apply --production-apply --confirm-production-db=<database>`.
- Correction preview is capped at 366 inclusive business days and 250 reviewed Leads; split larger corrections into multiple reviewed jobs.
- Analytics are live production-Lead queries, so completion records a bounded invalidation handoff rather than rebuilding a materialized cache.

### Risks and next step

- Production M4 requires reviewed source inventory and dry-run manifests before apply.
- Run M4 before enabling temporal CPL writes for active traffic, then monitor CPL schedule health, missing-rate Lead findings, and failed/stalled correction jobs.
