# Unit 06 completion — Registry migration, automation compatibility link, and reviewed Registry UI

## Status and scope

- **Status:** complete
- **Repositories / branches:** `vantage-main-server` / `granot-lead-lifecycle`; `vantage-admin` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–8, 29.4, 34.2, 34.5, 35–36, 37.1–37.2, 38/S04, and 39–40
- **Acceptance ownership:** migration/routing foundation of AC-09; migration/provider-separation portion of AC-29; migration, compatibility, audit, and fail-closed portion of AC-38
- **Applicable invariants preserved:** 1, 2, 5, 8, 9, and 10
- **Runtime posture:** reviewed source classification and automation references can be planned and applied through audited Unit 05 commands. No lifecycle flags, processor, Decision, Record Link, or Lead/Booking/Cancellation effect. Best Relocation creation policy remains `link_only`. `src/config/domain/granotLifecycle.ts` was not created.

## Files added or changed

### Server — automation compatibility

- `src/models/GranotAutomationSource.ts` — optional `granot_crm_source` plus named non-unique `{ granot_crm_source: 1, active: 1 }`
- `src/models/GranotAutomationSource.test.ts`
- `src/models/OperationsRegistryChange.ts` — `entity_type` adds `granot_automation_source`
- `src/services/granotLifecycle/automationCompatibility.ts` — issue-author status/code vocabulary
- `src/services/granotLifecycle/automationCompatibility.test.ts`
- `src/services/granotHttpCollector/sourceCatalog.ts` — list/create remain label + `supported_operations`; projections add `compatibility`; resolve dereferences Registry and fails closed with `INVALID_GRANOT_SOURCES`
- `src/services/granotHttpCollector/sourceCatalog.test.ts`

### Server — Registry commands, projections, and routes

- `src/services/operationsRegistry/granotAutomationSources.ts` — audited `setGranotAutomationSourceReference`
- `src/services/operationsRegistry/granotAutomationSources.test.ts` — injected transaction/audit/replay/rollback
- `src/services/operationsRegistry/granotCrmSourceProjections.ts` — dependency, automation, and latest-audit list/detail
- `src/services/operationsRegistry/index.ts`
- `src/validation/v1/admin.validation.ts` / `src/validation/v1.validation.ts` — update/activation schemas; no `normalized_granot_label` or `create_if_missing`
- `src/routes/v1.routes.ts` — thin `GET/PATCH /api/v1/admin/granot-crm-sources` and activation
- `src/routes/v1.routes.test.ts`
- `src/routes/granot-crm-sources.routes.test.ts`
- `src/routes/granot-automation.routes.test.ts`

### Server — migration and indexes

- `scripts/migrations/granot-lifecycle-source-registry.manifest.ts` — checked-in reviewed families; no ObjectIds
- `scripts/migrations/granot-lifecycle-source-registry.lib.ts` — pure planner
- `scripts/migrations/granot-lifecycle-source-registry.ts` — `--report|--apply|--verify`
- `scripts/migrations/granot-lifecycle-source-registry.test.ts`
- `scripts/migrations/granot-lifecycle-indexes.ts` / `.lib.ts` / `.test.ts` — script version `granot-lifecycle-indexes/4`; unique normalized-label apply allowed only after zero collisions
- `package.json` — `migration:granot-lifecycle:sources`

### Admin

- `lib/api/registryGranotCrmSources.ts` + `.test.ts`
- `components/operations-registry/granot-crm-sources-manager.tsx`
- `components/operations-registry/registry-shell.tsx` — `Granot sources` tab
- `lib/query/keys.ts` + `.test.ts`
- `lib/api/registryInvalidation.ts` + `.test.ts` — also invalidates Granot Automation queries
- `server/auth/authorization.ts` + `.test.ts`
- `lib/api/registryEntityLinks.ts` + `.test.ts`
- `lib/api/granotAutomation.ts` — additive compatibility
- `lib/granotAutomationSelection.ts` + `.test.ts` — unavailable rows stay visible and cannot be submitted
- `components/ingestion/granot-automation-dashboard.tsx`
- `tests/granot-crm-sources-manager.test.ts`

### Docs

- Server: `operationsRegistry.service.md`, `granotLifecycle.sourcePolicy.md`, `granotHttpCollector.service.md`, `project-organization.mdc`, `operations-registry.mdc`, `granot-http-automation.mdc`, `.cursor/index.md`, `scripts/migrations/README.md`
- Admin: `.cursor/rules/project-organization.mdc`, `docs/owner-dashboard-features.txt`

