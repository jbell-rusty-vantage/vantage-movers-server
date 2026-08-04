# Best Relocation Ingestion and Reporting Projection Specification

Status: specification complete; implementation not started  
Date: 2026-08-03  
Default business timezone: `America/New_York`

## 1. Purpose

This specification covers two application capabilities:

1. an application-owned, idempotent, scheduled Best Relocation ingestion; and
2. owner-configurable Google Sheets reports built from canonical production data.

The two capabilities both use Google APIs, but they are separate Modules with
different trust boundaries:

- ingestion reads external observations and invokes canonical domain commands;
- reporting reads canonical Mongo data and writes non-canonical projections.

They may share durable run, lease, audit, and provider-adapter conventions. They
must not share source/destination records, permissions, or Google identities by
accident.

## 2. Explicitly deferred work

The historical and production database merge is outside this specification.
Nothing here may:

- union the historical and production databases;
- expose historical database scope in report definitions;
- ingest pre-cutoff Best Relocation records through the recurring adapter;
- implement the future dashboard default that suppresses records before
  `2026-04-30`; or
- replace the later coordinated merge, materialized-view, verification, and
  dashboard-filtering plan.

Until that work is explicitly scheduled, configurable reports query the
production canonical database only.

Relevant direction:

- `docs/operations-registry-platform-direction.md`
- `docs/historical_production_db_staged_merge_ingestion_plans/`

## 3. Shared architectural invariants

1. MongoDB is canonical. Neither external input sheets nor generated report
   sheets become canonical business storage.
2. Preview never mutates canonical data or a destination workbook.
3. Apply executes an immutable plan or definition revision.
4. Every mutation records actor, source/run provenance, timing, and outcome.
5. Row number is provenance, never source identity.
6. Retries and concurrent triggers must not duplicate business records or
   deliveries.
7. External input workbooks and report destinations are separate records and
   permissions.
8. A configured report destination may never target a registered ingestion
   workbook or an operational Sheet Sync workbook.
9. Large work executes as leased, durable background runs, not inside an admin
   request.
10. Environment variables are deployment gates and credential/configuration
    inputs. Mutable owner intent belongs in application records.

## 4. Delivery sequence

Implementation proceeds in this order:

1. shared durable-run, lease, actor, checksum, and audit conventions;
2. thin generic ingestion kernel;
3. Best Relocation adapter, receipt bootstrap, dry-run, conflicts, and owner UI;
4. repeated production-data dry runs and activation gate;
5. scheduled Best Relocation ingestion;
6. reporting query catalog and durable reporting worker;
7. OAuth, Google Picker, destinations, and reporting admin UI;
8. live CI Google integration coverage and rollout hardening.

The Modules should be separate reviewable issue/PR groups. Scheduled ingestion
must not wait for Reporting Projection to be complete.

# Part A: Application-Owned Best Relocation Ingestion

## 5. Current assets to retain

The current service is a hardened migration pre-service:

- `src/services/bestRelocationSheetIngest/parsing.ts`
- `src/services/bestRelocationSheetIngest/matching.ts`
- `src/services/bestRelocationSheetIngest/plan.ts`
- `src/services/bestRelocationSheetIngest/apply.ts`
- `src/services/bestRelocationSheetIngest/dryRun.ts`
- `src/services/bestRelocationSheetIngest/types.ts`
- `src/services/bestRelocationSheetIngest/bestRelocationSheetIngest.test.ts`
- `scripts/best-relocation-sheet-ingest.ts`
- `src/services/bestRelocationSheetIngest/HANDOFF.md`

Retain its parsing, normalization, provenance, lead/booking matching, booking
collapse, dry-run planning, dependency ordering, and guarded idempotency
behavior. Replace CLI/local orchestration with server-owned runs, receipts,
leases, conflicts, and canonical domain commands.

The local CLI may remain as an operator diagnostic, but it must use the same
adapter and planner rather than become a second implementation.

## 6. Scope and source boundaries

### 6.1 Lead observations

Workbook environment key: `BEST_RELOCATION_SYNC_SHEET_ID`

Authoritative tabs:

- `Forms`
- `Local Forms`
- `Calls`

Only observations whose source timestamp is on or after local midnight
`2026-04-30 America/New_York` are in scope.

### 6.2 Booking and cancellation observations

Workbook environment key:
`BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID`

Authoritative tabs:

- `Booked Deals` for bookings;
- `Refunds` for cancellation/refund observations.

Only observations whose source timestamp is on or after local midnight
`2026-04-30 America/New_York` are in scope.

`LID_BestRelo` is derived matching/enrichment evidence only. It currently
projects values from `Booked Deals` with a formula similar to:

```text
=QUERY('Booked Deals'!G785:J, "select J where (I matches 'Best Relocation Forms') and G < 10000 and I is not null and J <> ''", 0)
```

It is not an independent source stream, receives no source-row receipts, and
cannot directly create or update canonical records. Its schema/formula health
is inspected because matching may depend on it.

### 6.3 Run watermark

Each run captures one immutable `source_read_through` instant before reading.
All source windows are `[2026-04-30 local midnight, source_read_through)`.

