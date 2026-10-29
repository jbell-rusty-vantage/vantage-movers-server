# Stamp trusted origin and immutable ingress snapshots

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leads/leadIngestionProvenance.ts`
- Knowledge: `docs/knowledge/services/call-lead.md`, `docs/knowledge/services/domain-commands.md`, `docs/knowledge/services/form-lead.md`

## Current operation and boundaries

Origin derivation is server-owned and snapshot fields are storage evidence. Current assignable Call origins still include ringcentral, vantage_admin, granot_lead_created and best_relocation_sheet; latter ingest is not live. Manual no_sync defaults true; other origins force false. Legacy labels do not prove runtime qualification.

## Remaining recommendation

Keep derive/assert/build/stamp/filter beats distinct. Improve names around trusted creation fields without renaming persisted enums. Do not merge Form/Call or remove a permitted mint path under a provenance rename.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`AssignableFormLeadIngestionOrigin`; `AssignableCallLeadIngestionOrigin`; `IngestedContactSnapshotInput`; `IngestedMoveSnapshotInput`; `IngestedContactSnapshot`; `IngestedMoveSnapshot`; `assertAssignableFormLeadIngestionOrigin`; `assertAssignableCallLeadIngestionOrigin`; `deriveFormLeadIngestionOrigin`; `deriveCallLeadIngestionOrigin`; `buildIngestedContactSnapshot`; `buildIngestedMoveSnapshot`; `noSyncOnCreate`; `formLeadCreationProvenanceFields`; `callLeadCreationProvenanceFields`; `omitForbiddenLeadLifecycleFields`

## Parity proof

Origin/actor matrix; unknown origin fails; contact normalization; move date absent; job normalization separate from reference; no_sync matrix; forbidden input stripped without mutating original; immutable model guards retained.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
