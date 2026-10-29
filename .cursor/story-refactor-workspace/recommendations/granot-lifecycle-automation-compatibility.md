# Explain automation source readiness

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/automationCompatibility.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/automation-apply.md`, `docs/knowledge/granot-lifecycle/source-policy.md`, `docs/knowledge/services/granot-http-collector.md`, `docs/knowledge/services/operations-registry.md`

## Current operation and boundaries

Read-only compatibility uses linked Registry lifecycle facts and route/operation compatibility. It is readiness guidance, not permission to execute; lifecycle apply revalidates gates.

## Remaining recommendation

Keep the two pure public evaluators. Name failure branches by disabled/deferred/missing-link/incompatible-route evidence rather than building another apply service.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`GRANOT_AUTOMATION_COMPATIBILITY_STATUSES`; `GranotAutomationCompatibilityStatus`; `GRANOT_AUTOMATION_COMPATIBILITY_ISSUE_CODES`; `GranotAutomationCompatibilityIssueCode`; `GranotAutomationSourceCompatibility`; `GranotAutomationCompatibilityOperation`; `GranotAutomationCompatibilityRoute`; `GranotAutomationCompatibilitySource`; `automationOperationPermittedByRoutes`; `evaluateGranotAutomationCompatibility`

## Parity proof

Unlinked, inactive, deferred and mismatched routes retain exact statuses/issue codes; compatible projection causes no mutation.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
