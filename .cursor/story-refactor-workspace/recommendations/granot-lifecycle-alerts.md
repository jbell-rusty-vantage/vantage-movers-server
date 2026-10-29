# Evaluate seven rollout alerts and persist transition wins

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/alerts.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/observability.md`

## Current operation and boundaries

The seven-alert catalog remains. Transitions use compare-and-set rows in bounded granot_lifecycle_health_state through healthState.ts, followed by best-effort logging. Operational Events, incidents and notification delivery are retired; missing data states vary by evaluator.

Capture unavailable, claim recovery, p95 and missing source rates use insufficient_data; a null oldest-due age or held-lease age instead yields ok under current evaluators.

## Remaining recommendation

Name evaluators by measured condition and persistence by the transition it wins. Keep classifyAlertTransition pure and Health persistence separate from event logging.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`GranotLifecycleAlertState`; `GranotLifecycleAlertUnit`; `GranotLifecycleAlertProjection`; `GranotLifecycleAlertSnapshot`; `nearestRankP95`; `evaluateGranotLifecycleAlerts`; `classifyAlertTransition`; `persistGranotLifecycleAlertTransitions`; `alertCatalogFrozen`

## Parity proof

Threshold boundaries, nearest-rank p95, unknown samples, stable firing since, concurrent evaluation emits one transition, recovery, instrumentation failure never fails processing.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
