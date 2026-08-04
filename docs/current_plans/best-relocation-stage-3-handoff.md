# Best Relocation Stage 3 — Implementation Handoff

Status: implementation complete; Google delivery activation intentionally pending Stage 4  
Implementation source: `best-relocation-stage-3-reporting-core.md`

## Delivered

- Three code-defined, schema-versioned production datasets:
  - `lead_outcome_detail@1`;
  - `lead_quality_exceptions@1`; and
  - `source_performance@1`.
- Strict `REPORTING_ENABLED_DATASETS` parsing. Blank configuration enables all
  three datasets; unknown and duplicate keys fail closed.
- Catalog-defined filters, columns, sensitivity, sorts, required tie-breakers,
  sampling policy, rolling-window options, and manual-only capability.
- Production-only canonical reads. Reporting accepts no historical/combined
  database scope, arbitrary Mongo query, join, expression, or unvetted field.
- Explicit and vetted rolling date windows with an IANA timezone:
  - explicit local `[from, to)` boundaries;
  - inclusive owner-facing through dates normalized to the next local midnight;
  - `last_n_days` rolling windows from 1 through 366 days;
  - fresh rolling-window resolution at preview and run preparation; and
  - New York 23-hour and 25-hour DST behavior.
- Hierarchical Operations Registry source validation using stable company and
  granularity keys plus immutable label snapshots.
- Canonical query behavior:
  - lead cohorts use canonical lead timestamps and half-open UTC predicates;
  - outcome joins retain unbooked form and call leads;
  - multiple bookings never duplicate a detail lead row;
  - deterministic primary booking selection prefers active state, then newest
    canonical book date, then ascending ID;
  - call-lead quote state is `not_applicable`;
  - all eight quality-exception types use non-PII summaries; and
  - source-performance rows group by stable Registry identity, not mutable labels.
- Owner-approved `source_performance@1` semantics recorded in the authoritative
  specification:
  - every canonical booking related to a cohort lead participates;
  - `cancelled_bookings` counts every related cancelled/refunded booking;
  - `net_bookings` is related bookings minus cancelled/refunded bookings;
  - binder and deposit sum across all related bookings; and
  - zero-denominator conversions are `null`.
- Correct CPL classification: `resolved`, `duplicate_zero`, and
  `not_applicable` are not unresolved; missing/undefined/`missing_rate` are.
- Exact or conservative `upper_bound` estimates with non-PII explanations,
  global query/materialization budgets, header-inclusive capacity checks, and
  no silent truncation.
- Versioned representative sampling with temporal and outcome/exception
  variation. Up to 50 sample rows are response-only and never persisted.
- Keyed sample evidence rather than a raw PII-derived checksum.
- Reporting persistence:
  - mutable `ReportingDefinition`;
  - append-only immutable `ReportingDefinitionRevision`;
  - TTL `ReportingPreview` metadata without sample values;
  - durable `ReportingRun`;
  - atomically consumed `ReportingRunConfirmation`.
- Transactional revision allocation/insertion/current-pointer advancement.
- Immutable revision and run fields with narrow Stage 4 transition,
  source-read-through, and failure repositories.
- Owner-write/admin-read authorization through the existing signed admin actor
  contract.
- Two-step, actor-bound manual run confirmation with a stable idempotency key,
  atomic confirmation consumption, replay fingerprint checks, and persisted
  idempotent responses.
- PII-safe reporting lifecycle audits and typed, allowlisted run failures.
- Validated destination port with identity/checksum/freshness/safety/capacity
  checks and strategy-specific snapshot/managed-tab requirements.
- Snapshot-consistent candidate-manifest capture with canonical dependency
  IDs, versions, fingerprints, and a snapshot token.
- Exact output-page-to-dependency mappings, complete resume validation,
  before/after page fencing, deterministic cursors, and checksum accumulator
  contracts.
- Versioned `ReportingExecutionPackageV1` and Stage 4 execution seam.
- Mandatory literal Google write semantics in the handoff contract:
  `valueInputOption: "RAW"` for headers and cells, with no formula
  interpretation.
- Catalog-driven Vantage Admin reporting UI:
  - definition list/detail and revision history;
  - explicit/rolling cohort builder;
  - hierarchical Registry source selection;
  - dataset-only filters and vetted column relabel/reorder controls;
  - PII badges, deterministic ordering notes, preview/capacity display;
  - immutable save, archive, and two-step run confirmation; and
  - read-only admin behavior with owner-only mutations.

## Public server interfaces

```text
GET    /api/v1/admin/reporting/catalog

POST   /api/v1/admin/reporting/draft/preview
GET    /api/v1/admin/reporting/definitions
POST   /api/v1/admin/reporting/definitions
GET    /api/v1/admin/reporting/definitions/:id
POST   /api/v1/admin/reporting/definitions/:id/preview
POST   /api/v1/admin/reporting/definitions/:id/revisions
POST   /api/v1/admin/reporting/definitions/:id/clone
DELETE /api/v1/admin/reporting/definitions/:id
POST   /api/v1/admin/reporting/definitions/:id/run

GET    /api/v1/admin/reporting/runs
GET    /api/v1/admin/reporting/runs/:id
```