Because source rows can be edited or reordered, timestamp watermarks are not the
sole incremental mechanism. Every run scans the bounded source data and uses
stable row identity plus content hashes to classify unchanged rows as no-ops.

## 7. Environment contract

Production application runtime requires:

```dotenv
BEST_RELOCATION_SYNC_SHEET_ID=
BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID=
BEST_RELOCATION_INGEST_ENABLED=false
CRON_SECRET=
```

Google service-account credentials continue to use the existing supported
configuration:

```dotenv
GOOGLE_SERVICE_ACCOUNT_JSON=
# or GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=
# local development may use SERVICE_ACCOUNT_LOCAL_FILE=
```

Rules:

- The two official workbook IDs are required in the application path.
- Remove hardcoded production workbook fallbacks from
  `src/services/bestRelocationSheetIngest/sheets.ts`.
- `BACKFILL_BEST_RELOCATION_SHEET_ID` and `BACKFILL_BOOKED_SHEET_ID` may remain
  as short-lived CLI aliases only, with deprecation warnings.
- `BEST_RELOCATION_INGEST_ENABLED` is a deployment-level hard gate and defaults
  to false.
- The dashboard can never bypass a false env gate.
- Cadence and active state are application records, not env values.
- The fixed cutoff is a versioned Best Relocation adapter invariant, not an
  owner-editable setting.

The current reader uses a readonly Sheets scope. Stable IDs require narrowly
scoped write access to the two configured input workbooks. The service account
must be an editor of those workbooks and should use only the Sheets scope needed
to read cells and write the managed identity column. It does not need Drive-wide
access.

## 8. Thin generic ingestion kernel

Build a reusable execution kernel without building a general ingestion designer
or arbitrary schema-mapping UI.

Suggested interface:

```ts
interface IngestionAdapter<TObservation, TPlan> {
  key: string;
  schemaVersion: number;
  inspect(): Promise<IngestionInspection>;
  read(input: IngestionReadInput): AsyncIterable<TObservation>;
  plan(input: IngestionPlanInput<TObservation>): Promise<TPlan>;
  apply(input: IngestionApplyInput<TPlan>): Promise<IngestionApplyResult>;
}
```

The kernel owns:

- durable run creation and status transitions;
- immutable plan checksum;
- lease acquisition and renewal;
- source-row receipt lookup and persistence;
- checkpoints and retry/resume;
- actor and audit metadata;
- conflict persistence;
- structured counters and operational events; and
- queue/worker orchestration.

The Best Relocation adapter owns:

- source workbook/tab interpretation;
- cutoff enforcement;
- stable row keys;
- header aliases and parsers;
- Best Relocation source attribution;
- matching/collapse evidence;
- safe-update classification; and
- mapping validated observations to canonical domain commands.

The kernel does not own Lead, Booking, Cancellation, registry attribution, or
booking-reconciliation business rules.

## 9. Persistence model

### 9.1 `ExternalDataConnection`

One non-secret Best Relocation connection record:

- `_id`
- `key: "best_relocation"`
- `provider: "google_sheets"`
- env-key references for the two workbook IDs
- resolved workbook titles and masked IDs for health display
- `application_enabled`
- `cadence_hours: 24 | 48`
- `next_due_at`
- `last_checked_at`
- `last_successful_run_at`
- connection/schema health
- created/updated actor and timestamps

Credentials remain in environment configuration and are never copied to Mongo.

### 9.2 `IngestionRun`

- adapter and schema version
- trigger: `bootstrap | preview | manual | schedule | retry`
- status:
  `queued | inspecting | planning | awaiting_approval | applying |
  completed | completed_with_errors | failed | skipped`
- immutable source IDs/titles and read-through watermark
- cutoff and timezone
- plan checksum
- counters for read, out-of-scope, unchanged, creates, safe updates, conflicts,
  invalid rows, leadless bookings, cancellations, failures, and skips
- checkpoint/cursor
- lease owner/expiry
- actor
- started/completed timestamps
- structured failure/skip reason

A disabled or not-yet-due heartbeat records a cheap `skipped` result or updates
connection scheduler health without reading Google Sheets.

### 9.3 `SourceRowReceipt`

Append-only observation receipt:

- connection and dataset key
- stable source-row ID
- content hash over normalized source-owned values
- schema profile/version
- workbook ID, tab ID/name, last observed row number, and range
- first/last seen timestamps
- ingestion run ID
- parsed observation type
- classification/outcome
- resulting canonical model and IDs
- last applied source-owned values needed for three-way update comparison
- matching method, confidence, and evidence references

Enforce a uniqueness constraint over connection, dataset, stable source ID,
schema version, and content hash. Re-reading identical evidence is a no-op.
Changed evidence appends a new receipt; it never rewrites historical evidence.

### 9.4 `IngestionConflict`

- run and source receipt references
- type:
  `ambiguous_lead_match | changed_protected_field | duplicate_source_identity |
  missing_source_row | schema_drift | unmatched_refund | canonical_divergence`
- severity and status
- source company/granularity keys and label snapshots
- workbook/tab/row provenance
- normalized source values and protected-value diff
- ranked candidate IDs, scores, methods, and evidence
- related canonical IDs
- resolution/disposition
- resolver actor and timestamp

