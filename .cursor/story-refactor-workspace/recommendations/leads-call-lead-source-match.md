# Compare a parsed Call source with assigned attribution

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leads/callLeadSourceMatch.ts`
- Knowledge: `docs/knowledge/services/booked-call-lead-reconciliation.md`, `docs/knowledge/services/enrichment.md`

## Current operation and boundaries

Compatibility accepts an unassigned source or a match on company id, granularity key, or legacy source_company; these checks are alternatives, so a legacy match can succeed even when another populated identifier differs. A conflict is a string only when parsed.source_company exists and none matches. Helpers also provide display labels. It is guidance for existing enrichment/reconciliation, not source reassignment authority.

## Remaining recommendation

Keep pure comparison/label/conflict helpers together. Use Source Company/Source Granularity names consistently; preserve the independent OR checks and legacy source_company fallback, including when another identifier differs; do not silently tighten attribution policy.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`CallLeadSourceParsedRow`; `isUnassignedSource`; `isLeadSourceCompatible`; `sourceDisplayLabel`; `leadSourceDisplayLabel`; `buildAssignedSourceConflict`

## Parity proof

Empty/not_provided; exact/same/conflicting source; label fallback; conflict string and absent parsed source behavior preserve shape and performs no write.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
