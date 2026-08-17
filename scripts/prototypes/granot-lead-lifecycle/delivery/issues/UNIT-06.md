# Unit 06 — Registry migration, automation compatibility link, and reviewed Registry UI

> **Contract maturity: implementation-ready once Unit 05 is complete.** This is the migration/UI half of S04. It turns reviewed source policy into deterministic, auditable data and makes incompatible automation sources visible and unusable for apply. It does not enable Granot Lead creation or any lifecycle processor/effect.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–8, 29.4 accessibility/safety conventions, 34.2, 34.5, 35–36, 37.1–37.2, 38/S04, and 39–40. Section 29's lifecycle case/timeline routes remain later work.
- **Acceptance ownership:** migration/routing foundation of AC-09; migration/provider-separation portion of AC-29; migration, compatibility, audit, and fail-closed portion of AC-38. Later identity/creation/operations units own complete runtime proofs.
- **Approved split:** Unit 06 entry in `lead_lifecycle_issue_breakdown_reccomendation.md`; do not absorb Unit 05 domain construction or Unit 07 processing.
- **Predecessor:** verified Unit 05 completion report and repository state, including exact label normalization, contextual route validation, trusted `GranotCrmSource` commands, audit/cache transaction behavior, and fail-closed source-policy reads.
- **Existing seams:** Operations Registry actor/audit/routes and Admin shell; `GranotAutomationSource`, `granotHttpCollector/sourceCatalog.ts`, Granot automation routes/Admin dashboard; Source Company and first-class Source Granularity Registry.
- **Canonical language/execution:** workspace `CONTEXT.md`, repository guidance, and the delivery runbook.

The final specification wins. Production labels and ObjectIds are never inferred from historical payloads, static provider `type`, or fuzzy string similarity. Where the specification does not name a route key or policy-version literal, Section 6.2 below records the narrow issue-author guidance required for a deterministic migration.

## 2. Objective

Deliver a dry-run-first source Registry migration that inventories every Granot CRM source, automation source, Source Company, Source Granularity, and reviewed alias; joins only unique exact-normalized matches; writes the locked initial classifications and automation references through audited runtime-owned policy; leaves every unresolved row disabled/deferred; and exposes a minimal Owner-reviewed Operations Registry UI where policy, dependencies, automation compatibility, and audit consequences are visible before mutation.

## 3. Repository, branch, and prerequisites

- **Server:** `vantage-main-server`, branch `granot-lead-lifecycle`.
- **Admin:** `vantage-admin`, branch `granot-lead-lifecycle`, limited to the minimum Granot source Registry list/detail/edit/enable surface.
- **Blocked by:** Unit 05.
- Reverify both working trees/branches and Unit 05 model/service/index/test evidence. Preserve current user changes.
- Verify the exact active Registry rows for company slug `best_relocation_leads` and granularity keys `best_relocation_leads_call`, `best_relocation_leads_form_local`, and `best_relocation_leads_form_long_distance`; the migration must fail closed if any is absent, inactive, duplicated, wrong-channel, or semantically mismatched.
- No commit, push, deploy, production apply, live payload inspection, customer-data export, Granot call, or external send without separate authorization.

## 4. Current-state evidence to verify

Observed on 2026-08-17; implementation must reverify after Unit 05 lands:

