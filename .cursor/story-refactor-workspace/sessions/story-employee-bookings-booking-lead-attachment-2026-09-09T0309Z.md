# Session story-employee-bookings-booking-lead-attachment-2026-09-09T0309Z

- Date (UTC): 2026-09-09
- Service / module: `employeeBookings` / `bookingLeadAttachment.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 30 / 1 / 7
- Recommendations on disk: 257 (through `employee-bookings-booking-lead-reconciliation.md`)
- Current service / next module (TRAVERSAL): `employeeBookings` (in-progress) / `bookingLeadAttachment.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/employee-bookings-booking-lead-attachment.md`
- operations named: claim and stamp the named Lead on this Job; mint a Call Lead then attach it; mint a Form Lead then attach it; reassign this Job to a different Lead (claim next first)
- remaining in this service: `reconciliationPolicy.ts`, `reconciliationRematch.service.ts`, `migrationPreflight.ts`, `migrationApplySafety.ts`

## Stock at end

- Visited / in-progress / unvisited: 30 / 1 / 7
- Current service / next module: `employeeBookings` (in-progress) / `reconciliationPolicy.ts`

## Messages posted

- 2026-09-09T0309Z next

## Ideas parked

- none

## Contradictions

- Claim miss is 409 here; public submit stays leadless
- Submit claims only; attach claims then stamps with `preserveExistingCpl`
- Mint then `apply_submission_source` writes Source and CPL twice
- Omitted `sourceResolution` (rematch) leaves the Lead and still sets Booking `source` to the prepared display label
- Missing CPL is reported inside this write; Form Lead ingestion reports after commit
- Reassign claims the next Lead first so a failed claim keeps the old attachment
- This file returns jobs and does not persist or finalize Sheet Sync
