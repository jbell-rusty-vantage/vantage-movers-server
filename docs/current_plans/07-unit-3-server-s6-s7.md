# Implementation Unit 3 — RingCentral Registry and Runtime Cutover (S6–S7)

Status: Execution brief derived from the approved Operations Registry plan
Date: 2026-07-29
Repository: `vantage-main-server`
Work packages: S6, S7

## 1. Purpose and prerequisites

This unit creates collection-backed RingCentral inbound route identity and
assignment history, validates numbers against the configured account, then
cuts every production Call Qualification path to one cached registry resolver.
It also completes registry-only source/label/filter consumer cutover.

Required reading:

1. [Specification](./01-operations-registry-specification.md), especially §10
   and §12
2. [Technical contracts](./02-data-model-api-and-runtime-contracts.md),
   RingCentral models/routes/runtime result and source resolver contract
3. [Implementation plan](./03-implementation-plan.md), S6–S7
4. [Migration/rollout plan](./04-migration-testing-rollout.md), especially M5,
   M6, RingCentral tests, deployment, verification, and rollback
5. [Unit 1](./05-unit-1-server-s0-s3.md) and merged S1/S3 handoffs
6. Repository RingCentral rules and
   `.cursor/businesslogic/ringcentral-call-lead-qualification.service.md`
7. Form/Call Lead, CRM, Sheet Sync, and Analytics business-logic docs for any
   consumer changed by S7

S6 requires merged S3 because assignments reference first-class call
granularities. S7 requires merged S6. The M5 production backfill and validation
gate is mandatory before pushing or deploying registry-only RingCentral
consumers; implementation/tests may proceed with fixtures and mocked validation.

## 2. Invariants agents must preserve

- Provider is fixed to `ringcentral`.
- Phone identity uses one shared E.164-like normalization.
- One normalized number identifies one route globally.
- One route has at most one open assignment; multiple routes may target one
  call granularity.
- Assignments target active `call` granularities only.
- Validation proves number existence/access in the configured account.
- Recent call evidence is informational and not an activation requirement.
- Failed/unvalidated drafts remain editable but cannot activate.
- Phone may change before first activation and is immutable afterward.
- Reassignment is immediate; no future scheduling.
- Delayed calls resolve assignment by call start time.
- Call Qualification remains inbound + mapped route + answered + caller phone
  + at least 120 seconds.
- There are no per-route executable or configurable qualification rules.
- Webhook and Call Log use the same resolver and qualification function.
- After S7 there is no static fallback.

## 3. S6 — RingCentral route registry

### Models

Add:

- `src/models/RingCentralInboundRoute.ts`
- `src/models/RingCentralInboundRouteAssignment.ts`

Use the fields/indexes in the technical contract. Route identity, provider
metadata, validation state, recent observation timestamps, lifecycle, and
assignment intervals are distinct concerns. Enforce one open assignment in the
transaction even if a partial unique index is also practical.

### Registry commands and query interface

Implement behind `src/services/operationsRegistry/`:

- route list/detail/dependency queries;
- create/update inactive draft;
- remote validation result persistence;
- activation/deactivation;
- immediate reassignment;
- immutable resolver snapshot loading;
- `resolveRingCentralInboundRoute(snapshot, phone, at)`;
- cache invalidation after committed mutation.

Activation/reassignment transactions recheck route, validation freshness,
company, granularity, channel, and active state. Reassignment closes and opens
intervals at the same instant. Deactivation closes the current interval and
does not modify existing Call Leads.

### Validation adapter

Relevant current integration files:

- `src/services/ringcentral/client.ts`
- `src/services/ringcentral/auth.ts`
- `src/services/ringcentral/ringcentral-config.ts`
- `src/services/ringcentral/phone-normalization.ts`
- `src/services/observability/operationalEventSanitizer.ts`

Perform remote account validation outside a Mongo transaction. Convert provider
results into a safe local result, then transactionally persist that result and
the Registry Change. Never persist/return credentials or raw remote bodies.
Unavailable/invalid validation returns the stable codes from the contract and
records an actionable Operational Event without crashing the admin request.

