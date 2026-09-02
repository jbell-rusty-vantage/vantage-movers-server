---
type: Service
title: "Granot source policy (`granotLifecycle/sourcePolicy`)"
description: Fail-closed Registry policy resolution and effect-gate snapshot. No effects.
tags: [granot-lifecycle]
status: draft
stale_after: 2026-11-19
resource: src/services/granotLifecycle/sourcePolicy.ts
applies_to:
  - src/services/granotLifecycle/sourcePolicy.ts
  - src/services/granotLifecycle/sourceLabel.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/granotLifecycle/sourcePolicy.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-optimization
  at: 2026-09-02T18:00:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Primary code:** `src/services/granotLifecycle/sourcePolicy.ts`, `src/services/granotLifecycle/sourceLabel.ts`  
**Domain terms used:** [Source Company](../../../../CONTEXT.md), [Source Granularity](../../../../CONTEXT.md), [Granot Automation Source](../../../../CONTEXT.md), [Granot CRM Source](../../../../CONTEXT.md), [Move Type](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md), [Call Qualification](../../../../CONTEXT.md)

# Granot source policy (`granotLifecycle/sourcePolicy`)

**Role:** Sole runtime semantic read boundary for a Granot source label. Resolve an exact normalized label to a typed policy snapshot or a fail-closed result, and evaluate the **eight** layered effect gates in `EFFECT_GATE_NAMES`. This module performs no target lookup, Lead/Booking/Cancellation mutation, Decision write, or cache write of uncommitted policy.

**Stack:** callable module only. Registry writes stay in `src/services/operationsRegistry/granotCrmSources.ts`. Observation normalization may share `sourceLabel.ts` but does not resolve policy.

## Public interface

- `normalizeGranotSourceLabel(raw)` — NFKC, trim, collapse whitespace, lowercase; reject empty/control/bidi rather than stripping them into a usable label.
- `resolveSourcePolicy(facts, store?)` — exact normalized-label lookup only. Provider `type` is never a classification input. A selected route also stamps `selected_lead_model` so identity can choose the Form or Call ladder without re-resolving Registry semantics. `referral_booking` can return `ok: true` **without** `selected_lead_model`, `source_granularity_id`, or route fields.
- `evaluateEffectGates(facts)` — pure snapshot of every applicable gate in stable eight-name order. The processor now passes real Registry `enabled` / `lifecycle_enabled` and company/granularity `active` facts from the snapshot, not Boolean id-presence approximations. This module still performs no writes.

`RequestedLifecycleEffect`: `lead_created` | `lead_link` | `lead_enrichment` | `booking_reconciliation` | `release_reconciliation`. For Referral + booking/release reconciliation, the company/granularity-active gates are forced true (`referralReconciliation`). Mongo store treats `row.enabled !== false` (absent defaults true). `evaluateEffectGates` / `policyPermitsEffect` do not read `route_event_class`. Once the planner marks Call `priority_updated` eligible, `requested_effect` stays `"lead_created"`. There is no ninth gate and no fourth `lead_created_policy` value.

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

Exact `EFFECT_GATE_NAMES` order:

1. `global_effect_flag`
2. `post_activation_live_mode`
3. `operational_enabled`
4. `lifecycle_enabled`
5. `disposition_permits_effect`
6. `source_company_active`
7. `source_granularity_active`
8. `policy_permits_effect`

First blocking reasons include `global_effect_disabled`, `shadow_effect_suppressed`, `historical_shadow`, `source_disabled`, `source_deferred`, `target_source_company_inactive`, `target_source_granularity_inactive`, `source_scope_conflict`, `creation_policy_observation_only`, `creation_policy_link_only`.

Route-selection failures (never first-row fallback): Form + Call routes both present → `conflict` / `missing_creation_route_data`; route count ≠ 1 → `ambiguous` / `missing_creation_route_data`; missing granularity → `policy_blocked` / `missing_creation_route_data`; wrong company → `conflict` / `source_scope_conflict`; wrong channel → `conflict` / `missing_creation_route_data`; inactive granularity → `policy_blocked` / `target_source_granularity_inactive`.

## Defaults and later work

Every unreviewed row remains lifecycle-disabled, deferred, observation-only, and route-empty. Unit 06 writes reviewed classifications and automation references through audited Registry commands; this module remains the only runtime semantic read. `lead_created_policy` stays exactly three values: `link_only` | `create_if_missing` | `observation_only`. Best Relocation reviewed policy is already `create_if_missing` (Forms and Inbounds). Reviewed inbound Call families — Main Site Inbounds, 10best Inbounds (TBM Call), TBM Prime Inbounds, Top10 Inbounds — were flipped to `create_if_missing` on 2026-09-02 through audited `createOrUpdateGranotCrmSource`. Inbound `create_if_missing` is the safety net when Call Qualification does not see the call; mapped qualifying calls stay RingCentral-created or adopted. Form families on those companies stay `link_only` unless a separate Owner command says otherwise. Customer text stays a separate `outbound_sms` command. This module authorizes no live effect and does not invent a fourth policy value, inbound mint boolean, or ninth gate.

## Related

- Registry writes and audit: [`operations-registry.md`](../services/operations-registry.md)
- Observation normalization: [`normalization.md`](./normalization.md)
- Identity consumes this snapshot and never copies Registry semantics ([`identity.md`](./identity.md)).
- Decision processor consumes this read/gate snapshot and Unit 14 identity ([`processor.md`](./processor.md)).
- Successful snapshots also carry `operational_enabled`, `lifecycle_enabled`, `source_company_active`, and `source_granularity_active` so Unit 15 can persist real gate facts.
