# Session story-employee-bookings-lead-match-evaluator-2026-09-09T0113Z

- Date (UTC): 2026-09-09
- Service / module: `employeeBookings` / `leadMatchEvaluator.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 30 / 1 / 7
- Recommendations on disk: 255 (through `employee-bookings-lead-candidate-queries.md`)
- Current service / next module (TRAVERSAL): `employeeBookings` (in-progress) / `leadMatchEvaluator.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/employee-bookings-lead-match-evaluator.md`
- operations named: refuse when the cards disagree about who this Job is; refuse when uniqueness is unproven; refuse when a stronger block already exists; apply the enabled auto-match rules in listed order; name why this Job still stays pending
- remaining in this service: `bookingLeadReconciliation.service.ts`, `bookingLeadAttachment.service.ts`, `reconciliationPolicy.ts`, `reconciliationRematch.service.ts`, `migrationPreflight.ts`, `migrationApplySafety.ts`

## Stock at end

- Visited / in-progress / unvisited: 30 / 1 / 7
- Current service / next module: `employeeBookings` (in-progress) / `bookingLeadReconciliation.service.ts`

## Messages posted

- 2026-09-09T0113Z next

## Ideas parked

- none

## Contradictions

- Overflow pending `multiple_matches` after identity and before any positive rule, including unique LID
- A Form LID *card* (not a typed LID) skips contact-triple and email+phone; `channel_phone_exact` does not skip
- Unassigned exact identity stores case reason `source_conflict`, not `source_unassigned`
- Call `created_on_unmatched` on exact identity stores `no_match`
- This interface never returns `matching_unavailable` — submit / rematch catch that themselves
- Owner refresh / update-pending / reopen record a `linked` decision and do not claim
- `form_email_phone_exact`’s `name_contradiction` filter is mostly dead after the identity walk
- Linked reason is always `high_confidence`; finder `confidence` is unread
