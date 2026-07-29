# Implementation Unit 5 — Dashboard Registry, Catalog, Source, and CPL UI (D0–D3)

Status: Execution brief derived from the approved Operations Registry plan
Date: 2026-07-29
Repository: `vantage-admin`
Work packages: D0, D1, D2, D3

## 1. Purpose and authority

This unit creates the Admin Dashboard Operations Registry workspace, signed
actor transport, Agent/Merchant lifecycle UI, first-class Source
Company/Granularity UI, and temporal CPL editors/correction workflow.

Before each package read:

1. all four authority documents in `vantage-main-server/docs/current_plans/`;
2. the relevant server package handoff (S1 for D0, S2 for D1, S3 for D2,
   S4/S5 for D3);
3. `vantage-admin/NEXTJS_AGENTS.md`;
4. the relevant checked-in Next.js 16 docs under `.next-docs/`, especially
   Proxy, route handlers/backend-for-frontend, data mutation, caching/
   revalidation, error handling, and testing;
5. `vantage-admin/.cursor/rules/project-organization.mdc`.

This brief supplies file-level context. Server payloads/errors and the approved
plans remain authoritative. Do not invent a browser contract to compensate for
an incomplete server package; coordinate a contract update through the
integration owner.

## 2. Sequence and server gates

```text
D0 after S1 contract
  -> D1 after S2
  -> D2 after S3
      -> D3 schedule UI after S4
      -> D3 correction UI after S5
```

Use separate D0–D3 branches and handoffs even if one agent executes this unit.
Merge each into the dashboard `feature/operations-registry` integration branch
before starting dependent work. Signed proxy transport must be deployable
before the server enables fail-closed production signature enforcement.

## 3. Dashboard-wide conventions

- Browser code calls local `/api/proxy/api/v1/admin/...`; it never calls the
  main server directly or receives server secrets.
- `VANTAGE_ADMIN_PROXY_SIGNING_SECRET` is server-only and must not use a
  `NEXT_PUBLIC_` name.
- Main-server success/error envelopes, stable codes, `issues`, conflict
  remediation, and `request_id` must survive the proxy.
- Use TanStack Query keys in `lib/query/keys.ts`; do not create ad hoc string
  keys in components.
- Lists are active-only by default with an explicit “Show inactive” control.
- Existing inactive values remain editable/selectable in explicit Owner
  correction workflows with a warning.
- Non-Owner authenticated dashboard roles can read registry state but cannot
  mutate it.
- No delete action appears.
- Stable keys/phone identity become read-only according to server lock state.
- Display New York business dates without interpreting them in the browser's
  local timezone.
- Render stable server conflicts inline; do not reduce them to a generic toast.

## 4. D0 — Registry shell and signed actor transport

### Signed proxy request

Current relevant files:

- `app/api/proxy/[...path]/route.ts`
- `server/auth/trustedProxyHeaders.ts`
- `server/auth/trustedProxyHeaders.test.ts`
- `server/auth/request.ts`
- `server/auth/authorization.ts`
- `server/auth/authorization.test.ts`
- `server/vantage-api/client.ts`
- `server/vantage-api/response.ts`
- `server/vantage-api/errors.ts`
- `server/audit/auditLog.ts`
- `lib/env/server.ts`
- `.env.example`

Add canonical HMAC signing coordinated exactly with S1. Generate a request ID,
sign normalized admin ID/email/role, timestamp, request ID, method, and path,
then forward the same request ID into the main-server Registry Change and local
`AdminAuditLog` correlation.

Do not sign mutable/ambiguous values differently between repositories. Add
shared contract fixtures that prove byte-for-byte canonicalization. Test valid,
missing, expired, tampered, method/path mismatch, and role cases. Keep the
secret out of browser bundles and logs.

Update proxy authorization so Owner may mutate registry endpoints and other
approved admin roles may GET them only. Existing admin write allowances for
legacy Agent/Merchant endpoints do not override registry Owner-only rules.

### Navigation and role access

Current Settings is Owner-only in parts of:

- `app/(dashboard)/settings/page.tsx`
- `components/settings/settings-tabs.tsx`
- `components/layout/dashboard-nav.tsx`
- `components/layout/dashboard-shell.tsx`
- `server/auth/routeGuard.ts`
- `proxy.ts`

The approved contract requires read-only registry access for other authenticated
dashboard roles. Choose a route/navigation shape that permits this without
opening unrelated Owner settings. Register it consistently in navigation,
shell gating, route guards, and proxy authorization.

