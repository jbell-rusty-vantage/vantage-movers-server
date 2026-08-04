# Best Relocation Stage 2: Application-Owned Ingestion

Status: implementation plan  
Source of truth: `docs/current_plans/best-relocation-ingestion-and-reporting-projection-spec.md`  
Owned source scope: Part A, sections 5-20, plus ingestion-specific sections 36-39  
Default business timezone: `America/New_York`

## 1. Stage purpose and sequencing

This stage replaces the existing CLI/local Best Relocation migration orchestration
with an application-owned, idempotent, leased, observable ingestion pipeline. It
retains the hardened parsing and matching assets, adds durable source receipts and
conflicts, applies through canonical in-process domain commands, and activates only
after bootstrap approval and three production-data dry runs.

Stage 2 consumes the shared conventions delivered by
`best-relocation-stage-1-shared-foundations.md`.

Stage 2 can execute in parallel with
`best-relocation-stage-3-reporting-core.md` after Stage 1 contracts are stable.
Scheduled ingestion must not wait for reporting. The two Modules may reuse shared
run, lease, actor, checksum, audit, queue, and provider conventions, but they must
not share source/destination records, Google identities, permissions, or business
rules accidentally.

Stage 2 contributes its two ingestion-workbook registrations to Stage 1's
authoritative operational-workbook registry.
`best-relocation-stage-4-google-delivery-and-rollout.md` consumes that unified
registry so reporting destinations denylist every ingestion and operational
workbook.

## 2. Entry criteria and Stage 1 inputs

Implementation begins only after the Stage 1 handoff has been accepted. Stage 2
must not land provisional copies of shared primitives while Stage 1 is in flight.
Before any Stage 2 work package starts,
`best-relocation-stage-1-shared-foundations.md` must provide and Stage 2 must
accept:

1. a durable run convention with explicit legal transitions, timestamps, actor,
   trigger, structured failure/skip reasons, counters, and checkpoints;
2. an atomic Mongo lease API with owner, expiry, acquire, renew, release, and
   stale-owner protection, based on `SheetSyncLease` and Sheet Sync drainer
   patterns;
3. immutable canonical serialization/checksum helpers suitable for plans;
4. trusted human and system actor shapes plus audit-event conventions;
5. queue/worker wake-up and idempotent consumer conventions;
6. structured operational-event and incident interfaces;
7. secret-safe provider error normalization and log redaction;
8. time/clock injection and half-open interval helpers;
9. common repository model/index and API error conventions; and
10. a documented compatibility/version policy for shared run and lease records.

Acceptance rule: Stage 2 imports or adapts these contracts at a narrow boundary and
adds ingestion-specific fields through composition or typed extension. It rejects
Stage 1 output if acquiring the same logical lease can produce two valid owners, a
run can move backward or mutate a completed plan, checksums are nondeterministic,
actors are optional on mutations, or audit/provider payloads can expose secrets or
PII.

Stage 2 does not require Stage 3 or Stage 4 code to begin scheduled ingestion.

## 3. Scope

Stage 2 owns:

- source inspection and bounded reads from the two official Best Relocation
  workbooks;
- cutoff, tab, header, formula-health, and source identity enforcement;
- the thin generic ingestion execution kernel;
- the Best Relocation adapter, planner, immutable plan, and apply executor;
- bootstrap adoption of records created by the prior import;
- durable connection, run, receipt, conflict, checkpoint, and lease state;
- mapping adapter plans to, and invoking, the canonical lead, booking,
  cancellation, and booking-reconciliation commands owned by Stage 1;
- preview, approval, manual run, schedule heartbeat, and durable worker execution;
- owner mutation and admin read-only APIs/UI;
- conflict review and booking-reconciliation integration;
- alerts, health, production dry runs, activation, and rollback;
- CLI compatibility as a diagnostic front end to the same adapter/planner; and
- the ingestion-workbook registration contract consumed by Stage 4 denylisting.

## 4. Non-goals

This stage does not:

- merge historical and production databases;
- union historical data into ingestion or reporting;
- ingest observations before `2026-04-30` through the recurring adapter;
- add the future dashboard default that suppresses records before `2026-04-30`;
- implement a general ingestion designer or arbitrary schema-mapping UI;
- make source sheets or generated sheets canonical;
- let owners edit the fixed cutoff;
- use `LID_BestRelo` as an independent source stream;
- implement report datasets, owner OAuth, Picker, report destinations, or report
  delivery;
- perform recurring ingestion by calling the deployment's public HTTP API;
- write canonical Mongoose models directly from ingestion workers;
- automatically delete canonical records when source rows disappear; or
- silently guess ambiguous lead, booking, or refund relationships.

## 5. Non-negotiable invariants

1. MongoDB is canonical. Source workbooks contain external observations only.
2. Preview mutates neither canonical data nor destination workbooks. A preview may
   not repair hidden IDs; identity repair requires an explicitly leased inspection
   or apply/bootstrap flow.
3. Apply executes exactly one immutable plan identified by a deterministic
   checksum. Planning inputs, source read-through, adapter version, and source
   snapshots cannot change after approval.
4. Every canonical mutation records actor, source/run provenance, timing, command,
   and outcome.
5. Row number is provenance only, never source identity.
6. Retries, row reordering, concurrent triggers, and repeated reads cannot
   duplicate business records or source receipts for identical evidence.
7. The ingestion service account and owner-reporting OAuth identity remain
   separate trust boundaries.
8. Only one applying Best Relocation run holds the adapter apply lease.
9. Structural failures abort before any canonical mutation.
10. Row-level failures after plan validation are isolated only where dependency
    ordering permits and are resumable from durable checkpoints/receipts.
11. A source edit can update only source-owned allowlisted fields under a
    three-way comparison. Canonical divergence creates a conflict.
12. Source disappearance never deletes or soft-deletes canonical data.
13. Valid unmatched bookings become explicit leadless/unresolved bookings plus
    reconciliation conflicts; they are never silently skipped.
14. Unmatched refunds become conflicts and never cancel a guessed booking.
15. Environment variables are deployment gates or credential/configuration
    inputs. Cadence and active owner intent are application records.
