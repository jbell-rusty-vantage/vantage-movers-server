# Recognize The Same Job

- Status: reviewed starter, 2026-10-29
- Target: `src/services/bookings/bookingIdentity.ts`
- Current declared exports: `normalizeJobNo`, `jobNumberDigitCore`, `jobNumbersEquivalent`, `equivalentNormalizedJobFilter`, `remapNormalizedJobFilter`, `equivalentNormalizedJobSnapshotFilter`, `normalizeSubmissionLid`, `normalizeComparisonEmail`, `normalizeComparisonName`.
- Evidence: `src/services/bookings/bookingIdentity.ts`, `docs/knowledge/services/bookings.md`, `docs/knowledge/services/employee-bookings.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Keep `normalizeJobNo` and the explicit equivalence/filter exports; their current names distinguish normalization from matching. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: letter prefixes are equivalent to the same Granot digit core; equivalent job filter matches exact, core, and letter-prefixed variants; equivalent snapshot filter remaps to the indexed cancellation snapshot field. See `src/services/bookings/bookingIdentity.test.ts`.

## Source-verified implementation constraints (2026-10-29)

These helpers are pure identity rules, not Booking intake or transaction orchestration. Keep normalization separate from equivalence: NFKC/case/punctuation normalization is not numeric conversion; only an uppercase letter prefix followed entirely by digits permits shared digit-core matching, and leading zeros remain significant. LID preserves internal punctuation, email trims/lowercases, and comparison name folds punctuation/space. Keep all exported filter/remapping seams, including cancellation snapshot remap. Prove prefixed/number-only twins, non-digit suffix, leading zeros, punctuation and missing inputs before any naming change.