Booking-link conflicts integrate with the existing booking-reconciliation
workflow. Their UI must clearly identify origin `external_sheet_ingestion`,
Best Relocation source company/granularity, run, workbook/tab/row, and candidate
evidence. Employee booking-form reconciliation remains distinguishable by its
own origin.

### 9.5 Lease

Use the atomic Mongo lease pattern already established by:

- `src/models/SheetSyncLease.ts`
- `src/services/sheetSync/drainer/leases.ts`

Only one applying Best Relocation run may hold the adapter lease. Preview runs
may execute concurrently only if they do not write hidden IDs; an inspection
that needs identity repair must use the write lease.

## 10. Stable source identity

Preferred keys:

- form leads: source UUID/ref number;
- calls: an immutable managed ID where a durable source key is absent;
- bookings: normalized job number plus a managed ID for duplicate/anomalous
  cases;
- refunds: immutable managed ID, associated booking/job number retained as
  business evidence.

Where no durable source key exists, Vantage writes a hidden
`vantage_ingestion_id` column once. It never changes that value. Header
discovery must use aliases/managed metadata rather than assume a fixed column
letter.

Row number remains protected provenance only. Reordering rows cannot create a
new business record.

Duplicate stable IDs, missing IDs that cannot be repaired, or copied IDs create
conflicts and do not guess.

## 11. Bootstrap of existing production records

The first application-owned run is a special `bootstrap`:

1. read every in-scope source row;
2. build the normal normalized observations and idempotency keys;
3. deterministically link observations to records created by the prior import;
4. create receipts that adopt those canonical IDs without reapplying writes;
5. generate conflicts for ambiguous, missing, or divergent records;
6. produce count and financial reconciliation summaries; and
7. require owner/operator approval.

Scheduled apply cannot be enabled until bootstrap discrepancies are resolved or
explicitly dispositioned. A fresh replay that merely depends on HTTP preflight
skips is not an acceptable baseline.

## 12. Planning classifications

Every in-scope observation is classified as exactly one of:

- unchanged/no-op;
- canonical create;
- allowlisted safe update;
- leadless booking create plus reconciliation conflict;
- conflict requiring review;
- invalid source row; or
- retryable provider/system failure.

The immutable plan orders dependencies:

1. form and call leads;
2. bookings;
3. reconciliation/link outcomes;
4. refunds/cancellations.

## 13. Update and deletion policy

### 13.1 Three-way safe updates

An automatic update is allowed only when:

1. the canonical record originated from this Best Relocation ingestion;
2. the field is in the adapter's source-owned allowlist; and
3. the current canonical value still equals the value last applied by the
   adapter.

If canonical data diverged after ingestion, the changed source value becomes a
conflict instead of overwriting application work.

Initial safe lead fields may include normalized customer contact and move
description fields such as name, phone, email, pickup/delivery geography, move
date, move size, and local/long-distance evidence. The implementation issue
must enumerate and test the exact paths.

Protected by default:

- canonical IDs and source attribution;
- booked/cancelled workflow links;
- quoted/workflow state changed inside Vantage;
- agent allocations;
- merchant;
- job number identity;
- binder, deposit, refund, and other financial values;
- audit, reconciliation, and Sheet Sync metadata.

Changed protected fields create review conflicts. Financial changes require
explicit owner disposition.

### 13.2 Deleted or missing source rows

Source disappearance never deletes or soft-deletes a canonical record
automatically. Mark the prior row state `source_missing`, emit a warning or
conflict, and require a canonical correction/cancellation workflow.

## 14. Matching and leadless bookings

The existing matching evidence remains the starting point, but the historical
`0.5` threshold is not automatically accepted for unattended production.
Calibrate a stricter auto-link policy from reviewed examples.

A valid booking observation that cannot be linked confidently:

1. is created idempotently as an explicitly leadless/unresolved canonical
   booking;
2. opens a reconciliation conflict with ranked lead candidates and evidence;
3. appears in the unified booking-reconciliation queue with external-ingestion
   origin metadata; and
4. can later be attached through the existing canonical reconciliation command.

The system never silently skips a valid booking and never guesses solely to
avoid a conflict.

Refund observations are part of recurring ingestion. If a refund cannot be
linked confidently to a booking, preserve it as a conflict; do not create a
cancellation against a guessed booking.

## 15. Canonical apply boundary

Scheduled workers must not call the application's public HTTP API back into the
same deployment and must not write Mongoose models directly.

Extract reusable in-process domain commands from the existing v1 service layer.
Invoke them under a dedicated, auditable system actor such as:

```text
actor_type: system
actor_id: best-relocation-ingestion
origin: external_sheet_ingestion
```

The commands retain:

- request/domain validation;
- Operations Registry attribution and snapshots;
- booking import guards;
- transaction/outbox behavior;
- operational audit events; and
- Sheet Sync side effects.

Relevant current boundaries:

