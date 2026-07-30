# Implementation Unit 2 — Temporal CPL and Corrections (S4–S5)

Status: Execution brief derived from the approved Operations Registry plan
Date: 2026-07-29
Repository: `vantage-main-server`
Work packages: S4, S5

## 1. Purpose and prerequisites

This unit replaces current-value CPL mutation with effective-dated schedules
for new Lead resolution, then adds a separate previewed, resumable workflow for
correcting prior production Leads.

Required reading:

1. [Current plan index](./index.md)
2. [Specification](./01-operations-registry-specification.md), especially §9
3. [Technical contracts](./02-data-model-api-and-runtime-contracts.md),
   especially CPL models, Lead fields, routes, errors, and runtime results
4. [Implementation plan](./03-implementation-plan.md), S4–S5
5. [Migration/rollout plan](./04-migration-testing-rollout.md), M4, M6,
   testing, deployment, and rollback
6. [Unit 1](./05-unit-1-server-s0-s3.md) and its merged handoffs
7. Repository rules and the Form Lead, Call Lead, Analytics, and backend-safety
   business-logic documents

Start only from an integration branch containing S1 and S3. First-class Source
Granularity IDs are the schedule identity. S5 starts only after S4's resolver,
schedule revision, and production Lead fields are merged.

## 2. Non-negotiable behavior

- Business dates use `America/New_York`; storage uses UTC instants plus the
  original date values/timezone.
- Start dates are inclusive local midnight. Owner-facing end dates are
  inclusive and convert to the next local midnight as exclusive storage.
- Resolve a Lead by its business `timestamp`, never `createdAt`.
- Store rates canonically as non-negative integer cents; accept no more than
  two decimal places.
- An active granularity schedule is continuous, non-overlapping, and has one
  open-ended final period.
- Free traffic is an explicit zero-dollar period.
- Missing paid rate is not free traffic: save the Lead, retain compatibility
  `cpl: 0`, mark `missing_rate`, and emit an Operational Event.
- Duplicate Call Leads remain zero CPL and retain the covering base period when
  available.
- Ordinary Simple/Advanced edits never rewrite existing Leads.
- Correction jobs touch production `FormLead` and `CallLead` only.
- No request-time unbounded `updateMany`.

## 3. S4 — Temporal CPL schedules

### Domain implementation

Add `src/models/CplRatePeriod.ts` with the contract fields/indexes. Place pure
schedule construction, validation, date conversion, money conversion, and
resolution functions behind `src/services/operationsRegistry/`.

Existing time helpers live in:

- `src/utils/easternTime.ts`
- `src/utils/easternTime.test.ts`

The existing constant may be named `FLORIDA_TIME_ZONE`, but it represents the
same IANA zone. Prefer a registry-facing New York/business-time name without
creating competing timezone logic. Add tests for ordinary boundaries and both
DST transitions.

### Concurrency and transactions

For every schedule command:

1. start one Mongo transaction;
2. load the granularity and verify `expected_revision`;
3. load all non-archived periods;
4. construct and validate the complete resulting schedule in memory;
5. compare-and-increment `schedule_revision`;
6. persist period changes and the Registry Change;
7. commit;
8. invalidate registry/CPL caches.

A stale revision returns HTTP 409 with the current revision and safe current
schedule. Mongo indexes do not replace interval validation.

Simple Mode validates all changed granularities before writing and commits the
multi-granularity command atomically. It ignores unchanged rows. Advanced Mode
accepts explicit discriminated operations (`add_future`, `split`,
`replace_schedule`, `correct_period`); do not expose arbitrary independent
PATCHes of interval fields.

### API surface

Implement:

```text
GET  /api/v1/admin/cpl/snapshot
POST /api/v1/admin/cpl/simple-schedule
GET  /api/v1/admin/source-granularities/:id/cpl-periods
POST /api/v1/admin/source-granularities/:id/cpl-schedule/commands
```

Use the request body and error codes from the technical contract. Mutations
require the S1 verified Owner actor and transactional audit.

### Lead schema and ingestion

Add the CPL resolution fields from the contract to:

- `src/models/FormLead.ts`
- `src/models/CallLead.ts`

Do not edit:

- `src/models/historical/FormLead.ts`
- `src/models/historical/CallLead.ts`

Cut Form Lead and Call Lead ingestion to registry `resolveCpl` after M4 schedule
seeding. Existing implementation locations:

- `src/services/leads/formLead.service.ts`
- `src/services/leads/callLead.service.ts`
- `src/services/leads/duplicateLead.service.ts`
- `src/config/domain/cpl.ts`

Persist amount snapshot, period reference, status, resolved time, and resolver
version. Preserve all existing duplicate detection and post-save ordering.
Failure to find a rate must not reject an otherwise valid Lead.

### Legacy behavior to disable

Current files:

- `src/services/cpl/cplRate.service.ts`
- `src/services/cpl/cplRate.service.test.ts`
- `src/models/CplRate.ts`
- `src/config/domain/cplRateDefinitions.ts`
- `src/routes/v1.routes.ts`

The old CPL PATCH path currently rewrites Leads with `updateMany`. Stop that
behavior before the temporal editor is authoritative. Compatibility GET may
remain temporarily; document exact retirement ownership for S8. No new caller
may resolve from `cpl_rates` or embedded `granularity.cpl` after cutover.

### Analytics disclosure

Update relevant Analytics paths, including:

- `src/services/analytics/leadCost.service.ts`
- `src/services/analytics/receiverAgentPerformance.service.ts`

