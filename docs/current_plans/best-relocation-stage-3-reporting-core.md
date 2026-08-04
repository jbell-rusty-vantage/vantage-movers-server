# Best Relocation Stage 3 — Reporting Domain and Query Core

Status: implementation plan  
Source of truth: `docs/current_plans/best-relocation-ingestion-and-reporting-projection-spec.md`  
Default business timezone: `America/New_York`

## 1. Stage outcome

Implement the production-only reporting domain/query core that lets an owner:

1. inspect the three versioned, deployment-allowlisted datasets;
2. build a definition draft using only catalog-declared filters, columns, and sorts;
3. validate the draft through a destination port defined here and implemented
   by Stage 4, using a contract fake while the stages are developed;
4. preview exact or explicitly bounded volume, 50 representative rows, warnings,
   PII/sensitivity, destination capacity, and intended changes;
5. save an immutable definition revision;
6. confirm the first delivery of that revision; and
7. prepare one durable, manual-only run against the immutable revision.

This stage does not write Google artifacts. It ends at a validated immutable
revision/run handoff that Stage 4 can stream and deliver without reinterpreting
owner intent.

V1 is manual-only. Do not expose or execute daily, weekly, monthly,
event-triggered, or other schedules. Do not implement an arbitrary Mongo/query
builder or key-based row upserts. Models may reserve compatible fields for a
future scheduling stage, but no active schedule is accepted by validation or
run preparation.

Stage 3 can execute in parallel with
[`best-relocation-stage-2-ingestion.md`](./best-relocation-stage-2-ingestion.md)
after the Stage 1 entry criteria below are met. The reporting query reads
canonical production models only and has no dependency on Stage 2 source
receipts, conflicts, or scheduling.

## 2. Related implementation documents

- Prerequisite:
  [`best-relocation-stage-1-shared-foundations.md`](./best-relocation-stage-1-shared-foundations.md)
- Parallel ingestion work:
  [`best-relocation-stage-2-ingestion.md`](./best-relocation-stage-2-ingestion.md)
- Consumer of this stage's handoff:
  [`best-relocation-stage-4-google-delivery-and-rollout.md`](./best-relocation-stage-4-google-delivery-and-rollout.md)

## 3. Entry criteria from Stage 1

Do not start persistence or route integration until Stage 1 supplies and tests:

- a trusted actor shape that distinguishes owner, admin, and system actors;
- owner-write/admin-read authorization helpers;
- immutable canonical serialization and SHA-256 checksum helpers;
- durable run status-transition guards;
- atomic Mongo lease fields/helpers and stale-lease recovery conventions;
- structured failure/reason envelopes with retryability;
- audit-event conventions that record actor, action, resource, timing, and
  outcome without raw PII;
- pagination/checkpoint primitives that support deterministic resume;
- production model access that cannot select historical or combined database
  scope; and
- a test database/fixture pattern for form leads, call leads, bookings,
  cancellations, Operations Registry labels, and multiple-booking anomalies.

If Stage 1 names differ, adapt imports at the reporting boundary rather than
forking actor, checksum, lease, run, or audit semantics.

## 4. Scope

Stage 3 owns:

- the code-defined dataset catalog and `REPORTING_ENABLED_DATASETS` allowlist;
- schema-versioned column, filter, measure, sort, sensitivity, and validation
  contracts;
- canonical production-only query plans for all three v1 datasets;
- Registry source filter validation and immutable key/label snapshots;
- IANA timezone validation, local-boundary-to-UTC conversion, display
  conversion, and half-open date ranges;
- reporting definition, immutable revision, run, and preview persistence;
- a validated destination port/snapshot interface defined by Stage 3, with
  contract fakes for Stage 3 and a production Google implementation owned by
  Stage 4;
- draft validation, preview, warning, capacity, checksum, and revision workflow;
- deterministic streaming/pagination contracts and query/data checksums;
- catalog, definition, preview, and manual run-preparation APIs;
- the reporting-core portion of the admin definition builder;
- PII-safe logging/audit/preview persistence; and
- acceptance tests 1–9 from source section 35, plus core capacity,
  deterministic checksum, authorization, and PII tests needed at this boundary.

## 5. Non-goals

Stage 3 must not:

- query, union, expose, or offer a selector for the historical database;
- suppress production records before `2026-04-30` as a dashboard/report default;
- implement the deferred historical/production merge;
- connect OAuth, bootstrap Picker, create or mutate Drive folders/files,
  manage destinations, write Sheets batches, stage/promote tabs, or clean up
  Google artifacts; those belong to Stage 4;
- use the operational Google service account for reporting;
- permit environment JSON to define queries, joins, columns, or measures;
- infer profit, revenue, ROI, or unspecified cost semantics;
- export secrets, raw payloads, Sheet Sync metadata, internal reconciliation
  evidence, or unreviewed model fields;
- make report rows canonical or persist a full duplicate of exported rows in Mongo;
- mutate canonical records or operational reconciliation/conflict queues;
- turn a reporting exception row into an operational resolution command;
- silently truncate samples, previews, or deliveries;
- take over a human-created tab by matching its name; or
- perform report work synchronously in an admin request.

## 6. Core invariants

1. Mongo production data is canonical; a report is a read-only projection.
2. Every dataset contract is code-defined and versioned.
3. Every internal date range is `[from, to)`.
4. Mongo dates are UTC instants; definition boundaries and displayed values use
   the revision's explicit IANA timezone.
5. A lead cohort is selected by canonical lead timestamp, while current/latest
   outcome information may occur after `to`.
6. Outcome joins are left joins: unbooked leads remain present.
7. Multiple bookings never duplicate a lead row.
8. Registry keys determine filtering; label snapshots preserve historical
   meaning and display.
9. Preview mutates neither canonical data nor a destination.
10. Editing creates a new immutable revision; a run always references exactly
    one immutable revision and checksum.
11. The first delivery of every revision requires explicit owner confirmation.
12. An unchanged revision may be run later only after a fresh volume/warning
    estimate is shown in the confirmation flow.
13. Query pagination has deterministic total ordering and no skipped or
    duplicated rows across page boundaries or resume.
14. No configured output is silently truncated. Over-capacity output is
    rejected with actionable dimensions and limits.