Add a registry shell with Overview/Health and future sub-navigation. Useful
patterns:

- `components/observational/observational-dashboard.tsx`
- `components/observational/observational-overview.tsx`
- `components/data-table/table-states.tsx`

### API/query interface

Add a registry client/type module (for example
`lib/api/operationsRegistry.ts`) and `queryKeys.operationsRegistry` for:

```text
GET /api/v1/admin/operations-registry/overview
GET /api/v1/admin/operations-registry/health
GET /api/v1/admin/operations-registry/changes
```

Model stable registry/CPL/RingCentral codes and preserve safe remediation data.
Avoid the generic request helper behavior that discards structured issues.

### D0 acceptance

- Owner mutation succeeds through the signed local proxy.
- Admin reads succeed and mutation attempts fail at UI/proxy/server.
- Tampered/expired signatures render a controlled forbidden error.
- The same request ID appears in proxy audit and server mutation evidence.
- Overview/Health shell has loading, retry/error, and empty states.
- Signing secret is absent from client code/bundle.

## 5. D1 — Agent and Merchant UI

### Existing implementation to refactor

- `components/settings/catalog-manager.tsx`
- `lib/api/catalog.ts`
- `lib/api/use-catalog-options.ts`
- `lib/api/facets.ts`
- `components/forms/booking-form.tsx`
- `components/operational/operational-resource-page.tsx`
- `docs/dynamic-agents-and-merchants.md`

Do not merely add fields to the current PATCH-only activation flow. Use the S2
create/update, activation, and dependency endpoints. Add list/create/rename,
dependency preview, deactivate/reactivate with optional reason, active-only
default, and “Show inactive”.

Display embedded Granot identity status. A configured username is read-only;
verification/last-observed state is informational. Render immutable-field,
duplicate-identifier, and dependency conflicts inline.

### Inactive selection behavior

Catalog options remain active-only for new ordinary selections. When editing an
existing Booking that already stores an inactive Agent/Merchant, retain it as a
labeled choice rather than forcing replacement. Explicit Owner corrective
selection may include inactive values and shows a warning before submission.

After mutation invalidate registry, catalog, facets, affected lists/search, and
Analytics filter/performance queries. Centralize invalidation rather than
duplicating incomplete lists in every component.

### D1 acceptance

- create/rename/deactivate/reactivate uses registry-backed endpoints;
- dependency preview occurs before deactivation;
- configured Granot username cannot be edited;
- inactive records are hidden by default and labeled when shown;
- existing inactive booking values remain editable;
- automatic/default selectors remain active-only;
- no delete control exists;
- Owner/read-only role behavior agrees with proxy/server.

## 6. D2 — Source Company and Granularity UI

### Replace the embedded-array editor

Current files:

- `components/settings/source-company-manager.tsx`
- `lib/api/sourceCompanies.ts`
- `lib/api/facets.ts`
- `lib/constants/domain.ts`
- `components/forms/booking-form.tsx`
- `app/api/employee-booking/options/route.ts`

The current manager PATCHes a whole embedded `granularities[]` array and stores
embedded CPL/phone data. Do not extend that shape. Replace it with Source
Company detail plus first-class Source Granularity rows, each mutated through
its dedicated ID/endpoint. Company metadata saves must never submit the full
granularity array.

### Required workflows

Implement:

- Source Company draft/create/edit/lifecycle/dependency preview;
- first-class form/call granularity create/edit/lifecycle/dependency preview;
- default form/call selection with server invariant feedback;
- exact/default/fallback resolution preview and conflict explanation;
- company-level workbook/container ID;
- granularity-level sheet tab;
- `derived_import` default;
- explicit `direct_write` opt-in with complete mapping validation;
- active-only defaults and explicit inactive Owner corrective selection.

Render `company_slug`, `granularity_key`, and locked channel as read-only when
the server says they are immutable. Deactivating a current default must collect
a same-command replacement or clearly surface the server conflict.

Use registry source endpoints from the technical contract, including
`POST /api/v1/admin/source-resolution/preview`.

### Consumer transition

Facets, booking source options, and employee-booking option routes should load
registry-backed companies/granularities rather than compile-time
`SOURCE_COMPANIES` or embedded arrays after their server cutover. Static labels
may remain temporary display fallbacks only if documented.

Storing sheet metadata never implies direct source-sheet writes. The dashboard
must not claim a workbook/tab is actively written merely because IDs exist.

### D2 acceptance

