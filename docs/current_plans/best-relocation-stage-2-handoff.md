# Best Relocation Stage 2 — Implementation Handoff

Status: implementation complete; production activation intentionally pending  
Implementation source: `best-relocation-stage-2-ingestion.md`

## Delivered

- Application-owned ingestion persistence:
  - `ExternalDataConnection`
  - `IngestionRun`
  - append-only `SourceRowReceipt`
  - mutable `SourceRowState` lookup projection (receipt history remains immutable)
  - `IngestionConflict`
- Required unique/history/queue/recovery indexes.
- Both official input workbooks registered in the Stage 1 operational-workbook
  registry as production-required `ingestion_source` entries.
- Fixed `[2026-04-30T00:00:00 America/New_York, source_read_through)` window.
- No hardcoded production spreadsheet IDs. `BACKFILL_*` aliases remain
  diagnostic-only and emit deprecation warnings.
- Separate read-only and write-scoped Sheets clients, structural inspection,
  required-tab/header checks, `LID_BestRelo` formula health, and fenced
  managed-ID repair. Repair uses an atomic server-side empty-cell replacement
  so a concurrent source writer cannot be overwritten.
- Stable source identities independent of row number, duplicate-ID rejection,
  deterministic content hashes, immutable plans, and canonical checksums.
- Conservative reviewed matching policy (`0.9`): unattended lead links require
  exact LID/ref evidence; refund auto-cancel requires agent, customer, or LID
  corroboration (`job_no_unique` alone is review evidence at `0.85`).
- Leadless booking and unmatched-refund conflicts.
- Three-way source-owned lead updates; protected and financial edits create
  conflicts and do not overwrite canonical values.
- Missing-source observations append `source_missing` evidence and preserve
  canonical records. Source reappearance updates the current-state projection
  without duplicating identical immutable evidence.
- Receipt-only bootstrap adoption with full canonical-content, count, and
  source-versus-canonical financial reconciliation plus blocking discrepancies.
- Direct Stage 1 canonical-command execution. The application worker has no
  HTTP loopback and does not write Lead, Booking, or Cancellation models.
- Fenced apply lease, per-action receipts/checkpoints, lease renewal, dependency
  blocking, row isolation, crash-window command-ledger recovery, and
  `completed_with_errors`. Recovery rehydrates prior canonical references,
  failed dependencies, completed-unit totals, and failure counters.
- Six-hour heartbeat, dual environment/application gates, atomic due claim,
  24/48-hour cadence, dedicated queue consumer, and cheap disabled/not-due
  skips.
- Owner-write/admin-read APIs and the Vantage Admin ingestion control, run, and
  conflict surface. Admins may inspect sources read-only; mutations remain owner.
- Structured health events for structural failure, schema/formula drift, zero
  parsed counts, unmatched-refund / leadless / conflict growth thresholds,
  duplicate identities, and `completed_with_errors`.
- API redaction of raw workbook IDs, command payloads, source-owned values, and
  raw source rows.
- Environment rollback is checked before approval/apply and before every
  canonical mutation. Final/failure transitions are owner/epoch/expiry fenced.
- A lease-busy queue delivery is rejected for retry rather than acknowledged,
  preventing durable queued runs from being stranded.
- CLI dry runs use the same application planner. Legacy CLI live apply is
  retired.

## Public server interfaces

```text
GET   /api/v1/admin/ingestion/connections/best-relocation
PATCH /api/v1/admin/ingestion/connections/best-relocation
POST  /api/v1/admin/ingestion/connections/best-relocation/inspect
POST  /api/v1/admin/ingestion/connections/best-relocation/preview
POST  /api/v1/admin/ingestion/connections/best-relocation/run
GET   /api/v1/admin/ingestion/runs
GET   /api/v1/admin/ingestion/runs/:runId
POST  /api/v1/admin/ingestion/runs/:runId/retry
GET   /api/v1/admin/ingestion/conflicts
POST  /api/v1/admin/ingestion/conflicts/:conflictId/resolve

GET|POST /api/cron/best-relocation-ingest-heartbeat
```