15. PII values never enter logs, audit payloads, persisted preview metadata,
    warnings, user-visible checksums, or structured failures.

## 7. Versioned dataset interfaces

Create `src/services/reporting/catalog/types.ts` with contracts equivalent to:

```ts
type DatasetKey =
  | "lead_outcome_detail"
  | "lead_quality_exceptions"
  | "source_performance";

type Sensitivity = "public" | "internal" | "confidential_pii";
type ScalarType =
  | "string"
  | "boolean"
  | "integer"
  | "decimal"
  | "money"
  | "date_time"
  | "date"
  | "enum"
  | "not_applicable_boolean";

interface ReportingDatasetV1<Filters, Row, Cursor> {
  key: DatasetKey;
  schemaVersion: 1;
  grain: string;
  dateSemantic: string;
  filters: FilterContract<Filters>;
  columns: readonly DatasetColumn<Row>[];
  allowedSorts: readonly SortSpec<Row>[];
  defaultSort: readonly SortTerm<Row>[];
  validate(input: unknown): ValidatedDatasetRequest<Filters>;
  estimate(input: QueryInput<Filters>): Promise<VolumeEstimate>;
  sample(input: QueryInput<Filters>, limit: 50): Promise<Row[]>;
  stream(input: QueryInput<Filters>, after?: Cursor):
    AsyncIterable<QueryPage<Row, Cursor>>;
}
```

All three v1 contracts have `schemaVersion: 1`. A breaking semantic, field,
type, measure, filter, sort, or query change requires a new schema version.
Old immutable revisions remain executable only while their exact contract
version is installed; otherwise run preparation rejects with
`dataset_schema_version_unavailable`.

### 7.1 Deployment allowlist

Parse:

```dotenv
REPORTING_ENABLED_DATASETS=lead_outcome_detail,lead_quality_exceptions,source_performance
```

Rules:

- omitted/blank configuration enables all three v1 datasets;
- only the three code-defined keys are accepted;
- unknown or duplicate tokens fail startup/config validation;
- disabled datasets are omitted from the owner catalog;
- existing revisions for a disabled dataset remain readable but cannot be
  previewed, revised, or run;
- environment values never define joins, filters, columns, measures, labels,
  sensitivity, or sort behavior.

### 7.2 Shared filter contract

Each draft/revision stores a versioned local date-window shape, explicit IANA
timezone, and hierarchical Registry source selection. It stores stable company
and granularity keys plus label snapshots; labels are never query keys.

Validation rules:

- require one or more valid Source Company keys;
- Granularity is optional, but every selected Granularity must be registered
  beneath a selected Source Company;
- selected companies without granularities mean all granularities under those
  companies;
- selected granularities narrow only their parent company;
- reject orphan, inactive-for-selection, or mismatched keys rather than
  broadening the query;
- agent, merchant, route, booking, cancellation, and local/long-distance filters
  are accepted only when declared by the selected dataset below;
- no request can submit `database_scope`;
- an inclusive date-only UI end such as “through 2026-06-04” is normalized and
  persisted as exclusive local midnight `2026-06-05`;
- explicit and vetted rolling windows are allowed; a rolling window resolves to
  explicit `[fromUtc, toUtc)` boundaries in each preview/run snapshot without
  mutating the revision;
- invalid/ambiguous local times and invalid IANA zones are rejected.

### 7.3 `lead_outcome_detail@1`

Grain: exactly one canonical lead per row.

Date semantic: lead cohort. Select form and call leads whose canonical lead
timestamp is in `[from, to)` in the definition timezone, then attach the
deterministic current/latest booking and cancellation outcome even when the
outcome occurred after `to`.

Valid filters are shared date/source filters plus `leadType`, `agentKeys`,
`merchantKeys`, `route: local | long_distance`,
`bookingStatus: booked | unbooked`, and
`cancellationStatus: active | cancelled_or_refunded`. Outcome filters apply to
the one-row-per-lead result. They may remove unbooked rows only when explicitly
selected; the default retains all leads.

The complete vetted column catalog is:

| Column ID | Default label | Type | Sensitivity/default |
| --- | --- | --- | --- |
| `lead_id` | Lead ID | string | internal/optional |
| `lead_type` | Lead Type | enum | internal/default |
| `lead_timestamp` | Lead Timestamp | date_time | internal/default |
| `source_company` | Source Company | string | internal/default |
| `source_granularity` | Granularity | string | internal/default |
| `customer_name` | Name | string | confidential_pii/default |
| `customer_phone` | Phone | string | confidential_pii/default |
| `customer_email` | Email | string | confidential_pii/default |
| `pickup_zip` | Pickup ZIP | string | confidential_pii/default |
| `pickup_state` | Pickup State | string | internal/default |
| `delivery_zip` | Delivery ZIP | string | confidential_pii/default |
| `delivery_state` | Delivery State | string | internal/default |
| `route_classification` | Route | enum | internal/default |
| `move_date` | Move Date | date | confidential_pii/default |
| `move_size` | Move Size | string | internal/default |
| `quoted` | Quoted | not_applicable_boolean | internal/default |
| `duplicate_state` | Duplicate | boolean | internal/default |
| `bad_lead_state` | Bad Lead | boolean | internal/default |
| `cpl_value` | CPL | money | internal/default |
| `cpl_resolution_status` | CPL Resolution | enum | internal/default |
| `booked` | Booked | boolean | internal/default |
| `booking_count` | Booking Count | integer | internal/default |
| `primary_job_number` | Primary Job Number | string | internal/default |
| `book_date` | Book Date | date_time | internal/default |
| `assigned_agents` | Assigned Agent(s) | string | internal/default |
| `merchant` | Merchant | string | internal/default |
| `binder` | Binder | money | internal/default |
| `deposit` | Deposit | money | internal/default |
| `cancelled_or_refunded` | Cancelled/Refunded | boolean | internal/default |
| `cancellation_or_refund_date` | Cancellation/Refund Date | date_time | internal/default |
| `refund_amount` | Refund Amount | money | internal/default |

Owner customization is limited to removing, relabeling, and reordering these
vetted columns. Relabeling cannot alter IDs, types, sensitivity, or semantics.
Mongo IDs are optional through `lead_id`.

Canonical query requirements:

