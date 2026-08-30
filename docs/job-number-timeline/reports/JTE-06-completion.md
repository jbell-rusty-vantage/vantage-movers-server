# JTE-06 completion

Closed 2026-08-27 on `job-timeline-enhancement` in `vantage-main-server`
(existing pack branch; no extra feature branches; not pushed).

Owner write-path authorization was this session's message: test database
only (`testvantagemovers`). Production apply, production index apply, and
any backfill of `vantagemovers` remain unauthorized.

## Create-path files

Official Cancellation writes stamp four immutable correlation fields from
the surviving Booking at create time. No client DTO, no Admin change, no
inference from contact or Sheet rows.

| File | Role |
| --- | --- |
| `src/services/cancellations/cancellationCorrelationSnapshots.ts` | Booking → snapshot helper |
| `src/services/cancellations/cancelledLead.service.ts` | `persistCancelledLeadCreateInTransaction` and `createCancellationForVerifiedBookingInTransaction` spread the stamp |
| `src/services/historicalConsolidation/planner.ts` | Historical insert of an official Cancellation stamps from the planned Booking document, not from the Sheet Job Number cell |
| `src/models/CancelledLead.ts` | Four fields, write-once after insert, `autoIndex: false`, named partial index constant |
| `src/validation/v1/cancellations.validation.ts` | Unchanged; strict create/update reject client-supplied snapshot keys |
| `src/services/jobNumberTimeline/mongo-evidence-loader.ts` | After the index lands, hop `cancelled_leads` by `normalized_job_no_snapshot` (remapped equivalent-job filter). No collection scan. |
| `src/services/bookings/bookingIdentity.ts` | `equivalentNormalizedJobSnapshotFilter` |
| `scripts/migrations/cancellation-correlation-snapshots.ts` | Report-first CLI |
| `scripts/migrations/cancellation-correlation-snapshots.lib.ts` | Deterministic vs remainder classification |

Assemble still attaches an orphan only when a durable job snapshot is
present, and still refuses orphans without one. Named tests §13.2 #14–15
pass.

## Inventory counts

Report-only, before any apply. Classification: a row is deterministic only
when its Booking still exists and that Booking has a recoverable
`normalized_job_no` / `job_no`. Remainder is not guessed.

| Database | Historical | Deterministic | Remainder | Already stamped |
| --- | --- | --- | --- | --- |
| `vantagemovers` (report only) | **48** | **11** | 37 | 0 |
| `testvantagemovers` (authorized apply) | 25 | 4 | 21 | 0 |

Production 48 / 11 matches the enhancement spec. No drift. Authorized
apply target was `testvantagemovers` only.

## Remainder ids (test apply target)

Not backfilled:

```text
6a86007c8980b44fb034d1e0
6a86015b6fab5cc573a9aeb5
6a86015d6fab5cc573a9aed0
6a86015f6fab5cc573a9aeed
6a8601a96c118e1333c70994
6a8601ab6c118e1333c709af
6a8601ad6c118e1333c709cc
6a8601ae6c118e1333c709e1
6a86051a3d9ea6071ed53d45
6a86051c3d9ea6071ed53d60
6a86051e3d9ea6071ed53d7d
6a86051f3d9ea6071ed53d97
6a86231946c731f20740ec1f
6a86231c46c731f20740ec3a
6a86231f46c731f20740ec57
6a86232146c731f20740ec6c
6a86232446c731f20740ec8a
6a862e5303f19d50f545c4fb
6a862e5503f19d50f545c516
6a862e5703f19d50f545c533
6a862e5803f19d50f545c548
```

## Apply authorization record

| Fact | Value |
| --- | --- |
| Authorizing message | Owner write-path authorization for JTE-06 on the test database only |
| Recorded in | `PROGRESS.md` Open questions, 2026-08-27 |
| Apply command | `TEST_MODE=true pnpm migration:cancellation-correlation-snapshots -- --apply --confirm-production=testvantagemovers` |
| Database | `testvantagemovers` |
| Index created | `cancelled_lead_normalized_job_no_snapshot` |
| Rows updated | 4 deterministic |
| Remainder written | 0 |
| Production apply | not run |
| Production confirm flag | not passed for `vantagemovers` |
| Gitignored manifests | `scripts/output/cancellation-correlation-snapshots/report-1787867432655.json` (test), `report-1787867442738.json` (production read), `apply-1787867455600.json`, `verify-1787867467620.json` |

Verify after apply: historical 25, already_stamped 4, deterministic 0,
remainder 21 (same ids), index present.

## Named-test output

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  "src/services/cancellations/**/*.test.ts" \
  "src/models/CancelledLead.test.ts" \
  "src/validation/v1/cancellations.validation.test.ts" \
  "src/services/jobNumberTimeline/**/*.test.ts" \
  "src/services/bookings/bookingIdentity.test.ts" \
  "scripts/migrations/cancellation-correlation-snapshots.lib.test.ts"
# 79 pass, 0 fail

✔ orphan cancellation is not attached without durable job snapshot
✔ cancellation snapshot restores exact job correlation
```

```text
pnpm test
# 1730 tests, 1643 pass, 0 fail, 87 skipped

pnpm typecheck
# tsc --noEmit exit 0
```

## What this issue did not do

- Production index apply or `vantagemovers` backfill.
- Guessing snapshots for the 21 test / 37 production remainder ids.
- WordPress receipts (JTE-07).
- Optimistic attach rules; assemble still refuses orphans without a snapshot.
- Google read-back, Daily Assurance, notifications.
- Removing the v1 client fallback.
- Creating `/daily`.
- Touching `vantage-admin` (create-path stamp is server-side; Owner DTOs
  already omit snapshot keys).

JTE-01 residual stands: CLI company/granularity mismatch prints
`filtered_out` (exit 0). JTE-02 residuals stand: `assembled_at` /
qualified RingCentral receipts. JTE-05 residual stands: v1 fallback kept;
live test-DB had no `cancellation_intake` pages (3 release-case rows).
That gap is correlation, not a license to invent an intake event.

No Command, EntityChange, case, outbox row, or notification was added
beyond the existing official Cancellation create path.
