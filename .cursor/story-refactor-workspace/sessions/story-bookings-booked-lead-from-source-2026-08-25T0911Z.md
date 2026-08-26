# Session story-bookings-booked-lead-from-source-2026-08-25T0911Z

- Date (UTC): 2026-08-25T09:11Z
- Service / module: `bookings` / `bookedLeadFromSource.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/17

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 1 / 1 / 36
- Recommendations on disk: 13 (`form-lead.md`, `leads-call-lead.md`, `leads-duplicate-lead.md`, `leads-ingestion-provenance.md`, `leads-source-company.md`, `leads-cpl-resolution.md`, `leads-lead-location.md`, `leads-lead-name.md`, `leads-lead-phone-matching.md`, `leads-source-lead-lookup.md`, `leads-call-lead-source-match.md`, `leads-lead-source-compatibility.md`, `bookings-booked-lead.md`)
- Current service / next module (TRAVERSAL): `bookings` (in-progress) / `bookedLeadFromSource.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/bookings-booked-lead-from-source.md`
- operations named: Book from the source form (find the Lead the form named / maybe reassign Source / fence Best Relocation twice / hand off to Book This Lead; public vs begin/complete)
- remaining in this service: `referralBooking.service.ts`, `leadlessBooking.service.ts`, `bookingMirror.service.ts`, `bookingSourceResolver.ts`, `bookingIdentity.ts`

## Stock at end

- Visited / in-progress / unvisited: 1 / 1 / 36
- Current service / next module: `bookings` / `referralBooking.service.ts`

## Messages posted

- 2026-08-25T0911Z next-run

## Ideas parked

- none

## Contradictions

- knowledge says one Best Relocation `requireBestRelocationImportSource`; this file fences assigned company then stored company
