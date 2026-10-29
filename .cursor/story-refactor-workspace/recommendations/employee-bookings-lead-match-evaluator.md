# Evaluate an Employee Booking Lead Match

- Status: reviewed starter, 2026-10-29
- Target: `src/services/employeeBookings/leadMatchEvaluator.ts`
- Current declared exports: `evaluateEmployeeBookingMatch`, `preferFormLeadForSharedJob`.
- Evidence: `src/services/employeeBookings/leadMatchEvaluator.ts`, `docs/knowledge/services/employee-bookings.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Keep `evaluateEmployeeBookingMatch` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: evaluateEmployeeBookingMatch auto-links a unique Call Lead Job Number; evaluateEmployeeBookingMatch auto-links a unique Form Lead Job Number on form channel; evaluateEmployeeBookingMatch prefers the Form Lead when a Form Lead and a Call Lead share the Job Number (either channel). See `src/services/employeeBookings/leadMatchEvaluator.test.ts`.

**Specific parity:** The current positive rules are exact Call and Form job matches. Preserve identity conflict and overflow handling, stronger blocks and the Form preference when both Leads share a job; do not restore the retired five-rule matcher.

## Source-verified implementation constraints (2026-10-29)

The shared-job preference runs before conflict and positive-rule selection: exactly one Form job candidate plus one-or-more Call job candidates sets aside those Call candidates, marks call_lead_shares_job and switches preferred model to Form even for Call channel. Two Forms do not collapse. Preserve policy-enabled rules, overflow rejection and remaining source/eligibility/contact conflict checks; contact confidence alone never auto-attaches. Prove shared-job on both channels, two Forms pending, unrelated phone conflict and disabled exact rules. This behavior is newer than the Service's simple preferred-channel table.
