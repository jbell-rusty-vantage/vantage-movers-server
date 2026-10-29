# Convert the plan into the only allowed Lead patch

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/authorizedDesiredState.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/desired-state.md`

## Current operation and boundaries

Current allowlists constrain plan conversion. Contact hashes and semantic payload checksum feed synchronize idempotency. Source/CPL, official money, immutable ingress evidence and forbidden metadata cannot become caller patches; receiver catalog stamps remain command-owned.

Direct assertion rejects unallowlisted set paths; conversion from a plan skips unknown or forbidden changed paths before asserting.

## Remaining recommendation

Keep conversion separate from assertion and planning. Improve local checksum/canonicalization names only when clearer; preserve key formats, semantic hashing and every allowed/forbidden path.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`GRANOT_LEAD_WRITE_PATHS`; `GranotLeadWritePath`; `GRANOT_CONTACT_PATHS`; `GranotContactPath`; `GRANOT_MOVE_PATHS`; `GranotMovePath`; `GranotAuthorizedLeadDesiredState`; `FORBIDDEN_DESIRED_STATE_METADATA_PATHS`; `AuthorizedDesiredStateError`; `toAuthorizedLeadDesiredState`; `assertAuthorizedLeadDesiredState`; `hashGranotContactLeaves`; `synchronizeLeadPayloadChecksum`; `synchronizeLeadIdempotencyKey`

## Parity proof

Direct assertion rejects unknown paths while plan conversion skips them; priority-only eligibility gains no contact/job authority; semantic equivalents hash identically; authorized changes affect checksum; primary caller contact and immutable snapshots remain unchanged.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