16. The dashboard cannot bypass a false environment hard gate.
17. No run reads beyond its captured `source_read_through`.
18. Scheduled ingestion does not depend on Stage 3 reporting availability.

## 6. Authoritative sources and read contract

### 6.1 Lead observations

Workbook ID env reference: `BEST_RELOCATION_SYNC_SHEET_ID`.

Authoritative tabs:

- `Forms`;
- `Local Forms`;
- `Calls`.

Only source observations timestamped on or after local midnight
`2026-04-30 America/New_York` are eligible.

### 6.2 Booking and cancellation observations

Workbook ID env reference:
`BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID`.

Authoritative tabs:

- `Booked Deals` for bookings;
- `Refunds` for cancellations/refunds.

Only source observations timestamped on or after local midnight
`2026-04-30 America/New_York` are eligible.

### 6.3 `LID_BestRelo`

`LID_BestRelo` is derived matching/enrichment evidence projected from `Booked
Deals`. It is not an independent dataset, receives no `SourceRowReceipt`, and
cannot directly create or update canonical records. Inspection must nevertheless
validate its expected tab/schema/formula health because matching may depend on it.
Any drift appears in inspection health and can block apply when it invalidates
matching assumptions.

### 6.4 Fixed cutoff and immutable read-through

The cutoff is a versioned Best Relocation adapter invariant:

```text
cutoff = 2026-04-30T00:00:00 in America/New_York
window = [cutoff, source_read_through)
```

Each run captures one `source_read_through` before reading any workbook and stores
it in the immutable run/plan snapshot. Every authoritative stream uses that same
upper bound. Because rows may be edited or reordered, every run scans bounded
source data; timestamps alone are not an incremental cursor. Stable source
identity plus a normalized source-owned content hash determines unchanged rows.

## 7. Environment and Google access contract

Production runtime requires:

```dotenv
BEST_RELOCATION_SYNC_SHEET_ID=
BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID=
BEST_RELOCATION_INGEST_ENABLED=false
CRON_SECRET=

GOOGLE_SERVICE_ACCOUNT_JSON=
# or GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=
# local development only:
SERVICE_ACCOUNT_LOCAL_FILE=
```

Rules:

- both official workbook IDs are mandatory for the application path;
- remove hardcoded production workbook fallbacks from
  `src/services/bestRelocationSheetIngest/sheets.ts`;
- `BACKFILL_BEST_RELOCATION_SHEET_ID` and `BACKFILL_BOOKED_SHEET_ID` may remain
  only as short-lived CLI aliases and must emit deprecation warnings;
- `BEST_RELOCATION_INGEST_ENABLED` defaults to false and is a deployment-level
  hard gate;
- connection `application_enabled`, `cadence_hours`, and `next_due_at` live in
  Mongo, not env;
- the dashboard displays the env gate read-only and cannot override it; and
- credentials remain in env and are never copied to Mongo, API payloads, logs, or
  audit metadata.

The existing readonly Sheets scope must be narrowedly expanded to permit reading
cells and writing only the managed `vantage_ingestion_id` column in the two
configured input workbooks. The service account must be an editor of those two
workbooks. It does not require Drive-wide access. Stage 2 must not reuse owner
OAuth credentials introduced for reporting.

## 8. Architecture and ownership boundaries

### 8.1 Thin generic kernel

The kernel exposes a small typed adapter contract:

```ts
interface IngestionAdapter<TObservation, TPlan> {
  key: string;
  schemaVersion: number;
  inspect(input: IngestionInspectInput): Promise<IngestionInspection>;
  read(input: IngestionReadInput): AsyncIterable<TObservation>;
  plan(input: IngestionPlanInput<TObservation>): Promise<TPlan>;
  apply(input: IngestionApplyInput<TPlan>): Promise<IngestionApplyResult>;
}
```

The kernel owns:

- durable run creation and legal status transitions;
- immutable plan serialization and checksum verification;
- lease acquisition, renewal, ownership checks, and release;
- source receipt lookup and append-only persistence;
- checkpoints, retry, and resume;
- actor/audit metadata;
- generic conflict persistence plumbing;
- structured counters and operational events; and
- queue/worker orchestration.

The kernel must remain ignorant of Lead, Booking, Cancellation, Operations
Registry attribution, booking reconciliation, and booking-collapse rules.

### 8.2 Best Relocation adapter

The adapter owns:

- workbook/tab/dataset interpretation;
- the fixed cutoff and New York timestamp parsing;
- source header aliases and schema profiles;
- stable source-row identity and hidden-ID repair;
- Best Relocation Source Company/Granularity attribution;
- normalization, lead/booking matching, booking collapse, and evidence;
- safe-update and conflict classification;
- dependency ordering; and
- mapping validated plan actions to canonical domain command inputs.

### 8.3 Canonical command boundary

Stage 1 extracts and owns the complete reusable in-process
`CanonicalDomainCommands` seam. Stage 2 imports that seam, maps validated adapter
plan actions to its command inputs, and invokes it. Workers do not call the public
API, write Lead, Booking, or Cancellation models directly, or add ingestion-only
variants of canonical commands.

System actor:

```text
actor_type: system
actor_id: best-relocation-ingestion
origin: external_sheet_ingestion
```

Commands must retain request/domain validation, Operations Registry attribution
and snapshots, booking import guards, transaction/outbox behavior, operational
audit events, and Sheet Sync side effects.

The command interface and context are exactly those accepted from Stage 1; Stage
2 must not widen or fork them. Stage 2 supplies the dedicated system actor,
deterministic idempotency key, run/source-receipt/connection provenance, and
canonical payload checksum. Workbook/tab/row and adapter/schema details remain
durable receipt/run provenance and can be resolved through the supplied
references. Existing validation, import guards, command ledger, transaction, and
outbox behavior remain authoritative.

## 9. Persistence, indexes, and retention

Model names may follow repository naming conventions, but their semantics and
indexes are required.

### 9.1 `ExternalDataConnection`

One non-secret connection record:

