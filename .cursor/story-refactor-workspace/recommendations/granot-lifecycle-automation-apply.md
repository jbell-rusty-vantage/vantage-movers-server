# Apply approved automation through the durable receipt

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/automationApply.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/automation-apply.md`, `docs/knowledge/granot-lifecycle/capture.md`, `docs/knowledge/granot-lifecycle/drainer.md`, `docs/knowledge/granot-lifecycle/extension-apply.md`, `docs/knowledge/granot-lifecycle/normalization.md`, `docs/knowledge/services/granot-http-collector.md`

## Current operation and boundaries

applyAutomationPlanAction captures run_id:action_id and calls canonical claimAndProcessOrPoll. loadAutomationReplayStates now bulk-loads live receipt state; terminal replay and pending clocks differ. Replay uses zero polling deadline. The Estimates cron and reviewed Estimates apply share this seam.

## Remaining recommendation

Keep bulk replay state in the current interface and caller map. Name capture, stored-receipt replay and claim translation as separate beats; leave Estimates scheduling and run leases in their owning modules.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`AutomationReplayState`; `loadAutomationReplayStates`; `GranotAutomationActionReceipt`; `ApplyAutomationActionInput`; `AutomationApplyDeps`; `applyAutomationPlanAction`; `translateAutomationClaimResult`

## Parity proof

Same statement replays, changed checksum conflicts, pending/not-due/claimed work is not forced, Owner requeue uses live state, dead letter translates correctly, no direct Lead patch or queue publish.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
