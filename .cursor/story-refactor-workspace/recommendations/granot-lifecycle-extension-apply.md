# Apply one approved extension statement through lifecycle

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/extensionApply.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/automation-apply.md`, `docs/knowledge/granot-lifecycle/capture.md`, `docs/knowledge/granot-lifecycle/drainer.md`, `docs/knowledge/granot-lifecycle/extension-apply.md`, `docs/knowledge/granot-lifecycle/normalization.md`

## Current operation and boundaries

Extension apply captures a channel operation receipt and calls claimAndProcessOrPoll. Translation returns extension-friendly outcomes but does not supply a direct Lead patch or bypass source/temporal/booking/contact policy.

## Remaining recommendation

Keep applyExtensionGranotItem public and name claim/expected-target conflict translation by outcome. Preserve operation identity, checksum and expected-target semantics.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`ExtensionGranotApplyItem`; `ExtensionGranotApplyResult`; `ApplyExtensionGranotItemInput`; `ExtensionApplyDeps`; `mapSynchronizationOutcomeMessage`; `applyExtensionGranotItem`

## Parity proof

Exact replay; changed same operation conflict; terminal/pending translation; target mismatch; processing off/dead letter; contact stays evidence; no direct domain write.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