1. normalize form and call leads to one shared projection;
2. match the UTC lead cohort before outcome joins;
3. match canonical Registry keys, not labels/regex aliases;
4. left-join every booking associated with each lead;
5. compute `booking_count` without unwinding into duplicate lead rows;
6. choose a primary/current booking deterministically by documented business
   state, descending canonical book timestamp, then ascending `_id`;
7. attach cancellation/refund state to that selected booking and retain the
   lead's aggregate cancelled/refunded state;
8. represent quoted call leads as `not_applicable`, never `false`;
9. use `null`, not fabricated zero/false/empty values, where unavailable; and
10. sort by `lead_timestamp ASC`, `lead_type ASC`, `lead_id ASC`.

Allowed owner sorts are `lead_timestamp`, `source_company`,
`source_granularity`, `customer_name`, `move_date`, `book_date`, and
`primary_job_number`. Every sort appends immutable `lead_type ASC`,
`lead_id ASC` tie-breakers and includes all terms in the cursor.

### 7.4 `lead_quality_exceptions@1`

Grain: exactly one report-quality exception occurrence per row. This read-only
dataset never replaces or mutates an operational reconciliation/conflict queue.

Date semantic: lead cohort when a lead exists; otherwise the canonical booking,
cancellation/refund, or divergence observation timestamp associated with the
exception. Each row exports `date_basis` so this is auditable.

The complete vetted exception enum is:

- `duplicate`;
- `bad_lead`;
- `unresolved_cpl_or_source_attribution`;
- `leadless_booking`;
- `ambiguous_or_unresolved_booking_match`;
- `multiple_booking_anomaly`;
- `source_canonical_divergence`;
- `unresolved_cancellation_or_refund_relationship`.

Valid filters are shared date/source filters plus `exceptionTypes[]` and
`leadType: form | call | none`.

The vetted columns are `exception_type`, `date_basis`, `exception_timestamp`,
`source_company`, `source_granularity`, optional `lead_id`, optional
`lead_type`, optional `job_number`, `summary`, `operational_status`, and
`related_record_count`. `summary` is a vetted non-PII description assembled
from enums/state fields; it may not contain raw evidence, candidate rankings,
names, phones, emails, addresses, or source payloads.

Default ordering is `exception_timestamp ASC`, `exception_type ASC`, and stable
synthetic `exception_key ASC`. The key is deterministically derived from the
exception type and canonical related IDs, supports pagination/checksums, and is
not selected by default.

### 7.5 `source_performance@1`

Default grain: Source Company plus optional Granularity and selected time
dimension. Date semantic: lead cohort `[from, to)` using canonical lead
timestamp. Attach booking/cancellation outcomes to cohort leads even when they
occur after `to`.

Valid filters are shared date/source filters plus
`timeDimension: none | day | month`, `includeGranularity: boolean`, and
`leadType: form | call`.

Dimension columns are `period`, `source_company`, and optional
`source_granularity`. The complete auditable measure catalog is:

| Measure ID | Definition |
| --- | --- |
| `total_leads` | Distinct canonical leads in the cohort |
| `valid_leads` | Cohort leads not marked duplicate or bad |
| `duplicates` | Cohort leads marked duplicate |
| `bad_leads` | Cohort leads marked bad |
| `quoted_form_leads` | Form leads with quoted true; call leads excluded as not applicable |
| `booked_leads` | Distinct cohort leads with at least one booking |
| `cancelled_bookings` | Cancelled/refunded bookings related to cohort leads; exact multiple-booking aggregation requires domain approval |
| `net_bookings` | Booked less cancelled outcome; exact grain and multiple-booking treatment require domain approval |
| `lead_to_booking_conversion` | `booked_leads / total_leads`; zero-denominator representation requires domain approval |
| `net_conversion` | `net_bookings / total_leads`; zero-denominator representation requires domain approval |
| `resolved_cpl_spend` | Sum of resolved canonical CPL for cohort leads |
| `unresolved_cpl_count` | Cohort leads without resolved CPL value/status |
| `total_binder` | Binder total related to cohort outcomes; multiple-booking aggregation requires domain approval |
| `total_deposit` | Deposit total related to cohort outcomes; multiple-booking aggregation requires domain approval |

Do not expose profit, revenue, ROI, or any inferred cost measure. Money rounds
to two decimal places only after aggregation; conversion ratios retain the
contracted decimal precision until delivery formatting. Call-lead quote state
never contributes to either quoted numerator or a false count.

The source specification intentionally names these auditable measures without
settling ambiguous multiple-booking and zero-denominator semantics. Before
`source_performance@1` is implemented, the owner/domain authority must approve
those semantics and record them in the authoritative specification and dataset
contract tests. The phrases in the table above are constraints, not permission
to choose primary-booking-only, all-booking, or zero/null behavior implicitly.

Default ordering is `period ASC`, `source_company ASC`,
`source_granularity ASC`. These dimensions form the complete pagination cursor.

### 7.6 Canonical query interface

All dataset implementations expose one common, production-only interface:

```ts
interface CanonicalReportingQuery {
  datasetKey: DatasetKey;
  datasetSchemaVersion: 1;
  resolvedWindow: {
    timezone: string;
    fromUtc: string;
    toExclusiveUtc: string;
  };
  validatedFilters: unknown;
  selectedColumns: Array<{ id: string; label: string }>;
  effectiveSort: Array<{ id: string; direction: "asc" | "desc" }>;
}

interface QueryPage<Row, Cursor> {
  rows: Row[];
  nextCursor: Cursor | null;
  rowCount: number;
  canonicalPageChecksum: string;
}
```

Requirements:

- use only production Mongoose models; do not call `getAdminModels` with a
  caller-provided scope;
- use keyset pagination, never offset pagination, for run streaming;
- keep a stable `source_read_through` captured by the run and add applicable
  `createdAt <= source_read_through` guards so later inserts do not shift pages;
- fence concurrent updates as well as inserts: require reliable monotonic
  `updatedAt`/version fields for every queried canonical model, build a compact
  ordered candidate manifest of IDs plus versions/fingerprints before external
  writes, and fail the current run if any candidate changed after
  `source_read_through`, during manifest construction, or before its page is
  consumed; if the existing models cannot supply that fence, use an equivalent
  Mongo snapshot/change-token strategy rather than emitting a mixed-time
  artifact; a retry with changed canonical data is a new run with a new
  read-through, never a restart that mutates the failed run's read-through;