- `src/services/leads/formLead.service.ts`
- `src/services/agents/agentAllocation.service.ts`
- `src/services/bookings/bestRelocationImportGuard.ts`
- `src/validation/v1/leads.validation.ts`
- `src/validation/v1/bookings.validation.ts`
- `src/validation/v1/cancellations.validation.ts`
- `src/services/sheetSync/sheetSyncCoordinator.ts`

## 16. Scheduler and worker

Add a protected Vercel cron heartbeat:

```text
GET|POST /api/cron/best-relocation-ingest-heartbeat
schedule: 0 */6 * * *
```

The route:

1. authenticates with `CRON_SECRET`;
2. checks `BEST_RELOCATION_INGEST_ENABLED`;
3. reads the application connection state;
4. records a cheap skip when disabled or not due;
5. atomically advances/claims `next_due_at`;
6. creates a queued run; and
7. wakes a dedicated ingestion worker.

The actual ingestion is a durable background job. It acquires/renews the lease,
plans, checkpoints, invokes domain commands, and finalizes counters. The route
does not read full workbooks or apply mutations.

Owner-selectable cadence is initially `24` or `48` hours, default `24`. The
six-hour heartbeat supports timely retry and cadence changes without editing
`vercel.json`.

Follow existing scheduler/queue patterns:

- `vercel.json`
- `src/routes/sheet-sync-cron.routes.ts`
- `api/queues/sheet-sync-consumer.ts`
- `src/services/sheetSync/drainer/runSheetSyncDrain.ts`

## 17. Failure policy

Abort before canonical mutation when any structural precondition fails:

- authentication/access;
- required workbook/tab missing;
- unexpected required headers or schema version;
- cutoff/time parsing failure;
- identity-column corruption;
- plan checksum failure; or
- inability to obtain the apply lease.

After a validated immutable plan exists, isolate row-level failures by
dependency group, checkpoint successful outcomes, and continue where safe.
Finish as `completed_with_errors` when isolated failures remain. Retry resumes
from receipts/checkpoints and does not blindly replay successful mutations.

## 18. Admin experience

Add an ingestion control surface to `vantage-admin`.

Owner capabilities:

- view env hard-gate state;
- activate/deactivate application scheduling;
- choose 24- or 48-hour cadence;
- inspect source and schema health;
- run preview now;
- run an approved plan now;
- inspect bootstrap status;
- inspect last/next run and counters;
- inspect provenance and row outcomes;
- resolve source-data conflicts; and
- enter the unified booking-reconciliation flow for booking-link conflicts.

Admins have read-only run, health, and conflict visibility. They cannot activate
the connection or apply/resolve mutations.

The env hard gate is always read-only in the dashboard.

Suggested APIs:

```text
GET   /api/v1/admin/ingestion/connections/best-relocation
PATCH /api/v1/admin/ingestion/connections/best-relocation
POST  /api/v1/admin/ingestion/connections/best-relocation/inspect
POST  /api/v1/admin/ingestion/connections/best-relocation/preview
POST  /api/v1/admin/ingestion/connections/best-relocation/run
GET   /api/v1/admin/ingestion/runs
GET   /api/v1/admin/ingestion/runs/:runId
GET   /api/v1/admin/ingestion/conflicts
POST  /api/v1/admin/ingestion/conflicts/:conflictId/resolve
```

All mutations use the existing trusted admin actor/audit conventions.

## 19. Alerts and health

Emit operational incidents/events for:

- structural run failure;
- stale successful ingestion;
- repeated row failures;
- parsed counts unexpectedly dropping to zero;
- schema/formula drift;
- overlapping trigger/lease contention beyond a threshold;
- duplicate job/source identities;
- unmatched refunds; and
- a sharp rise in conflicts or leadless bookings.

Use the existing notification pipeline for failure, staleness, and conflict
spikes. Do not send routine success notifications. Successful runs remain
visible in dashboard history.

## 20. Ingestion tests and acceptance criteria

Automated tests must prove:

1. both source windows begin at `2026-04-30 America/New_York`;
2. a row before cutoff never enters the plan;
3. two identical runs create no additional records;
4. row reordering preserves identity;
5. a generated hidden ID remains stable;
6. a newly appended lead creates exactly one lead;
7. a newly appended booking attaches exactly once;
8. a valid unmatched booking creates one leadless booking and one conflict;
9. resolving that conflict uses canonical booking reconciliation;
10. a new refund creates exactly one cancellation;
11. changed safe fields update only through the three-way allowlist;
12. changed protected/financial fields create conflicts;
13. a deleted source row never deletes canonical data;
14. structural schema drift prevents apply;
15. a partial run resumes without duplication;
16. concurrent triggers produce one applying run;
17. a false env gate and a disabled/not-due application state skip cheaply;
18. bootstrap adopts existing records without replaying writes; and
19. `LID_BestRelo` can influence evidence but cannot create a mutation.

Activation requires at least three production-data dry runs on different days
with:

- stable and explained counts;
- zero unexpected schema drift;
- no duplicate planned mutations;
- verified cutoff behavior;
- reviewed matching samples;
- successful retry/resume simulation; and
- owner/operator disposition of bootstrap conflicts.

Enable first at a 24-hour cadence. Rollback is setting
`BEST_RELOCATION_INGEST_ENABLED=false`.