- `_id`;
- `key: "best_relocation"`;
- `provider: "google_sheets"`;
- env-key references for both official workbook IDs;
- resolved workbook titles and masked IDs for health display;
- `application_enabled`;
- `cadence_hours: 24 | 48`, default `24`;
- `next_due_at`;
- `last_checked_at`;
- `last_successful_run_at`;
- connection/schema/formula/identity-column health;
- created/updated actor and timestamps.

Indexes:

- unique `{ key: 1 }`;
- scheduler lookup `{ application_enabled: 1, next_due_at: 1 }`;
- health lookup `{ last_successful_run_at: 1 }`.

Resolved raw workbook IDs must be available to trusted server code for matching
and Stage 4 denylisting but exposed to UI only in masked form.

### 9.2 `IngestionRun`

Required fields:

- adapter key and schema version;
- trigger:
  `bootstrap | preview | manual | schedule | retry`;
- status:
  `queued | inspecting | planning | awaiting_approval | applying | completed |
  completed_with_errors | failed | skipped`;
- immutable source workbook IDs/titles and `source_read_through`;
- cutoff and timezone;
- immutable plan reference/snapshot and checksum;
- counters for read, out-of-scope, unchanged, creates, safe updates, conflicts,
  invalid rows, leadless bookings, cancellations, failures, and skips;
- dependency-group checkpoint/cursor;
- lease owner/expiry snapshot;
- actor;
- started/completed timestamps;
- structured failure/skip reason;
- bootstrap reconciliation totals and approval/disposition metadata where
  applicable.

Indexes:

- run history `{ adapterKey: 1, createdAt: -1 }`;
- queue claim `{ status: 1, createdAt: 1 }`;
- lease/recovery `{ adapterKey: 1, status: 1, "lease.expiresAt": 1 }`;
- unique plan checksum within an immutable run identity, without treating equal
  previews as the same run.

Plan data may be embedded or separately stored according to Stage 1 limits, but
must be immutable after `awaiting_approval` and addressable by run ID plus
checksum.

### 9.3 `SourceRowReceipt`

Append-only fields:

- connection and dataset key;
- stable source-row ID;
- normalized source-owned content hash;
- schema profile/version;
- workbook ID, tab ID/name, last observed row number, and range;
- first/last seen timestamps represented by immutable observation plus lookup
  metadata according to repository convention;
- ingestion run ID;
- parsed observation type;
- classification/outcome;
- resulting canonical model and IDs;
- last applied source-owned values for three-way comparison;
- matching method, confidence, and evidence references;
- source state, including `source_missing` when later absent.

Required unique index:

```text
connection + dataset + stableSourceRowId + schemaVersion + contentHash
```

Identical evidence is a no-op. Changed evidence appends a receipt; historical
evidence is never overwritten. If mutable lookup metadata such as `lastSeenAt`
is needed, keep it in a separate current-state projection or append a new
observation without violating receipt immutability.

Additional indexes:

- current-source history
  `{ connectionId: 1, datasetKey: 1, stableSourceRowId: 1, createdAt: -1 }`;
- canonical provenance `{ resultingCanonicalIds: 1 }`;
- missing-source scans `{ connectionId: 1, datasetKey: 1, sourceState: 1 }`;
- run detail `{ ingestionRunId: 1, classification: 1 }`.

### 9.4 `IngestionConflict`

Required fields:

- run and source receipt references;
- type:
  `ambiguous_lead_match | changed_protected_field |
  duplicate_source_identity | missing_source_row | schema_drift |
  unmatched_refund | canonical_divergence`;
- severity and status;
- source company/granularity keys and label snapshots;
- workbook/tab/row provenance;
- normalized source values and protected-value diff;
- ranked candidate IDs, scores, methods, and evidence;
- related canonical IDs;
- resolution/disposition;
- resolver actor and timestamp;
- origin `external_sheet_ingestion`.

Indexes:

- queue `{ status: 1, severity: 1, createdAt: 1 }`;
- run detail `{ runId: 1, type: 1 }`;
- source identity `{ connectionId: 1, datasetKey: 1, stableSourceRowId: 1 }`;
- reconciliation filtering `{ origin: 1, type: 1, status: 1 }`.

Booking-link conflicts must appear in the existing unified booking-reconciliation
workflow while remaining distinguishable from employee booking-form
reconciliation. The UI must expose origin, Best Relocation Source
Company/Granularity, run, workbook/tab/row, candidates, scores, methods, and
evidence.

### 9.5 Lease

Use the Stage 1 atomic lease abstraction implemented from:

- `src/models/SheetSyncLease.ts`;
- `src/services/sheetSync/drainer/leases.ts`.

Lease key: one adapter-wide applying key such as
`ingestion:best_relocation:apply`.

Only one applying run may own it. The worker renews before expiry and verifies
ownership before every mutation batch/checkpoint. Preview runs can execute
concurrently only when they do not write managed IDs. Inspection/bootstrap/apply
that repairs identity must acquire the write lease.

## 10. Run state machine

Legal primary transitions:

```text
queued
  -> inspecting
  -> planning
  -> awaiting_approval
  -> applying
       -> completed
       -> completed_with_errors
```

Additional terminal paths:

```text
queued|inspecting -> skipped
queued|inspecting|planning|awaiting_approval|applying -> failed
planning -> completed               # mutation-free preview
applying -> completed_with_errors    # isolated row failures remain
```

Rules:

- `preview` never enters `applying`;
- bootstrap ends at `awaiting_approval` until reconciliation discrepancies are
  resolved or explicitly dispositioned, then applies adoption receipts without
  replaying canonical writes;
- an approved manual/scheduled apply references the exact immutable plan checksum;
- retry creates or records trigger `retry`, resumes from durable checkpoints and
  receipts, and never resets successful outcomes;
- terminal states are immutable except append-only audit/incident linkage;
- disabled/not-due heartbeat handling records a cheap `skipped` result or updates
  scheduler health without reading Google;
- lease loss is a structured failure unless safe recovery can prove that no
  mutation proceeds under an invalid owner.

## 11. Stable source identity and hidden column

Preferred identities:

- form leads: durable source UUID/ref number;
- calls: immutable managed ID where no durable source key exists;
- bookings: normalized job number, plus managed ID for duplicate/anomalous cases;
- refunds: immutable managed ID, with associated booking/job number retained only
  as business evidence.

