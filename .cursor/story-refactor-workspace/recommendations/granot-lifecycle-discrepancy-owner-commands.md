# Re-evaluate, correct a Record Link, or resolve without a fact

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/discrepancyOwnerCommands.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/revisions.md`, `docs/knowledge/services/domain-commands.md`

## Current operation and boundaries

Owner commands retain causal evidence, exact idempotency and revisions. Correction is explicit Owner authority; re-evaluation feeds current facts through normal booking reconciliation. No Action resolves work only.

## Remaining recommendation

Organize the three exported stories. Rename generic prepare/body/resolve only when they hide shared evidence or resolution policy; retain eligibility, stored command identifiers and canonical reconciliation seam.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`RE_EVALUATE_DISCREPANCY_COMMAND_NAME`; `CORRECT_RECORD_LINK_COMMAND_NAME`; `DISCREPANCY_NO_ACTION_COMMAND_NAME`; `ReEvaluateDiscrepancyInput`; `CorrectRecordLinkInput`; `DiscrepancyNoActionInput`; `DiscrepancyOwnerCommandResult`; `resolveGranotDiscrepancyNoAction`; `reEvaluateGranotDiscrepancy`; `correctGranotRecordLink`

## Parity proof

Owner/policy gate; stale revisions; conflicting selected target; exact replay/checksum conflict; correction Change/link evidence; normal reconciliation after correction; No Action creates no official fact.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
