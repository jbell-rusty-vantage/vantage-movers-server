# Operations Registry Implementation Plan and Branch Handoffs

Status: Execution plan
Date: 2026-07-28

## 1. Execution principles

- Deliver vertical, testable work packages.
- Establish server contracts before dashboard consumers.
- Preserve compatibility until a measured cutover point.
- Never maintain two permanent writable authorities.
- Use Mongo transactions for registry mutation plus audit.
- Keep external RingCentral calls outside transactions.
- Keep production and historical database code paths separated.
- No work package may import `src/models/historical/*`.
- Do not run production scripts, push, deploy, or merge to `main` without
  explicit owner authorization.

## 2. Repository and branch topology

`vantage-main-server` and `vantage-admin` are independent Git repositories.
Use an integration branch named `feature/operations-registry` in each.

Suggested work branches:

```text
vantage-main-server
  feature/operations-registry-foundation
  feature/operations-registry-catalogs
  feature/operations-registry-sources
  feature/operations-registry-cpl
  feature/operations-registry-corrections
  feature/operations-registry-ringcentral
  feature/operations-registry-consumer-cutover
  feature/operations-registry-rollout

vantage-admin
  feature/operations-registry-shell
  feature/operations-registry-catalog-ui
  feature/operations-registry-source-ui
  feature/operations-registry-cpl-ui
  feature/operations-registry-ringcentral-ui
  feature/operations-registry-health-audit-ui
```

If the owner deliberately enables worktrees, non-overlapping branches may run
in parallel. Otherwise, use sequential isolated branches and merge each into
the integration branch before starting the dependent package.

The coordinator owns:

- integration branches;
- shared API/error contract changes;
- merge conflict resolution;
- cross-repository acceptance;
- migration/deployment gates.

Subagents do not merge their own branches into integration or `main`.

## 3. Work package dependency graph

```text
S0 Inventory/spec verification
  -> S1 Registry foundation + trusted actor + audit
      -> S2 Agent/Merchant registry
      -> S3 First-class Source Granularities
          -> S4 Temporal CPL
              -> S5 CPL correction jobs
          -> S6 RingCentral routes
              -> S7 Runtime/static consumer cutover

D0 Dashboard registry shell (after S1 contracts)
  -> D1 Agent/Merchant UI (after S2)
  -> D2 Source UI (after S3)
      -> D3 CPL UI (after S4; corrections after S5)
      -> D4 RingCentral UI (after S6)
  -> D5 Health/audit UI (after S1, completed after S5/S7)

S8/D6 Cross-repository hardening and rollout
```

Parallelism is safe only between packages whose files and contracts do not
overlap. In particular, S3 is the schema seam for S4 and S6 and should merge
before either begins.

## 4. Server work packages

### S0 — Read-only inventory and contract verification

Deliver:

- a production-safe, dry-run-only inventory script;
- counts and collision reports for all existing registry data;
- static/runtime dependency inventory;
- expected migration manifest schema;
- no mutations.

Inventory:

- Agents, names, aliases, active state, and Granot usernames;
- Merchants and distinct production Booking merchant values;
- Source Companies, embedded granularities, defaults, and IDs;
- embedded CPL and legacy `cpl_rates`;
- existing production Lead counts by source/granularity/CPL;
- static and embedded RingCentral numbers;
- exact alias, CRM-label, source-site, and phone conflicts;
- code references to closed-world source maps/unions.

Exit gate:

- dry-run output is deterministic and redacted;
- collisions are categorized as blocking or reviewable;
- no historical database connection/import exists.

### S1 — Registry foundation, actor verification, and audit

Deliver:

- `src/services/operationsRegistry/` module shell;
- typed domain errors and command context;
- signed trusted-actor verification;
- owner-only mutation middleware;
- `OperationsRegistryChange` model;
- transaction helper that writes mutation and audit atomically;
- overview/health/change read routes;
- cache invalidation event interface;
- unit/integration tests.

Update dashboard proxy signing in a coordinated small dashboard branch before
enforcing the server signature in deployed environments. Support a controlled
compatibility flag only during preview deployment; production registry
mutations fail closed without verified owner context.

Exit gate:

- owner mutation succeeds with valid signature;
- non-owner and spoofed/expired signatures fail;
- read access follows approved roles;
- audit failure rolls back mutation;
- secrets/provider payloads are redacted.

### S2 — Agent and Merchant registry

Deliver:

