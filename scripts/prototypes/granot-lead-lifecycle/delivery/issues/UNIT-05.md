# Unit 05 — Audited Granot CRM source Registry domain

> **Contract maturity: implementation-ready.** This is the server-domain half of S04. It adds the semantic Registry model, trusted audited commands, fail-closed runtime resolution, and pure layered-gate evaluation. It does not classify/migrate existing rows, link automation rows, add Admin UI, or enable lifecycle effects.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–8.1, 8.4, applicable provenance/transaction expectations in 23, 27, 35–36, 37.1–37.2, and 38/S04.
- **Acceptance ownership:** Registry-domain/fail-closed foundations of AC-04, AC-09, AC-29, and AC-38. Unit 06 owns migration/classification/UI completion; later identity/effect units own live end-to-end assertions.
- **Predecessor:** Unit 01 completion and frozen lifecycle unions.
- **Existing Registry authority:** Operations Registry models/services, trusted actor rules, audit transaction helper, cache invalidation, source-company/granularity resolvers, and their tests.
- **Canonical language/execution:** workspace `CONTEXT.md` and delivery runbook.

The final specification wins. `GranotCrmSource` becomes the only semantic registry for a Granot source label; do not add a parallel lifecycle source catalog.

## 2. Objective

Evolve `GranotCrmSource` with exact normalized-label, disposition, creation-policy, route, and policy-version semantics; enforce legal/active routing combinations; expose Owner-only trusted commands whose mutation and redacted audit commit atomically and whose cache invalidation occurs only after commit; resolve runtime policy by exact normalized label with ambiguity/inactivity failing closed; and return a complete named gate snapshot for later Decisions.