- select only fields needed by the contract before application mapping;
- canonicalize scalar values, `null`, date strings, money, arrays, and object
  key order before checksumming;
- sample and full stream use the same validated predicates and row mapper;
- sample returns up to 50 rows using a deterministic, versioned
  dataset-specific representative-sampling policy over the eligible result
  (including temporal and outcome/exception variation where applicable), not
  merely the first page; the policy may select rows but may not reinterpret
  filters, grain, joins, or row values;
- a query-plan checksum covers dataset key/version, resolved window, validated
  filters, selected column IDs/labels/order, sort, timezone, destination
  snapshot checksum, and source read-through;
- a data checksum folds header plus canonical row bytes in stream order; and
- retries from a checkpoint must reproduce the same next cursor and checksum
  accumulator state.

Do not copy the existing analytics query implementation. Consolidate useful
normalization/attribution concepts from `analyticsFilters.ts`,
`analytics.service.ts`, `agentSalesReport.service.ts`, and
`adminBrowse.service.ts`, while correcting inclusive `$lte` date predicates to
the reporting contract's `$lt` exclusive end.

## 8. Timezone and date implementation

Create one reporting date-boundary module. It must:

- require and persist an explicit IANA timezone on every revision;
- default new drafts to `America/New_York`;
- convert local definition boundaries to UTC before Mongo predicates;
- convert displayed date/time values back to the revision timezone;
- preserve all Mongo `Date` values as UTC instants;
- use `$gte: fromUtc` and `$lt: toExclusiveUtc` everywhere;
- resolve an inclusive date-only end to the next local midnight before UTC
  conversion;
- handle New York 23-hour spring-forward and 25-hour fall-back days;
- reject nonexistent local times and require an explicit disambiguation policy
  for repeated local times; and
- include timezone library/tzdata behavior in tests so host timezone cannot
  change results.

## 9. Persistence, indexes, and state

### 9.1 `ReportingDefinition`

Mutable stable identity:

- `_id`;
- `name`, `description`;
- `dataset_key`;
- `state: active | archived`;
- `current_revision_id`;
- `created_by`, `created_at`, `updated_by`, `updated_at`.

V1 has no active schedule field. If a future-compatible opaque field is
reserved, validation requires it to be absent/null and no worker reads it.

Indexes:

- owner-visible active list: `{ state: 1, updated_at: -1, _id: 1 }`;
- current revision lookup: `{ current_revision_id: 1 }`;
- optional normalized owner-visible name uniqueness only if existing product
  naming rules require it; do not invent case-sensitive duplicates.

Archiving does not delete definitions or revisions and blocks new revisions and
runs until explicitly restored by a future authorized contract.

### 9.2 `ReportingDefinitionRevision`

Append-only and immutable after insert:

- `_id`, `definition_id`, `revision_number`;
- `dataset_key`, `dataset_schema_version`;
- explicit or rolling local `date_window_spec`;
- source company/granularity keys and label snapshots;
- all other validated filters;
- selected column IDs, owner labels, ordering, and effective sort;
- `timezone`;
- validated destination reference and immutable destination snapshot;
- `destination_snapshot_checksum`;
- `strategy: replace_tab | snapshot`;
- preview ID, result checksum, draft checksum, warnings, estimate timestamp;
- `revision_snapshot_checksum`;
- `created_by`, `created_at`.

Indexes and guards:

- unique `{ definition_id: 1, revision_number: 1 }`;
- `{ definition_id: 1, created_at: -1 }`;
- `{ dataset_key: 1, dataset_schema_version: 1 }`;
- schema middleware rejects updates/replacements/deletes in application code;
- repository exposes `insertRevision` and reads only, never a general update;
- revision number allocation is atomic and duplicate-key retry-safe;
- current revision pointer advances only after revision insert succeeds;
- run snapshots retain the revision checksum even if the definition is later
  archived or points to a newer revision.

### 9.3 Preview persistence

Persist short-lived `ReportingPreview` metadata rather than embedding raw rows:

- draft checksum and dataset/schema version;
- resolved UTC window and timezone;
- destination snapshot/checksum;
- exact/bounded row count and bound explanation;
- projected columns/cells;
- destination/provider capacity and remaining margin;
- estimated query/write batches;
- warning codes and non-PII parameters;
- selected PII column IDs/sensitivity and destination ownership classification;
- intended workbook/tab changes;
- sample row count and an ephemeral sample token, not sample values;
- preview checksum, creator, creation/expiry.

Use a TTL index on `expires_at`. If the API must return sample rows, compute and
return them in the response and keep them only in short-lived encrypted/cache
storage approved by Stage 1; never write sample values to Mongo logs, audit, or
the revision. The immutable revision stores preview metadata/checksum/warnings,
not the PII sample.

### 9.4 `ReportingRun`

Stage 3 creates the run; Stage 4 executes and extends delivery metadata.

Required fields:

- `_id`;
- immutable `definition_id`, `definition_revision_id`;
- full validated revision snapshot or durable immutable reference plus
  `revision_snapshot_checksum`;
- immutable `query_input_checksum` at queue time and nullable
  `query_plan_checksum`, set once after Stage 4 captures
  `source_read_through`;
- `trigger: manual`;
- actor snapshot;
- status:
  `queued | querying | writing | verifying | promoting | completed | failed | cancelled`;
- lease owner, acquired/renewed/expiry timestamps, attempt;
- checkpoint cursor, page/batch number, row count, checksum accumulator state;
- nullable `source_read_through`, set exactly once by the Stage 4 worker before
  querying and immutable thereafter;
- estimated and actual rows, columns, cells;
- query and write batch counters;
- deterministic final data checksum;
- provider request/retry counters;
- start/completion timestamps and structured failure;
- fresh estimate/warning snapshot shown at confirmation;
- first-delivery confirmation evidence where applicable.

Stage 3 may transition only into `queued` during run preparation. Stage 4 owns
execution transitions. Terminal states are immutable except append-only audit
or cleanup references.

Indexes:

- `{ definition_revision_id: 1, created_at: -1 }`;
- `{ status: 1, created_at: 1 }` for worker claim;
- `{ "lease.expires_at": 1, status: 1 }`;
- `{ created_at: -1, _id: 1 }` for history;
- an idempotency key unique across owner + revision + confirmation request so a
  retried HTTP request creates one run.

### 9.5 Destination port implemented by Stage 4

Stage 3 does not implement destination mutation, OAuth, Picker, or file health.
It defines and consumes the following validated port. Stage 3 uses a contract
fake so it can complete independently; Stage 4 supplies the production Google
adapter without changing the interface:

```ts
interface ValidatedReportingDestinationSnapshotV1 {
  contractVersion: 1;
  destinationId: string;
  provider: "google_sheets";
  driveConnectionId: string;
  ownerIdentitySnapshot: { stableOwnerId: string; maskedEmail: string };
  folder: { id: string; name: string; url: string };
  strategy: "replace_tab" | "snapshot";
  workbook?: { id: string; name: string; url: string };
  managedTab?: { immutableSheetId: number; name: string; managed: true };
  destinationType: string;
  ownershipPolicy: string;
  accessStatus: "verified";
  healthVerifiedAt: string;
  archived: false;
  safety: {
    denylistCheckedAt: string;
    operationalWorkbookMatch: false;
    humanCreatedTabTakeover: false;
  };
  capacity: {
    providerMaxCells: number;
    destinationAvailableCells: number;
  };
  snapshotChecksum: string;
}
```

Preview and run preparation reject stale/unverified/archived destinations,
checksum mismatch, strategy mismatch, capacity insufficiency, any operational
workbook match, or any non-managed replace target. Stage 4 remains responsible
for checking all ingestion workbooks (including both Best Relocation inputs),
Master Leads, Master Booked, every configured Sheet Sync target, and every
other operational projection workbook with no owner override.

### 9.6 Retention and PII

Retain indefinitely definitions, immutable revisions, run metadata, checksums,
verification metadata supplied later by Stage 4, actors, and timestamps. Apply
short TTLs to preview samples and temporary manifests. Never persist complete
report row artifacts in Mongo.

Logs/audits contain IDs, enum codes, counts, dimensions, checksums, timing, and
redacted failure paths only. They must not contain customer names, phone
numbers, emails, ZIP/address data, move dates tied to identity, sample rows,
OAuth tokens, raw query results, or destination credentials.

## 10. Validation, preview, revision, and run flow

### 10.1 Validate draft

1. Authorize owner mutation; admins are read-only.
2. Resolve an enabled code-defined dataset and exact schema version.
3. Reject historical/combined scope and all unknown properties.
4. Validate timezone and date-window shape.
5. Validate Registry hierarchy and capture key/label snapshots.
6. Validate only dataset-declared filters, columns, owner labels, ordering,
   sort, and strategy.
7. Fetch/validate a destination snapshot and checksum through the Stage 3-owned
   destination port; Stage 4 provides its production adapter.
8. Canonically serialize the validated draft and compute `draft_checksum`.

Use typed reason codes including:

- `dataset_disabled`;
- `dataset_schema_version_unavailable`;
- `invalid_filter`;
- `invalid_registry_selection`;
- `invalid_date_window`;
- `invalid_timezone`;
- `invalid_column`;
- `invalid_sort`;
- `forbidden_export_field`;
- `destination_unverified`;
- `destination_unsafe`;
- `destination_strategy_mismatch`.

### 10.2 Preview

For the exact draft checksum:

1. re-run validation;
2. capture a preview `source_read_through`;
3. resolve explicit UTC boundaries;
4. calculate exact row count, or an explicit safe bound when exact counting
   cannot finish within the preview budget;
5. calculate projected columns and cells, including one header row;
6. compare against actual provider and destination capacity;
7. estimate query pages, write batches, and large-delivery risk;
8. obtain exactly up to 50 rows from the canonical ordered query;
9. describe intended changes: snapshot workbook creation or managed-tab
   replacement, never a human-created tab;
10. identify selected PII column IDs and destination ownership;
11. emit typed warnings with non-PII parameters; and
12. compute a preview checksum tied to the validated draft, estimates,
    destination snapshot, source read-through, and sample checksum.

Never silently truncate. If projected cells exceed either destination capacity
or provider limits, return a blocking `destination_capacity_exceeded` result
with projected rows/columns/cells, applicable limit, and remediation. A bounded
count whose upper bound could exceed capacity cannot be approved until an exact
count or safe upper bound proves it fits.

### 10.3 Save immutable revision

Require an unexpired preview whose `draft_checksum`, destination checksum, and
preview checksum match the submitted draft. In one transaction or equivalent
safe sequence:

1. create/validate the stable definition if new;
2. allocate the next revision number;
3. insert the immutable revision;
4. compute/store its canonical snapshot checksum;
5. advance `current_revision_id`; and
6. audit revision creation without PII.

Editing any dataset, filter, date window, timezone, Registry selection,
column/label/order, sort, destination, or strategy creates another revision.
Never update a revision already referenced by a run.

### 10.4 Prepare manual run

For first delivery, require explicit owner confirmation bound to revision ID,
revision checksum, preview checksum, warnings, capacity, and intended changes.
For later runs of the unchanged revision, generate and return a fresh
volume/warning estimate first, then require confirmation bound to that estimate.
Confirmation is append-only evidence on the resulting `ReportingRun` and audit
event; it never updates the immutable revision.

On confirmation:

1. revalidate owner authorization, definition/revision state, dataset
   enablement/schema, destination snapshot, and capacity;
2. resolve a fresh window if rolling;
3. capture fresh estimate/warnings and intended changes;
4. create one idempotent `queued` run with trigger `manual`;
5. freeze revision/query-input/destination checksums and expected stream
   ordering; the final query-plan checksum is computed only after the Stage 4
   worker captures `source_read_through`;
6. audit the request; and
7. return `202 Accepted` immediately.

No query streaming or Google write runs inside the request.

## 11. Stage 3 APIs

All routes use existing trusted admin-proxy actor conventions. Owner may write;
admin may read catalog, definitions, redacted preview metadata/samples subject
to existing data access, and run history. Admin cannot preview on behalf of the
owner, create/revise/archive definitions, or prepare a run.