- `GranotCrmSource` currently owns the operational CSV catalog (`granot_crm_sources`); Unit 05 is expected to add lifecycle semantics without removing that compatibility surface.
- `GranotAutomationSource` currently owns exact `label`, `active`, `supported_operations`, and creation provenance independently; it has no authoritative `GranotCrmSource` reference.
- `granotHttpCollector/sourceCatalog.ts` lists only active automation rows and treats `supported_operations` as semantic authority. Unit 06 must retain the selection APIs while deriving lifecycle availability and routing semantics from the referenced `GranotCrmSource`.
- Seeded automation labels include spaced and unspaced Best Relocation variants; source config and the Operations Registry contain stable Best Relocation company/granularity keys. Those are review inputs, not permission to fuzzy-match.
- Server package scripts include receipt/index lifecycle migrations but no `migration:granot-lifecycle:sources` command.
- Admin already has `/operations-registry`, Owner/read-only role separation, signed Registry proxy requests, Source Company/Granularity editors, query invalidation, and change history. Granot Automation has a source selector/create surface, but no semantic compatibility status.
- No existing Admin Granot source lifecycle editor may become a second policy authority; the UI must call Unit 05 commands and render server projections.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** MongoDB remains System of Record; reviewed Registry rows and audits, not Admin state or a manifest alone, determine runtime policy.
- **Invariant 2:** source classification authorizes only later Lead behavior. It never authorizes a Booking/Cancellation fact.
- **Invariant 5:** this unit invokes no Lead/Booking/Cancellation canonical command.
- **Invariant 8:** Source System, Observation Channel, Ingestion Origin, actor, and initiator remain independent. Automation membership and provider `type=AUTO` are not source classification.
- **Invariant 9:** migration does not rewrite receipt/Observation evidence or creation/submission snapshots.
- **Invariant 10:** classification cannot reassign an existing Lead's Source Company, Source Granularity, Ingestion Origin, or CPL.
- Exact-normalized zero/multiple matches, inactive dependencies, wrong-channel routes, and unreviewed aliases fail closed. No first-row wins, fuzzy match, static fallback, or guessed ObjectId is permitted.
- `lead_created_policy` is `link_only` for both reviewed Best Relocation families after migration. Only Unit 19 may change one reviewed route to `create_if_missing` through a later audited command immediately before rollout.

## 6. Deliverables and exact contract

### 6.1 Automation compatibility reference and projection

Evolve `GranotAutomationSource` additively:

```ts
granot_crm_source?: ObjectId; // ref GranotCrmSource; optional only during migration compatibility
```

Add a named non-unique index `{ granot_crm_source: 1, active: 1 }`. Existing `label`, `active`, `supported_operations`, `created_from`, and creation provenance remain readable for one compatibility window; they no longer decide lifecycle semantics.

Every automation source list/detail/resolution projection returns:

```ts
type GranotAutomationSourceCompatibility = {
  granot_crm_source_id?: string;
  available_for_apply: boolean;
  status:
    | "ready"
    | "missing_reference"
    | "source_disabled"
    | "source_ambiguous"
    | "operation_not_permitted";
  issues: Array<{
    code:
      | "granot_crm_source_reference_missing"
      | "granot_crm_source_disabled"
      | "granot_crm_source_ambiguous"
      | "granot_crm_source_operation_not_permitted";
    message: string;
  }>;
};
```

The status/code literals above are **issue-author guidance** because the final specification requires a visible compatibility error but does not publish its response vocabulary. They are stable API values, not Synchronization outcome/reason additions.

- `ready` requires one referenced, operationally enabled, lifecycle-enabled, non-deferred Registry row whose validated routes permit the requested automation operation.
- Missing, invalid, inactive/disabled, ambiguous, or operation-incompatible policy remains visible in Owner/Admin lists but cannot be selected or resolved for apply.
- `resolveGranotAutomationSources` dereferences the authoritative Registry service for every selected row and returns the existing safe `INVALID_GRANOT_SOURCES` failure envelope with per-source compatibility issues; it never falls back to label or `supported_operations` semantics.
- List/filter behavior must not hide an unavailable row needed to explain a saved run/selection. The existing automation UI disables it and renders the server issue.
- Retain the current automation-label create endpoint and input shape. It creates an unavailable `missing_reference` row; only the Granot source Registry editor or reviewed migration may attach an exact existing Registry source. Automation creation never creates or classifies a `GranotCrmSource` implicitly.

### 6.2 Reviewed classification manifest

Place one typed, checked-in reviewed classification manifest beside the migration library. It contains no database ObjectIds and only these locked normalized label families:

| Exact normalized label | Classification |
| --- | --- |
| `bestrelocation inbounds`, `best relocation inbounds` | Best Relocation Call family |
| `bestrelocation forms`, `best relocation forms` | Best Relocation Form family |
| `referral` | Referral |
| `paid overflow` | deferred evidence-only |
| `auto` | future source label; deferred evidence-only |

Provider payload `type=AUTO` is not an input row or alias and cannot create/link/classify a source.

For deterministic persistence, use these **issue-author guidance** literals where the final specification is silent:

- `lifecycle_policy_version = "granot-lifecycle-source-policy-v1"` for reviewed lifecycle-enabled Best Relocation and Referral rows;
- Call route key `call_any`;
- Form route keys `form_local` and `form_long_distance`.

The manifest resolves target Registry data only by exact stable identifiers:

- Source Company `company_slug = "best_relocation_leads"`;
- Call granularity `granularity_key = "best_relocation_leads_call"`, channel Call, move type `any`;
- Form local granularity `granularity_key = "best_relocation_leads_form_local"`, channel Form, local;
- Form long-distance granularity `granularity_key = "best_relocation_leads_form_long_distance"`, channel Form, long-distance.

Do not embed ObjectIds. Require exactly one active first-class match for every referenced key and validate it through Unit 05 policy commands/resolver.

Locked resulting policy:

- Best Relocation Call: `lifecycle_enabled=true`, `source_scoped_lead`, `lead_created_policy=link_only`, company above, exactly `call_any`.
- Best Relocation Form: `lifecycle_enabled=true`, `source_scoped_lead`, `lead_created_policy=link_only`, same company, exactly `form_local` + `form_long_distance`. Same two valid normalized states select local; different valid states select long-distance; invalid/missing state selects no route.
- Referral: `lifecycle_enabled=true`, `referral_booking`, `observation_only`, no company/Lead routes.
- Paid Overflow and actual source label Auto: `lifecycle_enabled=false`, `deferred`, `observation_only`, no company/Lead routes.
- Every unreviewed, unmatched, multiply matched, or dependency-invalid row: `lifecycle_enabled=false`, `deferred`, `observation_only`, no guessed route. Preserve operational CSV fields.

### 6.3 Source migration report, plan, apply, and verify

Add `scripts/migrations/granot-lifecycle-source-registry.ts` plus a pure library/tests. The script uses shared lifecycle migration guards and runtime Unit 05 normalization/validation/command helpers; it does not duplicate policy.

Report/plan must deterministically inventory:

- every `GranotCrmSource` with masked ID, exact operational label, normalized label, operational/lifecycle status, disposition/policy/version, and dependency status;
- normalized-label collision groups;
- every `GranotAutomationSource`, its normalized label, current reference, exact zero/one/multiple Registry join result, supported-operation compatibility, and planned reference write;
- every active Source Company/Granularity relevant to a reviewed classification, including zero/multiple/inactive/wrong-channel/wrong-move-type findings;
- reviewed alias coverage and any unknown label; and
- proposed Registry policy mutations, automation reference writes, rows forced/staying disabled/deferred, and unique-index readiness.

Manifests are stable-sorted and PII-safe. The specification explicitly permits operations-safe IDs/labels; do not include payloads, contacts, addresses, credentials, headers, actor secrets, or arbitrary document dumps.

Apply rules:

- require `--apply --confirm-production=<database-name>` and separate user authorization;
- refuse the whole reviewed classification group when its normalized label, company, granularity, or route dependency is ambiguous/invalid;
- apply Registry semantic changes through Unit 05 audited commands with a deterministic migration actor/request/reason and transaction semantics;
- update an automation reference only for one exact normalized reviewed match; a replay with the same intended state is a no-op;
- never partially enable an invalid Best Relocation family or silently turn an unmatched row into a usable automation source;
- store changed IDs in the rollback manifest; cache invalidation follows committed Registry mutations only; and
- an audit/validation/reference write failure leaves the affected item unapplied and makes the run fail nonzero. Do not report a partially successful group as verified.