Every existing/unreviewed row must remain lifecycle-disabled/deferred by default. Unit 05 makes policy representable and safe; it authorizes no Lead creation, matching mutation, Booking/Release workflow, or production data apply.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server`; branch `granot-lead-lifecycle`.
- **Blocked by:** Unit 01. Shared-branch implementation remains sequential unless an integration owner explicitly authorizes otherwise; normally land after Unit 04.
- Before editing, verify `GranotCrmSource`, `LeadSourceCompany`, `LeadSourceGranularity`, `OperationsRegistryChange`, trusted actor/role parsing, `withRegistryMutation`, source resolution, cache listeners, and current indexes/tests.
- Preserve unrelated/user-owned work. No commit, push, deploy, production mutation/apply, live data inventory, or external send.

## 4. Current-state evidence to verify

Observed on 2026-08-17:

- `GranotCrmSource` currently stores operational CSV identity (`crm_origin`, `workspace_slug`, `granot_label`, channel, `source_company`, paths, `enabled`) but none of the Section 8 lifecycle semantic fields.
- It currently has unique `{ crm_origin, workspace_slug }` plus CSV-path indexes; those remain compatibility/operational indexes.
- `OperationsRegistryChange.entity_type` lacks `granot_crm_source`.
- `withRegistryMutation` already commits mutation plus audit in one transaction, sanitizes snapshots, converts duplicate `request_id` to a stable replay conflict, and invalidates requested caches after commit. Reuse it; do not invent a second audit system.
- Existing source Registry commands are Owner-only and pass a trusted `RegistryActorContext`; follow this boundary.
- Existing source normalization commonly uses lowercase/trim but not the exact NFKC + whitespace-collapse + control/bidi rejection required here.
- No `granotLifecycle/sourcePolicy.ts`, lifecycle flags, activation, Decision model, or lifecycle Registry commands exist.

If current code differs, preserve compatible operational CSV behavior while making lifecycle semantic reads authoritative through the new fields.

## 5. Locked decisions and invariants at risk

### Applicable invariants

- **Invariant 1:** MongoDB Registry rows and audits are authoritative; runtime must not rely on an in-memory/automation parallel catalog.
- **Invariant 2:** Registry policy cannot turn Granot evidence into official Booking/Cancellation authority.
- **Invariant 5:** Registry commands mutate Registry only; later aggregate changes still require canonical domain commands.
- **Invariant 8:** source label/Registry scope, observation channel, ingestion origin, actor, and initiator remain separate.
- **Invariant 9:** policy changes never rewrite Lead creation/submission evidence.
- **Invariant 10:** identity conflict never reassigns Source Company, Source Granularity, Ingestion Origin, or CPL. Gate/policy resolution must return conflict/blocking evidence, not a corrective reassignment.

### Locked defaults

- `lifecycle_enabled = false`.
- `lifecycle_disposition = "deferred"`.
- `lead_created_policy = "observation_only"`.
- `lifecycle_routes = []`.
- `lifecycle_policy_version` is required only when lifecycle is enabled.
- Existing operational `enabled` and new `lifecycle_enabled` are distinct and both must be true for effects.
- Unit 05 performs no initial classification. Unit 06's migration may set reviewed Best Relocation rows to `link_only`, never `create_if_missing`.

## 6. Deliverables and exact contract

### 6.1 `GranotCrmSource` semantic fields

Add exactly:

```ts
normalized_granot_label: string; // NFKC, trim, collapse whitespace, lowercase
lifecycle_enabled: boolean;      // default false
lifecycle_disposition: "source_scoped_lead" | "referral_booking" | "deferred"; // default deferred
lead_created_policy: "link_only" | "create_if_missing" | "observation_only";   // default observation_only
lead_source_company?: ObjectId;
lifecycle_routes: Array<{
  route_key: string;
  lead_model: "FormLead" | "CallLead";
  move_type: "local" | "long_distance" | "any";
  source_granularity_id: ObjectId;
}>;
lifecycle_policy_version: string; // required when enabled
```

Preserve existing fields/indexes/CSV workflows. Do not repurpose legacy `source_company` as `lead_source_company`; migration/compatibility review is Unit 06.

Declare explicit stable names for:

```ts
{ normalized_granot_label: 1 } unique
{ lifecycle_enabled: 1, lifecycle_disposition: 1, normalized_granot_label: 1 }
{ "lifecycle_routes.source_granularity_id": 1 }
```

The unique index is declared/tested but must not be applied to production before Unit 06 inventory proves zero normalized collisions.

### 6.2 Exact normalization and validation

Use one exported normalizer shared by model commands/runtime/migration:

- Unicode NFKC;
- trim leading/trailing whitespace;
- collapse internal whitespace to one ASCII space;
- lowercase;
- reject empty and all control/bidirectional characters rather than stripping them into a usable label.

Validation must be contextual and run on create/update commands as well as model writes:

- route keys are nonempty, stable, control/bidi-safe, and unique within the source;
- no duplicate/ambiguous route selector may validate;
- `source_scoped_lead` requires an active `LeadSourceCompany` and at least one route;
- every route references an active `LeadSourceGranularity` belonging to that company, with matching `lead_model` channel and matching local/long-distance semantics;
- Call routing is exactly one `CallLead + any` route and no Form route;
- Form routing is either exactly one `FormLead + any`, or exactly one local plus one long-distance route; no Call route;
- `referral_booking` and `deferred` have no Lead routes and require `observation_only`;
- `create_if_missing` is legal only for `source_scoped_lead`;
- lifecycle-enabled rows require operational `enabled`, nonempty policy version, and all active-reference/route rules;
- disabled rows may preserve reviewed policy data for later activation but must still reject structurally illegal/ambiguous routes; unreviewed defaults remain deferred/observation-only/empty.

Do not guess missing company/granularity IDs, auto-activate dependencies, or silently rewrite an illegal combination to defaults.

### 6.3 Trusted Registry commands

Add focused commands under `src/services/operationsRegistry/granotCrmSources.ts` for read/detail and create/update/enable-disable lifecycle semantics. Exact command naming may follow current Registry conventions, but all writes must:

- require trusted Owner actor (Admin/read-only roles cannot mutate);
- accept a unique `request_id`, explicit reason for enable/disable or semantic policy change, and the complete intended semantic state;
- normalize the label server-side and reject client-supplied normalized-label disagreement;
- load/validate referenced company/granularities inside the transaction/session;
- mutate `GranotCrmSource` and insert one `OperationsRegistryChange` in the same transaction using `withRegistryMutation`;
- add `granot_crm_source` to `OperationsRegistryChange.entity_type` and store sanitized before/after plus actor/request/reason provenance;
- preserve duplicate-request replay conflict behavior and never expose credentials/contact payloads in audit metadata;
- invalidate the Granot lifecycle source-policy/list/health caches only after commit, never after rollback/audit failure.

These are Operations Registry commands, not Lead/Booking/Cancellation canonical commands. Do not create `DomainCommandExecution` or `EntityChange` for a Registry-only mutation. Section 23's relevant expectation here is trusted causal actor/request/reason evidence and transaction atomicity; aggregate command provenance remains later units.

### 6.4 Runtime fail-closed source-policy resolver

Create `src/services/granotLifecycle/sourcePolicy.ts` as the sole runtime semantic read boundary. Given normalized source evidence and, where applicable, route facts, it returns a typed immutable policy snapshot or a typed fail-closed result; it performs no target lookup/effect.

Required behavior:

- exact normalized-label lookup only;
- zero matches → `source_unclassified`/policy blocked; multiple matches or duplicate normalized rows → durable-safe ambiguity error/result, never first-row wins;
- operationally disabled or lifecycle-disabled → `source_disabled`/policy blocked;
- deferred disposition → `source_deferred`/`deferred`;
- inactive/missing Source Company → `target_source_company_inactive`;
- missing/inactive/wrong-company/wrong-channel/ambiguous route → fail closed (`missing_creation_route_data`, policy blocked, or conflict as the later processor's frozen vocabulary permits); never choose a fallback;
- policy snapshot includes Registry ID, company ID where legal, selected granularity ID where legal, disposition, policy version, and no copied PII;
- source provider `type` is never an input to label selection/classification.

Best Relocation Form route selection is pure and exact: same two **valid** normalized state codes selects local; different two valid states selects long-distance; missing/invalid state yields insufficient route data and cannot select/create. Unit 05 proves this resolver behavior with synthetic configured rows; Unit 06 owns actual label classification/data migration.

### 6.5 Layered effect-gate evaluator

Implement a pure evaluator that receives explicit current facts and emits a stable ordered snapshot of every applicable gate:

1. named global effect flag;
2. post-activation receipt and processor mode `live`;
3. operational `GranotCrmSource.enabled` and `lifecycle_enabled` (record both names/booleans or one compound gate with explicit components; do not hide which failed);
4. disposition permits requested effect;
5. Source Company active;
6. selected Source Granularity active;
7. Lead-created or reconciliation policy permits requested effect.

The returned shape must be directly storable later as `evaluated_gates: Array<{ gate: string; allowed: boolean }>` and include enough typed policy result to map any false gate deterministically to the frozen reason vocabulary. Rules:

- every applicable gate is evaluated/snapshotted; do not short-circuit away evidence;
- any false gate prevents the requested effect;
- disabled gate → `policy_blocked`; deferred disposition → `deferred`;
- no flags/activation are introduced here; tests pass explicit `false` inputs and all runtime rows remain non-effecting;
- evaluator never mutates a row, target, or cache.

### 6.6 Reads, cache, and documentation

- Add policy/list/detail cache keys only if current Registry caching uses them; cache contents must be policy projections, never raw payload/contact data.
- Read-after-command must observe committed policy after cache invalidation.
- Update project organization and Granot lifecycle/Operations Registry behavior docs with semantic ownership, validation, audit, cache ordering, and default-disabled posture.
- Do not add Admin UI/routes beyond an existing protected Registry read adapter strictly required to test the service. Unit 06 owns reviewed mutation/display UX.

## 7. Explicitly out of scope

- Unit 06: inventory, reviewed aliases, exact joins, `GranotAutomationSource.granot_crm_source`, initial classification writes, source migration commands, compatibility errors/UI, or any production apply.
- `create_if_missing` rollout; initial reviewed policy remains `link_only` in Unit 06 and creation is Unit 19.
- Lifecycle flags/activation/Decision persistence, Observation-to-Registry processor orchestration, matching, source-scoped contact identity, Record Links, or retries.
- Any Lead/Booking/Cancellation/case/discrepancy/command/Entity Change/Sheet Sync/notification mutation.
- Reclassifying payload `type=AUTO`, resolving Paid Overflow/Auto ownership, guessing IDs/routes, or enabling rows by default.
- General Operations Registry redesign or compatibility-field cleanup.

## 8. Flags and runtime posture

- **Starting/ending lifecycle flags:** none/none; do not create `src/config/domain/granotLifecycle.ts`.
- Every existing/new unreviewed row defaults operationally non-effecting: lifecycle disabled + deferred + observation-only + no routes.
- Pure gate tests use explicit values; there is no live processor/caller.
- All later effects remain false/nonexistent.

## 9. Migration and indexes

- **Data migration:** none in Unit 05. Do not backfill `normalized_granot_label` or classify live rows. Unit 06 owns Section 34.2 report → Owner review → apply → verify.
- **Indexes:** declare/test the three model indexes and extend index reporting so normalized-label collisions are visible. Do not create the unique production index until Unit 06's reviewed collision report is zero and production apply is separately authorized.
- Model defaults/contextual validation must allow legacy rows to be read safely before migration while preventing them from becoming lifecycle-enabled.

## 10. Acceptance criteria

- [ ] Exact semantic fields/defaults and three named indexes match Section 8.1 without removing existing CSV fields/indexes.
- [ ] Normalized labels use exact NFKC/trim/collapse/lowercase and reject empty/control/bidi values; duplicate normalized labels fail closed.
- [ ] Route keys/selectors are unique and exact; all illegal Call/Form/mixed/ambiguous route shapes fail validation.
- [ ] Enabled `source_scoped_lead` requires active same-company/matching-channel dependencies and policy version; inactive/missing/mismatched references fail closed.
- [ ] `referral_booking`/`deferred` have no Lead routes and only `observation_only`; `create_if_missing` is legal only for source-scoped Lead.
- [ ] Owner-only commands validate inside the transaction and atomically pair mutation with one sanitized `granot_crm_source` audit containing actor/request/reason/before/after.
- [ ] Audit failure rolls back mutation; duplicate request ID remains a stable replay conflict; cache invalidates only after commit and read-after-write sees new policy.
- [ ] **AC-38 foundation:** zero/multiple/inactive/ambiguous runtime matches never pick a row/route and return stable fail-closed evidence; no cache can serve precommit policy.
- [ ] **AC-09 policy foundation:** same two valid states selects configured Form local route, different valid states selects long-distance, missing/invalid state selects none and cannot authorize creation.
- [ ] **AC-29 policy foundation:** deferred Paid Overflow/future Auto synthetic rows authorize no effect; payload `type=AUTO` is not accepted as source-classification input.
- [ ] **AC-04 foundation:** a requested effect with conflicting/ineligible Source Scope fails its gates and provides no reassignment/mutation output.
- [ ] Gate evaluator snapshots all seven applicable layers in stable order; any false gate blocks; deferred maps to `deferred`, other disabled gates to `policy_blocked`.
- [ ] All lifecycle rows remain disabled/deferred by default; no migration/classification, automation link, UI mutation, flag, processor, or aggregate effect lands.

Name tests `[AC-04]`, `[AC-09]`, `[AC-29]`, and/or `[AC-38]` as applicable, and describe them as foundation proofs where later end-to-end behavior is not yet present.

## 11. Required tests and commands

Minimum locations:

- `src/models/GranotCrmSource.test.ts` — fields/defaults/indexes/normalization plus complete contextual validation matrix;
- `src/services/operationsRegistry/granotCrmSources.test.ts` — trusted roles, transaction/audit atomicity, request replay, sanitized snapshots, cache-after-commit;
- `src/services/granotLifecycle/sourcePolicy.test.ts` — exact/zero/multiple/inactive/deferred/ambiguous resolution, state routing, provider separation, gate ordering/reasons;
- `src/models/OperationsRegistryChange` or existing Registry audit tests — new entity type and rollback regression;
- lifecycle index reporting test — normalized collision visibility and no premature unique apply.

Transaction/audit atomicity claims require Mongo replica-set integration evidence in addition to injected helper ordering tests. Use synthetic Registry IDs/labels only.

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/models/GranotCrmSource.test.ts" "src/services/operationsRegistry/granotCrmSources.test.ts" "src/services/operationsRegistry/registryAudit.test.ts" "src/services/granotLifecycle/sourcePolicy.test.ts" "scripts/migrations/granot-lifecycle-indexes.test.ts"
pnpm test
pnpm typecheck
```

