## Operations Registry work-package handoff

- Repository: `vantage-main-server`
- Branch: `feature/operations-registry`
- Base SHA: `f6443b69eb7eccec6ef63a105c0a2fe085945fbd`
- Head SHA: uncommitted working tree; no commit requested
- Work package: S6 RingCentral Registry and S7 runtime cutover
- Integration branch expected: `feature/operations-registry`

### Delivered

- Collection-backed RingCentral inbound routes and effective-dated assignment history.
- Owner-only draft, validation, activation, deactivation, reassignment, dependency, and list/detail interfaces.
- Live account validation adapter with safe provider metadata/errors and actionable Operational Events.
- Bounded immutable last-known-valid route snapshot, post-commit invalidation, historical call-time resolution, and refresh-failure events.
- Shared webhook/Call Log qualification facts; webhook preserves route identity in candidate/session state and Call Log loads one snapshot per run.
- RingCentral-created Call Leads persist route, assignment, target number, company, granularity, and label snapshots.
- Analytics diagnostic numbers load from the registry. Production runtime has no import or fallback to the static number map.
- Webhook subscription filters load active numbers from the registry in per-number mode; account mode remains the provider-wide inbound filter.
- Webhook attribution requires RingCentral's explicit call start time and fails closed when it is absent; notification time is never used across assignment boundaries.
- Snapshot refreshes use invalidation generations, react to source-company/granularity changes, and exclude inactive source targets and closed current routes.
- M5 dry-run-first, production-guarded, idempotent backfill/validation migration using the five static seeds plus embedded inbound numbers. Apply validates the entire plan before the first mutation, creates the route, assignment, and Call Lead provenance indexes, rolls back routes activated earlier in a failed run, and writes the failure manifest before exiting nonzero.
- Registry overview/health includes RingCentral counts and active route/assignment validation findings.

### Files

- Added: `src/models/RingCentralInboundRoute.ts`
- Added: `src/models/RingCentralInboundRouteAssignment.ts`
- Added: `src/services/operationsRegistry/{ringCentralRegistry,ringCentralSnapshot,ringCentralValidation}.ts`
- Added: `src/routes/ringcentral-registry.routes.ts`
- Added: `src/services/ringcentral/call-qualification.ts`
- Added: `scripts/migrations/operations-registry-ringcentral*`
- Modified: RingCentral webhook, candidate/session, Call Log, ingest, Analytics, Call Lead schema/create path, registry health/overview, validation/routes, rules, and business-logic docs.
- Intentionally untouched: historical models/database and production data.

### Verification

- Focused RingCentral/M5 suite: 34 passed, 0 failed.
- Full `pnpm test`: 577 passed, 0 failed.
- `pnpm typecheck`: no Unit 3 diagnostics; command remains blocked by the documented unrelated `scripts/dev_ops/*` errors.
- Test-database M5 dry run performed no writes or provider calls. It found all five static and five embedded candidates but correctly blocked because the test database has not applied M3 first-class Source Granularities.

### Operational notes

- Migration command: `pnpm migrations:operations-registry-ringcentral`.
- Production apply additionally requires `--apply --production-apply --confirm-production-db=vantagemovers`.
- Apply performs live RingCentral account validation. Do not run it without explicit owner authorization and reviewed M3/M5 dry-run manifests.
- Any invalid or unavailable number fails the apply preflight without changing registry state.
- Optional bounded cache/validation settings:
  - `RINGCENTRAL_REGISTRY_SNAPSHOT_MAX_AGE_MS`
  - `RINGCENTRAL_REGISTRY_LAST_KNOWN_VALID_MAX_AGE_MS`
  - `RINGCENTRAL_ROUTE_VALIDATION_MAX_AGE_MS`
  - `RINGCENTRAL_REGISTRY_MAPPING_CHECKSUM`
- Rollback is the prior deployment. Route/assignment documents remain additive and must not be dropped.

### Risks and next step

- M3 must be applied and verified in the target database before M5 can resolve assignments.
- Registry-only RingCentral code must not be pushed/deployed until an explicitly authorized M5 apply reports all intended mappings valid with zero conflicts.
- No live RingCentral validation or production migration was executed in this work session.