Automated tests mock RingCentral. Live validation is only the explicitly
authorized M5 rollout action.

### Admin routes

Implement:

```text
GET   /api/v1/admin/ringcentral/inbound-routes
POST  /api/v1/admin/ringcentral/inbound-routes
PATCH /api/v1/admin/ringcentral/inbound-routes/:id
POST  /api/v1/admin/ringcentral/inbound-routes/:id/validate
POST  /api/v1/admin/ringcentral/inbound-routes/:id/activate
POST  /api/v1/admin/ringcentral/inbound-routes/:id/deactivate
POST  /api/v1/admin/ringcentral/inbound-routes/:id/reassign
GET   /api/v1/admin/ringcentral/inbound-routes/:id/dependencies
```

All mutations require the S1 verified Owner actor. Keep routes thin and
validation schemas under `src/validation/v1/`.

### Resolver snapshot and cache

Call Qualification cannot query Mongo once per call leg. Load an immutable
last-known-valid route/assignment snapshot with:

- build/load timestamp and bounded maximum age;
- deterministic normalized-number lookup;
- assignment interval lookup by call start time;
- explicit invalidation after committed relevant mutation;
- observable refresh failure/staleness;
- no correctness dependency on `call-lead-sources.ts`.

The cache may serve a bounded last-known-valid snapshot according to the
approved failure posture, but stale/unresolved states must be explicit and
observable.

### M5 backfill/validation script

Seed candidates from:

- `src/services/ringcentral/call-lead-sources.ts` (the five static mappings);
- existing embedded inbound-number metadata in Source Companies.

The repository currently has no `scripts/ringcentral/` directory or matching
package scripts despite older rule references. Add/document the actual
invocation rather than assuming those commands exist.

Dry run reports normalized candidates, exactly resolved call granularities,
conflicts/unknowns, intended routes/assignments, and stable checksum. Apply is
idempotent and requires all safeguards in M5. It validates every intended
active route and aborts the gate if any intended number is missing,
conflicting, inaccessible, invalid, or assigned incorrectly.

### S6 acceptance

- failed drafts remain editable;
- invalid/unvalidated routes cannot activate;
- phone locks after first activation;
- multiple routes may target one call granularity;
- a number cannot target two granularities at one instant;
- reassignment closes/opens intervals atomically;
- delayed calls resolve by call start time;
- validation errors are safe and observable;
- recent-call absence does not block valid activation;
- snapshot invalidates only after commit;
- no route-level qualification rules are introduced.

## 4. S7 — Registry-only runtime consumer cutover

### RingCentral production paths

Cut these current consumers to the shared registry snapshot/resolver and shared
qualification function:

- `src/services/ringcentral/webhook-event-normalizer.ts`
- `src/services/ringcentral/ringcentral-call-lead-ingest.service.ts`
- `src/services/ringcentral/call-log-sync.service.ts`
- `src/services/ringcentral/call-session-aggregator.ts`
- `src/services/ringcentral/analytics-reconcile.service.ts`
- `src/services/ringcentral/ringcentral-duplicate-guard.ts`
- `src/services/ringcentral/call-log-vetting.ts`
- `src/services/ringcentral/call-candidate-evaluator.ts`
- `src/services/ringcentral/webhook-subscriptions.ts`
- `src/routes/ringcentral-webhook.routes.ts`

Preserve telephony facts during webhook normalization before qualification.
Candidate/session state carries route identity so later events cannot silently
re-resolve against a changed current assignment. Scheduled Call Log sync loads
one immutable snapshot per run. Webhook processing uses the shared cached
snapshot.

Persist on RingCentral-created Call Leads:

- route ID;
- assignment ID;
- normalized target number;
- company/granularity IDs and label snapshots from the resolver.

Unknown or inactive-at-call-time routes do not qualify. Webhook and Call Log
must agree for a database-only fixture, unknown route, deactivated route, and
reassigned/delayed call.

Keep the global `CALL_LEAD_MINIMUM_ANSWERED_SECONDS = 120` behavior. Do not move
it into Mongo or duplicate it per route.