Adjust an exact filename only to match repository convention; do not omit the behavior group.

## 12. Live/staging verification

No production apply/inventory. With a local replica set or explicitly approved staging synthetic rows:

- create default disabled/deferred row and inspect semantic keys only;
- attempt illegal/ambiguous/inactive routes and prove command rollback plus no audit/cache invalidation;
- apply one valid synthetic command and prove mutation+audit commit followed by cache invalidation;
- resolve exact/ambiguous/deferred synthetic labels and list gate names/booleans/reason only;
- prove zero Lead/Booking/Cancellation/Decision/case/Sheet Sync/notification deltas.

Never print source/customer payloads, credentials, contact values, or unreviewed production labels/IDs.

## 13. Rollback

Use the audited Owner command to set `lifecycle_enabled=false` for any test/staging row first. Remove/disable runtime policy callers while retaining Registry rows/audits. Never delete audit history or guess prior policy. Do not drop indexes or unset additive fields without separately authorized Section 34.7 tooling. The existing operational CSV catalog remains compatible.

## 14. Required completion handoff

Use Runbook Section 13 and include:

- exact model fields/defaults/index names and legacy compatibility preserved;
- normalization/validation matrix and source-policy result/gate types;
- Registry command names, trusted actor/reason/request contract, replica-set atomicity evidence, and cache ordering;
- AC-tagged focused/full test results/counts;
- index collision report status and explicit no data migration/production apply;
- flags none/none, rows default disabled/deferred, zero-effect proof;
- masked staging evidence or not-run reason;
- deferred Unit 06 classification/automation/UI work and later AC completion boundaries;
- no live data/payload, commit, push, deploy, or external send;
- final `git status --short`; and successful verification unblocking Unit 06.

Do not complete Unit 05 if a required command fails, an illegal/ambiguous route validates, mutation and audit can separate, cache invalidates before commit, a resolver guesses, or any row/effect is enabled by default.