When no durable source key exists, Vantage writes a hidden
`vantage_ingestion_id` column once and never changes that value. Header discovery
uses aliases and/or managed metadata, not a fixed column letter.

Identity repair flow:

1. inspect headers and managed metadata;
2. acquire the adapter write lease;
3. re-read the target row/range under the run read-through;
4. generate a collision-resistant ID;
5. write only empty managed-ID cells;
6. read back and verify the exact value;
7. persist provenance/inspection result;
8. release or renew the lease as the enclosing run requires.

Duplicate IDs, copied IDs, or missing IDs that cannot be safely repaired produce
`duplicate_source_identity` or structural identity conflicts. They never fall
back to row number or fuzzy guessing. Reordering rows changes provenance only.

## 12. Planning and immutable action contract

Every in-scope observation is classified exactly once as:

1. unchanged/no-op;
2. canonical create;
3. allowlisted safe update;
4. leadless booking create plus reconciliation conflict;
5. conflict requiring review;
6. invalid source row; or
7. retryable provider/system failure.

Plan actions include stable source ID, content hash, schema profile/version,
source provenance, classification, canonical target or idempotency key, matching
evidence, expected last-applied source state, command payload, dependency group,
and protected-field diffs. The final plan includes source snapshots,
`source_read_through`, cutoff/timezone, counters, warnings, and a canonical
checksum.

Execution order is fixed:

1. form and call leads;
2. bookings;
3. reconciliation/link outcomes;
4. refunds/cancellations.

A failure in an earlier action blocks only dependent later actions. Independent
actions may continue after checkpointing. A checksum mismatch, changed plan,
changed source snapshot required for safety, or unsupported schema version aborts
before mutation and requires re-plan/re-approval.

## 13. Bootstrap adoption and approval gate

The first application-owned run uses trigger `bootstrap`:

1. read every in-scope authoritative source row;
2. normalize through the production adapter and derive normal idempotency keys;
3. deterministically link observations to canonical records created by the prior
   import;
4. plan receipt adoption of linked canonical IDs without canonical replay;
5. create conflicts for ambiguous, missing, duplicate, or divergent records;
6. produce count and financial reconciliation summaries;
7. persist the immutable bootstrap plan/checksum;
8. require owner/operator review and approval;
9. after all discrepancies are resolved or explicitly dispositioned, append
   adoption receipts only; and
10. record bootstrap completion on the connection.

Scheduled apply is prohibited until bootstrap completion. HTTP preflight skips or
a fresh replay without adoption receipts are not an acceptable baseline.

Approval is rejected when:

- a structural inspection is unhealthy;
- the plan checksum does not match;
- undispositioned blocking discrepancies remain;
- count or financial summaries are unexplained;
- duplicate/corrupt source identity remains unresolved;
- the actor lacks owner mutation authority; or
- the env hard gate is false for activation, though bootstrap preview/adoption
  behavior may be allowed according to explicit non-scheduled operator policy.

## 14. Three-way updates, protected fields, and deletions

An automatic update is legal only when all are true:

1. the canonical record originated from this Best Relocation ingestion;
2. the field path is on the adapter's source-owned allowlist; and
3. the current canonical value equals the value last applied by the adapter.

The implementation package must enumerate exact model paths after inspecting
current schemas. Initial candidate lead fields are normalized:

- customer name;
- phone;
- email;
- pickup/delivery geography;
- move date;
- move size;
- local/long-distance and move-description evidence.

Each path needs normalization, equality, null/empty, and conflict tests. No
candidate path is activated merely because it appears in this plan.

Protected by default:

- canonical IDs and source attribution;
- booked/cancelled workflow links;
- quoted/workflow state changed in Vantage;
- agent allocations;
- merchant;
- job-number identity;
- binder, deposit, refund, and all other financial values;
- audit, reconciliation, and Sheet Sync metadata.

When source changes but canonical no longer equals last-applied source state,
persist `canonical_divergence` or `changed_protected_field`; never overwrite
application work. Financial changes always require explicit owner disposition.

If a previously received source row disappears, append/project
`source_missing`, emit a warning or `missing_source_row` conflict, and preserve
the canonical record unchanged. Correction/deletion/cancellation must use the
canonical application workflow.

## 15. Matching calibration, leadless bookings, and refunds

Retain existing normalization, matching evidence, booking collapse, provenance,
and guarded idempotency from:

- `src/services/bestRelocationSheetIngest/parsing.ts`;
- `src/services/bestRelocationSheetIngest/matching.ts`;
- `src/services/bestRelocationSheetIngest/plan.ts`;
- `src/services/bestRelocationSheetIngest/apply.ts`;
- `src/services/bestRelocationSheetIngest/dryRun.ts`;
- `src/services/bestRelocationSheetIngest/types.ts`;
- `src/services/bestRelocationSheetIngest/bestRelocationSheetIngest.test.ts`;
- `scripts/best-relocation-sheet-ingest.ts`;
- `src/services/bestRelocationSheetIngest/HANDOFF.md`.

The historical `0.5` matching threshold is not approved for unattended
production. Build a reviewed calibration fixture from representative matches,
non-matches, ambiguous candidates, reordered rows, and `LID_BestRelo` evidence.
Choose a stricter auto-link threshold/margin and record method, score, runner-up
margin, evidence references, and calibration version in plans/receipts.

A valid booking without a confident lead:

1. executes an idempotent leadless/unresolved booking command;
2. opens exactly one reconciliation conflict with ranked candidates/evidence;
3. appears in the unified booking-reconciliation queue with
   `external_sheet_ingestion` origin; and
4. later attaches only through the canonical reconciliation command.

It is neither skipped nor guessed.

Refunds are recurring authoritative observations. A confident booking link
creates exactly one cancellation through the canonical command. An unlinked or
ambiguous refund creates `unmatched_refund` and never cancels a guessed booking.

## 16. Scheduler, heartbeat, queue, and worker

Add protected heartbeat:

```text
GET|POST /api/cron/best-relocation-ingest-heartbeat
Vercel schedule: 0 */6 * * *
Authentication: CRON_SECRET
```