# Part B: Configurable Reporting Projection

## 21. Outcome and v1 boundary

The owner can:

1. connect his daily Google account through OAuth;
2. choose or create a Drive folder;
3. choose or create a destination spreadsheet;
4. select a vetted dataset;
5. configure filters and business columns;
6. preview volume, sample rows, warnings, and intended changes;
7. save an immutable definition revision;
8. manually run it as a durable background job; and
9. inspect delivery history, checksums, and failures.

V1 is manual-only. It does not include daily/weekly/monthly report schedules,
event-triggered reports, arbitrary Mongo/query builders, or key-based row
upserts. The persistence model may leave room for future schedules without
exposing or executing them.

## 22. Google identity and OAuth

Reporting uses owner OAuth only. It does not use the operational service account.

An OAuth client identifies the Vantage application in a Google Cloud project.
The owner authorizes that client using his daily Google account; the resulting
encrypted refresh token represents the owner.

Existing configuration:

- `src/config/domain/googleDriveOAuth.ts`
- `src/services/googleDriveOAuth/googleDriveOAuth.service.ts`
- `src/services/googleDriveOAuth/spreadsheet.service.ts`
- `src/models/GoogleDriveConnection.ts`
- `src/routes/google-drive-oauth.routes.ts`

Required production configuration includes:

```dotenv
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY=
GOOGLE_OAUTH_OWNER_EMAIL=
GOOGLE_OAUTH_REDIRECT_URI=
GOOGLE_OAUTH_COMPLETION_REDIRECT_URL=
GOOGLE_DRIVE_EXPORT_FOLDER_ID=
```

Google Picker adds:

```dotenv
GOOGLE_PICKER_API_KEY=
GOOGLE_PICKER_APP_ID=
```

The exact browser-visible Picker configuration must be separated from server
secrets. Never send the OAuth client secret, refresh token, or encryption key to
the dashboard.

Enable the Google Drive, Google Sheets, and Google Picker APIs in the production
Cloud project. Retain least-privilege `drive.file` access. Picker grants the app
access to the arbitrary owner-selected folder/file without requesting broad
whole-Drive browsing permission.

## 23. Dataset catalog and deployment allowlist

Dataset contracts are versioned server code. They define:

- supported filters;
- field and measure semantics;
- canonical query;
- column IDs/types/default labels;
- allowed sort keys;
- sensitivity classification;
- schema version; and
- preview and delivery validation.

Environment configuration may only enable/disable code-defined datasets:

```dotenv
REPORTING_ENABLED_DATASETS=lead_outcome_detail,lead_quality_exceptions,source_performance
```

The smart default is all three v1 datasets enabled. Environment JSON must not
define joins, columns, or measures.

### 23.1 `lead_outcome_detail`

Grain: exactly one canonical lead per row.

Date semantics: lead cohort. Select leads whose canonical lead timestamp is
within `[from, to)` in the definition timezone, then attach their latest/current
booking and cancellation outcome even if that outcome happened after `to`.

This dataset is the basis for owner-defined slices such as:

```text
Lead dates: 2026-04-30 through 2026-06-04
Sources:
  Best Relocation / Forms
  Best Relocation / Inbounds
  Top10 / Inbounds
Rows: all leads, including unbooked leads
Outcome: summarized booking/cancellation information on each lead row
```

If the UI presents an inclusive date-only end (`through June 4`), persist the
exclusive boundary of local midnight June 5.

Multiple-booking anomalies do not duplicate the lead. Include booking count and
a deterministic primary/current booking summary; expose the anomaly in
`lead_quality_exceptions`.

Default comprehensive business columns:

- lead ID and lead type;
- lead timestamp;
- Source Company and Granularity;
- name, phone, and email;
- pickup/delivery ZIP and state;
- route/local classification;
- move date and move size;
- quoted where applicable (`not applicable`, not false, for call leads);
- duplicate and bad-lead state;
- CPL value/resolution status;
- booked flag and booking count;
- primary job number and book date;
- assigned agent(s);
- merchant;
- binder and deposit;
- cancelled/refunded state, date, and amount where available.

The owner can remove, relabel, and reorder vetted columns. Mongo IDs are
optional. Secrets, raw payloads, Sheet Sync metadata, internal reconciliation
evidence, and unreviewed model fields are never exportable.

### 23.2 `lead_quality_exceptions`

Vetted exception types include:

- duplicates;
- bad leads;
- unresolved CPL/source attribution;
- leadless bookings;
- ambiguous or unresolved booking matches;
- multiple-booking anomalies;
- source/canonical divergence relevant to report quality; and
- cancellations/refunds with unresolved relationships.

This is a read-only reporting dataset. It does not replace the operational
reconciliation/conflict queues.

### 23.3 `source_performance`

Default grain is Source Company plus optional Granularity and selected time
dimension.

Auditable v1 measures:

- total leads;
- valid leads;
- duplicates;
- bad leads;
- quoted form leads;
- booked leads;
- cancelled bookings;
- net bookings;
- lead-to-booking conversion;
- net conversion;
- resolved CPL spend;
- unresolved-CPL count;
- total binder; and
- total deposit.