The run endpoint is a two-step protocol:

1. send `revisionId` and one stable `idempotencyKey` to receive a fresh
   estimate, warnings, intended changes, and signed confirmation;
2. send the same `revisionId`, `idempotencyKey`, and `confirmationToken` to
   create or replay one durable `queued` run.

The confirmed request returns `202` immediately. It does not stream Mongo rows
or invoke Google.

## Admin interfaces

```text
/reporting
/reporting/:definitionId
```

Relevant implementation:

```text
vantage-admin/lib/api/reporting.ts
vantage-admin/lib/reporting/
vantage-admin/components/reporting/
vantage-admin/app/(dashboard)/reporting/
```

The admin proxy permits reporting `GET` requests for owner and admin roles.
Every reporting `POST` and `DELETE` remains owner-only.

## Persistence and retention

- Definitions, immutable revisions, run metadata, checksums/evidence, actors,
  and audit metadata are retained.
- Preview metadata expires through its TTL index.
- Sample values and complete report artifacts are not stored in Mongo.
- Revisions reject mutation through document, query, replacement, and bulk
  paths.
- Run revision/query/destination snapshots are immutable.
- `source_read_through` is set once by a lease owner/epoch-fenced Stage 4
  operation.
- Failure persistence accepts only the typed non-PII reporting failure
  envelope.

Do not delete definitions, revisions, previews referenced by revisions, runs,
confirmations, manifests, or reporting audit evidence to correct report data.
Create a new immutable revision or a new run.

## Configuration

```dotenv
# Blank/omitted enables all three code-defined v1 datasets.
REPORTING_ENABLED_DATASETS=lead_outcome_detail,lead_quality_exceptions,source_performance

# Use dedicated production secrets. API_SECRET is only a fallback.
REPORTING_CONFIRMATION_SECRET=
REPORTING_EVIDENCE_SECRET=
```

Environment values only enable code-defined datasets and provide secrets.
They cannot define reporting joins, columns, measures, filters, labels, sorts,
or destinations.

## Activation state

Stage 3 does not write Google artifacts and does not include a Google delivery
worker. It ends after creating a validated, immutable, manual `queued` run and
its `ReportingExecutionPackageV1`.

The destination port intentionally has no production destination registered by
default. Preview and run preparation fail closed until Stage 4 supplies a
validated owner-OAuth destination adapter and registers a matching destination
ID/checksum.

The Stage 4 stream also fails closed until Stage 4 injects its persisted
manifest page adapter. This is intentional: Stage 3 defines and tests the
versioned seam; Stage 4 owns Google OAuth, destination management, worker
leases, persisted manifests, page reads, bounded writes, verification,
promotion, cleanup, and delivery metadata.

V1 remains manual-only. No daily, weekly, monthly, event-triggered, or other
schedule is accepted or executed.

## Stage 4 handoff requirements

Stage 4 must:

1. implement the validated Google destination port without changing its
   interface;
2. deny every operational/ingestion workbook with no owner override;
3. inject the persisted-manifest page adapter;
4. capture `source_read_through` exactly once under the active run lease owner
   and epoch;
5. prepare/persist one snapshot-consistent candidate manifest and its exact
   output-page dependency mappings;
6. validate the complete manifest on resume and mapped dependencies before and
   after every page read;
7. preserve revision, destination, query-input, cursor, and checksum contracts;
8. write all headers and cells using literal `RAW` semantics;
9. reject capacity, safety, ownership, header, cursor, count, or checksum drift;
10. checkpoint bounded Google writes and verification without reinterpreting
    filters, ordering, labels, or owner intent; and
11. leave failed immutable runs intact; retry with a new run/read-through when
    canonical data changed.

Stage 4 must not reuse the Stage 2 service-account identity, queue topic, lease
scope, destination namespace, or Google clients.

## Verification

Focused Stage 3 contracts:

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/services/reporting/reporting.test.ts \
  src/services/reporting/executionStream.test.ts
```

Repository checks:

```text
# vantage-main-server
pnpm typecheck
pnpm test

# vantage-admin
pnpm typecheck
pnpm test
pnpm lint
```

Results on 2026-08-04:

- focused reporting contracts: 40 passed, 0 failed;
- full server suite: 721 passed, 0 failed;
- server TypeScript: passed;
- admin suite: 120 passed, 0 failed;
- admin TypeScript: passed;
- admin ESLint: passed;
- final independent security review: no release-blocking findings;
- final independent correctness review: all findings resolved.

## Evidence limitation

The repository does not currently provide an isolated Mongo replica-set fixture
or an HTTP integration harness. Mongo snapshot transactions, duplicate-key
confirmation races, route middleware, and rollback behavior are covered by
typed adapter/fixture/behavior contracts but were not exercised against a live
isolated Mongo deployment during this implementation session.

Before Stage 4 production rollout, add or provision an isolated replica-set
integration environment and run the transaction, snapshot, lease-race,
authorization, and immediate-`202` API contracts end to end. Do not point those
tests at production.