The route performs only:

1. authenticate `CRON_SECRET`;
2. check `BEST_RELOCATION_INGEST_ENABLED`;
3. read connection state;
4. cheaply record skip/health when env-disabled, app-disabled, or not due;
5. atomically claim/advance `next_due_at`;
6. create one queued run with trigger `schedule`;
7. wake the dedicated ingestion consumer;
8. return without reading full workbooks or applying canonical mutations.

Owner cadence is `24` or `48` hours, default `24`. The six-hour heartbeat permits
timely retry and cadence changes without editing `vercel.json`.

The durable worker:

1. atomically claims a queued/retry run;
2. acquires and renews the adapter lease;
3. captures source IDs/titles and one `source_read_through`;
4. inspects required tabs, headers, formula health, cutoff parsing, and identity;
5. scans bounded source observations;
6. resolves receipts and creates the immutable plan/checksum;
7. stops for approval where required;
8. verifies the approved checksum and lease;
9. applies actions in dependency order through canonical commands;
10. persists receipt/conflict/outcome and checkpoint after each safe unit/batch;
11. renews/verifies lease throughout;
12. finalizes counters and `completed` or `completed_with_errors`;
13. updates connection health/timestamps;
14. emits incidents only when policy requires; and
15. safely releases the lease.

Follow:

- `vercel.json`;
- `src/routes/sheet-sync-cron.routes.ts`;
- `api/queues/sheet-sync-consumer.ts`;
- `src/services/sheetSync/drainer/runSheetSyncDrain.ts`.

## 17. Failure, checkpoint, and resume policy

Abort before canonical mutation on:

- Google authentication/access failure;
- required workbook or authoritative tab missing;
- unexpected required headers/schema version;
- cutoff or timestamp parsing failure;
- identity-column corruption;
- plan checksum failure;
- inability to obtain the apply lease;
- unapproved bootstrap/apply plan; or
- unsupported adapter/schema version.

After a validated immutable plan exists:

- isolate row-level errors by dependency group;
- do not execute actions whose prerequisites failed;
- checkpoint successful command and receipt outcomes;
- continue independent actions where safe;
- finish `completed_with_errors` when isolated failures remain;
- represent provider/system retryability explicitly; and
- resume from receipts and checkpoints without blindly replaying successful
  mutations.

Canonical commands and receipt insertion both require stable idempotency keys.
Recovery must tolerate a crash after canonical commit but before receipt/checkpoint
write by querying canonical provenance/idempotency outcome and adopting it rather
than issuing a duplicate command.

## 18. Roles, APIs, and control surface

### 18.1 Permissions

Owner may:

- view env hard-gate state;
- activate/deactivate application scheduling;
- choose 24- or 48-hour cadence;
- inspect workbook/schema/formula/identity health;
- run preview now;
- approve and run an immutable plan now;
- inspect and approve bootstrap status;
- inspect last/next run, counters, provenance, and row outcomes;
- resolve source-data conflicts; and
- enter canonical booking reconciliation for booking-link conflicts.

Admins have read-only connection, run, health, receipt/provenance, and conflict
visibility. They cannot activate, change cadence, apply, approve bootstrap, or
resolve mutations. The env hard gate is read-only for every dashboard role.

All mutations use existing trusted admin actor headers, owner authorization, and
audit conventions.

### 18.2 API contracts

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

Contract details:

- inspect returns masked source identity, access, required tabs, header/schema,
  formula, and managed-ID health; it never mutates unless an explicitly authorized
  repair mode acquires the write lease;
- preview returns run ID, immutable plan checksum, counters, warnings, samples,
  conflicts, and whether approval is required; it performs no canonical write;
- run accepts an approved run/plan ID and exact checksum, returns a queued durable
  run immediately, and is idempotent for repeated submissions;
- PATCH accepts only owner-controlled `application_enabled` and
  `cadence_hours`, never env state, workbook IDs, cutoff, or credentials;
- conflict resolution validates type-specific disposition and actor; booking
  attachment delegates to canonical reconciliation;
- list/detail endpoints redact credentials, raw PII-heavy payloads, and unmasked
  workbook IDs according to role.

### 18.3 Admin UI

Add an ingestion control/run/conflict surface under `vantage-admin`:

- env gate and application status;
- cadence and next due;
- source/schema/formula/identity health;
- bootstrap readiness, reconciliation summaries, conflicts, and approval;
- preview/run controls with immutable checksum confirmation;
- run history/detail with counters, checkpoints, failures, and row provenance;
- conflict queue/detail/resolution;
- links into unified booking reconciliation with origin filters.

UI visual treatment may evolve later, but permission, approval, immutable-plan,
run, and conflict behavior cannot change.

## 19. Alerts and health

Emit structured operational incidents/events for:

- structural run failure;
- stale successful ingestion;
- repeated row failures;
- parsed counts unexpectedly dropping to zero;
- schema or `LID_BestRelo` formula drift;
- trigger overlap or lease contention beyond a configured threshold;
- duplicate job/source identities;
- unmatched refunds;
- sharp conflict growth; and
- sharp leadless-booking growth.

Use the existing notification pipeline for failure, staleness, and conflict
spikes. Do not notify on routine success. Successful runs remain visible in
dashboard history. Alert payloads include run/connection IDs and safe counts, not
credentials or unnecessary customer PII.

## 20. Ordered reviewable work packages

### WP2.1 — Contract Stage 1 foundations

Dependencies: Stage 1 interfaces available.  
Changes:

- bind shared run, lease, checksum, actor, audit, queue, and event contracts;
- add ingestion-specific types without leaking Best Relocation rules into shared
  code;
- add contract tests for transition, checksum, and lease semantics.

Review gate: no duplicate shared primitive and no business-domain dependency in
the kernel.

### WP2.2 — Connection, run, receipt, conflict, and lease persistence

Dependencies: WP2.1.  
Changes:

- add models, validators, indexes, and migration/initialization behavior;
- seed/upsert the single `best_relocation` connection without credentials;
- implement append-only receipt and conflict repositories;
- implement legal run transitions and checkpoint storage.

Review gate: indexes prove duplicate identical evidence and concurrent apply are
prevented; terminal/plan immutability is tested.

