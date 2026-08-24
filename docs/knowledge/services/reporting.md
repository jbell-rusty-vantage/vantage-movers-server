---
type: Service
title: Reporting
description: Owner-gated report definitions, immutable revisions, confirmed runs, and Google destination delivery.
tags: [reporting]
status: draft
stale_after: 2026-09-21
resource: src/services/reporting/reporting.service.ts
applies_to:
  - src/services/reporting/reporting.service.ts
  - src/services/reporting/reportingDestination.service.ts
  - src/services/reporting/reportingWorker.ts
  - src/services/reporting/catalog/index.ts
  - src/config/domain/reporting.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/reporting/reporting.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T00:54:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/reporting/reporting.service.ts`  
**Domain terms used:** [System of Record](../../../../CONTEXT.md), [Reporting Sheets](../../../../CONTEXT.md), [CPL](../../../../CONTEXT.md)

# Reporting

**System of Record:** MongoDB reporting collections (`ReportingDefinition`, `ReportingDefinitionRevision`, `ReportingPreview`, `ReportingRun`, `ReportingRunConfirmation`, destinations/deliveries). Google workbooks are a delivery surface. Mongo domain collections remain the data authority ([ADR-0001](../../../../docs/adr/0001-mongodb-system-of-record.md)).

**Role:** Owner-designed, checksum-bound reports. Preview → immutable revision → two-step confirmed run → worker write. This is not Admin Analytics ([`analytics.md`](./analytics.md)) and not Sheet Sync ([`sheet-sync.md`](./sheet-sync.md)).

## HTTP / queue / cron

All under `/api/v1/admin/reporting` with `requireApiSecret`. Reads use `requireRegistryReadActor`. Mutations use `requireRegistryOwnerActor`.

| Action | Route | Function |
|--------|-------|----------|
| Catalog | `GET .../catalog` | `getReportingCatalog` — only enabled datasets |
| Destinations | `GET/POST/PATCH/DELETE .../destinations`, `POST .../verify` | `reportingDestination.service` |
| Draft preview | `POST .../draft/preview` | `previewReportingDraft` |
| Save definition / revision | `POST .../definitions`, `POST .../definitions/:id/revisions` | `saveReportingRevision` |
| Run | `POST .../definitions/:id/run` | `prepareManualRun` (estimate, then confirm) |
| Cancel | `POST .../runs/:id/cancel` | requires `idempotencyKey` |
| Queue | reporting consumer | `reportingWorker` |
| Cron | `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor) | wake stranded leased runs |

Google destination **mutations and new runs** stay off unless `REPORTING_GOOGLE_DELIVERY_ENABLED=true` (fail-closed). Missing env cannot enable writes.

## Datasets (code-defined `@1`)

Exactly three keys: `lead_outcome_detail` (one canonical Lead per row), `lead_quality_exceptions` (one exception occurrence), `source_performance` (Source Company / optional granularity / time). `REPORTING_ENABLED_DATASETS` may narrow the allowlist; unknown or duplicate tokens throw at parse. A definition cannot change `dataset_key` after create.

Windows are America/New_York half-open `[from,to)`. Max window 366 days. Unknown filter keys reject. Owner sorts cannot use internal fields; ASC tie-breakers are appended.

## Happy path

1. **Preview** (`previewReportingDraft`): validate draft, live destination snapshot + checksum, estimate + 50 sample rows, fail if projected cells (rows+header) exceed `min(providerMaxCells, destinationAvailableCells)`. Persist preview (15-minute TTL). Sample evidence is an opaque HMAC, not raw SHA of the sample.
2. **Revision** (`saveReportingRevision`): matching unexpired preview (`previewId` + `previewChecksum` + draft checksum) required or 409 `preview_expired_or_mismatch`. Transaction allocates `next_revision_number` and CAS-updates the current-revision pointer. Archived / missing definition → 409.
3. **Estimate** (`prepareManualRun` without `confirmationToken`): `idempotencyKey` required. Binds actor + revision checksum + **stable destination identity** (not volatile `healthVerifiedAt` / `denylistCheckedAt`) + query checksum. Confirmation TTL 10 minutes. Reusing the key with different immutable inputs → 409 `idempotency_fingerprint_mismatch`.
4. **Confirm** (same key + `confirmationToken`): fingerprints must still match live stable identity and estimate. Consumes the confirmation, creates the run, publishes a wake-up. Replay returns the existing run when the key was already consumed.

Execution package mandates literal `RAW` spreadsheet writes, literal headers/cells, `formulasAllowed: false`. Source read-through is captured by the worker under the active lease owner/epoch.

## Skip / fail paths

| Condition | Outcome |
|-----------|---------|
| Capacity exceeded, or estimate is only an `upper_bound` that cannot prove fit | 409 `destination_capacity_exceeded` |
| Destination port safety / checksum drift | fail closed |
| Confirmation expired or actor/key/revision/identity mismatch | 409 `invalid_confirmation` |
| Google delivery flag off | routes reject destination writes / new runs without leaking config |
| Run read failures | fixed safe envelopes; provider/source details are not exposed |

## Related services

- [`analytics.md`](./analytics.md) — interactive admin reports, not this pipeline
- [`google-sheets.md`](./google-sheets.md) — Sheet Sync projections; reporting uses its own Google adapters
- [`operations-registry.md`](./operations-registry.md) — Owner/read actor gates
