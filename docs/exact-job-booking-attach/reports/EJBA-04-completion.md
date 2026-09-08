---
type: Completion report
title: EJBA-04 — Knowledge pointers
status: complete
closed: 2026-09-08
---

# EJBA-04 completion

Repos: `vantage-main-server` branch `exact-job-booking-attach`; `vantage-admin` `main` (rules only). Knowledge-only. No runtime change, no commit, no push, no deploy.

## What landed

Knowledge bodies and the Admin project-organization map now describe Exact Job Booking Attach and `owner_booking` cases as they shipped in EJBA-01–03. Sentences were reverified against current code, not copied from the specification.

### Employee / rematch (`employee-bookings.md`)

- Rule table is job-only: `call_job_no_exact`, `form_job_no_exact`. Default policy `exact-job-v1`.
- Parser rejects `form_lid_exact`, `form_contact_triple_exact`, `form_email_phone_exact`, `channel_phone_exact`. `none` still disables automatic attach.
- Two same-job Call Leads (or two Form Leads) are `multiple_matches`. Job vs phone on different Leads is `identity_conflict`.
- Rematch default reasons are `matching_unavailable,no_match`.
- Rematch and Owner pending snapshots use `snapshotEmployeeBookingAutoMatchPolicy()`.
- `dismiss` stays `dismiss`. An `owner_booking` pending case can be dismissed with no Lead; the Booking stays Leadless.

### Precise Form server (`bookings.md`)

- Owner Call Lead asks Exact Job Booking Attach. No `findBestCallLeadMatchByPhone`. No Unmatched Call Lead mint.
- Miss / ambiguous → Leadless + pending case `origin=owner_booking`, `booking_origin=owner_booking`, HTTP 201, `data.reconciliation_case_id`.
- Unique job or Form Lead + Mongo ID → linked, no case, `booking_origin=owner_booking`.
- Explicit Owner leadless (non-import) always opens a case; sheet `booked_lead` / `owner_booking.create_pending`.
- Best Relocation import, Referral, and Confirm Granot Booking left as they shipped (import still phone-match / unmatched mint; Referral and Confirm open no case).
- Connect: `isConnectableLeadlessBooking` = official Granot Leadless and no pending Booking Lead Reconciliation Case. `owner_booking` and `employee_booking` are not official.

### Intake pointer (`owner-booking-intake.md`)

- Precise Form pending is not Granot official Leadless.
- Connect Booking to Lead for Confirm is unchanged.

### Admin rule (`vantage-admin/.cursor/rules/project-organization.mdc`)

- Precise Booking Form: optional Call phone, required Job, pending notice + `/bookings/reconciliation?case=`.
- Connect hidden when `booking_origin` is `employee_booking` or `owner_booking`.
- Reconciliation origin label “Precise Booking Form”; dismiss copy “Keep without a lead.”

## Commands

None. Knowledge-only. No `pnpm test` / `pnpm typecheck` for this issue.

## What this issue did not do

- Runtime or Admin UI changes (EJBA-01–03).
- Copy the specification into knowledge bodies.
- Change Confirm / Best Relocation / `identity.ts` docs to something that did not ship.
- Touch Daily Operations Admin files.
- Update `docs/index.md` — pack and Service pointer sentences were already accurate.
- Update `docs/knowledge/services/sheet-sync.md` — the job-shape table lists typical examples (`referral_booking.create`, `leadless_booking.create`); it is not a complete operation list and is not false without `owner_booking.create_pending`. That operation is recorded in `bookings.md`.
- Claim Employee submit’s initial case snapshot calls `snapshotEmployeeBookingAutoMatchPolicy()`. Submit still writes the same two fields from `getEmployeeBookingMatchingConfig()`. Rematch and Owner pending use the snapshot helper.

## Evidence for acceptance

- Knowledge sentences match shipped files: `employeeBookingMatching.ts`, `bookingReconciliation.ts`, `leadMatchEvaluator.ts`, `ownerBookingAttach.ts`, `bookedLeadFromSource.service.ts`, `bookingSourceResolver.ts`, `leadlessBooking.service.ts`, `connectLead.ts`, `confirmAttachment.ts`, Admin `booking-form-copy.ts` / `booking-stored-lead.ts` / `booking-reconciliation-copy.ts`.
- Glossary terms used: Exact Job Booking Attach, Precise Booking Form, Booking Lead Reconciliation, Booking Lead Reconciliation Case, Leadless Booking, Connect Booking to Lead, Employee Booking Submission, Unmatched Call Lead. No new synonyms.
