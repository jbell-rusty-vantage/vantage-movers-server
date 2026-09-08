# CLCP-01 completion

Closed 2026-09-04. Repo `vantage-main-server`, branch `call-lead-contact-provenance`.

## Behavior

`planQualifiedContact` no longer branches on Ingestion Origin. Every origin uses the WordPress Form path: if incoming contact is not semantically equal to `lead.granot_contact_snapshot`, plan `granot_contact_snapshot` only and return. Live `phone_number` / `normalized_phone_number` / `name` / `first_name` / `last_name` / `email` are not planned. `last_granot_contact_change.changed_paths` is not planned. `ingested_contact_snapshot` is not planned. Priority `1` / `5` still gates qualified contact. `synchronizeLeadFromGranot` already stamps `differs_from_ingested` + `observation_id` + `captured_at` when the snapshot path is present; snapshot-only plans still produce empty `contact_changed_paths`.

## Files changed

- `src/services/granotLifecycle/leadDesiredState.ts` — deleted the non-WordPress live-contact branch
- `src/services/granotLifecycle/leadDesiredState.test.ts` — inverted `[AC-12]`; added Granot-created later phone, Call formatting-only, Priority `8`
- `src/services/granotLifecycle/authorizedDesiredState.test.ts` — snapshot-only Call plan converts; live phone off `contact_changed_paths`
- `src/services/granotLifecycle/synchronizeLeadFromGranot.test.ts` — planner → authorize write set is snapshot only; `granotSnapshotDiffersFromIngested` stamps true; live phone absent from `changed_paths`
- `docs/call-lead-contact-provenance/issues/CLCP-01.md` — §10 boxes checked with evidence below
- `docs/call-lead-contact-provenance/PROGRESS.md` — close ledger
- this report

## Test command output

```text
pnpm exec tsx --test src/services/granotLifecycle/leadDesiredState.test.ts
ℹ tests 32
ℹ pass 32
ℹ fail 0
ℹ skipped 0

pnpm exec tsx --test src/services/granotLifecycle/authorizedDesiredState.test.ts
ℹ tests 7
ℹ pass 7
ℹ fail 0
ℹ skipped 0

pnpm exec tsx --test src/services/granotLifecycle/synchronizeLeadFromGranot.test.ts
ℹ tests 10
ℹ pass 10
ℹ fail 0
ℹ skipped 0

pnpm typecheck
tsc --noEmit
exit_code: 0
```

No required test failed or was skipped.

## Untouched (confirmed)

`git status` after the change did not list:

- `src/services/granotLifecycle/identity.ts`
- `src/services/enrichment/callLeadEnrichment.service.ts` (CSV / old enrichment)
- `src/services/granotLifecycle/sourcePolicy.ts`
- `src/services/granotLifecycle/createLeadFromGranot.ts` (mint unchanged)
- `.env` / feature flags

## Note for CLCP-04

These knowledge sentences still say live Call / Granot-created contact becomes current operational fields:

- `docs/knowledge/granot-lifecycle/desired-state.md` — “Granot-created and RingCentral-created qualified contact become current operational fields”
- `docs/knowledge/granot-lifecycle/processor.md` — “RingCentral-created and Granot-created qualified contact/move plan current fields plus a bounded `last_granot_contact_change.changed_paths` summary”

CLCP-04 owns the Service rewrite.

## Note for CLCP-02

Job-vs-phone conflict still exists. `identity.ts` `resolveCallLadder` (~826–834) still returns `conflict` / `job_number_conflict` when Job target and phone target are different Leads. Untouched on purpose.

## Acceptance criteria evidence (issue §10)

| Box | Evidence |
| --- | --- |
| RingCentral Call + Priority `1`/`5` plans `granot_contact_snapshot` only | Inverted `[AC-12]` in `leadDesiredState.test.ts` (Priority `1`; same `BROAD_ENRICHMENT_PRIORITIES` gate as `5`) |
| Live `phone_number` / `name` / `email` absent from `changed_paths` | Same test plus `granot_lead_created` later-phone case |
| `ingested_contact_snapshot` never planned | `[AC-12]` asserts it is absent from `changed_paths` |
| `granot_lead_created` later different phone → snapshot only | New planner test; live leaves absent |
| Semantic-equal contact → no snapshot rewrite | `Call Lead snapshot formatting-only…` (`+1` vs 10-digit, name peel) |
| Priority `8` does not plan snapshot contact | `Priority 8 Call Lead does not plan Granot Contact Snapshot` |
| WordPress Form snapshot-only unchanged | Existing `[AC-10]` and WordPress formatting-only still pass in the 32-test suite |
| Synchronize: snapshot persisted, live phone unchanged | New `synchronizeLeadFromGranot.test.ts` case; `differs_from_ingested` via existing `granotSnapshotDiffersFromIngested` |
| `identity.ts` and `callLeadEnrichment.service.ts` unchanged | `git status` / `git diff --stat` |
| Focused tests in §8 pass | Commands above: 32 + 7 + 10, typecheck clean |

## What this issue did not do

CLCP-02 identity Job-wins. CLCP-03 CSV/preview. CLCP-05 desk `q`. Knowledge Service rewrites. Mint behavior. Flag enablement.

Coordinator review also inverted `synchronizeLead.replica.test.ts` `[AC-12]` Call and Granot-created Form fixtures so they expect snapshot write + unchanged live name (existing replica file already covered this command).