- Agent embedded Granot identity and compatibility migration;
- Agent/Merchant name aliases and lifecycle fields;
- rename, activation, dependency-preview commands;
- active-only automatic and include-inactive owner query modes;
- catalog/booking integration respecting explicit inactive selection;
- Granot receiver matching through registry query;
- server tests and compatibility verification.

Do not change the extension repository. Preserve the server endpoints the
extension currently calls unless a separately approved contract change is
required.

Exit gate:

- duplicate Granot usernames are rejected;
- configured usernames cannot change through normal API;
- inactive Agents do not auto-match;
- owner booking/correction may explicitly use inactive Agent/Merchant;
- historical models are unchanged.

### S3 — First-class Source Granularities

Deliver:

- `LeadSourceGranularity` model;
- Source Company default ObjectId references and sheet projection mode;
- granular create/update/activation/dependency commands;
- alias conflict and resolution preview;
- registry source resolver;
- idempotent embedded-to-first-class seed script;
- compatibility read adapter;
- consumer contract tests for existing source assignments.

Migration preserves embedded subdocument `_id` values when valid and unique.
The embedded array is retained but becomes read-only compatibility data after
cutover.

Exit gate:

- all existing source-resolution fixtures have parity;
- owner-created source/company granularity resolves without static-union
  rejection;
- active defaults are valid;
- exact ambiguity fails with typed error/event;
- Master Leads behavior is unchanged;
- `derived_import` is the default sheet mode.

### S4 — Temporal CPL schedules

Deliver:

- `CplRatePeriod` model and indexes;
- New York business-date conversion helpers;
- pure schedule construction/validation functions;
- optimistic schedule revision and transaction commands;
- Simple Mode bulk command;
- Advanced Mode commands;
- Lead CPL snapshot/status fields in production models only;
- Form/Call ingestion resolution through the registry;
- missing-rate save-and-flag behavior;
- Analytics unresolved-CPL disclosure;
- removal/disablement of legacy update-many behavior.

Seed one reviewed open-ended cutover period per granularity. Do not infer past
periods and do not change existing Lead CPL values.

Exit gate:

- boundary and DST tests pass;
- active schedules cannot contain gaps/overlaps;
- multi-granularity Simple Mode is all-or-nothing;
- stale revisions return conflicts;
- duplicate Call Lead zero behavior remains;
- missing rate saves and emits an event;
- ordinary edits never update existing Leads.

### S5 — Production CPL correction jobs

Deliver:

- correction preview query and stable preview hash;
- `CplCorrectionJob` model;
- apply/cancel/status commands;
- bounded lease-based worker or protected cron;
- idempotent batch updates;
- Analytics invalidation/recalculation hook;
- progress/failure Operational Events;
- tests for resume, stale preview, partial failure, and no-op re-entry.

Exit gate:

- only production FormLead/CallLead models are touched;
- stale previews cannot apply;
- interrupted jobs resume without double correction;
- audit records link request and result;
- no request-time unbounded `updateMany` remains.

### S6 — RingCentral route registry

Deliver:

- route and assignment models;
- phone normalization/identity locking;
- local and remote validation adapter;
- strict activation and immediate reassignment commands;
- validation-failure Operational Events;
- route snapshot/cache and invalidation;
- admin routes and tests;
- pre-push backfill/validation script.

Remote validation occurs outside transactions. The command persists only
sanitized provider metadata. Account existence/access is required; recent call
evidence is optional.

Exit gate:

- failed draft stays editable;
- unvalidated/invalid routes cannot activate;
- multiple routes may target one call granularity;
- one phone cannot target two granularities at an instant;
- delayed call resolution uses call start time;
- no per-route qualification rules exist.

### S7 — Registry-only runtime consumer cutover

Deliver:

- webhook normalizer/qualifier integration;
- Call Log snapshot integration;
- candidate/session state route identity;
- call-lead ingest snapshot persistence;
- Analytics reconciliation integration;
- subscription diagnostic number loading;
- removal of runtime static RingCentral map;
- removal/demotion of closed-world Source Company maps/unions as runtime
  authority;
- CRM/source label and Analytics filter cutover;
- focused parity/contract tests.

This package cannot be pushed/deployed until the production RingCentral
backfill and validation gate in the rollout document passes.

Exit gate:

- no production qualification path imports the static number map;
- webhook and Call Log use one resolver/qualification function;
- database-only test number works in both paths;
- unknown/deactivated numbers fail consistently;
- dynamic source companies flow through supported consumers;
- compile-time values remain only as seeds/fixtures where still necessary.

### S8 — Server hardening and compatibility retirement

Deliver:

