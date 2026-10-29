# Show a bounded sample of official Bookings

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/jobNumberTimeline/recent-official-bookings.ts`
- Knowledge: `docs/knowledge/services/job-number-timeline.md`

## Current operation and boundaries

Separate Owner-only sample returns at most three latest official booked_leads by book date with safe job/date projection. It is not a Job Number catalog or module.read and carries no contact.

## Remaining recommendation

Keep listRecentOfficialBookingExamples and injectable Mongo lister as one small story. Name fallback date parsing explicitly without broadening query or adding pagination.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`RECENT_OFFICIAL_BOOKING_EXAMPLE_LIMIT`; `RecentOfficialBookingExample`; `RecentOfficialBookingLister`; `listRecentOfficialBookingExamples`; `createMongoRecentOfficialBookingLister`

## Parity proof

Hard cap3; newest book_date; empty/malformed rows; safe job/date shape; no contact and no mutation.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
