# Load the linked Form or Call without guessing identity

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leads/sourceLeadLookup.service.ts`
- Knowledge: `docs/knowledge/services/bookings.md`, `docs/knowledge/services/cancellation-mirror.md`, `docs/knowledge/services/cancelled-lead.md`

## Current operation and boundaries

getLinkedLead loads the explicit model/id and returns hydrated selected-database model with optional session. resolveSourceLeadById probes both; both is409, neither404, exactly one returns model+document. Form preference for shared jobs does not apply to an id collision.

## Remaining recommendation

Keep explicit-model lookup distinct from unknown-model resolution. Rename internal query selection only if clearer; avoid another repository abstraction or merging records.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`SourceLeadDocument`; `getLinkedLead`; `resolveSourceLeadById`

## Parity proof

Form/Call paths; supplied/null session; hydrated document; both-id conflict; neither not-found metadata; no mistaken job-based pair preference or side effects.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
