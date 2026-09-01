# Phase 5 — Projections + creatingObservation + Admin `/intakes` (AC-R10)

**Branches:** `vantage-main-server` `lead-lifecycle`; `vantage-admin` `lead-lifecycle`  
**Status:** done  
**Date:** 2026-09-01

Not committed. No production flags. FINAL SPEC untouched. Live Events (Phase 7), knowledge docs (Phase 8), and Owner Daily / BILA rewrite are out of scope.

## Server (`vantage-main-server`)

### List (AC-R10)

`includeReleaseCasesInList` is true only when `query.kind === "release"`. Omitted kind and `kind: "booking"` list booking cases only. Technical callers may still pass `kind: "release"` for historical Release cases on the lifecycle case page.

### `latest_action`

`projectCaseLatestAction` uses `selectBookingIntakeLatestAction`. Later `priority_5` cannot win when Booked or Release evidence exists. List items and case detail both expose `latest_action`.

### Detail capabilities (spec §7)

`capabilities.confirm_cancellation` is true only when the case is open, mode is `review_existing_booking`, `latest_action === "release"`, and `booking_commands_enabled`. It is false when commands are disabled (waiting-intake warning stays). `capabilities.commands` is unchanged.

### Creating observation (spec §4.9 / §9)

`selectCreatingObservationEvidence`: latest `booked` → `preferred_booked`; Release-only → `preferred_release`; Priority-5-only → `latest_creating`. Pairing is null without a creating Booked Observation.

`getIntakeCreatingObservation` still tries the booking case first, then a historical Release case. Owner Intakes only requests booking case ids (list is booking-only), so it never uses the Release fallback. The fallback stays for `GET .../cases/:id/creating-observation` on a historical Release id (existing technical route tests require it). `getBookingIntakeCreatingObservation` is the Owner Intakes path and does not fall through to a Release case.

### Job timeline

Left `assemble.ts` emit of historical `cancellation_intake` from Release cases. New Release evidence lands on booking cases, so assemble already emits `booking_intake`. Historical `cancellation_intake` rendering stays.

## Admin (`vantage-admin`)

### `/intakes`

One tab: Booking intakes. `IntakeCasePage` always opens `BookingIntakeWorkbench`. `CancellationIntakeWorkbench` is unused on `/intakes` (file kept as a tombstone; technical lifecycle case page still uses `ReleaseOwnerActions` for historical `kind: "release"`).

Empty open booking queue: "No booking intakes waiting. When Granot records a Booked or Release job, it will show up here."

`intakeActionLabel` is **Finish booking** for every intake list CTA. It never returns "Review cancellation". Review-release detail may say "Review booking or cancellation."

### Copy (must not say Granot cancelled)

| Surface | Copy |
| --- | --- |
| `intakeWhyHere("booked")` | Granot recorded a booking |
| `intakeWhyHere("release")` | Granot released this job |
| `intakeWhyHere("priority_5")` | Opened under the retired Priority 5 trigger |
| List / headline, no Booking, latest Release | Granot released this job. There is still no Vantage booking. File the booking if the sale is real, or choose No Action. |
| List / headline, has Booking, latest Release | Granot released this job. That may be a customer cancel or a booking edit. Review the official booking. |
| `granotStatementHeadline` for Release | Granot released job {n} … — never “Granot cancelled” |
| `creatingObservationTitle("preferred_release")` | Granot Release payload |
| `intakeActionLabel` | Finish booking |

`CANCELLATION_INTAKE_STORY` remains as an unused owner-path tombstone so leftover statement-card imports compile. It is not an Intakes tab.

### Three-command block

When `latest_action === "release"` and mode is `review_existing_booking`, `BookingOwnerActions` renders Update Existing Booking + Confirm Granot Cancellation + No Action against booking-case routes. Confirm uses `POST /api/v1/admin/granot-lifecycle/booking-cases/:id/confirm-cancellation` via `confirmGranotBookingCancellation`. Hidden when `capabilities.commands` is false.

Proxy allowlist includes booking-cases `confirm-cancellation`. Audit mapping: `granot_booking_confirm_cancellation`. Authorization tests enumerate that action.

## Files

### Server

- `src/services/granotLifecycle/projections.ts`
- `src/services/granotLifecycle/projections.test.ts`
- `src/services/granotLifecycle/creatingObservation.ts`
- `src/services/granotLifecycle/creatingObservation.test.ts`
- `src/services/granotLifecycle/bookingIntakeLatestAction.ts` (Phase 1 helper, used here)

### Admin

- `components/intakes/intakes-dashboard.tsx`
- `components/intakes/intake-copy.ts`
- `components/intakes/intake-case-page.tsx`
- `components/intakes/booking-intake-workbench.tsx`
- `components/intakes/intake-list.tsx`
- `components/granot-lifecycle/booking-owner-actions.tsx`
- `components/granot-lifecycle/cancellation-command-form.tsx`
- `lib/api/granotLifecycle.ts`
- `app/api/proxy/[...path]/route.ts`
- `server/audit/proxyAuditPayload.ts`
- `server/auth/authorization.test.ts`
- `tests/intakes-components.test.ts`
- `tests/granot-lifecycle-components.test.ts`
- `tests/home-overview.test.ts`
- `lib/api/granotLifecycle.test.ts`
- `server/audit/proxyAuditPayload.test.ts`

`cancellation-intake-workbench.tsx` is unused on `/intakes`. `release-owner-actions.tsx` stays for historical Release cases on the technical lifecycle page.

## Tests

Server:

```
pnpm exec node --import tsx --test src/services/granotLifecycle/creatingObservation.test.ts src/services/granotLifecycle/projections.test.ts src/services/granotLifecycle/bookingIntakeLatestAction.test.ts src/services/granotLifecycle/bookingReconciliation.test.ts
pnpm exec tsc --noEmit
```

58 passed, 0 failed. `tsc --noEmit` clean.

Admin:

```
pnpm exec node --import tsx --test tests/intakes-components.test.ts tests/granot-lifecycle-components.test.ts tests/home-overview.test.ts lib/api/granotLifecycle.test.ts server/audit/proxyAuditPayload.test.ts server/auth/authorization.test.ts
pnpm exec tsc --noEmit
```

124 passed, 0 failed. `tsc --noEmit` clean.

Covered: Release-only → `preferred_release`; Booked+Release → `preferred_booked`; list booking-only by default; `latest_action` ignores later Priority 5; capabilities matrix §7; pairing null on Release-only; Release copy has no “cancelled” / “canceled”; one Intakes tab; review+release shows cancel form; create-missing+release does not; commands-off hides cancel form.

## Follow-ups for Phase 6

Historical Release-case migrate helper (spec §10): for each open `granot_release_reconciliation_cases` row, find or open the `{normalized_job_no, action_kind:"booked"}` booking case, append missing Release evidence, keep/set `review_existing_booking` when a live Booking exists, resolve the Release case with a recorded No Action / migrate reason. Do not invent official Cancellation or Booking writes. Do not drop Release collections. Open `release_without_vantage_booking` discrepancies may resolve or stay historical.
