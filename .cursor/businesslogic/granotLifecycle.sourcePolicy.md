**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Primary code:** `src/services/granotLifecycle/sourcePolicy.ts`, `src/services/granotLifecycle/sourceLabel.ts`  
**Domain terms used:** Source Company, Source Granularity, Granot Automation Source, Move Type, Ingestion Origin

# Granot source policy (`granotLifecycle/sourcePolicy`)

**Role:** Sole runtime semantic read boundary for a Granot source label. Resolve an exact normalized label to a typed policy snapshot or a fail-closed result, and evaluate the seven layered effect gates. This module performs no target lookup, Lead/Booking/Cancellation mutation, Decision write, or cache write of uncommitted policy.

**Stack:** callable module only. Registry writes stay in `src/services/operationsRegistry/granotCrmSources.ts`. Observation normalization may share `sourceLabel.ts` but does not resolve policy.

## Public interface

- `normalizeGranotSourceLabel(raw)` — NFKC, trim, collapse whitespace, lowercase; reject empty/control/bidi rather than stripping them into a usable label.
- `resolveSourcePolicy(facts, store?)` — exact normalized-label lookup only. Provider `type` is never a classification input.
- `evaluateEffectGates(facts)` — pure snapshot of every applicable gate in stable order. Tests pass explicit `false` inputs; no flags or activation exist yet.

## Fail-closed resolution

- Zero matches → `policy_blocked` / `source_unclassified`.
- Multiple normalized rows → `ambiguous`; never first-row wins.
- Operationally disabled or `lifecycle_enabled=false` → `policy_blocked` / `source_disabled`.
- `deferred` → `deferred` / `source_deferred`.
- Missing/inactive Source Company → `target_source_company_inactive`.
- Missing/inactive/wrong-company/wrong-channel/ambiguous route → fail closed; never choose a fallback.
- Best Relocation Form routing is exact: same two valid USPS states → local; different valid states → long-distance; missing/invalid → `missing_creation_route_data` and cannot authorize creation.

## Layered gates

Every applicable gate is evaluated and snapshotted. Any false gate blocks the requested effect. Deferred disposition maps to `deferred`; other disabled gates map to `policy_blocked`. Conflicting/ineligible Source Scope fails gates with `conflict` / `source_scope_conflict` and no reassignment output.

1. named global effect flag
2. post-activation receipt and processor mode `live`
3. operational `enabled` and `lifecycle_enabled` as separate named booleans
4. disposition permits the requested effect
5. Source Company active
6. selected Source Granularity active
7. Lead-created or reconciliation policy permits the requested effect

## Defaults and later work

Every unreviewed row remains lifecycle-disabled, deferred, observation-only, and route-empty. Unit 06 owns classification, automation links, and reviewed UI. This module authorizes no live effect.

## Related

- Registry writes and audit: [`operationsRegistry.service.md`](operationsRegistry.service.md)
- Observation normalization: [`granotLifecycle.normalization.md`](granotLifecycle.normalization.md)