### WP2.3 — Source provider and stable identity

Dependencies: WP2.2.  
Changes:

- remove production workbook fallbacks;
- enforce env references, official tabs, cutoff, common read-through, and scope;
- add least-privilege hidden-column write/read-back;
- add schema/header alias and `LID_BestRelo` formula-health inspection;
- preserve CLI aliases with warnings.

Review gate: row reorder and hidden-ID tests pass; preview cannot write IDs.

### WP2.4 — Thin kernel and Best Relocation adapter refactor

Dependencies: WP2.2-WP2.3.  
Changes:

- preserve parsing, normalization, provenance, matching, collapse, planning, and
  dependency logic;
- expose it through the typed adapter;
- implement exact classifications, receipt lookups, immutable plan serialization,
  checksums, and missing-source detection;
- make CLI invoke this same adapter/planner.

Review gate: no parallel CLI implementation; `LID_BestRelo` has evidence-only
type/API constraints.

### WP2.5 — Canonical command integration

Dependencies: WP2.1; can overlap WP2.3-WP2.4.  
Changes:

- import the accepted Stage 1 `CanonicalDomainCommands` seam without adding
  adapter-specific command variants;
- map plan actions into the existing lead, booking, cancellation, and canonical
  booking-reconciliation command inputs;
- supply the system actor, idempotency key, payload checksum, and
  source/run/receipt provenance;
- prohibit model-direct writes from the worker.

Review gate: Stage 1 command contract tests pass unchanged, existing HTTP behavior
remains compatible, and command-level idempotency is proven through the shared
ledger.

### WP2.6 — Update policy and matching calibration

Dependencies: WP2.4-WP2.5.  
Changes:

- enumerate exact source-owned model paths;
- implement three-way comparisons and protected-field conflicts;
- create reviewed matching calibration fixtures and threshold/margin policy;
- implement leadless booking plus unified reconciliation and unmatched refunds.

Review gate: no financial/protected automatic updates; historical `0.5` is not
used without calibration evidence.

### WP2.7 — Bootstrap and approval

Dependencies: WP2.2-WP2.6.  
Changes:

- deterministic prior-import adoption;
- count/financial reconciliation;
- discrepancy conflicts/dispositions;
- owner approval and scheduled-activation block;
- receipt-only bootstrap apply.

Review gate: no canonical replay and no schedule path before approved bootstrap.

### WP2.8 — Durable apply worker and resume

Dependencies: WP2.2-WP2.7.  
Changes:

- queue claim, lease renewal, dependency execution, checkpoints, and recovery;
- row-level isolation and `completed_with_errors`;
- crash-window recovery between canonical commit and receipt write;
- structured counters/events.

Review gate: partial resume and concurrent-trigger acceptance tests pass.

### WP2.9 — Heartbeat, cadence, and activation gates

Dependencies: WP2.8.  
Changes:

- cron route and `vercel.json` six-hour schedule;
- dual env/application gate and atomic `next_due_at` claim;
- cheap skip behavior;
- 24/48-hour cadence, default 24.

Review gate: route performs no workbook scan or canonical mutation.

### WP2.10 — APIs, owner/admin UI, and alerts

Dependencies: WP2.2, WP2.7-WP2.9.  
Changes:

- routes/controllers/validation/authorization;
- admin client and ingestion screens;
- conflict and reconciliation origin UI;
- health events and notification thresholds.

Review gate: owner-write/admin-read matrix and secret/PII redaction tests pass.

### WP2.11 — Production dry runs and activation

Dependencies: all prior packages.  
Changes:

- execute and archive evidence for three dry runs on different days;
- simulate retry/resume;
- disposition bootstrap conflicts;
- activate at 24 hours only after sign-off;
- document rollback and operational ownership.

Review gate: every gate in section 23 is evidenced, not merely checked manually
without retained run IDs/checksums.

## 21. Likely files

Retain/refactor:

- `src/services/bestRelocationSheetIngest/parsing.ts`;
- `src/services/bestRelocationSheetIngest/matching.ts`;
- `src/services/bestRelocationSheetIngest/plan.ts`;
- `src/services/bestRelocationSheetIngest/apply.ts`;
- `src/services/bestRelocationSheetIngest/dryRun.ts`;
- `src/services/bestRelocationSheetIngest/types.ts`;
- `src/services/bestRelocationSheetIngest/sheets.ts`;
- `src/services/bestRelocationSheetIngest/bestRelocationSheetIngest.test.ts`;
- `src/services/bestRelocationSheetIngest/HANDOFF.md`;
- `scripts/best-relocation-sheet-ingest.ts`.

New or repository-convention equivalents:

- `src/services/ingestion/` for the thin kernel;
- `src/models/ExternalDataConnection.ts`;
- `src/models/IngestionRun.ts`;
- `src/models/SourceRowReceipt.ts`;
- `src/models/IngestionConflict.ts`;
- ingestion lease/checkpoint model if not supplied generically by Stage 1;
- `src/routes/ingestion.routes.ts`;
- protected heartbeat route;
- dedicated ingestion queue consumer under `api/queues/`.

Canonical boundaries likely touched:

- `src/services/leads/formLead.service.ts`;
- `src/services/agents/agentAllocation.service.ts`;
- `src/services/bookings/bestRelocationImportGuard.ts`;
- lead, booking, cancellation, reconciliation, Operations Registry, audit, and
  Sheet Sync services;
- `src/validation/v1/leads.validation.ts`;
- `src/validation/v1/bookings.validation.ts`;
- `src/validation/v1/cancellations.validation.ts`;
- `src/services/sheetSync/sheetSyncCoordinator.ts`.

Infrastructure:

- `src/app.ts`;
- `vercel.json`;
- `src/services/observability/`;
- Sheet Sync lease/run/worker patterns.

Admin:

- `vantage-admin/server/auth/authorization.ts`;
- `vantage-admin/app/api/proxy/[...path]/route.ts`;
- `vantage-admin/lib/api/` ingestion client;
- ingestion connection/run/conflict pages and components;
- observational health surfaces;
- unified booking-reconciliation origin metadata and filters.