### 11.1 Catalog

`GET /api/v1/admin/reporting/catalog`

Returns only enabled datasets and their exact schema versions, grain/date
semantics, filter schemas/options, columns/default labels/types/sensitivity,
measures, allowed/default sorts, default timezone, manual-only capability, and
preview limits. It returns no arbitrary query representation.

### 11.2 Definitions and revisions

- `GET /api/v1/admin/reporting/definitions`
- `POST /api/v1/admin/reporting/definitions`
- `GET /api/v1/admin/reporting/definitions/:id`
- `POST /api/v1/admin/reporting/definitions/:id/revisions`
- `POST /api/v1/admin/reporting/definitions/:id/clone`
- `DELETE /api/v1/admin/reporting/definitions/:id`

`DELETE` archives; it does not physically delete. Create/revise endpoints use
strict input schemas and require a valid preview token/checksum. Detail returns
revision history, immutable checksums, preview metadata, and destination
snapshot status but not credentials or persisted sample values. Clone creates
a draft, not an implicitly approved revision/run.

### 11.3 Preview

`POST /api/v1/admin/reporting/definitions/:id/preview`

Also support previewing a create draft through the create endpoint or a
dedicated draft identifier; do not require a mutable placeholder revision.
Response includes:

- draft and preview checksums;
- exact/bounded row count with bound kind;
- columns/cells and capacity;
- estimated query/write batches;
- up to 50 response-only sample rows;
- warnings and blocking reasons;
- intended changes;
- PII column IDs/sensitivity;
- destination ownership summary; and
- expiry.

### 11.4 Manual run preparation

`POST /api/v1/admin/reporting/definitions/:id/run`

Use a two-step protocol:

1. without confirmation, return the fresh estimate/warnings and a short-lived
   confirmation token bound to revision/destination/query checksums;
2. with that token and idempotency key, create one `queued` run and return
   `202 { runId, status: "queued" }`.

The run endpoint does not accept ad hoc filters, columns, destination, strategy,
or scope. It accepts only the immutable current/explicit revision ID and valid
confirmation evidence.

Read APIs needed by this stage:

- `GET /api/v1/admin/reporting/runs`
- `GET /api/v1/admin/reporting/runs/:id`

Cancellation and destination/OAuth/Picker APIs are implemented in Stage 4.

## 12. Reporting-core admin builder contract

Stage 3 supplies typed API data/client helpers and the core builder state
contract. Stage 4 may supply destination management and final visual treatment.

Builder steps:

1. dataset — enabled catalog item with visible grain/date semantics;
2. cohort window — explicit/rolling window and IANA timezone;
3. sources — hierarchical Source Company, then optional child Granularity
   selector using existing Operations Registry controls;
4. filters — render only the selected dataset's declared filters;
5. columns — vetted list only; remove/relabel/reorder, display PII badges;
6. ordering — catalog allowlist plus visible deterministic tie-breaker note;
7. destination/strategy — select only a snapshot validated through the
   Stage 3-owned destination port;
8. preview — volume, 50 rows, warnings, intended changes, PII/ownership,
   capacity, and blocking reasons; and
9. save/confirm — immutable revision, then explicit first-delivery confirmation.

Changing any earlier step invalidates preview and confirmation checksums.
Disabled datasets remain visible only on historical revision detail with an
unavailable reason. The builder has no schedule, raw field, join, Mongo,
historical scope, or arbitrary expression control.

Read-only admin views may show redacted preview metadata/sample according to
existing access policy, revision history, checksums, estimates, and run status.
Only owner controls enable create, revise, clone, archive, preview, and run.

## 13. Ordered, reviewable work packages

### WP3.1 — Catalog and configuration

- Add dataset/filter/column/measure/sensitivity types.
- Add the three `@1` contracts and exhaustive compile-time tests.
- Parse/default/validate `REPORTING_ENABLED_DATASETS`.
- Add the catalog service and endpoint.
- Prove no environment-defined query behavior and no database-scope input.

Review boundary: no Mongo aggregation or persistence.

### WP3.2 — Time and Registry validation

- Implement IANA/local/UTC boundary conversion and half-open predicates.
- Implement date-only inclusive-end normalization.
- Validate hierarchical Registry keys and capture label snapshots.
- Define strict filter schemas for each dataset.
- Add DST, hierarchy, unknown-property, and unsupported-filter tests.

Review boundary: pure validation and boundary helpers.

### WP3.3 — Canonical lead outcome query

- Build normalized form/call lead cohort branches.
- Add production-only Registry filtering and left outcome joins.
- Collapse multiple bookings to one lead row with deterministic primary booking.
- Map every vetted column and `not_applicable` quoted state.
- Add keyset pagination, sorts, cursor codec, estimation, and 50-row sample.

Review boundary: `lead_outcome_detail@1` passes acceptance tests 3, 5, 6, and 7.

### WP3.4 — Exceptions and source performance queries

- Implement all eight exception projections without exposing raw evidence.
- After owner/domain approval updates the authoritative specification, implement
  source/time grains and all fourteen measures with the approved
  multiple-booking, financial aggregation, and zero-denominator semantics.
- Reuse the lead-cohort normalization from WP3.3; do not fork semantics.
- Add deterministic group ordering/cursors and measure fixtures.

Review boundary: `lead_quality_exceptions@1` and
`source_performance@1` pass acceptance test 8. `source_performance@1` cannot
leave this work package while the semantic approval remains unresolved.

### WP3.5 — Definition/revision persistence

- Add definition, immutable revision, and preview models/repositories/indexes.
- Add canonical snapshot checksums and revision allocation.
- Add destination contract adapter for Stage 4.
- Add create/revise/clone/archive/read services and audit events.
- Prove old revisions and run snapshots cannot mutate.

Review boundary: acceptance test 9 passes before run creation.

### WP3.6 — Preview and capacity

- Make estimate/sample use the canonical query path.
- Compute columns/cells, batches, warnings, intended changes, sensitivity,
  destination capacity, and preview checksum.
- Add TTL-only preview metadata and response-only samples.
- Reject uncertain/over-capacity output; never truncate.

Review boundary: preview steps 1–9 are independently testable without Google.

### WP3.7 — Manual run preparation and handoff