Verify independently reloads persisted rows and asserts exact classifications/references, disabled/deferred unresolved rows, policy version/routes, automation compatibility, audit presence, and index definitions. It exits nonzero on drift.

### 6.4 Registry server surface

Expose Unit 05 queries/commands through thin protected routes:

```text
GET   /api/v1/admin/granot-crm-sources
GET   /api/v1/admin/granot-crm-sources/:id
PATCH /api/v1/admin/granot-crm-sources/:id
PATCH /api/v1/admin/granot-crm-sources/:id/activation
```

- Reads require a trusted Owner/Admin actor; mutations require a signed Owner actor.
- List/detail return operational fields, semantic policy, resolved dependency labels/IDs/status, automation references/compatibility, and latest safe audit metadata. They return no receipt/payload/contact data.
- Update accepts the complete intended semantic state and a required 10–1,000 character reason. It rereads and validates dependencies inside the transaction; this unit does not invent a client revision field absent from the final specification. Activation accepts `{ lifecycle_enabled:boolean, reason:string }`; enabling revalidates the complete current policy inside the transaction.
- Normalized labels are server-derived. Admin cannot submit `normalized_granot_label`, set a raw ObjectId without selecting a returned dependency, bypass illegal combinations, or enable `create_if_missing` in this unit.
- Success uses `{ ok:true, data }`; Registry error mapping remains consistent with existing Registry routes. No raw lifecycle Admin/case route is introduced.

### 6.5 Minimum reviewed Admin UI

In `vantage-admin`, extend `/operations-registry` with an accessible `Granot sources` tab and focused API/query-key modules. Do not place this editor in the later lifecycle cases/timeline UI.

- Owner/Admin can list and inspect every source, including disabled/deferred/unmatched/ambiguous rows, exact normalized label, disposition, creation policy, route dependencies, policy version, automation references, and compatibility issues.
- Admin role is read-only. Owner mutation uses the existing signed Registry proxy and requires explicit review plus a nonblank reason.
- The editor uses constrained selectors populated from active Source Company/Granularity projections. It never asks the browser to derive a route, normalized label, classification, or compatibility status.
- `create_if_missing` is absent/disabled with copy that creation remains a later rollout. The only Best Relocation policy available here is `link_only`.
- Activation control displays operational `enabled` separately from lifecycle activation, dependency validation, and the exact effect warning. No bulk enable/edit.
- Ingestion Granot Automation source selectors render `available_for_apply=false` rows disabled with the returned compatibility message; saved unavailable sources remain visible.
- Successful mutation invalidates Granot source list/detail, Operations Registry overview/health/changes, and Granot Automation source queries. Errors preserve unsaved form values.
- Follow established tab keyboard/focus/label/error-summary patterns and add component/API/query-key tests.

### 6.6 Documentation

Update project organization, Operations Registry/Granot automation behavior documentation, migration README, and Admin Registry documentation to record semantic ownership, exact migration/classification posture, compatibility errors, and rollback. Do not describe creation, processing, or lifecycle case UI as live.

## 7. Explicitly out of scope

- Unit 05 semantic model/command/resolver redesign except compatibility fixes discovered during implementation.
- Unit 07 Decision, Activation, Record Link, flags, processor, health/Job reads, or any receipt processing.
- Unit 14 identity ladders, Unit 15 desired-state/shadow orchestration, Unit 17 automation receipt convergence, Unit 18 Lead writes, and Unit 19 `create_if_missing`/Lead creation.
- Any Lead/Booking/Cancellation/case/discrepancy/Decision/Entity Change/Sheet Sync/notification effect.
- Classifying Paid Overflow, provider `type=AUTO`, or a future source Auto as an effecting source.
- Fuzzy aliases, first-row wins, guessed ObjectIds, auto-created Source Companies/Granularities, production apply/deploy, raw payload inspection, or compatibility cleanup/removal.
- Full `/ingestion/granot/lifecycle` dashboard, timelines, reconciliation UI, or duplicate Mongoose models in Admin.

## 8. Flags and runtime posture

