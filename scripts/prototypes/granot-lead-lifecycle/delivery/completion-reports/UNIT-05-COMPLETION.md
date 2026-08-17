# Unit 05 completion — Audited Granot CRM source Registry domain

## Status and scope

- **Status:** complete
- **Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–8.1, 8.4, applicable 23 provenance/transaction expectations, 27, 35–36, 37.1–37.2, and 38/S04 server-domain half
- **Acceptance ownership:** Registry-domain/fail-closed foundations of AC-04, AC-09, AC-29, and AC-38
- **Applicable invariants preserved:** 1, 2, 5, 8, 9, and 10
- **Runtime posture:** `GranotCrmSource` can represent lifecycle policy; Owner Registry commands mutate Registry only; `sourcePolicy.ts` resolves and evaluates gates. No flags, activation, processor, classification, automation link, Admin UI, or Lead/Booking/Cancellation effect.

## Files added or changed

### Model, semantics, and shared normalizer

- `src/models/GranotCrmSource.ts` — Section 8.1 fields/defaults, three named lifecycle indexes, `autoIndex: false`, contextual validate hook. Existing CSV fields/indexes preserved. Legacy string `source_company` is not reused as `lead_source_company`.
- `src/models/granotCrmSourceSemantics.ts` — shared structural/contextual validator used by model writes and Registry commands.
- `src/models/GranotCrmSource.test.ts` — fields/defaults/indexes/normalization plus the validation matrix.
- `src/models/OperationsRegistryChange.ts` — `entity_type` adds `granot_crm_source`.
- `src/services/granotLifecycle/sourceLabel.ts` — one exported NFKC/trim/collapse/lowercase normalizer; control/bidi rejection; USPS state + Form move-type selection.
- `src/services/granotLifecycle/normalization.ts` — Observation source-label lookup now calls the shared normalizer.

### Registry commands, audit, and cache

- `src/services/operationsRegistry/granotCrmSources.ts` — `listRegistryGranotCrmSources`, `getRegistryGranotCrmSource`, `createOrUpdateGranotCrmSource`, `setGranotCrmSourceLifecycleEnabled`.
- `src/services/operationsRegistry/granotCrmSources.test.ts` — Owner-only, reason, in-transaction validation, sanitized `granot_crm_source` audit, replay conflict, rollback without cache invalidation, read-after-write. Opt-in replica-set test is present.
- `src/services/operationsRegistry/granotCrmSourceCache.ts` — policy/list/health keys; contents are policy projections.
- `src/services/operationsRegistry/registryAudit.test.ts` — `granot_crm_source` rollback/cache regression.
- `src/services/operationsRegistry/index.ts` — public exports.

### Runtime policy and gates

- `src/services/granotLifecycle/sourcePolicy.ts` — sole runtime semantic read boundary and pure seven-layer gate evaluator.
- `src/services/granotLifecycle/sourcePolicy.test.ts` — `[AC-04]` `[AC-09]` `[AC-29]` `[AC-38]` foundation proofs.

### Indexes

- `scripts/migrations/granot-lifecycle-indexes.ts` / `.lib.ts` / `.test.ts` — normalized-label collision report (masked IDs); `GRANOT_CRM_SOURCE_UNIQUE_INDEX_APPLY_ENABLED = false`; script version `granot-lifecycle-indexes/3`. Unique production apply did not run.

### Docs

- `.cursor/businesslogic/granotLifecycle.sourcePolicy.md`
- `.cursor/businesslogic/granotLifecycle.normalization.md`
- `.cursor/businesslogic/operationsRegistry.service.md`
- `.cursor/index.md`
- `.cursor/rules/project-organization.mdc`
- `.cursor/rules/operations-registry.mdc`
- `.cursor/rules/schema-and-crud-inputs.mdc`
- `.cursor/rules/business-logic.mdc`
- `.cursor/rules/granot-lifecycle-capture.mdc`

## Exact model fields, defaults, and index names

Additive fields:

- `normalized_granot_label?: string`
- `lifecycle_enabled` default `false`
- `lifecycle_disposition` default `"deferred"`
- `lead_created_policy` default `"observation_only"`
- `lead_source_company?: ObjectId`
- `lifecycle_routes` default `[]`
- `lifecycle_policy_version` default `""` (required only when lifecycle-enabled)

Named lifecycle indexes:

- `granot_crm_source_normalized_label_unique` — `{ normalized_granot_label: 1 }` unique (declared/tested, not applied)
- `granot_crm_source_lifecycle_disposition_label` — `{ lifecycle_enabled: 1, lifecycle_disposition: 1, normalized_granot_label: 1 }`
- `granot_crm_source_lifecycle_route_granularity` — `{ "lifecycle_routes.source_granularity_id": 1 }`

Preserved: unique `{ crm_origin, workspace_slug }` and CSV-path indexes. Operational `enabled` remains distinct from `lifecycle_enabled`.

## Normalization, validation, resolver, and gates

- Shared algorithm: Unicode NFKC, trim, collapse internal whitespace to one ASCII space, lowercase; reject empty and all `\p{Cc}`/`\p{Cf}` characters.
- Client-supplied `normalized_granot_label` that disagrees with the server-normalized `granot_label` fails closed.
- Call routing: exactly one `CallLead + any`. Form routing: exactly one `FormLead + any`, or exactly one local plus one long-distance. Mixed/ambiguous selectors fail.
- `referral_booking` / `deferred`: no Lead routes and `observation_only`. `create_if_missing` is legal only for `source_scoped_lead`.
- Lifecycle-enabled rows require operational `enabled`, nonempty policy version, and active same-company/matching-channel refs. Disabled rows may keep reviewed policy but still reject illegal route shapes.

Resolver results use frozen vocabulary only:

- zero matches → `policy_blocked` / `source_unclassified`
- multiple normalized rows → `ambiguous` / `multiple_eligible_matches`
- disabled → `policy_blocked` / `source_disabled`
- deferred → `deferred` / `source_deferred`

Gate snapshot order: `global_effect_flag`, `post_activation_live_mode`, `operational_enabled`, `lifecycle_enabled`, `disposition_permits_effect`, `source_company_active`, `source_granularity_active`, `policy_permits_effect`. Layer 3 is recorded as two named booleans. Deferred maps to `deferred`; other disabled gates map to `policy_blocked`.

## Registry commands and audit

- Writes require trusted Owner `RegistryActorContext`, unique `request_id`, explicit reason, and the complete intended semantic state.
- Commands: `createOrUpdateGranotCrmSource`, `setGranotCrmSourceLifecycleEnabled`, plus reads `getRegistryGranotCrmSource` / `listRegistryGranotCrmSources`.
- Mutation + one sanitized `OperationsRegistryChange` (`entity_type: "granot_crm_source"`) share `withRegistryMutation`. Duplicate `request_id` remains `REGISTRY_DUPLICATE_IDENTIFIER`.
- Cache keys invalidated only after commit: `granot_lifecycle_source_policy`, `granot_lifecycle_source_list`, `granot_lifecycle_source_health`.
- No `DomainCommandExecution` or `EntityChange` is written.

## Verification

