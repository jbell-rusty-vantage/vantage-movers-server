# Session story-routes-granot-lifecycle-admin-2026-09-11T1520Z

- Date (UTC): 2026-09-11
- Service / module: `routes` / `granot-lifecycle-admin.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 315 (through `routes-ringcentral-registry.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `granot-lifecycle-admin.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-granot-lifecycle-admin.md`
- operations named: watch live webhook receipts (Owner SSE, gate before flush); search historical webhook receipts (Owner JSON, unmasked contact); show the intake queue and supporting cards (signed read; creating-observation / candidates Owner-only); show and resolve discrepancies; connect an official Booking to a Lead; ask an Owner Booking-case command; ask a leftover historical Release-case command; start the write-once clock or put a dead letter back — never put this desk before the secret, never capture a webhook here, never drain here, never mint an official Booking without an Owner command
- remaining in this service: `job-number-timeline-admin.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `job-number-timeline-admin.routes.ts`

## Messages posted

- 2026-09-11T1520Z next

## Ideas parked

- This desk sits after `/api/v1` secret; Drive / extension login sit before. Do not remount `requireApiSecret`.
- `/receipts/live` must stay before `/receipts` and `/receipts/:id/requeue`.
- `discrepancyAction` hides three Owner stories; Booking-case vs leftover Release-case confirm-cancellation share Zod, not a command.
- Connect-lead does not `observeGranotOwnerCommandResult`. Activation skips `Idempotency-Key`. Neither has a route test.
- Operator skill misses live/historical receipts, booking-case confirm-cancellation, and both connect-lead paths.
- `sendError` remaps every registry 403 to `OWNER_REQUIRED`, including unsigned case reads.
- Lead miss is generic `"Lead not found"`; case miss is `GRANOT_CASE_NOT_FOUND`.
- `GET .../jobs/:normalized_job_no` is `projectGranotJob`, not next `job-number-timeline`.
- Wave A projections rec still says default queue merges Booking and Release; current knowledge is booking-only.
- Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts`.

## Contradictions

- Operator skill / `v1.routes.test.ts` miss live receipts, historical receipts, booking-case cancel, connect-lead
- Wave A `granot-lifecycle-projections.md` default-merge vs current booking-only
- Knowledge `projections.md` lists discrepancy mutations under “Protected read surface”
- Wave A never enumerated `connectBookingToLead.ts`
- `sendError` remaps unsigned read-actor 403 to `OWNER_REQUIRED`
- This checkout has no `docs/adr/` and no `daily-operations-admin.routes.ts`
