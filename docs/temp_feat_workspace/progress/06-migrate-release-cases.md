# Phase 6 — Historical Release-case migrate helper (spec §10)

**Branch:** `vantage-main-server` `lead-lifecycle`  
**Status:** done  
**Date:** 2026-09-01

Not committed. No production flags. CLI was **not** run against production. FINAL SPEC untouched. Live Events (Phase 7) and knowledge docs (Phase 8) are out of scope.

No official Booking or Cancellation writes. Release collections are not dropped.

## Files

- `scripts/migrations/granot-lifecycle-release-cases-into-booking-intake.ts`
- `scripts/migrations/granot-lifecycle-release-cases-into-booking-intake.lib.ts`
- `scripts/migrations/granot-lifecycle-release-cases-into-booking-intake.test.ts`
- `package.json` — `migration:granot-lifecycle:release-cases-into-booking-intake`

Planner is unit-testable without Mongo. CLI wires report / apply / verify and reuses `assertGranotLifecycleDatabaseAllowed` + `assertGranotLifecycleApplyAuthorized` (`--confirm-production` must match the connected name; historical DB refused).

## Planner

For each open Release case:

1. Find or plan-open the `{normalized_job_no, action_kind:"booked"}` booking case.
2. Append Release evidence that is not already on that case (`action: "release"`, same `observation_id` is skipped).
3. Live (not cancelled) official Booking → `review_existing_booking` + `deterministic_booking_id`. Otherwise `create_missing_booking`. Sequence when opening is `max+1` or `1`.
4. Resolve the Release case: `state: "resolved"`, `outcome: "no_action"`, `reason_code: "already_handled_elsewhere"`, `reason_text: "migrated_to_booking_intake"`. Does **not** call Confirm Granot Cancellation.
5. Never plans official Booking or Cancellation field writes.

Apply runs one Mongo transaction per Release case (insert or `$push` evidence, optional review-mode `$set`, then resolve). Verify: migrated ids are not open; those Observations appear on a booking case; official `domain_revision` is unchanged. Manifest has case ids, job numbers, observation ids, and counts — no phones, emails, or names.

## Discrepancy choice

**Leave `release_without_vantage_booking` rows as historical.** Resolving them is not required to create a booking intake; spec §10 says the next Booked/Release Observation opens/refreshes that intake. New traffic must not create this reason (Phase 2). The helper records `discrepancy.action: "leave_historical"` and does not invent an intake from the discrepancy row.

## Tests

```
pnpm exec node --import tsx --test scripts/migrations/granot-lifecycle-release-cases-into-booking-intake.test.ts
pnpm exec tsc --noEmit
```

11 passed, 0 failed. `tsc --noEmit` clean.

Covered: open create-missing + append + resolve; existing booking case append-only; skip duplicate observation ids; live Booking → review + deterministic id; no official Booking/Cancellation writes; missing `--confirm-production` / historical DB refused.

## Follow-ups for Phase 7

Live Events `intake_link` + SSE `receipt_updated` (AC-L1–L5):

- `intake_link` is non-null only when that receipt’s Observation is already on a booking-case evidence row (`matched_via: "evidence_observation_id"`). Never resolve by `job_no` alone.
- Capture SSE may first emit `intake_link: null`; after the processor opens/refreshes the case, emit `receipt_updated` with the same `receipt_id` and a non-null link so Admin can replace the row without reload.
- Admin shows **Open booking intake** iff `intake_link` is present. No link for `lead_created`, `priority_updated`, pending rows, discrepancy-only completions, or Release-only cases that were never migrated.