- Registry Health completeness;
- cache staleness metrics/events;
- compatibility-read telemetry;
- remove legacy CPL writes and unused compatibility endpoints;
- document remaining compatibility fields and later-removal criteria;
- full focused suite/typecheck;
- migration runbook dry run.

Do not delete embedded legacy data or compatibility fields in this initiative.

## 5. Dashboard work packages

Dashboard packages must read the relevant Next.js 16 project docs before code
changes, as required by `vantage-admin/NEXTJS_AGENTS.md`.

### D0 — Registry shell and signed actor transport

Deliver:

- signed trusted actor headers from the authenticated server proxy;
- owner mutation authorization update;
- read-only access for other admin roles;
- Operations Registry Settings navigation;
- shared API/error types and query keys;
- overview/health shell.

### D1 — Agent and Merchant UI

Deliver:

- list/create/rename/activate/deactivate;
- dependency preview;
- optional reason;
- show-inactive control;
- inactive selection warnings in booking/edit workflows;
- immutable Granot username presentation and verification status.

### D2 — Source Company and Granularity UI

Deliver:

- company detail and first-class granularity rows;
- no replace-all embedded array form;
- defaults with invariant feedback;
- exact/fallback alias conflict preview;
- sheet workbook at company level;
- tab name at granularity level;
- `derived_import` default and explicit `direct_write` validation;
- inactive explicit selection support.

### D3 — CPL UI

Deliver:

- Simple Mode table with shared date and atomic changed-row update;
- Advanced Mode timeline and revision conflicts;
- past/current/future states;
- gap/overlap error rendering;
- explicit zero rates;
- missing-rate health links;
- production correction preview, confirmation, job progress, and result.

### D4 — RingCentral Queue Number UI

Deliver:

- draft create/edit;
- source call-granularity assignment;
- validate action and sanitized errors;
- account validation separate from call evidence;
- activation/deactivation/reassignment;
- immutable number display after first activation;
- multiple numbers per granularity;
- assignment history.

### D5 — Health and registry audit UI

Deliver:

- typed Registry Health findings;
- entity links and remediation actions;
- registry change history with before/after diff;
- filters for entity, action, actor, and date;
- correlation link/reference to dashboard request audit where available.

### D6 — Dashboard hardening

Deliver:

- query invalidation across settings/catalog/facets/booking/Analytics filters;
- loading/error/empty states;
- keyboard/accessibility pass;
- owner versus read-only behavior;
- tests, lint, typecheck, and build.

## 6. Branch startup checklist

For every work package:

1. Read `AGENTS.md`, referenced repository rules, this folder, and relevant
   business-logic documentation.
2. Run `git status --short`; identify unrelated changes.
3. Record the integration branch base SHA.
4. Create the package branch from the current integration branch.
5. Confirm owned files and non-owned shared files in the handoff.
6. Add focused failing tests before or with behavior changes where practical.
7. Keep migrations dry-run by default and external integrations mocked.
8. Update docs required by repository drift rules.

## 7. Merge checklist

The coordinator:

1. Reads the handoff and branch diff.
2. Confirms no unrelated changes or historical-model imports.
3. Re-runs focused tests and typecheck.
4. Confirms schema/API compatibility and migration notes.
5. Merges into the integration branch with preserved work-package history.
6. Records the merge SHA in the plan log/handoff.
7. Runs dependent contract tests before opening the next sequential branch.

If using parallel worktrees, rebase/merge the latest integration head into a
work branch before final validation when shared contracts changed.

## 8. Cross-repository acceptance gate

Before integration branches may merge to `main`:

- server and dashboard typechecks pass;
- server focused tests pass;
- dashboard tests/lint/build pass;
- API payloads/errors agree;
- owner/read-only authorization tests pass;
- dry-run migrations are clean;
- RingCentral pre-push production backfill/validation is explicitly authorized
  and completed before registry-only consumer push/deploy;
- rollback instructions are reviewed;
- no historical database/model code changed;
- no runtime static RingCentral fallback remains after cutover;
- no production mutation or deployment is performed implicitly.

## 9. Handoff template

```markdown
## Operations Registry work-package handoff

- Repository:
- Branch:
- Base SHA:
- Head SHA:
- Work package:
- Integration branch expected:

### Delivered

- Specification sections:
- Behavior:
- API/schema changes:
- Compatibility:

### Files

- Added:
- Modified:
- Intentionally untouched:

### Verification

- Commands:
- Results:
- Tests not run and why:

### Operational notes

- Migration:
- Environment/config:
- External services:
- Rollback:

### Risks and next step

- Known risks:
- Blocking issues:
- Recommended next work package/branch:
```
