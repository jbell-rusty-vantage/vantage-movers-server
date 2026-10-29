# Resolve reviewed source policy and eight gates

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/sourcePolicy.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/identity.md`, `docs/knowledge/granot-lifecycle/normalization.md`, `docs/knowledge/granot-lifecycle/source-policy.md`

## Current operation and boundaries

Exact normalized label lookup fails closed on zero/multiple matches. Snapshot includes selected model/route and active facts. Referral may have no Lead scope. type=AUTO grants no authority; Form routes with move_type any need no states merely to match.

## Remaining recommendation

Keep source resolution, deterministic route and pure gate evaluator deep. Name missing/inactive/ambiguous failures; preserve eight gate names and three policy values instead of adding mint booleans.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`SourcePolicyRoute`; `SourcePolicyRow`; `SourcePolicyLookupFacts`; `SourcePolicySnapshot`; `SourcePolicyResolution`; `SourcePolicyStore`; `RequestedLifecycleEffect`; `EffectGateFacts`; `EvaluatedGate`; `EFFECT_GATE_NAMES`; `EffectGateEvaluation`; `createMongoSourcePolicyStore`; `resolveSourcePolicy`; `evaluateEffectGates`

## Parity proof

Collision; disabled/deferred source; inactive/wrong-company routes; local/long-distance versus any; Referral no scope; gate order/first blocker; no cache or domain writes.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