## Reviewed classification

Issue-author literals: `lifecycle_policy_version = "granot-lifecycle-source-policy-v1"`; routes `call_any`, `form_local`, `form_long_distance`.

| Exact normalized labels | Result |
| --- | --- |
| `bestrelocation inbounds`, `best relocation inbounds` | Call family; `source_scoped_lead`; `link_only`; company `best_relocation_leads`; route `call_any` → `best_relocation_leads_call` |
| `bestrelocation forms`, `best relocation forms` | Form family; `source_scoped_lead`; `link_only`; same company; `form_local` + `form_long_distance` |
| `referral` | `referral_booking` / `observation_only`; no Lead routes |
| `paid overflow`, `auto` | lifecycle-disabled / `deferred` / `observation_only`; evidence-only |
| unmatched / colliding / invalid deps | lifecycle-disabled / `deferred`; no guessed routes; whole reviewed family refused |

Provider payload `type=AUTO` is excluded and is not a classification input. Manifest contains no ObjectIds.

## Automation compatibility

```ts
status: ready | missing_reference | source_disabled | source_ambiguous | operation_not_permitted
codes: granot_crm_source_reference_missing | _disabled | _ambiguous | _operation_not_permitted
```

`ready` requires one referenced, operationally enabled, lifecycle-enabled, non-deferred Registry row whose validated routes permit the requested operation. List/create keep legacy label/`supported_operations` fields. New automation labels are `missing_reference`. Resolve never falls back to label or `supported_operations` as authority.

## Verification

Focused server command (Unit 06 list plus route/compatibility replacements):

```text
node --import tsx --import ./scripts/test-setup.ts --test scripts/migrations/granot-lifecycle-source-registry.test.ts scripts/migrations/granot-lifecycle-indexes.test.ts src/models/GranotAutomationSource.test.ts src/services/granotLifecycle/automationCompatibility.test.ts src/services/granotHttpCollector/sourceCatalog.test.ts src/services/operationsRegistry/granotCrmSources.test.ts src/services/operationsRegistry/granotAutomationSources.test.ts src/services/granotLifecycle/sourcePolicy.test.ts src/routes/granot-crm-sources.routes.test.ts src/routes/v1.routes.test.ts src/routes/granot-automation.routes.test.ts
```

- **62 passed, 0 failed, 1 skipped.**
- Skipped: `[AC-38] replica-set create...` — opt-in via `GRANOT_LIFECYCLE_REPLICA_TESTS=true`. Local replica-set commit is **not claimed**. Injected `withRegistryMutation` ordering/rollback/cache-after-commit tests for CRM policy and automation references passed.

Full server:

```text
pnpm test
pnpm typecheck
```

- **1032 passed, 0 failed, 1 skipped** (same opt-in replica-set test).
- Typecheck **passed.**

Admin:

```text
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

- Tests **180 passed, 0 failed.**
- Lint **passed.**
- Typecheck **passed.**
- Build **passed** (retried with `NODE_OPTIONS=--max-old-space-size=8192` after an earlier host OOM).

`git diff --check` in both repositories: **passed.**

## AC-to-proof coverage

| AC | Unit 06 foundation | Proof |
| --- | --- | --- |
| AC-09 | Form local/long-distance routes; same valid states → local; different → long-distance; invalid/missing → none; migration stays `link_only` | `granot-lifecycle-source-registry.test.ts`, `sourcePolicy.test.ts`, `automationCompatibility.test.ts` |
| AC-29 | Paid Overflow / source Auto deferred evidence-only; provider `type=AUTO` excluded | `granot-lifecycle-source-registry.test.ts`, `sourcePolicy.test.ts` |
| AC-38 | unmatched/collision/invalid deps fail closed; automation link only for one exact-normalized reviewed match; replay no-op; audit failure unapplies; unique index refused on collision; Admin/API fail closed | source-registry + index tests, `granotAutomationSources.test.ts`, `sourceCatalog.test.ts`, `granot-crm-sources.routes.test.ts`, Admin API/selection/authorization tests |

## Migrations, indexes, flags, and effects

- **Source migration:** `pnpm migration:granot-lifecycle:sources -- --report|--apply|--verify`. Script version `granot-lifecycle-source-registry/1`. Omitted mode is report. Production apply was **not** run and is **not** authorized.
- **Index catalog:** version `granot-lifecycle-indexes/4`. Non-unique source/automation indexes first. `GRANOT_CRM_SOURCE_UNIQUE_INDEX_APPLY_ENABLED = true` in code, but unique apply is still refused while collisions exist. Production index apply was **not** run.
- **Starting/ending lifecycle flags:** none/none.
- Best Relocation `lead_created_policy` remains `link_only`. Referral remains `observation_only`.
- Zero Lead/Booking/Cancellation/Decision/Record Link/case/Sheet Sync/notification mutations.

## Masked staging / live verification

Not run. No production/staging inventory, no live labels/payloads, and no source/index apply against a live database. Synthetic Registry IDs/labels only.

## Known risks and deferred work

- Live Mongo replica-set transaction proof remains unverified until a disposable `testvantagemovers` replica set is available and `GRANOT_LIFECYCLE_REPLICA_TESTS=true` is set before process start.
- Source/index apply against any real database still requires separate Owner authorization after a reviewed report.
- Unique normalized-label index must not be applied while collisions remain.
- `create_if_missing` stays unselectable (Unit 19).
- Channel-neutral lifecycle apply remains Unit 17. Processor/Decision/activation remain Unit 07.
- Existing Granot Automation collection/preview behavior is retained; apply resolution now fails closed on incompatible sources.

## Newly unblocked

Units 04–06 are complete. Successful Unit 06 verification unblocks **Unit 07**. Shared-branch implementation remains sequential; Unit 09 stays blocked unless an integration owner explicitly authorizes non-overlapping work.

## Final `git status --short`

### vantage-main-server (`granot-lead-lifecycle`)

```text
 M .cursor/businesslogic/granotHttpCollector.service.md
 M .cursor/businesslogic/granotLifecycle.sourcePolicy.md
 M .cursor/businesslogic/operationsRegistry.service.md
 M .cursor/index.md
 M .cursor/rules/granot-http-automation.mdc
 M .cursor/rules/operations-registry.mdc
 M .cursor/rules/project-organization.mdc
 M package.json
 M scripts/migrations/README.md
 M scripts/migrations/granot-lifecycle-indexes.lib.ts
 M scripts/migrations/granot-lifecycle-indexes.test.ts
 M scripts/migrations/granot-lifecycle-indexes.ts
 M src/models/GranotAutomationSource.ts
 M src/models/OperationsRegistryChange.ts
 M src/routes/granot-automation.routes.test.ts
 M src/routes/v1.routes.test.ts
 M src/routes/v1.routes.ts
 M src/services/granotHttpCollector/sourceCatalog.test.ts
 M src/services/granotHttpCollector/sourceCatalog.ts
 M src/services/operationsRegistry/index.ts
 M src/validation/v1.validation.ts
 M src/validation/v1/admin.validation.ts
?? scripts/migrations/granot-lifecycle-source-registry.lib.ts
?? scripts/migrations/granot-lifecycle-source-registry.manifest.ts
?? scripts/migrations/granot-lifecycle-source-registry.test.ts
?? scripts/migrations/granot-lifecycle-source-registry.ts
?? src/models/GranotAutomationSource.test.ts
?? src/routes/granot-crm-sources.routes.test.ts
?? src/services/granotLifecycle/automationCompatibility.test.ts
?? src/services/granotLifecycle/automationCompatibility.ts
?? src/services/operationsRegistry/granotAutomationSources.test.ts
?? src/services/operationsRegistry/granotAutomationSources.ts
?? src/services/operationsRegistry/granotCrmSourceProjections.ts
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-06-COMPLETION.md
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
```

### vantage-admin (`granot-lead-lifecycle`)

```text
 M .cursor/rules/project-organization.mdc
 M components/ingestion/granot-automation-dashboard.tsx
 M components/operations-registry/registry-shell.tsx
 M docs/owner-dashboard-features.txt
 M lib/api/granotAutomation.ts
 M lib/api/registryEntityLinks.test.ts
 M lib/api/registryEntityLinks.ts
 M lib/api/registryInvalidation.test.ts
 M lib/api/registryInvalidation.ts
 M lib/granotAutomationSelection.test.ts
 M lib/granotAutomationSelection.ts
 M lib/query/keys.test.ts
 M lib/query/keys.ts
 M server/auth/authorization.test.ts
 M server/auth/authorization.ts
?? components/operations-registry/granot-crm-sources-manager.tsx
?? lib/api/registryGranotCrmSources.test.ts
?? lib/api/registryGranotCrmSources.ts
?? tests/granot-crm-sources-manager.test.ts
```

No commit, push, deploy, production mutation, live payload exposure, external call, or external send occurred.