Queue consumer:

```text
api/queues/best-relocation-ingestion-consumer.ts
topic: best-relocation-ingestion-events*
```

Preview body options:

- `{ bootstrap: true }` → trigger `bootstrap`, awaits approval
- `{ dry_run: true }` → trigger `preview`, mutation-free completion
- default → trigger `manual`, awaits approval before apply

Conflict resolve dispositions:

- `{ disposition: "dismiss", note }`
- `{ disposition: "attach_booking", booking_id, lead_model, lead_id, expected_revision }`
  (delegates to `canonicalDomainCommands.attachBookingToLead`)

## Activation state

The implementation does not enable production ingestion. Activation remains
blocked by the source specification's external evidence gates:

1. configure both official workbook env references and service-account access;
2. leave `BEST_RELOCATION_INGEST_ENABLED=false`;
3. run and approve bootstrap adoption, dispositioning every blocking conflict;
4. retain three production-data dry runs on three different days;
5. verify retry/resume, matching samples, stable counts, and zero unexpected
   schema/formula drift for every dry run;
6. set `BEST_RELOCATION_INGEST_ENABLED=true`;
7. enable the application connection at the initial 24-hour cadence.

These three different-day production runs cannot be manufactured by an
implementation session and must remain real operational evidence. The env gate
is the immediate rollback and cannot be bypassed by the dashboard.

## Operations checklist (pre-activation)

Env:

```dotenv
BEST_RELOCATION_SYNC_SHEET_ID=
BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID=
BEST_RELOCATION_INGEST_ENABLED=false
CRON_SECRET=
GOOGLE_SERVICE_ACCOUNT_JSON=
# or GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=
```

Operator proof required before enabling the env gate:

- [ ] Both workbook IDs resolve; admin connection shows masked IDs configured
- [ ] Service account is editor on only those two workbooks (no Drive-wide access)
- [ ] Bootstrap plan approved; every blocking conflict dispositioned
- [ ] Three dry-run evidence bundles retained (run id, read-through, checksum,
      counters, matching samples, conflicts, reviewer, date)
- [ ] Heartbeat route and queue consumer deployed (`vercel.json` schedule
      `0 */6 * * *`)
- [ ] On-call can identify current run, lease owner, last success, next due,
      blocking conflict, and rollback without DB improvisation

Rollback:

```dotenv
BEST_RELOCATION_INGEST_ENABLED=false
```

Do not delete runs, receipts, conflicts, plans, or command-ledger records.
Allow an active worker to checkpoint or fence it by lease expiry. Correct
canonical data only through canonical application workflows.

## Verification

Focused Stage 1/Stage 2 contracts:

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/services/ingestion/ingestion.test.ts \
  src/services/bestRelocationSheetIngest/bestRelocationSheetIngest.test.ts \
  src/services/operationalWorkbooks/registry.test.ts \
  src/services/durableWork/durableWork.test.ts \
  src/services/domainCommands/domainCommands.test.ts
```

Admin authorization:

```text
node --import tsx --test server/auth/authorization.test.ts
```

Repository checks:

```text
pnpm typecheck
pnpm test
```

Results on 2026-08-03:

- server TypeScript: passed;
- focused Stage 1/Stage 2 contracts: 63 passed, 0 failed;
- full server suite: 678 passed, 0 failed;
- admin TypeScript: passed;
- admin suite: 103 passed, 0 failed;
- admin ESLint: passed.

## Handoff constraints for Stage 3 / Stage 4

Stage 3 must keep reporting OAuth, destinations, datasets, and Google clients
separate from this ingestion identity and lease namespace.

Stage 4 consumes the Stage 1 operational-workbook registry, which now includes
both Stage 2 `ingestion_source` registrations, and must fail closed when those
IDs cannot be resolved.
