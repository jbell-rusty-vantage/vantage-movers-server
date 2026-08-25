# Session story-cancellations-cancellation-resolver-2026-08-25T1609Z

- Date (UTC): 2026-08-25T16:09Z
- Service / module: `cancellations` / `cancellationResolver.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / new PR (PR #23 already merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 2 / 1 / 35
- Recommendations on disk: 20 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`, `cancellations-cancelled-lead.md`)
- Current service / next module (TRAVERSAL): `cancellations` (in-progress) / `cancellationResolver.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/cancellations-cancellation-resolver.md`
- operations named: Find the Booking this cancellation names (Booking-id-only / Lead-id + bidirectional match / both-must-agree) / Load a Booking we may cancel on this public path (404 missing, 409 already cancelled, 409 Standalone for Referral / unauthorized leadless / missing Lead refs; `allowLeadless` never unlocks Referral)
- remaining in this service: `cancellationMirror.service.ts`

## Stock at end

- Visited / in-progress / unvisited: 2 / 1 / 35
- Current service / next module: `cancellations` (in-progress) / `cancellationMirror.service.ts`

## Messages posted

- 2026-08-25T1609Z next-run

## Ideas parked

- none

## Contradictions

- Knowledge lists Booking≠Lead 409 as a top-level resolver row; the check is `lead_id` path only. Split `Standalone…` vs write `Referral…` copy already open. See CONTRADICTIONS.md.