The approved `source_performance@1` booking semantics are:

- aggregate every canonical booking related to a cohort lead, not only the
  deterministic primary booking used by the one-row lead detail dataset;
- `cancelled_bookings` counts every related booking having at least one
  cancellation/refund record;
- `net_bookings` is the number of all related booking records minus the number
  of cancelled/refunded related booking records;
- `total_binder` and `total_deposit` sum their canonical amounts across every
  related booking record; and
- both conversion ratios are `null` when `total_leads` is zero.

These semantics are part of schema version 1 and are locked by contract tests.
Changing them is a dataset schema-version change.

Do not infer profit, revenue, or ROI until those domain terms and cost semantics
are specified. Call-lead quoted state is not applicable rather than false.

## 24. Source filter semantics

Use a hierarchical Registry selector:

1. select one or more Source Companies;
2. optionally select registered Granularities under those companies.

Persist stable registry keys and label snapshots in every immutable definition
revision. Labels may change without silently changing the historical meaning of
a prior run.

Other filters such as agent, merchant, route, booking status, cancellation
status, and local/long-distance are available only when the dataset contract
declares them valid.

Reuse/refactor canonical query concepts rather than copying the prototype's
aggregation logic:

- `src/services/analytics/analyticsFilters.ts`
- `src/services/analytics/analytics.service.ts`
- `src/services/analytics/agentSalesReport.service.ts`
- `src/services/admin/adminBrowse.service.ts`
- `scripts/test-create-google-spreadsheet.ts`

The prototype is evidence and a test fixture source, not the production query
Module.

## 25. Timezone and Mongo dates

Every definition revision stores an explicit IANA timezone. Default:
`America/New_York`.

Mongo `Date` values remain UTC instants. Convert local date/time boundaries to
UTC before constructing Mongo predicates. Convert result display values back to
the definition timezone. Tests must cover DST transitions where a local day is
23 or 25 hours.

All internal ranges are half-open: `[from, to)`.

## 26. Reporting persistence model

### 26.1 `ReportingDestination`

- provider: `google_sheets`
- Google Drive connection reference
- owner identity snapshot
- selected folder ID/name/URL
- workbook ID/name/URL when using `replace_tab`
- managed tab ID/name when using `replace_tab`
- destination type and ownership policy
- access/health status and last verification
- created/updated actor and timestamps
- archived state

Credentials are referenced, not copied.

### 26.2 `ReportingDefinition`

Stable identity and current revision pointer:

- owner-visible name and description
- active/archived state
- dataset key
- current revision ID
- created/updated actor and timestamps

V1 has no active schedule.

### 26.3 `ReportingDefinitionRevision`

Immutable:

- definition and revision number
- dataset key and dataset schema version
- explicit or rolling date-window specification
- Source Company/Granularity keys and label snapshots
- other validated filters
- selected column IDs, labels, ordering, and sort
- timezone
- destination reference/snapshot
- strategy: `replace_tab | snapshot`
- preview result/checksum and warnings
- creator and creation time

Editing creates a revision; it never mutates a prior revision used by a run.

### 26.4 `ReportingRun`

- immutable definition revision ID and snapshot checksum
- trigger: `manual`
- actor
- status:
  `queued | querying | writing | verifying | promoting |
  completed | failed | cancelled`
- lease and checkpoint
- source read-through instant
- estimated/actual rows, columns, and cells
- query/write batch counters
- deterministic data checksum
- provider request/retry counters
- timing and structured failure

### 26.5 `ReportingDelivery`

- run and destination references
- strategy
- spreadsheet and managed tab IDs/URLs
- staging artifact IDs
- provider responses needed for audit
- expected/verified headers, row count, cell count, and checksum
- promotion/cleanup result
- completion timestamp

Do not store a complete duplicate of exported rows in Mongo.

## 27. Destination selection and ownership

The owner can:

- create a folder through Vantage;
- choose a Vantage-created folder;
- use Google Picker to authorize an arbitrary existing owner folder;
- create a named spreadsheet in that folder;
- select an authorized existing spreadsheet for `replace_tab`; and
- choose the managed report tab name.

For `replace_tab`, Vantage creates and marks its own tab. Store the immutable
Google tab/sheet ID. Vantage may replace only that managed tab, never a
human-created tab found by name. Name collisions require a different name.
Detach/delete operations require explicit owner confirmation.

For `snapshot`, each run creates a new immutable spreadsheet in the selected
folder, named from the definition and run timestamp. A snapshot is not a new tab
in a shared workbook.

Before saving or running a destination, validate file IDs against a hard
denylist containing:

- every registered ingestion workbook, including both Best Relocation inputs;
- Master Leads;
- Master Booked;
- all configured source Sheet Sync targets; and
- any other operational projection workbook.

There is no owner override in v1.

## 28. Preview and revision workflow

Every new/revised definition must:

1. pass dataset/filter/column validation;
2. verify destination access and safety;
3. calculate exact or bounded row count;
4. calculate projected columns/cells and destination capacity;
5. estimate query/write batches and warn about large delivery;
6. return 50 representative sample rows;
7. describe intended workbook/tab changes;
8. identify PII columns and destination ownership; and
9. produce a preview checksum tied to the revision draft.