- **Starting/ending lifecycle flags:** none/none; Unit 07 owns `src/config/domain/granotLifecycle.ts`.
- Reviewed Best Relocation/Referral rows may become lifecycle-enabled only through reviewed source apply/Owner command, but no processor or global effect flag exists yet.
- Best Relocation creation policy ends `link_only`; Referral ends `observation_only`; Paid Overflow/Auto/unresolved end disabled/deferred.
- Existing Granot Automation collection/preview behavior remains. Apply semantics must fail closed on incompatible sources; channel-neutral lifecycle apply remains Unit 17.

## 9. Migration and indexes

Required commands:

```text
pnpm migration:granot-lifecycle:sources -- --report
pnpm migration:granot-lifecycle:sources -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:sources -- --verify
pnpm migration:granot-lifecycle:indexes -- --report
pnpm migration:granot-lifecycle:indexes -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:indexes -- --verify
```

- Add the exact `migration:granot-lifecycle:sources` package script. Omitted mode is report; modes are mutually exclusive; historical/unknown DBs are rejected.
- Source apply is separately approved and must follow report → Owner review → apply → verify.
- Extend the shared index catalog with Unit 05 `GranotCrmSource` indexes and the automation reference index. Create non-unique indexes first. Create the unique normalized-label index only after the source report/verify shows zero collisions.
- Assignment authorizes implementation and synthetic/test execution only. It does not authorize production report access if that would expose current operational data, production apply, or activation.

## 10. Acceptance criteria

- [ ] Report inventories every required collection/dependency and emits deterministic, PII-safe unmatched/multiple/inactive/invalid findings without guessing.
- [ ] Reviewed manifest contains only the exact normalized labels/families in Section 6.2; provider `type=AUTO` cannot enter classification.
- [ ] Best Relocation Call resolves exactly to one active Call/any granularity and ends `link_only`; no Form route exists.
- [ ] **AC-09 foundation:** Best Relocation Form resolves exact local/long-distance routes; same two valid states selects local, different valid states long-distance, and invalid/missing states select none. Migration never authorizes creation.
- [ ] Referral is lifecycle-enabled `referral_booking`/`observation_only` with no Lead route; Paid Overflow and actual source Auto remain lifecycle-disabled/deferred/evidence-only.
- [ ] **AC-29 migration portion:** Paid Overflow/Auto outcomes above are exact, and payload/provider `type=AUTO` has no source join/classification path.
- [ ] `GranotAutomationSource.granot_crm_source` is written only for one exact-normalized reviewed match; rerun is idempotent.
- [ ] Missing/inactive/ambiguous/operation-incompatible automation references remain visible with the exact compatibility projection and are rejected for apply.
- [ ] Existing automation label/supported-operation reads remain backward compatible during the window, but no semantic runtime read relies on them as authority.
- [ ] Source and automation mutations are auditable; audit failure prevents the Registry mutation, and post-commit cache invalidation order remains intact.
- [ ] **AC-38:** ambiguous/unmatched Registry and automation rows remain disabled/deferred; runtime resolution and Admin/automation selection fail closed; verify detects any drift.
- [ ] Owner can review/edit/enable only legal policy through the signed Registry surface; Admin is read-only; `create_if_missing` cannot be selected.
- [ ] Migration and Admin/API tests prove no raw payload/contact/credential data in manifests, projections, logs, errors, or fixtures.
- [ ] Unique index apply is refused on collision; verify checks exact model/index definitions.
- [ ] No lifecycle flag, processor, Decision, Record Link, Lead/Booking/Cancellation mutation, case, Sheet Sync, notification, or production apply lands.

Name owned tests `[AC-09]`, `[AC-29]`, and/or `[AC-38]` and label them as foundation/migration proof where later runtime creation/operations completes the AC.

## 11. Required tests and commands

Minimum proof:

- source migration pure tests: normalized aliases, exact Registry joins, deterministic plans/manifests, collision/inactive/wrong-route refusal, idempotent rerun, partial-failure/nonzero verify, and payload/provider exclusion;
- source migration replica-set integration: audited Registry mutation atomicity, automation reference persistence, replay, and rollback on audit/validation failure;
- `GranotAutomationSource` model/source-catalog/route tests: optional reference/index, compatibility projection, unavailable selection, legacy list shape compatibility, and no label fallback;
- Registry route validation/auth/masking tests for the four routes;
- Admin API/component/query tests for read-only Owner/Admin posture, constrained routing, reason/review, disabled creation, compatibility display, form preservation, invalidation, and accessibility;
- shared index migration collision/order/verify tests; and Unit 05 Registry/source-policy regression.

```text
# vantage-main-server
node --import tsx --import ./scripts/test-setup.ts --test "scripts/migrations/granot-lifecycle-source-registry.test.ts" "scripts/migrations/granot-lifecycle-indexes.test.ts" "src/models/GranotAutomationSource.test.ts" "src/services/granotHttpCollector/sourceCatalog.test.ts" "src/services/operationsRegistry/granotCrmSources.test.ts" "src/services/granotLifecycle/sourcePolicy.test.ts" "src/routes/granot-automation.routes.test.ts" "src/routes/v1.routes.test.ts"
pnpm test
pnpm typecheck

# vantage-admin
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

If the exact server route test is split under existing conventions, run the focused replacement and record it; do not omit route proof. Mongo transaction/index claims require a replica set. Use synthetic Registry rows/labels only.

## 12. Live/staging verification

No production apply is authorized. In local test DB or explicitly approved staging:

- run source report and inspect only counts, operations-safe labels/masked IDs, collision/dependency findings, and planned classifications;
- have an Owner review the locked Best Relocation/Referral/Deferred plan before any apply;
- apply synthetic spaced/unspaced Best Relocation, Referral, Paid Overflow, Auto, unmatched, and ambiguous rows, then run verify and index report/verify;
- prove the exact source routes/policies, automation references, unavailable compatibility messages, and matching audit entries;
- use Admin as Admin and Owner to prove read-only/mutation gates and preserved error state; and
- assert zero receipt/Observation/Decision/Record Link/Lead/Booking/Cancellation/case/discrepancy/Sheet Sync/notification deltas.

Never print raw payload/contact values, credentials, unbounded database documents, or unreviewed production aliases.

## 13. Rollback

Use Unit 05 audited Owner commands to set affected `lifecycle_enabled=false` first; this immediately makes referenced automation sources unavailable. Preserve operational CSV rows, automation rows/references, Operations Registry audits, and migration manifests. Do not delete or guess prior policy. If code rollback is needed, retain additive reference/semantic fields so compatibility readers continue to work. Unsetting fields or dropping indexes requires a separately authorized Section 34.7 rollback artifact. Never enable creation as rollback.

## 14. Required completion handoff

Use Runbook Section 13 and include:

- repositories/branches and behavior-grouped server/Admin files;
- exact reviewed normalized-label manifest, issue-author route/version literals, resolved stable Registry keys, and resulting classifications;
- source/automation model/index/API compatibility shape and legacy behavior retained;
- migration report/apply/verify and index command status, database posture, counts/findings, and explicit production-apply status;
- audited command/transaction/cache-order and Admin Owner/read-only evidence;
- AC-tagged focused/full server and Admin command outcomes/counts;
- exact Best Relocation, Referral, Paid Overflow, Auto, unmatched, and ambiguous proofs;
- privacy/forbidden-effect assertions and masked staging evidence or not-run reason;
- flags none/none, `lead_created_policy=link_only`, and no processor/effect enablement;
- risks/deferred compatibility, final `git status --short` in both repos, and explicit no commit/push/deploy/external-send statement; and
- successful verification unblocking Unit 07 only after Units 04–06 are all complete.

Do not complete Unit 06 with an unreviewed/guessed mapping, unresolved unique collision, usable incompatible automation row, missing audit, failing command, production mutation without authorization, creation policy beyond `link_only`, or any lifecycle aggregate effect.