- Add `ReportingRun` model, indexes, transition boundary, and idempotent create.
- Implement fresh estimate/confirmation protocol.
- Freeze query inputs, ordering, input checksums, and destination snapshot;
  leave source read-through unset for the Stage 4 worker's one-time capture.
- Publish the Stage 4 execution interface and contract tests.

Review boundary: endpoint returns immediately with one queued run.

### WP3.8 — Admin builder integration

- Add typed reporting API clients and catalog-driven builder state.
- Integrate Operations Registry source controls.
- Render filters/columns/PII badges/preview/capacity/confirmation.
- Enforce owner-write/admin-read behavior in UI and server.

Review boundary: builder cannot express anything outside the versioned contract.

## 14. Likely files

New server files:

- `src/config/domain/reporting.ts`
- `src/services/reporting/catalog/types.ts`
- `src/services/reporting/catalog/index.ts`
- `src/services/reporting/datasets/leadOutcomeDetail.ts`
- `src/services/reporting/datasets/leadQualityExceptions.ts`
- `src/services/reporting/datasets/sourcePerformance.ts`
- `src/services/reporting/query/canonicalLeadCohort.ts`
- `src/services/reporting/query/pagination.ts`
- `src/services/reporting/query/checksums.ts`
- `src/services/reporting/timezone.ts`
- `src/services/reporting/registryFilters.ts`
- `src/services/reporting/definitions.service.ts`
- `src/services/reporting/preview.service.ts`
- `src/services/reporting/runPreparation.service.ts`
- `src/services/reporting/destinationContract.ts`
- `src/validation/reporting.validation.ts`
- `src/models/ReportingDefinition.ts`
- `src/models/ReportingDefinitionRevision.ts`
- `src/models/ReportingPreview.ts`
- `src/models/ReportingRun.ts`
- `src/routes/reporting.routes.ts`

Existing server files to integrate/refactor:

- `src/app.ts`
- `src/services/analytics/analyticsFilters.ts`
- `src/services/analytics/analytics.service.ts`
- `src/services/analytics/agentSalesReport.service.ts`
- `src/services/admin/adminBrowse.service.ts`
- `src/services/operationsRegistry/`
- Stage 1 actor/checksum/audit/run/lease helpers.

Use `scripts/test-create-google-spreadsheet.ts` only as fixture/evidence for
capacity and intended-change language; it is not the production query module.

Likely admin files:

- `vantage-admin/lib/api/reporting.ts`
- reporting definition list/detail/builder/preview components and routes;
- `vantage-admin/components/operations-registry/`
- `vantage-admin/server/auth/authorization.ts`
- `vantage-admin/app/api/proxy/[...path]/route.ts`

Stage 4 owns changes under `src/services/googleDriveOAuth/`, OAuth/Picker owner
settings, destination manager, Google worker/queue consumer,
`ReportingDestination`, `ReportingDelivery`, and artifact UI.

## 15. Tests and acceptance gates

The first nine tests below map exactly to source section 35 acceptance items
1–9. Use fixture records spanning form/call leads, booked/unbooked leads,
cancelled/refunded outcomes, Registry hierarchy, unresolved CPL, and anomalies.

1. **Dataset/filter/column validation:** every valid catalog combination passes;
   unknown dataset/schema/filter/column/sort, forbidden export fields, disabled
   datasets, arbitrary scope/query input, and invalid labels fail closed.
2. **Hierarchical source filters:** company-only selects all of its
   granularities; selected child granularities narrow only their parent;
   mismatched/orphan keys reject; label changes do not change old revision keys
   or snapshots.
3. **Lead cohort `[from, to)`:** include exactly `from`, exclude exactly `to`,
   select by canonical lead timestamp, and attach an outcome after `to`.
4. **New York DST conversion:** prove UTC boundaries and row selection for
   23-hour spring-forward and 25-hour fall-back local days, plus inclusive UI
   end conversion to next local midnight.
5. **All leads retained:** outcome left joins retain form/call leads with no
   booking or cancellation under default filters.
6. **No multiple-booking duplication:** a lead with multiple bookings yields
   one detail row, correct booking count, deterministic primary/current summary,
   and one quality exception.
7. **Call quote not applicable:** detail output uses `not_applicable`; aggregate
   quoted-form measure excludes call leads and never counts them false.
8. **Source funnel measures:** verify all fourteen measures, granularity/time
   grouping, distinct lead semantics, the owner/domain-approved
   multiple-booking financial and zero-denominator semantics, CPL resolution,
   and absence of profit/revenue/ROI. This test is blocked until those semantics
   are recorded in the authoritative specification.
9. **Immutable revisions/run snapshots:** every edit creates a new revision;
   old checksum/content cannot update; a queued run retains the exact old
   revision/destination/query checksums after the definition advances.

Additional Stage 3 boundary tests:

10. exactly up to 50 sample rows use the same mapper/order as the stream;
11. exact/bounded estimates identify their kind and uncertain capacity blocks;
12. projected capacity includes headers and over-limit output rejects without
    truncation;
13. keyset pagination covers every row exactly once across pages and resume;
14. stable ordering and canonical serialization produce deterministic page,
    preview, query-plan, revision, and data checksums;
15. source-read-through plus the candidate version/fingerprint fence prevents
    later inserts or concurrent updates from shifting or changing an active
    stream; detected changes fail the current run, and only a new run may
    capture a fresh read-through;
16. first delivery requires confirmation; later unchanged runs require a fresh
    estimate/confirmation;
17. duplicate run requests with one idempotency key produce one queued run;
18. owner can mutate, admin can only read allowed redacted data;
19. logs, audit payloads, failures, warnings, and persisted preview metadata
    contain no customer PII or sample values;
20. destination contract rejects unverified, archived, stale, unsafe,
    strategy-mismatched, human-tab, and checksum-mismatched snapshots;
21. the API returns `202` without streaming the query or invoking Google; and
22. disabled datasets leave historical revisions readable but not runnable.

Unit tests cover pure contracts, time conversion, cursor/checksum behavior, and
measures. Mongo integration tests cover real aggregation, indexes, immutability,
transactions, pagination, snapshots, and authorization. API tests cover strict
schemas, preview response/redaction, confirmation, and immediate run creation.
Stage 4 adds live owner-OAuth Google integration, staging/promotion, cleanup,
and delivery acceptance tests 10–19 from source section 35.