Trustworthy totals must exclude or separately disclose `missing_rate` Leads.
An explicit zero-dollar resolved period remains a legitimate resolved value.
Define the response impact in tests and relevant Analytics business-logic docs.

### M4 schedule seed

Create one reviewed open-ended cutover period per active granularity. The
dry-run manifest must show the proposed New York date, source value, amount in
cents, conflicts, and checksum.

Do not infer historical periods. Do not initialize period references on prior
Leads. If embedded and `cpl_rates` values disagree, stop for owner review; do
not pick an automatic winner.

### S4 acceptance

- cents/date/DST/boundary tests pass;
- active schedules reject gaps and overlaps;
- explicit zero is resolved, not missing;
- Simple Mode is all-or-nothing across granularities;
- stale revisions return safe current state;
- new Leads resolve using business timestamp;
- missing rate saves and emits one actionable event;
- duplicate Call Lead zero behavior and base-period evidence remain;
- ordinary edits do not update existing Leads;
- Analytics discloses unresolved CPL.

## 4. S5 — Production CPL correction jobs

### Workflow

Corrections are not an Advanced Mode side effect. Implement a separate
preview/apply/status/cancel workflow:

```text
POST /api/v1/admin/cpl-corrections/preview
POST /api/v1/admin/cpl-corrections
GET  /api/v1/admin/cpl-corrections/:id
POST /api/v1/admin/cpl-corrections/:id/cancel
```

Preview returns bounded impact counts/details and a stable hash covering the
selection and target schedule revision. Apply requires explicit confirmation
of that hash. A changed selection/schedule returns `CPL_PREVIEW_STALE`.

### Model and worker

Add `src/models/CplCorrectionJob.ts` with the state, cursor, lease, counts, and
sanitized error fields in the contract. Implement a bounded lease-based worker
or protected cron behind the registry module.

Useful existing patterns:

- `src/services/employeeBookings/reconciliationRematch.service.ts`
- `src/services/employeeBookings/reconciliationRematch.service.test.ts`
- `src/services/employeeBookings/migrationApplySafety.ts`
- `src/services/observability/index.ts`

Do not couple the new job's domain behavior to employee-booking semantics;
reuse only proven lease/resume and apply-safety patterns.

Each batch:

- claims/renews a bounded lease;
- resumes from a durable stable Lead cursor;
- rechecks current Lead state and the target period before writing;
- updates `lead.cpl`, period reference, resolution fields, and
  `cpl_correction` metadata together;
- increments changed/no-op/failed counts idempotently;
- records safe progress/failure events;
- schedules Analytics invalidation/recalculation without an unbounded request.

Re-entering a completed batch is a no-op. Partial failure must preserve enough
state to resume without double correction.

### Audit and Analytics

The Registry Change for the request records actor, reason, request ID, preview
hash, target revision, and requested window without sensitive Lead payloads.
Completion/progress evidence links back to the job/request. Operational Events
describe actionable failure/progress conditions; they do not replace audit.

Integrate with the existing Analytics recomputation/invalidation seam, including
`src/services/analytics/analyticsMerge.ts`, and document the chosen bounded
mechanism. Never run an unbounded synchronous recompute in the apply request.

### S5 acceptance

- preview selection and hash are deterministic;
- stale preview cannot apply;
- only production Form/Call Lead models are imported;
- interrupted/expired-lease jobs resume;
- overlapping workers do not double-correct;
- no-op re-entry is safe;
- cancellation stops future batches without corrupting completed work;
- partial failures are visible and resumable;
- previous CPL is recorded for reviewed compensating rollback;
- audit and Operational Events contain no sensitive raw payloads;
- no request-time unbounded `updateMany` exists.

## 5. Owned and shared files

Likely S4 ownership:

- CPL schedule implementation under `src/services/operationsRegistry/`
- `src/models/CplRatePeriod.ts`
- production `FormLead.ts` and `CallLead.ts`
- lead-ingestion CPL calls
- current CPL service/route compatibility behavior
- relevant Analytics CPL aggregation
- CPL validation schemas and focused tests

Likely S5 ownership:

- correction implementation under `src/services/operationsRegistry/`
- `src/models/CplCorrectionJob.ts`
- bounded worker/cron boundary
- correction validation/routes/tests
- Analytics invalidation hook

Coordinator-owned shared areas include stable error contracts, route
registration, registry audit helpers, cache invalidation, and cross-repository
payload changes. Rebase on the current integration head before editing these.

## 6. Verification

Run focused pure, model/transaction, ingestion, Analytics, and worker tests
during each package. At each package handoff:

```text
pnpm typecheck
```

At the unit integration gate:

```text
pnpm typecheck
pnpm test
```

Use `TEST_MODE=true` and replica-set MongoDB for transaction tests. Mock
external systems. Production dry-run/apply, synthetic production Leads, and
deployment require separate explicit authorization.

## 7. Unit completion evidence

Provide separate S4 and S5 handoffs with:

- schema/index and API changes;
- schedule operation/error response examples;
- M4 dry-run manifest and owner-reviewed conflict disposition;
- proof that pre-existing Lead CPL values were not changed by seeding/ordinary
  edits;
- missing-rate and duplicate-zero test results;
- correction preview/hash, lease/resume, idempotency, cancellation, and partial
  failure results;
- Analytics disclosure/invalidation behavior;
- compatibility CPL reads/writes still present and S8 retirement criteria;
- rollback instructions and confirmation that historical models were untouched;
- server integration merge SHAs.

Unit 2 is complete after S5 merges and the integration branch passes the full
server validation. D3 correction UI may then complete against the stable
contracts.