## 22. Exact automated acceptance tests

The implementation is not accepted until automated tests prove all 19 source
criteria:

1. Both lead and booking/refund windows begin at local midnight
   `2026-04-30 America/New_York`.
2. A row timestamped before cutoff never enters the plan.
3. Two identical runs create no additional canonical records or duplicate
   receipts for identical evidence.
4. Row reordering preserves stable identity and canonical linkage.
5. A generated hidden `vantage_ingestion_id` remains stable across reads/runs.
6. One newly appended lead creates exactly one lead.
7. One newly appended booking attaches exactly once.
8. A valid unmatched booking creates exactly one leadless booking and exactly one
   reconciliation conflict.
9. Resolving that conflict invokes canonical booking reconciliation and does not
   patch the booking directly.
10. A new linked refund creates exactly one cancellation.
11. Changed safe fields update only when all three-way allowlist conditions hold.
12. Changed protected or financial fields create conflicts and do not mutate
    canonical values.
13. A deleted/missing source row never deletes or soft-deletes canonical data.
14. Structural schema drift prevents apply before canonical mutation.
15. A partial run resumes from receipt/checkpoint state without duplication.
16. Concurrent triggers produce exactly one applying run/lease owner.
17. A false env gate and an application-disabled or not-due connection skip
    cheaply without reading Google.
18. Bootstrap adopts existing canonical records by receipts without replaying
    canonical writes.
19. `LID_BestRelo` can influence matching evidence but cannot create a receipt,
    source action, or canonical mutation.

Additional required contract coverage:

- plan checksum changes for any material input and blocks altered apply;
- lease expiry/renewal and stale-worker fencing;
- hidden-ID duplicate/copied/corrupt cases;
- exact source-owned path allowlist and null/normalization semantics;
- dependency blocking after a lead failure;
- crash recovery after canonical commit but before receipt persistence;
- owner-write/admin-read authorization;
- audit actor/provenance completeness;
- credentials and unnecessary PII absent from logs/events/API responses;
- all legal and illegal state transitions;
- unmatched refund conflict behavior;
- `completed_with_errors` counter/checkpoint accuracy;
- CLI and application planner parity.

## 23. Production dry-run activation gate and rollback

Activation requires at least three dry runs against production data on three
different days. For each run, retain run ID, source read-through, source snapshot,
adapter/schema version, plan checksum, counters, matching sample review, warnings,
conflicts, and reviewer.

All three must show:

- stable and explained counts;
- zero unexpected schema drift;
- no duplicate planned mutations;
- verified cutoff behavior;
- reviewed matching samples under the calibrated policy;
- successful retry/resume simulation; and
- owner/operator disposition of every bootstrap conflict.

Activation acceptance:

1. Stage 1 contracts pass;
2. all 19 automated tests pass;
3. bootstrap adoption is approved and complete;
4. three-day dry-run evidence passes every item;
5. env hard gate is intentionally enabled by deployment operations;
6. owner enables the application connection;
7. initial cadence is `24` hours;
8. heartbeat, worker, lease, alert, and dashboard health are verified.

Activation rejection:

- any unexplained count/financial discrepancy;
- any duplicate planned mutation or unstable identity;
- unexpected schema/formula drift;
- matching policy not calibrated/reviewed;
- unresolved blocking bootstrap conflict;
- retry/resume or concurrency failure;
- canonical direct-write or HTTP loopback path;
- missing alert/rollback ownership;
- credentials or PII leakage.

Rollback is immediate:

```dotenv
BEST_RELOCATION_INGEST_ENABLED=false
```

The false env gate prevents new scheduled runs regardless of dashboard state.
Operations then lets an already applying worker reach a safe checkpoint or fences
it by the documented lease/runbook procedure; it must not corrupt state by
manually deleting receipts. Canonical corrections use canonical workflows.
Rollback preserves runs, receipts, conflicts, plans, audits, and connection state
for diagnosis and safe resume.

## 24. Operational handoff

Stage 2 hands activation to operations only with:

- exact production env checklist and proof both workbooks are configured;
- proof the service account is editor only where needed and lacks Drive-wide
  access;
- bootstrap approval record and discrepancy dispositions;
- three dry-run evidence bundle;
- active cadence and next-due behavior;
- heartbeat and worker deployment identifiers;
- lease/checkpoint recovery runbook;
- alert ownership and escalation path;
- owner/admin control-surface walkthrough;
- rollback command and safe in-flight-run procedure;
- known conflicts and accepted dispositions;
- evidence that both Best Relocation sources are registered in Stage 1's
  operational-workbook registry.

Operations accepts when every artifact is present, all activation gates pass, and
an on-call operator can identify the current run, lease owner, last success,
next due, blocking conflict, and rollback action without database improvisation.
Operations rejects the handoff if any source ID is hardcoded, the env gate can be
bypassed, bootstrap is incomplete, dry-run evidence is missing, or rollback
depends on deleting durable state.

## 25. Handoff to Stage 4: operational-workbook registrations

Stage 1 owns the single `OperationalWorkbookRegistry` interface and its
fail-closed destination evaluation. Stage 2 contributes exactly two required
static registrations to that registry:

- `BEST_RELOCATION_SYNC_SHEET_ID`;
- `BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID`.

Both registrations have purpose `ingestion_source`, owner module
`best_relocation_ingestion`, production-required status, and safe display labels.
They remain registered and denied even when application scheduling is disabled.
Stage 2 does not expose a second lookup, combine lists, or implement reporting
destination evaluation.

Stage 4 consumes the unified Stage 1 registry, which also contains Master Leads,
Master Booked, every configured Sheet Sync target, and every other operational
projection workbook. Report destination save, verify, preview, and run paths
reject an exact normalized Google file-ID match. There is no owner override in
v1.

Only trusted server code receives raw IDs. UI/health APIs receive masked IDs.
Missing/unresolvable official ingestion IDs make destination safety verification
fail closed; they do not produce an empty denylist. Changes invalidate destination
health and require re-verification.