- detail UI uses first-class granularity ObjectIds;
- company and granularity commands are independent;
- no replace-all embedded array request remains;
- default/channel/active invariants render actionable feedback;
- conflict preview distinguishes exact/default/fallback/ambiguous outcomes;
- Owner-created companies appear in supported selectors;
- sheet metadata ownership and projection mode are correct;
- stable keys are read-only after lock;
- no delete control exists.

## 7. D3 — CPL UI

### Retire the legacy editing experience

Current files:

- `components/settings/cpl-rate-manager.tsx`
- `lib/api/cplRates.ts`
- `components/settings/settings-tabs.tsx`
- `lib/floridaTime.ts`

The existing CPL editor PATCHes label slots and triggers legacy Lead rewrites.
It must not remain the normal editor. Demote it to explicit read-only
compatibility or remove it from primary navigation when S4 is authoritative.
Never call legacy CPL PATCH from the new UI.

### Simple Mode

Build a table from `GET /api/v1/admin/cpl/snapshot`:

- one current value/revision per active Source Granularity;
- one shared effective date defaulting to today in New York;
- changed-row tracking;
- one atomic Update action;
- explicit $0.00 support;
- no submission when nothing changed.

POST only changed rows and each expected revision. If any revision is stale,
preserve the user's edits, show current server revisions/schedules, and do not
present partial success.

### Advanced Mode

For one granularity, show past/current/future periods and issue explicit
discriminated schedule commands. Render inclusive owner dates while respecting
the server's exclusive storage end. Surface gap, overlap, stale revision, and
activation coverage errors inline. Do not PATCH arbitrary period fields.

### Production corrections

After S5, add:

1. bounded preview with affected counts/examples;
2. explicit confirmation and optional reason;
3. submit using preview hash and target schedule revision;
4. job status/progress polling;
5. completed, partial-failure, failed, and cancelled states;
6. cancel action where allowed;
7. stale-preview recovery that requires a fresh preview.

Ordinary schedule edits must never imply prior Leads changed. Label correction
as a separate production workflow with clear impact and rollback language.

### Analytics and health links

After schedule/correction mutation invalidate registry, CPL, Analytics, affected
detail/list, facets, and audit queries. Missing-rate findings should link to the
relevant granularity/schedule/correction context. Explicit zero is visually
distinct from unresolved/missing.

### D3 acceptance

- Simple Mode sends changed rows only and is all-or-nothing;
- shared date uses New York calendar semantics;
- stale revision preserves edits and supplies a refresh/reconcile path;
- Advanced Mode shows period state and actionable schedule errors;
- $0.00 is valid and not shown as missing;
- normal edits never call the legacy update/backfill route;
- correction requires preview/confirmation and displays durable progress;
- stale preview cannot apply;
- Owner/read-only behavior and query invalidation are correct.

## 8. Likely new module layout

Use existing project conventions; a coherent layout may include:

```text
lib/api/operationsRegistry.ts
lib/api/registryAgents.ts
lib/api/registryMerchants.ts
lib/api/registrySources.ts
lib/api/registryCpl.ts
server/auth/proxySigning.ts
components/operations-registry/
  registry-shell.tsx
  agents-manager.tsx
  merchants-manager.tsx
  source-companies/
  source-granularities/
  cpl/
```

This is guidance, not a requirement to create shallow pass-through files. Keep
the browser-facing interface small and place error normalization, invalidation,
and request behavior behind shared modules.

## 9. Verification

Run focused tests for signing, authorization, query keys, structured errors,
source form payloads, changed-row calculation, date display, and correction
state transitions. At each package handoff run at least:

```text
pnpm typecheck
pnpm test
```

At the Unit 5 integration gate run:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Do not use a live production API/provider for automated tests. Contract tests or
safe local smoke tests should target an S1–S5 compatible server.

## 10. Unit completion evidence

Provide separate D0–D3 handoffs containing:

- server package/contract SHA used;
- signed payload fixture and auth matrix;
- route/navigation decision enabling admin read-only access;
- API/type/query-key changes;
- legacy UI removed/demoted and compatibility behavior;
- Owner versus read-only test results;
- inactive selection/dependency behavior;
- proof source saves do not submit embedded arrays;
- CPL changed-row, revision conflict, zero/missing, and correction results;
- invalidation targets;
- lint/typecheck/test/build results;
- screenshots or safe local smoke notes where useful;
- rollback point and dashboard integration merge SHAs.

Unit 5 is complete after D3 (including S5 correction UI) is merged and the
dashboard integration branch passes all four validation commands.