The owner explicitly confirms the first delivery of a revision. Later manual
runs of the unchanged revision may run directly after a fresh volume/warning
estimate in the confirmation dialog.

Do not silently truncate. Permit output up to Google Sheets' actual platform and
destination limits, subject to provider quota and safe worker execution. Refuse
delivery with actionable feedback when projected cells exceed the destination
capacity or provider limit.

## 29. Durable report execution

The run-now API validates the immutable revision, creates a queued
`ReportingRun`, and returns immediately. A dedicated worker:

1. acquires a run lease;
2. captures source read-through;
3. streams/paginates the canonical Mongo query with deterministic ordering;
4. computes a deterministic checksum;
5. writes bounded Google API batches;
6. checkpoints after each batch;
7. retries retryable provider errors with bounded exponential backoff;
8. verifies artifact headers, rows, cells, and checksum; and
9. records and promotes the delivery.

The dashboard polls or refreshes run state. A browser disconnect has no effect
on the run.

The Reporting worker may reuse low-level Google quota/retry conventions from
Sheet Sync, but it must not create one `SheetSyncJob` per report row.

Relevant infrastructure:

- `src/services/sheetSync/drainer/runSheetSyncDrain.ts`
- `src/services/sheetSync/drainer/leases.ts`
- `src/models/SheetSyncRun.ts`
- `src/config/domain/sheetSync.ts`
- `src/services/googleDriveOAuth/spreadsheet.service.ts`

## 30. Replace-tab staging and promotion

Never clear the published tab before a replacement is ready.

1. Create a uniquely named hidden staging tab.
2. Write header and data batches.
3. Verify schema, row count, cell count, and checksum.
4. Promote using a Google batch update: rename the old managed tab aside, rename
   the staging tab to the published name, and preserve IDs/status needed for
   recovery.
5. Delete the old tab only after promotion verification, or retain it briefly
   under a bounded cleanup policy.
6. On failure, leave the previously published tab untouched and record/clean up
   the failed staging artifact.

Snapshot runs create a new workbook, verify it, and trash incomplete workbooks
on failure, extending the pattern in
`scripts/test-create-google-spreadsheet.ts`.

## 31. Reporting authorization and audit

Owner:

- connect/disconnect OAuth;
- use Picker;
- create/archive destinations;
- create/revise/archive definitions;
- preview;
- run;
- cancel when safely cancellable; and
- clean up managed artifacts.

Admins:

- read definitions and destination health;
- view preview metadata/sample subject to existing data access;
- view run/delivery history and failures; and
- cannot create external files, alter destinations/definitions, or run reports.

Follow existing admin proxy and trusted actor patterns:

- `vantage-admin/app/api/proxy/[...path]/route.ts`
- `vantage-admin/server/auth/authorization.ts`
- `vantage-admin/server/auth/trustedProxyHeaders.ts`
- `vantage-main-server/src/routes/google-drive-oauth.routes.ts`

Audit every destination mutation, definition revision, preview approval, run,
cancel, delivery, and cleanup.

## 32. Suggested reporting APIs

```text
GET    /api/v1/admin/reporting/catalog

GET    /api/v1/admin/reporting/destinations
POST   /api/v1/admin/reporting/destinations
GET    /api/v1/admin/reporting/destinations/:id
PATCH  /api/v1/admin/reporting/destinations/:id
POST   /api/v1/admin/reporting/destinations/:id/verify
DELETE /api/v1/admin/reporting/destinations/:id

GET    /api/v1/admin/reporting/definitions
POST   /api/v1/admin/reporting/definitions
GET    /api/v1/admin/reporting/definitions/:id
POST   /api/v1/admin/reporting/definitions/:id/revisions
POST   /api/v1/admin/reporting/definitions/:id/preview
POST   /api/v1/admin/reporting/definitions/:id/run
POST   /api/v1/admin/reporting/definitions/:id/clone
DELETE /api/v1/admin/reporting/definitions/:id

GET    /api/v1/admin/reporting/runs
GET    /api/v1/admin/reporting/runs/:id
POST   /api/v1/admin/reporting/runs/:id/cancel
```

Extend the existing OAuth routes with a safe Picker bootstrap endpoint that
returns only browser-safe Picker configuration and a short-lived access token
appropriate to the selected flow.

## 33. Reporting admin UI

Suggested pages/components:

- Google Drive connection and Picker setup under owner settings;
- Reporting Definitions list;
- definition builder with dataset, cohort window, Registry source selector,
  valid dataset-specific filters, columns, ordering, destination, and strategy;
- preview step with count/sample/warnings/intended changes;
- destination manager with ownership and health;
- run history/detail with progress, checksum, artifact link, and failure detail;
- read-only admin views for health and history.

Use existing Operations Registry controls for Source Company/Granularity
selection and existing observational run UI patterns as references:

- `vantage-admin/components/operations-registry/`
- `vantage-admin/lib/api/operationsRegistry.ts`
- `vantage-admin/components/observational/observational-sheet-sync.tsx`