Stage 1 accepts Stage 2's contribution when both registrations resolve through
the shared registry, are covered by contract tests, remain available independently
of ingestion cadence/reporting state, and cannot omit disabled-but-registered
input workbooks. Stage 4 accepts the resulting unified registry only when its
configuration-completeness check and destination evaluator pass. Either stage
rejects a second lookup, static copied list, masked-ID comparison, title-based
matching, owner override, or a contract that requires running or activating
ingestion first.

## 26. Risks and mitigations

- **Copied or reordered sheet rows create duplicates.** Use stable source keys,
  managed IDs, read-back verification, unique receipt indexes, and conflicts;
  never row numbers.
- **The service account gains excessive access.** Use Sheets-only access and share
  only the two input workbooks; do not request Drive-wide scope.
- **Old `0.5` matching creates wrong links unattended.** Calibrate a stricter
  threshold/margin from reviewed production examples and preserve ranked evidence.
- **Source edits overwrite application work.** Enforce source origin, exact
  allowlist, and last-applied/current three-way equality.
- **Crash between canonical mutation and receipt write duplicates work.** Use
  command idempotency/provenance and recovery adoption before retrying.
- **Bootstrap replays the historical import.** Make bootstrap receipt-adoption
  only and require count/financial approval.
- **Structural drift causes partial corruption.** Complete inspection and checksum
  validation before mutation.
- **Concurrent cron/manual triggers overlap.** Atomically claim due state and fence
  apply with one adapter lease.
- **A missing source row is mistaken for deletion intent.** Mark `source_missing`
  and require canonical correction.
- **Reporting and ingestion accidentally share identity or workbook access.**
  Maintain distinct service-account/OAuth paths and provide an authoritative
  Stage 2 registration contribution to Stage 1's denylist registry.
- **Kernel becomes a generic designer.** Keep business interpretation in the
  adapter and omit arbitrary mapping/configuration UI.
- **Stage 1 interface churn blocks progress.** Isolate shared contracts behind a
  Stage 2 boundary and reject semantically unsafe substitutions.

## 27. Definition of complete

Stage 2 is complete when Best Relocation:

- runs every owner-selected 24 or 48 hours under both env and application gates;
- reads only authoritative post-cutoff observations through one immutable
  read-through;
- maintains stable identities, durable append-only receipts, conflicts, plans,
  checkpoints, audits, and health;
- survives retries, crash windows, row reorder, and concurrent triggers without
  duplication;
- applies only through canonical in-process commands with Operations Registry,
  validation, outbox, audit, and Sheet Sync behavior intact;
- handles safe updates, leadless bookings, reconciliation, refunds, and missing
  rows exactly as specified;
- gives owners mutation/approval controls and admins read-only visibility;
- passes all 19 acceptance tests;
- passes bootstrap approval and three production-data dry runs on different days;
- activates first at 24 hours with a verified env-gate rollback; and
- contributes both official ingestion workbooks to Stage 1's fail-closed
  operational-workbook registry for Stage 4 consumption.

This completion does not include or authorize the historical/production database
merge and does not depend on Stage 3 reporting completion.

## 28. Source-section traceability

- **Sections 1-4:** trust boundaries, shared invariants, deferred historical merge,
  delivery order, and the rule that scheduled ingestion does not wait for
  reporting — sections 1-5 and 27 here.
- **Section 5:** retained migration assets and single adapter/planner
  implementation — sections 8, 15, 20, and 21.
- **Section 6:** workbooks, tabs, cutoff, `LID_BestRelo`, and immutable read-through
  — section 6.
- **Section 7:** env contract, fallback removal, deployment/application gates,
  credentials, and Sheets-only managed-column write access — section 7.
- **Section 8:** thin kernel interface and kernel/adapter ownership — section 8.
- **Section 9:** connection, run, receipt, conflict, indexes, uniqueness, and lease
  — sections 9-10.
- **Section 10:** stable source keys, hidden ID, aliases/metadata, row provenance,
  and duplicate-ID conflicts — section 11.
- **Section 11:** bootstrap adoption, reconciliation, approval, and schedule block
  — sections 13 and 23.
- **Section 12:** seven exact classifications and four dependency groups —
  section 12.
- **Section 13:** three-way allowlist, protected/financial fields, divergence, and
  source disappearance — section 14.
- **Section 14:** matching calibration, leadless booking/reconciliation, and
  unmatched refunds — section 15.
- **Section 15:** canonical in-process commands, system actor, retained validation,
  registry, guards, outbox, audit, and Sheet Sync — section 8.3.
- **Section 16:** cron route, six-hour heartbeat, dual gate, cadence, due claim,
  queue, and worker — section 16.
- **Section 17:** structural aborts, row isolation, checkpoints, errors, and resume
  — section 17.
- **Section 18:** owner/admin capabilities, APIs, UI, trusted actor/audit —
  section 18.
- **Section 19:** incidents, notification policy, and dashboard health —
  section 19.
- **Section 20:** all 19 tests, three production-data dry runs, 24-hour activation,
  and env rollback — sections 22-23.
- **Section 27 ingestion denylist dependency:** authoritative workbook handoff to
  Stage 4 — section 25.
- **Section 36:** ingestion routes/models/worker and admin file map, plus
  integration with Stage 1's command extraction — section 21.
- **Section 37:** admin authorization, clients, control surfaces, health, and
  reconciliation metadata — sections 18 and 21.
- **Section 38:** Operations Registry, cron, Sheet Sync lease/run, observability,
  and admin run patterns — sections 8, 9, 16, 19, and 21.
- **Section 39:** Part A completion and exclusion of historical merge —
  sections 4 and 27.

## 29. Cross-document contracts

- `best-relocation-stage-1-shared-foundations.md`: supplies durable run, lease,
  actor, checksum, audit, queue, time, and observability primitives; Stage 2
  accepts them only under section 2.
- `best-relocation-stage-3-reporting-core.md`: may implement in parallel after
  Stage 1; it shares conventions only, never ingestion records, identities,
  permissions, or business rules. Its availability cannot gate scheduled
  ingestion.
- `best-relocation-stage-4-google-delivery-and-rollout.md`: consumes section 25's
  two registrations through Stage 1's authoritative operational-workbook
  registry; it must fail closed when denylist safety cannot be verified and does
  not consume ingestion activation evidence.