### Static RingCentral retirement

`src/services/ringcentral/call-lead-sources.ts` is current static authority.
After the M5 gate, remove all runtime imports/fallbacks. It may remain only as a
seed/fixture artifact if still useful and clearly marked. Unknown registry
state must not silently consult it.

Subscription/diagnostic number loading must come from the registry while
preserving account-wide subscription correctness.

### Other registry-only consumers

Complete source attribution and dynamic catalog cutover where not already done:

- `src/services/leads/callLeadSourceMatch.ts`
- `src/services/crm/formLeadPayload.ts`
- `src/services/analytics/analyticsFilters.ts`
- `src/services/analytics/sourcePerformance.service.ts`
- `src/middleware/requireApiSecret.ts` where scoped source keys resolve through
  static configuration
- relevant booking, Sheet Sync target, and source-label consumers identified
  by S0 inventory

All automatic source resolution uses `resolveSourceAttribution` or persisted
snapshots. New Source Companies must flow through supported consumers without
compile-time union rejection. Static source values may remain only as
seeds/fixtures or clearly bounded compatibility display data.

### Analytics reconciliation posture

RingCentral Analytics reconciliation remains count-only and must not create
Call Leads. It uses registry diagnostic numbers and resolver facts but does not
become another ingestion path. Update relevant business-logic docs if behavior
or diagnostics change.

### S7 acceptance

- no production qualification path imports the static number map;
- webhook and Call Log share resolver/qualification behavior;
- a database-only number qualifies consistently in both paths;
- unknown/deactivated numbers fail consistently;
- delayed calls use historical assignment intervals;
- persisted Call Leads contain route/assignment/target snapshots;
- account-wide subscription behavior remains valid;
- global 120-second rule is unchanged;
- dynamic Source Companies reach CRM labels, filters, Analytics, and supported
  source consumers;
- no production fallback to static maps/unions remains.

## 5. File ownership and coordination

S6 primarily owns new route/assignment models, RingCentral registry commands,
validation adapter, snapshot/cache, admin routes, and M5 tooling. Avoid broad
changes to webhook/Call Log ingest until S6 merges.

S7 owns runtime RingCentral consumers, static-map removal, route identity
persistence, and the final static source/CRM/filter consumer cutover.

Shared coordinator-owned files include registry exports, errors, audit/cache
interfaces, `src/routes/v1.routes.ts`, production Lead schema areas also touched
by S4, and migration scripts/package commands. Rebase before modifying shared
contracts and preserve the S4 CPL resolution behavior in Call Lead Ingestion.

## 6. Verification

Focused tests must cover phone normalization, model uniqueness, transaction
intervals, validation sanitization, cache invalidation/staleness, resolver time
selection, webhook/Call Log parity, and static-import absence.

At each package handoff:

```text
pnpm typecheck
```

At the unit integration gate:

```text
pnpm typecheck
pnpm test
```

Automated verification uses `TEST_MODE=true`, replica-set MongoDB where
transactions are exercised, and mocked RingCentral. Do not perform live
provider calls or production backfill without explicit owner authorization.

## 7. Deployment gate and evidence

S7 code may be reviewed and merged to the integration branch with fixtures, but
must not be pushed/deployed as registry-only production behavior until the
explicitly authorized M5 apply/validation report passes.

The coordinator must retain:

- S6 and S7 handoffs and merge SHAs;
- route/assignment schema/index list;
- mocked validation and sanitized-error results;
- dry-run manifest and, when authorized, M5 apply run ID;
- all five known mappings plus approved extras;
- zero conflict/invalid/inactive-assignment report;
- final mapping checksum and database name;
- webhook/Call Log parity results, including a database-only number;
- proof no runtime static RingCentral import/fallback remains;
- dynamic source consumer contract results;
- cache staleness/invalidation evidence;
- rollback deployment point and confirmation historical models/database were
  untouched.

Unit 3 is complete only when S7 is merged and tested. Production rollout of its
registry-only RingCentral behavior remains separately gated by M5.