Focused command (exact Unit 05 list):

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/models/GranotCrmSource.test.ts" "src/services/operationsRegistry/granotCrmSources.test.ts" "src/services/operationsRegistry/registryAudit.test.ts" "src/services/granotLifecycle/sourcePolicy.test.ts" "scripts/migrations/granot-lifecycle-indexes.test.ts"
```

- **35 passed, 0 failed, 1 skipped.**
- Skipped: `[AC-38] replica-set create...` — opt-in via `GRANOT_LIFECYCLE_REPLICA_TESTS=true`. Local `127.0.0.1:27017` was **closed**. Injected `withRegistryMutation` ordering/rollback/cache-after-commit tests passed. Live disposable replica-set commit is **not claimed**.

Full repository command:

```text
pnpm test
```

- **1016 passed, 0 failed, 1 skipped** (the same opt-in replica-set test).

TypeScript:

```text
pnpm typecheck
```

- **passed.**

`git diff --check`: **passed.**

## AC-to-proof coverage

| AC | Unit 05 foundation | Proof |
| --- | --- | --- |
| AC-38 | zero/multiple/inactive/ambiguous never pick a row/route; audit+cache after commit; collision report; no unique apply | `sourcePolicy.test.ts`, `granotCrmSources.test.ts`, `registryAudit.test.ts`, `granot-lifecycle-indexes.test.ts` |
| AC-09 | same valid states → local; different → long-distance; missing/invalid → none | `sourcePolicy.test.ts` (synthetic configured rows) |
| AC-29 | deferred Paid Overflow / Auto authorize no effect; `type=AUTO` is not classification input | `sourcePolicy.test.ts` |
| AC-04 | ineligible Source Scope fails gates; no reassignment/mutation output | `sourcePolicy.test.ts` gate evaluator |

## Migrations, indexes, flags, and effects

- **Data migration:** none. No `normalized_granot_label` backfill. No classification. No production apply.
- **Index collision report:** implemented and tested; unique apply remains disabled (`GRANOT_CRM_SOURCE_UNIQUE_INDEX_APPLY_ENABLED = false`).
- **Starting/ending lifecycle flags:** none/none. `src/config/domain/granotLifecycle.ts` was not created.
- All rows default lifecycle-disabled + deferred + observation-only + empty routes.
- Zero Lead/Booking/Cancellation/Decision/case/Sheet Sync/notification mutations.

## Masked staging / live verification

Not run. No production/staging inventory, no live labels/IDs, and local Mongo was closed. Synthetic Registry IDs/labels only.

## Known risks and deferred work

- Live Mongo replica-set transaction proof remains unverified until a disposable `testvantagemovers` replica set is available and `GRANOT_LIFECYCLE_REPLICA_TESTS=true` is set before process start.
- Unit 06 owns inventory, reviewed aliases, `GranotAutomationSource.granot_crm_source`, classification writes, unique-index apply after a zero-collision report, compatibility UI, and production apply.
- `create_if_missing` is representable but not rolled out (Unit 19 / S13).
- Later AC-04/09/29/38 end-to-end processor/UI assertions remain later units.
- Existing operational `enabled` default `true` is unchanged and is not lifecycle authorization.

## Newly unblocked

Successful Unit 05 verification unblocks **Unit 06**. Shared-branch implementation remains sequential; Unit 09 stays blocked unless an integration owner explicitly authorizes non-overlapping work.

## Final `git status --short`

```text
 M .cursor/businesslogic/granotLifecycle.normalization.md
 M .cursor/businesslogic/operationsRegistry.service.md
 M .cursor/index.md
 M .cursor/rules/business-logic.mdc
 M .cursor/rules/granot-lifecycle-capture.mdc
 M .cursor/rules/operations-registry.mdc
 M .cursor/rules/project-organization.mdc
 M .cursor/rules/schema-and-crud-inputs.mdc
 M scripts/migrations/granot-lifecycle-indexes.lib.ts
 M scripts/migrations/granot-lifecycle-indexes.test.ts
 M scripts/migrations/granot-lifecycle-indexes.ts
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M src/models/GranotCrmSource.ts
 M src/models/OperationsRegistryChange.ts
 M src/services/granotLifecycle/normalization.ts
 M src/services/operationsRegistry/index.ts
 M src/services/operationsRegistry/registryAudit.test.ts
?? .cursor/businesslogic/granotLifecycle.sourcePolicy.md
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-05-COMPLETION.md
?? src/models/GranotCrmSource.test.ts
?? src/models/granotCrmSourceSemantics.ts
?? src/services/granotLifecycle/sourceLabel.ts
?? src/services/granotLifecycle/sourcePolicy.test.ts
?? src/services/granotLifecycle/sourcePolicy.ts
?? src/services/operationsRegistry/granotCrmSourceCache.ts
?? src/services/operationsRegistry/granotCrmSources.test.ts
?? src/services/operationsRegistry/granotCrmSources.ts
```

No commit, push, deploy, production mutation, live payload exposure, external call, or external send occurred.