## 16. Exit criteria

Stage 3 is complete when:

- all three `@1` dataset contracts are code-defined, enabled by the deployment
  allowlist, catalog-visible, and production-only;
- every listed grain, date semantic, detail column, exception type, dimension,
  measure, filter, sort, sensitivity, and forbidden inference/export is tested;
- all ranges are half-open and New York DST tests pass;
- canonical query sample/stream paths use deterministic keyset pagination,
  source read-through, and checksums;
- preview performs all nine required steps, returns up to 50 deterministically
  representative rows, records no PII samples, and blocks
  uncertain/over-capacity output without truncation;
- definitions revise immutably and queued runs freeze exact revision/query/
  destination checksums;
- owner-write/admin-read authorization is enforced server-side;
- manual run preparation is idempotent, durable, and returns immediately;
- acceptance tests 1–9 and all Stage 3 boundary tests pass; and
- the Stage 4 handoff package below is published as executable TypeScript
  contracts plus fixture-based contract tests.

## 17. Explicit handoff package to Stage 4

Stage 3 must deliver one versioned `ReportingExecutionPackageV1` per queued run:

```ts
interface ReportingExecutionPackageV1 {
  contractVersion: 1;
  runId: string;
  definitionId: string;
  revisionId: string;
  revisionNumber: number;
  revisionSnapshotChecksum: string;
  dataset: { key: DatasetKey; schemaVersion: 1; grain: string };
  resolvedWindow: {
    timezone: string;
    fromUtc: string;
    toExclusiveUtc: string;
  };
  queryInputChecksum: string;
  sourceReadThroughCapture: "stage_4_worker_before_query";
  stream: {
    selectedColumns: Array<{
      id: string;
      label: string;
      type: ScalarType;
      sensitivity: Sensitivity;
    }>;
    effectiveSort: Array<{ id: string; direction: "asc" | "desc" }>;
    cursorVersion: 1;
    pageSize: number;
    resumeCursor: string | null;
    checksumAlgorithm: "sha256";
  };
  estimate: {
    kind: "exact" | "upper_bound";
    rows: number;
    columns: number;
    cellsIncludingHeader: number;
    queryPages: number;
    writeBatches: number;
    generatedAt: string;
  };
  preview: {
    previewChecksum: string;
    sampleCount: number;
    sampleChecksum: string;
    warnings: Array<{ code: string; parameters: Record<string, number | string> }>;
    intendedChanges: IntendedDestinationChangesV1;
  };
  sensitivity: {
    highest: Sensitivity;
    piiColumnIds: string[];
    destinationOwnership: string;
  };
  destination: ValidatedReportingDestinationSnapshotV1;
  acceptance: DeliveryAcceptanceRulesV1;
}
```

The package must include or make available through a versioned service:

- validated immutable revision and destination snapshots;
- exact stream column order and header labels;
- deterministic sort terms, cursor codec/version, page size, and resume cursor;
- canonical row encoding and incremental SHA-256 checksum algorithm;
- revision, destination, query-input, preview, sample, page, and final data
  checksum expectations, plus the Stage 3 function for deriving the final
  query-plan checksum after Stage 4 supplies the captured read-through;
- exact/bounded volume, columns, cells including header, page/batch estimates,
  and capacity margin;
- the response-only 50-row sample path, non-PII sample checksum, and warnings;
- selected sensitivity metadata, PII column IDs, and ownership classification;
- snapshot versus managed replace-tab intended changes; and
- these acceptance/rejection rules.

Stage 4 must accept a package only when:

1. contract, cursor, dataset, and schema versions are supported;
2. run is `queued`, leaseable, manual, and references the same immutable
   revision checksum;
3. destination is verified, unarchived, safe, strategy-compatible, and its
   checksum still matches;
4. dataset remains deployment-enabled;
5. estimate/capacity remains valid or a fresh pre-write check still fits;
6. selected headers/columns match the revision exactly;
7. deterministic ordering is fixed and `source_read_through` is still unset so
   Stage 4 can capture it exactly once before querying;
8. first-delivery/fresh-run confirmation evidence is present; and
9. no blocking warning or forbidden sensitivity/destination combination exists.

Stage 4 must reject before writing when any check fails, recording a structured
non-PII failure. During delivery it must reject checksum/cursor discontinuity,
schema/header drift, row/cell count mismatch, capacity change, destination
ownership/safety change, or unsupported contract version. It must never
silently drop rows, reorder rows, rename columns, reinterpret filters, switch
destinations, or mutate the revision. Stage 4 owns bounded Google batches,
checkpoint persistence, retries, verification, promotion/cleanup, and final
`ReportingDelivery`.

## 18. Source-section traceability

| Source section | Stage 3 implementation ownership |
| --- | --- |
| §21 | Owner reporting outcome through manual run preparation; explicit manual-only v1 exclusions |
| §23 | Complete three-dataset catalog, grains, dates, columns, exception types, measures, sensitivity/versioning, deployment allowlist |
| §24 | Hierarchical Registry source filters, stable keys/label snapshots, dataset-only optional filters, query consolidation |
| §25 | Explicit IANA timezone, UTC Mongo dates, display conversion, DST, half-open ranges |
| §26 | Definition, immutable revision, run/preview persistence; validated destination contract; delivery metadata handed to Stage 4 |
| §28 | All nine preview steps, first-delivery confirmation, fresh later estimate, capacity/no truncation |
| §29 | Run-now validation/queue preparation and deterministic stream/pagination/checksum contract; Stage 4 owns the one-time worker capture of source read-through |
| §32 | Catalog, definition, preview, run preparation, and read APIs; destination/cancel/OAuth APIs deferred to Stage 4 |
| §33 | Catalog-driven owner builder and read-only admin reporting-core contract |
| §35 | Acceptance tests 1–9 plus capacity, deterministic stream, authorization, and PII/logging constraints |
| §§36–38 | Reporting service/models/routes/admin files, consolidated analytics concepts, Stage 1 patterns |

Any implementation conflict is resolved in favor of the source specification.
This document partitions ownership; it does not weaken cross-stage invariants.
