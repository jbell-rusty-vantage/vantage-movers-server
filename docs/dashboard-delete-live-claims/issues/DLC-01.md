# DLC-01 — Release live claims on dashboard delete

> **Contract maturity: implementation-ready.** Session 1. Server only.

## 1. Authority and required reading

- **Pack specification:** [`../dashboard-delete-live-claims-specification.md`](../dashboard-delete-live-claims-specification.md)
  — §2 through §6. Wins on what a delete releases.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

Dashboard Booking delete drops the active Granot Record Link `booking_ref`
for that Booking, and drops `deterministic_booking_id` on an open Granot
Booking Reconciliation Case that names it. Cancellation delete keeps the
unwind it already has and leaves the surviving Booking’s link alone.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Prerequisites:** none.
- No commit, push, deploy, or production write unless asked.
- Do not repair job 5565003. That Booking was recreated on 2026-09-28.

## 4. Current-state evidence to verify

Observed 2026-09-28. **Reverify before coding.**

- `deleteBookedLead` and `deleteBookedLeadInTransaction` in
  `src/services/bookings/bookedLead.service.ts` clear the Lead via
  `clearBookingFromLead`, tombstone Sheet Sync, and `booking.deleteOne`.
  They do not read `granot_record_links`.
- `runExistingDeleteBookedLead` in
  `src/services/domainCommands/existingWrites.ts` persists
  `pending.mutations` from `deleteBookedLeadInTransaction`.
  `preallocatedChangeIds(4)` sizes that list.
- `GranotRecordLink` query middleware rejects `booking_ref` updates and
  rejects replace/delete. Confirm writes `booking_ref` with
  `collection.updateOne` in `bookingConfirmation.ts` `persistLink`.
- `assertCompatibleLink` in `bookingConfirmation.ts` throws
  `GRANOT_IDENTITY_CONFLICT` when an active link `booking_ref` is not the
  permitted Booking id. A missing Booking does not make that check pass.
- Open Granot Booking Reconciliation Cases are unique per
  `normalized_job_no` + `action_kind` (`state: "open"`).
  `deterministic_booking_id` is optional. Release-case
  `deterministic_booking_id` is required.
- `deleteCancelledLead` already `$unset`s `booking.cancelled` and clears
  Lead `cancelled`.

## 5. Locked decisions

- One shared helper used by both Booking delete functions, inside the
  delete session, before `booking.deleteOne`.
- Record Link write is `collection.updateOne` compare-and-swap. Lost
  match aborts the transaction.
- Allowlist stays closed to `booking_ref`.
- `assertCompatibleLink` stays strict.
- Resolved case history, superseded links, discrepancy snapshots, and
  Daily Operations facts stay.
- No Mongoose `deleteOne` middleware.

## 6. Deliverables

1. Failing replica tests for AC-DLC-01 through AC-DLC-12.
2. Shared Booking-delete release from specification §3.1 and §3.2,
   including cascade (AC-DLC-10) and referral/leadless links.
3. Canonical mutation list includes the Record Link change when a link
   matched. Compatibility delete persists that same change.
4. Cancellation delete tests lock specification §4. No new Cancellation
   link write.
5. `docs/knowledge/services/bookings.md` Delete section names the Record
   Link release and the open-case `deterministic_booking_id` release.

## 7. Out of scope

Specification §7. In particular: middleware, Confirm changes, Lead
`lead_ref` clearing, admin copy, production repairs, release-case
migration.

## 8. Done

- AC-DLC-01 through AC-DLC-12 pass.
- `bookings.md` Delete mentions both releases.
- `PROGRESS.md` set to `complete` with a finish log line.