## 34. Reporting alerts and retention

Notify the owner on failed manual report runs and provider/authentication health
failures. Do not send routine success notifications.

Retain indefinitely:

- definition revisions;
- destination audit history;
- run/delivery metadata;
- checksums and verification;
- actors and timestamps.

Do not persist full report row artifacts in Mongo. Preview samples and temporary
staging manifests receive short TTLs. Google artifact retention remains under
the owner's Drive control.

## 35. Reporting tests and acceptance criteria

Unit/integration tests must cover:

1. dataset/filter/column validation;
2. hierarchical Source Company/Granularity filters;
3. lead-cohort `[from, to)` semantics;
4. New York-to-UTC conversion across DST;
5. all leads retained through left-joined outcome summaries;
6. no lead duplication for multiple-booking anomalies;
7. call-lead quoted value represented as not applicable;
8. source funnel measure definitions;
9. immutable revisions and run snapshots;
10. denylisting every ingestion/operational workbook;
11. refusal to take over a human-created tab;
12. Google capacity feedback and no silent truncation;
13. worker pagination, lease, retry, and checkpoint resume;
14. deterministic ordering/checksum;
15. staging verification and promotion;
16. prior tab preservation on failed replacement;
17. incomplete snapshot cleanup;
18. owner-write/admin-read authorization; and
19. PII excluded from logs, audit payloads, and persisted preview metadata.

CI also runs live Google integration tests using:

- a dedicated test Google OAuth user;
- a dedicated test Cloud/OAuth configuration;
- a dedicated disposable export root;
- secrets restricted to trusted CI branches/environments;
- unique run-tagged artifact names;
- content verification;
- cleanup in `finally`; and
- a janitor for abandoned test artifacts.

Production owner OAuth credentials must never be exposed to CI. Testing only
with the service account is insufficient because it would not exercise the
owner OAuth/Picker/reporting path.

# Part C: Cross-Module File and Implementation Map

## 36. Server files likely to change

Ingestion:

- `src/services/bestRelocationSheetIngest/`
- `src/services/bestRelocationSheetIngest/sheets.ts`
- `src/services/bestRelocationSheetIngest/HANDOFF.md`
- `src/routes/*ingestion*.routes.ts` (new)
- `src/models/IngestionRun.ts` (new)
- `src/models/SourceRowReceipt.ts` (new)
- `src/models/IngestionConflict.ts` (new)
- connection/schedule/lease models (new)
- `src/app.ts`
- `vercel.json`
- a dedicated queue consumer under `api/queues/`

Canonical command extraction:

- lead, booking, cancellation, reconciliation, registry, audit, and Sheet Sync
  service boundaries under `src/services/`

Reporting:

- `src/services/reporting/` (new)
- `src/models/ReportingDestination.ts` (new)
- `src/models/ReportingDefinition.ts` and revision model (new)
- `src/models/ReportingRun.ts` (new)
- `src/models/ReportingDelivery.ts` (new)
- `src/routes/reporting.routes.ts` (new)
- `src/services/googleDriveOAuth/`
- `src/config/domain/googleDriveOAuth.ts`
- dedicated reporting queue consumer

Query sources to consolidate:

- `src/services/analytics/analyticsFilters.ts`
- `src/services/analytics/analytics.service.ts`
- `src/services/analytics/agentSalesReport.service.ts`
- `scripts/test-create-google-spreadsheet.ts`

## 37. Admin files likely to change

- `vantage-admin/server/auth/authorization.ts`
- `vantage-admin/app/api/proxy/[...path]/route.ts`
- `vantage-admin/lib/api/` for ingestion/reporting clients
- owner settings for Google OAuth and Picker
- ingestion control/run/conflict pages
- reporting destination/definition/preview/run pages
- observational health surfaces
- unified booking-reconciliation origin metadata and filters

The later Claude-designed dashboard enhancement can supply visual treatment, but
it must preserve the permissions, revision, preview, run, and conflict behavior
defined here.

## 38. Existing patterns to reuse

- Operations Registry attribution and owner mutation controls:
  `src/services/operationsRegistry/`
- cron authentication:
  `src/routes/sheet-sync-cron.routes.ts`
- outbox/worker leases and runs:
  `src/services/sheetSync/`, `src/models/SheetSyncRun.ts`
- operational events/reports:
  `src/services/observability/`
- OAuth token encryption and owner restriction:
  `src/services/googleDriveOAuth/`
- Google spreadsheet proof:
  `scripts/test-create-google-spreadsheet.ts`
- admin run observability:
  `vantage-admin/components/observational/observational-sheet-sync.tsx`

## 39. Definition of complete

Part A is complete when Best Relocation runs every 24 or 48 hours under dual
env/application control, produces durable receipts and conflicts, survives
retries/concurrency, applies through canonical commands, and passes the
production activation gate.

Part B is complete when the owner can use OAuth and Picker to create a safe
destination, define and preview any of the three vetted production-only
datasets, manually run a durable snapshot or managed replace-tab delivery, and
verify its history and artifact without risking input or operational sheets.

Neither completion condition includes or authorizes the historical database
merge.
